# Marque redesign spec R1 (research agent output, 2026-10-25 ~23:58)

## Direction: "ops deck" — fixed 100dvh viewport app, dark instrument console
(Keep Marque orange accent; topbar with honest status LEDs from ctx.status)

## Tokens (replace :root in web/src/styles.css)
- bg #0b0e0c, bg-raise #0f1310, card-1 #131814, card-2 #181e18, card-3 #1f261e
- line #26301f / line-soft #1c2417, ink #d8e4d4, ink-2 #a8bda3, ink-3 #718373, ink-4 #516252
- acc #ff5a1e (was --lime #e04500), acc-2 #ff7d47, acc-text #ff8f5e, acc-ink #160c05
- green #3ee27f (live), amber #ffb03a (warn), radius 0, shadow none, glow 0 0 12px rgba(62,226,127,.28)
- fonts: Inter body, Oswald/Archivo display, mono ui-monospace; metrics use font-variant-numeric:tabular-nums
- DELETE plakat hard-shadow sweep styles.css:727-745 + contrast band 747-783 (they fight the dark deck)

## Shell (App.jsx + styles.css)
- html,body,#root{height:100%;overflow:hidden}; .shell{height:100dvh;grid rows 44px/1fr;overflow:hidden}; .main{min-height:0;overflow:hidden}
- New 44px .topbar row: [mark+STUDIO] [route name mono] [Wayfind back] …spacer… [LEDs: QLOO mode, LOCAL model, GPU] [clock]
- .brandmark unfixed → flex item in topbar; Wayfind moves into topbar; onboarding keeps bare hero
- Ambient: body::before 2 radial glows (orange top-right, green bottom-left ~10%), body::after scanlines+vignette, prefers-reduced-motion safe

## Shared primitives
- .panel: card-1 bg + hairline + corner brackets (::before/::after L-corners, rgba(255,140,80,.35))
- .panel-head: grid auto/1fr/auto, 10px mono uppercase, index <b>01</b> + name + right tag — unifies .section-label/.stg-slabel/.ptitle/.imp-label/.step-label
- .kv 92px/1fr mono rows; .led 7px square (.on green+pulse, .warn amber, .off)
- .rail: horizontal snap rail (auto-flow column, minmax 280-340px, snap-x, .scroll-x-fade edges)
- .segbar: segmented meter overlay on .affin-bar/.stg-bar
- .flap: split-flap row cells (two-tone gradient) for work/version/list rows

## Per-route (all height:100%;overflow:hidden; internal scrolls only)
- /dashboard: grid rows auto/auto/1fr — compact head, plans→.rail (~320px cards, +NEW end-tile), work→one-row rail
- /strategy: grid rows auto/auto/1fr; .stg-aud col-span-4 overflow-y:auto; .stg-picks rail or overflow grid; REMOVE zoom:.87 hack (strategy.css:1128); .stg-flow→"04 NEXT" panel row
- /strategy/:idx: keep grid rows; each .stg-detail-cols column overflow-y:auto; plans row fixed ~150px horizontal
- /campaigns: flex column h100% — head / composer+brief split 1.35/1 / campaigns overflow-y:auto or 360px rail groups
- /campaigns/:id: fuse .res-band+.res-next→one toolbar; creative-grid overflow-y:auto minmax 190px; agent chat→right panel (grid 1fr/360px)
- /websites: seg-tabs→sub-header; improve→grid 400px/1fr both cols scroll; site→rows auto/auto/1fr, .preview-frame height:62vh→flex:1 (studio.css:437)
- /brandbook: .book-stage flex h100%; .book-page flex:1 min-height:0 w/ .page-in scroll; cover aspect 3/4 max-height:100%; step-bar numbered 01-05
- lock/loading/empty states restyled dark

## Top-10 upgrades
1 fixed 100dvh grid + internal scroll regions · 2 dark ground + hairline panels · 3 topbar LEDs (QLOO/LOCAL/GPU honest telemetry) · 4 corner-bracket panels · 5 numbered mono panel-heads · 6 mono microtype + tabular-nums · 7 segmented meters · 8 horizontal rails + fade masks · 9 split-flap rows · 10 ambient glows/scanlines

## Image prompt spec (SDXL-Turbo)
- localgen.py: MODEL→stabilityai/sdxl-turbo, BASE→1024, snap8 hi→1536, steps default→2 (clamp ≤4), guidance 0.0, vae fp16-fix fallback (madebyollin/sdxl-vae-fp16-fix)
- tuning.json localAspectDims→SDXL-native: 1:1 [1024,1024], 4:5 [896,1120], 9:16 [768,1344], 16:9 [1344,768], 4:1 [1536,384]
- media.js: steps 6→2, upscale 2→1, provider label from /health model (local-sdxl-turbo); CreativeCard.jsx:303 badge map add key
- negatives (replace in media.js + localgen.py NEG): "text, words, letters, numbers, digits, typography, logo, watermark, caption, signature, label, font, writing, alphabet, newspaper, magazine, book, poster, packaging, signage, billboard, screen, menu, printed material, barcode, qr code, lowres, blurry, out of focus, jpeg artifacts, oversaturated, flat lighting, washed out, plastic skin, waxy, deformed hands, extra fingers, fused fingers, mutated limbs, distorted face, bad anatomy, disfigured, cartoon, anime, illustration, painting, drawing, sketch, 3d render, cgi, clipart, stock photo, collage, split screen, duplicate, frame, border, cropped head, amputated"
- prompt templates per kind with {lens}/{aperture}/{camera}/{lighting}/{film}/{frame}/{spaceZone} slots — see agent report (deliverable B.4) for full text; index.js:682-688 duplicate prompt array → delete, reuse buildAdImagePrompt; index.js:651-656 agent-edit path gets withSafety() wrap
