// state.json persistence + asset file helpers
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DATA_DIR, ASSETS_DIR, STATE_FILE } from '../config.js';

let state = {};

export function init() {
  fs.mkdirSync(ASSETS_DIR, { recursive: true });
  try { state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); }
  catch { state = {}; }
}

function persist() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = STATE_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
  fs.renameSync(tmp, STATE_FILE);
}

export const uid = () => crypto.randomUUID();
export const now = () => new Date().toISOString();

export function get(key, def = null) { return key in state ? state[key] : def; }
export function set(key, val) { state[key] = val; persist(); return val; }
export function list(key) { return get(key, []); }
export function push(key, item) { const arr = list(key); arr.push(item); set(key, arr); return item; }
export function find(key, id) { return list(key).find((x) => x.id === id) || null; }
export function update(key, id, patch) {
  const arr = list(key);
  const i = arr.findIndex((x) => x.id === id);
  if (i < 0) return null;
  arr[i] = { ...arr[i], ...patch };
  set(key, arr);
  return arr[i];
}
export function remove(key, id) { set(key, list(key).filter((x) => x.id !== id)); }

const MIME_EXT = {
  'image/png': 'png', 'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/webp': 'webp',
  'image/gif': 'gif', 'image/svg+xml': 'svg', 'video/mp4': 'mp4', 'application/pdf': 'pdf',
};
const EXT_MIME = Object.fromEntries(Object.entries(MIME_EXT).map(([m, e]) => [e, m]));

export function mimeToExt(mime = '') { return MIME_EXT[mime.split(';')[0].trim()] || 'bin'; }
export function extToMime(ext = '') { return EXT_MIME[ext.toLowerCase()] || 'application/octet-stream'; }

export function saveAssetBuf(buf, ext = 'png') {
  fs.mkdirSync(ASSETS_DIR, { recursive: true });
  const file = `${crypto.randomUUID()}.${ext}`;
  fs.writeFileSync(path.join(ASSETS_DIR, file), buf);
  return `/assets/${file}`;
}

export function saveAssetB64(b64, ext = 'png') { return saveAssetBuf(Buffer.from(b64, 'base64'), ext); }

export function assetAbs(webPath) {
  if (!webPath || !webPath.startsWith('/assets/')) return null;
  const abs = path.join(ASSETS_DIR, path.basename(webPath));
  return fs.existsSync(abs) ? abs : null;
}

export function readAsset(webPath) {
  const abs = assetAbs(webPath);
  if (!abs) return null;
  return { buf: fs.readFileSync(abs), mime: extToMime(path.extname(abs).slice(1)) };
}

export async function downloadToAsset(url, timeoutMs = 20000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { 'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36' },
    });
    if (!res.ok) throw new Error(`download ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 100 || buf.length > 30 * 1024 * 1024) throw new Error('bad size');
    const ext = mimeToExt(res.headers.get('content-type') || '') !== 'bin'
      ? mimeToExt(res.headers.get('content-type'))
      : (path.extname(new URL(url).pathname).slice(1) || 'png');
    return saveAssetBuf(buf, ext);
  } finally { clearTimeout(t); }
}

// images registry so /api/images/:id can resolve any generated asset
export function registerImage(webPath, meta = {}) {
  const imgs = list('images');
  const existing = imgs.find((i) => i.path === webPath);
  if (existing) return existing;
  const rec = { id: uid(), path: webPath, createdAt: now(), ...meta };
  imgs.push(rec); set('images', imgs);
  return rec;
}
export function findImage(idOrPath) {
  const imgs = list('images');
  return imgs.find((i) => i.id === idOrPath) || imgs.find((i) => i.path === idOrPath)
    || imgs.find((i) => i.path === `/assets/${idOrPath}`) || null;
}

// shallow+deep merge for profile patches: objects merge, arrays/primitives replace
export function applyPatch(target, patch) {
  if (!patch || typeof patch !== 'object') return target;
  const out = { ...target };
  for (const [k, v] of Object.entries(patch)) {
    if (v && typeof v === 'object' && !Array.isArray(v) && target?.[k] && typeof target[k] === 'object' && !Array.isArray(target[k])) {
      out[k] = applyPatch(target[k], v);
    } else out[k] = v;
  }
  return out;
}
