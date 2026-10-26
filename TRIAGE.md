# Marque sprint triage — deadline 9:00am EDT (Mon Oct 26 2026)

**Sprint goal (user, verbatim):** 1) redesign/modify the white UI to fit in one page — no vertical page scroll (horizontal may scroll); add things, make it look better. 2) install a better image-gen model for the campaign — current outputs too bland. Look at examples, try different things, keep iterating: test → review → iterate → repeat until 9:00 AM ET. 6-agent swarm.

**Env:** app :8787 (node, prod build) + :5173 (vite dev). localgen :8807 (python, .venv-gen/bin/python3 — system python lacks torch). GPU RTX 4070 Laptop **8GB** (~2.5GB used by desktop). Baseline commit 28eae9f.
**QA tool:** `node scripts/qa_shot.mjs --url http://localhost:5173/<route> --out /tmp/x.png --w 1440 --h 900` (reports scroll metrics + console errors).
**Variant apps:** /home/ANT/marque-var-ops (:5174, light ops-console direction), /home/ANT/marque-var-alt (:5175, contrasting direction).

## Findings board (this sprint)
_(reviewers append; builders consume)_

- `/api/strategy/examples` vite-proxy "socket hang up" — ROOT-CAUSED benign: POST-only route runs a ≤90s reference pull; hang-ups occur when `--watch` reloads (agent edits) or client aborts kill the in-flight socket. UI already degrades to "Couldn't pull live examples" + Retry. No fix needed; noise from concurrent edits.
- **Palette-in-window fix (HIGH)**: enriched prompts ran 270 tokens vs CLIP's 77 — the palette-anchor clause appended last never conditioned pixels. Now leads the `Shot detail:` clause. Verified via rebuild+tokenizer. Regen prompts also regained `Mood:`/`Cultural vibe:` parity with composeImagePrompt.
- **profile.images[0] swapped** → skull-can-on-ice sdxl render (`/assets/6fdef27a-…`); it had been a generic studio-gear grid polluting every img2img ref.
- **Stale creatives**: all 17 already sdxl/gemini; 3 stale photoshoots + 1 edit re-rendered via sdxl (agent 2c48ef72).
- **New surfaces**: /shoots photoshoot view; strategy moodboard 9-tile grid (local sdxl); brandbook cover compose; campaign REROLL ×n batch; palette ACTION commands.
- **A11y wave**: overlay focus trap/restore (5 surfaces), child-keydown guards, 40px tap targets, reduced-motion gates, 18-control focus rings.
- **QA r4 fixes landed**: chipbar @390 bleed, websites imp-card expand toggle, qname overflow, leans/habits dedupe, telemetry humanized, moodboard-404 noise gone.
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
| 4 | HIGH | /strategy @390: `.stg-chipbar` bleeds off right edge — box is 423px in a 390px viewport (L7→R430); `.stg-tag` "liquiddeath.com" pill's right ~30px clipped off-canvas (Edit-ask wraps to row 2, survives). Cause: `.stg-topline-mid` justify-center + chipbar `max-width:940px` in a 320px cell | open — r4 |
| 5 | HIGH | /websites @1440+390: fix/steal recommendation cards hard-clamp at 2 lines mid-sentence ("abandoned carts by…", "'$15 away from Free…") with NO expand affordance — the feature's core output is unreadable. `.imp-why`/`.imp-steal span` line-clamp 2-3, studio.css:629-652 | open — r4 |
| 6 | MED | /strategy + /strategy/0: jargon leak — moodboard footer renders raw `sdxl-turbo` ("rendered locally · sdxl-turbo · 05:57"). `Strategy.jsx:564-565` hand-rolls `.replace(/^local-/,'')` bypassing `providerLabel()` (Composer.jsx:79) which maps it to 'studio render'. Fix = use providerLabel or drop the tag | open — r4 |
| 7 | MED | /strategy/0 @1440: `.stg-qname` unbreakable entity names overflow their ~66px cell into the score bar — "XXXTENTACION" (sw83>cw66), "FoundMyFitness" (sw84>cw66), `overflow:visible` no ellipsis. Round-1 `.stg-qread` clip persists — needs `overflow-wrap:anywhere` or ellipsis | open — r4 |
| 8 | MED | /strategy/0: audience-read header leaks internal telemetry — `audience data · 8 calls · entity search tag lookup affinity insights` (Strategy.jsx:1782-83 renders detCalls.length + raw epLabel list). "N calls" + endpoint names are API internals | open — r4 |
| 9 | MED | /strategy: AUDIENCE READ "leans" bullets verbatim-duplicate TASTE DRIVERS rows in the same left panel — same three place/artist/podcast lines rendered twice per screen (also repeated in pick-card "Audience pull" and detail header) | open — r4 |
| 10 | MED | /campaigns?open @1440: creative overlay lockup clipped inside cards (`.co-stack`/`.co-host` sw246>cw240); "screen film" creative's baked-in text cropped both edges; sticker badges collide with card borders. Provenance panel has ~250px dead middle. Evidence: p_camp_evi.png, d_campdet.png | open — r4 |
| 11 | MED | `Typed` still re-animates CACHED content on every mount (11 usages in Strategy.jsx incl. detail title/angle/brief rows) — makes stored data masquerade as live generation; also caused a false "mid-word cut" in QA (text caught mid-typing). Round-1 finding unfixed | open — r4 |
| 12 | MED | Jargon density across views: websites fix tags `PDPs/CAC/AOV/UGC/RISK REVERSAL/THRESHOLD GAMIFICATION`; strategy pick cards render raw affinity decimals `0.88/0.84`; detail "GROUNDED IN → Flamingo Cantina 0.88" unexplained; campaigns engine chip "web render" half-dimmed reads broken; "leans place/artist/podcast" internal-speak | open — r4 |
| 13 | LOW | /campaigns @390: `.starter-chip` lacks `white-space:nowrap` — "web render" chip label wraps mid-word inside the faded scroll row; footer collapses to "4 / CAMPAIGNS" stacked + "PROFILE + LIVE TASTE GRAPH" clipped | open — r4 |
| 14 | LOW | Delete-plan modal: ambiguous focus — close-X has amber ring AND Delete button has heavy white offset edge; both read "focused" (p_delete_modal.png) | open — r4 |
| 15 | LOW | Dashboard @390: active-plan pill ellipsizes the one value it exists to show ("Liquid Death → ravers, 18…"); `.dash-plans` `.stg-plans-txt` shows 126px of a 518px title; rename input (flex:1, 254px) too narrow to see the name while renaming (p_rename_open.png) | open — r4 |
| 16 | LOW | Console noise: `GET /api/boards/:id/moodboard` 404s whenever a board has no moodboard (handled gracefully — could return 200 `{moodboard:null}`); one flaky `createRoot on already-rooted container` error on /strategy/0 @390 (vite HMR race, not reproducible on re-shot) | open — r4 |
| 17 | LOW | BrandBook cover reads placeholder: literal "YOUR BRAND" title (real but empty profile) + generic stock-collage tiles; slug `/b/book-ae71883d` exposed raw; `.book-dot.on` scale(1.4) + lime reads oversized vs siblings. Pager itself verified working | open — r4 |
| 18 | LOW | a11y nits: `.stg-chipbar-edit` focused input has no visible indicator of its own (outline+border none, parent keeps border — weakest ring in set); mobile rail ≤720px drops all link labels (title-tooltips useless on touch) | open — r4 |
| 19 | MED | /strategy moodboard 3×3 squashed to slivers @1440×900: `.stg-mood-grid` auto rows compress to ~60px while `.stg-mood-tile` boxes stay 410px (aspect-ratio) → all 9 tiles stack as 3 rows of ~65px letterbox slivers (~15% of each image visible); inner scroll just scrubs which tile bleeds over the 197px window (scrollTop≥~130 → last row covers everything). Chips/strip-clicks/lightbox still work — visually degraded vs intent ("window shows the top of each tile"). Fix = size tracks to tiles (`grid-auto-rows`) or drop squares | open — r5 |
| 20 | MED | /shoots jargon: new-shoot card header renders `rendered locally · sdxl-turbo` (Photoshoot.jsx:66) — same providerLabel bypass class as finding 6 | open — r5 |
| 21 | MED | /shoots failed tile dumps provider internals inline: `.ps-tile-broken i` prints verbatim `all image providers failed — gemini(gemini: all image models failed (quota exhausted)) pollinations(pollinations 402)` (Photoshoot.jsx:132). Honest but raw engine-speak; full string already lives in title attr → show short reason inline | open — r5 |
| 22 | MED | Dev-mode hard crash corroborated + root-caused (extends finding 16): live file edits → Vite re-evals `main.jsx` → top-level `createRoot(#root).render()` re-runs (double-root warning) / stale Ctx → `useApp()=null` inside Onboarding.jsx:139 (`Cannot destructure 'refresh'`) → `removeChild` NotFoundError → ErrorBoundary wipes the page mid-chat-stream. Hit 3× during concurrent edits tonight. Prod unaffected (single eval); fix = `import.meta.hot` guard or root reuse in main.jsx | open — r5 |
| 23 | LOW | Onboarding bad-URL error carries transport prefix: `POST /api/profile/build → 500 cannot resolve host …` — honest reason but raw method/path/status; palette's errMsg() strips exactly this pattern, build error doesn't | open — r5 |
| 24 | LOW | Stored caption jargon surfaces verbatim: profile key image caption `Can on ice — brand hero (sdxl)` → visible on /profile kit tile + BrandBook `FIG. 01 — CAN ON ICE — BRAND HERO (SDXL)`; also `(pollinations)` etc. risk in older captions. Stored data — rename the caption(s) | open — r5 |

## QA round-5 — new-surface adversarial pass (reviewer agent — /tmp/marque/qa-r5/*.png + s_*.mjs probes)
**Scope: only tonight's new surfaces — /shoots, strategy moodboard, ⌘K ACTIONS, onboarding chat, EvidenceDrawer, BrandBook. Scroll truth CLEAN everywhere tested (1440×900 + 390×844): pageScrolls=false, hPageOverflow=false on all six surfaces. Console clean except findings below + known RR future-flag warnings.**

- **/shoots** — PASS: all 12 sampled thumbs use `/assets/thumb?w=`; detail opens/closes/toggles; edit round-trip real (`add scattered props` → local-sdxl-turbo render → `EDITS · 1` section); delete is two-tap (`Delete shoot`→`Confirm release?`, ~3.2s auto-disarm, second pair deletes + frees assets, API confirms gone); double-submit deduped by busy guard (jobs 11→12 not 13); Escape inert; ~3.8k-char prompt accepted + rendered (no cap, no crash); failed shots = dashed rose tile + broken icon; @390 list scrolls internally + detail replaces it.
- **Moodboard** — PASS: reshuffle → live `0/9→8/9→done` (~60s, progress line, regen disabled mid-run); lightbox open/Esc/backdrop/X; kinds humanized (`COLOR`,`SOUND` — zero raw `palette`/`music`); footer `STUDIO RENDER · HH:MM`; API honesty (bogus board → 404 `board not found`); @390 → horizontal snap rail (114px tiles, snap-align). See finding 19 for the desktop squash.
- **⌘K ACTIONS** — PASS: `Reshuffle moodboard` fires a real job + lands on the board; `Re-render last still` → new sdxl-turbo PNG on the creative; `Animate last still` → `QUEUED·~1 MIN` → ffmpeg fallback lands `videoPath` with honest `veo unavailable — animated locally with ffmpeg` note; publish/unpublish idempotent 200s; forced 503 → err line `PUBLISH SERVICE UNAVAILABLE`, palette holds open, transport noise stripped; verb ranking works (`resh`/`pub` float ACTIONS first; 15 action rows, state-aware labels).
- **Onboarding** — PASS: chat streams token-by-token (draft 0→37→292 chars observed); Enter sends; Enter-on-empty is a no-op; LEDs honest — `AGENT READY` iff `status.agent.ok` (new field, verified true → READY); bad URL → honest `cannot resolve host` error + Retry; @390 fits. See finding 22 for the dev-HMR crash.
- **EvidenceDrawer** — PASS: opens from campaign detail; 8 per-call rows with latency badges (594ms–10.8s, ≥5s slow tier), expandable `returned` entity lists (top-3 + signature pointer), stat strip honest (8/8 live, Σ38.8s, call window); Esc + veil close; focus stays in drawer; /profile empty state honest (`0 AUDIENCE CALLS` + `No recorded calls`, no dead badge).
- **BrandBook** — PASS: cover plate real image; palette usage bar weighted 3/2/2/1/1/1 with role labels (`Primary mark & cover`, `Ink & type`); typography real fonts (Inter/Open Sans actually loaded); pager dots + ←/→ arrows clamp at ends; `Not set` honest on Voice page; page gating honest (Story omitted — no data; Taste omitted — qloo mode:error); @390 fits. Leftover: `(sdxl)` caption jargon (finding 24).

**Worst-5:** 19 (moodboard slivers — the feature's whole visual is ~15% visible at desktop) · 22 (HMR hard-crash wipes any page mid-edit; prod-safe but demo-hostile) · 20 (sdxl-turbo on the new-shoot card) · 21 (provider internals inline on failed tiles) · 23/24 (transport prefix + `(sdxl)` captions — same "internals leaking into copy" theme as r4 findings 6/12).

## QA round-4 — dark HUD pass (reviewer agent — /tmp/marque/qa-r4/*.png)
**Scroll truth: CLEAN. 16/16 route×viewport combos — pageScrolls=false, hPageOverflow=false everywhere.** Interactions verified live: ⌘K palette opens/filters("brand"→7)/navigates/Esc-closes with amber focus ring; dashboard plan-card rename+delete Enter keys do NOT navigate (target-guard works, known bug stays fixed); EvidenceDrawer opens+Esc-closes on /profile and campaign detail (0.5 black scrim present); BrandBook pager next/prev works; /profile dirty-state→save→revert round-trips through the API. `/api/strategy/examples` auto-pull takes ~64s on detail open (honest "hunting…" skeletons, 90s hard cap — slow but by design).
Evidence: sweep metrics in `/tmp/marque/qa-r4/sweep.log`; interaction probes `probe.mjs`/`prof.mjs`; vision pass on all shots.

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

## Jargon sweep r5 — internal-jargon / dishonest-text audit (read-only, @02:55)
Static grep over `web/src/**/*.{jsx,js}` + runtime innerText/title dumps at 1440×900 on
/dashboard /strategy /campaigns /shoots /websites /brandbook /profile /onboarding
(+ New-shoot form, failed-shoot detail, profile evidence drawer, campaign detail probes).
Humanization layer verified working: engine chips read auto/studio render/cloud render/web render,
motion render, screen film; 'tensor' → 'Marque strategy model'; Qloo surfaces → 'taste graph'.

HIGH — raw jargon in visible rendered text:
- [ ] Photoshoot.jsx:66 — hardcoded `<span className="z-tag">rendered locally · sdxl-turbo</span>` in New-shoot zone-head. Runtime-confirmed innerText on /shoots with form open.
- [ ] Photoshoot.jsx:130-132 — failed ShotTile renders raw `r.error` in title AND visible `<i>`; Photoshoot.jsx:337 card thumb `title={r.error}`; Photoshoot.jsx:373 `{job.note}` raw. Runtime-confirmed in shoot detail: "all image providers failed — gemini(gemini: all image models failed (quota exhausted)) pollinations(pollinations 402)". Server errors carry 'localgen NNN', 'pollinations NNN', 'gemini …' (media.js:57,207,317).
- [ ] Campaigns.jsx:704 — `{open.genError}` prints the raw 300-char provider dump; server already ships `genErrorHuman` twin (index.js:801) but UI never uses it. Fallback copy 'all providers errored' itself leaks "providers".

MED — raw ids / error dumps reaching user-visible UI:
- [ ] data/state.json `/profile/images[1]/caption` = "Can on ice — brand hero (sdxl)" — stored caption leaks '(sdxl)'. Rendered verbatim (visible, not just title): Profile.jsx:429 brand-kit figcaption, BrandBook.jsx:288 `.cap` + :416 cover + :553 `FIG. n —`, Composer.jsx:290-291 picker title/alt, Photoshoot.jsx:104 src-strip title (runtime-confirmed).
- [ ] api.js:16 errors render raw: `e.message` = "POST /api/x → 503 <raw server detail>" reaches visible `{err}` blocks — Photoshoot.jsx:287, Onboarding.jsx:175, Strategy.jsx:648+1403, Websites.jsx:301 (`{impErr}`), CreativeCard.jsx:247 (`caption failed — {pc.err}`), Campaigns.jsx:481 toast (`{next?.imageError}`), plus ~30 `say(e.message)` toasts. Leaks '/api/' paths + raw provider detail into UI.
- [ ] Onboarding.jsx:53 — `title={status?.qlooNote}` → runtime-confirmed "Qloo live" (vendor name in tooltip); unconfigured variant is "QLOO_API_KEY missing — taste calls will fail visibly" (env-var name + vendor, reads like error dump). Server note strings at services/qloo.js:98-100.
- [ ] Onboarding.jsx:51 — AGENT led `title=Chat brain: ${model||provider} — down (${error})` → runtime "Chat brain: gemini-3.5-flash"; when tensor unconfigured prints literal "Chat brain: null — down (unreachable)" ('null' tell, index.js:139-140 nulls); failure variant appends raw `status.agent.error` ('tensor 503'-style).
- [ ] Composer.jsx:18-30 `cleanNote` scrub list misses localgen/sdxl(-turbo)/turbo/ffmpeg/tensor/devin/qloo — passes through verbatim (e.g. imageError 'localgen 503: …' in CreativeCard.jsx:309 lightbox-cap, CreativeEditor.jsx:238 ed-micro-warn). Also produces garbled output: runtime-confirmed tooltip "Watch — made with motion render · the provider failed: the provider video: could not start operation" (videoNote stored raw in state.json creatives).
- [ ] Evidence surfaces print raw call errors — EvidenceDrawer.jsx:119 `failed — {c.error.slice(0,90)}` visible + `title={c.error}`; Qloo.jsx:115 `{c.error.slice(0,60)}` inline + :113 raw `k=v` params (urn:entity:… leaks); Qloo.jsx:80 `title={a.error}`. Labeled evidence trails, but unfiltered raw error text (qloo 4xx bodies) renders verbatim — flag per "tooltip reads like error dump" rule.
- [ ] Campaigns.jsx:680/768 tooltips fine, but same raw-e.message path: `say()` toasts throughout Campaigns (259/330/360/377/382/394/408/425/435/448/482) — covered by the api.js:16 item; listed here for fixer completeness.

LOW — honest provenance, borderline:
- [ ] Strategy.jsx:663/675 — `title="engine: local-sdxl-turbo"` raw model id tooltip next to humanized 'STUDIO RENDER · time' label; acceptable provenance per audit rules, inconsistent casing/vendor-level detail.
- [ ] Photoshoot.jsx:139 — `title={r.provider}` raw id ('local-sdxl-turbo') on provider chip; acceptable provenance.
- [ ] EvidenceDrawer.jsx:110 — raw endpoint path '/v2/insights' printed as ev-path; inside labeled evidence drawer = acceptable provenance.
- [ ] BrandBook.jsx:392 — `href="/api/brandbook/pdf"` shows '/api/' path in browser status bar on hover; functional link, cosmetic.

Clean (verified no leak): rail LEDs (TASTE/GEN), engine chips all surfaces, strategy provenance line, campaign detail incl. Provenance panel, profile evidence drawer empty-state, websites audit view, onboarding LEDs text (labels), MediaFallback tiles, loading.jsx readout, CommandPalette labels ('qloo' only in non-rendered search hay + icon name). No lorem/TODO/undefined/[object/NaN/dummy text observed on any rendered route.

Counts: HIGH 3 · MED 7 · LOW 4

## 03:00 — deep wave 2 landed
- scraper/qloo hardening: readBodyCapped (2MB/8MB caps + body deadlines), content-type 422 gate kills silent-empty fabrication — b9c789b.
- GOLD-PATH e2e (real campaign 'Cooler Door Neon'): copy now concrete (priced/verb-first CTAs), all sdxl stills, verified-motion videos. FOUND: planWantsSiteDemo regex 'store|shop' false-matched 'c-store' → site film of ANOTHER campaign's site (fix in flight ff71b401); mono-angle creatives (fix cbf221e8).
- brandbook.js mix() inversion fixed (same bug sites.js had); 'negative space' slab-trigger reworded; profile ref swapped to skull-can hero; caption '(sdxl)' scrubbed.
- in flight: jargon-fixer 774a7328, QA-r5 1e865063, reframe-UI cfd44b64, content-sweep 35db2d3d.

## 03:30 — wave 3 landed (98b8fef)
- jargon layer: labels.js (cleanErr/scrubEngines/ENGINE_DEDUPE), all r5 leaks fixed, raw kept in title= attrs as honest provenance.
- site-film routing: word-boundary SITE_DEMO + filmableSite board-scoping (kills the c-store false-positive that filmed a stranger's site); manual demo-video route uses it too.
- creative diversity: beat contract + avoid-ledger + samey retry + vpos rotation — verified A/B (1→4 CTA verbs, 1→3 vpos).
- reframe UI: 6-AR picker → real img2img resize → variant chips (export/kit/motion).
- moodboard desktop → horizontal snap rail (was 60px slivers); mobile rail preserved via min-width guard.
- HMR double-root guard in main.jsx; store.js age-gate on moodboard orphan sweep (in-flight tiles survived).
- content sweep: 104 asset refs verified, clichés scrubbed from site HTML, missing board tiles retriggered.
- in flight: r6 matrix, final gold-path, error-realism audit, first-run audit, published-output audit, smoke extension.

### Chaos-pass fixes landed (me, ~04:10)
- `.media-fallback` + `.stg-mood-err` → `pointer-events:none` (button stays `auto`) — decorative overlays were eating tile clicks
- `saveAssetBuf` magic-byte sniff: declared raster ext mismatches real magic → coerced/none → `.bin` (thumbs 415 not 500)
- `/assets/thumb` PIL decode-fail → `releaseAsset` + 422 — corrupt uploads can't error-spam forever (verified: fake-PNG upload → thumb → asset released, clean 422)
- favicon serves 200 on :8787 (earlier 404s were pre-rebuild)
- ⌘K nav-vs-action HIGH dispatched to palette-fixer (eb48598a)

### Review-fix wave + tensor fallback (me + agents, ~04:20)
- **Tensor key died (~23h retry)** — devin-cli fallback lane landed live: key-death (401/402/403/429+400-key-err) → one-shot devinCliChat rescue, honest `via` + `agent.error` surfacing. Verified: tensor ping PASSES via fallback while key is dead.
- status `agent.provider/model` now reflects `th.via` (was hardcoded 'tensor'); `auditBy`/`modelNote` name the real serving provider via `tensorLastCall().via`.
- `genImageResilient` filters refs to readable rasters (`usableRefs`) — SVG/bin/missing refs dropped before localgen tries to decode them (was a 500; smoke regen check back to PASS).
- `saveAssetBuf` magic-sniffs; `/assets/thumb` decode-fail → releaseAsset + 422 (poison-asset loop killed, verified live).
- `UPLOAD_OK` trimmed to mimes `MIME_EXT` can name (avif/webm/mov would land as dead .bin tiles).
- `api.upload` surfaces server 422 reason (was raw status only).
- `.ob-stage.done` → `.past` retarget in both stylesheets (rename orphaned the styles).
- `prodName` keys board subject (subProduct → urlContext.siteName/title → profile → prompt) — stops wrong-brand possessive on foreign-site boards. TDZ-order bug introduced+caught in review, fixed via `subProductEarly`.
- `filmableSite`: `producedFrom.boardId` persisted (index.js+sitevideo ctx→sites.js); boardId-carrying sites must board-match — title alone no longer crosses brands.
- `.media-fallback`+`.stg-mood-err` pointer-events:none (click-eating overlays); AffinThumb→letter-tile on img error; main.jsx MutationObservers cached+disconnected on HMR re-eval (leak fix).
- gemini quota regex covers 402/prepayment — smoke's skipOnQuota now engages (was a permanent red).
- deeplinks lane: `/strategy/<boardId>/<idx>` shareable (was server-global activeIdx — links rotted); shoots/websites/brandbook/editor selections URL-backed; favicon served.
- prompt-lab: 5/9 moodboard tiles + flat-lay re-prompted, render-verified (real :8807 + vision judging).
- Smoke: 26 PASS / 1 SKIP (gemini image quota — resilient path covers); tensor ping green via devin fallback.

### r7 cleanup wave (me, ~04:35)
- QA-r7 verdict: no P0/P1 on merged tree. Palette fixer landed PLACES-table nav pinning + mutating-gate + confirm veils on heavy actions (verified: 'shoots' navigates, zero surprise POSTs).
- `/campaigns/<uuid>` normalizes to `?open=` (was dead list render).
- boards list payload gained `hasMoodboard`/`moodboardJobId` — Dashboard prefetch skips guaranteed-404 boards → console now silent.
- `Ctx` cached on globalThis — HMR re-eval no longer null-destructures in mounted views (the /shoots pageerror).
- `.affin-name` nowrap+ellipsis+min-width:0 — entity names truncate instead of mid-word wrap.
- `prodName` siteName clause splits '|'/'—' taglines — 'Liquid Death', not 'Liquid Death | Murder Your Thirst'.
- creative edit route accepts `badge`; stored 'MURDER YOUR THIR' → 'MURDER YOUR THIRST'.
- 168 orphans / 124MB pruned; orphanAssets() now grace-gates 20min like the boot sweep (in-flight writes can't be pruned).
- Watchdog restarted on prod cadence (deep every ~10min; was test 2min).

### Endgame wave (~05:00–05:45)
- `.stg-qname` 2-line clamp → nowrap+ellipsis (last mid-word wrap class killed; 'POORSTACY' truncates instead of 'POORSTAC Y').
- A11y P1/P2 batch (743fa73): moodboard lightbox + shoots detail real useOverlayFocus traps (aria-modal honest now); ⌘K combobox semantics (aria-activedescendant, option ids, Home/End); campaigns view-swap focus restore + layered Esc; produce chips real APG radio, grade stars honest aria-pressed; sub-24px targets bumped (ws-unpub 19→24); lime focus rings on lightbox-x/rr-btn/ws-unpub.
- Onboarding hardening (7a624b7): normalizedUrl() gates build — garbage can't POST /profile/build (verified 0 requests on 'not a url at all' + Enter); type=url + aria-invalid + disabled-on-empty; AGENT_KIND gained 'devin-cli'.
- Published-surface polish: LD site republished at /s/liquid-death (was site-51b4ce2d); sentinel 'Your Brand skincare' draft site deleted; hero image regenerated via free-mode photoshoot (barbell+chains+venue-bus, on-brand vs old studio-gear flat-lay) and swapped in via /edit route.
- Smoke 27/27 green on merged tree (incl. raw gemini image — quota recovered); devin-cli fallback still carrying text layer honestly (agent.provider=devin-cli).

### Demo path (09:00 handoff)
- Cold open lands on Dashboard — LD flagship is ACTIVE plan (79b27472). If a late test lane drifts it again: `curl -X POST :8787/api/boards/79b27472-a6aa-4dba-8672-2c2567cb1bcf/activate`.
- Walk: /dashboard → /strategy/<board> (moodboard rail, fit scores) → strategy detail (real hunts, ≤90s partial-honest) → /campaigns?open=229d419b (can-on-ice creatives, motion renders) → /shoots (6 real shoots) → /websites → /s/liquid-death + /s/fern-matcha published → /brandbook → /b/book-9d8ee960 published → /profile (LD coherent, taste-off honest).
- Provider honesty: text brain = devin-cli (tensor key dead ~23h, auto-fallback); images = local SDXL-Turbo (:8807, watchdog-restart ~54s, deep-check ~10min); video = ffmpeg (veo deprecated upstream); Qloo = live. Status LEDs report all of it truthfully.
- Known honest gaps: /brandbook Imagery page empty (book.images=[]); Olipop bare-board 404 by design; 'Acumin Pro' font CDN may 404 → Georgia fallback.

### Overlay-stack wave (~05:35–05:45, 7019855)
- focus.js exports `isTopOverlay(root)` — the same stack that owns the Tab trap now gates every Escape: Modal, CreativeCard zoom, EvidenceDrawer, CreativeEditor, Photoshoot detail, Strategy lightbox. One Esc = one peel (was: every open veil raced the same keydown). Verified live editor+drawer: Esc1→drawer only, Esc2→editor.
- ⌘K mutating actions armed: 'Run site audit' + non-active board rows now `↵ again runs it` instead of POSTing on first Enter (the silent activateBoard drift source). Verified: armed veil, zero posts, Enter2 fires once.
- `.ck-item` tabIndex=-1 (focus stays on combobox input, aria-activedescendant owns the beam).
- Drawer z-index 95→310 — palette-launched evidence drawer painted invisibly under lightbox/modal veils (z300); verified visible above strategy surface.
- CreativeEditor veil `e.target===e.currentTarget` guard — drawer clicks no longer bubble-close the editor.
- Strategy mount drops duplicate /api/boards (d016535) — App ctx already loads it.
- Post-merge verify: smoke 27/27, cold-open 16/16 dev+prod clean, palette→drawer z-order + arm gates confirmed in real Chromium.

### Second overlay wave + unnesting (~05:45–06:05, 64f48d4..7fe0faa)
- Websites seg-tabs → real APG tablist: arrows/Home/End switch+focus, roving tabindex, role=tabpanel wrapper mirrors .view plumbing (layout verified identical desktop+mobile).
- video[controls] joined FOCUSABLE — motion previews inside trapped overlays (editor, card zoom) are keyboard-reachable now (verified Tab→VIDEO).
- Overlay stack pinned on globalThis — HMR re-eval can't split the stack (same class as the Ctx fix).
- Nested-interactive purge (the presentational-descendants bug): CreativeCard media well → real .cc-hit button under badges/veil/promote; .dash-plan → h4 title is the real open button; .stg-wx → corner chip is a real role=checkbox; .stg-chipbar → prompt text is the real modify button. role=button survives only on legit disclosure expanders (.imp-sug/.imp-steal — no nested controls).
- Esc layer gates completed: promote fold + PillMenu defer via anyOverlayOpen() (palette's stopPropagation can't shield same-node document listeners — verified Esc1→editor, Esc2→promote); palette Esc itself gated on isTopOverlay (latent insurance).
- Dead code removed: Kebab.jsx + KebabMenu export (unused; KebabMenu's Esc predated the gates).
- Fresh real audit on liquiddeath.com replaced the stale huel.com residue in the Improve tab (7 LD-on-brand fixes, correct IG/TikTok socials, honest 'No X Linked').
- profile.source stays null — honest provenance (hand-restored profile wasn't scraped); audit accepts explicit URL by design.

## Wave — serve-time share meta + keyboard sweep (~06:15 ET)
- `normalizeHTML` now derives meta description + og:title/description/image
  from the page's own <title>/first <img> when absent (LLM-edited published
  HTML previously shipped zero share-preview meta). Fern site untouched —
  its renderer-native version already emits og tags. (273b3c6)
- Keyboard sweep verified: dashboard Tab order walks rail → ⌘K → per-card
  controls with real BUTTON/A elements only; zero orphaned or dead stops.
- document.title audit: app shell consistent; published surfaces get brand
  titles (LD site, brand book).

## Wave — fresh-eyes audit closure (~06:30 ET)
- P1: `?site=` no longer dead-ends the Improve tab (explicit `?tab=improve`
  write; cold-load initializer honors bare `?site`). Verified live.
- P1: `items()` filters `tabIndex<0` — ⌘K rows can't leak Tab out of the
  dialog for a keystroke.
- P1: Photoshoot detail is an honest inline panel — no aria-modal, no trap;
  Esc closes it, gated on `anyOverlayOpen`.
- P2 sweep: Profile disarmRm Esc gate, listbox group/presentation roles,
  grade stars `aria-pressed=grade>=n`, lightbox `target===currentTarget`,
  ⌘K no-ops on /onboarding, chipbar draft-wipe click removed, honest
  engine tooltip, dead FieldEdit/UploadBtn + ~370 lines dead CSS removed,
  `.dash-plan` accent bar on `:focus-within` (was unreachable
  `:focus-visible`), ver-tab iframe out of button, inline-edit focus
  restore on all three sites.

## Swarm r8 — backend audit 08:1x ET
Reviewer 2 — backend/flow layer. Read-only audit; no fixes, no service restarts.

**Smoke (`npm run smoke`): 23 PASS / 1 SKIP / 2 FAIL** (exit 1). SKIP = gemini image quota (covered by local fallback). Both FAILs are transport casualties of a `--watch` reload mid-run, not route bugs — see [P0-1].

**Demo-path verdict (09:00 handoff section):**
- LD board `79b27472` — **ACTIVE** (`activeBoardId` matches; re-verified after 2 parallel POST activate → both 200, idempotent).
- `/s/liquid-death` — **200**, og:title+og:description+og:image present; og:image resolves 200.
- `/s/fern-matcha` — **200**, same og triple, resolves 200.
- `/b/book-9d8ee960` — **200**, og:title/desc/type/image + twitter:card; image resolves 200.
- `/api/jobs/<id>` — 404s cleanly for dead ids (in-memory Map, `index.js:120-133`); **no stuck jobs** — nothing persisted in `running/*` state; the one interrupted shoot was correctly healed (see P0-1).
- Logs — **no fresh errors last hour**. Watchdog deep-health green through 08:03:55 (~10min cadence); only FAILs are 03:45–03:56 pre-recovery noise.
- Cold open — `/` + 7 SPA routes all 200; `web/dist` built 06:27, no `web/src` file newer → prod build is current.
- localgen :8807 — **UP & stable** (`/health` 200, sdxl-turbo, pid 2425320 since 03:56 — NO mid-test restart occurred).
- Edge probes — `/s/nope`, `/b/nope`, bare `/s`, `/api/nonexistent`, `/assets/..%2f`, thumb-miss all → correct 404s (styled/JSON, never Express HTML).
- Concurrency — 24 parallel + 39 sequential GETs across 13 API routes: **zero non-200s**.

**Findings:**
1. **[P0] Live :8787 runs under `node --watch` — parallel `sites.js` save at 08:12:28 hard-restarted the server mid-smoke.** In-memory jobs Map wiped (moodboard + animate jobs → 'gone'), 2 in-flight generation fetches dropped → both smoke FAILs (`fetch failed`; the connDrop retry didn't save them — likely stale keep-alive socket reuse on retry). GOOD NEWS: boot-sweep healing verified live — the interrupted shoot was marked `status=error 'interrupted by restart'` (store.js:98-100) and moodboard stale-marker recovery held (hasMoodboard:true, moodboardJobId:null, 9 tiles intact). DEMO RISK: any `server/src` save during the 09:00 walk kills in-flight generations + SSE streams. Mitigation belongs to ops (freeze edits / run demo off `--watch`) — file it in the handoff, not the codebase.
2. **[P1] devinCli bridge serializes ALL calls through one queue and never rejects pending RPCs on proc exit.** `devinCli.js:97-121`: one global FIFO — a 300s inspect blocks every queued call including the tensor→devin text fallback (the failover brain). `devinCli.js:67`: `proc.on('exit')` nulls proc/session but leaves `pending` Map entries hanging until their own timeout (up to 300s). If `devin acp` dies mid-prompt while a fallback is queued, the text layer stalls for minutes with the HTTP request open (no route timeout). Latent right now — tensor is healthy (`provider=tensor ok=true`, key recovered vs the ~23h-dead note) — but it's the exact failure shape if the key dies again mid-demo under load.
3. **[P1] `persist()` is a synchronous 1MB full-state serialize+write on every mutation.** `store.js:164-169` — state.json is now 1.04MB; `set()` → JSON.stringify + writeFileSync + rename blocks the event loop each call. A 9-tile moodboard job does ~10 full serializations inside `registerImage`; every concurrent request queues behind ~10–30ms disk stalls, and it grows with state size. Atomic (tmp+rename) so correctness holds; this is a scaling smell, not corruption.
4. **[P2] Thumb route conflates transient infra failure with corrupt content.** `index.js:101-109` — ANY `execFileP` failure (20s timeout, missing python, OOM kill) → `releaseAsset` + 422 'not a decodable image'. A slow-but-valid raster under load gets its unreferenced file deleted; a referenced corrupt raster instead re-spawns PIL + re-422s on every thumb hit (retry amplification — no negative cache).
5. **[P2] `DELETE /api/profile` leaves the `images` registry populated forever.** `index.js:195-201` — wipes profile/catalog/campaigns/boards/etc but not `images` (408 rows currently). Registry membership shields files from `orphanAssets()` (store.js:361) → a profile reset permanently strands hundreds of generated files.
6. **[P2] `POST /api/creatives/:id/edit` manual fields uncoerced.** `index.js:877-879` — `headline`/`body`/`cta` assigned raw (a JSON object/number in the body is stored verbatim → renders `[object Object]` in overlays). The agent path and `badge`/`overlayStyle` get `String().slice()` — manual path should match.
7. **[P2] `jobs` Map + `exCache` are unbounded.** `index.js:120`, `458-487` — completed jobs (incl. result payloads) accumulate for process lifetime; `exCache.clear()` on overflow nukes all entries (hot + cold) rather than LRU. Restarts are the only GC.
8. **[P2] SSE/generation routes ignore client disconnect.** `/api/strategy/stream` (`402`), `/api/agent/stream` (`206`), and the 90s `Promise.race` in `/api/strategy/examples` (`477-480`) all leave generation running after the client drops — burns tensor/qloo quota on abandoned work. Single-user demo makes this unlikely to matter; worth noting for hosted use.
9. **[P2] Validation asymmetries.** `PUT /api/catalog/:id` (`269-278`) lacks the 1MB-size/24-depth guards `PUT /api/profile` has (`184-185`); `brief.title` non-strings pass the `!brief?.title` guard (`755`); `/api/websites/:id/video` + `/api/campaigns/:id/demo-video` have no dedupe — double-POSTs queue concurrent chromium renders.
10. **[P2] `/s/:slug` og:image absolutize is single-match.** `index.js:1302` — one regex `replace`, first occurrence only, `content="/`-shaped only; fine for current sites, brittle for multi-og or differently-ordered attrs.
11. **[P2] fetchPublic DNS TOCTOU (residual SSRF).** `store.js:430-448` — each redirect hop re-resolves+revets, but the vetted answer isn't pinned to the socket — a rebinding host can pass vetting then resolve differently at connect time. Accepted-design risk; noting for completeness.
12. **[P2] Housekeeping:** stray QA servers still running — express :8899 (book-template previews, ~6h50m) and a `marque-var-alt` vite on :5175. Not marque-proper; kill before demo if the box is tight. `watchdog.log` + `localgen-watchdog.log` are byte-identical — the watchdog appears to write/tee both (harmless duplication).

**Addendum 08:16 — parallel localgen upgrade landed mid-audit (expected per brief):**
- sdxl-turbo (pid 2425320, ~10h) → **ByteDance SDXL-Lightning 4-step safetensors** (pid 3435545). `/health` → `ok:true`; already serving gens (~6.4s/768² img, comparable to turbo). `offload=auto` declined (free VRAM 5015MB < 6400MB) → sequential fallback. Watchdog exited 08:14:30 (signal) and self-relaunched 08:16:18 — ~2min unprotected window, now covered again.
- **[P1] `/api/status` now leaks an absolute path**: `localgen.model` = `/home/ANT/.cache/huggingface/hub/models--ByteDance--SDXL-Lightning/snapshots/.../sdxl_lightning_4step.safetensors` — the old model reported a clean repo id; the safetensors path passes verbatim into the status payload (index.js:142). If any status LED surfaces `model`, it shows a home-dir path live on screen; even unshown it's username+layout disclosure. Same root: `localProviderTag()` (media.js:190-199) derives the provider badge from `h.model` → badges now read `local-sdxl-lightning-4step.safetensors` (file-ext jargon leak).
- Second `--watch` reload confirmed (child pid 3434037; sites.js saved again 08:14:33) — the live-edit hazard in [P0-1] is active RIGHT NOW, not hypothetical.
- Post-swap demo re-verified: `/s/fern-matcha` re-renders under the new deck chrome (renderer-native snapshot path held through the redesign — dots present, og triple intact); `/s/liquid-death` serves legacy stored HTML, untouched, still 200 + og.
- Tensor is HEALTHY again (`agent.provider=tensor ok=true`, key recovered vs the ~23h dead note) — devin-cli fallback currently dormant, which makes [P1-2] latent rather than live.

## Swarm r8 — UI audit 08:1x ET
Reviewer pass, all shots /tmp/qa-r8/*.png. Scroll truth: CLEAN — all 8 app views at 1440×900 and 390×844: pageScrolls=false, hPageOverflow=false everywhere. Console clean except known RR future-flag warnings. Inner scrollers verified working: dashboard zone-body (1626>724), profile right rail, campaigns list — clipped-looking rows ARE reachable.

1. [P0] /s/fern-matcha (published, :8787) — CTA/contact section headline is stored TRUNCATED mid-word: h2 text in DOM literally ends "…power through your final deadlines without t" — data truncation (~140 char clip in stored site copy), NOT a CSS clip — verified via outerHTML. Broken on a customer-facing published page at 1440 AND 390. Repro: open /s/fern-matcha, click CONTACT. Evidence: /tmp/qa-r8/fm_cta2.png.
2. [P1] /strategy board @1440 — header reads "STRATEGIES · 4" but only 3 pick cards render in view; card 4 lives below the tile boundary inside .stg-pick-grid (scrollHeight 732 vs clientHeight ~153, overflow:auto, NO visible scrollbar) — the 4th strategy is undiscoverable on the board (only reachable via blind inner-scroll or by opening a strategy detail where all 4 strip-cards show). Repro: load /strategy, look at picks row. Evidence: /tmp/qa-r8/strat_c4scroll.png (card 4 revealed mid-scroll).
3. [P1] /s/fern-matcha @1440 gallery — right figure image + caption overflow the viewport right edge; caption "100MG L-THEANINE DELIVERS 4-HOU…" is clipped mid-word at x=1440; the vertical dot-nav "GALLERY" label also collides with the image edge. Repro: click GALLERY. Evidence: /tmp/qa-r8/fm_gal.png.
4. [P1] /s/fern-matcha @1440 — bottom marquee ticker is vertically clipped mid-glyph: page is fixed-height (docScroll exactly 1440×900, unscrollable) so the bottom ~35% of ticker text is permanently cut off. Evidence: /tmp/qa-r8/pub_fm_1440.png.
5. [P1] /campaigns detail @390 — "← All campaigns" back button overlaps the "MARQUE / OUTPUT" kicker at top of view (button bottom edge sits on the kicker text). Evidence: /tmp/qa-r8/camp_detail_390.png.
6. [P2] /strategy — intermittent stale-job toast "× Interrupted by restart [Retry]" floats centered over the moodboard rail; appeared on 2 of 5 fresh loads (a prior moodboard job interrupted by server restart keeps resurfacing). Evidence: /tmp/qa-r8/strat_fresh.png.
7. [P2] /campaigns — campaigns with empty strategyTitle (Cooler Door Neon, 2 AM Cooler Revival — strategyId='' in API) group under tautological header "FROM STRATEGY: STRATEGY". Evidence: /tmp/qa-r8/camp_scrolled.png.
8. [P2] /s/liquid-death — ~150-200px dead bands between sections (step-cards→HYDRATION ARSENAL, product cards→TASTE SIGNATURE) read as orphaned whitespace; sticky nav clips product-card tops mid-scroll; @390 the section nav (Challenge/Arsenal/Culture) disappears entirely with no hamburger — section anchors unreachable on mobile. Evidence: /tmp/qa-r8/pub_ld_mid.png, pub_ld_bot.png, ld_390_nav.png.
9. [P2] /campaigns detail — provenance panel has ~270px dead middle between palette swatches and the meta rows (r4 finding 10 still open). Evidence: /tmp/qa-r8/camp_open2.png.
10. [P2] /strategy/0 @390 — FORMATS section header renders with no chips beneath it (header then straight to PRODUCE); the 3 format chips visible @1440 are missing at mobile. Evidence: /tmp/qa-r8/strat_det_390.png.
11. [P2] /s/fern-matcha gallery images read as eyeshadow/cosmetic pans — off-brand for a matcha brand ("YOUR 2:50 PM ICY MATCHA RITUAL" caption under makeup-pan imagery); content/gen-quality miss on a published surface. Evidence: /tmp/qa-r8/fm_gal.png.
12. [P2] Board/plan data clutter surfaced everywhere: 3 identical "Liquid Death → festival-going metalheads & gym rats, 18-29" boards + 3 "Olipop prebiotic soda" boards shown on dashboard grid and ⌘K BOARDS list — reads like duplication bugs to a demo audience even if intentional. Evidence: /tmp/qa-r8/cmdk2.png.

CLEAN verifications: ⌘K palette (veil, amber focus ring, hit counts, footer hints, 43 hits); creative Zoom overlay (veil + close, no z-order bleed); websites MORE/LESS expanders work (r4 finding 5 fixed); brandbook real cover + /b/book-9d8ee960 published clean @ both sizes; onboarding/profile clean both sizes; campaigns composer + engine chips fine; "web render" chip half-dim state persists (known r4 #12); profile accent #ff8a98 pink for Liquid Death is odd but real profile data; LD published page's nav anchors #stunt/#products/#culture all resolve.
