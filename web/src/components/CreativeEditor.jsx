import React, { useEffect, useRef, useState } from 'react';
import { api, pollJob } from '../api.js';
import { useApp } from '../App.jsx';
import Icon from './Icon.jsx';
import { QlooBadge, SignalChips } from './Qloo.jsx';
import EvidenceDrawer from './EvidenceDrawer.jsx';
import { downloadAsset, fileExt, useStages, providerLabel, cleanNote, isRaster } from './Composer.jsx';
import CreativeOverlay, { OVERLAY_STYLES } from './CreativeOverlay.jsx';
import { exportCreativePNG, renderCreativePNG } from './creativeExport.js';
import { useOverlayFocus, isTopOverlay } from '../focus.js';
import { cleanErr } from '../labels.js';
import '../views/studio.css';

// image-registry ops aren't wrapped by api.js — same shape as api.req, and
// like it we surface the server's {error} detail so failures read honestly
// ('image not found → 404'), not as a bare status dump.
async function imgOp(pathname, body) {
  const r = await fetch(pathname, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {}),
  });
  if (!r.ok) {
    let detail = '';
    try { detail = (await r.json()).error || ''; } catch { /* non-json body */ }
    const e = new Error(detail ? cleanErr(detail, 160) : `the request failed → ${r.status}`);
    e.status = r.status;
    e.debug = detail ? `${detail} → ${r.status}` : undefined;
    throw e;
  }
  const ct = r.headers.get('content-type') || '';
  return ct.includes('json') ? r.json() : r;
}

const ANIM_STAGES = ['Animating the creative — this takes a minute…', 'Directing the motion…', 'Rendering frames…', 'Polishing the cut…'];
const REGEN_STAGES = ['Regenerating image…', 'Recomposing the scene…', 'Finishing the render…'];
const REFRAME_STAGES = ['Reframing the creative…', 'Extending the scene…', 'Finishing the render…'];
// aspects the resize route accepts — a wider set than campaign creation offers
const RESIZE_ARS = ['1:1', '4:5', '9:16', '16:9', '3:4', '4:3'];
// busy keys that cover the preview with the spinner + stage note
const PREVIEW_BUSY = new Set(['regen', 'anim', 'reframe', 'animv']);

// Creative editor modal: image preview + headline/body/CTA + image regen,
// reframe (img2img aspect variants), layout fix, animate, download, and the
// Qloo signals panel.
export default function CreativeEditor({ creative, campaign, onClose, onSaved }) {
  const { say, status, profile } = useApp();
  const [cur, setCur] = useState(creative);
  const [headline, setHeadline] = useState(creative.headline || '');
  const [body, setBody] = useState(creative.body || '');
  const [cta, setCta] = useState(creative.cta || '');
  const [ovlStyle, setOvlStyle] = useState(creative.overlayStyle || 'performance');
  const [regenPrompt, setRegenPrompt] = useState('');
  const [regenProvider, setRegenProvider] = useState('auto');
  const [busy, setBusy] = useState('');           // 'save' | 'regen' | 'fix' | 'anim' | 'reframe' | 'animv' | 'kit'
  const [dl, setDl] = useState(false);
  const [evi, setEvi] = useState(false);
  const [chrome, setChrome] = useState(true);     // IG story chrome preview
  const [media, setMedia] = useState('image');    // 'image' | 'video'
  const [err, setErr] = useState('');             // inline error under the actions
  const [reframeAr, setReframeAr] = useState(''); // picked target aspect
  // reframe/motion results — real registry assets, but not persisted onto the
  // creative (no route writes creative.imagePath); chips re-preview them here
  const [variants, setVariants] = useState([]);   // {id, kind:'image'|'video', src, ar, provider, of?, at}
  const [sel, setSel] = useState(null);           // variant id in view — null = the creative's own image
  const stageSet = busy === 'anim' || busy === 'animv' ? ANIM_STAGES : busy === 'reframe' ? REFRAME_STAGES : REGEN_STAGES;
  const stageNote = useStages(stageSet, PREVIEW_BUSY.has(busy));
  const aspect = campaign?.aspectRatio || '1:1';
  const boxRef = useRef(null);
  // dialog focus: first control inside on open, back to the card on close
  useOverlayFocus(boxRef);

  // Escape closes the editor — but let the evidence drawer take the key first.
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape' && !evi && isTopOverlay(boxRef.current)) onClose?.(); };
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
    setErr('');
    try { await fn(); } catch (e) { setErr(e.message); say(e.message); }
    setBusy('');
  };

  const save = () => run('save', async () => {
    const { creative: c } = await api.editCreative(cur.id, { headline, body, cta, overlayStyle: ovlStyle });
    done(c, 'Creative saved');
  });
  const regen = () => run('regen', async () => {
    const { creative: c } = await api.regenCreativeImage(cur.id, regenPrompt.trim() || undefined, regenProvider === 'auto' ? undefined : regenProvider);
    c.imageAt = new Date().toISOString();   // 'rendered just now' stamp — the server doesn't return one
    done(c, 'Image regenerated');
    setMedia('image');
    setSel(null);                            // fresh render — the original chip leads again
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

  // ---------- reframe variants (session strip — assets persist, chips don't) ----------
  // the resize route resolves an image registry id OR an /assets/ basename
  const canReframe = /^\/assets\/[\w.-]+$/i.test(cur.imagePath || '');
  const selV = variants.find((v) => v.id === sel) || null;
  // roving tab stop for the resize radiogroup — the checked segment owns it,
  // else the first aspect the campaign's own (disabled) format doesn't block
  const roveAr = reframeAr || RESIZE_ARS.find((a) => a !== aspect);
  const reframe = () => run('reframe', async () => {
    const base = String(cur.imagePath).split('/').pop();
    const { image } = await imgOp(`/api/images/${encodeURIComponent(base)}/resize`, { aspect: reframeAr });
    const v = { id: image.id, kind: 'image', src: image.imagePath, ar: reframeAr, provider: image.provider, at: new Date().toISOString() };
    // one chip per target AR — re-running the same AR replaces the earlier take
    // (the previous asset itself stays in the registry)
    setVariants((vs) => [...vs.filter((x) => !(x.kind === 'image' && x.ar === v.ar)), v]);
    setSel(v.id);
    setMedia('image');
    setReframeAr('');
    say(`Reframed to ${v.ar} — saved to assets`);
  });
  // resize radiogroup keys — ←/→ (plus ↑/↓/Home/End) carry both focus and the
  // checked state through the aspects, skipping the campaign's own format
  // which stays disabled (radio-group "selection follows focus" behavior)
  const pickAr = (e) => {
    const avail = RESIZE_ARS.filter((a) => a !== aspect);
    if (!avail.length) return;
    const dir = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
    let next;
    if (dir) {
      const i = avail.indexOf(reframeAr);
      next = avail[i === -1 ? (dir > 0 ? 0 : avail.length - 1) : (i + dir + avail.length) % avail.length];
    } else if (e.key === 'Home') next = avail[0];
    else if (e.key === 'End') next = avail[avail.length - 1];
    else return;
    e.preventDefault();
    setReframeAr(next);
    e.currentTarget.parentElement?.querySelector(`[data-ar="${next}"]`)?.focus();
  };
  // image animate → 9:16 motion render. Unlike the creative route this can't
  // attach the clip to the creative — it lands in the asset library, honest.
  const animateVariant = (v) => run('animv', async () => {
    const { job } = await imgOp(`/api/images/${encodeURIComponent(v.id)}/animate`, {});
    const res = await pollJob(job.id);
    if (!res?.videoPath) throw new Error('motion job finished without a file');
    const mv = { id: `mv-${v.id}`, kind: 'video', src: res.videoPath, ar: '9:16', provider: res.provider, of: v.id, at: new Date().toISOString() };
    setVariants((vs) => [...vs.filter((x) => x.id !== mv.id), mv]);
    setSel(mv.id);
    say('Motion render ready — saved to assets');
  });
  const kit = (v) => run('kit', async () => {
    await api.promoteImage(v.id, { name: `Reframe ${v.ar || ''}`.trim(), caption: cur.headline || campaign?.brief?.title || '' });
    say('Saved to brand kit — usable as an ingredient');
  });
  // composite the creative's copy onto the reframed image at the variant's own
  // aspect — the honest "use this" (no route writes creative.imagePath)
  const exportVariant = async (v) => {
    if (dl) return;
    setDl(true);
    try {
      const cv = await renderCreativePNG({ ...cur, headline, body, cta, overlayStyle: ovlStyle, imagePath: v.src }, profile, campaign, v.ar || aspect);
      const blob = await new Promise((r) => cv.toBlob(r, 'image/png'));
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `marque-${cur.id}-${String(v.ar || aspect).replace(':', 'x')}.png`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    } catch (e) { setErr(e.message); say(e.message); }
    setDl(false);
  };

  const download = async () => {
    if (dl) return;
    if (media === 'image' && selV?.kind === 'image') return exportVariant(selV);
    setDl(true);
    try {
      if (media === 'image' && selV?.kind === 'video') {
        await downloadAsset(selV.src, `marque-${cur.id}-motion.mp4`);
      } else if (media === 'image' && (cur.cleanImage || /\.(png|jpe?g|webp)$/i.test(cur.imagePath || ''))) {
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
  // what the preview frame is actually showing right now
  const viewSrc = selV?.kind === 'image' ? selV.src : cur.imagePath;
  const viewRaster = selV ? isRaster(selV.src) : !!(cur.cleanImage || /\.(png|jpe?g|webp)$/i.test(cur.imagePath || ''));

  // footer microline — honest render provenance: which engine produced the
  // media currently in view (raw engine tag kept when it carries the model id)
  // plus the best timestamp on record. Regens stamp `imageAt` client-side;
  // campaign-born creatives fall back to the campaign's own creation time.
  const ago = (d) => {
    const ms = Date.now() - new Date(d).getTime();
    if (!isFinite(ms) || ms < 0) return '';
    const m = Math.floor(ms / 60000);
    if (m < 1) return 'just now';
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    return h < 24 ? `${h}h ago` : `${Math.floor(h / 24)}d ago`;
  };
  const prov = showVideo ? cur.videoProvider : selV ? selV.provider : cur.imageProvider;
  const stamp = selV?.at || cur.imageAt || cur.createdAt || campaign?.createdAt;
  const micro = [
    selV ? (selV.kind === 'video' ? 'motion variant' : `reframe ${selV.ar}`) : '',
    prov ? providerLabel(prov) : 'engine unrecorded',
    prov && String(prov).includes('-') ? String(prov) : '',
    ago(stamp),
  ].filter(Boolean).join(' · ');

  return (
    <div className="modal-veil" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={boxRef} className="modal editor" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Edit creative">
        <div className="row" style={{ justifyContent: 'space-between', marginBottom: 16 }}>
          <h3 style={{ margin: 0, fontSize: 18 }}>Edit creative</h3>
          <div className="row">
            <QlooBadge mode={status?.qloo === 'live' ? 'live' : 'off'} label="Audience data" />
            <button className="icon-btn" onClick={onClose} aria-label="Close"><Icon name="x" size={16} /></button>
          </div>
        </div>
        <div className="editor-grid">
          <div>
            {cur.videoPath && (
              <div className="seg-tabs mb8" role="group" aria-label="Preview media">
                <button type="button" className={media === 'image' ? 'on' : ''} aria-pressed={media === 'image'}
                  aria-label="Image preview" onClick={() => setMedia('image')}>Image</button>
                <button type="button" className={media === 'video' ? 'on' : ''} aria-pressed={media === 'video'}
                  aria-label="Animation preview" onClick={() => { setMedia('video'); setSel(null); }}>Animation</button>
              </div>
            )}
            <div className="editor-preview">
              {PREVIEW_BUSY.has(busy) ? (
                <div className="spin-overlay" style={{ position: 'static' }}>
                  <div className="row" style={{ flexDirection: 'column', gap: 12 }}>
                    <div className="spinner" />
                    <span className="muted small">{stageNote}</span>
                  </div>
                </div>
              ) : showVideo ? (
                <video src={cur.videoPath} controls autoPlay loop muted />
              ) : selV?.kind === 'video' ? (
                <video key={selV.src} src={selV.src} controls autoPlay loop muted />
              ) : (
                <div className="co-host" style={{ borderRadius: 14 }}>
                  <img src={viewSrc} alt={headline || 'creative'} />
                  {viewRaster && (
                    <CreativeOverlay creative={{ ...cur, headline, body, cta, overlayStyle: ovlStyle }} profile={profile} chrome={chrome && aspect === '9:16' && !selV} />
                  )}
                </div>
              )}
            </div>
            {(cur.cleanImage || /\.(png|jpe?g|webp)$/i.test(cur.imagePath || '')) && aspect === '9:16' && !showVideo && !selV && (
              <label className="row mt8 small" style={{ gap: 7, cursor: 'pointer' }}>
                <input type="checkbox" checked={chrome} onChange={(e) => setChrome(e.target.checked)} />
                <span className="muted">Platform chrome (story frame)</span>
              </label>
            )}
            {!!variants.length && (
              <div className="mt8">
                <div className="seg-tabs" role="group" aria-label="Reframes and motion renders from this session">
                  <button type="button" className={!sel ? 'on' : ''} aria-pressed={!sel}
                    aria-label={`Original ${aspect} preview`} title={`The creative's own ${aspect} image`}
                    onClick={() => setSel(null)}>{aspect} · original</button>
                  {variants.map((v) => (
                    <button key={v.id} type="button" className={sel === v.id ? 'on' : ''} aria-pressed={sel === v.id}
                      aria-label={v.kind === 'video' ? 'Motion render preview' : `Reframed ${v.ar} preview`}
                      title={v.kind === 'video'
                        ? `Motion render · ${providerLabel(v.provider)} — saved to assets`
                        : `Reframed to ${v.ar} · ${providerLabel(v.provider)} — saved to assets`}
                      onClick={() => { setSel(v.id); setMedia('image'); }}>
                      {v.kind === 'video' ? 'motion' : v.ar} · {providerLabel(v.provider)}
                    </button>
                  ))}
                </div>
                {selV ? (
                  <div className="row mt8" style={{ gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                    {selV.kind === 'image' ? (
                      <>
                        <button className="btn ghost sm" disabled={!!busy || dl} onClick={() => exportVariant(selV)}
                          title={`Export the creative composited at ${selV.ar} — headline, body + CTA drawn on`}>
                          <Icon name="download" size={13} /> Export {selV.ar}
                        </button>
                        <button className="btn ghost sm" disabled={!!busy} onClick={() => animateVariant(selV)}
                          title="Render a 9:16 motion cut from this frame — saved to assets">
                          {busy === 'animv' ? <span className="spinner" /> : <Icon name="film" size={13} />} Motion
                        </button>
                        <button className="btn ghost sm" disabled={!!busy} onClick={() => kit(selV)}
                          title="Promote into profile images — reusable as a generation ingredient">
                          {busy === 'kit' ? <span className="spinner" /> : <Icon name="book" size={13} />} Brand kit
                        </button>
                      </>
                    ) : (
                      <button className="btn ghost sm" onClick={() => downloadAsset(selV.src, `marque-${cur.id}-motion.mp4`).catch((e) => say(e.message))}>
                        <Icon name="download" size={13} /> Download motion
                      </button>
                    )}
                    <span className="muted small">variant — saved to assets; the creative stays {aspect}</span>
                  </div>
                ) : (
                  <p className="muted small mt8" style={{ marginBottom: 0 }}>Session variants — saved to your asset library; the creative keeps the campaign format ({aspect}).</p>
                )}
              </div>
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
              {['auto', 'local', 'gemini', 'pollinations'].map((id) => {
                // gate chips on engines we know are down — never offer a dead engine
                const offline = id === 'local'
                  ? !!status && (status.localgen?.ok === false || !status.localgen?.configured)
                  : id === 'gemini' ? !!status && !status.gemini : false;
                const tip = id === 'auto'
                  ? (cur.imageProvider ? `Last rendered by ${providerLabel(cur.imageProvider)}` : 'Default chain — picks the best available engine')
                  : offline ? (id === 'local' ? 'local engine offline' : 'cloud engine not configured')
                  : `Force ${providerLabel(id)} for the next regen`;
                return (
                  <button key={id} type="button" disabled={offline}
                    className={`ovl-st${regenProvider === id ? ' on' : ''}`}
                    title={tip}
                    onClick={() => !offline && setRegenProvider(id)}>{providerLabel(id)}</button>
                );
              })}
            </div>
            {!!cur.imagePath && (
              <>
                <label id="reframe-ar-lbl">Reframe <span className="muted" style={{ textTransform: 'none' }}>(img2img — extends the scene)</span></label>
                <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                  <div className="seg-tabs" role="radiogroup" aria-labelledby="reframe-ar-lbl">
                    {RESIZE_ARS.map((a) => (
                      <button key={a} type="button" role="radio" data-ar={a}
                        className={reframeAr === a ? 'on' : ''}
                        aria-checked={reframeAr === a}
                        tabIndex={a === roveAr ? 0 : -1}
                        disabled={a === aspect || !!busy}
                        style={a === aspect ? { opacity: 0.45, cursor: 'default' } : undefined}
                        title={a === aspect ? 'Current format — the campaign sets this' : `Resize to ${a}`}
                        onClick={() => setReframeAr(a)}
                        onKeyDown={pickAr}>{a}{a === aspect ? ' ·now' : ''}</button>
                    ))}
                  </div>
                  <button className="btn sm" disabled={!!busy || !reframeAr || !canReframe}
                    title={canReframe ? 'img2img reframe — keeps the subject + style' : 'Reframe needs a generated /assets image'}
                    onClick={reframe}>
                    {busy === 'reframe' ? <span className="spinner" /> : <Icon name="aspect" />} {busy === 'reframe' ? 'Reframing…' : 'Reframe'}
                  </button>
                </div>
              </>
            )}

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
              {(aspect === '9:16' || aspect === '16:9') && (
                <button className="btn ghost sm" disabled={!!busy} onClick={animate}
                  title={`Render a ${aspect} motion cut of this creative — attaches to it when done`}>
                  {busy === 'anim' ? <span className="spinner" /> : <Icon name="film" />} {busy === 'anim' ? 'Animating…' : 'Animate'}
                </button>
              )}
              <button className="btn ghost sm" disabled={dl} onClick={download}>
                {dl ? <span className="spinner" /> : <Icon name="download" />} Download
              </button>
            </div>
            {aspect !== '9:16' && aspect !== '16:9' && (
              <p className="muted small mt8">Creative animation renders at 9:16 or 16:9 — reframe to one above, then run Motion on the variant.</p>
            )}
            {!!err && <p className="mt8" role="alert" style={{ color: 'var(--amber, #d4a017)', fontSize: 12 }}>{err}</p>}
          </div>
        </div>
        <div className="ed-micro" title="Render provenance — the engine that made the media in view, and the best timestamp on record">
          <span className="ed-micro-src">{micro}</span>
          <span className="grow" />
          {showVideo && !!cleanNote(cur.videoNote) && <span className="ed-micro-warn">{cleanNote(cur.videoNote)}</span>}
          {!!cur.editedBy && <span>tuned by {cur.editedBy}</span>}
        </div>
      </div>
      {evi && <EvidenceDrawer signals={cur.qlooSignals || []} extra={campaign?.qlooSignals || []} onClose={() => setEvi(false)} />}
    </div>
  );
}
