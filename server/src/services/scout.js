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

async function youtubeExamples(query, note, n = 2) {
  // full extract (no flat-playlist) so view_count is real — capped n keeps it fast
  let out = '';
  try {
    out = await ytdlp([`ytsearch${n}:${query}`, '--print', '%(id)s|%(title).140s|%(channel)s|%(view_count)s', '--no-download'], 50000);
  } catch {
    out = await ytdlp([`ytsearch${n}:${query}`, '--flat-playlist', '--print', '%(id)s|%(title)s|%(channel)s']);
  }
  return out.split('\n').slice(0, n).map((line) => {
    const [id, title, channel, views] = line.split('|');
    const v = Number(views);
    return id && {
      platform: 'youtube', title: (title || 'YouTube video').slice(0, 140), author: channel,
      url: `https://www.youtube.com/watch?v=${id}`,
      image: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
      embed: `https://www.youtube.com/embed/${id}?rel=0`,
      views: Number.isFinite(v) ? v : null,
      note, source: 'scraped',
    };
  }).filter(Boolean);
}

async function tiktokExamples(handle, note, n = 2) {
  const h = handle.replace(/^@/, '');
  const out = await ytdlp([`https://www.tiktok.com/@${h}`, '--flat-playlist', '--playlist-end', String(n + 2), '--print', '%(id)s|%(title).80s']);
  const lines = out.split('\n').filter(Boolean).slice(0, n);
  return await Promise.all(lines.map(async (line) => {
    const [id, title] = line.split('|');
    if (!id) return null;
    const url = `https://www.tiktok.com/@${h}/video/${id}`;
    let thumb = null, author = `@${h}`, views = null;
    try {
      const oe = await getJson(`https://www.tiktok.com/oembed?url=${encodeURIComponent(url)}`, 6000);
      thumb = oe.thumbnail_url || null;
      author = oe.author_name || author;
    } catch { /* thumb optional */ }
    try {
      const vc = await ytdlp([url, '--print', '%(view_count)s', '--no-download'], 12000);
      const v = Number(vc);
      if (Number.isFinite(v)) views = v;
    } catch { /* views optional — card still carries the real artifact */ }
    return {
      platform: 'tiktok', title: (title || 'TikTok video').slice(0, 140), author,
      url, image: thumb, views,
      embed: `https://www.tiktok.com/player/v1/${id}?embed_from=oembed`,
      note, source: 'scraped',
    };
  })).then((a) => a.filter(Boolean));
}

// instagram lane — scrape the entity's actual IG frontpage: recent posts with
// real permalinks + like/view counts when IG yields them. Login-walled runs
// throw → the hunt is marked failed, never padded with wiki junk.
async function instagramExamples(handle, note, n = 2) {
  const h = handle.replace(/^@/, '');
  const out = await ytdlp([`https://www.instagram.com/${h}/`, '--flat-playlist', '--playlist-end', String(n + 2), '--print', '%(id)s|%(title).90s|%(url)s'], 40000);
  const lines = out.split('\n').filter(Boolean).slice(0, n);
  return await Promise.all(lines.map(async (line) => {
    const [id, title, url] = line.split('|');
    const link = url || (id ? `https://www.instagram.com/p/${id}/` : null);
    if (!link) return null;
    let views = null, likes = null, thumb = null;
    try {
      const meta = await ytdlp([link, '--print', '%(view_count)s|%(like_count)s|%(thumbnail)s', '--no-download'], 12000);
      const [v, l, t] = meta.split('|');
      if (Number.isFinite(Number(v))) views = Number(v);
      if (Number.isFinite(Number(l))) likes = Number(l);
      thumb = t && t.startsWith('http') ? t : null;
    } catch { /* counts optional */ }
    return {
      platform: 'instagram', title: (title || `IG post by @${h}`).slice(0, 140), author: `@${h}`,
      url: link, image: thumb, views, likes,
      embed: null,   // IG blocks iframes — card folds to the real thumbnail, not a dead frame
      note, source: 'scraped',
    };
  })).then((a) => a.filter(Boolean));
}

async function itunesExamples(query, media, platform, note, n = 3) {
  const j = await getJson(`https://itunes.apple.com/search?term=${encodeURIComponent(query)}&media=${media}&limit=${n}`);
  return (j.results || []).map((r) => ({
    platform, title: r.trackName || r.collectionName || query, author: r.artistName,
    url: r.trackViewUrl || r.collectionViewUrl,
    image: (r.artworkUrl100 || '').replace('100x100', '400x400'),
    note, source: 'catalog-art',
  }));
}

async function wikiExample(title, platform, note) {
  const j = await getJson(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`);
  // never surface a disambiguation page — it's not campaign reference material
  if (!j?.title || j.type === 'disambiguation') return null;
  // svg thumbs are almost always logos/flags/wordmarks — keep the card, drop the art
  const img = /\.svg(\?|$)/i.test(j.thumbnail?.source || '') ? null : j.thumbnail?.source;
  return {
    platform, title: j.title, author: 'wikipedia',
    url: j.content_urls?.desktop?.page,
    image: img,
    note: note || (j.extract || '').slice(0, 160), source: 'scraped',
  };
}

// Commons junk filter — logos/seals/maps/diagrams are not reference media
const COMMONS_JUNK = /logo|seal|coat of arms|flag of|map of|diagram|chart|icon|emblem|insignia|wordmark|monogram|specimen|taxon|holotype|pinned|preserved|feather|plumage|bird of paradise|paradisaea|cicinnurus|dissect|skeleton|fossil|herbarium|scan of|page \d|illustration from|engraving/i;

async function commonsExamples(query, platform, note, n = 3) {
  const j = await getJson(`https://commons.wikimedia.org/w/api.php?action=query&generator=search&gsrsearch=${encodeURIComponent(query)}&gsrnamespace=6&gsrlimit=${n + 4}&prop=imageinfo&iiprop=url%7Cmime&iiurlwidth=640&format=json`);
  const pages = Object.values(j.query?.pages || {});
  const items = [];
  for (const page of pages) {
    const info = page?.imageinfo?.[0];
    const title = (page?.title || '').replace(/^File:/, '');
    // only actual images — pdfs/djvus/ogvs aren't campaign reference media
    if (info?.mime && !String(info.mime).startsWith('image/')) continue;
    if (!info?.thumburl || COMMONS_JUNK.test(title)) continue;   // logos/diagrams aren't campaign refs
    items.push({
      platform, title: (title || 'reference image').replace(/\.(jpe?g|png|gif|webp|tiff?|svg)$/i, ''), author: 'wikimedia commons',
      url: info.descriptionurl, image: info.thumburl,
      note, source: 'scraped',
    });
    if (items.length >= n) break;
  }
  return items;
}

// run resolvers in order, first non-empty wins — a throw or an empty array
// just moves to the next fallback.
const tryAll = async (...fns) => {
  for (const f of fns) {
    try { const r = await f(); if (r && (!Array.isArray(r) || r.length)) return r; } catch { /* next fallback */ }
  }
  return null;
};
// run resolvers in parallel, keep every hit (scorer drops the junk later)
const collect = async (...fns) =>
  (await Promise.all(fns.map(async (f) => { try { return await f(); } catch { return null; } }))).filter(Boolean);

// REMOVED conceptVisual — no generated stand-ins. A lane that resolves
// nothing real simply contributes nothing; the UI shows the hunts that ran.

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
  maps: 'a short search for a real local business presence (e.g. "joes pizza nyc") — for businesses whose real medium is their Google Maps/local listing',
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
function buildContext({ strategy, profile, product, qlooBundle }) {
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
  // entities come from THIS board's per-ask taste bundle first; the global
  // profile.qloo bundle is only a fallback so stale signals can't leak in
  const bundleSrc = (qlooBundle?.affinities?.length ? qlooBundle : profile?.qloo) || {};
  const byType = {};
  for (const aff of bundleSrc?.affinities || []) {
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
// per-platform format word so seeded queries land on real artifacts,
// not a bare entity name (bare "Apollo 11" → disambiguation page)
const PLATFORM_FORMAT = {
  youtube: 'official ad', streaming: 'film', tv: 'series',
  podcast: 'interview', press: 'feature', instagram: 'post',
  guerrilla: 'campaign', ooh: 'billboard', email: 'newsletter', tiktok: '',
  maps: 'google maps listing',
};

function seedHunt(platform, ctx, slot = 0) {
  const { entityNames, product, strategy } = ctx;
  const topEnt = (type, s) => ctx.byType[type]?.[s]?.name;
  // rotate anchors across slots so a 2nd hunt per channel pulls different material
  const ent = entityNames.length ? entityNames[slot % entityNames.length] : null;
  const pname = product?.name || null;
  const kw = ctx.keywords.filter((k) => !k.includes(' ')).slice(0, 3).join(' ');
  // visual lanes anchor on the product/keywords — entity names land on random
  // Commons material ("Daphne Brooks" portraits for the Brooks shoe brand)
  const VISUAL = platform === 'instagram' || platform === 'guerrilla' || platform === 'ooh' || platform === 'email';
  const anchor = (VISUAL ? pname || kw || ent : ent || pname || kw) || null;
  const fmt = PLATFORM_FORMAT[platform];
  const note = `seeded from strategy material — proves the ${platform} lane of "${strategy?.title || 'this strategy'}"`;
  const mk = (query) => (query ? { platform, query, note } : null);
  switch (platform) {
    case 'tiktok': {
      // the brand's own handle first — real posts they actually ran — then artists
      const brand = pname || topEnt('urn:entity:brand', slot);
      const artist = topEnt('urn:entity:artist', slot);
      const h = brand ? `@${squash(brand)}` : artist ? `@${squash(artist)}` : null;
      return h ? mk(h) : null;
    }
    case 'youtube':
      // real campaign artifacts — brand-side spots AND customer-side video:
      // "Rhode lip tint official ad" vs "Rhode lip tint customer review"
      if (pname) return mk(`${pname} ${slot ? 'customer review' : 'official ad'}`);
      if (ent) return mk(`${ent} ${slot ? 'ad' : 'campaign film'}`);
      return mk(kw ? `${kw} brand ad` : null);
    case 'tv': {
      const show = topEnt('urn:entity:tv_show', slot);
      return mk(show || (anchor ? `${anchor} documentary series` : null));
    }
    case 'streaming': {
      const film = topEnt('urn:entity:movie', slot);
      return mk(film || (anchor ? `${anchor} documentary film` : null));
    }
    case 'podcast': return mk(topEnt('urn:entity:podcast', slot) || (anchor ? `${anchor} podcast` : null));
    case 'press': return mk(topEnt('urn:entity:book', slot) || (anchor ? `${anchor} book` : null));
    case 'instagram': return mk(pname || ent ? `@${squash(pname || ent)}` : null);
    case 'guerrilla': return mk(`${anchor || 'street'} pop-up`);
    case 'ooh': return mk(`${anchor || 'brand'} billboard`);
    case 'email': return mk(anchor ? `${anchor} newsletter design` : 'email newsletter design');
    case 'maps': {
      // local-presence medium — anchor on the product or a real place entity
      const place = topEnt('urn:entity:place', slot);
      return mk(`${pname || place || anchor} ${slot ? 'google maps listing' : 'google maps'}`);
    }
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
// then seed any uncovered channel so every lane gets a shot. Up to 2 hunts per
// channel (varied queries) — a richer pull than one card per lane.
function normalizeHunts(raw, ctx) {
  const chanNames = (Array.isArray(ctx.strategy?.channels) ? ctx.strategy.channels : []).map((c) => c.name || c).filter(Boolean);
  // channel mix + cross-media lanes — real broadcast/print/local artifacts
  // live on youtube/commons even when the strategy runs social-only
  const CROSS_MEDIA = ['youtube', 'tv', 'ooh', 'press', 'maps'];
  const allowed = chanNames.length ? new Set([...chanNames, ...CROSS_MEDIA]) : null;
  const out = []; const perChan = {}; const seenQ = new Set();
  for (const h of Array.isArray(raw) ? raw : []) {
    if (out.length >= 8) break;
    const platform = String(h.platform || '').toLowerCase();
    if (!platform || (perChan[platform] || 0) >= 2 || (allowed && !allowed.has(platform))) continue;
    let query = String(h.query || '').trim();
    const ok = platform === 'tiktok' ? handleMatchesContext(query, ctx) : huntMentionsContext(query, ctx);
    if (!ok) {
      const seed = seedHunt(platform, ctx);
      if (!seed) continue;
      query = seed.query;
    }
    const qk = `${platform}:${query.toLowerCase()}`;
    if (seenQ.has(qk)) continue;
    seenQ.add(qk);
    perChan[platform] = (perChan[platform] || 0) + 1;
    out.push({ platform, query, note: String(h.note || '') || `reference for the ${platform} lane` });
  }
  // backfill: 2 varied seeds per channel so even a one-lane strategy pulls deep
  for (const c of chanNames) {
    for (let slot = 0; slot < 2 && out.length < 8; slot++) {
      if ((perChan[c] || 0) >= 2) break;
      const s = seedHunt(c, ctx, (perChan[c] || 0) + slot);
      if (s && !seenQ.has(`${c}:${s.query.toLowerCase()}`)) {
        seenQ.add(`${c}:${s.query.toLowerCase()}`); perChan[c] = (perChan[c] || 0) + 1; out.push(s);
      }
    }
  }
  return out.slice(0, 8);
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
  // commons photos matching on a single bare token are near-always a person
  // or place sharing a brand name ("Daphne Brooks" for Brooks shoes) — demand
  // a phrase hit or 2+ distinct terms before trusting the match
  if (score > 0 && /wikimedia commons/i.test(item.author || '')) {
    const distinct = new Set(hits.flatMap((h) => h.hit));
    const hasPhrase = hits.some((h) => h.hit.some((t) => t.includes(' ')));
    if (distinct.size < 2 && !hasPhrase) { score = 0; hits.length = 0; }
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
// `hint` — free text the user types to steer the pull (creator names, formats,
// vibes). Hint terms join the match context AND force one extra hunt per lane.
export async function generateExamples({ strategy, profile, product = null, audienceRead, hint = '', qlooBundle }) {
  const brief = strategy?.brief || {};
  const ctx = buildContext({ strategy, profile, product, qlooBundle });
  const hintQ = String(hint || '').trim().slice(0, 120);
  if (hintQ) {
    for (const t of wordTokens(hintQ)) ctx.termSet.add(t);
    for (const p of phraseTerms(hintQ)) ctx.phraseSet.add(p);
    ctx.signals.push({ kind: 'entity', label: hintQ, terms: [hintQ.toLowerCase(), ...wordTokens(hintQ)] });
  }
  let hunts = null;
  try {
    const j = await chatJSON([
      { role: 'system', content: 'You plan evidence hunts for a marketing strategy. Strict JSON only.' },
      {
        role: 'user', content: [
          `Brand: ${profile?.name || 'brand'} — ${profile?.tagline || ''}`,
          `Strategy: ${strategy?.title} — ${strategy?.angle || brief.angle || ''}. Channels: ${(Array.isArray(strategy?.channels) ? strategy.channels : []).map((c) => c.name || c).join(', ')}.`,
          `Audience lean: ${audienceRead?.lean?.label || 'unknown'}. Media habits: ${(audienceRead?.mediaHabits || []).map((m) => m.note).join('; ')}.`,
          `Material to hunt around — entities: ${ctx.entityNames.join(', ') || 'none'}; keywords: ${ctx.keywords.filter((k) => !k.includes(' ')).slice(0, 12).join(', ') || 'none'}${product?.name ? `; product: ${product.name}${product.description ? ` — ${String(product.description).slice(0, 120)}` : ''}` : ''}.`,
          hintQ ? `USER STEER — prioritize hunts around: "${hintQ}"` : '',
          `RULES: every hunt query MUST name a real artifact a brand actually ran — a specific ad, commercial, campaign post, or creator collab — anchored on the product/entities above. e.g. "${product?.name || 'product'} official ad", "${ctx.entityNames[0] || 'entity'} campaign", "@${squash(ctx.entityNames[0] || 'brand')} tiktok". Think "how Nike promoted a specific shoe to a specific demographic" — never a generic query like "marketing example", "photography", or a bare word.`,
          `Return {"hunts":[{platform, query, note}]} — 6-8 hunts across the strategy's channel mix PLUS at least one cross-media lane (youtube hunt for a real TV/broadcast commercial or a customer-side review/POV video, ooh for billboard/print work, maps when the business's real medium is a local listing) — different media forms, not just social. Up to 2 per platform, vary the angle. For each platform: ${Object.entries(PLATFORM_VERB).map(([p, v]) => `${p}→${v}`).join('; ')}.`,
          `note = one line: why this example proves the tactic works for this audience.`,
        ].filter(Boolean).join('\n'),
      },
    ], { maxTokens: 2600 });
    hunts = j.hunts;
  } catch { /* deterministic fallback below */ }

  // validate LLM hunts (or fully seed when the model failed) — always against
  // the strategy's own material so category-word junk can't slip through.
  hunts = normalizeHunts(hunts, ctx);
  if (!hunts.length) {
    hunts = (strategy?.channels || []).map((c) => c.name || c)
      .map((c) => seedHunt(c, ctx)).filter(Boolean).slice(0, 8);
  }
  // user steer — one extra literal hunt per channel lane on the hint itself,
  // query shaped with that platform's format word (not a generic suffix)
  if (hintQ) {
    for (const c of (strategy?.channels || []).map((x) => x.name || x).slice(0, 3)) {
      const isHandle = /^@?[A-Za-z0-9_.]{2,32}$/.test(hintQ);
      hunts.push({ platform: c, query: c === 'tiktok' && isHandle ? hintQ : `${hintQ} ${PLATFORM_FORMAT[c] || ''}`.trim(), note: `user-steered pull — "${hintQ}"` });
    }
  }

  const huntList = hunts.slice(0, 8);
  const jobs = huntList.map(async (h) => {
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
          return await tryAll(...candidates.map((v) => () => tiktokExamples(v, note)));
        }
        case 'youtube': return await youtubeExamples(q, note);
        // iTunes movie/tv search is dead upstream — try it, then honest wiki cards
        case 'tv': return await tryAll(
          () => itunesExamples(q, 'tvShow', 'tv', note, 2),
          async () => [await wikiExample(`${q} (TV series)`, 'tv', note)].filter(Boolean),
          async () => [await wikiExample(q, 'tv', note)].filter(Boolean));
        case 'streaming': return await tryAll(
          () => itunesExamples(q, 'movie', 'streaming', note, 3),
          async () => [await wikiExample(`${q} (film)`, 'streaming', note)].filter(Boolean),
          async () => [await wikiExample(q, 'streaming', note)].filter(Boolean));
        case 'podcast': return await tryAll(
          () => itunesExamples(q, 'podcast', 'podcast', note, 3),
          async () => [await wikiExample(q, 'podcast', note)].filter(Boolean));
        case 'press': return await wikiExample(q, 'press', note);
        case 'instagram': {
          // scrape the entity's real IG frontpage — candidate handles are the
          // hunt query plus squashed brand/entity names; all fail = failed hunt
          const candidates = [...new Set([q, ...(ctx.byType['urn:entity:brand'] || []).slice(0, 3)
            .map((e) => `@${squash(e.name)}`)])]
            .map((v) => v.replace(/^@/, ''))
            .filter((v) => /^[A-Za-z0-9_.]{2,30}$/.test(v));
          if (!candidates.length) return null;
          return await tryAll(...candidates.map((v) => () => instagramExamples(v, note)));
        }
        case 'guerrilla': case 'ooh': case 'email': case 'maps': {
          // pull Commons AND a wiki card for the entity the query anchors on —
          // the relevance scorer drops whichever one is junk. Both empty? The
          // lane returns nothing — no generated stand-in.
          const anchor = ctx.entityNames.find((n) => q.toLowerCase().includes(n.toLowerCase()));
          const items = (await collect(
            () => commonsExamples(q, h.platform, note),
            async () => [await wikiExample(anchor || q, h.platform, note)].filter(Boolean))).flat();
          return items.length ? items : null;
        }
        default: return null;
      }
    } catch { return null; }
  });
  const perHunt = await Promise.all(jobs);
  const resolved = perHunt.flat().filter(Boolean);
  // a hunt that resolved zero real artifacts is marked failed — the UI lists
  // it as "pull failed" instead of silently skipping the lane
  huntList.forEach((h, i) => { if (!(perHunt[i] || []).length) h.failed = true; });
  if (process.env.SCOUT_DEBUG) console.error('[scout] hunts:', hunts.map((h) => `${h.platform}:${h.query}`), '→ resolved:', resolved.length, resolved.map((e) => `${e.platform}:${String(e.title).slice(0, 40)}`));

  // dedupe identical artifacts, score relevance, drop 0-scorers when better
  // items exist — but never return an empty hand (honest fallback).
  const seenUrl = new Set();
  const deduped = resolved.filter((e) => {
    // dedupe on artifact identity AND on normalized title — the same wiki page
    // surfaces once per resolver with different urls
    const tk = squash(e.title).replace(/\d+/g, '');   // "Chanel Alafaci 02/03/04" → one card
    const k = e.url || e.embed || `${e.platform}:${e.title}`;
    if (seenUrl.has(k) || (tk && seenUrl.has(`t:${tk}`))) return false;
    seenUrl.add(k); if (tk) seenUrl.add(`t:${tk}`);
    return true;
  });
  const scored = deduped.map((e) => ({ e, ...assess(e, ctx) }));
  const positive = scored.filter((s) => s.score > 0).sort((a, b) => b.score - a.score);
  // real artifacts only. zero-score scraped junk is dropped entirely — an
  // empty hand with the hunts listed is honest; padded concept art was not.
  let picked = positive.map((s) => s.e);
  if (!picked.length) picked = scored.filter((s) => s.score === 0).map((s) => s.e);
  const matchOf = new Map(scored.map((s) => [s.e, s.match]));
  const examples = picked.slice(0, 10).map((e) => ({ ...e, match: matchOf.get(e) || `matches channel: ${e.platform}` }));
  return { examples, hunts: huntList, fetchedAt: new Date().toISOString() };
}
