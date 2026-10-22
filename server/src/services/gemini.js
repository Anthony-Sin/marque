// Gemini API: image generation/edits (gemini image model) + Veo long-running video
import { ENV } from '../config.js';
import { saveAssetBuf, readAsset } from './store.js';

const G = 'https://generativelanguage.googleapis.com/v1beta';

export function geminiConfigured() { return !!ENV.geminiKey; }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
  if (!res.ok) throw new Error(`gemini ${res.status}: ${JSON.stringify(data)?.slice(0, 400) || res.statusText}`);
  return data;
}

// prompt: string; opts: {aspectRatio, refs:[{path}|{mime,data}], saveExt}
export async function genImage(prompt, opts = {}) {
  if (!geminiConfigured()) throw new Error('gemini not configured');
  const parts = [{ text: prompt }];
  for (const ref of opts.refs || opts.images || []) {
    const part = refPart(ref);
    if (part) parts.push(part);
  }
  const makeBody = (withAR) => {
    const generationConfig = { responseModalities: ['TEXT', 'IMAGE'] };
    if (withAR && opts.aspectRatio) generationConfig.imageConfig = { aspectRatio: opts.aspectRatio };
    return { contents: [{ parts }], generationConfig };
  };
  const url = `${G}/models/${ENV.geminiImageModel}:generateContent?key=${ENV.geminiKey}`;
  let data;
  try {
    data = await post(url, makeBody(true));
  } catch (e) {
    if (opts.aspectRatio && /imageConfig|aspectRatio|invalid|Invalid/i.test(String(e.message))) {
      data = await post(url, makeBody(false)); // retry without imageConfig
    } else throw e;
  }
  const parts2 = data?.candidates?.[0]?.content?.parts || [];
  for (const p of parts2) {
    const inline = p.inlineData || p.inline_data;
    if (inline?.data) {
      const mime = inline.mimeType || inline.mime_type || 'image/png';
      const ext = mime.includes('jpeg') || mime.includes('jpg') ? 'jpg' : mime.includes('webp') ? 'webp' : 'png';
      return saveAssetBuf(Buffer.from(inline.data, 'base64'), ext);
    }
  }
  throw new Error(`gemini: no image part in response (${JSON.stringify(data)?.slice(0, 300)})`);
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
  const data = await post(
    `${G}/models/${ENV.geminiVideoModel}:predictLongRunning?key=${ENV.geminiKey}`,
    { instances: [instance], parameters },
  );
  const opName = data?.name;
  if (!opName) throw new Error(`gemini video: no operation name (${JSON.stringify(data)?.slice(0, 300)})`);
  const deadline = Date.now() + 6 * 60 * 1000;
  while (Date.now() < deadline) {
    await sleep(10000);
    const st = await fetch(`${G}/${opName}?key=${ENV.geminiKey}`).then((r) => r.json());
    if (st.error) throw new Error(`gemini video op: ${st.error.message || JSON.stringify(st.error).slice(0, 300)}`);
    if (!st.done) continue;
    const uri = st.response?.generateVideoResponse?.generatedSamples?.[0]?.video?.uri;
    if (!uri) throw new Error(`gemini video done but no uri (${JSON.stringify(st.response)?.slice(0, 300)})`);
    let res = await fetch(uri, { headers: { 'x-goog-api-key': ENV.geminiKey } });
    if (!res.ok) res = await fetch(uri + (uri.includes('?') ? '&' : '?') + `key=${ENV.geminiKey}`);
    if (!res.ok) throw new Error(`video download ${res.status}`);
    return saveAssetBuf(Buffer.from(await res.arrayBuffer()), 'mp4');
  }
  throw new Error('gemini video: timed out after 6min');
}
