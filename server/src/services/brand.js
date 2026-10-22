// brand DNA: build a Profile from a website, chat scratch flow, or canned template
import { fetchSite } from './scraper.js';
import { chatJSON } from './tensor.js';
import { enrichProfile, qlooEvidence } from './qloo.js';
import { get, set, list, uid, now, saveAssetB64, registerImage } from './store.js';

const COLOR_KEYS = ['primary', 'secondary', 'accent', 'background', 'surface', 'text'];
const DEFAULT_COLORS = { primary: '#3a5a40', secondary: '#a3b18a', accent: '#d97706', background: '#ffffff', surface: '#f5f3ee', text: '#1f1f1f' };
const HEX = /^#[0-9a-fA-F]{6}$/;

function normalizeProfile(dna, extra = {}) {
  const colors = { ...DEFAULT_COLORS };
  for (const k of COLOR_KEYS) if (HEX.test(dna?.colors?.[k] || '')) colors[k] = dna.colors[k].toLowerCase();
  const profile = {
    id: uid(),
    createdAt: now(),
    updatedAt: now(),
    source: { type: 'scratch' },
    name: dna?.name || 'Untitled Brand',
    tagline: dna?.tagline || '',
    description: dna?.description || '',
    tone: Array.isArray(dna?.tone) ? dna.tone.slice(0, 7) : [],
    values: Array.isArray(dna?.values) ? dna.values.slice(0, 8) : [],
    audience: dna?.audience || '',
    colors,
    fonts: {
      heading: dna?.fonts?.heading || 'Inter',
      body: dna?.fonts?.body || dna?.fonts?.heading || 'Inter',
    },
    images: Array.isArray(dna?.images) ? dna.images : [],
    catalog: list('catalog'),
    qloo: null,
    ...extra,
  };
  return profile;
}

function persistProfile(profile) {
  profile.updatedAt = now();
  set('profile', profile);
  return profile;
}

const DNA_SYS = `You are a brand strategist extracting a brand DNA profile from website data.
Return a JSON object: {"name","tagline","description","tone":[4-7 voice keywords],"values":[3-6 strings],"audience":"one sentence","colors":{"primary","secondary","accent","background","surface","text"} all as #rrggbb,"fonts":{"heading","body"} display names}.
Prefer the scraped color palette and fonts when present; invent tasteful hex values only where scraping found nothing. Description is 2-3 sentences. Never invent product names or facts not in the data.`;

export async function buildProfileFromWebsite(url, { includeListing } = {}) {
  const scraped = await fetchSite(url);
  const payload = {
    url, title: scraped.title, description: scraped.description, og: scraped.og,
    text: scraped.text, colors: scraped.colors, fonts: scraped.fonts,
    imageCaptions: scraped.images.map((i) => i.alt || i.caption).filter(Boolean),
  };
  // "Include public business-listing details" — enrich with the public
  // knowledge-graph summary for this brand (Wikipedia REST), when one exists.
  if (includeListing) {
    try {
      const name = (scraped.og?.site_name || scraped.title || new URL(url).hostname.replace(/^www\.|\.\w+$/g, '')).split(/[|\-–—]/)[0].trim();
      const w = await fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(name)}`,
        { headers: { 'User-Agent': 'marque/1.0' }, signal: AbortSignal.timeout(8000) }).then((r) => (r.ok ? r.json() : null));
      if (w?.extract) payload.publicListing = { source: 'wikipedia', title: w.title, summary: w.extract.slice(0, 600) };
    } catch { /* listing enrichment is best-effort */ }
  }
  const dna = await chatJSON([
    { role: 'system', content: DNA_SYS },
    { role: 'user', content: `Scraped site data:\n${JSON.stringify(payload)}` },
  ], { maxTokens: 3000 });
  const images = scraped.images.map((im) => {
    const id = uid();
    registerImage(im.path, { source: 'scrape', url: im.url });
    return { id, path: im.path, url: im.url, caption: im.caption || im.alt || '' };
  });
  const profile = normalizeProfile({ ...dna, images }, { source: { type: 'website', url } });
  profile.socials = scraped.socials || {};
  profile.missingSocials = scraped.missingSocials || [];
  profile.qloo = await enrichProfile(profile);
  persistProfile(profile);
  return { profile, evidence: { qloo: qlooEvidence(profile.qloo) } };
}

const SCRATCH_SYS = `You are the Marque brand-onboarding agent. Through conversation you gather enough about the user's business to build a brand DNA profile.
Respond as JSON: {"reply":"your conversational reply","ready":bool,"profile":{...} or null}.
Set ready=true and emit the full profile once you know: business name, what they sell/do, vibe/tone, and (ideally) audience + color or style preferences. If unsure after 4+ exchanges, make tasteful choices and emit the profile anyway.
The profile shape: {"name","tagline","description","tone":[4-7],"values":[3-6],"audience":"one sentence","colors":{"primary","secondary","accent","background","surface","text"} #rrggbb,"fonts":{"heading","body"}}.
Keep replies short, warm, expert. Ask at most one or two questions per reply.`;

export async function buildFromScratch(messages, attachments = []) {
  const saved = [];
  for (const a of attachments || []) {
    try {
      const ext = (a.mime || '').includes('jpeg') ? 'jpg' : (a.mime || '').includes('svg') ? 'svg' : 'png';
      saved.push({ id: uid(), path: saveAssetB64(a.dataB64 || a.data || '', ext), url: '', caption: a.name || '' });
    } catch { /* skip bad attachment */ }
  }
  const hist = (messages || []).map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: String(m.content || '') }));
  if (saved.length) hist.push({ role: 'user', content: `[attached ${saved.length} brand image(s) — treat as logo/product references]` });
  let out = await chatJSON([{ role: 'system', content: SCRATCH_SYS }, ...hist], { maxTokens: 4000 });
  if (out?.ready && !out?.profile) {
    out = await chatJSON([
      { role: 'system', content: SCRATCH_SYS },
      ...hist,
      { role: 'user', content: 'Emit the complete profile JSON now as {"reply":"...","ready":true,"profile":{...}}.' },
    ], { maxTokens: 4000 });
  }
  let profile = null;
  if (out?.profile && typeof out.profile === 'object') {
    profile = normalizeProfile({ ...out.profile, images: [...saved, ...(out.profile.images || [])] }, { source: { type: 'scratch' } });
    profile.qloo = await enrichProfile(profile);
    persistProfile(profile);
  }
  return { reply: out?.reply || 'Tell me a bit more about your brand.', profile, evidence: { qloo: qlooEvidence(profile?.qloo) } };
}

const TEMPLATES = {
  'aurora-roast': {
    name: 'Aurora Roast', tagline: 'Small-batch coffee, roasted at first light.',
    description: 'Aurora Roast is a neighborhood specialty coffee roaster sourcing single-origin lots from smallholder farms. Every bag is roasted in small batches and brewed with care in a warm, plant-filled cafe.',
    tone: ['warm', 'expert', 'unhurried', 'craft', 'welcoming'],
    values: ['ethical sourcing', 'small-batch craft', 'community', 'seasonality'],
    audience: 'Curious coffee drinkers who care where their beans come from and slow down for a good cup.',
    colors: { primary: '#6f4e37', secondary: '#c9a87c', accent: '#e07a5f', background: '#fbf7f0', surface: '#f1e8dc', text: '#2b211b' },
    fonts: { heading: 'Fraunces', body: 'Inter' },
  },
  driftline: {
    name: 'Driftline', tagline: 'Surf goods built for the long ride.',
    description: 'Driftline is a coastal surf shop making durable boards, wax, and apparel. Born from dawn patrols and salt-stained parking lots, it keeps things simple, tough, and ocean-friendly.',
    tone: ['laid-back', 'rugged', 'optimistic', 'coastal', 'honest'],
    values: ['ocean stewardship', 'durability', 'local crew', 'no-fuss design'],
    audience: 'Surfers and beach-goers who want gear that lasts and a brand that gives back to the coast.',
    colors: { primary: '#0d5c63', secondary: '#7fb6b9', accent: '#f2a65a', background: '#f7fbfa', surface: '#e3efee', text: '#123030' },
    fonts: { heading: 'Archivo', body: 'Inter' },
  },
  'petal-and-stem': {
    name: 'Petal & Stem', tagline: 'Wild, garden-grown florals for every day.',
    description: 'Petal & Stem is a boutique florist studio arranging seasonal, locally grown flowers. Each bouquet is loose, romantic, and a little unruly — like it was just gathered from the garden.',
    tone: ['romantic', 'gentle', 'artful', 'fresh', 'personal'],
    values: ['seasonal stems', 'local growers', 'daily beauty', 'hand-tied craft'],
    audience: 'People who send flowers to mark small moments, and hosts who want natural, garden-style arrangements.',
    colors: { primary: '#7d4f5e', secondary: '#d9a7b0', accent: '#e8c547', background: '#fdf9f7', surface: '#f6eae8', text: '#3d2a2e' },
    fonts: { heading: 'Cormorant Garamond', body: 'Inter' },
  },
};
export const TEMPLATE_IDS = Object.keys(TEMPLATES);

export async function buildFromTemplate(templateId) {
  const t = TEMPLATES[templateId];
  if (!t) throw new Error(`unknown templateId "${templateId}" (options: ${TEMPLATE_IDS.join(', ')})`);
  const profile = normalizeProfile(t, { source: { type: 'template', templateId } });
  profile.qloo = await enrichProfile(profile);
  persistProfile(profile);
  return { profile };
}

export function currentProfile() {
  const p = get('profile');
  if (p) p.catalog = list('catalog');
  return p || null;
}
