# Marque sprint triage — deadline 2:00pm EDT (Fri Oct 23 2026, extended)

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
