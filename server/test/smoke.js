// smoke.js — sequential REAL integration checks (tensor, gemini image, qloo, scraper)
import fs from 'node:fs';
import { init, assetAbs } from '../src/services/store.js';
import { chat } from '../src/services/tensor.js';
import { genImage } from '../src/services/gemini.js';
import { genImageResilient } from '../src/services/media.js';
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
async function api(method, path, body) {
  const res = await fetch(API + path, {
    method,
    headers: body !== undefined ? { 'content-type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch { /* non-JSON body */ }
  return { status: res.status, body: data };
}

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
