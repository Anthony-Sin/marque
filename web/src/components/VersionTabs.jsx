import React, { useEffect, useRef, useState } from 'react';
import Icon from './Icon.jsx';
import { fmtDate } from './Composer.jsx';
import '../views/studio.css';

// srcDoc iframes are expensive (full doc parse + fonts per version) — mount each
// one lazily when its tab nears the viewport, keep it mounted after.
function LazyFrame({ html, title }) {
  const ref = useRef(null);
  const [live, setLive] = useState(false);
  useEffect(() => {
    if (live || !ref.current) return;
    const io = new IntersectionObserver((es) => {
      if (es.some((e) => e.isIntersecting)) { setLive(true); io.disconnect(); }
    }, { rootMargin: '200px' });
    io.observe(ref.current);
    return () => io.disconnect();
  }, [live]);
  return (
    <span ref={ref} style={{ display: 'contents' }}>
      {live ? <iframe title={title} srcDoc={html} sandbox="" tabIndex={-1} /> : <Icon name="site" size={26} />}
    </span>
  );
}

// "+ Regenerate" tile followed by one thumbnail tab per version: V1 · Oct 22, V2 · …
export default function VersionTabs({ versions = [], activeId, onPick, onRegenerate, busy }) {
  return (
    <div className="ver-tabs">
      <button className="ver-tab add" onClick={onRegenerate} disabled={busy} title="Regenerate site">
        <span className="thumb">{busy ? <span className="spinner" style={{ width: 22, height: 22 }} /> : <Icon name="plus" size={26} />}</span>
        <span className="cap">{busy ? 'Working…' : 'Regenerate'}</span>
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
              <LazyFrame html={v.html} title={`v${i + 1}`} />
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
