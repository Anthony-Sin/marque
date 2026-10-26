#!/usr/bin/env bash
# localgen watchdog — keep the SDXL-Turbo service (:8807) alive overnight.
#
#   scripts/localgen-watchdog.sh           # run in foreground (nohup it for real use)
#
# Every INTERVAL seconds it curls /health; every DEEP_EVERY cycles it asks for
# /health?deep=1 (one real 256px gen — proves the pipe, not just the socket).
# Two consecutive shallow failures, or any deep failure, trigger a restart —
# guarded so we only ever kill a process we spawned (tracked via $PIDFILE) and
# never stomp a foreign listener on the port. Logs to logs/localgen-watchdog.log;
# the service itself logs to logs/localgen.log.
#
# Knobs (env): LOCALGEN_PORT LOCALGEN_HOST WATCHDOG_INTERVAL WATCHDOG_DEEP_EVERY
#              WATCHDOG_COOLDOWN WATCHDOG_CURL_TIMEOUT WATCHDOG_DEEP_TIMEOUT
set -u

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PY="$ROOT/.venv-gen/bin/python3"
APP="$ROOT/server/scripts/localgen.py"
PORT="${LOCALGEN_PORT:-8807}"
HOST="${LOCALGEN_HOST:-127.0.0.1}"
LOG_DIR="$ROOT/logs"
LOG="$LOG_DIR/localgen-watchdog.log"
APP_LOG="$LOG_DIR/localgen.log"
PIDFILE="$LOG_DIR/localgen.pid"
INTERVAL="${WATCHDOG_INTERVAL:-30}"        # seconds between shallow checks
DEEP_EVERY="${WATCHDOG_DEEP_EVERY:-20}"    # deep check every N cycles (~10 min)
FAILS_TO_RESTART=2
COOLDOWN="${WATCHDOG_COOLDOWN:-180}"       # min seconds between restarts
CURL_TIMEOUT="${WATCHDOG_CURL_TIMEOUT:-10}"
DEEP_TIMEOUT="${WATCHDOG_DEEP_TIMEOUT:-180}" # a 256px gen can queue behind a real one

mkdir -p "$LOG_DIR"

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" | tee -a "$LOG"; }

# one watchdog at a time
exec 9>"$LOG_DIR/localgen-watchdog.lock"
if ! flock -n 9; then
  echo "another watchdog holds $LOG_DIR/localgen-watchdog.lock — exiting" >&2
  exit 1
fi

port_open() { (exec 3<>"/dev/tcp/$HOST/$PORT") 2>/dev/null; }

tracked_alive() {
  [ -f "$PIDFILE" ] || return 1
  local p; p="$(cat "$PIDFILE" 2>/dev/null)"
  [ -n "$p" ] && kill -0 "$p" 2>/dev/null
}

kill_tracked() {
  local p; p="$(cat "$PIDFILE" 2>/dev/null || true)"
  [ -n "$p" ] && kill -0 "$p" 2>/dev/null || return 0
  log "killing tracked pid $p"
  kill "$p" 2>/dev/null
  for _ in $(seq 1 15); do kill -0 "$p" 2>/dev/null || break; sleep 1; done
  kill -9 "$p" 2>/dev/null || true
}

start_service() {
  log "starting localgen on :$PORT (log: $APP_LOG)"
  # setsid: own session, so a Ctrl-C on the watchdog's terminal can't
  # propagate SIGINT into the service. $! is the python pid (last-command exec).
  (
    cd "$ROOT/server/scripts" || exit 1
    # 9>&- : don't let the service inherit the watchdog's lock fd — an
    # inherited fd keeps the flock held for the service's whole lifetime.
    setsid nohup "$PY" localgen.py --port "$PORT" >>"$APP_LOG" 2>&1 9>&- &
    echo $! >"$PIDFILE"
  )
  local p; p="$(cat "$PIDFILE")"
  last_restart="$(date +%s)"
  log "spawned pid $p — waiting for readiness"
  for i in $(seq 1 36); do
    sleep 5
    if curl -fsS --max-time 5 "http://$HOST:$PORT/health" >/dev/null 2>&1; then
      log "ready after ~$((i * 5))s (pid $p)"
      return 0
    fi
    if ! kill -0 "$p" 2>/dev/null; then
      log "pid $p died during startup — see $APP_LOG"
      return 1
    fi
  done
  log "pid $p not healthy after 180s — left running, loop keeps watching"
  return 1
}

maybe_restart() {
  local now; now="$(date +%s)"
  if [ $((now - last_restart)) -lt "$COOLDOWN" ]; then
    log "restart suppressed — cooldown ($((now - last_restart))s < ${COOLDOWN}s)"
    return 1
  fi
  if port_open; then
    if tracked_alive; then
      log "port $PORT held by OUR pid $(cat "$PIDFILE") but unhealthy — restarting it"
      kill_tracked
    else
      # someone else's listener (or a manual start) — never stomp it
      log "port $PORT held by an UNTRACKED process — refusing to restart"
      return 1
    fi
  else
    # nothing listening: safe to start; sweep a tracked husk if it lingers
    if tracked_alive; then
      log "tracked pid $(cat "$PIDFILE") alive but not listening — killing husk"
      kill_tracked
    fi
  fi
  start_service
}

fail=0; cycle=0; last_restart=0
trap 'log "watchdog exiting (signal)"; exit 0' TERM INT
log "watchdog up — target http://$HOST:$PORT interval=${INTERVAL}s deep-every=${DEEP_EVERY} cycles"
while true; do
  cycle=$((cycle + 1))
  deep=0; [ $((cycle % DEEP_EVERY)) -eq 0 ] && deep=1
  url="http://$HOST:$PORT/health"; t="$CURL_TIMEOUT"
  if [ "$deep" -eq 1 ]; then url="$url?deep=1"; t="$DEEP_TIMEOUT"; fi
  if [ "$deep" -eq 1 ]; then
    out="$(curl -fsS --max-time "$t" "$url" 2>/dev/null)"; rc=$?
  else
    curl -fsS --max-time "$t" "$url" >/dev/null 2>&1; rc=$?
  fi
  if [ "$rc" -eq 0 ]; then
    [ "$fail" -gt 0 ] && log "recovered after $fail failure(s)"
    [ "$deep" -eq 1 ] && log "deep health OK: $(printf '%s' "$out" | tr -d ' \n')"
    fail=0
  else
    fail=$((fail + 1))
    log "health FAIL #$fail (deep=$deep url=$url)"
    if [ "$deep" -eq 1 ] || [ "$fail" -ge "$FAILS_TO_RESTART" ]; then
      maybe_restart && fail=0
    fi
  fi
  sleep "$INTERVAL"
done
