// marque server — Express app, routes per docs/API.md, in-memory job runner
import express from 'express';
import multer from 'multer';
import fs from 'node:fs';
import path from 'node:path';
import { PORT, ASSETS_DIR, WEB_DIST, ENV, DATA_DIR } from './config.js';
import * as store from './services/store.js';
import { chat, chatJSON, tensorConfigured } from './services/tensor.js';
import { genImage, genVideo, geminiConfigured } from './services/gemini.js';
import * as qloo from './services/qloo.js';
import { fetchSite } from './services/scraper.js';
import * as brand from './services/brand.js';
import * as campaigns from './services/campaigns.js';
import { agentChat } from './services/agent.js';
import { generateStrategies } from './services/strategy.js';
import { generateWebsite, editWebsite, siteVersion } from './services/sites.js';
import { buildBook, htmlBook } from './services/brandbook.js';

const { get, set, list, push, find, update, remove, uid, now } = store;

store.init();
const app = express();
app.use(express.json({ limit: '30mb' }));
app.use('/assets', express.static(ASSETS_DIR));

const h = (fn) => (req, res) => Promise.resolve(fn(req, res)).catch((e) => {
  console.error(`[marque] ${req.method} ${req.path} →`, e.message);
  res.status(500).json({ error: String(e.message || e) });
});
const ok = (res, body) => res.json(body);

// ---------- jobs ----------
const jobs = new Map();
function runJob(kind, fn) {
  const job = { id: uid(), kind, status: 'running', createdAt: now() };
  jobs.set(job.id, job);
  (async () => {
    try { job.result = await fn(job); job.status = 'done'; }
    catch (e) { job.status = 'error'; job.error = String(e.message || e).slice(0, 400); }
  })();
  return job;
}
app.get('/api/jobs/:id', (req, res) => {
  const job = jobs.get(req.params.id);
  job ? ok(res, { job }) : res.status(404).json({ error: 'job not found' });
});

// ---------- status ----------
app.get('/api/status', h(async (_req, res) => {
  const q = qloo.status();
  ok(res, { tensor: tensorConfigured(), gemini: geminiConfigured(), qloo: q.mode, qlooNote: q.note });
}));

// ---------- profile ----------
function syncProfileCatalog() {
  const p = get('profile');
  if (p) { p.catalog = list('catalog'); p.updatedAt = now(); set('profile', p); }
  return p;
}

app.post('/api/profile/build', h(async (req, res) => {
  const { url, templateId } = req.body || {};
  if (templateId) return ok(res, await brand.buildFromTemplate(templateId));
  if (!url) return res.status(400).json({ error: 'url required' });
  ok(res, await brand.buildProfileFromWebsite(url));
}));
app.post('/api/profile/scratch', h(async (req, res) => {
  ok(res, await brand.buildFromScratch(req.body?.messages, req.body?.attachments));
}));
app.post('/api/profile/template', h(async (req, res) => {
  ok(res, await brand.buildFromTemplate(req.body?.templateId));
}));
app.get('/api/profile', h(async (_req, res) => ok(res, { profile: brand.currentProfile() })));
app.put('/api/profile', h(async (req, res) => {
  const patch = { ...(req.body?.patch || req.body || {}) };
  for (const k of ['id', 'createdAt', 'source', 'qloo']) delete patch[k];
  const profile = get('profile');
  if (!profile) return res.status(404).json({ error: 'no profile yet' });
  const merged = store.applyPatch(profile, patch);
  merged.updatedAt = now();
  merged.catalog = list('catalog');
  ok(res, { profile: set('profile', merged) });
}));
app.delete('/api/profile', h(async (_req, res) => {
  set('profile', null); set('catalog', []); set('campaigns', []); set('photoshoots', []);
  set('websites', []); set('brandbook', null);
  ok(res, { profile: null });
}));
app.post('/api/agent', h(async (req, res) => ok(res, await agentChat(req.body?.messages))));

// ---------- qloo ----------
app.post('/api/qloo/search', h(async (req, res) => {
  const r = await qloo.searchEntities(req.body?.query, req.body?.types);
  ok(res, { results: r.results, mode: r.mode });
}));
app.post('/api/qloo/insights', h(async (req, res) => {
  const r = await qloo.insights({ type: req.body?.type, entities: req.body?.entities, tags: req.body?.tags, take: req.body?.take || 8 });
  ok(res, { entities: r.entities, mode: r.mode });
}));
app.get('/api/qloo/status', h(async (_req, res) => ok(res, qloo.status())));

// ---------- catalog ----------
app.get('/api/catalog', h(async (_req, res) => ok(res, { items: list('catalog') })));
app.post('/api/catalog', h(async (req, res) => {
  const { name, description, image, url, price } = req.body || {};
  if (!name) return res.status(400).json({ error: 'name required' });
  const item = { id: uid(), name, description: description || '', image: image || null, url: url || '', price: price || null };
  push('catalog', item); syncProfileCatalog();
  ok(res, { item });
}));
app.post('/api/catalog/from-url', h(async (req, res) => {
  const { url } = req.body || {};
  if (!url) return res.status(400).json({ error: 'url required' });
  const s = await fetchSite(url);
  let meta = null;
  try {
    meta = await chatJSON([
      { role: 'system', content: 'Extract the product being sold from this page data. Return {"name","description","price" or null}.' },
      { role: 'user', content: JSON.stringify({ title: s.title, description: s.description, text: s.text.slice(0, 3000) }) },
    ], { maxTokens: 3000 });
  } catch { /* fallback below */ }
  const item = {
    id: uid(),
    name: meta?.name || s.title || new URL(url).hostname,
    description: meta?.description || s.description || '',
    image: s.images?.[0]?.path || null,
    url,
    price: meta?.price || null,
  };
  push('catalog', item); syncProfileCatalog();
  ok(res, { item });
}));
app.put('/api/catalog/:id', h(async (req, res) => {
  const item = update('catalog', req.params.id, req.body?.patch || req.body || {});
  if (!item) return res.status(404).json({ error: 'not found' });
  syncProfileCatalog();
  ok(res, { item });
}));
app.delete('/api/catalog/:id', h(async (req, res) => {
  remove('catalog', req.params.id); syncProfileCatalog();
  ok(res, { ok: true });
}));
app.post('/api/catalog/:id/sync-image', h(async (req, res) => {
  const item = find('catalog', req.params.id);
  if (!item?.url) return res.status(400).json({ error: 'item has no url' });
  const s = await fetchSite(item.url);
  if (!s.images?.length) return res.status(422).json({ error: 'no image found on page' });
  const updated = update('catalog', item.id, { image: s.images[0].path });
  syncProfileCatalog();
  ok(res, { item: updated });
}));

// ---------- strategy board ----------
app.post('/api/strategy', h(async (req, res) => {
  const { prompt } = req.body || {};
  if (!prompt?.trim()) return res.status(400).json({ error: 'prompt required' });
  ok(res, await generateStrategies({ prompt: prompt.trim(), profile: brand.currentProfile() }));
}));

// ---------- campaigns + creatives ----------
function findCreative(id) {
  for (const c of list('campaigns')) {
    const cr = (c.creatives || []).find((x) => x.id === id);
    if (cr) return { campaign: c, creative: cr };
  }
  return null;
}
function saveCampaign(c) { update('campaigns', c.id, c); return find('campaigns', c.id); }

app.get('/api/campaigns', h(async (_req, res) => ok(res, { campaigns: list('campaigns') })));
app.post('/api/campaigns/brief', h(async (req, res) => {
  ok(res, await campaigns.generateBrief(req.body || {}, brand.currentProfile()));
}));
app.post('/api/campaigns', h(async (req, res) => {
  const { brief, productId, ingredients, aspectRatio, qlooSignals } = req.body || {};
  if (!brief?.title) return res.status(400).json({ error: 'brief required' });
  const campaign = {
    id: uid(), createdAt: now(), brief,
    productId: productId || null,
    ingredients: ingredients || { images: [] },
    aspectRatio: ['1:1', '4:5', '9:16', '16:9'].includes(aspectRatio) ? aspectRatio : '1:1',
    creatives: [],
    qlooSignals: qlooSignals || [],
  };
  push('campaigns', campaign);
  const profile = brand.currentProfile();
  const job = runJob('campaign', async () => {
    const creatives = await campaigns.generateCreatives(campaign, profile, 4);
    const stored = find('campaigns', campaign.id) || campaign;
    stored.creatives = creatives;
    saveCampaign(stored);
    return { campaignId: campaign.id, creatives: creatives.length };
  });
  ok(res, { campaign, job });
}));
app.get('/api/campaigns/:id', h(async (req, res) => {
  const c = find('campaigns', req.params.id);
  c ? ok(res, { campaign: c }) : res.status(404).json({ error: 'not found' });
}));
app.post('/api/creatives/:id/edit', h(async (req, res) => {
  const hit = findCreative(req.params.id);
  if (!hit) return res.status(404).json({ error: 'not found' });
  const { headline, body, cta, layout } = req.body || {};
  if (headline != null) hit.creative.headline = headline;
  if (body != null) hit.creative.body = body;
  if (cta != null) hit.creative.cta = cta;
  if (layout && typeof layout === 'object') hit.creative.layout = { ...hit.creative.layout, ...layout };
  saveCampaign(hit.campaign);
  ok(res, { creative: hit.creative });
}));
app.post('/api/creatives/:id/regenerate-image', h(async (req, res) => {
  const hit = findCreative(req.params.id);
  if (!hit) return res.status(404).json({ error: 'not found' });
  const profile = brand.currentProfile();
  const c = profile?.colors || {};
  const extra = req.body?.prompt ? `Additional art direction: ${req.body.prompt}.` : '';
  const prompt = [
    `A finished ${hit.campaign.aspectRatio || '1:1'} social media ad creative for "${profile?.name}".`,
    `Brand palette: ${c.primary}, ${c.secondary}, accent ${c.accent}, background ${c.background}.`,
    `Render this exact text legibly: headline "${hit.creative.headline}", body "${hit.creative.body}", CTA "${hit.creative.cta}".`,
    `Text placed ${hit.creative.layout?.vpos || 'bottom'} ${hit.creative.layout?.hpos || 'left'}. ${extra} Clean professional ad composition, no watermarks.`,
  ].join(' ');
  try {
    hit.creative.imagePath = await genImage(prompt, { aspectRatio: hit.campaign.aspectRatio, refs: (profile?.images || []).slice(0, 1).map((i) => ({ path: i.path })) });
    delete hit.creative.placeholder;
  } catch (e) {
    hit.creative.imagePath = campaigns.placeholderCreative(profile, hit.creative);
    hit.creative.placeholder = true;
    hit.creative.imageError = String(e.message || e).slice(0, 200);
  }
  store.registerImage(hit.creative.imagePath, { source: 'creative' });
  saveCampaign(hit.campaign);
  ok(res, { creative: hit.creative });
}));
app.post('/api/creatives/:id/fix-layout', h(async (req, res) => {
  const hit = findCreative(req.params.id);
  if (!hit) return res.status(404).json({ error: 'not found' });
  try {
    const out = await chatJSON([
      { role: 'system', content: 'Pick the best text placement for a social ad creative. Return {"vpos":"top|middle|bottom","hpos":"left|center|right"}.' },
      { role: 'user', content: JSON.stringify({ headline: hit.creative.headline, body: hit.creative.body, brief: hit.campaign.brief, aspectRatio: hit.campaign.aspectRatio }) },
    ], { maxTokens: 3000 });
    if (['top', 'middle', 'bottom'].includes(out?.vpos)) hit.creative.layout.vpos = out.vpos;
    if (['left', 'center', 'right'].includes(out?.hpos)) hit.creative.layout.hpos = out.hpos;
  } catch { /* keep existing layout */ }
  saveCampaign(hit.campaign);
  ok(res, { creative: hit.creative });
}));
app.post('/api/creatives/:id/animate', h(async (req, res) => {
  const hit = findCreative(req.params.id);
  if (!hit) return res.status(404).json({ error: 'not found' });
  if (!hit.creative.imagePath) return res.status(400).json({ error: 'creative has no image' });
  hit.creative.videoState = 'running';
  saveCampaign(hit.campaign);
  const job = runJob('video', async () => {
    const videoPath = await genVideo(
      `Animate this brand ad creative with subtle, premium motion: gentle camera push, product detail movement, ambient light shifts. Keep all on-image text crisp and readable. Brand: ${hit.campaign.brief?.title || 'ad'}.`,
      { aspectRatio: hit.campaign.aspectRatio === '16:9' ? '16:9' : '9:16', imagePath: hit.creative.imagePath },
    );
    const stored = find('campaigns', hit.campaign.id);
    const cr = stored?.creatives?.find((x) => x.id === hit.creative.id);
    if (cr) { cr.videoPath = videoPath; cr.videoState = 'done'; saveCampaign(stored); }
    return { creativeId: hit.creative.id, videoPath };
  });
  ok(res, { job });
}));

// ---------- photoshoot + images ----------
const SHOOT_TEMPLATES = {
  studio: 'clean studio product shot, soft gradient backdrop, professional lighting',
  lifestyle: 'in-use lifestyle scene, natural window light, candid editorial feel',
  'flat-lay': 'overhead flat-lay arrangement on a neutral textured surface',
  detail: 'extreme close-up macro highlighting texture, materials and details',
  outdoor: 'natural outdoor scene with golden-hour light',
};

function runShoot(shot, profile) {
  return runJob('image', async () => {
    const results = [];
    const refs = shot.inputImage ? [{ path: shot.inputImage }] : [];
    for (const tpl of shot.templates) {
      const scene = SHOOT_TEMPLATES[tpl] || tpl;
      const prompt = shot.mode === 'product'
        ? `Professional photoshoot image of this product — ${scene}. Brand "${profile?.name || ''}" style: ${(profile?.tone || []).join(', ') || 'clean, modern'}. Palette accents ${profile?.colors?.primary || ''}, ${profile?.colors?.accent || ''}. Commercial photography, high detail.`
        : `${shot.prompt || 'Brand photoshoot image'} — ${scene}. Style: ${(profile?.tone || []).join(', ') || 'clean, modern'}. Palette: ${profile?.colors?.primary || ''}, ${profile?.colors?.secondary || ''}.`;
      try {
        const p = await genImage(prompt, { refs, aspectRatio: '4:5' });
        store.registerImage(p, { source: 'photoshoot', template: tpl });
        results.push({ id: uid(), imagePath: p, template: tpl });
      } catch (e) {
        results.push({ id: uid(), imagePath: null, template: tpl, error: String(e.message || e).slice(0, 200) });
      }
    }
    const stored = find('photoshoots', shot.id);
    if (stored) { stored.results = results; update('photoshoots', shot.id, stored); }
    return { shootId: shot.id, n: results.filter((r) => r.imagePath).length };
  });
}

app.get('/api/photoshoot', h(async (_req, res) => ok(res, { jobs: list('photoshoots') })));
app.post('/api/photoshoot', h(async (req, res) => {
  const { mode, inputImage, prompt, templates } = req.body || {};
  const tpls = Array.isArray(templates) && templates.length ? templates.slice(0, 4) : ['studio', 'lifestyle'];
  const shot = { id: uid(), createdAt: now(), mode: mode === 'product' ? 'product' : 'free', inputImage: inputImage || null, prompt: prompt || '', templates: tpls, results: [], edits: [] };
  push('photoshoots', shot);
  ok(res, { job: runShoot(shot, brand.currentProfile()), shoot: shot });
}));
app.post('/api/photoshoot/:id/edit', h(async (req, res) => {
  const shot = find('photoshoots', req.params.id);
  if (!shot) return res.status(404).json({ error: 'not found' });
  const { prompt, imagePath } = req.body || {};
  if (!prompt || !imagePath) return res.status(400).json({ error: 'prompt and imagePath required' });
  const job = runJob('image', async () => {
    const p = await genImage(`Edit this image: ${prompt}. Keep everything else identical.`, { refs: [{ path: imagePath }], aspectRatio: '4:5' });
    store.registerImage(p, { source: 'photoshoot-edit' });
    const stored = find('photoshoots', shot.id);
    stored.edits = [...(stored.edits || []), { prompt, imagePath: p }];
    update('photoshoots', shot.id, stored);
    return { shootId: shot.id, imagePath: p };
  });
  ok(res, { job });
}));

app.post('/api/images/:id/resize', h(async (req, res) => {
  const rec = store.findImage(req.params.id);
  if (!rec) return res.status(404).json({ error: 'image not found' });
  const aspect = ['1:1', '4:5', '9:16', '16:9', '3:4', '4:3'].includes(req.body?.aspect) ? req.body.aspect : '1:1';
  const p = await genImage(`Reframe and extend this image to a ${aspect} composition. Keep the subject, style and colors identical — fill new areas naturally.`, { refs: [{ path: rec.path }], aspectRatio: aspect });
  const created = store.registerImage(p, { source: 'resize', of: rec.id });
  ok(res, { image: { id: created.id, imagePath: p } });
}));
app.post('/api/images/:id/animate', h(async (req, res) => {
  const rec = store.findImage(req.params.id);
  if (!rec) return res.status(404).json({ error: 'image not found' });
  const job = runJob('video', async () => {
    const videoPath = await genVideo(req.body?.prompt || 'Subtle cinematic motion, gentle camera push-in, ambient light shift. Keep the subject identical.', { imagePath: rec.path, aspectRatio: '9:16' });
    return { imageId: rec.id, videoPath };
  });
  ok(res, { job });
}));
app.put('/api/images/:id', h(async (req, res) => {
  const rec = store.findImage(req.params.id);
  if (!rec) return res.status(404).json({ error: 'image not found' });
  const { target, name, caption } = req.body || {};
  if (target === 'catalog') {
    const item = { id: uid(), name: name || 'Photoshoot result', description: caption || '', image: rec.path, url: '', price: null };
    push('catalog', item); syncProfileCatalog();
    return ok(res, { item });
  }
  const profile = get('profile');
  if (!profile) return res.status(404).json({ error: 'no profile yet' });
  const img = { id: uid(), path: rec.path, url: '', caption: caption || name || '' };
  profile.images = [...(profile.images || []), img];
  profile.updatedAt = now();
  set('profile', profile);
  ok(res, { profile });
}));

// ---------- websites ----------
app.get('/api/websites', h(async (_req, res) => ok(res, { websites: list('websites') })));
app.post('/api/websites', h(async (req, res) => {
  const profile = brand.currentProfile();
  if (!profile) return res.status(400).json({ error: 'build a profile first' });
  ok(res, { website: await generateWebsite(profile, req.body?.prompt || '') });
}));
app.post('/api/websites/:id/edit', h(async (req, res) => {
  const w = find('websites', req.params.id);
  if (!w) return res.status(404).json({ error: 'not found' });
  ok(res, { version: await editWebsite(w, req.body?.prompt || '', brand.currentProfile()) });
}));
const slugRe = /^[a-z0-9][a-z0-9-]{1,60}$/;
app.post('/api/websites/:id/publish', h(async (req, res) => {
  const w = find('websites', req.params.id);
  if (!w) return res.status(404).json({ error: 'not found' });
  let slug = req.body?.slug || w.publishedSlug || `site-${w.id.slice(0, 8)}`;
  if (!slugRe.test(slug)) return res.status(400).json({ error: 'slug must be lowercase alphanumerics and dashes' });
  const clash = list('websites').find((x) => x.publishedSlug === slug && x.id !== w.id);
  if (clash) return res.status(409).json({ error: 'slug already in use' });
  update('websites', w.id, { publishedSlug: slug });
  ok(res, { publishedSlug: slug });
}));
app.post('/api/websites/:id/unpublish', h(async (req, res) => {
  const w = find('websites', req.params.id);
  if (!w) return res.status(404).json({ error: 'not found' });
  update('websites', w.id, { publishedSlug: null });
  ok(res, { ok: true });
}));
app.delete('/api/websites/:id/versions/:vid', h(async (req, res) => {
  const w = find('websites', req.params.id);
  if (!w) return res.status(404).json({ error: 'not found' });
  const versions = w.versions.filter((v) => v.id !== req.params.vid);
  if (versions.length === w.versions.length) return res.status(404).json({ error: 'version not found' });
  const activeVersion = w.activeVersion === req.params.vid ? versions.at(-1)?.id || null : w.activeVersion;
  update('websites', w.id, { versions, activeVersion });
  ok(res, { ok: true });
}));
app.get('/s/:slug', h(async (req, res) => {
  const w = list('websites').find((x) => x.publishedSlug === req.params.slug);
  const v = siteVersion(w);
  if (!v) return res.status(404).send('Not published');
  res.type('html').send(v.html);
}));

// ---------- brand book ----------
app.get('/api/brandbook', h(async (_req, res) => ok(res, { book: get('brandbook') })));
app.post('/api/brandbook', h(async (req, res) => {
  const profile = brand.currentProfile();
  if (!profile) return res.status(400).json({ error: 'build a profile first' });
  ok(res, { book: buildBook(profile, req.body || {}) });
}));
app.post('/api/brandbook/publish', h(async (req, res) => {
  const book = get('brandbook');
  if (!book) return res.status(404).json({ error: 'no book yet' });
  const slug = req.body?.slug || book.publishedSlug || `book-${book.id.slice(0, 8)}`;
  if (!slugRe.test(slug)) return res.status(400).json({ error: 'slug must be lowercase alphanumerics and dashes' });
  book.publishedSlug = slug;
  set('brandbook', book);
  ok(res, { publishedSlug: slug });
}));
app.post('/api/brandbook/unpublish', h(async (_req, res) => {
  const book = get('brandbook');
  if (!book) return res.status(404).json({ error: 'no book yet' });
  delete book.publishedSlug;
  set('brandbook', book);
  ok(res, { book });
}));
app.get('/api/brandbook/pdf', h(async (_req, res) => {
  const book = get('brandbook');
  const profile = brand.currentProfile();
  if (!book || !profile) return res.status(404).json({ error: 'no book yet' });
  // no PDF engine on the box — serve the print-optimized view with a save-as-PDF hint
  res.type('html').send(htmlBook(book, profile, { printHint: true }));
}));
app.get('/b/:slug', h(async (req, res) => {
  const book = get('brandbook');
  const profile = brand.currentProfile();
  if (!book || book.publishedSlug !== req.params.slug || !profile) return res.status(404).send('Not published');
  res.type('html').send(htmlBook(book, profile));
}));

// ---------- upload ----------
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });
app.post('/api/upload', upload.single('file'), h(async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'file required' });
  const p = store.saveAssetBuf(req.file.buffer, store.mimeToExt(req.file.mimetype));
  store.registerImage(p, { source: 'upload', name: req.file.originalname });
  ok(res, { path: p });
}));

// ---------- SPA ----------
if (fs.existsSync(path.join(WEB_DIST, 'index.html'))) {
  app.use(express.static(WEB_DIST));
  app.get('*', (req, res, next) => {
    if (/^\/(api|assets|s|b)(\/|$)/.test(req.path)) return next();
    res.sendFile(path.join(WEB_DIST, 'index.html'));
  });
  console.log('[marque] serving web/dist');
}

app.listen(PORT, () => {
  console.log(`[marque] listening on :${PORT}`);
  console.log(`[marque] tensor: ${ENV.tensorKey ? 'configured' : 'missing'} | gemini: ${ENV.geminiKey ? 'configured' : 'missing'} | qloo: ${qloo.qlooMode()} | data: ${DATA_DIR}`);
});
