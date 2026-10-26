import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import api, { pollJob } from '../api.js';
import { useApp } from '../App.jsx';
import { useOverlayFocus } from '../focus.js';
import Icon from '../components/Icon.jsx';
import { thumb, providerLabel, downloadAsset, fmtDate } from '../components/Composer.jsx';
import { cleanErr } from '../labels.js';
import './photoshoot.css';

// Scene presets — mirrors server tuning.json `shootTemplates`. The POST also
// accepts free-form scene strings, so this picker is a convenience, not a fence.
const PRESETS = ['studio', 'lifestyle', 'flat-lay', 'detail', 'outdoor'];
const MAX_SHOTS = 4;

const base = (p) => String(p || '').split('/').pop();
const renders = (j) => [...(j.results || []), ...(j.edits || [])].filter((r) => r?.imagePath);
// `status` is newer than some records — pre-status jobs all ran to completion
// before the field existed, so a missing status reads 'done', never 'running'.
const jobStatus = (j) => (j?.status === 'running' || j?.status === 'error' ? j.status : 'done');

function relTime(iso) {
  const t = new Date(iso).getTime();
  if (!t || Number.isNaN(t)) return '—';
  const s = Math.max(0, (Date.now() - t) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

const fullTime = (iso) => {
  const t = new Date(iso);
  return Number.isNaN(t.getTime()) ? '—'
    : `${fmtDate(iso)} · ${t.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`;
};

/* ---------- inline launch form ---------- */
function ShootForm({ profile, busy, onLaunch, onClose }) {
  const [prompt, setPrompt] = useState('');
  const [shots, setShots] = useState(2);
  const [picked, setPicked] = useState(['studio', 'lifestyle']);
  const [src, setSrc] = useState(null); // /assets/... → product mode
  const lib = (profile?.images || []).filter((i) => i?.path).slice(0, 8);

  const togglePreset = (p) =>
    setPicked((cur) => (cur.includes(p) ? cur.filter((x) => x !== p) : [...cur, p].slice(0, MAX_SHOTS)));

  // shots = templates sent; unpicked slots fill from the preset order
  const templates = useMemo(() => {
    const out = picked.slice(0, shots);
    for (const p of PRESETS) if (out.length < shots && !out.includes(p)) out.push(p);
    return out.slice(0, MAX_SHOTS);
  }, [picked, shots]);

  const submit = () => {
    onLaunch({
      mode: src ? 'product' : 'free',
      inputImage: src || undefined,
      prompt: prompt.trim() || undefined,
      templates,
    });
  };

  return (
    <section className="card hud ps-form" aria-label="New photoshoot">
      <div className="zone-head">
        <span className="z-id">NEW</span>New shoot
        <span className="z-tag" title="rendered locally · sdxl-turbo">{providerLabel('local-sdxl-turbo')}</span>
        <button type="button" className="icon-btn sm ps-x" onClick={onClose} aria-label="Close form"><Icon name="x" size={13} /></button>
      </div>
      <div className="ps-form-body">
        <textarea
          className="ps-prompt-in"
          rows={2}
          placeholder={src ? 'Scene direction for this product (optional)…' : 'Describe the scene — "matte amber bottle on wet slate, warm light"…'}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          autoFocus
        />
        <div className="ps-form-row">
          <span className="ps-lab">Shots</span>
          <span className="ps-seg" role="group" aria-label="Shot count">
            {[1, 2, 3, 4].map((n) => (
              <button key={n} type="button" className={shots === n ? 'on' : ''} onClick={() => setShots(n)}>{n}</button>
            ))}
          </span>
          <span className="ps-lab">Scenes</span>
          <span className="ps-tpl-chips">
            {PRESETS.map((p) => (
              <button key={p} type="button"
                className={`ps-tpl${picked.includes(p) ? ' on' : ''}`}
                onClick={() => togglePreset(p)}>{p}</button>
            ))}
          </span>
        </div>
        {!!lib.length && (
          <div className="ps-form-row">
            <span className="ps-lab">Product src</span>
            <span className="ps-src-strip scroll-x-fade">
              <button type="button" className={`ps-src${src ? '' : ' on'}`} onClick={() => setSrc(null)} title="Free scene — no product photo">
                <Icon name="sparkle" size={14} /><i>free</i>
              </button>
              {lib.map((im) => (
                <button key={im.id || im.path} type="button"
                  className={`ps-src${src === im.path ? ' on' : ''}`}
                  title={im.caption || base(im.path)} onClick={() => setSrc(src === im.path ? null : im.path)}>
                  <img src={thumb(im.path, 128)} alt="" loading="lazy" />
                </button>
              ))}
            </span>
          </div>
        )}
        <div className="ps-form-foot">
          <span className="ps-form-note mono">
            {src ? 'PRODUCT MODE' : 'FREE SCENE'} · {templates.length} SHOT{templates.length === 1 ? '' : 'S'} · {templates.join(' / ')}
          </span>
          <button type="button" className="btn lime sm" disabled={busy === 'launch' || (!src && !prompt.trim())} onClick={submit}>
            {busy === 'launch' ? <span className="spinner" /> : <Icon name="photo" size={14} />} Shoot
          </button>
        </div>
      </div>
    </section>
  );
}

/* ---------- one image tile + its actions ---------- */
function ShotTile({ r, onEdit, onKeep, onDl, busy }) {
  const err = !r.imagePath;
  return (
    <figure className={`ps-tile${err ? ' err' : ''}`}>
      {err ? (
        <span className="ps-tile-broken" title={r.error || 'render failed'}>
          <Icon name="x" size={16} />
          <i>{cleanErr(r.error) || 'render failed'}</i>
        </span>
      ) : (
        <img src={thumb(r.imagePath, 480)} alt={r.template || 'shoot render'} loading="lazy" />
      )}
      <figcaption className="ps-tile-meta">
        <span className="ps-tile-name" title={r.template}>{r.template || 'shot'}</span>
        <span className="ps-tile-prov" title={r.provider || 'provider not recorded'}>
          {r.provider ? providerLabel(r.provider) : 'render'}
        </span>
      </figcaption>
      {!err && (
        <span className="ps-tile-acts">
          <button type="button" className="icon-btn sm" title="Download PNG" onClick={() => onDl(r)} disabled={!!busy}>
            <Icon name="download" size={13} />
          </button>
          <button type="button" className="icon-btn sm" title="Edit this render" onClick={() => onEdit(r)} disabled={!!busy}>
            <Icon name="edit" size={13} />
          </button>
          <button type="button" className="icon-btn sm" title="Keep in brand kit (survives shoot cleanup)" onClick={() => onKeep(r)} disabled={!!busy}>
            <Icon name="dna" size={13} />
          </button>
        </span>
      )}
    </figure>
  );
}

/* ---------- main view ---------- */
export default function Photoshoot() {
  const { say, profile, refresh } = useApp();
  const [sp, setSp] = useSearchParams();
  const [jobs, setJobs] = useState(null);          // null loading · 'error' fetch failed
  const [err, setErr] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  // selection lives in the URL (?shoot=<id>): selecting pushes a history entry
  // so browser Back closes the panel instead of leaving /shoots; a shared link
  // lands on the same detail. Closing replaces — no dead param left behind.
  const sel = sp.get('shoot') || null;
  const select = (id) => {
    setEditFor(null);
    setSp(id ? { shoot: id } : {}, { replace: !id });
  };
  const [editFor, setEditFor] = useState(null);    // imagePath being edited
  const [editPrompt, setEditPrompt] = useState('');
  const [busy, setBusy] = useState('');            // 'launch' | 'edit' | 'del' | 'keep'
  const [confirmDel, setConfirmDel] = useState(false);
  const confirmT = useRef(null);
  useEffect(() => () => clearTimeout(confirmT.current), []);
  const detRef = useRef(null);

  const load = async (quiet) => {
    try {
      const { jobs } = await api.listPhotoshoot();
      setJobs(Array.isArray(jobs) ? jobs : []);
      setErr('');
    } catch (e) {
      if (!quiet) { setErr(e.message || 'fetch failed'); setJobs('error'); }
    }
  };
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const sorted = useMemo(
    () => (Array.isArray(jobs) ? [...jobs].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))) : []),
    [jobs],
  );
  const running = sorted.some((j) => jobStatus(j) === 'running');
  const nRenders = sorted.reduce((n, j) => n + renders(j).length, 0);
  const latest = sorted[0]?.createdAt;
  const job = sorted.find((j) => j.id === sel) || null;
  // the detail panel runs the drawer contract — focus moves in on open
  // (close button first), Tab wraps inside, and closing hands focus back to
  // the card that opened it. A deleted shoot's card is gone by then; the
  // hook checks document.contains before restoring, so nothing lands on body.
  useOverlayFocus(detRef, !!job);

  // Esc closes the detail like every other overlay
  useEffect(() => {
    if (!job) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') select(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [job]); // eslint-disable-line react-hooks/exhaustive-deps

  // live-poll only while something is actually rendering
  useEffect(() => {
    if (!running) return undefined;
    const t = setInterval(() => load(true), 2000);
    return () => clearInterval(t);
  }, [running]); // eslint-disable-line react-hooks/exhaustive-deps

  // a ?shoot= that no longer resolves (deleted, or never existed) is a lie —
  // strip it from the URL rather than render a dead selection
  useEffect(() => {
    if (sel && Array.isArray(jobs) && !jobs.some((j) => j.id === sel)) {
      setSp({}, { replace: true });
    }
  }, [jobs, sel]); // eslint-disable-line react-hooks/exhaustive-deps

  const launch = async (payload) => {
    setBusy('launch');
    try {
      const { shoot } = await api.createPhotoshoot(payload);
      await load();
      if (shoot?.id) select(shoot.id);
      setFormOpen(false);
      say('Shoot running — renders land as they finish');
    } catch (e) { say(e.message); }
    setBusy('');
  };

  const runEdit = async () => {
    if (!job || !editFor || !editPrompt.trim()) return;
    setBusy('edit');
    try {
      const { job: j } = await api.editPhotoshoot(job.id, { prompt: editPrompt.trim(), imagePath: editFor });
      if (j?.id) await pollJob(j.id).catch((e) => say(e.message));
      await load();
      setEditFor(null); setEditPrompt('');
      say('Edit rendered');
    } catch (e) { say(e.message); }
    setBusy('');
  };

  const keep = async (r) => {
    setBusy('keep');
    try {
      // PUT /api/images/:id resolves a path basename → profile.images; promoted
      // assets are ref-counted, so they survive a shoot delete
      await api.promoteImage(base(r.imagePath), { target: 'profile', caption: `${job?.mode || 'shoot'} · ${r.template || 'render'}` });
      await refresh();
      say('Kept in brand kit');
    } catch (e) { say(e.message); }
    setBusy('');
  };

  const del = async () => {
    if (!confirmDel) {
      setConfirmDel(true);
      clearTimeout(confirmT.current);
      confirmT.current = setTimeout(() => setConfirmDel(false), 3200);
      return;
    }
    setBusy('del');
    try {
      const { freedAssets } = await api.deletePhotoshoot(job.id);
      select(null); setConfirmDel(false);
      await load();
      say(freedAssets ? `Released ${freedAssets} asset${freedAssets === 1 ? '' : 's'}` : 'Shoot deleted');
    } catch (e) { say(e.message); }
    setBusy('');
  };

  const dl = (r) => downloadAsset(r.imagePath, `marque-${r.template || 'shot'}-${base(r.imagePath)}`).catch((e) => say(e.message));

  /* ---------- header ---------- */
  const head = (
    <header className="view-head">
      <div className="vh-main">
        <span className="vh-kicker">MARQUE / SHOOTS</span>
        <h1 className="display">Photoshoots</h1>
        <p className="sub">Local render runs — scene prompts in, shot plates out.</p>
      </div>
      <div className="vh-side">
        <span className="ps-stat"><b>{sorted.length}</b><i>shoots</i></span>
        <span className="ps-stat"><b>{nRenders}</b><i>renders</i></span>
        <span className="ps-stat"><i>last</i><b>{latest ? relTime(latest) : '—'}</b></span>
        <button type="button" className="btn lime sm" onClick={() => setFormOpen((o) => !o)}>
          <Icon name={formOpen ? 'x' : 'plus'} size={14} /> {formOpen ? 'Close' : 'New shoot'}
        </button>
      </div>
    </header>
  );

  /* ---------- states ---------- */
  if (jobs === null) {
    return <div className="section view ps-view">{head}<div className="loading-wrap"><div className="spinner" /></div></div>;
  }
  if (jobs === 'error') {
    return (
      <div className="section view ps-view">
        {head}
        <div className="locked-wrap">
          <div className="locked-ic"><Icon name="refresh" size={26} /></div>
          <h2 className="display">Can&apos;t reach the renderer</h2>
          <p>{err || 'The photoshoot feed didn’t respond — check the server and try again.'}</p>
          <button className="btn lime" onClick={() => { setJobs(null); load(); }}><Icon name="refresh" size={15} /> Retry</button>
        </div>
      </div>
    );
  }

  return (
    <div className={`section view ps-view${job ? ' det' : ''}`}>
      {head}
      {formOpen && <ShootForm profile={profile} busy={busy} onLaunch={launch} onClose={() => setFormOpen(false)} />}

      {!sorted.length ? (
        <div className="card ps-empty">
          <div className="ps-empty-ic"><Icon name="photo" size={26} /></div>
          <h2 className="display">No shoots yet</h2>
          <p>Run a scene through the local engine — one prompt, up to four plated renders, no stock photography.</p>
          <button className="btn lime" onClick={() => setFormOpen(true)}><Icon name="plus" size={15} /> New shoot</button>
        </div>
      ) : (
        <div className="ps-split">
          {/* ---------- job rail ---------- */}
          <div className="ps-list view-scroll">
            <div className="ps-sub mono">
              {sorted.length} SHOOT{sorted.length === 1 ? '' : 'S'} · {nRenders} RENDER{nRenders === 1 ? '' : 'S'}
              {running && <em> · RENDERING…</em>}
            </div>
            <div className="ps-grid">
              {sorted.map((j) => {
                const st = jobStatus(j);
                const tiles = (j.results || []);
                const nOk = tiles.filter((r) => r.imagePath).length;
                const nErr = tiles.filter((r) => !r.imagePath).length;
                return (
                  <button key={j.id} type="button"
                    className={`ps-card st-${st}${sel === j.id ? ' on' : ''}`}
                    onClick={() => select(sel === j.id ? null : j.id)}>
                    <span className="ps-card-top">
                      <i className="ps-led" />
                      <span className="ps-st mono">{st === 'error' ? 'error' : st === 'running' ? 'running' : 'done'}</span>
                      <span className="ps-mode mono">{j.mode === 'product' ? 'product' : 'free'}</span>
                      <span className="ps-time mono">{relTime(j.createdAt)}</span>
                    </span>
                    <span className="ps-thumbs">
                      {st === 'running' && !tiles.length
                        ? Array.from({ length: (j.templates || []).length || 2 }).map((_, i) => (
                            <span key={i} className="ps-thumb ps-thumb-wip"><span className="spinner" /></span>
                          ))
                        : tiles.slice(0, 4).map((r) => r.imagePath
                            ? <img key={r.id} src={thumb(r.imagePath, 300)} alt="" loading="lazy" />
                            : <span key={r.id} className="ps-thumb ps-thumb-err" title={r.error || 'render failed'}><Icon name="x" size={13} /></span>)}
                    </span>
                    <span className="ps-prompt">{j.prompt || (j.mode === 'product' ? 'Product shoot' : '—')}</span>
                    <span className="ps-card-meta mono">
                      {nOk}/{tiles.length || (j.templates || []).length} SHOTS
                      {!!nErr && <em className="ps-warn"> · {nErr} FAILED</em>}
                      {!!(j.edits || []).length && ` · ${j.edits.length} EDIT${j.edits.length === 1 ? '' : 'S'}`}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* ---------- detail panel ---------- */}
          {job && (
            <aside ref={detRef} className="card hud ps-detail" role="dialog" aria-modal="true" aria-label="Shoot detail">
              <div className="zone-head">
                <span className="z-id">SHT</span>Shoot · {job.id.slice(0, 8)}
                <span className={`z-tag ps-tag-${jobStatus(job)}`}>{jobStatus(job)}</span>
                <button type="button" className="icon-btn sm ps-x" onClick={() => select(null)} aria-label="Close detail">
                  <Icon name="x" size={13} />
                </button>
              </div>
              <div className="ps-detail-body">
                <dl className="ps-meta mono">
                  <div><dt>started</dt><dd>{fullTime(job.createdAt)}</dd></div>
                  <div><dt>mode</dt><dd>{job.mode === 'product' ? 'product' : 'free scene'}</dd></div>
                  <div><dt>scenes</dt><dd>{(job.templates || []).join(' / ') || '—'}</dd></div>
                  {!!job.prompt && <div><dt>prompt</dt><dd className="ps-meta-prompt">{job.prompt}</dd></div>}
                  {!!job.inputImage && (
                    <div><dt>source</dt><dd><img className="ps-meta-src" src={thumb(job.inputImage, 128)} alt="source product" /></dd></div>
                  )}
                </dl>

                {jobStatus(job) === 'error' && !!job.note && (
                  <div className="ps-note" role="alert" title={job.note}><Icon name="info" size={13} /> {cleanErr(job.note) || 'the render run failed — try again'}</div>
                )}
                {jobStatus(job) === 'running' && (
                  <div className="ps-note run"><span className="spinner" /> Rendering on the local engine…</div>
                )}

                {editFor && (
                  <div className="ps-editbox">
                    <span className="ps-lab">Edit · {base(editFor)}</span>
                    <textarea
                      rows={2}
                      placeholder='e.g. "make the background deep red"'
                      value={editPrompt}
                      onChange={(e) => setEditPrompt(e.target.value)}
                      autoFocus
                    />
                    <span className="ps-editbox-row">
                      <button type="button" className="btn ghost sm" onClick={() => { setEditFor(null); setEditPrompt(''); }}>Cancel</button>
                      <button type="button" className="btn lime sm" disabled={busy === 'edit' || !editPrompt.trim()} onClick={runEdit}>
                        {busy === 'edit' ? <span className="spinner" /> : <Icon name="sparkle" size={13} />} Render edit
                      </button>
                    </span>
                  </div>
                )}

                <div className="ps-sec mono">Results · {(job.results || []).filter((r) => r.imagePath).length}/{(job.results || []).length || (job.templates || []).length}</div>
                <div className="ps-tiles">
                  {(job.results || []).map((r) => (
                    <ShotTile key={r.id} r={r} busy={busy}
                      onEdit={(x) => { setEditFor(x.imagePath); setEditPrompt(''); }}
                      onKeep={keep} onDl={dl} />
                  ))}
                  {jobStatus(job) === 'running' && !(job.results || []).length &&
                    (job.templates || []).map((t, i) => (
                      <span key={i} className="ps-tile ps-thumb-wip"><span className="spinner" /><em className="mono">{t}</em></span>
                    ))}
                </div>

                {!!(job.edits || []).length && (
                  <>
                    <div className="ps-sec mono">Edits · {job.edits.length}</div>
                    <div className="ps-tiles">
                      {job.edits.map((r, i) => (
                        <ShotTile key={i} r={{ ...r, template: `edit · ${r.prompt || ''}` }} busy={busy}
                          onEdit={(x) => { setEditFor(x.imagePath); setEditPrompt(''); }}
                          onKeep={keep} onDl={dl} />
                      ))}
                    </div>
                  </>
                )}

                <div className="ps-detail-foot">
                  <span className="ps-foot-note mono">Deleting frees unkept renders</span>
                  <button type="button" className={`btn ghost sm ps-del${confirmDel ? ' arm' : ''}`} disabled={busy === 'del'} onClick={del}>
                    {busy === 'del' ? <span className="spinner" /> : <Icon name="trash" size={13} />}
                    {confirmDel ? ' Confirm release?' : ' Delete shoot'}
                  </button>
                </div>
              </div>
            </aside>
          )}
        </div>
      )}
    </div>
  );
}
