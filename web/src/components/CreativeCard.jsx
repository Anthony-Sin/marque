import React from 'react';
import Icon from './Icon.jsx';
import { arCss, downloadAsset } from './Composer.jsx';
import { useApp } from '../App.jsx';

// Creative thumbnail in the campaign grid. Hover → Edit / Animate (9:16 only) / Download.
export default function CreativeCard({ creative, aspect = '1:1', animating, onEdit, onAnimate, onChanged }) {
  const { say } = useApp();
  const video = !!creative.videoPath;

  const download = async () => {
    try {
      const src = video ? creative.videoPath : creative.imagePath;
      await downloadAsset(src, `marque-${creative.id}${video ? '.mp4' : '.png'}`);
    } catch (e) { say(e.message); }
  };

  return (
    <div className="card creative-card" style={{ '--ar': arCss(aspect) }}>
      <img src={creative.imagePath} alt={creative.headline || 'creative'} loading="lazy" />
      {video && (
        <span className="badge-v"><Icon name="play" size={10} sw={2.4} /> animated</span>
      )}
      {animating && (
        <div className="spin-overlay"><div className="spinner" /></div>
      )}
      <div className="veil">
        <button className="veil-btn" onClick={() => onEdit?.(creative)}>
          <Icon name="edit" size={14} /> Edit
        </button>
        {aspect === '9:16' && (
          <button className="veil-btn" disabled={animating} onClick={() => onAnimate?.(creative)}>
            <Icon name="film" size={14} /> Animate
          </button>
        )}
        <button className="veil-btn" title="Download" onClick={download}>
          <Icon name="download" size={14} />
        </button>
      </div>
      <div className="meta">
        <span className="ttl" title={creative.headline}>{creative.headline || 'Untitled creative'}</span>
      </div>
    </div>
  );
}
