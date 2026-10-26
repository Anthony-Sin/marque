// Per-board moodboard — a 3x3 grid of localgen tiles distilled from the
// board's own taste/audience data (taste entities, strategy angles, palette
// hexes, brand voice). Each tile is a DIFFERENT kind of visual — persona
// portrait, venue texture, palette-material study, product-in-context,
// music-scene energy, … — so the grid reads like an editorial board, not
// nine copies of the same product shot. That sameness was the blandness
// complaint; the tile KINDS are the fix.
import crypto from 'node:crypto';
import * as store from './store.js';
import { localgenImage, localgenHealth, localProviderTag } from './media.js';
import { ENV } from '../config.js';

const short = (v, n = 140) => String(v || '').replace(/\s+/g, ' ').trim().slice(0, n);
const and = (arr, n = 2) => (arr || []).slice(0, n).join(' and ');

// every entity name under a qloo type ('urn:entity:artist' → artists)
function names(board, type, n = 4) {
  const out = [];
  for (const a of board?.qlooBundle?.affinities || []) {
    if (a?.type !== `urn:entity:${type}`) continue;
    for (const e of a.entities || []) if (e?.name) out.push(e.name);
  }
  return [...new Set(out)].slice(0, n);
}

// site-scraped hexes first (they describe THIS board's subject), then the
// profile palette — enrichPrompt re-states them early so they survive the
// 77-token encoder window instead of being truncated away.
function boardPalette(board, profile) {
  const site = (board?.urlContext?.colors || []).map((c) => (typeof c === 'string' ? c : c?.hex));
  const pc = profile?.colors || {};
  return [...new Set([...site, pc.primary, pc.secondary, pc.accent].filter(Boolean).map((h) => String(h).toLowerCase()))]
    .filter((h) => /^#[0-9a-f]{3,8}$/.test(h))
    .slice(0, 4);
}

// everything the tile prompts pull from — pure board/profile/product data,
// no model call. The audience descriptor prefers the user's own ask ("… →
// festival-going metalheads & gym rats, 18–29" → the tail) over the model's
// brief label: the ask is the sharper picture of who this is for.
export function boardContext(board, profile = null, product = null) {
  const read = board?.audienceRead || {};
  const strategies = board?.strategies || [];
  const ask = short(board?.sub?.prompt || board?.title || '', 160);
  const tail = ask.split(/→|->|\|/).map((s) => s.trim()).filter(Boolean);
  const audienceDesc = (tail.length > 1 ? tail.at(-1) : '')
    || short(strategies[0]?.brief?.audience, 120)
    || read.lean?.label || 'this audience';
  const productName = short(
    product?.name || board?.urlContext?.siteName
    || String(board?.urlContext?.title || '').split('|')[0] || profile?.name || '', 60);
  return {
    ask, audienceDesc,
    lean: read.lean?.label || '',
    vibes: (read.vibeWords || []).slice(0, 5),
    strategies, strategy: strategies[0] || null,
    artists: names(board, 'artist'), brands: names(board, 'brand'),
    movies: names(board, 'movie', 3), places: names(board, 'place'),
    podcasts: names(board, 'podcast', 3), books: names(board, 'book', 3),
    palette: boardPalette(board, profile),
    productName, productDesc: short(product?.description || board?.urlContext?.description || '', 140),
    brandName: profile?.name || '', tone: (profile?.tone || []).slice(0, 4),
  };
}

// Nine fixed tiles, one visual KIND each. `style` maps to promptStyle's
// enrichment banks (light/lens/texture/grade cues differ per kind); `id` is
// the semantic label stored on the tile. Prompts put the subject in the
// first sentence — enrichPrompt splices treatment cues right after it.
export function buildTiles(c) {
  const place = c.places.length ? `a place like ${and(c.places)}` : 'the venues this crowd gathers in';
  const scene = short(c.strategy?.angle || c.ask, 130);
  const objects = [
    c.books[0] && `a dog-eared copy of ${short(c.books[0], 40)}`,
    c.movies[0] && `a creased still from ${short(c.movies[0], 40)}`,
    c.podcasts[0] && `earbuds queued on ${short(c.podcasts[0], 40)}`,
  ].filter(Boolean);
  const uniform = [...c.artists, ...c.brands].slice(0, 3);
  const mood = c.vibes.slice(0, 3).join(' / ') || c.lean || 'the crowd';
  const s = c.strategy;
  return [
    {
      id: 'persona', style: 'ad',
      prompt: `Editorial portrait photograph of one member of this audience — ${c.audienceDesc}. ${c.artists.length ? `Styled like they listen to ${and(c.artists)}: ` : ''}worn merch, inked skin, unposed direct gaze — a real person, not a model.`,
    },
    {
      id: 'venue', style: 'hero',
      prompt: `Empty venue texture study — ${place}. Raw concrete, salt-worn wood, sticker-bombed pillars, stage haze and string lights before doors open.`,
    },
    {
      id: 'palette', style: 'photoshoot',
      prompt: `Abstract palette-material study — swatches of powder-coated steel, matte concrete, torn print and tinted glass layered into a flat composition${c.palette.length ? ` in ${c.palette.slice(0, 3).join(', ')}` : ''}.`,
    },
    {
      id: 'product', style: 'ad',
      prompt: `Editorial product photograph of ${c.productName || 'the featured product'} in context — ${scene}${c.places[0] ? `, ${c.places[0]} surroundings` : ''} — a real environment, not a studio packshot.`,
    },
    {
      id: 'music', style: 'motion',
      // daytime pit — keeps the energy without landing in the same dark
      // backlit-silhouette register as the atmosphere/key-art tiles
      prompt: `Packed daytime festival crowd — ${c.artists.length ? `the energy of a ${and(c.artists)} set, ` : ''}raised hands against a bright sky, dust and haze in hard sunlight, a distant band mid-set, shot from inside the pit.`,
    },
    {
      id: 'culture', style: 'photoshoot',
      prompt: `Hard-lit flat-lay of this audience's objects, all covers and prints blank and unmarked — ${objects.length ? objects.join(', ') : 'worn headphones, gym chalk, a creased ticket stub and a battered paperback'} — arranged on scratched steel.`,
    },
    {
      id: 'strategy', style: 'hero',
      prompt: s
        ? `Cinematic key art for "${short(s.title, 60)}" — ${short(s.angle || s.brief?.keyMessage || c.ask, 140)} — one striking frame, mood over message.`
        : `Cinematic key art for ${c.ask} — one striking frame, mood over message.`,
    },
    {
      id: 'style', style: 'ad',
      prompt: `Street-style detail — ${uniform.length ? `the ${uniform.join('/')}-adjacent uniform` : "this crowd's uniform"}: layered black tees, chain hardware, scuffed high-tops, wristbands and ink. Close crop on fabric texture and wear.`,
    },
    {
      id: 'atmosphere', style: 'hero',
      // the bright counterpart to the crowd/key-art tiles — a morning-after
      // frame reads as its own image, not a fourth dark silhouette
      prompt: `The morning after — empty ${c.places.length ? 'venue surroundings' : 'festival grounds'} at sunrise, stage structure against a pale gold sky, dew and litter on trampled ground. The still side of ${mood} energy.`,
    },
  ];
}

// Sequential localgen loop (the service's GEN_LOCK serializes GPU work
// anyway — parallel calls would just queue). One retry per tile, unique
// seed per attempt. A board that vanished mid-run gets its tiles released
// rather than orphaned; a regen swaps tile sets atomically — the previous
// tiles release only after the new moodboard is on the record.
export async function generateMoodboard(boardId, onProgress) {
  if (!ENV.localgenUrl) throw new Error('local image generation is not configured');
  const health = await localgenHealth().catch(() => ({ ok: false }));
  if (!health.ok) throw new Error('local image service is offline');
  const board = store.find('boards', boardId);
  if (!board) throw new Error('board was deleted before generation started');
  const profile = store.get('profile');
  const product = board.sub?.productId ? store.find('catalog', board.sub.productId) : null;
  const ctx = boardContext(board, profile, product);
  const specs = buildTiles(ctx);
  const prev = (board.moodboard?.tiles || []).map((t) => t?.path).filter(Boolean);
  const seeds = new Set();
  const tiles = [];
  const failures = [];
  for (const spec of specs) {
    let path = null, lastErr = null;
    for (let attempt = 0; attempt < 2 && !path; attempt++) {
      let seed;
      do { seed = crypto.randomInt(1, 0x7fffffff); } while (seeds.has(seed));
      seeds.add(seed);
      try {
        path = await localgenImage(spec.prompt, { aspectRatio: '1:1', kind: spec.style, palette: ctx.palette, seed });
      } catch (e) { lastErr = e; }
    }
    if (path) {
      store.registerImage(path, { source: 'moodboard', boardId, kind: spec.id });
      tiles.push({ path, kind: spec.id, prompt: spec.prompt });
    } else {
      failures.push({ kind: spec.id, error: String(lastErr?.message || lastErr).slice(0, 120) });
    }
    onProgress?.({ done: tiles.length + failures.length, total: specs.length, tiles: tiles.length, failed: failures.length });
  }
  if (!tiles.length) {
    throw new Error(`moodboard generation failed — every tile errored (${failures[0]?.error || 'no output'})`);
  }
  const current = store.find('boards', boardId);
  if (!current) { // deleted mid-run — don't litter the asset dir
    for (const t of tiles) store.releaseAsset(t.path);
    return { boardId, tiles: 0, discarded: true };
  }
  const provider = await localProviderTag();
  const moodboard = {
    tiles, generatedAt: store.now(), provider, requested: specs.length,
    ...(failures.length ? { failed: failures.length, failures } : {}),
  };
  store.update('boards', boardId, { moodboard, moodboardError: null });
  // lastStrategy mirrors the whole board — refresh it BEFORE releasing the
  // old tile set, or assetInUse sees the stale copy still holding them
  if (store.get('lastStrategy')?.id === boardId) store.set('lastStrategy', store.find('boards', boardId));
  const live = new Set(tiles.map((t) => t.path));
  for (const p of prev) if (!live.has(p)) store.releaseAsset(p);
  return { boardId, tiles: tiles.length, failed: failures.length, provider, moodboard };
}
