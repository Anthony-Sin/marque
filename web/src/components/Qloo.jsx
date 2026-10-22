import React, { useState } from 'react';
import Icon from './Icon.jsx';

// <QlooBadge mode="live"|"demo" label="…" /> — the everywhere-visible taste marker.
export function QlooBadge({ mode = 'live', label, small }) {
  return (
    <span className={`qloo-badge${mode === 'demo' ? ' demo' : ''}`} title={mode === 'demo' ? 'Qloo demo data — live key pending' : 'Powered by Qloo taste graph'}>
      <Icon name="qloo" size={11} sw={2} /> {label || 'Powered by Qloo'}{mode === 'demo' ? ' · demo' : ''}
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
        <span key={i} className="signal-chip" title={`affinity ${s.affinity ?? ''}`.trim()}>
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
  const mode = bundle.mode === 'live' ? 'live' : 'demo';
  const cat = (t) => t.replace('urn:entity:', '').replace('_', ' ');
  return (
    <div className="card pad taste-panel">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h3 style={{ margin: 0, fontSize: 17 }}>
          Taste Signature
        </h3>
        <QlooBadge mode={mode} />
      </div>
      <p className="muted small" style={{ margin: '6px 0 14px' }}>
        What your audience also loves — correlations from Qloo's taste graph that ground every campaign we generate.
      </p>
      {bundle.entity && (
        <div className="small muted mb8">matched entity: <b style={{ color: 'var(--ink)' }}>{bundle.entity.name}</b></div>
      )}
      {(bundle.affinities || []).slice(0, compact ? 2 : 4).map((a) => (
        <div key={a.type} className="mb8">
          <div className="small" style={{ color: 'var(--ink-3)', textTransform: 'capitalize', marginBottom: 4 }}>{cat(a.type)}</div>
          {(a.entities || []).slice(0, 5).map((e) => (
            <div key={e.id || e.name} className="affin-row">
              <span className="affin-name small">{e.name}</span>
              <span className="affin-bar"><i style={{ width: `${Math.round((e.affinity ?? 0) * 100)}%` }} /></span>
              <span className="affin-score">{e.affinity != null ? e.affinity.toFixed(2) : '—'}</span>
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
