import React, { useEffect } from 'react';
import { useApp } from '../App.jsx';
import Icon from './Icon.jsx';
import { QlooBadge } from './Qloo.jsx';
import '../views/studio.css';

// Right slide-over: the Qloo evidence trail — every signal type the asset was
// grounded in, plus the raw call log (live or failed, never synthesized).
export default function EvidenceDrawer({ title = 'Taste evidence', signals = [], extra = [], bundle: bundleProp, calls: callsProp, info = null, onClose }) {
  const { profile } = useApp();
  // the asset's OWN board bundle wins — the global profile bundle is generic
  const bundle = bundleProp || profile?.qloo;
  const calls = callsProp || bundle?.calls || [];
  const all = [...signals, ...extra];
  // the badge reflects the calls actually shown — live / partial / error
  const badgeMode = calls.length
    ? (calls.every((c) => c.mode === 'live') ? 'live' : calls.some((c) => c.mode === 'live') ? 'partial' : 'error')
    : (bundle?.mode === 'live' ? 'live' : bundle?.mode === 'partial' ? 'partial' : bundle ? 'error' : 'off');

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const cat = (t) => String(t || '').replace('urn:entity:', '').replace(/_/g, ' ');

  return (
    <>
      <div className="drawer-veil" onClick={onClose} />
      <aside className="drawer" role="dialog" aria-label="Taste evidence">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <h3><Icon name="qloo" size={18} /> {title}</h3>
          <button className="icon-btn" onClick={onClose} aria-label="Close"><Icon name="x" size={16} /></button>
        </div>
        <p className="drawer-sub">
          Real calls to Qloo's cultural taste graph that grounded this work — every type, every call, failures included.
        </p>
        <QlooBadge mode={badgeMode} />

        {!!info && (
          <>
            <div className="section-label">This asset</div>
            <div className="call-line" style={{ border: '1px solid var(--line-soft)', borderRadius: 8, padding: '8px 10px' }}>
              {info}
            </div>
          </>
        )}

        {!!all.length && (
          <>
            <div className="section-label">Signals applied</div>
            {all.map((s, i) => (
              <div key={i} className="affin-row">
                <span className="affin-name small">
                  {s.entity || s.name}
                  {s.type && <span className="muted"> · {cat(s.type)}</span>}
                </span>
                {s.affinity != null && (
                  <>
                    <span className="affin-bar"><i style={{ width: `${Math.round(s.affinity * 100)}%` }} /></span>
                    <span className="affin-score">{s.affinity.toFixed(2)}</span>
                  </>
                )}
              </div>
            ))}
          </>
        )}

        {!!bundle?.affinities?.length && (
          <>
            <div className="section-label">Taste signature — every type pulled, cited or not</div>
            {bundle.affinities.map((a) => (
              <div key={a.type} style={{ marginBottom: 10 }}>
                <div className="small" style={{ color: 'var(--ink-3)', textTransform: 'capitalize', marginBottom: 3 }}>
                  {cat(a.type)}
                  {a.error && <span style={{ color: 'var(--rose, #e88)' }}> · call failed — {String(a.error).slice(0, 60)}</span>}
                </div>
                {!a.error && (a.entities || []).slice(0, 8).map((e, i) => (
                  <div key={e.id || i} className="affin-row" title={e.description || e.tagline || e.name}>
                    <span className="affin-name small">{e.name}</span>
                    <span className="affin-bar"><i style={{ width: `${Math.round((e.affinity ?? 0) * 100)}%` }} /></span>
                    <span className="affin-score" title={`affinity ${e.affinity != null ? e.affinity.toFixed(3) : 'n/a'} · popularity ${e.popularity != null ? (+e.popularity).toFixed(3) : 'n/a'}`}>
                      {e.affinity != null ? e.affinity.toFixed(2) : '—'}
                      {e.popularity != null && <i className="affin-pop">/{(+e.popularity).toFixed(2)}</i>}
                    </span>
                  </div>
                ))}
              </div>
            ))}
          </>
        )}

        <div className="section-label">Evidence trail · {calls.length} Qloo calls</div>
        {calls.length ? calls.map((c, i) => (
          <div key={i} className="call-line">
            <b>{c.endpoint}</b>{' '}
            {Object.entries(c.params || {}).map(([k, v]) => `${k}=${String(v).slice(0, 48)}`).join(' ')}
            {c.n != null && <span> → {c.n} results</span>}
            {c.tookMs != null && <span> · {c.tookMs}ms</span>}
            {!!c.mode && c.mode !== 'live' && (
              <span style={{ color: 'var(--rose, #e88)' }} title={c.error || ''}> · {c.mode}{c.error ? ` — ${String(c.error).slice(0, 80)}` : ''}</span>
            )}
          </div>
        )) : (
          <p className="muted small">No recorded calls — no taste bundle was linked to this asset when it was generated.</p>
        )}
      </aside>
    </>
  );
}
