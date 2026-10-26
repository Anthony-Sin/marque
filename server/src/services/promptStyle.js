// Anti-bland prompt enrichment for the local diffusion backend.
//
// Why this exists: caller prompts (campaigns.js composeImagePrompt, photoshoot
// prompts, edit specs) describe WHAT the image is about, but say almost nothing
// about HOW it is photographed. Turbo-class local models (sd-turbo, sdxl-turbo)
// respond strongly to concrete photographic language — lens, light, texture —
// and flatten to generic stock-looking output without it.
//
// Two honest rules:
//  1. Enrichment only ever adds photographic treatment cues (light, lens,
//     composition, texture, grade) and palette hexes that came FROM the
//     caller (opts.palette or hexes already present in the prompt). It never
//     invents brand names, products or scene content that isn't in the brief.
//  2. Cues already present in the prompt are never duplicated — each cue
//     carries a `skip` regex checked against the source text.
//
// Placement matters: CLIP encoders on turbo pipelines truncate at 77 tokens,
// and real briefs run 200+ tokens — anything appended at the tail is silently
// dropped. enrichPrompt therefore splices a compact treatment clause right
// after the prompt's first sentence, inside the encoder window.

// deterministically pick from a pool so the same prompt enriches the same way
// (stable for A/B + regen) but different prompts vary the treatment.
function pick(pool, seedStr) {
  let h = 0;
  for (let i = 0; i < seedStr.length; i++) h = (h * 31 + seedStr.charCodeAt(i)) >>> 0;
  return pool[h % pool.length];
}

const has = (prompt, re) => re.test(prompt);

// Each cue: { t: text to inject, skip: regex — drop cue when the prompt already
// covers this territory (no double-softbox, no second "rule of thirds"). }
const CUES = {
  ad: {
    lighting: [
      { t: 'lit by a large softbox key with a subtle rim light separating the subject', skip: /softbox|rim light|golden[- ]hour|window light|backlit|studio light|diffused daylight|catch-light/i },
      { t: 'warm golden-hour side light with soft natural shadow', skip: /softbox|rim light|golden[- ]hour|window light|backlit|studio light|diffused daylight|catch-light/i },
      { t: 'diffused daylight with gentle falloff and a clean catch-light', skip: /softbox|rim light|golden[- ]hour|window light|backlit|studio light|diffused daylight|catch-light/i },
    ],
    lens: [
      { t: 'shot on an 85mm lens at f/1.8, shallow depth of field, creamy bokeh', skip: /\b\d{2,3}mm\b|bokeh|depth of field|f\/\d/i },
      { t: 'shot on a 50mm lens at f/2.8, crisp subject isolation', skip: /\b\d{2,3}mm\b|bokeh|depth of field|f\/\d/i },
    ],
    texture: [
      { t: 'tactile real-material detail — visible grain, weave, condensation, brushed finishes', skip: /tactile|condensation|material detail|micro-?detail/i },
      { t: 'honest surface detail and natural imperfections, nothing plastic or rendered', skip: /tactile|condensation|material detail|micro-?detail/i },
    ],
    grade: { t: 'editorial commercial photograph, rich natural color, sharp focus on the subject', skip: /editorial commercial|filmic grade|cinematic grade/i },
  },
  photoshoot: {
    lighting: [
      { t: 'three-point studio softbox setup with a seamless lit backdrop', skip: /softbox|rim light|octabox|three-point|window light|studio light|directional light|hair light/i },
      { t: 'large octabox key with gentle wrap and a faint hair light', skip: /softbox|rim light|octabox|three-point|window light|studio light|directional light|hair light/i },
      { t: 'hard directional light with crisp graphic shadow', skip: /softbox|rim light|octabox|three-point|window light|studio light|directional light|hair light/i },
    ],
    lens: [
      { t: 'shot on a 100mm macro lens, fine surface micro-detail', skip: /\b\d{2,3}mm\b|macro|bokeh|depth of field|f\/\d/i },
      { t: 'shot on an 85mm lens at f/2.8, portrait compression, soft bokeh', skip: /\b\d{2,3}mm\b|macro|bokeh|depth of field|f\/\d/i },
    ],
    texture: [
      { t: 'fine material micro-texture resolved edge to edge', skip: /micro-?texture|material detail|tactile/i },
    ],
    grade: { t: 'professional studio photograph, clean true color, high-fidelity detail', skip: /studio photograph|high.fidelity|filmic grade/i },
  },
  hero: {
    lighting: [
      { t: 'atmospheric golden-hour wash with gentle haze and depth', skip: /golden[- ]hour|haze|atmospheric|softbox|window light|directional light/i },
      { t: 'soft directional light with airy atmospheric depth', skip: /golden[- ]hour|haze|atmospheric|softbox|window light|directional light/i },
    ],
    lens: [
      { t: 'shot on a 35mm wide editorial lens, deep layered scene', skip: /\b\d{2,3}mm\b|wide angle|bokeh|depth of field/i },
    ],
    texture: [
      { t: 'layered environmental detail with natural texture', skip: /environmental detail|tactile/i },
    ],
    grade: { t: 'cinematic editorial still, filmic color grade, sharp yet natural', skip: /cinematic|filmic grade/i },
  },
  motion: {
    lighting: [
      { t: 'motivated directional light with cinematic contrast', skip: /motivated|cinematic light|directional light|softbox/i },
    ],
    lens: [
      { t: 'anamorphic 50mm cinematic frame, shallow focus tracking the subject', skip: /anamorphic|\b\d{2,3}mm\b|shallow focus|bokeh/i },
    ],
    texture: [
      { t: 'subtle motion energy in the frame, natural film grain', skip: /motion energy|film grain/i },
    ],
    grade: { t: 'film still pulled from a commercial, cinematic color grade', skip: /film still|cinematic grade/i },
  },
  generic: {
    lighting: [
      { t: 'clean directional light with soft natural falloff', skip: /directional light|softbox|golden[- ]hour|window light/i },
    ],
    lens: [
      { t: 'shot on an 85mm lens at f/2.8, shallow depth of field', skip: /\b\d{2,3}mm\b|bokeh|depth of field|f\/\d/i },
    ],
    texture: [
      { t: 'natural surface detail', skip: /surface detail|tactile|texture/i },
    ],
    grade: { t: 'professional photograph, rich natural color, sharp focus', skip: /professional photograph|editorial|filmic/i },
  },
};

// composition cue is aspect-aware; only 'ad' outputs also get the
// headline-negative-space cue (the DOM overlay needs it — see campaigns.js).
const COMP_WIDE = { t: 'wide cinematic composition with lateral breathing room', skip: /negative space|rule.of.thirds|composition|framing/i };
const COMP_TALL = { t: 'strong vertical composition, subject carried low-center', skip: /negative space|rule.of.thirds|composition|framing/i };
const COMP_RULE = { t: 'rule-of-thirds composition', skip: /negative space|rule.of.thirds|composition|framing/i };
const AD_SPACE = { t: 'clean uncluttered negative space held for a headline overlay', skip: /negative space|headline|overlay/i };
// measured on this box: "unmarked/unlabeled" phrasing kills pseudo-text on
// product surfaces where 'no text' alone failed (guidance=0 → negatives no-op)
const UNMARKED = { t: 'all surfaces plain and unmarked — unlabeled packaging, blank label areas, no visible printing', skip: /unmarked|unlabeled|blank label/i };

function compCue(aspectRatio) {
  if (aspectRatio === '16:9' || aspectRatio === '4:1') return COMP_WIDE;
  if (aspectRatio === '9:16') return COMP_TALL;
  return COMP_RULE;
}

// infer the output kind from what the caller's prompt actually describes —
// callers today don't tag kind, so media.js sniffs it from the brief text.
export function inferKind(prompt, opts = {}) {
  if (opts.kind && CUES[opts.kind]) return opts.kind;
  const p = String(prompt || '');
  if (/\breframe\b|\bextend this image\b|\bedit this image\b|outpaint/i.test(p)) return 'generic';
  if (/video|motion|animate|still pulled|frame this|mid-action|demo/i.test(p)) return 'motion';
  if (/photoshoot|product shot|flat-?lay|macro|studio product/i.test(p)) return 'photoshoot';
  if (/hero|masthead|landing page|website banner|cover image/i.test(p)) return 'hero';
  if (/\bad\b|advert|campaign|editorial/i.test(p)) return 'ad';
  return 'generic';
}

// palette: opts.palette as {primary,secondary,accent} | string[] | string —
// or hexes lifted out of the caller's own prompt. Never invented.
export function extractPalette(prompt, palette) {
  let hexes = [];
  if (palette && typeof palette === 'object' && !Array.isArray(palette)) {
    hexes = [palette.primary, palette.secondary, palette.accent].filter(Boolean);
  } else if (Array.isArray(palette)) {
    hexes = palette.filter(Boolean);
  } else if (typeof palette === 'string') {
    hexes = palette.match(/#[0-9a-fA-F]{3,8}\b/g) || [];
  }
  if (!hexes.length) hexes = String(prompt).match(/#[0-9a-fA-F]{3,8}\b/g) || [];
  return [...new Set(hexes.map((h) => h.toLowerCase()))].slice(0, 4);
}

// enrichPrompt(prompt, {kind, palette, aspectRatio}) -> enriched prompt string.
// Returns the original string untouched when every cue is already covered.
export function enrichPrompt(prompt, opts = {}) {
  const src = String(prompt || '').trim();
  if (!src) return src;
  if (opts.enrich === false) return src;
  if (/shot detail:/i.test(src)) return src; // already enriched — idempotent
  const kind = inferKind(src, opts);
  const bank = CUES[kind] || CUES.generic;
  const parts = [];

  const light = pick(bank.lighting, src);
  if (!has(src, light.skip)) parts.push(light.t);
  const lens = pick(bank.lens, `${src}#lens`);
  if (!has(src, lens.skip)) parts.push(lens.t);
  const comp = compCue(opts.aspectRatio);
  if (!has(src, comp.skip)) parts.push(comp.t);
  if (kind === 'ad' && !has(src, AD_SPACE.skip)) parts.push(AD_SPACE.t);
  if ((kind === 'ad' || kind === 'photoshoot') && !has(src, UNMARKED.skip)) parts.push(UNMARKED.t);
  const tex = pick(bank.texture, `${src}#tex`);
  if (!has(src, tex.skip)) parts.push(tex.t);
  if (bank.grade && !has(src, bank.grade.skip)) parts.push(bank.grade.t);

  // palette hexes: re-state early only when they aren't already near the
  // front (hexes in the tail get truncated away by the 77-token encoder).
  const hexes = extractPalette(src, opts.palette);
  const head = src.slice(0, 200).toLowerCase();
  const early = hexes.filter((h) => !head.includes(h));
  if (early.length) {
    const [a, b, ...rest] = early;
    parts.push(`palette anchored on ${a}${b ? ` and ${b}` : ''}${rest.length ? ` with ${rest.join(', ')} accents` : ''}`);
  }

  if (!parts.length) return src;
  const clause = `Shot detail: ${parts.join(', ')}.`;

  // splice after the first sentence (or first clause for run-ons) so the
  // treatment lands inside the encoder window; short prompts just append.
  const m = /^(.{20,240}?[.!?])(\s|$)/s.exec(src) || /^(.{20,240}?,)(\s)/s.exec(src);
  if (m) return `${m[1]} ${clause} ${src.slice(m[0].length).trim()}`.replace(/\s+/g, ' ').trim();
  return `${src} ${clause}`.replace(/\s+/g, ' ').trim();
}

// Negative prompt for the local backend — keeps the original text-suppression
// list verbatim and extends it with SDXL-class quality/aesthetic guards.
export const LOCALGEN_NEGATIVE = [
  // original text suppression (unchanged — ads composite copy as DOM overlays)
  'text', 'words', 'letters', 'typography', 'logo', 'watermark', 'caption',
  'title', 'signature', 'label', 'font', 'writing', 'alphabet', 'numbers',
  'newspaper', 'magazine', 'book', 'poster', 'packaging', 'signage',
  'billboard', 'screen', 'menu', 'printed',
  // sdxl-class quality guards
  'blurry', 'out of focus', 'lowres', 'low quality', 'jpeg artifacts',
  'oversaturated', 'washed out', 'underexposed', 'overexposed',
  'flat dull lighting', 'plastic skin', 'deformed', 'disfigured',
  'bad anatomy', 'extra limbs', 'duplicate', 'collage', 'border',
  'noise', 'cgi', '3d render', 'illustration', 'cartoon', 'painting', 'sketch',
].join(', ');
