import React, { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, pollJob } from '../api.js';
import { useApp } from '../App.jsx';
import Icon from '../components/Icon.jsx';
import Wayfind from '../components/Wayfind.jsx';
import { downloadAsset, fileExt, fmtDate, postJson, useStages } from '../components/Composer.jsx';
import './studio.css';

const GEN_STAGES = ['Setting the scene…', 'Composing your shots…', 'Developing the images…', 'Final touch-ups…'];

// Scene text is sent as the template value — the server maps known keys
// (studio/lifestyle/flat-lay/detail/outdoor) and passes anything else through as prompt text.
const TEMPLATES = [
  { id: 'studio', label: 'Studio · white sweep', scene: 'studio' },
  { id: 'lifestyle-kitchen', label: 'Lifestyle · kitchen', scene: 'in-use lifestyle scene in a bright kitchen, candid editorial feel' },
  { id: 'lifestyle-desk', label: 'Lifestyle · desk', scene: 'lifestyle scene styled on a tidy desk, soft window light' },
  { id: 'outdoor', label: 'Outdoor · golden hour', scene: 'outdoor' },
  { id: 'flat-lay', label: 'Flat lay', scene: 'flat-lay' },
  { id: 'moody-dark', label: 'Moody · dark', scene: 'moody dark backdrop, dramatic low-key lighting' },
];
const MAX_TEMPLATES = 4; // matches the server cap in POST /api/photoshoot

// Small icon-button with a popover menu (action rows on result cards).
function PopBtn({ icon, label, title, items, disabled }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);
  return (
    <span className="pop-wrap">
      <button className="icon-btn" title={title || label} disabled={disabled}
        style={label ? { width: 'auto', padding: '0 10px', gap: 5, fontSize: 12 } : undefined}
        onClick={() => setOpen(!open)}>
        <Icon name={icon} size={15} />{label && <span>{label} ▾</span>}
      </button>
      {open && (
        <>
          <div className="menu-backdrop" onClick={() => setOpen(false)} />
          <div className="menu popover">
            {items.filter(Boolean).map((it, i) =>
              it.sep ? <div key={i} className="menu-sep" />
                : it.title ? <div key={i} className="menu-title">{it.title}</div>
                  : (
                    <button key={i} className={it.danger ? 'danger' : ''}
                      onClick={() => { setOpen(false); it.onClick?.(); }}>
                      {it.label}
                    </button>
                  ))}
          </div>
        </>
      )}
    </span>
  );
}

export default function Photoshoot() {
  const { profile, setProfile, say } = useApp();
  const [mode, setMode] = useState(null);              // 'product' | 'free'
  const [step, setStep] = useState(0);                 // product wizard: 0 pick image, 1 templates
  const [jobs, setJobs] = useState(null);
  const [activeJob, setActiveJob] = useState(null);
  const [busy, setBusy] = useState(false);
  const stageNote = useStages(GEN_STAGES, busy);
  // product flow
  const [inputImage, setInputImage] = useState(null);  // {path, caption}
  const [uploads, setUploads] = useState([]);          // session uploads — shown in the pick-grid
  const [picked, setPicked] = useState([]);            // template ids
  const [custom, setCustom] = useState('');
  const [customOpen, setCustomOpen] = useState(false);
  // free flow
  const [prompt, setPrompt] = useState('');
  const [refImage, setRefImage] = useState(null);
  // per-result state
  const [hidden, setHidden] = useState(new Set());
  const [extras, setExtras] = useState({});            // shootId -> extra result cards (resize output)
  const [vids, setVids] = useState({});                // resultKey -> videoPath
  const [showVid, setShowVid] = useState({});          // resultKey -> bool
  const [editFor, setEditFor] = useState(null);        // resultKey
  const [editPrompt, setEditPrompt] = useState('');
  const [resBusy, setResBusy] = useState('');          // resultKey currently working
  const fileRef = useRef(null);
  const uploadTarget = useRef('input');                // 'input' | 'ref'
  const [searchParams] = useSearchParams();
  const deepLinked = useRef(false);

  // Catalog kebab "Create Photoshoot" hands ?product=<id> — open product mode,
  // preselecting the item's image when it has one.
  useEffect(() => {
    if (deepLinked.current || !profile) return;
    const pid = searchParams.get('product');
    if (!pid) return;
    deepLinked.current = true;
    setMode('product');
    setStep(0);
    const c = (profile.catalog || []).find((x) => x.id === pid);
    if (c?.image) setInputImage({ path: c.image, caption: c.name });
  }, [profile, searchParams]);

  const reload = async () => {
    try {
      const list = (await api.listPhotoshoot()).jobs || [];
      setJobs(list);
      return list;
    } catch (e) { say(e.message); return []; }
  };
  useEffect(() => { reload(); }, []);

  const runAndTrack = async (createCall, doneNote) => {
    setBusy(true);
    try {
      const res = await createCall();
      // POST returns { job: Job, shoot: PhotoshootJob } — job.id ≠ shoot.id;
      // the job result carries { shootId }.
      const out = res.job?.id ? await pollJob(res.job.id, { onTick: () => {} }).catch((e) => { say(e.message); return null; }) : null;
      setActiveJob(res.shoot?.id || out?.shootId || res.job?.id || null);
      await reload();
      say(doneNote || 'Images ready');
    } catch (e) { say(e.message); }
    setBusy(false);
  };

  // ---------- inputs ----------
  const catalogImgs = (profile?.catalog || []).filter((c) => c.image)
    .map((c) => ({ path: c.image, caption: c.name }));
  const profileImgs = (profile?.images || []).filter((i) => i.path).map((i) => ({ path: i.path, caption: i.caption }));
  const sources = mode === 'free' ? [...uploads, ...profileImgs] : [...uploads, ...catalogImgs, ...profileImgs];

  const upload = async (e) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    try {
      const { path } = await api.upload(f);
      const img = { path, caption: f.name };
      setUploads((u) => (u.some((x) => x.path === path) ? u : [img, ...u]));
      if (uploadTarget.current === 'ref') setRefImage(img); else setInputImage(img);
      say('Uploaded');
    } catch (err) { say(err.message); }
  };

  // ---------- flows ----------
  const templates = [
    ...picked.map((id) => TEMPLATES.find((t) => t.id === id)?.scene || id),
    ...(custom.trim() ? [custom.trim()] : []),
  ];
  const generateProduct = () =>
    runAndTrack(() => api.createPhotoshoot({ mode: 'product', inputImage: inputImage.path, templates }));
  const generateFree = () =>
    runAndTrack(() => api.createPhotoshoot({ mode: 'free', prompt: prompt.trim(), inputImage: refImage?.path }));

  const job = (jobs || []).find((j) => j.id === activeJob);

  // ---------- result ops ----------
  const key = (j, r, i) => `${j.id}:${r.id || r.imagePath || i}`;
  // /api/images/:id resolves by registry id OR asset path — the result uid is not
  // the registry id, so pass the path (encoded) for a reliable lookup.
  const imgId = (r) => encodeURIComponent(r.imagePath || r.id || '');
  const putImage = async (r, body) => {
    const res = await fetch(`/api/images/${imgId(r)}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    if (!res.ok) { const e = new Error(`PUT /api/images/:id → ${res.status}`); e.status = res.status; throw e; }
    return res.json();
  };

  const editImage = async (j, r, k) => {
    if (!editPrompt.trim()) return;
    setResBusy(k);
    try {
      const { job: ej } = await api.editPhotoshoot(j.id, { prompt: editPrompt.trim(), imagePath: r.imagePath });
      if (ej?.id) await pollJob(ej.id);
      await reload();
      setEditFor(null); setEditPrompt('');
      say('Edit added to results');
    } catch (e) { say(e.message); }
    setResBusy('');
  };

  const animateImage = async (r, k) => {
    setResBusy(k);
    try {
      const res = await postJson(`/api/images/${imgId(r)}/animate`);
      const j = res.job || res;
      let videoPath = res.videoPath || r.videoPath;
      if (j?.id && j.status !== 'done') {
        const out = await pollJob(j.id).catch((e) => { say(e.message); return null; });
        videoPath = out?.videoPath || out?.result?.videoPath || videoPath;
      }
      if (videoPath) { setVids((v) => ({ ...v, [k]: videoPath })); setShowVid((s) => ({ ...s, [k]: true })); say('Animation ready'); }
      else say('Animation queued — check back shortly');
    } catch (e) { say(e.status === 404 ? 'Animate is not available on this server yet' : e.message); }
    setResBusy('');
  };

  const resizeImage = async (j, r, k, aspect) => {
    setResBusy(k);
    try {
      const res = await postJson(`/api/images/${imgId(r)}/resize`, { aspect });
      // resize returns a detached {image} — show it in this shoot's grid
      if (res?.image?.imagePath) {
        setExtras((x) => ({ ...x, [j.id]: [...(x[j.id] || []), { ...res.image, template: `resized ${aspect}` }] }));
      }
      await reload();
      say('Resized');
    } catch (e) {
      if (e.status === 404) {
        // fallback per contract: ask the editor for an aspect-aware re-compose
        try {
          const { job: ej } = await api.editPhotoshoot(j.id, { prompt: `Recompose this image for a ${aspect} aspect ratio`, imagePath: r.imagePath });
          if (ej?.id) await pollJob(ej.id);
          await reload();
          say('Resized via re-compose');
        } catch (e2) { say(e2.message); }
      } else say(e.message);
    }
    setResBusy('');
  };

  const saveToProfile = async (r) => {
    if (!r?.imagePath) return say('Nothing to save — this shot failed to render');
    try {
      // canonical route: PUT /api/images/:id { target:'profile' }
      const { profile: p } = await putImage(r, { target: 'profile', caption: 'Studio shot' });
      if (p) setProfile(p);
      say('Saved to Business Profile');
    } catch (e) {
      if (e.status !== 404) return say(e.message);
      try {
        const { profile: p } = await api.updateProfile({
          images: [...(profile?.images || []), { id: `img-${Math.random().toString(36).slice(2, 9)}`, path: r.imagePath, caption: 'Studio shot' }],
        });
        if (p) setProfile(p);
        say('Saved to Business Profile');
      } catch (e2) { say(e2.message); }
    }
  };
  const saveAsCatalog = async (r) => {
    if (!r?.imagePath) return say('Nothing to save — this shot failed to render');
    try {
      await putImage(r, { target: 'catalog', name: 'Studio shot' });
      say('Added to catalog');
    } catch (e) {
      if (e.status !== 404) return say(e.message);
      try { await api.addCatalog({ name: 'Studio shot', image: r.imagePath }); say('Added to catalog'); }
      catch (e2) { say(e2.message); }
    }
  };

  // ---------- render ----------
  const header = (
    <div className="page-head">
      <h1 className="display">Photoshoot</h1>
      <p className="sub">Choose a guided template for professional product shots or use our flexible editor to create anything you can imagine.</p>
    </div>
  );

  const resultCard = (j, r, i) => {
    const k = key(j, r, i);
    if (hidden.has(k)) return null;
    const vid = vids[k] || r.videoPath;
    const working = resBusy === k;
    return (
      <div key={k} className="card result-card">
        {showVid[k] && vid ? (
          <video src={vid} controls autoPlay loop muted style={{ width: '100%', aspectRatio: 1, objectFit: 'cover' }} />
        ) : r.imagePath ? (
          <img src={r.imagePath} alt={r.template || 'result'} loading="lazy" />
        ) : (
          <div className="res-fail">
            <Icon name="x" size={18} />
            <span>{r.error ? `render failed — ${r.error}` : 'render failed'}</span>
          </div>
        )}
        {working && <div className="spin-overlay"><div className="spinner" /></div>}
        {vid && (
          <button className="badge-v" style={{ border: 'none', cursor: 'pointer' }}
            onClick={() => setShowVid((s) => ({ ...s, [k]: !s[k] }))}>
            <Icon name="play" size={10} sw={2.4} /> {showVid[k] ? 'image' : 'video'}
          </button>
        )}
        <div className="acts">
          <button className="icon-btn" title="Edit via prompt" onClick={() => { setEditFor(editFor === k ? null : k); setEditPrompt(''); }}>
            <Icon name="edit" size={15} />
          </button>
          <button className="icon-btn" title="Animate" disabled={working} onClick={() => animateImage(r, k)}>
            <Icon name="film" size={15} />
          </button>
          <PopBtn icon="download" title="Download" items={[
            { label: `Image (${fileExt(r.imagePath).toUpperCase()})`, onClick: () => downloadAsset(r.imagePath, `marque-${r.id || 'shot'}.${fileExt(r.imagePath)}`).catch((e) => say(e.message)) },
            ...(vid ? [{ sep: true }, { label: 'Video (MP4)', onClick: () => downloadAsset(vid, `marque-${r.id || 'shot'}.mp4`).catch((e) => say(e.message)) }] : []),
          ]} />
          <PopBtn icon="check" title="Save" items={[
            { label: 'Save to Business Profile', onClick: () => saveToProfile(r) },
            { label: 'Save as catalog item', onClick: () => saveAsCatalog(r) },
          ]} />
          <span className="pop-wrap">
            <PopBtn icon="kebab" title="More" items={[
              { title: 'Resize' },
              ...['1:1', '4:5', '9:16', '16:9'].map((a) => ({ label: `${a}`, onClick: () => resizeImage(j, r, k, a) })),
              { sep: true },
              { label: 'Save to Business Profile', onClick: () => saveToProfile(r) },
              { label: 'Save as catalog item', onClick: () => saveAsCatalog(r) },
              { sep: true },
              { label: 'Hide', danger: true, onClick: () => setHidden((h) => new Set(h).add(k)) },
            ]} />
          </span>
        </div>
        {editFor === k && (
          <div className="edit-row">
            <input
              autoFocus
              value={editPrompt}
              placeholder="Describe the edit…"
              onChange={(e) => setEditPrompt(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && editImage(j, r, k)}
            />
            <button className="icon-btn" title="Generate edit" disabled={working || !editPrompt.trim()}
              onClick={() => editImage(j, r, k)}>
              <Icon name="send" size={15} />
            </button>
          </div>
        )}
        <div className="tpl"><Icon name="sparkle" size={11} /> {r.template || j.mode}</div>
      </div>
    );
  };

  return (
    <div className="section" style={{ paddingBottom: 80 }}>
      <Wayfind />
      {header}
      <input ref={fileRef} type="file" accept="image/*" className="hidden" style={{ display: 'none' }} onChange={upload} />

      {/* mode cards */}
      {!mode && (
        <div className="mode-grid">
          <button className="mode-card" onClick={() => { setMode('product'); setStep(0); }}>
            <span className="ic"><Icon name="bag" size={22} /></span>
            <h4>Create a product photoshoot</h4>
            <p>Choose a product image and templates to get professional shots</p>
          </button>
          <button className="mode-card" onClick={() => setMode('free')}>
            <span className="ic"><Icon name="sparkle" size={22} /></span>
            <h4>Generate or edit an image</h4>
            <p>Describe the image you want with a prompt or edit an existing one</p>
          </button>
        </div>
      )}

      {/* product wizard */}
      {mode === 'product' && (
        <div style={{ maxWidth: 760, margin: '0 auto' }}>
          <button className="btn ghost sm mb16" onClick={() => { setMode(null); setStep(0); setInputImage(null); setPicked([]); setCustom(''); }}>
            ← Back
          </button>
          <div className="step-bar">
            <span className={`step-dot${step === 0 ? ' on' : ''}`}><i>1</i> Product image</span>
            <span className="step-line" />
            <span className={`step-dot${step === 1 ? ' on' : ''}`}><i>2</i> Templates → Generate</span>
          </div>

          {step === 0 && (
            <div className="card pad">
              <h4 style={{ marginTop: 0 }}>Select your product image</h4>
              <p className="muted small">Pick from your catalog or Business Profile assets — or upload a new one. Choose an image that shows one product clearly.</p>
              <div className="pick-grid">
                {sources.map((im) => (
                  <button key={im.path} className={`pick-tile${inputImage?.path === im.path ? ' sel' : ''}`}
                    onClick={() => setInputImage(im)} title={im.caption}>
                    <img src={im.path} alt={im.caption || 'product'} />
                    {im.caption && <span className="cap">{im.caption}</span>}
                  </button>
                ))}
                <button className="pick-tile add" onClick={() => { uploadTarget.current = 'input'; fileRef.current?.click(); }}>
                  <Icon name="upload" size={20} /> Upload
                </button>
              </div>
              {!sources.length && <p className="muted small mt8">No images yet — upload one to continue.</p>}
              <div className="row mt16" style={{ justifyContent: 'flex-end' }}>
                <button className="btn lime" disabled={!inputImage} onClick={() => setStep(1)}>
                  Choose templates →
                </button>
              </div>
            </div>
          )}

          {step === 1 && (
            <div className="card pad">
              <h4 style={{ marginTop: 0 }}>Choose templates</h4>
              <p className="muted small">Select up to {MAX_TEMPLATES} preset or custom templates.</p>
              {inputImage && (
                <div className="row mb16">
                  <span className="media-tile" style={{ width: 64, height: 64 }}><img src={inputImage.path} alt="" /></span>
                  <span className="muted small">{inputImage.caption || 'Selected image'}</span>
                </div>
              )}
              <div className="tpl-grid">
                {TEMPLATES.map((t) => (
                  <button key={t.id}
                    className={`tpl-chip${picked.includes(t.id) ? ' sel' : ''}`}
                    onClick={() => setPicked((p) => p.includes(t.id) ? p.filter((x) => x !== t.id) : p.length < MAX_TEMPLATES ? [...p, t.id] : p)}>
                    {picked.includes(t.id) && <Icon name="check" size={13} sw={2.4} />}{t.label}
                  </button>
                ))}
                {customOpen ? (
                  <span className="tpl-chip custom-input">
                    <input
                      autoFocus
                      value={custom}
                      placeholder="Describe your own style…"
                      onChange={(e) => setCustom(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && setCustomOpen(false)}
                      onBlur={() => !custom.trim() && setCustomOpen(false)}
                    />
                    <button className="icon-btn" style={{ width: 28, height: 28 }} onClick={() => setCustomOpen(false)}>
                      <Icon name="check" size={13} />
                    </button>
                  </span>
                ) : (
                  <button className="tpl-chip" onClick={() => setCustomOpen(true)}>
                    <Icon name="plus" size={14} /> Add your own style
                  </button>
                )}
              </div>
              {custom.trim() && !customOpen && (
                <div className="mt8"><span className="tpl-chip sel">✦ {custom.trim()}</span></div>
              )}
              <div className="row mt24" style={{ justifyContent: 'space-between' }}>
                <button className="btn ghost" onClick={() => setStep(0)}>← Image</button>
                <button className="btn lime" disabled={busy || !templates.length} onClick={generateProduct}>
                  <Icon name="sparkle" /> Generate {templates.length ? `(${templates.length})` : ''}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* free flow */}
      {mode === 'free' && (
        <div style={{ maxWidth: 720, margin: '0 auto' }}>
          <button className="btn ghost sm mb16" onClick={() => { setMode(null); setPrompt(''); setRefImage(null); }}>
            ← Back
          </button>
          <div className="composer">
            <textarea
              value={prompt}
              placeholder="Describe the image you want to create…"
              onChange={(e) => setPrompt(e.target.value)}
            />
            <div className="row">
              {refImage ? (
                <span className="pill has">
                  <img src={refImage.path} alt="" style={{ width: 20, height: 20, borderRadius: 5, objectFit: 'cover' }} />
                  reference
                  <button style={{ background: 'none', border: 'none', color: 'inherit', padding: 0 }} onClick={() => setRefImage(null)}>✕</button>
                </span>
              ) : (
                <span className="pop-wrap">
                  <FreeRefPicker profileImgs={[...uploads, ...profileImgs]} onPick={setRefImage}
                    onUpload={() => { uploadTarget.current = 'ref'; fileRef.current?.click(); }} />
                </span>
              )}
              <span className="grow" />
              <button className="btn lime" disabled={busy || !prompt.trim()} onClick={generateFree}>
                <Icon name="sparkle" /> {busy ? 'Working…' : 'Generate'}
              </button>
            </div>
          </div>
        </div>
      )}

      {busy && (
        <>
          <div className="gen-note"><span className="spinner" />{stageNote}</div>
          <div className="grid c4">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="card result-card">
                <span className="skel" style={{ width: '100%', aspectRatio: 1 }} />
                <div style={{ padding: '10px 12px 14px' }}>
                  <span className="skel skel-line w55" />
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {/* active results — results[] + prompt edits[] + local resize extras */}
      {job && !!allResults(job, extras).length && (
        <>
          <div className="section-label">Results · {job.mode === 'product' ? 'product shoot' : 'free generation'} · {fmtDate(job.createdAt)}</div>
          <div className="grid c4">
            {allResults(job, extras).map((r, i) => resultCard(job, r, i))}
          </div>
        </>
      )}
      {job && !allResults(job, extras).length && !busy && (
        <div className="empty">
          <p>That shoot produced no images.</p>
          <button className="btn ghost sm" onClick={() => { setMode(null); setStep(0); }}>
            <Icon name="sparkle" size={13} /> Try a new shoot
          </button>
        </div>
      )}

      {/* history */}
      {jobs === null && !mode && (
        <div className="grid" style={{ gap: 10, marginTop: 26 }}>
          {[0, 1, 2].map((i) => (
            <div key={i} className="card job-row" style={{ cursor: 'default' }}>
              <span className="skel" style={{ width: 8, height: 8, borderRadius: '50%', flex: '0 0 auto' }} />
              <span className="skel" style={{ width: 34, height: 34, borderRadius: 9, flex: '0 0 auto' }} />
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8 }}>
                <span className="skel skel-line w40" style={{ height: 14 }} />
                <span className="skel skel-line w55" />
              </div>
              <div className="thumbs">
                {[0, 1, 2].map((j) => <span key={j} className="media-tile skel" />)}
              </div>
            </div>
          ))}
        </div>
      )}
      {!!jobs?.length && (
        <>
          <div className="section-label">History</div>
          <div className="grid" style={{ gap: 10 }}>
            {[...jobs].reverse().map((j) => (
              <div key={j.id} className={`card job-row${j.id === activeJob ? ' on' : ''}`} onClick={() => setActiveJob(j.id)}
                role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setActiveJob(j.id); } }}>
                <span className={`status-dot ${j.status || 'done'}`} />
                <Icon name={j.mode === 'product' ? 'bag' : 'sparkle'} size={17} />
                <div>
                  <div style={{ fontSize: 14, fontWeight: 600 }}>
                    {j.mode === 'product' ? 'Product shoot' : (j.prompt || 'Free generation')}
                  </div>
                  <div className="muted small">
                    {fmtDate(j.createdAt)}{j.templates?.length ? ` · ${j.templates.length} templates` : ''} · {(j.results || []).filter((r) => r.imagePath).length} image{(j.results || []).filter((r) => r.imagePath).length === 1 ? '' : 's'}
                  </div>
                </div>
                <div className="thumbs">
                  {(j.results || []).filter((r) => r.imagePath).slice(0, 4).map((r, i) => (
                    <span key={i} className="media-tile"><img src={r.imagePath} alt="" loading="lazy" /></span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
      {jobs !== null && !jobs?.length && !mode && (
        <div className="empty" style={{ paddingTop: 30 }}>
          <p>No photoshoots yet — pick a mode above.</p>
          <button className="btn ghost sm" onClick={() => { setMode('product'); setStep(0); }}>
            <Icon name="bag" size={13} /> Start a product shoot
          </button>
        </div>
      )}
    </div>
  );
}

// Merge a shoot's generated results with prompt edits (stored under edits[])
// and any locally-tracked resize output. Entries with no imagePath are failed
// generations — skip them.
function allResults(job, extras) {
  const res = (job?.results || []).filter((r) => r.imagePath);
  const edits = (job?.edits || []).filter((e) => e.imagePath)
    .map((e) => ({ id: `edit:${e.imagePath}`, imagePath: e.imagePath, template: `edit — ${e.prompt}` }));
  return [...res, ...edits, ...(extras[job?.id] || [])];
}

// Reference-image picker pill for the free-flow composer.
function FreeRefPicker({ profileImgs, onPick, onUpload }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);
  return (
    <>
      <button type="button" className="pill" onClick={() => setOpen(!open)}>
        <Icon name="image" /> Reference image <span className="caret">▾</span>
      </button>
      {open && (
        <>
          <div className="menu-backdrop" onClick={() => setOpen(false)} />
          <div className="menu popover" style={{ minWidth: 238 }}>
            <div className="menu-title">Optional reference</div>
            {!!profileImgs.length && (
              <div className="img-pick">
                {profileImgs.map((im) => (
                  <button key={im.path} onClick={() => { onPick(im); setOpen(false); }}>
                    <img src={im.path} alt={im.caption || ''} />
                  </button>
                ))}
              </div>
            )}
            <button onClick={() => { setOpen(false); onUpload(); }}>Upload an image…</button>
          </div>
        </>
      )}
    </>
  );
}
