// Scout: pulls REAL example media for a chosen strategy — YouTube + TikTok
// videos via yt-dlp, TV/podcast artwork via iTunes + Wikipedia, guerrilla/OOH
// imagery via Wikimedia Commons. Honest source labels on every card.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { chatJSON } from './tensor.js';

const run = promisify(execFile);
const YTDLP = process.env.YTDLP || '/home/ANT/.gridscan/venv/bin/yt-dlp';
const UA = { 'User-Agent': 'marque/1.0 (hackathon demo; contact: local)' };

async function ytdlp(args, timeout = 40000) {
  const { stdout } = await run(YTDLP, args, { timeout, maxBuffer: 4 * 1024 * 1024 });
  return stdout.trim();
}

async function getJson(url, timeout = 12000, retries = 1) {
  let lastErr;
  for (let i = 0; i <= retries; i++) {
    try {
      const res = await fetch(url, { headers: UA, signal: AbortSignal.timeout(timeout) });
      if (!res.ok) throw new Error(`fetch ${res.status}`);
      return await res.json();
    } catch (e) { lastErr = e; if (i < retries) await new Promise((s) => setTimeout(s, 1200)); }
  }
  throw lastErr;
}

// ---- resolvers (each returns a normalized example card or null) ----

async function youtubeExample(query, note) {
  const out = await ytdlp([`ytsearch1:${query}`, '--flat-playlist', '--print', '%(id)s|%(title)s|%(channel)s']);
  const [id, title, channel] = out.split('\n')[0].split('|');
  if (!id) return null;
  return {
    platform: 'youtube', title: (title || 'YouTube video').slice(0, 140), author: channel,
    url: `https://www.youtube.com/watch?v=${id}`,
    image: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
    embed: `https://www.youtube.com/embed/${id}?rel=0`,
    note, source: 'scraped',
  };
}

async function tiktokExample(handle, note) {
  const h = handle.replace(/^@/, '');
  const out = await ytdlp([`https://www.tiktok.com/@${h}`, '--flat-playlist', '--playlist-end', '4', '--print', '%(id)s|%(title).80s']);
  const line = out.split('\n').find(Boolean);
  if (!line) return null;
  const [id, title] = line.split('|');
  const url = `https://www.tiktok.com/@${h}/video/${id}`;
  let thumb = null, author = `@${h}`;
  try {
    const oe = await getJson(`https://www.tiktok.com/oembed?url=${encodeURIComponent(url)}`);
    thumb = oe.thumbnail_url || null;
    author = oe.author_name || author;
  } catch { /* thumb optional */ }
  return {
    platform: 'tiktok', title: (title || 'TikTok video').slice(0, 140), author,
    url, image: thumb,
    embed: `https://www.tiktok.com/player/v1/${id}?embed_from=oembed`,
    note, source: 'scraped',
  };
}

async function itunesExample(query, media, platform, note) {
  const j = await getJson(`https://itunes.apple.com/search?term=${encodeURIComponent(query)}&media=${media}&limit=1`);
  const r = j.results?.[0];
  if (!r) return null;
  return {
    platform, title: r.trackName || r.collectionName || query, author: r.artistName,
    url: r.trackViewUrl || r.collectionViewUrl,
    image: (r.artworkUrl100 || '').replace('100x100', '400x400'),
    note, source: 'catalog-art',
  };
}

async function wikiExample(title, platform, note) {
  const j = await getJson(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`);
  if (!j?.title) return null;
  return {
    platform, title: j.title, author: 'wikipedia',
    url: j.content_urls?.desktop?.page,
    image: j.thumbnail?.source,
    note: note || (j.extract || '').slice(0, 160), source: 'scraped',
  };
}

async function commonsExample(query, platform, note) {
  const j = await getJson(`https://commons.wikimedia.org/w/api.php?action=query&generator=search&gsrsearch=${encodeURIComponent(query)}&gsrnamespace=6&gsrlimit=1&prop=imageinfo&iiprop=url&iiurlwidth=640&format=json`);
  const page = Object.values(j.query?.pages || {})[0];
  const info = page?.imageinfo?.[0];
  if (!info) return null;
  return {
    platform, title: (page.title || 'reference image').replace(/^File:/, ''), author: 'wikimedia commons',
    url: info.descriptionurl, image: info.thumburl,
    note, source: 'scraped',
  };
}

// run resolvers in order, first non-null wins (a throw just moves to the next)
const tryAll = async (...fns) => {
  for (const f of fns) {
    try { const r = await f(); if (r) return r; } catch { /* next fallback */ }
  }
  return null;
};
// run resolvers in parallel, keep every hit (scorer drops the junk later)
const collect = async (...fns) =>
  (await Promise.all(fns.map(async (f) => { try { return await f(); } catch { return null; } }))).filter(Boolean);

function conceptVisual(query, platform, note) {
  return {
    platform, title: `concept: ${query}`, author: 'generated reference',
    url: null, embed: null,
    image: `https://image.pollinations.ai/prompt/${encodeURIComponent(`${query}, advertising reference photo, cinematic`)}?width=640&height=400&nologo=true`,
    note, source: 'concept-art',
  };
}

const PLATFORM_VERB = {
  tiktok: 'a specific real TikTok creator handle (@name) whose content style fits this strategy',
  youtube: 'a YouTube search query (2-5 words) that surfaces a real example of this tactic',
  tv: 'the title of one real TV show this audience plausibly watches (from the signals)',
  streaming: 'the title of one real movie/show fitting the strategy mood',
  podcast: 'a podcast search term (1-3 words) matching the audience',
  instagram: 'a short image-search query for reference photography of this tactic',
  guerrilla: 'a short image-search query for reference photos of this physical tactic (e.g. "coffee cart pop-up")',
  ooh: 'a short image-search query for reference photos of this placement (e.g. "transit poster coffee")',
  press: 'the title of one real publication/topic page on Wikipedia relevant to this angle',
  email: 'a short image-search query for reference photography of this tactic',
};

// ---- strategy-material terms: sanitize + dedupe so hunts never go generic ----

const STOPWORDS = new Set(('a an and are as at be been but by can could did do does for from had has have he her hers him his how if in into is it its me my no not of on or our ours out over per she so some such than that the their theirs them then there these they this those through to too under until up very via was we were what when where which while who whom why will with within without you your yours').split(' '));
// placeholder/web junk that shows up on scraped pages + generic marketing words
const JUNK_TERMS = new Set(('example examples domain documentation permission illustrative placeholder lorem ipsum reserved rights www http https com org net edu html page pages site sites website web click welcome index home using use used may also etc via marketing campaign advert advertising generic text word words second seconds established coordinate escalate literature asking anyone everyone someone more most other others much many own same new all any get got just like really very thing things').split(' '));

const TOK_RE = /[a-z0-9]+(?:['-][a-z0-9]+)*/g;
const keepTok = (t) => t.length >= 3 && !/^\d+$/.test(t) && !STOPWORDS.has(t) && !JUNK_TERMS.has(t);

function wordTokens(text) {
  return [...new Set((String(text || '').toLowerCase().match(TOK_RE) || []).filter(keepTok))];
}

// rough noun-phrase pull: runs of >=2 meaningful tokens (split on stopwords/punct)
function phraseTerms(text) {
  const out = []; let run = [];
  for (const w of (String(text || '').toLowerCase().match(TOK_RE) || [])) {
    if (keepTok(w)) run.push(w);
    else { if (run.length >= 2) out.push(run.slice(0, 3).join(' ')); run = []; }
  }
  if (run.length >= 2) out.push(run.slice(0, 3).join(' '));
  return [...new Set(out)];
}

const squash = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

// Build the relevance context once per call: ranked match signals (entity >
// product > strategy language > brand) + flat term/phrase sets for queries.
function buildContext({ strategy, profile, product }) {
  const brief = strategy?.brief || {};
  const signals = [];
  const termSet = new Set();
  const phraseSet = new Set();
  const seen = new Set();
  const addSignal = (kind, label, terms) => {
    terms = [...new Set(terms.filter(Boolean))];
    const key = `${kind}:${String(label).toLowerCase()}`;
    if (!terms.length || seen.has(key)) return;
    seen.add(key);
    signals.push({ kind, label, terms });
    for (const t of terms) (t.includes(' ') ? phraseSet : termSet).add(t);
  };

  // 1) entities the strategy actually cites, then top affinity entities per type
  const entityNames = [];
  const pushEntity = (name) => {
    name = String(name || '').trim();
    if (!name || !wordTokens(name).length) return;            // pure-junk entity
    if (entityNames.some((n) => n.toLowerCase() === name.toLowerCase())) return;
    entityNames.push(name);
  };
  for (const s of strategy?.qlooSignals || []) pushEntity(s.entity || s.name);
  const byType = {};
  for (const aff of profile?.qloo?.affinities || []) {
    const ents = (aff.entities || []).filter((e) => e?.name);
    if (ents.length && !byType[aff.type]) byType[aff.type] = ents;
  }
  for (const ents of Object.values(byType)) ents.slice(0, 2).forEach((e) => pushEntity(e.name));
  entityNames.slice(0, 8).forEach((n) => addSignal('entity', n, [n.toLowerCase(), ...wordTokens(n)]));

  // 2) product + brand
  if (product?.name) addSignal('product', product.name, [product.name.toLowerCase(), ...wordTokens(`${product.name} ${product.description || ''}`)]);
  if (profile?.name) addSignal('brand', profile.name, [profile.name.toLowerCase(), ...wordTokens(profile.name)]);

  // 3) the strategy's own language — title, angle, key message, hero signal
  const angleBits = [strategy?.title, strategy?.angle, brief.title, brief.angle, brief.keyMessage, strategy?.heroSignal].filter(Boolean);
  for (const bit of angleBits) {
    for (const p of phraseTerms(bit)) addSignal('angle', p, [p]);
    for (const w of wordTokens(bit)) addSignal('angle', w, [w]);
  }

  return { signals, termSet, phraseSet, entityNames, byType, keywords: [...termSet], product, strategy };
}

// Deterministic "{entity or product} {format}" hunt per platform, seeded from
// the strategy's own material — never a bare category word.
function seedHunt(platform, ctx) {
  const { entityNames, product, strategy } = ctx;
  const topEnt = (type) => ctx.byType[type]?.[0]?.name;
  const ent = entityNames[0] || null;
  const pname = product?.name || null;
  const kw = ctx.keywords.filter((k) => !k.includes(' ')).slice(0, 3).join(' ');
  const anchor = ent || pname || kw || null;
  const note = `seeded from strategy material — proves the ${platform} lane of "${strategy?.title || 'this strategy'}"`;
  const mk = (query) => (query ? { platform, query, note } : null);
  switch (platform) {
    case 'tiktok': {
      const artist = topEnt('urn:entity:artist');
      return artist ? mk(`@${squash(artist)}`) : null;
    }
    case 'youtube':
      if (ent) return mk(`${ent} short documentary`);
      if (pname) return mk(`${pname} review`);
      return mk(kw ? `${kw} short film` : 'modern lifestyle brand film');
    case 'tv': return mk(topEnt('urn:entity:tv_show') || ent);
    case 'streaming': return mk(topEnt('urn:entity:movie') || ent || pname);
    case 'podcast': return mk(topEnt('urn:entity:podcast') || (anchor ? `${anchor} podcast` : null));
    case 'press': return mk(topEnt('urn:entity:book') || ent || pname);
    case 'instagram': return mk(anchor ? `${anchor} photography` : 'editorial brand photography');
    case 'guerrilla': return mk(`${anchor || 'street'} pop-up`);
    case 'ooh': return mk(`${anchor || 'brand'} billboard`);
    case 'email': return mk(anchor ? `${anchor} newsletter design` : 'email newsletter design');
    default: return null;
  }
}

// A hunt query is only honest if it mentions the strategy's own material.
function huntMentionsContext(query, ctx) {
  const q = String(query || '').toLowerCase();
  if (!q) return false;
  for (const p of ctx.phraseSet) if (q.includes(p)) return true;
  return wordTokens(q).some((t) => ctx.termSet.has(t));
}
function handleMatchesContext(query, ctx) {
  const raw = String(query || '').trim();
  if (!/^@?[A-Za-z0-9_.]{2,32}$/.test(raw)) return false;   // must actually be a handle
  const h = squash(raw);
  return ctx.entityNames.some((n) => { const s = squash(n); return s && (h.includes(s) || s.includes(h)); })
    || [...ctx.termSet].some((t) => h.includes(t));
}

// Keep LLM hunts that name real strategy material; replace/drop generic ones;
// then seed any uncovered channel so every lane gets a shot.
function normalizeHunts(raw, ctx) {
  const chanNames = (ctx.strategy?.channels || []).map((c) => c.name || c).filter(Boolean);
  const allowed = chanNames.length ? new Set(chanNames) : null;
  const out = []; const seen = new Set();
  for (const h of Array.isArray(raw) ? raw : []) {
    if (out.length >= 5) break;
    const platform = String(h.platform || '').toLowerCase();
    if (!platform || seen.has(platform) || (allowed && !allowed.has(platform))) continue;
    let query = String(h.query || '').trim();
    const ok = platform === 'tiktok' ? handleMatchesContext(query, ctx) : huntMentionsContext(query, ctx);
    if (!ok) {
      const seed = seedHunt(platform, ctx);
      if (!seed) continue;
      query = seed.query;
    }
    seen.add(platform);
    out.push({ platform, query, note: String(h.note || '') || `reference for the ${platform} lane` });
  }
  for (const c of chanNames) {
    if (out.length >= 5) break;
    if (!seen.has(c)) {
      const s = seedHunt(c, ctx);
      if (s) { seen.add(c); out.push(s); }
    }
  }
  return out.slice(0, 5);
}

// ---- relevance ranking: score resolved items against the strategy's terms ----

const KIND_RANK = { entity: 0, product: 1, angle: 2, brand: 3 };

function assess(item, ctx) {
  const hay = `${item.title || ''} ${item.author || ''} ${item.description || ''} ${(item.tags || []).join(' ')}`.toLowerCase();
  let score = 0;
  const hits = [];
  for (const sig of ctx.signals) {
    const hit = sig.terms.filter((t) => hay.includes(t));
    if (!hit.length) continue;
    const pts = hit.reduce((a, t) => a + (t.includes(' ') ? 2 : 1), 0);   // phrase hits weigh more
    score += pts;
    hits.push({ sig, hit, pts });
  }
  hits.sort((a, b) => (KIND_RANK[a.sig.kind] ?? 9) - (KIND_RANK[b.sig.kind] ?? 9) || b.pts - a.pts);
  const top = hits[0];
  let match;
  if (!top) match = `matches channel: ${item.platform}`;
  else if (top.sig.kind === 'entity') match = `matches audience pull — ${top.sig.label}`;
  else if (top.sig.kind === 'product') match = `matches product — ${top.sig.label}`;
  else if (top.sig.kind === 'brand') match = `matches brand — ${top.sig.label}`;
  else match = `matches strategy angle: ${top.sig.label}`;
  return { score, match };
}

// LLM proposes hunts for the *selected* strategy; resolvers pull real artifacts,
// then each item is relevance-scored against the strategy's own material.
export async function generateExamples({ strategy, profile, product = null, audienceRead }) {
  const brief = strategy?.brief || {};
  const ctx = buildContext({ strategy, profile, product });
  let hunts = null;
  try {
    const j = await chatJSON([
      { role: 'system', content: 'You plan evidence hunts for a marketing strategy. Strict JSON only.' },
      {
        role: 'user', content: [
          `Brand: ${profile?.name || 'brand'} — ${profile?.tagline || ''}`,
          `Strategy: ${strategy?.title} — ${strategy?.angle || brief.angle || ''}. Channels: ${(strategy?.channels || []).map((c) => c.name || c).join(', ')}.`,
          `Audience lean: ${audienceRead?.lean?.label || 'unknown'}. Media habits: ${(audienceRead?.mediaHabits || []).map((m) => m.note).join('; ')}.`,
          `Material to hunt around — entities: ${ctx.entityNames.join(', ') || 'none'}; keywords: ${ctx.keywords.filter((k) => !k.includes(' ')).slice(0, 12).join(', ') || 'none'}${product?.name ? `; product: ${product.name}${product.description ? ` — ${String(product.description).slice(0, 120)}` : ''}` : ''}.`,
          `RULES: every hunt query MUST combine one entity/product/keyword above with a format word — e.g. "${ctx.entityNames[0] || 'entity'} short documentary", "${ctx.entityNames[1] || product?.name || 'entity'} style ad", "${product?.name || 'product'} review". Never emit a generic query like "marketing example" or a bare single word.`,
          `Return {"hunts":[{platform, query, note}]} — 4-5 hunts, one per DISTINCT platform actually in this strategy's channel mix. For each platform: ${Object.entries(PLATFORM_VERB).map(([p, v]) => `${p}→${v}`).join('; ')}.`,
          `note = one line: why this example proves the tactic works for this audience.`,
        ].join('\n'),
      },
    ], { maxTokens: 2600 });
    hunts = j.hunts;
  } catch { /* deterministic fallback below */ }

  // validate LLM hunts (or fully seed when the model failed) — always against
  // the strategy's own material so category-word junk can't slip through.
  hunts = normalizeHunts(hunts, ctx);
  if (!hunts.length) {
    hunts = (strategy?.channels || []).map((c) => c.name || c)
      .map((c) => seedHunt(c, ctx)).filter(Boolean).slice(0, 5);
  }

  const jobs = hunts.slice(0, 5).map(async (h) => {
    const q = String(h.query || '').trim();
    const note = h.note || '';
    try {
      switch (h.platform) {
        case 'tiktok': {
          // try the hunt's handle, then the audience's artist entities — all
          // are real signals, so whichever creator actually exists wins
          const candidates = [...new Set([q, ...(ctx.byType['urn:entity:artist'] || []).slice(0, 3)
            .map((e) => `@${squash(e.name)}`)])]
            .filter((v) => !/[.\s]/.test(v.replace(/^@/, '')));
          if (!candidates.length) return null;
          return await tryAll(...candidates.map((v) => () => tiktokExample(v, note)));
        }
        case 'youtube': return await youtubeExample(q, note);
        // iTunes movie/tv search is dead upstream — try it, then honest wiki cards
        case 'tv': return await tryAll(
          () => itunesExample(q, 'tvShow', 'tv', note),
          () => wikiExample(`${q} (TV series)`, 'tv', note),
          () => wikiExample(q, 'tv', note));
        case 'streaming': return await tryAll(
          () => itunesExample(q, 'movie', 'streaming', note),
          () => wikiExample(`${q} (film)`, 'streaming', note),
          () => wikiExample(q, 'streaming', note));
        case 'podcast': return await tryAll(
          () => itunesExample(q, 'podcast', 'podcast', note),
          () => wikiExample(q, 'podcast', note));
        case 'press': return await wikiExample(q, 'press', note);
        case 'guerrilla': case 'ooh': case 'instagram': case 'email': {
          // pull Commons AND a wiki card for the entity the query anchors on —
          // the relevance scorer drops whichever one is junk; concept-art only
          // when both come back empty.
          const anchor = ctx.entityNames.find((n) => q.toLowerCase().includes(n.toLowerCase()));
          const items = await collect(
            () => commonsExample(q, h.platform, note),
            () => wikiExample(anchor || q, h.platform, note));
          return items.length ? items : [conceptVisual(q, h.platform, note)];
        }
        default: return null;
      }
    } catch { return null; }
  });
  const resolved = (await Promise.all(jobs)).flat().filter(Boolean);

  // dedupe identical artifacts, score relevance, drop 0-scorers when better
  // items exist — but never return an empty hand (honest fallback).
  const seenUrl = new Set();
  const deduped = resolved.filter((e) => {
    const k = e.url || e.embed || `${e.platform}:${e.title}`;
    if (seenUrl.has(k)) return false;
    seenUrl.add(k); return true;
  });
  const scored = deduped.map((e) => ({ e, ...assess(e, ctx) }));
  const positive = scored.filter((s) => s.score > 0).sort((a, b) => b.score - a.score);
  const picked = positive.length ? positive : scored;
  const examples = picked.map(({ e, match }) => ({ ...e, match }));
  return { examples, hunts: hunts.slice(0, 5), fetchedAt: new Date().toISOString() };
}
