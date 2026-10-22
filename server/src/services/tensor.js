// TensorMux OpenAI-compatible chat client (glm-4-7-flash is a reasoning model:
// the answer is in message.content, message.reasoning burns max_tokens — always
// send a generous max_tokens).
import { ENV } from '../config.js';

const JSON_SYS = 'You respond with raw JSON only. No markdown, no code fences, no commentary before or after the JSON.';

export function tensorConfigured() { return !!(ENV.tensorBase && ENV.tensorKey); }

export async function chat(messages, opts = {}) {
  if (!tensorConfigured()) throw new Error('tensor not configured');
  const res = await fetch(`${ENV.tensorBase}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${ENV.tensorKey}` },
    body: JSON.stringify({
      model: ENV.tensorModel,
      messages,
      temperature: opts.temperature ?? 0.7,
      max_tokens: opts.maxTokens ?? 3000,
      ...(opts.extra || {}),
    }),
  });
  let data = null;
  try { data = await res.json(); } catch { /* fallthrough */ }
  if (!res.ok) throw new Error(`tensor ${res.status}: ${JSON.stringify(data)?.slice(0, 300) || res.statusText}`);
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
    last = await chat(msgs, { maxTokens: 3000, ...opts });
    const json = extractJSON(last);
    if (json !== null) return json;
    if (attempt === 0) msgs.push(
      { role: 'assistant', content: last.slice(0, 2000) },
      { role: 'user', content: 'That was not valid JSON. Return ONLY valid JSON — no markdown, no explanation.' },
    );
  }
  throw new Error('tensor: model did not return valid JSON');
}
