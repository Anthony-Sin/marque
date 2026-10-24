// Canvas rasterizer — draws the same layer stack CreativeOverlay renders in
// DOM (image → scrim → text grid → CTA pill) so downloads match the preview.
// Per-preset specs mirror the .st-* rules in styles.css.
const DIMS = { '1:1': [1080, 1080], '4:5': [1080, 1350], '9:16': [1080, 1920], '16:9': [1920, 1080], '4:1': [1920, 480] };

const PRESETS = {
  performance: {
    headFont: (px) => `700 ${px}px Oswald, 'Arial Narrow', sans-serif`, headPx: 88, upper: true, scrim: 'zone',
    bodyFont: '500', kicker: true, rotate: 0, headLH: 0.98, italicFirst: false, mark: false, stroke: false, blocks: false, glass: false, linkCta: false,
  },
  ugc: {
    headFont: (px) => `800 ${px}px Montserrat, Inter, sans-serif`, headPx: 78, upper: false, scrim: 'none',
    bodyFont: '700', kicker: false, rotate: 0, headLH: 1.04, italicFirst: false, mark: false, stroke: true, blocks: false, glass: false, linkCta: false,
  },
  editorial: {
    headFont: (px) => `400 ${px}px 'Instrument Serif', 'Playfair Display', serif`, headPx: 100, upper: false, scrim: 'soft',
    bodyFont: '400', kicker: true, rotate: 0, headLH: 1.02, italicFirst: true, mark: false, stroke: false, blocks: false, glass: false, linkCta: true,
  },
  marker: {
    headFont: (px) => `800 ${px}px Montserrat, Inter, sans-serif`, headPx: 82, upper: false, scrim: 'zone',
    bodyFont: '500', kicker: true, rotate: -1.5, headLH: 1.0, italicFirst: false, mark: true, stroke: false, blocks: false, glass: false, linkCta: false,
  },
  brutalist: {
    headFont: (px) => `400 ${px}px 'Archivo Black', Oswald, sans-serif`, headPx: 72, upper: true, scrim: 'none',
    bodyFont: '700', kicker: true, rotate: -2, headLH: 1.16, italicFirst: false, mark: false, stroke: false, blocks: true, glass: false, linkCta: false,
  },
  glass: {
    headFont: (px) => `600 ${px}px Inter, sans-serif`, headPx: 72, upper: false, scrim: 'none',
    bodyFont: '400', kicker: true, rotate: 0, headLH: 1.1, italicFirst: false, mark: false, stroke: false, blocks: false, glass: true, linkCta: false,
  },
};

function wrap(ctx, text, maxW) {
  const words = String(text).split(/\s+/).filter(Boolean);
  const lines = []; let cur = '';
  for (const w of words) {
    const t = cur ? `${cur} ${w}` : w;
    if (ctx.measureText(t).width <= maxW || !cur) cur = t;
    else { lines.push(cur); cur = w; }
  }
  if (cur) lines.push(cur);
  return lines;
}

function pickInk(hex) {
  const m = /^#?([0-9a-f]{6})/i.exec(String(hex || ''));
  if (!m) return '#1d1d18';
  const n = parseInt(m[1], 16);
  const lum = (0.2126 * (n >> 16) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255;
  return lum > 0.55 ? '#1d1d18' : '#ffffff';
}

async function loadImg(src) {
  const img = new Image();
  img.crossOrigin = 'anonymous';
  await new Promise((res, rej) => { img.onload = res; img.onerror = () => rej(new Error('image load failed')); img.src = src; });
  return img;
}

export async function renderCreativePNG(creative, profile, campaign, aspect = '1:1') {
  const [W, H] = DIMS[aspect] || DIMS['1:1'];
  const img = await loadImg(creative.imagePath);
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d');

  // 1) background image, cover-fit
  const s = Math.max(W / img.width, H / img.height);
  const iw = img.width * s, ih = img.height * s;
  ctx.drawImage(img, (W - iw) / 2, (H - ih) / 2, iw, ih);

  const st = PRESETS[creative.overlayStyle] || PRESETS.performance;
  const vpos = creative.layout?.vpos || 'bottom';
  const hpos = creative.layout?.hpos || 'left';
  const padX = Math.round(W * 0.075);
  const padY = Math.round(H * (aspect === '9:16' ? 0.09 : 0.075));
  const maxTextW = W - padX * 2;
  const accent = profile?.colors?.accent || '#e7e0c9';

  // 2) scrim treatment
  if (st.scrim === 'zone') {
    const zone = 0.55; let gr;
    if (vpos === 'top') {
      gr = ctx.createLinearGradient(0, 0, 0, H * zone);
      gr.addColorStop(0, 'rgba(10,12,6,0.82)'); gr.addColorStop(0.45, 'rgba(10,12,6,0.4)'); gr.addColorStop(1, 'rgba(10,12,6,0)');
      ctx.fillStyle = gr; ctx.fillRect(0, 0, W, H * zone);
    } else if (vpos === 'middle') {
      ctx.fillStyle = 'rgba(10,12,6,0.55)'; ctx.fillRect(0, 0, W, H);
    } else {
      gr = ctx.createLinearGradient(0, H, 0, H * (1 - zone));
      gr.addColorStop(0, 'rgba(10,12,6,0.82)'); gr.addColorStop(0.45, 'rgba(10,12,6,0.4)'); gr.addColorStop(1, 'rgba(10,12,6,0)');
      ctx.fillStyle = gr; ctx.fillRect(0, H * (1 - zone), W, H * zone);
    }
  } else if (st.scrim === 'soft') {
    ctx.fillStyle = 'rgba(10,12,6,0.26)'; ctx.fillRect(0, 0, W, H);
  }

  // 2b) brand lockup + offer badge — same ad-unit chrome as the DOM overlay
  {
    const lkY = Math.round(H * 0.055);
    ctx.fillStyle = accent;
    ctx.fillRect(padX, lkY, Math.round(W * 0.028), Math.round(H * 0.008));
    ctx.font = `800 ${Math.round(20 * (W / 1080))}px Inter, sans-serif`;
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.shadowColor = 'rgba(0,0,0,0.55)'; ctx.shadowBlur = Math.round(8 * (W / 1080));
    ctx.fillStyle = '#fff';
    const lockName = creative.brand || (profile?.name !== 'Your Brand' ? profile?.name : null) || 'Brand';
    ctx.fillText(String(lockName).toUpperCase(), padX + Math.round(W * 0.028) + Math.round(W * 0.014), lkY + Math.round(H * 0.004));
    ctx.shadowBlur = 0;
    if (creative.badge) {
      const bTxt = String(creative.badge).toUpperCase();
      ctx.font = `900 ${Math.round(24 * (W / 1080))}px Inter, sans-serif`;
      const bw = ctx.measureText(bTxt).width, bpx = Math.round(24 * (W / 1080)) * 1.1;
      const bx = W - padX - bw - bpx * 2, by = lkY - Math.round(24 * (W / 1080)) * 0.8;
      ctx.save();
      ctx.translate(bx + (bw + bpx * 2) / 2, by + Math.round(24 * (W / 1080)) * 0.8);
      ctx.rotate(0.05);
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillRect(-(bw + bpx * 2) / 2 + 4, -Math.round(24 * (W / 1080)) * 0.8 + 4, bw + bpx * 2, Math.round(24 * (W / 1080)) * 1.8);
      ctx.fillStyle = accent;
      ctx.fillRect(-(bw + bpx * 2) / 2, -Math.round(24 * (W / 1080)) * 0.8, bw + bpx * 2, Math.round(24 * (W / 1080)) * 1.8);
      ctx.fillStyle = pickInkForExport(accent);
      ctx.textAlign = 'center';
      ctx.fillText(bTxt, 0, Math.round(24 * (W / 1080)) * 0.1);
      ctx.restore();
    }
  }

  const u = W / 1080;
  try {
    await Promise.all([
      document.fonts.load(`700 ${Math.round(88 * u)}px Oswald`),
      document.fonts.load(`400 ${Math.round(100 * u)}px 'Instrument Serif'`),
      document.fonts.load(`italic 400 ${Math.round(100 * u)}px 'Instrument Serif'`),
      document.fonts.load(`800 ${Math.round(82 * u)}px Montserrat`),
      document.fonts.load(`400 ${Math.round(72 * u)}px 'Archivo Black'`),
      document.fonts.load(`600 ${Math.round(72 * u)}px Inter`),
      document.fonts.load(`500 ${Math.round(32 * u)}px Inter`),
      document.fonts.load(`800 ${Math.round(28 * u)}px Inter`),
    ]);
  } catch { /* fall back to system faces */ }

  const kicker = st.kicker && creative.angle ? ({ 'product-led': 'Product', lifestyle: 'Lifestyle', offer: 'Offer', 'social-proof': 'Community' })[creative.angle] || 'Featured' : '';
  const rawHead = creative.headline || '';
  const headline = st.upper ? rawHead.toUpperCase() : rawHead;
  const body = creative.body || '';
  const cta = (creative.cta || '').toUpperCase();

  const kickPx = Math.round(24 * u), headPx = Math.round(st.headPx * u), bodyPx = Math.round(32 * u), ctaPx = Math.round(28 * u);
  ctx.textBaseline = 'top';

  ctx.font = st.headFont(headPx);
  const headLines = wrap(ctx, headline, maxTextW - (st.blocks ? headPx * 0.8 : 0));
  const headLH = headPx * st.headLH;

  ctx.font = `${st.bodyFont} ${bodyPx}px Inter, sans-serif`;
  const bodyLines = wrap(ctx, body, maxTextW);
  const bodyLH = bodyPx * 1.38;

  ctx.font = `800 ${ctaPx}px Inter, sans-serif`;
  const ctaW = cta ? ctx.measureText(cta).width : 0;
  const pillH = st.linkCta ? Math.round(ctaPx * 1.5) : Math.round(ctaPx * 2.1);
  const pillW = st.linkCta ? Math.round(ctaW) : Math.round(ctaW + ctaPx * 2.6);

  const gaps = (kicker ? kickPx * 1.5 : 0) + headLines.length * headLH + (bodyLines.length ? bodyPx * 0.6 + bodyLines.length * bodyLH : 0) + (cta ? pillH + pillH * 0.9 : 0);
  let y = vpos === 'top' ? padY : vpos === 'middle' ? (H - gaps) / 2 : H - padY - gaps;
  const xFor = (w) => hpos === 'center' ? (W - w) / 2 : hpos === 'right' ? W - padX - w : padX;
  const align = hpos === 'center' ? 'center' : hpos === 'right' ? 'right' : 'left';
  const tx = hpos === 'center' ? W / 2 : hpos === 'right' ? W - padX : padX;
  ctx.textAlign = align;

  // glass panel behind the whole text stack
  if (st.glass) {
    const gp = Math.round(30 * u);
    const gx = padX - gp * 0.5, gy = y - gp;
    const gw = maxTextW + gp, gh = gaps + gp * 2;
    ctx.fillStyle = 'rgba(16,18,14,0.42)';
    ctx.strokeStyle = 'rgba(255,255,255,0.2)'; ctx.lineWidth = Math.max(1, 1.5 * u);
    ctx.beginPath(); ctx.roundRect(gx, gy, gw, gh, Math.round(28 * u)); ctx.fill(); ctx.stroke();
    y += gp * 0.35;
  }

  ctx.save();
  if (st.rotate) { ctx.translate(W / 2, y + gaps / 2); ctx.rotate(st.rotate * Math.PI / 180); ctx.translate(-W / 2, -(y + gaps / 2)); }

  ctx.shadowColor = 'rgba(0,0,0,0.4)'; ctx.shadowBlur = st.stroke ? 0 : 14 * u; ctx.shadowOffsetY = 2;
  if (kicker) {
    ctx.font = `800 ${kickPx}px Inter, sans-serif`;
    const ks = kicker.toUpperCase().split('').join(' ');
    if (st.blocks) {
      const kw = ctx.measureText(ks).width;
      ctx.fillStyle = '#111'; ctx.shadowColor = 'transparent';
      ctx.fillRect(xFor(kw + kickPx), y - kickPx * 0.25, kw + kickPx, kickPx * 1.35);
      ctx.fillStyle = '#fff';
    } else {
      ctx.fillStyle = st.glass ? accent : 'rgba(255,255,255,0.85)';
    }
    ctx.fillText(ks, tx, y); y += kickPx * 1.5;
  }

  ctx.font = st.headFont(headPx);
  const drawHead = (ln, ly) => {
    if (st.stroke) {
      ctx.lineWidth = headPx * 0.12; ctx.strokeStyle = '#000'; ctx.lineJoin = 'round';
      ctx.strokeText(ln, tx, ly);
      ctx.fillStyle = '#fff'; ctx.fillText(ln, tx, ly);
    } else if (st.blocks) {
      const lw = ctx.measureText(ln).width;
      const bx = xFor(lw + headPx * 0.5);
      ctx.fillStyle = '#000'; ctx.fillRect(bx + headPx * 0.14, ly + headPx * 0.14, lw + headPx * 0.5, headLH);
      ctx.fillStyle = '#fff'; ctx.fillRect(bx, ly, lw + headPx * 0.5, headLH);
      ctx.fillStyle = '#111';
      ctx.fillText(ln, hpos === 'center' ? bx + (lw + headPx * 0.5) / 2 : hpos === 'right' ? bx + lw + headPx * 0.25 : bx + headPx * 0.25, ly + (headLH - headPx) / 2);
    } else {
      ctx.fillStyle = '#ffffff'; ctx.fillText(ln, tx, ly);
    }
  };
  for (const ln of headLines) {
    if (st.italicFirst && ln === headLines[0] && ln.includes(' ')) {
      // italic lead word in accent
      const sp = ln.indexOf(' ');
      const first = ln.slice(0, sp), rest = ln.slice(sp);
      ctx.font = `italic ${headPx}px 'Instrument Serif', 'Playfair Display', serif`;
      ctx.fillStyle = accent;
      const fw = ctx.measureText(first).width;
      const startX = hpos === 'center' ? tx - ctx.measureText(ln).width / 2 : hpos === 'right' ? tx - ctx.measureText(ln).width : tx;
      const savedAlign = ctx.textAlign; ctx.textAlign = 'left';
      ctx.fillText(first, startX, y);
      ctx.font = st.headFont(headPx); ctx.fillStyle = '#fff';
      ctx.fillText(rest, startX + fw, y);
      ctx.textAlign = savedAlign;
    } else if (st.mark) {
      // money word gets the accent marker box
      const words = ln.split(' ');
      let bi = -1; words.forEach((w, i) => { if (/[\d%$]/.test(w)) bi = i; });
      if (bi < 0) bi = words.reduce((m, w, i) => (w.length > words[m].length ? i : m), 0);
      const lineW = ctx.measureText(ln).width;
      let cx = hpos === 'center' ? tx - lineW / 2 : hpos === 'right' ? tx - lineW : tx;
      const savedAlign = ctx.textAlign; ctx.textAlign = 'left';
      words.forEach((w, i) => {
        const seg = i === words.length - 1 ? w : `${w} `;
        const sw = ctx.measureText(seg).width;
        if (i === bi) {
          const bw = ctx.measureText(w).width;
          ctx.fillStyle = accent;
          ctx.fillRect(cx - headPx * 0.08, y + headPx * 0.08, bw + headPx * 0.16, headPx * 1.02);
          ctx.fillStyle = pickInk(accent);
          ctx.fillText(w, cx, y);
        } else {
          ctx.fillStyle = '#fff'; ctx.fillText(seg, cx, y);
        }
        cx += sw;
      });
      ctx.textAlign = savedAlign;
    } else {
      drawHead(ln, y);
    }
    y += headLH;
  }

  ctx.font = `${st.bodyFont} ${bodyPx}px Inter, sans-serif`;
  if (bodyLines.length) {
    y += bodyPx * 0.6;
    for (const ln of bodyLines) {
      if (st.blocks) {
        const bw = ctx.measureText(ln).width;
        const bx = xFor(bw + bodyPx * 0.7);
        ctx.fillStyle = '#000'; ctx.shadowColor = 'transparent';
        ctx.fillRect(bx + bodyPx * 0.18, y - bodyPx * 0.12 + bodyPx * 0.18, bw + bodyPx * 0.7, bodyLH);
        ctx.fillRect(bx, y - bodyPx * 0.12, bw + bodyPx * 0.7, bodyLH);
        ctx.fillStyle = '#fff';
      } else {
        ctx.fillStyle = 'rgba(255,255,255,0.94)';
      }
      ctx.fillText(ln, tx, y - (st.blocks ? bodyPx * 0.1 : 0)); y += bodyLH;
    }
  }
  ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;

  if (cta) {
    y += pillH * 0.9;
    if (st.linkCta) {
      ctx.fillStyle = '#fff';
      ctx.font = `600 ${ctaPx}px Inter, sans-serif`;
      const ls = cta.split('').join(' ');
      const lw = ctx.measureText(ls).width;
      const lx = xFor(lw);
      ctx.fillText(ls, hpos === 'center' ? lx + lw / 2 : hpos === 'right' ? lx + lw : lx, y);
      ctx.fillStyle = 'rgba(255,255,255,0.75)';
      ctx.fillRect(lx, y + ctaPx * 1.35, lw, Math.max(2, 2 * u));
    } else {
      const px = xFor(pillW);
      ctx.fillStyle = st.blocks ? '#000' : accent;
      if (st.blocks) { ctx.fillRect(px + ctaPx * 0.16, y + ctaPx * 0.16, pillW, pillH); ctx.fillStyle = accent; }
      ctx.beginPath(); ctx.roundRect(px, y, pillW, pillH, st.blocks ? 0 : pillH / 2); ctx.fill();
      ctx.fillStyle = pickInk(accent);
      ctx.font = `800 ${ctaPx}px Inter, sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText(cta, px + pillW / 2, y + (pillH - ctaPx) / 2 - ctaPx * 0.08);
      ctx.textAlign = align;
    }
  }
  ctx.restore();
  return cv;
}

export async function exportCreativePNG(creative, profile, campaign) {
  const ar = campaign?.aspectRatio || '1:1';
  const cv = await renderCreativePNG(creative, profile, campaign, ar);
  const blob = await new Promise((res) => cv.toBlob(res, 'image/png'));
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `marque-${creative.id}.png`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

// ink color on accent — same rule as the DOM overlay's pickInk
function pickInkForExport(hex) {
  const c = String(hex || '').replace('#', '');
  if (c.length !== 6) return '#141412';
  const r = parseInt(c.slice(0, 2), 16), g = parseInt(c.slice(2, 4), 16), b = parseInt(c.slice(4, 6), 16);
  return (0.299 * r + 0.587 * g + 0.114 * b) > 150 ? '#141412' : '#f4f3ec';
}
