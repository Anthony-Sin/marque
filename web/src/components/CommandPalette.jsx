import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { useApp } from '../App.jsx';
import Icon from './Icon.jsx';
import EvidenceDrawer from './EvidenceDrawer.jsx';
import { chanLabel } from '../labels.js';

/* Tiny fuzzy scorer — no deps. Every query char must land in order
   (subsequence); consecutive runs, word-start hits, prefix hits and early
   first-matches score higher, shorter targets win ties. -1 = no match. */
const WORD_BREAK = /[\s\-_./(&:]/;
function fuzz(q, target) {
  const s = (target || '').toLowerCase();
  const qs = q.trim().toLowerCase();
  if (!qs) return 0;
  let qi = 0, score = 0, last = -2, first = -1;
  for (let i = 0; i < s.length && qi < qs.length; i++) {
    if (s[i] !== qs[qi]) continue;
    if (first < 0) first = i;
    score += 2
      + (i === last + 1 ? 4 : 0)
      + (i === 0 || WORD_BREAK.test(s[i - 1]) ? 6 : 0);
    last = i; qi++;
  }
  if (qi < qs.length) return -1;
  if (s.startsWith(qs)) score += 10;
  // early hits are a gentle tiebreak — normalized so a deep-but-good match
  // inside a long haystack can never go negative and get filtered out
  return score / (s.length + 12) - (first / s.length) * 0.15;
}

const GROUPS = [
  ['boards', 'BOARDS'],
  ['strategies', 'STRATEGIES'],
  ['campaigns', 'CAMPAIGNS'],
  ['sites', 'SITES'],
  ['actions', 'ACTIONS'],
];

// ⌘K / Ctrl-K / '/' command strip — fuzzy-jump over real studio data.
// Boards + the active plan's strategies come straight from ctx; campaigns
// and sites aren't carried by ctx, so they're lazy-pulled once per open.
export default function CommandPalette({ open, onClose }) {
  const nav = useNavigate();
  const { board, boards, openBoard, hasStrategy, say } = useApp();
  const [q, setQ] = useState('');
  const [navIdx, setNavIdx] = useState(null); // null → beam sits on the best match
  const [extra, setExtra] = useState({ camps: null, sites: null }); // lazy lists — not in ctx
  const [evi, setEvi] = useState(false);                          // evidence drawer (ctx-reachable)
  const inputRef = useRef(null);
  const listRef = useRef(null);

  // reset + refocus on open; lazy-pull the lists ctx doesn't carry
  useEffect(() => {
    if (!open) return;
    setQ(''); setNavIdx(null);
    inputRef.current?.focus();
    let dead = false;
    api.listCampaigns()
      .then((d) => { if (!dead) setExtra((x) => ({ ...x, camps: d.campaigns || [] })); })
      .catch(() => { if (!dead) setExtra((x) => ({ ...x, camps: x.camps || [] })); });
    api.listWebsites()
      .then((d) => { if (!dead) setExtra((x) => ({ ...x, sites: d.websites || [] })); })
      .catch(() => { if (!dead) setExtra((x) => ({ ...x, sites: x.sites || [] })); });
    return () => { dead = true; };
  }, [open]);

  const items = useMemo(() => {
    const out = [];
    const push = (group, icon, label, meta, hay, run, tag) =>
      out.push({ id: `${group}:${out.length}`, group, icon, label, meta, hay: `${label} ${hay || ''}`, run, tag });

    // every plan — pick = activate it on the server, then land on the board
    (boards || []).forEach((b, i) => {
      const active = !!board?.id && b.id === board.id;
      const n = (b.strategyCount ?? b.titles?.length) || 0;
      push('boards', 'sparkle', b.title || `Plan ${i + 1}`,
        `${n || '—'} strateg${n === 1 ? 'y' : 'ies'}`,
        `plan board strategy ${b.sub?.prompt || ''} ${(b.titles || []).join(' ')} ${(b.channels || []).join(' ')}`,
        async () => {
          try { if (b.id && !active) await openBoard(b.id); }
          catch (e) { say?.(e.message || 'could not open that plan'); return; }
          nav('/strategy');
        },
        active ? 'active' : '');
    });

    // the active plan's strategies — /strategy/:idx is the view's detail route
    (board?.strategies || []).forEach((s, i) =>
      push('strategies', 'layout', s.title || `Strategy ${i + 1}`,
        `#${i + 1} · ${board.title || 'active plan'}`,
        `${s.angle || ''} ${s.brief?.title || ''} ${s.brief?.keyMessage || ''} ${(s.channels || []).map(chanLabel).join(' ')}`,
        () => nav(`/strategy/${i}`), 'on board'));

    (extra.camps || []).forEach((c) => {
      const chans = (c.brief?.channels || []).map(chanLabel).join(', ');
      push('campaigns', 'campaign', c.brief?.title || c.title || 'Untitled campaign',
        `${c.creatives?.length || 0} creative${(c.creatives?.length || 0) === 1 ? '' : 's'}${chans ? ` · ${chans}` : ''}`,
        `${chans} ${c.brief?.angle || ''} ${c.brief?.keyMessage || ''} ${c.strategyTitle || ''} ${c.aspectRatio || ''}`,
        () => nav(`/campaigns?open=${c.id}`),
        c.medium === 'video' ? 'video' : (c.strategyTitle ? 'from plan' : ''));
    });

    // sites — newest first, numbered to match the Websites view ("Site N")
    const sl = extra.sites || [];
    [...sl].reverse().forEach((s, ri) => {
      const from = s.producedFrom?.campaignTitle;
      push('sites', 'site', from ? `${from} — site` : `Site ${sl.length - ri}`,
        `${s.publishedSlug ? `live /s/${s.publishedSlug}` : 'not published'} · ${(s.versions || []).length || 1} ver`,
        `${from || ''} ${s.publishedSlug || ''} website landing ${s.prompt || ''}`,
        () => nav('/websites?tab=site'));
    });

    const gate = hasStrategy ? '' : 'locked';
    push('actions', 'plus', 'New plan', 'draft a fresh strategy board',
      'create generate strategy board plan', () => nav('/strategy?new=1'));
    push('actions', 'campaign', 'Produce ad set', 'open the output studio',
      'create campaign ads generate output', () => nav('/campaigns'), gate);
    push('actions', 'site', 'New site', 'generate a marketing site',
      'website landing page create', () => nav('/websites?tab=site'), gate);
    push('actions', 'book', 'Brand book', 'compile the printable brand book',
      'brandbook guidelines identity', () => nav('/brandbook'), gate);
    // the drawer reads profile.qloo + board.evidence.calls — all ctx-reachable
    push('actions', 'qloo', 'Evidence', 'taste-graph evidence trail',
      'qloo signals affinity proof calls', () => setEvi(true));
    push('actions', 'layout', 'Dashboard', 'the deck — plans at a glance',
      'home deck overview', () => nav('/dashboard'));
    return out;
  }, [boards, board, extra, hasStrategy, nav, openBoard, say]);

  // score → sort within each group → fixed HUD group order → flat list w/
  // a global index + the best-scoring row (beam lands there until arrows move)
  const { groups, flat, best } = useMemo(() => {
    const scored = [];
    for (const it of items) {
      const sl = fuzz(q, it.label);
      // label hits outweigh hay hits; the active plan pins to the top on ties
      const s = Math.max(sl >= 0 ? sl * 1.6 : -1, fuzz(q, it.hay)) + (it.tag === 'active' ? 0.05 : 0);
      if (s >= 0) scored.push({ it, s });
    }
    scored.sort((a, b) => b.s - a.s || a.it.label.localeCompare(b.it.label));
    const byGroup = new Map();
    for (const { it, s } of scored) {
      if (!byGroup.has(it.group)) byGroup.set(it.group, []);
      byGroup.get(it.group).push({ it, s });
    }
    const gs = []; let gi = 0, bestGi = 0, bestS = -1;
    for (const [key, name] of GROUPS) {
      const its = byGroup.get(key);
      if (!its?.length) continue;
      gs.push({ key, name, items: its.map(({ it, s }) => {
        const row = { ...it, gi };
        if (s > bestS) { bestS = s; bestGi = gi; }
        gi++;
        return row;
      }) });
    }
    return { groups: gs, flat: gs.flatMap((g) => g.items), best: bestGi };
  }, [items, q]);

  const sel = flat.length ? Math.min(navIdx ?? best, flat.length - 1) : -1;
  useEffect(() => { setNavIdx(null); }, [q]);

  const pick = (it) => {
    onClose();
    Promise.resolve(it?.run?.()).catch(() => {});
  };

  // palette-local key handling — arrows move the beam, ↵ runs, esc closes.
  // Bound on document + stopPropagation so keys eaten here can't also close
  // an underlying modal/drawer (their listeners live on window).
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); e.stopPropagation(); setNavIdx(flat.length ? (sel + 1) % flat.length : null); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); e.stopPropagation(); setNavIdx(flat.length ? (sel - 1 + flat.length) % flat.length : null); }
      else if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); if (flat[sel] || flat[0]) pick(flat[sel] || flat[0]); }
      else return;
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, flat, sel]);

  // keep the beam inside the scrollport
  useEffect(() => {
    listRef.current?.querySelector('.ck-item.on')?.scrollIntoView({ block: 'nearest' });
  }, [sel, q, open]);

  return (
    <>
      {open && (
        <div className="ck-veil" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
          <div className="ck hud" role="dialog" aria-modal="true" aria-label="Command palette">
            <div className="ck-inrow">
              <span className="ck-prompt">❯</span>
              <input
                ref={inputRef}
                className="ck-in"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Jump to a plan, campaign, site or action…"
                aria-label="Command palette"
                autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck={false}
              />
              <span className="ck-count">{flat.length || '—'} hit{flat.length === 1 ? '' : 's'}</span>
            </div>
            <div className="ck-list" ref={listRef} role="listbox">
              {!flat.length && (
                <div className="ck-empty">No match — try a plan, campaign or action</div>
              )}
              {groups.map((g) => (
                <div key={g.key} className="ck-group">
                  <div className="ck-group-head">
                    <span className="ck-gh-name">{g.name}</span>
                    <span className="ck-gh-n">{g.items.length}</span>
                  </div>
                  {g.items.map((it) => (
                    <button key={it.id} type="button" role="option" aria-selected={it.gi === sel}
                      className={`ck-item${it.gi === sel ? ' on' : ''}`}
                      onMouseEnter={() => setNavIdx(it.gi)}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => pick(it)}>
                      <span className="ck-ic"><Icon name={it.icon} size={14} /></span>
                      <span className="ck-main">
                        <span className="ck-lbl">{it.label}</span>
                        {!!it.meta && <span className="ck-meta">{it.meta}</span>}
                      </span>
                      {!!it.tag && <span className={`ck-tag ${it.tag}`}>{it.tag}</span>}
                      <span className="ck-enter">↵</span>
                    </button>
                  ))}
                </div>
              ))}
            </div>
            <div className="ck-foot">↑↓ navigate · ↵ open · esc close</div>
          </div>
        </div>
      )}
      {evi && (
        <EvidenceDrawer
          info={board?.title ? `Active plan — ${board.title}` : null}
          bundle={board?.evidence?.calls?.length
            ? { affinities: [], calls: board.evidence.calls, mode: board.evidence.qlooMode }
            : undefined}
          onClose={() => setEvi(false)}
        />
      )}
    </>
  );
}
