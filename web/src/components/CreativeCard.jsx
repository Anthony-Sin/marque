import React, { useState } from 'react';
import Icon from './Icon.jsx';
import { api } from '../api.js';
import { arCss, downloadAsset, fileExt, isRaster, MediaFallback } from './Composer.jsx';
import { useApp } from '../App.jsx';

// Creative thumbnail in the campaign grid. Hover reveals a bottom action bar
// over the image: Edit / Promote / Animate (9:16 only) / Download.
export default function CreativeCard({ creative, aspect = '1:1', campaign, animating, onEdit, onAnimate, onChanged }) {
  const { profile, say } = useApp();
  const video = !!creative.videoPath;
  const raster = isRaster(creative.imagePath);
  const [dl, setDl] = useState(false);
  const [g, setG] = useState(null); // optimistic grade override until the PATCH lands
  const [promote, setPromote] = useState(false);
  const [retrying, setRetrying] = useState(false);

  const retryImage = async () => {
    if (retrying) return;
    setRetrying(true);
    try {
      await api.regenCreativeImage(creative.id);
      onChanged?.();
    } catch (e) { say(e.message); }
    setRetrying(false);
  };

  // ready-to-post kit — caption + hashtags composed from the creative + campaign context
  const chans = campaign?.brief?.channels || [];
  const tags = [...new Set([
    ...chans.map((c) => `#${String(c).replace(/\s+/g, '')}`),
    ...(campaign?.qlooSignals || []).slice(0, 3).map((q) => `#${String(q.entity || q).replace(/[^A-Za-z0-9]/g, '')}`),
  ])].filter((t) => t.length > 2).slice(0, 6);
  const caption = [
    creative.headline || campaign?.brief?.title || '',
    creative.body || '',
    creative.cta ? `${creative.cta} →` : '',
    tags.join(' '),
  ].filter(Boolean).join('\n');
  const copyCaption = async () => {
    try { await navigator.clipboard.writeText(caption); say('Caption + tags copied'); }
    catch { say('copy failed — select manually'); }
  };

  const download = async () => {
    if (dl) return;
    setDl(true);
    try {
      const src = video ? creative.videoPath : creative.imagePath;
      await downloadAsset(src, `marque-${creative.id}.${video ? 'mp4' : fileExt(creative.imagePath)}`);
    } catch (e) { say(e.message); }
    setDl(false);
  };

  // 1–5 star grading — persisted on the creative via the edit endpoint.
  // Clicking the active grade clears it (0).
  const grade = g ?? creative.grade ?? 0;
  const rate = async (n) => {
    const v = grade === n ? 0 : n;
    setG(v);
    try {
      await api.editCreative(creative.id, { grade: v });
      onChanged?.();
    } catch (e) { say(e.message); }
    setG(null);
  };

  return (
    <div className={`card creative-card${promote ? ' promoting' : ''}`} style={{ '--ar': arCss(aspect) }}>
      <div className="cc-media">
        {raster ? (
          <img src={creative.imagePath} alt={creative.headline || 'creative'} loading="lazy" />
        ) : (
          <MediaFallback
            seed={campaign?.brief?.title || creative.headline}
            channel={chans[0]}
            monogram={profile?.name || campaign?.brief?.title}
          />
        )}
        {video && (
          <span className="badge-v"><Icon name="play" size={10} sw={2.4} /> animated</span>
        )}
        {(animating || retrying) && (
          <div className="spin-overlay"><div className="spinner" /></div>
        )}
        <div className="veil">
          <div className="veil-bar">
            <button type="button" className="veil-btn" onClick={() => onEdit?.(creative)}>
              <Icon name="edit" size={12} /> <span>Edit</span>
            </button>
            {!raster && (
              <button type="button" className="veil-btn" title="Retry image generation" disabled={retrying} onClick={retryImage}>
                <Icon name="refresh" size={12} /> <span>Retry</span>
              </button>
            )}
            <button type="button" className="veil-btn" title="Promote — caption + tags kit"
              onClick={() => setPromote((p) => !p)}>
              <Icon name="send" size={12} /> <span>{promote ? 'Close' : 'Promote'}</span>
            </button>
            {aspect === '9:16' && (
              <button type="button" className="veil-btn" disabled={animating}
                onClick={() => onAnimate?.(creative)}>
                <Icon name="film" size={12} /> <span>Animate</span>
              </button>
            )}
            <button type="button" className="veil-btn" title="Download" disabled={dl} onClick={download}>
              {dl ? <span className="spinner" /> : <Icon name="download" size={12} />} <span>Save</span>
            </button>
          </div>
        </div>
        {promote && (
          <div className="promote-panel">
            <div className="promote-head">
              <span className="promote-label">Post-ready caption</span>
              <button type="button" className="x" title="Close kit" onClick={() => setPromote(false)}>✕</button>
            </div>
            <p className="promote-caption">{caption}</p>
            {!!chans.length && (
              <div className="promote-chans">
                {chans.map((c) => <span key={c} className="chan-chip">{c}</span>)}
              </div>
            )}
            <button className="btn lime sm" onClick={copyCaption}><Icon name="copy" size={12} /> Copy caption</button>
          </div>
        )}
      </div>
      <div className="meta">
        <span className="ttl" title={creative.headline}>{creative.headline || 'Untitled creative'}</span>
        <span className="grade" role="radiogroup" aria-label="Grade this creative"
          title={grade ? `Grade ${grade}/5` : 'Not graded'}>
          {[1, 2, 3, 4, 5].map((n) => (
            <button key={n} type="button"
              className={`grade-star${grade >= n ? ' on' : ''}`}
              aria-label={`${n} star${n > 1 ? 's' : ''}`} aria-checked={grade === n} role="radio"
              onClick={() => rate(n)}>★</button>
          ))}
        </span>
      </div>
    </div>
  );
}
