// brand book assembly + printable multi-page HTML rendering
import { uid, now, get, set } from './store.js';

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const clip = (v, n) => { const s = String(v ?? '').replace(/\s+/g, ' ').trim(); return s ? s.slice(0, n) : null; };

// ---- palette + font helpers (same token pipeline the site renderer uses;
// kept local so sites.js remains untouched) ----
const rgb = (v) => {
  const s = String(v || '').trim();
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
};
const toHex = ([r, g, b]) => '#' + [r, g, b].map((x) => Math.max(0, Math.min(255, Math.round(x))).toString(16).padStart(2, '0')).join('');
const mix = (a, b, t) => { const A = rgb(a), B = rgb(b); return A && B ? toHex(A.map((v, i) => v + (B[i] - v) * t)) : null; };
const lum = (hex) => {
  const c = rgb(hex); if (!c) return null;
  const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
};
const contrast = (a, b) => { const la = lum(a), lb = lum(b); if (la == null || lb == null) return 1; return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05); };
const bestInk = (bg) => (contrast('#181410', bg) >= contrast('#f6f2ea', bg) ? '#181410' : '#f6f2ea');

const SYSFONTS = new Set(['serif', 'sans-serif', 'monospace', 'system-ui', 'georgia', 'helvetica', 'arial', 'times new roman', 'courier', 'courier new', 'verdana', 'tahoma', 'trebuchet ms', 'ui-sans-serif', 'ui-serif', 'ui-monospace', 'inherit']);
const fontName = (v) => String(v || '').replace(/['"\\;{}()<>]/g, '').trim().slice(0, 60) || null;
const googleFont = (v) => { const n = fontName(v); return n && !SYSFONTS.has(n.toLowerCase()) ? n : null; };

const pad2 = (n) => String(n).padStart(2, '0');

export function buildBook(profile, { coverImageId, imageIds = [] } = {}) {
  const imgs = profile?.images || [];
  const cover = imgs.find((i) => i.id === coverImageId) || imgs[0] || null;
  const picked = imageIds.map((id) => imgs.find((i) => i.id === id)).filter(Boolean).slice(0, 7);
  const c = profile?.colors || {};
  const book = {
    id: uid(),
    createdAt: now(),
    coverImage: cover?.id || null,
    images: picked.map((i) => i.id),
    publishedSlug: null,
    paletteNote: `The ${profile?.name || 'brand'} palette anchors on ${c.primary || 'a deep primary'} with ${c.accent || 'a warm accent'} for moments of emphasis — generous neutrals (${c.background || '#fff'}, ${c.surface || '#f5f3ee'}) keep layouts airy.`,
  };
  set('brandbook', book);
  return book;
}

// ---------- the published template ----------
// One document per request, re-rendered at serve time so template polish
// reaches already-published books. Every sheet is conditional on real data —
// a field the brand never filled simply leaves no page behind.
export function htmlBook(book, profile, { printHint = false } = {}) {
  const c = profile?.colors || {};
  const f = profile?.fonts || {};
  const imgs = profile?.images || [];
  const cover = imgs.find((i) => i.id === book?.coverImage) || imgs[0] || null;
  const picked = (book?.images || []).map((id) => imgs.find((i) => i.id === id)).filter(Boolean);
  const name = clip(profile?.name, 60) || 'The Brand';
  const affinities = (profile?.qloo?.affinities || []).filter((a) => (a?.entities || []).length);

  // ---- tokens: brand palette resolved for contrast ----
  const bg = rgb(c.background) ? c.background : '#faf8f4';
  const dark = (lum(bg) ?? 1) < 0.45;
  const ink = rgb(c.text) && contrast(c.text, bg) >= 3 ? c.text : bestInk(bg);
  const mut = mix(ink, bg, 0.58) || (dark ? '#9a958c' : '#6f6a60');
  const line = mix(ink, bg, 0.16) || (dark ? '#333026' : '#ddd8cc');
  const sf = rgb(c.surface) && contrast(c.surface, bg) > 1.04 ? c.surface : (mix(ink, bg, 0.05) || bg);
  const acc = rgb(c.accent) ? c.accent : (rgb(c.primary) ? c.primary : ink);
  const accInk = bestInk(acc);
  const band = rgb(c.primary) && contrast(c.primary, bg) >= 2.2 ? c.primary : (acc !== ink ? acc : (dark ? '#f6f2ea' : '#181410'));
  const bandInk = bestInk(band);
  const bandMut = mix(bandInk, band, 0.62) || mut;
  const bandLine = mix(bandInk, band, 0.3) || line;

  // ---- fonts: the book loads the faces it specifies ----
  const gf = [...new Set([f.heading, f.body].map(googleFont).filter(Boolean))];
  const fontsLink = gf.length
    ? `<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link href="https://fonts.googleapis.com/css2?${gf.map((n) => `family=${encodeURIComponent(n).replace(/%20/g, '+')}:ital,wght@0,400;0,500;0,600;0,700;1,400;1,500`).join('&')}&display=swap" rel="stylesheet">`
    : '';
  const fdName = fontName(f.heading);
  const fbName = fontName(f.body);
  const fd = fdName ? `'${fdName}',Georgia,'Times New Roman',serif` : `Georgia,'Times New Roman',serif`;
  const fb = fbName ? `'${fbName}',system-ui,-apple-system,'Segoe UI',Arial,sans-serif` : `system-ui,-apple-system,'Segoe UI',Helvetica,Arial,sans-serif`;

  // ---- section decisions — resolve before emitting; nothing renders empty ----
  const descParas = String(profile?.description || '').split(/\n+/).map((p) => p.trim()).filter(Boolean);
  const values = (profile?.values || []).filter(Boolean).slice(0, 8);
  const audience = clip(profile?.audience, 220);
  const storyOn = !!(descParas.length || values.length || audience);

  const tone = (profile?.tone || []).filter(Boolean).slice(0, 8);
  const voiceOn = tone.length > 0;

  const SW_ROLES = { Primary: 'Primary mark & cover', Secondary: 'Secondary elements', Accent: 'Moments of emphasis', Background: 'Page ground', Surface: 'Cards & fields', Text: 'Ink & type' };
  const SW_W = { Primary: 3, Secondary: 2, Accent: 2 };
  const swatches = Object.entries({ Primary: c.primary, Secondary: c.secondary, Accent: c.accent, Background: c.background, Surface: c.surface, Text: c.text })
    .filter(([, v]) => rgb(v))
    .map(([label, hex]) => ({ label, hex, role: SW_ROLES[label] || 'Supporting tone', w: SW_W[label] || 1 }));
  const paletteOn = swatches.length > 0;

  // imagery skips the cover art — it already gets its own spread
  const seen = new Set();
  const gridImgs = (picked.length ? picked : imgs.slice(0, 7))
    .filter((i) => i?.path && i.path !== cover?.path && !seen.has(i.path) && seen.add(i.path))
    .slice(0, 7);
  const imageryOn = gridImgs.length > 0;
  const tasteOn = affinities.length > 0;

  const secs = [];
  if (storyOn) secs.push({ id: 'story', label: 'Our Story' });
  if (voiceOn) secs.push({ id: 'voice', label: 'Voice' });
  if (paletteOn) secs.push({ id: 'palette', label: 'Palette' });
  secs.push({ id: 'type', label: 'Typography' });
  if (imageryOn) secs.push({ id: 'imagery', label: 'Imagery' });
  if (tasteOn) secs.push({ id: 'taste', label: 'Taste Signature' });
  secs.forEach((s, i) => { s.num = pad2(i + 1); s.folio = pad2(i + 3); }); // cover = 01, contents = 02

  // ---- copy + small parts ----
  const when = new Date(book?.createdAt || Date.now());
  const dateStr = when.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }).toUpperCase();
  const year = when.getFullYear();
  const kick = (s) => `<div class="kick"><b>Section ${s.num}</b><i>/</i><span>${esc(s.label)}</span></div>`;

  const swStrip = swatches.map((s) => `<span style="flex:${s.w};background:${esc(s.hex)}" title="${esc(s.label)} ${esc(s.hex)}"></span>`).join('');
  const swRows = swatches.map((s) => {
    const chipInk = bestInk(s.hex);
    return `<div class="spec"><div class="sw" style="background:${esc(s.hex)}"><span style="color:${chipInk}">${esc(s.hex)}</span></div><div class="spec-m"><div class="spec-l">${esc(s.label)}</div><div class="spec-r">${esc(s.role)}</div></div></div>`;
  }).join('');

  const toneRows = tone.map((t, i) => `<div class="trow"><span class="tn">${pad2(i + 1)}</span><span class="tw">${esc(t)}</span></div>`).join('');

  const moodFigs = gridImgs.map((i, n) => {
    const cap = clip(i.caption, 70) || `Fig. ${pad2(n + 1)}`;
    const ref = `<span>Fig. ${pad2(n + 1)}</span>`;
    return `<figure${n === 0 && gridImgs.length !== 2 ? ' class="feat"' : ''}><img src="${esc(i.path)}" alt="${esc(cap)}"><figcaption>${ref}<span>${esc(cap)}</span></figcaption></figure>`;
  }).join('');

  const affRows = affinities.map((a) => {
    const names = (a.entities || []).slice(0, 7).map((e) => e.affinity != null ? `${esc(e.name)} <em>${Number(e.affinity).toFixed(2)}</em>` : esc(e.name)).join(' · ');
    return `<div class="arow"><div class="atype">${esc(String(a.type).replace('urn:entity:', ''))}</div><div class="anames">${names || '—'}</div></div>`;
  }).join('');

  // ---- cover ----
  const coverArt = cover
    ? `<figure class="cart"><img src="${esc(cover.path)}" alt="${esc(clip(cover.caption, 70) || `${name} cover art`)}"><figcaption><span>Cover art</span><span>${esc(clip(cover.caption, 60) || 'Studio series')}</span></figcaption></figure>`
    : (swatches.length ? `<div class="cart cart-pal"><div class="cpal">${swStrip}</div><figcaption><span>Palette</span><span>${swatches.length} colors</span></figcaption></div>` : '');
  const coverBody = `
    <div class="ctop"><span>Brand Book</span><span>Vol. 01 — ${esc(dateStr)}</span></div>
    <div class="cbody">
      ${coverArt}
      <h1 class="cname">${esc(name)}</h1>
      ${profile?.tagline ? `<p class="ctag">${esc(profile.tagline)}</p>` : ''}
    </div>
    <div class="cmeta"><span>${esc(name)}</span><span>Brand Book</span><span>© ${year}</span></div>`;

  // ---- contents ----
  const tocBody = `
    <div class="kick"><b>Contents</b><i>/</i><span>${secs.length + 1} spreads</span></div>
    <h2 class="toc-h">Inside<br><em>the book.</em></h2>
    <div class="toc">
      ${secs.map((s) => `<div class="trow toc-row"><span class="tn">${s.num}</span><span class="tw">${esc(s.label)}</span><span class="tp">P.${s.folio}</span></div>`).join('')}
      <div class="trow toc-row"><span class="tn">${pad2(secs.length + 1)}</span><span class="tw">Colophon</span><span class="tp">—</span></div>
    </div>`;

  // ---- section bodies ----
  const bodies = {
    story: () => `
      ${kick(secs.find((s) => s.id === 'story'))}
      <h2 class="sh">${esc(profile?.tagline || 'Our story')}</h2>
      ${descParas.length ? `<p class="lede">${esc(descParas[0])}</p>` : ''}
      ${descParas.slice(1).map((p) => `<p class="bp">${esc(p)}</p>`).join('')}
      ${values.length ? `<div class="sub-k">What we value</div><div class="vlist">${values.map((v, i) => `<div class="trow vrow"><span class="tn">${pad2(i + 1)}</span><span class="vw">${esc(v)}</span></div>`).join('')}</div>` : ''}
      ${audience ? `<div class="pull"><div class="pull-k">Who we serve</div><p>${esc(audience)}</p></div>` : ''}`,
    voice: () => `
      ${kick(secs.find((s) => s.id === 'voice'))}
      <h2 class="sh">How we sound</h2>
      <p class="lede">Every word — a headline, a caption, a subject line — should read unmistakably ${esc(name)}: ${esc(tone.slice(0, 3).join(', '))}${tone.length > 3 ? ', and everything in between.' : '.'}</p>
      <div class="sub-k">Tone of voice — ${tone.length} registers</div>
      <div class="tlist">${toneRows}</div>`,
    palette: () => `
      ${kick(secs.find((s) => s.id === 'palette'))}
      <h2 class="sh">The palette</h2>
      <div class="pal-strip">${swStrip}</div>
      <div class="specs">${swRows}</div>
      ${book?.paletteNote ? `<div class="pnote"><div class="pull-k">Palette note</div><p>${esc(book.paletteNote)}</p></div>` : ''}`,
    type: () => `
      ${kick(secs.find((s) => s.id === 'type'))}
      <h2 class="sh">Typography</h2>
      <div class="faces">
        <div class="face">
          <div class="face-k"><span>Display face</span><span>${esc(fdName || 'System serif')}</span></div>
          <div class="face-aa" style="font-family:${fd}">Aa</div>
          <p class="face-pg" style="font-family:${fd}">The quick brown fox jumps over the lazy dog — 0123456789</p>
        </div>
        <div class="face">
          <div class="face-k"><span>Text face</span><span>${esc(fbName || 'System sans')}</span></div>
          <div class="face-aa" style="font-family:${fb}">Aa</div>
          <p class="face-pg" style="font-family:${fb}">Pack my box with five dozen liquor jugs — the quick brown fox jumps over the lazy dog. 0123456789</p>
        </div>
      </div>
      <div class="sub-k">Scale in use</div>
      <div class="ladder">
        <div class="lrow"><span class="lk">Display — 48</span><span class="ls" style="font-family:${fd};font-size:clamp(2rem,5vw,3rem)">Headlines lead</span></div>
        <div class="lrow"><span class="lk">Title — 28</span><span class="ls" style="font-family:${fd};font-size:1.75rem">Sections breathe</span></div>
        <div class="lrow"><span class="lk">Body — 16</span><span class="ls" style="font-size:1rem">Long-form copy stays quiet and readable.</span></div>
        <div class="lrow"><span class="lk">Caption — 11</span><span class="ls lk2">LABELS &amp; CAPTIONS TRACK WIDE</span></div>
      </div>`,
    imagery: () => `
      ${kick(secs.find((s) => s.id === 'imagery'))}
      <h2 class="sh">Imagery</h2>
      <p class="bp">The visual mood — ${gridImgs.length} frame${gridImgs.length === 1 ? '' : 's'} from the brand library.</p>
      <div class="mood">${moodFigs}</div>`,
    taste: () => `
      ${kick(secs.find((s) => s.id === 'taste'))}
      <h2 class="sh">Taste signature</h2>
      <p class="lede">Where the audience's culture overlaps — measured affinities that steer partnerships, playlists, placements and creative direction.</p>
      <div class="alist">${affRows}</div>
      <p class="credit">Affinity data — Qloo taste intelligence</p>`,
  };

  // ---- back cover / colophon ----
  const metaRows = [
    ['Published', dateStr],
    ['Edition', 'Vol. 01'],
    ['Set in', [fdName, fbName].filter(Boolean).join(' · ') || 'System faces'],
    paletteOn ? ['Palette', `${swatches.length} swatches`] : null,
    imageryOn ? ['Imagery', `${gridImgs.length} frames`] : null,
    tasteOn ? ['Taste data', 'Qloo'] : null,
  ].filter(Boolean).map(([k, v]) => `<div class="crow"><span>${esc(k)}</span><span>${esc(v)}</span></div>`).join('');
  const backBody = `
    <div class="bkick">Colophon</div>
    <div class="bmark">${esc(name)}</div>
    <div class="brule"></div>
    <div class="bmeta">${metaRows}</div>
    <p class="bcred">Brand book generated by Marque —<br>the on-brand marketing studio.</p>
    <div class="bend">— Fin —</div>`;

  // ---- assemble sheets with running furniture ----
  const sheets = [];
  sheets.push({ cls: 'sheet cover', bare: true, body: coverBody });
  sheets.push({ label: 'Contents', body: tocBody });
  for (const s of secs) sheets.push({ label: `${s.num} — ${s.label}`, body: bodies[s.id]() });
  sheets.push({ cls: 'sheet back', bare: true, body: backBody });

  const total = sheets.length;
  const sheetsHtml = sheets.map((s, i) => {
    if (s.bare) return `<section class="${s.cls}">${s.body}</section>`;
    return `<section class="sheet"><div class="ftop"><span>Brand book — ${esc(name)}</span><span>${esc(s.label)}</span></div><div class="sbody">${s.body}</div><div class="fbot"><span>Marque Studio</span><span>${pad2(i + 1)} / ${pad2(total)}</span></div></section>`;
  }).join('');

  // ---- meta for link unfurling ----
  const metaDesc = clip(profile?.description || profile?.tagline || `${name} brand guidelines — palette, typography, voice and imagery.`, 200);
  const ogImage = cover?.path ? `<meta property="og:image" content="${esc(cover.path)}"><meta name="twitter:card" content="summary_large_image">` : '';
  const favicon = `<link rel="icon" href="data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><rect width="16" height="16" fill="${acc}"/></svg>`)}">`;

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(name)} — Brand Book</title>
<meta name="description" content="${esc(metaDesc)}">
<meta property="og:title" content="${esc(name)} — Brand Book">
<meta property="og:description" content="${esc(metaDesc)}">
<meta property="og:type" content="website">
<meta name="theme-color" content="${esc(bg)}">
${ogImage}
${favicon}
${fontsLink}
<style>
:root{--bg:${bg};--ink:${ink};--mut:${mut};--line:${line};--sf:${sf};--acc:${acc};--acc-ink:${accInk};--band:${band};--band-ink:${bandInk};--band-mut:${bandMut};--band-line:${bandLine};--fd:${fd};--fb:${fb};--fm:ui-monospace,'SF Mono','Cascadia Mono',Menlo,Consolas,monospace}
*{box-sizing:border-box;margin:0;padding:0}
body{background:#e9e7e2;color:var(--ink);font:400 1rem/1.7 var(--fb);-webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility}
img{display:block;max-width:100%}
::selection{background:var(--acc);color:var(--acc-ink)}

/* ---- sheet: the page object, on-screen and in print ---- */
.sheet{width:210mm;max-width:calc(100% - 2rem);min-height:285mm;margin:clamp(1.5rem,3.5vw,3rem) auto;background:var(--bg);box-shadow:0 34px 70px rgba(24,20,16,.16),0 4px 16px rgba(24,20,16,.08);display:flex;flex-direction:column;padding:clamp(2.6rem,7%,4.6rem) clamp(2.1rem,7%,4.2rem);page-break-after:always;break-after:page;position:relative}
.ftop,.fbot{display:flex;justify-content:space-between;gap:1rem;font:600 .62rem/1.5 var(--fm);letter-spacing:.24em;text-transform:uppercase;color:var(--mut);flex:none;flex-wrap:wrap}
.ftop{padding-bottom:1.3rem;border-bottom:1px solid var(--line);margin-bottom:clamp(2rem,5vh,3.4rem)}
.fbot{border-top:1px solid var(--line);padding-top:1.1rem;margin-top:auto}
.sbody{flex:1;display:flex;flex-direction:column}

/* ---- shared editorial atoms ---- */
.kick{display:flex;align-items:baseline;gap:.7rem;font:600 .66rem/1.4 var(--fm);letter-spacing:.26em;text-transform:uppercase;color:var(--mut)}
.kick b{color:var(--acc);font-weight:600}
.kick i{font-style:normal;color:var(--line)}
.sh{font-family:var(--fd);font-weight:600;font-size:clamp(2.1rem,4.8vw,3.3rem);line-height:1.02;letter-spacing:-.02em;margin:1.5rem 0 0;text-wrap:balance}
.lede{font-size:clamp(1.04rem,1.5vw,1.26rem);line-height:1.66;color:var(--ink);max-width:34em;margin-top:clamp(1.6rem,3.5vh,2.4rem);text-wrap:pretty}
.bp{font-size:.96rem;line-height:1.78;color:var(--ink);max-width:40em;margin-top:1.05rem}
.sub-k{font:600 .66rem/1 var(--fm);letter-spacing:.26em;text-transform:uppercase;color:var(--mut);margin-top:clamp(2.2rem,5vh,3.2rem)}
.pull{margin-top:clamp(1.8rem,4vh,2.6rem);border-left:2px solid var(--acc);padding:.4rem 0 .4rem 1.4rem}
.pull-k{font:600 .62rem/1 var(--fm);letter-spacing:.26em;text-transform:uppercase;color:var(--acc);margin-bottom:.8rem}
.pull p{font-family:var(--fd);font-size:clamp(1.15rem,2vw,1.5rem);line-height:1.45;max-width:26em}
.trow{display:flex;align-items:baseline;gap:1.4rem;padding:1.15rem 0;border-bottom:1px solid var(--line);break-inside:avoid}
.tn{font:600 .7rem/1 var(--fm);letter-spacing:.18em;color:var(--acc);min-width:2.4rem}
.tw{font-family:var(--fd);font-weight:600;font-size:clamp(1.5rem,3.2vw,2.2rem);line-height:1.05;letter-spacing:-.015em}
.vw{font-size:1.05rem}
.vlist{margin-top:.4rem;border-top:1px solid var(--line)}
.tlist{margin-top:.4rem;border-top:1px solid var(--line)}

/* ---- cover ---- */
.cover{background:var(--band);color:var(--band-ink);padding:0}
.ctop,.cmeta{display:flex;justify-content:space-between;gap:1rem;flex-wrap:wrap;font:600 .64rem/1.5 var(--fm);letter-spacing:.26em;text-transform:uppercase;color:var(--band-mut);padding:1.5rem clamp(2.1rem,7%,4.2rem);flex:none}
.cmeta{border-top:1px solid var(--band-line);margin-top:auto}
.cbody{flex:1;display:flex;flex-direction:column;justify-content:center;padding:0 clamp(2.1rem,7%,4.2rem) clamp(2rem,4vh,3rem);gap:clamp(1.6rem,3.5vh,2.6rem)}
.cart{margin:0;border:1px solid var(--band-line);padding:.55rem}
.cart img{width:100%;aspect-ratio:16/10;object-fit:cover}
.cart figcaption{display:flex;justify-content:space-between;gap:1rem;padding-top:.7rem;font:600 .6rem/1.4 var(--fm);letter-spacing:.22em;text-transform:uppercase;color:var(--band-mut)}
.cart-pal .cpal{display:flex;height:clamp(9rem,26vh,15rem)}
.cart-pal .cpal span{flex:1}
.cart-pal figcaption{display:flex;justify-content:space-between;padding-top:.7rem;font:600 .6rem/1.4 var(--fm);letter-spacing:.22em;text-transform:uppercase;color:var(--band-mut)}
.cname{font-family:var(--fd);font-weight:600;font-size:clamp(2.7rem,7.4vw,5.2rem);line-height:.98;letter-spacing:-.025em;text-wrap:balance}
.ctag{font-size:clamp(1.05rem,1.8vw,1.4rem);line-height:1.5;color:var(--band-mut);max-width:26em}

/* ---- contents ---- */
.toc-h{font-family:var(--fd);font-weight:600;font-size:clamp(2.4rem,5.4vw,3.8rem);line-height:1.0;letter-spacing:-.02em;margin:1.6rem 0 2.4rem}
.toc-h em{font-style:italic;font-weight:400;color:var(--mut)}
.toc{border-top:1px solid var(--line)}
.toc-row .tp{margin-left:auto;font:600 .66rem/1 var(--fm);letter-spacing:.2em;color:var(--mut)}

/* ---- palette ---- */
.pal-strip{display:flex;height:clamp(4rem,9vh,6rem);border:1px solid var(--line);margin-top:clamp(1.8rem,4vh,2.8rem)}
.specs{margin-top:1.4rem;border-top:1px solid var(--line)}
.spec{display:grid;grid-template-columns:5.6rem 1fr;gap:1.3rem;padding:.8rem 0;border-bottom:1px solid var(--line);align-items:stretch;break-inside:avoid}
.spec .sw{min-height:3rem;display:flex;align-items:flex-end;padding:.5rem .6rem;border:1px solid var(--line)}
.spec .sw span{font:600 .62rem/1 var(--fm);letter-spacing:.14em;text-transform:uppercase}
.spec-m{display:flex;flex-direction:column;justify-content:center;gap:.35rem}
.spec-l{font-family:var(--fd);font-weight:600;font-size:1.15rem;line-height:1.1}
.spec-r{font-size:.82rem;color:var(--mut)}
.pnote{margin-top:clamp(1.6rem,3.5vh,2.4rem);background:var(--sf);padding:1.1rem 1.4rem;border-left:2px solid var(--acc)}
.pnote p{font-size:.92rem;line-height:1.7;color:var(--ink);max-width:44em}

/* ---- typography ---- */
.faces{display:grid;grid-template-columns:1fr 1fr;gap:clamp(1.5rem,4vw,3rem);margin-top:clamp(1.8rem,4vh,2.8rem)}
.face{border-top:1px solid var(--line);padding-top:1.2rem;break-inside:avoid}
.face-k{display:flex;justify-content:space-between;gap:1rem;font:600 .62rem/1.4 var(--fm);letter-spacing:.24em;text-transform:uppercase;color:var(--mut)}
.face-aa{font-size:clamp(4.2rem,9vw,7rem);line-height:1.05;letter-spacing:-.03em;margin-top:1.1rem}
.face-pg{font-size:1rem;line-height:1.6;color:var(--mut);margin-top:.9rem;max-width:24em}
.ladder{margin-top:.5rem;border-top:1px solid var(--line)}
.lrow{display:flex;align-items:baseline;gap:1.6rem;padding:1.1rem 0;border-bottom:1px solid var(--line)}
.lk{font:600 .62rem/1.4 var(--fm);letter-spacing:.22em;text-transform:uppercase;color:var(--mut);min-width:8.6rem;flex:none}
.ls{line-height:1.2}
.lk2{font:600 .68rem/1.4 var(--fm);letter-spacing:.22em;color:var(--ink)}

/* ---- imagery ---- */
.mood{display:grid;grid-template-columns:repeat(3,1fr);gap:1.1rem;margin-top:clamp(1.6rem,3.5vh,2.4rem)}
.mood figure{margin:0;break-inside:avoid}
.mood .feat{grid-column:span 2}
.mood img{width:100%;aspect-ratio:4/5;object-fit:cover}
.mood .feat img{aspect-ratio:8/5}
.mood figcaption{display:flex;justify-content:space-between;gap:.8rem;border-top:1px solid var(--line);margin-top:.7rem;padding-top:.6rem;font:600 .6rem/1.4 var(--fm);letter-spacing:.18em;text-transform:uppercase;color:var(--mut)}

/* ---- taste ---- */
.alist{margin-top:clamp(1.8rem,4vh,2.6rem);border-top:1px solid var(--line)}
.arow{display:grid;grid-template-columns:9rem 1fr;gap:1.4rem;padding:1.15rem 0;border-bottom:1px solid var(--line);break-inside:avoid}
.atype{font:600 .62rem/1.5 var(--fm);letter-spacing:.22em;text-transform:uppercase;color:var(--acc);padding-top:.2rem}
.anames{font-size:.96rem;line-height:1.75}
.anames em{font-style:normal;font:600 .68rem/1 var(--fm);color:var(--acc);letter-spacing:.06em}
.credit{margin-top:1.4rem;font:600 .62rem/1.5 var(--fm);letter-spacing:.22em;text-transform:uppercase;color:var(--mut)}

/* ---- back cover ---- */
.back{background:var(--band);color:var(--band-ink);align-items:center;text-align:center;justify-content:center;gap:0}
.bkick{font:600 .66rem/1 var(--fm);letter-spacing:.3em;text-transform:uppercase;color:var(--band-mut)}
.bmark{font-family:var(--fd);font-weight:600;font-size:clamp(2.2rem,5.4vw,3.6rem);letter-spacing:-.02em;line-height:1.05;margin-top:1.6rem}
.brule{width:4.5rem;height:1px;background:var(--band-line);margin:1.8rem auto}
.bmeta{width:min(22rem,100%)}
.crow{display:flex;justify-content:space-between;gap:1rem;padding:.65rem 0;border-bottom:1px solid var(--band-line);font:600 .64rem/1.4 var(--fm);letter-spacing:.2em;text-transform:uppercase}
.crow span:first-child{color:var(--band-mut)}
.bcred{margin-top:2.2rem;font-size:.86rem;line-height:1.8;color:var(--band-mut)}
.bend{margin-top:auto;padding-top:2.5rem;font:600 .62rem/1 var(--fm);letter-spacing:.3em;text-transform:uppercase;color:var(--band-mut)}

/* ---- floating print affordance (screen only) ---- */
.noprint{position:fixed;bottom:1.2rem;right:1.2rem;z-index:50;background:#141210;color:#f2efe8;border:1px solid #141210;padding:.85rem 1.4rem;font:600 .66rem/1 var(--fm);letter-spacing:.22em;text-transform:uppercase;cursor:pointer;box-shadow:0 14px 30px rgba(0,0,0,.25)}
.noprint:hover{background:#2a251f}

/* ---- smaller viewports: sheets shed their paper size, keep the rhythm ---- */
@media screen and (max-width:880px){
  .sheet{width:calc(100% - 1.4rem);min-height:0;margin:1rem auto;padding:2.1rem 1.35rem}
  .faces{grid-template-columns:1fr}
  .mood{grid-template-columns:repeat(2,1fr)}
  .mood .feat{grid-column:1/-1}
  .spec{grid-template-columns:4.2rem 1fr}
  .arow{grid-template-columns:1fr;gap:.4rem}
  .lk{min-width:6rem}
  .lrow{gap:1rem}
}
@media screen and (max-width:560px){
  .mood{grid-template-columns:1fr}
  .lrow{flex-direction:column;gap:.45rem}
  .ftop,.fbot,.ctop,.cmeta{font-size:.56rem;letter-spacing:.18em}
}

/* ---- print: same pages, no chrome ---- */
@page{size:A4;margin:0}
@media print{
  body{background:#fff}
  *,*::before,*::after{-webkit-print-color-adjust:exact;print-color-adjust:exact}
  /* running furniture is screen chrome — drop it in print so a long section
     flows cleanly instead of orphaning a footer; cover + colophon keep the
     full-bleed page look */
  .sheet{width:210mm;max-width:none;min-height:0;margin:0;box-shadow:none}
  .cover,.back{min-height:296mm}
  .ftop,.fbot{display:none}
  .mood img{aspect-ratio:1/1}
  .mood .feat img{aspect-ratio:2/1}
  .noprint{display:none!important}
}
</style></head><body>
${printHint ? '<button class="noprint" onclick="window.print()">Print / Save as PDF</button>' : ''}
${sheetsHtml}
</body></html>`;
}
