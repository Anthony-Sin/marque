import React, { useState } from 'react';
import Icon from './Icon.jsx';

// <FieldEdit label kind value onSave renderValue? hint? placeholder? />
// Inline-editable profile field row: label | value | pencil.
// kind: 'text' | 'textarea' | 'list' (comma-separated → string[]) |
//       'colors' (swatch row + hex add/remove → hex[]) |
//       'fonts' ({heading, body} with Aa previews) |
//       'links' ([{label,url}]) | 'quotes' ([{quote,author}])
// onSave(serialized) is awaited; throw to keep the editor open (parent should toast).

const HEX6 = /^#[0-9a-fA-F]{6}$/;
const HEX3 = /^#[0-9a-fA-F]{3}$/;
const pickerHex = (c) => {
  if (HEX6.test(c || '')) return c;
  if (HEX3.test(c || '')) return `#${c.slice(1).split('').map((x) => x + x).join('')}`;
  return '#8a8a8a';
};
const absUrl = (u) => (!u ? '' : /^https?:\/\//i.test(u) ? u : `https://${u}`);
const hostOf = (u) => { try { return new URL(absUrl(u)).hostname.replace(/^www\./, ''); } catch { return u; } };
const isUrlish = (s) => /\./.test(s) && !/\s/.test(s);

function initDraft(kind, value) {
  switch (kind) {
    case 'list': return (value || []).join(', ');
    case 'colors': return [...(value || [])];
    case 'fonts': return { heading: '', body: '', ...(value || {}) };
    case 'links':
    case 'quotes': return (value || []).map((x) => ({ ...x }));
    default: return value ?? '';
  }
}

function serialize(kind, draft) {
  switch (kind) {
    case 'list': return String(draft || '').split(',').map((s) => s.trim()).filter(Boolean);
    case 'colors': return (draft || []).map((c) => String(c).trim()).filter(Boolean);
    case 'links': return (draft || []).filter((x) => String(x.label || x.url || '').trim());
    case 'quotes': return (draft || []).filter((x) => String(x.quote || '').trim());
    default: return draft;
  }
}

// ---------- display renderers ----------
export function ValueView({ kind, value }) {
  if (kind === 'colors') {
    const list = value || [];
    if (!list.length) return <span className="muted">—</span>;
    return (
      <span className="swatches wrap">
        {list.map((c, i) => (
          <span key={i} className="pf-swatch">
            <span className="swatch" style={{ background: c }} />
            <span className="pf-hex">{c}</span>
          </span>
        ))}
      </span>
    );
  }
  if (kind === 'fonts') {
    const f = value || {};
    const slot = (name, lbl) => (
      <span className="pf-font-prev">
        <span className="font-aa" style={{ fontFamily: `'${name || 'Inter'}', sans-serif` }}>Aa</span>
        <span>{name || '—'}</span>
        <em>{lbl}</em>
      </span>
    );
    return <span className="pf-fonts-view">{slot(f.heading, 'heading')}{slot(f.body, 'body')}</span>;
  }
  if (kind === 'links') {
    const list = value || [];
    if (!list.length) return <span className="muted">—</span>;
    return (
      <span className="taglist">
        {list.map((l, i) => (
          <a key={i} className="tag pf-taglink" href={absUrl(l.url)} target="_blank" rel="noreferrer">
            <Icon name="link" size={11} /> {l.label || hostOf(l.url) || l.url}
          </a>
        ))}
      </span>
    );
  }
  if (kind === 'quotes') {
    const list = value || [];
    if (!list.length) return <span className="muted">—</span>;
    return (
      <span className="pf-quotes">
        {list.map((t, i) => (
          <span key={i} className="pf-quote">
            “{t.quote}”{t.author ? <span className="muted"> — {t.author}</span> : null}
          </span>
        ))}
      </span>
    );
  }
  if (kind === 'list') {
    const list = value || [];
    if (!list.length) return <span className="muted">—</span>;
    return <span className="taglist">{list.map((t, i) => <span key={i} className="tag">{t}</span>)}</span>;
  }
  return <span>{value || <span className="muted">—</span>}</span>;
}

// ---------- editors ----------
function ColorsEditor({ draft, setDraft }) {
  const [hex, setHex] = useState('');
  const set = (i, c) => setDraft(draft.map((x, j) => (j === i ? c : x)));
  const rm = (i) => setDraft(draft.filter((_, j) => j !== i));
  const add = () => {
    let h = hex.trim();
    if (h && !h.startsWith('#')) h = `#${h}`;
    if (!HEX6.test(h) && !HEX3.test(h)) return;
    setDraft([...draft, h.toLowerCase()]);
    setHex('');
  };
  return (
    <div>
      <div className="small muted mb8">Click a swatch to change it · the × removes it</div>
      <div className="swatches wrap">
        {draft.map((c, i) => (
          <span key={i} className="pf-swatch-edit">
            <label className="swatch" style={{ background: pickerHex(c), position: 'relative', overflow: 'hidden', cursor: 'pointer' }} title={c}>
              <input
                type="color"
                value={pickerHex(c)}
                onChange={(e) => set(i, e.target.value)}
                style={{ position: 'absolute', inset: 0, opacity: 0, cursor: 'pointer' }}
              />
            </label>
            <button type="button" className="pf-swatch-x" title="Remove color" onClick={() => rm(i)}>
              <Icon name="x" size={9} sw={2.6} />
            </button>
            <span className="pf-hex">{c}</span>
          </span>
        ))}
        <span className="pf-swatch-add">
          <input
            value={hex}
            onChange={(e) => setHex(e.target.value)}
            placeholder="#a1b2c3"
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); add(); }
            }}
          />
          <button type="button" className="btn ghost sm" onClick={add}><Icon name="plus" size={13} /> Add color</button>
        </span>
      </div>
    </div>
  );
}

function FontsEditor({ draft, setDraft }) {
  const slot = (key, lbl) => (
    <div className="pf-font-slot" key={key}>
      <div className="font-aa" style={{ fontFamily: `'${draft[key] || 'Inter'}', sans-serif` }}>Aa</div>
      <input
        value={draft[key] || ''}
        onChange={(e) => setDraft({ ...draft, [key]: e.target.value })}
        placeholder={`${lbl} font name`}
      />
      <div className="pf-font-slot-lbl">{lbl}</div>
    </div>
  );
  return <div className="pf-fonts-edit">{slot('heading', 'Heading')}{slot('body', 'Body')}</div>;
}

function PairsEditor({ draft, setDraft, keys, placeholders, addLabel }) {
  const [a, b] = keys;
  const set = (i, k, v) => setDraft(draft.map((x, j) => (j === i ? { ...x, [k]: v } : x)));
  return (
    <div className="pf-pairs">
      {draft.map((x, i) => (
        <div className="pf-pair" key={i}>
          <input value={x[a] || ''} placeholder={placeholders[0]} onChange={(e) => set(i, a, e.target.value)} />
          <input value={x[b] || ''} placeholder={placeholders[1]} onChange={(e) => set(i, b, e.target.value)} />
          <button type="button" className="icon-btn" title="Remove" onClick={() => setDraft(draft.filter((_, j) => j !== i))}>
            <Icon name="x" size={13} />
          </button>
        </div>
      ))}
      <div>
        <button type="button" className="btn ghost sm" onClick={() => setDraft([...draft, { [a]: '', [b]: '' }])}>
          <Icon name="plus" size={13} /> {addLabel}
        </button>
      </div>
    </div>
  );
}

function Editor({ kind, draft, setDraft, placeholder }) {
  switch (kind) {
    case 'textarea':
      return <textarea rows={5} value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={placeholder} autoFocus />;
    case 'list':
      return <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={placeholder || 'comma, separated, values'} autoFocus />;
    case 'colors':
      return <ColorsEditor draft={draft} setDraft={setDraft} />;
    case 'fonts':
      return <FontsEditor draft={draft} setDraft={setDraft} />;
    case 'links':
      return <PairsEditor draft={draft} setDraft={setDraft} keys={['label', 'url']} placeholders={['Button label', 'https://…']} addLabel="Add link" />;
    case 'quotes':
      return <PairsEditor draft={draft} setDraft={setDraft} keys={['quote', 'author']} placeholders={['“It changed our mornings.”', 'Customer name']} addLabel="Add testimonial" />;
    default:
      return <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={placeholder} autoFocus />;
  }
}

// ---------- the row ----------
export default function FieldEdit({ label, hint, kind = 'text', value, onSave, renderValue, placeholder }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(null);
  const [busy, setBusy] = useState(false);

  const start = () => { setDraft(initDraft(kind, value)); setEditing(true); };
  const cancel = () => { setEditing(false); setDraft(null); };
  const apply = async () => {
    setBusy(true);
    try {
      await onSave(serialize(kind, draft));
      setEditing(false);
      setDraft(null);
    } catch { /* parent toasted — keep editor open */ }
    finally { setBusy(false); }
  };

  return (
    <div
      className={`field${editing ? ' editing' : ''}`}
      onKeyDown={(e) => {
        if (e.key === 'Escape' && editing) {
          e.preventDefault();
          cancel();
          return;
        }
        if (e.key === 'Enter' && e.target.tagName === 'INPUT' && ['text', 'list'].includes(kind)) {
          e.preventDefault();
          apply();
        }
      }}
    >
      <div className="f-label">
        {label}
        {hint && <div className="pf-hint">{hint}</div>}
      </div>
      <div className="f-val">
        {editing ? (
          <>
            <Editor kind={kind} draft={draft} setDraft={setDraft} placeholder={placeholder} />
            <div className="row mt8">
              <button type="button" className="btn lime sm" onClick={apply} disabled={busy}>
                {busy && <span className="spinner" />}{busy ? 'Saving…' : 'Apply'}
              </button>
              <button type="button" className="btn ghost sm" onClick={cancel} disabled={busy}>Cancel</button>
            </div>
          </>
        ) : (
          renderValue ? renderValue(value) : <ValueView kind={kind} value={value} />
        )}
      </div>
      {!editing && (
        <button type="button" className="f-edit" title={`Edit ${label || 'field'}`} onClick={start}>
          <Icon name="edit" size={15} />
        </button>
      )}
    </div>
  );
}
