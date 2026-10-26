import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, pollJob } from '../api.js';
import { useApp } from '../App.jsx';
import Icon from '../components/Icon.jsx';
import PublishBar from '../components/PublishBar.jsx';
import { QlooBadge, TastePanel } from '../components/Qloo.jsx';
import { postJson, useStages, thumb } from '../components/Composer.jsx';
import './studio.css';

const MAX_IMGS = 7;
const COVER_STAGES = ['Dreaming up cover art…', 'Rendering your cover…', 'Applying finishing touches…'];

// profile.colors is a keyed object ({primary, secondary, accent, background,
// surface, text}) on the server — normalize to [{label, hex}] (array-safe too).
const colorList = (p) => {
  const c = p?.colors;
  if (!c) return [];
  if (Array.isArray(c)) return c.filter(Boolean).map((hex, i) => ({ label: ['primary', 'secondary', 'accent'][i] || `color ${i + 1}`, hex }));
  return Object.entries(c).filter(([, v]) => typeof v === 'string' && v.startsWith('#')).map(([label, hex]) => ({ label, hex }));
};

// luminance check — light swatches need dark labels or the hex reads white-on-white
const lightHex = (hex) => {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '').trim());
  if (!m) return false;
  const n = parseInt(m[1], 16);
  const lum = 0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255);
  return lum > 150;
};

const pad2 = (n) => String(n).padStart(2, '0');

// palette usage split — same weights the printed book's .pal-strip uses, so
// the in-app bar and the published sheet agree on how the palette divides
const SW_ROLE = {
  primary: 'Primary mark & cover', secondary: 'Secondary elements', accent: 'Moments of emphasis',
  background: 'Page ground', surface: 'Cards & fields', text: 'Ink & type',
};
const SW_W = { primary: 3, secondary: 2, accent: 2 };
const swatchSpecs = (p) => colorList(p).map(({ label, hex }) => ({
  label, hex,
  role: SW_ROLE[String(label).toLowerCase()] || 'Supporting tone',
  w: SW_W[String(label).toLowerCase()] || 1,
}));

// brand faces — sanitize like the server template's fontName (strips anything
// that could break out of a style attr), then build an honest fallback stack
const SYSFONTS = new Set(['serif', 'sans-serif', 'monospace', 'system-ui', 'georgia', 'helvetica', 'arial', 'times new roman', 'courier', 'courier new', 'verdana', 'tahoma', 'trebuchet ms', 'ui-sans-serif', 'ui-serif', 'ui-monospace', 'inherit']);
const fontName = (v) => String(v || '').replace(/['"\\;{}()<>]/g, '').trim().slice(0, 60) || null;
const googleFont = (v) => { const n = fontName(v); return n && !SYSFONTS.has(n.toLowerCase()) ? n : null; };
const fontStack = (v, fallback) => { const n = fontName(v); return n ? `'${n}',${fallback}` : fallback; };

// honest empty state — the book prints "not set" instead of inventing content
const NotSet = ({ children }) => (
  <div className="bb-unset">
    <span className="bb-unset-tag">Not set</span>
    <p className="muted small">{children}</p>
  </div>
);

export default function BrandBook() {
  const { profile, setProfile, say, status } = useApp();
  const nav = useNavigate();
  const [book, setBook] = useState(undefined);       // undefined=loading, null=none
  const [step, setStep] = useState('cover');         // cover | images | view
  const [cover, setCover] = useState(null);          // {id?, path}
  const [picked, setPicked] = useState([]);          // image ids (profile.images)
  const [page, setPage] = useState(0);
  const [busy, setBusy] = useState('');              // 'gen-cover' | 'create' | 'pub'
  const coverNote = useStages(COVER_STAGES, busy === 'gen-cover');
  const fileRef = useRef(null);

  const reload = async () => {
    try {
      const { book: b } = await api.getBrandBook();
      setBook(b);
      if (b) setStep('view');
    } catch { setBook(null); }
  };
  useEffect(() => { reload(); }, []);

  // the type page previews real faces — pull the profile's Google fonts into
  // the doc (system faces skip the CDN round-trip entirely). One shared link,
  // updated in place; removing it would clobber other views' font stacks.
  useEffect(() => {
    const names = [...new Set([googleFont(profile?.fonts?.heading), googleFont(profile?.fonts?.body)].filter(Boolean))];
    if (!names.length) return undefined;
    let link = document.getElementById('bb-gfonts');
    if (!link) {
      link = document.createElement('link');
      link.id = 'bb-gfonts';
      link.rel = 'stylesheet';
      document.head.appendChild(link);
    }
    link.href = `https://fonts.googleapis.com/css2?${names.map((n) => `family=${encodeURIComponent(n).replace(/%20/g, '+')}:ital,wght@0,400;0,500;0,600;0,700;1,400;1,500`).join('&')}&display=swap`;
    return undefined;
  }, [profile?.fonts?.heading, profile?.fonts?.body]);

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
      images: [...(profile?.images || []), { id: nid, path, caption }],
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

  // "generate new" cover → photoshoot free mode (shared by the wizard's
  // Generate-new tile and the book view's Compose-cover action)
  const runCoverShoot = async () => {
    const { job, shoot } = await api.createPhotoshoot({
      mode: 'free',
      prompt: `Brand book cover for ${profile?.name || 'the brand'} — ${(profile?.tone || []).slice(0, 3).join(', ') || 'clean'} style, palette ${colorList(profile).slice(0, 3).map((c) => c.hex).join(' ')}, elegant editorial layout space`,
    });
    if (job?.id) await pollJob(job.id).catch(() => {});
    const { jobs } = await api.listPhotoshoot();
    const j = (jobs || []).find((x) => x.id === shoot?.id) || (jobs || []).at(-1);
    return (j?.results || []).find((r) => r.imagePath)?.imagePath || null;
  };

  const genCover = async () => {
    setBusy('gen-cover');
    try {
      const path = await runCoverShoot();
      if (path) { setCover({ path }); say('Cover generated'); }
      else say('No cover image came back');
    } catch (e) { say(e.message); }
    setBusy('');
  };

  // view-mode cover composition — no PATCH route exists for the book's cover,
  // so the book is re-POSTed with the same imageIds + the new coverImageId.
  // buildBook resets publishedSlug → republish the same slug so a live book
  // stays live at the same URL (fail loudly, never fake the badge).
  const composeCover = async () => {
    setBusy('gen-cover');
    try {
      const path = await runCoverShoot();
      if (!path) { say('No cover image came back'); setBusy(''); return; }
      const coverImageId = await ensureImageId(path, 'Brand book cover');
      const wasLive = book?.publishedSlug;
      const { book: b } = await api.createBrandBook({ coverImageId, imageIds: book?.images || [] });
      if (wasLive && b) {
        try {
          const r = await api.publishBrandBook(wasLive);
          b.publishedSlug = r.publishedSlug || r.slug || wasLive;
        } catch { say('Cover composed — republish the book to restore the live link'); }
      }
      if (b) setBook(b);
      setPage(0);
      say('Cover composed');
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
    if (book?.publishedSlug) { window.open(`/b/${book.publishedSlug}`, '_blank', 'noopener'); return; }
    const blob = new Blob([bookHtml(profile, book)], { type: 'text/html' });
    const u = URL.createObjectURL(blob);
    window.open(u, '_blank', 'noopener');
    setTimeout(() => URL.revokeObjectURL(u), 60_000);
  };

  // the badge claims the signature IN THE BOOK is live — that's the bundle's
  // own mode, not the service's global liveness (they disagreed on screen)
  const qlooMode = profile?.qloo?.mode === 'live' ? 'live'
    : profile?.qloo?.mode === 'partial' ? 'partial'
    : profile?.qloo?.mode === 'error' ? 'error'
    : status?.qloo === 'live' ? 'live' : 'off';

  // ---------- loading ----------
  if (book === undefined) {
    return (
      <div className="section view bb-view">
        <div className="view-head">
          <div className="vh-main">
            <span className="vh-kicker">MARQUE / BOOK</span>
            <h1 className="display">Your Brand Book</h1>
            <p className="sub">A Brand Book generated from your Business Profile.</p>
          </div>
        </div>
        <div className="book-stage card hud">
          <div className="book-page" style={{ padding: 38, display: 'block' }}>
            <span className="skel skel-line" style={{ width: 120, marginBottom: 18 }} />
            <span className="skel" style={{ width: '100%', height: 240, borderRadius: 14 }} />
            <span className="skel skel-line w70 mt16" />
            <span className="skel skel-line w40" style={{ marginTop: 10 }} />
          </div>
          <div className="book-nav">
            {[0, 1, 2, 3, 4, 5].map((i) => <span key={i} className="skel" style={{ width: 8, height: 8, borderRadius: '50%' }} />)}
          </div>
        </div>
      </div>
    );
  }

  // ---------- wizard ----------
  if (step !== 'view') {
    return (
      <div className="section view bb-view">
        <div className="view-head">
          <div className="vh-main">
            <span className="vh-kicker">MARQUE / BOOK</span>
            <h1 className="display">Your Brand Book</h1>
            <p className="sub">A Brand Book generated from your Business Profile.</p>
          </div>
        </div>
        <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={upload} />

        <div className="step-bar">
          <span className={`step-dot${step === 'cover' ? ' on' : ''}`}><i>1</i> Cover</span>
          <span className="step-line" />
          <span className={`step-dot${step === 'images' ? ' on' : ''}`}><i>2</i> Up to {MAX_IMGS} images</span>
          <span className="step-line" />
          <span className="step-dot"><i>3</i> Create</span>
        </div>

        <div className="bb-step">
          {step === 'cover' && (
            <div className="card pad">
              <h4 style={{ marginTop: 0 }}>Pick a cover image</h4>
              <p className="muted small">From your Business Profile assets, an upload, or generate a new one.</p>
              <div className="pick-grid">
                {(profile?.images || []).filter((im) => im.path).map((im) => (
                  <button key={im.id || im.path}
                    className={`pick-tile${(cover?.id || cover?.path) === (im.id || im.path) ? ' sel' : ''}`}
                    onClick={() => setCover({ id: im.id, path: im.path })}>
                    <img src={thumb(im.path, 320)} alt={im.caption || ''} />
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
                  <span className="pick-tile sel"><img src={thumb(cover.path, 320)} alt="cover" /><span className="cap">cover</span></span>
                )}
              </div>
              {busy === 'gen-cover' && <div className="gen-note"><span className="spinner" />{coverNote}</div>}
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
                {(profile?.images || []).filter((im) => im.path).map((im) => {
                  const k = im.id || im.path;
                  const sel = picked.includes(k);
                  return (
                    <button key={k}
                      className={`pick-tile${sel ? ' sel' : ''}`}
                      onClick={() => setPicked((p) => sel ? p.filter((x) => x !== k) : p.length < MAX_IMGS ? [...p, k] : p)}>
                      <img src={thumb(im.path, 320)} alt={im.caption || ''} />
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
                  {busy === 'create' ? <span className="spinner" /> : <Icon name="book" />} {busy === 'create' ? 'Creating…' : `Create book (${picked.length}/${MAX_IMGS})`}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  // ---------- book view ----------
  // the cover resolves like the published sheet: book's coverImageId first,
  // then the profile library's first real image
  const coverSrc = imgPath(book.coverImage) || (profile?.images || []).find((i) => i?.path)?.path || '';
  const coverCaption = (profile?.images || []).find((i) => i.path === coverSrc)?.caption || '';
  const bookImgs = (book.images || [])
    .map((ref) => (profile?.images || []).find((i) => i.id === ref || i.path === ref))
    .filter((i) => i?.path);
  const swatches = swatchSpecs(profile);
  const tones = (profile?.tone || []).filter(Boolean);
  const fHead = fontName(profile?.fonts?.heading);
  const fBody = fontName(profile?.fonts?.body);
  const fdStack = fontStack(fHead, "Georgia,'Times New Roman',serif");
  const fbStack = fontStack(fBody, "system-ui,-apple-system,'Segoe UI',Arial,sans-serif");
  const when = new Date(book.createdAt || Date.now());
  const coverDate = when.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }).toUpperCase();
  // a page only exists if it has real content — no empty spreads
  const hasStory = !!(profile?.tagline || profile?.description || profile?.audience || profile?.values?.length);
  const hasTaste = !!profile?.qloo && profile.qloo.mode !== 'error' && profile.qloo.mode !== 'none';
  const pages = [
    { id: 'cover', label: 'Cover' },
    hasStory && { id: 'story', label: 'Story' },
    { id: 'voice', label: 'Voice' },
    swatches.length > 0 && { id: 'palette', label: 'Palette' },
    { id: 'type', label: 'Typography' },
    { id: 'imagery', label: 'Imagery' },
    hasTaste && { id: 'taste', label: 'Taste' },
  ].filter(Boolean);
  const cur = pages[Math.min(page, pages.length - 1)];

  // ←/→ turns pages once the stage has focus (click it or Tab to it);
  // text inputs inside the stage (publish slug) keep their own arrow keys
  const onBookKey = (e) => {
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
    if (e.key === 'ArrowLeft') { e.preventDefault(); setPage((p) => Math.max(0, p - 1)); }
    if (e.key === 'ArrowRight') { e.preventDefault(); setPage((p) => Math.min(pages.length - 1, p + 1)); }
  };

  return (
    <div className="section view bb-view">
      <div className="view-head">
        <div className="vh-main">
          <span className="vh-kicker">MARQUE / BOOK</span>
            <h1 className="display">Your Brand Book</h1>
          <p className="sub">A Brand Book generated from your Business Profile.</p>
        </div>
        <div className="vh-side">
          <a className="btn ghost sm" href="/api/brandbook/pdf" target="_blank" rel="noreferrer" title="Opens the print view — Save as PDF from the browser print dialog">
            <Icon name="download" /> Print / PDF
          </a>
          <button className="btn ghost sm" onClick={previewNewTab}>
            <Icon name="eye" /> Preview
          </button>
          <button className="btn ghost sm" onClick={() => { setStep('cover'); setPicked([]); }}>
            <Icon name="refresh" /> Recreate
          </button>
        </div>
      </div>

      <div className="book-stage card hud" tabIndex={0} role="region"
        aria-label="Brand book spreads — focus, then use the arrow keys to turn pages"
        onKeyDown={onBookKey}>
        <div className="book-page">
          {cur.id === 'cover' && (
            <div className="book-cover">
              <div className="cov-top"><span>Brand Book</span><span>Vol. 01 — {coverDate}</span></div>
              {coverSrc ? (
                <figure className="cov-plate">
                  <span className="cov-frame">
                    <img src={thumb(coverSrc, 800)} alt={coverCaption || `${profile?.name || 'Brand'} cover art`} />
                  </span>
                  <figcaption><span>Plate I — Brand mark</span><span>{coverCaption || 'Studio series'}</span></figcaption>
                </figure>
              ) : (
                <figure className="cov-plate">
                  {/* no plate art yet — the frame falls back to the real palette
                      (matching the published sheet), never a gray box */}
                  {swatches.length ? (
                    <span className="cov-frame cov-pal" role="img" aria-label="Cover fallback — brand palette strip">
                      {swatches.map((s) => <i key={s.label + s.hex} style={{ flex: s.w, background: s.hex }} />)}
                    </span>
                  ) : (
                    <span className="cov-frame cov-blank">
                      <Icon name="image" size={24} /><span>No cover art on file</span>
                    </span>
                  )}
                  <figcaption>
                    <span>Plate I — {swatches.length ? 'Palette' : 'Not set'}</span>
                    <span>{swatches.length ? `${swatches.length} colors` : ''}</span>
                  </figcaption>
                  <div className="cov-compose">
                    <button className="btn ghost sm" onClick={composeCover} disabled={busy === 'gen-cover'}>
                      {busy === 'gen-cover' ? <span className="spinner" /> : <Icon name="sparkle" />} Compose cover
                    </button>
                    <span className="cov-compose-note">one studio render, set as Plate I</span>
                  </div>
                  {busy === 'gen-cover' && <div className="gen-note"><span className="spinner" />{coverNote}</div>}
                </figure>
              )}
              <div className="cov-name-row">
                <h2 className="display cov-name">{profile?.name || 'Your brand'}</h2>
                {profile?.tagline && <p className="cov-tag">{profile.tagline}</p>}
              </div>
              <div className="cov-bot"><span>{profile?.name || 'Your brand'}</span><span>Brand book</span><span>© {when.getFullYear()}</span></div>
            </div>
          )}
          {cur.id === 'story' && (
            <div className="page-in">
              <div className="pg-label">Our story</div>
              <h2 className="display bb-h2">{profile?.tagline || profile?.name}</h2>
              <p className="bb-lede">{profile?.description}</p>
              {profile?.audience && <p className="muted small mt16">For {profile.audience}</p>}
              {!!profile?.values?.length && (
                <>
                  <div className="bb-sub">What we value</div>
                  <div className="taglist">{profile.values.map((v) => <span key={v} className="tag">{v}</span>)}</div>
                </>
              )}
            </div>
          )}
          {cur.id === 'voice' && (
            <div className="page-in">
              <div className="pg-label">Voice</div>
              <h2 className="display bb-h2">How we sound</h2>
              <div className="bb-sub">Tone of voice{tones.length ? ` — ${tones.length} register${tones.length === 1 ? '' : 's'}` : ''}</div>
              {tones.length ? (
                <div className="bb-tones">
                  {tones.map((t, i) => <span key={t} className="bb-tone"><b>{pad2(i + 1)}</b>{t}</span>)}
                </div>
              ) : (
                <NotSet>No tone keywords on the profile — add tone of voice on your Business Profile and republish the book.</NotSet>
              )}
              <div className="bb-sub">In one line</div>
              {profile?.tagline ? (
                <blockquote className="bb-quote">“{profile.tagline}”<cite>— {profile?.name || 'the brand'}, tagline</cite></blockquote>
              ) : (
                <NotSet>No tagline on the profile — the one-line voice sample lands here once set.</NotSet>
              )}
            </div>
          )}
          {cur.id === 'palette' && (
            <div className="page-in">
              <div className="pg-label">Palette</div>
              <h2 className="display bb-h2">The palette</h2>
              <div className="bb-sub">How the palette splits</div>
              <div className="pal-bar" role="img"
                aria-label={`Palette proportions — ${swatches.map((s) => s.label).join(', ')}`}>
                {swatches.map((s) => (
                  <span key={s.label + s.hex} style={{ flex: s.w, background: s.hex }} title={`${s.label} ${s.hex}`} />
                ))}
              </div>
              <div className="pal-specs">
                {swatches.map(({ label, hex, role }) => (
                  <div className="pal-spec" key={label + hex}>
                    <span className={`pal-sw${lightHex(hex) ? ' sw-light' : ''}`} style={{ background: hex }}><i>{hex}</i></span>
                    <span className="pal-meta"><b>{label}</b><span>{role}</span></span>
                  </div>
                ))}
              </div>
              {book.paletteNote && <p className="muted small mt16">{book.paletteNote}</p>}
            </div>
          )}
          {cur.id === 'type' && (
            <div className="page-in">
              <div className="pg-label">Typography</div>
              <h2 className="display bb-h2">Typefaces</h2>
              {!(fHead || fBody) ? (
                <NotSet>No brand faces on the profile — set heading and body fonts on your Business Profile.</NotSet>
              ) : (
                <>
                  <div className="bb-faces">
                    <div className="bb-face">
                      <div className="bb-face-k"><span>Display face</span><span>{fHead || 'not set'}</span></div>
                      {fHead ? (
                        <>
                          <div className="bb-face-aa" style={{ fontFamily: fdStack }}>Aa</div>
                          <p className="bb-face-pg" style={{ fontFamily: fdStack }}>The quick brown fox jumps over the lazy dog — 0123456789</p>
                        </>
                      ) : <NotSet>Falls back to the serif stack until a display face is set.</NotSet>}
                    </div>
                    <div className="bb-face">
                      <div className="bb-face-k"><span>Text face</span><span>{fBody || 'not set'}</span></div>
                      {fBody ? (
                        <>
                          <div className="bb-face-aa" style={{ fontFamily: fbStack }}>Aa</div>
                          <p className="bb-face-pg" style={{ fontFamily: fbStack }}>Pack my box with five dozen liquor jugs — the quick brown fox jumps over the lazy dog. 0123456789</p>
                        </>
                      ) : <NotSet>Falls back to the system sans until a text face is set.</NotSet>}
                    </div>
                  </div>
                  <div className="bb-sub">Scale in use</div>
                  <div className="bb-ladder">
                    <div className="bb-lrow"><span className="bb-lk">Display — 48</span><span className="bb-ls" style={{ fontFamily: fdStack, fontSize: 'clamp(1.6rem,4.6vw,3rem)' }}>Headlines lead</span></div>
                    <div className="bb-lrow"><span className="bb-lk">Title — 28</span><span className="bb-ls" style={{ fontFamily: fdStack, fontSize: '1.5rem' }}>Sections breathe</span></div>
                    <div className="bb-lrow"><span className="bb-lk">Body — 16</span><span className="bb-ls" style={{ fontFamily: fbStack, fontSize: '1rem' }}>Long-form copy stays quiet and readable.</span></div>
                    <div className="bb-lrow"><span className="bb-lk">Caption — 11</span><span className="bb-ls bb-lcap">Labels &amp; captions track wide</span></div>
                  </div>
                </>
              )}
            </div>
          )}
          {cur.id === 'imagery' && (
            <div className="page-in">
              <div className="pg-label">Imagery{bookImgs.length ? ` · ${bookImgs.length}` : ''}</div>
              <div className="book-imgs">
                {bookImgs.map((im, i) => (
                  <figure key={im.id || im.path} className="media-tile bb-fig">
                    <img src={thumb(im.path, 560)} alt={im.caption || `Book image ${i + 1}`} />
                    <figcaption>FIG. {pad2(i + 1)}{im.caption ? ` — ${im.caption}` : ''}</figcaption>
                  </figure>
                ))}
                {!bookImgs.length && (
                  <div className="empty" style={{ padding: '30px 10px', gridColumn: '1 / -1' }}>
                    <p>No imagery recorded on this book — images land here after onboarding scrapes your site.</p>
                  </div>
                )}
              </div>
            </div>
          )}
          {cur.id === 'taste' && (
            <div className="page-in" style={profile?.qloo ? { padding: 0 } : undefined}>
              {profile?.qloo ? <TastePanel bundle={profile.qloo} /> : (
                <div className="page-in"><div className="pg-label">Taste signature</div>
                  <p className="muted small">No taste data on this profile yet — enrich your Business Profile and republish the book.</p>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="book-nav" role="navigation" aria-label="Book pages">
          <button className="icon-btn" aria-label="Previous page" disabled={page === 0} onClick={() => setPage((p) => Math.max(0, p - 1))}>←</button>
          <span className="book-dots">
            {pages.map((p, i) => (
              <button key={p.id} className={`book-dot${i === page ? ' on' : ''}`} title={p.label} aria-label={`Go to ${p.label} page`} aria-current={i === page ? 'page' : undefined} onClick={() => setPage(i)} />
            ))}
          </span>
          <span className="book-pageno" aria-live="polite">{pad2(page + 1)} / {pad2(pages.length)}</span>
          <button className="icon-btn" aria-label="Next page" disabled={page >= pages.length - 1} onClick={() => setPage((p) => Math.min(pages.length - 1, p + 1))}>→</button>
        </div>

        <div className="bb-foot">
          <PublishBar
            publishedSlug={book.publishedSlug}
            base="/b/"
            label="this book"
            busy={busy === 'pub'}
            onPublish={publish}
            onUnpublish={unpublish}
          />
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
<section><h2>Palette</h2>${colorList(p).map(({ label, hex }) => `<span class="sw" style="background:${esc(hex)};${lightHex(hex) ? 'color:#1a1a1a;text-shadow:0 1px 2px rgba(255,255,255,.4)' : ''}">${esc(label)} · ${esc(hex)}</span>`).join('')}${book?.paletteNote ? `<p class="muted">${esc(book.paletteNote)}</p>` : ''}</section>
<section><h2>Typography</h2><p class="muted">Heading · ${esc(p.fonts?.heading)}</p><h1 style="font-size:34px">The quick brown fox</h1><p class="muted">Body · ${esc(p.fonts?.body)}</p><p style="font-family:system-ui">The quick brown fox jumps over the lazy dog.</p></section>
<section><h2>Imagery</h2>${imgs.map((s) => `<img class="t" src="${thumb(s, 320)}">`).join('')}</section>
</body></html>`;
}
