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
  'queue', 'start', 'improve', 'check', 'take', 'down', 'deploy', 'record',
  'share', 'review', 'analyze', 'video', 'demo', 'motion',
];
const verbQuery = (q) => {
  const s = q.trim().toLowerCase();
  return !!s && ACTION_VERBS.some((v) => s.startsWith(v));
};

// filler words carry no intent — 'the shoots' and 'go to shoots' both boil
// down to 'shoots' once they're stripped
const FILLER = new Set([
  'a', 'an', 'the', 'my', 'our', 'your', 'this', 'that', 'it', 'its', 'to',
  'of', 'for', 'on', 'in', 'me', 'go', 'up', 'at', 'do', 'so', 'be',
]);
const TOKEN_SPLIT = /[\s\-_./(&:—–,!?]+/;
const qwords = (q) =>
  q.trim().toLowerCase().split(TOKEN_SPLIT).filter((w) => w && !FILLER.has(w));

// multi-word queries score per-token: every content word must land somewhere
// in the target — as a subsequence across it, or on a single word of it
// (word hits are the strong signal: 'take down site' finds 'take' + 'down' +
// 'site' as words in the unpublish row's hay). 'film the site demo' works
// even though 'the' never sits next to 'film' in the hay.
function qfuzz(q, target) {
  const ws = qwords(q);
  if (!ws.length) return fuzz(q, target);
  if (ws.length === 1) return fuzz(ws[0], target);
  const twords = String(target || '').toLowerCase().split(TOKEN_SPLIT);
  let sum = 0;
  for (const w of ws) {
    let s = fuzz(w, target);
    for (const tw of twords) s = Math.max(s, fuzz(w, tw));
    if (s < 0) return -1;
    sum += s;
  }
  return sum / ws.length;
}

// the routes + the words that mean each place. A lone place word — or a place
// word inside a query that isn't verb-led — pins its nav row above everything
// and keeps mutating rows out of the running: 'shoots' opens Shoots, it never
// fires 'film the site demo'.
const PLACES = [
  { icon: 'layout',   label: 'Dashboard',        to: '/dashboard',         meta: 'the deck — plans at a glance',        words: 'dashboard home deck overview' },
  { icon: 'sparkle',  label: 'Strategy board',   to: '/strategy',          meta: 'the active plan · strategies',        words: 'strategy strategies board boards plan plans' },
  { icon: 'campaign', label: 'Campaigns',        to: '/campaigns',         meta: 'the output studio — ad sets',         words: 'campaigns campaign output studio creatives creative ads', gate: true },
  { icon: 'photo',    label: 'Shoots',           to: '/shoots',            meta: 'photoshoots — product + lifestyle',   words: 'shoots shoot photoshoot photoshoots photo photos session still stills' },
  { icon: 'site',     label: 'Websites',         to: '/websites?tab=site', meta: 'generated sites — publish + audit',   words: 'websites website sites site webpages landing', gate: true },
  { icon: 'book',     label: 'Brand book',       to: '/brandbook',         meta: 'the printable brand book',            words: 'brandbook book books guide guidelines identity', gate: true },
  { icon: 'dna',      label: 'Business profile', to: '/profile',           meta: 'edit brand identity, palette, voice', words: 'profile brand business settings dna voice palette' },
];
// 2 = the word IS an alias, 1 = a prefix of one (≥2 chars) or an alias plus a
// tail ('shoots' ⊃ 'shoot', 'decks' ⊃ 'deck'); 0 = not a place word
const aliasHit = (words, w) => {
  let hit = 0;
  for (const a of words.split(' ')) {
    if (a === w) return 2;
    if ((w.length >= 2 && a.startsWith(w)) || (a.length >= 4 && w.startsWith(a))) hit = 1;
  }
  return hit;
};
const isPlaceWord = (w) => !!w && PLACES.some((p) => aliasHit(p.words, w));

// nav-intent words — with a place word they still mean 'take me there'
// ('open the brand book', 'sites list'), so the pin survives a longer query
const NAV_WORDS = new Set(['open', 'show', 'view', 'see', 'page', 'goto', 'jump', 'list', 'nav', 'tab']);

// a mutating row's intent words = its own label + synonyms (the hay). A lone
// query word (≥3 chars) reaches a POST only through one of these — a fuzzy
// hit on 'shoot' inside the film row's hay isn't intent to film anything.
const intentHit = (it, w) =>
  w.length >= 3 &&
  it.hay.toLowerCase().split(TOKEN_SPLIT)
    .some((v) => v === w || v.startsWith(w) || w.startsWith(v));

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
  // uid of a confirm-armed heavy row — pick() arms it, a second pick on the
  // same row fires, and any other input cancels the arm via disarm()
  const armRef = useRef(null);
  const disarm = () => {
    armRef.current = null;
    if (actRef.current?.k === 'confirm') setAct(null);
  };
  const inputRef = useRef(null);
  const listRef = useRef(null);
  const boxRef = useRef(null);
  // focus lands in the input on open (data-autofocus), returns to the opener
  // on close; Tab cycles inside the strip while it's up
  useOverlayFocus(boxRef, open);

  // reset + refocus on open; lazy-pull the lists ctx doesn't carry
  useEffect(() => {
    if (!open) return;
    setQ(''); setNavIdx(null); setAct(null); armRef.current = null; clearTimeout(actT.current);
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
    // pick; run() returns {line, hold?, pending?} — pending resolves to a
    // toast. Every cmd POSTs something, so all are `mutating`: the ranker
    // only lists them when the query expresses intent. `extra` carries
    // {uid, confirm} — a confirm string arms the row: first pick explains on
    // the status line, second pick on the same row fires.
    const cmd = (icon, label, meta, hay, busy, run, tag, extra) =>
      push('actions', icon, label, meta, hay, run, tag,
        { async: true, busy, mutating: true, ...(extra || {}) });

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
          nav(b.id ? `/strategy/${b.id}` : '/strategy');
        },
        active ? 'active' : '');
    });

    // the active plan's strategies — /strategy/<boardId>/<idx> keeps the link
    // true even after another plan gets activated (bare /strategy/:idx still
    // resolves on the active board as a fallback)
    (board?.strategies || []).forEach((s, i) =>
      push('strategies', 'layout', s.title || `Strategy ${i + 1}`,
        `#${i + 1} · ${board.title || 'active plan'}`,
        `${s.angle || ''} ${s.brief?.title || ''} ${s.brief?.keyMessage || ''} ${(s.channels || []).map(chanLabel).join(' ')}`,
        () => nav(board.id ? `/strategy/${board.id}/${i}` : `/strategy/${i}`), 'on board'));

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
        }, 'job',
        // already-running is just a board open — only a fresh render asks twice
        running ? null : {
          uid: 'moodboard',
          confirm: `render 9 moodboard tiles for ${board.title || 'the active plan'} · ~1 min`,
        });
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
        }, '', {
          uid: 'reroll-still',
          confirm: `re-render “${(lastStill.headline || 'the still').slice(0, 34)}” on ${stillCamp.brief?.title || 'the campaign'} · ~30s`,
        });
    }

    // still → motion — same per-card shortcut the campaign view runs; the
    // route acks with a job, the render lands on the creative record
    if (animStill) {
      cmd('play', 'Animate last still',
        `${stillCamp.brief?.title || 'campaign'} · “${(animStill.headline || 'still').slice(0, 34)}” → video`,
        'animate video motion render still creative film move make',
        'queueing render…',
        async () => {
          const { job } = await api.animateCreative(animStill.id);
          nav(`/campaigns?open=${stillCamp.id}`);
          say?.('Animation queued · ~1 min — lands on the creative');
          return {
            line: 'queued · animating still · ~1 min',
            pending: job?.id ? pollJob(job.id).then(() => 'animation ready — open the creative to watch') : null,
          };
        }, 'job', {
          uid: 'anim',
          confirm: `animate “${(animStill.headline || 'the still').slice(0, 34)}” → video · lands on ${stillCamp.brief?.title || 'the campaign'}`,
        });
    }

    // site demo film — screen-captures the newest site version into a video
    // creative on the newest campaign (same fallback chain the route uses)
    if (filmCamp && filmable) {
      cmd('film', 'Film site demo',
        `screen-capture · lands on ${filmCamp.brief?.title || 'newest campaign'}`,
        'film video demo shoot record capture site screen animate make produce',
        'queueing capture…',
        async () => {
          const { job } = await api.campaignDemoVideo(filmCamp.id);
          nav(`/campaigns?open=${filmCamp.id}`);
          say?.('Site film queued — lands as a creative on this campaign');
          return {
            line: 'queued · filming the site',
            pending: job?.id ? pollJob(job.id).then(() => 'site film ready — on the campaign') : null,
          };
        }, 'job', {
          uid: 'film',
          confirm: `film the site demo · lands on ${filmCamp.brief?.title || 'the newest campaign'}`,
        });
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
        }, '', {
          uid: `pub-${draftSite.id}`,
          confirm: `publish ${siteName(draftSite)} — live at /s/site-${draftSite.id.slice(0, 8)}`,
        });
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
        }, '', {
          uid: `unpub-${s.id}`,
          confirm: `unpublish /s/${s.publishedSlug} — ${siteName(s)} goes dark`,
        });
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
        }, '', {
          uid: 'pub-book',
          confirm: 'publish the brand book — goes live',
        });
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
    // the drawer reads profile.qloo + board.evidence.calls — all ctx-reachable
    push('actions', 'qloo', 'Evidence', 'taste-graph evidence trail',
      'qloo signals affinity proof calls', () => setEvi(true));
    // one nav row per route — `place` words pin the row to the top when the
    // query names the page, and they're always safe to hit: nav never mutates
    PLACES.forEach((p) =>
      push('actions', p.icon, p.label, p.meta, p.words,
        () => nav(p.to), p.gate ? gate : '', { place: p.words }));
    return out;
  }, [boards, board, extra, hasStrategy, nav, openBoard, say, setBoard, profile, status]);

  // score → sort within each group → fixed HUD group order → flat list w/
  // a global index + the best-scoring row (beam lands there until arrows move)
  const { groups, flat, best } = useMemo(() => {
    const T = qwords(q);                        // content words, filler stripped
    const single = T.length === 1;
    const place = single && isPlaceWord(T[0]);  // the query IS a place name
    const verb = verbQuery(q);
    // the query asks for a place — always when it IS the word; inside a longer
    // query only when it isn't verb-led AND every other word is a place/nav
    // word too: 'open the dashboard' is a nav ask, 'ravers campaign' and
    // 'film a site video' are not
    const placeQ = single
      ? place
      : !!T.length && !verb && T.every((t) => isPlaceWord(t) || NAV_WORDS.has(t));
    const scored = [];
    let anyPin = false;
    for (const it of items) {
      const sl = qfuzz(q, it.label);
      // label hits outweigh hay hits; the active plan pins to the top on ties
      let s = Math.max(sl >= 0 ? sl * 1.6 : -1, qfuzz(q, it.hay)) + (it.tag === 'active' ? 0.05 : 0);
      // a place ask pins its nav row — the pin can rescue a nav row the rest
      // of the query sank
      if (T.length && it.place && placeQ) {
        let pin = 0, ts = -1;
        for (const t of T) {
          const ph = aliasHit(it.place, t);
          if (ph > 0 && ph >= pin) { pin = ph; ts = Math.max(ts, fuzz(t, it.hay)); }
        }
        if (pin) { s = Math.max(s, ts) + (pin === 2 ? 200 : 100); anyPin = true; }
      }
      if (s < 0) continue;
      // mutating rows (every cmd POSTs) list only on expressed intent —
      // never on a place word; a lone word must reach the action's own
      // trigger words or land a decent label hit; a phrase needs a
      // non-place trigger plus a real score; a query that's all filler
      // can't fire one at all
      if (it.mutating && q.trim()) {
        if (!T.length) continue;
        if (single) {
          // ≥3 chars so bare prefixes ('re', 'fi', 's') can't arm a POST
          if (place || T[0].length < 3 || !(intentHit(it, T[0]) || sl >= 0.55)) continue;
        } else if (!(s >= 0.2 && T.some((t) => !isPlaceWord(t) && intentHit(it, t)))) continue;
      }
      scored.push({ it, s });
    }
    scored.sort((a, b) => b.s - a.s || a.it.label.localeCompare(b.it.label));
    const byGroup = new Map();
    for (const { it, s } of scored) {
      if (!byGroup.has(it.group)) byGroup.set(it.group, []);
      byGroup.get(it.group).push({ it, s });
    }
    const gs = []; let gi = 0, bestGi = 0, bestS = -1;
    // verb-y queries read as commands, place words read as jumps — either
    // way ACTIONS rises above the data groups
    const order = (verb || place || anyPin)
      ? [['actions', 'ACTIONS'], ...GROUPS.filter(([k]) => k !== 'actions')]
      : GROUPS;
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
  // typing changes what ↵ means — drop the beam position and any armed confirm
  useEffect(() => { setNavIdx(null); disarm(); },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [q]);

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
    // heavyweight jobs arm first — the status line says what ↵ will run, a
    // second Enter/click on the same row fires it
    if (it.confirm && armRef.current !== (it.uid || it.id)) {
      armRef.current = it.uid || it.id;
      setAct({ k: 'confirm', msg: `${it.confirm} — ↵ again runs it` });
      return;
    }
    armRef.current = null;
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
      else if (e.key === 'ArrowDown') { e.preventDefault(); e.stopPropagation(); disarm(); setNavIdx(flat.length ? (sel + 1) % flat.length : null); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); e.stopPropagation(); disarm(); setNavIdx(flat.length ? (sel - 1 + flat.length) % flat.length : null); }
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
                  color: act.k === 'err' ? 'var(--rose)' : act.k === 'ok' ? 'var(--lime)' : act.k === 'confirm' ? 'var(--amber)' : 'var(--ink-3)',
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
