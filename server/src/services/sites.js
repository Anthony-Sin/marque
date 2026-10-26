// marketing site generation/edits — the model writes a copy deck (strict JSON),
// renderSiteHTML owns the layout. Published pages (/s/:slug) are re-rendered
// from the version's `site` snapshot so template polish propagates to live
// sites; legacy versions without a snapshot still serve their stored HTML.
import { chat, chatJSON } from './tensor.js';
import { uid, now, push, update, find, assetAbs } from './store.js';

// The copy-deck contract. The renderer is a fixed editorial template — the
// model's job is words, image picks and section selection, never markup.
const SITE_SYS = `You are the copy chief for a marketing site produced by the Marque studio. A fixed editorial template (hairline rules, display type, generous whitespace) renders the page — you supply the words as strict JSON: {"content":{...},"style":{...}}. No HTML, no markdown, no commentary.
Schema — omit any key you cannot fill well; omitted sections simply do not render:
{
 "content":{
  "navCta":"short top-bar button label",
  "hero":{"kicker":"2-4 word eyebrow","headline":"max 10 words","sub":"1-2 sentence lede","cta":"primary button label","ctaAlt":"secondary link label","image":"one of the provided /assets paths","alt":"alt text"},
  "strip":["3-8 short ticker words/phrases"],
  "story":{"kicker":"eyebrow","headline":"section title","paras":["1-3 paragraphs"],"points":[{"title":"short","text":"one sentence"}],"image":"/assets path or omit"},
  "products":{"kicker":"eyebrow","headline":"section title","sub":"one line"},
  "gallery":{"kicker":"eyebrow","headline":"section title"},
  "taste":{"kicker":"eyebrow","headline":"section title","blurb":"one sentence","names":["only affinity names given in the input"]},
  "cta":{"headline":"closing line","sub":"one sentence","button":"button label"},
  "footer":{"note":"one short line"}
 },
 "style":{"theme":"light|dark|auto","hero":"split|solo|auto"}
}
Rules: only /assets image paths listed in the input — never invent URLs or names; match the brand's tone keywords exactly; the hero headline must carry the strategy/campaign message, not just restate the brand name; keep every string tight — this is editorial copy, not filler.`;

// legacy path — old versions store a full HTML doc; editing one still works
// markup-to-markup so published pages are never stranded by the new renderer.
const SITE_SYS_HTML = `You are an elite web designer for the Marque studio. Return JSON {"html":"..."} — one complete, self-contained HTML document for a marketing site.
Requirements:
- All CSS inline in a <style> block using CSS custom properties built from the brand palette/fonts given. No external CSS/JS frameworks. Google Fonts <link> is allowed.
- Sections: sticky nav, hero with a strong generated tagline + CTA, about/story, products or catalog grid (from the given items), a "taste signature" section that names 3-5 cultural affinities as social proof ("Loved by fans of X, Y"), and a footer.
- Use the brand's real image paths (/assets/...) where provided — never invent URLs; unsplash/placeholder URLs are forbidden.
- Tone of voice must match the brand's tone keywords. Mobile-responsive, generous whitespace, rounded cards.`;

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
// clip: never ship a mid-word cut — snap back to the last word boundary
// (kept ≥60% of the limit so we don't gut copy that starts with one long word)
const clip = (v, n) => {
  const s = String(v ?? '').replace(/\s+/g, ' ').trim();
  if (!s) return null;
  if (s.length <= n) return s;
  const cut = s.slice(0, n);
  const sp = cut.lastIndexOf(' ');
  return (sp >= n * 0.6 ? cut.slice(0, sp) : cut).trimEnd();
};

// ---------------- render-input snapshot ----------------
// Everything the template needs, frozen on the version so a published page
// stays stable even if the profile is later rebuilt. Image paths are
// live-checked — a published page never emits an <img> for a missing file.
function siteInputs(profile, ctx = null) {
  const seen = new Set();
  const images = [];
  const addImg = (path, caption) => { if (path && assetAbs(path) && !seen.has(path)) { seen.add(path); images.push({ path, caption: clip(humanCaption(caption), 90) || '' }); } };
  for (const i of profile?.images || []) addImg(i?.path, i?.caption);
  for (const c of ctx?.campaign?.creatives || []) addImg(c?.image, c?.headline);
  const catalog = (profile?.catalog || [])
    .filter((i) => i?.name)
    .map((i) => ({ name: clip(i.name, 60), description: clip(i.description, 220) || '', price: i.price ?? null, image: i.image && assetAbs(i.image) ? i.image : null }))
    .slice(0, 12);
  const affMap = new Map(); // measured affinities name → best score (for the taste index)
  for (const a of profile?.qloo?.affinities || []) {
    for (const e of a.entities || []) {
      if (!e?.name) continue;
      const cur = affMap.get(e.name);
      const score = Number(e.affinity);
      if (!cur || (Number.isFinite(score) && score > (cur.score ?? -1))) affMap.set(e.name, { name: e.name, score: Number.isFinite(score) ? score : null });
    }
  }
  const affinities = [...affMap.values()].sort((x, y) => (y.score ?? 0) - (x.score ?? 0)).slice(0, 8);
  const links = [];
  const src = profile?.source?.url;
  if (/^https?:\/\//i.test(src || '')) links.push({ label: 'Official site', href: src });
  const ps = ctx?.product?.site;
  if (/^https?:\/\//i.test(ps || '') && ps !== src) links.push({ label: 'Brand site', href: ps });
  const p = profile || {};
  return {
    brand: {
      name: clip(p.name, 60) || '', tagline: clip(p.tagline, 140) || '', description: clip(p.description, 900) || '',
      tone: (p.tone || []).map((t) => clip(t, 30)).filter(Boolean).slice(0, 8),
      values: (p.values || []).map((v) => clip(v, 60)).filter(Boolean).slice(0, 6),
      audience: clip(p.audience, 300) || '',
      colors: p.colors || {}, fonts: p.fonts || {}, images,
    },
    catalog, affinities, links,
  };
}

// ---------------- copy deck: model output → sanitized → merged over fallback ----------------
const ALLOWED_THEMES = new Set(['light', 'dark', 'auto']);
const ALLOWED_HERO = new Set(['split', 'solo', 'auto']);

function cleanContent(raw, inputs) {
  if (!raw || typeof raw !== 'object') return {};
  const okPaths = new Set([...(inputs.brand.images || []).map((i) => i.path), ...inputs.catalog.map((i) => i.image).filter(Boolean)]);
  const img = (v) => (typeof v === 'string' && okPaths.has(v) ? v : null);
  const affSet = new Map(inputs.affinities.map((a) => [a.name.toLowerCase(), a.name]));
  const names = (arr, cap, len) => (Array.isArray(arr) ? arr.map((x) => clip(x, len)).filter(Boolean).slice(0, cap) : []);
  const out = {};
  // CTA fields: an explicit null still means "drop it", but a blocked generic
  // string leaves the key absent so the honest fallback copy fills in
  const ctaField = (o, k, v, n) => { if (v == null) { o[k] = null; return; } const s = ctaCopy(v, n); if (s != null) o[k] = s; };
  if (raw.navCta != null) { const s = ctaCopy(raw.navCta, 24); if (s != null) out.navCta = s; }
  if (raw.hero && typeof raw.hero === 'object') {
    const h = raw.hero;
    out.hero = {
      kicker: clip(h.kicker, 48), headline: clip(h.headline, 120), sub: clip(h.sub, 280),
      image: img(h.image), alt: clip(h.alt, 120) || '',
    };
    ctaField(out.hero, 'cta', h.cta, 30);
    ctaField(out.hero, 'ctaAlt', h.ctaAlt, 30);
  }
  if (Array.isArray(raw.strip)) out.strip = names(raw.strip, 8, 28);
  if (raw.story && typeof raw.story === 'object') {
    const s = raw.story;
    out.story = {
      kicker: clip(s.kicker, 48), headline: clip(s.headline, 90),
      paras: (Array.isArray(s.paras) ? s.paras.map((p) => clip(p, 700)).filter(Boolean).slice(0, 4) : []),
      points: (Array.isArray(s.points) ? s.points.map((p) => ({ title: clip(p?.title, 60), text: clip(p?.text, 240) })).filter((p) => p.title).slice(0, 5) : []),
      image: img(s.image),
    };
  }
  for (const k of ['products', 'gallery']) {
    if (raw[k] && typeof raw[k] === 'object') out[k] = { kicker: clip(raw[k].kicker, 48), headline: clip(raw[k].headline, 90), sub: clip(raw[k].sub, 200) };
  }
  if (raw.taste && typeof raw.taste === 'object') {
    const t = raw.taste;
    // affinity names must come from the measured set — the model may re-case
    // them, but it may not invent new ones
    const picked = (Array.isArray(t.names) ? t.names : []).map((n) => affSet.get(String(n || '').toLowerCase())).filter(Boolean);
    out.taste = { kicker: clip(t.kicker, 48), headline: clip(t.headline, 90), blurb: clip(t.blurb, 220), names: [...new Set(picked)].slice(0, 6) };
  }
  if (raw.cta && typeof raw.cta === 'object') { out.cta = { headline: clip(raw.cta.headline, 120), sub: clip(raw.cta.sub, 220) }; ctaField(out.cta, 'button', raw.cta.button, 30); }
  if (raw.footer && typeof raw.footer === 'object') out.footer = { note: clip(raw.footer.note, 140) };
  return out;
}

function cleanStyle(raw) {
  if (!raw || typeof raw !== 'object') return {};
  const out = {};
  if (ALLOWED_THEMES.has(raw.theme)) out.theme = raw.theme;
  if (ALLOWED_HERO.has(raw.hero)) out.hero = raw.hero;
  return out;
}

// deterministic deck — a publishable page even when the model can't answer.
// Fallback only fills gaps; model copy always wins where it exists.
function contentFallback(inputs, ctx) {
  const b = inputs.brand;
  const camp = ctx?.campaign, strat = ctx?.strategy;
  const hasCat = inputs.catalog.length > 0;
  return {
    navCta: hasCat ? 'Shop' : 'Contact',
    hero: {
      kicker: clip(strat?.title || camp?.title, 48),
      headline: clip(camp?.keyMessage || camp?.title || strat?.title || b.tagline || b.name || 'New from the studio', 120),
      sub: clip((b.description || '').split(/(?<=[.!?])\s+/)[0] || strat?.angle || camp?.angle, 280),
      cta: hasCat ? 'Shop the collection' : 'Our story', ctaAlt: null, image: null, alt: '',
    },
    strip: b.tone.slice(0, 8),
    story: {
      kicker: 'Our story', headline: null,
      paras: b.description ? [b.description] : [],
      points: b.values.slice(0, 4).map((v) => ({ title: v, text: null })),
      image: null,
    },
    products: hasCat ? { kicker: 'Catalog', headline: 'The lineup', sub: null } : null,
    gallery: { kicker: 'In frame', headline: 'Imagery' },
    taste: inputs.affinities.length
      ? { kicker: 'Taste signature', headline: 'Loved by fans of', blurb: `The cultural affinities measured across the people who already love ${b.name || 'the brand'}.`, names: inputs.affinities.slice(0, 6).map((a) => a.name) }
      : null,
    cta: { headline: clip(camp?.keyMessage || strat?.title, 120) || 'See it for yourself.', sub: clip(strat?.angle || camp?.angle, 220), button: hasCat ? 'Shop the collection' : 'Get in touch' },
    footer: { note: clip(b.tagline, 140) },
  };
}

// model deck layered over the fallback — a null model section honors the
// model's choice to drop it; missing keys fall through to fallback copy
function mergeDeck(fallback, model) {
  const out = { ...fallback };
  for (const [k, v] of Object.entries(model || {})) {
    if (v === null) { out[k] = null; continue; }
    if (v && typeof v === 'object' && !Array.isArray(v) && fallback?.[k] && typeof fallback[k] === 'object' && !Array.isArray(fallback[k])) out[k] = { ...fallback[k], ...v };
    else out[k] = v;
  }
  return out;
}

// ---------------- color math — tolerant parse, WCAG contrast ----------------
function rgb(hex) {
  if (typeof hex !== 'string') return null;
  const s = hex.trim();
  let m = s.match(/^#([0-9a-f]{3,8})$/i);
  if (m) {
    let h = m[1];
    if (h.length === 3 || h.length === 4) h = h.slice(0, 3).split('').map((x) => x + x).join('');
    else if (h.length >= 6) h = h.slice(0, 6);
    else return null;
    const n = parseInt(h, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  m = s.match(/^rgba?\(\s*(\d{1,3})[,\s]+(\d{1,3})[,\s]+(\d{1,3})/i);
  return m ? [+m[1], +m[2], +m[3]] : null;
}
const toHex = ([r, g, b]) => '#' + [r, g, b].map((x) => Math.max(0, Math.min(255, Math.round(x))).toString(16).padStart(2, '0')).join('');
const mix = (a, b, t) => { const A = rgb(a), B = rgb(b); return A && B ? toHex(A.map((v, i) => v + (B[i] - v) * t)) : null; };
const lum = (hex) => {
  const c = rgb(hex); if (!c) return null;
  const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
};
const contrast = (a, b) => { const la = lum(a), lb = lum(b); if (la == null || lb == null) return 1; return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05); };
const bestInk = (bg) => (contrast('#181410', bg) >= contrast('#f6f2ea', bg) ? '#181410' : '#f6f2ea');
// move a foreground color toward its ground's best ink until it clears AA
// (+margin) — keeps as much brand hue as readability allows
const liftToContrast = (fg, bg, target = 4.6) => {
  if (!fg || !bg) return fg;
  if (contrast(fg, bg) >= target) return fg;
  const inkV = bestInk(bg);
  for (let t = 0.05; t <= 1.001; t += 0.05) { const m = mix(fg, inkV, t); if (m && contrast(m, bg) >= target) return m; }
  return inkV;
};
// "muted" only earns the name while it still reads — the most blend into the
// ground that still meets AA (plain ink when no blend passes)
const mutedOn = (inkV, bg, blend) => { for (let t = blend; t >= 0; t -= 0.05) { const m = mix(inkV, bg, t); if (m && contrast(m, bg) >= 4.6) return m; } return inkV; };

// a spec is not a price — "12-Pack", "16 oz" and friends must never wear
// price styling. A real price carries a currency mark, a decimals figure,
// an explicit currency code, or the word "free".
const looksLikePrice = (v) => { const s = String(v ?? '').trim(); if (!s) return true; return /[$€£¥₹₩]|\b(?:usd|eur|gbp|jpy|cad|aud|nzd|inr|cny|krw|chf|sek|mxn|brl)\b|\d+[.,]\d{2}\b|^free$/i.test(s); };

// clickbait-empty CTAs the deck contract forbids — a blocked string falls
// back to copy that says what the button actually does
const GENERIC_CTA = /^(learn more|shop now|click here|buy now|read more|find out more|see more|get started|sign up|order now|submit|go)\s*[→›»]?$/i;
const ctaCopy = (v, n) => { const s = clip(v, n); return s && !GENERIC_CTA.test(s) ? s : null; };

// stored captions carry internal provenance — engine names, provider tiers,
// pipeline words — that reads as jargon on a published page (CSS uppercases
// it into an all-caps shout). Segments made only of these tokens are
// stripped; if nothing human remains, the slot falls back to "Fig. N".
const CAP_PROV = new Set(['studio', 'free', 'cloud', 'local', 'remote', 'ai', 'ml', 'api', 'gen', 'generated', 'render', 'rendered', 'engine', 'model', 'sdxl', 'turbo', 'gemini', 'pollinations', 'veo', 'ffmpeg', 'img2img', 'cdn', 'proxy', 'placeholder', 'stock', 'demo', 'test', 'testing', 'kit', 'promote', 'sample', 'scratch', 'tmp', 'draft', 'b64', 'tier', 'provider']);
const allProv = (s) => s.split(/[\s·•|/+_—–-]+/).filter(Boolean).every((t) => CAP_PROV.has(t.toLowerCase()));
const humanCaption = (cap) => {
  let s = String(cap ?? '').replace(/\s+/g, ' ').trim();
  if (!s) return null;
  // "(sdxl)" / "(via pollinations)"-style engine parentheticals
  s = s.replace(/\(([^()]*)\)/g, (m, inner) => { const toks = inner.replace(/^(via|by|using|with|from|on)\s+/i, ''); return allProv(toks) ? ' ' : m; }).replace(/\s+/g, ' ').trim();
  // "·"-separated provenance segments — "free · studio", "hero · local"
  const kept = s.split(/\s*[·•|]\s*/).map((x) => x.trim()).filter((p) => p && !allProv(p));
  s = kept.join(' · ').trim();
  return s && !allProv(s) ? s : null;
};

const SYSFONTS = new Set(['serif', 'sans-serif', 'monospace', 'system-ui', 'georgia', 'helvetica', 'arial', 'times new roman', 'courier', 'courier new', 'verdana', 'tahoma', 'trebuchet ms', 'ui-sans-serif', 'ui-serif', 'ui-monospace', 'inherit']);
const fontName = (v) => String(v || '').replace(/['"\\;{}()<>]/g, '').trim().slice(0, 60) || null;
const googleFont = (v) => { const n = fontName(v); return n && !SYSFONTS.has(n.toLowerCase()) ? n : null; };

// ---------------- the template ----------------
// One function in, one document out. Every section is conditional on real
// data — nothing publishes an empty shell.
export function renderSiteHTML(site) {
  const brand = site?.brand || {};
  const c = brand.colors || {};
  const f = brand.fonts || {};
  const content = site?.content || {};
  const style = site?.style || {};
  const catalog = (site?.catalog || []).filter((i) => i?.name);
  const links = (site?.links || []).filter((l) => /^https?:\/\//i.test(l?.href || ''));
  const name = brand.name || 'The Brand';

  // palette → tokens (light/dark resolved from the real background color)
  let bg = rgb(c.background) ? c.background : '#faf8f4';
  let dark = (lum(bg) ?? 1) < 0.45;
  if (style.theme === 'dark' && !dark) { bg = '#14110e'; dark = true; }
  if (style.theme === 'light' && dark) { bg = '#faf8f4'; dark = false; }
  const ink = rgb(c.text) && contrast(c.text, bg) >= 3 ? c.text : bestInk(bg);
  // "muted" must still read — mutedOn keeps the quietest blend that clears AA
  const mut = mutedOn(ink, bg, 0.48);
  const line = mix(bg, ink, 0.14) || (dark ? '#333026' : '#ded9cd');
  // a surface token only earns its slot when it's subtly distinct AND keeps
  // the page polarity — a light surface on a dark theme would leave ink-colored
  // text on a cream card (the contrast check alone can't see that)
  const sf = rgb(c.surface) && contrast(c.surface, bg) > 1.04 && ((lum(c.surface) ?? 1) < 0.5) === dark ? c.surface : (mix(bg, ink, 0.05) || bg);
  const accent = rgb(c.accent) ? c.accent : (rgb(c.primary) ? c.primary : '#9a4b1f');
  const accInk = bestInk(accent);
  // accent worn as small text needs its own token — the raw hue only survives
  // when it genuinely reads on the page ground (chips/labels, same contract
  // as solid accent + acc-ink pairs)
  const accText = liftToContrast(accent, bg);
  // the inverted band prefers the brand primary; it only falls back to ink
  // when primary would sit too close to the page background to read as a band
  const band = rgb(c.primary) && contrast(c.primary, bg) >= 1.35 ? c.primary : ink;
  const bandInk = bestInk(band);
  const bandMut = mutedOn(bandInk, band, 0.5);
  const bandLine = mix(band, bandInk, 0.3) || line;

  // fonts — Google Fonts <link> only for real family names (same external
  // allowance the generated docs already used); system stack otherwise
  const gf = [...new Set([f.heading, f.body].map(googleFont).filter(Boolean))];
  const fontsLink = gf.length
    ? `<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link href="https://fonts.googleapis.com/css2?${gf.map((n) => `family=${encodeURIComponent(n).replace(/%20/g, '+')}:wght@400;500;600;700;800`).join('&')}&display=swap" rel="stylesheet">`
    : '';
  const fd = fontName(f.heading) ? `'${fontName(f.heading)}',Georgia,'Times New Roman',serif` : `Georgia,'Times New Roman',serif`;
  const fb = fontName(f.body) ? `'${fontName(f.body)}',system-ui,-apple-system,'Segoe UI',Arial,sans-serif` : `system-ui,-apple-system,'Segoe UI',Helvetica,Arial,sans-serif`;

  // image pool — snapshot paths re-checked live so a deleted asset never 404s
  const okImg = (p) => typeof p === 'string' && p.startsWith('/assets/') && !!assetAbs(p);
  const pool = [];
  const seen = new Set();
  const addPool = (p, caption) => { if (okImg(p) && !seen.has(p)) { seen.add(p); pool.push({ path: p, caption: humanCaption(caption) || '' }); } };
  for (const i of brand.images || []) addPool(i?.path, i?.caption);
  for (const i of catalog) addPool(i?.image, i?.name);

  // section decisions — resolve what's actually rendering before emitting
  const hero = content.hero || {};
  let heroImg = hero.image && okImg(hero.image) ? { path: hero.image, caption: hero.alt || pool.find((p) => p.path === hero.image)?.caption || '' } : null;
  if (!heroImg && style.hero !== 'solo' && pool.length) heroImg = pool[0];
  const heroSplit = heroImg && style.hero !== 'solo';

  const strip = (content.strip?.length ? content.strip : brand.tone || []).slice(0, 8);
  // marquee needs ≥2 identical halves wide enough to cover the viewport —
  // estimate ~14px/char at this tracking and force an even repeat count
  const stripTxt = strip.join(' · ');
  const mqReps = Math.max(4, 2 * Math.ceil(300 / Math.max(stripTxt.length, 1)));
  const mqRow = (strip.map((t) => `<span>${esc(t)}</span>`).join('<i>·</i>') + '<i>·</i>').repeat(mqReps);

  const story = content.story || {};
  const storyParas = (story.paras || []).filter(Boolean);
  const storyPoints = (story.points || []).filter((p) => p?.title);
  let storyImg = story.image && okImg(story.image) && story.image !== heroImg?.path ? pool.find((p) => p.path === story.image) || { path: story.image, caption: '' } : null;
  let galleryImgs = pool.filter((i) => i.path !== heroImg?.path && i.path !== storyImg?.path).slice(0, 4);
  if (!storyImg && galleryImgs.length === 1) storyImg = galleryImgs.pop(); // lone leftover image earns a place in the story column
  const storyOn = !!(story.headline || storyParas.length || storyPoints.length || storyImg);
  // catalog renders as photo cards + a ruled spec index for image-less items —
  // two deliberate anatomies instead of fake placeholder art
  // an image already anchoring the hero/story must not reappear as a product
  // photo — recycled art reads instantly as template reuse
  const imgUsed = (p) => !p || p === heroImg?.path || p === storyImg?.path;
  const catImg = catalog.filter((it) => it.image && okImg(it.image) && !imgUsed(it.image));
  const catTx = catalog.filter((it) => !(it.image && okImg(it.image) && !imgUsed(it.image)));
  const productsOn = catalog.length > 0 && content.products !== null; // an explicit products:null drops the shop even with a catalog on file
  const galleryOn = galleryImgs.length >= 2 && !!(content.gallery !== null);
  const taste = content.taste || null;
  const tasteNames = (taste?.names || []).filter(Boolean);
  const affScores = new Map((site?.affinities || []).map((a) => [String(a?.name || '').toLowerCase(), a?.score]));
  const tasteOn = !!(taste && (taste.headline || tasteNames.length) && tasteNames.length);
  const cta = content.cta || {};
  const ctaOn = !!(cta.headline || cta.button);

  // nav only lists sections that exist — no dead anchors
  const secs = [];
  if (storyOn) secs.push({ id: 'story', label: 'Story' });
  if (productsOn) secs.push({ id: 'products', label: 'Catalog' });
  if (galleryOn) secs.push({ id: 'gallery', label: 'Gallery' });
  if (tasteOn) secs.push({ id: 'taste', label: 'Taste' });
  // hero meta line — a real section index when sections exist, honest
  // issue-style chrome when the page is too thin to index
  const hmetaItems = secs.length ? secs.map((s) => s.label) : (ctaOn ? ['Contact'] : ['Vol. 01', String(new Date().getFullYear())]);
  const navLinks = secs.map((s) => `<a href="#${s.id}">${esc(s.label)}</a>`).join('');
  const ctaHref = links[0]?.href || (productsOn ? '#products' : (ctaOn ? '#cta' : '#hero'));
  const heroGhost = hero.ctaAlt ? `<a class="arr" href="#${secs[0]?.id || 'cta'}">${esc(hero.ctaAlt)} <i>→</i></a>` : '';
  const navCta = content.navCta ? `<a class="btn-o" href="${esc(ctaHref)}">${esc(content.navCta)}</a>` : '';
  const mnav = secs.length ? `<details class="mnav"><summary>Menu</summary><nav>${navLinks}${ctaOn ? '<a href="#cta">Contact</a>' : ''}</nav></details>` : '';

  // eyebrow — hairline tick + tracked caps (numbering stays on the semantic
  // lists only: process steps and the ranked taste index)
  const kick = (text, cls = '') => `<div class="kick ${cls}"><i></i>${text ? `<span>${esc(text)}</span>` : ''}</div>`;

  const fig = (img, cls = '') => img ? `<figure class="${cls}"><img src="${esc(img.path)}" alt="${esc(img.caption || '')}" loading="lazy">${img.caption ? `<figcaption><span>${esc(img.caption)}</span></figcaption>` : ''}</figure>` : '';
  // spec copy (pack size, volume) never wears price styling — a real price
  // gets the tracked-caps slot, a spec gets plain muted text
  const priceSlot = (v) => {
    const s = String(v ?? '').trim();
    if (!s) return '<span></span>';
    return looksLikePrice(s) ? `<span class="price">${esc(s)}</span>` : `<span class="pspec">${esc(s)}</span>`;
  };

  const heroHtml = `
  <section id="hero" class="panel hp"><header class="hero ${heroSplit ? 'split' : 'solo'}"><div class="wrap ${heroSplit ? 'grid' : ''}">
    <div class="h-copy">
      <div class="h-core">
      ${hero.kicker ? `<div class="kick ${heroSplit ? '' : 'center'}"><i></i><span>${esc(hero.kicker)}</span></div>` : ''}
      <h1 class="${(() => { const t = hero.headline || brand.tagline || name || ''; return t.length > 90 ? 'hl-long' : t.length > 58 ? 'hl-mid' : ''; })()}">${esc(hero.headline || brand.tagline || name)}</h1>
      ${hero.sub ? `<p class="lede">${esc(hero.sub)}</p>` : ''}
      <div class="acts">${hero.cta ? `<a class="btn" href="${esc(ctaHref)}">${esc(hero.cta)}</a>` : ''}${heroGhost}</div>
      </div>
      ${heroSplit ? `<div class="hmeta"><span class="hm-k">${secs.length ? 'In this issue' : esc(name)}</span>${hmetaItems.map((s) => `<span>${esc(s)}</span>`).join('<i>/</i>')}</div>` : ''}
    </div>
    ${heroSplit ? fig(heroImg, 'h-img') : ''}
  </div></header>
  ${strip.length >= 2 ? `<div class="strip"><div class="mq"><div class="mq-in">${mqRow}</div></div></div>` : ''}</section>`;

  const storyHtml = storyOn ? `
  <section id="story" class="sec panel"><div class="wrap s-grid">
    <div class="s-head">${kick(story.kicker)}${story.headline ? `<h2>${esc(story.headline)}</h2>` : ''}</div>
    <div class="s-body">
      ${storyImg ? fig(storyImg, 's-img') : ''}
      ${storyParas.map((p, i) => `<p${i === 0 ? ' class="first"' : ''}>${esc(p)}</p>`).join('')}
      ${storyPoints.length ? `<ol class="steps">${storyPoints.map((p, i) => `<li><span class="n">${String(i + 1).padStart(2, '0')}</span><div><h3>${esc(p.title)}</h3>${p.text ? `<p>${esc(p.text)}</p>` : ''}</div></li>`).join('')}</ol>` : ''}
    </div>
  </div></section>` : '';

  const productsHtml = productsOn ? `
  <section id="products" class="sec panel"><div class="wrap">
    <div class="phead"><div>${kick(content.products?.kicker)}${content.products?.headline ? `<h2>${esc(content.products.headline)}</h2>` : ''}</div>${content.products?.sub ? `<p class="sub">${esc(content.products.sub)}</p>` : ''}</div>
    ${catImg.length === 1 && catTx.length ? '<div class="psplit">' : ''}
    ${catImg.length ? `<div class="pgrid hscroll">${catImg.map((it) => `
      <article class="pcell">
        <img class="ph" src="${esc(it.image)}" alt="${esc(it.name)}" loading="lazy">
        <h3>${esc(it.name)}</h3>
        ${it.description ? `<p class="pd">${esc(it.description)}</p>` : ''}
        <div class="pfoot">${priceSlot(it.price)}<span class="arr2">→</span></div>
      </article>`).join('')}
    </div>` : ''}
    ${catTx.length ? `<ol class="plist"${catImg.length > 1 ? ' style="margin-top:2.4rem"' : ''}>${catTx.map((it, i) => `
      <li class="prow"><span class="n">${String(i + 1).padStart(2, '0')}</span><div class="pr"><h3>${esc(it.name)}</h3>${it.description ? `<p class="pd">${esc(it.description)}</p>` : ''}</div>${priceSlot(it.price)}<span class="arr2">→</span></li>`).join('')}
    </ol>` : ''}
    ${catImg.length === 1 && catTx.length ? '</div>' : ''}
  </div></section>` : '';

  const galleryHtml = galleryOn ? `
  <section id="gallery" class="sec panel"><div class="wrap">
    <div class="phead"><div>${kick(content.gallery?.kicker)}${content.gallery?.headline ? `<h2>${esc(content.gallery.headline)}</h2>` : ''}</div></div>
    <div class="g-grid hscroll n${galleryImgs.length}">${galleryImgs.map((im, i) => `
      <figure class="${i === 0 && galleryImgs.length === 3 ? 'wide' : ''}"><img src="${esc(im.path)}" alt="${esc(im.caption || '')}" loading="lazy"><figcaption><span>Fig. ${String(i + 1).padStart(2, '0')}</span><span>${esc(im.caption || '')}</span></figcaption></figure>`).join('')}
    </div>
  </div></section>` : '';

  const tasteHtml = tasteOn ? `
  <section id="taste" class="band panel"><div class="wrap">
    ${kick(taste.kicker, 'onband')}
    ${taste.headline ? `<h2>${esc(taste.headline)}</h2>` : ''}
    ${taste.blurb ? `<p class="b-lede">${esc(taste.blurb)}</p>` : ''}
    <ol class="idx"><li class="ihd"><span class="n"></span><span>Ranked affinity</span><span class="sc"><i></i><b>Score</b></span></li>${tasteNames.map((n, i) => { const sc = affScores.get(String(n).toLowerCase()); return `<li><span class="n">${String(i + 1).padStart(2, '0')}</span><span class="nm">${esc(n)}</span>${sc != null ? `<span class="sc"><i><u style="width:${Math.max(6, Math.min(100, Math.round(sc <= 1 ? sc * 100 : sc)))}%"></u></i><b>${Math.round(sc <= 1 ? sc * 100 : sc)}</b></span>` : `<span class="sc"></span>`}</li>`; }).join('')}</ol>
  </div></section>` : '';

  const ctaHtml = ctaOn ? `
  <section id="cta" class="cta panel ${tasteOn ? '' : 'band'}"><div class="wrap">
    ${cta.headline ? `<h2>${esc(cta.headline)}</h2>` : ''}
    ${cta.sub ? `<p>${esc(cta.sub)}</p>` : ''}
    <div class="acts">${cta.button ? `<a class="btn" href="${esc(ctaHref)}">${esc(cta.button)}</a>` : ''}</div>
  </div></section>` : '';

  const year = new Date().getFullYear();
  const desc = clip(hero.sub || brand.description || brand.tagline, 180) || '';
  const footerLinks = links.length ? `<div class="fcol"><h4>Elsewhere</h4>${links.map((l) => `<a href="${esc(l.href)}" rel="noopener">${esc(l.label || l.href)}</a>`).join('')}</div>` : '';
  const indexCol = secs.length ? `<div class="fcol"><h4>Index</h4>${secs.map((s) => `<a href="#${s.id}">${esc(s.label)}</a>`).join('')}</div>` : '';
  const fcols = [indexCol, footerLinks].filter(Boolean).length;

  // deck chrome — one dot per panel (mirror of the track order: hero → secs →
  // cta → colophon) plus a hairline progress rail under the nav; both are
  // hidden on mobile and updated by the inline script
  const dotSecs = [{ id: 'hero', label: 'Intro' }, ...secs, ...(ctaOn ? [{ id: 'cta', label: 'Contact' }] : []), { id: 'end', label: 'Colophon' }];
  const deckChrome = `<nav class="dots" aria-label="Panels">${dotSecs.map((d) => `<a href="#${d.id}"><span>${esc(d.label)}</span></a>`).join('')}</nav><div class="prog" aria-hidden="true"><i></i></div>`;

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(name)}${brand.tagline ? ` — ${esc(brand.tagline)}` : ''}</title>
${desc ? `<meta name="description" content="${esc(desc)}"><meta property="og:title" content="${esc(name)}"><meta property="og:description" content="${esc(desc)}">${heroImg ? `<meta property="og:image" content="${esc(heroImg.path)}">` : ''}` : ''}
${fontsLink}
<style>
:root{--bg:${bg};--ink:${ink};--mut:${mut};--line:${line};--sf:${sf};--acc:${accent};--acc-ink:${accInk};--acc-text:${accText};--band:${band};--band-ink:${bandInk};--band-mut:${bandMut};--band-line:${bandLine};--fd:${fd};--fb:${fb};--navh:3.5rem}
*{box-sizing:border-box;margin:0;padding:0}
html{scroll-behavior:smooth;scroll-padding-top:calc(var(--navh) + .8rem);height:100%}
body{background:var(--bg);color:var(--ink);font:400 1rem/1.7 var(--fb);-webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility;display:flex;flex-direction:column;min-height:100vh;min-height:100dvh}
img{display:block;max-width:100%}
a{color:inherit}
h1,h2,h3{font-family:var(--fd);font-weight:500;line-height:1.05;letter-spacing:-.015em}
::selection{background:var(--acc);color:var(--acc-ink)}
.wrap{max-width:1280px;margin:0 auto;padding-inline:clamp(1.25rem,4vw,3.5rem)}
.kick{display:flex;align-items:center;gap:.85rem;font:600 .72rem/1.2 var(--fb);letter-spacing:.3em;text-transform:uppercase;color:var(--mut);flex-wrap:wrap}
.kick i{width:2.2rem;height:1px;background:var(--acc);flex:none}
.kick.center{justify-content:center}
.kick.onband{color:var(--band-mut)}
.kick.onband i{background:var(--band-ink)}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:.6rem;background:var(--acc);color:var(--acc-ink);text-decoration:none;font:600 .73rem/1 var(--fb);letter-spacing:.22em;text-transform:uppercase;padding:1.05rem 1.75rem;border-radius:2px;transition:opacity .2s,transform .2s;white-space:nowrap}
.btn:hover{opacity:.87;transform:translateY(-1px)}
.btn-sm{padding:.8rem 1.2rem;font-size:.68rem}
.btn-o{display:inline-flex;align-items:center;gap:.5rem;text-decoration:none;font:600 .68rem/1 var(--fb);letter-spacing:.22em;text-transform:uppercase;padding:.75rem 1.15rem;border:1px solid var(--line);color:var(--ink);border-radius:2px;white-space:nowrap;transition:border-color .2s,color .2s}
.btn-o:hover{border-color:var(--acc);color:var(--acc)}
.band .btn{background:var(--band-ink);color:var(--band)}
.arr{display:inline-flex;align-items:center;gap:.4rem;text-decoration:none;font:600 .74rem/1 var(--fb);letter-spacing:.2em;text-transform:uppercase;color:var(--ink);border-bottom:1px solid var(--acc);padding-bottom:.4rem}
.arr i{font-style:normal;color:var(--acc)}
.arr:hover{color:var(--acc)}
.top{position:sticky;top:0;z-index:60;flex:none;border-bottom:1px solid var(--line);background:color-mix(in srgb,var(--bg) 88%,transparent);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px)}
.top .wrap{display:flex;align-items:center;gap:1.5rem;min-height:var(--navh)}
.mark{font-family:var(--fd);font-size:1.2rem;letter-spacing:.01em;text-decoration:none;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:46vw}
.tnav{display:flex;gap:1.8rem;margin-left:auto;align-items:center}
.tnav a{font-size:.73rem;letter-spacing:.22em;text-transform:uppercase;text-decoration:none;color:var(--mut);padding-block:.5rem}
.tnav a:hover{color:var(--ink)}
.mnav{display:none;position:relative;margin-left:auto}
.mnav summary{list-style:none;cursor:pointer;font-size:.72rem;letter-spacing:.24em;text-transform:uppercase;padding:.6rem 0;color:var(--ink)}
.mnav summary::-webkit-details-marker{display:none}
.mnav nav{position:absolute;right:0;top:calc(100% + .6rem);background:var(--bg);border:1px solid var(--line);min-width:13rem;box-shadow:0 18px 40px rgba(0,0,0,.14)}
.mnav nav a{display:block;padding:.95rem 1.15rem;border-top:1px solid var(--line);text-decoration:none;font-size:.72rem;letter-spacing:.22em;text-transform:uppercase}
.mnav nav a:first-child{border-top:0}
.hero{padding-block:clamp(3.5rem,8vw,7.5rem) clamp(4rem,8vw,7rem)}
.hero .grid{display:grid;grid-template-columns:1.08fr .92fr;gap:clamp(2.5rem,6vw,5.5rem);align-items:center}
.hero.solo{text-align:center}
.hero.solo .h-copy{max-width:56rem;margin:0 auto}
.hero h1{font-size:clamp(2.6rem,6.6vw,5.4rem);line-height:1.0;letter-spacing:-.02em;margin-top:1.7rem}
.hero.solo h1{margin-inline:auto}
.lede{font-size:clamp(1.03rem,1.5vw,1.28rem);line-height:1.65;color:var(--mut);max-width:33em;margin-top:1.5rem}
.hero.solo .lede{margin-inline:auto}
.acts{display:flex;align-items:center;gap:1.6rem;margin-top:2.5rem;flex-wrap:wrap}
.hero.solo .acts{justify-content:center}
.hero.split .h-copy{display:flex;flex-direction:column;align-self:stretch;justify-content:center}
.hero.split .h-core{margin:auto 0}
.hmeta{padding-top:3.2rem;display:flex;align-items:baseline;gap:.75rem;flex-wrap:wrap;font-size:.7rem;letter-spacing:.26em;text-transform:uppercase;color:var(--mut)}
.hmeta .hm-k{color:var(--acc-text)}
.hmeta span{white-space:nowrap}
.hmeta i{font-style:normal;opacity:.5}
figure{margin:0}
.h-img img{width:100%;aspect-ratio:4/5;object-fit:cover}
figcaption{display:flex;justify-content:space-between;gap:1rem;border-top:1px solid var(--line);margin-top:.9rem;padding-top:.75rem;font-size:.74rem;letter-spacing:.16em;text-transform:uppercase;color:var(--mut)}
.strip{border-block:1px solid var(--line);padding-block:1.05rem;overflow:hidden}
.mq{display:flex}
.mq-in{display:flex;align-items:center;gap:1.8rem;white-space:nowrap;animation:mq 46s linear infinite;will-change:transform}
.mq span{font-size:.76rem;letter-spacing:.3em;text-transform:uppercase;color:var(--mut)}
.mq i{color:var(--acc);font-style:normal}
@keyframes mq{to{transform:translateX(-50%)}}
@media (prefers-reduced-motion:reduce){.mq-in{animation:none;transform:none}}
.sec{padding-block:clamp(4.5rem,9vw,8.5rem)}
.s-grid{display:grid;grid-template-columns:minmax(0,5fr) minmax(0,7fr);gap:clamp(2rem,5vw,5rem);align-items:start}
h2{font-size:clamp(2.05rem,4.4vw,3.4rem);margin-top:1.5rem}
.s-body>p{margin-top:1.1em;max-width:44em}
.s-body>p.first{font-size:clamp(1.15rem,1.8vw,1.4rem);line-height:1.6;color:var(--ink);margin-top:0}
.s-img{margin-bottom:2.2rem}
.s-img img{width:100%;aspect-ratio:4/3;object-fit:cover}
.steps{list-style:none;margin-top:2.8rem;border-top:1px solid var(--line)}
.steps li{display:grid;grid-template-columns:3.4rem 1fr;gap:1.2rem;padding:1.55rem 0;border-bottom:1px solid var(--line)}
.steps .n{font-family:var(--fd);font-size:1.05rem;color:var(--acc-text);padding-top:.25rem}
.steps h3{font-size:1.3rem;letter-spacing:-.01em}
.steps p{color:var(--mut);font-size:.95rem;max-width:44em;margin-top:.4rem}
.phead{display:flex;align-items:flex-end;justify-content:space-between;gap:2rem;margin-bottom:clamp(2.4rem,5vw,3.8rem)}
.phead .sub{max-width:23rem;color:var(--mut);font-size:.95rem;line-height:1.6;padding-bottom:.3rem}
.pgrid{display:grid;grid-template-columns:repeat(auto-fit,minmax(15.5rem,22rem));width:fit-content;max-width:100%;border:1px solid var(--line);border-width:1px 0 0 1px}
.pcell{background:var(--bg);padding:1.5rem;border-right:1px solid var(--line);border-bottom:1px solid var(--line);display:flex;flex-direction:column;gap:.85rem}
.ph{width:100%;aspect-ratio:4/5;object-fit:cover}
.psplit{display:grid;grid-template-columns:minmax(16rem,21rem) minmax(0,1fr);gap:clamp(2rem,4.5vw,4rem);align-items:stretch}
.psplit .plist{border-top:0;height:100%;display:flex;flex-direction:column}
.psplit .prow{flex:1;align-items:center}
.plist{list-style:none;border-top:1px solid var(--line)}
.prow{display:flex;align-items:baseline;gap:1.6rem;padding:1.35rem 0;border-bottom:1px solid var(--line)}
.prow .n{font-size:.74rem;letter-spacing:.22em;color:var(--acc-text);min-width:2.6rem}
.prow .pr{flex:1;min-width:0}
.prow h3{font-size:1.3rem}
.prow .pd{margin-top:.3rem}
.prow .price{white-space:nowrap}
.pcell h3{font-size:1.28rem;line-height:1.15}
.pd{color:var(--mut);font-size:.92rem;line-height:1.6}
.pfoot{margin-top:auto;display:flex;align-items:center;justify-content:space-between;border-top:1px solid var(--line);padding-top:.85rem;min-height:2.4rem}
.price{font-size:.74rem;letter-spacing:.2em;text-transform:uppercase}
.pspec{font-size:.88rem;color:var(--mut)}
.pfoot .pspec,.prow .pspec{white-space:nowrap}
.arr2{color:var(--acc);font-size:1.05rem;line-height:1}
.g-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:clamp(1.2rem,3.5vw,3rem)}
.g-grid figure:nth-child(even){margin-top:clamp(1.6rem,5vw,4.5rem)}
.g-grid img{width:100%;aspect-ratio:4/5;object-fit:cover}
.g-grid figure.wide{grid-column:1/-1;margin-top:0}
.g-grid figure.wide img{aspect-ratio:16/9}
.band{background:var(--band);color:var(--band-ink)}
.band .wrap{padding-block:clamp(4.5rem,9vw,8rem)}
.band h2{color:var(--band-ink)}
.b-lede{color:var(--band-mut);max-width:40em;margin-top:1.2rem;font-size:clamp(1rem,1.4vw,1.15rem)}
.idx{list-style:none;margin-top:clamp(2.2rem,4vw,3.5rem);border-top:1px solid var(--band-line)}
.idx .ihd{padding:.7rem 0 1.1rem;font-size:.66rem;letter-spacing:.26em;text-transform:uppercase;color:var(--band-mut)}
.idx .ihd .sc i{display:none}
.idx li{display:flex;align-items:baseline;gap:1.6rem;padding:1.3rem 0;border-bottom:1px solid var(--band-line)}
.idx .n{font-size:.74rem;letter-spacing:.22em;color:var(--band-mut);min-width:2.8rem}
.idx .nm{font-family:var(--fd);font-size:clamp(1.5rem,3.4vw,2.7rem);line-height:1.08}
.idx .sc{margin-left:auto;display:flex;align-items:center;gap:.7rem;font-size:.82rem;letter-spacing:.08em;color:var(--band-mut);font-variant-numeric:tabular-nums}
.idx .sc i{display:block;width:clamp(5rem,11vw,9rem);height:4px;background:var(--band-line)}
.idx .sc u{display:block;height:100%;background:var(--band-ink)}
.idx .sc b{font-weight:600;min-width:2.2rem;text-align:right}
.cta{text-align:center;background:var(--sf);border-block:1px solid var(--line)}
.cta .wrap{padding-block:clamp(4.5rem,10vw,8rem)}
.cta h2{font-size:clamp(2.3rem,5.6vw,4.3rem);margin-top:0}
.cta.band{background:var(--band);color:var(--band-ink);border-block:0}
.cta.band h2{color:var(--band-ink)}
.cta p{color:var(--mut);max-width:36em;margin:1.3rem auto 0}
.cta.band p{color:var(--band-mut)}
.cta .acts{justify-content:center}
.foot{border-top:1px solid var(--line)}
.foot .wrap{padding-block:clamp(3.5rem,7vw,5.5rem) 1.6rem}
.fgrid{display:grid;gap:clamp(2rem,5vw,4rem)}
.fgrid.c0{grid-template-columns:1fr}
.fgrid.c0 .fnote{margin-inline:0}
.fgrid.c1{grid-template-columns:minmax(0,1.5fr) minmax(0,1fr)}
.fgrid.c2{grid-template-columns:minmax(0,1.5fr) minmax(0,1fr) minmax(0,1fr)}
.fmark{font-family:var(--fd);font-size:clamp(1.9rem,3.4vw,2.9rem);line-height:1.05;letter-spacing:-.015em}
.fnote{color:var(--mut);font-size:.92rem;max-width:26em;margin-top:1.1rem}
.ftone{display:flex;align-items:center;gap:.9rem;flex-wrap:wrap;margin-top:1.4rem}
.ftone span{font-size:.68rem;letter-spacing:.26em;text-transform:uppercase;color:var(--mut)}
.ftone i{color:var(--acc);font-style:normal}
.fcol h4{font:600 .68rem/1 var(--fb);letter-spacing:.28em;text-transform:uppercase;color:var(--mut);margin-bottom:1.05rem}
.fcol a{display:block;text-decoration:none;padding:.38rem 0;font-size:.95rem}
.fcol a:hover{color:var(--acc)}
.fbase{display:flex;justify-content:space-between;gap:.8rem;flex-wrap:wrap;border-top:1px solid var(--line);margin-top:clamp(2.5rem,5vw,4rem);padding-top:1.3rem;font-size:.73rem;letter-spacing:.14em;color:var(--mut)}
/* ---- deck mode (≥721px): the page becomes a horizontal reel of full-viewport
   panels — the body never scrolls vertically; .track carries x-scroll-snap ---- */
.dots,.prog{display:none}
@media (min-width:721px){
  html,body{height:100%;overflow:hidden}
  .track{flex:1;min-height:0;display:flex;overflow-x:auto;overflow-y:hidden;scroll-snap-type:x mandatory;scroll-behavior:smooth;scroll-padding-left:0;scrollbar-width:thin;scrollbar-color:var(--mut) transparent}
  .panel{flex:none;width:100vw;min-width:100vw;height:100%;scroll-snap-align:start;scroll-snap-stop:always;display:flex;flex-direction:column;overflow-x:hidden;overflow-y:auto;scrollbar-width:thin}
  .panel+.panel{border-left:1px solid var(--line)}
  /* right pad clears the fixed .dots rail + its hover labels */
  .panel>.wrap{width:100%;margin-top:auto;margin-bottom:auto;padding-right:clamp(5rem,8vw,8.5rem)}
  .panel.sec{padding-block:0}
  .sec.panel>.wrap,.band.panel>.wrap,.cta.panel>.wrap,.foot.panel>.wrap{padding-block:clamp(1.4rem,4vh,3rem)}
  .foot.panel{border-top:0}
  .hp .hero{flex:1;min-height:0;padding-block:clamp(1.2rem,3.5vh,3rem);display:flex;flex-direction:column;overflow-y:auto;scrollbar-width:thin}
  .hp .hero .wrap{width:100%;margin-top:auto;margin-bottom:auto}
  .hp .strip{flex:none}
  .panel .hero h1{font-size:clamp(2.9rem,6.8vw,6.8rem)}
  .panel .hero h1.hl-mid{font-size:clamp(2.4rem,5.4vw,5.2rem)}
  .panel .hero h1.hl-long{font-size:clamp(1.9rem,4.2vw,4rem)}
  .panel .lede{margin-top:1.2rem}
  .panel .acts{margin-top:clamp(1.4rem,3.5vh,2.4rem)}
  .panel .hmeta{padding-top:clamp(1.4rem,4vh,3rem)}
  .hp .h-img img{height:min(58vh,34rem);height:min(58dvh,34rem);aspect-ratio:auto;width:100%;object-fit:cover}
  .panel .phead{margin-bottom:clamp(1.2rem,3vh,2.2rem)}
  .panel .pgrid{display:flex;width:auto;max-width:none;overflow-x:auto;scrollbar-width:thin;padding-bottom:.5rem}
  .panel .pcell{flex:1 0 auto;min-width:clamp(13.5rem,17vw,18rem);padding:1.2rem}
  .panel .ph{height:clamp(10rem,26vh,16rem);aspect-ratio:auto}
  .panel .pcell h3{font-size:1.15rem}
  .panel .pd{font-size:.88rem}
  .panel .pfoot{padding-top:.7rem;min-height:2.2rem}
  .panel .prow{padding:1.05rem 0}
  .panel .psplit{align-items:start}
  .panel .steps{margin-top:clamp(1.2rem,2.6vh,2rem)}
  .panel .steps li{padding:.8rem 0}
  .panel .s-body>p{margin-top:.9em}
  .panel .s-body>p.first{font-size:clamp(1.05rem,1.6vw,1.25rem)}
  .panel .s-img{margin-bottom:1.2rem}
  .panel .s-img img{max-height:22vh;aspect-ratio:auto;width:100%;object-fit:cover}
  .panel .g-grid{display:flex;gap:clamp(1rem,2.5vw,2rem);overflow-x:auto;scrollbar-width:thin;padding-bottom:.5rem}
  .panel .g-grid figure{flex:1 0 auto;min-width:clamp(13rem,17vw,18rem);margin-top:0}
  .panel .g-grid figure.wide{min-width:clamp(19rem,30vw,30rem);flex-grow:1.6}
  .panel .g-grid img{width:100%;height:clamp(14rem,50vh,27rem);aspect-ratio:auto;object-fit:cover}
  .panel .idx{margin-top:clamp(1.4rem,3.5vh,2.6rem)}
  .panel .idx li{padding:1rem 0}
  .panel .idx .nm{font-size:clamp(1.4rem,2.6vw,2.3rem)}
  .panel .fbase{margin-top:clamp(1.4rem,3.5vh,2.6rem)}
  .dots{display:flex;position:fixed;right:1.15rem;top:50%;transform:translateY(-50%);z-index:70;flex-direction:column;gap:.75rem}
  .dots a{position:relative;display:block;width:.55rem;height:.55rem;border-radius:50%;background:var(--mut);opacity:.42;transition:opacity .2s,transform .2s,background .2s}
  .dots a.on{opacity:1;background:var(--acc);transform:scale(1.45)}
  .dots a span{position:absolute;right:1.35rem;top:50%;transform:translateY(-50%);font-size:.62rem;letter-spacing:.24em;text-transform:uppercase;color:var(--mut);opacity:0;transition:opacity .2s;white-space:nowrap;pointer-events:none}
  .dots a:hover span,.dots a.on span{opacity:1}
  .prog{display:block;position:fixed;left:0;right:0;top:calc(var(--navh) - 1px);height:2px;z-index:70;pointer-events:none}
  .prog i{display:block;height:100%;background:var(--acc);transform-origin:0 50%;transform:scaleX(0)}
}
@media (min-width:721px) and (max-width:980px){
  .hp .h-img img{height:min(32vh,20rem)}
}
@media (max-width:980px){
  .hero .grid{grid-template-columns:1fr}
  .h-img{max-width:34rem}
  .hero.split .h-copy{align-self:auto}
  .hmeta{padding-top:2.6rem}
  .psplit{grid-template-columns:1fr}
  .s-grid{grid-template-columns:1fr}
  .fgrid.c1,.fgrid.c2{grid-template-columns:1fr 1fr}
}
@media (max-width:840px){
  .tnav{display:none}
  .mnav{display:block}
  .top .wrap{min-height:3.9rem}
}
@media (max-width:640px){
  .acts{gap:1.1rem}
  .idx .sc i{display:none}
  figcaption{font-size:.8rem}
  .phead{flex-direction:column;align-items:flex-start;gap:1rem}
  .g-grid{grid-template-columns:1fr 1fr;gap:.9rem}
  .g-grid.n2{grid-template-columns:1fr}
  .g-grid.n2 figure:nth-child(even){margin-top:0}
  .g-grid figure:nth-child(even){margin-top:1.4rem}
  .g-grid figcaption{display:none}
  .fgrid.c1,.fgrid.c2{grid-template-columns:1fr}
  .mark{max-width:56vw}
  .idx li{gap:1rem}
  .prow{flex-wrap:wrap;gap:.8rem 1.6rem}
  .prow .pr{flex-basis:calc(100% - 4.2rem)}
  .prow .price,.prow .pspec{margin-left:4.2rem}
  .steps li{grid-template-columns:2.6rem 1fr}
}
</style></head>
<body id="top">
<header class="top"><div class="wrap">
  <a class="mark" href="#hero">${esc(name)}</a>
  <nav class="tnav">${navLinks}</nav>
  ${navCta}${mnav}
</div></header>
<main class="track">
${heroHtml}
${storyHtml}
${productsHtml}
${galleryHtml}
${tasteHtml}
${ctaHtml}
<footer id="end" class="foot panel"><div class="wrap">
  <div class="fgrid c${fcols}">
    <div><div class="fmark">${esc(name)}</div>${(content.footer?.note || brand.tagline || brand.description) ? `<p class="fnote">${esc(content.footer?.note || brand.tagline || brand.description)}</p>` : ''}${(brand.tone || []).length ? `<div class="ftone">${brand.tone.slice(0, 5).map((t) => `<span>${esc(t)}</span>`).join('<i>·</i>')}</div>` : ''}</div>
    ${indexCol}${footerLinks}
  </div>
  <div class="fbase"><span>© ${year} ${esc(name)}</span><span>Site by Marque</span></div>
</div></footer>
</main>
${deckChrome}
<script>(function(){
var t=document.querySelector('.track'),bar=document.querySelector('.prog i');
var dots=[].slice.call(document.querySelectorAll('.dots a'));
if(!t)return;
var mq=matchMedia('(max-width:720px)'),lock=0;
function upd(){
  var max=t.scrollWidth-t.clientWidth;
  if(bar)bar.style.transform='scaleX('+(max>0?t.scrollLeft/max:0)+')';
  var on=Math.min(dots.length-1,Math.round(t.scrollLeft/Math.max(1,t.clientWidth)));
  dots.forEach(function(d,i){d.classList.toggle('on',i===on)});
}
t.addEventListener('scroll',upd,{passive:true});addEventListener('resize',upd);upd();
t.addEventListener('wheel',function(e){
  if(mq.matches||Math.abs(e.deltaX)>Math.abs(e.deltaY))return;
  var el=e.target&&e.target.closest?e.target.closest('.hscroll'):null;
  if(el&&el.scrollWidth-el.clientWidth>4){
    var room=e.deltaY<0?el.scrollLeft:el.scrollWidth-el.clientWidth-el.scrollLeft;
    if(room>4){el.scrollLeft+=e.deltaY;return}
  }
  var p=e.target&&e.target.closest?e.target.closest('.panel'):null;
  if(p&&p.scrollHeight-p.clientHeight>4){
    if(e.deltaY>0?p.scrollTop+p.clientHeight<p.scrollHeight-4:p.scrollTop>4)return;
  }
  var n=Date.now();if(n<lock)return;lock=n+650;
  t.scrollBy({left:(e.deltaY<0?-1:1)*t.clientWidth,behavior:'smooth'});
},{passive:true});
addEventListener('keydown',function(e){
  if(mq.matches)return;
  var d=e.key==='ArrowRight'||e.key==='PageDown'?1:e.key==='ArrowLeft'||e.key==='PageUp'?-1:0;
  if(!d||/INPUT|TEXTAREA|SELECT/.test((e.target&&e.target.tagName)||''))return;
  e.preventDefault();t.scrollBy({left:d*t.clientWidth,behavior:'smooth'});
});
})();</script>
</body></html>`;
}

// ---------------- model plumbing ----------------
function siteContext(profile, inputs, extraPrompt = '', ctx = null) {
  return JSON.stringify({
    brand: {
      name: profile?.name, tagline: profile?.tagline, description: profile?.description,
      tone: profile?.tone, values: profile?.values, audience: profile?.audience,
      colors: profile?.colors, fonts: profile?.fonts,
      images: inputs.brand.images.map((i) => ({ path: i.path, caption: i.caption })),
      catalog: inputs.catalog,
      affinities: inputs.affinities,
    },
    // when the site is produced off the board/campaign, this is the work it
    // must look like — palette, hero product, headline language, and the
    // creatives already rendered for it (their /assets paths are usable picks)
    producedFrom: ctx || undefined,
    request: extraPrompt || 'Write the site copy deck.',
  });
}

// pull a complete html doc out of model output (fences, prose, or raw)
function extractHTML(t) {
  if (!t || typeof t !== 'string') return null;
  const s = t.replace(/```(?:html)?/gi, '');
  const start = s.search(/<!doctype|<html/i);
  if (start < 0) return null;
  const close = s.toLowerCase().lastIndexOf('</html>');
  const end = close > start ? close + '</html>'.length : s.length;
  const html = s.slice(start, end).trim();
  return html.length > 200 && html.includes('<') ? html : null;
}

// repair common LLM defects in generated docs before they ship: a malformed
// viewport meta (`name="viewport="content=…"`) is ignored by browsers so mobile
// renders at the 980px fallback — strip broken metas and guarantee a good one.
// The same pass covers docs stored before the fixes landed — /s/<slug> serves
// legacy html through this function, so repairs reach already-published pages.

// made-up CSS shorthands: `border-y:`/`border-x:` aren't properties — the
// separators they meant to draw silently never compute (borderTopWidth: 0).
// Only declaration position qualifies — a `.border-y:hover` selector must not
// be mangled, so the name has to follow `{`, `;` or the block start.
const fixBorderShorthands = (html) => html
  .replace(/(^|[{;}])\s*border-y\s*:\s*([^;}{]+)/gi, (_m, p, v) => `${p}border-top:${v};border-bottom:${v}`)
  .replace(/(^|[{;}])\s*border-x\s*:\s*([^;}{]+)/gi, (_m, p, v) => `${p}border-left:${v};border-right:${v}`);

// chip-family text (`.badge`, `.chip`, `.pill`) sitting on its own translucent
// tint: raw accent on a ~20% accent wash over a dark ground composites below
// AA. Measure the composited ground and lift the text color toward the best
// ink until it clears 4.6 — the same contract the renderer's chips hold. Docs
// that already pass are untouched.
function repairChipContrast(html) {
  const root = html.match(/:root\s*\{([^{}]*)\}/);
  const vars = new Map();
  if (root) for (const m of root[1].matchAll(/(--[\w-]+)\s*:\s*([^;}{]+)/g)) vars.set(m[1], m[2].trim());
  const resolve = (v) => String(v ?? '').replace(/var\(\s*(--[\w-]+)\s*(?:,[^)]*)?\)/g, (_m, n) => vars.get(n) ?? '');
  const rgbaOf = (v) => {
    const s = resolve(v).trim();
    const m = s.match(/rgba?\(\s*([\d.]+)\s*[, ]\s*([\d.]+)\s*[, ]\s*([\d.]+)\s*(?:[,/]\s*([\d.]+%?))?/i);
    if (m) { const a = m[4] == null ? 1 : (String(m[4]).endsWith('%') ? parseFloat(m[4]) / 100 : parseFloat(m[4])); return { c: [+m[1], +m[2], +m[3]], a: Number.isFinite(a) ? a : 1 }; }
    const h = rgb(s); return h ? { c: h, a: 1 } : null;
  };
  // the page ground: body's own background wins; common bg-ish vars otherwise
  const bodyBg = rgbaOf((html.match(/body\s*\{([^{}]*)\}/)?.[1].match(/background(?:-color)?\s*:\s*([^;]+)/) || [])[1]);
  let page = bodyBg ? (bodyBg.a >= 1 ? bodyBg.c : [255, 255, 255].map((w, i) => Math.round(w * (1 - bodyBg.a) + bodyBg.c[i] * bodyBg.a))) : null;
  if (!page) for (const k of ['--color-bg', '--bg', '--background', '--color-background', '--color-surface', '--surface', '--color-card', '--card']) { const v = rgbaOf(vars.get(k)); if (v) { page = v.c; break; } }
  if (!page) page = [255, 255, 255];
  return html.replace(/([^{}]*)\{([^{}]*)\}/g, (m, sel, decls) => {
    if (!/(badge|chip|pill)/i.test(sel)) return m;
    const colM = decls.match(/(^|;)\s*color\s*:\s*([^;]+)/); // `border-color:`/`background-color:` can't false-match — the name must follow `;` or the block start
    if (!colM) return m;
    const tint = rgbaOf((decls.match(/background(?:-color)?\s*:\s*([^;]+)/) || [])[1]);
    const eff = tint ? (tint.a >= 1 ? tint.c : page.map((v, i) => Math.round(v * (1 - tint.a) + tint.c[i] * tint.a))) : page;
    const col = rgbaOf(colM[2]);
    if (!col) return m;
    const effHex = toHex(eff), colHex = toHex(col.c);
    if (contrast(colHex, effHex) >= 4.5) return m;
    const fix = liftToContrast(colHex, effHex, 4.6);
    if (fix === colHex) return m;
    return `${sel}{${decls.replace(colM[0], `${colM[1]}color:${fix}`)}}`;
  });
}

// dead `href="#"` anchors: a brand/logo mark takes the doc's own most-linked
// external origin (its real brand url); anything else becomes an inert span
// instead of a jump-to-top trap.
function repairDeadAnchors(html) {
  const counts = new Map();
  for (const m of html.matchAll(/\bhref\s*=\s*['"](https?:\/\/[^'"]+)['"]/gi)) {
    try { const o = new URL(m[1]).origin; counts.set(o, (counts.get(o) || 0) + 1); } catch { /* skip */ }
  }
  const origin = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || null;
  return html.replace(/<a\b([^>]*?)\s*href\s*=\s*(['"])#\2([^>]*)>([\s\S]*?)<\/a\s*>/gi, (m, pre, _q, post, inner) => {
    if (origin && /\bclass\s*=\s*['"][^'"]*\b(?:logo|brand|mark)\b/i.test(`${pre || ''} ${post || ''}`))
      return `<a${pre || ''} href="${origin}" rel="noopener"${post || ''}>${inner}</a>`;
    return `<span${pre || ''}${post || ''}>${inner}</span>`;
  });
}

// a `.price` slot holding non-price copy ("12-Pack", pack sizes, specs) demotes
// to plain `.spec` text — specs never masquerade as cost
const repairPriceSlots = (html) => html.replace(
  /<([a-z0-9]+)\b([^>]*\bclass\s*=\s*['"][^'"]*\bprice\b[^'"]*['"][^>]*)>([^<]*)<\/\1\s*>/gi,
  (m, tag, attrs, inner) => {
    const txt = inner.replace(/&[a-z#0-9]+;/gi, ' ').replace(/\s+/g, ' ').trim();
    if (looksLikePrice(txt)) return m;
    const fixed = attrs.replace(/(class\s*=\s*['"])([^'"]*)(['"])/i, (_m, o, cls, c) => o + cls.replace(/\bprice\b/g, 'spec') + c);
    return `<${tag}${fixed}>${inner}</${tag}>`;
  });

// hardcoded footer years go stale — © lines track the render year instead
const fixStaleYear = (html) => html.replace(/(©|&copy;|&#0*169;|&#x0*a9;)\s*(?:19|20)\d{2}(\s*[-–—]\s*(?:19|20)\d{2})?/gi, (_m, sym) => `${sym} ${new Date().getFullYear()}`);

export function normalizeHTML(html) {
  if (!html || typeof html !== 'string') return html;
  let out = fixBorderShorthands(html);
  out = repairChipContrast(out);
  out = repairDeadAnchors(out);
  out = repairPriceSlots(out);
  out = fixStaleYear(out);
  out = out.replace(/<meta\s+name\s*=\s*["']?viewport=[^>]*>/gi, '');
  if (!/<meta\s+name\s*=\s*["']viewport["']/i.test(out)) {
    const tag = '<meta name="viewport" content="width=device-width, initial-scale=1">';
    out = /<head[^>]*>/i.test(out) ? out.replace(/<head[^>]*>/i, (m) => `${m}\n${tag}`) : `${tag}\n${out}`;
  }
  if (!/<meta\s+property\s*=\s*["']og:title["']/i.test(out) && /<head[^>]*>/i.test(out)) {
    const title = (out.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1] || '').trim();
    const img = out.match(/<img[^>]*\ssrc\s*=\s*["']([^"']+)["']/i)?.[1];
    if (title) {
      const desc = title.split(/\s*[|—–-]\s*/).slice(1).join(' ').trim() || title;
      const tags = `<meta name="description" content="${esc(desc)}"><meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(desc)}">${img ? `<meta property="og:image" content="${esc(img)}">` : ''}`;
      out = out.replace(/<head[^>]*>/i, (m) => `${m}\n${tags}`);
    }
  }
  return out;
}

// copy deck from the model — chatJSON {content,style}; nil on failure (the
// fallback deck still ships a coherent page, so generation never hard-fails)
async function siteDeck(messages) {
  try {
    const out = await chatJSON(messages, { maxTokens: 4000 });
    if (out && typeof out === 'object' && (out.content || out.style)) return out;
    if (out?.site && typeof out.site === 'object') return out.site; // tolerate {"site":{...}} wrap
  } catch { /* fallback deck covers it */ }
  return null;
}

// html completion — only for editing legacy pre-renderer versions
async function siteHTML(messages) {
  try {
    const out = await chatJSON(messages, { maxTokens: 8000 });
    const html = extractHTML(out?.html) || (typeof out?.html === 'string' && out.html.includes('<') ? out.html : null);
    if (html) return normalizeHTML(html);
  } catch { /* fall back to raw html */ }
  const raw = await chat([
    { role: 'system', content: `${SITE_SYS_HTML}\n\nIMPORTANT: ignore the JSON instruction — output the complete HTML document only, starting with <!DOCTYPE html>. No commentary, no code fences.` },
    ...messages.slice(1),
  ], { maxTokens: 8000 });
  return normalizeHTML(extractHTML(raw));
}

export async function generateWebsite(profile, prompt = '', ctx = null) {
  const inputs = siteInputs(profile, ctx);
  const sys = ctx
    ? `${SITE_SYS}\n\nThis site is being produced from a specific campaign/strategy (see producedFrom). The copy MUST extend that work: hero headline lands the campaign's keyMessage/angle, producedFrom.product is the hero subject when given, and hero/gallery image picks prefer producedFrom.campaign.creatives[].image paths.`
    : SITE_SYS;
  const deck = await siteDeck([
    { role: 'system', content: sys },
    { role: 'user', content: siteContext(profile, inputs, prompt, ctx) },
  ]);
  const site = {
    v: 1,
    brand: inputs.brand, catalog: inputs.catalog, links: inputs.links, affinities: inputs.affinities,
    content: mergeDeck(contentFallback(inputs, ctx), cleanContent(deck?.content, inputs)),
    style: cleanStyle(deck?.style),
  };
  const html = renderSiteHTML(site);
  const version = { id: uid(), html, site, prompt, createdAt: now() };
  const website = { id: uid(), createdAt: now(), versions: [version], activeVersion: version.id, publishedSlug: null };
  if (ctx) website.producedFrom = {
    campaignId: ctx.campaign?.id || null,
    campaignTitle: ctx.campaign?.title || null,
    strategyTitle: ctx.strategy?.title || null,
    // boardId is the collision-free scope key — strategy titles repeat across
    // boards, and filmableSite must never film another brand's site
    boardId: ctx.boardId || null,
  };
  push('websites', website);
  return website;
}

// produce-flow ctx for edits — the route doesn't carry it, so rehydrate the
// campaign the site was produced from (fresh creatives feed fresh image picks)
function editCtx(website) {
  const c = website?.producedFrom?.campaignId ? find('campaigns', website.producedFrom.campaignId) : null;
  return c ? {
    campaign: {
      id: c.id, title: c.brief?.title, angle: c.brief?.angle, audience: c.brief?.audience,
      keyMessage: c.brief?.keyMessage, channels: c.brief?.channels || [],
      creatives: (c.creatives || []).filter((x) => x.imagePath && !x.failed).slice(0, 6).map((x) => ({ image: x.imagePath, headline: x.headline })),
    },
  } : null;
}

export async function editWebsite(website, prompt, profile, ctx = null) {
  const active = website.versions.find((v) => v.id === website.activeVersion) || website.versions.at(-1);
  ctx = ctx || editCtx(website);
  let version;
  if (active?.site) {
    // renderer-native version — the model edits the copy deck, the template re-renders
    const inputs = profile ? siteInputs(profile, ctx) : { brand: active.site.brand, catalog: active.site.catalog || [], affinities: [], links: active.site.links || [] };
    const deck = await siteDeck([
      { role: 'system', content: SITE_SYS },
      { role: 'user', content: siteContext(profile, inputs, '', ctx) },
      { role: 'user', content: `Here is the current copy deck. Apply this edit: "${prompt}". Return the FULL updated {"content":{...},"style":{...}} — you may drop or add sections.\n\nCURRENT DECK:\n${JSON.stringify({ content: active.site.content, style: active.site.style })}` },
    ]);
    const site = {
      ...active.site,
      brand: inputs.brand, catalog: inputs.catalog, links: inputs.links || active.site.links || [],
      content: mergeDeck(active.site.content || {}, cleanContent(deck?.content, inputs)),
      style: { ...(active.site.style || {}), ...cleanStyle(deck?.style) },
    };
    version = { id: uid(), html: renderSiteHTML(site), site, prompt, createdAt: now() };
  } else {
    // legacy version — markup-in, markup-out so the published page keeps working
    const html = await siteHTML([
      { role: 'system', content: SITE_SYS_HTML },
      { role: 'user', content: siteContext(profile, siteInputs(profile, ctx)) },
      { role: 'user', content: `Here is the current site HTML. Apply this edit: "${prompt}". Return the FULL updated document as {"html":"..."}.\n\nCURRENT HTML:\n${active?.html || ''}` },
    ]);
    if (!html) throw new Error('site edit returned no html');
    version = { id: uid(), html, prompt, createdAt: now() };
  }
  const versions = [...website.versions, version];
  update('websites', website.id, { versions, activeVersion: version.id });
  return version;
}

export function siteVersion(website) {
  return website?.versions?.find((v) => v.id === website.activeVersion) || website?.versions?.at(-1) || null;
}
