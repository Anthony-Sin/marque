// Marque API client — thin fetch wrapper matching docs/API.md.
import { cleanErr } from './labels.js';

const J = (r) => {
  if (!r.ok) throw Object.assign(new Error(`HTTP ${r.status}`), { status: r.status, body: r._body });
  return r;
};
async function req(method, url, body, opts = {}) {
  const r = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    ...opts,
  });
  if (!r.ok) {
    let detail = '';
    try { detail = (await r.json()).error || ''; } catch {}
    // ~30 toasts and {err} blocks print e.message verbatim — it must read
    // like a sentence, never a "POST /api/x → 503 {provider dump}" combo.
    // A short plain detail keeps its status for honesty ('not found → 404');
    // a long or raw one (paths, JSON, engine dumps) reduces to the cleaned
    // detail text alone. The untouched route+status+detail lives on e.debug
    // for console logging.
    const debug = `${method} ${url} → ${r.status}${detail ? ` ${detail}` : ''}`;
    const plain = !!detail && detail.length <= 90 && !/[{}"'<>\\/]|https?:/.test(detail);
    const e = new Error(
      detail
        ? (plain ? `${cleanErr(detail) || 'the request failed'} → ${r.status}` : cleanErr(detail, 160) || 'the request failed — try again')
        : `the request failed → ${r.status}`,
    );
    e.status = r.status;
    e.debug = debug;
    throw e;
  }
  const ct = r.headers.get('content-type') || '';
  return ct.includes('json') ? r.json() : r;
}

export const api = {
  status: () => req('GET', '/api/status'),
  // profile / onboarding
  getProfile: () => req('GET', '/api/profile'),
  buildProfile: (url, includeListing) => req('POST', '/api/profile/build', { url, includeListing }),
  scratchProfile: (messages, attachments) => req('POST', '/api/profile/scratch', { messages, attachments }),
  templateProfile: (templateId) => req('POST', '/api/profile/template', { templateId }),
  updateProfile: (patch) => req('PUT', '/api/profile', { patch }),
  agent: (messages) => req('POST', '/api/agent', { messages }),
  // SSE agent chat — onEvent('token',{delta}) per streamed reply token,
  // 'tool' {label,detail} per tool call, 'done' {reply,patch,evidence}.
  agentStream: async (messages, onEvent) => {
    const r = await fetch('/api/agent/stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages }),
    });
    if (!r.ok || !r.body) throw new Error(`the agent stream failed → ${r.status}`);
    const reader = r.body.getReader();
    const dec = new TextDecoder();
    let buf = ''; let final = null;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let cut;
      while ((cut = buf.indexOf('\n\n')) >= 0) {
        const frame = buf.slice(0, cut); buf = buf.slice(cut + 2);
        const ev = (frame.match(/^event: (.+)$/m) || [])[1];
        const raw = (frame.match(/^data: (.+)$/m) || [])[1];
        if (!ev || !raw) continue;
        let data = null; try { data = JSON.parse(raw); } catch {}
        if (ev === 'done') final = data;
        else if (ev === 'error') throw new Error(cleanErr(data?.error, 160) || 'agent failed');
        else onEvent?.(ev, data);
      }
    }
    return final;
  },
  // qloo
  qlooSearch: (query) => req('POST', '/api/qloo/search', { query }),
  qlooInsights: (type, params) => req('POST', '/api/qloo/insights', { type, ...params }),
  qlooStatus: () => req('GET', '/api/qloo/status'),
  // catalog
  listCatalog: () => req('GET', '/api/catalog'),
  addCatalog: (item) => req('POST', '/api/catalog', item),
  addCatalogFromUrl: (url) => req('POST', '/api/catalog/from-url', { url }),
  updateCatalog: (id, patch) => req('PUT', `/api/catalog/${id}`, { patch }),
  deleteCatalog: (id) => req('DELETE', `/api/catalog/${id}`),
  syncCatalogImage: (id) => req('POST', `/api/catalog/${id}/sync-image`),
  // strategy board
  strategy: (prompt, productId, url) => req('POST', '/api/strategy', { prompt, productId, url }),
  // SSE strategy generation — onEvent(name, data) fires per pipeline stage:
  // 'stage' (scraping), 'audience' (taste-graph read), 'strategies', 'anti',
  // 'done' ({board}), 'error'. Returns the final board.
  strategyStream: async (prompt, productId, url, onEvent) => {
    const r = await fetch('/api/strategy/stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, productId, url }),
    });
    if (!r.ok || !r.body) throw new Error(`the strategy stream failed → ${r.status}`);
    const reader = r.body.getReader();
    const dec = new TextDecoder();
    let buf = ''; let finalBoard = null;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let cut;
      while ((cut = buf.indexOf('\n\n')) >= 0) {
        const frame = buf.slice(0, cut); buf = buf.slice(cut + 2);
        const ev = (frame.match(/^event: (.+)$/m) || [])[1];
        const raw = (frame.match(/^data: (.+)$/m) || [])[1];
        if (!ev || !raw) continue;
        let data = null; try { data = JSON.parse(raw); } catch {}
        if (ev === 'done') finalBoard = data?.board;
        else if (ev === 'error') throw new Error(cleanErr(data?.error, 160) || 'strategy failed');
        else onEvent?.(ev, data);
      }
    }
    onEvent?.('done', { board: finalBoard });
    return finalBoard;
  },
  getStrategy: () => req('GET', '/api/strategy'),
  strategyExamples: (strategy, audienceRead, hint, boardId) => req('POST', '/api/strategy/examples', { strategy, audienceRead, hint, boardId }),
  // multi-plan boards
  boards: () => req('GET', '/api/boards'),
  board: (id) => req('GET', `/api/boards/${id}`),
  boardStrategy: (id, idx) => req('GET', `/api/boards/${id}/strategies/${idx}`),
  activateBoard: (id) => req('POST', `/api/boards/${id}/activate`),
  renameBoard: (id, title) => req('PATCH', `/api/boards/${id}`, { title }),
  deleteBoard: (id) => req('DELETE', `/api/boards/${id}`),
  // moodboard — 9 localgen tiles per board; POST starts the ~1min job
  // (dedup mid-run returns the same job), GET 404s until tiles exist
  moodboard: (id) => req('GET', `/api/boards/${id}/moodboard`),
  genMoodboard: (id) => req('POST', `/api/boards/${id}/moodboard`),
  dashboard: () => req('GET', '/api/dashboard'),
  // campaigns
  listCampaigns: () => req('GET', '/api/campaigns'),
  campaignBrief: (payload) => req('POST', '/api/campaigns/brief', payload),
  createCampaign: (payload) => req('POST', '/api/campaigns', payload),
  getCampaign: (id) => req('GET', `/api/campaigns/${id}`),
  deleteCampaign: (id) => req('DELETE', `/api/campaigns/${id}`),
  editCreative: (id, patch) => req('POST', `/api/creatives/${id}/edit`, patch),
  publishStatus: () => req('GET', '/api/publish/status'),
  publishCaption: (creative, platform, campaign) => req('POST', '/api/publish/caption', { creative, platform, campaign }),
  regenCreativeImage: (id, prompt, provider) => req('POST', `/api/creatives/${id}/regenerate-image`, { prompt, provider }),
  fixCreativeLayout: (id) => req('POST', `/api/creatives/${id}/fix-layout`),
  animateCreative: (id) => req('POST', `/api/creatives/${id}/animate`),
  campaignDemoVideo: (id, seconds) => req('POST', `/api/campaigns/${id}/demo-video`, { seconds }),
  deleteCreative: (id) => req('DELETE', `/api/creatives/${id}`),
  // photoshoot
  listPhotoshoot: () => req('GET', '/api/photoshoot'),
  createPhotoshoot: (payload) => req('POST', '/api/photoshoot', payload),
  editPhotoshoot: (id, payload) => req('POST', `/api/photoshoot/${id}/edit`, payload),
  deletePhotoshoot: (id) => req('DELETE', `/api/photoshoot/${id}`),
  // image registry ops — :id resolves registry id OR a path basename; the
  // profile target promotes a render into profile.images (brand kit)
  promoteImage: (idOrPath, payload) => req('PUT', `/api/images/${encodeURIComponent(idOrPath)}`, payload),
  // websites
  listWebsites: () => req('GET', '/api/websites'),
  createWebsite: (promptOrOpts) => req('POST', '/api/websites', typeof promptOrOpts === 'string' ? { prompt: promptOrOpts } : (promptOrOpts || {})),
  improveWebsite: (url) => req('POST', '/api/websites/improve', { url }),
  editWebsite: (id, prompt) => req('POST', `/api/websites/${id}/edit`, { prompt }),
  publishWebsite: (id, slug) => req('POST', `/api/websites/${id}/publish`, { slug }),
  unpublishWebsite: (id) => req('POST', `/api/websites/${id}/unpublish`),
  deleteWebsiteVersion: (id, vid) => req('DELETE', `/api/websites/${id}/versions/${vid}`),
  // brand book
  getBrandBook: () => req('GET', '/api/brandbook'),
  createBrandBook: (payload) => req('POST', '/api/brandbook', payload),
  publishBrandBook: (slug) => req('POST', '/api/brandbook/publish', { slug }),
  // misc
  upload: async (file) => {
    const fd = new FormData();
    fd.append('file', file);
    const r = await fetch('/api/upload', { method: 'POST', body: fd });
    if (!r.ok) {
      // the server names the reason (unsupported type / too large / undecodable)
      // — surface it, not just the transport code
      const j = await r.json().catch(() => null);
      throw new Error(cleanErr(j?.error || `the upload failed → ${r.status}`));
    }
    return r.json();
  },
  job: (id) => req('GET', `/api/jobs/${id}`),
};

// Poll a job until done/error. onTick(job) each poll.
export async function pollJob(id, { interval = 2500, timeout = 8 * 60 * 1000, onTick } = {}) {
  const t0 = Date.now();
  for (;;) {
    const { job } = await api.job(id);
    onTick?.(job);
    if (job.status === 'done') return job.result;
    // job.error is a raw server string (often a provider dump) — toasts print
    // it verbatim, so it goes through the same scrub as HTTP details
    if (job.status === 'error') throw Object.assign(new Error(cleanErr(job.error, 160) || 'job failed'), { debug: job.error });
    if (Date.now() - t0 > timeout) throw new Error('job timed out');
    await new Promise((r) => setTimeout(r, interval));
  }
}

export default api;
