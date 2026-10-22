// marketing site generation/edits — TensorMux writes a complete single-file HTML site
import { chat, chatJSON } from './tensor.js';
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

// pull a complete html doc out of model output (fences, prose, or raw)
function extractHTML(t) {
  if (!t || typeof t !== 'string') return null;
  const s = t.replace(/```(?:html)?/gi, '');
  const start = s.search(/<!doctype|<html/i);
  if (start < 0) return null;
  const close = s.toLowerCase().lastIndexOf('</html>');
  const end = close > start ? close + '</html>'.length : s.length;
  const html = s.slice(start, end).trim();
  return html.length > 200 && html.includes('<') ? html : null;
}

// primary path: chatJSON -> {html}; fallback: raw HTML completion (models are
// far more reliable emitting markup than JSON-escaped markup)
async function siteHTML(messages) {
  try {
    const out = await chatJSON(messages, { maxTokens: 8000 });
    const html = extractHTML(out?.html) || (typeof out?.html === 'string' && out.html.includes('<') ? out.html : null);
    if (html) return html;
  } catch { /* fall back to raw html */ }
  const raw = await chat([
    { role: 'system', content: `${SITE_SYS}\n\nIMPORTANT: ignore the JSON instruction — output the complete HTML document only, starting with <!DOCTYPE html>. No commentary, no code fences.` },
    ...messages.slice(1),
  ], { maxTokens: 8000 });
  return extractHTML(raw);
}

export async function generateWebsite(profile, prompt = '') {
  const html = await siteHTML([
    { role: 'system', content: SITE_SYS },
    { role: 'user', content: siteContext(profile, prompt) },
  ]);
  if (!html) throw new Error('site generation returned no html');
  const version = { id: uid(), html, prompt, createdAt: now() };
  const website = { id: uid(), createdAt: now(), versions: [version], activeVersion: version.id, publishedSlug: null };
  push('websites', website);
  return website;
}

export async function editWebsite(website, prompt, profile) {
  const active = website.versions.find((v) => v.id === website.activeVersion) || website.versions.at(-1);
  const html = await siteHTML([
    { role: 'system', content: SITE_SYS },
    { role: 'user', content: siteContext(profile) },
    { role: 'user', content: `Here is the current site HTML. Apply this edit: "${prompt}". Return the FULL updated document as {"html":"..."}.\n\nCURRENT HTML:\n${active?.html || ''}` },
  ]);
  if (!html) throw new Error('site edit returned no html');
  const version = { id: uid(), html, prompt, createdAt: now() };
  const versions = [...website.versions, version];
  update('websites', website.id, { versions, activeVersion: version.id });
  return version;
}

export function siteVersion(website) {
  return website?.versions?.find((v) => v.id === website.activeVersion) || website?.versions?.at(-1) || null;
}
