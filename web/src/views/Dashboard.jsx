import React, { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { useApp } from '../App.jsx';
import Icon from '../components/Icon.jsx';
import Modal from '../components/Modal.jsx';
import { isRaster, MediaFallback, thumb } from '../components/Composer.jsx';
import { chanLabel } from '../labels.js';
import './dashboard.css';

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

  // ctx is a *loading* stand-in only — once the dashboard payload lands it's
  // authoritative, so a deleted board can't flash back in from cached ctx
  const boards = (dash ? dash.boards : ctxBoards) || [];
  const campaigns = dash?.campaigns || [];

  // plan cards list strategy titles — summaries don't carry them, so lazy-pull
  // the full board for the first few plans (the active one is already in ctx).
  useEffect(() => {
    // summaries carry titles/channels now — only fetch a full board when they don't
    const want = boards.slice(0, 6).filter((b) => b.id && !(board?.id === b.id) && !fullBoards[b.id] && !b.titles?.length);
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

  // campaign thumbs: /api/dashboard campaigns carry no images — pull full
  // campaigns and grab the first creative thumbnail + best grade per campaign.
  // Grouped by boardId so each plan card shows the work it produced.
  useEffect(() => {
    if (dash === undefined) return;
    const recent = [...campaigns]
      .sort((a, b) => +new Date(b.createdAt || 0) - +new Date(a.createdAt || 0));
    if (!recent.length) { setWork([]); return; }
    let dead = false;
    (async () => {
      try {
        const { campaigns: full = [] } = await api.listCampaigns();
        if (dead) return;
        setWork(recent.map((c) => {
          const f = full.find((x) => x.id === c.id) || {};
          const crs = f.creatives || [];
          // each thumb keeps its creative's caption — the strip reads as four
          // distinct renders, not four copies of the campaign title
          const shots = crs.filter((cr) => isRaster(creativeImg(cr)))
            .map((cr) => ({ src: creativeImg(cr), cap: cr.headline || cr.angle || '' }));
          return {
            ...c,
            boardId: c.boardId || f.boardId || null,
            title: c.title || f.brief?.title || 'Untitled campaign',
            strategyTitle: c.strategyTitle || f.strategyTitle || '',
            channel: (f.brief?.channels || [])[0] || '',
            img: shots[0]?.src || '',
            thumbs: shots.slice(0, 4),
            grade: Math.max(0, ...crs.map((cr) => +cr.grade || 0)),
          };
        }));
      } catch {
        if (!dead) setWork(recent.map((c) => ({ ...c, img: '', thumbs: [], channel: '', grade: 0 })));
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

  // top-3 strategy titles for a plan card — ctx board if it's active, else lazy fetch
  const stratTitles = (b) => {
    const full = (board?.id === b.id ? board : null) || fullBoards[b.id];
    return ((full?.strategies || []).map((s) => s.title).filter(Boolean).slice(0, 3).length
      ? full.strategies.map((s) => s.title).filter(Boolean).slice(0, 3)
      : (b.titles || []).slice(0, 3));
  };

  // long-form date for the deck header — the sheet's "issue date"
  const today = new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });

  const orphanWork = work.filter((c) => !boards.some((b) => b.id === c.boardId));
  return (
    <div className="section view dash-wrap">
      {/* ---------- header — route kicker + title left, date + stat tiles right ---------- */}
      <header className="dash-head">
        <div className="dash-head-l">
          <span className="vh-kicker">MARQUE / DECK</span>
          <h1 className="display dash-title">Dashboard</h1>
          <p className="dash-greet">What are we making today?</p>
        </div>
        <div className="dash-head-r">
          <span className="dash-date">{today}</span>
          <div className="dash-stats">
            <span className="dash-stat"><b>{boards.length}</b><i>plans</i></span>
            {!!work.length && <span className="dash-stat"><b>{work.length}</b><i>campaigns</i></span>}
            {!!board?.title && (
              <span className="dash-stat dash-stat-board" title={`Active plan — ${board.title}`}>
                <i>active plan</i><b className="dash-stat-board-t">{board.title}</b>
              </span>
            )}
          </div>
        </div>
      </header>

      {!boards.length ? (
        /* ---------- empty state — one centered hero ---------- */
        <div className="card dash-empty">
          <div className="dash-empty-ic"><Icon name="sparkle" size={26} /></div>
          <h2 className="display">Create your first strategy board</h2>
          <p>
            One prompt becomes a board of audience-grounded strategies —
            then ads, films, sites and the brand book flow from it.
          </p>
          <Link className="btn lime" to="/strategy">
            <Icon name="sparkle" size={16} /> Create your first strategy board
          </Link>
        </div>
      ) : (
        <div className={`dash-deck${orphanWork.length ? '' : ' no-work'}`}>
          {/* ---------- your plans ---------- */}
          <section className="card hud dash-zone">
            <div className="zone-head"><span className="z-id">P-01</span>Your plans<span className="z-tag">{boards.length} BOARD{boards.length === 1 ? '' : 'S'}</span></div>
            <div className="dash-zone-body">
              <div className="grid c3">
            {boards.map((b) => {
              const active = board?.id && b.id === board.id;
              const titles = stratTitles(b);
              const extra = (b.strategyCount ?? 0) - titles.length;
              const planWork = work.filter((c) => c.boardId === b.id);
              return (
                <div key={b.id || b.title} className={`card dash-plan${active ? ' on' : ''}`}
                  role="button" tabIndex={0}
                  onClick={() => open(b)}
                  onKeyDown={(e) => {
                    // only the card itself activates — Enter/Space bubbled up
                    // from a child (rename/delete buttons, work links) belongs
                    // to that child, not to the card's "open plan" shortcut
                    if (e.target !== e.currentTarget) return;
                    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(b); }
                  }}>
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
                        onBlur={() => setRenaming(null)}
                      />
                    ) : (
                      <h4>{b.title || 'Strategy board'}{active && <span className="dash-plan-live">active</span>}</h4>
                    )}
                    {!!b.id && renaming !== b.id && (
                      <span className="dash-plan-acts" onClick={(e) => e.stopPropagation()}>
                        <button type="button" className="icon-btn" title="Rename plan" aria-label="Rename plan"
                          onClick={() => { setRenameVal(b.title || ''); setRenaming(b.id); }}>
                          <Icon name="edit" size={13} />
                        </button>
                        <button type="button" className="icon-btn danger" title="Delete plan" aria-label="Delete plan"
                          onClick={() => setDeleting(b)}>
                          <Icon name="trash" size={13} />
                        </button>
                      </span>
                    )}
                  </div>
                  {!!b.createdAt && <div className="dash-plan-meta">{fmtDate(b.createdAt)}</div>}
                  {!!b.sub?.prompt && b.sub.prompt !== b.title && <div className="dash-plan-sub">“{b.sub.prompt}”</div>}
                  {!!titles.length && (
                    <ul className="dash-plan-strats">
                      {titles.map((t) => <li key={t}><span>{t}</span></li>)}
                      {extra > 0 && <li className="more"><span>+{extra} more</span></li>}
                    </ul>
                  )}
                  {!!(b.channels || []).length && (
                    <div className="chip-row">
                      {b.channels.slice(0, 4).map((c) => (
                        <span key={c} className="chan-chip">
                          <Icon name={chanIcon(c)} size={10} /> {chanLabel(c)}
                        </span>
                      ))}
                    </div>
                  )}
                  {/* base cluster — work strip + instrument stats + foot all
                      anchor to the card floor so the middle never reads dead */}
                  <div className="dash-plan-base">
                    {!!planWork.length && (
                      <div className="dash-plan-work" onClick={(e) => e.stopPropagation()}>
                        {planWork
                          .flatMap((c) => (c.thumbs?.length ? c.thumbs : [{ src: c.img, cap: '' }]).filter((t) => t.src)
                            .map((t) => ({ src: t.src, cap: t.cap, c })))
                          .slice(0, 5)
                          .map(({ src, cap, c }, i) => (
                            <Link key={`${c.id}:${i}`} to={`/campaigns?open=${c.id}`} className="dash-pw" title={cap || c.title}>
                              {!badImg[`${c.id}:${i}`] ? (
                                <img src={thumb(src, 160)} alt="" loading="lazy"
                                  onError={() => setBadImg((m) => ({ ...m, [`${c.id}:${i}`]: true }))} />
                              ) : (
                                <MediaFallback className="dash-pw-fb" seed={c.title} channel={c.channel} />
                              )}
                            </Link>
                          ))}
                        <span className="dash-pw-n-static" title={`${planWork.length} campaign${planWork.length === 1 ? '' : 's'} from this plan`}>
                          {planWork.length} campaign{planWork.length === 1 ? '' : 's'}
                        </span>
                      </div>
                    )}
                    {/* telemetry band — real per-plan counts, no filler */}
                    <div className="dash-plan-stats">
                      <span className="dp-stat"><b>{(b.strategyCount ?? titles.length) || '—'}</b><i>strategies</i></span>
                      <span className="dp-stat"><b>{planWork.length}</b><i>campaigns</i></span>
                      <span className="dp-stat" title={b.topReach ? 'estimated reach' : 'no reach estimate on record'}>
                        <b>{b.topReach ? fmtViews(b.topReach) : '—'}</b><i>est views</i>
                      </span>
                    </div>
                    <div className="dash-plan-foot">
                      <span className="dash-plan-go">pick a strategy →</span>
                    </div>
                  </div>
                </div>
              );
            })}
            <button type="button" className="card dash-new" onClick={() => nav('/strategy?new=1')}>
              <Icon name="plus" size={20} /> New plan
              <span className="dash-new-sub">draft a new strategy board</span>
            </button>
              </div>
            </div>
          </section>

          {/* ---------- other work — campaigns not tied to a shown plan ---------- */}
          {!!orphanWork.length && (
            <section className="card hud dash-zone dash-zone-work">
              <div className="zone-head"><span className="z-id">P-02</span>Recent output<span className="z-tag">{orphanWork.length} CAMPAIGN{orphanWork.length === 1 ? '' : 'S'}</span></div>
              <div className="dash-work">
                {orphanWork.map((c) => {
                  const showImg = c.img && !badImg[c.id];
                  return (
                    <Link key={c.id} to={`/campaigns?open=${c.id}`} className="card dash-work-card">
                      {showImg ? (
                        <span className="dash-work-media">
                          <img src={thumb(c.img, 480)} alt="" loading="lazy"
                            onError={() => setBadImg((m) => ({ ...m, [c.id]: true }))} />
                        </span>
                      ) : (
                        <MediaFallback className="dash-work-media"
                          seed={c.title} channel={c.channel} monogram={profile?.name} />
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
            </section>
          )}
        </div>
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
