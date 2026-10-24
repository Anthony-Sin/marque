// mock_vid.mjs — headless page→mp4 capture. playwright-core + system chromium + ffmpeg.
// Usage: node scripts/mock_vid.mjs --url <url> --out <name.mp4> [--seconds 10] [--w 1280] [--h 720]
//        [--scroll 1] [--hold 0]
//   --scroll 1  ease-scroll the full page height over <seconds> (easeInOutQuad)
//   --hold 1    just sit on the settled page for <seconds> (default when no --scroll)
import { chromium } from '/home/ANT/mllab/scripts/node_modules/playwright-core/index.mjs';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const args = process.argv.slice(2);
const opt = {};
for (let i = 0; i < args.length; i += 2) opt[args[i].replace(/^--/, '')] = args[i + 1];

const url = opt.url || 'http://localhost:5173/';
const out = opt.out || '/tmp/mock_vid.mp4';
const seconds = Number(opt.seconds || 10);
const w = Number(opt.w || 1280), h = Number(opt.h || 720);
const doScroll = opt.scroll !== undefined && opt.scroll !== '0';
const SETTLE_MS = 1500;

const vidDir = mkdtempSync(join(tmpdir(), 'mockvid-'));
const browser = await chromium.launch({ executablePath: '/usr/bin/chromium', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const ctx = await browser.newContext({ viewport: { width: w, height: h }, recordVideo: { dir: vidDir, size: { width: w, height: h } } });
const page = await ctx.newPage();
const logs = [];
page.on('pageerror', (e) => logs.push(`[pageerror] ${String(e).slice(0, 200)}`));

const tPage0 = Date.now(); // ~when recording starts (page creation)
await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 }).catch(e => logs.push(`[nav] ${e.message}`));
await page.waitForTimeout(SETTLE_MS);
const tReady = Date.now(); // ~when scroll/hold begins

if (doScroll) {
  // Scroll whichever element actually scrolls: document.scrollingElement first, fallback .main.
  const target = await page.evaluate(() => {
    const se = document.scrollingElement || document.documentElement;
    if (se && se.scrollHeight > se.clientHeight + 4) return 'scrollingElement';
    const main = document.querySelector('.main');
    if (main && main.scrollHeight > main.clientHeight + 4) return '.main';
    return 'none';
  });
  const dur = seconds * 1000;
  const t0 = Date.now();
  // easeInOutQuad over full scrollable range, in-page so rAF/timing stays smooth.
  await page.evaluate(({ target, dur }) => new Promise((done) => {
    const el = target === '.main' ? document.querySelector('.main')
      : (document.scrollingElement || document.documentElement);
    const max = Math.max(0, (el ? el.scrollHeight - el.clientHeight : 0));
    const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - ((-2 * t + 2) ** 2) / 2);
    const t0 = performance.now();
    const tick = (now) => {
      const p = Math.min(1, (now - t0) / dur);
      const y = ease(p) * max;
      if (el && el !== document.scrollingElement && el !== document.documentElement && el !== document.body) {
        el.scrollTop = y;
      } else {
        window.scrollTo(0, y);
      }
      if (p < 1) requestAnimationFrame(tick); else done();
    };
    requestAnimationFrame(tick);
  }), { target, dur });
  await page.waitForTimeout(400); // slight settle at end
  console.log('SCROLL_TARGET', target, 'elapsed_ms', Date.now() - t0);
} else {
  await page.waitForTimeout(seconds * 1000);
}

await ctx.close();           // finalize + save .webm
await browser.close();

const webm = readdirSync(vidDir).find(f => f.endsWith('.webm'));
if (!webm) { console.error('FAIL: no webm produced in', vidDir); process.exit(1); }
const webmPath = join(vidDir, webm);
console.log('WEBM', webmPath, statSync(webmPath).size, 'bytes');

// webm (vp8/vp9) -> h264 mp4, yuv420p for compat, faststart for streaming, crf 23.
// The webm covers the whole session (nav + settle + action); trim to start LEAD
// seconds before scroll/hold begins so the mp4 lands near --seconds.
const LEAD = 0.4, TAIL = 0.6;
const skip = Math.max(0, (tReady - tPage0) / 1000 - LEAD);
execFileSync('ffmpeg', ['-y', '-ss', skip.toFixed(2), '-i', webmPath, '-t', String(seconds + LEAD + TAIL), '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '23', '-movflags', '+faststart', out], { stdio: 'pipe' });
rmSync(vidDir, { recursive: true, force: true });

const probe = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration,size', '-of', 'default=noprint_wrappers=1', out], { encoding: 'utf8' }).trim();
console.log('MP4', out);
console.log('FFPROBE', probe.replace(/\n/g, ' '));
if (logs.length) console.log('PAGELOG\n' + logs.join('\n'));
