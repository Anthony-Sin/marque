import React, { useState } from 'react';
import Icon from './Icon.jsx';

// <QlooBadge mode="live"|"partial"|"error"|"off" label="…" /> — the everywhere-visible taste marker.
// No simulated/demo modes: calls are live or they failed visibly.
const MODE_LABEL = { live: ' · live', partial: ' · partial', error: ' · failed', off: ' · off' };
const MODE_TITLE = {
  live: 'Every call hit the live Qloo taste graph',
  partial: 'Some Qloo calls failed — the trail shows which and why',
  error: 'Qloo calls failed — see the call trail for the error',
  off: 'Qloo not configured — no taste calls made',
};
export function QlooBadge({ mode = 'live', label, small }) {
  const m = MODE_LABEL[mode] !== undefined ? mode : 'off';
  return (
    <span className={`qloo-badge${m === 'live' ? '' : m === 'partial' ? ' partial' : ' demo'}`} title={MODE_TITLE[m]}>
      <Icon name="qloo" size={11} sw={2} /> {label || 'Taste intelligence'}{MODE_LABEL[m]}
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
          title={`${s.entity || s.name} — Qloo taste-graph correlation ${s.affinity != null ? (+s.affinity).toFixed(2) : 'n/a'} (0–1, higher = stronger pull)`}>
          {s.entity || s.name}
          {s.affinity != null && <b>{(+s.affinity).toFixed(2)}</b>}
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
  return (
    <div className="card pad taste-panel">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h3 style={{ margin: 0, fontSize: 17 }}>
          Taste Signature
        </h3>
        <QlooBadge mode={mode} />
      </div>
      <p className="muted small" style={{ margin: '6px 0 4px' }}>
        What your audience also loves — correlations from Qloo's taste graph that ground every campaign we generate.
      </p>
      <p className="muted small" style={{ margin: '0 0 12px', fontSize: 10.5 }}>
        affinity = how strongly fans of your brand pull toward this entity (0–1, &gt;0.8 is a strong pull) · popularity = how big the entity is overall. High affinities cluster because Qloo ranks within your audience, not the whole world.
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
              insights call failed — {String(a.error).slice(0, 80)}
            </div>
          )}
          {(a.entities || []).slice(0, compact ? 3 : 5).map((e) => (
            <div key={e.id || e.name} className="affin-row rich">
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
            {showCalls ? 'hide' : 'show'} evidence · {bundle.calls.length} Qloo calls
          </button>
          {showCalls && (
            <div className="mt8 small muted" style={{ fontFamily: 'monospace', fontSize: 11 }}>
              {bundle.calls.map((c, i) => (
                <div key={i} style={{ padding: '3px 0', borderBottom: '1px solid var(--line-soft)' }}>
                  {c.endpoint} · {Object.entries(c.params || {}).map(([k, v]) => `${k}=${String(v).slice(0, 40)}`).join(' ')}
                  {c.n != null && <span style={{ color: 'var(--lime)' }}> → {c.n} results</span>}
                  {!!c.mode && c.mode !== 'live' && <span style={{ color: 'var(--rose, #e88)' }} title={c.error || ''}> · {c.mode}{c.error ? ` — ${String(c.error).slice(0, 60)}` : ''}</span>}
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
