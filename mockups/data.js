// Shared data layer for strategy-board mockups. window.DATA = {...}
window.DATA = {
  profile: {
    name: "Aurora Roast",
    website: "https://auroraroast.example",
    tagline: "Ethically sourced, bold flavor, community first.",
    tone: ["Bold", "Artisanal", "Community-focused"],
    colors: ["#3b2417", "#c98d4b", "#e8dcc8", "#1c1410"],
    prompt: "launch our new single-origin espresso for winter"
  },
  audienceRead: {
    lean: { label: "Craft-progressive, AI-skeptical", confidence: 0.68,
      signals: ["high affinity for indie + heritage media", "over-indexes on slow-living tags", "skepticism markers in audience cluster"] },
    mediaHabits: [
      { channel: "instagram", note: "primary — follows specialty-coffee + ceramic craft accounts" },
      { channel: "podcast", note: "strong — food + interview shows over-index" },
      { channel: "tiktok", note: "moderate — process/craft videos only" },
      { channel: "tv", note: "low — streaming-first household profile" }],
    vibeWords: ["hands-on", "transparent", "anti-corporate", "ritual"]
  },
  strategies: [
    {
      id: "s1", title: "The 6am Cup Ritual",
      angle: "Own the morning-ritual moment with process-first storytelling",
      channels: [
        { name: "instagram", fit: 0.94, why: "audience over-indexes on craft/artisan accounts (Blue Bottle 0.91, Khruangbin 0.87)" },
        { name: "tiktok", fit: 0.61, why: "process videos work; skip trend formats" },
        { name: "podcast", fit: 0.78, why: "food interview shows rank top-3 affinity" },
        { name: "tv", fit: 0.22, why: "weak linear signal — audience is streaming-first" }],
      formats: ["UGC ritual reels", "roaster-day-in-life", "static carousel: brew guide"],
      brief: { title: "The 6am Cup Ritual", angle: "process-first storytelling", audience: "specialty coffee regulars 25-44", keyMessage: "Your morning deserves a slower roast" },
      audienceFit: { score: 0.89, notes: ["matches slow-living identity", "human story > tech story for this crowd"] },
      watchouts: ["AI-generated imagery will read 'off' to this anti-corporate base — lead with real process shots", "avoid hard-sell CTA language"],
      qlooSignals: [{ entity: "Blue Bottle Coffee", type: "brand", affinity: 0.91 }, { entity: "Khruangbin", type: "artist", affinity: 0.87 }, { entity: "The Bear", type: "tv_show", affinity: 0.74 }],
      heroSignal: "Blue Bottle Coffee"
    },
    {
      id: "s2", title: "Roast Lab Guerrilla",
      angle: "Pop-up tasting carts where the regulars already are",
      channels: [
        { name: "guerrilla", fit: 0.88, why: "dense indie-venue affinity map — farmers markets, record stores" },
        { name: "instagram", fit: 0.71, why: "geo-tagged pop-up content spreads locally" },
        { name: "ooh", fit: 0.55, why: "transit posters near university district cluster" }],
      formats: ["pop-up tasting cart", "record-store collab night", "free-cup-for-vinyl drop"],
      brief: { title: "Roast Lab Guerrilla", angle: "hyperlocal presence", audience: "downtown indie culture cluster", keyMessage: "Find us where you already hang" },
      audienceFit: { score: 0.83, notes: ["community-first value aligned", "local cluster density is high"] },
      watchouts: ["permit lead times for carts", "don't over-brand — hand-lettered signage tests better here"],
      qlooSignals: [{ entity: "local record stores", type: "place", affinity: 0.82 }, { entity: "farmers markets", type: "place", affinity: 0.79 }],
      heroSignal: "local record stores"
    },
    {
      id: "s3", title: "Bean Passport",
      angle: "Origin-story series — every bag a destination",
      channels: [
        { name: "youtube", fit: 0.81, why: "documentary-style food travel content indexes well" },
        { name: "instagram", fit: 0.77, why: "carousel storytelling fits habit" },
        { name: "email", fit: 0.66, why: "bookish segment responds to long-form drops" },
        { name: "streaming", fit: 0.48, why: "pre-roll on food/travel content only" }],
      formats: ["mini-doc series", "passport-stamp loyalty program", "origin postcard in every bag"],
      brief: { title: "Bean Passport", angle: "origin storytelling", audience: "coffee nerds + armchair travelers", keyMessage: "Taste where it grew" },
      audienceFit: { score: 0.76, notes: ["travel affinity moderate", "education angle fits 'transparent' vibe"] },
      watchouts: ["production cost per episode", "avoid exoticizing — co-story with producers"],
      qlooSignals: [{ entity: "travel documentaries", type: "tv_show", affinity: 0.7 }, { entity: "Atlas Obscura", type: "brand", affinity: 0.68 }],
      heroSignal: "travel documentaries"
    },
    {
      id: "s4", title: "Night Shift Brew Crew",
      angle: "Serve the late-night study + creative crowd",
      channels: [
        { name: "tiktok", fit: 0.72, why: "study-with-me + lo-fi formats index on this subcluster" },
        { name: "instagram", fit: 0.64, why: "secondary reach" }],
      formats: ["midnight happy hour", "lo-fi study playlist collab", "exam-week bottomless"],
      brief: { title: "Night Shift Brew Crew", angle: "occasion expansion", audience: "students + night creatives", keyMessage: "Roasted for the late shift" },
      audienceFit: { score: 0.58, notes: ["expands audience but lower fit with core brand voice"] },
      watchouts: ["dilutes artisan positioning if pushed too hard", "margins on late hours"],
      qlooSignals: [{ entity: "lo-fi playlists", type: "artist", affinity: 0.71 }, { entity: "night markets", type: "place", affinity: 0.66 }],
      heroSignal: "lo-fi playlists"
    }
  ]
};
