// marque server — Express app, routes per docs/API.md, in-memory job runner
import express from 'express';
import multer from 'multer';
import compression from 'compression';
import fs from 'node:fs';
import path from 'node:path';
import { PORT, ASSETS_DIR, WEB_DIST, ENV, DATA_DIR } from './config.js';
import { tuning } from './tuning.js';
import * as store from './services/store.js';
import { chat, chatJSON, tensorConfigured } from './services/tensor.js';
import { geminiConfigured } from './services/gemini.js';
import { genImageResilient, genVideoResilient, localgenHealth } from './services/media.js';
import * as qloo from './services/qloo.js';
import { fetchSite } from './services/scraper.js';
import * as brand from './services/brand.js';
import * as campaigns from './services/campaigns.js';
import { agentChat } from './services/agent.js';
import { generateStrategies } from './services/strategy.js';
import { generateExamples } from './services/scout.js';
import { generateWebsite, editWebsite, siteVersion } from './services/sites.js';
import { buildBook, htmlBook } from './services/brandbook.js';

const { get, set, list, push, find, update, remove, uid, now } = store;

store.init();
const app = express();
app.use(compression());
app.use(express.json({ limit: '30mb' }));
// bad JSON bodies get a clean 400 — never the default HTML stack trace
app.use((err, _req, res, next) => {
  if (err?.type === 'entity.parse.failed' || err instanceof SyntaxError) return res.status(400).json({ error: 'malformed JSON body' });
  if (err?.type === 'entity.too.large' || err?.name === 'MulterError' || err?.code === 'LIMIT_FILE_SIZE')
    return res.status(413).json({ error: 'payload too large' });
  next(err);
});
app.use('/assets', express.static(ASSETS_DIR, {
  maxAge: '7d', immutable: true,
  // user-uploaded SVGs could carry inline script — serve in a CSP sandbox so
  // direct navigation renders harmlessly; <img> display is unaffected
  setHeaders: (res) => {
    res.setHeader('Content-Security-Policy', "sandbox; default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:; media-src 'self'");
    res.setHeader('X-Content-Type-Options', 'nosniff');
  },
}));

const h = (fn) => (req, res) => Promise.resolve(fn(req, res)).catch((e) => {
  console.error(`[marque] ${req.method} ${req.path} →`, e.message);
  const msg = String(e.message || e);
  // caller-caused failures (unreachable/private URLs) are 4xx, not 5xx
  res.status(/private|loopback|link-local|metadata/i.test(msg) ? 400 : 500).json({ error: msg });
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
  const lg = await localgenHealth().catch(() => ({ ok: false }));
  ok(res, {
    tensor: tensorConfigured(), gemini: geminiConfigured(), qloo: q.mode, qlooNote: q.note,
    localgen: { configured: !!ENV.localgenUrl, mode: ENV.localgenProvider || 'off', ok: !!lg.ok, model: lg.model },
  });
}));

// ---------- profile ----------
function syncProfileCatalog() {
  const p = get('profile');
  if (p) { p.catalog = list('catalog'); p.updatedAt = now(); set('profile', p); }
  return p;
}

app.post('/api/profile/build', h(async (req, res) => {
  const { url, templateId, includeListing } = req.body || {};
  if (templateId) return ok(res, await brand.buildFromTemplate(templateId));
  if (!url) return res.status(400).json({ error: 'url required' });
  ok(res, await brand.buildProfileFromWebsite(url, { includeListing }));
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
  set('websites', []); set('brandbook', null); set('lastStrategy', null);
  set('boards', []); set('activeBoardId', null); exCache.clear();
  ok(res, { profile: null });
}));
app.post('/api/agent', h(async (req, res) => ok(res, await agentChat(req.body?.messages))));
// Streaming variant — SSE: 'token' {delta} per model token (reply text only,
// decoded from the JSON envelope), 'tool' per tool call, 'done' final result.
app.post('/api/agent/stream', async (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  const send = (event, data) => { try { res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); } catch { /* client gone */ } };
  const flush = res.flushHeaders?.bind(res); if (flush) flush();
  const heartbeat = setInterval(() => { try { res.write(': ping\n\n'); } catch { /* client gone */ } }, 15000);
  try {
    const { agentChatStream } = await import('./services/agent.js');
    const result = await agentChatStream(req.body?.messages, (ev, data) => send(ev, data));
    send('done', result);
  } catch (e) {
    send('error', { error: String(e.message || e) });
  }
  clearInterval(heartbeat);
  res.end();
});

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

// ---------- strategy boards (plans) ----------
function boardTitle(prompt) {
  const t = String(prompt || '').replace(/\s+/g, ' ').trim();
  if (t.length <= 48) return t || 'Untitled plan';
  // cut at a word boundary, mark the truncation — no mid-word stumps
  return `${t.slice(0, 48).replace(/\s+\S*$/, '')}…`;
}
function boardSummary(b) {
  const strats = b.strategies || [];
  return {
    id: b.id, title: b.title || 'Untitled plan', createdAt: b.createdAt || null, sub: b.sub || null, strategyCount: strats.length,
    // card-level fields so list views don't need a per-board fetch (N+1)
    titles: strats.slice(0, 3).map((s) => s.title).filter(Boolean),
    channels: [...new Set(strats.flatMap((s) => (s.channels || []).map((c) => c.name)))].slice(0, 5),
    qlooMode: honestBoard(b).evidence?.qlooMode || null,
  };
}
// card-level strategy — deep fields (brief/watchouts/formats/fit likes) are
// served per-card on demand via /api/boards/:id/strategies/:idx so a click
// actually fetches the campaign board instead of revealing preloaded data.
function slimStrategy(s) {
  return {
    id: s.id, title: s.title, angle: s.angle, heroSignal: s.heroSignal,
    channels: (s.channels || []).map((c) => ({ name: c.name, fit: c.fit })),
    audienceFit: { score: s.audienceFit?.score },
    reach: s.reach, qlooSignals: s.qlooSignals,
    // card-level context — enough to judge the play without opening it; the
    // deep fields (watchouts, channel why, fit notes) still fetch on click
    brief: { audience: s.brief?.audience, keyMessage: s.brief?.keyMessage },
    formats: (s.formats || []).slice(0, 4),
  };
}
// a board's mode label is recomputed from its own call log on read — every
// call is 'live' or 'error', so the label is live / partial / error honestly
function honestBoard(b) {
  if (!b) return b;
  const modes = (b.evidence?.calls || []).map((c) => c?.mode).filter(Boolean);
  if (!modes.length) return b;
  const live = modes.filter((m) => m === 'live').length;
  const mode = live === modes.length ? 'live' : live > 0 ? 'partial' : 'error';
  return {
    ...b,
    evidence: b.evidence ? { ...b.evidence, qlooMode: mode } : b.evidence,
    qlooBundle: b.qlooBundle ? { ...b.qlooBundle, mode } : b.qlooBundle,
  };
}
function slimBoard(b) {
  b = honestBoard(b);
  return b && { ...b, strategies: (b.strategies || []).map(slimStrategy) };
}
function migrateBoards() {
  // one-time lazy migration: a legacy single 'lastStrategy' becomes the first board
  const last = get('lastStrategy');
  if (!last || list('boards').length) return;
  const board = { id: uid(), title: boardTitle(last.sub?.prompt), createdAt: last.fetchedAt || now(), activeStrategyIdx: null, ...last };
  push('boards', board);
  set('activeBoardId', board.id);
}
function resolveActiveBoard() {
  migrateBoards();
  const boards = list('boards');
  return boards.find((b) => b.id === get('activeBoardId')) || get('lastStrategy') || boards.at(-1) || null;
}

app.post('/api/strategy', h(async (req, res) => {
  const { prompt, productId, url } = req.body || {};
  const raw = (prompt || '').trim();
  // allow the URL itself to be the "prompt" (product/site scouting)
  const inlineUrl = url || (raw.match(/https?:\/\/\S+/) || [])[0] || null;
  if (!raw && !inlineUrl) return res.status(400).json({ error: 'prompt required' });
  const product = productId ? find('catalog', productId) : null;
  let urlContext = null;
  if (inlineUrl) {
    try {
      const s = await fetchSite(inlineUrl);
      urlContext = { url: inlineUrl, title: s.title, description: s.description || s.meta?.description || '' };
    } catch { urlContext = { url: inlineUrl, scrapeFailed: true }; }
  }
  const finalPrompt = raw || `analyze this product/site and suggest campaign strategies: ${inlineUrl}`;
  const result = await generateStrategies({ prompt: finalPrompt, profile: brand.currentProfile(), product, urlContext });
  result.sub = { prompt: finalPrompt, productId: productId || '', url: inlineUrl || '' };
  const board = { id: uid(), title: boardTitle(finalPrompt), createdAt: now(), activeStrategyIdx: null, urlContext, ...result };
  push('boards', board);
  set('activeBoardId', board.id);
  set('lastStrategy', board);   // backward compat: GET /api/strategy + legacy readers
  ok(res, slimBoard(board));
}));
app.get('/api/strategy', h(async (_req, res) => {
  ok(res, { board: slimBoard(resolveActiveBoard()), boards: list('boards').map(boardSummary) });
}));
// Streaming variant — SSE frames land as each pipeline stage finishes, so the
// board fills in real time: audience read first (deterministic, ~instant),
// then strategies, then ruled-out rows, then the saved board.
app.post('/api/strategy/stream', async (req, res) => {
  const { prompt, productId, url } = req.body || {};
  const raw = (prompt || '').trim();
  const inlineUrl = url || (raw.match(/https?:\/\/\S+/) || [])[0] || null;
  if (!raw && !inlineUrl) return res.status(400).json({ error: 'prompt required' });
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  const send = (event, data) => { try { res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); } catch { /* client gone */ } };
  const flush = res.flushHeaders?.bind(res); if (flush) flush();
  try {
    const product = productId ? find('catalog', productId) : null;
    let urlContext = null;
    if (inlineUrl) {
      send('stage', { stage: 'scraping', url: inlineUrl });
      try {
        const s = await fetchSite(inlineUrl);
        urlContext = { url: inlineUrl, title: s.title, description: s.description || s.meta?.description || '' };
      } catch { urlContext = { url: inlineUrl, scrapeFailed: true }; }
      send('stage', { stage: 'scraped', urlContext });
    }
    const finalPrompt = raw || `analyze this product/site and suggest campaign strategies: ${inlineUrl}`;
    const result = await generateStrategies({
      prompt: finalPrompt, profile: brand.currentProfile(), product, urlContext,
      onStage: (event, data) => send(event, data),
    });
    result.sub = { prompt: finalPrompt, productId: productId || '', url: inlineUrl || '' };
    const board = { id: uid(), title: boardTitle(finalPrompt), createdAt: now(), activeStrategyIdx: null, urlContext, ...result };
    push('boards', board);
    set('activeBoardId', board.id);
    set('lastStrategy', board);
    send('done', { board: slimBoard(board) });
  } catch (e) {
    send('error', { error: String(e.message || e) });
  }
  res.end();
});
const exCache = new Map(); // in-memory per-board cache — re-visiting a card doesn't re-scrape
app.post('/api/strategy/examples', h(async (req, res) => {
  const { strategy, audienceRead, boardId, hint } = req.body || {};
  if (!strategy?.id && !strategy?.title) return res.status(400).json({ error: 'strategy required' });
  if (strategy.channels !== undefined && !Array.isArray(strategy.channels)) return res.status(400).json({ error: 'strategy.channels must be an array' });
  const skey = strategy.id || strategy.title;
  const scope = boardId || get('activeBoardId') || '';
  const key = `${scope ? `${scope}:` : ''}${skey}:${String(hint || '').toLowerCase()}`;
  if (exCache.has(key)) return ok(res, exCache.get(key));
  const exBoard = (boardId && find('boards', boardId)) || resolveActiveBoard();
  const product = exBoard?.sub?.productId ? find('catalog', exBoard.sub.productId) : null;
  const data = await generateExamples({ strategy, profile: brand.currentProfile(), audienceRead, product, hint, qlooBundle: exBoard?.qlooBundle });
  if (exCache.size > tuning('exampleCacheSize')) exCache.clear();
  exCache.set(key, data);
  ok(res, data);
}));

// ---------- boards ----------
app.get('/api/boards', h(async (_req, res) => {
  migrateBoards();
  ok(res, { boards: list('boards').map(boardSummary), activeBoardId: get('activeBoardId') });
}));
app.get('/api/boards/:id', h(async (req, res) => {
  const b = find('boards', req.params.id);
  b ? ok(res, { board: slimBoard(b) }) : res.status(404).json({ error: 'board not found' });
}));
// deep fields for ONE strategy — fetched when the user opens the card
app.get('/api/boards/:id/strategies/:idx', h(async (req, res) => {
  const b = find('boards', req.params.id);
  if (!b) return res.status(404).json({ error: 'board not found' });
  const s = (b.strategies || [])[+req.params.idx];
  if (!s) return res.status(404).json({ error: 'strategy not found' });
  const ev = honestBoard(b).evidence;
  ok(res, {
    strategy: s,
    audienceRead: b.audienceRead || null,
    evidence: ev ? {
      qlooMode: ev.qlooMode, signals: ev.signals,
      drivers: ev.drivers, calls: ev.calls,
      qlooEvidence: ev.qlooEvidence, source: ev.source,
    } : null,
  });
}));
app.post('/api/boards/:id/activate', h(async (req, res) => {
  const b = find('boards', req.params.id);
  if (!b) return res.status(404).json({ error: 'board not found' });
  set('activeBoardId', b.id);
  set('lastStrategy', b);   // whole board — keeps GET /api/strategy correct
  ok(res, { board: b, activeBoardId: b.id });
}));
app.patch('/api/boards/:id', h(async (req, res) => {
  const b = find('boards', req.params.id);
  if (!b) return res.status(404).json({ error: 'board not found' });
  const title = typeof req.body?.title === 'string' ? req.body.title.trim() : '';
  if (!title || title.length > 120) return res.status(400).json({ error: 'title must be a non-empty string up to 120 chars' });
  const board = update('boards', b.id, { title });
  if (get('activeBoardId') === b.id) set('lastStrategy', board); // keep legacy pointer fresh
  ok(res, { board });
}));
app.delete('/api/boards/:id', h(async (req, res) => {
  const b = find('boards', req.params.id);
  if (!b) return res.status(404).json({ error: 'board not found' });
  remove('boards', b.id);
  if (get('activeBoardId') === b.id) {
    const next = list('boards')
      .slice()
      .sort((x, y) => String(x.createdAt || '').localeCompare(String(y.createdAt || '')))
      .at(-1) || null;
    set('activeBoardId', next?.id || null);
    set('lastStrategy', next);
  } else if (get('lastStrategy')?.id === b.id) {
    set('lastStrategy', find('boards', get('activeBoardId')));
  }
  ok(res, { ok: true, activeBoardId: get('activeBoardId') });
}));

// ---------- dashboard ----------
app.get('/api/dashboard', h(async (_req, res) => {
  migrateBoards();
  const p = brand.currentProfile();
  const boards = list('boards').map((b) => ({
    ...boardSummary(b),
    channels: (b.strategies?.[0]?.channels || []).slice(0, 4).map((c) => c.name).filter(Boolean),
    topReach: (b.strategies || []).reduce((m, s) => Math.max(m, +s.reach?.estViews || 0), 0),
  }));
  ok(res, {
    profile: p ? { name: p.name || '', tagline: p.tagline || '', source: p.source || null } : null,
    boards,
    campaigns: list('campaigns').map((c) => ({
      id: c.id,
      title: c.brief?.title || 'Untitled campaign',
      createdAt: c.createdAt || null,
      creativeCount: (c.creatives || []).length,
      strategyTitle: c.strategyTitle || '',
    })),
    photoshootCount: list('photoshoots').length,
    websiteCount: list('websites').length,
    brandbook: !!get('brandbook'),
    qlooMode: qloo.status().mode,
  });
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

app.get('/api/campaigns', h(async (_req, res) => {
  const boards = list('boards') || [];
  ok(res, {
    campaigns: list('campaigns').map((c) => {
      const b = boards.find((x) => x.id === c.boardId);
      return { ...c, qlooBundle: b?.qlooBundle || c.qlooBundle || null, evidence: b?.evidence || c.evidence || null };
    }),
  });
}));
app.delete('/api/campaigns/:id', h(async (req, res) => {
  if (!find('campaigns', req.params.id)) return res.status(404).json({ error: 'not found' });
  remove('campaigns', req.params.id);
  ok(res, { deleted: req.params.id });
}));
app.post('/api/campaigns/brief', h(async (req, res) => {
  ok(res, await campaigns.generateBrief(req.body || {}, brand.currentProfile()));
}));
app.post('/api/campaigns', h(async (req, res) => {
  const { brief, productId, ingredients, aspectRatio, qlooSignals, notes, strategyId, strategyTitle, boardId, provider } = req.body || {};
  if (!brief?.title) return res.status(400).json({ error: 'brief required' });
  // Snapshot the source board's bundle only when the caller names it — the
  // board drives product context (resolveProductContext), so guessing it from
  // "signals were passed" contaminates the creative copy with the wrong brand.
  const srcBoard = (boardId && find('boards', boardId)) || null;
  const campaign = {
    id: uid(), createdAt: now(), brief,
    productId: productId || null,
    ingredients: ingredients || { images: [] },
    aspectRatio: ['1:1', '4:5', '9:16', '16:9'].includes(aspectRatio) ? aspectRatio : '1:1',
    creatives: [],
    qlooSignals: qlooSignals || [],
    notes: notes || '',
    strategyId: strategyId || null,
    strategyTitle: strategyTitle || '',
    boardId: boardId || null,
    qlooBundle: srcBoard?.qlooBundle || null,
    evidence: srcBoard?.evidence || null,
    imageProvider: ['local', 'gemini', 'pollinations'].includes(provider) ? provider : undefined,
  };
  push('campaigns', campaign);
  const profile = brand.currentProfile();
  const job = runJob('campaign', async (j) => {
    const creatives = await campaigns.generateCreatives(campaign, profile, 4, (p) => { j.progress = p; });
    const stored = find('campaigns', campaign.id) || campaign;
    stored.creatives = creatives;
    saveCampaign(stored);
    return { campaignId: campaign.id, creatives: creatives.length };
  });
  ok(res, { campaign, job });
}));
app.get('/api/campaigns/:id', h(async (req, res) => {
  const c = find('campaigns', req.params.id);
  if (!c) return res.status(404).json({ error: 'not found' });
  const b = honestBoard((list('boards') || []).find((x) => x.id === c.boardId));
  ok(res, { campaign: { ...c, qlooBundle: b?.qlooBundle || c.qlooBundle || null, evidence: b?.evidence || c.evidence || null } });
}));
app.post('/api/creatives/:id/edit', h(async (req, res) => {
  const hit = findCreative(req.params.id);
  if (!hit) return res.status(404).json({ error: 'not found' });
  const { headline, body, cta, layout, grade, overlayStyle } = req.body || {};
  if (headline != null) hit.creative.headline = headline;
  if (body != null) hit.creative.body = body;
  if (cta != null) hit.creative.cta = cta;
  if (grade != null) hit.creative.grade = Math.max(0, Math.min(5, +grade || 0));
  if (overlayStyle != null) hit.creative.overlayStyle = String(overlayStyle).slice(0, 24);
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
  const prod = await campaigns.resolveProductContext(hit.campaign);
  const brandName = prod?.name || profile?.name;
  const vpos = hit.creative.layout?.vpos || 'bottom';
  const space = vpos === 'top' ? 'upper third' : vpos === 'middle' ? 'center band' : 'lower third';
  const prompt = [
    `Editorial ad photograph for "${brandName}", ${hit.campaign.aspectRatio || '1:1'} composition native to ${(hit.campaign.brief?.channels || [])[0] || 'instagram'} — strong focal subject, real platform content feel, not a generic stock gradient.`,
    hit.campaign.brief?.angle ? `Campaign angle: ${hit.campaign.brief.angle}.` : '',
    prod ? `Featuring: "${prod.name}"${prod.description ? ` — ${prod.description}` : ''}.` : '',
    `CRITICAL: absolutely NO text, words, letters, typography, logos, captions or watermarks — NO newspapers, magazines, books, posters, packaging, signage, screens or printed materials; plain unmarked objects only. Clean negative space in the ${space} for a headline overlay.`,
    `Art direction palette: ${c.primary}, ${c.secondary}, accent ${c.accent}. ${extra}`,
  ].join(' ');
  try {
    const g = await genImageResilient(prompt, { aspectRatio: hit.campaign.aspectRatio, provider: ['local', 'gemini', 'pollinations'].includes(req.body?.provider) ? req.body.provider : undefined, refs: (profile?.images || []).slice(0, 1).map((i) => ({ path: i.path })) });
    hit.creative.imagePath = g.path;
    hit.creative.imageProvider = g.provider;
    hit.creative.cleanImage = true;
    delete hit.creative.placeholder;
    delete hit.creative.imageError;
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
app.delete('/api/creatives/:id', h(async (req, res) => {
  const hit = findCreative(req.params.id);
  if (!hit) return res.status(404).json({ error: 'not found' });
  hit.campaign.creatives = (hit.campaign.creatives || []).filter((x) => x.id !== req.params.id);
  saveCampaign(hit.campaign);
  ok(res, { deleted: req.params.id });
}));
app.post('/api/creatives/:id/animate', h(async (req, res) => {
  const hit = findCreative(req.params.id);
  if (!hit) return res.status(404).json({ error: 'not found' });
  if (!hit.creative.imagePath) return res.status(400).json({ error: 'creative has no image' });
  hit.creative.videoState = 'running';
  saveCampaign(hit.campaign);
  const job = runJob('video', async () => {
    try {
      const v = await genVideoResilient(
        `Animate this brand ad creative with subtle, premium motion: gentle camera push, product detail movement, ambient light shifts. Keep all on-image text crisp and readable. Brand: ${hit.campaign.brief?.title || 'ad'}.`,
        { aspectRatio: hit.campaign.aspectRatio === '16:9' ? '16:9' : '9:16', imagePath: hit.creative.imagePath },
      );
      const stored = find('campaigns', hit.campaign.id);
      const cr = stored?.creatives?.find((x) => x.id === hit.creative.id);
      if (cr) { cr.videoPath = v.path; cr.videoState = 'done'; cr.videoProvider = v.provider; if (v.note) cr.videoNote = v.note; saveCampaign(stored); }
      return { creativeId: hit.creative.id, videoPath: v.path, provider: v.provider };
    } catch (e) {
      const stored = find('campaigns', hit.campaign.id);
      const cr = stored?.creatives?.find((x) => x.id === hit.creative.id);
      if (cr) { cr.videoState = 'error'; saveCampaign(stored); }
      throw e;
    }
  });
  ok(res, { job });
}));

// ---------- photoshoot + images ----------
const SHOOT_TEMPLATES = tuning('shootTemplates');

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
        const g = await genImageResilient(prompt, { refs, aspectRatio: '4:5' });
        store.registerImage(g.path, { source: 'photoshoot', template: tpl, provider: g.provider });
        results.push({ id: uid(), imagePath: g.path, template: tpl, provider: g.provider });
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
    const g = await genImageResilient(`Edit this image: ${prompt}. Keep everything else identical.`, { refs: [{ path: imagePath }], aspectRatio: '4:5' });
    store.registerImage(g.path, { source: 'photoshoot-edit', provider: g.provider });
    const stored = find('photoshoots', shot.id);
    stored.edits = [...(stored.edits || []), { prompt, imagePath: g.path, provider: g.provider }];
    update('photoshoots', shot.id, stored);
    return { shootId: shot.id, imagePath: g.path, provider: g.provider };
  });
  ok(res, { job });
}));

app.post('/api/images/:id/resize', h(async (req, res) => {
  const rec = store.findImage(req.params.id);
  if (!rec) return res.status(404).json({ error: 'image not found' });
  const aspect = ['1:1', '4:5', '9:16', '16:9', '3:4', '4:3'].includes(req.body?.aspect) ? req.body.aspect : '1:1';
  const g = await genImageResilient(`Reframe and extend this image to a ${aspect} composition. Keep the subject, style and colors identical — fill new areas naturally.`, { refs: [{ path: rec.path }], aspectRatio: aspect });
  const created = store.registerImage(g.path, { source: 'resize', of: rec.id, provider: g.provider });
  ok(res, { image: { id: created.id, imagePath: g.path, provider: g.provider } });
}));
app.post('/api/images/:id/animate', h(async (req, res) => {
  const rec = store.findImage(req.params.id);
  if (!rec) return res.status(404).json({ error: 'image not found' });
  const job = runJob('video', async () => {
    const v = await genVideoResilient(req.body?.prompt || 'Subtle cinematic motion, gentle camera push-in, ambient light shift. Keep the subject identical.', { imagePath: rec.path, aspectRatio: '9:16' });
    return { imageId: rec.id, videoPath: v.path, provider: v.provider };
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
app.get('/api/websites', h(async (_req, res) => ok(res, { websites: list('websites'), lastAudit: get('lastSiteAudit') || null })));
app.post('/api/websites', h(async (req, res) => {
  const profile = brand.currentProfile();
  if (!profile) return res.status(400).json({ error: 'build a profile first' });
  const prompt = typeof req.body?.prompt === 'string' ? req.body.prompt.trim() : '';
  ok(res, { website: await generateWebsite(profile, prompt) });
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
app.delete('/api/websites/:id', h(async (req, res) => {
  if (!find('websites', req.params.id)) return res.status(404).json({ error: 'not found' });
  remove('websites', req.params.id);
  ok(res, { deleted: req.params.id });
}));
app.delete('/api/brandbook', h(async (_req, res) => {
  set('brandbook', null);
  ok(res, { deleted: true });
}));
app.post('/api/websites/:id/unpublish', h(async (req, res) => {
  const w = find('websites', req.params.id);
  if (!w) return res.status(404).json({ error: 'not found' });
  update('websites', w.id, { publishedSlug: null });
  ok(res, { ok: true });
}));
// analyze the current site vs audience/competitor taste signals → fix-list
app.post('/api/websites/improve', h(async (req, res) => {
  const profile = brand.currentProfile();
  if (!profile) return res.status(400).json({ error: 'build a profile first' });
  const { url } = req.body || {};
  const target = url || profile.source?.url;
  if (!target) return res.status(422).json({ error: 'no site on file — add a website URL first' });
  let site = null;
  try { site = await fetchSite(target); } catch { /* continue w/o scrape */ }
  const brandAffs = (profile.qloo?.affinities || []).find((a) => a.type === 'urn:entity:brand')?.entities || [];
  const competitors = brandAffs.slice(0, 4).map((e) => e.name);
  const j = await chatJSON([
    { role: 'system', content: 'You are a conversion-focused web strategist. Strict JSON only.' },
    { role: 'user', content: [
      `Brand: ${profile.name} — ${profile.tagline || ''}. Site: ${target || 'unknown'}.`,
      site ? `Site title: ${site.title}. Description: ${site.description}. Socials found: ${Object.keys(site.socials || {}).join(', ') || 'none'}. Missing socials: ${(site.missingSocials || []).join(', ') || 'none'}.` : '',
      `Audience-adjacent brands (taste graph): ${competitors.join(', ') || 'unknown'}.`,
      `Return {"suggestions":[{"area","fix","why","effort":"low|med|high","impact":"low|med|high"}],"competitorNotes":[{"brand","steal"}]} — 5-8 concrete fixes ranked by impact, each tied to the audience data or a competitor pattern. competitorNotes = what to steal from each adjacent brand.`,
    ].filter(Boolean).join('\n') },
  ], { maxTokens: 2600 });
  const audit = { url: target, scraped: !!site, socials: site?.socials || {}, missingSocials: site?.missingSocials || [], suggestions: j.suggestions || [], competitorNotes: j.competitorNotes || [], competitors, at: now() };
  set('lastSiteAudit', audit);   // a 20s+ analysis shouldn't vanish on navigation
  ok(res, audit);
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

// unknown API paths get a JSON 404, never Express's HTML page
app.use('/api', (_req, res) => res.status(404).json({ error: 'not found' }));

// ---------- SPA ----------
if (fs.existsSync(path.join(WEB_DIST, 'index.html'))) {
  app.use(express.static(WEB_DIST, { setHeaders: (res, p) => {
    if (/\.(js|css|woff2?|png|jpe?g|svg|webp|mp4)$/.test(p)) res.setHeader('Cache-Control', 'public, max-age=604800, immutable');
  } }));
  app.get('*', (req, res, next) => {
    if (/^\/(api|assets|s|b)(\/|$)/.test(req.path)) return next();
    res.sendFile(path.join(WEB_DIST, 'index.html'), (err) => {
      if (err && !res.headersSent) res.status(503).type('html').send(
        '<meta charset=utf-8><body style="font-family:system-ui;display:grid;place-items:center;min-height:100vh;margin:0">'
        + '<div style="text-align:center"><h2>Studio is rebuilding…</h2><p>Refresh in a few seconds.</p></div></body>');
    });
  });
  console.log('[marque] serving web/dist');
}

app.listen(PORT, () => {
  console.log(`[marque] listening on :${PORT}`);
  console.log(`[marque] tensor: ${ENV.tensorKey ? 'configured' : 'missing'} | gemini: ${ENV.geminiKey ? 'configured' : 'missing'} | qloo: ${qloo.qlooMode()} | data: ${DATA_DIR}`);
});
