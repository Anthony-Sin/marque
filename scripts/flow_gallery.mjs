// Build mockups/flow/index.html — the ranked gallery of flow-* variants.
// Reads rank.json (written by the ranking pass): [{name, style, rank, blurb}]
// Falls back to alphabetical for unranked files. Embeds _media/{name}.png
// screenshots and lazy <video> demos. Run AFTER scripts/flow_assets.mjs.
import { readdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, basename } from 'node:path';

const DIR = new URL('../mockups/flow', import.meta.url).pathname;
const MEDIA = join(DIR, '_media');

let rank = [];
try { rank = JSON.parse(readFileSync(join(DIR, 'rank.json'), 'utf8')); } catch { /* unranked */ }
const ranked = new Map(rank.map((r, i) => [r.name, { ...r, rank: r.rank ?? i + 1 }]));

const files = readdirSync(DIR).filter((f) => f.endsWith('.html') && f.startsWith('flow-')).sort();
const items = files.map((f) => {
  const name = basename(f, '.html');
  const meta = ranked.get(name) || {};
  return {
    name, file: f,
    rank: meta.rank ?? 999,
    style: meta.style || name.replace(/^flow-\d+-?/, '').replace(/-/g, ' '),
    blurb: meta.blurb || '',
    shot: existsSync(join(MEDIA, `${name}.png`)) ? `_media/${name}.png` : '',
    vid: existsSync(join(MEDIA, `${name}.mp4`)) ? `_media/${name}.mp4` : '',
  };
}).sort((a, b) => a.rank - b.rank);

const cards = items.map((it, i) => `
  <article class="card">
    <a class="shot" href="./${it.file}" target="_blank" rel="noopener">
      ${it.shot ? `<img src="${it.shot}" alt="${it.name}" loading="lazy">` : '<div class="noshot">no preview</div>'}
      <span class="num">#${it.rank === 999 ? i + 1 : it.rank}</span>
    </a>
    <div class="meta">
      <h3><a href="./${it.file}" target="_blank" rel="noopener">${it.name}</a></h3>
      <p class="style">${it.style}</p>
      ${it.blurb ? `<p class="blurb">${it.blurb}</p>` : ''}
      ${it.vid ? `<details class="demo"><summary>▶ demo reel</summary><video src="${it.vid}" controls muted playsinline preload="none"></video></details>` : ''}
    </div>
  </article>`).join('\n');

writeFileSync(join(DIR, 'index.html'), `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Marque — strategy→result flow · ${items.length} directions</title>
<style>
  :root{--ink:#191613;--mut:#8a8378;--line:#e5dfd5;--paper:#faf8f3;--acc:#d4521e}
  *{box-sizing:border-box;margin:0}
  body{font:15px/1.5 -apple-system,"Segoe UI",system-ui,sans-serif;background:var(--paper);color:var(--ink)}
  header{max-width:1100px;margin:0 auto;padding:56px 24px 8px}
  h1{font-size:34px;letter-spacing:-.02em}
  .sub{color:var(--mut);margin-top:6px;max-width:640px}
  .count{display:inline-block;margin-top:14px;font-size:12px;letter-spacing:.14em;text-transform:uppercase;border:1px solid var(--line);border-radius:99px;padding:4px 12px;color:var(--acc)}
  main{max-width:1100px;margin:0 auto;padding:24px;display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:28px}
  .card{border:1px solid var(--line);border-radius:12px;background:#fff;overflow:hidden;transition:transform .18s,box-shadow .18s}
  .card:hover{transform:translateY(-3px);box-shadow:0 12px 32px rgba(25,22,19,.10)}
  .shot{display:block;position:relative;aspect-ratio:16/10;background:#efeae2;overflow:hidden}
  .shot img{width:100%;height:100%;object-fit:cover;object-position:top;display:block}
  .num{position:absolute;top:10px;left:10px;background:var(--ink);color:#fff;font-size:11px;font-weight:700;padding:3px 9px;border-radius:99px}
  .meta{padding:14px 16px 16px}
  h3{font-size:15px}
  h3 a{color:inherit;text-decoration:none}
  h3 a:hover{color:var(--acc)}
  .style{font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:var(--acc);margin:2px 0 6px}
  .blurb{font-size:13px;color:var(--mut)}
  .demo{margin-top:10px}
  .demo summary{cursor:pointer;font-size:12px;color:var(--acc);user-select:none}
  .demo video{width:100%;margin-top:8px;border-radius:8px;background:#000}
  .noshot{display:grid;place-items:center;height:100%;color:var(--mut);font-size:12px}
  footer{max-width:1100px;margin:0 auto;padding:16px 24px 56px;color:var(--mut);font-size:12px}
</style></head><body>
<header>
  <h1>Strategy → Result</h1>
  <p class="sub">${items.length} interface directions for the same Marque workflow — one ask, live audience read, four strategies with Qloo evidence, ruled-outs, produced output, palette and provenance. Ranked by the review pass.</p>
  <span class="count">${items.filter(i=>i.vid).length} with demo reels</span>
</header>
<main>${cards}
</main>
<footer>Generated ${new Date().toISOString().slice(0, 10)} · real board data (Rhode → Gen Z) via ../data.js · culled variants live in vault/</footer>
</body></html>`);
console.log(`gallery: ${items.length} cards (${items.filter(i=>i.vid).length} videos)`);
