import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import api from '../api.js';
import { useApp } from '../App.jsx';
import Icon from '../components/Icon.jsx';
import { thumb } from '../components/Composer.jsx';
import EvidenceDrawer from '../components/EvidenceDrawer.jsx';
import { QlooBadge, SignalChips } from '../components/Qloo.jsx';
import './studio.css';
import './profile.css';

// ---------- helpers ----------
const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;
const HEX6 = /^#[0-9a-f]{6}$/i;
const HEX3 = /^#[0-9a-f]{3}$/i;
const COLOR_ORDER = ['primary', 'secondary', 'accent', 'background', 'surface', 'text'];
const arrEq = (a, b) => JSON.stringify(a || []) === JSON.stringify(b || []);
const absUrl = (u) => (!u ? '' : /^https?:\/\//i.test(u) ? u : `https://${u}`);
const hostOf = (u) => { try { return new URL(absUrl(u)).hostname.replace(/^www\./, ''); } catch { return u; } };
// <input type="color"> only accepts #rrggbb — expand 3-digit, neutral fallback
const pickerHex = (c) => {
  if (HEX6.test(c || '')) return c;
  if (HEX3.test(c || '')) return `#${c.slice(1).split('').map((x) => x + x).join('')}`;
  return '#8a8a8a';
};
const slug = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 20) || 'swatch';
const fmtDay = (d) => {
  const t = new Date(d);
  return isNaN(t) ? '' : t.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
};
const baseName = (p) => String(p || '').split('/').pop();
// upload route caps bodies at 25MB — check client-side so failures read plainly
const UPLOAD_MAX = 25 * 1024 * 1024;

// profile.colors is canonically {primary,…} but older profiles may carry a
// bare [hex…] array — display either as ordered {key,hex} cards, always PATCH
// the object form (applyPatch merges it over either shape).
const colorEntries = (colors) => {
  if (Array.isArray(colors)) {
    return colors.filter(Boolean).map((hex, i) => ({ key: COLOR_ORDER[i] || `swatch${i + 1}`, hex }));
  }
  if (colors && typeof colors === 'object') {
    const keys = [
      ...COLOR_ORDER.filter((k) => colors[k]),
      ...Object.keys(colors).filter((k) => !COLOR_ORDER.includes(k) && colors[k]),
    ];
    return keys.map((k) => ({ key: k, hex: colors[k] }));
  }
  return [];
};
const colorsObj = (list) => Object.fromEntries(
  (list || []).filter((e) => e.key && String(e.hex || '').trim()).map((e) => [e.key, String(e.hex).trim().toLowerCase()]),
);

// what the editable draft holds — one slot per patchable top-level field
const init = (p) => ({
  name: p.name || '',
  tagline: p.tagline || '',
  description: p.description || '',
  // 'website' in p matters: an explicit empty string must not fall back to
  // the scrape url again — the user cleared it on purpose
  website: 'website' in p ? (p.website || '') : (p.source?.url || ''),
  audience: p.audience || '',
  tone: [...(Array.isArray(p.tone) ? p.tone : [])],
  values: [...(Array.isArray(p.values) ? p.values : [])],
  colors: colorEntries(p.colors),
  fonts: { heading: '', body: '', ...(p.fonts || {}) },
});
// normalized snapshot — the dirty check and the patch diff both run on this
const snap = (d) => ({
  name: d.name, tagline: d.tagline, description: d.description,
  website: d.website, audience: d.audience,
  tone: d.tone, values: d.values, fonts: d.fonts, colors: colorsObj(d.colors),
});

export default function ProfilePage() {
  const { profile: p, setProfile, refresh, say } = useApp();
  const [d, setD] = useState(null);      // editable draft — null until profile lands
  const [busy, setBusy] = useState(false);
  const [evi, setEvi] = useState(false); // taste-evidence drawer
  const [newSw, setNewSw] = useState({ name: '', hex: '#' });
  const [chipIn, setChipIn] = useState({ tone: '', values: '' });
  // brand kit strip — writes go straight to the API (no draft), so it tracks
  // its own busy flag + a per-thumb two-tap remove confirm
  const [kitBusy, setKitBusy] = useState('');      // 'key:<k>' | 'rm:<k>' | 'up'
  const [confirmRm, setConfirmRm] = useState(null); // image id/path awaiting tap 2
  const confirmRmT = useRef(null);

  // the server-truth snapshot the draft diffs against
  const base = useMemo(() => (p ? snap(init(p)) : null), [p]);

  // diff draft vs server truth → a patch of ONLY the top-level keys that moved
  const buildPatch = () => {
    const cur = snap(d); const patch = {};
    for (const k of ['name', 'tagline', 'description', 'website', 'audience']) {
      if (cur[k] !== base[k]) patch[k] = cur[k];
    }
    for (const k of ['tone', 'values']) if (!arrEq(cur[k], base[k])) patch[k] = cur[k];
    if (!arrEq(cur.fonts, base.fonts)) {
      const f = {};
      for (const k of Object.keys(cur.fonts)) if (cur.fonts[k] !== base.fonts[k]) f[k] = cur.fonts[k];
      patch.fonts = f;
    }
    if (!arrEq(cur.colors, base.colors)) {
      const c = {};
      for (const [k, v] of Object.entries(cur.colors)) if (base.colors[k] !== v) c[k] = v;
      // applyPatch merges objects, it can't delete — a removed swatch leaves a
      // null tombstone every reader already truthy-filters
      for (const k of Object.keys(base.colors)) if (!(k in cur.colors)) c[k] = null;
      patch.colors = c;
    }
    return patch;
  };
  const patch = p && d && base ? buildPatch() : {};
  const dirtyKeys = Object.keys(patch);
  const dirty = dirtyKeys.length > 0;

  // follow ctx updates only while the draft is clean — never clobber typing
  useEffect(() => {
    if (p && !dirty) setD(init(p));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p]);

  // cancel a pending remove-confirm timer on unmount
  useEffect(() => () => clearTimeout(confirmRmT.current), []);

  const set = (k) => (e) => setD((x) => ({ ...x, [k]: e.target ? e.target.value : e }));
  const setColor = (i, hex) => setD((x) => ({ ...x, colors: x.colors.map((c, j) => (j === i ? { ...c, hex } : c)) }));
  const rmColor = (i) => setD((x) => ({ ...x, colors: x.colors.filter((_, j) => j !== i) }));
  const addColor = () => {
    const hex = newSw.hex.trim().toLowerCase();
    if (!HEX.test(hex)) { say('Use #rgb or #rrggbb for the hex'); return; }
    const root = slug(newSw.name || 'swatch');
    let key = root; let n = 2;
    while (d.colors.some((c) => c.key === key)) key = `${root}${n++}`;
    setD((x) => ({ ...x, colors: [...x.colors, { key, hex }] }));
    setNewSw({ name: '', hex: '#' });
  };
  const chipAdd = (k) => {
    const t = chipIn[k].trim();
    if (t && !d[k].includes(t)) setD((x) => ({ ...x, [k]: [...x[k], t] }));
    setChipIn((x) => ({ ...x, [k]: '' }));
  };
  const chipRm = (k, i) => setD((x) => ({ ...x, [k]: x[k].filter((_, j) => j !== i) }));

  const save = async () => {
    const bad = d.colors.find((c) => c.hex && !HEX.test(c.hex.trim()));
    if (bad) { say(`"${bad.hex}" isn't a hex color — use #rgb or #rrggbb`); return; }
    if (!dirty || busy) return;
    setBusy(true);
    try {
      const { profile: np } = await api.updateProfile(patch);
      if (np) setProfile(np);
      await refresh(); // rail LEDs / brand accents everywhere read ctx
      say('Profile saved');
    } catch (e) {
      say(`Save failed — ${e.message}`);
    }
    setBusy(false);
  };
  const discard = () => setD(init(p));

  /* ---------- brand kit — profile.images writes (immediate, not drafted) ----------
     PUT /api/profile {patch:{images:[…]}} replaces the whole array (applyPatch
     treats arrays as replace) — reorder and remove both ride that route. There
     is no file-deleting image route, so removal only unpins from the kit. */
  const writeImages = async (next, tag) => {
    setKitBusy(tag);
    try {
      const { profile: np } = await api.updateProfile({ images: next });
      if (np) setProfile(np);
      await refresh();
      return true;
    } catch (e) {
      say(e.message);
      return false;
    } finally {
      setKitBusy('');
    }
  };
  const imgKey = (img) => img.id || img.path;
  const makeKey = (img) => {
    const images = p.images || [];
    const next = [img, ...images.filter((x) => imgKey(x) !== imgKey(img))];
    writeImages(next, `key:${imgKey(img)}`).then((done) => done && say('Key image set — it drives image-to-image renders'));
  };
  const askRm = (key) => {
    // two-tap confirm: first tap opens the veil on that thumb, auto-cancels
    setConfirmRm(key);
    clearTimeout(confirmRmT.current);
    confirmRmT.current = setTimeout(() => setConfirmRm(null), 4200);
  };
  const doRm = (img) => {
    setConfirmRm(null); clearTimeout(confirmRmT.current);
    const next = (p.images || []).filter((x) => imgKey(x) !== imgKey(img));
    writeImages(next, `rm:${imgKey(img)}`).then((done) => done && say('Removed from brand kit — the file stays in assets'));
  };
  const onFile = async (e) => {
    const f = e.target.files?.[0];
    e.target.value = ''; // same file twice must re-fire
    if (!f || kitBusy) return;
    if (!/^image\//.test(f.type || '')) { say('Images only — pick a png, jpg, webp or gif'); return; }
    if (f.size > UPLOAD_MAX) { say('File is over the 25MB upload limit'); return; }
    setKitBusy('up');
    try {
      // POST /api/upload saves the asset + registers it; the promote route then
      // pins it into profile.images (what pickers + this strip read)
      const { path: up } = await api.upload(f);
      const { profile: np } = await api.promoteImage(baseName(up), { target: 'profile', caption: f.name });
      if (np) setProfile(np);
      await refresh();
      say('Added to brand kit');
    } catch (e2) {
      say(`Upload failed — ${e2.message}`);
    }
    setKitBusy('');
  };

  if (p === undefined || d === null) {
    return <div className="loading-wrap"><div className="spinner" /></div>;
  }
  if (!p) return <Navigate to="/onboarding" replace />;

  const bundle = p.qloo;
  const topSignals = (bundle?.affinities || [])
    .flatMap((a) => (a.entities || []).map((e) => ({ entity: e.name, affinity: e.affinity })))
    .sort((a, b) => (b.affinity ?? 0) - (a.affinity ?? 0))
    .slice(0, 6);
  const srcLbl = p.source?.type === 'template'
    ? `template · ${p.source.templateId || 'unknown'}`
    : p.source?.url ? `scraped · ${hostOf(p.source.url)}` : (p.source?.type || 'manual');

  const chipList = (k, label, placeholder) => (
    <div className="pfv-field">
      <span className="pfv-lbl">{label}</span>
      <div className="pfv-chips">
        {d[k].map((t, i) => (
          <span className="pfv-chip" key={`${t}-${i}`}>
            {t}
            <button type="button" aria-label={`Remove ${t}`} title={`Remove ${t}`} onClick={() => chipRm(k, i)}>
              <Icon name="x" size={10} sw={2.5} />
            </button>
          </span>
        ))}
        <input
          className="pfv-chipin"
          value={chipIn[k]}
          placeholder={placeholder}
          aria-label={`Add ${label}`}
          onChange={(e) => setChipIn((x) => ({ ...x, [k]: e.target.value }))}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); chipAdd(k); }
            if (e.key === 'Backspace' && !chipIn[k] && d[k].length) chipRm(k, d[k].length - 1);
          }}
          onBlur={() => chipAdd(k)}
        />
      </div>
    </div>
  );

  return (
    <div className="section view pfv-view">
      <div className="view-head">
        <div className="vh-main">
          <span className="vh-kicker">MARQUE / BRAND</span>
          <h1 className="display">Business Profile</h1>
          <p className="sub">The file every board, campaign, site and palette reads. Edit in place — Save writes only what changed.</p>
        </div>
        <div className="vh-side">
          {!!bundle && (
            <button type="button" className="btn ghost sm" onClick={() => setEvi(true)}>
              <Icon name="qloo" size={13} /> Evidence{bundle.calls?.length ? ` · ${bundle.calls.length}` : ''}
            </button>
          )}
          <Link
            className="btn ghost sm"
            to="/onboarding"
            title="Rebuilds the whole profile from scratch — onboarding replaces these fields"
          >
            <Icon name="refresh" size={13} /> Regenerate profile
          </Link>
        </div>
      </div>

      <div className="pfv-split">
        {/* ---------- left rail — identity ---------- */}
        <section className="card hud cp-panel pfv-rail">
          <div className="zone-head">
            <span className="z-id">ID</span>Identity
            {dirty && <span className="z-tag">unsaved</span>}
          </div>
          <div className="cp-panel-body">
            <label className="pfv-field">
              <span className="pfv-lbl">Name</span>
              <input className="pfv-in pfv-name" value={d.name} onChange={set('name')} placeholder="Untitled brand" />
            </label>
            <label className="pfv-field">
              <span className="pfv-lbl">Tagline</span>
              <input className="pfv-in" value={d.tagline} onChange={set('tagline')} placeholder="One line that sells it" />
            </label>
            <label className="pfv-field">
              <span className="pfv-lbl">Description</span>
              <textarea className="pfv-in" rows={5} value={d.description} onChange={set('description')} placeholder="What the business does, who it's for" />
            </label>
            <label className="pfv-field">
              <span className="pfv-lbl">Site URL</span>
              <input className="pfv-in" value={d.website} onChange={set('website')} placeholder="https://yoursite.com" spellCheck={false} />
            </label>
            <dl className="pfv-meta">
              <dt>created</dt>
              <dd>{fmtDay(p.createdAt) || '—'}{p.updatedAt ? ` · edited ${fmtDay(p.updatedAt)}` : ''}</dd>
              <dt>source</dt>
              <dd>{srcLbl}</dd>
              <dt>assets</dt>
              <dd>{(p.images || []).length} images · {(p.catalog || []).length} catalog</dd>
            </dl>
            <p className="muted small" style={{ margin: 'auto 0 0', paddingTop: 12 }}>
              Regenerating rebuilds this file from a URL, a chat, or a template — the current fields are replaced.
            </p>
          </div>
        </section>

        {/* ---------- right column — palette / voice / taste ---------- */}
        <div className="pfv-col">
          <section className="card hud cp-panel">
            <div className="zone-head">
              <span className="z-id">PAL</span>Palette &amp; type
              <span className="z-tag">{d.colors.length} swatches</span>
            </div>
            <div className="cp-panel-body">
              <div className="pfv-swgrid">
                {d.colors.map((c, i) => (
                  <div className="pfv-sw" key={c.key}>
                    <label className="pfv-sw-chip" style={{ background: HEX.test(c.hex.trim()) ? c.hex.trim() : 'var(--card-3)' }} title={`${c.key} — click to pick`}>
                      <input type="color" value={pickerHex(c.hex.trim())} onChange={(e) => setColor(i, e.target.value)} aria-label={`Pick ${c.key} color`} />
                    </label>
                    <button type="button" className="pfv-sw-x" onClick={() => rmColor(i)} aria-label={`Remove ${c.key}`} title={`Remove ${c.key}`}>
                      <Icon name="x" size={9} sw={2.6} />
                    </button>
                    <div className="pfv-sw-body">
                      <span className="pfv-sw-key">{c.key}</span>
                      <input
                        className={`pfv-sw-hex${c.hex.trim() && !HEX.test(c.hex.trim()) ? ' bad' : ''}`}
                        value={c.hex}
                        onChange={(e) => setColor(i, e.target.value)}
                        spellCheck={false}
                        aria-label={`${c.key} hex value`}
                      />
                    </div>
                  </div>
                ))}
              </div>
              <div className="pfv-addsw">
                <input value={newSw.name} placeholder="role (e.g. highlight)" onChange={(e) => setNewSw((s) => ({ ...s, name: e.target.value }))} />
                <input className="pfv-hexin" value={newSw.hex} placeholder="#rrggbb" spellCheck={false}
                  onChange={(e) => setNewSw((s) => ({ ...s, hex: e.target.value }))}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addColor(); } }} />
                <button type="button" className="btn ghost sm" onClick={addColor}><Icon name="plus" size={13} /> Add swatch</button>
              </div>
              <div className="pfv-fonts">
                {[['heading', 'Heading'], ['body', 'Body']].map(([k, lbl]) => (
                  <div className="pfv-font" key={k}>
                    <span className="font-aa" style={{ fontFamily: `'${d.fonts[k] || 'Inter'}', sans-serif` }}>Aa</span>
                    <span className="pfv-font-l">
                      <input value={d.fonts[k]} placeholder={`${lbl} font name`}
                        onChange={(e) => setD((x) => ({ ...x, fonts: { ...x.fonts, [k]: e.target.value } }))} />
                      <span className="pfv-sw-key">{lbl}</span>
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </section>

          {/* ---------- brand library — profile.images, slot 1 = img2img key ref ---------- */}
          <section className="card hud cp-panel">
            <div className="zone-head">
              <span className="z-id">IMG</span>Brand library
              <span className="z-tag">
                {(p.images || []).length
                  ? `${p.images.length} image${p.images.length === 1 ? '' : 's'} · slot 1 = key`
                  : 'empty'}
              </span>
            </div>
            <div className="cp-panel-body">
              {!(p.images || []).length && (
                <p className="muted small" style={{ margin: 0 }}>
                  Nothing kept yet — pin a shoot render from Photoshoots or add a file here.
                </p>
              )}
              <div className="pfv-kit">
                {(p.images || []).map((img, i) => {
                  const k = imgKey(img);
                  return (
                    <figure className={`pfv-kit-item${i === 0 ? ' key' : ''}`} key={k}>
                      <div className="pfv-kit-frame">
                        <img src={thumb(img.path, 200)} alt={img.caption || `brand image ${i + 1}`} loading="lazy" />
                        {i === 0 && (
                          <span className="pfv-kit-key" title="Key image — drives image-to-image renders">KEY</span>
                        )}
                        <div className="pfv-kit-ops">
                          {i !== 0 && (
                            <button
                              type="button" className="pfv-kit-op"
                              aria-label={`Make ${img.caption || `image ${i + 1}`} the key image`}
                              title="Make key image — moves to slot 1, the reference image-to-image renders start from"
                              disabled={!!kitBusy} onClick={() => makeKey(img)}
                            >key</button>
                          )}
                          <button
                            type="button" className="pfv-kit-op ic danger"
                            aria-label={`Remove ${img.caption || `image ${i + 1}`} from the brand kit`}
                            title="Remove from brand kit — the file stays in assets"
                            disabled={!!kitBusy} onClick={() => askRm(k)}
                          ><Icon name="trash" size={11} sw={2.2} /></button>
                        </div>
                        {confirmRm === k && (
                          <div className="pfv-kit-confirm" role="alert">
                            <p>
                              Remove from the brand kit? The file stays in assets.
                              {i === 0 && ' Next image becomes key.'}
                            </p>
                            <span className="pfv-kit-confirm-ops">
                              <button type="button" className="go" disabled={!!kitBusy} onClick={() => doRm(img)}>
                                {kitBusy === `rm:${k}` ? '…' : 'Remove'}
                              </button>
                              <button type="button" onClick={() => setConfirmRm(null)}>Keep</button>
                            </span>
                          </div>
                        )}
                      </div>
                      {!!img.caption && (
                        <figcaption className="pfv-kit-cap" title={img.caption}>{img.caption}</figcaption>
                      )}
                    </figure>
                  );
                })}
                <label
                  className={`pfv-kit-add${kitBusy === 'up' ? ' busy' : ''}`}
                  title="Add an image file to the brand kit — png · jpg · webp · gif, up to 25MB"
                >
                  <input type="file" accept="image/*" aria-label="Add image to the brand kit" disabled={!!kitBusy} onChange={onFile} />
                  {kitBusy === 'up' ? <span className="spinner" /> : <Icon name="upload" size={14} />}
                  <span>{kitBusy === 'up' ? 'adding' : 'add image'}</span>
                </label>
              </div>
              {!!(p.images || []).length && (
                <p className="muted small" style={{ margin: 0 }}>
                  Slot 1 is the key reference photoshoots and regens image-to-image from.
                  Removing drops an image from the kit — the file stays in assets.
                </p>
              )}
            </div>
          </section>

          <section className="card hud cp-panel">
            <div className="zone-head"><span className="z-id">VOX</span>Voice &amp; audience</div>
            <div className="cp-panel-body">
              {chipList('tone', 'Tone of voice', 'add a tone keyword…')}
              {chipList('values', 'Brand values', 'add a value…')}
              <label className="pfv-field">
                <span className="pfv-lbl">Audience</span>
                <textarea className="pfv-in" rows={3} value={d.audience} onChange={set('audience')} placeholder="Who this brand is for — one honest sentence" />
              </label>
            </div>
          </section>

          <section className="card hud cp-panel">
            <div className="zone-head">
              <span className="z-id">SIG</span>Taste signals
              {bundle && <QlooBadge mode={bundle.mode === 'live' ? 'live' : bundle.mode === 'partial' ? 'partial' : 'error'} label="Audience data" />}
            </div>
            <div className="cp-panel-body">
              {!bundle ? (
                <p className="muted small" style={{ margin: 0 }}>
                  No taste signature yet — regenerate the profile or enrich it and we'll match what your audience also loves.
                </p>
              ) : (
                <>
                  {!!bundle.entity?.name && (
                    <div className="pfv-trow">
                      <span className="pfv-lbl">Matched entity</span>
                      <span className="pfv-tent">
                        <Icon name="qloo" size={13} /> {bundle.entity.name}
                        {bundle.entity.popularity != null && <em> · popularity {(+bundle.entity.popularity).toFixed(2)}</em>}
                      </span>
                    </div>
                  )}
                  {!!bundle.tags?.length && (
                    <div className="pfv-trow">
                      <span className="pfv-lbl">Entity tags</span>
                      <span className="taglist">{bundle.tags.map((t) => <span key={t.id || t.name} className="tag">{t.name}</span>)}</span>
                    </div>
                  )}
                  {!!topSignals.length && (
                    <div className="pfv-trow">
                      <span className="pfv-lbl">Top signals</span>
                      <SignalChips signals={topSignals} max={6} />
                    </div>
                  )}
                  <div className="pfv-trow">
                    <span className="pfv-lbl">Coverage</span>
                    <span className="muted small">
                      {(bundle.affinities || []).length} signal type{(bundle.affinities || []).length === 1 ? '' : 's'}
                      {bundle.fetchedAt ? ` · fetched ${fmtDay(bundle.fetchedAt)}` : ''}
                    </span>
                  </div>
                  {!bundle.entity?.name && !bundle.tags?.length && !topSignals.length && (
                    <p className="muted small" style={{ margin: 0 }}>
                      No signals came back — the taste graph couldn't match this profile yet.
                      Enrich the identity fields and regenerate to retry.
                    </p>
                  )}
                  <button type="button" className="btn ghost sm" style={{ alignSelf: 'flex-start' }} onClick={() => setEvi(true)}>
                    <Icon name="qloo" size={13} /> Show evidence{bundle.calls?.length ? ` · ${bundle.calls.length} calls` : ''}
                  </button>
                </>
              )}
            </div>
          </section>
        </div>
      </div>

      {/* save bar — appears only when the draft genuinely diverges */}
      {dirty && (
        <div className="pfv-savebar" role="status">
          <span className="pfv-dirty"><i />Unsaved — {dirtyKeys.join(' · ')}</span>
          <span className="grow" />
          <button type="button" className="btn ghost sm" onClick={discard} disabled={busy}>Discard</button>
          <button type="button" className="btn lime sm" onClick={save} disabled={busy}>
            {busy ? <span className="spinner" /> : <Icon name="check" size={13} />}
            {busy ? 'Saving…' : 'Save profile'}
          </button>
        </div>
      )}

      {evi && <EvidenceDrawer bundle={bundle} onClose={() => setEvi(false)} />}
    </div>
  );
}
