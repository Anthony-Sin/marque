// Local website → video capture. For tech/product-demo campaigns the honest
// medium is the real site in motion: render it headless in local Chromium,
// smooth-scroll the page, record the viewport, ffmpeg → mp4. No cloud.
import { createRequire } from 'node:module';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ASSETS_DIR } from '../config.js';
import { uid } from './store.js';

const run = promisify(execFile);
const require = createRequire(import.meta.url);
let chromium = null, pwErr = null;
function pw() {
  if (chromium || pwErr) return { chromium, pwErr };
  for (const p of ['playwright-core', '/home/ANT/mllab/scripts/node_modules/playwright-core']) {
    try { chromium = require(p).chromium; return { chromium }; } catch (e) { pwErr = e; }
  }
  return { pwErr };
}

export function siteVideoAvailable() {
  const { chromium: c } = pw();
  return !!(c && fs.existsSync(process.env.CHROMIUM_BIN || '/usr/bin/chromium'));
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

export async function renderSiteVideo({ html, url }, { aspectRatio = '16:9', seconds = 8, source = 'site-capture' } = {}) {
  const { chromium: c, pwErr: e } = pw();
  if (!c) throw new Error(`playwright unavailable: ${e?.message || 'not installed'}`);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sitevid-'));
  const size = aspectRatio === '9:16' ? { width: 540, height: 960 } : aspectRatio === '1:1' ? { width: 720, height: 720 } : { width: 1280, height: 720 };
  const browser = await c.launch({ executablePath: process.env.CHROMIUM_BIN || '/usr/bin/chromium', headless: true });
  try {
    const ctx = await browser.newContext({ viewport: size, recordVideo: { dir, size } });
    const page = await ctx.newPage();
    if (url) await page.goto(url, { waitUntil: 'load', timeout: 30000 });
    else await page.setContent(html || '<h1>empty site</h1>', { waitUntil: 'load' });
    await page.waitForTimeout(700);
    await driveScroll(page, seconds);
    await page.waitForTimeout(300);
    await ctx.close();   // finalizes the recorded webm
    const webm = fs.readdirSync(dir).find((f) => f.endsWith('.webm'));
    if (!webm) throw new Error('no video recorded');
    const out = path.join(ASSETS_DIR, `${uid()}.mp4`);
    await run('ffmpeg', ['-y', '-i', path.join(dir, webm), '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', out], { timeout: 60000 });
    return { path: out, provider: 'site-capture', note: `real site rendered + captured locally (${seconds}s scroll)` };
  } finally {
    await browser.close().catch(() => {});
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// does this plan call for a site/product demo rather than generated footage?
export function planWantsSiteDemo(plan = {}, campaign = {}) {
  const text = [plan.format, plan.direction, plan.angle, campaign?.brief?.angle, campaign?.brief?.notes, campaign?.brief?.keyMessage].filter(Boolean).join(' ').toLowerCase();
  return /\b(web ?site|web ?app|app\b|ui|ux|dashboard|landing|demo|software|platform|interface|store|shop|checkout|onboard)/.test(text);
}
