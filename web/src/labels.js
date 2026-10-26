// proper channel casing for UI — data stays lowercase everywhere else
export const CHAN_LABEL = { tiktok: 'TikTok', youtube: 'YouTube', tv: 'TV', ooh: 'OOH', streaming: 'Streaming', podcast: 'Podcast', press: 'Press', email: 'Email', guerrilla: 'Guerrilla', instagram: 'Instagram', maps: 'Maps', web: 'Web' };
export const chanLabel = (n) => {
  const key = String(n || '').toLowerCase();
  if (CHAN_LABEL[key]) return CHAN_LABEL[key];
  // enum-ish names like "instagram_reels" → "Instagram Reels"
  return String(n || '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
};

// Qloo call endpoints → what the call actually did (raw path stays as detail)
const EP_LABEL = { '/search': 'entity search', '/v2/tags': 'tag lookup', '/v2/insights': 'affinity insights' };
export const epLabel = (ep) => EP_LABEL[ep] || String(ep || '').replace(/^\/(v\d+\/)?/, '') || 'taste call';

// vendor/model ids → the names the UI already reports them by. Order matters:
// specific two-word forms run before the bare ids that would eat their tail.
export const ENGINE_WORDS = [
  [/\bgemini[ -]video\b/gi, 'the video model'],
  [/\bveo[\w.-]*/gi, 'the video model'],
  [/\bffmpeg[\w.-]*/gi, 'motion render'],
  [/\b(?:local-?gen|sdxl(?:-turbo)?|sd-turbo|stabilityai)[\w./-]*|\bturbo\b/gi, 'the studio renderer'],
  [/\b(?:gemini|imagen)[\w.-]*/gi, 'the cloud renderer'],
  [/\bpollinations[\w.-]*/gi, 'the web renderer'],
  [/\b(?:tensor|devin)[\w.-]*/gi, 'the chat brain'],
  [/\bqloo\b/gi, 'the taste graph'],
  [/\b(?:chromium|playwright)[\w.-]*/gi, 'the capture engine'],
];
// alternation of the replacement names above — for dedupe collapses
const ENGINE_NAMES = 'video model|video engine|studio renderer|cloud renderer|web renderer|chat brain|taste graph|motion render|render engines?|capture engine';
// 'the X failed: the X: …' (a raw dump that named the same engine twice)
// collapses back to one mention
export const ENGINE_DEDUPE = new RegExp(`\\b(the (?:${ENGINE_NAMES})\\b)[^:;.]{0,24}?:\\s*\\1(?:\\s+(?:video|image))?[,:]?\\s*`, 'gi');

export const scrubEngines = (s) => {
  let out = String(s);
  for (const [re, name] of ENGINE_WORDS) out = out.replace(re, name);
  return out;
};

// Stored errors carry provider dumps — 'gemini(gemini: … (quota exhausted))',
// 'localgen 503: connect ECONNREFUSED', 'qloo 403 /v2/insights — {…}',
// 'QLOO_API_KEY not set'. Callers keep the raw string in title=/console for
// honesty; visible copy gets this residue: per-engine 'name(detail)' groups
// dropped, vendor ids → the names providerLabel() reports, status and socket
// codes → words. Empty result falls back to a sentence, capped ~90 chars.
export function cleanErr(raw, max = 90) {
  let s = String(raw || '').split('{')[0]
    // 'name(detail…)' per-engine dumps — tolerate one nested paren level
    .replace(/\b[\w-]+\((?:[^()]|\([^()]*\))*\)/g, ' ')
    // an unclosed trailing paren means a JSON split cut a dump mid-way
    .replace(/\s*\([^()]*$/, '')
    .replace(/\bmodels\/[^\s,}"']+/g, 'the model')
    .replace(/\b[A-Z][A-Z0-9_]*_(?:KEY|TOKEN|SECRET|URL|BASE)\b/g, 'the api key')
    .replace(/\bhttps?:\S*/g, ' ');
  s = scrubEngines(s)
    .replace(/\bproviders\b/gi, 'render engines')
    .replace(/\bprovider\b/gi, 'render engine')
    // status + socket codes → words
    .replace(/\b(?:401|403)\b/g, 'key rejected')
    .replace(/\b402\b/g, 'out of quota')
    .replace(/\b429\b/g, 'rate-limited')
    .replace(/\b5\d{2}\b/g, 'unreachable')
    .replace(/\b4\d{2}\b/g, 'rejected')
    .replace(/\b(?:ECONNREFUSED|ENOTFOUND|ETIMEDOUT|ECONNRESET|EAI_AGAIN|socket hang up|fetch failed|terminated)\b/gi, 'unreachable')
    .replace(/\b(?:connect|dial|read|write)\s+(?=unreachable\b)/gi, '')
    .replace(/\b(?:cli|http)\b/gi, '')
    // leftover /v2/insights or /api/… path fragments (two+ segments)
    .replace(/\s\/[\w.\-]+\/[\w.\-/]*/g, ' ')
    .replace(ENGINE_DEDUPE, '$1 — ')
    // 'the X/the X' slash-dupes → one mention
    .replace(/\b(the [\w ]{2,24}?)\/\1\b/gi, '$1')
    // 'unreachable: unreachable' — a status code and a socket code that both
    // folded to the same word collapse to one
    .replace(/\b(\w{4,})\b([\s:;,.\-—–]+\1\b)+/gi, '$1')
    .replace(/\brequest to\s+failed\b/gi, 'the request failed')
    .replace(/\s+([:;,])/g, '$1')
    .replace(/["'`]+/g, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/^[\s:;,.\-—–]+/, '')
    .replace(/[\s:;,.\-—–]+$/, '');
  if (!s) s = 'the service failed — try again';
  return s.length > max ? `${s.slice(0, max).replace(/[\s:;,.\-—–]*\S*$/, '')}…` : s;
}
