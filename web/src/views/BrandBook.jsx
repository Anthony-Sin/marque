import React, { useEffect, useRef, useState } from 'react';
import { api, pollJob } from '../api.js';
import { useApp } from '../App.jsx';
import Icon from '../components/Icon.jsx';
import PublishBar from '../components/PublishBar.jsx';
import { QlooBadge, TastePanel } from '../components/Qloo.jsx';
import { postJson } from '../components/Composer.jsx';
import './studio.css';

const MAX_IMGS = 7;

// profile.colors is a keyed object ({primary, secondary, accent, background,
// surface, text}) on the server — normalize to [{label, hex}] (array-safe too).
const colorList = (p) => {
  const c = p?.colors;
  if (!c) return [];
  if (Array.isArray(c)) return c.filter(Boolean).map((hex, i) => ({ label: ['primary', 'secondary', 'accent'][i] || `color ${i + 1}`, hex }));
  return Object.entries(c).filter(([, v]) => typeof v === 'string' && v.startsWith('#')).map(([label, hex]) => ({ label, hex }));
};

export default function BrandBook() {
  const { profile, setProfile, say, status } = useApp();
  const [book, setBook] = useState(undefined);       // undefined=loading, null=none
  const [step, setStep] = useState('cover');         // cover | images | view
  const [cover, setCover] = useState(null);          // {id?, path}
  const [picked, setPicked] = useState([]);          // image ids (profile.images)
  const [page, setPage] = useState(0);
  const [busy, setBusy] = useState('');              // 'gen-cover' | 'create' | 'pub'
  const fileRef = useRef(null);

  const reload = async () => {
    try {
      const { book: b } = await api.getBrandBook();
      setBook(b);
      if (b) setStep('view');
    } catch { setBook(null); }
  };
  useEffect(() => { reload(); }, []);

  // image refs may be ids or paths depending on what was stored
  const imgPath = (ref) => {
    if (!ref) return '';
    if (typeof ref === 'object') return ref.path || ref.url || '';
    if (ref.startsWith('/')) return ref;
    return (profile?.images || []).find((i) => i.id === ref)?.path || '';
  };

  // ensure a path is a profile image, return its id (or the path if server keeps it)
  const ensureImageId = async (path, caption) => {
    const found = (profile?.images || []).find((i) => i.path === path || i.id === path);
    if (found) return found.id || found.path;
    // PUT /api/profile applies the patch verbatim — mint the id client-side so
    // the book's coverImageId/imageIds lookups resolve.
    const nid = `img-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    const { profile: p } = await api.updateProfile({
      patch: { images: [...(profile?.images || []), { id: nid, path, caption }] },
    });
    if (p) setProfile(p);
    return (p?.images || []).find((i) => i.path === path)?.id || nid || path;
  };

  const upload = async (e) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    try {
      const { path } = await api.upload(f);
      setCover({ path });
      say('Uploaded — set as cover choice');
    } catch (err) { say(err.message); }
  };

  // "generate new" cover → photoshoot free mode
  const genCover = async () => {
    setBusy('gen-cover');
    try {
      const { job } = await api.createPhotoshoot({
        mode: 'free',
        prompt: `Brand book cover for ${profile?.name || 'the brand'} — ${(profile?.tone || []).slice(0, 3).join(', ') || 'clean'} style, palette ${colorList(profile).slice(0, 3).map((c) => c.hex).join(' ')}, elegant editorial layout space`,
      });
      if (job?.id) await pollJob(job.id).catch(() => {});
      const { jobs } = await api.listPhotoshoot();
      const j = (jobs || []).find((x) => x.id === job?.id) || (jobs || []).at(-1);
      const path = j?.results?.[0]?.imagePath;
      if (path) { setCover({ path }); say('Cover generated'); }
      else say('No cover image came back');
    } catch (e) { say(e.message); }
    setBusy('');
  };

  const createBook = async () => {
    setBusy('create');
    try {
      const coverImageId = cover.id || await ensureImageId(cover.path, 'Brand book cover');
      const imageIds = picked.filter(Boolean).slice(0, MAX_IMGS);
      const { book: b } = await api.createBrandBook({ coverImageId, imageIds });
      setBook(b);
      setStep('view');
      setPage(0);
      say('Brand book created');
    } catch (e) { say(e.message); }
    setBusy('');
  };

  const publish = async (slug) => {
    setBusy('pub');
    try {
      const res = await api.publishBrandBook(slug);
      const publishedSlug = res.publishedSlug || res.slug;
      setBook((b) => ({ ...b, publishedSlug }));
      say(`Live at /b/${publishedSlug}`);
    } catch (e) { say(e.message); }
    setBusy('');
  };
  const unpublish = async () => {
    setBusy('pub');
    try {
      await postJson('/api/brandbook/unpublish');
      setBook((b) => ({ ...b, publishedSlug: undefined }));
      say('Unpublished');
    } catch (e) { say(e.status === 404 ? 'Unpublish is not available on this server yet' : e.message); }
    setBusy('');
  };

  const previewNewTab = () => {
    if (book?.publishedSlug) { window.open(`/b/${book.publishedSlug}`, '_blank'); return; }
    const blob = new Blob([bookHtml(profile, book)], { type: 'text/html' });
    window.open(URL.createObjectURL(blob), '_blank');
  };

  const qlooMode = status?.qloo === 'live' ? 'live' : 'demo';

  // ---------- loading ----------
  if (book === undefined) {
    return (
      <div className="section">
        <div className="page-head">
          <h1 className="display">Your Brand Book</h1>
          <p className="sub">A Brand Book generated from your Business Profile.</p>
        </div>
        <div className="gen-hero">
          <div className="icon-hero"><Icon name="book" size={28} /></div>
          <div className="big">Loading your Brand Book</div>
          <div className="muted">Just a moment…</div>
        </div>
      </div>
    );
  }

  // ---------- wizard ----------
  if (step !== 'view') {
    return (
      <div className="section" style={{ paddingBottom: 80 }}>
        <div className="page-head">
          <h1 className="display">Your Brand Book</h1>
          <p className="sub">A Brand Book generated from your Business Profile.</p>
        </div>
        <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={upload} />

        <div className="step-bar">
          <span className={`step-dot${step === 'cover' ? ' on' : ''}`}><i>1</i> Cover</span>
          <span className="step-line" />
          <span className={`step-dot${step === 'images' ? ' on' : ''}`}><i>2</i> Up to {MAX_IMGS} images</span>
          <span className="step-line" />
          <span className="step-dot"><i>3</i> Create</span>
        </div>

        <div style={{ maxWidth: 760, margin: '0 auto' }}>
          {step === 'cover' && (
            <div className="card pad">
              <h4 style={{ marginTop: 0 }}>Pick a cover image</h4>
              <p className="muted small">From your Business Profile assets, an upload, or generate a new one.</p>
              <div className="pick-grid">
                {(profile?.images || []).map((im) => (
                  <button key={im.id || im.path}
                    className={`pick-tile${(cover?.id || cover?.path) === (im.id || im.path) ? ' sel' : ''}`}
                    onClick={() => setCover({ id: im.id, path: im.path })}>
                    <img src={im.path} alt={im.caption || ''} />
                    {im.caption && <span className="cap">{im.caption}</span>}
                  </button>
                ))}
                <button className="pick-tile add" onClick={() => fileRef.current?.click()}>
                  <Icon name="upload" size={20} /> Upload
                </button>
                <button className="pick-tile add" disabled={busy === 'gen-cover'} onClick={genCover}>
                  {busy === 'gen-cover' ? <div className="spinner" style={{ width: 20, height: 20 }} /> : <Icon name="sparkle" size={20} />}
                  Generate new
                </button>
                {cover && !(profile?.images || []).some((i) => (i.id || i.path) === (cover.id || cover.path)) && (
                  <span className="pick-tile sel"><img src={cover.path} alt="cover" /><span className="cap">cover</span></span>
                )}
              </div>
              <div className="row mt16" style={{ justifyContent: 'flex-end' }}>
                <button className="btn lime" disabled={!cover} onClick={() => setStep('images')}>
                  Confirm cover →
                </button>
              </div>
            </div>
          )}

          {step === 'images' && (
            <div className="card pad">
              <h4 style={{ marginTop: 0 }}>Pick up to {MAX_IMGS} images</h4>
              <p className="muted small">These fill the imagery pages — product shots, studio results, campaign art.</p>
              <div className="pick-grid">
                {(profile?.images || []).map((im) => {
                  const k = im.id || im.path;
                  const sel = picked.includes(k);
                  return (
                    <button key={k}
                      className={`pick-tile${sel ? ' sel' : ''}`}
                      onClick={() => setPicked((p) => sel ? p.filter((x) => x !== k) : p.length < MAX_IMGS ? [...p, k] : p)}>
                      <img src={im.path} alt={im.caption || ''} />
                    </button>
                  );
                })}
                <button className="pick-tile add" onClick={() => fileRef.current?.click()}>
                  <Icon name="upload" size={20} /> Upload
                </button>
              </div>
              <div className="row mt16" style={{ justifyContent: 'space-between' }}>
                <button className="btn ghost" onClick={() => setStep('cover')}>← Cover</button>
                <button className="btn lime" disabled={busy === 'create' || !picked.length} onClick={createBook}>
                  <Icon name="book" /> {busy === 'create' ? 'Creating…' : `Create book (${picked.length}/${MAX_IMGS})`}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  // ---------- book view ----------
  const coverSrc = imgPath(book.coverImage);
  const bookImgs = (book.images || []).map(imgPath).filter(Boolean);
  const pages = [
    { id: 'cover', label: 'Cover' },
    { id: 'story', label: 'Story' },
    { id: 'palette', label: 'Palette' },
    { id: 'type', label: 'Typography' },
    { id: 'imagery', label: 'Imagery' },
    { id: 'taste', label: 'Taste' },
  ];
  const cur = pages[Math.min(page, pages.length - 1)];

  return (
    <div className="section" style={{ paddingBottom: 80 }}>
      <div className="page-head" style={{ paddingBottom: 14 }}>
        <h1 className="display">Your Brand Book</h1>
        <p className="sub">A Brand Book generated from your Business Profile.</p>
      </div>

      <div className="toolbar mb16" style={{ maxWidth: 840, margin: '0 auto 16px' }}>
        <a className="btn ghost sm" href="/api/brandbook/pdf" target="_blank" rel="noreferrer">
          <Icon name="download" /> Download PDF
        </a>
        <button className="btn ghost sm" onClick={previewNewTab}>
          <Icon name="eye" /> Preview in New Tab
        </button>
        <span className="grow" />
        <button className="btn ghost sm" onClick={() => { setStep('cover'); setPicked([]); }}>
          <Icon name="refresh" /> Recreate
        </button>
      </div>

      <div className="book-stage">
        <div className="book-page">
          {cur.id === 'cover' && (
            <div className="book-cover">
              {coverSrc && <img src={coverSrc} alt="cover" />}
              <div className="cover-txt">
                <div className="pg-label" style={{ color: 'var(--ink-3)' }}>Brand Book</div>
                <h2 className="display">{profile?.name || 'Your brand'}</h2>
                {profile?.tagline && <p>{profile.tagline}</p>}
              </div>
            </div>
          )}
          {cur.id === 'story' && (
            <div className="page-in">
              <div className="pg-label">Our story</div>
              <h2 className="display" style={{ fontSize: 30 }}>{profile?.tagline || profile?.name}</h2>
              <p style={{ maxWidth: 560 }}>{profile?.description}</p>
              {profile?.audience && <p className="muted small">For {profile.audience}</p>}
              {!!profile?.values?.length && (
                <div className="taglist mt8">{profile.values.map((v) => <span key={v} className="tag">{v}</span>)}</div>
              )}
            </div>
          )}
          {cur.id === 'palette' && (
            <div className="page-in">
              <div className="pg-label">Palette</div>
              <div className="palette-strip">
                {colorList(profile).map(({ label, hex }) => (
                  <span key={label + hex} className="sw" style={{ background: hex }}>
                    <span>{label}<br />{hex}</span>
                  </span>
                ))}
              </div>
              {book.paletteNote && <p className="muted small mt16">{book.paletteNote}</p>}
            </div>
          )}
          {cur.id === 'type' && (
            <div className="page-in">
              <div className="pg-label">Typography</div>
              <div className="type-sample">
                <div className="muted small">Heading · {profile?.fonts?.heading || 'default'}</div>
                <div className="h display" style={{ fontStyle: 'italic' }}>The quick brown fox</div>
                <div className="muted small mt16">Body · {profile?.fonts?.body || 'default'}</div>
                <div className="b">The quick brown fox jumps over the lazy dog.</div>
              </div>
            </div>
          )}
          {cur.id === 'imagery' && (
            <div className="page-in">
              <div className="pg-label">Imagery · {bookImgs.length}</div>
              <div className="book-imgs">
                {bookImgs.map((p, i) => <span key={i} className="media-tile"><img src={p} alt="" /></span>)}
                {!bookImgs.length && <p className="muted">No imagery recorded on this book.</p>}
              </div>
            </div>
          )}
          {cur.id === 'taste' && (
            <div className="page-in" style={{ padding: 0 }}>
              <TastePanel bundle={profile?.qloo} />
            </div>
          )}
        </div>

        <div className="book-nav">
          <button className="icon-btn" onClick={() => setPage((p) => Math.max(0, p - 1))}>←</button>
          {pages.map((p, i) => (
            <button key={p.id} className={`book-dot${i === page ? ' on' : ''}`} title={p.label} onClick={() => setPage(i)} />
          ))}
          <button className="icon-btn" onClick={() => setPage((p) => Math.min(pages.length - 1, p + 1))}>→</button>
        </div>

        <div className="mt16">
          <PublishBar
            publishedSlug={book.publishedSlug}
            base="/b/"
            label="this book"
            busy={busy === 'pub'}
            onPublish={publish}
            onUnpublish={unpublish}
          />
        </div>
        <div className="row mt8" style={{ justifyContent: 'center' }}>
          <QlooBadge mode={qlooMode} label="Taste signature inside" />
        </div>
      </div>
    </div>
  );
}

// Standalone preview doc for "Preview in New Tab" when the book isn't published.
function bookHtml(profile, book) {
  const p = profile || {};
  const img = (ref) => {
    if (!ref) return '';
    if (typeof ref === 'object') return ref.path || '';
    if (String(ref).startsWith('/')) return ref;
    return (p.images || []).find((i) => i.id === ref)?.path || '';
  };
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const imgs = (book?.images || []).map(img).filter(Boolean);
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(p.name)} — Brand Book</title>
<style>body{margin:0;background:#161616;color:#f2f2f0;font-family:Georgia,serif}section{padding:60px 8%;border-bottom:1px solid #333}h1{font-style:italic;font-size:52px;margin:0}h2{font-style:italic}.muted{color:#9a9a94}.cover{min-height:70vh;display:flex;flex-direction:column;justify-content:flex-end;background:linear-gradient(180deg,transparent, rgba(0,0,0,.75)),url('${img(book?.coverImage)}') center/cover}.sw{display:inline-block;width:90px;height:90px;border-radius:14px;margin-right:12px;vertical-align:bottom;font-size:11px;padding:8px;color:#fff;text-shadow:0 1px 3px #000;box-sizing:border-box}.tag{display:inline-block;background:#2e2e2e;border-radius:999px;padding:6px 14px;margin:4px 6px 0 0;font-size:14px}img.t{width:150px;height:150px;object-fit:cover;border-radius:12px;margin:0 8px 8px 0}</style></head><body>
<section class="cover"><div><div class="muted">BRAND BOOK</div><h1>${esc(p.name)}</h1><p>${esc(p.tagline)}</p></div></section>
<section><h2>Our story</h2><p style="max-width:560px">${esc(p.description)}</p><p class="muted">${esc(p.audience)}</p>${(p.values || []).map((v) => `<span class="tag">${esc(v)}</span>`).join('')}</section>
<section><h2>Palette</h2>${colorList(p).map(({ label, hex }) => `<span class="sw" style="background:${esc(hex)}">${esc(label)} · ${esc(hex)}</span>`).join('')}${book?.paletteNote ? `<p class="muted">${esc(book.paletteNote)}</p>` : ''}</section>
<section><h2>Typography</h2><p class="muted">Heading · ${esc(p.fonts?.heading)}</p><h1 style="font-size:34px">The quick brown fox</h1><p class="muted">Body · ${esc(p.fonts?.body)}</p><p style="font-family:system-ui">The quick brown fox jumps over the lazy dog.</p></section>
<section><h2>Imagery</h2>${imgs.map((s) => `<img class="t" src="${s}">`).join('')}</section>
</body></html>`;
}
