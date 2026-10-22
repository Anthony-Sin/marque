import React, { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { useApp } from '../App.jsx';
import Icon, { Logo } from '../components/Icon.jsx';
import Modal from '../components/Modal.jsx';
import './dashboard.css';

// the pipeline, as a journey — each step is a live stat card that opens its section.
const FLOW = [
  { to: '/strategy', icon: 'sparkle', label: 'Strategy', free: true },
  { to: '/campaigns', icon: 'campaign', label: 'Campaign' },
  { to: '/photoshoot', icon: 'photo', label: 'Create' },
  { to: '/websites', icon: 'site', label: 'Publish' },
];

const CHAN_ICON = {
  instagram: 'image', tiktok: 'film', youtube: 'play', tv: 'site', streaming: 'share',
  podcast: 'mic', ooh: 'aspect', guerrilla: 'megaphone', email: 'send', press: 'book',
};
const chanIcon = (c) => CHAN_ICON[String(c || '').toLowerCase()] || 'sparkle';
const fmtViews = (n) => {
  const v = +n || 0;
  if (v >= 1e6) return `${(v / 1e6).toFixed(1).replace(/\.0$/, '')}M`;
  if (v >= 1e3) return `${Math.round(v / 1e3)}K`;
  return `${v}`;
};
const fmtDate = (v) => {
  const d = v ? new Date(v) : null;
  return d && !Number.isNaN(+d) ? d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '';
};
// creatives store their render under imagePath / image.path / path — grab whichever exists
const creativeImg = (cr) => cr?.image?.path || cr?.imagePath || cr?.path || '';
// a ctx board (no summary endpoints yet) → the summary shape the cards render
const asSummary = (b) => b && ({
  id: b.id, title: b.title || 'Strategy board', createdAt: b.createdAt,
  strategyCount: (b.strategies || []).length || undefined, sub: b.sub,
});

export default function Dashboard() {
  const { profile, board, setBoard, boards: ctxBoards, setBoards, openBoard, say } = useApp();
  const nav = useNavigate();
  const [dash, setDash] = useState(undefined);   // undefined = loading
  const [work, setWork] = useState([]);          // recent campaigns enriched w/ thumbnails + grade
  const [badImg, setBadImg] = useState({});      // creative thumbnails that failed to load → collapse
  const [fullBoards, setFullBoards] = useState({}); // boardId → full board (strategy titles)
  const [renaming, setRenaming] = useState(null); // board id being renamed
  const [renameVal, setRenameVal] = useState('');
  const [deleting, setDeleting] = useState(null); // board summary pending confirm
  const renameRef = useRef(null);

  const load = async () => {
    try {
      const d = await api.dashboard();
      setDash(d);
      if (Array.isArray(d.boards)) setBoards?.(d.boards);
    } catch {
      // backend without /api/dashboard yet — synthesize from /api/boards or ctx
      try {
        const { boards } = await api.boards();
        setDash({ boards: boards || [], campaigns: [] });
        if (Array.isArray(boards)) setBoards?.(boards);
      } catch {
        setDash({ boards: board ? [asSummary(board)] : [], campaigns: [] });
      }
    }
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, []);

  const boards = (dash?.boards?.length ? dash.boards : ctxBoards) || [];
  const campaigns = dash?.campaigns || [];

  // plan cards list strategy titles — summaries don't carry them, so lazy-pull
  // the full board for the first few plans (the active one is already in ctx).
  useEffect(() => {
    const want = boards.slice(0, 6).filter((b) => b.id && !(board?.id === b.id) && !fullBoards[b.id]);
    if (!want.length) return;
    let dead = false;
    Promise.allSettled(want.map((b) => api.board(b.id))).then((rs) => {
      if (dead) return;
      setFullBoards((m) => {
        const n = { ...m };
        rs.forEach((r, i) => { if (r.status === 'fulfilled' && r.value?.board) n[want[i].id] = r.value.board; });
        return n;
      });
    });
    return () => { dead = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boards, board?.id]);

  // recent-work strip: /api/dashboard campaigns carry no images — pull full
  // campaigns and grab the first creative thumbnail + best grade per campaign.
  useEffect(() => {
    if (dash === undefined) return;
    const recent = [...campaigns]
      .sort((a, b) => +new Date(b.createdAt || 0) - +new Date(a.createdAt || 0))
      .slice(0, 4);
    if (!recent.length) { setWork([]); return; }
    let dead = false;
    (async () => {
      try {
        const { campaigns: full = [] } = await api.listCampaigns();
        if (dead) return;
        setWork(recent.map((c) => {
          const f = full.find((x) => x.id === c.id) || {};
          const crs = f.creatives || [];
          const shot = crs.find((cr) => creativeImg(cr));
          return {
            ...c,
            title: c.title || f.brief?.title || 'Untitled campaign',
            strategyTitle: c.strategyTitle || f.strategyTitle || '',
            img: shot ? creativeImg(shot) : '',
            grade: Math.max(0, ...crs.map((cr) => +cr.grade || 0)),
          };
        }));
      } catch {
        if (!dead) setWork(recent.map((c) => ({ ...c, img: '', grade: 0 })));
      }
    })();
    return () => { dead = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dash]);

  useEffect(() => { if (renaming) renameRef.current?.focus(); }, [renaming]);

  // click a plan card → activate it on the server, then open the board view
  const open = async (b) => {
    if (renaming === b.id) return;
    if (b.id) {
      try { await openBoard(b.id); }
      catch (e) { say?.(e.message || 'could not open that plan'); return; }
    }
    nav('/strategy');
  };

  const commitRename = async (b) => {
    const title = renameVal.trim();
    setRenaming(null);
    if (!title || !b.id || title === b.title) return;
    try {
      await api.renameBoard(b.id, title);
      const patch = (x) => (x.id === b.id ? { ...x, title } : x);
      setDash((d) => d && { ...d, boards: (d.boards || []).map(patch) });
      setBoards?.((bs) => (bs || []).map(patch));
      if (board?.id === b.id) setBoard({ ...board, title });
      say?.('Plan renamed');
    } catch (e) { say?.(e.message || 'rename failed'); }
  };

  const confirmDelete = async () => {
    const b = deleting;
    setDeleting(null);
    if (!b?.id) return;
    try {
      await api.deleteBoard(b.id);
      setDash((d) => d && { ...d, boards: (d.boards || []).filter((x) => x.id !== b.id) });
      setBoards?.((bs) => (bs || []).filter((x) => x.id !== b.id));
      if (board?.id === b.id) {
        // the active plan was deleted — adopt whatever the server now calls active
        try { const { board: nb } = await api.getStrategy(); setBoard(nb || null); }
        catch { setBoard(null); }
      }
      say?.('Plan deleted');
    } catch (e) { say?.(e.message || 'delete failed'); }
  };

  if (profile === undefined || dash === undefined) {
    return <div className="loading-wrap"><div className="spinner" /></div>;
  }

  // live state per pipeline step — counts fed by /api/dashboard
  const stepStat = (to) => {
    if (to === '/strategy') return { n: boards.length, u: boards.length === 1 ? 'plan' : 'plans' };
    if (to === '/campaigns') return { n: campaigns.length, u: campaigns.length === 1 ? 'campaign' : 'campaigns' };
    if (to === '/photoshoot') return { n: dash.photoshootCount ?? '—', u: 'shoots' };
    return { n: dash.websiteCount ?? '—', u: (dash.websiteCount === 1 ? 'site' : 'sites') };
  };

  // top-2 strategy titles for a plan card — ctx board if it's active, else lazy fetch
  const stratTitles = (b) => {
    const full = (board?.id === b.id ? board : null) || fullBoards[b.id];
    return (full?.strategies || []).map((s) => s.title).filter(Boolean).slice(0, 2);
  };

  return (
    <div className="section dash-wrap">
      {/* ---------- header — the mark + name live here, not in a bar ---------- */}
      <header className="dash-head">
        <div className="dash-brand">
          <Logo size={30} />
          <span className="dash-brand-name">Marque</span>
          <span className="dash-brand-tag">STUDIO</span>
        </div>
        <h1 className="display dash-title">Dashboard</h1>
        <p className="dash-greet">What are we making today?</p>

        {/* pipeline — 4 connected steps, each a live stat card */}
        <div className="dash-flow" aria-label="pipeline">
          {FLOW.map((s, i) => {
            const locked = !s.free && !board;
            const st = stepStat(s.to);
            return (
              <button key={s.label} type="button" style={{ '--i': i }}
                className={`card dash-step${locked ? ' locked' : ''}`}
                title={locked ? 'Generate a strategy first — this step unlocks' : `Open ${s.label}`}
                onClick={() => nav(locked ? '/strategy' : s.to)}>
                <span className="dash-step-top">
                  <span className="dash-step-idx">{String(i + 1).padStart(2, '0')}</span>
                  <span className="dash-step-ic"><Icon name={locked ? 'lock' : s.icon} size={15} /></span>
                </span>
                <span className="dash-step-name">{s.label}</span>
                {locked ? (
                  <span className="dash-step-count dim">needs a board</span>
                ) : (
                  <span className="dash-step-count"><b>{st.n}</b> {st.u}</span>
                )}
              </button>
            );
          })}
        </div>
      </header>

      {!boards.length ? (
        /* ---------- empty state — one centered hero ---------- */
        <div className="card dash-empty">
          <div className="dash-empty-ic"><Icon name="sparkle" size={26} /></div>
          <h2 className="display">Create your first strategy board</h2>
          <p>
            One prompt becomes a board of audience-grounded strategies —
            then campaigns, photoshoots and sites flow from it.
          </p>
          <Link className="btn lime" to="/strategy">
            <Icon name="sparkle" size={16} /> Create your first strategy board
          </Link>
        </div>
      ) : (
        <>
          {/* ---------- your plans ---------- */}
          <div className="section-label">Your plans</div>
          <div className="grid c3">
            {boards.map((b) => {
              const active = board?.id && b.id === board.id;
              const titles = stratTitles(b);
              const extra = (b.strategyCount ?? 0) - titles.length;
              return (
                <div key={b.id || b.title} className={`card dash-plan${active ? ' on' : ''}`}
                  role="button" tabIndex={0}
                  onClick={() => open(b)}
                  onKeyDown={(e) => { if (e.key === 'Enter') open(b); }}>
                  <div className="dash-plan-top">
                    {renaming === b.id ? (
                      <input
                        ref={renameRef}
                        className="dash-plan-rename"
                        value={renameVal}
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) => setRenameVal(e.target.value)}
                        onKeyDown={(e) => {
                          e.stopPropagation();
                          if (e.key === 'Enter') commitRename(b);
                          if (e.key === 'Escape') setRenaming(null);
                        }}
                        onBlur={() => commitRename(b)}
                      />
                    ) : (
                      <h4>{b.title || 'Strategy board'}{active && <span className="dash-plan-live">active</span>}</h4>
                    )}
                    {!!b.id && renaming !== b.id && (
                      <span className="dash-plan-acts" onClick={(e) => e.stopPropagation()}>
                        <button type="button" className="icon-btn" title="Rename plan"
                          onClick={() => { setRenameVal(b.title || ''); setRenaming(b.id); }}>
                          <Icon name="edit" size={13} />
                        </button>
                        <button type="button" className="icon-btn danger" title="Delete plan"
                          onClick={() => setDeleting(b)}>
                          <Icon name="trash" size={13} />
                        </button>
                      </span>
                    )}
                  </div>
                  <div className="dash-plan-meta">
                    {fmtDate(b.createdAt)}{b.createdAt && b.strategyCount != null ? ' · ' : ''}
                    {b.strategyCount != null && `${b.strategyCount} strateg${b.strategyCount === 1 ? 'y' : 'ies'}`}
                  </div>
                  {!!b.sub?.prompt && <div className="dash-plan-sub">“{b.sub.prompt}”</div>}
                  {!!titles.length && (
                    <ul className="dash-plan-strats">
                      {titles.map((t) => <li key={t}>{t}</li>)}
                      {extra > 0 && <li className="more">+{extra} more</li>}
                    </ul>
                  )}
                  {!!(b.channels || []).length && (
                    <div className="chip-row">
                      {b.channels.slice(0, 4).map((c) => (
                        <span key={c} className="chan-chip">
                          <Icon name={chanIcon(c)} size={10} /> {c}
                        </span>
                      ))}
                    </div>
                  )}
                  <div className="dash-plan-foot">
                    {!!b.topReach && (
                      <span className="dash-reach" title="estimated reach">
                        <Icon name="eye" size={11} />{fmtViews(b.topReach)} est. views
                      </span>
                    )}
                    <span className="dash-plan-go">pick a strategy →</span>
                  </div>
                </div>
              );
            })}
            <button type="button" className="card dash-new" onClick={() => nav('/strategy?new=1')}>
              <Icon name="plus" size={20} /> New plan
            </button>
          </div>

          {/* ---------- recent work — media-first ---------- */}
          {!!work.length && (
            <>
              <div className="section-label">Recent work</div>
              <div className="dash-work">
                {work.map((c) => {
                  const showImg = c.img && !badImg[c.id];
                  return (
                    <Link key={c.id} to="/campaigns" className="card dash-work-card">
                      {showImg ? (
                        <span className="dash-work-media">
                          <img src={c.img} alt="" loading="lazy"
                            onError={() => setBadImg((m) => ({ ...m, [c.id]: true }))} />
                        </span>
                      ) : (
                        <span className="dash-work-media none"><Icon name="image" size={20} /></span>
                      )}
                      <span className="dash-work-body">
                        <b className="dash-work-title">{c.title || 'Untitled campaign'}</b>
                        {!!c.strategyTitle && (
                          <span className="dash-work-src">
                            <Icon name="sparkle" size={10} /> from strategy: <i>{c.strategyTitle}</i>
                          </span>
                        )}
                        <span className="dash-work-meta">
                          {c.creativeCount ?? 0} creatives
                          {!!c.grade && <em className="dash-work-grade">★ {c.grade}/5</em>}
                        </span>
                      </span>
                    </Link>
                  );
                })}
              </div>
            </>
          )}
        </>
      )}

      {deleting && (
        <Modal narrow title="Delete this plan?" onClose={() => setDeleting(null)}
          footer={(
            <>
              <button className="btn ghost" onClick={() => setDeleting(null)}>Cancel</button>
              <button className="btn pf-danger-solid" onClick={confirmDelete}>
                <Icon name="trash" size={14} /> Delete
              </button>
            </>
          )}>
          <p className="muted" style={{ margin: 0 }}>
            “{deleting.title || 'Strategy board'}” and its strategies will be removed.
            Campaigns already created from it are kept.
          </p>
        </Modal>
      )}
    </div>
  );
}
