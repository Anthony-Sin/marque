// Capture screenshot + scroll-video for every mockups/flow/*.html into
// mockups/flow/_media/{name}.{png,mp4}. Usage: node scripts/flow_assets.mjs [pattern]
// e.g. node scripts/flow_assets.mjs 'flow-0*' or a single name 'flow-03'
import { chromium } from '/home/ANT/mllab/scripts/node_modules/playwright-core/index.mjs';
import { readdirSync, mkdirSync, existsSync } from 'node:fs';
import { join, basename } from 'node:path';

const DIR = new URL('../mockups/flow', import.meta.url).pathname;
const OUT = join(DIR, '_media');
mkdirSync(OUT, { recursive: true });

const pat = process.argv[2] || 'flow-*';
const files = readdirSync(DIR)
  .filter((f) => f.endsWith('.html') && (pat === 'flow-*' ? f.startsWith('flow-') : f.includes(pat.replace('*', ''))))
  .sort();

const browser = await chromium.launch({ executablePath: '/usr/bin/chromium', headless: true });
for (const f of files) {
  const name = basename(f, '.html');
  const url = `file://${join(DIR, f)}`;
  const shotPath = join(OUT, `${name}.png`);
  const vidPath = join(OUT, `${name}.mp4`);

  // --- screenshot (1440w viewport, above the fold + a bit) ---
  if (!existsSync(shotPath)) {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const p = await ctx.newPage();
    try {
      await p.goto(url, { waitUntil: 'load', timeout: 15000 });
      await p.waitForTimeout(2000);
      await p.screenshot({ path: shotPath });
      console.log('shot', name);
    } catch (e) { console.log('shot FAIL', name, e.message.slice(0, 80)); }
    await ctx.close();
  }

  // --- scroll video (~14s: settle, smooth scroll down & back) ---
  if (!existsSync(vidPath)) {
    const ctx = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      recordVideo: { dir: '/tmp/flowvid', size: { width: 1440, height: 900 } },
    });
    const p = await ctx.newPage();
    try {
      await p.goto(url, { waitUntil: 'load', timeout: 15000 });
      await p.waitForTimeout(1800);
      const h = await p.evaluate(() => document.body.scrollHeight);
      const steps = Math.min(8, Math.max(3, Math.floor(h / 800)));
      for (let i = 1; i <= steps; i++) {
        await p.evaluate((y) => window.scrollTo({ top: y, behavior: 'smooth' }), Math.round((h * i) / steps) - 200);
        await p.waitForTimeout(1100);
      }
      await p.evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' }));
      await p.waitForTimeout(1200);
      const v = await p.video();
      await ctx.close();
      await v.saveAs(vidPath);
      console.log('vid ', name);
    } catch (e) { console.log('vid FAIL', name, e.message.slice(0, 80)); await ctx.close(); }
  }
}
await browser.close();
console.log('done', files.length, 'files');
