import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { useApp } from '../App.jsx';
import Icon from '../components/Icon.jsx';
import { QlooBadge, SignalChips } from '../components/Qloo.jsx';
import './strategy.css';

const STAGES = [
  'Reading your audience…',
  'Scanning Instagram & TikTok signals…',
  'Pulling TV & media affinities…',
  'Scoring channel fit…',
  'Stress-testing cultural match…',
];

const ALL_CHANNELS = ['instagram', 'tiktok', 'youtube', 'tv', 'streaming', 'podcast', 'ooh', 'guerrilla', 'email', 'press'];
const PULL_SOURCES = ['YouTube', 'TikTok', 'iTunes', 'Wikipedia', 'Wikimedia Commons'];
const URL_RE = /https?:\/\/[^\s]+/;

// map evidence/strategy channel names onto the existing Icon set
const CHAN_ICON = {
  instagram: 'image', tiktok: 'film', youtube: 'play', tv: 'site', streaming: 'share',
  podcast: 'mic', ooh: 'aspect', guerrilla: 'megaphone', email: 'send', press: 'book',
};
const chanIcon = (c) => CHAN_ICON[String(c || '').toLowerCase()] || 'sparkle';
const pct = (v) => Math.round(Math.max(0, Math.min(1, +v || 0)) * 100);
const badgeMode = (m) => (m === 'live' ? 'live' : m === 'simulated' ? 'simulated' : 'demo');
const findUrl = (t) => (String(t || '').match(URL_RE) || [])[0] || '';
const host = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return u; } };
const REDUCED = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

// count-up for ring numerals (skipped under reduced-motion)
function CountUp({ v = 0 }) {
  const [n, setN] = useState(REDUCED ? Math.round(v) : 0);
  useEffect(() => {
    const target = Math.round(v);
    if (REDUCED) { setN(target); return; }
    let raf, t0;
    const step = (t) => {
      if (!t0) t0 = t;
      const p = Math.min(1, (t - t0) / 850);
      setN(Math.round(target * (1 - Math.pow(1 - p, 3))));
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [v]);
  return <>{n}</>;
}

// animated score ring — stroke-dashoffset animates via stgRing keyframe (from full offset → inline value)
function Ring({ value = 0, label }) {
  const R = 40;
  const C = +(2 * Math.PI * R).toFixed(2); // 251.33 — matches @keyframes stgRing
  const v = Math.max(0, Math.min(1, +value || 0));
  return (
    <div className="stg-ring" role="img" aria-label={`${label} ${pct(v)}%`}>
      <svg viewBox="0 0 96 96">
        <circle className="stg-ring-bg" cx="48" cy="48" r={R} />
        <circle className="stg-ring-fg" cx="48" cy="48" r={R}
          strokeDasharray={C} style={{ strokeDashoffset: C * (1 - v) }} />
      </svg>
      <div className="stg-ring-num"><b><CountUp v={pct(v)} /></b><span>{label}</span></div>
    </div>
  );
}

// staged Pomelli-style wait — advances every 2.5s, holds on the last stage
function Loader({ stage, mode }) {
  return (
    <div className="card stg-loader">
      <div className="stg-loader-head">
        <span className="lbl">
          <span className="spinner" style={{ width: 16, height: 16, borderWidth: 2 }} />
          Building your strategy board — the agent is slow on purpose…
        </span>
        <QlooBadge mode={mode} />
      </div>
      <div className="stg-stages">
        {STAGES.map((s, i) => (
          <div key={s} className={`stg-stage${i < stage ? ' done' : i === stage ? ' now' : ''}`}>
            <span className="stg-stage-ic">
              {i < stage ? <Icon name="check" size={12} /> : i + 1}
            </span>
            {s}
          </div>
        ))}
      </div>
      <div className="stg-shimmer"><i /></div>
    </div>
  );
}

// rotating "pulling examples from X…" line while /api/strategy/examples scrapes (30-90s)
function PullStatus() {
  const [i, setI] = useState(0);
  useEffect(() => {
    if (REDUCED) return undefined;
    const t = setInterval(() => setI((n) => (n + 1) % PULL_SOURCES.length), 1700);
    return () => clearInterval(t);
  }, []);
  return (
    <span>
      pulling examples from <b className="stg-pull-src" key={i}>{PULL_SOURCES[i]}</b> — live scrape, can take a minute…
    </span>
  );
}

const SRC_LABEL = { scraped: 'scraped', 'catalog-art': 'catalog art', 'concept-art': 'concept art' };

// one "in the wild" example card — embed iframe if we got a safe player URL,
// thumbnail otherwise; whole card links out when there's no embed.
function WildCard({ e, i }) {
  const tt = /tiktok/i.test(e.embed || '');
  const inner = (
    <>
      {e.embed ? (
        <span className={`stg-wx-media${tt ? ' tt' : ''}`}>
          <iframe src={e.embed} title={e.title || 'example'} loading="lazy"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; picture-in-picture; web-share"
            referrerPolicy="strict-origin-when-cross-origin" allowFullScreen />
        </span>
      ) : e.image ? (
        <span className="stg-wx-media"><img src={e.image} alt="" loading="lazy" /></span>
      ) : null}
      <span className="stg-wx-body">
        <span className="stg-wx-plat">
          <Icon name={chanIcon(e.platform)} size={12} />{e.platform || 'web'}
          <span className={`stg-src ${e.source || 'scraped'}`}>{SRC_LABEL[e.source] || e.source || 'scraped'}</span>
        </span>
        <span className="stg-wx-title">{e.title}</span>
        {!!e.author && <span className="stg-wx-author">{e.author}</span>}
        {!!e.note && <span className="stg-wx-note">“{e.note}”</span>}
        {!!e.url && !!e.embed && (
          <a className="stg-wx-open" href={e.url} target="_blank" rel="noreferrer">
            open original <Icon name="link" size={10} />
          </a>
        )}
      </span>
    </>
  );
  const cls = `stg-wx${e.url && !e.embed ? ' link' : ''}`;
  return e.url && !e.embed
    ? <a className={cls} style={{ '--i': i }} href={e.url} target="_blank" rel="noreferrer">{inner}</a>
    : <div className={cls} style={{ '--i': i }}>{inner}</div>;
}

export default function Strategy() {
  const { profile, say, status } = useApp();
  const nav = useNavigate();
  const [prompt, setPrompt] = useState('');
  const [siteUrl, setSiteUrl] = useState('');
  const [productId, setProductId] = useState('');
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState(0);
  const [res, setRes] = useState(null);
  const [err, setErr] = useState('');
  const [sel, setSel] = useState(0);          // selected strategy index
  const [view, setView] = useState('rec');    // 'rec' recommended | 'nope' wouldn't-work
  const [eviOpen, setEviOpen] = useState(false);
  const [ex, setEx] = useState({});           // strategyId -> {status, data, err}
  const [sub, setSub] = useState(null);       // submitted {prompt, productId, url}
  const detailRef = useRef(null);

  useEffect(() => {
    if (!busy) return;
    setStage(0);
    const t = setInterval(() => setStage((s) => Math.min(s + 1, STAGES.length - 1)), 2500);
    return () => clearInterval(t);
  }, [busy]);

  const generate = async (text) => {
    const raw = String(text ?? prompt);
    const p = raw.trim();
    const url = siteUrl.trim() || findUrl(raw);
    if ((!p && !url) || busy) return;
    if (text) setPrompt(p);
    setBusy(true); setErr(''); setRes(null); setSel(0); setView('rec'); setEviOpen(false); setEx({});
    setSub({ prompt: p, productId, url });
    try {
      setRes(await api.strategy(p, productId || undefined, url || undefined));
    } catch (e) {
      setErr(e.message || 'strategy generation failed');
      say?.(e.message);
    }
    setBusy(false);
  };

  // collapse back to the composer (chip bar "new prompt")
  const reset = () => { setRes(null); setErr(''); setSel(0); setView('rec'); setEx({}); setSub(null); };

  // lazy pull of real-world examples for a strategy — cached per strategy id
  const loadExamples = async (s, force = false) => {
    if (!s) return;
    const id = s.id || s.title;
    const cur2 = ex[id];
    if (!force && cur2 && cur2.status !== 'error') return;
    setEx((m) => ({ ...m, [id]: { status: 'loading' } }));
    try {
      const data = await api.strategyExamples(s, res?.audienceRead);
      setEx((m) => ({ ...m, [id]: { status: 'done', data } }));
    } catch (e) {
      setEx((m) => ({ ...m, [id]: { status: 'error', err: e.message || 'pull failed' } }));
    }
  };

  // hand a strategy to Campaigns: stash its brief, then open /campaigns?strategy=<id>
  const useStrategy = (s) => {
    const b = s.brief || {};
    const briefPrompt = [
      `Campaign: ${b.title || s.title}`,
      b.angle ? `Angle: ${b.angle}` : '',
      b.audience ? `Audience: ${b.audience}` : '',
      b.keyMessage ? `Key message: ${b.keyMessage}` : '',
      (s.channels || []).length ? `Channels: ${s.channels.map((c) => c.name).join(', ')}` : '',
    ].filter(Boolean).join('\n');
    try {
      sessionStorage.setItem('marque.strategyBrief', JSON.stringify({
        strategyId: s.id, title: s.title, prompt: briefPrompt, brief: b,
      }));
    } catch { /* storage unavailable — navigation still carries the strategy id */ }
    say?.(`"${s.title}" loaded into Campaigns`);
    nav(`/campaigns?strategy=${encodeURIComponent(s.id)}`);
  };

  const examples = useMemo(() => {
    const out = [];
    const prod = (profile?.catalog || [])[0];
    if (prod?.name) out.push(`Launch ${prod.name} to the people most likely to care`);
    if (profile?.name) out.push(`A seasonal push for ${profile.name} that borrows from what our audience already loves`);
    out.push('Sharpen how we talk about what makes us different');
    out.push('Reach new customers without discounting');
    return out.slice(0, 4);
  }, [profile]);

  const read = res?.audienceRead || {};
  const lean = read.lean || {};
  const evi = res?.evidence || {};
  const strats = res?.strategies || [];
  const cur = strats.length ? strats[Math.min(sel, strats.length - 1)] : null;
  const chans = cur ? [...(cur.channels || [])].sort((a, b) => (+b.fit || 0) - (+a.fit || 0)) : [];
  const drivers = (evi.drivers?.length ? evi.drivers : read.mediaHabits) || [];
  const qmode = evi.qlooMode || status?.qloo;
  const exState = cur ? ex[cur.id || cur.title] : null;

  // lazy-pull examples the first time a strategy's dashboard opens
  useEffect(() => {
    if (res && !busy && cur && view === 'rec') loadExamples(cur);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [res, busy, sel, view]);

  // select a card → open its campaign dashboard below
  const pick = (i) => {
    setSel(i); setView('rec');
    if (!REDUCED) {
      setTimeout(() => detailRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 140);
    }
  };

  // "Wouldn't work" — channels nobody suggested or that score <0.35 everywhere,
  // plus one lean-derived gimmick the audience read penalizes.
  const rejected = useMemo(() => {
    if (!res) return [];
    const fitsBy = {};
    for (const s of strats) for (const c of s.channels || []) {
      (fitsBy[c.name] = fitsBy[c.name] || []).push(+c.fit || 0);
    }
    const out = [];
    const leanLabel = lean.label || '';
    if (/craft|heritage|indie/i.test(leanLabel)) {
      out.push({ name: 'AI-hologram stunt', reason: `penalized for this lean (${leanLabel}) — reads as gimmicky; keep generated assets subtle` });
    } else if (/early|adopter|tech/i.test(leanLabel)) {
      out.push({ name: 'Static print-only push', reason: `undersells a ${leanLabel} crowd — they reward interactive, AI-native formats` });
    } else if (leanLabel) {
      out.push({ name: 'Edgy niche-collab drop', reason: `too narrow for a ${leanLabel} audience — broad, value-led channels carry it` });
    }
    for (const ch of ALL_CHANNELS) {
      const fits = fitsBy[ch];
      if (!fits) out.push({ name: ch, reason: 'no supporting signal in the audience taste data' });
      else if (Math.max(...fits) < 0.35) {
        out.push({ name: ch, reason: `weak fit in every concept (best ${pct(Math.max(...fits))}%) — spend would be speculative` });
      }
    }
    return out.slice(0, 7);
  }, [res]); // eslint-disable-line react-hooks/exhaustive-deps

  const inlineUrl = findUrl(prompt);
  const effUrl = siteUrl.trim() || inlineUrl;
  const canGo = !busy && !!(prompt.trim() || effUrl);
  const subProduct = sub?.productId ? (profile?.catalog || []).find((p) => p.id === sub.productId) : null;
  const subHost = sub?.url ? host(sub.url) : '';

  if (profile === undefined) {
    return <div className="loading-wrap"><div className="spinner" /></div>;
  }

  return (
    <div className="section stg-wrap">
      <div className="page-head">
        <h1 className="display">Strategy board</h1>
        <p className="sub">
          Say what you're trying to do — or paste a product/site URL — we read your audience's
          taste graph, pitch strategies with the evidence behind every call, and flag what wouldn't work.
        </p>
      </div>

      {!profile ? (
        <div className="card stg-nudge">
          <h3 className="display">First, your brand</h3>
          <p>
            Strategies are grounded in your Business Profile's taste signature.
            Set it up and this board lights up — it takes about a minute.
          </p>
          <Link className="btn lime" to="/onboarding">
            <Icon name="dna" size={16} /> Set up Business Profile
          </Link>
        </div>
      ) : (
        <>
          {/* ---- collapsed prompt chip — the board owns the screen once results land ---- */}
          {res && !busy && (
            <div className="stg-chipbar">
              <span className="stg-chipbar-ic"><Icon name="sparkle" size={14} /></span>
              <span className="stg-chipbar-prompt" title={sub?.prompt || sub?.url}>
                {sub?.prompt || sub?.url || 'strategy board'}
              </span>
              {!!subProduct && <span className="stg-tag"><Icon name="bag" size={11} />{subProduct.name}</span>}
              {!!subHost && <span className="stg-tag"><Icon name="globe" size={11} />{subHost}</span>}
              <button className="btn ghost sm stg-chipbar-new" onClick={reset}>
                <Icon name="edit" size={13} /> New prompt
              </button>
            </div>
          )}

          {/* ---- composer — animates shut once strategies arrive ---- */}
          <div className={`stg-compose${res && !busy ? ' shut' : ''}`} aria-hidden={!!(res && !busy)}>
            <div className="stg-compose-in">
              <div className="card stg-ask">
                <textarea
                  value={prompt}
                  placeholder="What are you trying to make happen? e.g. launch our spring drop to people who already love what we do"
                  onChange={(e) => setPrompt(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) generate(); }}
                />
                <div className="stg-ask-foot">
                  {!!(profile?.catalog || []).length && (
                    <select className="stg-prod" value={productId} onChange={(e) => setProductId(e.target.value)}
                      title="Optional — anchor strategies to a catalog product">
                      <option value="">No specific product</option>
                      {profile.catalog.map((p) => <option key={p.id} value={p.id}>For: {p.name}</option>)}
                    </select>
                  )}
                  <span className={`stg-urlwrap${siteUrl.trim() ? ' has' : ''}`} title="Optional — we'll scrape this as product/site context">
                    <Icon name="link" size={13} />
                    <input className="stg-url" value={siteUrl} placeholder="or paste a product/site URL"
                      onChange={(e) => setSiteUrl(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') generate(); }} />
                  </span>
                  {!!inlineUrl && !siteUrl.trim() && (
                    <span className="stg-tag" title="Detected in your prompt — will be scraped as context">
                      <Icon name="globe" size={11} />{host(inlineUrl)}
                    </span>
                  )}
                  <span className="grow" />
                  <button className="btn lime" disabled={!canGo} onClick={() => generate()}>
                    {busy
                      ? <span className="spinner stg-btnspin" />
                      : <Icon name="sparkle" />}
                    {busy ? 'Working…' : 'Generate strategies'}
                  </button>
                </div>
                <div className="stg-hint">prompt, or paste a product/website URL — we'll scrape it for context</div>
              </div>

              {!res && !busy && !err && (
                <div className="stg-examples">
                  {examples.map((x) => (
                    <button key={x} className="stg-ex" onClick={() => setPrompt(x)}>{x}</button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {busy && <Loader stage={stage} mode={badgeMode(status?.qloo)} />}

          {err && !busy && (
            <div className="card stg-err">
              <span className="lead"><Icon name="x" size={16} /> Couldn't build strategies</span>
              <span className="muted small">{err}</span>
              <button className="btn ghost sm" onClick={() => generate()}>
                <Icon name="refresh" size={14} /> Retry
              </button>
            </div>
          )}

          {res && !busy && (
            <div className="stg-board">
              {/* ---- audience read ---- */}
              <section className="card stg-tile stg-aud" style={{ '--i': 0 }}>
                <div className="stg-tile-head">
                  <span className="stg-ml">Audience read</span>
                  <QlooBadge mode={badgeMode(qmode)} label="Qloo read" />
                </div>
                <div className="stg-aud-main">
                  <div className="stg-aud-left">
                    <div className="stg-lean display">{lean.label || 'Unclear'}</div>
                    <div className="stg-heur">heuristic read — not a fact</div>
                    {!!lean.signals?.length && (
                      <ul className="stg-sigs">
                        {lean.signals.map((s, i) => <li key={i}>{s}</li>)}
                      </ul>
                    )}
                  </div>
                  <Ring value={lean.confidence} label="conf" />
                </div>
                {!!read.mediaHabits?.length && (
                  <div>
                    <span className="stg-ml">Media habits</span>
                    <div className="stg-habits" style={{ marginTop: 8 }}>
                      {read.mediaHabits.map((h, i) => (
                        <div className="stg-habit" key={i}>
                          <span className="stg-hchip"><Icon name={chanIcon(h.channel)} />{h.channel}</span>
                          <span className="stg-hnote">{h.note}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {!!read.vibeWords?.length && (
                  <div>
                    <span className="stg-ml">Vibe</span>
                    <div className="stg-chiprow" style={{ marginTop: 7 }}>
                      {read.vibeWords.map((w) => <span key={w} className="stg-chip vibe">{w}</span>)}
                    </div>
                  </div>
                )}
              </section>

              {/* ---- channel scans (the scrape evidence) ---- */}
              <section className="card stg-tile stg-scans" style={{ '--i': 1 }}>
                <div className="stg-tile-head">
                  <span className="stg-ml">Channel scans</span>
                  <span className="stg-live-dot"><i /> taste-graph evidence</span>
                </div>
                {drivers.length ? drivers.map((d, i) => (
                  <div className="stg-scan" key={`${d.channel}-${i}`} style={{ '--i': i }}>
                    <span className="stg-scan-ic"><Icon name={chanIcon(d.channel)} /></span>
                    <div className="stg-scan-body">
                      <div className="stg-scan-line">
                        <b>{d.channel}</b><span className="stg-scan-arrow">←</span>{d.note}
                      </div>
                    </div>
                    <span className="stg-scan-dot" />
                  </div>
                )) : (
                  <div className="stg-empty-note">No channel drivers returned — strategies fall back to generic priors.</div>
                )}

                <div className="stg-evi">
                  <button className="btn ghost sm" onClick={() => setEviOpen(!eviOpen)}>
                    <Icon name="qloo" size={14} />
                    {eviOpen ? 'Hide evidence' : 'Qloo evidence'}
                    {!!evi.calls?.length && ` · ${evi.calls.length} calls`}
                  </button>
                  {eviOpen && (
                    <div className="stg-evi-body">
                      {!!evi.signals?.length && (
                        <div className="stg-evi-group">
                          <span className="stg-ml">Top affinities driving this</span>
                          {evi.signals.map((s, i) => <div className="stg-evi-line" key={i}>{s}</div>)}
                        </div>
                      )}
                      {!!evi.qlooEvidence?.length && (
                        <div className="stg-evi-group">
                          <span className="stg-ml">Qloo evidence</span>
                          {evi.qlooEvidence.map((e, i) => (
                            <div className="stg-evi-line" key={i}><b>{e.label}</b> — {e.detail}</div>
                          ))}
                        </div>
                      )}
                      {!!evi.calls?.length && (
                        <div className="stg-evi-group">
                          <span className="stg-ml">Calls</span>
                          {evi.calls.map((c, i) => (
                            <div className="stg-call" key={i}>
                              <code>{c.endpoint}</code>
                              {c.tookMs != null && <span>{c.tookMs}ms</span>}
                              {c.n != null && <span className="n">→ {c.n} results</span>}
                              <span className={`stg-mode ${String(qmode)}`}>{qmode || 'unknown'}</span>
                            </div>
                          ))}
                        </div>
                      )}
                      {!evi.signals?.length && !evi.qlooEvidence?.length && !evi.calls?.length && (
                        <div className="stg-empty-note">No Qloo calls were recorded for this run.</div>
                      )}
                    </div>
                  )}
                </div>
                {!!evi.source && (
                  <span className="stg-empty-note">
                    ideation: {evi.source === 'tensor' ? 'agent-generated' : 'deterministic fallback'}
                  </span>
                )}
              </section>

              {/* ---- strategy picker: recommended cards vs rejected tactics ---- */}
              <section className="card stg-tile stg-picks" style={{ '--i': 2 }}>
                <div className="stg-tile-head">
                  <span className="stg-ml">Strategies · {strats.length}</span>
                  <div className="stg-seg" role="tablist" aria-label="Recommended or rejected">
                    <button role="tab" aria-selected={view === 'rec'} className={view === 'rec' ? 'on' : ''}
                      onClick={() => setView('rec')}>Recommended · {strats.length}</button>
                    <button role="tab" aria-selected={view === 'nope'} className={view === 'nope' ? 'on' : ''}
                      onClick={() => setView('nope')}>Wouldn't work · {rejected.length}</button>
                  </div>
                </div>

                {view === 'nope' ? (
                  <div className="stg-nope-list">
                    <p className="stg-nope-sub">
                      Rejected before it costs you money — same evidence, opposite conclusion.
                    </p>
                    {rejected.length ? rejected.map((r) => (
                      <div className="stg-rej" key={r.name}>
                        <span className="stg-rej-x"><Icon name="x" /></span>
                        <div>
                          <b>{r.name}</b>
                          <span className="stg-rej-why">{r.reason}</span>
                        </div>
                      </div>
                    )) : (
                      <div className="stg-empty-note">Nothing ruled out — this audience reads broad-channel.</div>
                    )}
                  </div>
                ) : !strats.length ? (
                  <div className="stg-empty-note">The agent didn't return any strategies — try a more specific prompt.</div>
                ) : (
                  <div className="stg-pick-grid">
                    {strats.map((s, i) => (
                      <button key={s.id || i} className={`stg-pick${i === sel ? ' sel' : ''}`}
                        style={{ '--i': i }} onClick={() => pick(i)}
                        aria-pressed={i === sel} title={s.title}>
                        <span className="stg-pick-top">
                          <span className="stg-idx">STRATEGY {String(i + 1).padStart(2, '0')}</span>
                          {i === sel && <span className="stg-pick-check"><Icon name="check" size={11} sw={2.4} /></span>}
                        </span>
                        <b className="stg-pick-title">{s.title}</b>
                        {!!s.angle && <span className="stg-pick-angle">{s.angle}</span>}
                        {!!(s.channels || []).length && (
                          <span className="stg-pick-chans">
                            {[...(s.channels || [])].sort((a, b) => (+b.fit || 0) - (+a.fit || 0)).slice(0, 3).map((c) => (
                              <span className="stg-pick-chan" key={c.name}>
                                <Icon name={chanIcon(c.name)} size={11} />{c.name}
                                <em><i style={{ width: `${pct(c.fit)}%` }} /></em>
                              </span>
                            ))}
                          </span>
                        )}
                        <span className="stg-pick-foot">
                          <span className="stg-pick-fit">{pct(s.audienceFit?.score)}% audience fit</span>
                          <span className="stg-pick-go">{i === sel ? 'selected' : 'open board →'}</span>
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </section>

              {/* ---- campaign dashboard for the selected strategy ---- */}
              {cur && view === 'rec' && (
                <section ref={detailRef} key={cur.id || sel}
                  className="card stg-tile stg-detail" style={{ '--i': 3 }}>
                  <div className="stg-detail-top">
                    <div className="stg-strat-id">
                      <span className="stg-idx">STRATEGY {String(sel + 1).padStart(2, '0')} · CAMPAIGN BOARD</span>
                      <h3 className="display">{cur.title}</h3>
                      {!!cur.angle && <p className="stg-angle">{cur.angle}</p>}
                      {!!cur.audienceFit?.notes?.length && (
                        <div className="stg-fitnotes">{cur.audienceFit.notes.join(' · ')}</div>
                      )}
                    </div>
                    <Ring value={cur.audienceFit?.score} label="audience fit" />
                  </div>

                  <div className="stg-detail-cols">
                    <div className="stg-detail-left">
                      {!!cur.brief && (
                        <div className="stg-brief">
                          <span className="stg-ml">Brief summary</span>
                          {!!cur.brief.keyMessage && (
                            <div className="stg-brief-row"><b>Key message</b>{cur.brief.keyMessage}</div>
                          )}
                          {!!cur.brief.audience && (
                            <div className="stg-brief-row"><b>Audience</b>{cur.brief.audience}</div>
                          )}
                          {!!cur.brief.angle && (
                            <div className="stg-brief-row"><b>Angle</b>{cur.brief.angle}</div>
                          )}
                        </div>
                      )}

                      {!!cur.formats?.length && (
                        <div>
                          <span className="stg-ml">Formats</span>
                          <div className="stg-chiprow" style={{ marginTop: 7 }}>
                            {cur.formats.map((f) => <span key={f} className="stg-chip">{f}</span>)}
                          </div>
                        </div>
                      )}

                      {(!!cur.heroSignal || !!cur.qlooSignals?.length) && (
                        <div>
                          <span className="stg-ml">Grounded in</span>
                          <div className="stg-chiprow" style={{ marginTop: 7, alignItems: 'center' }}>
                            {!!cur.heroSignal && (
                              <span className="stg-hero-sig" title="hero signal">
                                <Icon name="qloo" />{cur.heroSignal}
                              </span>
                            )}
                            <SignalChips signals={(cur.qlooSignals || []).filter((q) => q.entity !== cur.heroSignal)} max={5} />
                          </div>
                        </div>
                      )}

                      {!!cur.watchouts?.length && (
                        <div className="stg-watch">
                          <span className="stg-ml rose">Watchouts</span>
                          <ul>{cur.watchouts.map((w, i) => <li key={i}>{w}</li>)}</ul>
                        </div>
                      )}
                    </div>

                    <div className="stg-detail-right">
                      <div>
                        <span className="stg-ml">Channel fit</span>
                        <div className="stg-chans" style={{ marginTop: 9 }}>
                          {chans.length ? chans.map((c, i) => (
                            <div className="stg-chan" key={c.name}>
                              <span className="stg-chan-ic"><Icon name={chanIcon(c.name)} /></span>
                              <span className="stg-chan-name">{c.name}</span>
                              <span className="stg-bar">
                                <i className={i === 0 ? 'hot' : ''}
                                  style={{ width: `${pct(c.fit)}%`, '--d': `${0.15 + i * 0.09}s` }} />
                              </span>
                              <span className="stg-chan-val">{pct(c.fit)}</span>
                              {!!c.why && <div className="stg-why">{c.why}</div>}
                            </div>
                          )) : <div className="stg-empty-note">No channel mix attached.</div>}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* ---- in the wild: real examples scraped per strategy ---- */}
                  <div className="stg-wild">
                    <div className="stg-wild-head">
                      <span className="stg-ml">In the wild — pulled from the open web</span>
                      <span className="stg-wild-tools">
                        {exState?.status === 'done' && !!(exState.data?.hunts || []).length && (
                          <span className="stg-wild-hunts">
                            hunts: {[...new Set(exState.data.hunts.map((h) => h.platform))].join(' · ')}
                          </span>
                        )}
                        <button className="btn ghost sm" onClick={() => loadExamples(cur, true)}
                          disabled={exState?.status === 'loading'}>
                          <Icon name="refresh" size={13} />
                          {exState?.status === 'loading' ? 'Pulling…' : 'Re-pull'}
                        </button>
                      </span>
                    </div>

                    {(!exState || exState.status === 'loading') && (
                      <>
                        <div className="stg-wild-status">
                          <span className="spinner stg-btnspin" /><PullStatus />
                        </div>
                        <div className="stg-wild-grid">
                          {[0, 1, 2, 3].map((i) => (
                            <div className="stg-wx skel" key={i} style={{ '--i': i }}>
                              <i className="m" /><i className="t" /><i className="t s" />
                            </div>
                          ))}
                        </div>
                      </>
                    )}

                    {exState?.status === 'error' && (
                      <div className="stg-wild-err">
                        <span><Icon name="x" size={14} /> Couldn't pull live examples — {exState.err}</span>
                        <button className="btn ghost sm" onClick={() => loadExamples(cur, true)}>
                          <Icon name="refresh" size={13} /> Retry
                        </button>
                      </div>
                    )}

                    {exState?.status === 'done' && (
                      (exState.data?.examples || []).length ? (
                        <div className="stg-wild-grid">
                          {exState.data.examples.map((e, i) => <WildCard key={i} e={e} i={i} />)}
                        </div>
                      ) : (
                        <div className="stg-empty-note">No examples surfaced for this strategy — try re-pulling.</div>
                      )
                    )}
                  </div>

                  <div className="stg-strat-foot">
                    <span className="hint">Hands its brief to the Campaigns composer</span>
                    <button className="btn lime" onClick={() => useStrategy(cur)}>
                      Use this strategy <Icon name="send" size={15} />
                    </button>
                  </div>
                </section>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
