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
  // SVG placeholders already carry baked-in copy — compositing live type on top
  // would double-render it (the card grid skips these via the raster check, but
  // the editor preview gates on cleanImage alone, which placeholders keep)
  if (creative?.placeholder || /\.svg(?:[?#]|$)/i.test(String(creative?.imagePath || ''))) return null;
  const vpos = creative?.layout?.vpos || 'bottom';
  const hpos = creative?.layout?.hpos || 'left';
  const st = creative?.overlayStyle || 'performance';
  const accent = profile?.colors?.accent || '#e7e0c9';
  const inkOnPill = pickInk(accent);
  // every rendered string is real creative data — sanitize defensively so a
  // junk token ('undefined', 'null', lorem, 'Untitled campaign') degrades to
  // an omitted line instead of shipping placeholder-looking copy
  const brand = cleanCopy(creative?.brand) || cleanCopy(profile?.name !== 'Your Brand' ? profile?.name : '');
  const headline = cleanCopy(creative?.headline);
  const body = cleanCopy(creative?.body);
  const cta = cleanCopy(creative?.cta);
  const badge = cleanCopy(creative?.badge);
  const angle = cleanCopy(creative?.angle);
  return (
    <div className={`co-stack st-${st}${chrome ? ' chrome-on' : ''}`} style={{ '--accent': accent, '--ink-on-accent': inkOnPill }}>
      {/* brand lockup — parks on the edge OPPOSITE the copy (v-classes), like real paid social */}
      <div className={`co-lockup v-${vpos}`}>
        <span className="co-lockup-bar" style={{ background: accent }} />
        {!!brand && <span className="co-lockup-name">{brand}</span>}
      </div>
      {!!badge && <div className={`co-badge v-${vpos}`} style={{ background: accent, color: inkOnPill }}>{badge}</div>}
      <div className={`co-scrim v-${vpos}`} />
      <div className={`co-card`}>
        <div className={`co-grid v-${vpos} h-${hpos}`}>
          {!!angle && <div className="co-kicker">{kickerFor(angle)}</div>}
          {!!headline && <div className="co-headline">{styleHeadline(st, headline)}</div>}
          {!!body && <div className="co-body">{body}</div>}
          {!!cta && (
            <div className="co-cta" style={{ background: accent, color: inkOnPill }}>
              {cta}
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
// normalize a copy field to a renderable string or '' — collapses whitespace
// and rejects model/user/serialization junk that would read as placeholder text
function cleanCopy(v) {
  const s = String(v ?? '').replace(/\s+/g, ' ').trim();
  return /^(undefined|null|nan|none|n\/?a|tbd|lorem( ipsum.*)?|untitled( campaign)?|your brand)$/i.test(s) ? '' : s;
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
