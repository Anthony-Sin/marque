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
export const epLabel = (ep) => EP_LABEL[ep] || String(ep || '').replace(/^\/(v\d+\/)?/, '') || 'qloo call';
