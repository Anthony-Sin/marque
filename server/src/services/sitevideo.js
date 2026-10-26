// Local website → video capture. For tech/product-demo campaigns the honest
// medium is the real site in motion: render it headless in local Chromium,
// smooth-scroll the page, record the viewport, ffmpeg → mp4. No cloud.
//
// ffmpeg lives in two slots here: playwright's recordVideo insists on its own
// build under <ms-playwright>/ffmpeg-<rev>/ (playwright-core ships none), and
// we shell out to a real ffmpeg for webm → mp4. We bridge the gap: find a real
// ffmpeg (env → ffmpeg-static → PATH) and symlink it into playwright's slot.
// If even that fails, the same CDP screencast frames playwright uses are piped
// to system ffmpeg ourselves — identical mechanism, still an honest mp4.
import { createRequire } from 'node:module';
import { execFile, execFileSync, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ASSETS_DIR } from '../config.js';
import { uid } from './store.js';

const run = promisify(execFile);
const require = createRequire(import.meta.url);
let chromium = null, pwErr = null, pwSpec = null;
function pw() {
  if (chromium || pwErr) return { chromium, pwErr };
  for (const p of ['playwright-core', '/home/ANT/mllab/scripts/node_modules/playwright-core']) {
    try { chromium = require(p).chromium; pwSpec = p; return { chromium }; } catch (e) { pwErr = e; }
  }
  return { pwErr };
}

// a runnable ffmpeg: env override → ffmpeg-static dep → whatever PATH has
let ffmpegBin = null, ffmpegSearched = false;
export function resolveFfmpeg() {
  if (ffmpegSearched) return ffmpegBin;
  ffmpegSearched = true;
  const candidates = [];
  if (process.env.FFMPEG_BIN) candidates.push(process.env.FFMPEG_BIN);
  try { const p = require('ffmpeg-static'); if (p) candidates.push(p); } catch { /* not installed */ }
  candidates.push('ffmpeg');
  for (const bin of candidates) {
    try { execFileSync(bin, ['-version'], { stdio: 'ignore', timeout: 5000 }); ffmpegBin = bin; break; } catch { /* try next */ }
  }
  return ffmpegBin;
}

// directory playwright's registry resolves browsers/tools from
function pwRegistryDir(pkgRoot) {
  const env = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (env === '0') return path.join(pkgRoot, '.local-browsers');
  if (env) return path.isAbsolute(env) ? env : path.resolve(process.env.INIT_CWD || process.cwd(), env);
  const home = os.homedir();
  if (process.platform === 'darwin') return path.join(home, 'Library', 'Caches', 'ms-playwright');
  if (process.platform === 'win32') return path.join(process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local'), 'ms-playwright');
  return path.join(process.env.XDG_CACHE_HOME || path.join(home, '.cache'), 'ms-playwright');
}

// package root of whichever playwright-core actually loaded (needs browsers.json)
function pwPkgRoot() {
  pw();
  if (!pwSpec) return null;
  if (path.isAbsolute(pwSpec)) return pwSpec;
  try { return path.dirname(require.resolve(`${pwSpec}/package.json`)); } catch { /* exports may hide it */ }
  try {
    let d = path.dirname(require.resolve(pwSpec));
    while (d !== path.dirname(d) && !fs.existsSync(path.join(d, 'browsers.json'))) d = path.dirname(d);
    return fs.existsSync(path.join(d, 'browsers.json')) ? d : null;
  } catch { return null; }
}

// exact path playwright's executablePathOrDie('ffmpeg') will demand
function pwFfmpegExpected() {
  const pkgRoot = pwPkgRoot();
  if (!pkgRoot) return null;
  let rev = null;
  try { rev = JSON.parse(fs.readFileSync(path.join(pkgRoot, 'browsers.json'), 'utf8')).browsers?.find((b) => b.name === 'ffmpeg')?.revision; } catch { /* no browsers.json */ }
  if (!rev) return null;
  const exe = process.platform === 'win32' ? 'ffmpeg-win64.exe' : process.platform === 'darwin' ? 'ffmpeg-mac' : 'ffmpeg-linux';
  return path.join(pwRegistryDir(pkgRoot), `ffmpeg-${rev}`, exe);
}

function absBin(bin) {
  if (!bin || path.isAbsolute(bin)) return bin;
  for (const d of (process.env.PATH || '').split(path.delimiter)) {
    const p = path.join(d, bin);
    if (fs.existsSync(p)) return p;
  }
  return bin;
}

// satisfy playwright's ffmpeg slot: its own build if present, else a symlink
// to a real ffmpeg. Returns the path the recorder will exec, or null.
function ensurePwFfmpeg() {
  const expected = pwFfmpegExpected();
  if (!expected) return null;
  if (fs.existsSync(expected)) return expected;
  const real = absBin(resolveFfmpeg());
  if (!real) return null;
  try {
    fs.mkdirSync(path.dirname(expected), { recursive: true });
    fs.rmSync(expected, { force: true });          // clear a stale/broken link
    fs.symlinkSync(real, expected);
    return expected;
  } catch { return null; }
}

// honest gate: chromium + a video path — playwright's bundled ffmpeg, or any
// ffmpeg we can link into its slot / mux the screencast fallback with.
export function siteVideoAvailable() {
  const { chromium: c } = pw();
  if (!(c && fs.existsSync(process.env.CHROMIUM_BIN || '/usr/bin/chromium'))) return false;
  const expected = pwFfmpegExpected();
  return !!(expected && fs.existsSync(expected)) || !!resolveFfmpeg();
}

// scroll driven from Node in real time — rAF inside headless chromium doesn't
// pace to wall-clock, so the recorded video would come out far too short
async function driveScroll(page, seconds) {
  const h = await page.evaluate('Math.max(document.body.scrollHeight - innerHeight, 1)');
  const steps = Math.max(20, seconds * 12);                 // ~12fps of scroll
  for (let i = 0; i <= steps; i++) {
    const p = i / steps;
    const e = p < .5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2; // easeInOutQuad
    const y = p < .8 ? e * h : h * (1 - (e - .8) / .2 * .35);       // down, drift back 35%
    await page.evaluate(`scrollTo(0, ${Math.round(y)})`);
    await page.waitForTimeout(Math.round((seconds * 1000) / steps));
  }
}

async function film(page, { html, url, seconds }) {
  if (url) await page.goto(url, { waitUntil: 'load', timeout: 30000 });
  else await page.setContent(html || '<h1>empty site</h1>', { waitUntil: 'load' });
  await page.waitForTimeout(700);
  await driveScroll(page, seconds);
  await page.waitForTimeout(300);
}

// playwright's own recorder — needs the ffmpeg slot filled
async function captureWithRecorder(browser, { html, url, size, seconds, dir }) {
  const ctx = await browser.newContext({ viewport: size, recordVideo: { dir, size } });
  try {
    const page = await ctx.newPage();
    await film(page, { html, url, seconds });
  } finally {
    await ctx.close().catch(() => {});   // finalizes the recorded webm
  }
  const webm = fs.readdirSync(dir).find((f) => f.endsWith('.webm'));
  if (!webm) throw new Error('no video recorded');
  return path.join(dir, webm);
}

// same CDP screencast playwright's recorder sits on, but muxed by a real
// ffmpeg — used when its private ffmpeg slot can't be satisfied
async function captureViaScreencast(browser, { html, url, size, seconds, ffmpeg, out }) {
  const ctx = await browser.newContext({ viewport: size });
  const frames = [];
  try {
    const page = await ctx.newPage();
    const cdp = await ctx.newCDPSession(page);
    cdp.on('Page.screencastFrame', (ev) => {
      if (ev?.data && frames.length < 900) frames.push(ev.data);
      cdp.send('Page.screencastFrameAck', { sessionId: ev.sessionId }).catch(() => {});
    });
    await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 78, maxWidth: size.width, maxHeight: size.height, everyNthFrame: 1 });
    await film(page, { html, url, seconds });
    await cdp.send('Page.stopScreencast').catch(() => {});
  } finally {
    await ctx.close().catch(() => {});
  }
  if (frames.length < 8) throw new Error(`screencast captured only ${frames.length} frames`);
  // replay the captured frames across the real scroll duration
  const fps = Math.min(30, Math.max(4, frames.length / seconds));
  await new Promise((resolve, reject) => {
    const p = spawn(ffmpeg, ['-y', '-f', 'image2pipe', '-framerate', String(fps), '-i', 'pipe:0', '-an', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', out]);
    let tail = '';
    p.stderr.on('data', (d) => { tail = (tail + d).slice(-600); });
    p.on('error', reject);
    p.on('close', (code) => (code === 0 && fs.existsSync(out)) ? resolve() : reject(new Error(`ffmpeg mux failed (${code}): ${tail.trim().slice(-300)}`)));
    for (const f of frames) p.stdin.write(Buffer.from(f, 'base64'));
    p.stdin.end();
  });
  return out;
}

export async function renderSiteVideo({ html, url }, { aspectRatio = '16:9', seconds = 8, source = 'site-capture' } = {}) {
  const { chromium: c, pwErr: e } = pw();
  if (!c) throw new Error(`playwright unavailable: ${e?.message || 'not installed'}`);
  const ffmpeg = resolveFfmpeg() || ensurePwFfmpeg();   // system/static, else playwright's own build can transcode
  if (!ffmpeg) throw new Error('no ffmpeg on this machine — install ffmpeg or set FFMPEG_BIN');
  ensurePwFfmpeg();   // best-effort: link a real ffmpeg into playwright's slot
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sitevid-'));
  const size = aspectRatio === '9:16' ? { width: 540, height: 960 } : aspectRatio === '1:1' ? { width: 720, height: 720 } : { width: 1280, height: 720 };
  const browser = await c.launch({ executablePath: process.env.CHROMIUM_BIN || '/usr/bin/chromium', headless: true });
  try {
    const out = path.join(ASSETS_DIR, `${uid()}.mp4`);
    let note = `real site rendered + captured locally (${seconds}s scroll)`;
    try {
      const webm = await captureWithRecorder(browser, { html, url, size, seconds, dir });
      await run(ffmpeg, ['-y', '-i', webm, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', out], { timeout: 60000 });
    } catch (err) {
      if (!/ffmpeg|Executable doesn't exist|no video recorded/i.test(String(err?.message || err))) throw err;
      await captureViaScreencast(browser, { html, url, size, seconds, ffmpeg, out });
      note += ' (CDP screencast → system ffmpeg)';
    }
    return { path: `/assets/${path.basename(out)}`, fsPath: out, provider: 'site-capture', note };
  } finally {
    await browser.close().catch(() => {});
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// does this plan call for a site/product demo rather than generated footage?
// Fires on the brand's OWN web surface — site/landing/app/demo intent. Bare
// retail words can't fire it: unqualified 'store'/'shop'/'checkout' name a
// place ('convenience store run', 'c-store', 'checkout counter'), not a page —
// the old unbounded store|shop match once filmed a stranger's site.
const SITE_DEMO = /\b(?:web ?sites?|web ?apps?|web ?stores?|web ?shops?|e-?stores?|e-?shops?|e-?comm(?:erce|s)?|micro ?sites?|landings?(?: ?pages?)?|home ?pages?|online (?:stores?|shops?)|storefronts?|(?:our|brand|new) sites?|apps?|ui|ux|dashboards?|demos?|software|platforms?|interfaces?|saas|checkouts? (?:flows?|funnels?|pages?|screens?|process(?:es)?|experiences?|journeys?)|(?:web|online|site) checkouts?|onboardings?|product tours?)\b/;
export function planWantsSiteDemo(plan = {}, campaign = {}) {
  const text = [plan.format, plan.direction, plan.angle, campaign?.brief?.title, campaign?.brief?.angle, campaign?.notes || campaign?.brief?.notes, campaign?.brief?.keyMessage].filter(Boolean).join(' ').toLowerCase();
  return SITE_DEMO.test(text);
}
