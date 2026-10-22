import React, { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { useApp } from '../App.jsx';
import Icon from '../components/Icon.jsx';
import Modal from '../components/Modal.jsx';
import './dashboard.css';

// the pipeline, spelled out — the single line that makes the flow obvious
const FLOW = ['Strategy', 'Campaign', 'Create', 'Publish'];

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
// a ctx board (no summary endpoints yet) → the summary shape the cards render
const asSummary = (b) => b && ({
  id: b.id, title: b.title || 'Strategy board', createdAt: b.createdAt,
  strategyCount: (b.strategies || []).length || undefined, sub: b.sub,
});

export default function Dashboard() {
  const { profile, board, setBoard, boards: ctxBoards, setBoards, openBoard, say } = useApp();
  const nav = useNavigate();
  const [dash, setDash] = useState(undefined); // undefined = loading
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

  useEffect(() => { if (renaming) renameRef.current?.focus(); }, [renaming]);

  const boards = (dash?.boards?.length ? dash.boards : ctxBoards) || [];
  const campaigns = dash?.campaigns || [];

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

  const stats = [
    { n: boards.length, l: 'plans' },
    { n: campaigns.length, l: 'campaigns' },
    { n: dash.photoshootCount ?? '—', l: 'photoshoots' },
    { n: dash.websiteCount ?? '—', l: 'websites' },
  ];

  return (
    <div className="section dash-wrap">
      <div className="page-head">
        <h1 className="display">Dashboard</h1>
        <div className="dash-flow" aria-label="pipeline">
          {FLOW.map((s, i) => (
            <React.Fragment key={s}>
              {i > 0 && <span className="dash-flow-sep">→</span>}
              <span className="dash-flow-step">{s}</span>
            </React.Fragment>
          ))}
        </div>
      </div>

      {!boards.length ? (
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
          {/* ---- stat strip ---- */}
          <div className="dash-stats">
            {stats.map((s) => (
              <div key={s.l} className="card dash-stat">
                <b>{s.n}</b><span>{s.l}</span>
              </div>
            ))}
          </div>

          {/* ---- your plans ---- */}
          <div className="section-label">Your plans</div>
          <div className="grid c3">
            {boards.map((b) => {
              const active = board?.id && b.id === board.id;
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

          {/* ---- recent campaigns ---- */}
          {!!campaigns.length && (
            <>
              <div className="section-label">Recent campaigns</div>
              <div className="grid c2">
                {campaigns.slice(0, 4).map((c) => (
                  <Link key={c.id} to="/campaigns" className="card dash-camp">
                    <h4>{c.title || 'Untitled campaign'}</h4>
                    {!!c.strategyTitle && (
                      <span className="dash-camp-src">
                        <Icon name="sparkle" size={11} /> from strategy: <b>{c.strategyTitle}</b>
                      </span>
                    )}
                    <span className="dash-camp-meta">
                      {c.creativeCount ?? 0} creatives{fmtDate(c.createdAt) ? ` · ${fmtDate(c.createdAt)}` : ''}
                    </span>
                  </Link>
                ))}
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
