// smoke.js — sequential REAL integration checks (tensor, gemini image, qloo, scraper)
import fs from 'node:fs';
import { init, assetAbs } from '../src/services/store.js';
import { chat } from '../src/services/tensor.js';
import { genImage } from '../src/services/gemini.js';
import { genImageResilient } from '../src/services/media.js';
import * as qloo from '../src/services/qloo.js';
import { fetchSite } from '../src/services/scraper.js';
import { ENV } from '../src/config.js';

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
  const r = await qloo.insights({ type: 'urn:entity:artist', entities: ['fixture:brand:patagonia'], take: 4 });
  if (!r.entities.length) throw new Error('no entities returned');
  return `mode=${s.mode} top=${r.entities[0].name}`;
});

await check('scraper fetchSite example.com', async () => {
  const s = await fetchSite('https://example.com');
  if (!/example/i.test(s.title)) throw new Error(`unexpected title: ${s.title}`);
  return `title="${s.title}" textLen=${s.text.length}`;
});

console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
process.exit(failures ? 1 : 0);
