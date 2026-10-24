// campaign briefs + creative generation (copy via TensorMux, image via Gemini, SVG fallback)
import { chatJSON } from './tensor.js';
import { genImageResilient, genVideoResilient } from './media.js';
import { renderSiteVideo, planWantsSiteDemo, siteVideoAvailable } from './sitevideo.js';
import { siteVersion } from './sites.js';
import { find, list, update, uid, saveAssetBuf, registerImage } from './store.js';
import { fetchSite } from './scraper.js';
import { tuning } from '../tuning.js';

const BRIEF_SYS = `You are a senior marketing strategist. Given a brand profile and a campaign prompt, return JSON:
{"title":"campaign name","angle":"one line positioning angle","audience":"who this targets","keyMessage":"the single message","channels":[2-4 of "instagram","tiktok","facebook","email","print","web"],"suggestions":[{...2 more alternative briefs as {"title","angle","keyMessage"}}]}.
Ground everything in the brand's tone, audience and taste signals.`;

function flattenAffinities(profile) {
  const out = [];
  for (const aff of profile?.qloo?.affinities || []) {
    for (const e of aff.entities || []) out.push({ entity: e.name, type: aff.type, affinity: e.affinity ?? 0 });
  }
  return out;
}

function flattenBundle(bundle) {
  const out = [];
  for (const aff of bundle?.affinities || []) {
    for (const e of aff.entities || []) out.push({ entity: e.name, type: aff.type, affinity: e.affinity ?? 0 });
  }
  return out;
}

function pickQlooSignals(profile, prompt = '', n = 5) {
  let all = flattenAffinities(profile);
  // profile bundle empty → fall back to the most recent strategy board's bundle
  if (!all.length) {
    const boards = list('boards') || [];
    for (let i = boards.length - 1; i >= 0 && !all.length; i--) all = flattenBundle(boards[i]?.qlooBundle);
  }
  if (!all.length) return [];
  const words = new Set(prompt.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 3));
  const scored = all.map((s) => {
    let score = s.affinity || 0;
    for (const w of s.entity.toLowerCase().split(/[^a-z0-9]+/)) if (words.has(w)) score += 0.5;
    return { ...s, score };
  });
  return scored.sort((a, b) => b.score - a.score).slice(0, n).map(({ entity, type, affinity }) => ({ entity, type, affinity }));
}

export async function generateBrief({ prompt, productId, ingredients }, profile) {
  const product = productId ? find('catalog', productId) : null;
  const affinities = flattenAffinities(profile).slice(0, 12);
  // pasted-link flow (Creatify/Zeely pattern): scrape the URL so copy + art
  // direction have the real product as subject, not invented brand soup
  const link = /https?:\/\/[^\s)>"']+/i.exec(prompt || '')?.[0];
  const PUBLIC_HOST = (() => {
    try { return !/^(localhost|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|0\.|::1|\[::1\]|.*\.local$)/i.test(new URL(link || 'http://x').hostname); }
    catch { return false; }
  })();
  let urlContext = null;
  if (link && PUBLIC_HOST) {
    try {
      const s = await fetchSite(link);
      urlContext = { url: link, title: s.title || '', description: (s.description || s.meta?.description || '').slice(0, 300) };
    } catch { urlContext = { url: link }; }
  }
  const brief = await chatJSON([
    { role: 'system', content: BRIEF_SYS },
    {
      role: 'user',
      content: JSON.stringify({
        brand: { name: profile?.name, tagline: profile?.tagline, description: profile?.description, tone: profile?.tone, audience: profile?.audience },
        product: product ? { name: product.name, description: product.description } : null,
        site: urlContext,
        ingredients: ingredients || null,
        tasteSignals: affinities,
        prompt,
      }),
    },
  ], { maxTokens: 3000 });
  const out = {
    title: brief?.title || prompt?.slice(0, 60) || 'Untitled campaign',
    angle: brief?.angle || '',
    audience: brief?.audience || profile?.audience || '',
    keyMessage: brief?.keyMessage || '',
    // model sometimes invents enum-ish names ("instagram_reels") — normalize to
    // the canonical channel token so chips/targeting stay consistent
    channels: Array.isArray(brief?.channels)
      ? brief.channels.slice(0, 4).map((c) => String(c).toLowerCase().replace(/_/g, ' ').trim().split(' ')[0]).filter(Boolean)
      : ['instagram'],
  };
  if (urlContext) out.urlContext = urlContext;
  const suggestions = Array.isArray(brief?.suggestions)
    ? brief.suggestions.slice(0, 3).map((s) => ({ title: s.title || '', angle: s.angle || '', keyMessage: s.keyMessage || '' }))
    : [];
  return { brief: out, suggestions, qlooSignals: pickQlooSignals(profile, `${prompt || ''} ${out.title} ${out.angle}`) };
}

const COPY_SYS = `You are a social-media copywriter writing ad creative for feeds (Instagram/TikTok/YouTube). Return JSON {"headline","body","cta","layout":{"vpos","hpos"}}.
Rules: headline <= 7 words and MUST be a scroll-stopping hook written for the target audience — specific, punchy, native to social (never generic slogans like "records reality" or "the neutral standard"); body <= 15 words, conversational, drives the key message; cta <= 4 words and action-first ("See it in action", "Grab yours"). layout.vpos: "top"|"middle"|"bottom"; layout.hpos: "left"|"center"|"right" — where text should sit on the image.`;

const ANGLES = tuning('creativeAngles');
const CAPS = tuning('copyBudgets');

// The image prompt needs a concrete SUBJECT — a real product/site — or art
// direction collapses into abstract brand gradients. Resolve in order:
// 1) catalog product   2) the scraped site saved on the strategy's board
// 3) the "Original ask:" line the strategy handoff writes into notes
export async function resolveProductContext(campaign) {
  const viaCatalog = campaign.productId ? find('catalog', campaign.productId) : null;
  if (viaCatalog) return viaCatalog;
  // pasted-link brief carries its own scrape — the freshest subject signal.
  // big sites bot-block plain fetch; then the domain itself is the subject
  // ("drink-huel") so prompts still name something concrete.
  const uc = campaign.brief?.urlContext;
  if (uc?.url) {
    const host = (() => { try { return new URL(uc.url).hostname.replace(/^www\./, '').split('.')[0]; } catch { return ''; } })();
    const name = uc.title || host || uc.url;
    return { name, description: (uc.description || '').slice(0, 300), site: uc.url };
  }
  const boards = list('boards') || [];
  // boardId is the only collision-free key — deterministic boards reuse
  // strategy ids (st1/st2) AND titles, so it's checked first
  const board = boards.find((b) => b.id === campaign.boardId)
    || boards.find((b) => (b.strategies || []).some((s) => s.title && s.title === campaign.strategyTitle))
    || boards.find((b) => (b.strategies || []).some((s) => s.id === campaign.strategyId));
  // board was made before urlContext persisted — lazily re-scrape + cache
  if (board && !board.urlContext && board.sub?.url) {
    try {
      const s = await fetchSite(board.sub.url);
      board.urlContext = { url: board.sub.url, title: s.title, description: s.description || s.meta?.description || '' };
      update('boards', board.id, { urlContext: board.urlContext });
    } catch { board.urlContext = { url: board.sub.url }; }
  }
  if (board?.urlContext?.title || board?.urlContext?.description) {
    return { name: board.urlContext.title || board.urlContext.url, description: (board.urlContext.description || '').slice(0, 300), site: board.urlContext.url };
  }
  // no scrape stored — fall back to the ask text itself (notes "Original ask:"
  // line, or the board's submitted prompt) so the subject is still concrete
  const ask = /Original ask:\s*(.+)/i.exec(campaign.notes || '')?.[1]?.trim() || board?.sub?.prompt;
  if (ask) {
    const name = ask
      .replace(/^help me (build|make|create|launch|position|analyze)\s+(a\s+)?(campaign|ad|strategy|strategies|plan)\s+(for|about|of|on)?\s*/i, '')
      .replace(/\s*→.*$/, '')
      .replace(/https?:\/\/\S+/g, '')
      .trim().slice(0, 90) || ask.slice(0, 90);
    return { name, description: ask.slice(0, 300) };
  }
  return null;
}

// Background image prompt — the photo layer ONLY. Copy is composited as a DOM
// overlay (see CreativeOverlay.jsx), so the image must ship TEXT-FREE with
// negative space reserved where the overlay will sit. This is how the winning
// ad tools composite — never bake glyphs into pixels.
function composeImagePrompt(campaign, profile, copy, product, angle) {
  const c = profile?.colors || {};
  const affNames = flattenAffinities(profile).slice(0, 3).map((a) => a.entity).join(', ');
  const brandName = product?.name || profile?.name;
  const vpos = copy?.layout?.vpos || 'bottom';
  const space = vpos === 'top' ? 'upper third' : vpos === 'middle' ? 'center band' : 'lower third';
  return [
    `Editorial ad photograph for "${brandName}" (${angle} angle), ${campaign.aspectRatio || '1:1'} composition native to ${(campaign.brief?.channels || [])[0] || 'instagram'} — the actual product/subject front and center, shot like real platform content, not a generic stock gradient.`,
    campaign.brief?.angle ? `Campaign angle: ${campaign.brief.angle}.` : '',
    product ? `Featuring: "${product.name}"${product.description ? ` — ${product.description}` : ''}.` : '',
    `CRITICAL: absolutely NO text, words, letters, typography, logos, captions, labels or watermarks anywhere in the image — that means NO newspapers, magazines, books, posters, packaging, signage, screens or any printed materials; plain unmarked objects and surfaces only.`,
    `Compose with clean, uncluttered negative space in the ${space} (a headline will be overlaid there later) — keep the subject away from that zone.`,
    `Art direction palette: primary ${c.primary}, secondary ${c.secondary}, accent ${c.accent}.`,
    profile?.tone?.length ? `Mood: ${profile.tone.join(', ')}.` : '',
    affNames ? `Cultural vibe for art direction: ${affNames}.` : '',
    `Professional commercial photography, sharp focus, rich color grading, high detail.`,
  ].filter(Boolean).join(' ');
}

export function placeholderCreative(profile, copy) {
  const c = profile?.colors || { primary: '#3a5a40', secondary: '#a3b18a', text: '#1f1f1f', background: '#ffffff' };
  const esc = (s) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${c.primary}"/><stop offset="1" stop-color="${c.secondary}"/></linearGradient></defs>
<rect width="1024" height="1024" fill="url(#g)"/>
<rect x="0" y="720" width="1024" height="304" fill="${c.background}" opacity="0.92"/>
<text x="64" y="820" font-family="Georgia, serif" font-size="64" font-weight="bold" fill="${c.text}">${esc(copy.headline)}</text>
<text x="64" y="890" font-family="Helvetica, Arial, sans-serif" font-size="34" fill="${c.text}">${esc(copy.body)}</text>
<rect x="64" y="930" width="260" height="64" rx="32" fill="${c.accent}"/>
<text x="194" y="973" font-family="Helvetica, Arial, sans-serif" font-size="30" font-weight="bold" fill="#ffffff" text-anchor="middle">${esc(copy.cta)}</text>
</svg>`;
  return saveAssetBuf(Buffer.from(svg), 'svg');
}

// agentic plan — the model picks each creative's medium + angle from the
// brief/product/notes so output isn't one fixed medium: product demos, video
// spots, stills, copy-led cards all on the table depending on the ask.
async function planCreatives(campaign, profile, product, n) {
  try {
    const j = await chatJSON([
      { role: 'system', content: 'You plan ad creatives for a campaign. Strict JSON only.' },
      {
        role: 'user', content: [
          `Brand: ${profile?.name || 'brand'} — ${profile?.tagline || ''}. Audience: ${profile?.audience || ''}.`,
          `Brief: ${JSON.stringify(campaign.brief || {}).slice(0, 700)}.`,
          product?.name ? `Product: ${product.name}${product.description ? ` — ${String(product.description).slice(0, 200)}` : ''}.` : '',
          campaign.notes ? `Notes: ${campaign.notes}` : '',
          `Return {"items":[{"angle","medium","format","direction","badge","overlayStyle","score"}]} — exactly ${n} items.`,
          `angle = the creative angle (short). medium = "video" | "image" | "copy" — pick video when the brief/notes ask for demos, motion, how-it-works, before/after or the product benefits from movement; image for stills; copy for text-led cards. format = platform shape ("reel","spot","carousel","billboard"). direction = one line of shot/art direction.`,
          `badge = short offer/claim sticker ("NEW","4.9★","LIMITED") or "" when none fits. overlayStyle = one of performance|ugc|editorial|marker|brutalist|glass — pick the treatment that fits the angle (ugc for creator-style, editorial for luxury, performance for direct-response). score = your predicted thumbstop strength 40-98 (honest estimate, not random).`,
          `Vary mediums across the set — a real campaign mixes formats. If notes ask for product demos, at least half should be video.`,
        ].filter(Boolean).join('\n'),
      },
    ], { maxTokens: 1600 });
    const items = (Array.isArray(j?.items) ? j.items : [])
      .map((it) => ({
        angle: String(it.angle || '').slice(0, 60),
        medium: ['video', 'image', 'copy'].includes(it.medium) ? it.medium : 'image',
        format: String(it.format || '').slice(0, 40),
        direction: String(it.direction || '').slice(0, 220),
        badge: String(it.badge || '').slice(0, 16),
        overlayStyle: ['performance', 'ugc', 'editorial', 'marker', 'brutalist', 'glass'].includes(it.overlayStyle) ? it.overlayStyle : null,
        score: Math.max(40, Math.min(98, Math.round(+it.score || 0) || 0)) || null,
      }))
      .filter((it) => it.angle);
    return items.length ? items : null;
  } catch { return null; }
}

async function oneCreative(campaign, profile, product, angle, plan = null) {
  const copy = await chatJSON([
    { role: 'system', content: COPY_SYS },
    {
      role: 'user',
      content: JSON.stringify({
        brand: { name: profile?.name, tone: profile?.tone, audience: profile?.audience },
        brief: campaign.brief, product: product ? { name: product.name, description: product.description } : null,
        notes: campaign.notes || undefined,
        angle,
      }),
    },
  ], { maxTokens: 3000 });
  const safe = {
    headline: String(copy?.headline || campaign.brief?.title || profile?.name || 'New').split(' ').slice(0, CAPS.headlineMaxWords).join(' '),
    body: String(copy?.body || campaign.brief?.keyMessage || '').split(' ').slice(0, CAPS.bodyMaxWords).join(' '),
    cta: String(copy?.cta || 'Learn more').split(' ').slice(0, CAPS.ctaMaxWords).join(' '),
    layout: {
      vpos: ['top', 'middle', 'bottom'].includes(copy?.layout?.vpos) ? copy.layout.vpos : 'bottom',
      hpos: ['left', 'center', 'right'].includes(copy?.layout?.hpos) ? copy.layout.hpos : 'left',
    },
  };
  const creative = { id: uid(), headline: safe.headline, body: safe.body, cta: safe.cta, layout: safe.layout, angle, cleanImage: true };
  // resolve the real brand for the lockup — product name first, then the
  // product half of a "Campaign — Product" brief title, never a template name
  const tplName = profile?.name && profile.name !== 'Your Brand' ? profile.name : null;
  const briefTail = String(campaign.brief?.title || '').split(/—|→| - /).pop().trim().slice(0, 40);
  creative.brand = product?.name || tplName || briefTail || null;
  if (plan) {
    creative.medium = plan.medium;
    if (plan.format) creative.format = plan.format;
    if (plan.badge) creative.badge = plan.badge;
    if (plan.overlayStyle) creative.overlayStyle = plan.overlayStyle;
    if (plan.score) creative.score = plan.score;   // model-estimated thumbstop, shown as "est"
    if (plan.medium === 'video') creative.videoState = 'idle';
  }
  const refs = [];
  if (product?.image) refs.push({ path: product.image });
  for (const im of (campaign.ingredients?.images || profile?.images?.slice(0, 1).map((i) => i.path) || [])) refs.push({ path: im });
  try {
    const g = await genImageResilient(
      composeImagePrompt(campaign, profile, safe, product, angle) +
      (plan?.direction ? ` Shot direction: ${plan.direction}.` : '') +
      (plan?.medium === 'video' ? ' Frame this like a still pulled from a product demo video — subject mid-action, motion-ready composition.' : ''),
      {
      aspectRatio: campaign.aspectRatio || '1:1',
      provider: campaign.imageProvider,
      refs: refs.slice(0, 3),
    });
    creative.imagePath = g.path;
    creative.imageProvider = g.provider;
  } catch (e) {
    creative.imagePath = placeholderCreative(profile, safe);
    creative.placeholder = true;
    creative.imageError = String(e.message || e).slice(0, 200);
  }
  registerImage(creative.imagePath, { source: 'creative', angle });
  // video/demo mediums go through the video lane — for tech/product demos the
  // honest medium is the real site in motion (local capture), not AI footage
  if (plan?.medium === 'video' && creative.imagePath && !creative.placeholder) {
    creative.videoState = 'running';
    try {
      const site = list('websites')?.at(-1);
      const version = site ? siteVersion(site) : null;
      let v = null;
      if (version?.html && planWantsSiteDemo(plan, campaign) && siteVideoAvailable()) {
        v = await renderSiteVideo({ html: version.html }, { aspectRatio: campaign.aspectRatio, seconds: 8 });
        creative.videoDirection = 'site-demo';
      }
      if (!v) v = await genVideoResilient(
        [
          `Product demo video for ${product?.name || profile?.name || 'the product'} — ${plan.direction || 'show the product in use'}.`,
          plan.format ? `Format: ${plan.format}.` : '',
          `Camera language: smooth product orbit/macro detail pass, real-use motion, premium commercial pacing. Keep any on-image text crisp.`,
          `Brand: ${profile?.name || ''}. Angle: ${angle}.`,
        ].filter(Boolean).join(' '),
        { aspectRatio: campaign.aspectRatio === '16:9' ? '16:9' : '9:16', imagePath: creative.imagePath },
      );
      creative.videoPath = v.path; creative.videoState = 'done';
      creative.videoProvider = v.provider; if (v.note) creative.videoNote = v.note;
    } catch (e) {
      creative.videoState = 'error';
      creative.videoNote = String(e.message || e).slice(0, 200);
    }
  }
  return creative;
}

export async function generateCreatives(campaign, profile, n = 4, onProgress = null) {
  const product = await resolveProductContext(campaign);
  onProgress?.({ stage: 'planning mediums', done: 0, total: n });
  const plan = await planCreatives(campaign, profile, product, n);
  const creatives = [];
  for (let i = 0; i < n; i++) {
    const p = plan?.[i] || null;
    onProgress?.({ stage: `writing + rendering${p ? ` · ${p.medium}` : ''}`, done: i, total: n });
    try {
      creatives.push(await oneCreative(campaign, profile, product, p?.angle || ANGLES[i % ANGLES.length], p));
    } catch (e) {
      creatives.push({ id: `cr-${Date.now()}-${i}`, failed: true, imageError: String(e?.message || e).slice(0, 200), headline: 'Generation failed' });
    }
    onProgress?.({ stage: 'writing + rendering', done: i + 1, total: n });
  }
  return creatives;
}
