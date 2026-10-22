import React, { useEffect, useMemo, useState } from 'react';
import { api, pollJob } from '../api.js';
import { useApp } from '../App.jsx';
import Icon from '../components/Icon.jsx';
import Composer, { arCss, isRaster, MediaFallback } from '../components/Composer.jsx';
import CreativeCard from '../components/CreativeCard.jsx';
import CreativeEditor from '../components/CreativeEditor.jsx';
import EvidenceDrawer from '../components/EvidenceDrawer.jsx';
import Wayfind from '../components/Wayfind.jsx';
import { QlooBadge, SignalChips } from '../components/Qloo.jsx';
import './studio.css';

const EXPECTED_CREATIVES = 4; // server generates 4 per campaign — skeleton count while filling

// Brief fields materialize one-by-one (fade+blur) once the response lands —
// `mat` + `--i` drive the stagger. Skeleton bars show while it drafts.
const BRIEF_SKEL_FIELDS = [
  { k: 'Angle', w: 'w85' },
  { k: 'Audience', w: 'w70' },
  { k: 'Key message', w: 'w85' },
  { k: 'Channels', pills: true },
  { k: 'Taste signals', pills: true },
];

export default function Campaigns() {
  const { profile, say, status } = useApp();
  const [campaigns, setCampaigns] = useState(null);
  const [openId, setOpenId] = useState(null);        // campaign detail view
  const [brief, setBrief] = useState(null);          // {brief, suggestions, qlooSignals}
  const [draft, setDraft] = useState(null);          // composer payload that produced the brief
  const [seed, setSeed] = useState(null);
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState('idle');        // idle | briefing | generating
  const [making, setMaking] = useState('');          // campaign id currently filling with creatives
  const [editing, setEditing] = useState(null);      // creative in the editor modal
  const [animating, setAnimating] = useState('');    // creative id currently animating
  const [evi, setEvi] = useState(false);
  const [handoff, setHandoff] = useState(null);      // {strategy, notes, prompt, productId, exampleRefs?}

  const reload = async () => {
    try { setCampaigns((await api.listCampaigns()).campaigns || []); }
    catch (e) { say(e.message); setCampaigns([]); }
  };
  useEffect(() => { reload(); }, []);

  // Strategy board handoff: 'strategyHandoff' is written by the Strategy view's
  // "Use this strategy" button. Consume once → composer chip + auto-start brief.
  // Optional `exampleRefs: [{platform,title,author,url,note}]` fold into the
  // brief text as a "Reference examples:" section.
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem('strategyHandoff');
      if (!raw) return;
      sessionStorage.removeItem('strategyHandoff');
      const data = JSON.parse(raw);
      const s = data?.strategy;
      if (!s) return;
      setHandoff(data);
      const b = s.brief || {};
      const lines = [
        `Campaign: ${b.title || s.title}`,
        b.angle ? `Angle: ${b.angle}` : '',
        b.audience ? `Audience: ${b.audience}` : '',
        b.keyMessage ? `Key message: ${b.keyMessage}` : '',
        (s.channels || []).length ? `Channels: ${s.channels.map((c) => c.name || c).join(', ')}` : '',
        data.notes ? `Notes from the strategy board: ${data.notes}` : '',
        data.prompt ? `Original ask: ${data.prompt}` : '',
      ];
      if (Array.isArray(data.exampleRefs) && data.exampleRefs.length) {
        lines.push('Reference examples:');
        for (const r of data.exampleRefs) {
          lines.push(`- ${r.title || 'example'} — @${r.author || 'unknown'}${r.platform ? ` (${r.platform})` : ''}${r.note ? `: ${r.note}` : ''}`);
        }
      }
      const merged = lines.filter(Boolean).join('\n');
      setSeed({ text: merged, productId: data.productId || null });
      genBrief({ prompt: merged, productId: data.productId || undefined });
      say('Strategy loaded — drafting your brief');
    } catch { /* malformed stash — ignore */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const open = (campaigns || []).find((c) => c.id === openId) || null;

  // group "Your campaigns" by the strategy that spawned them (handoff metadata)
  const groups = useMemo(() => {
    const byStrat = new Map();  // key → { key, title, items }
    const other = [];
    for (const c of campaigns || []) {
      const key = c.strategyId || c.strategyTitle;
      if (!key) { other.push(c); continue; }
      if (!byStrat.has(key)) byStrat.set(key, { key, title: c.strategyTitle || 'strategy', items: [] });
      byStrat.get(key).items.push(c);
    }
    return { strat: [...byStrat.values()], other };
  }, [campaigns]);

  // one campaign summary card — shared by grouped + ungrouped lists.
  // SVG/empty creatives get a branded fallback tile instead of a raw empty box.
  const campCard = (c) => (
    <div key={c.id} className="card camp-card">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h4>{c.brief?.title || 'Untitled campaign'}</h4>
        <span className="chan-chip">{c.aspectRatio || '1:1'}</span>
      </div>
      {c.brief?.angle && <p className="muted small" style={{ margin: 0 }}>{c.brief.angle}</p>}
      <div className="chip-row mt8">
        {(c.brief?.channels || []).map((ch) => <span key={ch} className="chan-chip">{ch}</span>)}
        <SignalChips signals={c.qlooSignals || []} max={3} />
      </div>
      {!!c.creatives?.length && (
        <div className="thumbs">
          {c.creatives.slice(0, 4).map((cr) => (
            <span key={cr.id} className="media-tile">
              {isRaster(cr.imagePath) ? (
                <img src={cr.imagePath} alt="" loading="lazy" />
              ) : (
                <MediaFallback
                  seed={c.brief?.title || cr.headline}
                  channel={(c.brief?.channels || [])[0]}
                  monogram={profile?.name}
                />
              )}
            </span>
          ))}
          {c.creatives.length > 4 && <span className="more">+{c.creatives.length - 4}</span>}
        </div>
      )}
      <div className="foot">
        <span className="muted small">{c.creatives?.length || 0} creatives</span>
        <span className="grow" />
        <button className="btn sm" onClick={() => setOpenId(c.id)}>Open</button>
      </div>
    </div>
  );

  // skeleton creative tile — image area + title bar shimmer while a campaign fills
  const skelCreative = (i, ar) => (
    <div key={`skel-${i}`} className="card creative-card" style={{ '--ar': arCss(ar) }}>
      <div className="cc-media">
        <span className="skel cc-skel-media" />
      </div>
      <div className="meta"><span className="skel skel-line w70" /></div>
    </div>
  );

  // Generate Brief → skeleton card → fields materialize on the response
  const genBrief = async (payload) => {
    if (busy) return;
    setBusy(true); setPhase('briefing');
    try {
      const res = await api.campaignBrief(payload);
      setBrief(res);
      setDraft(payload);
    } catch (e) { say(e.message); }
    setBusy(false); setPhase((p) => (p === 'briefing' ? 'idle' : p));
  };

  // Confirm brief → createCampaign → open the campaign (skeleton creative grid
  // while the job runs) → poll → creatives fill in staggered.
  const confirmBrief = async () => {
    if (!brief?.brief) return;
    setBusy(true); setPhase('generating');
    try {
      const { campaign, job } = await api.createCampaign({
        brief: brief.brief,
        productId: draft?.productId,
        ingredients: draft?.ingredients,
        aspectRatio: draft?.aspectRatio,
        qlooSignals: brief.qlooSignals,   // server persists these onto the campaign
        notes: handoff?.notes || '',      // keep board notes for creative generation
        strategyId: handoff?.strategyId || handoff?.strategy?.id || undefined,
        strategyTitle: handoff?.strategyTitle || handoff?.strategy?.title || undefined,
      });
      if (campaign?.id) {
        setMaking(campaign.id);
        await reload();                  // pick up the fresh (still-empty) campaign
        setOpenId(campaign.id);          // detail view shows skeleton creatives
        if (job?.id) {
          await pollJob(job.id).catch((e) => say(e.message));
        }
        await reload();                  // creatives land → staggered fill-in
      } else if (job?.id) {
        await pollJob(job.id).catch((e) => say(e.message));
        await reload();
      }
      setBrief(null);
      setHandoff(null);
      say('Campaign ready');
    } catch (e) { say(e.message); }
    setMaking('');
    setBusy(false); setPhase('idle');
  };

  // Card-level animate shortcut (9:16 only — CreativeCard hides it otherwise).
  const animateOne = async (creative) => {
    setAnimating(creative.id);
    try {
      const { job } = await api.animateCreative(creative.id);
      await pollJob(job.id);
      await reload();
      say('Animation ready — open the creative to watch it');
    } catch (e) { say(e.message); }
    setAnimating('');
  };

  // ---------- detail: creative grid ----------
  if (open) {
    const creatives = open.creatives || [];
    const pendingSkels = making === open.id ? Math.max(0, EXPECTED_CREATIVES - creatives.length) : 0;
    return (
      <div className="section" style={{ paddingBottom: 80 }}>
        <Wayfind />
        <div className="page-head" style={{ textAlign: 'left', padding: '10px 0 18px' }}>
          <button className="btn ghost sm mb8" onClick={() => setOpenId(null)}>
            ← All campaigns
          </button>
          <h2 className="display" style={{ fontSize: 34 }}>{open.brief?.title || 'Campaign'}</h2>
          {open.brief?.angle && <p className="sub" style={{ margin: 0, maxWidth: 640 }}>{open.brief.angle}</p>}
          <div className="row wrap mt8">
            {(open.brief?.channels || []).map((c) => <span key={c} className="chan-chip">{c}</span>)}
            <span className="chan-chip">{open.aspectRatio || '1:1'}</span>
            <SignalChips signals={open.qlooSignals || []} />
            <button className="btn ghost sm" onClick={() => setEvi(true)}>
              <Icon name="qloo" size={14} /> Evidence
            </button>
          </div>
        </div>
        <div className="creative-grid">
          {creatives.map((cr) => (
            <CreativeCard
              key={cr.id}
              creative={cr}
              campaign={open}
              aspect={open.aspectRatio}
              animating={animating === cr.id}
              onEdit={setEditing}
              onAnimate={animateOne}
              onChanged={reload}
            />
          ))}
          {Array.from({ length: pendingSkels }, (_, i) => skelCreative(i, open.aspectRatio))}
        </div>
        {!creatives.length && !pendingSkels && (
          <div className="empty">
            <p>No creatives yet — generation may still be running.</p>
            <button className="btn ghost sm" onClick={reload}>
              <Icon name="refresh" size={13} /> Check again
            </button>
          </div>
        )}
        {editing && (
          <CreativeEditor
            creative={editing}
            campaign={open}
            onClose={() => setEditing(null)}
            onSaved={() => reload()}
          />
        )}
        {evi && <EvidenceDrawer signals={open.qlooSignals || []} onClose={() => setEvi(false)} />}
      </div>
    );
  }

  // ---------- landing ----------
  const chans = (handoff?.strategy?.channels || []).map((c) => c.name || c).filter(Boolean);
  return (
    <div className="section" style={{ paddingBottom: 80 }}>
      <Wayfind />
      <div className="page-head">
        <h1 className="display">Campaigns</h1>
        <p className="sub">Prompt a campaign or continue one below — brief first, creatives after.</p>
      </div>

      <div className="composer-zone">
        {handoff && (
          <div className="camp-src">
            <Icon name="sparkle" size={12} />
            <span className="camp-src-txt">
              from strategy: <b>{handoff.strategy?.title || handoff.strategyTitle || 'untitled'}</b>
              {!!chans.length && <i> · {chans.slice(0, 3).join(' · ')}</i>}
            </span>
            <button className="x" title="Dismiss" onClick={() => setHandoff(null)}>✕</button>
          </div>
        )}
        <Composer seed={seed} busy={busy} onGenerate={genBrief} />
      </div>

      {phase === 'briefing' && !brief?.brief && (
        <div className="card pad brief-card" aria-busy="true" aria-label="Drafting your campaign brief">
          <div className="row" style={{ justifyContent: 'space-between', marginBottom: 8 }}>
            <span className="skel skel-line w55" style={{ height: 18 }} />
            <span className="skel" style={{ width: 52, height: 18, borderRadius: 999 }} />
          </div>
          {BRIEF_SKEL_FIELDS.map((f) => (
            <div className="brief-field" key={f.k}>
              <span className="k">{f.k}</span>
              {f.pills ? (
                <span className="v chip-row">
                  <span className="skel" style={{ width: 62, height: 20, borderRadius: 999 }} />
                  <span className="skel" style={{ width: 80, height: 20, borderRadius: 999 }} />
                  <span className="skel" style={{ width: 48, height: 20, borderRadius: 999 }} />
                </span>
              ) : (
                <span className="v"><span className={`skel skel-line ${f.w}`} /></span>
              )}
            </div>
          ))}
        </div>
      )}

      {brief?.brief && (
        <div className="card pad brief-card">
          <div className="row mat" style={{ '--i': 0, justifyContent: 'space-between', marginBottom: 8 }}>
            <h3>{brief.brief.title || 'Campaign brief'}</h3>
            <QlooBadge mode={status?.qloo === 'live' ? 'live' : 'demo'} />
          </div>
          <div className="brief-field mat" style={{ '--i': 1 }}><span className="k">Angle</span><span className="v">{brief.brief.angle}</span></div>
          <div className="brief-field mat" style={{ '--i': 2 }}><span className="k">Audience</span><span className="v">{brief.brief.audience}</span></div>
          <div className="brief-field mat" style={{ '--i': 3 }}><span className="k">Key message</span><span className="v">{brief.brief.keyMessage}</span></div>
          <div className="brief-field mat" style={{ '--i': 4 }}>
            <span className="k">Channels</span>
            <span className="v chip-row">{(brief.brief.channels || []).map((c) => <span key={c} className="chan-chip">{c}</span>)}</span>
          </div>
          {!!brief.qlooSignals?.length && (
            <div className="brief-field mat" style={{ '--i': 5 }}>
              <span className="k">Taste signals</span>
              <span className="v"><SignalChips signals={brief.qlooSignals} max={6} /></span>
            </div>
          )}
          {!!brief.suggestions?.length && (
            <div className="brief-field mat" style={{ '--i': 6 }}>
              <span className="k">Alternatives</span>
              <span className="v" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {brief.suggestions.map((s, i) => (
                  <button key={i} className="btn ghost sm" style={{ justifyContent: 'flex-start' }}
                    title={s.keyMessage}
                    onClick={() => setBrief((b) => ({ ...b, brief: { ...b.brief, title: s.title || b.brief.title, angle: s.angle || b.brief.angle, keyMessage: s.keyMessage || b.brief.keyMessage } }))}>
                    {s.title}{s.angle ? ` — ${s.angle}` : ''}
                  </button>
                ))}
              </span>
            </div>
          )}
          <div className="row mt16 mat" style={{ '--i': 7, justifyContent: 'flex-end', gap: 10 }}>
            <button className="btn ghost" onClick={() => { setBrief(null); setHandoff(null); setPhase('idle'); }}>Discard</button>
            <button className="btn lime" disabled={busy} onClick={confirmBrief}>
              <Icon name="check" /> Confirm — generate creatives
            </button>
          </div>
        </div>
      )}

      <div className="section-label">Your campaigns</div>
      {campaigns === null ? (
        <div className="grid c2">
          {[0, 1].map((i) => (
            <div key={i} className="card camp-card">
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <span className="skel skel-line w55" style={{ height: 15 }} />
                <span className="skel" style={{ width: 34, height: 20, borderRadius: 999 }} />
              </div>
              <span className="skel skel-line w85" />
              <div className="chip-row mt8">
                <span className="skel" style={{ width: 52, height: 20, borderRadius: 999 }} />
                <span className="skel" style={{ width: 64, height: 20, borderRadius: 999 }} />
              </div>
              <div className="thumbs">
                {[0, 1, 2, 3].map((j) => <span key={j} className="media-tile skel" />)}
              </div>
            </div>
          ))}
        </div>
      ) : campaigns.length ? (
        <>
          {groups.strat.map((g) => (
            <div key={g.key} className="camp-group">
              <div className="camp-group-label">
                <Icon name="sparkle" size={11} /> from strategy: <b>{g.title}</b>
              </div>
              <div className="grid c2">{g.items.map(campCard)}</div>
            </div>
          ))}
          {!!groups.other.length && (
            <div className="camp-group">
              {!!groups.strat.length && <div className="camp-group-label">Other campaigns</div>}
              <div className="grid c2">{groups.other.map(campCard)}</div>
            </div>
          )}
        </>
      ) : (
        <div className="empty">
          <p>No campaigns yet — generate a brief above to get started.</p>
          <button className="btn ghost sm" onClick={() => document.querySelector('.composer textarea')?.focus()}>
            <Icon name="sparkle" size={13} /> Start a brief
          </button>
        </div>
      )}
    </div>
  );
}
