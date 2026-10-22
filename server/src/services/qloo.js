// Qloo Taste AI client (GET-only). Every call carries an evidence-trail record;
// when QLOO_API_KEY is empty or a call fails, fixtures keep the UI surfaces alive.
import { ENV } from '../config.js';
import { fixtureEntities, fixtureSearch, fixtureTags } from './qlooFixtures.js';

const normId = (e) => e.id || e.entity_id || e.entityId;
const normEntity = (e) => ({
  id: normId(e),
  name: e.name || e.properties?.name || normId(e),
  affinity: e.affinity ?? e.query?.affinity,
  popularity: e.popularity,
  types: e.types || (e.type ? [e.type] : undefined),
});

async function qget(path, params) {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v == null || v === '') continue;
    if (Array.isArray(v)) { if (v.length) qs.append(k, v.join(',')); }
    else qs.append(k, String(v));
  }
  const res = await fetch(`${ENV.qlooBase}${path}?${qs.toString()}`, {
    headers: { 'X-Api-Key': ENV.qlooKey },
  });
  if (!res.ok) throw new Error(`qloo ${res.status} ${path}`);
  return res.json();
}

// wrap a call: live when keyed, fixture fallback on missing key OR live failure
async function call(endpoint, params, liveFn, fixtureFn) {
  const at = new Date().toISOString();
  const t0 = Date.now();
  let mode = 'fixture';
  try {
    if (!ENV.qlooKey) throw new Error('no key');
    const data = await liveFn();
    mode = 'live';
    return { mode, data, call: { endpoint, params, at, tookMs: Date.now() - t0, n: count(data) } };
  } catch {
    const data = fixtureFn();
    return { mode, data, call: { endpoint, params, at, tookMs: Date.now() - t0, n: count(data) } };
  }
}
function count(d) { return (d?.results || d?.entities || d?.tags || d || []).length ?? 0; }

export async function searchEntities(query, types) {
  const params = { query, types: Array.isArray(types) ? types.join(',') : types };
  const r = await call('/search', params,
    async () => {
      const d = await qget('/search', params);
      return (d.results || d.entities || d || []).map(normEntity);
    },
    () => fixtureSearch(query));
  return { mode: r.mode, results: r.data, call: r.call };
}

export async function insights({ type, entities, tags: tagIds, take = 8 }) {
  const params = {
    'filter.type': type,
    'signal.interests.entities': Array.isArray(entities) ? entities.join(',') : entities,
    'signal.interests.tags': Array.isArray(tagIds) ? tagIds.join(',') : tagIds,
    take,
  };
  const seed = `${type}|${params['signal.interests.entities'] || ''}|${params['signal.interests.tags'] || ''}`;
  const r = await call('/v2/insights', params,
    async () => {
      const d = await qget('/v2/insights', params);
      return (d.results?.entities || d.entities || d.results || []).map(normEntity);
    },
    () => fixtureEntities(type, take, seed));
  return { mode: r.mode, entities: r.data, call: r.call };
}

export async function tags(query, take = 8) {
  const params = { 'filter.query': query };
  const r = await call('/v2/tags', params,
    async () => {
      const d = await qget('/v2/tags', params);
      return (d.results?.tags || d.tags || d.results || []).map((t) => ({ id: normId(t) || t.id, name: t.name, types: t.types }));
    },
    () => fixtureTags(query, take));
  return { mode: r.mode, tags: r.data, call: r.call };
}

export function qlooMode() { return ENV.qlooKey ? 'live' : 'fixture'; }

export function status() {
  if (!ENV.qlooBase) return { mode: 'off', note: 'Qloo not configured' };
  return ENV.qlooKey
    ? { mode: 'live', note: 'Qloo live' }
    : { mode: 'fixture', note: 'No Qloo key yet — serving demo taste data' };
}

const CAT_KEYWORDS = [
  [/coffee|café|cafe|restaurant|food|bakery|drink|bar\b/i, 'urn:entity:place'],
  [/music|band|audio|record/i, 'urn:entity:artist'],
  [/film|movie|cinema|media/i, 'urn:entity:movie'],
  [/book|publish|read|writ/i, 'urn:entity:book'],
  [/podcast|radio/i, 'urn:entity:podcast'],
  [/game|play/i, 'urn:entity:video-game'],
  [/fashion|apparel|cloth|wear|beauty|skincare|brand|shop|retail|product/i, 'urn:entity:brand'],
];
function pickCategories(profile) {
  const hay = `${profile.name || ''} ${profile.description || ''} ${(profile.values || []).join(' ')} ${(profile.tone || []).join(' ')}`;
  const cats = [];
  for (const [re, t] of CAT_KEYWORDS) if (re.test(hay) && !cats.includes(t)) cats.push(t);
  for (const t of ['urn:entity:artist', 'urn:entity:brand', 'urn:entity:place', 'urn:entity:movie']) {
    if (cats.length >= 4) break;
    if (!cats.includes(t)) cats.push(t);
  }
  return cats.slice(0, 4);
}

function deriveKeywords(profile) {
  const kws = [...(profile.tone || [])];
  const STOP = new Set('the a an and or of for to in on with our we your you is are be at by from as it its this that'.split(' '));
  for (const w of `${profile.description || ''} ${profile.audience || ''}`.toLowerCase().split(/[^a-z'-]+/)) {
    if (w.length > 3 && !STOP.has(w) && !kws.includes(w)) kws.push(w);
    if (kws.length >= 6) break;
  }
  return kws.slice(0, 4);
}

// Full QlooBundle per API.md — never throws; worst case returns empty fixture bundle.
export async function enrichProfile(profile) {
  const calls = [];
  let mode = 'fixture';
  let entity = null;
  try {
    const s = await searchEntities(profile.name || 'brand');
    calls.push(s.call); mode = s.mode;
    const best = s.results?.[0];
    if (best) entity = { id: best.id, name: best.name, popularity: best.popularity };
  } catch { /* keep going */ }

  const tagList = [];
  for (const kw of deriveKeywords(profile)) {
    try {
      const t = await tags(kw);
      calls.push(t.call);
      for (const tg of t.tags.slice(0, 3)) if (!tagList.find((x) => x.id === tg.id)) tagList.push(tg);
    } catch { /* keep going */ }
  }
  const tagIds = tagList.slice(0, 5).map((t) => t.id).filter(Boolean);

  const affinities = [];
  for (const type of pickCategories(profile)) {
    try {
      const r = await insights({
        type,
        entities: entity?.id ? [entity.id] : undefined,
        tags: tagIds.length ? tagIds : undefined,
        take: 8,
      });
      calls.push(r.call);
      affinities.push({ type, entities: r.entities });
    } catch { /* keep going */ }
  }

  return { entity, tags: tagList.slice(0, 8), affinities, calls, mode, fetchedAt: new Date().toISOString() };
}

export function qlooEvidence(bundle) {
  if (!bundle) return [];
  const ev = [];
  for (const aff of bundle.affinities || []) {
    const top = aff.entities?.[0];
    if (!top) continue;
    const label = String(aff.type || '').replace('urn:entity:', '');
    const a = typeof top.affinity === 'number' ? ` (${top.affinity.toFixed(2)})` : '';
    ev.push({ label, detail: `Top affinity: ${top.name}${a} via fans of the brand` });
  }
  ev.push({ label: 'qloo', detail: `${bundle.calls?.length || 0} Qloo calls — ${bundle.mode} mode${bundle.mode === 'fixture' ? ' (demo data)' : ''}` });
  return ev;
}
