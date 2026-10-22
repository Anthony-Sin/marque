import React, { useState } from 'react';
import { useApp } from '../App.jsx';
import Icon from './Icon.jsx';
import '../views/studio.css';

// Publish controls: slug input + Publish, or live URL + open/copy + Unpublish.
// base: '/s/' for websites, '/b/' for brand book.
export default function PublishBar({ publishedSlug, base = '/s/', label = 'this site', onPublish, onUnpublish, busy }) {
  const { say } = useApp();
  const [slug, setSlug] = useState('');
  const url = publishedSlug ? `${window.location.origin}${base}${publishedSlug}` : null;

  const copy = async () => {
    try { await navigator.clipboard.writeText(url); say('Link copied'); }
    catch { say('Copy failed'); }
  };

  return (
    <div className="card publish-bar">
      {publishedSlug ? (
        <>
          <span className="pub-url"><Icon name="globe" size={15} /> {base}{publishedSlug}</span>
          <a className="btn ghost sm" href={`${base}${publishedSlug}`} target="_blank" rel="noreferrer">
            <Icon name="eye" /> Open
          </a>
          <button className="btn ghost sm" onClick={copy}><Icon name="share" /> Share</button>
          <span className="grow" />
          <button className="btn ghost sm" disabled={busy} onClick={() => onUnpublish?.()}>
            {busy && <span className="spinner" />}Unpublish
          </button>
        </>
      ) : (
        <>
          <span className="row" style={{ gap: 7, color: 'var(--ink-2)', fontSize: 13.5 }}>
            <Icon name="globe" size={15} /> Publish {label}
          </span>
          <input
            className="slug-in"
            value={slug}
            onChange={(e) => setSlug(e.target.value.replace(/[^a-z0-9-]/gi, '-').toLowerCase())}
            onKeyDown={(e) => e.key === 'Enter' && !busy && onPublish?.(slug.trim() || undefined)}
            placeholder="custom-slug (optional)"
          />
          <button className="btn lime sm" disabled={busy} onClick={() => onPublish?.(slug.trim() || undefined)}>
            {busy ? <span className="spinner" /> : <Icon name="link" />} Publish
          </button>
        </>
      )}
    </div>
  );
}
