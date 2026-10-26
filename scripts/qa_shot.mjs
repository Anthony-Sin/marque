// qa_shot.mjs — screenshot helper for QA agents. Uses playwright-core + system chromium.
// Usage: node scripts/qa_shot.mjs --url http://localhost:5173/dashboard --out /tmp/shot.png
//        [--w 1920] [--h 1080] [--wait 1500] [--full] [--js "code"] [--click "sel"] [--hover "sel"]
//        [--scroll y] [--repeat n]  (repeat = take n numbered shots with --wait between)
import { chromium } from '/home/ANT/mllab/scripts/node_modules/playwright-core/index.mjs';

const args = process.argv.slice(2);
const opt = {};
for (let i = 0; i < args.length; i += 2) opt[args[i].replace(/^--/, '')] = args[i + 1];

const url = opt.url || 'http://localhost:5173/';
const out = opt.out || '/tmp/qa_shot.png';
const w = Number(opt.w || 1920), h = Number(opt.h || 1080);
const wait = Number(opt.wait || 1200);
const repeat = Number(opt.repeat || 1);

const browser = await chromium.launch({ executablePath: '/usr/bin/chromium', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const page = await browser.newPage({ viewport: { width: w, height: h } });
const logs = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') logs.push(`[${m.type()}] ${m.text().slice(0, 300)}`); });
page.on('pageerror', (e) => logs.push(`[pageerror] ${String(e).slice(0, 300)}`));

await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 }).catch(e => logs.push(`[nav] ${e.message}`));
await page.waitForTimeout(wait);

if (opt.click) { try { await page.click(opt.click, { timeout: 4000 }); await page.waitForTimeout(wait); } catch (e) { logs.push(`[click ${opt.click}] ${e.message.slice(0, 120)}`); } }
if (opt.hover) { try { await page.hover(opt.hover, { timeout: 4000 }); await page.waitForTimeout(500); } catch (e) { logs.push(`[hover] ${e.message.slice(0, 120)}`); } }
if (opt.scroll) { await page.evaluate((y) => document.querySelector('.main')?.scrollTo(0, y) || window.scrollTo(0, y), Number(opt.scroll)); await page.waitForTimeout(500); }
if (opt.js) { try { await page.evaluate(opt.js); await page.waitForTimeout(Number(opt.wait2 || 800)); } catch (e) { logs.push(`[js] ${e.message.slice(0, 200)}`); } }

for (let i = 0; i < repeat; i++) {
  const p = repeat > 1 ? out.replace(/\.png$/, `_${i}.png`) : out;
  await page.screenshot({ path: p, fullPage: !!opt.full });
  console.log('SHOT', p);
  if (i < repeat - 1) await page.waitForTimeout(wait);
}

// layout metrics QA cares about
const metrics = await page.evaluate(() => {
  const main = document.querySelector('.main') || document.documentElement;
  const doc = document.documentElement;
  return {
    viewport: `${innerWidth}x${innerHeight}`,
    mainScroll: main ? `${main.scrollWidth}x${main.scrollHeight} vs client ${main.clientWidth}x${main.clientHeight}` : 'n/a',
    hOverflow: main ? main.scrollWidth > main.clientWidth : null,
    vScrollNeeded: main ? main.scrollHeight > main.clientHeight : null,
    // page-level scroll truth: document taller than viewport = the page scrolls even if .main doesn't
    pageScrolls: doc.scrollHeight > innerHeight + 2 || document.body.scrollHeight > innerHeight + 2,
    docScroll: `${doc.scrollWidth}x${doc.scrollHeight} vs viewport ${innerWidth}x${innerHeight}`,
    hPageOverflow: doc.scrollWidth > innerWidth + 2,
  };
});
console.log('METRICS', JSON.stringify(metrics));
if (logs.length) console.log('CONSOLE\n' + logs.join('\n'));
await browser.close();
