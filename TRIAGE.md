# Marque sprint triage — deadline 9:00am EDT (Mon Oct 26 2026)

**Sprint goal (user, verbatim):** 1) redesign/modify the white UI to fit in one page — no vertical page scroll (horizontal may scroll); add things, make it look better. 2) install a better image-gen model for the campaign — current outputs too bland. Look at examples, try different things, keep iterating: test → review → iterate → repeat until 9:00 AM ET. 6-agent swarm.

**Env:** app :8787 (node, prod build) + :5173 (vite dev). localgen :8807 (python, .venv-gen/bin/python3 — system python lacks torch). GPU RTX 4070 Laptop **8GB** (~2.5GB used by desktop). Baseline commit 28eae9f.
**QA tool:** `node scripts/qa_shot.mjs --url http://localhost:5173/<route> --out /tmp/x.png --w 1440 --h 900` (reports scroll metrics + console errors).
**Variant apps:** /home/ANT/marque-var-ops (:5174, light ops-console direction), /home/ANT/marque-var-alt (:5175, contrasting direction).

## Findings board (this sprint)
_(reviewers append; builders consume)_

- `/api/strategy/examples` vite-proxy "socket hang up" — ROOT-CAUSED benign: POST-only route runs a ≤90s reference pull; hang-ups occur when `--watch` reloads (agent edits) or client aborts kill the in-flight socket. UI already degrades to "Couldn't pull live examples" + Retry. No fix needed; noise from concurrent edits.
- Data hygiene agent (9be154c8): freed 176 orphan assets / 64.5MB via new `POST /api/maintenance/prune-assets` (dry-default); dead `jobId`/`moodboardJob` markers swept at boot; `strategyStale` reconciliation; `lastStrategy` fully deprecated → live projection. smoke 15/15.
- site-tpl published-site template polish verified live on `/s/site-51b4ce2d` (hero TOC, product splits, contrast tuning).

| # | Sev | Finding | Status |
|---|-----|---------|--------|
| — | — | UI: vertical page scroll must go — every route fits 100dvh | in-progress (variants A/B) |
| — | — | Imggen: sd-turbo outputs bland → SDXL-Turbo install on :8807 | in-progress (agent A) |
| — | — | Imggen: prompt enrichment (lighting/lens/composition/palette) | in-progress (agent F) |
| — | — | media.js:96 'local-sd-turbo' hardcoded label → read model from /health | assigned (agent F) |
| 1 | HIGH | SDXL-Turbo VERIFIED working on :8808 — outputs dramatically better (golden-hour editorial vs flat). BUT 2nd+ gen OOMs: GPU shared w/ MuseTalk (2.0GB pid 862527) + TTS (238MB pid 834505) — only ~5.4GB headroom. Fix = model_cpu_offload + expandable_segments + empty_cache per gen + OOM retry, or fallback segmind/SSD-1B (3.4GB fits resident) | agent A on it |
| 2 | MED | CLIP truncates prompts >77 tokens — enriched prompt tails (palette/mood) get cut. Front-load subject+photo terms or compress tail | agent F aware |
| 3 | MED | qa_shot.mjs .main metric lied (body scrolls, .main didn't) — added pageScrolls/docScroll/hPageOverflow | FIXED |

## QA round-1 findings (agent D — /tmp/marque/qa-r1/*.png)
**Scroll truth: 4/6 routes scroll @desktop (strategy 1052, campaigns 957, websites 1052, brandbook 939 vs 900), 5/6 @mobile. Dashboard/onboarding/campaign-detail waste bottom 30-45%.**

- [H] dashboard @390: H1 "DASHBOARD" overlaps Marque/STUDIO badge (x372 > 212)
- [H] /strategy: .stg-topline pill flush at top:0, clipped; mobile Edit-ask clipped right edge
- [H] /brandbook: slides ~60% empty placeholder-looking frames
- [M] .stg-pick-aud/.stg-pick-fmts hard-clip text mid-word (scrollWidth 418 vs client 251, no ellipsis)
- [M] /websites "Analyze vs competitors" nukes rendered audit → 90% empty + 1 spinner line during job
- [M] Typed component re-animates cached content on every /strategy/:idx mount — makes real data look fake
- [M] .stg-qread/.stg-qgroups clipped ~23px right edge (MOVIE col)
- [M] campaigns Product dropdown = dead end ("No catalog items") overlapping composer
- [M] jargon leak: `watch · ffmpeg`, `local · sd-turbo`, `EST 92 ★`, `Taste signature · failed`, dead Local chip while localgen down → audit agent 4d9efa49 mapping all
- [L] duplicate identical campaign cards ("Heavy Metal Heavy Lifting" ×2)
- [L] creative overlay text legibility ("Chug"→"Clug", lockup under badge chip)
- [L] Generate-Brief disabled-look inconsistency vs onboarding CTA
- [L] console noise: RR future-flag warnings, socket/cert errors, 404 on /b/book-*

**Design-critic summary:** flat #fff canvas + identical border+hard-shadow recipe = "vibe-coded"; weak type range; vacant card interiors; internals leak. Winning moves: fill viewport, card interior architecture, tonal range, no hard-clipped copy, instant-load cached content + translate jargon.

Variant lanes: ops (light) :5174 · alt (dark HUD) :5175 · edit (editorial) :5176

---

# Marque sprint triage — deadline 10:00am EDT (Sat Oct 24 2026)

**Sprint goal:** one continuous workflow — brand identity → strategy board → one-click produce → final results. Merged pipeline (no separate "campaign step" UX), output-type picker on the strategy card, final-results surface carrying strategy+palette+Qloo provenance, websites generated from campaign/brand context. Removed test-only surfaces (/profile, /photoshoot). Then: full-flow demo video (cloned voice) + ~50 ranked creative mockup variants w/ per-mockup videos + gallery. Local commits only.

## Active workstream status
- [~] merged produce flow (strategy → results)
- [ ] results-view enrichment (strategy snapshot, palette, next outputs)
- [ ] website gen from campaign/brand context
- [ ] /profile + /photoshoot surface removal
- [ ] docs single-pipeline (SYSTEM.md, pipelines.svg)
- [ ] mockup batch (~60 raw → top 50), gallery, per-mockup videos
- [ ] main demo video w/ voice clone
- [ ] QA rounds till clean

## Findings board (this sprint)
_(reviewers append here)_

---

# Previous sprint — deadline 2:00pm EDT (Fri Oct 23 2026, extended)

**State (13:55 · deadline 2pm): 7 rounds done, competitor teardown applied.**
Shipped from teardown: starter template chips under campaign composer (Creatify/Zeely chat-first pattern — verified live, click prefills) + **campaign-level engine picker** (auto/local/gemini chips → provider→campaign.imageProvider→genImageResilient; verified: gemini-forced campaign = 4/4 gemini creatives).
Round-7 tail: strategy "public video/catalog" claim → honest "reference pulls on demand" phrasing (both spots); TastePanel empty state added ("No taste signals yet…").
Round-8: all PASS; `profile.patch` re-pollution cleaned with server stopped (in-memory copy had re-persisted it — clean disk while stopped). `videoNote` verified persisting ("veo failed: …could not start operation").
Localgen noise gate: sd-turbo occasionally emits pure RGB static that passed the byte-size check — `is_noise()` rejects on gradient energy (gx/gy>40; noise≈64, real≤32, calibrated on r7_gencover_actual.png), retries once w/ reseed, then 500 → resilient chain escalates. Verified: normal gen 200 in 2.9s. **Venv note**: localgen needs `.venv-gen/bin/python3` (system python3 has no torch) — documented in .env.example.
**Pasted-link campaigns (Creatify/Zeely killer feature)**: URL in composer prompt → `fetchSite` scrape → `brief.urlContext` → LLM brief gets real site context + `resolveProductContext` prefers it (catalog → urlContext → board). Bot-blocked sites degrade to hostname subject ("drink-huel"). Verified live: rhodeskin.com → "The Rhode Standard" brief w/ real skincare context + Source link field on brief card.
Round-9 (mobile/a11y): HIGHs fixed — camp-del invisible on touch/keyboard (`:focus-within` + `@media (hover:none) OR (max-width:640px)` — verified opacity 1 @390); Animate veil-btn missing `title` (only unnamed icon-only button); `--ink-4` #6f6f6a→#8b8b85 (3.6:1→~4.7:1 WCAG AA). MEDs: toast `role=status aria-live`; Composer img-picker filters URL-only assets (broken src=""); **pill popovers overflowed right edge @390** → bottom-sheet at ≤520px (verified right=382<390). Methodology note: `documentElement.scrollWidth` FALSE-PASSES — `.main` overflow-y:auto computes overflow-x:auto; check `.main.scrollWidth>clientWidth` or element rects. Topnav x-overflow is intentional (scrollable nav + fade mask). Remaining knowns: nested-interactive role=button wrappers (dash-plan/stg-chipbar/stg-wx), grade-star ~11px targets + roving-tabindex, 5.5px ring labels, focus-trap absent in modals (role/aria-modal + named closes now added), Websites tablist arrow-nav, Kebab menuitem roles.
Round-9 MED/LOW batch shipped: toast max-width + aria-live; .msg overflow-wrap; job-row keyboard (role/tabindex/Enter-Space) + min-width:0; stg-wx-match title tooltip; pub-url overflow-wrap; EvidenceDrawer/CreativeEditor/Modal role=dialog + named closes; book-dot 8px→24px hit-area via transparent border (visual unchanged — verified); composer/stg-ask :focus-within lime ring (verified computed box-shadow); stg-wild-grid/pick-grid/qgroups minmax min() floor for <300px viewports.
Round-10: static verify all PASS; runtime sweep 16 route×viewport combos → 0 console errors, 0 .main overflow. Chips verified: [auto|local|gemini] + 4 starters on prod bundle.
SSRF hardening on pasted-link flow: private-host URLs (localhost/RFC1918/.local) no longer stored as urlContext (scraper already blocked the fetch — now the bare URL can't pollute product context either). Verified: localhost prompt → urlContext null; rhodeskin.com → real title+description scraped.
Security pass: state.json writes are atomic (tmp+rename); asset filenames are server UUIDs + path.basename guard; upload bounded 25MB memory-storage, ext from declared mime. **SVG stored-XSS closed**: /assets now serves `Content-Security-Policy: sandbox` + `X-Content-Type-Options: nosniff` — verified headers live, images render via <img>, video serves w/ range (206). grade-star hit area → ~22px; book-dot aria-current; Kebab role=menuitem; ring-label 5.5→7px. Publish/Promote audited — honest (local hosted pages / caption+copy, no fake social posting). Final bundle index-kFbR-riJ: 16 route×viewport sweep 0 errors. Agent SSE re-verified on final bundle (token growth → exact-5-word reply). Competitor captures persisted to `mockups/competitors/` (11 PNGs: Creatify, Zeely, AdCreative, QuickAds). "Try" label added separating starter chips from engine chips (mobile screenshot verified). `aria-current` confirmed auto-applied by NavLink on active route. Accounts: AdCreative signup OK→card wall at /payment-info; Creatify/Zeely public surfaces captured (cmp_*.png).
UNFIXED BACKLOG: strategy "public video/catalog" static claim (Strategy.jsx:1046,1154,1446 — make conditional on example pull), Taste-page empty state (Qloo.jsx:40), composer-level engine picker + attach chip, auto creative-score heuristic, publish-destination chips, stream intra-step smoothing, campaigns list payload trim.
Round-6 (deep interaction): all flows PASS. Fixed: Back-button (push on open, openId clears on pop — verified live), uploaded images now visible in pick-grid + ref picker, sendFile→503 rebuild page, armed-delete amber fill at icon widths. Accepted/documented: stream bursts = tool-exec pauses (tool chips fill them), veil-over-CTA = inherent pinned-hover design, #12 payload dup (local ~15KB, trivial).
Round-7 (fake-data hunt + BrandBook e2e): fixed HIGH double-wrap updateProfile (BrandBook+Photoshoot silently discarded cover, wrote junk profile.patch — cleaned), genCover first-success result, honest Print/PDF label. LOW backlog: strategy "public video/catalog" static claim, Taste-page empty state.
Round-6 fixes: Back push/replace verified, uploads in pick-grid, 503 rebuild page, armed-delete fill, editorial scrim, small-card type floor, ffmpeg badge.
**CRITICAL fix this round:** boardId auto-link contaminating creative copy — a nutrition brief rendered Rhode skincare copy because resolveProductContext trusts boardId. Now: boardId/snapshot only when caller explicitly passes it. Verified: regenerated campaign → "Real food. Maximum output." Huel-style copy.

## Competitor teardown (AdCreative.ai / Creatify / Zeely) — screenshots in /tmp/marque/cmp_*.png
- AdCreative signup works (temp-mail OK) but walls at /payment-info — card required for trial. Hero = generated ads as page art + "20 free downloads" credit framing + Conversion Score card.
- Creatify & Zeely both lead with **chat-first composer**: prompt box dead-center, inline model picker ("Opus 5.5"/"Claude Opus 5"), + attach, mic, send; template starter-cards beneath (UGC Testimonials / Competitor Analysis / Launch Video). Zeely adds "Connect Slack" team chip.
- Takeaways → BACKLOG: starter template chips under campaign composer; composer-level engine picker; product/URL attach chip in composer; auto creative-score heuristic (contrast/coverage/headline-len) next to manual stars; share/publish-destination chips (Slack/webhook); keep output-as-hero (dashboard already does).
Post-round-5 wins: VersionTabs lazy iframes (IntersectionObserver), Gate 'error' retry state vs misleading LockedScreen, editorial scrim deepened (legible serif over bright images), container-query type floor for small cards, honest 'animated · ffmpeg' provider badge, Blueprint 4/4 + FlowState 3/3 + Ritual 3/3 watermarked/gibberish creatives all re-rendered (Gemini for lifestyle, local flat-lays for Aesop — cohesive). 5 QA rounds complete; round-5 independent verification PASSED all 10 checks (1 regression caught→fixed→re-verified). Build `index-CyYE7zYe.js`, smoke ×5 PASS, 8 routes × 0 console errors, mobile 390px clean. 5 QA rounds complete; round-5 independent verification PASSED all 10 checks (1 regression caught→fixed→re-verified). Build `index-CyYE7zYe.js`, smoke ×5 PASS, 8 routes × 0 console errors, mobile 390px clean.

## Verified end-to-end (real output, not code inspection)
- Local model: `server/scripts/localgen.py` (sd-turbo, RTX 4070, :8807) — clean text-free images at steps=6, ~1.2s/img. Matcha campaign: 4× creatives in ~50s, `local-sd-turbo` provider, zero errors.
- Escalation: forced `{provider:"gemini"}` regen on a bad local creative → clean photo ad, badge flipped blue. Engine picker chips live in editor (auto/local/gemini/pollinations).
- Overlay presets ×6: editorial/marker/brutalist/ugc/glass/performance — DOM layer + mirrored canvas rasterizer; download verified 1080×1920 PNG w/ preset styling (3.3MB).
- Streaming: `/api/agent/stream` SSE verified — thinking→token→done(clean reply+patch); UI shows "reasoning…" caret + tool chips. `/api/strategy/stream` stage events.
- Gemini keys: 5-key pool `GEMINI_API_KEYS` rotation; smoke passes.
- `/api/status`: `{tensor:true, gemini:true, qloo:"live", localgen:{configured,mode:"local-first",ok:true,model:"stabilityai/sd-turbo"}}`
- Routes: all 6 pages + campaign details render on :5173 AND :8787, zero console errors, mobile 390px no h-scroll.
- Smoke: tensor/gemini/localgen/qloo-live/scraper all PASS (×2 runs).

## Fixes landed this session (3 QA rounds)
- Vite `/s`,`/b` proxy contexts ate `/src/**` → anchored regex patterns; dev server serves JS again.
- `.flow-card` overflow clipped composer dropdown → `overflow:visible` + top radius.
- Hidden scrollbars → thin styled (8px, subtle thumb).
- `.co-host` container-type collapsed editor preview → moved to `.co-stack`.
- Provider badge crushed meta titles → moved to image top-right corner.
- `?open=` deep link: write via `show()` (refresh/back restore), read on mount.
- Profile tombstone tabs (999px radius) → docked folder tabs, shared baseline.
- Failed-creative meta row → `.cc-err` wraps to own line.
- Veil labels truncate → icon-only below 330px container.
- Gibberish text in local images → steps 4→6 + printed-materials ban in BOTH prompt paths + explicit negative in media.js.
- `/brand-book` → `/brandbook` alias.
- SignalChips: affinity score + "Qloo taste-graph correlation" tooltip; stg-ent + hero-sig chips same treatment.
- Campaign signals fallback: briefs pull from latest board qlooBundle when profile bundle empty (verified: ZAYN/Bebe Rexha/Chanel…).
- Websites pre-audit void → Scrape/Benchmark/Fix-list explainer.
- EvidenceDrawer empty-state copy corrected (no fake "building" promise).
- videoNote persisted when Veo falls back to ffmpeg.
- Campaign evidence persistence: campaigns now snapshot the source board's qlooBundle+evidence at creation and auto-link boardId when brief carried signals (verified: boardless brief → bundle+evidence on both GET paths).
- Round-5 verification: all fixes PASS except one caught regression — scraper's 'cannot scrape private/local addresses' lost its 400 (now re-added `private` to classifier; verified live: private URL → 400). BrandBook images-step picker got the missing path filter.
- Round-4 QA fixes: websites empty-prompt 400 removed; Photoshoot referenceImage→inputImage key bug; error JSON 404 for unknown /api/*; multer/413 JSON errors; h() "local"→400 misclassifier tightened; URL-only assets filtered from pickers; BrandBook genCover shoot-id fix; MAX_TEMPLATES 6→4; phantom step-3 dot removed; onboarding exit+clobber warning; React ErrorBoundary; immutable caching on hashed+generated assets; gzip compression (363KB→111KB JS); Blueprint campaign all-Gemini regenerated (gibberish local images replaced); "deadurl test" junk board deleted.
- Websites explainer, hardcode audit → `server/tuning.json` + `tuning.js` (channels, counts, reach priors, conf labels, gemini fallbacks).

- No hardcoded/preloaded content: web/ ships zero bundled media; data/assets + state.json are real runtime artifacts only. "deadurl test" junk board deleted.
- Blueprint/FlowStateFuel campaigns predate the snapshot fix (created via composer with no board + no signals) — their Evidence drawer honestly shows "no taste bundle was linked"; only NEW campaigns snapshot bundles.

## Known limits (honest, documented)
- Veo unavailable: `veo-3.1-lite-generate-preview` deprecated; `gemini-omni-1.1-flash` requires Interactions API + paid tier. Video = ffmpeg-render (labeled). TODO: Interactions API integration or paid key.
- Local sd-turbo: clean for simple surface compositions; occasionally bakes small corner-logo/glyph artifacts on editorial-portrait prompts despite text/logo bans — mitigate via engine picker → Gemini.
- Profile "Your Brand" = honest un-built placeholder state.
- `node --watch` unusable (inotify limit) — manual restarts; Vite runs polling mode.
- Google auth session profile: `/home/ANT/.google-login-prof` (CDP 9223, now closed).

## Env
- `.env`: GEMINI_API_KEYS×5, LOCALGEN_URL=:8807, LOCALGEN_PROVIDER=local-first (documented in .env.example)
- Processes: node :8787, vite :5173 (polling), localgen :8807 (python)
- No commits made; 39 modified + 6 new files in working tree.

## Truthful-data rules (hard contract)
- NO Qloo fallbacks anywhere: qloo.js is live-or-error only. qlooFixtures.js deleted; LLM synthesis of Qloo-shaped entities deleted. Failed calls persist in the trail with endpoint/params/timestamp/duration/error.
- Bundle modes: live / partial / error / off — recomputed from the call log on every read (honestBoard), so stale persisted "live" labels can't survive contradicting evidence. Legacy simulated/fixture call records downgrade to error.
- No stale-profile substitution: a failed per-ask enrichment no longer inherits profile.qloo — the failure stays on the board that caused it.
- Qloo anchoring: insights anchor on live tag signals (entity /search hits only when the name genuinely starts with the query token — "Sint-Genesius-Rode" is rejected for "Rhode"). Entity used for display only.
- Jobs report real progress (job.progress {stage,done,total}); UI skeletons show the actual count, not blind shimmer.
- Video: veo failure notes persist on the creative; the badge reads "watch · ffmpeg" and opens a playable <video> lightbox.
- Image click → lightbox zoom (desktop); tap pins action veil (touch).
- Top nav collapsed to logo-only; section links live on the strategy board's plans row.

## Round-11 adversarial sweep (QA agent, ~04:00) — findings board

MED (fixer agent assigned):
- [x] Free-text brief inherits active-board Qloo signals — FIXED → contaminates provenance
- [x] Promote caption leaks "YourBrand" placeholder — FIXED + junk Qloo hashtags
- [x] Strategy detail auto-pulls media examples — FIXED (on-demand only)

LOW (fixer agent):
- [x] DELETE version last-version guard — FIXED
- [x] hunts chip row dedupe — FIXED
- [x] "WATCHOUTS" → "Watch-outs" — FIXED
- [x] chipbar-prompt squeeze — FIXED (wraps)
- [x] Campaign delete styled Modal — FIXED

LOW (noted, later):
- Google Fonts render-blocking CDN → consider self-host/font-display
- Creative overlay clips lockup at 390px (~8px)
- Promote panel: no platform-aspect mismatch hint
- Stale huel.com audit reads as "yours" — no recency/ownership marker
- Brandbook "Taste signature · failed" badge — no retry affordance
- Engine chip sets inconsistent between composer and editor
- dash-plan-top ~6px text overflow; icon buttons lack aria-labels

## Round-12 review (code-read pass)
- [x] Next-output "Website" → /websites?tab=site (was audit tab) — FIXED
- [x] Site film films campaign-linked site, falls back to newest — FIXED
- [x] Restored briefDraft handoff could re-fire auto-produce — FIXED (auto flag stripped on restore)
- [x] producedFrom.campaignId stored `true` not id — FIXED
- [x] WildCard platform chip casing → chanLabel — FIXED

## Final state — 10:00 sprint closeout
- Merged pipeline verified e2e: ads (4 sd-turbo creatives), motion (mixed set, 2 real mp4s), site (brand-context HTML) — all produce paths land on results
- 3 adversarial rounds: ~28 fixes, final round clean (7/7 holds)
- 78 mockups produced → 50 displayed + 28 vaulted; top-10 got print/a11y craft pass
- Demo: marque-walkthrough.mp4 (174s) + v2 with title/end cards (180.6s), cloned voice
- Residuals noted for later: none blocking; see round-12 review list above

## Sprint 26-10-26 (cont.) — post-merge state @00:50
- MERGED: variant-B dark HUD (marque-var-alt) → web/src. Qloo.jsx hand-merged (mainline badge-hide + variant epLabel trails). Build clean. :5173 verified pageScrolls:false on dash/strategy/campaigns.
- media.js: steps 6→4; refs-honesty — local dropped from auto chain when refs present (local is txt2img-only; gemini does reframes), explicit local+refs returns note; promptStyle UNMARKED cue added (measured: kills label pseudo-text where negatives can't reach at guidance=0).
- localgen.py: upscale was bilinear (resample=2 lie) → real LANCZOS; service restarted w/ sdxl-turbo seq-offload.
- e2e verified: regen creative → local-sdxl-turbo 1408x1760 in 5.9s; photoshoot batch 4/4 clean; honest 400/404s; gemini path works (928x1152, gray-band artifact seen once — watch).
- Open: photoshoot/agent-edit under provider:'local' still ignores refs by design (note now attached); stale creatives still labeled local-sd-turbo (honest historical data); label text artifacts reduced not eliminated.
- In-flight agents: graft-details (var-ops/edit best-of), post-merge QA, ffmpeg site-film fix, e2e user flow.
### merge spot-checks @00:55
- :8787 serves rebuilt dist — dark HUD live in prod too. Onboarding/brandbook/strategy-detail all render clean.
- ISSUE: /strategy/0 @1366 — right column (audience profile panel) hard-clips at viewport edge; IN-THE-WILD rail cards cut mid-glyph — needs h-scroll affordance or padding fix.
- ISSUE: rail-foot LED labels ("QLOO LIVE", clock) overflow the 66px icon rail — graft agent mid-edit on that block; recheck after it lands.
- PERF: /assets pngs now 1.7-2.2MB (2x upscale) — book/dashboard thumbs load full-size; consider downscale thumbs later (perf lane).
- Stale creatives all regen'd → local-sdxl-turbo (8/8 visible creatives on new model).
### @01:15 — round 3 results
LANDED: graft-all-12 (LEDs/clock/stat-tiles/folio/zone-counts/wash/labels/hover/sticky/kickers/middles/2col-console) · img2img on localgen (shared-weight, +0MB vram, reframe_canvas) · site-film FIXED (pw-ffmpeg slot heal + CDP screencast fallback; verified real mp4s) · smoke 15→16 checks all green · thumbs route −99.4% payload · Cmd+K palette · gemini timeouts.
FLOW-TEST: real campaign produced e2e; findings → reload-during-gen no auto-resume, produce auto-fires w/o review, EXPECTED_CREATIVES=4 hardcoded, jargon remnants in Strategy views.
QA-POST-MERGE: systematic jargon bypass in merged views (engine chips Local/Gemini/Pollinations raw, QLOO AFFINITY headers, QLOO LIVE LED, epLabel+raw double-print) + mobile defects (390px affinity-table crush, ring label clip, header stats off-canvas).
FUZZ: crash on /api/strategy/stream; proto-key bypass wipes profile (TEMPLATES['constructor'], PUBLISH_PLATFORMS); deep-nest DoS stored in profile; numeric slug → unreachable; DNS-rebind SSRF; id-overwrite via catalog PUT; error-middleware order leaks HTML stacks; photoshoot has no DELETE; jobs-map in-mem → stuck 'running' after restart.
IN-FLIGHT: fixr3(flow+jargon views) · cmdk(done) · thumbs(done) · site-tpl · book-tpl · hardening(0bddb9dc) · fuzzer residue: __FUZZTEST__ photoshoot dc36b5b1 + ~20 orphan assets (no API to remove yet — hardening adds DELETE).
### @01:37 — hygiene pass applied
- Deleted fuzz photoshoot dc36b5b1 (+2 assets), dup campaign 7591bbd2 (+8 assets). ~172 orphan files (~100MB) + ~136 dead registry rows remain — needs an orphan sweep w/ picker-safety check first (ingredient picker may read registry).
- Audit found: dead jobId handles persist on done records; boards[].moodboardJob not swept at boot; assetInUse() ignores moodboard tiles + lastStrategy; 'lastStrategy' is a stale 1.5k-line dup of a live board (legacy readers); genError prints raw if a failed campaign opens.
- PROFILE = stub 'Your Brand' (source:null) — never onboarded for real; demo state.
- VEO: this API key lists 60 models, zero veo → cloud video permanently unavailable; ffmpeg fallback is the honest motion path (motion-quality agent improving it).
