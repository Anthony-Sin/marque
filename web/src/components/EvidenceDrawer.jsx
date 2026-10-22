import React from 'react';
import { useApp } from '../App.jsx';
import Icon from './Icon.jsx';
import { QlooBadge, SignalChips } from './Qloo.jsx';
import '../views/studio.css';

// Right slide-over: the Qloo evidence trail — signals the asset was grounded in,
// plus the raw calls recorded on the profile's taste bundle.
export default function EvidenceDrawer({ title = 'Taste evidence', signals = [], extra = [], onClose }) {
  const { profile } = useApp();
  const bundle = profile?.qloo;
  const calls = bundle?.calls || [];
  const all = [...signals, ...extra];

  return (
    <>
      <div className="drawer-veil" onClick={onClose} />
      <aside className="drawer">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <h3><Icon name="qloo" size={18} /> {title}</h3>
          <button className="icon-btn" onClick={onClose}><Icon name="x" size={16} /></button>
        </div>
        <p className="drawer-sub">
          Correlations from Qloo's cultural taste graph that grounded this work.
        </p>
        <QlooBadge mode={bundle?.mode === 'live' ? 'live' : 'demo'} />

        {!!all.length && (
          <>
            <div className="section-label">Signals applied</div>
            {all.map((s, i) => (
              <div key={i} className="affin-row">
                <span className="affin-name small">
                  {s.entity || s.name}
                  {s.type && <span className="muted"> · {String(s.type).replace('urn:entity:', '')}</span>}
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
            <div className="section-label">Profile taste signature</div>
            <SignalChips
              signals={bundle.affinities.flatMap((a) => (a.entities || []).slice(0, 2))}
              max={10} />
          </>
        )}

        <div className="section-label">Evidence trail · {calls.length} Qloo calls</div>
        {calls.length ? calls.map((c, i) => (
          <div key={i} className="call-line">
            <b>{c.endpoint}</b>{' '}
            {Object.entries(c.params || {}).map(([k, v]) => `${k}=${String(v).slice(0, 48)}`).join(' ')}
            {c.n != null && <span> → {c.n} results</span>}
            {c.tookMs != null && <span> · {c.tookMs}ms</span>}
          </div>
        )) : (
          <p className="muted small">No recorded calls — the taste bundle may still be building.</p>
        )}
      </aside>
    </>
  );
}
