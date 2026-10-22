// marketing site generation/edits — TensorMux writes a complete single-file HTML site
import { chatJSON } from './tensor.js';
import { uid, now, push, update, find } from './store.js';

const SITE_SYS = `You are an elite web designer for the Marque studio. Return JSON {"html":"..."} — one complete, self-contained HTML document for a marketing site.
Requirements:
- All CSS inline in a <style> block using CSS custom properties built from the brand palette/fonts given. No external CSS/JS frameworks. Google Fonts <link> is allowed.
- Sections: sticky nav, hero with a strong generated tagline + CTA, about/story, products or catalog grid (from the given items), a "taste signature" section that names 3-5 cultural affinities as social proof ("Loved by fans of X, Y"), and a footer.
- Use the brand's real image paths (/assets/...) where provided — never invent URLs; unsplash/placeholder URLs are forbidden.
- Tone of voice must match the brand's tone keywords. Mobile-responsive, generous whitespace, rounded cards.`;

function siteContext(profile, extraPrompt = '') {
  return JSON.stringify({
    brand: {
      name: profile?.name, tagline: profile?.tagline, description: profile?.description,
      tone: profile?.tone, values: profile?.values, audience: profile?.audience,
      colors: profile?.colors, fonts: profile?.fonts,
      images: (profile?.images || []).map((i) => ({ path: i.path, caption: i.caption })),
      catalog: (profile?.catalog || []).map((c) => ({ name: c.name, description: c.description, image: c.image, price: c.price })),
      affinities: (profile?.qloo?.affinities || []).flatMap((a) => (a.entities || []).slice(0, 3).map((e) => e.name)),
    },
    request: extraPrompt || 'Generate the marketing site.',
  });
}

export async function generateWebsite(profile, prompt = '') {
  const out = await chatJSON([
    { role: 'system', content: SITE_SYS },
    { role: 'user', content: siteContext(profile, prompt) },
  ], { maxTokens: 8000 });
  const html = typeof out?.html === 'string' && out.html.includes('<') ? out.html : null;
  if (!html) throw new Error('site generation returned no html');
  const version = { id: uid(), html, prompt, createdAt: now() };
  const website = { id: uid(), createdAt: now(), versions: [version], activeVersion: version.id, publishedSlug: null };
  push('websites', website);
  return website;
}

export async function editWebsite(website, prompt, profile) {
  const active = website.versions.find((v) => v.id === website.activeVersion) || website.versions.at(-1);
  const out = await chatJSON([
    { role: 'system', content: SITE_SYS },
    { role: 'user', content: siteContext(profile) },
    { role: 'user', content: `Here is the current site HTML. Apply this edit: "${prompt}". Return the FULL updated document as {"html":"..."}.\n\nCURRENT HTML:\n${active?.html || ''}` },
  ], { maxTokens: 8000 });
  const html = typeof out?.html === 'string' && out.html.includes('<') ? out.html : null;
  if (!html) throw new Error('site edit returned no html');
  const version = { id: uid(), html, prompt, createdAt: now() };
  const versions = [...website.versions, version];
  update('websites', website.id, { versions, activeVersion: version.id });
  return version;
}

export function siteVersion(website) {
  return website?.versions?.find((v) => v.id === website.activeVersion) || website?.versions?.at(-1) || null;
}
