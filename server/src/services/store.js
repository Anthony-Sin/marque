// state.json persistence + asset file helpers
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { DATA_DIR, ASSETS_DIR, STATE_FILE } from '../config.js';

let state = {};

// keys a caller-controlled patch must never write — `id` keeps records
// addressable (a PUT body's "id" must not rename the row), dunder/proto keys
// are pollution vectors once merged or re-serialized
const PATCH_BAD_KEY = /^(id|__.*|prototype|constructor)$/;
// for stored-data repair `id` is legitimate — only strip the pollution keys
const DATA_BAD_KEY = /^(__.*|prototype|constructor)$/;

export const isPlainObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

// depth check that never recurses — a hostile patch can nest thousands deep
export function exceedsDepth(root, max = 24) {
  const stack = [[root, 0]];
  while (stack.length) {
    const [v, d] = stack.pop();
    if (d > max) return true;
    if (v && typeof v === 'object') for (const x of Object.values(v)) stack.push([x, d + 1]);
  }
  return false;
}

// repair pass for state.json junk written by earlier builds: strip dunder/proto
// keys and truncate pathological nesting (>32) so reads/stringify stay healthy
const CLEAN_MAX_DEPTH = 32;
function cleanDeep(root) {
  let changed = false;
  const walk = (v, depth) => {
    if (!v || typeof v !== 'object') return v;
    if (depth > CLEAN_MAX_DEPTH) { changed = true; return Array.isArray(v) ? [] : {}; }
    if (Array.isArray(v)) return v.map((x) => walk(x, depth + 1));
    const out = {};
    for (const [k, x] of Object.entries(v)) {
      if (DATA_BAD_KEY.test(k)) { changed = true; continue; }
      out[k] = walk(x, depth + 1);
    }
    return out;
  };
  const out = walk(root, 0);
  return changed ? out : root;
}

export function init() {
  fs.mkdirSync(ASSETS_DIR, { recursive: true });
  try { state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); }
  catch { state = {}; }
  let dirty = false;
  const cleaned = cleanDeep(state);
  if (cleaned !== state) { state = cleaned; dirty = true; }
  // heal once at boot: image-registry rows pointing at deleted files are stale
  // refs — any <img> or image op built on them 404s. Drop them.
  const imgs = state.images;
  if (Array.isArray(imgs)) {
    const live = imgs.filter((i) => !i?.path?.startsWith('/assets/') || fs.existsSync(path.join(ASSETS_DIR, path.basename(i.path))));
    if (live.length !== imgs.length) { state.images = live; dirty = true; }
  }
  // fuzz litter: upload probes register under curl's default filename — they
  // were never brand assets. Drop the registry rows, then releaseAsset the
  // files so anything a record somehow came to reference still survives.
  if (Array.isArray(state.images)) {
    const junk = state.images.filter((i) => i?.name === 'mp.bin' || /^smoke\b/i.test(i?.name || ''));
    if (junk.length) {
      const junkIds = new Set(junk.map((i) => i.id));
      state.images = state.images.filter((i) => !junkIds.has(i.id));
      dirty = true;
      for (const i of junk) releaseAsset(i.path);
    }
  }
  // interrupted-by-restart sweep: the job runner is in-memory — any record
  // still marked 'running' at boot is dead work, not live progress. Mark it
  // honestly so the UI stops spinning instead of spinning forever.
  const note = 'interrupted by restart';
  for (const c of state.campaigns || []) {
    if (c?.genStatus === 'running') {
      c.genStatus = 'error';
      c.genError = note;
      c.genErrorHuman = 'Generation was interrupted by a server restart — hit retry.';
      delete c.jobId;
      dirty = true;
    } else if (c?.jobId) {
      // a jobId on a settled record is a dead handle — the jobs map is
      // in-memory, so a client that re-attaches to it can only 404
      delete c.jobId;
      dirty = true;
    }
    for (const cr of c.creatives || []) {
      if (cr?.videoState === 'running') { cr.videoState = 'error'; cr.videoNote = note; dirty = true; }
    }
  }
  for (const s of state.photoshoots || []) {
    if (s?.status === 'running') { s.status = 'error'; s.note = note; dirty = true; }
  }
  // a moodboard job marker that outlived its in-memory job is dead work —
  // the tiles it made are either already stored on `moodboard` or never
  // landed; either way the marker must not dedupe a future POST onto a
  // job id that no longer exists
  for (const b of state.boards || []) {
    if (b && 'moodboardJob' in b) {
      // any persisted marker is a dead handle — drop the key; only a marker
      // that held an actual job id was interrupted work worth an error note
      if (b.moodboardJob) b.moodboardError = note;
      delete b.moodboardJob;
      dirty = true;
    }
  }
  // tiles a killed moodboard run left behind: registered with source
  // 'moodboard' but referenced by no board's tile list — they can never be
  // reached again, so release them instead of littering the asset dir
  const mbRefs = new Set((state.boards || []).flatMap((b) => (b.moodboard?.tiles || []).map((t) => t?.path)));
  for (const img of list('images')) {
    if (img?.source === 'moodboard' && img.path && !mbRefs.has(img.path)) {
      releaseAsset(img.path); dirty = true;
    }
  }
  // strategyTitle is a stored copy of the board strategy's title made at
  // create time — boards keep living, so the copy drifts. When the link
  // still resolves and the live title differs, refresh the stored copy,
  // keep the original for provenance, and flag that drift happened.
  // Campaigns whose link no longer resolves keep their stored title.
  for (const c of state.campaigns || []) {
    const board = (state.boards || []).find((x) => x.id === c?.boardId);
    const live = board && (board.strategies || []).find((s) => s.id && s.id === c.strategyId);
    if (!live?.title) continue; // nothing trustworthy to compare against
    if (live.title !== c.strategyTitle) {
      c.strategyTitleAtCreate = c.strategyTitle;
      c.strategyTitle = live.title;
      c.strategyStale = true;
      dirty = true;
    } else if (c.strategyStale || c.strategyTitleAtCreate) {
      // live title matches the stored copy again — a lingering stale flag
      // would be a lie
      delete c.strategyStale;
      delete c.strategyTitleAtCreate;
      dirty = true;
    }
  }
  // lastStrategy is a verbatim dup of a board for legacy readers — it drifts
  // (the active board, resolved live, is the projection). Once boards exist
  // the copy is dead weight; only an empty boards list still needs it —
  // migrateBoards promotes it into a real board on first read.
  if (Array.isArray(state.boards) && state.boards.length && 'lastStrategy' in state) {
    delete state.lastStrategy;
    dirty = true;
  }
  if (dirty) persist();
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
// central scrub for record patches: drops id/proto/dunder keys and non-object
// bodies so a caller-controlled PUT can't rename the row or plant junk keys
export function sanitizePatch(patch) {
  if (!isPlainObject(patch)) return {};
  const out = {};
  for (const [k, v] of Object.entries(patch)) if (!PATCH_BAD_KEY.test(k)) out[k] = v;
  return out;
}
export function update(key, id, patch) {
  const arr = list(key);
  const i = arr.findIndex((x) => x.id === id);
  if (i < 0) return null;
  arr[i] = { ...arr[i], ...sanitizePatch(patch) };
  set(key, arr);
  return arr[i];
}
export function remove(key, id) { set(key, list(key).filter((x) => x.id !== id)); }

const MIME_EXT = {
  'image/png': 'png', 'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/webp': 'webp',
  'image/gif': 'gif', 'image/svg+xml': 'svg', 'video/mp4': 'mp4', 'application/pdf': 'pdf',
};
const EXT_MIME = Object.fromEntries(Object.entries(MIME_EXT).map(([m, e]) => [e, m]));

// own-property lookups — 'constructor'/'toString' would resolve inherited
// members and land a function where a string belongs
export function mimeToExt(mime = '') { const k = mime.split(';')[0].trim(); return Object.hasOwn(MIME_EXT, k) ? MIME_EXT[k] : 'bin'; }
export function extToMime(ext = '') { const k = ext.toLowerCase(); return Object.hasOwn(EXT_MIME, k) ? EXT_MIME[k] : 'application/octet-stream'; }

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

// does anything in state still reference this asset path? The images registry
// is an index, not a consumer — records (profile/catalog/campaigns/shoots/
// sites/boards/book) are what keep a file alive. Consulted shapes:
//   profile.images[].path, catalog[].image,
//   campaigns[].creatives[].imagePath|videoPath, campaigns[].ingredients.images[],
//   photoshoots[].inputImage|results[].imagePath|edits[].imagePath,
//   websites (any /assets/ URL embedded in the record — demoVideo.path plus
//     the literal refs baked into stored version HTML),
//   boards[].moodboard.tiles[].path,
//   brandbook.coverImage|images[] — profile-image ids resolved to paths,
//   lastStrategy — legacy board mirror, serialized scan while it survives.
// A '<uuid>-poster.png' is derived data — it stays alive exactly as long as
// the '<uuid>.mp4' it was captured from.
const posterParent = (webPath) => (typeof webPath === 'string' && webPath.endsWith('-poster.png'))
  ? `${webPath.slice(0, -'-poster.png'.length)}.mp4` : null;
export function assetInUse(webPath) {
  if (!webPath) return false;
  const parent = posterParent(webPath);
  const ref = (v) => v === webPath || (parent !== null && v === parent);
  const p = state.profile;
  if (p && (p.images || []).some((i) => ref(i?.path))) return true;
  if ((state.catalog || []).some((i) => ref(i?.image))) return true;
  for (const c of state.campaigns || []) {
    for (const cr of c.creatives || []) if (ref(cr?.imagePath) || ref(cr?.videoPath)) return true;
    for (const im of c.ingredients?.images || []) if (ref(typeof im === 'string' ? im : im?.path)) return true;
  }
  for (const s of state.photoshoots || []) {
    if (ref(s.inputImage)) return true;
    for (const r of s.results || []) if (ref(r?.imagePath)) return true;
    for (const e of s.edits || []) if (ref(e?.imagePath)) return true;
  }
  for (const w of state.websites || []) {
    const blob = JSON.stringify(w);
    if (blob.includes(webPath) || (parent && blob.includes(parent))) return true;
  }
  for (const b of state.boards || []) {
    for (const t of b.moodboard?.tiles || []) if (ref(t?.path)) return true;
  }
  const book = state.brandbook;
  if (book) {
    for (const id of [book.coverImage, ...(book.images || [])]) {
      const hit = (p?.images || []).find((i) => i.id === id) || (state.images || []).find((i) => i.id === id);
      if (hit && ref(hit.path)) return true;
    }
  }
  if (state.lastStrategy) {
    const blob = JSON.stringify(state.lastStrategy);
    if (blob.includes(webPath) || (parent && blob.includes(parent))) return true;
  }
  return false;
}

// every /assets/ web path a record keeps alive — the same universe
// assetInUse() answers one path at a time, collected once so the prune sweep
// can subtract it from the on-disk listing in O(1) per file.
export function referencedAssetPaths() {
  const refs = new Set();
  const add = (v) => { if (typeof v === 'string' && v.startsWith('/assets/')) refs.add(v); };
  const addBlob = (v) => { for (const m of JSON.stringify(v).matchAll(/\/assets\/[\w.-]+/g)) refs.add(m[0]); };
  const p = state.profile;
  for (const i of p?.images || []) add(i?.path);
  for (const i of state.catalog || []) add(i?.image);
  for (const c of state.campaigns || []) {
    for (const cr of c.creatives || []) { add(cr?.imagePath); add(cr?.videoPath); }
    for (const im of c.ingredients?.images || []) add(typeof im === 'string' ? im : im?.path);
  }
  for (const s of state.photoshoots || []) {
    add(s.inputImage);
    for (const r of s.results || []) add(r?.imagePath);
    for (const e of s.edits || []) add(e?.imagePath);
  }
  for (const w of state.websites || []) addBlob(w);
  for (const b of state.boards || []) for (const t of b.moodboard?.tiles || []) add(t?.path);
  const book = state.brandbook;
  if (book) {
    for (const id of [book.coverImage, ...(book.images || [])]) {
      const hit = (p?.images || []).find((i) => i.id === id) || (state.images || []).find((i) => i.id === id);
      add(hit?.path);
    }
  }
  if (state.lastStrategy) addBlob(state.lastStrategy);
  return refs;
}

// uuid-named files in ASSETS_DIR that no record and no registry row points
// at — the prune sweep's candidate set. The filename gate means anything not
// minted by saveAssetBuf (thumbs dir lives one level down, dotfiles, foreign
// files) is never even considered; registry membership makes a file part of
// the library, so registry rows are enough to keep a file.
const ASSET_FILE_RE = /^[0-9a-f-]{36}(\.\w+|-poster\.png)$/;
export function orphanAssets() {
  const refs = referencedAssetPaths();
  const registered = new Set(list('images').map((i) => i?.path));
  const orphans = [];
  for (const d of fs.readdirSync(ASSETS_DIR, { withFileTypes: true })) {
    if (!d.isFile() || !ASSET_FILE_RE.test(d.name)) continue;
    const webPath = `/assets/${d.name}`;
    if (registered.has(webPath)) continue;
    const parent = posterParent(webPath);
    if (refs.has(webPath) || (parent && refs.has(parent))) continue;
    let bytes = 0;
    try { bytes = fs.statSync(path.join(ASSETS_DIR, d.name)).size; } catch { continue; }
    orphans.push({ path: webPath, bytes });
  }
  return orphans;
}

// unlink iff unreferenced — drops the file plus any registry rows. Used by the
// DELETE routes so removing a record doesn't leave orphaned files behind.
export function releaseAsset(webPath) {
  if (!webPath || !String(webPath).startsWith('/assets/') || assetInUse(webPath)) return false;
  const abs = assetAbs(webPath);
  if (abs) { try { fs.unlinkSync(abs); } catch { /* already gone */ } }
  const imgs = list('images');
  const keep = imgs.filter((i) => i.path !== webPath);
  if (keep.length !== imgs.length) set('images', keep);
  return true;
}

// ---------- outbound-fetch SSRF guard ----------
// A public-looking hostname can still resolve to a private/loopback address
// (DNS-rebind, e.g. lvh.me → 127.0.0.1). String-check the host as a fast path,
// then resolve and vet EVERY candidate before a socket opens.
const PRIVATE_HOST = /^(localhost|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|0\.|::1|\[::1\]|.*\.local$|.*\.internal$)/i;

export function isPrivateAddr(addr) {
  let a = String(addr || '').toLowerCase();
  if (a.startsWith('::ffff:')) a = a.slice(7); // v4-mapped v6
  if (isIP(a) === 6) {
    if (a === '::1' || a === '::') return true;
    const h = parseInt(a.split(':')[0] || '0', 16);
    if ((h & 0xfe00) === 0xfc00) return true;  // fc00::/7 unique-local
    if ((h & 0xffc0) === 0xfe80) return true;  // fe80::/10 link-local
    if ((h & 0xff00) === 0xff00) return true;  // ff00::/8 multicast
    return false;
  }
  if (isIP(a) !== 4) return true;              // fail closed on weird input
  const p = a.split('.').map(Number);
  if (p[0] === 0 || p[0] === 10 || p[0] === 127) return true;
  if (p[0] === 169 && p[1] === 254) return true;                    // link-local / metadata
  if (p[0] === 172 && p[1] >= 16 && p[1] <= 31) return true;
  if (p[0] === 192 && p[1] === 168) return true;
  if (p[0] === 100 && p[1] >= 64 && p[1] <= 127) return true;       // CGNAT — non-public
  if (p[0] === 192 && p[1] === 0 && p[2] === 0) return true;        // IETF protocol assignments
  if (p[0] >= 224) return true;                                     // multicast / reserved
  return false;
}

export async function assertPublicUrl(url) {
  const u = new URL(url); // throws on garbage input
  if (!/^https?:$/.test(u.protocol)) throw new Error('only http/https URLs can be fetched');
  if (PRIVATE_HOST.test(u.hostname)) throw new Error(`cannot fetch private/local addresses (${u.hostname})`);
  const host = u.hostname.replace(/^\[|\]$/g, ''); // strip v6 brackets for lookup
  let addrs;
  try { addrs = await lookup(host, { all: true, verbatim: true }); }
  catch { throw new Error(`cannot resolve host ${u.hostname}`); }
  if (!addrs.length || addrs.some((x) => isPrivateAddr(x.address))) {
    throw new Error(`cannot fetch private/local addresses — ${u.hostname} resolves to a non-public range`);
  }
  return u;
}

// fetch that follows redirects hop-by-hop so every target gets the DNS+range
// vet BEFORE a socket opens — fetch(redirect:'follow') connects to a private
// redirect target first and only lets us inspect res.url afterwards (too late).
export async function fetchPublic(url, { headers = {}, timeoutMs = 20000, maxHops = 8 } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    let current = url;
    for (let hop = 0; ; hop++) {
      await assertPublicUrl(current);
      const res = await fetch(current, { signal: ctrl.signal, redirect: 'manual', headers });
      const loc = res.headers.get('location');
      if (res.status >= 300 && res.status < 400 && loc) {
        try { await res.body?.cancel(); } catch { /* free the socket either way */ }
        if (hop >= maxHops) throw new Error('too many redirects');
        current = new URL(loc, current).href;
        continue;
      }
      return res;
    }
  } finally { clearTimeout(t); }
}

export async function downloadToAsset(url, timeoutMs = 20000) {
  const res = await fetchPublic(url, {
    timeoutMs,
    headers: { 'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36' },
  });
  if (!res.ok) throw new Error(`download ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 100 || buf.length > 30 * 1024 * 1024) throw new Error('bad size');
  const ext = mimeToExt(res.headers.get('content-type') || '') !== 'bin'
    ? mimeToExt(res.headers.get('content-type'))
    : (path.extname(new URL(url).pathname).slice(1) || 'png');
  return saveAssetBuf(buf, ext);
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

// shallow+deep merge for profile patches: objects merge, arrays/primitives
// replace. Guards against hostile patches — dunder/proto keys are dropped and
// merge recursion is capped (route validation rejects deep patches outright;
// this is defense-in-depth for other callers like the profile agent).
const PATCH_MERGE_MAX_DEPTH = 24;
export function applyPatch(target, patch, depth = 0) {
  if (!isPlainObject(patch)) return target;
  const out = { ...(isPlainObject(target) ? target : {}) };
  for (const [k, v] of Object.entries(patch)) {
    if (PATCH_BAD_KEY.test(k)) continue;
    if (isPlainObject(v) && isPlainObject(out[k])) {
      out[k] = depth >= PATCH_MERGE_MAX_DEPTH ? v : applyPatch(out[k], v, depth + 1);
    } else out[k] = v;
  }
  return out;
}
