import React, { useEffect, useMemo, useState } from 'react';
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

// map evidence/strategy channel names onto the existing Icon set
const CHAN_ICON = {
  instagram: 'image', tiktok: 'film', youtube: 'play', tv: 'site', streaming: 'share',
  podcast: 'mic', ooh: 'aspect', guerrilla: 'megaphone', email: 'send', press: 'book',
};
const chanIcon = (c) => CHAN_ICON[String(c || '').toLowerCase()] || 'sparkle';
const pct = (v) => Math.round(Math.max(0, Math.min(1, +v || 0)) * 100);
const badgeMode = (m) => (m === 'live' ? 'live' : m === 'simulated' ? 'simulated' : 'demo');
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

export default function Strategy() {
  const { profile, say, status } = useApp();
  const nav = useNavigate();
  const [prompt, setPrompt] = useState('');
  const [productId, setProductId] = useState('');
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState(0);
  const [res, setRes] = useState(null);
  const [err, setErr] = useState('');
  const [sel, setSel] = useState(0);       // selected strategy index
  const [eviOpen, setEviOpen] = useState(false);

  useEffect(() => {
    if (!busy) return;
    setStage(0);
    const t = setInterval(() => setStage((s) => Math.min(s + 1, STAGES.length - 1)), 2500);
    return () => clearInterval(t);
  }, [busy]);

  const generate = async (text) => {
    const p = String(text ?? prompt).trim();
    if (!p || busy) return;
    if (text) setPrompt(p);
    setBusy(true); setErr(''); setRes(null); setSel(0); setEviOpen(false);
    try {
      setRes(await api.strategy(p, productId || undefined));
    } catch (e) {
      setErr(e.message || 'strategy generation failed');
      say?.(e.message);
    }
    setBusy(false);
  };

  // hand a strategy to Campaigns: stash its brief, then open /campaigns?strategy=<id>
  const useStrategy = (s) => {
    const b = s.brief || {};
    const briefPrompt = [
      `Campaign: ${b.title || s.title}`,
      b.angle ? `Angle: ${b.angle}` : '',
      b.audience ? `Audience: ${b.audience}` : '',
      b.keyMessage ? `Key message: ${b.keyMessage}` : '',
      (s.channels || []).length ? `Channels: ${s.channels.map((c) => c.name || c).join(', ')}` : '',
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

  if (profile === undefined) {
    return <div className="loading-wrap"><div className="spinner" /></div>;
  }

  return (
    <div className="section stg-wrap">
      <div className="page-head">
        <h1 className="display">Strategy board</h1>
        <p className="sub">
          Say what you're trying to do — we read your audience's taste graph, pitch strategies
          with the evidence behind every call, and flag what wouldn't work.
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
              <span className="grow" />
              <button className="btn lime" disabled={busy || !prompt.trim()} onClick={() => generate()}>
                <Icon name="sparkle" /> {busy ? 'Working…' : 'Generate strategies'}
              </button>
            </div>
          </div>

          {!res && !busy && !err && (
            <div className="stg-examples">
              {examples.map((x) => (
                <button key={x} className="stg-ex" onClick={() => setPrompt(x)}>{x}</button>
              ))}
            </div>
          )}

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

              {/* ---- featured strategy (switcher) ---- */}
              <section className="card stg-tile stg-strat" style={{ '--i': 2 }}>
                <div className="stg-tile-head">
                  <span className="stg-ml">Strategies · {strats.length}</span>
                  {strats.length > 1 && (
                    <div className="stg-seg" role="tablist" aria-label="Switch strategy">
                      {strats.map((s, i) => (
                        <button key={s.id || i} role="tab" aria-selected={i === sel}
                          className={i === sel ? 'on' : ''} title={s.title}
                          onClick={() => setSel(i)}>{i + 1}</button>
                      ))}
                    </div>
                  )}
                </div>

                {!cur ? (
                  <div className="stg-empty-note">The agent didn't return any strategies — try a more specific prompt.</div>
                ) : (
                  <div className="stg-strat-body" key={cur.id || sel}>
                    <div className="stg-strat-top">
                      <div className="stg-strat-id">
                        <span className="stg-idx">STRATEGY {String(sel + 1).padStart(2, '0')}</span>
                        <h3 className="display">{cur.title}</h3>
                        {!!cur.angle && <p className="stg-angle">{cur.angle}</p>}
                      </div>
                      <Ring value={cur.audienceFit?.score} label="audience fit" />
                    </div>
                    {!!cur.audienceFit?.notes?.length && (
                      <div className="stg-fitnotes">{cur.audienceFit.notes.join(' · ')}</div>
                    )}

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

                    <div className="stg-strat-foot">
                      <span className="hint">Hands its brief to the Campaigns composer</span>
                      <button className="btn lime" onClick={() => useStrategy(cur)}>
                        Use this strategy <Icon name="send" size={15} />
                      </button>
                    </div>
                  </div>
                )}
              </section>

              {/* ---- wouldn't work ---- */}
              <section className="card stg-tile stg-nope" style={{ '--i': 3 }}>
                <div className="stg-tile-head">
                  <span className="stg-ml rose">Wouldn't work here</span>
                  <span style={{ color: 'var(--rose)' }}><Icon name="x" size={15} /></span>
                </div>
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
              </section>
            </div>
          )}
        </>
      )}
    </div>
  );
}
