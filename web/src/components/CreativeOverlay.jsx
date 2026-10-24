import React from 'react';
import Icon from './Icon.jsx';

// DOM text layer composited over a clean (text-free) generated background —
// the industry pattern: imagery stays pure pixels, copy stays live type.
// Style presets follow real paid-social overlay treatments; creativeExport.js
// mirrors the same presets into the rasterized download.
export const OVERLAY_STYLES = [
  { id: 'performance', name: 'Performance', hint: 'Bold condensed on scrim' },
  { id: 'ugc', name: 'UGC Native', hint: 'TikTok caption stroke' },
  { id: 'editorial', name: 'Editorial Serif', hint: 'Quiet luxury serif' },
  { id: 'marker', name: 'Marker Highlight', hint: 'Creator hook boxes' },
  { id: 'brutalist', name: 'Brutalist Sticker', hint: 'Offset hard blocks' },
  { id: 'glass', name: 'Glass Card', hint: 'Frosted blur panel' },
];

export default function CreativeOverlay({ creative, profile, chrome = false }) {
  const vpos = creative?.layout?.vpos || 'bottom';
  const hpos = creative?.layout?.hpos || 'left';
  const st = creative?.overlayStyle || 'performance';
  const accent = profile?.colors?.accent || '#e7e0c9';
  const inkOnPill = pickInk(accent);
  return (
    <div className={`co-stack st-${st}`} style={{ '--accent': accent, '--ink-on-accent': inkOnPill }}>
      <div className={`co-scrim v-${vpos}`} />
      <div className={`co-card`}>
        <div className={`co-grid v-${vpos} h-${hpos}`}>
          {!!creative?.angle && <div className="co-kicker">{kickerFor(creative.angle)}</div>}
          {!!creative?.headline && <div className="co-headline">{styleHeadline(st, creative.headline)}</div>}
          {!!creative?.body && <div className="co-body">{creative.body}</div>}
          {!!creative?.cta && (
            <div className="co-cta" style={{ background: accent, color: inkOnPill }}>
              {creative.cta}
            </div>
          )}
        </div>
      </div>
      {chrome && (
        <div className="co-chrome-top">
          <span className="co-chrome-handle">@{handle(profile)}</span>
          <span className="co-chrome-ic"><Icon name="send" size={13} /></span>
          <span className="co-chrome-ic"><Icon name="kebab" size={13} /></span>
        </div>
      )}
    </div>
  );
}

// editorial: first word italic serif flourish; marker: money-word gets the
// highlight block; other presets render the string as-is.
export function styleHeadline(style, text) {
  if (!text) return text;
  if (style === 'editorial') {
    const m = text.match(/^(\S+)\s+(.*)$/s);
    if (m) return <><em className="co-ital">{m[1]}</em> {m[2]}</>;
    return text;
  }
  if (style === 'marker') {
    const words = text.split(/\s+/);
    let best = -1;
    words.forEach((w, i) => { if (/[\d%$]/.test(w)) best = i; });
    if (best < 0) best = words.reduce((bi, w, i) => (w.length > words[bi].length ? i : bi), 0);
    return words.map((w, i) => (
      <React.Fragment key={i}>{i > 0 && ' '}{i === best ? <mark className="co-mark">{w}</mark> : w}</React.Fragment>
    ));
  }
  return text;
}

function handle(profile) {
  return String(profile?.name || 'brand').toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 20) || 'brand';
}
function pickInk(hex) {
  const c = String(hex || '').replace('#', '');
  if (c.length !== 6) return '#141412';
  const r = parseInt(c.slice(0, 2), 16), g = parseInt(c.slice(2, 4), 16), b = parseInt(c.slice(4, 6), 16);
  return (0.299 * r + 0.587 * g + 0.114 * b) > 150 ? '#141412' : '#f4f3ec';
}
function kickerFor(angle) {
  return { product: 'Product', lifestyle: 'Lifestyle', offer: 'Offer', ugc: 'Community', retargeting: 'For you' }[angle] || 'Spotlight';
}
