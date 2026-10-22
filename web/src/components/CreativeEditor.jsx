import React, { useState } from 'react';
import { api, pollJob } from '../api.js';
import { useApp } from '../App.jsx';
import Icon from './Icon.jsx';
import { QlooBadge, SignalChips } from './Qloo.jsx';
import EvidenceDrawer from './EvidenceDrawer.jsx';
import { downloadAsset } from './Composer.jsx';
import '../views/studio.css';

// Creative editor modal: image preview + headline/body/CTA + image regen,
// layout fix, animate (9:16), download, and the Qloo signals panel.
export default function CreativeEditor({ creative, campaign, onClose, onSaved }) {
  const { say, status } = useApp();
  const [cur, setCur] = useState(creative);
  const [headline, setHeadline] = useState(creative.headline || '');
  const [body, setBody] = useState(creative.body || '');
  const [cta, setCta] = useState(creative.cta || '');
  const [regenPrompt, setRegenPrompt] = useState('');
  const [busy, setBusy] = useState('');           // 'save' | 'regen' | 'fix' | 'anim'
  const [evi, setEvi] = useState(false);
  const [media, setMedia] = useState('image');    // 'image' | 'video'
  const aspect = campaign?.aspectRatio || '1:1';

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
    const { creative: c } = await api.editCreative(cur.id, { headline, body, cta });
    done(c, 'Creative saved');
  });
  const regen = () => run('regen', async () => {
    const { creative: c } = await api.regenCreativeImage(cur.id, regenPrompt.trim() || undefined);
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
    try {
      const src = media === 'video' && cur.videoPath ? cur.videoPath : cur.imagePath;
      await downloadAsset(src, `marque-${cur.id}${src === cur.videoPath ? '.mp4' : '.png'}`);
    } catch (e) { say(e.message); }
  };

  const signals = [...(cur.qlooSignals || []), ...(campaign?.qlooSignals || [])];
  const showVideo = media === 'video' && cur.videoPath;

  return (
    <div className="modal-veil" onClick={onClose}>
      <div className="modal editor" onClick={(e) => e.stopPropagation()}>
        <div className="row" style={{ justifyContent: 'space-between', marginBottom: 16 }}>
          <h3 style={{ margin: 0, fontSize: 18 }}>Edit creative</h3>
          <div className="row">
            <QlooBadge mode={status?.qloo === 'live' ? 'live' : 'demo'} />
            <button className="icon-btn" onClick={onClose}><Icon name="x" size={16} /></button>
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
                    <span className="muted small">
                      {busy === 'anim' ? 'Animating with Veo — this takes a minute…' : 'Regenerating image…'}
                    </span>
                  </div>
                </div>
              ) : showVideo ? (
                <video src={cur.videoPath} controls autoPlay loop muted />
              ) : (
                <img src={cur.imagePath} alt={headline || 'creative'} />
              )}
            </div>
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
            <label>Regenerate image <span className="muted" style={{ textTransform: 'none' }}>(optional prompt)</span></label>
            <input value={regenPrompt} onChange={(e) => setRegenPrompt(e.target.value)}
              placeholder="e.g. warmer light, outdoors" />

            <div className="editor-actions">
              <button className="btn lime sm" disabled={!!busy} onClick={save}>
                <Icon name="check" /> {busy === 'save' ? 'Saving…' : 'Save'}
              </button>
              <button className="btn sm" disabled={!!busy} onClick={regen}>
                <Icon name="refresh" /> Regenerate image
              </button>
              <button className="btn ghost sm" disabled={!!busy} onClick={fix}>
                <Icon name="layout" /> Fix layout
              </button>
              {aspect === '9:16' && (
                <button className="btn ghost sm" disabled={!!busy} onClick={animate}>
                  <Icon name="film" /> {busy === 'anim' ? 'Animating…' : 'Animate'}
                </button>
              )}
              <button className="btn ghost sm" onClick={download}>
                <Icon name="download" /> Download
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
