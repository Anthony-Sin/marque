// TensorMux OpenAI-compatible chat client (glm-4-7-flash is a reasoning model:
// the answer is in message.content, message.reasoning burns max_tokens — always
// send a generous max_tokens).
import { ENV } from '../config.js';
import { devinCliAvailable, devinCliChat } from './devinCli.js';

const JSON_SYS = 'You respond with raw JSON only. No markdown, no code fences, no commentary before or after the JSON.';

export function tensorConfigured() { return !!(ENV.tensorBase && ENV.tensorKey); }

// runtime health — tensorConfigured() only proves env vars exist. The last
// real call's outcome is stamped by postCompletions, and a cached GET /models
// probe verifies base+auth without burning chat tokens, so /api/status can
// say whether the chat brain is actually reachable.
// lastCall.via records who actually served the last call: 'tensor' normally,
// 'devin-cli' when the key-death fallback below rescued it (with origError).
let lastCall = null; // {ok:bool, at:epoch, error?:string, via?:'tensor'|'devin-cli', origError?:string}
let probeCache = { at: 0, result: null };

export function tensorLastCall() { return lastCall; }

export async function tensorHealth({ probeTtlMs = 30000 } = {}) {
  if (!tensorConfigured()) return { configured: false, ok: false };
  if (probeCache.result && Date.now() - probeCache.at < probeTtlMs) return probeCache.result;
  let result;
  try {
    const res = await fetch(`${ENV.tensorBase}/models`, {
      signal: AbortSignal.timeout(6000),
      headers: { authorization: `Bearer ${keyPool()[0] || ENV.tensorKey}` },
    });
    result = { configured: true, ok: res.ok, error: res.ok ? null : `tensor ${res.status}` };
  } catch (e) {
    result = { configured: true, ok: false, error: String(e?.message || e).slice(0, 160) };
  }
  result.lastCallOk = lastCall?.ok ?? null;
  if (!result.ok || lastCall?.ok === false) result.lastError = result.error || lastCall?.error || null;
  // honest provider reporting — who actually answered the last call, and
  // whether the devin-cli rescue path is standing by. /api/status can't carry
  // new fields, so an active fallback is also folded into lastError where the
  // status route's `error` spread will surface it.
  result.via = lastCall?.via ?? 'tensor';
  result.fallback = { provider: 'devin-cli', available: devinCliAvailable() };
  if (lastCall?.via === 'devin-cli') {
    result.fallback.servedAt = lastCall.at;
    result.fallback.reason = lastCall.origError || null;
    result.lastError = `[tensor→devin fallback] serving via devin-cli (tensor: ${lastCall.origError || 'key-death'})`;
  }
  probeCache = { at: Date.now(), result };
  return result;
}

// key pool — TENSOR_API_KEY first, then the GEMINI_API_KEYS pool. When the
// endpoint is Google's OpenAI-compat shim every key works on it; a 429 free-
// tier burn on one key rolls the request onto the next instead of failing.
let tKeyIdx = 0;
function keyPool() {
  const seen = new Set();
  return [ENV.tensorKey, ...(ENV.geminiKeys || [])].filter((k) => k && !seen.has(k) && seen.add(k));
}

async function postCompletions(payload, timeoutMs) {
  const keys = keyPool();
  let lastErr = null;
  // two passes: transient upstream 5xx ("model high demand") gets one delayed
  // retry after every key has been tried — a capacity blip shouldn't kill a run
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 0; i < Math.max(1, keys.length); i++) {
      const key = keys[(tKeyIdx + i) % keys.length];
      try {
        const res = await fetch(`${ENV.tensorBase}/chat/completions`, {
          signal: AbortSignal.timeout(timeoutMs),
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
          body: JSON.stringify(payload),
        });
        if (res.status === 429 || res.status === 403 || res.status === 401 || res.status === 402) {
          // auth/quota classes — roll the pool: a dead key (or depleted
          // prepaid credits on a 402) may be fine on the next key before we
          // declare key-death and reroute through devin-cli
          lastErr = new Error(`tensor ${res.status}: quota/auth on key #${(tKeyIdx + i) % keys.length + 1}`);
          continue; // next key
        }
        if (res.status === 400) {
          // Google's OpenAI-compat shim reports dead keys as 400
          // INVALID_ARGUMENT "Please pass a valid API key" — a 400 that names
          // the key is really auth failure → roll the pool; any other 400 is
          // a caller bug and returns to the caller's error path unchanged
          let body = '';
          try { body = JSON.stringify(await res.clone().json()).slice(0, 300); } catch { /* not json */ }
          if (/api.?key|unauthenticated/i.test(body)) {
            lastErr = new Error(`tensor 400: api-key rejected on key #${(tKeyIdx + i) % keys.length + 1}`);
            continue; // next key
          }
        }
        if (res.status >= 500) {
          lastErr = new Error(`tensor ${res.status}: upstream transient`);
          continue; // next key — then the delayed second pass
        }
        tKeyIdx = (tKeyIdx + i) % Math.max(1, keys.length);
        lastCall = { ok: true, at: Date.now(), via: 'tensor' }; // endpoint answered — reachable + authed
        return res;
      } catch (e) {
        lastErr = e; // timeout/network — still worth trying the next key
      }
    }
    if (pass === 0) await new Promise((r) => setTimeout(r, 3500));
  }
  const err = lastErr || new Error('tensor: no API keys configured');
  lastCall = { ok: false, at: Date.now(), via: 'tensor', error: String(err?.message || err).slice(0, 160) };
  throw err;
}

// ---------- devin-cli fallback (key-death only) ----------
// When every pooled key dies on auth/quota (401/402/403/429 or the body's
// RESOURCE_EXHAUSTED/UNAUTHENTICATED/invalid-key markers — the 402
// "prepayment credits depleted" flap lands here), the SAME prompt is rerouted
// once through the local devin bridge so the text layer survives the outage.
// Deliberately NOT retried this way: timeouts/network aborts, 5xx transients,
// 400s without key markers, and JSON parse misses — those are flakes, not
// key-death, and rerouting them would double-serve calls through a slow pipe.
function keyDeath(err) {
  const m = String(err?.message || err);
  if (/^tensor (401|402|403|429)\b/.test(m)) return true;
  if (/RESOURCE_EXHAUSTED|UNAUTHENTICATED|PERMISSION_DENIED|API_KEY_INVALID|prepayment|credits? depleted|exceeded your.{0,20}quota/i.test(m)) return true;
  // the shim also wraps key rejection in a 400 — a 4xx whose body complains
  // about the API key itself is still key-death; other 400s are caller bugs
  return /^tensor 4\d\d\b/.test(m) && /api.?key/i.test(m);
}

// the bridge gets a compacted prompt — system + first user (the task) + last
// user (a JSON-correction nudge when chatJSON is on attempt 2). Middle
// history is dropped: the fallback is survival, not conversational parity.
function compactMessages(messages) {
  const sys = messages.find((m) => m.role === 'system');
  const users = messages.filter((m) => m.role === 'user');
  const out = [];
  if (sys) out.push(sys);
  if (users[0]) out.push(users[0]);
  const last = users[users.length - 1];
  if (last && last !== users[0]) out.push(last);
  if (!out.length) out.push(...messages.slice(-1));
  return out;
}

// does this call expect JSON back? explicit opts.json only (chatJSON sets it).
// Don't regex-guess from prompt text — sites.js's HTML path literally says
// "ignore the JSON instruction", and flipping its rescue to demand JSON
// would break the exact calls we're saving. extractJSON still parses
// JSON-shaped replies served under the generic tail.
const wantsJson = (_messages, opts) => !!opts.json;

// one rescue attempt per call. On success lastCall is re-stamped
// via:'devin-cli' (origError preserved) so tensorHealth()/status report the
// true provider; on bridge failure the ORIGINAL tensor error is rethrown —
// the dead key is the actionable signal, not the rescue's complaint.
async function devinFallback(messages, origErr, { json = false } = {}) {
  if (!keyDeath(origErr)) throw origErr;
  if (!devinCliAvailable()) throw origErr;
  console.warn(`[tensor→devin fallback] ${String(origErr?.message || origErr).slice(0, 160)} — rerouting through devin-cli`);
  try {
    const text = await devinCliChat(compactMessages(messages), { json });
    if (!text || !text.trim()) throw new Error('devin-cli returned empty text');
    lastCall = { ok: true, at: Date.now(), via: 'devin-cli', origError: String(origErr?.message || origErr).slice(0, 160) };
    return text;
  } catch (e) {
    console.warn(`[tensor→devin fallback] devin-cli also failed (${String(e?.message || e).slice(0, 120)}) — surfacing original tensor error`);
    throw origErr;
  }
}

// streaming variant — OpenAI-compatible SSE; onToken(delta) per chunk,
// resolves with the full concatenated text (same post-processing as chat()).
export async function chatStream(messages, opts = {}) {
  if (!tensorConfigured()) throw new Error('tensor not configured');
  let res;
  try {
    res = await postCompletions({
      model: ENV.tensorModel,
      messages,
      temperature: opts.temperature ?? 0.7,
      max_tokens: opts.maxTokens ?? 3000,
      stream: true,
      ...(opts.extra || {}),
    }, opts.timeoutMs ?? 120000);
  } catch (e) {
    // key-death before a byte streamed → rescue through devin-cli and emit the
    // whole reply as one onToken burst (the bridge isn't SSE); anything else
    // — timeouts, 5xx — rethrows untouched
    const text = await devinFallback(messages, e, { json: wantsJson(messages, opts) });
    opts.onToken?.(text, text);
    return text;
  }
  if (!res.ok || !res.body) {
    let data = null;
    try { data = await res.json(); } catch { /* fallthrough */ }
    const text = await devinFallback(messages, new Error(`tensor ${res.status}: ${JSON.stringify(data)?.slice(0, 300) || res.statusText}`), { json: wantsJson(messages, opts) });
    opts.onToken?.(text, text);
    return text;
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  // reasoning models stream delta.reasoning (thinking) + delta.content (answer)
  // — keep them separate; the answer is what callers want
  let buf = '', full = '', thinking = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let cut;
    while ((cut = buf.indexOf('\n\n')) >= 0) {
      const frame = buf.slice(0, cut); buf = buf.slice(cut + 2);
      for (const line of frame.split('\n')) {
        if (!line.startsWith('data:')) continue;
        const raw = line.slice(5).trim();
        if (raw === '[DONE]') continue;
        try {
          const j = JSON.parse(raw);
          const d = j?.choices?.[0]?.delta || {};
          const content = d.content ?? '';
          const reasoning = d.reasoning ?? d.reasoning_content ?? '';
          if (reasoning) { thinking += reasoning; opts.onReasoning?.(reasoning, thinking); }
          if (content) { full += content; opts.onToken?.(content, full); }
        } catch { /* partial frame */ }
      }
    }
  }
  return full.trim() ? full : thinking;
}

export async function chat(messages, opts = {}) {
  if (!tensorConfigured()) throw new Error('tensor not configured');
  let res;
  try {
    res = await postCompletions({
      model: ENV.tensorModel,
      messages,
      temperature: opts.temperature ?? 0.7,
      max_tokens: opts.maxTokens ?? 3000,
      ...(opts.extra || {}),
    }, opts.timeoutMs ?? 90000);
  } catch (e) {
    return devinFallback(messages, e, { json: wantsJson(messages, opts) });
  }
  let data = null;
  try { data = await res.json(); } catch { /* fallthrough */ }
  if (!res.ok) {
    return devinFallback(messages, new Error(`tensor ${res.status}: ${JSON.stringify(data)?.slice(0, 300) || res.statusText}`), { json: wantsJson(messages, opts) });
  }
  const msg = data?.choices?.[0]?.message || {};
  const content = (msg.content ?? '').toString();
  if (content.trim()) return content;
  return (msg.reasoning ?? '').toString();
}

// fix common model sloppiness inside string literals: raw newlines/tabs and
// invalid backslash escapes — enough to make loose JSON strict-parseable
export function repairJSON(s) {
  let out = '', inStr = false, esc = false;
  for (const c of s) {
    if (!inStr) { if (c === '"') inStr = true; out += c; continue; }
    if (esc) {
      if ('"\\/bfnrtu'.includes(c)) out += c;
      else if (c === '\n') out += 'n';
      else if (c === '\r') out += 'r';
      else if (c === '\t') out += 't';
      else out += '\\' + c; // bad escape → literal backslash + char
      esc = false; continue;
    }
    if (c === '\\') { esc = true; out += c; continue; }
    if (c === '"') { inStr = false; out += c; continue; }
    if (c === '\n') { out += '\\n'; continue; }
    if (c === '\r') { out += '\\r'; continue; }
    if (c === '\t') { out += '\\t'; continue; }
    out += c;
  }
  return out;
}

function tryParse(s) {
  try { return { v: JSON.parse(s) }; } catch { /* fallthrough */ }
  try { return { v: JSON.parse(repairJSON(s)) }; } catch { return { v: undefined }; }
}

export function extractJSON(text) {
  if (!text) return null;
  const t = String(text).replace(/```(?:json|javascript|js)?/gi, '');
  let start = -1, from = 0;
  while (true) {
    start = -1;
    for (let i = from; i < t.length; i++) { if (t[i] === '{' || t[i] === '[') { start = i; break; } }
    if (start < 0) return null;
    const open = t[start], close = open === '{' ? '}' : ']';
    let depth = 0, inStr = false, esc = false, end = -1;
    for (let i = start; i < t.length; i++) {
      const c = t[i];
      if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue; }
      if (c === '"') inStr = true;
      else if (c === open) depth++;
      else if (c === close) { depth--; if (depth === 0) { end = i; break; } }
    }
    if (end < 0) return null;
    const { v } = tryParse(t.slice(start, end + 1));
    if (v !== undefined) return v;
    from = end + 1;
  }
}

export async function chatJSON(messages, opts = {}) {
  const msgs = [...messages];
  if (msgs[0]?.role === 'system') msgs[0] = { ...msgs[0], content: `${msgs[0].content}\n\n${JSON_SYS}` };
  else msgs.unshift({ role: 'system', content: JSON_SYS });
  let last = '';
  for (let attempt = 0; attempt < 2; attempt++) {
    last = await chat(msgs, { maxTokens: 3000, ...opts, json: true });
    const json = extractJSON(last);
    if (json !== null) return json;
    if (attempt === 0) msgs.push(
      { role: 'assistant', content: last.slice(0, 2000) },
      { role: 'user', content: 'That was not valid JSON. Return ONLY valid JSON — no markdown, no explanation.' },
    );
  }
  throw new Error('tensor: model did not return valid JSON');
}
