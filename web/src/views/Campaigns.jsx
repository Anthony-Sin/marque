import React, { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { api, pollJob } from '../api.js';
import { useApp } from '../App.jsx';
import Icon from '../components/Icon.jsx';
import Composer, { arCss, isRaster, MediaFallback } from '../components/Composer.jsx';
import CreativeCard from '../components/CreativeCard.jsx';
import CreativeEditor from '../components/CreativeEditor.jsx';
import EvidenceDrawer from '../components/EvidenceDrawer.jsx';
import Wayfind from '../components/Wayfind.jsx';
import { QlooBadge, SignalChips } from '../components/Qloo.jsx';
import { chanLabel } from '../labels.js';
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
  const loc = useLocation();
  const nav = useNavigate();
  const [campaigns, setCampaigns] = useState(null);
  const [openId, setOpenId] = useState(null);        // campaign detail view
  // open/close also writes the ?open= deep link: PUSH when opening so browser
  // Back returns to the list; REPLACE when closing so the back-stack stays clean
  const show = (id) => {
    setOpenId(id);
    nav(id ? `/campaigns?open=${id}` : '/campaigns', { replace: !id });
  };
  const [brief, setBrief] = useState(null);          // {brief, suggestions, qlooSignals}
  const [draft, setDraft] = useState(null);          // composer payload that produced the brief
  const [seed, setSeed] = useState(null);
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState('idle');        // idle | briefing | generating
  const [making, setMaking] = useState('');          // campaign id currently filling with creatives
  const [jobProg, setJobProg] = useState(null);      // real {done,total,stage} from the job poll
  const [editing, setEditing] = useState(null);      // creative in the editor modal
  const [animating, setAnimating] = useState('');    // creative id currently animating
  const [evi, setEvi] = useState(false);
  const [handoff, setHandoff] = useState(null);      // {strategy, notes, prompt, productId, exampleRefs?}
  const [liveAspect, setLiveAspect] = useState('4:5'); // composer's real pill state
  const [engine, setEngine] = useState('auto');        // campaign-level image engine override

  const reload = async () => {
    try { setCampaigns((await api.listCampaigns()).campaigns || []); }
    catch (e) { say(e.message); setCampaigns([]); }
  };
  useEffect(() => { reload(); }, []);

  // deep link: /campaigns?open=<id> (dashboard "Recent work" cards land here)
  useEffect(() => {
    const want = new URLSearchParams(loc.search).get('open');
    if (want && campaigns?.some((c) => c.id === want)) setOpenId(want);
    else if (want && campaigns) nav('/campaigns', { replace: true });  // stale id — clean the url
    else if (!want && openId) setOpenId(null);                          // browser Back left the detail
  }, [loc.search, campaigns]); // eslint-disable-line react-hooks/exhaustive-deps


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

  // a drafted-but-unconfirmed brief shouldn't vanish on navigation — stash it
  // and restore on return (a pending handoff always drafts fresh instead)
  useEffect(() => {
    try {
      if (sessionStorage.getItem('strategyHandoff')) return;
      const raw = sessionStorage.getItem('marque.briefDraft');
      if (raw) { const d = JSON.parse(raw); setBrief(d.brief || null); setDraft(d.draft || null); if (d.handoff) setHandoff(d.handoff); }
    } catch { /* ignore */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    try {
      if (brief) sessionStorage.setItem('marque.briefDraft', JSON.stringify({ brief, draft, handoff }));
      else sessionStorage.removeItem('marque.briefDraft');
    } catch { /* ignore */ }
  }, [brief]);

  const open = (campaigns || []).find((c) => c.id === openId) || null;

  // group "Your campaigns" by the strategy that spawned them (handoff metadata)
  const groups = useMemo(() => {
    const byStrat = new Map();  // key → { key, title, items }
    const other = [];
    for (const c of campaigns || []) {
      const key = `${c.boardId || ''}:${c.strategyId || c.strategyTitle || ''}`;
      if (key === ':') { other.push(c); continue; }
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
        {(c.brief?.channels || []).map((ch) => <span key={ch} className="chan-chip">{chanLabel(ch)}</span>)}
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
        <span className="muted small">{c.creatives?.length || 0} creative{(c.creatives?.length || 0) === 1 ? '' : 's'}</span>
        <span className="grow" />
        <button className="icon-btn sm camp-del" title="Delete campaign" onClick={async (e) => {
          e.stopPropagation();
          if (!window.confirm(`Delete "${c.brief?.title || 'this campaign'}"?`)) return;
          await api.deleteCampaign(c.id).catch(() => {});
          setCampaigns((cs) => (cs || []).filter((x) => x.id !== c.id));
          if (openId === c.id) show(null);
        }}><Icon name="trash" size={13} /></button>
        <button className="btn sm" onClick={() => show(c.id)}>Open</button>
      </div>
    </div>
  );

  // skeleton creative tile — image area + title bar shimmer while a campaign fills
  // generating-state tile — shimmer only under real job progress, labelled so
  // stored cards and in-flight cards are visually distinct
  const skelCreative = (i, ar) => (
    <div key={`skel-${i}`} className="card creative-card cc-making" style={{ '--ar': arCss(ar) }}>
      <div className="cc-media">
        <span className="skel cc-skel-media" />
        <span className="cc-making-tag">
          {jobProg ? `${jobProg.stage} ${jobProg.done}/${jobProg.total}` : 'generating — real render in flight'}
        </span>
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
        aspectRatio: liveAspect || draft?.aspectRatio,
        qlooSignals: brief.qlooSignals,   // server persists these onto the campaign
        notes: handoff?.notes || '',      // keep board notes for creative generation
        strategyId: handoff?.strategyId || handoff?.strategy?.id || undefined,
        strategyTitle: handoff?.strategyTitle || handoff?.strategy?.title || undefined,
        boardId: handoff?.boardId || undefined,
        provider: engine !== 'auto' ? engine : undefined,
      });
      if (campaign?.id) {
        setMaking(campaign.id);
        await reload();                  // pick up the fresh (still-empty) campaign
        show(campaign.id);               // detail view shows skeleton creatives
        if (job?.id) {
          await pollJob(job.id, { onTick: (j) => setJobProg(j.progress || null) }).catch((e) => say(e.message));
          setJobProg(null);
        }
        await reload();                  // creatives land → staggered fill-in
      } else if (job?.id) {
        await pollJob(job.id, { onTick: (j) => setJobProg(j.progress || null) }).catch((e) => say(e.message));
        setJobProg(null);
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
      say('Animation ready — Edit the creative to watch it, or Save to download');
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
          <button className="btn ghost sm mb8" onClick={() => show(null)}>
            ← All campaigns
          </button>
          <h2 className="display" style={{ fontSize: 34 }}>{open.brief?.title || 'Campaign'}</h2>
          {open.brief?.angle && <p className="sub" style={{ margin: 0, maxWidth: 640 }}>{open.brief.angle}</p>}
          <div className="row wrap mt8">
            {(open.brief?.channels || []).map((c) => <span key={c} className="chan-chip">{chanLabel(c)}</span>)}
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
        {evi && <EvidenceDrawer signals={open.qlooSignals || []} bundle={open.qlooBundle} calls={open.evidence?.calls} onClose={() => setEvi(false)} />}
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

      {/* one continuous card — composer on top, the brief materializes inside
          the same surface once it lands (prompt → brief → confirm, no seam) */}
      <div className={`composer-zone card flow-card${brief?.brief || phase === 'briefing' ? ' has-brief' : ''}`}>
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
        <Composer seed={seed} busy={busy} onGenerate={genBrief} onAspect={setLiveAspect} />

        {/* starter chips — competitor-style tappable brief seeds; they only
            prefill the composer's prompt, the user still edits before generating */}
        {!brief?.brief && phase !== 'briefing' && (
          <div className="starter-row">
            <span className="starter-eng" title="Image engine for this campaign's creatives">
              <b>Engine</b>
              {[['auto', 'auto'], ['local', 'local'], ['gemini', 'gemini']].map(([id, label]) => (
                <button key={id} type="button" className={`starter-chip eng${engine === id ? ' on' : ''}`}
                  title={id === 'auto' ? 'Default chain — local first, escalate on failure' : `Force ${label} for all creatives in this campaign`}
                  onClick={() => setEngine(id)}>{label}</button>
              ))}
            </span>
            <b className="starter-lbl">Try</b>
            {[
              ['Product hero', 'A bold product-hero shot for our flagship — clean studio backdrop, strong negative space for the headline'],
              ['UGC-style testimonial', 'A native-feeling UGC ad: real-person testimonial energy, handheld aesthetic, honest hook in the first line'],
              ['Launch moment', 'A launch announcement for something new — urgency, single message, built for stories/reels'],
              ['Problem → fix', 'A problem-agitate-solve ad for busy professionals — the pain first, our product as the obvious fix'],
            ].map(([name, text]) => (
              <button key={name} type="button" className="starter-chip" title={text}
                onClick={() => setSeed({ text, n: Date.now() })}>{name}</button>
            ))}
          </div>
        )}

      {phase === 'briefing' && !brief?.brief && (
        <div className="brief-card in-flow" aria-busy="true" aria-label="Drafting your campaign brief">
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
        <div className="brief-card in-flow">
          <div className="row mat" style={{ '--i': 0, justifyContent: 'space-between', marginBottom: 8 }}>
            <h3>{brief.brief.title || 'Campaign brief'}</h3>
            <QlooBadge mode={status?.qloo === 'live' ? 'live' : 'off'} label="Qloo API" />
          </div>
          <div className="brief-field mat" style={{ '--i': 1 }}><span className="k">Angle</span><span className="v">{brief.brief.angle}</span></div>
          <div className="brief-field mat" style={{ '--i': 2 }}><span className="k">Audience</span><span className="v">{brief.brief.audience}</span></div>
          <div className="brief-field mat" style={{ '--i': 3 }}><span className="k">Key message</span><span className="v">{brief.brief.keyMessage}</span></div>
          <div className="brief-field mat" style={{ '--i': 4 }}>
            <span className="k">Channels</span>
            <span className="v chip-row">{(brief.brief.channels || []).map((c) => <span key={c} className="chan-chip">{chanLabel(c)}</span>)}</span>
          </div>
          {brief.brief.urlContext && (
            <div className="brief-field mat" style={{ '--i': 4 }}>
              <span className="k">Source link</span>
              <span className="v"><a href={brief.brief.urlContext.url} target="_blank" rel="noreferrer" style={{ color: 'inherit' }}>{brief.brief.urlContext.title || brief.brief.urlContext.url}</a></span>
            </div>
          )}
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
      </div>

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
