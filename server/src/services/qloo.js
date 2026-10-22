// Qloo Taste AI client (GET-only). Every call carries an evidence-trail record.
// Modes: 'live' (real QLOO_API_KEY) → 'simulated' (LLM synthesizes Qloo-shaped
// responses so the pipeline stays dynamic) → 'fixture' (static, last resort).
import { ENV } from '../config.js';
import { chatJSON, tensorConfigured } from './tensor.js';
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

// wrap a call: live when keyed → LLM-simulated → static fixture
async function call(endpoint, params, liveFn, fixtureFn, synthFn) {
  const at = new Date().toISOString();
  const t0 = Date.now();
  let mode = 'fixture', data = null;
  try {
    if (!ENV.qlooKey) throw new Error('no key');
    data = await liveFn();
    mode = 'live';
  } catch {
    if (synthFn && tensorConfigured()) {
      try { data = await synthFn(); mode = 'simulated'; } catch { /* fall to fixture */ }
    }
    if (data == null) data = fixtureFn();
  }
  return { mode, data, call: { endpoint, params, at, tookMs: Date.now() - t0, n: count(data), mode } };
}

const slug = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'x';
const SIM_SYS = 'You simulate the Qloo Taste AI API. Return culturally plausible, specific, REAL-WORLD entities (actual brands, shows, artists, places — never invented names). Strict JSON only.';

async function synthSearch(query, types) {
  const j = await chatJSON([
    { role: 'system', content: SIM_SYS },
    { role: 'user', content: `Qloo /search simulation. query="${query}" types="${types || 'any'}". Return {"results":[{"name","popularity":0-1,"types":["urn:entity:..."]}]} — up to 6 real entities most likely meant by the query.` },
  ], { maxTokens: 1200 });
  return (j.results || []).slice(0, 6).map((e) => ({ id: `sim:${slug(e.name)}`, ...e }));
}
async function synthInsights(type, seed, take) {
  const j = await chatJSON([
    { role: 'system', content: SIM_SYS },
    { role: 'user', content: `Qloo /v2/insights simulation. Audience seed: "${seed}". Target entity type: "${type}". Return {"entities":[{"name","affinity":0-1}]} — ${take} real ${type.replace('urn:entity:', '')} entities this audience plausibly over-indexes on, ranked by affinity (highest first, spread 0.35-0.95). Be specific and culturally real.` },
  ], { maxTokens: 1600 });
  return (j.entities || []).slice(0, take).map((e) => ({ id: `sim:${slug(e.name)}`, types: [type], ...e }));
}
async function synthTags(query, take) {
  const j = await chatJSON([
    { role: 'system', content: SIM_SYS },
    { role: 'user', content: `Qloo /v2/tags simulation. query="${query}". Return {"tags":[{"name"}]} — up to ${take} short lowercase taste tags.` },
  ], { maxTokens: 800 });
  return (j.tags || []).slice(0, take).map((t) => ({ id: `urn:tag:${slug(t.name)}`, name: t.name, types: ['urn:tag'] }));
}
function count(d) { return (d?.results || d?.entities || d?.tags || d || []).length ?? 0; }

export async function searchEntities(query, types) {
  const params = { query, types: Array.isArray(types) ? types.join(',') : types };
  const r = await call('/search', params,
    async () => {
      const d = await qget('/search', params);
      return (d.results || d.entities || d || []).map(normEntity);
    },
    () => fixtureSearch(query),
    () => synthSearch(query, params.types));
  return { mode: r.mode, results: r.data, call: r.call };
}

export async function insights({ type, entities, tags: tagIds, take = 8, hint }) {
  const params = {
    'filter.type': type,
    'signal.interests.entities': Array.isArray(entities) ? entities.join(',') : entities,
    'signal.interests.tags': Array.isArray(tagIds) ? tagIds.join(',') : tagIds,
    take,
  };
  const seed = hint || `${type}|${params['signal.interests.entities'] || ''}|${params['signal.interests.tags'] || ''}`;
  const r = await call('/v2/insights', params,
    async () => {
      const d = await qget('/v2/insights', params);
      return (d.results?.entities || d.entities || d.results || []).map(normEntity);
    },
    () => fixtureEntities(type, take, seed),
    () => synthInsights(type, seed, take));
  return { mode: r.mode, entities: r.data, call: r.call };
}

export async function tags(query, take = 8) {
  const params = { 'filter.query': query };
  const r = await call('/v2/tags', params,
    async () => {
      const d = await qget('/v2/tags', params);
      return (d.results?.tags || d.tags || d.results || []).map((t) => ({ id: normId(t) || t.id, name: t.name, types: t.types }));
    },
    () => fixtureTags(query, take),
    () => synthTags(query, take));
  return { mode: r.mode, tags: r.data, call: r.call };
}

export function qlooMode() { return ENV.qlooKey ? 'live' : tensorConfigured() ? 'simulated' : 'fixture'; }

export function status() {
  if (!ENV.qlooBase) return { mode: 'off', note: 'Qloo not configured' };
  if (ENV.qlooKey) return { mode: 'live', note: 'Qloo live' };
  return tensorConfigured()
    ? { mode: 'simulated', note: 'No Qloo key yet — LLM simulating Qloo-style taste data' }
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
  const tagResults = await Promise.all(deriveKeywords(profile).map((kw) => tags(kw).catch(() => null)));
  for (const t of tagResults) {
    if (!t) continue;
    calls.push(t.call);
    for (const tg of t.tags.slice(0, 3)) if (!tagList.find((x) => x.id === tg.id)) tagList.push(tg);
  }
  const tagIds = tagList.slice(0, 5).map((t) => t.id).filter(Boolean);

  const hint = `${profile.name || 'brand'} audience — fans of ${entity?.name || profile.name}${tagList.length ? `; taste tags: ${tagList.slice(0, 5).map((t) => t.name).join(', ')}` : ''}`;
  const types = pickCategories(profile);
  const affinities = [];
  const insResults = await Promise.all(types.map((type) =>
    insights({ type, entities: entity?.id ? [entity.id] : undefined, tags: tagIds.length ? tagIds : undefined, take: 8, hint }).catch(() => null)));
  insResults.forEach((r, i) => {
    if (!r) return;
    calls.push(r.call);
    affinities.push({ type: types[i], entities: r.entities });
  });

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
