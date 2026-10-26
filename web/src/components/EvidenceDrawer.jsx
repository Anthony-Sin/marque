import React, { useEffect, useRef, useState } from 'react';
import { useApp } from '../App.jsx';
import Icon from './Icon.jsx';
import { QlooBadge } from './Qloo.jsx';
import { epLabel } from '../labels.js';
import { useOverlayFocus } from '../focus.js';
import '../views/studio.css';
import './evidence.css';

// What a call record actually carries (server qloo.js):
//   { endpoint, params, at, tookMs, n, mode: 'live'|'error', error? }
// There is no per-call payload copy, no cache flag, no status code — the
// drawer surfaces only fields that exist, and says so where data runs out.
// The one safe correlation: an insights call's returned entities are stored
// 1:1 in the bundle as the affinity group for its params['filter.type']
// (enrichProfile pulls each class exactly once, retries included).

const cat = (t) => String(t || '').replace('urn:entity:', '').replace(/_/g, ' ');
const pad = (n) => String(n).padStart(2, '0');
const clockOf = (t) => { const d = new Date(t); return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`; };
const dayOf = (t) => new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

// relative stamp — future/skewed timestamps (clock drift between server and
// client) and stale ones degrade to absolute dates rather than lying
function relTime(at) {
  const t = Date.parse(at);
  if (Number.isNaN(t)) return null;
  const diff = Date.now() - t;
  if (diff < -60e3) return `${dayOf(t)} ${clockOf(t)}`;
  if (diff < 60e3) return 'just now';
  const m = Math.round(diff / 60e3); if (m < 60) return `${m}m ago`;
  const h = Math.round(diff / 36e5); if (h < 48) return `${h}h ago`;
  const d = Math.round(diff / 864e5); if (d < 45) return `${d}d ago`;
  return dayOf(t);
}

const fmtDur = (ms) => (ms == null ? null : ms >= 60000 ? `${(ms / 60000).toFixed(1)}m` : ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`);

// humanized label — 'enrichProfile' is a synthetic wrapper record for a failed
// pull, not a graph endpoint; everything else goes through epLabel
const callLabel = (c) => (c?.endpoint === 'enrichProfile' ? 'profile enrichment' : epLabel(c?.endpoint));

// the entity class a call targeted — a chip only when the params say so
function callClass(c) {
  const t = c?.params?.['filter.type'];
  if (t) return cat(t);
  if (c?.endpoint === '/v2/tags') return 'tag';
  if (c?.endpoint === '/search') return 'entity';
  return null;
}

const KNOWN_PARAMS = new Set(['query', 'filter.query', 'filter.type', 'signal.interests.entities', 'signal.interests.tags', 'take']);
// params → readable arg chips. Seed URNs/UUIDs become counts — the seed is
// named only when the bundle ties it to bundle.entity (a real match).
function callArgs(c, bundle) {
  const p = c?.params || {};
  const out = [];
  const q = p.query ?? p['filter.query'];
  if (q != null && q !== '') out.push(`“${String(q).slice(0, 42)}”`);
  const se = p['signal.interests.entities'];
  if (se) {
    const ids = String(se).split(',').filter(Boolean);
    const named = bundle?.entity?.id && ids.includes(bundle.entity.id) ? bundle.entity.name : null;
    out.push(named ? `seed ${named}` : `seed ${ids.length} ${ids.length === 1 ? 'entity' : 'entities'}`);
  }
  const st = p['signal.interests.tags'];
  if (st) {
    const n = String(st).split(',').filter(Boolean).length;
    out.push(`+${n} tag seed${n === 1 ? '' : 's'}`);
  }
  if (p.take != null && p.take !== '') out.push(`take ${p.take}`);
  for (const [k, v] of Object.entries(p)) {
    if (KNOWN_PARAMS.has(k) || v == null || v === '') continue;
    out.push(`${k.replace(/^(filter|signal)\./, '')} ${String(v).slice(0, 30)}`);
  }
  return out;
}

// an insights call's returned payload — the affinity group for its class.
// /search hit lists and /v2/tags payloads are NOT retained per call, so
// those rows honestly show no "returned" section.
function returnedFor(c, bundle) {
  if (c?.endpoint !== '/v2/insights' || c?.mode !== 'live') return null;
  const t = c?.params?.['filter.type'];
  if (!t) return null;
  const g = (bundle?.affinities || []).find((a) => a.type === t);
  return g && !g.error && (g.entities || []).length ? g.entities : null;
}

const msTier = (ms) => (ms == null ? '' : ms < 1200 ? ' ok' : ms >= 5000 ? ' slow' : '');

// one call = one forensic row: sequence no, live led, humanized label, class
// chip, raw endpoint path, args, result count, latency badge, timestamp,
// failure reason — and an expandable "returned" list where one exists.
function CallRow({ c, idx, bundle, matchedName }) {
  const [open, setOpen] = useState(false);
  const live = c?.mode === 'live';
  const klass = callClass(c);
  const args = callArgs(c, bundle);
  const ents = returnedFor(c, bundle);
  const top = (ents || []).slice(0, 3);
  const rel = relTime(c?.at);
  return (
    <div className={`ev-call${live ? '' : ' err'}`}>
      <div className="ev-head">
        <span className="ev-idx">{pad(idx + 1)}</span>
        <i className="ev-led" aria-hidden="true" />
        <b className="ev-ep">{callLabel(c)}</b>
        {klass && <span className="ev-chip">{klass}</span>}
        {!!c?.endpoint && c.endpoint !== 'enrichProfile' && <span className="ev-path">{c.endpoint}</span>}
        {rel && <span className="ev-when" title={c.at}>{rel}</span>}
      </div>
      {!!args.length && (
        <div className="ev-args">{args.map((a, i) => <span key={i} className="ev-arg">{a}</span>)}</div>
      )}
      <div className="ev-meta">
        <span className="ev-n">{c?.n ?? '—'} {(c?.n ?? 0) === 1 ? 'result' : 'results'}</span>
        {c?.tookMs != null && <span className={`ev-ms${msTier(c.tookMs)}`} title="graph response time">{fmtDur(c.tookMs)}</span>}
        {!live && <span className="ev-fail" title={c?.error || undefined}>failed{c?.error ? ` — ${String(c.error).slice(0, 90)}` : ''}</span>}
        {!!matchedName && <span className="ev-match">matched → {matchedName}</span>}
        {!!ents && (
          <button type="button" className="ev-ret" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
            returned {top.length}/{c?.n ?? ents.length} <Icon name="chevron-down" size={10} sw={2.4} />
          </button>
        )}
      </div>
      {open && !!ents && (
        <div className="ev-ret-list">
          {top.map((e, i) => (
            <div key={e.id || `${e.name}-${i}`} className="affin-row" title={e.description || e.tagline || e.name || undefined}>
              <span className="affin-name small">{e.name}</span>
              <span className="affin-bar"><i style={{ width: `${Math.round((e.affinity ?? 0) * 100)}%` }} /></span>
              <span className="affin-score">{e.affinity != null ? e.affinity.toFixed(2) : '—'}</span>
            </div>
          ))}
          {(c?.n ?? 0) > top.length && (
            <div className="ev-ret-more">top {top.length} of {c.n} returned — the full pull sits in the taste signature above</div>
          )}
        </div>
      )}
    </div>
  );
}

// Right slide-over: the evidence trail — every signal type the asset was
// grounded in, plus the raw call log (live or failed, never synthesized).
export default function EvidenceDrawer({ title = 'Taste evidence', signals = [], extra = [], bundle: bundleProp, calls: callsProp, info = null, onClose }) {
  const { profile } = useApp();
  const boxRef = useRef(null);
  // focus lands on the drawer's close button, returns to whatever opened it
  useOverlayFocus(boxRef);
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

  // the drawer scrolls internally — lock the page behind it while mounted
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);

  // ---- summary stats — computed from real call fields only ----
  const liveN = calls.filter((c) => c?.mode === 'live').length;
  const errN = calls.length - liveN;
  const entN = calls.reduce((s, c) => s + (c?.endpoint === '/v2/tags' ? 0 : (c?.n || 0)), 0);
  const tagN = calls.reduce((s, c) => s + (c?.endpoint === '/v2/tags' ? (c?.n || 0) : 0), 0);
  const latSum = calls.reduce((s, c) => s + (c?.tookMs || 0), 0);
  const classes = new Set(calls.map((c) => c?.params?.['filter.type']).filter(Boolean));
  const times = calls.map((c) => Date.parse(c?.at)).filter((t) => !Number.isNaN(t)).sort((a, b) => a - b);
  const t0 = times[0], t1 = times[times.length - 1];
  const sameDay = t0 != null && new Date(t0).toDateString() === new Date(t1).toDateString();
  // the bundle keeps only the MATCHED entity from search, not the hit list —
  // attribute it to a /search call only when exactly one ran
  const searchCalls = calls.filter((c) => c?.endpoint === '/search');
  const matched = searchCalls.length === 1 && bundle?.entity?.name ? bundle.entity.name : null;

  return (
    <>
      <div className="drawer-veil" onClick={onClose} />
      <aside ref={boxRef} className="drawer" role="dialog" aria-modal="true" aria-label="Taste evidence">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <h3><Icon name="qloo" size={18} /> {title}</h3>
          <button className="icon-btn" onClick={onClose} aria-label="Close"><Icon name="x" size={16} /></button>
        </div>
        <p className="drawer-sub">
          Real calls to the audience taste graph that grounded this work — every type, every call, failures included.
        </p>
        <QlooBadge mode={badgeMode} />

        {!!calls.length && (
          <>
            <div className="ev-stats">
              <div className="ev-stat"><b>{calls.length}</b><span>calls</span></div>
              <div className={`ev-stat ${errN ? 'bad' : 'good'}`}><b>{liveN}/{calls.length}</b><span>live</span></div>
              {!!entN && <div className="ev-stat"><b>{entN}</b><span>entities</span></div>}
              {!!tagN && <div className="ev-stat"><b>{tagN}</b><span>tags</span></div>}
              {!!classes.size && <div className="ev-stat"><b>{classes.size}</b><span>classes</span></div>}
              <div className="ev-stat"><b>{fmtDur(latSum) || '—'}</b><span>Σ lat</span></div>
            </div>
            {!!times.length && (
              <div className="ev-window">
                {t0 === t1
                  ? `call at ${dayOf(t0)} ${clockOf(t0)}`
                  : `call window ${dayOf(t0)} ${clockOf(t0)} → ${sameDay ? clockOf(t1) : `${dayOf(t1)} ${clockOf(t1)}`} · span ${fmtDur(t1 - t0)}`}
                {matched ? ` · matched “${matched}”` : ''}
              </div>
            )}
          </>
        )}

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

        <div className="section-label">
          Evidence trail · {calls.length} audience call{calls.length === 1 ? '' : 's'}{errN ? ` · ${errN} failed` : ''}
        </div>
        {calls.length ? calls.map((c, i) => (
          <CallRow key={i} c={c} idx={i} bundle={bundle} matchedName={c?.endpoint === '/search' ? matched : null} />
        )) : (
          <p className="muted small">No recorded calls — no taste bundle was linked to this asset when it was generated.</p>
        )}
      </aside>
    </>
  );
}
