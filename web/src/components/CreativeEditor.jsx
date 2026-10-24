import React, { useEffect, useState } from 'react';
import { api, pollJob } from '../api.js';
import { useApp } from '../App.jsx';
import Icon from './Icon.jsx';
import { QlooBadge, SignalChips } from './Qloo.jsx';
import EvidenceDrawer from './EvidenceDrawer.jsx';
import { downloadAsset, fileExt, useStages } from './Composer.jsx';
import CreativeOverlay, { OVERLAY_STYLES } from './CreativeOverlay.jsx';
import { exportCreativePNG } from './creativeExport.js';
import '../views/studio.css';

const ANIM_STAGES = ['Animating the creative — this takes a minute…', 'Directing the motion…', 'Rendering frames…', 'Polishing the cut…'];
const REGEN_STAGES = ['Regenerating image…', 'Recomposing the scene…', 'Finishing the render…'];

// Creative editor modal: image preview + headline/body/CTA + image regen,
// layout fix, animate (9:16), download, and the Qloo signals panel.
export default function CreativeEditor({ creative, campaign, onClose, onSaved }) {
  const { say, status, profile } = useApp();
  const [cur, setCur] = useState(creative);
  const [headline, setHeadline] = useState(creative.headline || '');
  const [body, setBody] = useState(creative.body || '');
  const [cta, setCta] = useState(creative.cta || '');
  const [ovlStyle, setOvlStyle] = useState(creative.overlayStyle || 'performance');
  const [regenPrompt, setRegenPrompt] = useState('');
  const [regenProvider, setRegenProvider] = useState('auto');
  const [busy, setBusy] = useState('');           // 'save' | 'regen' | 'fix' | 'anim'
  const [dl, setDl] = useState(false);
  const [evi, setEvi] = useState(false);
  const [chrome, setChrome] = useState(true);     // IG story chrome preview
  const [media, setMedia] = useState('image');    // 'image' | 'video'
  const stageNote = useStages(busy === 'anim' ? ANIM_STAGES : REGEN_STAGES, busy === 'anim' || busy === 'regen');
  const aspect = campaign?.aspectRatio || '1:1';

  // Escape closes the editor — but let the evidence drawer take the key first.
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape' && !evi) onClose?.(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, evi]);

  const done = (c, msg) => {
    setCur(c);
    if (c.headline !== undefined) setHeadline(c.headline ?? '');
    if (c.body !== undefined) setBody(c.body ?? '');
    if (c.cta !== undefined) setCta(c.cta ?? '');
    onSaved?.(c);
    if (msg) say(msg);
  };
  const run = async (key, fn) => {
    setBusy(key);
    try { await fn(); } catch (e) { say(e.message); }
    setBusy('');
  };

  const save = () => run('save', async () => {
    const { creative: c } = await api.editCreative(cur.id, { headline, body, cta, overlayStyle: ovlStyle });
    done(c, 'Creative saved');
  });
  const regen = () => run('regen', async () => {
    const { creative: c } = await api.regenCreativeImage(cur.id, regenPrompt.trim() || undefined, regenProvider === 'auto' ? undefined : regenProvider);
    done(c, 'Image regenerated');
    setMedia('image');
  });
  const fix = () => run('fix', async () => {
    const { creative: c } = await api.fixCreativeLayout(cur.id);
    done(c, 'Layout fixed');
  });
  const animate = () => run('anim', async () => {
    const { job } = await api.animateCreative(cur.id);
    const res = await pollJob(job.id);
    const v = res?.videoPath || res?.creative?.videoPath;
    setCur((c) => ({ ...c, videoPath: v || c.videoPath, videoState: 'done' }));
    setMedia('video');
    onSaved?.({ ...cur, videoPath: v });
    say('Animation ready');
  });
  const download = async () => {
    if (dl) return;
    setDl(true);
    try {
      if (media === 'image' && (cur.cleanImage || /\.(png|jpe?g|webp)$/i.test(cur.imagePath || ''))) {
        await exportCreativePNG({ ...cur, headline, body, cta, overlayStyle: ovlStyle }, profile, campaign);
      } else {
        const src = media === 'video' && cur.videoPath ? cur.videoPath : cur.imagePath;
        await downloadAsset(src, `marque-${cur.id}.${src === cur.videoPath ? 'mp4' : fileExt(src)}`);
      }
    } catch (e) { say(e.message); }
    setDl(false);
  };

  const signals = [...(cur.qlooSignals || []), ...(campaign?.qlooSignals || [])];
  const showVideo = media === 'video' && cur.videoPath;

  return (
    <div className="modal-veil" onClick={onClose}>
      <div className="modal editor" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Edit creative">
        <div className="row" style={{ justifyContent: 'space-between', marginBottom: 16 }}>
          <h3 style={{ margin: 0, fontSize: 18 }}>Edit creative</h3>
          <div className="row">
            <QlooBadge mode={status?.qloo === 'live' ? 'live' : 'off'} label="Qloo API" />
            <button className="icon-btn" onClick={onClose} aria-label="Close"><Icon name="x" size={16} /></button>
          </div>
        </div>
        <div className="editor-grid">
          <div>
            {cur.videoPath && (
              <div className="seg-tabs mb8">
                <button className={media === 'image' ? 'on' : ''} onClick={() => setMedia('image')}>Image</button>
                <button className={media === 'video' ? 'on' : ''} onClick={() => setMedia('video')}>Animation</button>
              </div>
            )}
            <div className="editor-preview">
              {busy === 'regen' || busy === 'anim' ? (
                <div className="spin-overlay" style={{ position: 'static' }}>
                  <div className="row" style={{ flexDirection: 'column', gap: 12 }}>
                    <div className="spinner" />
                    <span className="muted small">{stageNote}</span>
                  </div>
                </div>
              ) : showVideo ? (
                <video src={cur.videoPath} controls autoPlay loop muted />
              ) : (
                <div className="co-host" style={{ borderRadius: 14 }}>
                  <img src={cur.imagePath} alt={headline || 'creative'} />
                  {(cur.cleanImage || /\.(png|jpe?g|webp)$/i.test(cur.imagePath || '')) && (
                    <CreativeOverlay creative={{ ...cur, headline, body, cta, overlayStyle: ovlStyle }} profile={profile} chrome={chrome && aspect === '9:16'} />
                  )}
                </div>
              )}
            </div>
            {(cur.cleanImage || /\.(png|jpe?g|webp)$/i.test(cur.imagePath || '')) && aspect === '9:16' && !showVideo && (
              <label className="row mt8 small" style={{ gap: 7, cursor: 'pointer' }}>
                <input type="checkbox" checked={chrome} onChange={(e) => setChrome(e.target.checked)} />
                <span className="muted">Platform chrome (story frame)</span>
              </label>
            )}
            <div className="mt8">
              <SignalChips signals={signals} max={6} />
              {!signals.length && <span className="muted small">No signals recorded on this creative.</span>}
              <div className="mt8">
                <button className="btn ghost sm" onClick={() => setEvi(true)}>
                  <Icon name="qloo" size={14} /> Evidence
                </button>
              </div>
            </div>
          </div>

          <div className="editor-side">
            <label>Headline</label>
            <input value={headline} onChange={(e) => setHeadline(e.target.value)} placeholder="Headline" />
            <label>Description</label>
            <textarea value={body} onChange={(e) => setBody(e.target.value)} placeholder="Body copy" />
            <label>Call to action</label>
            <input value={cta} onChange={(e) => setCta(e.target.value)} placeholder="Shop now" />
            <label>Overlay style</label>
            <div className="ovl-styles">
              {OVERLAY_STYLES.map((st) => (
                <button key={st.id} type="button" title={st.hint}
                  className={`ovl-st${ovlStyle === st.id ? ' on' : ''}`}
                  onClick={() => setOvlStyle(st.id)}>{st.name}</button>
              ))}
            </div>
            <label>Regenerate image <span className="muted" style={{ textTransform: 'none' }}>(optional prompt)</span></label>
            <input value={regenPrompt} onChange={(e) => setRegenPrompt(e.target.value)}
              placeholder="e.g. warmer light, outdoors" />
            <div className="ovl-styles" style={{ marginTop: 6 }}>
              {[['auto', 'Engine: auto'], ['local', 'Local'], ['gemini', 'Gemini'], ['pollinations', 'Pollinations']].map(([id, name]) => (
                <button key={id} type="button"
                  className={`ovl-st${regenProvider === id ? ' on' : ''}`}
                  title={id === 'auto' ? `Default chain (${cur.imageProvider || 'auto'} used last)` : `Force ${name} for the next regen`}
                  onClick={() => setRegenProvider(id)}>{name}</button>
              ))}
            </div>

            <div className="editor-actions">
              <button className="btn lime sm" disabled={!!busy} onClick={save}>
                {busy === 'save' ? <span className="spinner" /> : <Icon name="check" />} {busy === 'save' ? 'Saving…' : 'Save'}
              </button>
              <button className="btn sm" disabled={!!busy} onClick={regen}>
                {busy === 'regen' ? <span className="spinner" /> : <Icon name="refresh" />} Regenerate image
              </button>
              <button className="btn ghost sm" disabled={!!busy} onClick={fix}>
                {busy === 'fix' ? <span className="spinner" /> : <Icon name="layout" />} Fix layout
              </button>
              {aspect === '9:16' && (
                <button className="btn ghost sm" disabled={!!busy} onClick={animate}>
                  {busy === 'anim' ? <span className="spinner" /> : <Icon name="film" />} {busy === 'anim' ? 'Animating…' : 'Animate'}
                </button>
              )}
              <button className="btn ghost sm" disabled={dl} onClick={download}>
                {dl ? <span className="spinner" /> : <Icon name="download" />} Download
              </button>
            </div>
            {aspect !== '9:16' && (
              <p className="muted small mt8">Animation is available on 9:16 creatives only.</p>
            )}
          </div>
        </div>
      </div>
      {evi && <EvidenceDrawer signals={cur.qlooSignals || []} extra={campaign?.qlooSignals || []} onClose={() => setEvi(false)} />}
    </div>
  );
}
