#!/usr/bin/env bash
# One-time helper: opens a Chromium window on YOUR display with a dedicated
# profile + CDP port 9223. Sign in to Google once — the qloo key watcher then
# polls it headlessly forever after (you can close the window; profile persists).
# Re-run this script if the session ever lapses.
PROF=$HOME/.google-login-prof
DISPLAY=${DISPLAY:-:0} /usr/bin/chromium \
  --user-data-dir="$PROF" --remote-debugging-port=9223 \
  --no-first-run --no-default-browser-check --ozone-platform=x11 \
  "https://accounts.google.com/ServiceLogin?continue=https://mail.google.com/mail/" \
  >/tmp/login-helper.log 2>&1 &
echo "login window launched (pid $!). Sign in to Google, then you may close it."
echo "watcher polls CDP :9223 — session persists in $PROF"
