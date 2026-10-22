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

async function commonsExample(query, note) {
  const j = await getJson(`https://commons.wikimedia.org/w/api.php?action=query&generator=search&gsrsearch=${encodeURIComponent(query)}&gsrnamespace=6&gsrlimit=1&prop=imageinfo&iiprop=url&iiurlwidth=640&format=json`);
  const page = Object.values(j.query?.pages || {})[0];
  const info = page?.imageinfo?.[0];
  if (!info) return null;
  return {
    platform: 'guerrilla', title: (page.title || 'reference image').replace(/^File:/, ''), author: 'wikimedia commons',
    url: info.descriptionurl, image: info.thumburl,
    note, source: 'scraped',
  };
}

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

// LLM proposes hunts for the *selected* strategy; resolvers pull real artifacts.
export async function generateExamples({ strategy, profile, audienceRead }) {
  const brief = strategy?.brief || {};
  let hunts = null;
  try {
    const j = await chatJSON([
      { role: 'system', content: 'You plan evidence hunts for a marketing strategy. Strict JSON only.' },
      {
        role: 'user', content: [
          `Brand: ${profile?.name || 'brand'} — ${profile?.tagline || ''}`,
          `Strategy: ${strategy?.title} — ${strategy?.angle || brief.angle || ''}. Channels: ${(strategy?.channels || []).map((c) => c.name).join(', ')}.`,
          `Audience lean: ${audienceRead?.lean?.label || 'unknown'}. Media habits: ${(audienceRead?.mediaHabits || []).map((m) => m.note).join('; ')}.`,
          `Return {"hunts":[{platform, query, note}]} — 4-5 hunts, one per DISTINCT platform actually in this strategy's channel mix. For each platform: ${Object.entries(PLATFORM_VERB).map(([p, v]) => `${p}→${v}`).join('; ')}.`,
          `note = one line: why this example proves the tactic works for this audience.`,
        ].join('\n'),
      },
    ], { maxTokens: 2600 });
    hunts = j.hunts;
  } catch { /* deterministic fallback below */ }

  if (!Array.isArray(hunts) || !hunts.length) {
    // deterministic fallback: hunt from the strategy's channels + the profile's
    // top affinity entities/category terms (not the brand's own name).
    const topEnt = (type) => (profile?.qloo?.affinities || [])
      .find((a) => a.type === type)?.entities?.[0]?.name;
    let cat = (profile?.tagline || profile?.overview || '').split(/[,.—]/)[0].trim();
    if (!cat || /example|domain|illustrative|lorem|placeholder/i.test(cat)) cat = 'modern lifestyle brand';
    const chanQueries = {
      youtube: `${cat} brand film`, tiktok: topEnt('urn:entity:artist') ? `@${topEnt('urn:entity:artist').replace(/\s/g, '').toLowerCase()}` : null,
      tv: topEnt('urn:entity:tv_show'), streaming: topEnt('urn:entity:movie'),
      podcast: topEnt('urn:entity:podcast'), press: topEnt('urn:entity:book') || `${cat} industry`,
      instagram: cat, guerrilla: 'pop-up shop street', ooh: 'transit billboard advertising', email: 'email newsletter design',
    };
    hunts = (strategy?.channels || []).map((c) => c.name).filter((c) => chanQueries[c])
      .slice(0, 4).map((c) => ({ platform: c, query: chanQueries[c], note: `reference for the ${c} lane of ${strategy?.title}` }));
  }

  const jobs = hunts.slice(0, 5).map(async (h) => {
    const q = String(h.query || '').trim();
    const note = h.note || '';
    try {
      switch (h.platform) {
        case 'tiktok': return /[.\s]/.test(q.replace(/^@/, '')) ? null : await tiktokExample(q, note);
        case 'youtube': return await youtubeExample(q, note);
        case 'tv': return await wikiExample(q, 'tv', note);
        case 'streaming': return await itunesExample(q, 'movie', 'streaming', note);
        case 'podcast': return await itunesExample(q, 'podcast', 'podcast', note);
        case 'press': return await wikiExample(q, 'press', note);
        case 'guerrilla': case 'ooh': case 'instagram': case 'email':
          return await commonsExample(q, note) || await wikiExample(q, h.platform, note) || conceptVisual(q, h.platform, note);
        default: return null;
      }
    } catch { return null; }
  });
  const examples = (await Promise.all(jobs)).filter(Boolean);
  return { examples, hunts: hunts.slice(0, 5), fetchedAt: new Date().toISOString() };
}
