# Marque

Agentic brand studio — a local-first pipeline from brand intake to published
artifacts. One continuous flow:

    profile → strategy board → moodboard → campaigns → shoots → sites → book

**Demo** — walkthrough video: <https://youtu.be/KCMrd_DM5uY> · packaged
release: <https://github.com/Anthony-Sin/marque/releases/tag/v1.0-qloo-hackathon>
· built for the [Qloo Agentic Hackathon](https://qloo.devpost.com).

- **Brand DNA** — `POST /api/profile/build` scrapes a URL (copy, colors,
  fonts, images) into voice/palette/audience; `/api/profile/scratch` builds
  one via agent chat; `/api/profile/template` clones a starter. Qloo
  taste-graph affinities enrich the audience picture.
- **Strategy boards** — `POST /api/strategy` (+ SSE `/stream`) generates
  campaign plays on a board backed by logged Qloo calls;
  `/api/strategy/examples` pulls real reference work per card.
- **Moodboard** — `POST /api/boards/:id/moodboard` runs a job of nine
  sequential local SDXL-Turbo tiles (persona, venue, palette, key art…)
  distilled from the board's taste data.
- **Campaigns** — `POST /api/campaigns` generates brief + creatives (stills;
  `creatives/:id/animate` adds motion); per-creative edit/regen/fix-layout;
  `demo-video` films a site from its own board.
- **Shoots** — `POST /api/photoshoot` (`product`|`free` modes) renders brand
  stills; `:id/edit` does img2img edits.
- **Sites** — `POST /api/websites` generates versioned HTML from campaign /
  board context; `publish` exposes `/s/<slug>`; `:id/video` captures a real
  screen film of the page.
- **Book** — `POST /api/brandbook` builds the style guide; publish at
  `/b/<slug>`; print view at `/api/brandbook/pdf`.

## Architecture

| Piece | Where | Port |
|-------|-------|------|
| Express API + static host | `server/` (`src/index.js`, all routes one file) | `:8787` |
| React/Vite SPA | `web/` (`src/views/*`, proxies `/api` `/assets` `/s` `/b` `/mockups`) | `:5173` |
| Local image service | `server/scripts/localgen.py` — SDXL-Turbo on GPU, own torch venv `.venv-gen` | `:8807` |

State is one JSON document — `data/state.json` (atomic writes; `DATA_DIR`
relocates). Every generated/scraped/uploaded file lands in `data/assets/`
(UUID-named, refcounted via `releaseAsset`), served at `/assets` behind a
CSP sandbox; `/assets/thumb/<file>?w=` renders cached downscales through PIL
in the gen venv. Long work (moodboards, shoots, video) runs on an in-memory
job runner — poll `GET /api/jobs/:id`. In production the same process serves
`web/dist` plus the `/s` `/b` publish routes — one process is the whole app.

## Run

```sh
cp .env.example .env        # fill keys (below)
npm install                 # root: concurrently only
npm --prefix server install && npm --prefix web install

npm run dev                 # API :8787 + vite :5173 (watch mode)
npm run build && npm start  # or: build web/dist, one node process on :8787
```

The GPU renderer is a separate service — start it with the torch venv
(system python lacks torch); set `LOCALGEN_PROVIDER` to un-`off`:

```sh
LOCALGEN_MODEL=stabilityai/sdxl-turbo .venv-gen/bin/python3 server/scripts/localgen.py   # :8807
```

Watchdog: `nohup scripts/localgen-watchdog.sh &` polls `:8807/health` every 30s
(`?deep=1` — a real 256px gen — every ~10min) and restarts a dead/unhealthy
service, guarded so it never kills a process it didn't spawn. Logs:
`logs/localgen-watchdog.log` + `logs/localgen.log`; `localgen.py --selftest`
runs the deep check once and exits.

Env vars (names only — `.env` is gitignored): `TENSOR_BASE_URL`
`TENSOR_API_KEY` `TENSOR_MODEL` — chat brain, all text features ·
`GEMINI_API_KEY` (+ optional `GEMINI_API_KEYS` pool) `GEMINI_IMAGE_MODEL`
`GEMINI_VIDEO_MODEL` — cloud image + video · `QLOO_API_KEY` `QLOO_BASE_URL`
— taste graph (hackathon endpoint) · `LOCALGEN_URL` `LOCALGEN_PROVIDER`
(`off`|`local-first`|`local-only`|`fallback`), optional `LOCALGEN_MODEL`
`_PORT` `_BASE` `_STEPS` `_MAXPX` `_OFFLOAD` · `PORT` (8787) `DATA_DIR`.
Publish lanes additionally read `TIKTOK_ACCESS_TOKEN`,
`META_ACCESS_TOKEN`+`IG_BUSINESS_ID`, `YOUTUBE_API_KEY`;
`GET /api/publish/status` reports honestly which are absent.

## Provider honesty model

Every artifact carries a provider stamp; `web/src/labels.js` +
`Composer.jsx:providerLabel()` map raw ids to reported names — a raw engine
id never reaches copy:

- `tensor` → **chat brain** — `/api/agent` and every `chatJSON` consumer
  (devin-cli is agentic tooling only, never a chat fallback)
- `local-<model>` (e.g. `local-sdxl-turbo`) → **studio render** — the GPU
  box; leads the chain under `local-first`/`local-only`, img2img refs included
- `gemini`/`imagen` → **cloud render**; `pollinations` → **web render**
  (keyless last resort, text-to-image only — refs dropped with a note)
- `veo` → **video model** — unprovisioned on this key tier, so stills
  animate through `ffmpeg-render` → **motion render** (always lands, says so)
- `site-capture` → **screen film** — chromium/playwright scroll-capture of
  a real generated page
- `qloo` → **the taste graph** — calls log `live` or `error` only; boards
  recompute `live`/`partial`/`error` on read. No synthetic evidence, ever.

## Testing / QA

`npm run smoke` — the API must be up on `:PORT` first; it exercises real
services plus live HTTP routes. `server/test/smoke.js` runs 26 checks: tensor ping,
gemini + resilient-chain gen, qloo search/insights, scraper, `/api/status`
shape + agent honesty, campaign/moodboard dedupe, profile patch round-trips,
thumbnail clamp, pinned-ref regen (traversal dropped), photoshoot lifecycle,
resize/animate jobs, promptStyle units. Localgen checks SKIP when the GPU
service is down; quota-blocked Gemini checks SKIP rather than fail.

For UI QA (playwright-core + system chromium; path is machine-local):

```sh
node scripts/qa_shot.mjs --url http://localhost:5173/<route> --out /tmp/x.png \
  [--w 1440 --h 900 --wait 1500 --click sel --hover sel --js "code" --scroll y --full --repeat n]
```

It prints `SHOT` paths, `METRICS` (`pageScrolls`, `hPageOverflow`,
`mainScroll`, `docScroll`) and console errors. Route-matrix expectation:
**no page scroll anywhere** — `pageScrolls=false`, `hPageOverflow=false` at
1440×900 and 390×844; views fit `100dvh` and scroll only inside their own
rails/panels.

## Repo map

`server/src/index.js` — every route (~1.4k lines, one file);
`server/src/services/` — one file per concern (store, tensor, gemini, media,
qloo, scraper, brand, strategy, campaigns, moodboard, sites, sitevideo,
brandbook, agent, devinCli); `server/src/config.js` + `tuning.js` — env and
knobs (`server/tuning.json`); `server/scripts/` — `localgen.py`, `thumb.py`;
`web/src/` — `App.jsx` rail/routes, `views/` per surface, `components/`,
`labels.js` honesty layer; `data/` — `state.json` + `assets/`; `docs/` —
`API.md`, `SYSTEM.md`, `STRATEGY.md`, `svg/` diagrams; `mockups/` —
dev-scratch statics (`MARQUE_DEV_MOCKUPS=1` re-enables in prod); `scripts/`
— QA + flow tooling (`qa_shot.mjs`, `flow_*.mjs`, …).

`TRIAGE.md` is the living triage board: sprint goal on top, reviewers append
numbered findings, builders consume and flip status. Read it before touching
the UI — scroll/jargon/provenance regressions are tracked there, not in
issues.
