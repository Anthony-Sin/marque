// fetchSite(url): HTML -> {title,description,text,colors,fonts,images,links,htmlLen}
import { downloadToAsset } from './store.js';

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

async function fetchText(url, timeoutMs = 15000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { 'user-agent': UA, accept: 'text/html,*/*' }, redirect: 'follow' });
    if (!res.ok) throw new Error(`fetch ${res.status} ${url}`);
    const html = await res.text();
    return { html, finalUrl: res.url || url };
  } finally { clearTimeout(t); }
}

const attr = (tag, name) => {
  const m = tag.match(new RegExp(`${name}\\s*=\\s*["']([^"']*)["']`, 'i'))
    || tag.match(new RegExp(`${name}\\s*=\\s*([^\\s>]+)`, 'i'));
  return m ? m[1] : '';
};

function stripToText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<nav[\s\S]*?<\/nav>/gi, ' ')
    .replace(/<footer[\s\S]*?<\/footer>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&#\d+;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractColors(html) {
  const styleish = [];
  for (const m of html.matchAll(/<style[\s\S]*?<\/style>/gi)) styleish.push(m[0]);
  for (const m of html.matchAll(/style\s*=\s*"[^"]*"/gi)) styleish.push(m[0]);
  const counts = new Map();
  for (const blob of styleish) {
    for (const m of blob.matchAll(/#[0-9a-fA-F]{3,8}\b/g)) {
      let hex = m[0].toLowerCase();
      if (hex.length === 4) hex = '#' + hex[1] + hex[1] + hex[2] + hex[2] + hex[3] + hex[3];
      if (hex.length > 7) hex = hex.slice(0, 7);
      if (/^#(fff|ffffff|000|000000|111111|222222|eee|eeeeee|ddd|dddddd|ccc|cccccc|999999|888888|777777|666666)$/.test(hex)) continue;
      counts.set(hex, (counts.get(hex) || 0) + 1);
    }
  }
  return [...counts.entries()].map(([hex, count]) => ({ hex, count })).sort((a, b) => b.count - a.count).slice(0, 10);
}

function extractFonts(html) {
  const fonts = new Set();
  for (const m of html.matchAll(/fonts\.googleapis\.com\/css2?\?[^"'>]+/gi)) {
    for (const f of m[0].matchAll(/family=([^:&"']+)/g)) fonts.add(decodeURIComponent(f[1]).replace(/\+/g, ' '));
  }
  for (const m of html.matchAll(/font-family\s*:\s*([^;}<"']+)/gi)) {
    const f = m[1].split(',')[0].trim().replace(/^['"]|['"]$/g, '');
    if (f && !/^(inherit|initial|sans-serif|serif|monospace|system-ui|auto|default|-apple-system)$/i.test(f) && f.length < 60) fonts.add(f);
  }
  return [...fonts].slice(0, 8);
}

const BAD_IMG = /(sprite|favicon|icon[-_.]|[-_.]icon|pixel|spinner|loader|1x1|blank\.|tracking|avatar|badge|arrow|bullet|placeholder|gravatar)/i;

function collectImages(html, base) {
  const out = [];
  const seen = new Set();
  const add = (src, alt, w, h, bonus = 0) => {
    if (!src || src.startsWith('data:')) return;
    let abs;
    try { abs = new URL(src, base).href; } catch { return; }
    if (!/^https?:/.test(abs) || seen.has(abs)) return;
    if (BAD_IMG.test(abs)) return;
    const dims = `${w || ''}x${h || ''}`;
    if (w && h && (+w < 60 || +h < 60)) return;
    if (/(\d{1,3})x(\d{1,3})/.test(abs) && abs.match(/(\d{1,3})x(\d{1,3})/).slice(1).some((n) => +n < 60)) return;
    seen.add(abs);
    let score = bonus + (alt ? 12 : 0) + (w && h && +w >= 400 ? 16 : 0);
    out.push({ url: abs, alt: alt || '', w, h, score, dims });
  };
  for (const m of html.matchAll(/<meta[^>]+property\s*=\s*["']og:image["'][^>]*>/gi)) add(attr(m[0], 'content'), 'og:image', null, null, 40);
  for (const m of html.matchAll(/<img[^>]*>/gi)) {
    const tag = m[0];
    const src = attr(tag, 'src') || attr(tag, 'data-src') || attr(tag, 'data-lazy-src');
    const w = +attr(tag, 'width') || null, h = +attr(tag, 'height') || null;
    const cls = attr(tag, 'class') || '';
    const bonus = /(hero|banner|product|cover|feature|main)/i.test(cls + ' ' + src) ? 14 : 0;
    add(src, attr(tag, 'alt'), w, h, bonus);
  }
  return out.sort((a, b) => b.score - a.score);
}

function extractMeta(html) {
  const meta = { og: {} };
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  meta.title = title ? title[1].replace(/\s+/g, ' ').trim() : '';
  for (const m of html.matchAll(/<meta[^>]*>/gi)) {
    const tag = m[0];
    const name = attr(tag, 'name') || attr(tag, 'property');
    const content = attr(tag, 'content');
    if (!name || !content) continue;
    if (name.toLowerCase() === 'description') meta.description = content;
    if (name.toLowerCase().startsWith('og:')) meta.og[name.toLowerCase().slice(3)] = content;
  }
  if (!meta.description && meta.og.description) meta.description = meta.og.description;
  return meta;
}

function siteLinks(html, base) {
  const links = [];
  const seen = new Set();
  for (const m of html.matchAll(/<a[^>]+href\s*=\s*["']([^"']+)["'][^>]*>/gi)) {
    let abs;
    try { abs = new URL(m[1], base); } catch { continue; }
    if (abs.origin !== base.origin || seen.has(abs.href)) continue;
    if (!/(about|contact|product|shop|menu|story|collection|team|services|work)/i.test(abs.pathname)) continue;
    seen.add(abs.href);
    links.push(abs.href);
    if (links.length >= 6) break;
  }
  return links;
}

export async function fetchSite(url) {
  const { html, finalUrl } = await fetchText(url);
  const base = new URL(finalUrl);
  const meta = extractMeta(html);
  let text = stripToText(html);
  const images = collectImages(html, base);
  const links = siteLinks(html, base);

  // follow up to 2 same-origin links for more text/images
  const followed = [];
  for (const link of links.slice(0, 2)) {
    try {
      const sub = await fetchText(link, 10000);
      followed.push(link);
      text += ' ' + stripToText(sub.html);
      for (const img of collectImages(sub.html, new URL(sub.finalUrl))) {
        if (!images.find((i) => i.url === img.url)) images.push(img);
      }
    } catch { /* skip */ }
  }
  text = text.slice(0, 8000);

  // download best images
  const top = images.slice(0, 8);
  const saved = [];
  for (const img of top) {
    try {
      const p = await downloadToAsset(img.url);
      saved.push({ path: p, url: img.url, alt: img.alt || '', caption: img.alt || '', w: img.w, h: img.h });
    } catch { /* skip undownloadable */ }
    if (saved.length >= 8) break;
  }

  return {
    title: meta.title || '',
    description: meta.description || '',
    og: meta.og || {},
    text,
    colors: extractColors(html),
    fonts: extractFonts(html),
    images: saved,
    links: followed,
    htmlLen: html.length,
  };
}
