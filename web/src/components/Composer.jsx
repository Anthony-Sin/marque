import React, { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useApp } from '../App.jsx';
import Icon from './Icon.jsx';
import '../views/studio.css';

export const ASPECTS = ['1:1', '4:5', '9:16', '16:9'];
export const arCss = (ar) => (ar || '1:1').replace(':', '/');

// file extension of an asset path (for honest download filenames — no transcode happens)
export function fileExt(p, fallback = 'png') {
  const m = /\.([a-z0-9]+)(?:[?#]|$)/i.exec(String(p || ''));
  return (m ? m[1] : fallback).toLowerCase();
}

// Stage-rotating copy for long-running jobs. Returns stages[i], cycling every
// `ms` while `active`; resets to the first stage each time `active` turns on.
export function useStages(stages, active, ms = 2800) {
  const [i, setI] = useState(0);
  useEffect(() => {
    if (!active) return undefined;
    setI(0);
    const t = setInterval(() => setI((x) => (x + 1) % stages.length), ms);
    return () => clearInterval(t);
  }, [active, stages.length, ms]);
  return stages[Math.min(i, stages.length - 1)];
}

export function fmtDate(d) {
  if (!d) return '';
  const t = new Date(d);
  return isNaN(t) ? '' : t.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

// true when a creative/campaign image path points at a real raster render —
// generated placeholders are saved as .svg and read as flat empty tiles.
export const isRaster = (p) => !!p && !/\.svg(?:[?#]|$)/i.test(String(p));

// channel name → icon glyph (shared by campaign tiles + dashboard work cards)
const CHAN_GLYPH = {
  instagram: 'image', tiktok: 'film', youtube: 'play', tv: 'site', streaming: 'share',
  podcast: 'mic', ooh: 'aspect', guerrilla: 'megaphone', email: 'send', press: 'book',
  print: 'book', facebook: 'share', web: 'site',
};
export const chanGlyph = (c) => CHAN_GLYPH[String(c || '').toLowerCase()] || 'sparkle';

// Styled tile shown when a creative has no real raster image: a dark,
// subtly-tinted gradient (deterministic from `seed`, usually the campaign
// title), a brand monogram and the primary channel glyph — reads as an
// intentional placeholder instead of an empty box.
export function MediaFallback({ seed = '', channel, monogram, className = '', style }) {
  let h = 0;
  for (const ch of String(seed || 'marque')) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const h1 = h % 360;
  const h2 = (h1 + 36 + (h % 55)) % 360;
  const mono = String(monogram || seed || 'M').trim()[0]?.toUpperCase() || 'M';
  return (
    <span
      className={`media-fallback${className ? ` ${className}` : ''}`}
      style={{
        background: `linear-gradient(150deg, hsl(${h1}, 26%, 23%) 0%, hsl(${h2}, 30%, 14%) 100%)`,
        ...style,
      }}
      aria-hidden="true"
    >
      <span className="mf-mono">{mono}</span>
      {channel && (
        <span className="mf-chan"><Icon name={chanGlyph(channel)} size={11} /><i>{channel}</i></span>
      )}
    </span>
  );
}

// POST helper for contract routes the api client doesn't wrap (images ops, brandbook unpublish).
export async function postJson(url, body) {
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {}),
  });
  if (!r.ok) {
    const e = new Error(`POST ${url} → ${r.status}`);
    e.status = r.status;
    throw e;
  }
  const ct = r.headers.get('content-type') || '';
  return ct.includes('json') ? r.json() : r;
}

// fetch an asset → object URL → <a download>.
export async function downloadAsset(path, filename) {
  const r = await fetch(path);
  if (!r.ok) throw new Error(`download ${r.status}`);
  const blob = await r.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename || path.split('/').pop() || 'download';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

// Kebab (⋮) + popover menu. Renders fragments so .kebab keeps its card-absolute position.
export function KebabMenu({ items, icon = 'kebab' }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);
  return (
    <>
      <button className="kebab" title="More" onClick={(e) => { e.stopPropagation(); setOpen(!open); }}>
        <Icon name={icon} size={18} />
      </button>
      {open && (
        <>
          <div className="menu-backdrop" onClick={() => setOpen(false)} />
          <div className="menu card-menu">
            {items.filter(Boolean).map((it, i) =>
              it.sep ? <div key={i} className="menu-sep" />
              : it.title ? <div key={i} className="menu-title">{it.title}</div>
              : (
                <button key={i} className={it.danger ? 'danger' : ''} onClick={(e) => { e.stopPropagation(); setOpen(false); it.onClick?.(); }}>
                  {it.label}
                </button>
              ))}
          </div>
        </>
      )}
    </>
  );
}

// Pill with a dropdown menu; used inside the composer row.
function PillMenu({ icon, label, has, open, onToggle, children, wide }) {
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') onToggle?.(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onToggle]);
  return (
    <span className="pop-wrap">
      <button type="button" className={`pill${has ? ' has' : ''}`} onClick={onToggle}>
        <Icon name={icon} /> {label} <span className="caret">▾</span>
      </button>
      {open && (
        <>
          <div className="menu-backdrop" onClick={onToggle} />
          <div className="menu popover" style={wide ? { minWidth: 238 } : undefined}>
            {children}
          </div>
        </>
      )}
    </span>
  );
}

// The big rounded prompt card: textarea + mic + Product/Images/Aspect pills + CTA.
// onGenerate({prompt, productId, ingredients:{images,productUrl?}, aspectRatio})
export default function Composer({
  seed,               // {text} — when set, fills the textarea (suggestion "Use")
  busy, note,
  cta = 'Generate Brief',
  placeholder = 'Describe the campaign you want to create',
  disclaimer = 'Marque can make mistakes, so double-check it.',
  onGenerate,
  onAspect,             // (ar) => {} — live pill state, so parents never go stale
}) {
  const { profile, say } = useApp();
  const nav = useNavigate();
  const [searchParams] = useSearchParams();
  const [prompt, setPrompt] = useState('');
  const [productId, setProductId] = useState(() => searchParams.get('product') || '');
  const [images, setImages] = useState([]);      // asset paths, ≤3
  const [aspect, setAspectState] = useState('4:5');
  const setAspect = (a) => { setAspectState(a); onAspect?.(a); };
  const [menu, setMenu] = useState(null);        // 'product' | 'images' | 'aspect'

  useEffect(() => {
    if (!seed) return;
    if (seed.text != null) setPrompt(seed.text);
    if (seed.productId != null) setProductId(seed.productId);
  }, [seed]);

  const catalog = profile?.catalog || [];
  const profileImages = profile?.images || [];
  const product = catalog.find((p) => p.id === productId);

  const toggleImg = (path) =>
    setImages((im) => (im.includes(path) ? im.filter((x) => x !== path) : im.length < 3 ? [...im, path] : im));

  const submit = () => {
    if (busy || !prompt.trim()) return;
    onGenerate?.({
      prompt: prompt.trim(),
      productId: productId || undefined,
      ingredients: {
        images,
        ...(product?.url ? { productUrl: product.url } : {}),
      },
      aspectRatio: aspect,
    });
  };

  return (
    <>
      <div className="composer">
        <textarea
          value={prompt}
          placeholder={placeholder}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit(); }}
        />
        <button className="icon-btn mic" title="Dictate (coming soon)" type="button"
          onClick={() => say?.('Dictation is coming soon')}>
          <Icon name="mic" />
        </button>
        <div className="row">
          <PillMenu
            icon="bag" label={product ? `Product · ${product.name}` : 'Product'} has={!!product}
            open={menu === 'product'} onToggle={() => setMenu(menu === 'product' ? null : 'product')}>
            <div className="menu-title">Campaign product</div>
            <button className={!productId ? 'on' : ''} onClick={() => { setProductId(''); setMenu(null); }}>None</button>
            {catalog.map((p) => (
              <button key={p.id} className={productId === p.id ? 'on' : ''}
                onClick={() => { setProductId(p.id); setMenu(null); }}>
                {p.name}
              </button>
            ))}
            {!catalog.length && (
              <button onClick={() => { setMenu(null); nav('/profile/catalog'); }}>
                No catalog items yet — add one →
              </button>
            )}
          </PillMenu>

          <PillMenu
            icon="image" label={images.length ? `Images · ${images.length}` : 'Images'} has={!!images.length}
            open={menu === 'images'} onToggle={() => setMenu(menu === 'images' ? null : 'images')} wide>
            <div className="menu-title">Ingredients — up to 3</div>
            {profileImages.length ? (
              <div className="img-pick">
                {profileImages.filter((im) => im.path).map((im) => (
                  <button key={im.id || im.path} className={images.includes(im.path) ? 'sel' : ''}
                    title={im.caption || ''} onClick={() => toggleImg(im.path)}>
                    <img src={im.path} alt={im.caption || 'asset'} />
                  </button>
                ))}
              </div>
            ) : (
              <button onClick={() => { setMenu(null); nav('/profile/assets'); }}>
                No images yet — add some in Assets →
              </button>
            )}
            {!!images.length && <button onClick={() => setImages([])}>Clear selection</button>}
          </PillMenu>

          <PillMenu
            icon="aspect" label={`Aspect Ratio · ${aspect}`} has
            open={menu === 'aspect'} onToggle={() => setMenu(menu === 'aspect' ? null : 'aspect')}>
            <div className="menu-title">Creative format</div>
            {ASPECTS.map((a) => (
              <button key={a} className={aspect === a ? 'on' : ''} onClick={() => { setAspect(a); setMenu(null); }}>
                {a}{a === '9:16' ? ' · vertical (animatable)' : ''}
              </button>
            ))}
          </PillMenu>

          <span className="grow" />
          <button className="btn lime" disabled={busy || !prompt.trim()} onClick={submit}>
            {busy ? <span className="spinner" /> : <Icon name="sparkle" />} {busy ? 'Working…' : cta}
          </button>
        </div>
      </div>
      {note ? (
        <div className="gen-note"><span className="spinner" />{note}</div>
      ) : (
        disclaimer && <div className="disclaimer">{disclaimer}</div>
      )}
    </>
  );
}
