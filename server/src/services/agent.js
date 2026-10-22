// profile-editing agent: chat with a small JSON tool-call protocol over Qloo + patches
import { chatJSON } from './tensor.js';
import { searchEntities, insights } from './qloo.js';
import { get, set, applyPatch, list, now } from './store.js';

const PATCHABLE = new Set(['name', 'tagline', 'description', 'tone', 'values', 'audience', 'colors', 'fonts', 'images', 'catalog']);

const SYS = `You are the Marque brand agent — a helpful brand strategist editing a brand DNA profile through chat.

The current profile JSON is below. You may:
1) Reply normally: {"reply":"..."}
2) Edit the profile: {"reply":"...","patch":{...partial profile fields...}} — patches merge; arrays replace.
3) Call a tool (one per step, then you'll get TOOL_RESULT and continue):
   {"tool":"qloo_search","args":{"query":"..."}}
   {"tool":"qloo_insights","args":{"type":"urn:entity:artist|urn:entity:brand|urn:entity:place|urn:entity:movie|urn:entity:tv|urn:entity:podcast","entities":["entity-id"],"tags":["tag-id"],"take":8}}
   {"tool":"update_profile","args":{"patch":{...}}}

Use Qloo tools when the user asks about taste, audience affinities, competitors, inspiration, or "what our customers are into". Cite entity names in replies. Keep replies concise and useful. Never output anything but the JSON object.`;

function sanitizePatch(patch) {
  if (!patch || typeof patch !== 'object') return null;
  const out = {};
  for (const [k, v] of Object.entries(patch)) if (PATCHABLE.has(k)) out[k] = v;
  return Object.keys(out).length ? out : null;
}

async function runTool(tool, args, evidence) {
  try {
    if (tool === 'qloo_search') {
      const r = await searchEntities(String(args?.query || ''), args?.types);
      evidence.push({ label: 'qloo_search', detail: `"${args?.query}" → ${r.results.length} results (${r.mode})` });
      return { mode: r.mode, results: r.results.slice(0, 8) };
    }
    if (tool === 'qloo_insights') {
      const r = await insights({ type: args?.type || 'urn:entity:brand', entities: args?.entities, tags: args?.tags, take: args?.take || 8 });
      evidence.push({ label: 'qloo_insights', detail: `${args?.type} → ${r.entities.length} affinities (${r.mode})` });
      return { mode: r.mode, entities: r.entities.slice(0, 8) };
    }
    if (tool === 'update_profile') {
      const patch = sanitizePatch(args?.patch);
      if (!patch) return { ok: false, error: 'patch had no editable fields' };
      const profile = get('profile') || {};
      profile.updatedAt = now();
      const merged = applyPatch(profile, patch);
      merged.catalog = list('catalog');
      set('profile', merged);
      evidence.push({ label: 'update_profile', detail: `patched: ${Object.keys(patch).join(', ')}` });
      return { ok: true, applied: Object.keys(patch) };
    }
    return { ok: false, error: `unknown tool ${tool}` };
  } catch (e) {
    return { ok: false, error: String(e.message || e).slice(0, 200) };
  }
}

export async function agentChat(messages) {
  const profile = get('profile') || null;
  const evidence = [];
  const msgs = [
    { role: 'system', content: `${SYS}\n\nCURRENT PROFILE:\n${JSON.stringify(profile).slice(0, 6000)}` },
    ...(messages || []).map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: String(m.content || '') })),
  ];
  let finalPatch = null;
  for (let step = 0; step < 6; step++) {
    const out = await chatJSON(msgs, { maxTokens: 3000 });
    if (out?.tool) {
      const result = await runTool(out.tool, out.args, evidence);
      msgs.push(
        { role: 'assistant', content: JSON.stringify(out) },
        { role: 'user', content: `TOOL_RESULT ${out.tool}: ${JSON.stringify(result).slice(0, 3000)}` },
      );
      if (out.tool === 'update_profile' && result.ok) {
        finalPatch = applyPatch(finalPatch || {}, sanitizePatch(out.args?.patch) || {});
      }
      continue;
    }
    const patch = sanitizePatch(out?.patch);
    if (patch) {
      const profile2 = get('profile') || {};
      profile2.updatedAt = now();
      const merged = applyPatch(profile2, patch);
      merged.catalog = list('catalog');
      set('profile', merged);
      finalPatch = applyPatch(finalPatch || {}, patch);
      evidence.push({ label: 'update_profile', detail: `patched: ${Object.keys(patch).join(', ')}` });
    }
    return { reply: out?.reply || (typeof out === 'string' ? out : 'Done.'), patch: finalPatch, evidence: { qloo: evidence } };
  }
  return { reply: 'I hit my step limit — try rephrasing that request.', patch: finalPatch, evidence: { qloo: evidence } };
}
