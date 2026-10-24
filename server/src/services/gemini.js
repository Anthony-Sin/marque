// Gemini API: image generation/edits (gemini image model) + Veo long-running video
import { ENV } from '../config.js';
import { tuning } from '../tuning.js';
import { saveAssetBuf, readAsset } from './store.js';

const G = 'https://generativelanguage.googleapis.com/v1beta';

export function geminiConfigured() { return !!ENV.geminiKeys?.length || !!ENV.geminiKey; }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// key pool: round-robin spreads load across AI Studio projects; a 429 on one
// key jumps to the next instead of burning the whole fallback chain
let keyIdx = 0;
const pool = () => (ENV.geminiKeys?.length ? ENV.geminiKeys : [ENV.geminiKey].filter(Boolean));
function nextKey() {
  const p = pool();
  if (!p.length) return '';
  const k = p[keyIdx % p.length];
  keyIdx = (keyIdx + 1) % p.length;
  return k;
}
export function geminiKeyCount() { return pool().length; }

// env-pinned model first, then known image-capable fallbacks (deprecation/quota safety)
const IMAGE_FALLBACKS = tuning('geminiImageFallbacks');
const VIDEO_FALLBACKS = tuning('geminiVideoFallbacks');

function refPart(ref) {
  if (!ref) return null;
  if (ref.inline_data || ref.inlineData) return ref.inline_data ? { inline_data: ref.inline_data } : { inline_data: ref.inlineData };
  if (ref.data) return { inline_data: { mime_type: ref.mime || ref.mime_type || 'image/png', data: ref.data } };
  const p = ref.path || ref.imagePath || (typeof ref === 'string' ? ref : null);
  if (p) {
    const a = readAsset(p);
    if (a) return { inline_data: { mime_type: a.mime, data: a.buf.toString('base64') } };
  }
  return null;
}

async function post(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  let data = null;
  try { data = await res.json(); } catch { /* fallthrough */ }
  if (!res.ok) {
    const e = new Error(`gemini ${res.status}: ${JSON.stringify(data)?.slice(0, 400) || res.statusText}`);
    e.status = res.status;
    e.quota = res.status === 429;
    throw e;
  }
  return data;
}

async function tryImageModel(model, prompt, opts, parts) {
  const makeBody = (withAR) => {
    const generationConfig = { responseModalities: ['TEXT', 'IMAGE'] };
    if (withAR && opts.aspectRatio) generationConfig.imageConfig = { aspectRatio: opts.aspectRatio };
    return { contents: [{ parts: [{ text: prompt }, ...parts] }], generationConfig };
  };
  const url = `${G}/models/${model}:generateContent?key=${nextKey()}`;
  let data;
  try {
    data = await post(url, makeBody(true));
  } catch (e) {
    if (opts.aspectRatio && e.status === 400) data = await post(url, makeBody(false)); // retry without imageConfig
    else throw e;
  }
  const out = data?.candidates?.[0]?.content?.parts || [];
  for (const p of out) {
    const inline = p.inlineData || p.inline_data;
    if (inline?.data) {
      const mime = inline.mimeType || inline.mime_type || 'image/png';
      const ext = mime.includes('jpeg') || mime.includes('jpg') ? 'jpg' : mime.includes('webp') ? 'webp' : 'png';
      return saveAssetBuf(Buffer.from(inline.data, 'base64'), ext);
    }
  }
  throw new Error(`gemini: no image part in response (${JSON.stringify(data)?.slice(0, 300)})`);
}

// prompt: string; opts: {aspectRatio, refs:[{path}|{mime,data}]}
export async function genImage(prompt, opts = {}) {
  if (!geminiConfigured()) throw new Error('gemini not configured');
  const parts = [];
  for (const ref of opts.refs || opts.images || []) {
    const part = refPart(ref);
    if (part) parts.push(part);
  }
  const models = [...new Set([ENV.geminiImageModel, ...IMAGE_FALLBACKS])];
  const errs = [];
  for (const model of models) {
    try {
      return await tryImageModel(model, prompt, opts, parts);
    } catch (e) {
      errs.push(`${model}: ${String(e.message).slice(0, 120)}`);
      if (e.status === 503) { // transient overload — one retry on the same model
        await sleep(4000);
        try { return await tryImageModel(model, prompt, opts, parts); }
        catch (e2) { errs.push(`${model} retry: ${String(e2.message).slice(0, 120)}`); }
      }
    }
  }
  const allQuota = errs.length && errs.every((s) => /429|quota|RESOURCE_EXHAUSTED/i.test(s));
  const e = new Error(`gemini: all image models failed (${allQuota ? 'quota exhausted' : errs.join(' | ').slice(0, 400)})`);
  e.quota = allQuota;
  throw e;
}

// prompt: string; opts: {aspectRatio:'9:16', imagePath?, durationSeconds?}
export async function genVideo(prompt, opts = {}) {
  if (!geminiConfigured()) throw new Error('gemini not configured');
  const instance = { prompt };
  if (opts.imagePath) {
    const a = readAsset(opts.imagePath);
    if (!a) throw new Error(`image not found: ${opts.imagePath}`);
    instance.image = { bytesBase64Encoded: a.buf.toString('base64'), mimeType: a.mime };
  }
  const parameters = { aspectRatio: opts.aspectRatio || '9:16' };
  if (opts.durationSeconds) parameters.durationSeconds = opts.durationSeconds;

  let opName = null;
  const models = [...new Set([ENV.geminiVideoModel, ...VIDEO_FALLBACKS])];
  const errs = [];
  for (const model of models) {
    try {
      const data = await post(`${G}/models/${model}:predictLongRunning?key=${nextKey()}`, { instances: [instance], parameters });
      opName = data?.name;
      if (opName) break;
      errs.push(`${model}: no operation name`);
    } catch (e) {
      errs.push(`${model}: ${String(e.message).slice(0, 120)}`);
    }
  }
  if (!opName) {
    const e = new Error(`gemini video: could not start operation (${errs.join(' | ').slice(0, 400)})`);
    e.quota = errs.length && errs.every((s) => /429|quota|RESOURCE_EXHAUSTED/i.test(s));
    throw e;
  }
  const deadline = Date.now() + tuning('videoPollTimeoutMs');
  while (Date.now() < deadline) {
    await sleep(10000);
    const st = await fetch(`${G}/${opName}?key=${nextKey()}`).then((r) => r.json());
    if (st.error) throw new Error(`gemini video op: ${st.error.message || JSON.stringify(st.error).slice(0, 300)}`);
    if (!st.done) continue;
    const uri = st.response?.generateVideoResponse?.generatedSamples?.[0]?.video?.uri;
    if (!uri) throw new Error(`gemini video done but no uri (${JSON.stringify(st.response)?.slice(0, 300)})`);
    let res = await fetch(uri, { headers: { 'x-goog-api-key': nextKey() } });
    if (!res.ok) res = await fetch(uri + (uri.includes('?') ? '&' : '?') + `key=${nextKey()}`);
    if (!res.ok) throw new Error(`video download ${res.status}`);
    return saveAssetBuf(Buffer.from(await res.arrayBuffer()), 'mp4');
  }
  throw new Error('gemini video: timed out after 6min');
}
