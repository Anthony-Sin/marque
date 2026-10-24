// Devin CLI bridge — drives `devin acp` (Agent Client Protocol over stdio) as
// the app's agentic backend: image/video inspection, multi-step edits, maps
// lookups — the work a plain text LLM can't do. Fast text stays on tensor;
// pixel generation stays on Gemini. One persistent process + one session;
// calls serialize on a queue.
import { spawn, execSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';

const ROOT = path.resolve(new URL('..', import.meta.url).pathname, '..', '..');
const MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif' };

let proc = null, buf = '', nextId = 1;
const pending = new Map();          // id -> {resolve, reject}
let sessionId = null, sessionPromise = null, readyPromise = null;
const queue = [];                   // serialized prompt calls
let pumping = false;
let current = null;                 // {text} while a prompt call is in flight
let binPath = null;                 // cached `which devin`

export function devinCliAvailable() {
  if (binPath === null) {
    try { binPath = execSync('command -v devin', { encoding: 'utf8' }).trim() || false; }
    catch { binPath = false; }
  }
  return !!binPath;
}

function send(obj) { proc.stdin.write(JSON.stringify(obj) + '\n'); }

function rpc(method, params, timeoutMs = 30000) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => { pending.delete(id); reject(new Error(`acp ${method} timed out`)); }, timeoutMs);
    pending.set(id, { resolve: (v) => { clearTimeout(t); resolve(v); }, reject: (e) => { clearTimeout(t); reject(e); } });
    send({ jsonrpc: '2.0', id, method, params });
  });
}

function onLine(line) {
  let msg;
  try { msg = JSON.parse(line); } catch { return; }
  if (msg.id != null && pending.has(msg.id)) {
    const p = pending.get(msg.id);
    pending.delete(msg.id);
    msg.error ? p.reject(new Error(msg.error.message || JSON.stringify(msg.error))) : p.resolve(msg.result);
    return;
  }
  // session/update notification — accumulate agent text
  if (msg.method === 'session/update' && current) {
    const u = msg.params?.update || {};
    if (u.sessionUpdate === 'agent_message_chunk' && u.content?.type === 'text') {
      current.text += u.content.text || '';
    }
  }
}

function ensureProc() {
  if (proc && !proc.killed && proc.exitCode == null) return;
  buf = ''; pending.clear(); sessionId = null; sessionPromise = null;
  proc = spawn('devin', ['acp'], { cwd: ROOT, stdio: ['pipe', 'pipe', 'inherit'] });
  proc.stdout.on('data', (d) => {
    buf += d.toString();
    let cut;
    while ((cut = buf.indexOf('\n')) >= 0) { const l = buf.slice(0, cut); buf = buf.slice(cut + 1); onLine(l); }
  });
  proc.on('exit', () => { proc = null; sessionId = null; sessionPromise = null; });
}

async function ensureReady() {
  if (readyPromise) return readyPromise;
  readyPromise = (async () => {
    ensureProc();
    await rpc('initialize', {
      protocolVersion: 1,
      clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
      clientInfo: { name: 'marque', version: '0.1.0' },
    }, 30000);
    // the only advertised auth method — completes silently while the local
    // `devin` CLI is already logged in (stored session token is reused)
    await rpc('authenticate', { methodId: 'devin-browser' }, 120000);
  })().catch((e) => { readyPromise = null; throw e; });
  return readyPromise;
}

async function ensureSession() {
  if (sessionId) return sessionId;
  if (sessionPromise) return sessionPromise;
  sessionPromise = (async () => {
    const r = await rpc('session/new', { cwd: ROOT, mcpServers: [] }, 60000);
    sessionId = r.sessionId;
    return sessionId;
  })().catch((e) => { sessionPromise = null; throw e; });
  return sessionPromise;
}

async function pump() {
  if (pumping) return;
  pumping = true;
  try {
    while (queue.length) {
      const { parts, agentic, resolve, reject } = queue.shift();
      try {
        await ensureReady();
        const sid = await ensureSession();
        current = { text: '' };
        await rpc('session/prompt', { sessionId: sid, prompt: parts }, agentic ? 600000 : 300000);
        resolve(current.text.trim());
      } catch (e) {
        reject(e);
      } finally {
        current = null;
      }
    }
  } finally {
    pumping = false;
  }
}

function enqueue(parts, agentic) {
  return new Promise((resolve, reject) => { queue.push({ parts, agentic, resolve, reject }); pump(); });
}

const flatten = (messages) => messages
  .map((m) => (m.role === 'system' ? `Instructions: ${m.content}` : m.role === 'assistant' ? `Assistant: ${m.content}` : String(m.content)))
  .join('\n\n');

// plain text exchange — used when the agent must answer, not act
export async function devinCliChat(messages) {
  const text = `${flatten(messages)}\n\nRespond with ONLY the requested output — no tools, no file writes, no narration.`;
  return enqueue([{ type: 'text', text }], false);
}

// vision — send one or more image files for the agent to actually look at
export async function devinCliInspect(imagePaths, instruction, { agentic = false } = {}) {
  const paths = (Array.isArray(imagePaths) ? imagePaths : [imagePaths]).filter(Boolean);
  const parts = [];
  for (const p of paths) {
    const abs = path.isAbsolute(p) ? p : path.join(ROOT, p);
    const mime = MIME[path.extname(abs).toLowerCase()];
    if (!mime || !fs.existsSync(abs)) throw new Error(`devin inspect: unreadable image ${abs}`);
    parts.push({ type: 'image', data: fs.readFileSync(abs).toString('base64'), mimeType: mime });
  }
  parts.push({ type: 'text', text: agentic ? instruction : `${instruction}\n\nRespond with ONLY the requested output — no tools, no file writes, no narration.` });
  return enqueue(parts, agentic);
}
