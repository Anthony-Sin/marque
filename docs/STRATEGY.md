# Strategy Board — design notes

The strategy board is what happens before a brief: given a campaign prompt (and
optional product), the server returns *candidate strategies* — each a channel
mix, format list, audience-fit score and watchouts — grounded in the profile's
Qloo bundle.

## Server flow (server/src/services/strategy.js)

1. Load profile + profile.qloo bundle (affinities per entity type, tags, calls).
2. Build an `audienceRead`:
   - `mediaHabits`: map affinity coverage by type → channels
     (tv_show→tv/streaming, podcast→podcast, artist→tiktok/music-led,
     brand→instagram (visual/lifestyle brands), place→guerrilla/ooh,
     book→email/press). Top 2-3 types by mean affinity → note text.
   - `lean`: heuristic from tags+entity mix — e.g. craft/heritage/indie
     signals → "craft-progressive, novelty-cautious"; tech/finance/venture
     signals → "early-adopter, AI-receptive"; mainstream/large-brand skew →
     "mass-market pragmatic". Each lean gets strategy guidance baked in
     (see leanRules below).
   - `vibeWords`: 3-5 adjectives distilled from tone+aesthetic+top tags.
3. Ask TensorMux (chatJSON) for 3-4 strategies using: prompt, product,
   profile summary, top affinities (entity names+scores by type),
   audienceRead. Schema enforced = Strategy from API.md.
4. Post-process each strategy: fill channel `fit` scores deterministically
   from bundle coverage (don't trust the LLM's numbers), attach the real
   qlooSignals it cited (match names → entities), compute audienceFit from
   channel alignment + lean rules, inject lean-derived watchouts if the LLM
   missed them.

## leanRules (server constant)

- craft-progressive / heritage / indie-leaning audience →
  watchout: "AI-forward messaging lands poorly here — lead with human craft,
  keep generated assets subtle"; boost formats: process docs, pop-ups,
  collabs; penalize 'ai-hologram'-style gimmicks.
- early-adopter / tech-receptive → note: "this crowd rewards AI-native
  creative — interactive + generative formats test well"; boost interactive.
- mass-market pragmatic → broad channels fine; value-led messaging.
- The lean is a heuristic shown with a confidence — always label it a read,
  not a fact.

## Response shape

`{ strategies, audienceRead, evidence }` — evidence includes which bundle
inputs drove each channel call so the UI can show "why" honestly.
