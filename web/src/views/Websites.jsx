import React, { useEffect, useState } from 'react';
import { api } from '../api.js';
import { useApp } from '../App.jsx';
import Icon from '../components/Icon.jsx';
import VersionTabs from '../components/VersionTabs.jsx';
import PublishBar from '../components/PublishBar.jsx';
import { QlooBadge } from '../components/Qloo.jsx';
import './studio.css';

export default function Websites() {
  const { say, status } = useApp();
  const [sites, setSites] = useState(null);
  const [vid, setVid] = useState(null);
  const [prompt, setPrompt] = useState('');
  const [editOpen, setEditOpen] = useState(false);
  const [busy, setBusy] = useState('');            // 'create' | 'edit' | 'del' | 'pub'
  const site = sites?.[0] || null;

  const reload = async () => {
    try { setSites((await api.listWebsites()).websites || []); }
    catch (e) { say(e.message); setSites([]); }
  };
  useEffect(() => { reload(); }, []);

  const versions = site?.versions || [];
  const active = versions.find((v) => v.id === vid)
    || versions.find((v) => v.id === site?.activeVersion)
    || versions[versions.length - 1];

  const mergeVersion = (version) => {
    setSites((ss) => ss.map((s) => s.id === site.id
      ? { ...s, versions: [...s.versions.filter((v) => v.id !== version.id), version], activeVersion: version.id }
      : s));
    setVid(version.id);
  };

  const create = async () => {
    setBusy('create');
    try {
      const { website } = await api.createWebsite(prompt.trim() || undefined);
      await reload();
      setVid(website?.activeVersion || website?.versions?.at(-1)?.id);
      say('Your website is ready');
    } catch (e) { say(e.message); }
    setBusy('');
  };

  const edit = async (p) => {
    setBusy('edit');
    try {
      const { version } = await api.editWebsite(site.id, p || prompt.trim() || 'Refresh the design with a new variation');
      mergeVersion(version);
      setEditOpen(false); setPrompt('');
      say('New version ready');
    } catch (e) { say(e.message); }
    setBusy('');
  };

  const previewNewTab = () => {
    const blob = new Blob([active?.html || ''], { type: 'text/html' });
    window.open(URL.createObjectURL(blob), '_blank');
  };

  const delVersion = async () => {
    if (!active || versions.length <= 1) { say('Keep at least one version'); return; }
    setBusy('del');
    try {
      await api.deleteWebsiteVersion(site.id, active.id);
      setVid(null);
      await reload();
      say('Version deleted');
    } catch (e) { say(e.message); }
    setBusy('');
  };

  const publish = async (slug) => {
    setBusy('pub');
    try {
      const { publishedSlug } = await api.publishWebsite(site.id, slug);
      setSites((ss) => ss.map((s) => s.id === site.id ? { ...s, publishedSlug } : s));
      say(`Live at /s/${publishedSlug}`);
    } catch (e) { say(e.message); }
    setBusy('');
  };
  const unpublish = async () => {
    setBusy('pub');
    try {
      await api.unpublishWebsite(site.id);
      setSites((ss) => ss.map((s) => s.id === site.id ? { ...s, publishedSlug: undefined } : s));
      say('Unpublished');
    } catch (e) { say(e.message); }
    setBusy('');
  };

  // ---------- generating / empty hero ----------
  if (busy === 'create' || sites === null) {
    return (
      <div className="section">
        <div className="page-head" style={{ paddingBottom: 0 }}>
          <p className="sub" style={{ maxWidth: 'none' }}>Your site is built from your Business Profile. Feel free to edit anytime.</p>
        </div>
        <div className="gen-hero">
          <div className="icon-hero"><Icon name="site" size={28} /></div>
          <div className="big">{sites === null ? 'Loading…' : 'Generating your Website …'}</div>
          <div className="muted">This may take a few minutes.</div>
          {sites === null ? null : <div className="mt16"><div className="spinner" style={{ margin: '0 auto' }} /></div>}
        </div>
      </div>
    );
  }

  if (!site) {
    return (
      <div className="section">
        <div className="page-head" style={{ paddingBottom: 0 }}>
          <p className="sub" style={{ maxWidth: 'none' }}>Your site is built from your Business Profile. Feel free to edit anytime.</p>
        </div>
        <div className="gen-hero">
          <div className="icon-hero"><Icon name="site" size={28} /></div>
          <div className="big">Your site is built from your Business Profile</div>
          <div className="muted">Copy and imagery grounded in your taste signature — one click to a live page.</div>
          <div className="mt24">
            <input
              className="slug-in"
              style={{ width: 320, maxWidth: '80%', marginRight: 10 }}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Optional direction (e.g. bold landing for the summer drop)"
            />
            <button className="btn lime" onClick={create}><Icon name="sparkle" /> Create Website</button>
          </div>
        </div>
      </div>
    );
  }

  // ---------- site view ----------
  return (
    <div className="section" style={{ paddingBottom: 80 }}>
      <div className="page-head" style={{ textAlign: 'left', padding: '26px 0 8px' }}>
        <div className="row wrap">
          <h2 className="display" style={{ fontSize: 32, margin: 0 }}>Your Website</h2>
          <span className="grow" />
          <QlooBadge mode={status?.qloo === 'live' ? 'live' : 'demo'} />
        </div>
        <p className="sub" style={{ margin: '6px 0 0', maxWidth: 640, textAlign: 'left' }}>
          Built from your Business Profile — copy grounded in your Taste Signature.
        </p>
      </div>

      <VersionTabs
        versions={versions}
        activeId={active?.id}
        onPick={setVid}
        busy={busy === 'edit'}
        onRegenerate={() => edit('Regenerate the site with a fresh variation of layout and copy')}
      />

      <div className="toolbar mb16">
        {editOpen ? (
          <>
            <input
              className="site-prompt"
              autoFocus
              value={prompt}
              placeholder="Describe the change (e.g. darker hero, add testimonials section)…"
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && edit()}
            />
            <button className="btn lime sm" disabled={busy === 'edit'} onClick={() => edit()}>
              <Icon name="send" /> {busy === 'edit' ? 'Editing…' : 'Apply'}
            </button>
            <button className="btn ghost sm" onClick={() => setEditOpen(false)}>Cancel</button>
          </>
        ) : (
          <>
            <button className="btn ghost sm" disabled={busy === 'edit'} onClick={() => setEditOpen(true)}>
              <Icon name="edit" /> Edit
            </button>
            <button className="btn ghost sm" disabled={busy === 'edit'}
              onClick={() => edit('Regenerate the site with a fresh variation of layout and copy')}>
              <Icon name="refresh" /> Regenerate
            </button>
            <button className="btn ghost sm" onClick={previewNewTab}>
              <Icon name="eye" /> Preview in New Tab
            </button>
            <span className="grow" />
            <button className="btn ghost sm" disabled={busy === 'del'} onClick={delVersion}>
              <Icon name="trash" /> Delete version
            </button>
          </>
        )}
      </div>

      <div className="preview-frame">
        {busy === 'edit' ? (
          <div className="loading-wrap" style={{ height: '100%', background: 'var(--card)' }}>
            <div className="spinner" />
            <div className="muted">Generating a new version…</div>
          </div>
        ) : active ? (
          <iframe title="site preview" srcDoc={active.html} sandbox="allow-same-origin allow-scripts" />
        ) : (
          <div className="empty" style={{ height: '100%', background: 'var(--card)' }}>No version selected.</div>
        )}
      </div>

      <div className="mt16">
        <PublishBar
          publishedSlug={site.publishedSlug}
          base="/s/"
          label="this site"
          busy={busy === 'pub'}
          onPublish={publish}
          onUnpublish={unpublish}
        />
      </div>
    </div>
  );
}
