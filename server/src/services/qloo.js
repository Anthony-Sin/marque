// Qloo Taste AI client (GET-only). Every call carries an evidence-trail record.
// NO fallbacks: a call is 'live' or 'error' — failures surface as failures.
import { ENV } from '../config.js';

const normId = (e) => e.id || e.entity_id || e.entityId;
const normEntity = (e) => {
  const p = e.properties || {};
  return {
    id: normId(e),
    name: e.name || p.name || normId(e),
    affinity: e.affinity ?? e.query?.affinity,
    popularity: e.popularity,
    types: e.types || (e.type ? [e.type] : e.subtype ? [e.subtype] : undefined),
    // rich graph payload — what makes the panel feel like real data, not a list
    image: p.image?.url || p.image || null,
    tagline: p.tagline || null,
    keywords: (p.keywords || p.lifestyle || []).slice(0, 5),
    industries: (p.industries || p.genres || []).slice(0, 3),
    description: (p.description || '').slice(0, 240) || null,
  };
};

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
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`qloo ${res.status} ${path}${body ? ` — ${body.slice(0, 160)}` : ''}`);
  }
  return res.json();
}

// one call: live, or an error record with the real reason — never synthesized
async function call(endpoint, params, liveFn) {
  const at = new Date().toISOString();
  const t0 = Date.now();
  try {
    if (!ENV.qlooKey) throw new Error('QLOO_API_KEY not set');
    const data = await liveFn();
    return { mode: 'live', data, call: { endpoint, params, at, tookMs: Date.now() - t0, n: count(data), mode: 'live' } };
  } catch (e) {
    const error = String(e?.message || e).slice(0, 300);
    return {
      mode: 'error', data: null, error,
      call: { endpoint, params, at, tookMs: Date.now() - t0, n: 0, mode: 'error', error },
    };
  }
}

function count(d) {
  const r = d?.results?.entities || d?.results?.tags || d?.results || d?.entities || d?.tags || d || [];
  return Array.isArray(r) ? r.length : 0;
}

export async function searchEntities(query, types) {
  const params = { query, types: Array.isArray(types) ? types.join(',') : types };
  const r = await call('/search', params, async () => {
    const d = await qget('/search', params);
    return (d.results || d.entities || d || []).map(normEntity);
  });
  return { mode: r.mode, results: r.data, error: r.error, call: r.call };
}

export async function insights({ type, entities, tags: tagIds, take = 8, hint }) {
  const params = {
    'filter.type': type,
    'signal.interests.entities': Array.isArray(entities) ? entities.join(',') : entities,
    'signal.interests.tags': Array.isArray(tagIds) ? tagIds.join(',') : tagIds,
    take,
  };
  const r = await call('/v2/insights', params, async () => {
    const d = await qget('/v2/insights', params);
    return (d.results?.entities || d.entities || d.results || []).map((e) => normEntity(e?.entity || e));
  });
  return { mode: r.mode, entities: r.data, error: r.error, call: r.call };
}

export async function tags(query, take = 8) {
  const params = { 'filter.query': query };
  const r = await call('/v2/tags', params, async () => {
    const d = await qget('/v2/tags', params);
    return (d.results?.tags || d.tags || d.results || []).map((t) => ({ id: normId(t) || t.id, name: t.name, types: t.types }));
  });
  return { mode: r.mode, tags: r.data, error: r.error, call: r.call };
}

export function qlooMode() { return ENV.qlooKey ? 'live' : 'off'; }

export function status() {
  if (!ENV.qlooBase) return { mode: 'off', note: 'Qloo not configured' };
  if (ENV.qlooKey) return { mode: 'live', note: 'Qloo live' };
  return { mode: 'off', note: 'QLOO_API_KEY missing — taste calls will fail visibly' };
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
  // pad to a broad pull — the point is a rich taste map, not a narrow one
  for (const t of ['urn:entity:artist', 'urn:entity:brand', 'urn:entity:movie', 'urn:entity:place', 'urn:entity:podcast', 'urn:entity:book']) {
    if (cats.length >= 6) break;
    if (!cats.includes(t)) cats.push(t);
  }
  return cats.slice(0, 6);
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

// QlooBundle per API.md — no fallbacks: 'live' when every call succeeded,
// 'partial' when some did, 'error' when all failed, 'off' without a key.
function bundleMode(calls) {
  const modes = calls.map((c) => c?.mode).filter(Boolean);
  if (!modes.length) return 'error';
  const live = modes.filter((m) => m === 'live').length;
  return live === modes.length ? 'live' : live > 0 ? 'partial' : 'error';
}

// is a /search hit plausibly the subject we asked about? Qloo ranks loosely —
// "Rhode" returns Sint-Genesius-Rode, a Belgian village ("rhode" is a token
// inside it, but not what the query means). Require the entity's name to
// START with the query's first token — "rhode island"✓, "sint-genesius-rode"✗
function relevantHit(query, e) {
  const toks = (s) => String(s || '').toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 1);
  const q = toks(query), n = toks(e?.name);
  if (!q.length || !n.length) return false;
  if (n[0] === q[0]) return true;
  return n.slice(0, 2).join(' ').startsWith(q.join(' '));
}

export async function enrichProfile(profile, opts = {}) {
  const calls = [];
  let entity = null;
  const query = profile.name || 'brand';
  const s = await searchEntities(query);
  calls.push(s.call);
  // pick the first hit whose name actually overlaps the query — not results[0]
  const best = (s.results || []).find((e) => relevantHit(query, e));
  if (best) entity = { id: best.id, name: best.name, popularity: best.popularity };

  const tagList = [];
  const liveTagIds = [];   // only tags returned by a LIVE call are valid signals
  const addTags = (t) => {
    if (!t) return;
    calls.push(t.call);
    for (const tg of (t.tags || []).slice(0, 3)) {
      if (!tagList.find((x) => x.id === tg.id)) tagList.push(tg);
      if (t.call?.mode === 'live' && tg.id) liveTagIds.push(tg.id);
    }
  };
  // tags are the reliable insights anchor — always pull at least one set,
  // lite mode or not (an entity signal alone 400s when the entity is irrelevant)
  const kws = deriveKeywords(profile);
  const tagResults = await Promise.all((opts.lite ? kws.slice(0, 1) : kws).map((kw) => tags(kw)));
  for (const t of tagResults) addTags(t);
  // a live-but-empty tag call yields no anchor — walk the remaining keywords
  // before giving up (never retry the same keyword: same empty result)
  for (let i = 1; !liveTagIds.length && i < kws.length; i++) {
    addTags(await tags(kws[i]));
  }
  if (!liveTagIds.length) addTags(await tags(query));

  const hint = `${query} audience — fans of ${entity?.name || query}${profile.audience ? `; ask: ${String(profile.audience).slice(0, 120)}` : ''}${tagList.length ? `; taste tags: ${tagList.slice(0, 5).map((t) => t.name).join(', ')}` : ''}`;
  const types = pickCategories(profile);
  const affinities = [];
  // anchor: live tags first (proven reliable); the entity id only when it is a
  // genuine name match — a wrong entity poisons every insights call
  const signal = liveTagIds.length
    ? { tags: liveTagIds.slice(0, 3) }
    : entity?.id ? { entities: [entity.id] } : {};
  const insResults = await Promise.all(types.map((type) =>
    insights({ type, ...signal, take: 10, hint })));
  insResults.forEach((r, i) => {
    if (!r) return;
    calls.push(r.call);
    // a failed insights call still gets a group slot — UI shows "call failed"
    affinities.push({ type: types[i], entities: r.entities || [], error: r.error || null });
  });

  return { entity, tags: tagList.slice(0, 8), affinities, calls, mode: bundleMode(calls), fetchedAt: new Date().toISOString() };
}

export function qlooEvidence(bundle) {
  if (!bundle) return [];
  const ev = [];
  for (const aff of bundle.affinities || []) {
    const top = aff.entities?.[0];
    const label = String(aff.type || '').replace('urn:entity:', '');
    if (aff.error) { ev.push({ label, detail: `insights call failed — ${aff.error}` }); continue; }
    if (!top) continue;
    const a = typeof top.affinity === 'number' ? ` (${top.affinity.toFixed(2)})` : '';
    ev.push({ label, detail: `Top affinity: ${top.name}${a} via fans of the brand` });
  }
  const mix = {};
  for (const c of bundle.calls || []) mix[c.mode] = (mix[c.mode] || 0) + 1;
  const mixStr = Object.entries(mix).map(([m, n]) => `${n} ${m}`).join(' · ');
  ev.push({ label: 'qloo', detail: `${bundle.calls?.length || 0} Qloo calls — ${mixStr}${bundle.mode === 'partial' ? ' — some failed, see trail' : ''}` });
  return ev;
}
