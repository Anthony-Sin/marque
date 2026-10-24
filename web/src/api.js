// Marque API client — thin fetch wrapper matching docs/API.md.
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
    const e = new Error(`${method} ${url} → ${r.status} ${detail}`);
    e.status = r.status;
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
    if (!r.ok || !r.body) throw new Error(`agent stream → ${r.status}`);
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
        else if (ev === 'error') throw new Error(data?.error || 'agent failed');
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
    if (!r.ok || !r.body) throw new Error(`stream → ${r.status}`);
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
        else if (ev === 'error') throw new Error(data?.error || 'strategy failed');
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
  deleteCreative: (id) => req('DELETE', `/api/creatives/${id}`),
  // photoshoot
  listPhotoshoot: () => req('GET', '/api/photoshoot'),
  createPhotoshoot: (payload) => req('POST', '/api/photoshoot', payload),
  editPhotoshoot: (id, payload) => req('POST', `/api/photoshoot/${id}/edit`, payload),
  // websites
  listWebsites: () => req('GET', '/api/websites'),
  createWebsite: (prompt) => req('POST', '/api/websites', { prompt }),
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
    if (!r.ok) throw new Error(`upload ${r.status}`);
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
    if (job.status === 'error') throw new Error(job.error || 'job failed');
    if (Date.now() - t0 > timeout) throw new Error('job timed out');
    await new Promise((r) => setTimeout(r, interval));
  }
}

export default api;
