# Marque — how the whole system works

Marque is a **local-first, on-brand marketing studio**. You give it a brand —
paste a site URL, chat your way through onboarding, or pick a template — and it
extracts a *brand DNA* (voice, palette, fonts, audience) enriched with **Qloo
taste-graph affinities** for that brand's audience. From there it's **one
pipeline**: the **strategy board** (audience-grounded campaign plans) → pick an
output on the card → the result lands — **ad sets, motion ads, AI video,
websites** (generated marketing sites you can publish and even film), or the
**brand book** (a printable style guide). Images come from a local sd-turbo
service with Gemini as escalation, video from Veo with an honest ffmpeg
fallback, and every artifact carries a **provenance badge** — `local ·
sd-turbo`, `gemini`, `ffmpeg` — so nothing pretends to be what it isn't.

This document is the map. `docs/API.md` covers the route contract in detail;
`docs/STRATEGY.md` has the strategy-board design notes; `TRIAGE.md` is the
running log of what was verified end-to-end. The three diagrams below are
also saved as standalone files in `docs/svg/` (`architecture.svg`,
`pipelines.svg`, `datamodel.svg`) for direct viewing.

---

## Repo layout

```
marque/
├─ package.json            # npm run dev = server + web concurrently
├─ server/
│  ├─ src/index.js         # Express app — every route (53KB, single file)
│  ├─ src/config.js        # env + paths (PORT 8787, DATA_DIR, API keys)
│  ├─ src/tuning.js        # loads server/tuning.json + env overrides
│  ├─ src/services/        # the whole backend, one file per concern
│  ├─ scripts/localgen.py  # sd-turbo image service on :8807 (GPU)
│  └─ test/smoke.js        # real-integration checks (npm run smoke)
├─ web/
│  ├─ vite.config.js       # dev server :5173, proxies /api /assets ^/s ^/b
│  └─ src/                 # React SPA — App.jsx, views/, components/, api.js
├─ data/
│  ├─ state.json           # the entire database (atomic writes)
│  └─ assets/              # every generated/scraped/uploaded file, UUID-named
├─ docs/                   # this file, API.md, STRATEGY.md, svg/
├─ mockups/                # competitor teardown captures + design studies
└─ TRIAGE.md               # QA log + honest-data contract + known limits
```

There is no build system beyond Vite, no ORM, no message queue, no test
framework — `server/test/smoke.js` hits the real APIs and reports PASS/FAIL.

---

## Architecture

<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1240 880" font-family="ui-monospace,'Cascadia Mono',Menlo,Consolas,monospace">
  <defs>
    <marker id="a1" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
      <path d="M0,0 L10,5 L0,10 z" fill="#e8e6df"/>
    </marker>
    <marker id="a2" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
      <path d="M0,0 L10,5 L0,10 z" fill="#ff4d00"/>
    </marker>
  </defs>
  <rect width="1240" height="880" fill="#121212"/>
  <text x="40" y="46" fill="#e8e6df" font-size="17" font-weight="700" letter-spacing="3">MARQUE — SYSTEM ARCHITECTURE</text>
  <text x="40" y="68" fill="#8f8d84" font-size="11.5">local-first marketing studio · one Express server · all state in data/state.json · keys never reach the browser</text>
  <rect x="40" y="110" width="240" height="200" rx="6" fill="#1a1a19" stroke="#454540"/>
  <rect x="40" y="110" width="240" height="30" rx="6" fill="#232322"/>
  <text x="56" y="130" fill="#ff4d00" font-size="12" font-weight="700" letter-spacing="2">WEB CLIENT</text>
  <text x="56" y="162" fill="#e8e6df" font-size="11">React SPA — views/*</text>
  <text x="56" y="182" fill="#8f8d84" font-size="10.5">plain CSS, no UI libs</text>
  <text x="56" y="202" fill="#8f8d84" font-size="10.5">SSE streams · job polling</text>
  <line x1="56" y1="216" x2="264" y2="216" stroke="#33332f"/>
  <text x="56" y="236" fill="#8f8d84" font-size="10.5">dev: Vite :5173 — proxies</text>
  <text x="56" y="254" fill="#8f8d84" font-size="10.5">  /api /assets ^/s ^/b</text>
  <text x="56" y="274" fill="#8f8d84" font-size="10.5">prod: static web/dist + SPA</text>
  <text x="56" y="292" fill="#8f8d84" font-size="10.5">  fallback on :8787</text>
  <rect x="340" y="110" width="570" height="580" rx="8" fill="#161615" stroke="#454540"/>
  <rect x="340" y="110" width="570" height="34" rx="8" fill="#232322"/>
  <text x="356" y="132" fill="#ff4d00" font-size="12" font-weight="700" letter-spacing="2">EXPRESS :8787 — server/src/index.js</text>
  <g font-size="10.5">
    <rect x="356" y="156" width="262" height="44" rx="4" fill="#1a1a19" stroke="#3a3a36"/>
    <text x="368" y="174" fill="#e8e6df">/api/* — REST routes</text>
    <text x="368" y="191" fill="#8f8d84">+ SSE: strategy · agent</text>
    <rect x="632" y="156" width="262" height="44" rx="4" fill="#1a1a19" stroke="#3a3a36"/>
    <text x="644" y="174" fill="#e8e6df">/assets — generated media</text>
    <text x="644" y="191" fill="#8f8d84">immutable · CSP sandbox</text>
    <rect x="356" y="208" width="262" height="44" rx="4" fill="#1a1a19" stroke="#3a3a36"/>
    <text x="368" y="226" fill="#e8e6df">/s/:slug — published sites</text>
    <text x="368" y="243" fill="#8f8d84">LLM single-file HTML</text>
    <rect x="632" y="208" width="262" height="44" rx="4" fill="#1a1a19" stroke="#3a3a36"/>
    <text x="644" y="226" fill="#e8e6df">/b/:slug — brand book</text>
    <text x="644" y="243" fill="#8f8d84">print-friendly HTML/PDF</text>
  </g>
  <rect x="356" y="268" width="262" height="330" rx="6" fill="#1a1a19" stroke="#3a3a36"/>
  <text x="368" y="290" fill="#8f8d84" font-size="10" letter-spacing="1.5">PIPELINE SERVICES</text>
  <g font-size="10.5">
    <text x="368" y="314" fill="#e8e6df">brand.js</text>
    <text x="368" y="331" fill="#8f8d84" font-size="9.5">profile build: scrape→DNA→Qloo</text>
    <text x="368" y="356" fill="#e8e6df">strategy.js</text>
    <text x="368" y="373" fill="#8f8d84" font-size="9.5">boards · audience read · fit</text>
    <text x="368" y="398" fill="#e8e6df">campaigns.js</text>
    <text x="368" y="415" fill="#8f8d84" font-size="9.5">briefs · creative copy+images</text>
    <text x="368" y="440" fill="#e8e6df">sites.js</text>
    <text x="368" y="457" fill="#8f8d84" font-size="9.5">marketing-site gen + edits</text>
    <text x="368" y="482" fill="#e8e6df">sitevideo.js</text>
    <text x="368" y="499" fill="#8f8d84" font-size="9.5">chromium scroll-capture → mp4</text>
    <text x="368" y="524" fill="#e8e6df">brandbook.js</text>
    <text x="368" y="541" fill="#8f8d84" font-size="9.5">brand book → printable HTML</text>
    <text x="368" y="566" fill="#e8e6df">scout.js</text>
    <text x="368" y="583" fill="#8f8d84" font-size="9.5">real example media (yt-dlp…)</text>
  </g>
  <rect x="632" y="268" width="262" height="330" rx="6" fill="#1a1a19" stroke="#3a3a36"/>
  <text x="644" y="290" fill="#8f8d84" font-size="10" letter-spacing="1.5">CLIENTS + CORE</text>
  <g font-size="10.5">
    <text x="644" y="314" fill="#e8e6df">tensor.js</text>
    <text x="644" y="331" fill="#8f8d84" font-size="9.5">chat · chatJSON · chatStream</text>
    <text x="644" y="356" fill="#e8e6df">qloo.js</text>
    <text x="644" y="373" fill="#8f8d84" font-size="9.5">live-or-error · evidence trail</text>
    <text x="644" y="398" fill="#e8e6df">gemini.js</text>
    <text x="644" y="415" fill="#8f8d84" font-size="9.5">image + veo · key-pool rotate</text>
    <text x="644" y="440" fill="#e8e6df">media.js</text>
    <text x="644" y="457" fill="#8f8d84" font-size="9.5">resilient image/video chains</text>
    <text x="644" y="482" fill="#e8e6df">scraper.js</text>
    <text x="644" y="499" fill="#8f8d84" font-size="9.5">fetchSite · SSRF-guarded</text>
    <text x="644" y="524" fill="#e8e6df">agent.js · devinCli.js</text>
    <text x="644" y="541" fill="#8f8d84" font-size="9.5">profile agent · acp stdio bridge</text>
    <text x="644" y="566" fill="#e8e6df">store.js · tuning.js</text>
    <text x="644" y="583" fill="#8f8d84" font-size="9.5">state.json CRUD · tuning.json</text>
  </g>
  <rect x="356" y="616" width="538" height="56" rx="6" fill="#1a1a19" stroke="#3a3a36"/>
  <text x="368" y="638" fill="#e8e6df" font-size="11">runJob() — in-memory job runner</text>
  <text x="368" y="657" fill="#8f8d84" font-size="10">GET /api/jobs/:id · progress {stage,done,total} · not persisted</text>
  <rect x="40" y="430" width="240" height="160" rx="6" fill="#1a1a19" stroke="#454540"/>
  <rect x="40" y="430" width="240" height="30" rx="6" fill="#232322"/>
  <text x="56" y="450" fill="#ff4d00" font-size="12" font-weight="700" letter-spacing="2">LOCALGEN :8807</text>
  <text x="56" y="482" fill="#e8e6df" font-size="11">scripts/localgen.py — python</text>
  <text x="56" y="502" fill="#8f8d84" font-size="10.5">sd-turbo fp16 · steps ≤ 8 · GPU</text>
  <text x="56" y="522" fill="#8f8d84" font-size="10.5">POST /generate → PNG · /health</text>
  <text x="56" y="542" fill="#8f8d84" font-size="10.5">noise gate: rejects static,</text>
  <text x="56" y="559" fill="#8f8d84" font-size="10.5">reseed once → 500 escalates</text>
  <g>
    <rect x="960" y="110" width="240" height="76" rx="6" fill="#1a1a19" stroke="#454540"/>
    <text x="976" y="134" fill="#e8e6df" font-size="11" font-weight="700">TensorMux / GLM</text>
    <text x="976" y="152" fill="#8f8d84" font-size="9.5">chat completions · glm-4-7-flash</text>
    <text x="976" y="169" fill="#8f8d84" font-size="9.5">all text, JSON, reasoning — tensor.js</text>
    <rect x="960" y="198" width="240" height="76" rx="6" fill="#1a1a19" stroke="#454540"/>
    <text x="976" y="222" fill="#e8e6df" font-size="11" font-weight="700">Gemini API</text>
    <text x="976" y="240" fill="#8f8d84" font-size="9.5">image models + Veo long-running</text>
    <text x="976" y="257" fill="#8f8d84" font-size="9.5">5-key pool rotation — gemini.js</text>
    <rect x="960" y="286" width="240" height="76" rx="6" fill="#1a1a19" stroke="#454540"/>
    <text x="976" y="310" fill="#e8e6df" font-size="11" font-weight="700">Qloo taste graph</text>
    <text x="976" y="328" fill="#8f8d84" font-size="9.5">/search · /v2/tags · /v2/insights</text>
    <text x="976" y="345" fill="#8f8d84" font-size="9.5">audience affinities — qloo.js</text>
    <rect x="960" y="374" width="240" height="76" rx="6" fill="#1a1a19" stroke="#454540"/>
    <text x="976" y="398" fill="#e8e6df" font-size="11" font-weight="700">Devin CLI</text>
    <text x="976" y="416" fill="#8f8d84" font-size="9.5">`devin acp` agent over stdio</text>
    <text x="976" y="433" fill="#8f8d84" font-size="9.5">vision inspect + audits — devinCli.js</text>
    <rect x="960" y="462" width="240" height="76" rx="6" fill="#1a1a19" stroke="#454540"/>
    <text x="976" y="486" fill="#e8e6df" font-size="11" font-weight="700">pollinations.ai</text>
    <text x="976" y="504" fill="#8f8d84" font-size="9.5">keyless image generation</text>
    <text x="976" y="521" fill="#8f8d84" font-size="9.5">last-resort fallback — media.js</text>
    <rect x="960" y="550" width="240" height="76" rx="6" fill="#1a1a19" stroke="#454540"/>
    <text x="976" y="574" fill="#e8e6df" font-size="11" font-weight="700">the open web</text>
    <text x="976" y="592" fill="#8f8d84" font-size="9.5">scraped sites · yt-dlp · iTunes</text>
    <text x="976" y="609" fill="#8f8d84" font-size="9.5">Wikipedia · Wikimedia — scraper/scout</text>
  </g>
  <rect x="340" y="730" width="570" height="110" rx="8" fill="#1a1a19" stroke="#454540"/>
  <text x="356" y="756" fill="#ff4d00" font-size="12" font-weight="700" letter-spacing="2">data/</text>
  <text x="356" y="780" fill="#e8e6df" font-size="10.5">state.json — profile · catalog · boards · campaigns · photoshoots ·</text>
  <text x="356" y="798" fill="#e8e6df" font-size="10.5">  websites · brandbook · images registry (atomic tmp+rename writes)</text>
  <text x="356" y="822" fill="#8f8d84" font-size="10.5">assets/ — UUID-named media files · served immutable + nosniff</text>
  <line x1="280" y1="210" x2="332" y2="210" stroke="#e8e6df" stroke-width="1.5" marker-end="url(#a1)"/>
  <text x="286" y="200" fill="#8f8d84" font-size="9.5">REST + SSE</text>
  <line x1="332" y1="510" x2="288" y2="510" stroke="#e8e6df" stroke-width="1.5" marker-end="url(#a1)"/>
  <text x="40" y="416" fill="#8f8d84" font-size="9.5">← POST /generate (media.js)</text>
  <line x1="625" y1="690" x2="625" y2="722" stroke="#e8e6df" stroke-width="1.5" marker-end="url(#a1)"/>
  <text x="637" y="712" fill="#8f8d84" font-size="9.5">atomic JSON writes + asset files</text>
  <line x1="910" y1="148" x2="952" y2="148" stroke="#e8e6df" stroke-width="1.2" marker-end="url(#a1)"/>
  <line x1="910" y1="236" x2="952" y2="236" stroke="#e8e6df" stroke-width="1.2" marker-end="url(#a1)"/>
  <line x1="910" y1="324" x2="952" y2="324" stroke="#e8e6df" stroke-width="1.2" marker-end="url(#a1)"/>
  <line x1="910" y1="412" x2="952" y2="412" stroke="#e8e6df" stroke-width="1.2" marker-end="url(#a1)"/>
  <line x1="910" y1="500" x2="952" y2="500" stroke="#e8e6df" stroke-width="1.2" marker-end="url(#a1)"/>
  <line x1="910" y1="588" x2="952" y2="588" stroke="#e8e6df" stroke-width="1.2" marker-end="url(#a1)"/>
  <rect x="960" y="660" width="240" height="46" rx="4" fill="none" stroke="#3a3a36"/>
  <text x="976" y="680" fill="#8f8d84" font-size="10">EXTERNAL CALLS — all keys stay</text>
  <text x="976" y="696" fill="#8f8d84" font-size="10">server-side, never in the browser</text>
</svg>

**Three processes, three ports.** `npm run dev` starts Express on `:8787` and
Vite on `:5173` (proxies `/api`, `/assets`, `^/s`, `^/b` — the anchored regex
matters, a bare `/s` prefix swallowed `/src/**`). `server/scripts/localgen.py`
is a third process on `:8807` (needs `.venv-gen/bin/python3` — torch lives in
that venv). In production, Express serves `web/dist` plus an SPA fallback, so
one port is enough.

**The split of labor is deliberate:** fast text work (briefs, copy, site HTML,
agent) goes to TensorMux's GLM model; pixel generation goes to the local
sd-turbo then Gemini; taste data is Qloo-only; and *agentic* work — looking at
a creative and planning an edit, auditing a live site — goes to the `devin`
CLI over ACP stdio (`devinCli.js` keeps one persistent process + session and
serializes prompts on a queue). All keys stay server-side; the browser only
ever sees `/api/*` JSON and `/assets/*` files.

### Services reference (server/src/services/)

| file | does what |
|------|-----------|
| `store.js` | `state.json` get/set/list/push/find/update/remove — atomic tmp+rename. Asset helpers: `saveAssetBuf` (UUID name), `assetAbs` (basename-guarded), `registerImage`/`findImage` registry, `applyPatch` merge |
| `tensor.js` | OpenAI-compatible client — `chat`, `chatStream` (splits `delta.reasoning` vs `delta.content`), `chatJSON` with `repairJSON` + one retry |
| `qloo.js` | GET-only Qloo client — `/search`, `/v2/tags`, `/v2/insights`. `enrichProfile` builds a bundle: entity match (name-prefix gate) → tags → insights per entity type. **Live-or-error, never synthesized** |
| `scraper.js` | `fetchSite(url)` — SSRF-guarded (no private/loopback hosts, re-checked after redirects), strips to text, mines colors/fonts/socials, downloads top-scored images |
| `brand.js` | Builds the Profile three ways: website scrape → LLM DNA → `enrichProfile`; chat scratch (agent decides when `ready`); canned templates |
| `strategy.js` | The differentiator — per-ask Qloo bundle → deterministic `audienceRead` + `channelFit` → LLM draft → normalize (fit from fitMap not the model, signals re-matched to real entities, reach model, ruled-out gate) |
| `campaigns.js` | `generateBrief` (pasted-URL scrape included) → `generateCreatives` → `planCreatives` (LLM picks medium/angle/overlay) → `oneCreative` (copy → image → optional video). `resolveProductContext` chain: catalog → brief.urlContext → board.urlContext → notes "Original ask" |
| `media.js` | `genImageResilient` / `genVideoResilient` — the escalation chains (see below). Also `localgenImage`, `pollinationsImage`, `ffmpegAnimate` (ken-burns still→mp4) |
| `gemini.js` | Gemini image models (fallback list in tuning.json) + Veo `predictLongRunning` polling; round-robins a key pool on every call |
| `sitevideo.js` | Playwright-core + system Chromium: renders the generated site, ease-scrolls it, records webm → ffmpeg mp4. `planWantsSiteDemo` decides when a "demo" creative should film the real site instead of AI footage |
| `sites.js` | `generateWebsite`/`editWebsite` — chatJSON `{html}` first, raw-HTML completion fallback; versions kept per site |
| `brandbook.js` | Assembles the book record + renders `htmlBook` — a 7-page printable HTML document (story, voice, palette, type, imagery, taste signature) |
| `scout.js` | `/api/strategy/examples` backend — pulls *real* example media per strategy: YouTube/TikTok via yt-dlp, TV/podcast art via iTunes, OOH via Wikimedia |
| `agent.js` | Profile-editing chat agent — JSON tool protocol (`qloo_search`, `qloo_insights`, `update_profile`), max 6 steps; `agentChatStream` streams reply tokens out of the JSON envelope |
| `devinCli.js` | `devin acp` bridge — one process/session, prompt queue; `devinCliChat` text, `devinCliInspect` sends image files for vision work |
| `tuning.js` | Loads `server/tuning.json` — every heuristic constant (channels, reach priors, lean rules, model fallback lists, budgets) editable without code changes; `TUNING_<KEY>` env overrides |

---

## The one pipeline — board → produced output

<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1240 950" font-family="ui-monospace,'Cascadia Mono',Menlo,Consolas,monospace">
  <defs>
    <marker id="a1" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
      <path d="M0,0 L10,5 L0,10 z" fill="#e8e6df"/>
    </marker>
    <marker id="a2" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
      <path d="M0,0 L10,5 L0,10 z" fill="#ff4d00"/>
    </marker>
  </defs>
  <rect width="1240" height="950" fill="#121212"/>
  <text x="40" y="42" fill="#e8e6df" font-size="17" font-weight="700" letter-spacing="3">MARQUE — GENERATION PIPELINES</text>
  <text x="40" y="64" fill="#8f8d84" font-size="11.5">two request flows · dashed orange = escalation / fallback path · every artifact keeps a provider badge</text>
  <text x="52" y="98" fill="#ff4d00" font-size="12" font-weight="700" letter-spacing="2">STRATEGY BOARD → PRODUCE — POST /api/strategy/stream (SSE), then one click to output</text>
  <rect x="40" y="108" width="1160" height="360" rx="8" fill="#161615" stroke="#3a3a36"/>
  <g>
    <rect x="58" y="130" width="180" height="130" rx="5" fill="#1f1f1e" stroke="#454540"/>
    <text x="72" y="152" fill="#ff4d00" font-size="11" font-weight="700">1 · ASK</text>
    <text x="72" y="174" fill="#e8e6df" font-size="10">prompt text, or a pasted</text>
    <text x="72" y="190" fill="#e8e6df" font-size="10">product/site URL</text>
    <text x="72" y="212" fill="#8f8d84" font-size="9.5">+ optional productId</text>
    <text x="72" y="228" fill="#8f8d84" font-size="9.5">(catalog item)</text>
    <rect x="263" y="130" width="180" height="130" rx="5" fill="#1f1f1e" stroke="#454540"/>
    <text x="277" y="152" fill="#ff4d00" font-size="11" font-weight="700">2 · SCRAPE</text>
    <text x="277" y="174" fill="#e8e6df" font-size="10">fetchSite(url)</text>
    <text x="277" y="190" fill="#8f8d84" font-size="9.5">public hosts only —</text>
    <text x="277" y="206" fill="#8f8d84" font-size="9.5">SSRF guard</text>
    <text x="277" y="228" fill="#8f8d84" font-size="9.5">title + description →</text>
    <text x="277" y="244" fill="#8f8d84" font-size="9.5">urlContext</text>
    <rect x="468" y="130" width="210" height="130" rx="5" fill="#1f1f1e" stroke="#454540"/>
    <text x="482" y="152" fill="#ff4d00" font-size="11" font-weight="700">3 · PER-ASK TASTE PULL</text>
    <text x="482" y="174" fill="#e8e6df" font-size="10">qloo.enrichProfile (lite)</text>
    <text x="482" y="192" fill="#8f8d84" font-size="9.5">/search entity (name-match gate)</text>
    <text x="482" y="208" fill="#8f8d84" font-size="9.5">→ /v2/tags → /v2/insights ×types</text>
    <text x="482" y="230" fill="#e8e6df" font-size="9.5">bundle: live | partial | error</text>
    <text x="482" y="246" fill="#8f8d84" font-size="9.5">every call logged w/ mode+ms</text>
    <rect x="703" y="130" width="210" height="130" rx="5" fill="#1f1f1e" stroke="#454540"/>
    <text x="717" y="152" fill="#ff4d00" font-size="11" font-weight="700">4 · DETERMINISTIC READ</text>
    <text x="717" y="174" fill="#e8e6df" font-size="10">audienceRead</text>
    <text x="717" y="190" fill="#8f8d84" font-size="9.5">lean · mediaHabits · vibeWords</text>
    <text x="717" y="212" fill="#e8e6df" font-size="10">channelFit map</text>
    <text x="717" y="228" fill="#8f8d84" font-size="9.5">type→channel × mean affinity</text>
    <text x="717" y="244" fill="#8f8d84" font-size="9.5">± leanRules boost/penalize</text>
    <rect x="938" y="130" width="244" height="130" rx="5" fill="#1f1f1e" stroke="#454540"/>
    <text x="952" y="152" fill="#ff4d00" font-size="11" font-weight="700">5 · LLM DRAFT</text>
    <text x="952" y="174" fill="#e8e6df" font-size="10">chatJSON → 3–4 strategies</text>
    <text x="952" y="190" fill="#e8e6df" font-size="10">+ antiStrategies</text>
    <text x="952" y="212" fill="#8f8d84" font-size="9.5">title · angle · channels · formats</text>
    <text x="952" y="228" fill="#8f8d84" font-size="9.5">brief · watchouts · heroSignal</text>
    <text x="952" y="246" fill="#8f8d84" font-size="9.5">fallback: deterministic top-up</text>
  </g>
  <line x1="238" y1="195" x2="256" y2="195" stroke="#e8e6df" stroke-width="1.5" marker-end="url(#a1)"/>
  <line x1="443" y1="195" x2="461" y2="195" stroke="#e8e6df" stroke-width="1.5" marker-end="url(#a1)"/>
  <line x1="678" y1="195" x2="696" y2="195" stroke="#e8e6df" stroke-width="1.5" marker-end="url(#a1)"/>
  <line x1="913" y1="195" x2="931" y2="195" stroke="#e8e6df" stroke-width="1.5" marker-end="url(#a1)"/>
  <rect x="938" y="292" width="244" height="120" rx="5" fill="#1f1f1e" stroke="#454540"/>
  <text x="952" y="314" fill="#ff4d00" font-size="11" font-weight="700">6 · NORMALIZE + PERSIST</text>
  <text x="952" y="336" fill="#e8e6df" font-size="10">fit overwritten from fitMap</text>
  <text x="952" y="352" fill="#8f8d84" font-size="9.5">signals re-matched to real entities</text>
  <text x="952" y="368" fill="#8f8d84" font-size="9.5">reach = fit × channel priors</text>
  <text x="952" y="388" fill="#e8e6df" font-size="10">→ boards.push + activeBoardId</text>
  <line x1="1060" y1="260" x2="1060" y2="284" stroke="#e8e6df" stroke-width="1.5" marker-end="url(#a1)"/>
  <rect x="58" y="292" width="840" height="120" rx="5" fill="#1a1a19" stroke="#3a3a36"/>
  <text x="72" y="314" fill="#8f8d84" font-size="10" letter-spacing="1.5">WHAT THE CLIENT SEES — SSE FRAMES, IN ORDER</text>
  <g font-size="10">
    <rect x="72" y="328" width="128" height="30" rx="15" fill="#232322" stroke="#454540"/>
    <text x="88" y="348" fill="#8f8d84">stage: scraping</text>
    <rect x="214" y="328" width="128" height="30" rx="15" fill="#232322" stroke="#454540"/>
    <text x="230" y="348" fill="#8f8d84">stage: scraped</text>
    <rect x="356" y="328" width="110" height="30" rx="15" fill="#232322" stroke="#454540"/>
    <text x="377" y="348" fill="#e8e6df">audience</text>
    <rect x="480" y="328" width="110" height="30" rx="15" fill="#232322" stroke="#454540"/>
    <text x="499" y="348" fill="#e8e6df">strategies</text>
    <rect x="604" y="328" width="80" height="30" rx="15" fill="#232322" stroke="#454540"/>
    <text x="629" y="348" fill="#e8e6df">anti</text>
    <rect x="698" y="328" width="120" height="30" rx="15" fill="#232322" stroke="#ff4d00"/>
    <text x="716" y="348" fill="#ff4d00">done {board}</text>
    <rect x="72" y="370" width="746" height="30" rx="4" fill="none" stroke="#3a3a36"/>
    <text x="84" y="390" fill="#8f8d84" font-size="9.5">board sections fill live as each frame lands · a failed frame = 'error' — partial results still shown honestly</text>
  </g>
  <line x1="938" y1="352" x2="826" y2="352" stroke="#ff4d00" stroke-width="1.2" stroke-dasharray="4 4" marker-end="url(#a2)"/>
  <text x="52" y="508" fill="#ff4d00" font-size="12" font-weight="700" letter-spacing="2">└─ RENDER STAGE — inside the same produce run → POST /api/campaigns → runJob</text>
  <rect x="40" y="518" width="1160" height="400" rx="8" fill="#161615" stroke="#3a3a36"/>
  <rect x="58" y="540" width="180" height="130" rx="5" fill="#1f1f1e" stroke="#454540"/>
  <text x="72" y="562" fill="#ff4d00" font-size="11" font-weight="700">1 · BRIEF</text>
  <text x="72" y="584" fill="#e8e6df" font-size="10">generateBrief (LLM) or</text>
  <text x="72" y="600" fill="#e8e6df" font-size="10">strategy handoff</text>
  <text x="72" y="622" fill="#8f8d84" font-size="9.5">pasted URL → urlContext</text>
  <text x="72" y="638" fill="#8f8d84" font-size="9.5">board bundle + evidence</text>
  <text x="72" y="654" fill="#8f8d84" font-size="9.5">snapshotted when linked</text>
  <rect x="263" y="540" width="180" height="130" rx="5" fill="#1f1f1e" stroke="#454540"/>
  <text x="277" y="562" fill="#ff4d00" font-size="11" font-weight="700">2 · PLAN</text>
  <text x="277" y="584" fill="#e8e6df" font-size="10">planCreatives — LLM</text>
  <text x="277" y="600" fill="#e8e6df" font-size="10">assigns per slot:</text>
  <text x="277" y="622" fill="#8f8d84" font-size="9.5">medium image|video|copy</text>
  <text x="277" y="638" fill="#8f8d84" font-size="9.5">angle · overlayStyle</text>
  <text x="277" y="654" fill="#8f8d84" font-size="9.5">est. thumbstop score</text>
  <rect x="468" y="540" width="180" height="130" rx="5" fill="#1f1f1e" stroke="#454540"/>
  <text x="482" y="562" fill="#ff4d00" font-size="11" font-weight="700">3 · COPY</text>
  <text x="482" y="584" fill="#e8e6df" font-size="10">chatJSON per creative:</text>
  <text x="482" y="606" fill="#8f8d84" font-size="9.5">headline ≤ 10 words</text>
  <text x="482" y="622" fill="#8f8d84" font-size="9.5">body ≤ 24 words</text>
  <text x="482" y="638" fill="#8f8d84" font-size="9.5">cta ≤ 5 words</text>
  <text x="482" y="654" fill="#8f8d84" font-size="9.5">+ layout {vpos, hpos}</text>
  <rect x="673" y="540" width="250" height="196" rx="5" fill="#1f1f1e" stroke="#454540"/>
  <text x="687" y="562" fill="#ff4d00" font-size="11" font-weight="700">4 · IMAGE — genImageResilient</text>
  <text x="687" y="582" fill="#8f8d84" font-size="9.5">engine override? → single provider run</text>
  <rect x="687" y="592" width="222" height="26" rx="13" fill="#232322" stroke="#ff4d00"/>
  <text x="703" y="609" fill="#e8e6df" font-size="10">localgen · sd-turbo (:8807)</text>
  <line x1="798" y1="618" x2="798" y2="630" stroke="#ff4d00" stroke-width="1.2" stroke-dasharray="3 3" marker-end="url(#a2)"/>
  <rect x="687" y="630" width="222" height="26" rx="13" fill="#232322" stroke="#454540"/>
  <text x="703" y="647" fill="#e8e6df" font-size="10">gemini (key pool + model list)</text>
  <line x1="798" y1="656" x2="798" y2="668" stroke="#ff4d00" stroke-width="1.2" stroke-dasharray="3 3" marker-end="url(#a2)"/>
  <rect x="687" y="668" width="222" height="26" rx="13" fill="#232322" stroke="#454540"/>
  <text x="703" y="685" fill="#e8e6df" font-size="10">pollinations.ai</text>
  <line x1="798" y1="694" x2="798" y2="706" stroke="#ff4d00" stroke-width="1.2" stroke-dasharray="3 3" marker-end="url(#a2)"/>
  <rect x="687" y="706" width="222" height="24" rx="4" fill="none" stroke="#3a3a36"/>
  <text x="699" y="722" fill="#8f8d84" font-size="9.5">all failed → SVG placeholder + flag</text>
  <rect x="948" y="540" width="234" height="130" rx="5" fill="#1f1f1e" stroke="#454540"/>
  <text x="962" y="562" fill="#ff4d00" font-size="11" font-weight="700">5 · OVERLAY</text>
  <text x="962" y="584" fill="#e8e6df" font-size="10">copy composited as DOM</text>
  <text x="962" y="600" fill="#e8e6df" font-size="10">overlay — never baked in</text>
  <text x="962" y="622" fill="#8f8d84" font-size="9.5">6 presets: performance · ugc ·</text>
  <text x="962" y="638" fill="#8f8d84" font-size="9.5">editorial · marker · brutalist · glass</text>
  <text x="962" y="656" fill="#8f8d84" font-size="9.5">canvas mirror → PNG export</text>
  <rect x="673" y="762" width="250" height="130" rx="5" fill="#1f1f1e" stroke="#454540"/>
  <text x="687" y="784" fill="#ff4d00" font-size="11" font-weight="700">6 · VIDEO — genVideoResilient</text>
  <text x="687" y="806" fill="#8f8d84" font-size="9.5">medium=video → demo-ish brief?</text>
  <rect x="687" y="816" width="222" height="26" rx="13" fill="#232322" stroke="#ff4d00"/>
  <text x="699" y="833" fill="#e8e6df" font-size="10">site capture (playwright+ffmpeg)</text>
  <line x1="798" y1="842" x2="798" y2="854" stroke="#ff4d00" stroke-width="1.2" stroke-dasharray="3 3" marker-end="url(#a2)"/>
  <rect x="687" y="854" width="222" height="26" rx="13" fill="#232322" stroke="#454540"/>
  <text x="703" y="871" fill="#e8e6df" font-size="10">veo → ffmpeg-render (note kept)</text>
  <rect x="948" y="762" width="234" height="130" rx="5" fill="#1f1f1e" stroke="#454540"/>
  <text x="962" y="784" fill="#ff4d00" font-size="11" font-weight="700">7 · PERSIST</text>
  <text x="962" y="806" fill="#e8e6df" font-size="10">creative → campaign.creatives[]</text>
  <text x="962" y="826" fill="#8f8d84" font-size="9.5">imagePath + imageProvider</text>
  <text x="962" y="842" fill="#8f8d84" font-size="9.5">videoPath + videoProvider</text>
  <text x="962" y="858" fill="#8f8d84" font-size="9.5">registerImage → /assets/&lt;uuid&gt;</text>
  <text x="962" y="876" fill="#8f8d84" font-size="9.5">job.progress polls till done</text>
  <line x1="238" y1="605" x2="256" y2="605" stroke="#e8e6df" stroke-width="1.5" marker-end="url(#a1)"/>
  <line x1="443" y1="605" x2="461" y2="605" stroke="#e8e6df" stroke-width="1.5" marker-end="url(#a1)"/>
  <line x1="648" y1="605" x2="666" y2="605" stroke="#e8e6df" stroke-width="1.5" marker-end="url(#a1)"/>
  <line x1="923" y1="605" x2="941" y2="605" stroke="#e8e6df" stroke-width="1.5" marker-end="url(#a1)"/>
  <line x1="798" y1="736" x2="798" y2="754" stroke="#e8e6df" stroke-width="1.5" marker-end="url(#a1)"/>
  <text x="810" y="750" fill="#8f8d84" font-size="9.5">if medium=video</text>
  <line x1="1065" y1="670" x2="1065" y2="754" stroke="#e8e6df" stroke-width="1.5" marker-end="url(#a1)"/>
  <line x1="923" y1="827" x2="941" y2="827" stroke="#e8e6df" stroke-width="1.5" marker-end="url(#a1)"/>
</svg>

### Strategy board → produce — `POST /api/strategy/stream` (SSE), then one click to output

The heart of the product — and the whole pipeline. The board runs the ask →
audience read → strategy cards → ruled-out list, then each strategy's **Produce**
row picks the output: `Ad set` (4 stills), `Motion ad` (set + animated hero),
`AI video` (video-first units), `Website`, or `Brand book`. Media outputs hand
the strategy to `/campaigns` which auto-drafts the brief, auto-confirms, and
lands on the **final result** — the campaign detail carrying a provenance band
(strategy snapshot: fit, est. reach, audience lean, vibe words) and the brand
palette strip. Site/book outputs generate inline and land on their surfaces.

Key detail: the taste pull is **per-ask** — the bundle is enriched for *this*
prompt/product/URL, not recycled from the profile, so every board hunts its own
audience. An entity is only trusted as an insights anchor when its name
genuinely starts with the query token (`relevantHit` — "Sint-Genesius-Rode" is
rejected for "Rhode"); otherwise live tag ids anchor the calls. `audienceRead`
and `channelFit` are computed deterministically from the bundle — the LLM
ideates, but the numbers come from data, and `normalizeStrategy` overwrites the
model's fit scores, re-matches its cited signals to real entities, and gates the
"ruled out" list so a channel can only be rejected when it's strictly weaker
than every recommendation. SSE emits each stage as it completes; the
non-streaming route returns the same shape in one shot.

**Render stage (inside the same produce run)** — `POST /api/campaigns` →
background job: `generateBrief` first (or the strategy handoff via
`sessionStorage` + `auto`), then the create call snapshots the source board's
`qlooBundle`+`evidence` and a `strategySnapshot` (title/fit/reach/lean/vibes)
**only when `boardId` is explicitly passed** — that rule exists because a wrong
board guess once contaminated creative copy with a different brand's context.
`planCreatives` lets the LLM pick each slot's medium (image/video/copy), angle,
overlay preset and estimated score — a `medium` pin on the campaign forces a
video- or image-only run for the AI-video/ad-set produce paths. Per creative:
copy is capped by `copyBudgets`, the image prompt demands a **text-free photo
with reserved negative space** (copy is composited as a DOM overlay by
`CreativeOverlay.jsx` and mirrored into the rasterized PNG by
`creativeExport.js` — glyphs are never baked into pixels), and video slots
either film the generated site (`renderSiteVideo`, when the plan smells like a
product demo and capture is available) or go through `genVideoResilient`. The
UI polls the job and the creative grid fills staggered as `job.progress
{stage,done,total}` advances.

**Outputs inherit the work.** `POST /api/websites` accepts
`{campaignId|boardId,strategyIdx}` — a `producedFrom` context carries the
campaign brief, the resolved product, and the rendered creative image paths
into the site prompt, so the generated site uses the brand palette and the
actual campaign imagery rather than inventing a look.

### The escalation chains (the interesting part)

| layer | chain | honesty |
|-------|-------|---------|
| image | engine override → `localgen sd-turbo` → `gemini` (key pool + model fallback list) → `pollinations` → SVG placeholder | `imageProvider` on the creative names the winner; `note` records `"after: local(...) \| gemini(...)"`; total failure = `placeholder:true` + `imageError` |
| video | site-demo capture *(if plan wants a demo)* → `veo` → `ffmpeg-render` ken-burns | `videoProvider` + `videoNote` persists e.g. `"veo failed: could not start operation"`; badge reads "watch · ffmpeg" |
| gemini internal | `GEMINI_IMAGE_MODEL` → `geminiImageFallbacks[]` (6 models); each call rotates the 5-key pool; one 503 retry | error strings keep every model's failure |
| localgen internal | generate → `is_noise()` gradient-energy check → reseed once → 500 | noise never ships; the 500 escalates the outer chain |
| LLM JSON | `chat` → `extractJSON` (`repairJSON` fixes sloppy strings) → assistant-echo retry → throw | failures surface as errors, not invented content |

---

## Data model

Everything lives in `data/state.json` (atomic tmp+rename writes via `store.js`)
plus `data/assets/` files. Asset filenames are **server-generated UUIDs** —
never user input — and every lookup goes through `path.basename`.

<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1240 880" font-family="ui-monospace,'Cascadia Mono',Menlo,Consolas,monospace">
  <defs>
    <marker id="a1" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
      <path d="M0,0 L10,5 L0,10 z" fill="#e8e6df"/>
    </marker>
  </defs>
  <rect width="1240" height="880" fill="#121212"/>
  <text x="40" y="42" fill="#e8e6df" font-size="17" font-weight="700" letter-spacing="3">MARQUE — DATA MODEL</text>
  <text x="40" y="64" fill="#8f8d84" font-size="11.5">data/state.json top-level keys · nested [] = embedded arrays · →asset = a path like /assets/&lt;uuid&gt;.png</text>
  <rect x="40" y="96" width="270" height="290" rx="6" fill="#1a1a19" stroke="#454540"/>
  <rect x="40" y="96" width="270" height="28" rx="6" fill="#232322"/>
  <text x="54" y="115" fill="#ff4d00" font-size="11.5" font-weight="700" letter-spacing="1.5">profile</text>
  <text x="230" y="115" fill="#8f8d84" font-size="9">object | null</text>
  <g font-size="10" fill="#e8e6df">
    <text x="54" y="144">id · createdAt · updatedAt</text>
    <text x="54" y="162">source {type, url|templateId}</text>
    <text x="54" y="180">name · tagline · description</text>
    <text x="54" y="198">tone[] · values[] · audience</text>
    <text x="54" y="216">colors {primary…text}</text>
    <text x="54" y="234">fonts {heading, body}</text>
    <text x="54" y="252">images[] {id, path→asset, caption}</text>
    <text x="54" y="270">socials · missingSocials</text>
    <text x="54" y="288" fill="#ff4d00">qloo → QlooBundle</text>
  </g>
  <line x1="54" y1="300" x2="296" y2="300" stroke="#33332f"/>
  <g font-size="9.5" fill="#8f8d84">
    <text x="54" y="318">built by scrape→LLM DNA→enrich,</text>
    <text x="54" y="334">chat scratch, or a template</text>
    <text x="54" y="356">profile.catalog mirrors catalog[]</text>
    <text x="54" y="372">on every read (syncProfileCatalog)</text>
  </g>
  <rect x="40" y="420" width="270" height="110" rx="6" fill="#1a1a19" stroke="#454540"/>
  <rect x="40" y="420" width="270" height="28" rx="6" fill="#232322"/>
  <text x="54" y="439" fill="#ff4d00" font-size="11.5" font-weight="700" letter-spacing="1.5">catalog</text>
  <text x="240" y="439" fill="#8f8d84" font-size="9">array</text>
  <g font-size="10" fill="#e8e6df">
    <text x="54" y="468">item {id, name, description}</text>
    <text x="54" y="486">image→asset · url · price</text>
    <text x="54" y="508" fill="#8f8d84" font-size="9.5">manual, /from-url scrape, or</text>
    <text x="54" y="522" fill="#8f8d84" font-size="9.5">saved from a photoshoot result</text>
  </g>
  <line x1="175" y1="420" x2="175" y2="394" stroke="#e8e6df" stroke-width="1.2" marker-end="url(#a1)"/>
  <text x="187" y="410" fill="#8f8d84" font-size="9">mirrors ↑</text>
  <rect x="40" y="560" width="270" height="130" rx="6" fill="#1a1a19" stroke="#454540"/>
  <rect x="40" y="560" width="270" height="28" rx="6" fill="#232322"/>
  <text x="54" y="579" fill="#ff4d00" font-size="11.5" font-weight="700" letter-spacing="1.5">brandbook</text>
  <text x="226" y="579" fill="#8f8d84" font-size="9">object | null</text>
  <g font-size="10" fill="#e8e6df">
    <text x="54" y="608">id · createdAt · paletteNote</text>
    <text x="54" y="626">coverImage → profile.images id</text>
    <text x="54" y="644">images[] → profile.images ids</text>
    <text x="54" y="662">publishedSlug → GET /b/:slug</text>
    <text x="54" y="680" fill="#8f8d84" font-size="9.5">rendered as printable HTML book</text>
  </g>
  <rect x="350" y="96" width="290" height="400" rx="6" fill="#1a1a19" stroke="#454540"/>
  <rect x="350" y="96" width="290" height="28" rx="6" fill="#232322"/>
  <text x="364" y="115" fill="#ff4d00" font-size="11.5" font-weight="700" letter-spacing="1.5">boards</text>
  <text x="545" y="115" fill="#8f8d84" font-size="9">array — "plans"</text>
  <g font-size="10" fill="#e8e6df">
    <text x="364" y="144">id · title · createdAt</text>
    <text x="364" y="162">sub {prompt, productId, url}</text>
    <text x="364" y="180">urlContext {url, title, description}</text>
    <text x="364" y="204" fill="#ff4d00">strategies[] →</text>
    <text x="380" y="222" font-size="9.5" fill="#e8e6df">{id "st1"…, title, angle, formats[]}</text>
    <text x="380" y="238" font-size="9.5" fill="#e8e6df">channels[{name, fit, why, noSignal}]</text>
    <text x="380" y="254" font-size="9.5" fill="#e8e6df">brief{title,angle,audience,keyMsg}</text>
    <text x="380" y="270" font-size="9.5" fill="#e8e6df">audienceFit · watchouts[]</text>
    <text x="380" y="286" font-size="9.5" fill="#e8e6df">qlooSignals[] · heroSignal · reach</text>
    <text x="364" y="310" fill="#ff4d00">antiStrategies[] →</text>
    <text x="380" y="328" font-size="9.5" fill="#e8e6df">{title, channel, whyNot}</text>
    <text x="364" y="352">audienceRead {lean, mediaHabits,</text>
    <text x="364" y="368">  vibeWords}</text>
    <text x="364" y="392" fill="#ff4d00">qlooBundle · evidence {signals,</text>
    <text x="364" y="408" fill="#ff4d00">  drivers, calls[]}</text>
  </g>
  <line x1="364" y1="420" x2="626" y2="420" stroke="#33332f"/>
  <g font-size="9.5" fill="#8f8d84">
    <text x="364" y="438">pointers: activeBoardId + lastStrategy</text>
    <text x="364" y="454">(legacy mirror of the active board)</text>
    <text x="364" y="476">qlooMode recomputed from calls[] on</text>
    <text x="364" y="490">every read — honestBoard()</text>
  </g>
  <rect x="680" y="96" width="280" height="400" rx="6" fill="#1a1a19" stroke="#454540"/>
  <rect x="680" y="96" width="280" height="28" rx="6" fill="#232322"/>
  <text x="694" y="115" fill="#ff4d00" font-size="11.5" font-weight="700" letter-spacing="1.5">campaigns</text>
  <text x="880" y="115" fill="#8f8d84" font-size="9">array</text>
  <g font-size="10" fill="#e8e6df">
    <text x="694" y="144">id · createdAt · aspectRatio</text>
    <text x="694" y="162">brief {title, angle, audience,</text>
    <text x="694" y="178">  keyMessage, channels[]}</text>
    <text x="694" y="200">productId → catalog item</text>
    <text x="694" y="218">boardId → boards · strategyId/Title</text>
    <text x="694" y="236">imageProvider (engine override)</text>
    <text x="694" y="254">qlooSignals[] · notes · ingredients</text>
    <text x="694" y="272" fill="#ff4d00">qlooBundle + evidence snapshot</text>
    <text x="694" y="288" fill="#8f8d84" font-size="9.5">(copied from the source board —</text>
    <text x="694" y="302" fill="#8f8d84" font-size="9.5"> only when boardId is passed)</text>
    <text x="694" y="326" fill="#ff4d00">creatives[] →</text>
    <text x="710" y="344" font-size="9.5" fill="#e8e6df">{id, headline, body, cta}</text>
    <text x="710" y="360" font-size="9.5" fill="#e8e6df">layout{vpos,hpos} · overlayStyle</text>
    <text x="710" y="376" font-size="9.5" fill="#e8e6df">imagePath→asset · imageProvider</text>
    <text x="710" y="392" font-size="9.5" fill="#e8e6df">videoPath→asset · videoProvider</text>
    <text x="710" y="408" font-size="9.5" fill="#e8e6df">videoNote · grade · score · badge</text>
  </g>
  <line x1="694" y1="420" x2="946" y2="420" stroke="#33332f"/>
  <g font-size="9.5" fill="#8f8d84">
    <text x="694" y="438">genStatus running|done|error</text>
    <text x="694" y="454">genError kept when it fails</text>
    <text x="694" y="476">placeholder SVG + imageError flag</text>
    <text x="694" y="490">when every provider fails</text>
  </g>
  <rect x="990" y="96" width="210" height="180" rx="6" fill="#1a1a19" stroke="#454540"/>
  <rect x="990" y="96" width="210" height="28" rx="6" fill="#232322"/>
  <text x="1004" y="115" fill="#ff4d00" font-size="11.5" font-weight="700" letter-spacing="1.5">websites</text>
  <text x="1130" y="115" fill="#8f8d84" font-size="9">array</text>
  <g font-size="10" fill="#e8e6df">
    <text x="1004" y="144">id · createdAt</text>
    <text x="1004" y="162">versions[] → {id, html,</text>
    <text x="1004" y="178">  prompt, createdAt}</text>
    <text x="1004" y="196">activeVersion → version id</text>
    <text x="1004" y="214">publishedSlug → /s/:slug</text>
    <text x="1004" y="232">demoVideo → asset mp4</text>
  </g>
  <text x="1004" y="258" fill="#8f8d84" font-size="9.5">lastSiteAudit {suggestions[],</text>
  <text x="1004" y="272" fill="#8f8d84" font-size="9.5">competitorNotes[]} — top level</text>
  <rect x="990" y="306" width="210" height="190" rx="6" fill="#1a1a19" stroke="#454540"/>
  <rect x="990" y="306" width="210" height="28" rx="6" fill="#232322"/>
  <text x="1004" y="325" fill="#ff4d00" font-size="11.5" font-weight="700" letter-spacing="1.5">photoshoots</text>
  <text x="1130" y="325" fill="#8f8d84" font-size="9">array</text>
  <g font-size="10" fill="#e8e6df">
    <text x="1004" y="354">id · createdAt</text>
    <text x="1004" y="372">mode: product | free</text>
    <text x="1004" y="390">inputImage→asset · prompt</text>
    <text x="1004" y="408">templates[] (studio, lifestyle…)</text>
    <text x="1004" y="430">results[] → {imagePath→asset,</text>
    <text x="1004" y="446">  template, provider}</text>
    <text x="1004" y="468">edits[] → {prompt, spec,</text>
    <text x="1004" y="484">  imagePath→asset, directed}</text>
  </g>
  <line x1="680" y1="200" x2="648" y2="200" stroke="#e8e6df" stroke-width="1.2" marker-end="url(#a1)"/>
  <text x="652" y="192" fill="#8f8d84" font-size="9">boardId</text>
  <polyline points="700,496 700,522 318,522 318,510" fill="none" stroke="#8f8d84" stroke-width="1.2" marker-end="url(#a1)"/>
  <text x="420" y="514" fill="#8f8d84" font-size="9">productId → catalog</text>
  <polyline points="40,640 24,640 24,240 40,240" fill="none" stroke="#55554f" stroke-width="1.2" stroke-dasharray="4 4" marker-end="url(#a1)"/>
  <rect x="40" y="730" width="1160" height="106" rx="8" fill="#161615" stroke="#3a3a36"/>
  <text x="56" y="756" fill="#ff4d00" font-size="11" font-weight="700" letter-spacing="1.5">images — registry</text>
  <text x="56" y="776" fill="#e8e6df" font-size="9.5">every generated / scraped / uploaded image: {id, path, source, provider, createdAt}</text>
  <text x="56" y="794" fill="#8f8d84" font-size="9.5">registerImage() dedupes by path · lets /api/images/:id resolve any asset</text>
  <text x="56" y="814" fill="#8f8d84" font-size="9.5">creative.imagePath · photoshoot results · website demoVideo all land here</text>
  <line x1="490" y1="744" x2="490" y2="824" stroke="#33332f"/>
  <text x="506" y="756" fill="#ff4d00" font-size="11" font-weight="700" letter-spacing="1.5">data/assets/ — media files</text>
  <text x="506" y="776" fill="#e8e6df" font-size="9.5">server-named UUIDs only: {uuid}.{png|jpg|webp|svg|mp4}</text>
  <text x="506" y="794" fill="#8f8d84" font-size="9.5">served immutable 7d + CSP sandbox + nosniff · writes are atomic (tmp+rename)</text>
  <text x="506" y="814" fill="#8f8d84" font-size="9.5">assetAbs() basename-guards every lookup — no traversal</text>
  <line x1="940" y1="744" x2="940" y2="824" stroke="#33332f"/>
  <text x="956" y="756" fill="#8f8d84" font-size="11" font-weight="700" letter-spacing="1.5">jobs — NOT persisted</text>
  <text x="956" y="776" fill="#e8e6df" font-size="9.5">in-memory Map: {id, kind, status,</text>
  <text x="956" y="792" fill="#e8e6df" font-size="9.5">  progress{stage,done,total}, result, error}</text>
  <text x="956" y="812" fill="#8f8d84" font-size="9.5">returned by campaigns, photoshoots,</text>
  <text x="956" y="826" fill="#8f8d84" font-size="9.5">animate, site-video — polled via /api/jobs/:id</text>
  <text x="40" y="866" fill="#8f8d84" font-size="9.5">QlooBundle = {entity, tags[], affinities[{type, entities[{name, affinity, popularity}]}], calls[{endpoint, params, at, tookMs, n, mode, error?}], mode: live | partial | error | off}</text>
</svg>

Things worth knowing:

- **Everything is keyed by UUID**, and cross-references are by id (`boardId`,
  `productId`, `coverImage`, `activeVersion`) or by `/assets/<uuid>` path.
- `boards` are the "plans" you see in the UI; `lastStrategy` mirrors the active
  board for older readers, and `migrateBoards()` lazily upgrades a legacy
  single-board state on first read.
- `profile.catalog` is **not** a separate store — it's rebuilt from
  `catalog[]` on every read/write (`syncProfileCatalog`).
- `jobs` are deliberately in-memory: they're transient progress handles. The
  durable records (campaigns, photoshoots) update themselves as jobs finish.
- `brandbook` and `lastSiteAudit` are singletons — one book, one audit at a
  time.

---

## Frontend map (web/src)

React 18 + `react-router-dom`, one design-token stylesheet (`styles.css`) plus
per-view CSS. No component library, no state library — a single `Ctx` context
(`App.jsx`) carries `{profile, board, boards, status, say, openBoard,
hasStrategy}`.

| route | view | what it does |
|-------|------|--------------|
| `/onboarding` | `Onboarding.jsx` | Three doors: paste URL → scrape+DNA+Qloo (staged loader), chat scratch (LLM decides `ready`), template pick |
| `/`, `/dashboard` | `Dashboard.jsx` | The hub — plan cards (rename/delete/activate, per-plan work strips), "Other work" campaigns, empty state → Strategy |
| `/strategy/*` | `Strategy.jsx` (78K, the biggest view) | The board: ask composer → SSE stream fills audience read → strategy cards → anti-strategies. Card detail lazy-fetches `/api/boards/:id/strategies/:idx`; "examples" pulls real media via scout; **Produce row** picks the output (ad set / motion / AI video / website / brand book) and runs straight to the result |
| `/profile/*` | — | *retired* — redirects to `/dashboard`; the profile data layer still feeds every pipeline (scrape → catalog → palette) |
| `/campaigns/*` | `Campaigns.jsx` | The results surface. Manual composer (starter + engine chips) for ad-hoc runs; handoffs with `auto:true` draft + confirm + generate with no clicks. Detail = the final result: provenance band (strategy snapshot, palette, Qloo live badge) → creative grid → `CreativeEditor` modal → next-output CTAs (website / site film / brand book) |
| `/photoshoot` | — | *retired* — redirects to `/dashboard`; the `/api/photoshoot` backend still powers the brand-book cover generator |
| `/websites` | `Websites.jsx` | Generate (LLM full-HTML), version tabs, agentic edits, publish → `/s/:slug`, "Improve" audit (Qloo competitors + Devin/tensor), scroll-capture demo video |
| `/brandbook` (alias `/brand-book`) | `BrandBook.jsx` | Pick cover + ≤7 images → printable book → publish `/b/:slug` → "PDF" = print view |
| `*` | — | Redirects to `/dashboard` (or `/onboarding` when no profile) |

Shared components (`components/`): `Composer` (prompt box + Product/Images/
Aspect pills), `CreativeCard` (provider badges, watch-video lightbox),
`CreativeOverlay` + `creativeExport` (6 overlay presets, DOM + canvas mirror),
`EvidenceDrawer` (the Qloo call trail slide-over), `Qloo.jsx` (`QlooBadge`,
`SignalChips`, `TastePanel`), `AgentPane`, `FieldEdit`, `Kebab`, `Modal`,
`PublishBar` (honest connect status + per-platform captions — no fake social
posting), `UploadBtn`, `VersionTabs` (lazy iframes), `Wayfind` (the ←Dashboard
link — Dashboard is the hub, there is no persistent nav chrome beyond the
logo-only top bar).

Key state flows:

- **SSE**: `api.strategyStream` and `api.agentStream` hand-parse `event:`/`data:`
  frames off `res.body` — Strategy fills the board section-by-section; the
  agent pane streams `thinking`/`token`/`tool`/`done`.
- **Jobs**: `pollJob(id)` polls `/api/jobs/:id` (2.5s, 8min cap) and surfaces
  `job.progress` for real skeleton counts.
- **Deep links**: `/campaigns?open=<id>` — opening a campaign *pushes* history
  so browser-Back closes the detail; `?new=1`, `?product=<id>` prefill.
- **Handoff**: Strategy → Campaigns rides `sessionStorage.strategyHandoff`
  (`{strategy, notes, productId, boardId, strategyIdx, auto, output}`),
  consumed once on mount; a pending handoff always drafts a fresh brief.
  `auto:true` (the Produce flow) skips the confirm click entirely.
- **Gate**: `/campaigns`, `/websites`, `/brandbook` render
  `LockedScreen` until a board exists — with a real retry state when the
  fetch itself failed.

---

## Providers & provenance

Every generated artifact carries its maker:

| badge | meaning |
|-------|---------|
| `local · sd-turbo` | `imageProvider:"local-sd-turbo"` — rendered by localgen.py on the GPU |
| `gemini` | a Gemini image model won the chain (or was forced) |
| `pollinations` | the keyless last resort produced the image |
| `veo` | Veo long-running video |
| `watch · ffmpeg` | `videoProvider:"ffmpeg-render"` — ken-burns render; `videoNote` keeps the veo failure |
| `site-capture` | the real generated site, scrolled and filmed locally |
| `animated · ffmpeg` / placeholder SVG | flagged `placeholder:true` + `imageError`, never silently branded |

The **engine picker** override chain: user chip (`auto|local|gemini` on the
campaign, or the editor's per-regen provider) → `campaign.imageProvider` →
`genImageResilient({provider})` → a single-provider chain. Otherwise
`LOCALGEN_PROVIDER` sets the default order: `local-first` (the `.env` default)
= local→gemini→pollinations; `local-only` pins local; `fallback` keeps gemini
first; `off` disables local entirely.

---

## What it's supposed to look like

The intended flow reads left-to-right through the product's own vocabulary:

1. **Dashboard** — the hub. Plan cards ("boards"), each with its strategies
   and the work that came out of them. First visit: one centered hero →
   "Create your first strategy board."
2. **Strategy** — the board. Type a product→audience ask or paste a URL;
   sections type in live: the audience read (lean, media habits, vibe words),
   strategy cards with fit rings and reach estimates, then the ruled-out
   list. Every number traces to a real Qloo call in the Evidence drawer.
3. **Campaigns** — pick a strategy (or compose directly): brief card →
   creative grid → editor with engine chips, overlay presets, grading stars,
   animate/download/publish-caption.
4. **Photoshoot / Websites** — studio surfaces for the same brand: product
   renders with named templates, and a generated site you version, audit and
   publish at `/s/:slug`.
5. **BrandBook** — the artifact that ties it together: cover, palette, voice,
   imagery and the taste signature, published at `/b/:slug` or printed to PDF.

**Design language** (from `styles.css` — the "plakat" theme): a Swiss-poster
system — white ground, black grotesk (`Inter`), **international orange
`#ff4d00`** as the single accent (the token is still *named* `--lime` from an
earlier theme — `btn lime` means orange), hard black rules, `4px 4px 0` offset
shadows, zero border-radius. Display type runs italic-serif accents
(`Instrument Serif`/`Playfair`) for editorial moments, `Oswald`/`Montserrat`/
`Archivo Black` for condensed labels. Media-first cards, thin styled
scrollbars, and a `MediaFallback` tile (seeded dark gradient + monogram +
channel glyph) wherever an image is genuinely missing.

**The honest-data rules** (hard contract, per TRIAGE.md): no Qloo fallbacks
anywhere — a call is `live` or it fails visibly in the trail; bundle/board
modes are recomputed from the call log on every read so stale "live" labels
can't survive contradicting evidence; a failed per-ask enrichment stays on
its own board instead of inheriting the profile's older bundle; jobs report
real `{stage,done,total}` progress; publish features are honest (local hosted
pages + caption generation — no fake social posting); and empty states say so
("Your Brand" is a deliberately un-built placeholder profile).

---

## Running it

```bash
npm install && npm --prefix server install && npm --prefix web install
# .env — see .env.example: TENSOR_*, GEMINI_API_KEYS (5-key pool), QLOO_*,
#        LOCALGEN_URL=http://127.0.0.1:8807, LOCALGEN_PROVIDER=local-first
.venv-gen/bin/python3 server/scripts/localgen.py   # terminal 1 — needs torch venv
npm run dev                                        # terminal 2 — :8787 + :5173
npm run smoke                                      # real-integration checks
```

`GET /api/status` reports the whole integration surface at a glance:
`{tensor, devin, gemini, qloo:"live"|"off", localgen:{configured,mode,ok,model}}`.
`server/tuning.json` holds every tunable — channel priors, lean rules, model
fallback lists, copy budgets — editable live, or per-key via `TUNING_<KEY>`
env vars. Known limits (honest, from TRIAGE.md): Veo models are deprecated/
gated so video usually renders via ffmpeg and is labeled as such; sd-turbo
occasionally bakes small glyph artifacts on editorial portraits (engine chip
→ gemini is the fix); `node --watch` is unusable on this box (inotify limit) —
Vite runs polling mode and the server restarts manually.
