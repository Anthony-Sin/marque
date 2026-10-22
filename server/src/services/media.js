// Media fallback providers — used when Gemini image/video models are quota-blocked.
// pollinations.ai: free image gen (returns real JPEGs). ffmpeg: rendered MP4 animation.
// Every helper reports its provider so the UI can label output honestly.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import fs from 'node:fs';
import { saveAssetBuf, assetAbs } from './store.js';
import { genImage, genVideo } from './gemini.js';

const run = promisify(execFile);

const AR_DIMS = { '1:1': [1024, 1024], '4:5': [960, 1200], '9:16': [720, 1280], '16:9': [1280, 720], '4:1': [1280, 320] };
export const dimsFor = (ar) => AR_DIMS[ar] || AR_DIMS['1:1'];

// pollinations.ai — no key needed; GET returns image bytes. ~10-30s.
export async function pollinationsImage(prompt, { aspectRatio = '1:1' } = {}) {
  const [w, h] = dimsFor(aspectRatio);
  const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt.slice(0, 900))}?width=${w}&height=${h}&nologo=true&seed=${Math.floor(Math.random() * 1e6)}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(90000) });
  if (!res.ok) throw new Error(`pollinations ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 10_000) throw new Error('pollinations: empty image');
  return saveAssetBuf(buf, 'jpg');
}

// ffmpeg ken-burns: still → 5s subtle zoom/pan MP4 (H.264, plays everywhere).
export async function ffmpegAnimate(imageWebPath, { aspectRatio = '9:16', seconds = 5 } = {}) {
  const abs = assetAbs(imageWebPath);
  if (!abs || !fs.existsSync(abs)) throw new Error('ffmpeg: source image missing');
  const [w, h] = dimsFor(aspectRatio);
  const out = saveAssetBuf(Buffer.alloc(0), 'mp4'); // reserve name
  const outAbs = assetAbs(out);
  const fps = 30, frames = seconds * fps;
  // zoompan: 1.0→1.08 zoom with slight drift; scale+crop to target ar
  const vf = `scale=${w * 2}:${h * 2}:force_original_aspect_ratio=increase,crop=${w * 2}:${h * 2},zoompan=z='min(zoom+0.0006,1.10)':x='iw/2-(iw/zoom/2)+sin(on/40)*8':y='ih/2-(ih/zoom/2)':d=${frames}:s=${w}x${h}:fps=${fps},format=yuv420p`;
  await run('ffmpeg', ['-y', '-loop', '1', '-i', abs, '-vf', vf, '-t', String(seconds), '-c:v', 'libx264', '-preset', 'fast', '-crf', '23', '-movflags', '+faststart', '-pix_fmt', 'yuv420p', outAbs], { timeout: 120000 });
  if (!fs.existsSync(outAbs) || fs.statSync(outAbs).size < 5000) throw new Error('ffmpeg: render failed');
  return out;
}

// --- resilient wrappers: try the paid models first, fall back honestly ---

// returns { path, provider: 'gemini'|'pollinations' } — throws if all fail
export async function genImageResilient(prompt, opts = {}) {
  try {
    return { path: await genImage(prompt, opts), provider: 'gemini' };
  } catch (e) {
    const err = String(e.message || e).slice(0, 200);
    try {
      const path = await pollinationsImage(prompt, opts);
      return { path, provider: 'pollinations', note: `gemini failed: ${err}` };
    } catch (e2) {
      const err2 = new Error(`all image providers failed — gemini(${err}) pollinations(${String(e2.message).slice(0, 120)})`);
      err2.geminiError = err;
      throw err2;
    }
  }
}

// returns { path, provider: 'veo'|'ffmpeg' } — ffmpeg always succeeds given a still
export async function genVideoResilient(prompt, opts = {}) {
  try {
    return { path: await genVideo(prompt, opts), provider: 'veo' };
  } catch (e) {
    if (!opts.imagePath) throw e;
    const path = await ffmpegAnimate(opts.imagePath, opts);
    return { path, provider: 'ffmpeg-render', note: `veo failed: ${String(e.message || e).slice(0, 160)}` };
  }
}
