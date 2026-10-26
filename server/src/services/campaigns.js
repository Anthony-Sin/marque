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
Ground everything in the brand's tone, audience and taste signals. angle and keyMessage must be concrete — name the product, offer or audience moment — never generic slogans that could sit on any brand's ad.`;

export function flattenAffinities(profile) {
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

function pickQlooSignals(profile, prompt = '', n = 5, board = null) {
  let all = flattenAffinities(profile);
  // profile bundle empty → the named board's bundle stands in. Without an
  // explicit board context the brief borrows no provenance — a free-typed ask
  // must not inherit whatever board happens to be active.
  if (!all.length && board) all = flattenBundle(board.qlooBundle);
  if (!all.length) return [];
  const words = new Set(prompt.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 3));
  const scored = all.map((s) => {
    let score = s.affinity || 0;
    for (const w of s.entity.toLowerCase().split(/[^a-z0-9]+/)) if (words.has(w)) score += 0.5;
    return { ...s, score };
  });
  return scored.sort((a, b) => b.score - a.score).slice(0, n).map(({ entity, type, affinity }) => ({ entity, type, affinity }));
}

export async function generateBrief({ prompt, productId, ingredients, boardId, strategyId }, profile) {
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
  // board signals attach only when the request names its board/strategy —
  // the strategy handoff carries boardId; a free-typed ask keeps its own
  const srcBoard = (boardId && find('boards', boardId))
    || (strategyId && (list('boards') || []).find((b) => (b.strategies || []).some((s) => s.id && s.id === strategyId)))
    || null;
  return { brief: out, suggestions, qlooSignals: pickQlooSignals(profile, `${prompt || ''} ${out.title} ${out.angle}`, 5, srcBoard) };
}

const COPY_SYS = `You are a direct-response copywriter writing overlay copy for social ads (Instagram/TikTok/YouTube). Return JSON {"headline","body","cta","layout":{"vpos","hpos"}}.
Every line must be concrete and tied to THIS brief — the product, the offer, a number, an ingredient, a real feature. If a line could run unchanged on a competitor's ad, rewrite it.
headline <= 7 words: a scroll-stopping hook for the target audience, driven by the brief's angle (offer → name the offer; proof → name the proof; product → name what it does). Never a generic slogan ("records reality", "the neutral standard", "elevate your routine").
body <= 15 words: conversational, carries the key message with one concrete detail — never restates the headline.
cta <= 3 words: verb-first and names what the viewer gets or does ("Watch it work", "Try the sampler", "Claim 20% off").
BANNED — never output these clichés in any field: "learn more", "shop now", "click here", "buy now", "discover", "elevate your", "unlock", "unleash", "level up", "game-changer", "don't miss out". No invented urgency — urgency only when the brief has a real offer.
layout.vpos: "top"|"middle"|"bottom"; layout.hpos: "left"|"center"|"right" — where text should sit on the image.`;

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
    `Compose so the ${space} stays visually calm — an uncluttered photographic backdrop with the subject kept clear of that zone (a headline will be overlaid there later).`,
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

// ---- set-level diversity ----
// One campaign ≠ one argument repeated: the planner names each unit's beat
// (persuasion family), the copy pass is told which hooks/CTA verbs/layout
// slots siblings already claimed, and a cheap deterministic net catches
// whatever samey copy slips through anyway — before image gen pays for it.
const STOPWORDS = new Set('the a an and or of to in on at it its is are be with from this that under over just now new out off up my our your you yours their his her them they we us get got for all one two how why who what when where will would could can has have had not but so if as by per via any each every some most more less much many very too also than then there here into onto about after before again once only own same such while do does did no'.split(' '));
const normToks = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter((w) => w && !STOPWORDS.has(w));
// share of the smaller token set also present in the other — 1 = clone
const tokOverlap = (a, b) => {
  const A = new Set(a || []), B = new Set(b || []);
  if (!A.size || !B.size) return 0;
  let hit = 0;
  for (const w of A) if (B.has(w)) hit++;
  return hit / Math.min(A.size, B.size);
};
// a CTA's first content word is its verb — "Find a cooler" vs "Find nearest
// cooler" are the same pitch even though the strings differ
const ctaVerb = (cta) => (String(cta || '').toLowerCase().match(/[a-z']+/) || [''])[0];
// badge stickers cap at 16 chars — trim at a word boundary so a long claim
// reads "MURDER YOUR" instead of shipping a clipped "MURDER YOUR THIR"
const badgeClip = (s) => {
  const b = String(s || '').trim().slice(0, 18);
  return b.length > 16 ? (b.slice(0, 16).replace(/\s+\S*$/, '') || b.slice(0, 16)) : b;
};
// preferred overlay slot order — bottom performs best on social, so it stays
// first pick; the dedup rotation only leaves it once a sibling claims it
const VPOS_ROTATION = ['bottom', 'top', 'middle'];

// persuasion families — the vocabulary beat labels normalize into; the
// planner picks one per unit, the post-pass fills gaps with fresh families
const BEAT_FAMILIES = ['price', 'convenience', 'identity', 'occasion', 'proof', 'comparison', 'ritual', 'problem', 'novelty'];
function beatFamily(s) {
  const t = String(s || '').toLowerCase().trim();
  if (!t) return null;
  if (BEAT_FAMILIES.includes(t)) return t;
  if (/price|cost|cheap|budget|deal|discount|\$|afford|value|under/.test(t)) return 'price';
  if (/easy|fast|quick|instant|convenient|nearby|grab|simple|friction/.test(t)) return 'convenience';
  if (/identity|status|style|become|belong|vibe|aesthetic|tribe|image/.test(t)) return 'identity';
  if (/occasion|night|morning|weekend|party|festival|holiday|season|moment|summer|winter|late|1 ?am/.test(t)) return 'occasion';
  if (/proof|review|rated|rating|stars|loved|tested|data|science|result|number/.test(t)) return 'proof';
  if (/versus|vs\.?|compare|instead|switch|better than|unlike|default|swap/.test(t)) return 'comparison';
  if (/ritual|routine|habit|daily|everyday/.test(t)) return 'ritual';
  if (/problem|pain|fix|solve|tired|sick|struggle|hate/.test(t)) return 'problem';
  if (/novel|drop|launch|first|introducing|limited|new/.test(t)) return 'novelty';
  return null;
}

// plan post-pass — even when the model returns samey items (repeated beat
// labels, near-identical angle wording, the same badge sticker twice),
// reassign fresh beat labels and drop repeat stickers so the copy pass is
// pushed apart instead of handed four copies of one argument
function diversifyPlan(items) {
  const usedBeats = new Set();
  const usedBadges = new Set();
  const seenAngles = [];
  return items.map((it, i) => {
    const angToks = normToks(it.angle);
    const angleDup = seenAngles.some((t) => tokOverlap(t, angToks) >= 0.6);
    let beat = beatFamily(it.beat) || beatFamily(it.angle);
    if (!beat || usedBeats.has(beat) || angleDup) {
      beat = BEAT_FAMILIES.find((b) => !usedBeats.has(b)) || beat || `beat-${i + 1}`;
    }
    usedBeats.add(beat);
    seenAngles.push(angToks);
    let badge = it.badge;
    const bkey = String(badge || '').toLowerCase().replace(/[^a-z0-9$%★]+/g, '');
    if (bkey) {
      // same sticker family twice reads as one ad repeated, not a campaign
      if (usedBadges.has(bkey)) badge = '';
      else usedBadges.add(bkey);
    }
    return { ...it, beat, badge };
  });
}

// does this headline reuse a sibling's hook? Clone check = heavy token
// overlap; samey check = 2+ shared salient nouns (digits, long words — the
// "every hook leads with the pack size" failure survives different phrasings)
function headlineDup(headline, priorToks) {
  const t = normToks(headline);
  const salient = new Set(t.filter((w) => /\d/.test(w) || w.length >= 7));
  return priorToks.some((p) => {
    if (tokOverlap(t, p) >= 0.5) return true;
    let shared = 0;
    for (const w of salient) if (p.includes(w)) shared++;
    return shared >= 2;
  });
}

// the running ledger's worth of exclusions, spelled out for the copy call —
// naming the taken elements beats a bare "be different"
function diversityBlock(avoid, plan) {
  const bits = [];
  if (plan?.beat) bits.push(`This unit argues the "${plan.beat}" beat — headline, body and CTA must all serve that persuasion family.`);
  const lines = [];
  if (avoid?.beats?.size) lines.push(`beats already argued: ${[...avoid.beats].join(', ')}`);
  if (avoid?.headlines?.length) lines.push(`headlines already taken: ${avoid.headlines.map((h) => `"${h}"`).join(' | ')}`);
  if (avoid?.ctaVerbs?.size) lines.push(`CTA opening verbs already used: ${[...avoid.ctaVerbs].join(', ')}`);
  if (avoid?.vpos?.size) lines.push(`layout vpos slots already claimed: ${[...avoid.vpos].join(', ')}`);
  if (avoid?.rejected) lines.push(`REJECTED draft "${avoid.rejected.headline}" / "${avoid.rejected.cta}" — it ${avoid.rejected.reason === 'cta-verb-taken' ? 'opened the CTA on a verb a sibling already used' : `reused a sibling's headline nouns`}; pick something clearly different`);
  if (lines.length) {
    bits.push(`Sibling creatives in THIS campaign already claimed:\n- ${lines.join('\n- ')}\nDo not reuse those hooks, nouns, verbs or slots — argue your beat from a different side.`);
  }
  return bits.length ? `\n\n${bits.join('\n')}` : '';
}

// agentic plan — the model picks each creative's medium + angle from the
// brief/product/notes so output isn't one fixed medium: product demos, video
// spots, stills, copy-led cards all on the table depending on the ask.
export async function planCreatives(campaign, profile, product, n) {
  try {
    const j = await chatJSON([
      { role: 'system', content: 'You plan ad creatives for a campaign. Strict JSON only.' },
      {
        role: 'user', content: [
          `Brand: ${profile?.name || 'brand'} — ${profile?.tagline || ''}. Audience: ${profile?.audience || ''}.`,
          `Brief: ${JSON.stringify(campaign.brief || {}).slice(0, 700)}.`,
          product?.name ? `Product: ${product.name}${product.description ? ` — ${String(product.description).slice(0, 200)}` : ''}.` : '',
          campaign.notes ? `Notes: ${campaign.notes}` : '',
          `Return {"items":[{"beat","angle","medium","format","direction","badge","overlayStyle","score"}]} — exactly ${n} items.`,
          `beat = the persuasion family this unit argues — one word from: price, convenience, identity, occasion, proof, comparison, ritual, problem, novelty. DIVERSITY CONTRACT: every item MUST argue a different beat — ${n} creatives = ${n} distinct reasons to care, not one hook rephrased. Do not repeat these elements across items: beat, the hook subject inside angle (size/price/scene/proof), badge sticker, format, or the subject of direction. If two items would make the same argument, push one into another beat family.`,
          `angle = the creative angle (short, specific to this brief — name the product/offer/audience moment, not a generic label like "lifestyle"). medium = "video" | "image" | "copy" — pick video when the brief/notes ask for demos, motion, how-it-works, before/after or the product benefits from movement; image for stills; copy for text-led cards. format = platform shape ("reel","spot","carousel","billboard"). direction = one line of shot/art direction naming the real subject in a real moment, not "product on gradient".`,
          `badge = a real claim/label sticker the brief supports — a rating, category tag, certification or true offer ("NEW DROP","4.9★","VEGAN","SPF 50","LIMITED","2-FOR-1") — never filler ("PROMO","WOW","HOT","BEST"), never the same sticker or claim twice in the set, and "" when nothing factual fits. overlayStyle = one of performance|ugc|editorial|marker|brutalist|glass — pick the treatment that fits the angle (ugc for creator-style, editorial for luxury, performance for direct-response). score = your predicted thumbstop strength 40-98 (honest estimate, not random).`,
          campaign.medium === 'video'
            ? `Every item MUST be medium "video" — this is a video-first production run (demos, spots, motion). Directions should read like shot lists.`
            : campaign.medium === 'image'
              ? `Every item MUST be medium "image" — stills only, no video units.`
              : `Vary mediums across the set — a real campaign mixes formats. If notes ask for product demos, at least half should be video.`,
        ].filter(Boolean).join('\n'),
      },
    ], { maxTokens: 1600 });
    const items = diversifyPlan((Array.isArray(j?.items) ? j.items : [])
      .map((it) => ({
        beat: String(it.beat || '').slice(0, 24),
        angle: String(it.angle || '').slice(0, 60),
        medium: ['video', 'image', 'copy'].includes(it.medium) ? it.medium : 'image',
        format: String(it.format || '').slice(0, 40),
        direction: String(it.direction || '').slice(0, 220),
        badge: badgeClip(it.badge),
        overlayStyle: ['performance', 'ugc', 'editorial', 'marker', 'brutalist', 'glass'].includes(it.overlayStyle) ? it.overlayStyle : null,
        score: Math.max(40, Math.min(98, Math.round(+it.score || 0) || 0)) || null,
      }))
      .filter((it) => it.angle));
    return items.length ? items : null;
  } catch { return null; }
}

// cliché screen — COPY_SYS bans these phrases; a model that parrots one anyway
// loses the line to an honest fallback instead of shipping filler on the overlay
const CLICHE = /\b(learn more|shop now|click here|buy now|discover|elevate your|unlock|unleash|level up|game.?changer|don'?t miss out)\b/i;

// honest CTA when the model omits one or echoes a cliché — the channel's own
// verb pointed at what the creative actually is; "" drops the pill entirely
// (print has no tap target, an invented CTA there reads faker than none)
function fallbackCta(campaign, product, plan) {
  const ch = (campaign.brief?.channels || [])[0] || 'instagram';
  if (ch === 'print') return '';
  const angle = `${plan?.angle || ''} ${campaign.brief?.angle || ''} ${campaign.brief?.title || ''}`;
  if (/offer|deal|sale|discount|launch|drop|limited/i.test(angle)) return 'Get the offer';
  const name = String(product?.name || '').trim();
  const named = name && name.length <= 24 && name.split(/\s+/).length <= 2 ? `Try ${name}` : null;
  if (ch === 'email' || ch === 'web') return product?.site ? 'Visit the site' : named || 'See it live';
  if (plan?.medium === 'video' || ch === 'tiktok') return 'Watch it work';
  return named || 'See it live';
}

// the copy pass alone — exported so tests/harnesses can exercise real model
// output without paying for image gen. `avoid` is the set-level ledger of
// hooks/CTA verbs/vpos slots earlier creatives already claimed (built in
// generateCreatives); null = standalone call with no exclusions.
export async function writeCopy(campaign, profile, product, angle, plan = null, avoid = null) {
  const copy = await chatJSON([
    { role: 'system', content: COPY_SYS },
    {
      role: 'user',
      content: JSON.stringify({
        brand: { name: profile?.name, tone: profile?.tone, audience: profile?.audience },
        brief: campaign.brief, product: product ? { name: product.name, description: product.description } : null,
        notes: campaign.notes || undefined,
        angle,
        beat: plan?.beat || undefined,
      }) + diversityBlock(avoid, plan),
    },
  ], { maxTokens: 3000 });
  const ctaIn = String(copy?.cta || '').trim();
  const headIn = String(copy?.headline || '');
  const bodyIn = String(copy?.body || '');
  return {
    headline: String((headIn && !CLICHE.test(headIn) && headIn) || campaign.brief?.title || profile?.name || 'New').split(' ').slice(0, CAPS.headlineMaxWords).join(' '),
    body: String((bodyIn && !CLICHE.test(bodyIn) && bodyIn) || campaign.brief?.keyMessage || '').split(' ').slice(0, CAPS.bodyMaxWords).join(' '),
    cta: (ctaIn && !CLICHE.test(ctaIn) ? ctaIn : fallbackCta(campaign, product, plan)).split(' ').slice(0, CAPS.ctaMaxWords).join(' '),
    layout: {
      vpos: ['top', 'middle', 'bottom'].includes(copy?.layout?.vpos) ? copy.layout.vpos : 'bottom',
      hpos: ['left', 'center', 'right'].includes(copy?.layout?.hpos) ? copy.layout.hpos : 'left',
    },
  };
}

// which site may this campaign honestly film? Scoped provenance, in order:
// (a) a site produced FROM this campaign, (b) a site produced from the
// campaign's board — a sibling campaign's, or the named strategy's. Anything
// else is a stranger's site: an honest "screen film" label over unrelated
// content still lies about the work, so this returns null and the caller must
// skip the capture. Only boardId + producedFrom.campaignId are collision-free
// keys — strategy ids/titles repeat across deterministic boards, so a
// boardless campaign matches solely on its own strategyTitle.
export function filmableSite(campaign) {
  const sites = list('websites') || [];
  const own = sites.filter((w) => w.producedFrom?.campaignId === campaign.id).at(-1);
  if (own) return own;
  const board = campaign.boardId ? (list('boards') || []).find((b) => b.id === campaign.boardId) : null;
  const stratTitles = new Set(
    [campaign.strategyTitle, ...(board?.strategies || []).map((s) => s?.title)].filter(Boolean),
  );
  const siblingIds = new Set(
    (list('campaigns') || []).filter((c) => board && c.boardId === board.id).map((c) => c.id),
  );
  return sites.filter((w) =>
    siblingIds.has(w.producedFrom?.campaignId)
    || (w.producedFrom?.strategyTitle && stratTitles.has(w.producedFrom.strategyTitle)),
  ).at(-1) || null;
}

async function oneCreative(campaign, profile, product, angle, plan = null, avoid = null) {
  let safe = await writeCopy(campaign, profile, product, angle, plan, avoid);
  let dupe = null;
  // samey-copy net — when this draft reuses a sibling's CTA verb or headline
  // nouns, retry once with the theft spelled out; a stubborn repeat still
  // ships (a live ad beats a dead slot) but is flagged so the set can report
  // it honestly instead of quietly passing clones off as a campaign
  if (avoid) {
    let ctaDup = !!ctaVerb(safe.cta) && avoid.ctaVerbs.has(ctaVerb(safe.cta));
    let headDup = headlineDup(safe.headline, avoid.headlineToks);
    if (ctaDup || headDup) {
      const retry = await writeCopy(campaign, profile, product, angle, plan, {
        ...avoid,
        rejected: { headline: safe.headline, cta: safe.cta, reason: ctaDup ? 'cta-verb-taken' : 'headline-nouns-taken' },
      });
      const rCtaDup = !!ctaVerb(retry.cta) && avoid.ctaVerbs.has(ctaVerb(retry.cta));
      const rHeadDup = headlineDup(retry.headline, avoid.headlineToks);
      if ((rCtaDup ? 1 : 0) + (rHeadDup ? 1 : 0) < (ctaDup ? 1 : 0) + (headDup ? 1 : 0)) {
        safe = retry; ctaDup = rCtaDup; headDup = rHeadDup;
      }
      if (ctaDup || headDup) dupe = [ctaDup && 'cta-verb', headDup && 'headline'].filter(Boolean).join('+');
    }
    // vpos: slot already claimed → deterministic next-free rotation, applied
    // BEFORE the image prompt reserves the calm zone for that slot so the art
    // and the overlay stay consistent
    if (avoid.vpos.has(safe.layout.vpos)) {
      const free = VPOS_ROTATION.filter((v) => !avoid.vpos.has(v));
      if (free.length) safe = { ...safe, layout: { ...safe.layout, vpos: free[0] } };
    }
  }
  const creative = { id: uid(), headline: safe.headline, body: safe.body, cta: safe.cta, layout: safe.layout, angle, cleanImage: true };
  if (dupe) creative.dupe = dupe;   // still-samey flag — surfaced, not hidden
  creative.beat = plan?.beat || beatFamily(angle) || null;
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
      // film only a provenance-scoped site — no own/board site means the unit
      // stays a normal motion creative, never a screencast of unrelated work
      const site = filmableSite(campaign);
      const version = site ? siteVersion(site) : null;
      let v = null, filmedSite = null;
      if (version?.html && planWantsSiteDemo(plan, campaign) && siteVideoAvailable()) {
        v = await renderSiteVideo({ html: version.html }, { aspectRatio: campaign.aspectRatio, seconds: 8 });
        creative.videoDirection = 'site-demo';
        // 'screen film' stays honest only if the tile says WHICH site ran
        filmedSite = site.publishedSlug || site.producedFrom?.campaignTitle || site.producedFrom?.strategyTitle || `site-${site.id.slice(0, 8)}`;
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
      if (filmedSite) creative.videoNote = `${creative.videoNote ? `${creative.videoNote} — ` : ''}filmed site: ${filmedSite}`;
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
  // produce-mode medium pin — 'video'/'image' forces every unit's lane even
  // when the LLM plan comes back null or mixed
  const forceMedium = ['video', 'image'].includes(campaign.medium) ? campaign.medium : null;
  const creatives = [];
  // running ledger of what earlier units claimed — fed into each copy call so
  // the model is told which hooks/CTA verbs/layout slots are already taken
  const avoid = { beats: new Set(), ctaVerbs: new Set(), vpos: new Set(), headlines: [], headlineToks: [] };
  for (let i = 0; i < n; i++) {
    let p = plan?.[i] || null;
    if (forceMedium) p = { ...(p || {}), medium: forceMedium };
    onProgress?.({ stage: `writing + rendering${p ? ` · ${p.medium}` : ''}`, done: i, total: n });
    try {
      const cr = await oneCreative(campaign, profile, product, p?.angle || ANGLES[i % ANGLES.length], p, avoid);
      creatives.push(cr);
      if (!cr.failed) {
        if (cr.beat) avoid.beats.add(cr.beat);
        const v = ctaVerb(cr.cta); if (v) avoid.ctaVerbs.add(v);
        if (cr.layout?.vpos) avoid.vpos.add(cr.layout.vpos);
        if (cr.headline) { avoid.headlines.push(cr.headline); avoid.headlineToks.push(normToks(cr.headline)); }
      }
    } catch (e) {
      creatives.push({ id: `cr-${Date.now()}-${i}`, failed: true, imageError: String(e?.message || e).slice(0, 200), headline: 'Generation failed' });
    }
    onProgress?.({ stage: 'writing + rendering', done: i + 1, total: n });
  }
  // last-resort fan-out — every unit somehow claimed the same vpos → rotate
  // deterministically so the set doesn't stack all its overlays in one zone
  const laid = creatives.filter((c) => !c.failed && c.layout?.vpos);
  if (laid.length > 1 && new Set(laid.map((c) => c.layout.vpos)).size === 1) {
    laid.forEach((c, i) => { c.layout = { ...c.layout, vpos: VPOS_ROTATION[i % VPOS_ROTATION.length] }; });
  }
  return creatives;
}
