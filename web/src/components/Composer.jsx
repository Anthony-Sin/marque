import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../App.jsx';
import Icon from './Icon.jsx';
import '../views/studio.css';

export const ASPECTS = ['1:1', '4:5', '9:16', '16:9'];
export const arCss = (ar) => (ar || '1:1').replace(':', '/');

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
}) {
  const { profile } = useApp();
  const nav = useNavigate();
  const [prompt, setPrompt] = useState('');
  const [productId, setProductId] = useState('');
  const [images, setImages] = useState([]);      // asset paths, ≤3
  const [aspect, setAspect] = useState('4:5');
  const [menu, setMenu] = useState(null);        // 'product' | 'images' | 'aspect'

  useEffect(() => { if (seed && seed.text != null) setPrompt(seed.text); }, [seed]);

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
        <button className="icon-btn mic" title="Dictate (coming soon)" type="button">
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
                {profileImages.map((im) => (
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
