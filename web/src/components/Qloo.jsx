import React, { useState } from 'react';
import Icon from './Icon.jsx';
import { epLabel, cleanErr } from '../labels.js';

// <QlooBadge mode="live"|"partial"|"error"|"off" label="…" /> — the everywhere-visible taste marker.
// No simulated/demo modes: calls are live or they failed visibly. A badge only
// renders when data is flowing — failed/off states are explained by the
// evidence trail, not by a dead chip.
const MODE_SUFFIX = { live: ' · live', partial: ' · limited' };
const MODE_TITLE = {
  live: 'Live audience data — every call reached the taste graph',
  partial: 'Some taste calls failed — the evidence trail shows which and why',
};
// Callers sometimes pass the raw vendor name as a label — never print it.
const humanLabel = (l) => {
  const s = String(l || '').replace(/qloo(\s*api)?/gi, '').replace(/^[\s·—–-]+|[\s·—–-]+$/g, '');
  return s || 'Taste signals';
};
export function QlooBadge({ mode = 'live', label, small }) {
  const m = mode === 'live' ? 'live' : mode === 'partial' ? 'partial' : null;
  if (!m) return null;
  return (
    <span className={`qloo-badge${m === 'partial' ? ' partial' : ''}`} title={MODE_TITLE[m]}>
      <Icon name="qloo" size={11} sw={2} /> {humanLabel(label)}{MODE_SUFFIX[m]}
    </span>
  );
}

// <SignalChips signals={[{entity,affinity}]} /> — little lime chips showing the
// affinities a creative/brief was grounded in.
export function SignalChips({ signals = [], max = 4 }) {
  if (!signals.length) return null;
  return (
    <span className="row wrap" style={{ gap: 5 }}>
      {signals.slice(0, max).map((s, i) => (
        <span key={i} className="signal-chip"
          title={`${s.entity || s.name} — audience overlap ${s.affinity != null ? (+s.affinity).toFixed(2) : 'n/a'} (0–1, higher = stronger pull)`}>
          {s.entity || s.name}
        </span>
      ))}
      {signals.length > max && <span className="signal-chip">+{signals.length - max}</span>}
    </span>
  );
}

// <TastePanel bundle={profile.qloo} /> — the "Taste Signature" card.
// bundle: {entity, tags, affinities:[{type,entities:[{id,name,affinity,popularity}]}], calls, mode, fetchedAt}
export function TastePanel({ bundle, compact }) {
  const [showCalls, setShowCalls] = useState(false);
  if (!bundle) return null;
  const mode = bundle.mode === 'live' ? 'live' : bundle.mode === 'partial' ? 'partial' : 'error';
  const cat = (t) => t.replace('urn:entity:', '').replace('_', ' ');
  // params → a readable arg line — seed id lists collapse to counts so no
  // urn:entity:/UUID internals print verbatim
  const callArgsLine = (c) => Object.entries(c.params || {}).map(([k, v]) => {
    const s = String(v);
    if (/^signal\.interests\.(entities|tags)$/.test(k)) {
      const n = s.split(',').filter(Boolean).length;
      return `${n} ${k.endsWith('tags') ? 'tag' : 'entity'} seed${n === 1 ? '' : 's'}`;
    }
    if (k === 'filter.type') return `type ${cat(s)}`;
    return `${k.replace(/^filter\./, '')}=${s.replace(/urn:entity:[\w:-]+/g, 'entity').slice(0, 40)}`;
  }).join(' · ');
  return (
    <div className="card pad taste-panel">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h3 style={{ margin: 0, fontSize: 17 }}>
          Taste Signature
        </h3>
        <QlooBadge mode={mode} label="Audience data" />
      </div>
      <p className="muted small" style={{ margin: '6px 0 4px' }}>
        What your audience also loves — correlations from the taste graph that ground every campaign we generate.
      </p>
      <p className="muted small" style={{ margin: '0 0 12px', fontSize: 10.5 }}>
        affinity = how strongly fans of your brand pull toward this entity (0–1, &gt;0.8 is a strong pull) · popularity = how big the entity is overall. High affinities cluster because the graph ranks within your audience, not the whole world.
      </p>
      {bundle.entity && (
        <div className="small muted mb8">matched entity: <b style={{ color: 'var(--ink)' }}>{bundle.entity.name}</b></div>
      )}
      {!bundle.affinities?.length && (
        <div className="small muted" style={{ padding: '14px 0 4px' }}>
          No taste signals yet{bundle.entity?.name ? ` for "${bundle.entity.name}"` : ''} — enrich your Business Profile
          (website, products, or brand details) and we'll match what your audience also loves.
        </div>
      )}
      {(bundle.affinities || []).slice(0, compact ? 2 : 4).map((a) => (
        <div key={a.type} className="mb8">
          <div className="small" style={{ color: 'var(--ink-3)', textTransform: 'capitalize', marginBottom: 4 }}>{cat(a.type)}</div>
          {a.error && (
            <div className="small" style={{ color: 'var(--rose, #e88)', padding: '4px 0' }} title={a.error}>
              Taste data couldn't be reached — retry
            </div>
          )}
          {(a.entities || []).slice(0, compact ? 3 : 5).map((e, ei) => (
            <div key={e.id || `${e.name}-${ei}`} className="affin-row rich">
              {e.image
                ? <img className="affin-thumb" src={e.image} alt="" loading="lazy" referrerPolicy="no-referrer" />
                : <span className="affin-thumb ph">{(e.name || '?')[0]}</span>}
              <span className="affin-col">
                <span className="affin-name small" title={e.description || undefined}>{e.name}</span>
                {!!e.keywords?.length && (
                  <span className="affin-kws">
                    {e.keywords.slice(0, 3).map((k) => <i key={k}>{k}</i>)}
                  </span>
                )}
                {!e.keywords?.length && !!e.tagline && <span className="affin-kws"><i>{e.tagline.slice(0, 44)}</i></span>}
              </span>
              <span className="affin-bar"><i style={{ width: `${Math.round((e.affinity ?? 0) * 100)}%` }} /></span>
              <span className="affin-score" title={e.popularity != null ? `popularity ${(+e.popularity).toFixed(2)}` : undefined}>{e.affinity != null ? e.affinity.toFixed(2) : '—'}</span>
            </div>
          ))}
        </div>
      ))}
      {!!bundle.calls?.length && (
        <div className="mt8">
          <button className="btn ghost sm" onClick={() => setShowCalls(!showCalls)}>
            {showCalls ? 'hide' : 'show'} evidence · {bundle.calls.length} audience calls
          </button>
          {showCalls && (
            <div className="mt8 small muted" style={{ fontFamily: 'monospace', fontSize: 11 }}>
              {bundle.calls.map((c, i) => (
                <div key={i} style={{ padding: '3px 0', borderBottom: '1px solid var(--line-soft)' }}>
                  {epLabel(c.endpoint)} · {callArgsLine(c)}
                  {c.n != null && <span style={{ color: 'var(--lime)' }}> → {c.n} results</span>}
                  {!!c.mode && c.mode !== 'live' && <span style={{ color: 'var(--rose, #e88)' }} title={c.error || ''}> · {c.mode}{c.error ? ` — ${cleanErr(c.error)}` : ''}</span>}
                  {!!c.tookMs && <span className="muted"> · {c.tookMs}ms</span>}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default QlooBadge;
