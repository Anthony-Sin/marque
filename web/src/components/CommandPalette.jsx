import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, pollJob } from '../api.js';
import { useApp } from '../App.jsx';
import Icon from './Icon.jsx';
import EvidenceDrawer from './EvidenceDrawer.jsx';
import { useOverlayFocus } from '../focus.js';
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

// verb-y queries float the ACTIONS block above the data groups — 'reshuffle'
// is a command, 'ravers' is a plan. Prefixes, so 'gen', 're', 'pub' all catch.
const ACTION_VERBS = [
  're', 'gen', 'new', 'creat', 'make', 'pub', 'unpub', 'shoot', 'photo',
  'film', 'anim', 'audit', 'mood', 'run', 'prod', 'compil', 'fix', 'launch',
  'queue', 'start',
];
const verbQuery = (q) => {
  const s = q.trim().toLowerCase();
  return !!s && ACTION_VERBS.some((v) => s.startsWith(v));
};

// api errors arrive as 'POST /api/x → 503 detail' — the detail is the part a
// human reads; strip the transport noise for the status line
const errMsg = (e) =>
  (String(e?.message || e || 'action failed')
    .replace(/^(GET|POST|PUT|PATCH|DELETE)\s+\S+\s*→\s*\d+\s*/, '') || 'action failed')
    .slice(0, 120);

// ⌘K / Ctrl-K / '/' command strip — fuzzy-jump over real studio data.
// Boards + the active plan's strategies come straight from ctx; campaigns
// and sites aren't carried by ctx, so they're lazy-pulled once per open.
export default function CommandPalette({ open, onClose }) {
  const nav = useNavigate();
  const { board, boards, openBoard, hasStrategy, say, setBoard, profile, status } = useApp();
  const [q, setQ] = useState('');
  const [navIdx, setNavIdx] = useState(null); // null → beam sits on the best match
  const [extra, setExtra] = useState({ camps: null, sites: null, book: undefined }); // lazy lists — not in ctx
  const [evi, setEvi] = useState(false);                          // evidence drawer (ctx-reachable)
  // act = action status line {k:'run'|'ok'|'err', msg}. actRef mirrors it so
  // the document key handler (bound on flat/sel) reads fresh state; actT is
  // the pending self-clear timer.
  const [act, setActRaw] = useState(null);
  const actRef = useRef(null);
  const actT = useRef(null);
  const setAct = (v) => { actRef.current = v; setActRaw(v); };
  const actAfter = (ms, fn) => { clearTimeout(actT.current); actT.current = setTimeout(fn, ms); };
  const inputRef = useRef(null);
  const listRef = useRef(null);
  const boxRef = useRef(null);
  // focus lands in the input on open (data-autofocus), returns to the opener
  // on close; Tab cycles inside the strip while it's up
  useOverlayFocus(boxRef, open);

  // reset + refocus on open; lazy-pull the lists ctx doesn't carry
  useEffect(() => {
    if (!open) return;
    setQ(''); setNavIdx(null); setAct(null); clearTimeout(actT.current);
    inputRef.current?.focus();
    let dead = false;
    api.listCampaigns()
      .then((d) => { if (!dead) setExtra((x) => ({ ...x, camps: d.campaigns || [] })); })
      .catch(() => { if (!dead) setExtra((x) => ({ ...x, camps: x.camps || [] })); });
    api.listWebsites()
      .then((d) => { if (!dead) setExtra((x) => ({ ...x, sites: d.websites || [] })); })
      .catch(() => { if (!dead) setExtra((x) => ({ ...x, sites: x.sites || [] })); });
    api.getBrandBook()
      .then((d) => { if (!dead) setExtra((x) => ({ ...x, book: d.book || null })); })
      .catch(() => { if (!dead) setExtra((x) => ({ ...x, book: x.book ?? null })); });
    // a moodboard marker on the board is only a hint — the label 'already
    // rendering' is honest only if the job is actually still running
    const mbJobId = board?.moodboardJob?.jobId;
    if (mbJobId) {
      api.job(mbJobId)
        .then((d) => { if (!dead) setExtra((x) => ({ ...x, mbJob: d.job || null })); })
        .catch(() => { if (!dead) setExtra((x) => ({ ...x, mbJob: null })); });
    } else setExtra((x) => ({ ...x, mbJob: null }));
    return () => { dead = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const items = useMemo(() => {
    const out = [];
    const push = (group, icon, label, meta, hay, run, tag, opts) =>
      out.push({ id: `${group}:${out.length}`, group, icon, label, meta, hay: `${label} ${hay || ''}`, run, tag, ...(opts || {}) });
    // cmd = an item that runs through the status line instead of closing on
    // pick; run() returns {line, hold?, pending?} — pending resolves to a toast
    const cmd = (icon, label, meta, hay, busy, run, tag) =>
      push('actions', icon, label, meta, hay, run, tag, { async: true, busy });

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

    // ---------- do-something commands — every one backed by an api.js helper,
    // gated on the state it actually needs, and reported on the status line.
    // Job-starters ack fast (queued → close → toast when pollJob lands); slow
    // sync calls get a beat to fail in-palette before going fire-and-forget.
    const camps = extra.camps || [];
    const stills = (c) => (c.creatives || []).filter((cr) => cr.medium !== 'video' && cr.imagePath);
    const stillCamp = [...camps].reverse().find((c) => stills(c).length);
    const lastStill = stillCamp && stills(stillCamp).at(-1);            // re-render target
    const animStill = stillCamp &&                                     // animate prefers a still
      (stills(stillCamp).filter((cr) => !cr.videoPath && cr.videoState !== 'running').at(-1) || null);
    const filmCamp = camps.at(-1);                                     // demo film lands on newest
    const filmable = sl.some((s) => (s.versions || []).length);
    const draftSite = [...sl].reverse().find((s) => !s.publishedSlug);
    const liveSites = sl.filter((s) => s.publishedSlug);
    const siteName = (s) => s.producedFrom?.campaignTitle
      ? `${s.producedFrom.campaignTitle} — site`
      : `Site ${sl.indexOf(s) + 1}`;
    // mirrors the campaign view's provider pick — the creative's own engine
    // when it's a real renderer, else local
    const rrProvider = (cr) => {
      const p = String(cr?.imageProvider || '').split('-')[0];
      return ['local', 'gemini', 'pollinations'].includes(p) ? p : 'local';
    };
    // give a slow sync call ~350ms to fail fast (bad id, 422) so the error
    // lands in-palette; past that it's reported, the strip closes, and the
    // result arrives as a toast — never a blocking spinner
    const raceFast = (p) => Promise.race([
      p.then(() => null).catch((e) => e),
      new Promise((r) => setTimeout(() => r('pending'), 350)),
    ]);

    // moodboard — the board's 9-tile taste render. POST is idempotent mid-run
    // (dedups onto the live job), so firing twice can't queue a second run.
    // Hidden only when localgen is definitively off — the POST would 503.
    if (board?.id && status?.localgen?.configured !== false) {
      const hasTiles = !!(board.moodboard?.tiles || []).length;
      // marker + confirmed-live job — a stale marker never mislabels the row
      const running = extra.mbJob?.status === 'running';
      cmd('sparkle', running ? 'Moodboard — already rendering' : hasTiles ? 'Reshuffle moodboard' : 'Generate moodboard',
        `${board.title || 'active plan'} · 9 tiles · ~1 min`,
        'generate render reshuffle reroll regenerate moodboard tiles board visual new',
        'posting render job…',
        async () => {
          const d = await api.genMoodboard(board.id);
          if (d?.job?.id) {
            // stamp the server-side marker onto ctx so the board view's
            // resume-poll path picks the run up the moment it mounts
            setBoard?.((b) => (b?.id === board.id ? { ...b, moodboardJob: { jobId: d.job.id }, moodboardError: null } : b));
            nav('/strategy');
            say?.(d.deduplicated ? 'Moodboard already rendering — progress is on the board' : 'Moodboard job started · ~1 min');
            // when the run settles, drop our ctx marker so the row relabels
            const unmark = () => setBoard?.((b) => (b?.id === board.id ? { ...b, moodboardJob: null } : b));
            return {
              line: d.deduplicated ? 'already in flight · opening the board' : 'queued · moodboard rendering · ~1 min',
              pending: pollJob(d.job.id).then(
                () => { unmark(); return 'moodboard ready — tiles landed on the board'; },
                (e) => { unmark(); throw e; }),
            };
          }
          nav('/strategy');
          return { line: 'opening the board' };
        }, 'job');
    }

    // single-still reroll — same endpoint as the card's hover reroll. The POST
    // is synchronous (~10-30s render), so it races a fast-fail window then
    // reports via pending; a 200 with a placeholder still reads as failure.
    if (lastStill) {
      cmd('refresh', 'Re-render last still',
        `${stillCamp.brief?.title || 'campaign'} · “${(lastStill.headline || 'still').slice(0, 34)}”`,
        'reroll regenerate render re-render still image creative photo new fresh',
        'posting re-render…',
        async () => {
          const p = api.regenCreativeImage(lastStill.id, undefined, rrProvider(lastStill));
          const early = await raceFast(p);
          if (early instanceof Error) throw early;
          nav(`/campaigns?open=${stillCamp.id}`);
          return {
            line: early === null ? 'still re-rendered · opening the card' : 're-rendering · lands on the card',
            pending: early === null ? null : p.then(({ creative: next }) => {
              if (next?.imageError || next?.placeholder) throw new Error(next.imageError || 'renderer returned a placeholder');
              return 'still re-rendered — reopen the card to view it';
            }),
          };
        }, '');
    }

    // still → motion — same per-card shortcut the campaign view runs; the
    // route acks with a job, the render lands on the creative record
    if (animStill) {
      cmd('play', 'Animate last still',
        `${stillCamp.brief?.title || 'campaign'} · “${(animStill.headline || 'still').slice(0, 34)}” → video`,
        'animate video motion render still creative film move',
        'queueing render…',
        async () => {
          const { job } = await api.animateCreative(animStill.id);
          nav(`/campaigns?open=${stillCamp.id}`);
          say?.('Animation queued · ~1 min — lands on the creative');
          return {
            line: 'queued · animating still · ~1 min',
            pending: job?.id ? pollJob(job.id).then(() => 'animation ready — open the creative to watch') : null,
          };
        }, 'job');
    }

    // site demo film — screen-captures the newest site version into a video
    // creative on the newest campaign (same fallback chain the route uses)
    if (filmCamp && filmable) {
      cmd('film', 'Film site demo',
        `screen-capture · lands on ${filmCamp.brief?.title || 'newest campaign'}`,
        'film video demo shoot record capture site screen animate',
        'queueing capture…',
        async () => {
          const { job } = await api.campaignDemoVideo(filmCamp.id);
          nav(`/campaigns?open=${filmCamp.id}`);
          say?.('Site film queued — lands as a creative on this campaign');
          return {
            line: 'queued · filming the site',
            pending: job?.id ? pollJob(job.id).then(() => 'site film ready — on the campaign') : null,
          };
        }, 'job');
    }

    // publish/unpublish — the site id resolves from the lazy list; the slug
    // auto-picks (site-<id8>) so the action needs nothing else
    if (draftSite) {
      cmd('globe', `Publish site — ${siteName(draftSite)}`,
        `goes live · /s/site-${draftSite.id.slice(0, 8)}`,
        'publish live launch website site deploy share',
        'flipping live…',
        async () => {
          const { publishedSlug } = await api.publishWebsite(draftSite.id);
          setExtra((x) => ({ ...x, sites: (x.sites || []).map((s) => (s.id === draftSite.id ? { ...s, publishedSlug } : s)) }));
          say?.(`Live · /s/${publishedSlug}`);
          return { line: `live · /s/${publishedSlug}` };
        }, '');
    }
    liveSites.forEach((s) => {
      cmd('globe', `Unpublish — /s/${s.publishedSlug}`,
        `${siteName(s)} goes dark`,
        'unpublish offline take down website site remove',
        'taking it down…',
        async () => {
          await api.unpublishWebsite(s.id);
          setExtra((x) => ({ ...x, sites: (x.sites || []).map((w) => (w.id === s.id ? { ...w, publishedSlug: null } : w)) }));
          say?.(`/s/${s.publishedSlug} unpublished`);
          return { line: 'offline · unpublished' };
        }, '');
    });

    // publish the compiled book — only meaningful when a book exists and
    // isn't already live (there's no unpublish helper, so the reverse is out)
    if (extra.book && !extra.book.publishedSlug) {
      cmd('book', 'Publish brand book',
        'goes live · /b/<slug>',
        'publish live launch book brandbook guidelines share',
        'flipping live…',
        async () => {
          const { publishedSlug } = await api.publishBrandBook();
          setExtra((x) => ({ ...x, book: x.book ? { ...x.book, publishedSlug } : x.book }));
          say?.(`Book live · /b/${publishedSlug}`);
          return { line: `live · /b/${publishedSlug}` };
        }, '');
    }

    // site audit — the improve endpoint audits the profile's own source url,
    // so it's only valid when the brand brought a site. Long sync call:
    // race a fast-fail, then report + let the toast close the loop; results
    // persist server-side and surface on the Sites → Improve tab
    const auditUrl = profile?.source?.url;
    if (auditUrl) {
      cmd('eye', 'Run site audit',
        `${auditUrl.replace(/^https?:\/\//, '').slice(0, 40)} · ranked fix list`,
        'audit analyze improve website site review check run seo',
        'kicking off the audit…',
        async () => {
          const p = api.improveWebsite();
          const early = await raceFast(p);
          if (early instanceof Error) throw early;
          return {
            line: early === null ? 'audit done · Sites → Improve my site' : 'audit running · ~30s · ping when it lands',
            pending: early === null ? null : p.then((a) => `site audit ready · ${(a?.suggestions || []).length} fixes — Sites → Improve my site`),
          };
        }, '');
    }

    const gate = hasStrategy ? '' : 'locked';
    push('actions', 'plus', 'New plan', 'draft a fresh strategy board',
      'create generate strategy board plan', () => nav('/strategy?new=1'));
    push('actions', 'campaign', 'Produce ad set', 'open the output studio',
      'create campaign ads generate output', () => nav('/campaigns'), gate);
    push('actions', 'photo', 'New photoshoot', 'product + lifestyle stills — the form lives on Shoots',
      'shoot photo product lifestyle camera session stills create', () => nav('/shoots'));
    // the batch re-render engine lives on the campaign view (sequential regen,
    // per-tile progress, early-stop) — the palette deep-links to it rather
    // than re-running N renders blind
    if (stillCamp) {
      push('actions', 'refresh', 'Re-render stills',
        `batch reroll · opens ${stillCamp.brief?.title || 'the campaign'}`,
        're-render reroll regenerate render all stills images creatives batch reshuffle',
        () => nav(`/campaigns?open=${stillCamp.id}`), gate);
    }
    push('actions', 'site', 'New site', 'generate a marketing site',
      'website landing page create', () => nav('/websites?tab=site'), gate);
    push('actions', 'book', 'Brand book', 'compile the printable brand book',
      'brandbook guidelines identity', () => nav('/brandbook'), gate);
    // the drawer reads profile.qloo + board.evidence.calls — all ctx-reachable
    push('actions', 'qloo', 'Evidence', 'taste-graph evidence trail',
      'qloo signals affinity proof calls', () => setEvi(true));
    push('actions', 'layout', 'Dashboard', 'the deck — plans at a glance',
      'home deck overview', () => nav('/dashboard'));
    push('actions', 'dna', 'Business profile', 'edit brand identity, palette, voice',
      'profile brand dna palette voice settings', () => nav('/profile'));
    return out;
  }, [boards, board, extra, hasStrategy, nav, openBoard, say, setBoard, profile, status]);

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
    // verb-y queries read as commands — ACTIONS rises above the data groups
    const order = verbQuery(q) ? [['actions', 'ACTIONS'], ...GROUPS.filter(([k]) => k !== 'actions')] : GROUPS;
    for (const [key, name] of order) {
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

  // fire-and-report — async items run under the status line: 'run' while the
  // call is out, 'ok' briefly on ack (then close), 'err' stays a few seconds
  // in-palette so a failure never flashes past unseen. run() may hand back
  // `pending` — a promise whose settle lands as a toast after close. A throw
  // can never crash the strip; Esc during 'run' just closes (the call lands).
  const fire = async (it) => {
    if (actRef.current?.k === 'run' || actRef.current?.k === 'ok') return;
    setAct({ k: 'run', msg: it.busy || 'working…' });
    try {
      const r = (await it.run()) || {};
      if (r.pending?.then) r.pending.then((m) => m && say?.(m)).catch((e) => say?.(errMsg(e)));
      setAct({ k: 'ok', msg: r.line || 'done' });
      actAfter(r.hold ?? 850, () => { setAct(null); onClose(); });
    } catch (e) {
      setAct({ k: 'err', msg: errMsg(e) });
      actAfter(3600, () => { if (actRef.current?.k === 'err') setAct(null); });
    }
  };

  const pick = (it) => {
    if (!it) return;
    if (it.async) return void fire(it);          // real command — reports on the status line
    const k = actRef.current?.k;
    if (k === 'run' || k === 'ok') return;       // a fire is settling — don't nav out from under it
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
          <div ref={boxRef} className="ck hud" role="dialog" aria-modal="true" aria-label="Command palette">
            <div className="ck-inrow">
              <span className="ck-prompt">❯</span>
              <input
                ref={inputRef}
                data-autofocus
                className="ck-in"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Jump to a plan, campaign, site — or fire an action…"
                aria-label="Command palette"
                autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck={false}
              />
              <span className="ck-count">{flat.length || '—'} hit{flat.length === 1 ? '' : 's'}</span>
            </div>
            {/* action status line — inline-styled (palette owns no stylesheet);
                HUD mono micro-label with a status dot: dim run, lime ok, rose err */}
            {act && (
              <div className="ck-act" data-k={act.k} role="status" aria-live="polite"
                style={{
                  display: 'flex', alignItems: 'center', gap: 8, flex: 'none',
                  padding: '7px 14px', borderBottom: '1px solid var(--line-soft)',
                  fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 700,
                  letterSpacing: '.12em', textTransform: 'uppercase',
                  color: act.k === 'err' ? 'var(--rose)' : act.k === 'ok' ? 'var(--lime)' : 'var(--ink-3)',
                }}>
                <i style={{
                  width: 6, height: 6, borderRadius: '50%', flex: 'none', display: 'inline-block',
                  background: 'currentColor', boxShadow: '0 0 7px currentColor',
                  ...(act.k === 'run' ? { animation: 'railClockBlink 1s steps(1) infinite' } : {}),
                }} />
                <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {act.msg}
                </span>
              </div>
            )}
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
