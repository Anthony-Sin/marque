// Strategy Board: prompt + profile Qloo bundle -> candidate strategies.
// TensorMux ideates; channel fit + audience read are computed deterministically
// from real bundle data so "why" is always honest (see docs/STRATEGY.md).
import { chatJSON } from './tensor.js';
import * as qloo from './qloo.js';

const TYPE_CHANNEL = {
  'urn:entity:tv_show': 'tv', 'urn:entity:movie': 'streaming', 'urn:entity:podcast': 'podcast',
  'urn:entity:artist': 'tiktok', 'urn:entity:brand': 'instagram', 'urn:entity:place': 'guerrilla',
  'urn:entity:book': 'press', 'urn:entity:person': 'youtube',
};
const ALL_CHANNELS = ['instagram', 'tiktok', 'youtube', 'tv', 'streaming', 'podcast', 'ooh', 'guerrilla', 'email', 'press'];

const LEAN_RULES = {
  'craft-progressive': {
    confidence: 0.66,
    watchout: 'AI-forward messaging can read as gimmicky here — lead with human craft and keep generated assets subtle.',
    boost: ['guerrilla', 'ooh', 'press'], penalize: ['streaming'],
    note: 'Craft/heritage/indie affinities — novelty-cautious, provenance-led.',
  },
  'early-adopter': {
    confidence: 0.7,
    note: 'Tech/venture/modern affinities — this crowd rewards AI-native, interactive creative.',
    boost: ['tiktok', 'youtube', 'streaming'], penalize: [],
  },
  'mass-market pragmatic': {
    confidence: 0.55,
    note: 'Mainstream affinities — broad channels fine; value-led messaging beats novelty.',
    boost: ['tv', 'instagram'], penalize: [],
  },
};

function topByType(bundle) {
  const out = {};
  for (const aff of bundle?.affinities || []) {
    const ents = (aff.entities || []).filter((e) => e.name);
    if (ents.length) out[aff.type] = ents;
  }
  return out;
}

function meanAffinity(ents = []) {
  const vals = ents.map((e) => e.affinity).filter((n) => typeof n === 'number');
  return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
}

export function audienceRead(bundle, profile = {}) {
  const byType = topByType(bundle);
  const ranked = Object.entries(byType)
    .map(([type, ents]) => ({ type, ents, mean: meanAffinity(ents) }))
    .sort((a, b) => b.mean - a.mean);

  const mediaHabits = ranked.slice(0, 3).map((r) => {
    const ch = TYPE_CHANNEL[r.type] || 'instagram';
    const names = r.ents.slice(0, 2).map((e) => e.name).join(', ');
    return { channel: ch, note: `strong ${r.type.replace('urn:entity:', '')} pull — ${names}`, type: r.type };
  });

  const hay = [
    ...(bundle?.tags || []).map((t) => `${t.name || ''} ${t.id || ''}`),
    ...Object.values(byType).flat().map((e) => e.name || ''),
    profile.aesthetic || '', ...(profile.values || []),
  ].join(' ').toLowerCase();

  let lean;
  if (/craft|heritage|indie|artisan|vinyl|analog|slow|sustainable|hand/.test(hay)) {
    lean = { label: 'craft-progressive', ...LEAN_RULES['craft-progressive'], signals: mediaHabits.map((m) => m.note).slice(0, 3) };
  } else if (/tech|venture|finance|startup|crypto|software|ai |gadget/.test(hay)) {
    lean = { label: 'early-adopter', ...LEAN_RULES['early-adopter'], signals: mediaHabits.map((m) => m.note).slice(0, 3) };
  } else {
    lean = { label: 'mass-market pragmatic', ...LEAN_RULES['mass-market pragmatic'], signals: mediaHabits.map((m) => m.note).slice(0, 3) };
  }

  const vibeWords = [...new Set([
    ...(profile.tone || []).slice(0, 2),
    ...(bundle?.tags || []).slice(0, 3).map((t) => (t.name || '').replace(/^urn:tag:/, '')),
  ].filter(Boolean))].slice(0, 5);

  return { lean: { label: lean.label, confidence: lean.confidence, signals: lean.signals }, mediaHabits, vibeWords };
}

function channelFit(bundle, lean) {
  const byType = topByType(bundle);
  const fit = Object.fromEntries(ALL_CHANNELS.map((c) => [c, { fit: 0.18, why: [] }]));
  for (const [type, ents] of Object.entries(byType)) {
    const ch = TYPE_CHANNEL[type];
    if (!ch) continue;
    const m = meanAffinity(ents);
    const top = ents[0];
    fit[ch].fit = Math.min(0.95, 0.35 + m * 0.6);
    if (top) fit[ch].why.push(`${top.name}${typeof top.affinity === 'number' ? ` (${top.affinity.toFixed(2)})` : ''}`);
  }
  // guerrilla ties to place affinity + instagram buzz adjacency
  if (fit.instagram.fit > 0.5 && fit.guerrilla.fit < 0.5) { fit.guerrilla.fit = Math.max(fit.guerrilla.fit, fit.instagram.fit - 0.15); }
  const rules = LEAN_RULES[lean.label];
  if (rules) {
    for (const c of rules.boost || []) fit[c].fit = Math.min(0.95, fit[c].fit + 0.12);
    for (const c of rules.penalize || []) fit[c].fit = Math.max(0.08, fit[c].fit - 0.2);
  }
  return fit;
}

const SCHEMA = `Respond with strict JSON: {"strategies":[{ "title","angle","channels":[channel names],"formats":[],"brief":{"title","angle","audience","keyMessage"},"watchouts":[],"heroSignal" }]} — 3-4 strategies. Each channels[] picks from: ${ALL_CHANNELS.join(', ')}. Base every call on the audience data given; never suggest a channel with no evidence.`;

export async function generateStrategies({ prompt, profile, product = null, urlContext = null }) {
  const bundle = profile?.qloo || null;
  const read = audienceRead(bundle, profile);
  const fitMap = channelFit(bundle, read.lean);
  const byType = topByType(bundle);
  const signalLines = Object.entries(byType).flatMap(([type, ents]) =>
    ents.slice(0, 4).map((e) => `${type.replace('urn:entity:', '')}: ${e.name} (${(e.affinity ?? 0).toFixed(2)})`));

  let raw = null, modelNote = 'deterministic';
  try {
    raw = await chatJSON([
      { role: 'system', content: `You are a campaign strategist for ${profile?.name || 'a brand'}. ${SCHEMA}` },
      {
        role: 'user', content: [
          `Campaign prompt: ${prompt}`,
          `Brand: ${profile?.name} — ${profile?.tagline || ''}. Tone: ${(profile?.tone || []).join(', ')}. Overview: ${(profile?.overview || '').slice(0, 300)}`,
          product ? `Focus product: ${product.name}${product.description ? ` — ${product.description.slice(0, 200)}` : ''}${product.price ? ` (${product.price})` : ''}` : null,
          urlContext ? `Referenced site: ${urlContext.title || urlContext.url} — ${(urlContext.description || '').slice(0, 200)}` : null,
          `Audience read: lean=${read.lean.label} (heuristic). Media habits: ${read.mediaHabits.map((m) => `${m.channel} (${m.note})`).join('; ')}.`,
          `Top audience affinities:\n${signalLines.join('\n')}`,
          `Channel-fit priors (0-1): ${Object.entries(fitMap).map(([c, v]) => `${c}=${v.fit.toFixed(2)}`).join(', ')}`,
          `Lean guidance: ${LEAN_RULES[read.lean.label]?.watchout || LEAN_RULES[read.lean.label]?.note || ''}`,
        ].join('\n\n'),
      },
    ], { maxTokens: 3000 });
  } catch { /* fall through to deterministic */ }

  const modelList = raw?.strategies || raw?.strategy || (Array.isArray(raw) ? raw : null);
  if (modelList?.length) modelNote = 'tensor';
  const strategies = (modelList?.length ? modelList : fallbackStrategies(prompt, read))
    .slice(0, 4).map((s, i) => normalizeStrategy(s, i, fitMap, read, bundle, prompt));

  return {
    strategies,
    audienceRead: read,
    evidence: {
      source: modelNote,
      qlooMode: bundle?.mode || 'none',
      signals: signalLines.slice(0, 14),
      drivers: read.mediaHabits,
      calls: bundle?.calls || [],
      qlooEvidence: qloo.qlooEvidence(bundle),
    },
    fetchedAt: new Date().toISOString(),
  };
}

function normalizeStrategy(s, i, fitMap, read, bundle, prompt) {
  const names = (Array.isArray(s.channels) ? s.channels : []).map((c) => String(c).toLowerCase());
  const channels = (names.length ? names : ['instagram', 'tiktok']).filter((c) => fitMap[c] !== undefined)
    .map((c) => ({ name: c, fit: +fitMap[c].fit.toFixed(2), why: fitMap[c].why.join(', ') || `${read.lean.label} audience` }));
  const cited = Object.values(topByType(bundle)).flat()
    .filter((e) => JSON.stringify(s).toLowerCase().includes((e.name || '').toLowerCase().slice(0, 12)))
    .slice(0, 4).map((e) => ({ entity: e.name, type: e.type || '', affinity: e.affinity }));
  const fitScore = channels.length ? channels.reduce((a, c) => a + c.fit, 0) / channels.length : 0.2;
  const watchouts = [...(s.watchouts || [])];
  const leanW = LEAN_RULES[read.lean.label]?.watchout;
  if (leanW && !watchouts.some((w) => w.includes(leanW.slice(0, 25)))) watchouts.push(leanW);
  return {
    id: `st${i + 1}`, title: s.title || `Strategy ${i + 1}`, angle: s.angle || '',
    channels, formats: s.formats || [],
    brief: { title: s.brief?.title || s.title || prompt, angle: s.brief?.angle || s.angle || '', audience: s.brief?.audience || read.lean.label, keyMessage: s.brief?.keyMessage || '' },
    audienceFit: { score: +Math.min(0.98, fitScore).toFixed(2), notes: [read.lean.label, ...(read.mediaHabits[0] ? [read.mediaHabits[0].note] : [])] },
    watchouts, qlooSignals: cited, heroSignal: s.heroSignal || cited[0]?.entity || '',
  };
}

function fallbackStrategies(prompt, read) {
  const top = read.mediaHabits.map((m) => m.channel);
  return [
    { title: 'Lead channel play', angle: `Double down where the audience already lives (${top[0] || 'instagram'}).`, channels: top.slice(0, 2), formats: ['short-form video', 'carousel'], brief: { title: prompt, angle: 'audience-native creative', audience: read.lean.label, keyMessage: prompt }, watchouts: [] },
    { title: 'Culture-collab angle', angle: 'Borrow credibility from adjacent affinities — collab, placement or pop-up.', channels: [...new Set([top[1] || 'guerrilla', 'ooh'])], formats: ['pop-up', 'collab drop'], brief: { title: prompt, angle: 'cultural partnership', audience: read.lean.label, keyMessage: prompt }, watchouts: [] },
    { title: 'Counter-positioning', angle: 'Zig where the category zags — earned media + community seeding.', channels: ['press', 'email'], formats: ['press kit', 'founder letter'], brief: { title: prompt, angle: 'earned-first', audience: read.lean.label, keyMessage: prompt }, watchouts: [] },
  ];
}
