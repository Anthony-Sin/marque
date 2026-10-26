# Prompt-layer upgrade: less-bland localgen output

Explorer 2 findings, 2025-XX. Probes run against the CURRENT service
(`stabilityai/sdxl-turbo`, pid live at test time). READ-ONLY — nothing applied.

## Verdict

**Style B won both seeds.** Dense professional photo language (film stock +
named light direction + lens/aperture + texture vocabulary, one compact
paragraph) beats today's verbatim `enrichPrompt` output on every blandness axis:

| probe | seed | contrast σ | sharpness (grad E) | dead-flat % | color metric |
|-------|------|-----------|--------------------|-------------|--------------|
| a = current enrichPrompt verbatim | 1234 | 45.3 | 4.16 | 40.9 | 73.1 |
| a2 | 5678 | 42.8 | 4.35 | 39.9 | 74.0 |
| b = pro-photo language | 1234 | 51.3 | 5.72 | 21.8 | 57.7 |
| b2 | 5678 | 50.6 | 6.99 | 17.8 | 56.6 |
| c = flat-lay (pro-style) | 1234 | 41.2 | 5.23 | 39.9 | 35.7 |
| b, steps=8 | 1234 | 56.4 | 7.06 | 21.9 | 69.7 |

Read: (a) is more saturated but softer with ~2× the dead-flat area — the
"oversaturated plastic stock" look. (b) trades saturation for tonal range and
micro-detail; lower color metric here is the *filmic-mute* win, not a loss.
(c)'s flat % is expected (linen/stone knolling ground is legitimately flat).

Probe files: `/tmp/probe-a.png`, `/tmp/probe-a2.png`, `/tmp/probe-b.png`,
`/tmp/probe-b2.png`, `/tmp/probe-c.png`, `/tmp/probe-c2.png`,
`/tmp/probe-b-noneg.png`, `/tmp/probe-b-s8.png`, `/tmp/probe-b-1024.png`.
Payloads: `/tmp/probe-*.json`.

## Two infrastructure facts that change what the prompt must do

1. **Negative prompt is a no-op today.** `localgen.py:224` runs
   `guidance_scale=0.0` (ADD-distilled turbo). Proof: probe-b with vs without
   `negative` → byte-identical PNG (md5 9cccf63b…). ALL suppression
   (text/packaging/rendered look) must live in the positive prompt — the
   `UNMARKED` cue at promptStyle.js:113 is load-bearing, not decoration.
   Negative additions below are free insurance for the post-swap model only.

2. **`upscale: 2` is a Lanczos stretch, not a detail pass**
   (localgen.py:261-262 `img.resize`). We generate 768² and interpolate to
   1536² — softness is baked in. Probe at native 1024² (`upscale:1`,
   `/tmp/probe-b-1024.png`, ~6.8s vs ~5.6s) resolves real detail sdxl-turbo's
   1024-native pipeline is capable of. If the rebuilt service stays
   SDXL-turbo-class, generate at native res.

## Proposed diffs — server/src/services/promptStyle.js

### 1. Convert `grade` to a pool with film-stock variants (all banks)

Film-stock names are the single highest-signal color-grade token — "Kodak
Portra 400" mutes the plastic saturation better than "rich natural color".
`pick()` already exists; grade currently can't vary.

```diff
   ad: {
     ...
-    grade: { t: 'editorial commercial photograph, rich natural color, sharp focus on the subject', skip: /editorial commercial|filmic grade|cinematic grade/i },
+    grade: [
+      { t: 'editorial commercial photograph on Kodak Portra 400 — muted natural saturation, warm filmic grade', skip: /editorial commercial|filmic grade|cinematic grade|portra|cinestill|film stock/i },
+      { t: 'editorial commercial photograph, filmic color grade, sharp focus on the subject', skip: /editorial commercial|filmic grade|cinematic grade|portra|cinestill|film stock/i },
+    ],
   },
   photoshoot: {
     ...
-    grade: { t: 'professional studio photograph, clean true color, high-fidelity detail', skip: /studio photograph|high.fidelity|filmic grade/i },
+    grade: [
+      { t: 'professional studio photograph, clean true color, high-fidelity detail', skip: /studio photograph|high.fidelity|filmic grade/i },
+      { t: 'professional studio photograph on Fujifilm Pro 400H — clean neutral color, fine grain', skip: /studio photograph|high.fidelity|filmic grade|fuji|pro 400h/i },
+    ],
   },
   hero: {
     ...
-    grade: { t: 'cinematic editorial still, filmic color grade, sharp yet natural', skip: /cinematic|filmic grade/i },
+    grade: [
+      { t: 'cinematic editorial still on Cinestill 800T — filmic color grade, halation in the highlights', skip: /cinematic|filmic grade|cinestill/i },
+      { t: 'cinematic editorial still, filmic color grade, sharp yet natural', skip: /cinematic|filmic grade|cinestill/i },
+    ],
   },
   motion: { ... grade: [ { t: 'film still pulled from a commercial, cinematic color grade', ...same } ] },
   generic: { ... grade: [ { t: 'professional photograph, rich natural color, sharp focus', ...same } ] },
```

And the consumption site (~line 181) — treat grade like the other pools:

```diff
-  if (bank.grade && !has(src, bank.grade.skip)) parts.push(bank.grade.t);
+  const grade = pick(bank.grade, `${src}#grade`);
+  if (!has(src, grade.skip)) parts.push(grade.t);
```

### 2. Add a `flatlay` kind — photoshoot cues actively contradict knolling

Bug: moodboard.js 'culture'/'palette' tiles and `shootTemplates['flat-lay']`
all route to `kind:'photoshoot'`, which injects "three-point softbox + seamless
backdrop" and "100mm macro / 85mm bokeh" — the OPPOSITE of what a top-down
knolling frame wants (hard even light, f/8 edge-to-edge). This is why the
flat-lay probe needed explicit f/8 + even-light language in-prompt.

```diff
+  // BEFORE the photoshoot rule, and remove 'flat-?lay' from it — 'flat-lay'
+  // prompts need f/8 even-light cues, not macro/bokeh
+  if (/flat-?lay|knolling|top-?down|overhead/i.test(p)) return 'flatlay';
-  if (/photoshoot|product shot|flat-?lay|macro|studio product/i.test(p)) return 'photoshoot';
+  if (/photoshoot|product shot|macro|studio product/i.test(p)) return 'photoshoot';
```

```js
  flatlay: {
    lighting: [
      { t: 'hard even overhead light with no directional shadow', skip: /even light|overhead light|softbox|directional light|window light/i },
    ],
    lens: [
      // skip must NOT match 'overhead'/'top-down' — that's the view angle the
      // cue ADDS, not a lens spec; skip only on real lens/aperture terms
      { t: 'true top-down view on a 50mm lens at f/8, edge-to-edge sharp', skip: /\b\d{2,3}mm\b|f\/\d|macro|bokeh|depth of field/i },
    ],
    texture: [
      { t: 'fine material texture resolved across the whole frame', skip: /micro-?texture|material detail|tactile/i },
    ],
    grade: [
      { t: 'precise editorial flat-lay, muted filmic color grade', skip: /editorial flat|filmic grade/i },
    ],
  },
```

### 3. Optional ad-bank cue: kill the seamless-void look

Biggest residual blandness in probe-a was the dead-gradient backdrop (flat %
~41). A treatment cue (not scene content — stays inside rule 1):

```js
  ad: {
    ...
    texture: [
      ...existing two,
      { t: 'a real environment with believable depth behind the subject — no seamless void or flat gradient backdrop', skip: /environment|backdrop|void|gradient backdrop/i },
    ],
  },
```

### 4. LOCALGEN_NEGATIVE additions (post-swap insurance only — no-op today)

```diff
   'noise', 'cgi', '3d render', 'illustration', 'cartoon', 'painting', 'sketch',
+  'clipart', 'stock photo', 'airbrushed', 'smooth plastic', 'flat even lighting',
+  'flat gray background', 'studio void', 'vector', 'low contrast', 'muddy colors',
+  'bokeh wallpaper', 'generic backdrop', 'over sharpened', 'hdr',
 ].join(', ');
```

Do NOT add 'bokeh', 'packaging' variants beyond existing, or 'gradient' — bokeh
is requested positively in cue text and 'gradient backdrop' is a legit
photoshoot request (tuning.json shootTemplates.studio).

## Proposed diffs — media.js + tuning.json (defaults only)

```diff
// media.js:29 — knee is at 4, but probe showed +10% contrast / +24% sharpness
// at 8 for ~2× time (~12s). Compromise: 6 for one-off assets, keep 4 for
// moodboard's 9-tile batch via opts.
-  const { aspectRatio = '1:1', steps = 4, seed } = opts;
+  const { aspectRatio = '1:1', steps = 6, seed } = opts;
```
(Alternatively keep 4 and let callers pass `steps`; moodboard.js:160 could
stay 4 by passing it explicitly.)

```diff
// tuning.json — only if the rebuilt service stays SDXL-turbo-class (1024-native).
// 768+Lanczos×2 → native-res output; same ~6s latency, real detail.
- "localAspectDims": {"1:1": [768, 768], "4:5": [704, 880], "9:16": [576, 1024], "16:9": [1024, 576], "4:1": [1024, 256]}
+ "localAspectDims": {"1:1": [1024, 1024], "4:5": [896, 1120], "9:16": [768, 1344], "16:9": [1344, 768], "4:1": [1344, 336]}
```
```diff
// media.js:49 — Lanczos×2 adds no detail; with native-res dims, drop it
-      prompt: finalPrompt, width: w, height: h, steps, seed, upscale: 2, negative: LOCALGEN_NEGATIVE,
+      prompt: finalPrompt, width: w, height: h, steps, seed, upscale: 1, negative: LOCALGEN_NEGATIVE,
```
If the swapped model is slower/heavier, keep 768+upscale:2 — flag to the
rebuilder: `upscale` is currently `resize`, a real upscaler pass would change
this math.

## Caller-side notes (not applied — src owned by rebuilder)

- campaigns.js `composeImagePrompt` (~line 168-178): the tail after the
  77-token window (CRITICAL no-text wall, palette restatement, mood,
  "Professional commercial photography…") is dead weight for CLIP — its job is
  already done by the spliced `Shot detail` clause + `UNMARKED`. Consider
  trimming or moving the no-text wall earlier; probe-b's compact body is part
  of why it won.
- moodboard.js `buildTiles`: 'culture' + 'palette' tiles should pass
  `kind: 'flatlay'` (their prompts say knolling/top-down already — inferKind
  change above also catches them automatically via prompt text).
- Photoshoot prompts (index.js:1005-1006) already name scenes via
  shootTemplates; `flat-lay` template hits the new bank once inferKind lands.

## Re-verify after the model swap

Same probes work verbatim: `curl -X POST localhost:8807/generate -d
@/tmp/probe-*.json -o out.png`. If the new model has guidance > 0, re-run the
b vs b-noneg pair — negatives will start mattering and the diff in §4 becomes
live code, not insurance.
