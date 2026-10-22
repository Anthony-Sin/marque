// campaign briefs + creative generation (copy via TensorMux, image via Gemini, SVG fallback)
import { chatJSON } from './tensor.js';
import { genImageResilient } from './media.js';
import { find, uid, saveAssetBuf, registerImage } from './store.js';

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

function pickQlooSignals(profile, prompt = '', n = 5) {
  const all = flattenAffinities(profile);
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
  const brief = await chatJSON([
    { role: 'system', content: BRIEF_SYS },
    {
      role: 'user',
      content: JSON.stringify({
        brand: { name: profile?.name, tagline: profile?.tagline, description: profile?.description, tone: profile?.tone, audience: profile?.audience },
        product: product ? { name: product.name, description: product.description } : null,
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
    channels: Array.isArray(brief?.channels) ? brief.channels.slice(0, 4) : ['instagram'],
  };
  const suggestions = Array.isArray(brief?.suggestions)
    ? brief.suggestions.slice(0, 3).map((s) => ({ title: s.title || '', angle: s.angle || '', keyMessage: s.keyMessage || '' }))
    : [];
  return { brief: out, suggestions, qlooSignals: pickQlooSignals(profile, `${prompt || ''} ${out.title} ${out.angle}`) };
}

const COPY_SYS = `You are a social-media copywriter writing ad creative for feeds (Instagram/TikTok/YouTube). Return JSON {"headline","body","cta","layout":{"vpos","hpos"}}.
Rules: headline <= 7 words and MUST be a scroll-stopping hook written for the target audience — specific, punchy, native to social (never generic slogans like "records reality" or "the neutral standard"); body <= 15 words, conversational, drives the key message; cta <= 4 words and action-first ("See it in action", "Grab yours"). layout.vpos: "top"|"middle"|"bottom"; layout.hpos: "left"|"center"|"right" — where text should sit on the image.`;

const ANGLES = ['product-led', 'lifestyle', 'offer', 'social-proof'];

function composeImagePrompt(campaign, profile, copy, product, angle) {
  const c = profile?.colors || {};
  const affNames = flattenAffinities(profile).slice(0, 3).map((a) => a.entity).join(', ');
  return [
    `A finished ${campaign.aspectRatio || '1:1'} social-media ad creative, native to ${(campaign.brief?.channels || [])[0] || 'instagram'} feed, for the brand "${profile?.name}" (${angle} angle). It must look like real platform content — strong focal subject, brand-true styling, not a generic stock-ad gradient.`,
    campaign.brief?.angle ? `Campaign angle: ${campaign.brief.angle}.` : '',
    product ? `Featuring the product "${product.name}"${product.description ? ` — ${product.description}` : ''}.` : '',
    `Brand palette: primary ${c.primary}, secondary ${c.secondary}, accent ${c.accent}, background ${c.background}, text ${c.text}. Use these exact colors.`,
    `Typography style: ${profile?.fonts?.heading || 'modern sans'} headlines.`,
    profile?.tone?.length ? `Mood: ${profile.tone.join(', ')}.` : '',
    affNames ? `Cultural vibe for art direction reference: ${affNames}.` : '',
    `Render this exact text legibly on the image in the brand style — headline: "${copy.headline}"`,
    copy.body ? `body line: "${copy.body}"` : '',
    copy.cta ? `and a button-style CTA: "${copy.cta}".` : '',
    `Place the text toward the ${copy.layout?.vpos || 'bottom'} ${copy.layout?.hpos || 'left'} with strong contrast. Clean, professional ad composition, no watermarks.`,
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

async function oneCreative(campaign, profile, product, angle) {
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
    headline: String(copy?.headline || campaign.brief?.title || profile?.name || 'New').split(' ').slice(0, 10).join(' '),
    body: String(copy?.body || campaign.brief?.keyMessage || '').split(' ').slice(0, 24).join(' '),
    cta: String(copy?.cta || 'Learn more').split(' ').slice(0, 5).join(' '),
    layout: {
      vpos: ['top', 'middle', 'bottom'].includes(copy?.layout?.vpos) ? copy.layout.vpos : 'bottom',
      hpos: ['left', 'center', 'right'].includes(copy?.layout?.hpos) ? copy.layout.hpos : 'left',
    },
  };
  const creative = { id: uid(), headline: safe.headline, body: safe.body, cta: safe.cta, layout: safe.layout, angle };
  const refs = [];
  if (product?.image) refs.push({ path: product.image });
  for (const im of (campaign.ingredients?.images || profile?.images?.slice(0, 1).map((i) => i.path) || [])) refs.push({ path: im });
  try {
    const g = await genImageResilient(composeImagePrompt(campaign, profile, safe, product, angle), {
      aspectRatio: campaign.aspectRatio || '1:1',
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
  return creative;
}

export async function generateCreatives(campaign, profile, n = 4) {
  const product = campaign.productId ? find('catalog', campaign.productId) : null;
  const creatives = [];
  for (let i = 0; i < n; i++) {
    creatives.push(await oneCreative(campaign, profile, product, ANGLES[i % ANGLES.length]));
  }
  return creatives;
}
