import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link, Navigate, useLocation, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api.js';
import { useApp } from '../App.jsx';
import Icon from '../components/Icon.jsx';
import Wayfind from '../components/Wayfind.jsx';
import { SignalChips } from '../components/Qloo.jsx';
import './strategy.css';

// the textarea opens with this default — editable; chips below swap in alternates.
const DEFAULT_PROMPT = 'Cold brew coffee subscription → busy parents';

// real-product prompts — "product/brand → target audience". Every idea carries
// its product page so the scraper pulls real context; clicking fills BOTH the
// prompt and the link field.
const PROMPT_IDEAS = [
  { label: 'Nike Alphafly → sub-3 runners', text: 'Nike Alphafly 3 → marathoners chasing sub-3, 25–40', url: 'https://www.nike.com/t/alphafly-3-road-racing-shoes' },
  { label: 'Liquid Death → festival crowd', text: 'Liquid Death → festival-going metalheads & gym rats, 18–29', url: 'https://liquiddeath.com' },
  { label: 'Skims → Gen Z shapewear', text: 'Skims Fits Everybody → Gen Z first-time shapewear buyers on TikTok', url: 'https://skims.com' },
  { label: 'Olipop → soda quitters', text: 'Olipop prebiotic soda → health-conscious millennials quitting Coke', url: 'https://drinkolipop.com' },
  { label: 'Dr. Martens → first-boot buyers', text: 'Dr. Martens 1460 → first-boot buyers, college freshmen 18–22', url: 'https://www.drmartens.com' },
];

const ALL_CHANNELS = ['instagram', 'tiktok', 'youtube', 'tv', 'streaming', 'podcast', 'ooh', 'guerrilla', 'email', 'press'];
// plain-English channel glossary — jargon like "guerrilla" explains itself on hover
const CHAN_GLOSS = {
  instagram: 'Instagram — feed posts, Reels, Stories',
  tiktok: 'TikTok — short-form video, creator-led',
  youtube: 'YouTube — pre-roll, Shorts, long-form',
  tv: 'TV / CTV spots — broad-reach video ads',
  streaming: 'Streaming audio/video ad placements (Spotify, Hulu)',
  podcast: 'Podcast host-reads and sponsorships',
  ooh: 'Out-of-home — billboards, transit, posters',
  guerrilla: 'Guerrilla — low-cost, unconventional street/public stunts that earn attention by surprise (chalk art, pop-ups, projections)',
  email: 'Email / CRM — owned list sends',
  press: 'Earned press — PR outreach, editorial coverage',
};
const URL_RE = /https?:\/\/[^\s]+/;

// map evidence/strategy channel names onto the existing Icon set
const CHAN_ICON = {
  instagram: 'image', tiktok: 'film', youtube: 'play', tv: 'site', streaming: 'share',
  podcast: 'mic', ooh: 'aspect', guerrilla: 'megaphone', email: 'send', press: 'book',
};
const chanIcon = (c) => CHAN_ICON[String(c || '').toLowerCase()] || 'sparkle';
const pct = (v) => Math.round(Math.max(0, Math.min(1, +v || 0)) * 100);
const findUrl = (t) => (String(t || '').match(URL_RE) || [])[0] || '';
const host = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return u; } };
// "42K est. views" — reach badges
const fmtViews = (n) => {
  const v = +n || 0;
  if (v >= 1e6) return `${(v / 1e6).toFixed(1).replace(/\.0$/, '')}M`;
  if (v >= 1e3) return `${Math.round(v / 1e3)}K`;
  return `${v}`;
};
const REDUCED = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

// streams text character-by-character — the LLM "writing" feel. Used on text
// that lands when data resolves, so content appears to be generated in place.
function Typed({ text = '', cps = 46, delay = 0, className = '', as: Tag = 'span', ...rest }) {
  const s = String(text);
  const [n, setN] = useState(REDUCED ? s.length : 0);
  useEffect(() => {
    if (REDUCED) { setN(s.length); return undefined; }
    setN(0);
    let i = 0, iv;
    const t = setTimeout(() => {
      iv = setInterval(() => {
        i += 1 + (Math.random() < .28 ? 1 : 0); // uneven cadence reads generated
        setN(Math.min(i, s.length));
        if (i >= s.length) clearInterval(iv);
      }, 1000 / cps);
    }, delay);
    return () => { clearTimeout(t); if (iv) clearInterval(iv); };
  }, [s, cps, delay]);
  return (
    <Tag className={className} {...rest}>
      {s.slice(0, n)}
      {n < s.length && <i className="stg-caret" aria-hidden="true" />}
    </Tag>
  );
}

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

// animated score ring — stroke-dashoffset animates via stgRing keyframe (from full offset → inline value).
// small = compact variant used on strategy pick cards.
function Ring({ value = 0, label, small }) {
  const R = 40;
  const C = +(2 * Math.PI * R).toFixed(2); // 251.33 — matches @keyframes stgRing
  const v = Math.max(0, Math.min(1, +value || 0));
  return (
    <div className={`stg-ring${small ? ' sm' : ''}`} role="img" aria-label={`${label} ${pct(v)}%`}>
      <svg viewBox="0 0 96 96">
        <circle className="stg-ring-bg" cx="48" cy="48" r={R} />
        <circle className="stg-ring-fg" cx="48" cy="48" r={R}
          strokeDasharray={C} style={{ strokeDashoffset: C * (1 - v) }} />
      </svg>
      <div className="stg-ring-num"><b><CountUp v={pct(v)} /></b><span>{label}</span></div>
    </div>
  );
}

// ghost-drafting — muted phrases typed into skeleton card slots while the
// model works: type → hold → erase → next phrase. The LLM-writing feel without
// fake progress: these are visibly drafting marks, replaced by real data.
const GHOST_AUD = ['reading the taste graph…', 'scoring media habits…', 'weighing audience signals…', 'checking what to rule out…'];
const GHOST_PICKS = [
  ['drafting lead channel play…', 'fitting formats to the audience…', 'scoring reach…'],
  ['testing a culture-collab angle…', 'matching taste entities…', 'scoring reach…'],
  ['trying counter-positioning…', 'weighing press vs social…', 'scoring reach…'],
];

function GhostWriter({ phrases, delay = 0, big = false }) {
  const [txt, setTxt] = useState('');
  useEffect(() => {
    if (REDUCED) { setTxt(phrases[0] || ''); return undefined; }
    let pi = 0, ci = 0, del = false, alive = true, t;
    const tick = () => {
      if (!alive) return;
      const p = phrases[pi % phrases.length];
      if (!del) {
        ci += 1; setTxt(p.slice(0, ci));
        if (ci >= p.length) { del = true; t = setTimeout(tick, 1700); return; }
        t = setTimeout(tick, 24 + Math.random() * 42);
      } else {
        ci = Math.max(0, ci - 3); setTxt(p.slice(0, ci));
        if (ci === 0) { del = false; pi += 1; t = setTimeout(tick, 340); return; }
        t = setTimeout(tick, 13);
      }
    };
    t = setTimeout(tick, delay);
    return () => { alive = false; clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return <span className={`stg-ghost${big ? ' big' : ''}`}>{txt}<i className="stg-caret" /></span>;
}

const skelBar = (w, h, cls = '') => (
  <span className={`stg-shimmer sk ${cls}`.trim()} style={{ '--w': w, '--h': h }}><i /></span>
);

// per-section skeletons — used both by BoardSkeleton (pre-stream) and inside the
// real board for sections whose SSE stage hasn't landed yet
function AudSkeleton() {
  return (
    <>
      <div className="stg-tile-head">{skelBar('112px', '10px')}</div>
      <div className="stg-aud-main">
        <div className="stg-aud-left stg-skel-col">
          <GhostWriter phrases={GHOST_AUD} big />
          {skelBar('38%', '10px')}
          <div style={{ height: 8 }} />
          {skelBar('88%', '11px')}
          {skelBar('72%', '11px')}
          {skelBar('55%', '11px')}
        </div>
        {skelBar('104px', '104px', 'circle')}
      </div>
      <div className="stg-skel-chips">
        {skelBar('74px', '24px', 'pill')}
        {skelBar('92px', '24px', 'pill')}
        {skelBar('64px', '24px', 'pill')}
        {skelBar('80px', '24px', 'pill')}
      </div>
      {skelBar('100%', '10px')}
      {skelBar('76%', '10px')}
    </>
  );
}

function PicksSkeleton() {
  return (
    <div className="stg-pick-grid">
      {[0, 1, 2].map((i) => (
        <div className="stg-pick stg-pick-skel" key={i} style={{ '--i': i }}>
          <span className="stg-pick-top">
            {skelBar('92px', '9px')}
            {skelBar('46px', '46px', 'circle')}
          </span>
          <GhostWriter phrases={GHOST_PICKS[i]} delay={200 + i * 420} />
          {skelBar('58%', '15px')}
          {skelBar('82%', '10px')}
          <span className="stg-pick-foot">
            {skelBar('86px', '17px', 'pill')}
            {skelBar('42px', '9px')}
          </span>
        </div>
      ))}
    </div>
  );
}

// board-shaped skeleton shown the moment generation starts — same 12-col bento
// as the real board, with ghost text being written into the slots so it reads
// as the model drafting, then the staggered .stg-fill reveals land on top.
function BoardSkeleton() {
  return (
    <div className="stg-board stg-board-skel" aria-hidden="true">
      <section className="card stg-tile stg-aud skel-tile"><AudSkeleton /></section>
      <section className="card stg-tile stg-picks skel-tile">
        <div className="stg-tile-head">{skelBar('140px', '10px')}</div>
        <PicksSkeleton />
      </section>
    </div>
  );
}

// detail-route skeleton — same geometry as the real .stg-detail card, with a
// GhostWriter drafting "what the fetch is doing" into the title slot. The
// click→fetch gap IS the product: this stays up until /boards/:id/strategies/:idx
// answers, then real content materializes in place.
const GHOST_DETAIL = [
  'assembling channel fits…', 'scoring the evidence…', 'pulling the brief…',
  'weighing the watchouts…', 'asking the taste graph…',
];

function DetailSkeleton() {
  const bar = (w, h, cls = '') => (
    <span className={`stg-shimmer sk ${cls}`.trim()} style={{ '--w': w, '--h': h }}><i /></span>
  );
  return (
    <section className="card stg-tile stg-detail stg-detail-skel" aria-hidden="true">
      <div className="stg-detail-top">
        <div className="stg-strat-id stg-skel-col">
          {bar('186px', '10px')}
          <GhostWriter phrases={GHOST_DETAIL} big />
          {bar('58%', '21px')}
          {bar('86%', '11px')}
          {bar('64%', '11px')}
          {bar('140px', '18px', 'pill')}
        </div>
        {bar('104px', '104px', 'circle')}
      </div>
      <div className="stg-detail-cols">
        <div className="stg-detail-left stg-skel-col">
          {bar('96px', '10px')}
          {bar('100%', '64px')}
          {bar('72px', '10px')}
          <span className="stg-skel-chips">
            {bar('88px', '24px', 'pill')}
            {bar('116px', '24px', 'pill')}
            {bar('70px', '24px', 'pill')}
          </span>
          {bar('110px', '10px')}
          {bar('92%', '11px')}
          {bar('78%', '11px')}
        </div>
        <div className="stg-detail-right stg-skel-col">
          {bar('82px', '10px')}
          {bar('100%', '38px')}
          {bar('100%', '38px')}
          {bar('100%', '38px')}
          {bar('100%', '38px')}
        </div>
      </div>
    </section>
  );
}

// "urn:entity:tv_show" → "tv show" — the readable entity-type label
const qtype = (t) => String(t || '').replace(/^urn:entity:/, '').replace(/_/g, ' ');

// evidence.signals rows arrive as "brand: National Geographic (0.92)" strings —
// parse them back into {type, name, affinity} rows so the detail can show the
// actual Qloo entities, grouped by entity type.
const SIG_RE = /^([a-z_ -]+):\s*(.+?)\s*\((\d+(?:\.\d+)?)\)\s*$/i;
const parseSignals = (signals) => (Array.isArray(signals) ? signals : [])
  .map((s) => {
    const m = String(s || '').match(SIG_RE);
    return m ? { type: qtype(m[1]), name: m[2].trim(), affinity: +m[3] } : null;
  })
  .filter(Boolean);

// fetched strategy details cached per board+idx for the session — first visit
// shows the skeleton→fetch cycle; navigating away and back reuses it.
const DETAIL_CACHE = new Map();

// media id pullers for wild cards — the server hands us watch/embed urls, the
// card derives what kind of inline player the "view" button should open.
const ytIdOf = (u) => (String(u || '').match(/(?:youtube\.com\/(?:watch\?[^&]*v=|embed\/|shorts\/)|youtu\.be\/)([\w-]{6,})/) || [])[1] || '';
const tkIdOf = (u) => (String(u || '').match(/tiktok\.com\/(?:@[\w.-]+\/video\/|player\/v1\/)(\d+)/) || [])[1] || '';

const SRC_LABEL = { scraped: 'scraped', 'catalog-art': 'catalog art', 'concept-art': 'concept art' };

import { chanLabel } from '../labels.js';

// the ask minus imperative + audience tails → a clean product/subject phrase
const cleanAsk = (raw) => (String(raw || '').split('→')[0]
  .replace(/^\s*(help me |please )?(build|make|create|launch|position|grow|market|promote|sell|pitch|analyze)\s+/i, '')
  .replace(/\s+(aimed at|for|targeting|to reach|to market to|going after)\s+.+$/i, '')
  .trim() || 'your product').slice(0, 60);

// honesty helper — 'live' only claims when every call was live
const qlooVerb = (mode) => (mode === 'live' ? 'Qloo says' : 'the taste model says');

// stable identity for an example card — survives re-pulls ordering shifts
const exKey = (e) => e.url || e.embed || `${e.platform || 'web'}:${e.title || ''}`;

// one "in the wild" example card — SELECTABLE: a click toggles it into the set
// of references handed to the campaign. The play/view button opens REAL media
// in a fold under the card — youtube iframe, tiktok poster, image, audio, or a
// sandboxed page peek. Nothing ever links out of the app (no target=_blank).
function WildCard({ e, i, sel, onToggle }) {
  const [open, setOpen] = useState(true);   // the media fold is always visible — collapse is opt-out
  const [imgDead, setImgDead] = useState(false);   // upstream image flaked → hide thumb
  const img = imgDead ? '' : (e.image || e.thumb || '');
  const vid = ytIdOf(e.embed || e.embedUrl || e.url) || e.videoId || '';
  const tk = tkIdOf(e.embed || e.embedUrl || e.url) || '';
  const isTk = !!tk || /tiktok/i.test(e.platform || '');
  const audio = e.audioUrl || e.previewUrl || '';
  const embed = e.embed || e.embedUrl || '';
  // media kind the fold will render — every card with any artifact gets one
  const kind = vid ? 'yt' : isTk && (tk || embed || img) ? 'tk'
    : audio ? 'audio' : embed ? 'embed' : img ? 'img' : e.url ? 'page' : null;
  const btnLabel = open ? 'close'
    : kind === 'yt' || kind === 'embed' ? 'play inline'
    : kind === 'tk' ? 'view' : kind === 'audio' ? 'listen'
    : kind === 'page' ? 'peek' : 'view';
  const btnIcon = open ? 'x' : kind === 'img' || kind === 'page' ? 'eye' : kind === 'audio' ? 'mic' : 'play';

  return (
    <div className={`stg-wx pickable${open ? ' open' : ''}${sel ? ' sel' : ''}`} style={{ '--i': i }}
      role="button" tabIndex={0} aria-pressed={!!sel}
      title={sel ? 'Selected — will feed the campaign' : 'Select as a campaign reference'}
      onClick={onToggle}
      onKeyDown={(ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); onToggle?.(); } }}>
      {!!img && !imgDead && <span className="stg-wx-media"><img src={img} alt="" loading="lazy" onError={() => setImgDead(true)} /></span>}
      <span className="stg-wx-body stg-fill">
        <span className="stg-wx-plat">
          <Icon name={chanIcon(e.platform)} size={12} />{e.platform || 'web'}
          <span className={`stg-src ${e.source || 'scraped'}`}>{SRC_LABEL[e.source] || e.source || 'scraped'}</span>
        </span>
        <span className="stg-wx-title">{e.title}</span>
        {!!e.match && <span className="stg-wx-match" title={e.match}>{e.match}</span>}
        {!!e.author && <span className="stg-wx-author">{e.author}</span>}
        {(typeof e.views === 'number' || typeof e.likes === 'number') && (
          <span className="stg-wx-views" title="Real engagement reported by the source">
            {typeof e.views === 'number' && <><Icon name="eye" size={10} /> {fmtViews(e.views)} views</>}
            {typeof e.likes === 'number' && <><Icon name="check" size={10} /> {fmtViews(e.likes)} likes</>}
          </span>
        )}
        {!!e.note && <span className="stg-wx-note">“{e.note}”</span>}
        <span className="stg-wx-acts">
          {!!kind && (
            <button type="button" className="stg-wx-play"
              onClick={(ev) => { ev.preventDefault(); ev.stopPropagation(); setOpen((o) => !o); }}>
              <Icon name={btnIcon} size={10} /> {btnLabel}
            </button>
          )}
        </span>
      </span>
      <span className={`stg-wx-check${sel ? ' on' : ''}`} aria-hidden="true">
        <Icon name="check" size={11} sw={2.8} />
      </span>
      {/* the media fold — opens beneath the card, in-app */}
      {open && (
        <span className="stg-wx-fold" onClick={(ev) => ev.stopPropagation()}>
          {kind === 'yt' && (
            <span className="stg-wx-embed">
              <iframe src={`https://www.youtube.com/embed/${vid}`} title={e.title || 'youtube example'}
                loading="lazy" referrerPolicy="strict-origin-when-cross-origin"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; picture-in-picture; web-share"
                allowFullScreen />
            </span>
          )}
          {kind === 'tk' && (img ? (
            <span className="stg-wx-poster">
              <img src={img} alt={e.title || 'TikTok cover'} loading="lazy" />
              <span className="stg-wx-poster-cap">
                <Icon name="film" size={12} /> TikTok video{e.author ? ` — ${e.author}` : ''} · cover frame (TikTok blocks embeds)
              </span>
            </span>
          ) : (
            <span className="stg-wx-embed tt">
              <iframe src={embed || `https://www.tiktok.com/player/v1/${tk}`} title={e.title || 'tiktok example'}
                loading="lazy" referrerPolicy="strict-origin-when-cross-origin" allowFullScreen />
            </span>
          ))}
          {kind === 'audio' && <audio controls preload="none" src={audio} className="stg-wx-audio" />}
          {kind === 'embed' && (
            <span className="stg-wx-embed">
              <iframe src={embed} title={e.title || 'example'} loading="lazy"
                referrerPolicy="strict-origin-when-cross-origin"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; picture-in-picture; web-share"
                allowFullScreen />
            </span>
          )}
          {kind === 'img' && (img ? (
            <span className="stg-wx-big"><img src={img} alt={e.title || ''} onError={() => setImgDead(true)} /></span>
          ) : (
            <span className="stg-wx-poster-cap"><Icon name="image" size={12} /> image unavailable upstream — the reference card still carries the source link context</span>
          ))}
          {kind === 'page' && (
            <span className="stg-wx-embed page">
              <iframe src={e.url} title={e.title || 'source page'} loading="lazy"
                sandbox="allow-scripts allow-same-origin" referrerPolicy="strict-origin-when-cross-origin" />
              <span className="stg-wx-poster-cap"><Icon name="globe" size={12} />{host(e.url)} — live page in a sandbox</span>
            </span>
          )}
        </span>
      )}
    </div>
  );
}

export default function Strategy() {
  const { profile, say, board, setBoard, boards, setBoards, openBoard } = useApp();
  const nav = useNavigate();
  const loc = useLocation();
  // /strategy → the board list; /strategy/:idx → one strategy's full page.
  const { '*': seg = '' } = useParams();
  const isDetail = seg !== '';
  const sel = isDetail && /^\d+$/.test(seg) ? parseInt(seg, 10) : null;

  const [prompt, setPrompt] = useState(DEFAULT_PROMPT);
  const [siteUrl, setSiteUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [editingPrompt, setEditingPrompt] = useState(false); // chipbar inline edit
  const [editPrompt, setEditPrompt] = useState('');
  const [resL, setResL] = useState(undefined); // local override; undefined → follow ctx board
  const [err, setErr] = useState('');
  const [notes, setNotes] = useState('');      // "add notes for the campaign"
  const [ex, setEx] = useState(() => {         // "boardId:strategyId" -> {status, data, err, hint}
    try { return JSON.parse(sessionStorage.getItem('marque.wildEx') || '{}') || {}; }
    catch { return {}; }
  });
  const [sub, setSub] = useState(null);        // submitted {prompt, productId, url}
  // detail fetch-on-click — "boardId:idx" -> {status, strategy, audienceRead, evidence, err}
  const [det, setDet] = useState({});
  const detReq = useRef({});                   // in-flight guard, keyed like det
  const exReq = useRef({});                    // in-flight guard for example pulls
  const exCacheRef = useRef(new Map());        // "boardId:strategyId::hint" -> last pull (no silent refire)
  const [wildHint, setWildHint] = useState(''); // user steer for the wild pull
  // selected "in the wild" references, keyed per board+strategy so the set
  // survives route hops; mirrored to sessionStorage + the Campaigns handoff
  // (the boards API only persists title — there is no selection field).
  const [selEx, setSelEx] = useState(() => {
    try { return JSON.parse(sessionStorage.getItem('marque.wildSel') || '{}') || {}; }
    catch { return {}; }
  });
  // pulled refs survive navigation — session persist (done states only)
  useEffect(() => {
    try {
      const done = Object.fromEntries(Object.entries(ex).filter(([, v]) => v?.status === 'done'));
      sessionStorage.setItem('marque.wildEx', JSON.stringify(done));
    } catch { /* storage full/unavailable — memory-only still works */ }
  }, [ex]);
  const [renaming, setRenaming] = useState(false);
  const [renameVal, setRenameVal] = useState('');
  const renameRef = useRef(null);

  // the board lives in app Ctx (loaded via api.getStrategy on app mount) so it
  // survives navigation; resL lets this view clear it locally for a new prompt
  // without revoking the global unlock.
  const res = resL === undefined ? board : resL;
  const setRes = (v) => { setResL(v); if (v) setBoard(v); };

  // restore the submitted prompt for a persisted board (selection is the URL now)
  useEffect(() => {
    if (!res) return;
    try {
      const sj = sessionStorage.getItem('marque.strategySub');
      const restored = res.sub || (sj ? JSON.parse(sj) : null); // server-persisted sub is authoritative
      if (restored) setSub((s) => s || restored);
    } catch { /* storage unavailable — board still renders */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [res]);

  // the plans row lists every board — refresh summaries on mount
  useEffect(() => {
    api.boards()
      .then(({ boards: bs }) => { if (Array.isArray(bs)) setBoards?.(bs); })
      .catch(() => {}); // older backend — the switcher just stays short
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // /strategy?new=1 → straight into the composer for a fresh board
  useEffect(() => {
    if (new URLSearchParams(loc.search).get('new')) {
      reset();
      nav('/strategy', { replace: true }); // strip the query so it doesn't retrigger
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loc.search]);

  useEffect(() => { if (renaming) renameRef.current?.focus(); }, [renaming]);

  const generate = async (text) => {
    const raw = String(text ?? prompt);
    const p = raw.trim();
    const url = siteUrl.trim() || findUrl(raw);
    if ((!p && !url) || busy) return;
    if (text) setPrompt(p);
    setBusy(true); setErr(''); setNotes(''); setEx({});
    // stream the build — each stage lands and its section starts typing in
    // while the next is still generating. Falls back to the one-shot call.
    try {
      const s = { prompt: p, productId: '', url };
      setSub(s);
      setRes({ sub: s });   // partial board — sections fill as stages arrive
      let gotBoard = null;
      try {
        const stream = api.strategyStream(p, undefined, url || undefined, (ev, data) => {
          if (ev === 'stage' && data?.urlContext) setRes((r) => ({ ...(r || {}), urlContext: data.urlContext }));
          if (ev === 'audience') setRes((r) => ({ ...(r || {}), audienceRead: data.audienceRead, evidence: data.evidence, sub: s }));
          if (ev === 'strategies') setRes((r) => ({ ...(r || {}), strategies: data.strategies }));
          if (ev === 'anti') setRes((r) => ({ ...(r || {}), antiStrategies: data.antiStrategies }));
          if (ev === 'done' && data?.board) setRes(data.board);
        });
        gotBoard = await Promise.race([
          stream,
          new Promise((_, rej) => setTimeout(() => rej(new Error('generation timed out — the model took too long. Retry?')), 150000)),
        ]);
      } catch (e) {
        if (/timed out/.test(e.message || '')) throw e;   // don't mask timeouts with a silent re-wait
        const out = await api.strategy(p, undefined, url || undefined);   // SSE unsupported → one-shot
        gotBoard = out;
        setRes(out);
      }
      try { sessionStorage.setItem('marque.strategySub', JSON.stringify(s)); } catch { /* storage unavailable */ }
      // a new board now exists — refresh the plans switcher
      api.boards().then(({ boards: bs }) => { if (Array.isArray(bs)) setBoards?.(bs); }).catch(() => {});
    } catch (e) {
      setErr(e.message || 'strategy generation failed');
      say?.(e.message);
    }
    setBusy(false);
  };

  // pill click → collapse back to the composer (ctx board stays → app stays unlocked)
  const reset = () => {
    setResL(null); setErr(''); setNotes(''); setEx({}); setRenaming(false);
    setPrompt(''); setSiteUrl('');   // composer starts empty — no leftover text
    if (isDetail) nav('/strategy');
  };

  // inline board rename — PATCH /api/boards/:id, then patch every local copy
  const commitRename = async () => {
    const title = renameVal.trim();
    setRenaming(false);
    if (!title || !res?.id || title === res.title) return;
    try {
      await api.renameBoard(res.id, title);
      const nb = { ...res, title };
      setBoard(nb); setResL(nb);
      setBoards?.((bs) => (bs || []).map((b) => (b.id === res.id ? { ...b, title } : b)));
      say?.('Plan renamed');
    } catch (e) { say?.(e.message || 'rename failed'); }
  };

  // manual pull of real-world examples — only fires on button click, steered by
  // the hint input. Results are cached per board+strategy+hint so re-visiting a
  // card or re-typing a used hint restores instead of re-scraping.
  const loadExamples = async (s, hint = '', force = false) => {
    if (!s) return;
    const scope = wildScope(s);
    const h = String(hint || '').trim();
    const ck = `${scope}::${h.toLowerCase()}`;
    if (!force && exCacheRef.current.has(ck)) {
      setEx((m) => ({ ...m, [scope]: { status: 'done', data: exCacheRef.current.get(ck), hint: h } }));
      return;
    }
    if (exReq.current[ck]) return;
    exReq.current[ck] = true;
    setEx((m) => ({ ...m, [scope]: { status: 'loading', hint: h } }));
    try {
      const data = await api.strategyExamples(s, detReadRef.current, h, res?.id);
      exCacheRef.current.set(ck, data);
      setEx((m) => ({ ...m, [scope]: { status: 'done', data, hint: h } }));
    } catch (e) {
      setEx((m) => ({ ...m, [scope]: { status: 'error', err: e.message || 'pull failed', hint: h } }));
    } finally {
      delete exReq.current[ck];
    }
  };

  // hand the strategy to Campaigns: stash the handoff (+ any wild-example
  // references the user selected), then open /campaigns
  const useStrategy = (s) => {
    const keys = new Set(selEx[wildScope(s)] || []);
    const exampleRefs = ((ex[wildScope(s)]?.data?.examples) || [])
      .filter((e) => keys.has(exKey(e)))
      .map((e) => ({ platform: e.platform || '', title: e.title || '', author: e.author || '', url: e.url || '', note: e.note || '' }));
    try {
      sessionStorage.setItem('strategyHandoff', JSON.stringify({
        strategy: s,
        strategyId: s.id || '',
        strategyTitle: s.title || '',
        boardId: board?.id || '',
        notes,
        prompt: sub?.prompt || '',
        productId: sub?.productId || '',
        exampleRefs,
      }));
    } catch { /* storage unavailable — Campaigns just won't prefill */ }
    say?.(`"${s.title}" handed to Campaigns`);
    nav('/campaigns');
  };

  const read = res?.audienceRead || {};
  const lean = read.lean || {};
  const strats = res?.strategies || [];
  // `cur` is the SLIM card (title/angle/fit/channels{name,fit} only) — the detail
  // page must fetch the full strategy; nothing below may read brief/watchouts/etc
  // off it until boardStrategy() resolves.
  const cur = sel !== null && sel >= 0 && sel < strats.length ? strats[sel] : null;
  const detKey = res?.id && sel !== null ? `${res.id}:${sel}` : null;
  const detState = detKey ? det[detKey] : null;
  const full = detState?.status === 'done' ? detState.strategy : null;
  // the detail fetch returns its own audienceRead + evidence — prefer them
  const detRead = detState?.audienceRead || read;
  const detEv = detState?.evidence || res?.evidence || {};
  const detReadRef = useRef(detRead);
  detReadRef.current = detRead;
  const chans = full ? [...(full.channels || [])].sort((a, b) => (+b.fit || 0) - (+a.fit || 0)) : [];
  const calls = res?.evidence?.calls || [];
  const ev = res?.evidence || {};

  // actual Qloo entities ("type: name (aff)" rows) + a name→row lookup so
  // channel-fit "likes" and the Qloo-read section show real affinities
  const entRows = useMemo(() => parseSignals(detEv.signals), [detEv]);
  const entIndex = useMemo(() => {
    const m = {};
    for (const r of entRows) m[r.name.toLowerCase()] = r;
    return m;
  }, [entRows]);
  const entGroups = useMemo(() => {
    const g = [];
    for (const r of entRows) {
      const last = g[g.length - 1];
      if (last && last.type === r.type) last.rows.push(r);
      else g.push({ type: r.type, rows: [r] });
    }
    return g;
  }, [entRows]);

  // selection scope: per board + strategy, so picks don't leak between plans
  const wildScope = (s) => `${res?.id || 'board'}:${s?.id || s?.title || ''}`;
  const curScope = cur ? wildScope(cur) : '';
  const exState = cur ? ex[curScope] : null;
  const curSel = new Set(selEx[curScope] || []);
  const wildList = (exState?.data?.examples || []).slice(0, 8);
  const selExamples = wildList.filter((e) => curSel.has(exKey(e)));
  const toggleWild = (e) => {
    if (!curScope) return;
    const k = exKey(e);
    setSelEx((m) => {
      const cur2 = new Set(m[curScope] || []);
      if (cur2.has(k)) cur2.delete(k); else cur2.add(k);
      const next = { ...m, [curScope]: [...cur2] };
      try { sessionStorage.setItem('marque.wildSel', JSON.stringify(next)); } catch { /* storage unavailable */ }
      return next;
    });
  };

  // provenance line under the signals — built from real board.evidence fields
  const provBits = [];
  if (ev.qlooMode && ev.qlooMode !== 'none') provBits.push('Qloo taste graph');
  if (calls.length) provBits.push(`${calls.length} call${calls.length === 1 ? '' : 's'}`);
  if (ev.qlooMode && ev.qlooMode !== 'none') provBits.push(`${ev.qlooMode} mode`);
  if (ev.source) provBits.push(ev.source === 'tensor' ? 'Marque strategy model' : 'rule-based strategy model');
  if ((sub?.url || res?.sub?.url) && !res?.urlContext?.scrapeFailed) provBits.push('site scrape');

  // fetch-on-click: the slim board card doesn't carry brief/watchouts/fit likes —
  // opening /strategy/:idx fires the real fetch and the skeleton holds the gap.
  // DETAIL_CACHE + detReq keep back-nav and double-effects from refiring.
  const fetchDetail = (key, force = false) => {
    if (!key) return;
    const idx = +key.slice(key.lastIndexOf(':') + 1);
    const boardId = key.slice(0, key.lastIndexOf(':'));
    if (!force && (DETAIL_CACHE.has(key) || detReq.current[key])) {
      if (DETAIL_CACHE.has(key)) {
        const v = DETAIL_CACHE.get(key);
        setDet((m) => (m[key] === v ? m : { ...m, [key]: v }));
      }
      return;
    }
    detReq.current[key] = true;
    const t0 = Date.now();
    setDet((m) => ({ ...m, [key]: { status: 'loading' } }));
    api.boardStrategy(boardId, idx)
      .then((d) => {
        // hold the skeleton ≥380ms even on a fast response — an instant swap
        // reads as a blank flash, not a fetch
        const wait = Math.max(0, 380 - (Date.now() - t0));
        setTimeout(() => {
          const v = { status: 'done', ...d };
          DETAIL_CACHE.set(key, v);
          setDet((m) => ({ ...m, [key]: v }));
        }, wait);
      })
      .catch((e) => {
        setDet((m) => ({ ...m, [key]: { status: 'error', err: e.message || 'detail fetch failed' } }));
      })
      .finally(() => { delete detReq.current[key]; });
  };

  useEffect(() => {
    if (detKey) fetchDetail(detKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detKey]);

  // fresh card → fresh notes + fresh pull steer
  useEffect(() => { setNotes(''); setWildHint(''); }, [sel]);

  // auto-pull references once a card is open — real-time unless already cached.
  // fires only when the scope has no entry yet, so re-opens hit cache instantly.
  const pullAnim = useRef(null);
  const [pullPhase, setPullPhase] = useState(0);
  useEffect(() => {
    const s = detState?.status === 'done' ? detState.strategy : cur;
    if (s && !ex[wildScope(s)]) loadExamples(s, '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detState?.status, cur?.id]);
  useEffect(() => {
    if (exState?.status === 'loading') {
      pullAnim.current = setInterval(() => setPullPhase((p) => p + 1), 900);
      return () => clearInterval(pullAnim.current);
    }
  }, [exState?.status]);
  const wildGridRef = useRef(null);
  const scrollWild = (dir) => wildGridRef.current?.scrollBy({ left: dir * 560, behavior: 'smooth' });

  // "your audience likes" rows for a channel-fit row — media-habit note first,
  // then the cited affinities resolved to real Qloo entities (name · type · score),
  // backfilled from the driver's entity type so every row cites the taste graph.
  const fitLikes = (c) => {
    const out = [];
    const seen = new Set();
    const habit = (detRead.mediaHabits || []).find((m) => m.channel === c.name)?.note;
    if (habit) out.push({ text: habit });
    const pushEnt = (r) => {
      if (!r || seen.has(r.name.toLowerCase()) || out.length >= 6) return;
      seen.add(r.name.toLowerCase());
      out.push({ ent: r });
    };
    for (const bit of String(c.why || '').split(/\s*[,;]\s*/).filter(Boolean)) {
      const m = bit.match(/^(.+?)\s*\((\d+(?:\.\d+)?)\)$/);
      const name = (m ? m[1] : bit).trim();
      const known = entIndex[name.toLowerCase()];
      if (known) pushEnt(known);
      else if (m) pushEnt({ name, type: '', affinity: +m[2] });
      else if (!seen.has(bit.toLowerCase())) { seen.add(bit.toLowerCase()); out.push({ text: bit }); }
    }
    // driver type for this channel (mediaHabits carries the urn) → its entities
    const drvType = qtype((detEv.drivers || []).find((d) => d.channel === c.name)?.type);
    if (drvType) for (const r of entRows) if (r.type === drvType) pushEnt(r);
    return out.length ? out : [{ text: `matches the ${detRead.lean?.label || 'audience'} read` }];
  };

  // "why this fits" — composed from real board data: product, top entities, channels
  const prodName = cleanAsk(sub?.prompt || res?.sub?.prompt || res?.title);
  const qTop = [...entRows].sort((a, b) => b.affinity - a.affinity).slice(0, 3);
  const qChans = chans.slice(0, 3).map((c) => chanLabel(c.name));
  const detCalls = detEv.calls || [];
  const detSources = [...new Set(detCalls.map((c) => c.endpoint).filter(Boolean))];

  // "What we ruled out" — the board's antiStrategies, else derive from fit priors
  const anti = useMemo(() => {
    if (!res) return [];
    // while streaming, only the real antiStrategies stage may fill this —
    // deriving "no signal" rows before strategies land claims false rulings
    if (busy && !Array.isArray(res.antiStrategies)) return [];
    if (Array.isArray(res.antiStrategies) && res.antiStrategies.length) {
      return res.antiStrategies.slice(0, 6).map((a) => ({
        title: a.title || a.channel || 'tactic', channel: a.channel,
        why: String(a.whyNot || a.why || '').replace(/[*_`]/g, '').replace(/'whyNot'\s*/gi, '').trim(),
      }));
    }
    const fitsBy = {};
    for (const s of strats) for (const c of s.channels || []) {
      (fitsBy[c.name] = fitsBy[c.name] || []).push(+c.fit || 0);
    }
    const out = [];
    const leanLabel = lean.label || '';
    if (/craft|heritage|indie/i.test(leanLabel)) {
      out.push({ title: 'AI-hologram stunt', why: `penalized for this lean (${leanLabel}) — reads as gimmicky; keep generated assets subtle` });
    } else if (/early|adopter|tech/i.test(leanLabel)) {
      out.push({ title: 'Static print-only push', why: `undersells a ${leanLabel} crowd — they reward interactive, AI-native formats` });
    } else if (leanLabel) {
      out.push({ title: 'Edgy niche-collab drop', why: `too narrow for a ${leanLabel} audience — broad, value-led channels carry it` });
    }
    for (const ch of ALL_CHANNELS) {
      const fits = fitsBy[ch];
      if (!fits) out.push({ title: ch, channel: ch, why: 'no supporting signal in the audience taste data' });
      else if (Math.max(...fits) < 0.35) {
        out.push({ title: ch, channel: ch, why: `weak fit in every concept (best ${pct(Math.max(...fits))}%) — spend would be speculative` });
      }
    }
    return out.slice(0, 7);
  }, [res, strats, lean.label, busy]);

  const inlineUrl = findUrl(prompt);
  const effUrl = siteUrl.trim() || inlineUrl;
  const canGo = !busy && !!(prompt.trim() || effUrl);
  const subProduct = sub?.productId ? (profile?.catalog || []).find((p) => p.id === sub.productId) : null;
  const subHost = sub?.url ? host(sub.url) : '';

  if (profile === undefined || res === undefined) {
    return <div className="loading-wrap"><div className="spinner" /></div>;
  }

  // detail URL without a valid board/card → back to the board list
  if (isDetail && !busy && !cur) {
    return <Navigate to="/strategy" replace />;
  }

  const pageHead = (
    <div className="page-head">
      <h1 className="display">Strategy board</h1>
      <p className="sub">
        Say what you're trying to do — or paste a product/site URL — we read your audience's
        taste graph, pitch strategies with the evidence behind every call, and flag what wouldn't work.
      </p>
    </div>
  );

  return (
    <div className="section stg-wrap">
      <Wayfind />
      {!profile ? (
        <>
          {pageHead}
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
        </>
      ) : (
        <>
          {/* ---- collapsed prompt pill — click the text to edit it inline,
                Enter regenerates from the modified prompt ---- */}
          {(busy || res) && (
            <div className={`stg-chipbar${editingPrompt ? ' editing' : ''}`} role="button" tabIndex={editingPrompt ? -1 : 0}
              title="Click to modify this prompt"
              onClick={() => { if (!editingPrompt && !busy) { setEditPrompt(sub?.prompt || ''); setEditingPrompt(true); } }}
              onKeyDown={(e) => { if (e.key === 'Enter' && !editingPrompt && !busy) { setEditPrompt(sub?.prompt || ''); setEditingPrompt(true); } }}>
              <span className="stg-chipbar-ic"><Icon name="sparkle" size={14} /></span>
              {editingPrompt ? (
                <input className="stg-chipbar-edit" autoFocus value={editPrompt}
                  placeholder="product/brand → audience"
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) => setEditPrompt(e.target.value)}
                  onKeyDown={(e) => {
                    e.stopPropagation();
                    if (e.key === 'Enter' && editPrompt.trim()) { setEditingPrompt(false); generate(editPrompt.trim()); }
                    if (e.key === 'Escape') setEditingPrompt(false);
                  }}
                  onBlur={() => setEditingPrompt(false)} />
              ) : (
                <span className="stg-chipbar-prompt" title={sub?.prompt || sub?.url}>
                  {sub?.prompt || sub?.url || 'strategy board'}
                </span>
              )}
              {!editingPrompt && !!subProduct && <span className="stg-tag"><Icon name="bag" size={11} />{subProduct.name}</span>}
              {!editingPrompt && !!subHost && <span className="stg-tag"><Icon name="globe" size={11} />{subHost}</span>}
              {!editingPrompt && (
                <button className="btn ghost sm stg-chipbar-new" disabled={busy}
                  title="Edit this prompt and regenerate — creates a new plan"
                  onClick={(e) => { e.stopPropagation(); if (!busy) { setEditPrompt(sub?.prompt || ''); setEditingPrompt(true); } }}>
                  <Icon name="edit" size={13} /> Edit ask
                </button>
              )}
            </div>
          )}

          {/* ---- plans row — switch between every generated strategy board ---- */}
          {res && !busy && (
            <div className="stg-plans">
              <span className="stg-plans-cur">
                <span className="stg-plans-label">Plan:</span>
                {renaming ? (
                  <input
                    ref={renameRef}
                    className="stg-plan-rename"
                    value={renameVal}
                    onChange={(e) => setRenameVal(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') commitRename();
                      if (e.key === 'Escape') setRenaming(false);
                    }}
                    onBlur={() => setRenaming(false)}
                  />
                ) : (boards || []).length > 1 ? (
                  // real switcher — the row looks like a picker, so make it one
                  <select className="stg-plan-switch display" value={res.id || ''}
                    onChange={async (e) => {
                      const b = await openBoard(e.target.value).catch(() => null);
                      if (b) { setResL(b); nav('/strategy'); }
                    }}>
                    {(boards || []).map((b) => <option key={b.id} value={b.id}>{b.title || 'Untitled plan'}</option>)}
                  </select>
                ) : (
                  <span className="stg-plans-title display">
                    {res.title || 'Strategy board'}
                  </span>
                )}
                {!renaming && !!res.id && (
                  <button type="button" className="stg-plan-edit" title="Rename plan"
                    onClick={() => { setRenameVal(res.title || ''); setRenaming(true); }}>
                    <Icon name="edit" size={12} />
                  </button>
                )}
              </span>
              <button type="button" className="btn ghost sm stg-plan-new" onClick={reset}>
                <Icon name="plus" size={11} /> New plan
              </button>
              {/* workflow links — folded in from the old topnav; they only make
                  sense once a board exists, so they live on the board */}
              <span className="stg-flow">
                <Link className="stg-flow-link" to="/campaigns"><Icon name="campaign" size={11} />Campaigns</Link>
                <Link className="stg-flow-link" to="/photoshoot"><Icon name="photo" size={11} />Photoshoot</Link>
                <Link className="stg-flow-link" to="/websites"><Icon name="site" size={11} />Websites</Link>
                <Link className="stg-flow-link" to="/brandbook"><Icon name="book" size={11} />Brand book</Link>
                <Link className="stg-flow-link" to="/profile"><Icon name="dna" size={11} />Profile</Link>
              </span>
            </div>
          )}

          {/* live stage readout while a board streams — the SSE stage names,
              not a spinner pretending to be progress */}
          {busy && (
            <div className="stg-stage" role="status" aria-live="polite">
              <span className="stg-stage-dot" />
              {res?.antiStrategies ? 'scoring what we ruled out…'
                : res?.strategies ? 'ranking ruled-out tactics…'
                : res?.audienceRead ? 'model is drafting strategies…'
                : 'pulling Qloo taste data + reading the site…'}
            </div>
          )}

          {/* a dead-URL board must say so loudly — confident-looking output on
              zero scraped input is exactly the dishonesty we guard against */}
          {!!res?.urlContext?.scrapeFailed && (
            <div className="stg-warn">
              <Icon name="info" size={13} /> couldn't read {host(res.urlContext.url) || 'that site'} — this read leans on taste signals only. Re-check the URL or describe the product instead.
            </div>
          )}

          {/* ---- heading + composer — slide up + fade once submitted ---- */}
          <div className={`stg-compose${busy || res ? ' shut' : ''}`} aria-hidden={!!(busy || res)}>
            <div className="stg-compose-in">
              {pageHead}
              <div className="card stg-ask">
                <textarea
                  value={prompt}
                  placeholder="Your product or brand → the audience you want. e.g. Rhode lip tint → Gen Z"
                  onChange={(e) => setPrompt(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) generate(); }}
                />
                <div className={`stg-linkrow${siteUrl.trim() ? ' has' : ''}`}>
                  <span className="stg-linkrow-lbl"><Icon name="link" size={13} /> Product link</span>
                  <input className="stg-url" value={siteUrl}
                    placeholder="amazon.com/dp/… · yourstore.com/product · any product or brand site"
                    onChange={(e) => setSiteUrl(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') generate(); }} />
                  {!!inlineUrl && !siteUrl.trim() && (
                    <span className="stg-tag" title="Detected in your prompt — will be scraped as context">
                      <Icon name="globe" size={11} />{host(inlineUrl)}
                    </span>
                  )}
                </div>
                <div className="stg-ask-foot">
                  <span className="stg-hint-inline">the link gets scraped for real product context — the more real the page, the sharper the strategies</span>
                  <span className="grow" />
                  <button className="btn lime" disabled={!canGo} onClick={() => generate()}>
                    <Icon name="sparkle" /> Generate strategies
                  </button>
                </div>
              </div>

              {!err && (
                <div className="stg-examples">
                  {PROMPT_IDEAS.map((idea) => (
                    <button key={idea.text} className="stg-ex" title={`${idea.text} · scrapes ${idea.url}`}
                      onClick={() => { setPrompt(idea.text); setSiteUrl(idea.url); }}>
                      {idea.label}<span className="stg-ex-url">{host(idea.url)}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* while the board generates: full skeleton until the first stage
              (audience read) lands — then real sections type in live and only
              the not-yet-arrived sections stay skeleton inside the board */}
          {busy && !res?.audienceRead && !res?.strategies && <BoardSkeleton />}

          {err && !busy && (
            <div className="card stg-err">
              <span className="lead"><Icon name="x" size={16} /> Couldn't build strategies</span>
              <span className="muted small">{err}</span>
              <button className="btn ghost sm" onClick={() => generate()}>
                <Icon name="refresh" size={14} /> Retry
              </button>
            </div>
          )}

          {res && !isDetail && (res.audienceRead || res.strategies || !busy) && (
            <>
              <div className="stg-board">
                {/* ---- audience read ---- */}
                {!res.audienceRead ? (
                  <section className="card stg-tile stg-aud skel-tile"><AudSkeleton /></section>
                ) : (
                <section className="card stg-tile stg-aud" style={{ '--i': 0 }}>
                  <div className="stg-tile-head">
                    <span className="stg-ml">Audience read</span>
                  </div>
                  <div className="stg-aud-main">
                    <div className="stg-aud-left">
                      <Typed as="div" className="stg-lean display stg-fill" style={{ '--fo': '60ms' }} text={lean.label || 'Unclear'} delay={80} cps={34} />
                      <div className="stg-heur stg-fill" style={{ '--fo': '130ms' }}>directional read — not a fact</div>
                      {!!lean.signals?.length && (
                        <ul className="stg-sigs">
                          {lean.signals.map((s, i) => {
                            // "strong artist pull — X, Y" → the entity type is the API facet
                            const facet = (String(s).match(/(\w+)\s+pull/i) || [])[1]?.toLowerCase();
                            return (
                              <li key={i} className="stg-fill" style={{ '--fo': `${190 + i * 55}ms` }}>
                                {s}
                                {!!facet && <span className="stg-sig-src" title={`Qloo taste graph · ${facet} entities`}>qloo:{facet}</span>}
                              </li>
                            );
                          })}
                        </ul>
                      )}
                    </div>
                    <div className="stg-fill stg-ringwrap" style={{ '--fo': '120ms' }}
                      title="Confidence in this read — derived from signal breadth and pull strength">
                      <Ring value={lean.confidence} label="conf" />
                    </div>
                  </div>

                  {/* provenance — derived from the board's own evidence fields */}
                  {!!provBits.length && (
                    <div className="stg-prov stg-fill" style={{ '--fo': '320ms' }}
                      title="Where this read came from">
                      <Icon name="qloo" size={10} />
                      <span>from {provBits.join(' · ')}</span>
                    </div>
                  )}

                  {!!read.mediaHabits?.length && (
                    <div className="stg-fill" style={{ '--fo': '380ms' }}>
                      <span className="stg-ml">Taste drivers</span>
                      <div className="stg-habits" style={{ marginTop: 8 }}>
                        {read.mediaHabits.map((h, i) => (
                          <div className="stg-habit stg-fill" key={i} style={{ '--fo': `${410 + i * 55}ms` }}>
                            <span className="stg-hchip">{String(h.type || '').replace('urn:entity:', '').replace(/_/g, ' ') || h.channel}</span>
                            <span className="stg-hnote">{h.note}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {!!read.vibeWords?.length && (
                    <div className="stg-fill" style={{ '--fo': '540ms' }}>
                      <span className="stg-ml">Taste anchors</span>
                      <div className="stg-chiprow" style={{ marginTop: 7 }}>
                        {read.vibeWords.map((w, i) => (
                          <span key={w} className="stg-chip vibe stg-fill" style={{ '--fo': `${560 + i * 30}ms` }}>{w}</span>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* ---- data sources — where the board's evidence came from ---- */}
                  <div className="stg-fill" style={{ '--fo': '650ms' }}>
                    <span className="stg-ml">Data sources</span>
                    <div className="stg-srcs" style={{ marginTop: 7 }}>
                      {!!ev.qlooMode && ev.qlooMode !== 'none' && (
                        <span className="stg-src-item"><Icon name="qloo" size={11} />{ev.qlooMode === 'live' ? 'Qloo taste graph · live' : `Qloo · ${ev.qlooMode}`}</span>
                      )}
                      <span className="stg-src-item"><Icon name="sparkle" size={11} />{ev.source === 'tensor' ? 'Marque strategy model' : 'rule-based strategy model'}</span>
                      {!!(sub?.url || res?.sub?.url) && (
                        <span className="stg-src-item"><Icon name="globe" size={11} />{res?.urlContext?.scrapeFailed ? 'site unreachable' : 'site scrape'} · {host(sub?.url || res?.sub?.url)}</span>
                      )}
                      <span className="stg-src-item"><Icon name="film" size={11} />reference pulls on demand</span>
                    </div>
                  </div>
                </section>
                )}

                {/* ---- strategy cards — the board's main area ---- */}
                <section className="card stg-tile stg-picks" style={{ '--i': 1 }}>
                  <div className="stg-tile-head">
                    <span className="stg-ml">Strategies{strats.length ? ` · ${strats.length}` : ''}</span>
                    <span className="stg-empty-note">{busy ? 'model is drafting picks…' : 'pick a card for the full breakdown'}</span>
                  </div>
                  {!strats.length ? (
                    busy ? <PicksSkeleton />
                      : <div className="stg-empty-note">The agent didn't return any strategies — try a more specific prompt.</div>
                  ) : (
                    <div className="stg-pick-grid">
                      {strats.map((s, i) => {
                        // "why this play" — grounded in the ask + the taste graph:
                        // product phrase (text before →), audience lean, top entity pulls
                        const prodLabel = cleanAsk(sub?.prompt || res?.sub?.prompt);
                        const ents = (s.qlooSignals || [])
                          .map((q) => q?.entity || q).filter(Boolean).slice(0, 2);
                        const pull = [s.heroSignal, ...ents].filter(Boolean).filter((v, j, a) => a.indexOf(v) === j).slice(0, 2);
                        return (
                        <Link key={s.id || i} className="stg-pick"
                          style={{ '--i': i }} to={`/strategy/${i}`} title={s.title}>
                          <span className="stg-pick-top stg-fill" style={{ '--fo': '30ms' }}>
                            <span className="stg-idx">STRATEGY {String(i + 1).padStart(2, '0')}</span>
                            <Ring value={s.audienceFit?.score} label="fit" small />
                          </span>
                          <Typed as="b" className="stg-pick-title stg-fill" style={{ '--fo': '120ms' }} text={s.title} delay={140} cps={40} />
                          {!!s.angle && (
                            <span className="stg-pick-angle stg-fill" style={{ '--fo': '150ms' }}>{s.angle}</span>
                          )}
                          <span className="stg-pick-why stg-fill" style={{ '--fo': '170ms' }}>
                            <span className="stg-pick-why-lbl">Qloo pull</span>
                            {pull.length ? pull.join(' · ') : '—'}
                            {' → '}
                            {lean.label || 'audience'}
                            {' · runs on '}
                            {(s.channels || []).slice(0, 2).map((c) => chanLabel(c.name)).join(' + ') || 'mixed'}
                          </span>
                          {!!s.brief?.audience && (
                            <span className="stg-pick-aud stg-fill" style={{ '--fo': '195ms' }}>
                              <Icon name="eye" size={10} />{s.brief.audience}
                            </span>
                          )}
                          {!!(s.qlooSignals || []).length && (
                            <span className="stg-pick-ents stg-fill" style={{ '--fo': '215ms' }}>
                              {(s.qlooSignals || []).slice(0, 3).map((q, qi) => {
                                const ent = q?.entity || q;
                                const aff = q?.affinity;
                                return (
                                  <span key={qi} className="stg-ent" title={typeof aff === 'number' ? `${ent} — Qloo taste-graph correlation ${aff.toFixed(2)} (0–1, higher = stronger pull)` : 'Qloo signal'}>
                                    <Icon name="qloo" size={9} />{ent}{typeof aff === 'number' && <i>{aff.toFixed(2)}</i>}
                                  </span>
                                );
                              })}
                            </span>
                          )}
                          {!!(s.channels || []).length && (
                            <span className="stg-pick-chips stg-fill" style={{ '--fo': '210ms' }}>
                              {[...(s.channels || [])].sort((a, b) => (+b.fit || 0) - (+a.fit || 0)).slice(0, 4).map((c) => (
                                <span className="stg-chip stg-pick-chip" key={c.name} title={CHAN_GLOSS[c.name] || c.name}>
                                  <Icon name={chanIcon(c.name)} size={10} />{chanLabel(c.name)}
                                </span>
                              ))}
                            </span>
                          )}
                          {!!(s.formats || []).length && (
                            <span className="stg-pick-fmts stg-fill" style={{ '--fo': '225ms' }}>
                              <Icon name="film" size={10} />Delivers: {(s.formats || []).slice(0, 3).join(' · ')}
                            </span>
                          )}
                          <span className="stg-pick-foot stg-fill" style={{ '--fo': '300ms' }}>
                            {!!s.reach && (
                              <span className="stg-reach" title={s.reach.basis || 'estimated reach'}>
                                <Icon name="eye" size={11} />{fmtViews(s.reach.estViews)} est. views
                              </span>
                            )}
                            <span className="stg-pick-go">open →</span>
                          </span>
                        </Link>
                        );
                      })}
                    </div>
                  )}

                  {/* ---- ruled out — always-visible quiet rows under the pick grid ---- */}
                  {!!anti.length && (
                    <div className="stg-ruled-out">
                      <span className="stg-ml stg-ruled-lbl">What we ruled out</span>
                      <div className="stg-ruled-rows">
                        {anti.map((r, i) => (
                          <div className="stg-rej stg-fill" key={`${r.title}-${i}`} style={{ '--fo': `${300 + i * 50}ms` }}>
                            <Icon name="x" size={10} />
                            <b>{r.title}</b>
                            {!!r.channel && !String(r.title || '').toLowerCase().includes(String(r.channel).toLowerCase())
                              && <span className="stg-rej-chan">{chanLabel(r.channel)}</span>}
                            <span className="stg-rej-why">{r.why}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </section>
              </div>

              {/* provenance lives inside the audience tile + evidence drawer */}
            </>
          )}

          {/* ---- /strategy/:idx — full-page strategy detail. The slim card can't
                fill this in: skeleton + ghost drafting until boardStrategy lands ---- */}
          {res && !busy && isDetail && cur && (
            <div className="stg-detailpage">
              <Link className="btn ghost sm stg-back" to="/strategy">← all strategies</Link>
              {detState?.status === 'error' ? (
                <div className="card stg-err">
                  <span className="lead"><Icon name="x" size={16} /> Couldn't load this strategy</span>
                  <span className="muted small">{detState.err}</span>
                  <button className="btn ghost sm" onClick={() => fetchDetail(detKey, true)}>
                    <Icon name="refresh" size={14} /> Retry
                  </button>
                </div>
              ) : !full ? <DetailSkeleton /> : (
              <section className="card stg-tile stg-detail" key={full.id || sel}>
                <div className="stg-detail-top">
                  <div className="stg-strat-id">
                    <span className="stg-idx">STRATEGY {String(sel + 1).padStart(2, '0')} · CAMPAIGN BOARD</span>
                    <Typed as="h3" className="display" text={full.title || ''} cps={40} />
                    {!!full.angle && <p className="stg-angle"><Typed text={full.angle} delay={220} cps={70} /></p>}
                    {!!full.audienceFit?.notes?.length && (
                      <div className="stg-fitnotes"><Typed text={full.audienceFit.notes.join(' · ')} delay={380} cps={80} /></div>
                    )}
                    {!!full.reach && (
                      <div style={{ marginTop: 9 }}>
                        <span className="stg-reach" title={full.reach.basis || 'estimated reach'}>
                          <Icon name="eye" size={11} />{fmtViews(full.reach.estViews)} est. views
                        </span>
                      </div>
                    )}
                  </div>
                  <Ring value={full.audienceFit?.score} label="audience fit" />
                </div>

                <div className="stg-detail-cols">
                  <div className="stg-detail-left">
                    {!!full.brief && (
                      <div className="stg-brief">
                        <span className="stg-ml">Brief summary</span>
                        {!!full.brief.audience && (
                          <div className="stg-brief-row"><b>Audience</b><Typed text={full.brief.audience} delay={300} cps={80} /></div>
                        )}
                        {!!full.brief.keyMessage && (
                          <div className="stg-brief-row"><b>Key message</b><Typed text={full.brief.keyMessage} delay={420} cps={80} /></div>
                        )}
                        {!!full.brief.angle && (
                          <div className="stg-brief-row"><b>Angle</b><Typed text={full.brief.angle} delay={540} cps={80} /></div>
                        )}
                      </div>
                    )}

                    {!!full.formats?.length && (
                      <div>
                        <span className="stg-ml">Formats</span>
                        <div className="stg-chiprow" style={{ marginTop: 7 }}>
                          {full.formats.map((f) => <span key={f} className="stg-chip">{f}</span>)}
                        </div>
                      </div>
                    )}

                    {(!!full.heroSignal || !!full.qlooSignals?.length) && (
                      <div>
                        <span className="stg-ml">Grounded in</span>
                        <div className="stg-chiprow" style={{ marginTop: 7, alignItems: 'center' }}>
                          {!!full.heroSignal && (() => {
                            const ha = (full.qlooSignals || []).find((q) => q.entity === full.heroSignal)?.affinity;
                            return (
                              <span className="stg-hero-sig"
                                title={`${full.heroSignal} — hero signal${typeof ha === 'number' ? ` · Qloo taste-graph correlation ${ha.toFixed(2)}` : ''}`}>
                                <Icon name="qloo" />{full.heroSignal}{typeof ha === 'number' && <i>{ha.toFixed(2)}</i>}
                              </span>
                            );
                          })()}
                          <SignalChips signals={(full.qlooSignals || []).filter((q) => q.entity !== full.heroSignal)} max={5} />
                        </div>
                      </div>
                    )}

                    {!!full.watchouts?.length && (
                      <div className="stg-watch">
                        <span className="stg-ml rose">Watchouts</span>
                        <ul>{full.watchouts.map((w, i) => (
                          <li key={i}><Typed text={w} delay={700 + i * 160} cps={90} /></li>
                        ))}</ul>
                      </div>
                    )}
                  </div>

                  <div className="stg-detail-right">
                    <div>
                      <span className="stg-ml">Channel fit</span>
                      <div className="stg-fits" style={{ marginTop: 9 }}>
                        {chans.length ? chans.map((c, i) => (
                          <details key={c.name} className="stg-fit" open={i === 0}>
                            <summary className="stg-fit-sum">
                              <span className="stg-chan-ic"><Icon name={chanIcon(c.name)} /></span>
                              <span className="stg-chan-name">{chanLabel(c.name)}</span>
                              <span className="stg-bar">
                                <i className={i === 0 ? 'hot' : ''}
                                  style={{ width: `${pct(c.fit)}%`, '--d': `${0.15 + i * 0.09}s` }} />
                              </span>
                              <span className="stg-chan-val">{pct(c.fit)}</span>
                              <span className="stg-fit-caret">▾</span>
                            </summary>
                            <div className="stg-fit-body">
                              <span className="stg-ml">Your audience likes</span>
                              <ul className="stg-fit-likes">
                                {fitLikes(c).map((b, j) => b.ent ? (
                                  <li key={j} className="stg-like">
                                    <b>{b.ent.name}</b>
                                    {!!b.ent.type && <span className="stg-like-type">{b.ent.type}</span>}
                                    {typeof b.ent.affinity === 'number' && (
                                      <span className="stg-like-aff">{b.ent.affinity.toFixed(2)}</span>
                                    )}
                                  </li>
                                ) : <li key={j}>{b.text}</li>)}
                              </ul>
                            </div>
                          </details>
                        )) : <div className="stg-empty-note">No channel mix attached.</div>}
                      </div>
                    </div>
                  </div>
                </div>

                {/* ---- Qloo read — the actual taste-graph evidence under this
                      strategy. Entity rows grouped by type, affinities visible,
                      provenance in plain sight — no accordions. ---- */}
                {(!!entGroups.length || !!detEv.qlooEvidence?.length) && (
                  <div className="stg-qread">
                    <div className="stg-tile-head">
                      <span className="stg-ml">Qloo read — the taste data under this call</span>
                      <span className="stg-prov" title="Where this evidence came from">
                        <Icon name="qloo" size={10} />
                        <span>
                          Qloo {detEv.qlooMode || 'none'} · {detCalls.length} call{detCalls.length === 1 ? '' : 's'}
                          {!!detSources.length && ` · sources: ${detSources.join(' ')}`}
                        </span>
                      </span>
                    </div>

                    {!!entGroups.length && (
                      <div className="stg-qgroups">
                        {entGroups.map((g) => (
                          <div className="stg-qgroup" key={g.type}>
                            <span className="stg-qtype">qloo affinity · {g.type}</span>
                            {g.rows.map((r) => (
                              <span className="stg-qrow" key={r.name}>
                                <span className="stg-qname">{r.name}</span>
                                <span className="stg-qbar"><i style={{ width: `${pct(r.affinity)}%` }} /></span>
                                <span className="stg-qaff">{r.affinity.toFixed(2)}</span>
                              </span>
                            ))}
                          </div>
                        ))}
                      </div>
                    )}

                    {!!detEv.qlooEvidence?.length && (
                      <div className="stg-qev">
                        {detEv.qlooEvidence.map((row, i) => (
                          <div className="stg-qev-row" key={i}>
                            <span className="stg-qev-lbl">{row.label}</span>
                            <span className="stg-qev-detail">{row.detail}</span>
                          </div>
                        ))}
                      </div>
                    )}

                    {(!!qTop.length || !!qChans.length) && (
                      <p className="stg-qwhy">
                        <Typed cps={70} delay={550} text={
                          `Why this fits: ${prodName}'s audience over-indexes on ` +
                          qTop.map((r) => `${r.name}${typeof r.affinity === 'number' ? ` (${r.affinity.toFixed(2)})` : ''}`).join(', ').replace(/, ([^,]+)$/, ' and $1') +
                          (qChans.length ? ` — so this play favors ${qChans.join(' + ')}, the channels where that pull already lives.` : '.')
                        } />
                      </p>
                    )}
                  </div>
                )}

                {/* ---- notes → handoff ---- */}
                <div className="stg-handoff">
                  <textarea
                    className="stg-notes"
                    rows={3}
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="Add notes for the campaign — tone, must-haves, things to avoid…"
                  />
                  <div className="stg-strat-foot">
                    <span className="hint">Hands its brief to the Campaigns composer</span>
                    <button className="btn lime" onClick={() => useStrategy(full)}>
                      Use this strategy <Icon name="send" size={15} />
                    </button>
                  </div>
                </div>

                {/* ---- in the wild: manual, steerable pull of real examples;
                        click cards to select references that ride into the
                        campaign handoff ---- */}
                <div className="stg-wild">
                  <div className="stg-wild-head">
                    <span className="stg-ml">{!wildList.length ? 'In the wild — reference pulls'
                      : 'In the wild — pulled from the open web'}</span>
                    <span className="stg-wild-tools">
                      {wildList.length > 2 && (
                        <span className="stg-wild-nav">
                          <button type="button" className="stg-wild-arrow" onClick={() => scrollWild(-1)} aria-label="scroll back">‹</button>
                          <button type="button" className="stg-wild-arrow" onClick={() => scrollWild(1)} aria-label="scroll forward">›</button>
                        </span>
                      )}
                      {exState?.status === 'done' && !!wildList.length && (
                        <span className="stg-wild-hint">
                          select references to feed the campaign
                          {!!selExamples.length && <b className="stg-wild-n">{selExamples.length} selected</b>}
                        </span>
                      )}
                      {exState?.status === 'done' && !!(exState.data?.hunts || []).length && (
                        <span className="stg-wild-hunts">
                          hunts: {exState.data.hunts.map((h, i) => (
                            <span key={i} className={h.failed ? 'stg-hunt stg-hunt-fail' : 'stg-hunt'}
                              title={h.failed ? `${h.query} — pull failed, no real artifact found` : h.query}>
                              {h.failed && <Icon name="x" size={9} />}{chanLabel(h.platform)}
                            </span>
                          ))}
                        </span>
                      )}
                    </span>
                  </div>

                  {/* steer + trigger — nothing pulls until the button is hit */}
                  <div className="stg-pull">
                    <input
                      className="stg-pull-hint"
                      value={wildHint}
                      placeholder="steer the pull — e.g. documentary-style instagram reels"
                      disabled={exState?.status === 'loading'}
                      onChange={(e) => setWildHint(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && exState?.status !== 'loading') loadExamples(full, wildHint);
                      }}
                    />
                    <button className="btn ghost sm stg-pull-btn"
                      disabled={exState?.status === 'loading'}
                      onClick={() => loadExamples(full, wildHint)}>
                      <Icon name="refresh" size={13} />
                      {exState?.status === 'loading' ? 'Pulling…' : exState?.status === 'done' ? 'Re-pull' : 'Pull references'}
                    </button>
                  </div>

                  {!exState && (
                    <div className="stg-empty-note">
                      Nothing pulled yet — hit Pull references to hunt YouTube, TikTok, Commons &amp; catalog sources for this tactic.
                    </div>
                  )}

                  {/* skeleton cards while the scrape runs — animated pull cue */}
                  {exState?.status === 'loading' && (
                    <>
                      <div className="stg-pull-status">
                        <span className="stg-pull-dot" />
                        hunting {['youtube', 'tiktok', 'instagram', 'catalog'][pullPhase % 4]}…
                      </div>
                      <div className="stg-wild-grid" ref={wildGridRef}>
                        {[0, 1, 2, 3].map((i) => (
                          <div className="stg-wx skel pull" key={i} style={{ '--i': i }}>
                            <i className="m" /><i className="t" /><i className="t s" />
                            <span className="stg-wx-scan" />
                          </div>
                        ))}
                      </div>
                    </>
                  )}

                  {exState?.status === 'error' && (
                    <div className="stg-wild-err">
                      <span><Icon name="x" size={14} /> Couldn't pull live examples — {exState.err}</span>
                      <button className="btn ghost sm" onClick={() => loadExamples(full, wildHint, true)}>
                        <Icon name="refresh" size={13} /> Retry
                      </button>
                    </div>
                  )}

                  {exState?.status === 'done' && (
                    wildList.length ? (
                      <div className="stg-wild-grid" ref={wildGridRef}>
                        {wildList.map((e, i) => (
                          <WildCard key={exKey(e) || i} e={e} i={i}
                            sel={curSel.has(exKey(e))} onToggle={() => toggleWild(e)} />
                        ))}
                      </div>
                    ) : (
                      <div className="stg-empty-note">No examples surfaced for this strategy — try re-pulling{exState.hint ? ' with a different steer' : ''}.</div>
                    )
                  )}
                </div>
              </section>
              )}

              {/* provenance lives inside the audience read + evidence drawer */}
            </div>
          )}
        </>
      )}
    </div>
  );
}
