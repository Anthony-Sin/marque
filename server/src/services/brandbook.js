// brand book assembly + printable multi-page HTML rendering
import { uid, now, get, set } from './store.js';

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

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

function page(children, extra = '') {
  return `<section class="page" style="${extra}">${children}</section>`;
}

export function htmlBook(book, profile, { printHint = false } = {}) {
  const c = profile?.colors || {};
  const f = profile?.fonts || {};
  const imgs = profile?.images || [];
  const cover = imgs.find((i) => i.id === book?.coverImage) || imgs[0];
  const picked = (book?.images || []).map((id) => imgs.find((i) => i.id === id)).filter(Boolean);
  const gridImgs = picked.length ? picked : imgs.slice(0, 6);
  const affinities = profile?.qloo?.affinities || [];

  const swatches = Object.entries({ Primary: c.primary, Secondary: c.secondary, Accent: c.accent, Background: c.background, Surface: c.surface, Text: c.text })
    .filter(([, v]) => v)
    .map(([label, hex]) => `<div class="swatch"><div class="chip" style="background:${esc(hex)}"></div><div class="swlabel">${label}</div><div class="hex">${esc(hex)}</div></div>`)
    .join('');

  const tone = (profile?.tone || []).map((t) => `<span class="pill">${esc(t)}</span>`).join(' ');
  const values = (profile?.values || []).map((v) => `<li>${esc(v)}</li>`).join('');
  const imgGrid = gridImgs.map((i) => `<figure><img src="${esc(i.path)}" alt="${esc(i.caption || '')}"><figcaption>${esc(i.caption || '')}</figcaption></figure>`).join('');
  const affRows = affinities.map((a) => {
    const names = (a.entities || []).slice(0, 6).map((e) => e.affinity != null ? `${esc(e.name)} <span class="aff">${Number(e.affinity).toFixed(2)}</span>` : esc(e.name)).join(' · ');
    return `<div class="affrow"><div class="afftype">${esc(String(a.type).replace('urn:entity:', ''))}</div><div class="affnames">${names || '—'}</div></div>`;
  }).join('');
  const fontSample = `<div class="fontrow"><div><div class="fname">${esc(f.heading || 'Heading')}</div><div class="fhead" style="font-family:'${esc(f.heading || 'Georgia')}',serif">Aa — The quick brown fox jumps over the lazy dog</div></div><div><div class="fname">${esc(f.body || 'Body')}</div><div class="fbody" style="font-family:'${esc(f.body || 'Helvetica')}',sans-serif">Aa — Pack my box with five dozen liquor jugs. 0123456789</div></div></div>`;

  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(profile?.name || 'Brand')} — Brand Book</title>
<style>
  :root{--p:${esc(c.primary || '#333')};--s:${esc(c.secondary || '#999')};--a:${esc(c.accent || '#e07a5f')};--bg:${esc(c.background || '#fff')};--sf:${esc(c.surface || '#f5f3ee')};--tx:${esc(c.text || '#1f1f1f')}}
  *{box-sizing:border-box;margin:0}
  body{background:#e8e8e8;color:var(--tx);font-family:'${esc(f.body || 'Helvetica')}',Helvetica,Arial,sans-serif}
  .page{width:210mm;min-height:280mm;margin:24px auto;padding:18mm;background:var(--bg);box-shadow:0 4px 30px rgba(0,0,0,.12);page-break-after:always;display:flex;flex-direction:column}
  h1,h2,h3{font-family:'${esc(f.heading || 'Georgia')}',Georgia,serif}
  .kicker{letter-spacing:.25em;text-transform:uppercase;font-size:11px;color:var(--p);margin-bottom:12px}
  .cover{justify-content:center;align-items:flex-start;gap:18px}
  .cover img{max-width:100%;max-height:120mm;object-fit:cover;border-radius:12px}
  .cover h1{font-size:52px;line-height:1.05}.cover .tag{font-size:20px;color:var(--p)}
  .story p{font-size:15px;line-height:1.8;margin-bottom:14px}
  ul{margin:10px 0 0 20px;line-height:1.9}
  .pill{display:inline-block;padding:6px 16px;border-radius:99px;background:var(--sf);color:var(--tx);margin:0 8px 8px 0;font-size:14px}
  .swatches{display:grid;grid-template-columns:repeat(3,1fr);gap:18px;margin-top:16px}
  .chip{height:90px;border-radius:14px;border:1px solid rgba(0,0,0,.08)}
  .swlabel{font-weight:600;margin-top:8px}.hex{color:#888;font-size:12px;font-family:monospace}
  .note{margin-top:20px;padding:14px 18px;background:var(--sf);border-radius:12px;font-size:13px;line-height:1.7}
  .fontrow{display:grid;grid-template-columns:1fr 1fr;gap:24px;margin-top:16px}
  .fname{font-size:12px;letter-spacing:.2em;text-transform:uppercase;color:#999;margin-bottom:8px}
  .fhead{font-size:26px;line-height:1.3}.fbody{font-size:18px;line-height:1.5}
  .grid{display:grid;grid-template-columns:repeat(3,1fr);gap:14px;margin-top:16px}
  .grid img{width:100%;height:150px;object-fit:cover;border-radius:10px}
  figcaption{font-size:11px;color:#999;margin-top:4px}
  .affrow{display:grid;grid-template-columns:110px 1fr;gap:14px;padding:12px 0;border-bottom:1px solid var(--sf)}
  .afftype{font-size:11px;letter-spacing:.15em;text-transform:uppercase;color:var(--p);padding-top:2px}
  .affnames{font-size:14px;line-height:1.7}.aff{color:var(--a);font-size:12px}
  .powered{margin-top:auto;padding-top:24px;font-size:12px;color:#999}
  @media print{body{background:#fff}.page{margin:0;box-shadow:none;width:auto;min-height:96vh}.noprint{display:none}}
  .noprint{position:fixed;top:12px;right:12px;background:#1f1f1f;color:#fff;padding:10px 18px;border-radius:99px;font-size:13px;cursor:pointer;border:0}
</style></head><body>
${printHint ? '<button class="noprint" onclick="window.print()">Print / Save as PDF</button>' : ''}
${page(`<div class="kicker">Brand Book</div>${cover ? `<img src="${esc(cover.path)}" alt="">` : ''}<h1>${esc(profile?.name || 'Brand')}</h1><div class="tag">${esc(profile?.tagline || '')}</div>`, 'class="page cover"')}
${page(`<div class="kicker">01 — Our Story</div><div class="story"><p>${esc(profile?.description || '')}</p><h3>What we value</h3><ul>${values}</ul><h3 style="margin-top:20px">Who we serve</h3><p>${esc(profile?.audience || '')}</p></div>`)}
${page(`<div class="kicker">02 — Voice</div><h2>How we sound</h2><div style="margin-top:16px">${tone}</div><p class="story" style="margin-top:20px">Every word, caption and headline should feel unmistakably ${esc(profile?.name || 'us')}.</p>`)}
${page(`<div class="kicker">03 — Palette</div><div class="swatches">${swatches}</div><div class="note">${esc(book?.paletteNote || '')}</div>`)}
${page(`<div class="kicker">04 — Typography</div>${fontSample}`)}
${page(`<div class="kicker">05 — Imagery</div><div class="grid">${imgGrid || '<p>No imagery yet.</p>'}</div>`)}
${page(`<div class="kicker">06 — Taste Signature</div><p class="story">Where our audience's culture overlaps — measured affinities that inform partnerships, playlists, placements and creative direction.</p><div style="margin-top:16px">${affRows || '<p>No taste data yet.</p>'}</div><div class="powered">Powered by Qloo${profile?.qloo?.mode === 'fixture' ? ' — demo data' : ''}</div>`)}
</body></html>`;
}
