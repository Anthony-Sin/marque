// smoke.js — sequential REAL integration checks (tensor, gemini image, qloo, scraper)
import fs from 'node:fs';
import { init, assetAbs, list } from '../src/services/store.js';
import { chat } from '../src/services/tensor.js';
import { genImage } from '../src/services/gemini.js';
import { genImageResilient, localgenHealth } from '../src/services/media.js';
import * as qloo from '../src/services/qloo.js';
import { fetchSite } from '../src/services/scraper.js';
import { enrichPrompt, inferKind, extractPalette } from '../src/services/promptStyle.js';
import { ENV, PORT } from '../src/config.js';

init();

let failures = 0;
async function check(name, fn, { skipOnQuota = false } = {}) {
  const t0 = Date.now();
  try {
    const detail = await fn();
    console.log(`PASS ${name} — ${detail} (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
  } catch (e) {
    if (e.skip) {
      console.log(`SKIP ${name} — ${e.message}`);
      return;
    }
    if (skipOnQuota && e.quota) {
      console.log(`SKIP ${name} — API path exercised; Google quota exhausted on all image models (re-run after quota reset)`);
      return;
    }
    failures++;
    console.log(`FAIL ${name} — ${String(e.message || e).slice(0, 300)}`);
  }
}

await check('tensor chat ping', async () => {
  if (!ENV.tensorKey) throw new Error('TENSOR_API_KEY missing');
  const out = await chat([
    { role: 'system', content: 'You are a ping service.' },
    { role: 'user', content: 'Reply with exactly: ready' },
  ], { maxTokens: 3000 });
  if (!out || !out.trim()) throw new Error('empty content');
  return `content="${out.trim().slice(0, 60)}"`;
});

await check('gemini genImage', async () => {
  if (!ENV.geminiKey) throw new Error('GEMINI_API_KEY missing');
  const p = await genImage('A single minimal flat icon of a coffee cup, centered, on a solid warm cream background. No text.', { aspectRatio: '1:1' });
  const abs = assetAbs(p);
  if (!abs) throw new Error(`asset not saved: ${p}`);
  const head = fs.readFileSync(abs).subarray(0, 4);
  const isPng = head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47;
  const isJpg = head[0] === 0xff && head[1] === 0xd8;
  if (!isPng && !isJpg) throw new Error(`bad magic bytes: ${head.toString('hex')}`);
  return `${p} ${isPng ? 'PNG' : 'JPEG'} ${fs.statSync(abs).size}B`;
}, { skipOnQuota: true });

await check('genImageResilient (gemini → pollinations fallback)', async () => {
  let r = null, lastErr = null;
  for (let i = 0; i < 4 && !r; i++) { // anonymous pollinations tier rate-limits intermittently
    try { r = await genImageResilient('A single minimal flat icon of a coffee cup, centered, on a solid warm cream background. No text.', { aspectRatio: '1:1' }); }
    catch (e) { lastErr = e; await new Promise((s) => setTimeout(s, 20000)); }
  }
  if (!r) throw lastErr;
  const abs = assetAbs(r.path);
  if (!abs) throw new Error(`asset not saved: ${r.path}`);
  const head = fs.readFileSync(abs).subarray(0, 4);
  const isPng = head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47;
  const isJpg = head[0] === 0xff && head[1] === 0xd8;
  if (!isPng && !isJpg) throw new Error(`bad magic bytes: ${head.toString('hex')}`);
  return `${r.path} via ${r.provider} ${isPng ? 'PNG' : 'JPEG'} ${fs.statSync(abs).size}B`;
});

await check('qloo status + insights', async () => {
  const s = qloo.status();
  // resolve a real entity first — a fixture id errors the whole insights call
  const sr = await qloo.searchEntities('Patagonia');
  // prefer a brand entity — first hit can be a place/geo record that the
  // insights signal rejects
  const eid = (sr.results || []).find((e) => (e.types || []).includes('urn:entity:brand'))?.id
    || (sr.results || []).find((e) => e.types?.length)?.id;
  if (!eid) throw new Error(`entity search failed: ${sr.error || 'no results'}`);
  const r = await qloo.insights({ type: 'urn:entity:artist', entities: [eid], take: 4 });
  if (!r.entities?.length) throw new Error(`no entities returned (${r.error || 'empty'})`);
  return `mode=${s.mode} top=${r.entities[0].name}`;
});

await check('scraper fetchSite example.com', async () => {
  const s = await fetchSite('https://example.com');
  if (!/example/i.test(s.title)) throw new Error(`unexpected title: ${s.title}`);
  return `title="${s.title}" textLen=${s.text.length}`;
});

// --- HTTP surface checks — lock in tonight's server fixes against live :PORT ---
const API = `http://127.0.0.1:${PORT}`;
const sleep = (ms) => new Promise((s) => setTimeout(s, ms));
// a local-dependent check marks itself SKIP rather than FAIL when the GPU
// service is down — same idea as skipOnQuota
const skip = (msg) => { const e = new Error(msg); e.skip = true; throw e; };
// a --watch reload (other agents editing server/src) drops the listener for a
// few seconds — ECONNREFUSED/ECONNRESET is transport, never a route failure.
// Retry ONCE, but only after the port actually answers again.
const connDrop = (e) => /ECONNREFUSED|ECONNRESET|EPIPE|ETIMEDOUT|fetch failed/i.test(String(e?.cause?.code || e?.message || e));
async function waitForApi(timeoutMs = 15000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try { await fetch(`${API}/api/status`, { signal: AbortSignal.timeout(1500) }); return true; }
    catch { await sleep(700); }
  }
  return false;
}
async function api(method, path, body) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(API + path, {
        method,
        headers: body !== undefined ? { 'content-type': 'application/json' } : undefined,
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
      let data = null;
      try { data = await res.json(); } catch { /* non-JSON body */ }
      return { status: res.status, body: data };
    } catch (e) {
      if (attempt === 0 && connDrop(e)) { await waitForApi(); continue; }
      throw e;
    }
  }
}
// binary endpoint (thumbs) — same retry, raw response back
async function raw(path) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(API + path);
      return { status: res.status, headers: res.headers, buf: await res.arrayBuffer() };
    } catch (e) {
      if (attempt === 0 && connDrop(e)) { await waitForApi(); continue; }
      throw e;
    }
  }
}
async function localgenUp() {
  if (!ENV.localgenUrl) return false;
  const h = await localgenHealth().catch(() => ({ ok: false }));
  return !!h.ok;
}
// poll the in-memory job runner to a terminal state — every long-poll in this
// suite must stay bounded or a hung job would hang the run
async function pollJob(id, deadlineMs = 60000) {
  const t0 = Date.now();
  while (Date.now() - t0 < deadlineMs) {
    const r = await api('GET', `/api/jobs/${id}`);
    if (r.status === 404) return { status: 'gone' }; // jobs map is in-memory — a reload loses it
    const j = r.body?.job;
    if (j && j.status !== 'running') return j;
    await sleep(4000);
  }
  return null; // still running at deadline — caller decides if that matters
}
// pixel dims straight off the wire bytes — PNG IHDR or a JPEG SOF scan. Lets
// the resize check verify the aspect a route actually rendered, not just 200.
function imgDims(buf) {
  const b = Buffer.from(buf);
  if (b.length > 24 && b[0] === 0x89 && b[1] === 0x50) return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
  if (b.length > 4 && b[0] === 0xff && b[1] === 0xd8) {
    for (let off = 2; off + 9 < b.length;) {
      if (b[off] !== 0xff) { off++; continue; }
      const marker = b[off + 1], len = b.readUInt16BE(off + 2);
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { off += 2; continue; }
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker))
        return { h: b.readUInt16BE(off + 5), w: b.readUInt16BE(off + 7) };
      off += 2 + len;
    }
  }
  return null; // webp/gif/unknown — caller soft-asserts
}
// registered rasters that resolve through /api/images/:id — registry ids
// first (id lookup), then creative imagePath basenames (/assets/<base>
// lookup). No GET route lists the registry, so candidates are verified live
// by the POST itself: a stale row just 404s and the next is tried.
async function imageCandidates() {
  const reg = (list('images') || []).filter((i) => /\.(png|jpe?g|webp)$/i.test(i?.path || '') && assetAbs(i.path));
  const seen = new Set(reg.map((i) => i.path));
  const extra = [];
  for (const c of (await api('GET', '/api/campaigns')).body?.campaigns || []) {
    for (const cr of c.creatives || []) {
      if (/\.(png|jpe?g|webp)$/i.test(cr?.imagePath || '') && !seen.has(cr.imagePath) && assetAbs(cr.imagePath))
        extra.push(cr.imagePath.split('/').pop());
    }
  }
  return [...reg.slice(-6).reverse().map((i) => i.id), ...extra.slice(0, 4)];
}
let smokeImageRef = null;    // raster ref resolved once — resize + animate share it
let smokeAnimateJobId = null; // fired ahead of the resize check so the video gen overlaps

await check('http api reachable', async () => {
  const r = await api('GET', '/api/status');
  if (r.status !== 200 || !r.body) throw new Error(`GET /api/status → ${r.status} — is the server running on :${PORT}?`);
  return `${API} 200`;
});

await check('status shape: localgen + qloo fields', async () => {
  const r = await api('GET', '/api/status');
  const lg = r.body?.localgen;
  if (!lg || lg.ok !== true) throw new Error(`localgen.ok=${lg?.ok} (configured=${lg?.configured} mode=${lg?.mode})`);
  if (!/sdxl/i.test(String(lg.model || ''))) throw new Error(`localgen.model="${lg.model}" — expected sdxl variant`);
  if (!('qloo' in r.body)) throw new Error('qloo field missing from /api/status');
  return `localgen=${lg.model} ok=true qloo=${r.body.qloo}`;
});

await check('status agent honesty: ok + model reported', async () => {
  const r = await api('GET', '/api/status');
  const a = r.body?.agent;
  if (r.status !== 200 || !a) throw new Error('agent field missing from /api/status');
  // the chat/copy brain must report itself honestly: reachable AND naming the
  // model actually answering — a green light with no model is PR, not status
  if (a.ok !== true) throw new Error(`agent.ok=${a.ok} provider=${a.provider} error=${a.error || 'none'}`);
  if (!a.model) throw new Error('agent.model missing — honesty requires naming the model in use');
  return `provider=${a.provider} model=${a.model} ok=true${a.lastCallOk === false ? ' (note: lastCallOk=false)' : ''}`;
});

await check('campaign create dedupes on board+strategy+title', async () => {
  const title = `smoke dedupe ${Date.now()}`;
  const payload = { boardId: 'smoke-dedupe-board', strategyId: 'smoke-dedupe-strat', brief: { title } };
  const r1 = await api('POST', '/api/campaigns', payload);
  const id = r1.body?.campaign?.id;
  if (r1.status !== 200 || !id) throw new Error(`first create → ${r1.status} ${JSON.stringify(r1.body)?.slice(0, 160)}`);
  let stray = null;
  try {
    const r2 = await api('POST', '/api/campaigns', payload);
    if (r2.body?.campaign?.id && r2.body.campaign.id !== id) stray = r2.body.campaign.id; // a real duplicate — needs cleanup too
    if (r2.body?.deduplicated !== true || r2.body?.campaign?.id !== id)
      throw new Error(`second create not deduped → ${JSON.stringify(r2.body)?.slice(0, 200)}`);
    const lst = await api('GET', '/api/campaigns');
    const hits = (lst.body?.campaigns || []).filter((c) => c.brief?.title === title);
    if (hits.length !== 1) throw new Error(`title listed ${hits.length}x, expected exactly once`);
    return `id=${id.slice(0, 8)} deduplicated:true, title listed once`;
  } finally {
    await api('DELETE', `/api/campaigns/${id}`);
    if (stray) await api('DELETE', `/api/campaigns/${stray}`);
  }
});

await check('failed+empty campaigns filtered from list', async () => {
  // no HTTP path lands a campaign in genStatus:'error' with 0 creatives (per-
  // creative failures still produce creative records), and the store is
  // in-memory in the server process — so assert the filter's shape on the
  // live list: nothing listed may be both failed and empty.
  const r = await api('GET', '/api/campaigns');
  const campaigns = r.body?.campaigns || [];
  const bad = campaigns.filter((c) => c.genStatus === 'error' && !(c.creatives || []).length);
  if (bad.length) throw new Error(`${bad.length} failed+empty campaign(s) listed: ${bad.map((c) => c.id.slice(0, 8)).join(',')}`);
  return `${campaigns.length} listed, none failed-and-empty`;
});

await check('demo-video refuses when no own/board site to film', async () => {
  // the regression locked in: a campaign with no site in scope must get 400
  // 'no website … to film' — never a 200 that quietly films a stranger's.
  // filmableSite's scope is replicated exactly: own campaign → a sibling on
  // the same board → a producedFrom.strategyTitle in the campaign's/board's
  // strategy titles. Board detail routes give the full title set (the list
  // route's `titles` is truncated to 3).
  const [cs, ws] = await Promise.all([api('GET', '/api/campaigns'), api('GET', '/api/websites')]);
  const campaigns = cs.body?.campaigns || [], sites = ws.body?.websites || [];
  const boardSeen = {}; // boardId → {exists, titles[]} — a deleted board means no siblings, matching find('boards')
  for (const id of [...new Set(campaigns.map((c) => c.boardId).filter(Boolean))]) {
    const b = await api('GET', `/api/boards/${id}`);
    boardSeen[id] = { exists: b.status === 200, titles: (b.body?.board?.strategies || []).map((s) => s?.title).filter(Boolean) };
  }
  const filmless = campaigns.find((c) => {
    const bd = c.boardId ? boardSeen[c.boardId] : null;
    const stratTitles = new Set([c.strategyTitle, ...(bd?.exists ? bd.titles : [])].filter(Boolean));
    const siblingIds = bd?.exists ? new Set(campaigns.filter((x) => x.boardId === c.boardId).map((x) => x.id)) : new Set();
    return !sites.some((w) =>
      w.producedFrom?.campaignId === c.id
      || siblingIds.has(w.producedFrom?.campaignId)
      || (w.producedFrom?.strategyTitle && stratTitles.has(w.producedFrom.strategyTitle)));
  });
  if (!filmless) skip('every campaign on record has a site in scope — nothing filmless to probe');
  const r = await api('POST', `/api/campaigns/${filmless.id}/demo-video`);
  if (r.status !== 400 || !/no website.*to film/i.test(String(r.body?.error || '')))
    throw new Error(`→ ${r.status} ${JSON.stringify(r.body)?.slice(0, 160)} — want 400 'no website … to film' (a 200 films a stranger's site)`);
  const miss = await api('POST', '/api/campaigns/smoke-no-such-campaign/demo-video');
  if (miss.status !== 404) throw new Error(`unknown campaign → ${miss.status}, want 404`);
  return `campaign=${filmless.id.slice(0, 8)} "${String(filmless.brief?.title || '').slice(0, 30)}" → 400 "${r.body.error.slice(0, 60)}"; unknown id → 404`;
});

await check('brandbook unpublish idempotent', async () => {
  const pre = await api('GET', '/api/brandbook');
  const slug = pre.body?.book?.publishedSlug || null; // restore afterwards — book may be live
  try {
    const u1 = await api('POST', '/api/brandbook/unpublish');
    if (u1.status !== 200) throw new Error(`first unpublish → ${u1.status} ${JSON.stringify(u1.body)?.slice(0, 120)}`);
    const u2 = await api('POST', '/api/brandbook/unpublish');
    if (u2.status !== 200) throw new Error(`second unpublish → ${u2.status} ${JSON.stringify(u2.body)?.slice(0, 120)}`);
    for (const [n, b] of [[1, u1.body], [2, u2.body]]) {
      // contract: {ok:true} with no book, or {book} with publishedSlug gone
      const clean = b && (b.ok === true || ('book' in b && !b.book?.publishedSlug));
      if (!clean) throw new Error(`unpublish ${n} bad body → ${JSON.stringify(b)?.slice(0, 120)}`);
    }
    const post = await api('GET', '/api/brandbook');
    if (post.body?.book?.publishedSlug) throw new Error('publishedSlug survived unpublish');
    return `200 twice, idempotent (${slug ? 'book existed — republished after' : 'no book — {ok:true} path'})`;
  } finally {
    if (slug) {
      const rp = await api('POST', '/api/brandbook/publish', { slug });
      if (rp.body?.publishedSlug !== slug) console.log(`WARN smoke: book restore failed — republish manually (slug ${slug})`);
    }
  }
});

await check('image resize 404s cleanly on unknown id', async () => {
  const r = await api('POST', '/api/images/smoke-no-such-image/resize', { aspect: '1:1' });
  if (r.status !== 404) throw new Error(`expected 404, got ${r.status}`);
  if (!r.body?.error) throw new Error(`no JSON error body: ${JSON.stringify(r.body)?.slice(0, 120)}`);
  return `404 {"error":"${r.body.error}"}`;
});

await check('refs requests reach the local img2img engine', async () => {
  // stub-level: kill every provider endpoint via fetch + dead localgen URL,
  // then read the attempted-provider list out of the thrown error. No network.
  // Contract (post-img2img): refs no longer drop local — local forwards the
  // reference to /generate as `image` (img2img) and leads the chain.
  const realFetch = globalThis.fetch;
  const oldUrl = ENV.localgenUrl;
  const oldMode = ENV.localgenProvider;
  ENV.localgenUrl = 'http://127.0.0.1:9'; // dead — local must fail fast when attempted
  ENV.localgenProvider = 'local-first';   // pin the chain order under test
  globalThis.fetch = async () => { throw new Error('smoke: network stubbed'); };
  try {
    const attempt = (opts) => genImageResilient('smoke refs probe', opts)
      .then(() => null)
      .catch((e) => e);
    const eRefs = await attempt({ refs: [{ path: '/assets/smoke-missing.png' }], aspectRatio: '1:1' });
    if (!eRefs) throw new Error('refs call unexpectedly succeeded under stub');
    if (!/local\(/i.test(eRefs.message)) throw new Error(`local skipped despite img2img refs support: ${eRefs.message.slice(0, 200)}`);
    const tried = (eRefs.message.match(/(local|gemini|pollinations)\(/gi) || []).join(' ');
    return `refs chain attempted: ${tried} (local img2img leads)`;
  } finally {
    globalThis.fetch = realFetch;
    ENV.localgenUrl = oldUrl;
    ENV.localgenProvider = oldMode;
  }
});

// --- tonight's surfaces — moodboard job, photoshoot lifecycle, profile patch,
// caller-pinned regen refs, thumbnail route. Fixtures resolve live from the API
// (boards/campaigns/profile), nothing hardcoded.
let moodboardJobId = null; // shared so later local checks can drain the GPU queue first

await check('moodboard POST dedupes an in-flight job', async () => {
  if (!(await localgenUp())) skip('localgen down — moodboard tiles are local-only');
  const boards = (await api('GET', '/api/boards')).body?.boards || [];
  const board = boards.find((b) => (b.strategyCount || 0) > 0) || boards[0];
  if (!board) skip('no boards on record to moodboard');
  const r1 = await api('POST', `/api/boards/${board.id}/moodboard`);
  const jobId = r1.body?.job?.id;
  if (![200, 202].includes(r1.status) || !jobId)
    throw new Error(`POST → ${r1.status} ${JSON.stringify(r1.body)?.slice(0, 160)}`);
  moodboardJobId = jobId;
  const r2 = await api('POST', `/api/boards/${board.id}/moodboard`);
  if (r2.body?.deduplicated !== true || r2.body?.job?.id !== jobId)
    throw new Error(`re-POST not deduped onto the live job → ${JSON.stringify(r2.body)?.slice(0, 200)}`);
  // mid-run GET is honest either way: {moodboard[,job]} once tiles exist, or
  // 404 {error, job} while a board-less first run is still going
  const g = await api('GET', `/api/boards/${board.id}/moodboard`);
  const tiles = g.body?.moodboard?.tiles;
  if (g.status === 200) {
    if (!Array.isArray(tiles) || !tiles.length) throw new Error('200 but no moodboard.tiles');
    const bad = tiles.find((t) => !/^\/assets\/[\w.-]+$/.test(t?.path || ''));
    if (bad) throw new Error(`tile path malformed → ${JSON.stringify(bad).slice(0, 120)}`);
  } else if (!(g.status === 404 && g.body?.job?.id === jobId)) {
    throw new Error(`GET mid-run → ${g.status} ${JSON.stringify(g.body)?.slice(0, 160)}`);
  }
  // the gen is ~9 sequential sdxl-turbo calls (~50s) — poll is cheap, bound it;
  // a terminal 'error' is a real break, 'still running' just frees the GPU later
  const done = await pollJob(jobId, 70000);
  if (done?.status === 'error') throw new Error(`moodboard job errored — ${String(done.error).slice(0, 160)}`);
  const tail = done?.status === 'done'
    ? `done tiles=${done.result?.tiles} via ${done.result?.provider}`
    : done?.status === 'gone' ? 'job gone (server reloaded mid-run)' : 'still running at 70s deadline';
  return `board=${board.id.slice(0, 8)} job=${jobId.slice(0, 8)} deduplicated:true; GET tiles=${tiles?.length || 0}; ${tail}`;
});

await check('moodboard routes 404 on unknown board', async () => {
  for (const m of ['POST', 'GET']) {
    const r = await api(m, '/api/boards/smoke-no-such-board/moodboard');
    if (r.status !== 404 || !r.body?.error)
      throw new Error(`${m} → ${r.status} ${JSON.stringify(r.body)?.slice(0, 120)}, want 404 {error}`);
  }
  return 'POST + GET unknown board → 404 {error}';
});

await check('profile PUT patch round-trips tone', async () => {
  const pre = await api('GET', '/api/profile');
  if (pre.status !== 200) throw new Error(`GET /api/profile → ${pre.status}`);
  if (!pre.body?.profile) skip('no profile on record to patch');
  const before = Array.isArray(pre.body.profile.tone) ? pre.body.profile.tone : [];
  const probe = ['smoke-tone'];
  try {
    const put = await api('PUT', '/api/profile', { patch: { tone: probe } });
    if (put.status !== 200 || !Array.isArray(put.body?.profile?.tone))
      throw new Error(`PUT {patch:{tone}} → ${put.status} ${JSON.stringify(put.body)?.slice(0, 140)}`);
    const mid = await api('GET', '/api/profile');
    if (JSON.stringify(mid.body?.profile?.tone || []) !== JSON.stringify(probe))
      throw new Error(`GET after patch → tone=${JSON.stringify(mid.body?.profile?.tone).slice(0, 120)}`);
    const back = await api('PUT', '/api/profile', { patch: { tone: before } });
    const post = await api('GET', '/api/profile');
    if (back.status !== 200 || JSON.stringify(post.body?.profile?.tone || []) !== JSON.stringify(before))
      throw new Error('restore did not round-trip the original tone');
    return `patch → reflected → restored (${JSON.stringify(before).slice(0, 80)})`;
  } finally {
    // belt-and-suspenders: a mid-assert throw must not leave the probe behind
    const cur = await api('GET', '/api/profile').catch(() => null);
    if (cur && JSON.stringify(cur.body?.profile?.tone || []) !== JSON.stringify(before))
      await api('PUT', '/api/profile', { patch: { tone: before } }).catch(() => {});
  }
});

await check('profile images array round-trips intact', async () => {
  const pre = await api('GET', '/api/profile');
  if (pre.status !== 200) throw new Error(`GET /api/profile → ${pre.status}`);
  if (!pre.body?.profile) skip('no profile on record to patch');
  const before = pre.body.profile.images;
  if (!Array.isArray(before) || !before.length) skip('profile has no images array to round-trip');
  try {
    // the wipe this locks in: applyPatch replaces arrays wholesale, so a
    // partial images[] shrinks the library. The contract under test is that
    // the FULL just-read array goes back verbatim — every id, every caption.
    const put = await api('PUT', '/api/profile', { patch: { images: before } });
    if (put.status !== 200) throw new Error(`PUT {patch:{images}} → ${put.status} ${JSON.stringify(put.body)?.slice(0, 140)}`);
    const got = (await api('GET', '/api/profile')).body?.profile?.images;
    if (!Array.isArray(got) || got.length !== before.length)
      throw new Error(`images ${before.length} → ${Array.isArray(got) ? got.length : 'gone'} after round-trip`);
    const byId = new Map(got.map((g) => [g?.id, g]));
    const lost = before.filter((i) => !byId.has(i?.id));
    if (lost.length) throw new Error(`dropped ids: ${lost.map((i) => String(i?.id).slice(0, 8)).join(',')}`);
    const drift = before.filter((i) => byId.get(i?.id)?.caption !== i?.caption);
    if (drift.length) throw new Error(`caption drift on ${drift.length} image(s): ${drift.map((i) => String(i?.id).slice(0, 8)).join(',')}`);
    const capN = before.filter((i) => i?.caption).length;
    return `${before.length} images round-tripped verbatim (${capN} captioned, all preserved)`;
  } finally {
    // restore on any failure — leaving a half-written array IS the wipe
    const cur = await api('GET', '/api/profile').catch(() => null);
    if (cur && JSON.stringify(cur.body?.profile?.images || null) !== JSON.stringify(before))
      await api('PUT', '/api/profile', { patch: { images: before } }).catch(() => {});
  }
});

await check('thumbnail route renders + clamps w', async () => {
  // a real raster asset — profile library first, then any creative image
  const prof = (await api('GET', '/api/profile')).body?.profile;
  let asset = (prof?.images || []).map((i) => i?.path).find((p) => /\.(png|jpe?g|webp|gif)$/i.test(p || ''));
  if (!asset) {
    const cs = (await api('GET', '/api/campaigns')).body?.campaigns || [];
    outer: for (const c of cs) for (const cr of c.creatives || []) {
      if (/\.(png|jpe?g|webp|gif)$/i.test(cr?.imagePath || '')) { asset = cr.imagePath; break outer; }
    }
  }
  if (!asset) skip('no raster asset on record to thumb');
  const base = asset.split('/').pop();
  const t1 = await raw(`/assets/thumb/${base}?w=160`);
  const mime = t1.headers.get('content-type') || '';
  const len = Number(t1.headers.get('content-length')) || t1.buf.byteLength;
  if (t1.status !== 200) throw new Error(`w=160 → ${t1.status}`);
  if (!/^image\/(jpeg|png)/.test(mime)) throw new Error(`content-type "${mime}"`);
  if (!(len > 0 && len < 50 * 1024)) throw new Error(`thumb ${len}B — expected <50KB`);
  const t2 = await raw(`/assets/thumb/${base}?w=99999`);
  if (t2.status !== 200) throw new Error(`w=99999 → ${t2.status} (clamp to 2048 must never 5xx)`);
  return `${base.slice(0, 8)}… w=160 ${mime} ${len}B; w=99999 clamped → 200`;
});

await check('regenerate-image honors caller-pinned refs', async () => {
  if (moodboardJobId) await pollJob(moodboardJobId, 60000); // drain tiles so local isn't queued behind the grid
  if (!(await localgenUp())) skip('localgen down — provider pinned to local');
  const cs = (await api('GET', '/api/campaigns')).body?.campaigns || [];
  const target = cs.flatMap((c) => c.creatives || []).find((cr) => cr?.imagePath);
  if (!target) skip('no creative on record to regenerate');
  const ref = target.imagePath; // the creative's own art — exactly what the UI pins
  const r = await api('POST', `/api/creatives/${target.id}/regenerate-image`, { refs: [{ path: ref }], provider: 'local' });
  const cr = r.body?.creative;
  if (r.status !== 200 || !cr) throw new Error(`POST → ${r.status} ${JSON.stringify(r.body)?.slice(0, 160)}`);
  if (cr.imageError) throw new Error(`regen errored with a pinned ref — ${cr.imageError}`);
  if (!/^local/.test(String(cr.imageProvider || '')))
    throw new Error(`imageProvider="${cr.imageProvider}" — provider:'local' pin ignored`);
  // a traversal-shaped ref must be dropped server-side — it can never reach
  // localgen (which would surface it in creative.imageError)
  const evil = await api('POST', `/api/creatives/${target.id}/regenerate-image`, { refs: [{ path: '/assets/../../etc/passwd' }], provider: 'local' });
  if (evil.status === 200) {
    if (/passwd|not readable/i.test(JSON.stringify(evil.body || {})))
      throw new Error(`malformed ref reached the provider → ${JSON.stringify(evil.body?.creative?.imageError).slice(0, 160)}`);
  } else if (evil.status !== 400) {
    throw new Error(`malformed ref → ${evil.status}, want 400 or a clean drop`);
  }
  return `creative=${target.id.slice(0, 8)} → ${cr.imageProvider} w/ pinned ref; /assets/../../etc/passwd ${evil.status === 400 ? '400s' : 'dropped'}`;
});

await check('photoshoot job lifecycle + delete frees assets', async () => {
  if (!(await localgenUp())) skip('localgen down — shoot gen would crawl the paid fallback chain');
  const marker = `smoke probe ${Date.now()}`; // unique — retry/concurrent strays share it
  const r = await api('POST', '/api/photoshoot', { mode: 'free', prompt: `${marker} — matte black water can on raw concrete, single hard light`, templates: ['studio'] });
  const jobId = r.body?.job?.id, shotId = r.body?.shoot?.id;
  if (r.status !== 200 || !jobId || !shotId)
    throw new Error(`POST → ${r.status} ${JSON.stringify(r.body)?.slice(0, 160)}`);
  let deleted = false;
  try {
    const job = await pollJob(jobId, 60000);
    if (job?.status === 'error') throw new Error(`shoot job errored — ${String(job.error).slice(0, 160)}`);
    const listed = await api('GET', '/api/photoshoot');
    const rec = (listed.body?.jobs || []).find((s) => s.id === shotId);
    if (!rec) throw new Error('shoot missing from GET /api/photoshoot');
    if (job?.status === 'done' && rec.status !== 'done')
      throw new Error(`job done but shoot.status="${rec.status}"`);
    const del = await api('DELETE', `/api/photoshoot/${shotId}`);
    deleted = true;
    if (del.status !== 200 || typeof del.body?.freedAssets !== 'number')
      throw new Error(`DELETE → ${del.status} ${JSON.stringify(del.body)?.slice(0, 140)} — freedAssets must be a number`);
    const tail = job ? `job ${job.status}${job.result ? ` n=${job.result.n}` : ''}` : 'still running at 60s deadline (accepted)';
    return `shot=${shotId.slice(0, 8)} listed status=${rec.status}; ${tail}; freedAssets=${del.body.freedAssets}`;
  } finally {
    // sweep by marker too — a connDrop-retried POST can mint a second shot the
    // tracked id doesn't cover
    if (!deleted) await api('DELETE', `/api/photoshoot/${shotId}`).catch(() => {});
    const lst = await api('GET', '/api/photoshoot').catch(() => null);
    for (const s of (lst?.body?.jobs || []).filter((x) => String(x.prompt || '').startsWith(marker)))
      await api('DELETE', `/api/photoshoot/${s.id}`).catch(() => {});
  }
});

// the animate POST returns instantly (in-memory job runner) — fire it here so
// its video gen overlaps the resize gens below; the animate check asserts its
// terminal state. No ref (or a transport drop) → each check resolves its own.
try {
  const ref = (await imageCandidates())[0];
  if (ref) {
    const a = await api('POST', `/api/images/${encodeURIComponent(ref)}/animate`);
    if (a.status === 200 && a.body?.job?.id) { smokeAnimateJobId = a.body.job.id; smokeImageRef = ref; }
  }
} catch { /* prelude is best-effort — the animate check retries for real */ }

await check('image resize: real id → 16:9, bogus aspect → 1:1', async () => {
  const created = []; // minted image ids — released via catalog pin+delete in finally
  try {
    const cands = await imageCandidates();
    if (!cands.length) skip('no raster image on record to resize');
    let r = null, used = null;
    for (const id of cands) {
      const t = await api('POST', `/api/images/${encodeURIComponent(id)}/resize`, { aspect: '16:9' });
      if (t.status === 404) continue; // stale registry row — try the next
      r = t; used = id; break;
    }
    if (!r) throw new Error(`every candidate 404'd (${cands.length} tried)`);
    if (r.status !== 200 || !r.body?.image?.imagePath) throw new Error(`16:9 resize → ${r.status} ${JSON.stringify(r.body)?.slice(0, 160)}`);
    created.push(r.body.image.id);
    const head = await raw(`/assets/${r.body.image.imagePath.split('/').pop()}`);
    if (head.status !== 200 || !head.buf.byteLength) throw new Error(`resized asset → ${head.status} ${head.buf.byteLength}B`);
    const d = imgDims(head.buf);
    if (d && Math.abs(d.w / d.h - 16 / 9) > 0.08) throw new Error(`asked 16:9, got ${d.w}x${d.h}`);
    const r2 = await api('POST', `/api/images/${encodeURIComponent(used)}/resize`, { aspect: 'bogus' });
    if (r2.status !== 200 || !r2.body?.image?.imagePath) throw new Error(`bogus-aspect resize → ${r2.status} ${JSON.stringify(r2.body)?.slice(0, 160)}`);
    created.push(r2.body.image.id);
    const head2 = await raw(`/assets/${r2.body.image.imagePath.split('/').pop()}`);
    const d2 = head2.status === 200 ? imgDims(head2.buf) : null;
    if (d2 && Math.abs(d2.w / d2.h - 1) > 0.08) throw new Error(`bogus aspect → ${d2.w}x${d2.h}, not the 1:1 default`);
    return `id=${used.slice(0, 8)} 16:9→${d ? `${d.w}x${d.h}` : 'asset 200'} via ${r.body.image.provider}; bogus→${d2 ? `${d2.w}x${d2.h}` : '1:1'}`;
  } finally {
    // no unregister route — pin each minted image into catalog, then delete
    // the item: releaseAsset unlinks file + registry row iff nothing refs it
    for (const id of created) {
      const pin = await api('PUT', `/api/images/${id}`, { target: 'catalog', name: 'smoke resize cleanup' }).catch(() => null);
      const itemId = pin?.body?.item?.id;
      if (itemId) await api('DELETE', `/api/catalog/${itemId}`).catch(() => {});
    }
    const cat = await api('GET', '/api/catalog').catch(() => null); // sweep a stranded pin
    for (const it of (cat?.body?.items || cat?.body?.catalog || []).filter((x) => x?.name === 'smoke resize cleanup'))
      await api('DELETE', `/api/catalog/${it.id}`).catch(() => {});
  }
});

await check('image animate job reaches a terminal state', async () => {
  // reuse the job fired before the resize check; if that prelude never got a
  // job off (no ref, transport drop), resolve + fire one here instead
  let jobId = smokeAnimateJobId;
  if (!jobId) {
    const ref = smokeImageRef || (await imageCandidates())[0];
    if (!ref) skip('no registered raster to animate');
    const r = await api('POST', `/api/images/${encodeURIComponent(ref)}/animate`);
    if (r.status === 404) skip(`resolved ref went stale before animate — ${ref.slice(0, 8)}`);
    jobId = r.body?.job?.id;
    if (r.status !== 200 || !jobId) throw new Error(`POST → ${r.status} ${JSON.stringify(r.body)?.slice(0, 140)}`);
  }
  const j = await pollJob(jobId, 100000);
  if (!j) throw new Error('still running at 100s deadline — never reached a terminal state');
  // 'gone' means a --watch reload dropped the in-memory map — transport, not
  // a route failure. 'error' is reported but tolerated: ffmpeg fallback makes
  // 'done' the usual landing, and what this locks in is a TERMINAL state.
  if (j.status === 'gone') return `job=${jobId.slice(0, 8)} map lost mid-run (server reload)`;
  if (!['done', 'error'].includes(j.status)) throw new Error(`job.status="${j.status}" — expected terminal`);
  if (j.status === 'error') return `job=${jobId.slice(0, 8)} errored (tolerated) — ${String(j.error).slice(0, 120)}`;
  const vp = j.result?.videoPath;
  if (!/^\/assets\/[\w.-]+\.mp4$/.test(vp || '')) throw new Error(`done but no videoPath → ${JSON.stringify(j.result)?.slice(0, 120)}`);
  const abs = assetAbs(vp);
  if (abs) try { fs.unlinkSync(abs); } catch { /* already gone — it was unreferenced */ }
  return `job=${jobId.slice(0, 8)} done provider=${j.result?.provider} video=${vp.split('/').pop().slice(0, 12)}… (unlinked)`;
});

// --- promptStyle unit checks (no server, no network) ---
await check('enrichPrompt splices early + idempotent', async () => {
  const src = 'headline prompt about a product.';
  const once = enrichPrompt(src);
  if (once === src) throw new Error('no enrichment applied');
  const idx = once.indexOf('Shot detail:');
  if (idx < 0) throw new Error('Shot detail clause missing');
  if (idx >= 240) throw new Error(`Shot detail at char ${idx} — outside the 77-token encoder window`);
  const twice = enrichPrompt(once);
  if (twice !== once) throw new Error('not idempotent — second enrich mutated the prompt');
  return `clause@${idx}, enrich(enrich(x))===enrich(x)`;
});

await check('enrichPrompt never duplicates existing cues', async () => {
  const src = 'Lifestyle ad shot on 85mm with softbox light.';
  const out = enrichPrompt(src);
  const mm = (out.match(/\b\d{2,3}mm\b/g) || []).length;
  if (mm !== 1) throw new Error(`lens cue duplicated over 85mm source (${mm} mm mentions)`);
  if (/bokeh|depth of field|softbox/i.test(out.replace(src, ''))) throw new Error('duplicated covered cue territory');
  if (enrichPrompt('keep me verbatim', { enrich: false }) !== 'keep me verbatim') throw new Error('enrich:false did not return the original');
  return '85mm+softbox respected, enrich:false passthrough';
});

await check('inferKind + extractPalette classify sanely', async () => {
  const kinds = [
    ['New print ad for the spring launch', 'ad'],
    ['Studio product shot for the fall catalog', 'photoshoot'],
    ['Landing page hero banner', 'hero'],
    ['Animate this frame — mid-action product video', 'motion'],
    ['A quiet picture of a dog', 'generic'],
    ['Reframe and extend this image to a 16:9 composition', 'generic'],
  ];
  for (const [p, want] of kinds) {
    const got = inferKind(p);
    if (got !== want) throw new Error(`inferKind("${p.slice(0, 40)}…")=${got}, want ${want}`);
  }
  const pal = extractPalette('brand colors #AABBCC and #112233 here');
  if (pal.join(',') !== '#aabbcc,#112233') throw new Error(`prompt hexes → ${pal.join(',')}`);
  const palObj = extractPalette('no hexes', { primary: '#FF0000', accent: '#00ff00' });
  if (!palObj.includes('#ff0000') || !palObj.includes('#00ff00')) throw new Error(`opts.palette ignored → ${palObj.join(',')}`);
  const palDup = extractPalette('#AABBCC then #aabbcc again');
  if (palDup.length !== 1 || palDup[0] !== '#aabbcc') throw new Error(`dedupe/lowercase broken → ${palDup.join(',')}`);
  return 'kinds ok; hexes lowercased+deduped; opts.palette honored';
});

console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
process.exit(failures ? 1 : 0);
