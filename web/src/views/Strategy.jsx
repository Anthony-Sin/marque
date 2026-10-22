import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link, Navigate, useLocation, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api.js';
import { useApp } from '../App.jsx';
import Icon from '../components/Icon.jsx';
import Wayfind from '../components/Wayfind.jsx';
import { SignalChips } from '../components/Qloo.jsx';
import './strategy.css';

// typed out one line at a time while /api/strategy runs — the scan coverage is real:
// the server scores fit across every channel below from the taste bundle.
const TYPE_LINES = [
  'Reading your taste graph…',
  'Scanning Instagram · TikTok · YouTube · TV · Streaming · Podcasts · OOH · Press · Email…',
  'Scoring channel fit against your audience…',
  'Drafting strategies…',
];

// the textarea opens with this default — editable; chips below swap in alternates.
const DEFAULT_PROMPT = 'Help me build a campaign for this product to market to adults';

// audience/task-shaped alternates — click to fill the prompt. A chip may also set
// the site-URL field (url) so the scrape context comes along with the prompt.
const PROMPT_IDEAS = [
  { label: '…to kids', text: 'Help me build a campaign for this product to market to kids' },
  { label: '…to Gen Z', text: 'Help me build a campaign for this product to market to Gen Z' },
  { label: 'Position this brand against bigger competitors', text: 'Position this brand against bigger competitors' },
  { label: 'Find the best channels to reach my audience', text: 'Find the best channels to reach my audience' },
  { label: 'Analyze allbirds.com', text: 'Analyze allbirds.com — suggest campaign strategies for this store', url: 'https://allbirds.com' },
];

const ALL_CHANNELS = ['instagram', 'tiktok', 'youtube', 'tv', 'streaming', 'podcast', 'ooh', 'guerrilla', 'email', 'press'];
const PULL_SOURCES = ['YouTube', 'TikTok', 'iTunes', 'Wikipedia', 'Wikimedia Commons'];
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

// LLM-style staged progress — each status line types out character-by-character,
// then the next one starts. Previous lines stay, checked. No spinner.
// slim → a compact bar pinned above the board skeleton (the cards are already
// there; the status types underneath the composer, alongside them).
function Typer({ lines = TYPE_LINES, slim = false }) {
  const [li, setLi] = useState(0);
  const [cc, setCc] = useState(0);
  useEffect(() => {
    if (REDUCED) { setLi(lines.length - 1); setCc(9999); return undefined; }
    const line = lines[li] || '';
    if (cc < line.length) {
      const ch = line[cc];
      const d = ch === ' ' ? 12 : 15 + Math.random() * 34; // uneven cadence — feels written
      const t = setTimeout(() => setCc((c) => c + 1), d);
      return () => clearTimeout(t);
    }
    if (li < lines.length - 1) {
      const t = setTimeout(() => { setLi((l) => l + 1); setCc(0); }, 420);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [li, cc, lines]);

  return (
    <div className={`card stg-typer${slim ? ' slim' : ''}`} aria-live="polite">
      <div className="stg-typer-head">
        <span className="stg-typer-dot" />
        Marque is working
      </div>
      <div className="stg-typer-lines">
        {lines.slice(0, li).map((l) => (
          <div className="stg-tw done" key={l}>
            <Icon name="check" size={12} sw={2.4} /><span>{l}</span>
          </div>
        ))}
        <div className="stg-tw now">
          <span>{(lines[li] || '').slice(0, cc)}</span>
          <span className="stg-tw-caret" />
        </div>
      </div>
      {!slim && <div className="stg-shimmer"><i /></div>}
    </div>
  );
}

// board-shaped skeleton shown the moment generation starts — same 12-col bento
// as the real board, so the staggered .stg-fill reveals land in place of it.
function BoardSkeleton() {
  const bar = (w, h, cls = '') => (
    <span className={`stg-shimmer sk ${cls}`.trim()} style={{ '--w': w, '--h': h }}><i /></span>
  );
  return (
    <div className="stg-board stg-board-skel" aria-hidden="true">
      {/* audience-read tile skeleton */}
      <section className="card stg-tile stg-aud skel-tile">
        <div className="stg-tile-head">{bar('112px', '10px')}</div>
        <div className="stg-aud-main">
          <div className="stg-aud-left stg-skel-col">
            {bar('62%', '24px')}
            {bar('38%', '10px')}
            <div style={{ height: 8 }} />
            {bar('88%', '11px')}
            {bar('72%', '11px')}
            {bar('55%', '11px')}
          </div>
          {bar('104px', '104px', 'circle')}
        </div>
        <div className="stg-skel-chips">
          {bar('74px', '24px', 'pill')}
          {bar('92px', '24px', 'pill')}
          {bar('64px', '24px', 'pill')}
          {bar('80px', '24px', 'pill')}
        </div>
        {bar('100%', '10px')}
        {bar('76%', '10px')}
      </section>

      {/* strategy picks — 3 skeleton cards in the real pick grid */}
      <section className="card stg-tile stg-picks skel-tile">
        <div className="stg-tile-head">{bar('140px', '10px')}</div>
        <div className="stg-pick-grid">
          {[0, 1, 2].map((i) => (
            <div className="stg-pick stg-pick-skel" key={i} style={{ '--i': i }}>
              <span className="stg-pick-top">
                {bar('92px', '9px')}
                {bar('46px', '46px', 'circle')}
              </span>
              {bar('94%', '15px')}
              {bar('58%', '15px')}
              {bar('82%', '10px')}
              <span className="stg-pick-foot">
                {bar('86px', '17px', 'pill')}
                {bar('42px', '9px')}
              </span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

// rotating "pulling examples from X…" line while /api/strategy/examples scrapes (30-90s)
function PullStatus() {
  const [i, setI] = useState(0);
  useEffect(() => {
    if (REDUCED) return undefined;
    const t = setInterval(() => setI((n) => (n + 1) % PULL_SOURCES.length), 1700);
    return () => clearInterval(t);
  }, []);
  return (
    <span>
      pulling examples from <b className="stg-pull-src" key={i}>{PULL_SOURCES[i]}</b> — live scrape, can take a couple of minutes…
    </span>
  );
}

const SRC_LABEL = { scraped: 'scraped', 'catalog-art': 'catalog art', 'concept-art': 'concept art' };

// one "in the wild" example card. Embed-capable items (YouTube/TikTok player URLs)
// open an inline collapsible player; everything else links out in a NEW TAB.
function WildCard({ e, i }) {
  const [open, setOpen] = useState(false);
  const tt = /tiktok/i.test(e.embed || '');
  const media = e.embed && open ? (
    <span className={`stg-wx-media${tt ? ' tt' : ''}`}>
      <iframe src={e.embed} title={e.title || 'example'} loading="lazy"
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; picture-in-picture; web-share"
        referrerPolicy="strict-origin-when-cross-origin" allowFullScreen />
    </span>
  ) : e.image ? (
    <span className="stg-wx-media"><img src={e.image} alt="" loading="lazy" /></span>
  ) : null;

  const body = (
    <span className="stg-wx-body">
      <span className="stg-wx-plat">
        <Icon name={chanIcon(e.platform)} size={12} />{e.platform || 'web'}
        <span className={`stg-src ${e.source || 'scraped'}`}>{SRC_LABEL[e.source] || e.source || 'scraped'}</span>
      </span>
      <span className="stg-wx-title">{e.title}</span>
      {!!e.match && <span className="stg-wx-match">{e.match}</span>}
      {!!e.author && <span className="stg-wx-author">{e.author}</span>}
      {!!e.note && <span className="stg-wx-note">“{e.note}”</span>}
      <span className="stg-wx-acts">
        {(!!e.embed || !!e.image) && (
          <button type="button" className="stg-wx-play"
            onClick={(ev) => { ev.preventDefault(); ev.stopPropagation(); setOpen((o) => !o); }}>
            <Icon name={open ? 'x' : 'play'} size={10} /> {open ? 'close' : e.embed ? 'play inline' : 'view'}
          </button>
        )}
      </span>
    </span>
  );

  // never navigate out — embeds play in the fold, images expand in place
  return (
    <div className={`stg-wx${open ? ' open' : ''}`} style={{ '--i': i }}
      onClick={() => { if (!e.embed && e.image) setOpen((o) => !o); }} role={!e.embed && e.image ? 'button' : undefined}>
      {media}{body}
      {open && !e.embed && e.image && (
        <span className="stg-wx-big"><img src={e.image} alt={e.title || ''} /></span>
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
  const [productId, setProductId] = useState('');
  const [busy, setBusy] = useState(false);
  const [resL, setResL] = useState(undefined); // local override; undefined → follow ctx board
  const [err, setErr] = useState('');
  const [notes, setNotes] = useState('');      // "add notes for the campaign"
  const [ex, setEx] = useState({});            // strategyId -> {status, data, err}
  const [sub, setSub] = useState(null);        // submitted {prompt, productId, url}
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
    try {
      const out = await api.strategy(p, productId || undefined, url || undefined);
      setRes(out);
      const s = { prompt: p, productId, url };
      setSub(s);
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

  // lazy pull of real-world examples for a strategy — cached per strategy id
  const loadExamples = async (s, force = false) => {
    if (!s) return;
    const id = s.id || s.title;
    const cur2 = ex[id];
    if (!force && cur2 && cur2.status !== 'error') return;
    setEx((m) => ({ ...m, [id]: { status: 'loading' } }));
    try {
      const data = await api.strategyExamples(s, res?.audienceRead);
      setEx((m) => ({ ...m, [id]: { status: 'done', data } }));
    } catch (e) {
      setEx((m) => ({ ...m, [id]: { status: 'error', err: e.message || 'pull failed' } }));
    }
  };

  // hand the strategy to Campaigns: stash the handoff, then open /campaigns
  const useStrategy = (s) => {
    try {
      sessionStorage.setItem('strategyHandoff', JSON.stringify({
        strategy: s,
        strategyId: s.id || '',
        strategyTitle: s.title || '',
        notes,
        prompt: sub?.prompt || '',
        productId: sub?.productId || productId || '',
      }));
    } catch { /* storage unavailable — Campaigns just won't prefill */ }
    say?.(`"${s.title}" handed to Campaigns`);
    nav('/campaigns');
  };

  const read = res?.audienceRead || {};
  const lean = read.lean || {};
  const strats = res?.strategies || [];
  const cur = sel !== null && sel >= 0 && sel < strats.length ? strats[sel] : null;
  const chans = cur ? [...(cur.channels || [])].sort((a, b) => (+b.fit || 0) - (+a.fit || 0)) : [];
  const exState = cur ? ex[cur.id || cur.title] : null;
  const calls = res?.evidence?.calls || [];

  // lazy-pull examples whenever a strategy detail page is open
  useEffect(() => {
    if (res && !busy && cur) loadExamples(cur);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [res, busy, sel]);

  // fresh card → fresh notes
  useEffect(() => { setNotes(''); }, [sel]);

  // "wouldn't work" bullets for a channel-fit row: media-habit note + cited affinities
  const fitBullets = (c) => {
    const bits = String(c.why || '').split(/\s*[,;]\s*/).filter(Boolean);
    const habit = (read.mediaHabits || []).find((m) => m.channel === c.name)?.note;
    const out = habit && !bits.includes(habit) ? [habit, ...bits] : bits;
    return out.length ? out : [`matches the ${lean.label || 'audience'} read`];
  };

  // "What we ruled out" — the board's antiStrategies, else derive from fit priors
  const anti = useMemo(() => {
    if (!res) return [];
    if (Array.isArray(res.antiStrategies) && res.antiStrategies.length) {
      return res.antiStrategies.slice(0, 6).map((a) => ({
        title: a.title || a.channel || 'tactic', channel: a.channel, why: a.whyNot || a.why || '',
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
  }, [res, strats, lean.label]);

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
          {/* ---- collapsed prompt pill — click to re-open the composer ---- */}
          {(busy || res) && (
            <div className="stg-chipbar" role="button" tabIndex={0} title="Edit this prompt"
              onClick={reset} onKeyDown={(e) => { if (e.key === 'Enter') reset(); }}>
              <span className="stg-chipbar-ic"><Icon name="sparkle" size={14} /></span>
              <span className="stg-chipbar-prompt" title={sub?.prompt || sub?.url}>
                {sub?.prompt || sub?.url || 'strategy board'}
              </span>
              {!!subProduct && <span className="stg-tag"><Icon name="bag" size={11} />{subProduct.name}</span>}
              {!!subHost && <span className="stg-tag"><Icon name="globe" size={11} />{subHost}</span>}
              <button className="btn ghost sm stg-chipbar-new" disabled={busy}
                onClick={(e) => { e.stopPropagation(); if (!busy) reset(); }}>
                <Icon name="edit" size={13} /> New prompt
              </button>
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
                    onBlur={commitRename}
                  />
                ) : (
                  <span className="stg-plans-title display">
                    {res.title || 'Strategy board'}
                    {!!res.id && (
                      <button type="button" className="stg-plan-edit" title="Rename plan"
                        onClick={() => { setRenameVal(res.title || ''); setRenaming(true); }}>
                        <Icon name="edit" size={12} />
                      </button>
                    )}
                  </span>
                )}
              </span>
              {/* this board shows only its own plan — other plans live on the
                  dashboard, so there's no cross-contamination between boards */}
              <button type="button" className="btn ghost sm stg-plan-new" onClick={reset}>
                <Icon name="plus" size={11} /> New plan
              </button>
            </div>
          )}

          {/* ---- heading + composer — slide up + fade once submitted ---- */}
          <div className={`stg-compose${busy || res ? ' shut' : ''}`} aria-hidden={!!(busy || res)}>
            <div className="stg-compose-in">
              {pageHead}
              <div className="card stg-ask">
                <textarea
                  value={prompt}
                  placeholder="What are you trying to make happen? e.g. launch our spring drop to people who already love what we do"
                  onChange={(e) => setPrompt(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) generate(); }}
                />
                <div className="stg-ask-foot">
                  {!!(profile?.catalog || []).length && (
                    <select className="stg-prod" value={productId} onChange={(e) => setProductId(e.target.value)}
                      title="Optional — anchor strategies to a catalog product">
                      <option value="">No specific product</option>
                      {profile.catalog.map((p) => <option key={p.id} value={p.id}>For: {p.name}</option>)}
                    </select>
                  )}
                  <span className={`stg-urlwrap${siteUrl.trim() ? ' has' : ''}`} title="Optional — we'll scrape this as product/site context">
                    <Icon name="link" size={13} />
                    <input className="stg-url" value={siteUrl} placeholder="or paste a product/store URL"
                      onChange={(e) => setSiteUrl(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') generate(); }} />
                  </span>
                  {!!inlineUrl && !siteUrl.trim() && (
                    <span className="stg-tag" title="Detected in your prompt — will be scraped as context">
                      <Icon name="globe" size={11} />{host(inlineUrl)}
                    </span>
                  )}
                  <span className="grow" />
                  <button className="btn lime" disabled={!canGo} onClick={() => generate()}>
                    <Icon name="sparkle" /> Generate strategies
                  </button>
                </div>
                <div className="stg-hint">prompt, or paste a product/website URL — we'll scrape it for context</div>
              </div>

              {!err && (
                <div className="stg-examples">
                  {PROMPT_IDEAS.map((idea) => (
                    <button key={idea.text} className="stg-ex" title={idea.url ? `${idea.text} · ${idea.url}` : idea.text}
                      onClick={() => { setPrompt(idea.text); if (idea.url) setSiteUrl(idea.url); }}>{idea.label}</button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* while the board generates: board-shaped skeleton cards fill in
              real-time — no separate status bar */}
          {busy && <BoardSkeleton />}

          {err && !busy && (
            <div className="card stg-err">
              <span className="lead"><Icon name="x" size={16} /> Couldn't build strategies</span>
              <span className="muted small">{err}</span>
              <button className="btn ghost sm" onClick={() => generate()}>
                <Icon name="refresh" size={14} /> Retry
              </button>
            </div>
          )}

          {res && !busy && !isDetail && (
            <>
              <div className="stg-board">
                {/* ---- audience read ---- */}
                <section className="card stg-tile stg-aud" style={{ '--i': 0 }}>
                  <div className="stg-tile-head">
                    <span className="stg-ml">Audience read</span>
                  </div>
                  <div className="stg-aud-main">
                    <div className="stg-aud-left">
                      <div className="stg-lean display">{lean.label || 'Unclear'}</div>
                      <div className="stg-heur">heuristic read — not a fact</div>
                      {!!lean.signals?.length && (
                        <ul className="stg-sigs">
                          {lean.signals.map((s, i) => <li key={i}>{s}</li>)}
                        </ul>
                      )}
                    </div>
                    <Ring value={lean.confidence} label="conf" />
                  </div>
                  {!!read.mediaHabits?.length && (
                    <div>
                      <span className="stg-ml">Media habits</span>
                      <div className="stg-habits" style={{ marginTop: 8 }}>
                        {read.mediaHabits.map((h, i) => (
                          <div className="stg-habit" key={i}>
                            <span className="stg-hchip"><Icon name={chanIcon(h.channel)} />{h.channel}</span>
                            <span className="stg-hnote">{h.note}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {!!read.vibeWords?.length && (
                    <div>
                      <span className="stg-ml">Vibe</span>
                      <div className="stg-chiprow" style={{ marginTop: 7 }}>
                        {read.vibeWords.map((w) => <span key={w} className="stg-chip vibe">{w}</span>)}
                      </div>
                    </div>
                  )}

                  {/* ---- ruled out — collapsed accordion inside the audience card ---- */}
                  {!!anti.length && (
                    <details className="stg-ruled">
                      <summary className="stg-ruled-sum">
                        <span className="stg-ml rose">What we ruled out, and why</span>
                        <span className="stg-ruled-meta">
                          {anti.length} <span className="stg-fit-caret">▾</span>
                        </span>
                      </summary>
                      <div className="stg-nope-list">
                        {anti.map((r, i) => (
                          <div className="stg-rej" key={`${r.title}-${i}`}>
                            <span className="stg-rej-x"><Icon name="x" /></span>
                            <div>
                              <b>{r.title}</b>
                              {!!r.channel && <span className="stg-rej-chan">{r.channel}</span>}
                              <span className="stg-rej-why">{r.why}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </details>
                  )}

                  {/* ---- data sources — where the board's evidence came from ---- */}
                  <div>
                    <span className="stg-ml">Data sources</span>
                    <div className="stg-srcs" style={{ marginTop: 7 }}>
                      <span className="stg-src-item"><Icon name="qloo" size={11} />Qloo taste graph</span>
                      <span className="stg-src-item"><Icon name="sparkle" size={11} />TensorMux strategy model</span>
                      {!!(sub?.url || res?.sub?.url) && (
                        <span className="stg-src-item"><Icon name="globe" size={11} />site scrape · {host(sub?.url || res?.sub?.url)}</span>
                      )}
                      <span className="stg-src-item"><Icon name="film" size={11} />public video/catalog examples</span>
                    </div>
                    {!!calls.length && (
                      <details className="stg-calls">
                        <summary className="stg-calls-sum">
                          <span className="stg-calls-lbl">
                            <Icon name="qloo" size={12} /> Qloo taste-graph calls · {calls.length}
                          </span>
                          <span className="stg-fit-caret">▾</span>
                        </summary>
                        <div className="stg-calls-list">
                          {calls.map((c, i) => (
                            <div className="stg-call-line" key={i}>
                              <b>{c.endpoint}</b>{' '}
                              {Object.entries(c.params || {}).map(([k, v]) => `${k}=${String(v).slice(0, 36)}`).join(' ')}
                              {c.n != null && <span className="n"> → {c.n} results</span>}
                              {c.mode && <span> · {c.mode}</span>}
                            </div>
                          ))}
                        </div>
                      </details>
                    )}
                  </div>
                </section>

                {/* ---- strategy cards — the board's main area ---- */}
                <section className="card stg-tile stg-picks" style={{ '--i': 1 }}>
                  <div className="stg-tile-head">
                    <span className="stg-ml">Strategies · {strats.length}</span>
                    <span className="stg-empty-note">pick a card for the full breakdown</span>
                  </div>
                  {!strats.length ? (
                    <div className="stg-empty-note">The agent didn't return any strategies — try a more specific prompt.</div>
                  ) : (
                    <div className="stg-pick-grid">
                      {strats.map((s, i) => (
                        <Link key={s.id || i} className="stg-pick"
                          style={{ '--i': i }} to={`/strategy/${i}`} title={s.title}>
                          <span className="stg-pick-top">
                            <span className="stg-idx">STRATEGY {String(i + 1).padStart(2, '0')}</span>
                            <Ring value={s.audienceFit?.score} label="fit" small />
                          </span>
                          <b className="stg-pick-title stg-fill" style={{ '--fo': '90ms' }}>{s.title}</b>
                          {!!(s.channels || []).length && (
                            <span className="stg-pick-chips stg-fill" style={{ '--fo': '170ms' }}>
                              {[...(s.channels || [])].sort((a, b) => (+b.fit || 0) - (+a.fit || 0)).slice(0, 4).map((c) => (
                                <span className="stg-chip stg-pick-chip" key={c.name}>
                                  <Icon name={chanIcon(c.name)} size={10} />{c.name}
                                </span>
                              ))}
                            </span>
                          )}
                          <span className="stg-pick-foot">
                            {!!s.reach && (
                              <span className="stg-reach" title={s.reach.basis || 'estimated reach'}>
                                <Icon name="eye" size={11} />{fmtViews(s.reach.estViews)} est. views
                              </span>
                            )}
                            <span className="stg-pick-go">open →</span>
                          </span>
                        </Link>
                      ))}
                    </div>
                  )}
                </section>
              </div>

              <div className="stg-attrib">
                Strategy generated with TensorMux · cultural signals via Qloo taste graph ·
                examples scraped from public video &amp; catalog sources
              </div>
            </>
          )}

          {/* ---- /strategy/:idx — full-page strategy detail ---- */}
          {res && !busy && isDetail && cur && (
            <div className="stg-detailpage">
              <Link className="btn ghost sm stg-back" to="/strategy">← all strategies</Link>
              <section className="card stg-tile stg-detail" key={cur.id || sel}>
                <div className="stg-detail-top">
                  <div className="stg-strat-id">
                    <span className="stg-idx">STRATEGY {String(sel + 1).padStart(2, '0')} · CAMPAIGN BOARD</span>
                    <h3 className="display">{cur.title}</h3>
                    {!!cur.angle && <p className="stg-angle">{cur.angle}</p>}
                    {!!cur.audienceFit?.notes?.length && (
                      <div className="stg-fitnotes">{cur.audienceFit.notes.join(' · ')}</div>
                    )}
                    {!!cur.reach && (
                      <div style={{ marginTop: 9 }}>
                        <span className="stg-reach" title={cur.reach.basis || 'estimated reach'}>
                          <Icon name="eye" size={11} />{fmtViews(cur.reach.estViews)} est. views
                        </span>
                      </div>
                    )}
                  </div>
                  <Ring value={cur.audienceFit?.score} label="audience fit" />
                </div>

                <div className="stg-detail-cols">
                  <div className="stg-detail-left">
                    {!!cur.brief && (
                      <div className="stg-brief">
                        <span className="stg-ml">Brief summary</span>
                        {!!cur.brief.audience && (
                          <div className="stg-brief-row"><b>Audience</b>{cur.brief.audience}</div>
                        )}
                        {!!cur.brief.keyMessage && (
                          <div className="stg-brief-row"><b>Key message</b>{cur.brief.keyMessage}</div>
                        )}
                        {!!cur.brief.angle && (
                          <div className="stg-brief-row"><b>Angle</b>{cur.brief.angle}</div>
                        )}
                      </div>
                    )}

                    {!!cur.formats?.length && (
                      <div>
                        <span className="stg-ml">Formats</span>
                        <div className="stg-chiprow" style={{ marginTop: 7 }}>
                          {cur.formats.map((f) => <span key={f} className="stg-chip">{f}</span>)}
                        </div>
                      </div>
                    )}

                    {(!!cur.heroSignal || !!cur.qlooSignals?.length) && (
                      <div>
                        <span className="stg-ml">Grounded in</span>
                        <div className="stg-chiprow" style={{ marginTop: 7, alignItems: 'center' }}>
                          {!!cur.heroSignal && (
                            <span className="stg-hero-sig" title="hero signal">
                              <Icon name="qloo" />{cur.heroSignal}
                            </span>
                          )}
                          <SignalChips signals={(cur.qlooSignals || []).filter((q) => q.entity !== cur.heroSignal)} max={5} />
                        </div>
                      </div>
                    )}

                    {!!cur.watchouts?.length && (
                      <div className="stg-watch">
                        <span className="stg-ml rose">Watchouts</span>
                        <ul>{cur.watchouts.map((w, i) => <li key={i}>{w}</li>)}</ul>
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
                              <span className="stg-chan-name">{c.name}</span>
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
                                {fitBullets(c).map((b, j) => <li key={j}>{b}</li>)}
                              </ul>
                            </div>
                          </details>
                        )) : <div className="stg-empty-note">No channel mix attached.</div>}
                      </div>
                    </div>
                  </div>
                </div>

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
                    <button className="btn lime" onClick={() => useStrategy(cur)}>
                      Use this strategy <Icon name="send" size={15} />
                    </button>
                  </div>
                </div>

                {/* ---- in the wild: real examples scraped per strategy ---- */}
                <div className="stg-wild">
                  <div className="stg-wild-head">
                    <span className="stg-ml">In the wild — pulled from the open web</span>
                    <span className="stg-wild-tools">
                      {exState?.status === 'done' && !!(exState.data?.hunts || []).length && (
                        <span className="stg-wild-hunts">
                          hunts: {[...new Set(exState.data.hunts.map((h) => h.platform))].join(' · ')}
                        </span>
                      )}
                      <button className="btn ghost sm" onClick={() => loadExamples(cur, true)}
                        disabled={exState?.status === 'loading'}>
                        <Icon name="refresh" size={13} />
                        {exState?.status === 'loading' ? 'Pulling…' : 'Re-pull'}
                      </button>
                    </span>
                  </div>

                  {(!exState || exState.status === 'loading') && (
                    <>
                      <div className="stg-wild-status">
                        <span className="spinner stg-btnspin" /><PullStatus />
                      </div>
                      <div className="stg-wild-grid">
                        {[0, 1, 2, 3].map((i) => (
                          <div className="stg-wx skel" key={i} style={{ '--i': i }}>
                            <i className="m" /><i className="t" /><i className="t s" />
                          </div>
                        ))}
                      </div>
                    </>
                  )}

                  {exState?.status === 'error' && (
                    <div className="stg-wild-err">
                      <span><Icon name="x" size={14} /> Couldn't pull live examples — {exState.err}</span>
                      <button className="btn ghost sm" onClick={() => loadExamples(cur, true)}>
                        <Icon name="refresh" size={13} /> Retry
                      </button>
                    </div>
                  )}

                  {exState?.status === 'done' && (
                    (exState.data?.examples || []).length ? (
                      <div className="stg-wild-grid">
                        {exState.data.examples.map((e, i) => <WildCard key={i} e={e} i={i} />)}
                      </div>
                    ) : (
                      <div className="stg-empty-note">No examples surfaced for this strategy — try re-pulling.</div>
                    )
                  )}
                </div>
              </section>

              <div className="stg-attrib">
                Strategy generated with TensorMux · cultural signals via Qloo taste graph ·
                examples scraped from public video &amp; catalog sources
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
