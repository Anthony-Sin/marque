import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { api, pollJob } from '../api.js';
import { useApp } from '../App.jsx';
import Icon from '../components/Icon.jsx';
import Composer, { arCss, isRaster, MediaFallback, fmtDate, providerLabel, thumb } from '../components/Composer.jsx';
import CreativeCard from '../components/CreativeCard.jsx';
import CreativeEditor from '../components/CreativeEditor.jsx';
import EvidenceDrawer from '../components/EvidenceDrawer.jsx';
import Modal from '../components/Modal.jsx';
import { QlooBadge, SignalChips } from '../components/Qloo.jsx';
import { chanLabel, cleanErr } from '../labels.js';
import './studio.css';

const EXPECTED_CREATIVES = 4; // fallback skeleton count — the campaign record's own `expected` wins when present
const COUNT_STEPS = [2, 4, 6]; // honest set sizes the campaign pipeline accepts

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
  const { profile, say, status, board } = useApp();
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
  const [deleting, setDeleting] = useState(null);  // campaign pending delete confirm
  const [handoff, setHandoff] = useState(null);      // {strategy, notes, prompt, productId, exampleRefs?, auto?, output?, strategyIdx?}
  const autoRan = useRef(false);                     // produce-flow auto-confirm fires once
  const resumeDead = useRef(new Set());              // campaign ids whose in-flight run the server can no longer confirm
  const [liveAspect, setLiveAspect] = useState('4:5'); // composer's real pill state
  const [engine, setEngine] = useState('auto');        // campaign-level image engine override
  const [creativeCount, setCreativeCount] = useState(EXPECTED_CREATIVES); // set size for the next run
  const [reroll, setReroll] = useState(null);          // batch re-render progress {i,total} while running
  const [rrMap, setRrMap] = useState({});              // creativeId → queued | spin | done | fail
  const [rrNote, setRrNote] = useState('');            // inline result/stop note in the CRE zone head
  const rrCtl = useRef(null);                          // {cancel} — leaving the detail view stops the loop

  const reload = async () => {
    try { setCampaigns((await api.listCampaigns()).campaigns || []); }
    catch (e) { say(e.message); setCampaigns([]); }
  };
  useEffect(() => { reload(); }, []);

  // deep links: /campaigns?open=<id> (dashboard "Recent work" cards land here)
  // plus ?edit=<creativeId> — the editor modal is a pushed history entry, so
  // browser Back closes the modal instead of overshooting out of the campaign
  useEffect(() => {
    const q = new URLSearchParams(loc.search);
    const want = q.get('open');
    const editId = q.get('edit');
    const camp = want && campaigns?.find((c) => c.id === want);
    if (camp) {
      setOpenId(want);
      if (editId) {
        const cr = (camp.creatives || []).find((x) => x.id === editId);
        if (cr) setEditing(cr);
        else {
          // stale creative id — strip the param, keep the campaign open
          q.delete('edit');
          nav(`/campaigns?${q.toString()}`, { replace: true });
        }
      } else if (editing) setEditing(null);   // browser Back popped the editor entry
    } else if (want && campaigns) nav('/campaigns', { replace: true });  // stale id — clean the url
    else if (!want && openId) { setOpenId(null); setEditing(null); }      // browser Back left the detail
    else if (!want && editId && campaigns) {
      // ?edit without ?open — resolve the creative's campaign and complete
      // the link; no owner on record → strip the param rather than leave a lie
      const owner = campaigns.find((c) => (c.creatives || []).some((x) => x.id === editId));
      nav(owner ? `/campaigns?open=${owner.id}&edit=${editId}` : '/campaigns', { replace: true });
    }
  }, [loc.search, campaigns]); // eslint-disable-line react-hooks/exhaustive-deps

  // opening the editor PUSHES ?edit= (see above); the modal close acts like
  // Back — pops our own entry when we pushed it this session, else replaces
  // (a cold-opened edit link has no prior in-app entry to pop to)
  const editPushed = useRef(false);
  const openEditor = (cr) => {
    if (!cr?.id || !open) return;
    editPushed.current = true;
    nav(`/campaigns?open=${open.id}&edit=${cr.id}`);
  };
  const closeEditor = () => {
    setEditing(null);
    if (editPushed.current) { editPushed.current = false; nav(-1); }
    else if (open) nav(`/campaigns?open=${open.id}`, { replace: true });
  };


  // Strategy board handoff: 'strategyHandoff' is written by the Strategy view's
  // "Use this strategy" button. Consume once → composer chip + auto-start brief.
  // Optional `exampleRefs: [{platform,title,author,url,note}]` fold into the
  // brief text as a "Reference examples:" section.
  const freshHandoffRef = useRef(false);
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem('strategyHandoff');
      if (!raw) return;
      sessionStorage.removeItem('strategyHandoff');
      freshHandoffRef.current = true;   // a fresh produce beat a stale draft restore
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
      genBrief({
        prompt: merged,
        productId: data.productId || undefined,
        // board context → the brief may carry that board's taste signals
        boardId: data.boardId || undefined,
        strategyId: data.strategyId || data.strategy?.id || undefined,
      });
      say(data.auto ? `Strategy loaded — producing ${({ ads: 'ad set', motion: 'motion ad', video: 'AI video' })[data.output] || 'output'}` : 'Strategy loaded — review the brief, then hit Produce');
    } catch { /* malformed stash — ignore */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // produce flow: a handoff stages the prefilled brief for ONE confirm click —
  // a real render run never fires just because the user arrived. Auto-confirm
  // only on explicit opt-in: ?autorun=1 in the URL, or a handoff carrying
  // auto:true. The param is consumed so a reload can't re-fire a paid run.
  const autorun = new URLSearchParams(loc.search).get('autorun') === '1';
  useEffect(() => {
    // freshHandoffRef = the handoff was consumed this mount — a restored draft
    // can never auto-fire a real run even with ?autorun=1 still in the URL
    const want = !!handoff && (handoff.auto === true || (autorun && freshHandoffRef.current));
    if (!want || !brief?.brief || autoRan.current || busy) return;
    autoRan.current = true;
    if (autorun) nav('/campaigns', { replace: true });
    confirmBrief();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [brief, handoff, autorun]);

  // a drafted-but-unconfirmed brief shouldn't vanish on navigation — stash it
  // and restore on return (a pending handoff always drafts fresh instead)
  useEffect(() => {
    try {
      if (freshHandoffRef.current) return;   // fresh produce handoff already consumed
      const raw = sessionStorage.getItem('marque.briefDraft');
      if (raw) {
        const d = JSON.parse(raw);
        setBrief(d.brief || null); setDraft(d.draft || null);
        // a restored handoff must never auto-fire produce again — a failed
        // create would otherwise re-run on every mount
        if (d.handoff) setHandoff({ ...d.handoff, auto: false });
      }
    } catch { /* ignore */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    try {
      if (brief) sessionStorage.setItem('marque.briefDraft', JSON.stringify({ brief, draft, handoff }));
      else sessionStorage.removeItem('marque.briefDraft');
    } catch { /* ignore */ }
  }, [brief]);

  // auto-resume — reopening (or reloading into) a campaign whose render job is
  // still in flight keeps the live feed instead of dead-ending on "check
  // again". Re-attaches to the persisted job for real progress; records that
  // predate jobId fall back to polling the campaign itself. confirmBrief's own
  // poll owns the session run (making === openId), so resume only takes over
  // when nothing local is driving.
  useEffect(() => {
    const c = (campaigns || []).find((x) => x.id === openId);
    if (!openId || !c || c.genStatus !== 'running' || making === openId || resumeDead.current.has(c.id)) return undefined;
    let dead = false;
    const finish = () => { if (!dead) { setJobProg(null); reload(); } };
    if (c.jobId) {
      pollJob(c.jobId, { onTick: (j) => { if (!dead) setJobProg(j.progress || null); } })
        .then(finish)
        .catch((e) => {
          // the job is gone (server restart) — stop auto-polling; the manual
          // Check-again button remains for a genuinely stuck record
          if (e?.status === 404) resumeDead.current.add(c.id);
          finish();
        });
      return () => { dead = true; };
    }
    let ticks = 0;
    const t = setInterval(async () => {
      try {
        const { campaign: fresh } = await api.getCampaign(openId);
        if (dead) return;
        if (!fresh || fresh.genStatus !== 'running' || (fresh.creatives || []).length || ++ticks > 240) {
          clearInterval(t);
          if (fresh?.genStatus === 'running' && !(fresh.creatives || []).length) resumeDead.current.add(c.id);
          finish();
        }
      } catch { /* transient — next tick retries */ }
    }, 2500);
    return () => { dead = true; clearInterval(t); };
  }, [openId, campaigns, making]); // eslint-disable-line react-hooks/exhaustive-deps

  // batch re-render housekeeping — leaving the detail view (Back, another
  // campaign, or unmount) cancels the loop between posts; an in-flight regen
  // still lands its tile update. Per-tile rings + notes reset per campaign.
  useEffect(() => {
    setRrMap({}); setRrNote('');
    return () => { if (rrCtl.current) rrCtl.current.cancel = true; };
  }, [openId]);

  const open = (campaigns || []).find((c) => c.id === openId) || null;

  // live strategy titles — the campaign's stored strategyTitle goes stale when
  // the source strategy is renamed or regenerated. Resolve the CURRENT title
  // from the board record (ctx board when it's active; lazy fetch otherwise)
  // and fall back to what the campaign recorded at creation.
  const [stratBoards, setStratBoards] = useState({}); // boardId → full board
  useEffect(() => {
    const ids = [...new Set((campaigns || []).map((c) => c.boardId).filter(Boolean))]
      .filter((id) => id !== board?.id && !stratBoards[id]);
    if (!ids.length) return;
    let dead = false;
    Promise.allSettled(ids.map((id) => api.board(id))).then((rs) => {
      if (dead) return;
      setStratBoards((m) => {
        const n = { ...m };
        rs.forEach((r, i) => { if (r.status === 'fulfilled' && r.value?.board) n[ids[i]] = r.value.board; });
        return n;
      });
    });
    return () => { dead = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [campaigns, board?.id]);

  const liveStratTitle = (c) => {
    const b = (c.boardId && board?.id === c.boardId ? board : null) || stratBoards[c.boardId];
    if (!b) return c.strategyTitle || '';
    const s = (b.strategies || []).find((x) => x.id && x.id === c.strategyId);
    if (s?.title) return s.title;
    // board loaded, strategy gone (deleted or regenerated) — the stored label
    // is stale, so name the group after the campaign itself
    if (c.strategyId) return c.title || '';
    return c.strategyTitle || '';
  };

  // group "Your campaigns" by the strategy that spawned them (handoff metadata)
  const groups = useMemo(() => {
    const byStrat = new Map();  // key → { key, title, items }
    const other = [];
    for (const c of campaigns || []) {
      const key = `${c.boardId || ''}:${c.strategyId || c.strategyTitle || ''}`;
      if (key === ':') { other.push(c); continue; }
      if (!byStrat.has(key)) byStrat.set(key, { key, title: liveStratTitle(c) || 'strategy', items: [] });
      byStrat.get(key).items.push(c);
    }
    return { strat: [...byStrat.values()], other };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [campaigns, board, stratBoards]);

  const confirmDelete = async () => {
    const c = deleting;
    setDeleting(null);
    if (!c?.id) return;
    try { await api.deleteCampaign(c.id); } catch (e) { say(e.message || 'Delete failed'); return; }
    setCampaigns((cs) => (cs || []).filter((x) => x.id !== c.id));
    if (openId === c.id) show(null);
  };

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
                <img src={thumb(cr.imagePath, 200)} alt="" loading="lazy" />
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
        <button className="icon-btn sm camp-del" title="Delete campaign" aria-label="Delete campaign" onClick={(e) => {
          e.stopPropagation();
          setDeleting(c);
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
        strategyIdx: Number.isInteger(handoff?.strategyIdx) ? handoff.strategyIdx : undefined,
        boardId: handoff?.boardId || undefined,
        provider: engine !== 'auto' ? engine : undefined,
        medium: handoff?.output === 'video' ? 'video' : undefined,
        count: creativeCount,
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
        // motion output — animate the strongest creative once the set lands
        if (handoff?.output === 'motion') {
          const { campaigns: fresh } = await api.listCampaigns().catch(() => ({ campaigns: [] }));
          const freshCamp = (fresh || []).find((x) => x.id === campaign.id);
          const hero = (freshCamp?.creatives || [])
            .filter((x) => !x.failed && x.imagePath)
            .sort((a, b) => (+b.score || +b.grade || 0) - (+a.score || +a.grade || 0))[0];
          if (hero) {
            setAnimating(hero.id);
            try {
              const { job: aj } = await api.animateCreative(hero.id);
              if (aj?.id) await pollJob(aj.id);
              await reload();
            } catch (e) { say(e.message); }
            setAnimating('');
          }
        }
      } else if (job?.id) {
        await pollJob(job.id, { onTick: (j) => setJobProg(j.progress || null) }).catch((e) => say(e.message));
        setJobProg(null);
        await reload();
      }
      setBrief(null);
      setHandoff(null);
      // deduped re-confirm can return a run that's still in flight — say so
      // instead of claiming "ready" over a filling grid (resume poll carries it)
      const stillRunning = campaign?.genStatus === 'running';
      say(stillRunning
        ? 'Generation in flight — creatives land in the campaign as they render'
        : handoff?.output === 'motion' ? 'Motion ad ready' : handoff?.output === 'video' ? 'AI video units ready' : 'Campaign ready');
    } catch (e) { say(e.message); }
    setMaking('');
    setBusy(false); setPhase('idle');
  };

  // site-demo video — films the generated website into a campaign creative
  const demoVideo = async () => {
    if (!open) return;
    setAnimating('demo');
    try {
      const { job } = await api.campaignDemoVideo(open.id);
      await pollJob(job.id);
      await reload();
      say('Site demo video added to the campaign');
    } catch (e) { say(e.message); }
    setAnimating('');
  };

  // produce-chain continuations — a result feeds the next artifact: the site
  // inherits this campaign's palette/product/creatives, the book compiles the brand
  const [producingNext, setProducingNext] = useState('');  // 'site' | 'book'
  const makeWebsite = async () => {
    if (!open || producingNext) return;
    setProducingNext('site');
    try {
      await api.createWebsite({
        prompt: `Site extending the "${open.brief?.title || 'campaign'}" campaign — same brand palette, same product, same message.`,
        campaignId: open.id,
      });
      say('Site drafted from this campaign');
      nav('/websites?tab=site');
    } catch (e) { say(e.message); }
    setProducingNext('');
  };
  const makeBook = async () => {
    if (producingNext) return;
    setProducingNext('book');
    try {
      await api.createBrandBook({});
      say('Brand book compiled');
      nav('/brandbook');
    } catch (e) { say(e.message); }
    setProducingNext('');
  };
  const fmtV = (n) => { const v = +n || 0; return v >= 1e6 ? `${(v / 1e6).toFixed(1).replace(/\.0$/, '')}M` : v >= 1e3 ? `${Math.round(v / 1e3)}K` : `${v}`; };

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

  // ---------- re-render stills (batch + per-tile reroll) ----------
  // engine for a regen — the creative's own provider when it's a real image
  // engine ('local-sdxl-turbo' → 'local'); anything else falls back to local
  const rrProvider = (cr) => {
    const p = String(cr?.imageProvider || '').split('-')[0];
    return ['local', 'gemini', 'pollinations'].includes(p) ? p : 'local';
  };
  // the endpoint 200s even when the render fails — the honest signal is a
  // placeholder/error flag on the returned creative, not the HTTP status
  const rrOk = (cr) => !!cr && !cr.imageError && !cr.placeholder;
  // fold a regenerated creative back into the open campaign so its tile
  // refreshes in place — no full reload between posts
  const applyCreative = (campId, next) => {
    if (!next) return;
    next.imageAt = new Date().toISOString();   // 'rendered just now' stamp for the editor microline
    setCampaigns((cs) => (cs || []).map((c) => (c.id === campId
      ? { ...c, creatives: (c.creatives || []).map((x) => (x.id === next.id ? next : x)) }
      : c)));
  };

  // per-tile hover reroll — one click, no editor round-trip
  const rerollOne = async (cr) => {
    if (!open || reroll || rrMap[cr.id] === 'spin') return;
    setRrMap((m) => ({ ...m, [cr.id]: 'spin' }));
    let ok = false;
    try {
      const { creative: next } = await api.regenCreativeImage(cr.id, undefined, rrProvider(cr));
      applyCreative(open.id, next);
      ok = rrOk(next);
      if (!ok) say(`Re-render failed — ${cleanErr(next?.imageError, 120) || 'renderer returned a placeholder'}`);
    } catch (e) { say(e.message); }
    setRrMap((m) => ({ ...m, [cr.id]: ok ? 'done' : 'fail' }));
  };

  // header batch — sequential regen of every still in the visible campaign.
  // Stops early on a 3-failure streak (a wedged local renderer won't recover
  // mid-run) and reports the streak honestly instead of grinding through.
  const rerollAll = async () => {
    if (!open || reroll) return;
    const targets = (open.creatives || []).filter((cr) => cr.imagePath);
    if (!targets.length) return;
    const ctl = { cancel: false };
    rrCtl.current = ctl;
    setRrNote('');
    setRrMap(Object.fromEntries(targets.map((cr) => [cr.id, 'queued'])));
    setReroll({ i: 0, total: targets.length });
    let streak = 0, fails = 0, stopped = false;
    for (let i = 0; i < targets.length; i++) {
      if (ctl.cancel) break;
      const cr = targets[i];
      setReroll({ i: i + 1, total: targets.length });
      setRrMap((m) => ({ ...m, [cr.id]: 'spin' }));
      let ok = false;
      try {
        const { creative: next } = await api.regenCreativeImage(cr.id, undefined, rrProvider(cr));
        applyCreative(open.id, next);
        ok = rrOk(next);
      } catch { /* counted as a failure below */ }
      fails += ok ? 0 : 1;
      streak = ok ? 0 : streak + 1;
      setRrMap((m) => ({ ...m, [cr.id]: ok ? 'done' : 'fail' }));
      if (streak >= 3) { stopped = true; break; }
    }
    setReroll(null);
    if (rrCtl.current === ctl) rrCtl.current = null;
    if (ctl.cancel) return;
    if (stopped) {
      setRrNote('local renderer unstable — stopped early');
      say('Re-render stopped early — 3 failures in a row');
    } else if (fails) {
      setRrNote(`${targets.length - fails}/${targets.length} re-rendered — ${fails} failed`);
    } else {
      setRrNote(`${targets.length} still${targets.length === 1 ? '' : 's'} re-rendered`);
    }
  };

  // ---------- detail: the final result ----------
  if (open) {
    const creatives = open.creatives || [];
    // in-flight = this session's run OR a run the server still reports running
    // (reloaded mid-generation — the resume effect above drives the live poll).
    // A record the server can no longer confirm (lost job) drops back to the
    // manual empty state instead of shimmering forever.
    const filling = making === open.id || (open.genStatus === 'running' && !resumeDead.current.has(open.id));
    const expected = open.expected || EXPECTED_CREATIVES;
    const pendingSkels = filling ? Math.max(0, expected - creatives.length) : 0;
    const snap = open.strategySnapshot || null;
    const palKeys = Object.entries(profile?.colors || {}).filter(([, v]) => /^#|rgb/.test(String(v))).slice(0, 6);
    const hasProv = !!(snap || open.strategyTitle || palKeys.length > 0);
    return (
      <div className="section view cp-view">
        <div className="view-head cp-head">
          <div className="vh-main">
            <button className="btn ghost sm cp-back" onClick={() => show(null)}>
              ← All campaigns
            </button>
            <span className="vh-kicker">MARQUE / OUTPUT</span>
            <h2 className="display">{open.brief?.title || 'Campaign'}</h2>
            {open.brief?.angle && <p className="sub">{open.brief.angle}</p>}
            {open.brief?.keyMessage && (
              <p className="res-km">“{open.brief.keyMessage}”{open.brief.audience ? <span className="res-km-aud"> — aimed at {open.brief.audience}</span> : ''}</p>
            )}
          </div>
          <div className="vh-side">
            <div className="row wrap">
              {(open.brief?.channels || []).map((c) => <span key={c} className="chan-chip">{chanLabel(c)}</span>)}
              <span className="chan-chip">{open.aspectRatio || '1:1'}</span>
              {open.medium === 'video' && <span className="chan-chip"><Icon name="play" size={10} /> video-first</span>}
              <SignalChips signals={open.qlooSignals || []} />
              <button className="btn ghost sm" onClick={() => setEvi(true)}>
                <Icon name="qloo" size={14} /> Evidence
              </button>
            </div>
            <div className="res-next">
              <span className="res-next-lbl">Next output</span>
              <button className="btn ghost sm" disabled={!!producingNext} onClick={makeWebsite}
                title="Generate a marketing site that reuses this campaign's palette, product and creative imagery">
                {producingNext === 'site' ? <span className="spinner" /> : <Icon name="site" size={13} />} Website
              </button>
              <button className="btn ghost sm" disabled={animating === 'demo' || !!producingNext} onClick={demoVideo}
                title="Render the generated website locally and capture a real scroll video into this campaign">
                {animating === 'demo' ? <span className="spinner" /> : <Icon name="film" size={13} />} Site film
              </button>
              <button className="btn ghost sm" disabled={!!producingNext} onClick={makeBook}
                title="Compile the printable brand book">
                {producingNext === 'book' ? <span className="spinner" /> : <Icon name="book" size={13} />} Brand book
              </button>
            </div>
          </div>
        </div>
        <div className={`cp-split${hasProv ? '' : ' solo'}`}>
          {hasProv && (
            <section className="card hud cp-panel cp-prov">
              <div className="zone-head"><span className="z-id">PRV</span>Provenance</div>
              <div className="cp-panel-body">
                {/* provenance — which strategy produced this, what the board
                    measured, and the palette every downstream artifact inherits */}
                <div className="res-src">
                  {(snap?.title || open.strategyTitle) && (
                    <span className="res-from"><Icon name="sparkle" size={11} /> from strategy <b>{liveStratTitle(open) || snap?.title}</b></span>
                  )}
                  {typeof snap?.fit === 'number' && (
                    <span className="res-fit" title="audience-fit score from the strategy board">{Math.round(snap.fit * 100)} fit</span>
                  )}
                  {!!snap?.estViews && (
                    <span className="res-reach" title="board-estimated reach for this strategy"><Icon name="eye" size={11} />{fmtV(snap.estViews)} est.</span>
                  )}
                  {!!snap?.lean && <span className="chan-chip" title="audience lean from the taste read">{snap.lean}</span>}
                  {(snap?.vibes || []).slice(0, 4).map((v) => <span key={v} className="chan-chip res-vibe">{v}</span>)}
                  <QlooBadge mode={open.qlooBundle?.mode === 'live' ? 'live' : 'off'} label="Taste graph" />
                </div>
                {!!palKeys.length && (
                  <div className="res-pal" title="Brand palette — the site and brand book inherit these">
                    {palKeys.map(([k, v]) => (
                      <span key={k} className="res-sw" style={{ background: v }} title={`${k} · ${v}`} />
                    ))}
                  </div>
                )}
                {/* board notes — the steering text the creatives were written against */}
                {!!open.notes && (
                  <div className="cp-notes">
                    <div className="section-label">Board notes</div>
                    <p>“{open.notes}”</p>
                  </div>
                )}
                {/* ledger — the honest facts on record for this campaign */}
                <div className="cp-dl">
                  {open.createdAt && <div className="cp-dl-row"><span>Created</span><b>{fmtDate(open.createdAt)}</b></div>}
                  {!!open.brief?.audience && <div className="cp-dl-row"><span>Audience</span><b>{open.brief.audience}</b></div>}
                  {!!(open.brief?.channels || []).length && (
                    <div className="cp-dl-row"><span>Channels</span><b>{open.brief.channels.map(chanLabel).join(' · ')}</b></div>
                  )}
                  <div className="cp-dl-row"><span>Format</span><b>{open.aspectRatio || '1:1'}{open.medium === 'video' ? ' · video-first' : ''}</b></div>
                  <div className="cp-dl-row"><span>Creatives</span><b>{creatives.length}{open.expected && open.expected !== creatives.length ? ` of ${open.expected} planned` : ''}</b></div>
                  {!!creatives.length && (() => {
                    const mix = {};
                    for (const cr of creatives) mix[cr.medium || 'image'] = (mix[cr.medium || 'image'] || 0) + 1;
                    return (
                      <div className="cp-dl-row"><span>Mix</span><b>{Object.entries(mix).map(([m, n]) => `${n} ${m}`).join(' · ')}</b></div>
                    );
                  })()}
                  {(() => {
                    const g = creatives.map((cr) => +cr.grade || 0).filter(Boolean);
                    return g.length ? (
                      <div className="cp-dl-row"><span>Grade</span><b>★ {(g.reduce((a, b) => a + b, 0) / g.length).toFixed(1)} avg</b></div>
                    ) : null;
                  })()}
                  {!!open.evidence?.calls?.length && (
                    <div className="cp-dl-row"><span>Evidence</span><b>{open.evidence.calls.length} audience calls on record</b></div>
                  )}
                </div>
              </div>
            </section>
          )}
          <section className="card hud cp-panel cp-bay">
            <div className="zone-head">
              <span className="z-id">CRE</span>Creatives
              <span className="z-tag">{creatives.length} TOTAL</span>
              <span className="rr-cluster" aria-live="polite">
                {!!rrNote && !reroll && <span className="rr-note">{rrNote}</span>}
                <button type="button" className="rr-btn"
                  disabled={!!reroll || !creatives.some((cr) => cr.imagePath)}
                  title={reroll
                    ? `Re-rendering ${reroll.i}/${reroll.total} — sequential, each takes a few seconds`
                    : 'Re-render every still in this campaign — sequential regen, honest progress'}
                  onClick={rerollAll}>
                  {!!reroll && <span className="spinner" />}
                  {reroll ? `REROLL ${reroll.i}/${reroll.total}` : `REROLL ×${creatives.filter((cr) => cr.imagePath).length}`}
                </button>
              </span>
            </div>
            <div className="cp-panel-body">
              <div className="creative-grid">
                {creatives.map((cr) => (
                  <div key={cr.id} className="cc-wrap">
                    <CreativeCard
                      creative={cr}
                      campaign={open}
                      aspect={open.aspectRatio}
                      animating={animating === cr.id || rrMap[cr.id] === 'spin'}
                      onEdit={openEditor}
                      onAnimate={animateOne}
                      onChanged={reload}
                    />
                    <span className="cc-tools">
                      {(!!cr.videoPath || cr.medium === 'video') && (
                        <span className="cc-motion"
                          title={cr.videoPath
                            ? `Motion unit${cr.videoProvider ? ` · ${providerLabel(cr.videoProvider)}` : ''}`
                            : cr.videoState === 'error' ? 'Planned motion — render failed' : 'Planned as a motion unit'}>
                          <Icon name="film" size={9} />motion
                        </span>
                      )}
                      {!!rrMap[cr.id] && (
                        <span className={`cc-ring ${rrMap[cr.id]}`} role="status"
                          title={{ queued: 'Queued for re-render', spin: 'Re-rendering…', done: 'Re-rendered', fail: 'Re-render failed' }[rrMap[cr.id]]} />
                      )}
                      {!!cr.imagePath && rrMap[cr.id] !== 'spin' && (
                        <button type="button" className="cc-reroll" disabled={!!reroll}
                          title="Reroll — regenerate this image in place"
                          onClick={(e) => { e.stopPropagation(); rerollOne(cr); }}>
                          <Icon name="refresh" size={10} />reroll
                        </button>
                      )}
                    </span>
                  </div>
                ))}
                {Array.from({ length: pendingSkels }, (_, i) => skelCreative(i, open.aspectRatio))}
              </div>
              {!creatives.length && !pendingSkels && (
                <div className="empty">
                  {open.genStatus === 'error' ? (
                    <p title={open.genError || undefined}>Generation failed — {String(open.genErrorHuman || 'every render engine failed').replace(/\.$/, '')}. Hit Regenerate to retry.</p>
                  ) : (
                    <p>No creatives yet — generation may still be running.</p>
                  )}
                  <button className="btn ghost sm" onClick={reload}>
                    <Icon name="refresh" size={13} /> Check again
                  </button>
                </div>
              )}
            </div>
          </section>
        </div>
        {editing && (
          <CreativeEditor
            creative={editing}
            campaign={open}
            onClose={closeEditor}
            onSaved={() => reload()}
          />
        )}
        {evi && <EvidenceDrawer signals={open.qlooSignals || []} bundle={open.qlooBundle} calls={open.evidence?.calls} onClose={() => setEvi(false)} />}
      </div>
    );
  }

  // ---------- landing ----------
  const chans = (handoff?.strategy?.channels || []).map((c) => c.name || c).filter(Boolean);
  const nCamps = campaigns?.length || 0;
  return (
    <div className="section view cp-view">
      <div className="view-head">
        <div className="vh-main">
          <span className="vh-kicker">MARQUE / OUTPUT</span>
          <h1 className="display">Campaigns</h1>
          <p className="sub">Prompt a campaign or continue one below — brief first, creatives after.</p>
        </div>
      </div>

      <div className="cp-split">
      {/* brief console — composer on top, the brief materializes inside the
          same surface once it lands (prompt → brief → confirm, no seam) */}
      <section className={`card hud cp-panel cp-console${brief?.brief || phase === 'briefing' ? ' has-brief' : ''}`}>
        <div className="zone-head"><span className="z-id">BRI</span>Brief console</div>
        <div className="cp-panel-body">
        {handoff && (
          <div className="camp-src">
            <Icon name="sparkle" size={12} />
            <span className="camp-src-txt">
              from strategy: <b>{handoff.strategy?.title || handoff.strategyTitle || 'untitled'}</b>
              {!!chans.length && <i> · {chans.slice(0, 3).join(' · ')}</i>}
            </span>
            <button className="x" title="Dismiss" aria-label="Dismiss" onClick={() => setHandoff(null)}>✕</button>
          </div>
        )}
        <Composer seed={seed} busy={busy} onGenerate={genBrief} onAspect={setLiveAspect} />

        {/* starter chips — competitor-style tappable brief seeds; they only
            prefill the composer's prompt, the user still edits before generating */}
        {!brief?.brief && phase !== 'briefing' && (
          <div className="starter-row">
            <span className="starter-eng" title="Image engine for this campaign's creatives">
              <b>Engine</b>
              {['auto', 'local', 'gemini', 'pollinations'].map((id) => (
                <button key={id} type="button" className={`starter-chip eng${engine === id ? ' on' : ''}`}
                  title={id === 'auto' ? 'Default chain — studio render first, escalate on failure' : `Force ${providerLabel(id)} for all creatives in this campaign`}
                  onClick={() => setEngine(id)}>{providerLabel(id)}</button>
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

        {/* honest flow readout — what the console does, in three steps */}
        {!brief?.brief && phase !== 'briefing' && (
          <div className="cp-flow">
            <span className="cp-flow-step"><b>01</b>Prompt or starter chip</span>
            <span className="cp-flow-step"><b>02</b>Review the drafted brief</span>
            <span className="cp-flow-step"><b>03</b>Confirm — creatives land in the list</span>
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
            <QlooBadge mode={status?.qloo === 'live' ? 'live' : 'off'} label="Taste graph" />
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
          <div className="row mt16 mat cp-launch" style={{ '--i': 7, justifyContent: 'flex-end', gap: 10 }}>
            {/* set-size stepper — drives the `count` field on POST /campaigns;
                the skeleton grid + Ready line track whatever is picked */}
            <span className="cp-count" role="group" aria-label="Creatives to generate" title="Set size for this run">
              <b>Creatives</b>
              {COUNT_STEPS.map((n) => (
                <button key={n} type="button"
                  className={`starter-chip eng cp-count-chip${creativeCount === n ? ' on' : ''}`}
                  onClick={() => setCreativeCount(n)}>{n}</button>
              ))}
            </span>
            <span className="cp-ready">
              Ready — {creativeCount} creative{creativeCount === 1 ? '' : 's'}
              {handoff?.output === 'motion' ? ' + hero animation' : ''}{handoff?.output === 'video' ? ' · video-first' : ''}
              {' '}· est {creativeCount * 22.5 >= 120 ? `~${Math.round(creativeCount * 22.5 / 60)}m` : `~${Math.round(creativeCount * 22.5)}s`}
            </span>
            <span className="grow" />
            <button className="btn ghost" onClick={() => { setBrief(null); setHandoff(null); setPhase('idle'); }}>Discard</button>
            <button className="btn lime" disabled={busy} onClick={confirmBrief}>
              <Icon name="check" /> Produce — {creativeCount} creative{creativeCount === 1 ? '' : 's'}
            </button>
          </div>
        </div>
      )}

      {/* status line pinned to the console floor — real counts, no filler */}
      <div className="cp-console-foot">
        <Icon name="qloo" size={11} />
        <span>Grounded in your Business Profile{status?.qloo === 'live' ? ' + live taste graph' : ''}</span>
        <span className="grow" />
        <span className="cp-foot-n">{nCamps} campaign{nCamps === 1 ? '' : 's'} on record</span>
      </div>
        </div>
      </section>

      <section className="card hud cp-panel cp-list">
        <div className="zone-head"><span className="z-id">OUT</span>Your campaigns<span className="z-tag">{nCamps} TOTAL</span></div>
        <div className="cp-panel-body">
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
      </section>
      </div>

      {deleting && (
        <Modal narrow title="Delete this campaign?" onClose={() => setDeleting(null)}
          footer={(
            <>
              <button className="btn ghost" onClick={() => setDeleting(null)}>Cancel</button>
              <button className="btn pf-danger-solid" onClick={confirmDelete}>
                <Icon name="trash" size={14} /> Delete
              </button>
            </>
          )}>
          <p className="muted" style={{ margin: 0 }}>
            “{deleting.brief?.title || 'Untitled campaign'}” and its creatives will be removed.
          </p>
        </Modal>
      )}
    </div>
  );
}
