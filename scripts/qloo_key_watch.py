#!/usr/bin/env python3
"""Watch Gmail for the Qloo hackathon API key -> write QLOO_API_KEY to marque/.env.

Each tick pulls live cookies from a CDP browser (:9223 login-helper window, or
:9222 automation browser if a Google session exists there), hits Gmail's
basic-HTML interface, searches for Qloo mail, extracts the API key.

Loop: python3 scripts/qloo_key_watch.py   (--once, --interval N)
Arm it once:  scripts/google-login-helper.sh  -> sign in -> done.
"""
import argparse, json, os, re, subprocess, sys, time
from html import unescape

ENV_FILE = "/home/ANT/marque/.env"
FLAG = "/tmp/qloo_key_found"
PULL = "/home/ANT/marque/scripts/gmail_cdp_pull.mjs"
PORTS = ["9224", "9223", "9222"]
QUERIES = ["from:qloo", "qloo api key", "subject:qloo"]
KEY_RE = re.compile(r"(?:api[_ -]?key|x-api-key|key is|token)[:\s'\"=]*([A-Za-z0-9][A-Za-z0-9_\-\.]{19,127})", re.I)
BARE_RE = re.compile(r"\b([A-Za-z0-9]{24,48}\.[A-Za-z0-9_\-\.]{24,64}|[A-Fa-f0-9]{32,64}|sk-[A-Za-z0-9_\-]{16,})\b")

def log(*a): print(time.strftime("[%H:%M:%S]"), *a, flush=True)

def pull_cookies():
    for p in PORTS:
        try:
            r = subprocess.run(["node", PULL, p], capture_output=True, text=True, timeout=20)
            f = f"/tmp/cdp_cookies_{p}.json"
            if r.returncode == 0 and os.path.exists(f):
                return json.loads(open(f).read()), p
        except Exception:
            pass
    return None, None

def gmail_session():
    import requests
    cookies, port = pull_cookies()
    if not cookies:
        return None, None
    s = requests.Session()
    s.headers["User-Agent"] = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/131 Safari/537.36"
    n = 0
    for c in cookies:
        if "google" not in c.get("domain", ""):
            continue
        try:
            c["value"].encode("latin-1")
            s.cookies.set(c["name"], c["value"], domain=c["domain"].lstrip("."))
            n += 1
        except Exception:
            pass
    return (s if n else None), port

def find_key(s):
    seen = set()
    for q in QUERIES:
        r = s.get("https://mail.google.com/mail/h/", params={"s": "q", "q": q}, timeout=30)
        if r.status_code != 200:
            continue
        if "accounts.google.com" in r.url:
            return "NOAUTH", None
        for th in re.findall(r'th=([0-9a-f]+)', r.text)[:8]:
            if th in seen:
                continue
            seen.add(th)
            m = s.get("https://mail.google.com/mail/h/", params={"th": th, "v": "c"}, timeout=30)
            text = unescape(re.sub(r"<[^>]+>", " ", m.text))
            low = text.lower()
            # must actually be a qloo thread mentioning a key — not any random hex
            if "qloo" not in low or ("key" not in low and "token" not in low):
                continue
            cands = []
            k = KEY_RE.search(text)
            if k:
                cands.append(k.group(1))
            cands += [b for b in BARE_RE.findall(text) if re.search(r"[a-z]", b) or re.search(r"[A-Z]", b)]
            for cand in cands:
                if verify_key(cand):
                    return cand, th
                log(f"candidate {cand[:8]}… rejected by qloo (401)")
    return None, None

def verify_key(key):
    """Check candidate against the real Qloo endpoint before trusting it."""
    import urllib.request
    try:
        r = urllib.request.urlopen(urllib.request.Request(
            "https://hackathon.api.qloo.com/v2/insights?filter.type=urn:entity:brand&take=1",
            headers={"X-Api-Key": key}), timeout=20)
        return r.status == 200
    except urllib.error.HTTPError as e:
        return e.code != 401  # 401 = bad key; 429/5xx = key probably fine
    except Exception:
        return False

def write_env(key):
    old = ""
    if os.path.exists(ENV_FILE):
        old = open(ENV_FILE).read()
    lines = [l for l in old.splitlines() if not l.startswith("QLOO_API_KEY=")]
    lines.append(f"QLOO_API_KEY={key}")
    open(ENV_FILE, "w").write("\n".join(lines) + "\n")
    open(FLAG, "w").write(key + "\n")

def tick():
    s, port = gmail_session()
    if not s:
        log("no CDP browser with google cookies (run scripts/google-login-helper.sh once)")
        return False
    key, th = find_key(s)
    if key == "NOAUTH":
        log(f":{port} has google cookies but session is signed out — re-login via helper")
        return False
    if key:
        write_env(key)
        log(f"KEY FOUND (:{port}, thread {th}): {key[:8]}… -> {ENV_FILE}")
        return True
    log(f":{port} authed, no qloo key mail yet")
    return False

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--once", action="store_true")
    ap.add_argument("--interval", type=int, default=1800)
    a = ap.parse_args()
    if os.path.exists(FLAG):
        log("already found:", open(FLAG).read().strip()[:8] + "…")
        return
    while True:
        try:
            if tick():
                return
        except Exception as e:
            log("tick failed:", e)
        if a.once:
            return
        time.sleep(a.interval)

if __name__ == "__main__":
    main()
