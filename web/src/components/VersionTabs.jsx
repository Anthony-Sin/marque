import React from 'react';
import Icon from './Icon.jsx';
import { fmtDate } from './Composer.jsx';
import '../views/studio.css';

// "+ Regenerate" tile followed by one thumbnail tab per version: V1 · Oct 22, V2 · …
export default function VersionTabs({ versions = [], activeId, onPick, onRegenerate, busy }) {
  return (
    <div className="ver-tabs">
      <button className="ver-tab add" onClick={onRegenerate} disabled={busy} title="Regenerate site">
        <span className="thumb"><Icon name="plus" size={26} /></span>
        <span className="cap">Regenerate</span>
      </button>
      {versions.map((v, i) => (
        <button
          key={v.id || i}
          className={`ver-tab${(v.id || i) === activeId ? ' on' : ''}`}
          onClick={() => onPick?.(v.id || i)}
          title={v.prompt || `Version ${i + 1}`}
        >
          <span className="thumb">
            {v.html ? (
              <iframe title={`v${i + 1}`} srcDoc={v.html} sandbox="" tabIndex={-1} />
            ) : (
              <Icon name="site" size={26} />
            )}
          </span>
          <span className="cap">V{i + 1}{v.createdAt ? ` · ${fmtDate(v.createdAt)}` : ''}</span>
        </button>
      ))}
    </div>
  );
}
