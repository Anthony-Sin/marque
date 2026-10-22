# Marque — internal API + data contract

Single source of truth for server routes and the shapes the web app consumes.
All routes live under `/api` on the Express server (default port 8787). The Vite
dev server proxies `/api` and `/assets` and `/s` to it.

## Integrations (server-side only, keys never reach the browser)

| service    | used for | env |
|------------|----------|-----|
| TensorMux  | all text/agentic reasoning (profile build, agent chat, briefs, copy, website gen) | TENSOR_API_KEY, TENSOR_MODEL (glm-4-7-flash) |
| Gemini API | image generation + image edits + Veo video | GEMINI_API_KEY, GEMINI_IMAGE_MODEL, GEMINI_VIDEO_MODEL |
| Qloo       | cultural taste graph affinities | QLOO_API_KEY, QLOO_BASE_URL |

`GET /api/status` → `{ tensor: bool, gemini: bool, qloo: "live"|"fixture"|"off", qlooNote? }`
When Qloo has no key, the server serves cached fixture responses and `qloo:"fixture"`;
the UI must still render all Qloo surfaces with a "demo data" note.

## Data model (stored in data/state.json, assets in data/assets/)

```js
Profile = {
  id, createdAt, updatedAt,
  source: { type: 'website'|'scratch'|'template', url? , templateId?},
  name, website, tagline, description,  // strings (description = "Business overview")
  tone: [string],                       // "Brand tone of voice" e.g. Bold, Warm
  aesthetic: [string],                  // "Brand aesthetic" e.g. minimal, playful
  values: [string],                     // "Brand values"
  audience: string,
  colors: [hex, hex, ...],              // ordered palette, first = primary
  fonts: { heading, body },             // display names
  business: {                           // "Business Details" tab fields
    location, phone, hours, keywords: [string], social: [string],
    ctaLinks: [ {label,url} ], testimonials: [ {quote,author} ]
  },
  images: [ { id, path, url, caption } ],   // path = /assets/<file>
  catalog: [ CatalogItem ],
  qloo: QlooBundle | null,
}
// UI derives: colors[0]=primary, colors[1]=secondary, colors[2]=accent, etc.
CatalogItem = { id, name, description, image?, url?, price? }
QlooBundle = {
  entity: { id, name, popularity } | null,       // /search best brand match
  tags: [ { id, name, types } ],                 // /v2/tags used
  affinities: [ { type: 'urn:entity:artist'|..., entities: [ {id,name,affinity,popularity} ] } ],
  calls: [ { endpoint, params, at, tookMs, n } ],// evidence trail for UI
  mode: 'live'|'fixture', fetchedAt
}
Campaign = {
  id, createdAt, brief: { title, angle, audience, keyMessage, channels:[string] },
  productId?, ingredients: { images:[string], productUrl? },
  aspectRatio: '1:1'|'4:5'|'9:16'|'16:9',
  creatives: [ Creative ],
  qlooSignals: [ { entity, type, affinity } ],
}
Creative = { id, imagePath, headline, body, cta, layout: {vpos,hpos}, videoPath?, videoState? }
PhotoshootJob = { id, createdAt, mode:'product'|'free', inputImage?, prompt?, templates:[string], results:[{id,imagePath,template}], edits:[{prompt,imagePath}] }
Website = { id, createdAt, versions:[{id,html,css?,prompt,createdAt}], activeVersion, publishedSlug? }
BrandBook = { id, createdAt, coverImage, images:[id], publishedSlug?, paletteNote }
Job = { id, kind:'video'|'image'|'site'|'campaign', status:'running'|'done'|'error', result?, error? }
```

Every list response also carries `evidence` where useful:
`evidence.qloo` = array of `{label, detail}` human-readable proof strings
("Top affinity: Khruangbin (0.91) via fans of the brand") rendered in UI.

## Routes

Profile / onboarding
- `POST /api/profile/build` `{url, templateId?}` → `{profile, evidence}` — scrape site → TensorMux DNA → Qloo enrich. Long (~30-90s); frontend polls `GET /api/profile` after, or treat as single await.
- `POST /api/profile/scratch` `{messages:[{role,content}], attachments?:[{name,mime,dataB64}]}` → `{reply, profile, evidence}` — agent builds profile from chat.
- `POST /api/profile/template` `{templateId}` → `{profile}` — canned starter profiles.
- `GET /api/profile` → `{profile|null}`
- `PUT /api/profile` `{patch}` → `{profile}` — direct field edits.
- `POST /api/agent` `{messages}` → `{reply, patch?, evidence?}` — profile-editing agent (right panel). May return a `patch` the client applies via PUT.

Qloo (browser-visible, key stays server-side)
- `POST /api/qloo/search` `{query, types?}` → `{results:[{id,name,popularity,types}]}`
- `POST /api/qloo/insights` `{type, entities?, tags?, take?}` → `{entities:[{id,name,affinity,popularity}]}`
- `GET /api/qloo/status` → `{mode, note}`

Catalog
- `GET /api/catalog` → `{items}`
- `POST /api/catalog` `{name,description,image?,url?}` → `{item}`
- `POST /api/catalog/from-url` `{url}` → `{item}` — scrape product URL.
- `PUT /api/catalog/:id` `{patch}` → `{item}`
- `DELETE /api/catalog/:id`
- `POST /api/catalog/:id/sync-image` → re-fetch image from item.url

Campaigns
- `GET /api/campaigns` → `{campaigns}`
- `POST /api/campaigns/brief` `{prompt, productId?, ingredients?}` → `{brief, suggestions:[{title,angle,keyMessage}], qlooSignals}` (Generate Brief step)
- `POST /api/campaigns` `{brief, productId?, ingredients?, aspectRatio}` → `{campaign, job}` — starts creative generation job.
- `GET /api/campaigns/:id` → `{campaign}`
- `POST /api/creatives/:id/edit` `{headline?,body?,cta?,layout?}` → `{creative}`
- `POST /api/creatives/:id/regenerate-image` `{prompt?}` → `{creative}`
- `POST /api/creatives/:id/fix-layout` → `{creative}` — recompute text placement
- `POST /api/creatives/:id/animate` → `{job}` — Veo video; poll job.

Photoshoot
- `GET /api/photoshoot` → `{jobs}`
- `POST /api/photoshoot` `{mode, inputImage?, prompt?, templates:[..]}` → `{job}`
- `POST /api/photoshoot/:id/edit` `{prompt, imagePath}` → `{job}` — iterative image edit
- Result ops on an image: `/api/images/:id/resize {aspect}`, `/api/images/:id/animate`, save-to-profile / save-as-catalog via PUT.

Websites
- `GET /api/websites` → `{websites}`
- `POST /api/websites` `{prompt?}` → `{website}` — TensorMux writes a full single-page site grounded in profile + Qloo signals.
- `POST /api/websites/:id/edit` `{prompt}` → `{version}` — agentic edit, new version.
- `POST /api/websites/:id/publish` `{slug?}` → `{publishedSlug}` — site then served at `GET /s/:slug`.
- `POST /api/websites/:id/unpublish`
- `DELETE /api/websites/:id/versions/:vid`

Brand Book
- `GET /api/brandbook` → `{book|null}`
- `POST /api/brandbook` `{coverImageId, imageIds:[<=7]}` → `{book}`
- `POST /api/brandbook/publish` `{slug?}` → served at `GET /b/:slug`
- `GET /api/brandbook/pdf` → application/pdf

Assets
- `GET /assets/<file>` — generated/scraped media (images, mp4).
- `POST /api/upload` multipart `{file}` → `{path:'/assets/x.png'}` (from-scratch attachments, ingredient images).

Jobs
- `GET /api/jobs/:id` → `{job}` — poll for video/campaign generation.

## Frontend architecture (web/)

React + Vite, plain CSS (one design-token stylesheet, no UI libs).
Screens: `Onboarding` (url / scratch / template), `ProfilePage` (Overview+Catalog+Assets tabs, agent chat right pane), `CampaignsPage` (prompt box + suggestion cards + campaign grid + creative editor modal), `PhotoshootPage`, `WebsitesPage`, `BrandBookPage`.
Shared: left nav rail, top bar with integration status chips (Tensor ✓, Gemini ✓, Qloo live/demo), `EvidenceDrawer` showing Qloo calls, `QlooBadge` component, `JobPoller` hook.
Design language: clean Google-Labs-like light UI — generous whitespace, 16-20px
radius cards, soft shadows, Google Sans-style typography (system stack:
'Google Sans','Product Sans',Roboto,Inter), ink #1f1f1f, accent per brand
colors, subtle hover lifts, pill chips. No mention of any other product name.
```
