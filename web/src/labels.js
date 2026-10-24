// proper channel casing for UI — data stays lowercase everywhere else
export const CHAN_LABEL = { tiktok: 'TikTok', youtube: 'YouTube', tv: 'TV', ooh: 'OOH', streaming: 'Streaming', podcast: 'Podcast', press: 'Press', email: 'Email', guerrilla: 'Guerrilla', instagram: 'Instagram', maps: 'Maps', web: 'Web' };
export const chanLabel = (n) => {
  const key = String(n || '').toLowerCase();
  if (CHAN_LABEL[key]) return CHAN_LABEL[key];
  // enum-ish names like "instagram_reels" → "Instagram Reels"
  return String(n || '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
};
