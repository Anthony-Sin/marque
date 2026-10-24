// Strategy Board: prompt + profile Qloo bundle -> candidate strategies.
// TensorMux ideates; channel fit + audience read are computed deterministically
// from real bundle data so "why" is always honest (see docs/STRATEGY.md).
import { chatJSON } from './tensor.js';
import * as qloo from './qloo.js';
import { tuning } from '../tuning.js';

const TYPE_CHANNEL = tuning('typeChannel');
const ALL_CHANNELS = tuning('allChannels');
const LEAN_RULES = tuning('leanRules');

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

export function audienceRead(bundle, profile = {}, askText = '') {
  const byType = topByType(bundle);
  const ranked = Object.entries(byType)
    .map(([type, ents]) => ({ type, ents, mean: meanAffinity(ents) }))
    .sort((a, b) => b.mean - a.mean);

  const mediaHabits = ranked.slice(0, 3).map((r) => {
    const ch = TYPE_CHANNEL[r.type] || 'instagram';
    const names = r.ents.slice(0, 2).map((e) => e.name).join(', ');
    const kind = r.type.replace('urn:entity:', '').replace(/_/g, ' ');
    // read as a habit, not a raw signal dump: "their feed leans documentary — X, Y"
    return { channel: ch, note: `leans ${kind} — follows ${names}`, type: r.type };
  });

  // the ask itself is a signal — "design-conscious millennials" should steer
  // the lean, not get overwritten by whatever the entity soup happens to say
  const hay = [
    askText,
    ...(bundle?.tags || []).map((t) => `${t.name || ''} ${t.id || ''}`),
    ...Object.values(byType).flat().map((e) => e.name || ''),
    profile.aesthetic || '', ...(profile.values || []),
  ].join(' ').toLowerCase();

  let lean;
  if (/design|aesthetic|luxur|premium|minimal|fashion|beaut|skincare|style|taste/.test(hay)) {
    lean = { label: 'design-led', note: 'Aesthetic-first affinities — visual craft, editorial polish and tasteful restraint carry this crowd.', signals: mediaHabits.map((m) => m.note).slice(0, 3), confidence: 0.62 };
  } else if (/craft|heritage|indie|artisan|vinyl|analog|slow|sustainable|hand/.test(hay)) {
    lean = { label: 'craft-progressive', ...LEAN_RULES['craft-progressive'], signals: mediaHabits.map((m) => m.note).slice(0, 3) };
  } else if (/tech|venture|finance|startup|crypto|software|ai |gadget/.test(hay)) {
    lean = { label: 'early-adopter', ...LEAN_RULES['early-adopter'], signals: mediaHabits.map((m) => m.note).slice(0, 3) };
  } else if (/film|movie|cinema|documentary|music|artist|album|book|fiction|podcast/.test(hay)) {
    // culture-heavy signals get their own read instead of the generic bucket
    lean = { label: 'culture-led', note: 'Story/format affinities — this crowd responds to narrative-led creative and earned media.', signals: mediaHabits.map((m) => m.note).slice(0, 3), confidence: 0.62 };
  } else if (/sport|fitness|athlet|outdoor|run|train|wellness|health/.test(hay)) {
    lean = { label: 'performance-minded', note: 'Sport/wellness affinities — proof-led creative, community and challenge formats win.', signals: mediaHabits.map((m) => m.note).slice(0, 3), confidence: 0.62 };
  } else {
    lean = { label: 'mass-market pragmatic', ...LEAN_RULES['mass-market pragmatic'], signals: mediaHabits.map((m) => m.note).slice(0, 3) };
  }

  // vibe words come from the taste graph itself (top entity names + tag names);
  // profile.tone words read as audience vibes ("Objective enthusiasts") — banned
  const vibeWords = [...new Set([
    ...ranked.slice(0, 2).flatMap((r) => r.ents.slice(0, 3).map((e) => e.name)),
    ...(bundle?.tags || []).slice(0, 3).map((t) => (t.name || '').replace(/^urn:tag:/, '').replace(/^\w/, (c) => c.toUpperCase())),
  ].filter((v) => v && v.length <= 22))].slice(0, 5);

  // confidence is derived, not constant: base per lean + how much signal
  // actually exists (breadth of entity types + strength of the top pull)
  const typeCount = ranked.length;
  const topMean = ranked[0]?.mean || 0;
  // confidence honestly reflects provenance — synthesized taste data can't
  // back the same certainty the live graph can
  const modeDamp = bundle?.mode === 'live' ? 1 : bundle?.mode === 'partial' ? 0.86 : 0.72;
  const derived = Math.min(0.95, Math.max(0.3,
    (lean.confidence * 0.55 + topMean * 0.3 + Math.min(5, typeCount) * 0.03) * modeDamp));

  return { lean: { label: lean.label, confidence: +derived.toFixed(2), signals: lean.signals }, mediaHabits, vibeWords };
}

function channelFit(bundle, lean) {
  const byType = topByType(bundle);
  const fit = Object.fromEntries(ALL_CHANNELS.map((c) => [c, { fit: 0.18, why: [], noSignal: true }]));
  for (const [type, ents] of Object.entries(byType)) {
    const ch = TYPE_CHANNEL[type];
    if (!ch) continue;
    const m = meanAffinity(ents);
    const top = ents[0];
    fit[ch].fit = Math.min(0.95, 0.35 + m * 0.6);
    fit[ch].noSignal = false;
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

const SCHEMA = `Respond with strict JSON: {"strategies":[{ "title","angle","channels":[channel names],"formats":[],"brief":{"title","angle","audience","keyMessage"},"watchouts":[],"heroSignal","reach":{"estViews":number,"basis":"one line"}},"antiStrategies":[{"title","channel","whyNot"}]]} — 3-4 strategies + 3-6 antiStrategies (tactics that would NOT work for this audience and why). Each channels[] picks from: ${ALL_CHANNELS.join(', ')}. reach.estViews = plausible organic impressions estimate for a small/mid brand (be honest, 1k-500k range). Base every call on the audience data given; never suggest a channel with no evidence. RULES: title = a short campaign-concept name tied to the PRODUCT or the creative idea (e.g. "Inside the Sole Lab"), NEVER named after an audience entity, brand, or artist (bad: "The National Geographic Report", "The Oppenheimer Sequence"). heroSignal = the name of ONE audience entity from the affinity list this play leans on — a proper noun only, never a sentence, spec, or scraped fragment.`;

export async function generateStrategies({ prompt, profile, product = null, urlContext = null, onStage = null }) {
  // Per-ask taste bundle: the audience read must follow THIS product/site, not
  // a stale profile bundle — otherwise every board shows the same entities.
  // enrichProfile never throws (worst case: an all-error bundle that stays
  // visible in the trail — it is NOT swapped for a healthy-looking older pull).
  let bundle = null;
  const subject = product?.name || urlContext?.title || null;
  try {
    bundle = await qloo.enrichProfile({
      name: subject || prompt.slice(0, 80),
      tagline: urlContext?.description || product?.description || '',
      description: product?.description || urlContext?.description || '',
      audience: prompt,
      tone: profile?.tone || [],
      values: profile?.values || [],
      aesthetic: profile?.aesthetic || '',
    }, { lite: true });
  } catch (e) {
    // per-ask pull threw — keep the failure visible; never substitute the
    // profile's older bundle and pretend it describes THIS product
    bundle = { affinities: [], tags: [], calls: [{ endpoint: 'enrichProfile', params: { subject: subject || prompt.slice(0, 40) }, at: new Date().toISOString(), tookMs: 0, n: 0, mode: 'error', error: String(e?.message || e).slice(0, 200) }], mode: 'error' };
  }
  const read = audienceRead(bundle, profile, prompt);
  const fitMap = channelFit(bundle, read.lean);
  const byType = topByType(bundle);
  const signalLines = Object.entries(byType).flatMap(([type, ents]) =>
    ents.slice(0, 4).map((e) => `${type.replace('urn:entity:', '')}: ${e.name} (${(e.affinity ?? 0).toFixed(2)})`));

  // STAGE 1 — everything the taste graph already knows, emitted before the
  // model call so the board starts filling while strategies are being written
  const evidence = {
    source: 'pending', qlooMode: bundle?.mode || 'none',
    signals: signalLines.slice(0, 14), drivers: read.mediaHabits,
    calls: bundle?.calls || [], qlooEvidence: qloo.qlooEvidence(bundle),
  };
  onStage?.('audience', { audienceRead: read, evidence, channelFit: fitMap });

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
          `Audience read: lean=${read.lean.label}. Media habits: ${read.mediaHabits.map((m) => `${m.channel} (${m.note})`).join('; ')}.`,
          `Top audience affinities:\n${signalLines.join('\n')}`,
          `Channel-fit priors (0-1): ${Object.entries(fitMap).map(([c, v]) => `${c}=${v.fit.toFixed(2)}`).join(', ')}`,
          `Lean guidance: ${LEAN_RULES[read.lean.label]?.watchout || LEAN_RULES[read.lean.label]?.note || ''}`,
        ].join('\n\n'),
      },
    ], { maxTokens: 6000, timeoutMs: 100000 });
  } catch { /* fall through to deterministic */ }

  const modelList = raw?.strategies || raw?.strategy || (Array.isArray(raw) ? raw : null);
  if (modelList?.length) modelNote = 'tensor';
  // the model sometimes under-delivers (1 strategy) — top up from the
  // deterministic set so a board never ships a lone card
  const merged = [...(modelList?.length ? modelList : fallbackStrategies(prompt, read))];
  if (merged.length < 3) {
    for (const f of fallbackStrategies(prompt, read, fitMap)) {
      if (merged.length >= 3) break;
      if (!merged.some((m) => (m.title || '') === (f.title || ''))) merged.push(f);
    }
  }
  const strategies = merged.slice(0, 4).map((s, i) => normalizeStrategy(s, i, fitMap, read, bundle, prompt));

  // STAGE 2 — the picks land; anti-strategies still being scored below
  onStage?.('strategies', { strategies });

  // a channel is only fairly "ruled out" when it's strictly weaker than the
  // weakest recommended channel — rejecting an equal-strength lane while
  // pushing another contradicts the board's own math
  const usedFits = strategies.flatMap((s) => s.channels.map((c) => c.fit));
  const antiLimit = Math.min(0.45, ...(usedFits.length ? usedFits : [0.45]));
  const ruledOut = (c) => (fitMap[c]?.fit ?? 0) < antiLimit;

  // rejected tactics: LLM's own list, else derive from the lowest-fit channels
  let anti = Array.isArray(raw?.antiStrategies) ? raw.antiStrategies : null;
  if (!anti?.length) {
    const used = new Set(strategies.flatMap((s) => s.channels.map((c) => c.name)));
    // only genuinely-weak channels get ruled out — an unused 0.7-fit lane is
    // headroom, not a rejection. noSignal rows say "no evidence", not "weak".
    anti = ALL_CHANNELS.filter((c) => !used.has(c) && ruledOut(c))
      .sort((a, b) => fitMap[a].fit - fitMap[b].fit)
      .slice(0, 5)
      .map((c) => ({
        title: `${c.charAt(0).toUpperCase() + c.slice(1)}-led push`,
        channel: c,
        whyNot: fitMap[c].noSignal
          ? `no taste-graph signal supports ${c} for this audience`
          : `thin signal (${fitMap[c].fit.toFixed(2)}) — nearest pull: ${fitMap[c].why[0]}`,
      }));
  }

  const antiClean = anti.slice(0, 6)
    .map((a) => ({ ...a, title: clean(a.title), channel: a.channel, whyNot: clean(a.whyNot || a.why) }))
    // LLM-named channels get the same gate — a ruled-out channel must be
    // weaker than every recommendation (unmatched names pass through as
    // qualitative model judgment, not channel-fit math)
    .filter((a) => !fitMap[a.channel] || ruledOut(a.channel))
    // the model sometimes argues the opposite of the board's own read
    // ("niche, not mass-market" on a mass-market board) — a ruled-out row
    // that contradicts the lean gets replaced by the honest fit-based reason
    .map((a) => {
      const neg = LEAN_NEG[read.lean.label];
      if (a.channel && fitMap[a.channel] && neg && neg.test(a.whyNot || '')) {
        return { ...a, whyNot: fitMap[a.channel].noSignal
          ? `no taste-graph signal supports ${a.channel} for this audience`
          : `weaker pull (${fitMap[a.channel].fit.toFixed(2)}) than the channels this audience actually lives on` };
      }
      return a;
    });

  onStage?.('anti', { antiStrategies: antiClean });

  return {
    strategies,
    antiStrategies: antiClean,
    audienceRead: read,
    // compact per-ask taste bundle — evidence pulls/hunts seed from THIS, not
    // the global profile bundle, so every board hunts its own audience
    qlooBundle: {
      mode: bundle?.mode || 'none',
      affinities: (bundle?.affinities || []).map((a) => ({
        type: a.type,
        entities: (a.entities || []).slice(0, 6).map((e) => ({
          name: e.name, affinity: e.affinity, popularity: e.popularity,
          image: e.image, tagline: e.tagline, keywords: e.keywords, industries: e.industries,
        })),
      })),
    },
    evidence: { ...evidence, source: modelNote },
    fetchedAt: new Date().toISOString(),
  };
}

function normalizeStrategy(s, i, fitMap, read, bundle, prompt) {
  const names = (Array.isArray(s.channels) ? s.channels : []).map((c) => String(c).toLowerCase());
  const channels = (names.length ? names : ['instagram', 'tiktok']).filter((c) => fitMap[c] !== undefined)
    .map((c) => ({ name: c, fit: +fitMap[c].fit.toFixed(2), noSignal: !!fitMap[c].noSignal, why: fitMap[c].why.join(', ') || `${read.lean.label} audience` }));
  const allEnts = Object.values(topByType(bundle)).flat();
  const cited = allEnts
    .filter((e) => (e.name || '').length >= 8 && JSON.stringify(s).toLowerCase().includes(e.name.toLowerCase().slice(0, 12)))
    .slice(0, 4).map((e) => ({ entity: e.name, type: e.type || '', affinity: e.affinity }));
  // heroSignal names a real audience entity — count it as cited even when the
  // rest of the copy doesn't echo the name verbatim
  const hero = cleanSignal(s.heroSignal);
  if (hero && !cited.some((c) => c.entity.toLowerCase() === hero.toLowerCase())) {
    // fuzzy: model writes "ZAYN"/"The Martian" — the bundle may say "Zayn"/"The Martian (film)"
    const hl = hero.toLowerCase();
    const he = allEnts.find((e) => {
      const el = (e.name || '').toLowerCase();
      return el === hl || el.startsWith(hl) || hl.startsWith(el) || el.includes(` ${hl}`) || el.includes(`${hl} `);
    });
    if (he) cited.unshift({ entity: he.name, type: he.type || '', affinity: he.affinity });
  }
  const fitScore = channels.length ? channels.reduce((a, c) => a + c.fit, 0) / channels.length : 0.2;
  const watchouts = (Array.isArray(s.watchouts) ? s.watchouts : []).map(clean);
  const leanW = LEAN_RULES[read.lean.label]?.watchout;
  if (leanW && !watchouts.some((w) => w.includes(leanW.slice(0, 25)))) watchouts.push(leanW);
  return {
    id: `st${i + 1}`, title: clean(s.title) || `Strategy ${i + 1}`, angle: clean(s.angle),
    channels, formats: (Array.isArray(s.formats) ? s.formats : []).map(clean),
    brief: { title: clean(s.brief?.title || s.title || prompt), angle: clean(s.brief?.angle || s.angle), audience: clean(s.brief?.audience || read.lean.label), keyMessage: clean(s.brief?.keyMessage) },
    audienceFit: { score: +Math.min(0.98, fitScore).toFixed(2), notes: [read.lean.label, ...(read.mediaHabits[0] ? [read.mediaHabits[0].note] : [])] },
    watchouts, qlooSignals: cited, heroSignal: cleanSignal(s.heroSignal) || cited[0]?.entity || '',
    reach: {
      estViews: Math.max(0, Number.isFinite(+s.reach?.estViews) ? Math.round(+s.reach.estViews) : estimateReach(channels, s.title || '')),
      basis: s.reach?.basis || `directional model — sum of channel-fit × typical organic reach`,
    },
  };
}

// model-facing copy cleaner — strips markdown emphasis and internal vocabulary
// the model echoes back ("heuristic", "'whyNot'") so UI text stays human
const clean = (v) => String(v || '').replace(/[*_`~#>]/g, '').replace(/\bheuristic(s)?\b/gi, 'data-informed').replace(/\s{2,}/g, ' ').trim();

// directional reach model: each channel carries a typical organic-reach prior
// for a small/mid brand; the strategy's fit per channel scales it. A stable
// title-hash jitter (±15%) keeps identical fits from producing identical numbers.
// phrases that would flip the board's lean on its head inside a ruled-out row
const LEAN_NEG = {
  'mass-market pragmatic': /\b(niche|subcultur|avant-garde|not mass|artist-leaning)/i,
  'design-led': /\b(mass-market|mainstream|not design|unconcerned with design)/i,
  'craft-progressive': /\b(mass-market|mainstream)/i,
  'early-adopter': /\b(laggard|late-adopt|mainstream|conservative)/i,
  'culture-led': /\b(uncultured|not culture|apathetic)/i,
  'performance-minded': /\b(sedentary|not perform|inactive)/i,
};

const CHANNEL_REACH_PRIOR = tuning('channelReachPriors');
function estimateReach(channels, title) {
  const base = channels.reduce((a, c) => a + (CHANNEL_REACH_PRIOR[c.name] || 20000) * c.fit, 0);
  let h = 0;
  for (const ch of String(title)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return Math.max(1500, Math.round(base * (0.85 + (h % 300) / 1000)));
}

// heroSignal must be a proper-noun entity — the model sometimes sneaks scraped
// fragments ("Exhibit ID: X. Status: Verified…"). Reject anything sentence-like.
function cleanSignal(v) {
  const s = String(v || '').trim();
  if (!s || s.length > 48 || /[:.;]|ID:|Status:|Conclusion:/i.test(s)) return '';
  return s;
}

function fallbackStrategies(prompt, read, fitMap = {}) {
  // picks follow the fit ranking — never hard-code a channel the ruled-out
  // logic would flag at the same strength (recommend = reject contradiction)
  const ranked = ALL_CHANNELS.slice().sort((a, b) => (fitMap[b]?.fit ?? 0) - (fitMap[a]?.fit ?? 0));
  const pick = (start, n = 2) => {
    const out = ranked.slice(start, start + n);
    return out.length ? out : ranked.slice(0, n);
  };
  return [
    { title: 'Lead channel play', angle: `Double down where the audience already lives (${ranked[0] || 'instagram'}).`, channels: pick(0), formats: ['short-form video', 'carousel'], brief: { title: prompt, angle: 'audience-native creative', audience: read.lean.label, keyMessage: prompt }, watchouts: [] },
    { title: 'Culture-collab angle', angle: 'Borrow credibility from adjacent affinities — collab, placement or pop-up.', channels: pick(2), formats: ['pop-up', 'collab drop'], brief: { title: prompt, angle: 'cultural partnership', audience: read.lean.label, keyMessage: prompt }, watchouts: [] },
    { title: 'Counter-positioning', angle: 'Zig where the category zags — earned media + community seeding.', channels: pick(4), formats: ['press kit', 'founder letter'], brief: { title: prompt, angle: 'earned-first', audience: read.lean.label, keyMessage: prompt }, watchouts: [] },
  ];
}
