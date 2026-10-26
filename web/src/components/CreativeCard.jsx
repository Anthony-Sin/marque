import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Icon from './Icon.jsx';
import { api } from '../api.js';
import { useOverlayFocus, isTopOverlay } from '../focus.js';
import { arCss, cleanNote, downloadAsset, fileExt, isRaster, MediaFallback, providerLabel, thumb } from './Composer.jsx';
import CreativeOverlay from './CreativeOverlay.jsx';
import { exportCreativePNG } from './creativeExport.js';
import { chanLabel } from '../labels.js';
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
  const [pinned, setPinned] = useState(false);   // touch tap reveals the veil actions
  const [delArm, setDelArm] = useState(false);   // two-tap confirm for delete
  const [deling, setDeling] = useState(false);
  const [zoom, setZoom] = useState(false);       // lightbox — image zoom / video playback
  const zoomRef = useRef(null);
  // lightbox takes focus (close button first) and hands it back on close
  useOverlayFocus(zoomRef, zoom);
  // coarse pointers tap to pin the veil; mouse click opens the lightbox
  const COARSE = typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches;

  useEffect(() => {
    if (!zoom) return;
    const onKey = (e) => { if (e.key === 'Escape' && isTopOverlay(zoomRef.current)) setZoom(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [zoom]);

  // promote panel closes on Escape like every other overlay
  useEffect(() => {
    if (!promote) return;
    const onKey = (e) => { if (e.key === 'Escape') setPromote(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [promote]);

  // publish lane — platform connect status + per-platform LLM captions
  const [pubStatus, setPubStatus] = useState(null);
  const [pubCaps, setPubCaps] = useState({});
  useEffect(() => {
    if (!promote || pubStatus) return;
    api.publishStatus().then((r) => setPubStatus(r)).catch(() => setPubStatus({ platforms: {} }));
  }, [promote, pubStatus]);
  const pubOrder = (campaign?.brief?.channels || [])
    .map((c) => String(c).toLowerCase())
    .filter((c) => ['tiktok', 'instagram', 'youtube'].includes(c));
  const loadPubCap = async (pk) => {
    setPubCaps((m) => ({ ...m, [pk]: { status: 'loading' } }));
    try {
      const r = await api.publishCaption(creative, pk, campaign);
      setPubCaps((m) => ({ ...m, [pk]: { status: 'done', text: r.caption } }));
    } catch (e) {
      setPubCaps((m) => ({ ...m, [pk]: { status: 'error', err: e.message } }));
    }
  };
  const copyText = async (text, okMsg) => {
    try { await navigator.clipboard.writeText(text); say(okMsg); }
    catch { say('copy failed — select manually'); }
  };

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
  // hashtags come from real topical material — product, brief words, taste
  // entities — never channel names (#web isn't a thing anyone posts)
  const tagWord = (s) => String(s || '').split(/\s+/).slice(0, 2).map((w) => (w[0] || '').toUpperCase() + w.slice(1)).join('').replace(/[^A-Za-z0-9]/g, '');
  // brief-derived words first, raw taste entities last (they're names, not
  // topics) — placeholder brand name never becomes a literal hashtag
  const tags = [...new Set([
    ...(campaign?.product ? [`#${tagWord(campaign.product)}`] : []),
    ...(profile?.name && profile.name !== 'Your Brand' ? [`#${tagWord(profile.name)}`] : []),
    ...(campaign?.brief?.title || '').split(/\s+/).filter((w) => w.length > 3).slice(0, 3).map((w) => `#${tagWord(w)}`),
    ...(campaign?.qlooSignals || []).slice(0, 2).map((q) => `#${tagWord(q.entity || q)}`),
  ])].filter((t) => t.length > 4 && t.length < 26).slice(0, 4);
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
      if (!video && creative.cleanImage) {
        // composite the overlay into the export — downloads what you see
        await exportCreativePNG(creative, profile, campaign);
      } else {
        const src = video ? creative.videoPath : creative.imagePath;
        await downloadAsset(src, `marque-${creative.id}.${video ? 'mp4' : fileExt(creative.imagePath)}`);
      }
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
          <div className="co-host">
            <img src={thumb(creative.imagePath, 560)} alt={creative.headline || 'creative'} loading="lazy" />
            {creative.cleanImage && <CreativeOverlay creative={creative} profile={profile} />}
          </div>
        ) : (
          <MediaFallback
            seed={campaign?.brief?.title || creative.headline}
            channel={chans[0]}
            monogram={profile?.name || campaign?.brief?.title}
          />
        )}
        {/* the media well's activation is a REAL button layered under the
            badges/veil/promote (z1 < their z2/z3/z6) — nesting controls inside
            a role=button would make them presentational to screen readers */}
        <button type="button" className="cc-hit"
          aria-label={onEdit ? `Edit ${creative.headline || 'creative'}` : video ? `Play ${creative.headline || 'creative'} animation` : `Preview ${creative.headline || 'creative'} media`}
          onClick={() => {
            if (COARSE) { setPinned((p) => !p); return; }
            if (onEdit) onEdit(creative); else setZoom(true);
          }} />
        {video && (
          <button type="button" className="badge-v" onClick={(e) => { e.stopPropagation(); setZoom(true); }}
            title={creative.videoProvider ? `Watch — made with ${providerLabel(creative.videoProvider)}${creative.videoNote ? ` · ${cleanNote(creative.videoNote)}` : ''}` : 'Watch the animated version'}>
            <Icon name="play" size={10} sw={2.4} /><span>watch{creative.videoProvider ? ` · ${providerLabel(creative.videoProvider)}` : ''}</span>
          </button>
        )}
        {!!creative.imageProvider && (
          <span className={`badge-p p-${String(creative.imageProvider).split('-')[0]}`}
            title={`Image made with ${providerLabel(creative.imageProvider)}`}>
            {providerLabel(creative.imageProvider)}
          </span>
        )}
        {(animating || retrying) && (
          <div className="spin-overlay"><div className="spinner" /></div>
        )}
        <div className={`veil${pinned ? ' pin' : ''}`}>
          <div className="veil-bar">
            <button type="button" className="veil-btn" title="Edit copy + layout" onClick={() => onEdit?.(creative)}>
              <Icon name="edit" size={12} /> <span>Edit</span>
            </button>
            {!raster && (
              <button type="button" className={`veil-btn${creative.imageError ? ' failed' : ''}`} title={creative.imageError ? 'Last image attempt failed — try again' : 'Retry image generation'} disabled={retrying} onClick={retryImage}>
                <Icon name="refresh" size={12} /> <span>Retry</span>
              </button>
            )}
            <button type="button" className="veil-btn" title="Promote — caption + tags kit"
              onClick={() => setPromote((p) => !p)}>
              <Icon name="send" size={12} /> <span>{promote ? 'Close' : 'Promote'}</span>
            </button>
            {aspect === '9:16' && (
              <button type="button" className="veil-btn" title="Animate" disabled={animating}
                onClick={() => onAnimate?.(creative)}>
                <Icon name="film" size={12} /> <span>Animate</span>
              </button>
            )}
            <button type="button" className="veil-btn" title={video ? 'Play video' : 'Zoom'} onClick={(e) => { e.stopPropagation(); setZoom(true); }}>
              <Icon name={video ? 'play' : 'eye'} size={12} /> <span>{video ? 'Play' : 'Zoom'}</span>
            </button>
            <button type="button" className="veil-btn" title="Download" disabled={dl} onClick={download}>
              {dl ? <span className="spinner" /> : <Icon name="download" size={12} />} <span>Download</span>
            </button>
            <button type="button" className={`veil-btn${delArm ? ' failed' : ''}`}
              title={delArm ? 'Click again to delete this creative' : 'Delete creative'}
              disabled={deling}
              onClick={async () => {
                if (!delArm) { setDelArm(true); setTimeout(() => setDelArm(false), 2600); return; }
                setDeling(true);
                try { await api.deleteCreative(creative.id); onChanged?.(); }
                catch (e) { say(e.message); }
                setDeling(false); setDelArm(false);
              }}>
              {deling ? <span className="spinner" /> : <Icon name="trash" size={12} />} <span>{delArm ? 'Sure?' : 'Delete'}</span>
            </button>
          </div>
        </div>
        {promote && (
          <div className="promote-panel" onClick={(e) => e.stopPropagation()}>
            <div className="promote-head">
              <span className="promote-label">Publish lane — per platform</span>
              <button type="button" className="x" title="Close kit" aria-label="Close kit" onClick={() => setPromote(false)}>✕</button>
            </div>
            {(pubOrder.length ? pubOrder : ['tiktok', 'instagram', 'youtube']).map((pk) => {
              const ps = pubStatus?.platforms?.[pk];
              const pc = pubCaps[pk];
              return (
                <div className="pub-row" key={pk}>
                  <div className="pub-row-head">
                    <span className="pub-plat">{ps?.label || pk}</span>
                    <span className="pub-aspect">{ps?.aspect || ''}</span>
                    {!!ps?.aspect && aspect !== ps.aspect && (
                      <span className="pub-mismatch"
                        title={`This creative is ${aspect} — ${ps.label || pk} prefers ${ps.aspect}; it will be letterboxed or cropped by the platform`}>
                        creative is {aspect}
                      </span>
                    )}
                    {ps ? (
                      ps.connected
                        ? <span className="pub-conn on">connected</span>
                        : <span className="pub-conn" title={`connect ${ps?.label || pk} in settings to enable posting`}>not connected</span>
                    ) : <span className="pub-conn">status…</span>}
                  </div>
                  <p className="promote-caption">
                    {pc?.status === 'loading' ? 'writing a platform-native caption…'
                      : pc?.status === 'error' ? `caption failed — ${pc.err}`
                      : pc?.text || caption}
                  </p>
                  <div className="pub-acts">
                    <button className="btn ghost sm" onClick={() => copyText(pc?.text || caption, 'Caption copied')}>
                      <Icon name="copy" size={12} /> Copy
                    </button>
                    <button className="btn ghost sm" disabled={dl} onClick={download}>
                      <Icon name="download" size={12} /> Asset
                    </button>
                    {!pc?.text && (
                      <button className="btn ghost sm" disabled={pc?.status === 'loading'} onClick={() => loadPubCap(pk)}>
                        <Icon name="sparkle" size={12} /> {pc?.status === 'loading' ? 'Writing…' : 'Write caption'}
                      </button>
                    )}
                    <button className="btn ghost sm" disabled title={ps?.connected ? 'posting isn’t available yet — use the kit above' : `connect ${ps?.label || pk} in settings to enable posting`}>
                      <Icon name="send" size={12} /> Post
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
      <div className="meta">
        <span className="ttl" title={creative.headline}>{creative.headline || 'Untitled creative'}</span>
        {!!creative.score && (
          <span className="cc-score" title="AI-estimated stopping power — not a measured metric">
            score ~<b>{creative.score}</b>
          </span>
        )}
        {!!creative.imageError && (
          <span className="cc-err">
            image unavailable{retrying ? ' — retrying…' : ' — hit Retry'}
          </span>
        )}

        {/* a labelled button row, not a radiogroup: APG radios would check on
            arrow navigation, and every check is a real PATCH — five stops of
            toggle buttons say exactly what each press does instead */}
        <span className="grade" role="group" aria-label="Grade this creative"
          title={grade ? `Grade ${grade}/5` : 'Not graded'}>
          {[1, 2, 3, 4, 5].map((n) => (
            <button key={n} type="button"
              className={`grade-star${grade >= n ? ' on' : ''}`}
              aria-label={`${n} star${n > 1 ? 's' : ''}`} aria-pressed={grade === n}
              onClick={() => rate(n)}>★</button>
          ))}
        </span>
      </div>
      {zoom && createPortal(
        <div ref={zoomRef} className="lightbox" role="dialog" aria-modal="true" aria-label={video ? 'Animated creative' : 'Creative zoom'} onClick={() => setZoom(false)}>
          <button type="button" className="lightbox-x" aria-label="Close" onClick={() => setZoom(false)}><Icon name="x" size={18} /></button>
          {video ? (
            <div className="lightbox-media" onClick={(e) => e.stopPropagation()}>
              <video src={creative.videoPath} poster={raster ? creative.imagePath : undefined} controls autoPlay loop muted playsInline />
              <div className="lightbox-cap">
                animated · {providerLabel(creative.videoProvider || 'ffmpeg-render')}
                {!!cleanNote(creative.videoNote) && <span className="lightbox-note"> — {cleanNote(creative.videoNote)}</span>}
              </div>
            </div>
          ) : raster ? (
            <img className="lightbox-media" src={creative.imagePath} alt={creative.headline || 'creative'} onClick={(e) => e.stopPropagation()} />
          ) : (
            <div className="lightbox-cap">No image stored for this creative{creative.imageError ? ` — ${cleanNote(creative.imageError)}` : ''}</div>
          )}
        </div>, document.body)}
    </div>
  );
}
