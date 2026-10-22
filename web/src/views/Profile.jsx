import React, { useRef, useState } from 'react';
import { NavLink, Navigate, Route, Routes, useNavigate } from 'react-router-dom';
import api from '../api.js';
import { useApp } from '../App.jsx';
import Icon from '../components/Icon.jsx';
import AgentPane from '../components/AgentPane.jsx';
import FieldEdit from '../components/FieldEdit.jsx';
import Kebab from '../components/Kebab.jsx';
import Modal from '../components/Modal.jsx';
import UploadBtn from '../components/UploadBtn.jsx';
import { TastePanel } from '../components/Qloo.jsx';

const uid = () => (crypto.randomUUID ? crypto.randomUUID() : `id-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
const absUrl = (u) => (!u ? '' : /^https?:\/\//i.test(u) ? u : `https://${u}`);
const hostOf = (u) => { try { return new URL(absUrl(u)).hostname.replace(/^www\./, ''); } catch { return u; } };
const isUrlish = (s) => /\./.test(String(s)) && !/\s/.test(String(s));

// profile.colors arrives as either [hex…] (API.md) or {primary,…} (server normalize) — display either, always PATCH an array (applyPatch replaces arrays wholesale).
const COLOR_ORDER = ['primary', 'secondary', 'accent', 'background', 'surface', 'text'];
const colorList = (colors) => {
  if (Array.isArray(colors)) return colors;
  if (colors && typeof colors === 'object') {
    const keys = [...COLOR_ORDER.filter((k) => colors[k]), ...Object.keys(colors).filter((k) => !COLOR_ORDER.includes(k))];
    return keys.map((k) => colors[k]).filter(Boolean);
  }
  return [];
};

export default function ProfilePage() {
  const { profile } = useApp();
  if (profile === undefined) {
    return (
      <div className="profile-wrap" style={{ paddingTop: 60 }}>
        <div className="card pad">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="field">
              <span className="f-label"><span className="skel skel-line w70" /></span>
              <span className="f-val"><span className="skel skel-line" style={{ maxWidth: 320 }} /></span>
            </div>
          ))}
        </div>
      </div>
    );
  }
  if (!profile) return <Navigate to="/onboarding" replace />;
  return (
    <div className="split">
      <div className="left">
        <Routes>
          <Route index element={<Overview />} />
          <Route path="catalog" element={<CatalogTab />} />
          <Route path="assets" element={<AssetsTab />} />
          <Route path="*" element={<Navigate to="/profile" replace />} />
        </Routes>
      </div>
      <AgentPane />
    </div>
  );
}

function ProfileTabs() {
  const cls = ({ isActive }) => `tab${isActive ? ' on' : ''}`;
  return (
    <nav className="tabs">
      <NavLink end to="/profile" className={cls}>Overview</NavLink>
      <NavLink to="/profile/catalog" className={cls}>Catalog</NavLink>
      <NavLink to="/profile/assets" className={cls}>Assets</NavLink>
    </nav>
  );
}

// ============================== OVERVIEW ==============================
function Overview() {
  const { profile: p, refresh, setProfile, say } = useApp();
  const nav = useNavigate();
  const [sub, setSub] = useState('brand'); // 'brand' | 'details'
  const [confirmReset, setConfirmReset] = useState(false);
  const [resetting, setResetting] = useState(false);
  const b = p.business || {};

  const save = async (patch) => {
    try {
      await api.updateProfile(patch);
      await refresh();
    } catch (e) {
      say(`Save failed — ${e.message}`);
      throw e;
    }
  };

  const doReset = async () => {
    if (resetting) return;
    setResetting(true);
    try { await fetch('/api/profile', { method: 'DELETE' }); } catch { /* route may not exist yet */ }
    setConfirmReset(false);
    setResetting(false);
    setProfile(null);
    nav('/onboarding');
  };

  return (
    <div className="profile-wrap">
      <div className="page-head" style={{ paddingBottom: 18 }}>
        <h1 className="display">Your Business Profile</h1>
        <p className="sub">Unlock the power to generate product photos, marketing campaigns, a website, and more.</p>
      </div>
      <ProfileTabs />

      <div className="pf-wtabs">
        <button type="button" className={`tab${sub === 'brand' ? ' on' : ''}`} onClick={() => setSub('brand')}>Brand Overview</button>
        <button type="button" className={`tab${sub === 'details' ? ' on' : ''}`} onClick={() => setSub('details')}>Business Details</button>
      </div>

      {sub === 'brand' ? (
        <div className="card pad pf-under-tabs">
          <FieldEdit
            label="Business name" kind="text" value={p.name}
            onSave={(v) => save({ name: v })}
            renderValue={(v) => <span className="pf-bigname display">{v || 'Untitled brand'}</span>}
          />
          <FieldEdit
            label="Website" kind="text" value={p.website || p.source?.url || ''}
            onSave={(v) => save({ website: v })}
            renderValue={(v) => (v ? (
              <a href={absUrl(v)} target="_blank" rel="noreferrer"><Icon name="link" size={13} /> {hostOf(v)}</a>
            ) : <span className="muted">—</span>)}
          />
          <FieldEdit label="Colors" kind="colors" value={colorList(p.colors)} onSave={(v) => save({ colors: v })} />
          <FieldEdit label="Fonts" kind="fonts" value={p.fonts} onSave={(v) => save({ fonts: v })} />
          <FieldEdit label="Tagline" kind="text" value={p.tagline} onSave={(v) => save({ tagline: v })} />
          <FieldEdit label="Brand values" kind="list" value={p.values} onSave={(v) => save({ values: v })} />
          <FieldEdit label="Brand aesthetic" kind="list" value={p.aesthetic} onSave={(v) => save({ aesthetic: v })} />
          <FieldEdit label="Brand tone of voice" kind="list" value={p.tone} onSave={(v) => save({ tone: v })} />
          <FieldEdit label="Business overview" kind="textarea" value={p.description} onSave={(v) => save({ description: v })} />
          <FieldEdit label="Audience" kind="textarea" value={p.audience} onSave={(v) => save({ audience: v })} />
        </div>
      ) : (
        <div className="card pad pf-under-tabs right">
          <FieldEdit label="Location" kind="textarea" value={b.location} onSave={(v) => save({ business: { location: v } })} />
          <FieldEdit label="Phone Number" kind="text" value={b.phone} onSave={(v) => save({ business: { phone: v } })} />
          <FieldEdit label="Open hours" kind="text" value={b.hours} onSave={(v) => save({ business: { hours: v } })} />
          <FieldEdit label="Keywords" kind="list" value={b.keywords} onSave={(v) => save({ business: { keywords: v } })} />
          <FieldEdit
            label="Social media" kind="list" value={b.social}
            onSave={(v) => save({ business: { social: v } })}
            renderValue={(v) => <SocialView value={v} />}
          />
          <FieldEdit
            label="Call To Action Links" kind="links" value={b.ctaLinks}
            hint="Shown as buttons on your generated site"
            onSave={(v) => save({ business: { ctaLinks: v } })}
          />
          <FieldEdit label="Testimonials" kind="quotes" value={b.testimonials} onSave={(v) => save({ business: { testimonials: v } })} />
        </div>
      )}

      {sub === 'brand' && (
        <div className="mt16">
          <TastePanel bundle={p.qloo} />
        </div>
      )}

      <div className="pf-cta-row">
        <Kebab
          up
          align="left"
          title="Profile options"
          items={[
            { label: 'Reset profile', icon: 'trash', danger: true, onClick: () => setConfirmReset(true) },
          ]}
        />
        <button type="button" className="btn lime" onClick={() => nav('/brandbook')}>
          <Icon name="book" size={15} /> Create Brand Book
        </button>
        <button type="button" className="btn lime" onClick={() => nav('/websites')}>
          <Icon name="site" size={15} /> Create Website
        </button>
      </div>

      {confirmReset && (
        <Modal
          narrow
          title="Reset profile"
          onClose={() => setConfirmReset(false)}
          footer={(
            <>
              <button type="button" className="btn ghost" onClick={() => setConfirmReset(false)}>Cancel</button>
              <button type="button" className="btn pf-danger-solid" onClick={doReset} disabled={resetting}>
                {resetting ? <span className="spinner" /> : <Icon name="trash" size={14} />} Reset profile
              </button>
            </>
          )}
        >
          <p className="muted" style={{ margin: 0 }}>
            This clears your business profile — brand DNA, images and taste signature —
            and takes you back to onboarding. This can&apos;t be undone.
          </p>
        </Modal>
      )}
    </div>
  );
}

function SocialView({ value }) {
  const list = value || [];
  if (!list.length) return <span className="muted">—</span>;
  return (
    <span className="taglist">
      {list.map((s, i) => (isUrlish(s) ? (
        <a key={i} className="tag pf-taglink" href={absUrl(s)} target="_blank" rel="noreferrer">
          <Icon name="link" size={11} /> {hostOf(s)}
        </a>
      ) : (
        <span key={i} className="tag">{s}</span>
      )))}
    </span>
  );
}

// ============================== CATALOG ==============================
function CatalogTab() {
  const { profile: p, refresh, say } = useApp();
  const nav = useNavigate();
  const [modal, setModal] = useState(null); // {kind:'url'|'item', item?}
  const [acting, setActing] = useState(false); // async kebab op in flight
  const items = p.catalog || [];

  const act = async (fn, okMsg) => {
    if (acting) return;
    setActing(true);
    try {
      await fn();
      await refresh();
      if (okMsg) say(okMsg);
    } catch (e) {
      say(e.message);
    } finally {
      setActing(false);
    }
  };

  const kebabItems = (it) => [
    { label: 'Edit', icon: 'edit', onClick: () => setModal({ kind: 'item', item: it }) },
    { label: 'Sync image from URL', icon: 'refresh', onClick: () => act(() => api.syncCatalogImage(it.id), 'Image synced') },
    { label: 'Create Campaign', icon: 'campaign', onClick: () => nav(`/campaigns?product=${it.id}`) },
    { label: 'Create Photoshoot', icon: 'photo', onClick: () => nav(`/photoshoot?product=${it.id}`) },
    { label: 'Delete', icon: 'trash', danger: true, onClick: () => act(() => api.deleteCatalog(it.id), 'Removed from catalog') },
  ];

  return (
    <div className="profile-wrap">
      <div className="page-head" style={{ paddingBottom: 18 }}>
        <h1 className="display">Business Profile — Catalog</h1>
        <p className="sub">The products and services Marque can feature in your campaigns. Add or remove them anytime.</p>
      </div>
      <ProfileTabs />

      <div className="grid c3">
        <button type="button" className="card pf-addcard" onClick={() => setModal({ kind: 'url' })}>
          <Icon name="link" size={22} />
          <span>Add from URL</span>
        </button>
        <button type="button" className="card pf-addcard" onClick={() => setModal({ kind: 'item' })}>
          <Icon name="plus" size={22} />
          <span>Add from scratch</span>
        </button>
        {items.map((it) => (
          <div key={it.id} className="card pf-cat">
            <Kebab corner items={kebabItems(it)} />
            <div className="pf-cat-img">
              {it.image ? <img src={it.image} alt={it.name} /> : <Icon name="bag" size={26} />}
            </div>
            <div className="pf-cat-body">
              <div className="pf-cat-name">{it.name}</div>
              {it.description && <div className="pf-cat-desc">{it.description}</div>}
              <div className="row mt8">
                {it.price && <span className="pf-price">{it.price}</span>}
                {it.url && (
                  <a className="small" href={absUrl(it.url)} target="_blank" rel="noreferrer">
                    <Icon name="link" size={11} /> {hostOf(it.url)}
                  </a>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
      {!items.length && (
        <div className="empty">No products yet — add one from a URL or build it from scratch.</div>
      )}
      {acting && (
        <div className="row" style={{ justifyContent: 'center', margin: '14px 0', color: 'var(--ink-3)', fontSize: 13.5 }}>
          <span className="spinner pf-spin-sm" /> Working…
        </div>
      )}

      {modal?.kind === 'url' && (
        <AddUrlModal
          onClose={() => setModal(null)}
          onDone={async () => { setModal(null); await refresh(); say('Product added'); }}
          say={say}
        />
      )}
      {modal?.kind === 'item' && (
        <ItemModal
          item={modal.item}
          onClose={() => setModal(null)}
          onDone={async (edited) => { setModal(null); await refresh(); say(edited ? 'Saved' : 'Product added'); }}
          say={say}
        />
      )}
    </div>
  );
}

function AddUrlModal({ onClose, onDone, say }) {
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const go = async () => {
    if (!url.trim() || busy) return;
    setBusy(true);
    try {
      await api.addCatalogFromUrl(url.trim());
      await onDone();
    } catch (e) {
      say(`Couldn't fetch that page — ${e.message}`);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      narrow
      title="Add from URL"
      onClose={onClose}
      footer={(
        <>
          <button type="button" className="btn ghost" onClick={onClose}>Cancel</button>
          <button type="button" className="btn lime" onClick={go} disabled={busy || !url.trim()}>
            {busy && <span className="spinner" />}{busy ? 'Fetching…' : 'Add product'}
          </button>
        </>
      )}
    >
      <p className="muted small" style={{ margin: 0 }}>Paste a product or service page — we&apos;ll scrape the name, description and image.</p>
      <input
        className="pf-input"
        value={url}
        placeholder="https://…"
        autoFocus
        onChange={(e) => setUrl(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && go()}
      />
    </Modal>
  );
}

function ItemModal({ item, onClose, onDone, say }) {
  const editing = !!item?.id;
  const [f, setF] = useState({
    name: item?.name || '',
    description: item?.description || '',
    price: item?.price || '',
    url: item?.url || '',
    image: item?.image || '',
  });
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));

  const go = async () => {
    if (!f.name.trim()) return say('Name is required');
    if (busy) return undefined;
    setBusy(true);
    const body = Object.fromEntries(Object.entries(f).filter(([, v]) => String(v).trim()));
    try {
      if (editing) await api.updateCatalog(item.id, body);
      else await api.addCatalog(body);
      await onDone(editing);
    } catch (e) {
      say(e.message);
    } finally {
      setBusy(false);
    }
    return undefined;
  };

  return (
    <Modal
      narrow
      title={editing ? 'Edit product' : 'Add from scratch'}
      onClose={onClose}
      footer={(
        <>
          <button type="button" className="btn ghost" onClick={onClose}>Cancel</button>
          <button type="button" className="btn lime" onClick={go} disabled={busy}>
            {busy && <span className="spinner" />}{busy ? 'Saving…' : editing ? 'Save changes' : 'Add product'}
          </button>
        </>
      )}
    >
      <label className="pf-lbl">
        Name
        <input className="pf-input" value={f.name} onChange={set('name')} placeholder="Ceramic pour-over set" autoFocus />
      </label>
      <label className="pf-lbl">
        Description
        <textarea className="pf-input" rows={3} value={f.description} onChange={set('description')} placeholder="What it is and who it's for" />
      </label>
      <div className="row">
        <label className="pf-lbl grow">
          Price
          <input className="pf-input" value={f.price} onChange={set('price')} placeholder="$29" />
        </label>
        <label className="pf-lbl grow">
          Product URL
          <input className="pf-input" value={f.url} onChange={set('url')} placeholder="https://…" />
        </label>
      </div>
      <div className="pf-lbl">Image</div>
      <div className="row">
        {f.image && <img className="pf-thumb" src={f.image} alt="" />}
        <UploadBtn
          label="Upload"
          className="btn ghost sm"
          onUploaded={(r) => setF((x) => ({ ...x, image: r.path || x.image }))}
        />
        <input className="pf-input grow" value={f.image} onChange={set('image')} placeholder="…or paste an image URL" />
      </div>
    </Modal>
  );
}

// ============================== ASSETS ==============================
function AssetsTab() {
  const { profile: p, refresh, say } = useApp();
  const nav = useNavigate();
  const imgs = p.images || [];
  const imgsRef = useRef(imgs);
  imgsRef.current = imgs;
  const [capModal, setCapModal] = useState(null); // image record
  const [urlModal, setUrlModal] = useState(false);
  const [acting, setActing] = useState(false);

  const writeImages = async (next, okMsg) => {
    if (acting) return;
    imgsRef.current = next; // keep multi-upload sequential writes consistent
    setActing(true);
    try {
      await api.updateProfile({ images: next });
      await refresh();
      if (okMsg) say(okMsg);
    } catch (e) {
      say(e.message);
    } finally {
      setActing(false);
    }
  };
  const addImage = (img) => writeImages([...imgsRef.current, img]);
  const removeImage = (im) => writeImages(imgsRef.current.filter((x) => x !== im && x.id !== im.id));

  return (
    <div className="profile-wrap">
      <div className="page-head" style={{ paddingBottom: 18 }}>
        <h1 className="display">Business Profile — Assets</h1>
        <p className="sub">Images Marque can draw on for campaigns, photoshoots and your site.</p>
      </div>
      <ProfileTabs />

      <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
        <div className="section-label" style={{ margin: 0 }}>Images</div>
        <div className="row">
          <UploadBtn
            label="Upload Images"
            className="btn ghost sm"
            multiple
            onUploaded={async (r) => { await addImage({ id: uid(), path: r.path, url: '', caption: '' }); }}
          />
          <button type="button" className="btn ghost sm" onClick={() => setUrlModal(true)}>
            <Icon name="link" size={14} /> Add from URL
          </button>
        </div>
      </div>

      {acting && (
        <div className="row" style={{ justifyContent: 'center', margin: '14px 0', color: 'var(--ink-3)', fontSize: 13.5 }}>
          <span className="spinner pf-spin-sm" /> Working…
        </div>
      )}

      {imgs.length ? (
        <div className="grid c4 mt16">
          {imgs.map((im, i) => (
            <div key={im.id || im.path || i} className="media-tile pf-asset">
              {im.path || im.url ? (
                <img src={im.path || im.url} alt={im.caption || 'brand asset'} />
              ) : (
                <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--ink-4)' }}>
                  <Icon name="image" size={22} />
                </span>
              )}
              <Kebab
                corner
                items={[
                  { label: 'Set caption', icon: 'edit', onClick: () => setCapModal(im) },
                  { label: 'Remove', icon: 'trash', danger: true, onClick: () => removeImage(im) },
                ]}
              />
              {im.caption && <div className="pf-cap">{im.caption}</div>}
            </div>
          ))}
          <div className="card pad pf-promo">
            <h4>Endless creatives, ready in minutes</h4>
            <p className="muted small">Skip the cost and complexity of traditional shoots — generate on-brand images that drive sales.</p>
            <div>
              <button type="button" className="btn lime sm" onClick={() => nav('/photoshoot')}>
                <Icon name="photo" size={14} /> Try Photoshoot
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div className="empty">
          <p>No images yet — upload product shots, add from a URL, or generate some.</p>
          <button type="button" className="btn lime" onClick={() => nav('/photoshoot')}>
            <Icon name="photo" size={15} /> Try Photoshoot
          </button>
        </div>
      )}

      {capModal && (
        <CaptionModal
          im={capModal}
          onClose={() => setCapModal(null)}
          onSave={async (cap) => {
            setCapModal(null);
            await writeImages(imgsRef.current.map((x) => (x === capModal || x.id === capModal.id ? { ...x, caption: cap } : x)));
          }}
        />
      )}
      {urlModal && (
        <AssetUrlModal
          onClose={() => setUrlModal(false)}
          onSave={async (u, cap) => {
            setUrlModal(false);
            await addImage({ id: uid(), path: '', url: u, caption: cap });
            say('Image added');
          }}
        />
      )}
    </div>
  );
}

function CaptionModal({ im, onClose, onSave }) {
  const [cap, setCap] = useState(im.caption || '');
  const [busy, setBusy] = useState(false);
  const go = async () => {
    if (busy) return;
    setBusy(true);
    try { await onSave(cap.trim()); } finally { setBusy(false); }
  };
  return (
    <Modal
      narrow
      title="Image caption"
      onClose={onClose}
      footer={(
        <>
          <button type="button" className="btn ghost" onClick={onClose}>Cancel</button>
          <button type="button" className="btn lime" onClick={go} disabled={busy}>
            {busy && <span className="spinner" />}Save
          </button>
        </>
      )}
    >
      <img src={im.path || im.url} alt="" style={{ borderRadius: 10, maxHeight: 200, width: '100%', objectFit: 'cover' }} />
      <input
        className="pf-input"
        value={cap}
        onChange={(e) => setCap(e.target.value)}
        placeholder="What's in this image?"
        autoFocus
        onKeyDown={(e) => e.key === 'Enter' && go()}
      />
    </Modal>
  );
}

function AssetUrlModal({ onClose, onSave }) {
  const [url, setUrl] = useState('');
  const [cap, setCap] = useState('');
  const [busy, setBusy] = useState(false);
  const go = async () => {
    if (!url.trim() || busy) return;
    setBusy(true);
    try { await onSave(url.trim(), cap.trim()); } finally { setBusy(false); }
  };
  return (
    <Modal
      narrow
      title="Add image from URL"
      onClose={onClose}
      footer={(
        <>
          <button type="button" className="btn ghost" onClick={onClose}>Cancel</button>
          <button type="button" className="btn lime" onClick={go} disabled={busy || !url.trim()}>
            {busy && <span className="spinner" />}Add image
          </button>
        </>
      )}
    >
      <input className="pf-input" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…/image.png" autoFocus />
      <input className="pf-input" value={cap} onChange={(e) => setCap(e.target.value)} placeholder="Caption (optional)" onKeyDown={(e) => e.key === 'Enter' && go()} />
    </Modal>
  );
}
