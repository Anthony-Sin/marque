// Media fallback providers — used when Gemini image/video models are quota-blocked.
// pollinations.ai: free image gen (returns real JPEGs). ffmpeg: rendered MP4 animation.
// Every helper reports its provider so the UI can label output honestly.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import fs from 'node:fs';
import { saveAssetBuf, assetAbs, readAsset } from './store.js';
import { genImage, genVideo } from './gemini.js';
import { enrichPrompt, LOCALGEN_NEGATIVE } from './promptStyle.js';
import { ENV } from '../config.js';
import { tuning } from '../tuning.js';

const run = promisify(execFile);

const AR_DIMS = tuning('aspectDims');
export const dimsFor = (ar) => AR_DIMS[ar] || AR_DIMS['1:1'];

// sd-turbo is 512px-native — generate near its sweet spot, upscale to output size
const LOCAL_DIMS = tuning('localAspectDims');

// local diffusion service (server/scripts/localgen.py) — ~1-3s on a 4070.
// Prompts are run through promptStyle.enrichPrompt: caller briefs describe the
// subject, not the photography — turbo-class models go bland without concrete
// lens/light/texture cues. gemini gets the raw prompt (it needs no tags).
export async function localgenImage(prompt, opts = {}) {
  if (!ENV.localgenUrl) throw new Error('localgen not configured');
  // sdxl-turbo is ADD-distilled — measured knee at 4 steps; 6 just burns ~2s/img
  const { aspectRatio = '1:1', steps = 4, seed } = opts;
  const [w, h] = LOCAL_DIMS[aspectRatio] || LOCAL_DIMS['1:1'];
  const finalPrompt = enrichPrompt(prompt, { kind: opts.kind, palette: opts.palette, aspectRatio, enrich: opts.enrich });
  // img2img: localgen runs a real ref pipeline — pass the first ref through as
  // base64 so reframe/edit ops stay local instead of falling through to cloud.
  const ref = (opts.refs || opts.images || [])[0];
  let image;
  if (ref) {
    image = ref.data || ref.inline_data?.data || ref.inlineData?.data || null;
    if (!image) {
      const p = ref.path || ref.imagePath || (typeof ref === 'string' ? ref : null);
      const a = p && readAsset(p);
      if (!a) throw new Error(`localgen: reference not readable: ${p || 'inline ref'}`);
      image = a.buf.toString('base64');
    }
  }
  const res = await fetch(`${ENV.localgenUrl}/generate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      prompt: finalPrompt, width: w, height: h, steps, seed, upscale: 2, negative: LOCALGEN_NEGATIVE,
      ...(image ? { image, strength: opts.strength ?? 0.55 } : {}),
    }),
    signal: AbortSignal.timeout(120000),
  });
  if (!res.ok) {
    let detail = '';
    try { detail = (await res.json()).error; } catch { /* status only */ }
    throw new Error(`localgen ${res.status}${detail ? `: ${detail}` : ''}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 10_000) throw new Error('localgen: empty image');
  return saveAssetBuf(buf, 'png');
}

export async function localgenHealth() {
  if (!ENV.localgenUrl) return { ok: false };
  try {
    const r = await fetch(`${ENV.localgenUrl}/health`, { signal: AbortSignal.timeout(3000) });
    return r.ok ? await r.json() : { ok: false };
  } catch { return { ok: false }; }
}

// Honest provider badge — resolved from the live /health `model` field
// ('stabilityai/sdxl-turbo' → 'local-sdxl-turbo'). Cached once the model is
// known (it doesn't change under a running process); while health is
// unreachable nothing is cached and the label falls back to plain 'local'.
let localProviderCached;
// exported for moodboard.js — its tiles come straight from localgenImage so
// they report the same honest provider label the resilient chain does
export async function localProviderTag() {
  if (localProviderCached === undefined) {
    const h = await localgenHealth().catch(() => null);
    if (h?.ok && h.model) {
      const short = String(h.model).split('/').pop().toLowerCase()
        .replace(/[^a-z0-9.-]+/g, '-').replace(/^-+|-+$/g, '');
      localProviderCached = short ? `local-${short}` : 'local';
    }
  }
  return localProviderCached || 'local';
}

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

// ffmpeg motion design: still → seconds-long MP4 (H.264, plays everywhere).
// Every render picks a deterministic-but-varied camera move: eased ken-burns
// (zero velocity at both ends, so it reads as a move, not a panning still),
// a mild corner vignette for depth, and short head/tail fades so the clip
// cuts like an edit. Drift is written as a fraction of the live crop slack
// (iw-iw/zoom)/2, which is 0 at zoom=1 — the window can never leave frame.
const MOTION_DECK = ['push-right', 'push-left', 'push-up', 'push-diag', 'pull', 'settle'];
const MOTION_NAMED = [
  [/pull|zoom.?out|pull.?back|reveal|\bwide/i, 'pull'],
  [/settle|locked|tripod|\bland|\bhold/i, 'settle'],
  [/orbit|arc|sweep|diagonal/i, 'push-diag'],
  [/tilt|ris(e|ing)|upward|crane|pedestal/i, 'push-up'],
  [/\bleft/i, 'push-left'],
  [/\bright/i, 'push-right'],
  [/push|punch|zoom.?in|macro|close.?up|detail/i, 'push'],
];
export async function ffmpegAnimate(imageWebPath, { aspectRatio = '9:16', seconds = 5, motion = '', seed } = {}) {
  const abs = assetAbs(imageWebPath);
  if (!abs || !fs.existsSync(abs)) throw new Error('ffmpeg: source image missing');
  const [w, h] = dimsFor(aspectRatio);
  const out = saveAssetBuf(Buffer.alloc(0), 'mp4'); // reserve name
  const outAbs = assetAbs(out);
  const fps = 30, frames = seconds * fps;
  // 3x oversampled canvas — zoompan snaps crop coords to whole source px, so
  // the bigger the canvas the smaller the visible step (1/3 output px here)
  const K = 3, iw = w * K, ih = h * K;
  // seeded by asset path (a uuid) → variety across creatives, repeatable on re-render
  let hv = 0x811c9dc5;
  for (const c of String(seed ?? `${imageWebPath}|${motion}`)) { hv ^= c.charCodeAt(0); hv = Math.imul(hv, 0x01000193); }
  const rnd = () => { hv ^= hv << 13; hv ^= hv >>> 17; hv ^= hv << 5; return (hv >>> 0) / 4294967296; };
  // the motion-direction text (devin-written or the static default) can name a
  // camera move — honor it when it does; else draw from the seeded deck
  let variant = MOTION_NAMED.find(([re]) => re.test(motion))?.[1]
    || MOTION_DECK[Math.floor(rnd() * MOTION_DECK.length)];
  if (variant === 'push') variant = MOTION_DECK[Math.floor(rnd() * 4)];
  const t = `on/${frames}`;
  const eio = `${t}*${t}*(3-2*${t})`;  // smoothstep ease-in-out
  const eo = `1-pow(1-${t},4)`;        // quart ease-out — quick push, settles into a hold
  const Z = 0.10 + rnd() * 0.04;       // zoom depth 10–14%
  const P = () => 0.5 + rnd() * 0.3;   // drift amplitude, fraction of crop slack
  const sgn = () => (rnd() < 0.5 ? -1 : 1);
  const cx = '(iw-iw/zoom)/2', cy = '(ih-ih/zoom)/2';
  let z, x = cx, y = cy;
  if (variant === 'pull') {
    const z0 = 1.12;
    z = `${z0}-${(z0 - 1).toFixed(3)}*${eio}`;
    x = `${cx}*(1+${(P() * sgn() * 0.6).toFixed(3)}*(1-${eio}))`; // recenters as it reveals
  } else if (variant === 'settle') {
    z = `1+${(Z + 0.02).toFixed(3)}*${eo}`;
    x = `${cx}*(1+${(P() * sgn() * 0.5).toFixed(3)}*(${eo}-0.5))`;
  } else {
    z = `1+${Z.toFixed(3)}*${eio}`;
    if (variant === 'push-right') x = `${cx}*(1+${P().toFixed(3)}*(${eio}-0.5))`;
    else if (variant === 'push-left') x = `${cx}*(1-${P().toFixed(3)}*(${eio}-0.5))`;
    else if (variant === 'push-up') y = `${cy}*(1-${P().toFixed(3)}*(${eio}-0.5))`;
    else { // push-diag
      x = `${cx}*(1+${(P() * sgn()).toFixed(3)}*(${eio}-0.5))`;
      y = `${cy}*(1-${(P() * 0.6).toFixed(3)}*(${eio}-0.5))`;
    }
  }
  const fadeIn = 0.3, fadeOut = 0.35;
  const vf = `scale=${iw}:${ih}:force_original_aspect_ratio=increase,crop=${iw}:${ih},zoompan=z='${z}':x='${x}':y='${y}':d=${frames}:s=${w}x${h}:fps=${fps},vignette=angle=PI/6,fade=t=in:st=0:d=${fadeIn},fade=t=out:st=${(seconds - fadeOut).toFixed(2)}:d=${fadeOut},format=yuv420p`;
  await run('ffmpeg', ['-y', '-loop', '1', '-i', abs, '-vf', vf, '-t', String(seconds), '-c:v', 'libx264', '-preset', 'fast', '-crf', '23', '-movflags', '+faststart', '-pix_fmt', 'yuv420p', outAbs], { timeout: 120000 });
  if (!fs.existsSync(outAbs) || fs.statSync(outAbs).size < 5000) throw new Error('ffmpeg: render failed');
  return { path: out, variant };
}

// --- resilient wrappers: try the paid models first, fall back honestly ---

// returns { path, provider: 'local-<model>'|'local'|'gemini'|'pollinations' } — throws if all fail.
// Provider order follows ENV.localgenProvider: 'local-first' (default in .env)
// puts the on-GPU model first; 'local-only' pins it; 'fallback' keeps gemini
// primary and uses local as the quota escape hatch; 'off' disables it.
export async function genImageResilient(prompt, opts = {}) {
  const mode = ENV.localgenProvider || 'off';
  const useLocal = mode !== 'off' && !!ENV.localgenUrl;
  const hasRefs = !!(opts.refs?.length || opts.images?.length);
  const chain = opts.provider && opts.provider !== 'auto'
    ? [opts.provider]                                   // user-picked engine (e.g. "try gemini instead")
    : mode === 'local-only' ? ['local']
    : mode === 'local-first' && useLocal ? ['local', 'gemini', 'pollinations']
    : mode === 'fallback' && useLocal ? ['gemini', 'local', 'pollinations']
    : ['gemini', 'pollinations'];
  const errs = [];
  for (const p of chain) {
    try {
      const path = p === 'local' ? await localgenImage(prompt, opts)
        : p === 'gemini' ? await genImage(prompt, opts)
        : await pollinationsImage(prompt, opts);
      // local does img2img and gemini takes refs — the ref is only ignored when
      // the chain lands on pollinations (txt2img GET, can't accept images),
      // which requires the local call to have errored first.
      return { path, provider: p === 'local' ? await localProviderTag() : p, note: [hasRefs && p === 'pollinations' ? 'reference image ignored — pollinations is text-to-image only' : null, errs.length ? `after: ${errs.join(' | ')}` : null].filter(Boolean).join(' · ') || undefined };
    } catch (e) {
      errs.push(`${p}(${String(e.message || e).slice(0, 110)})`);
    }
  }
  const err = new Error(`all image providers failed — ${errs.join(' | ')}`.slice(0, 500));
  err.geminiError = errs.find((e) => e.startsWith('gemini'));
  throw err;
}

// returns { path, provider: 'veo'|'ffmpeg-render' } — ffmpeg always succeeds given a still
export async function genVideoResilient(prompt, opts = {}) {
  try {
    return { path: await genVideo(prompt, opts), provider: 'veo' };
  } catch (e) {
    if (!opts.imagePath) throw e;
    const r = await ffmpegAnimate(opts.imagePath, { ...opts, motion: prompt });
    console.warn(`[media] veo failed, ffmpeg fallback used (${r.variant}): ${String(e?.message || e).slice(0, 300)}`);
    return { path: r.path, provider: 'ffmpeg-render', note: `veo unavailable — animated locally with ffmpeg (${r.variant})` };
  }
}
