import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api.js';
import { useApp } from '../App.jsx';
import Icon, { Logo } from '../components/Icon.jsx';
import { QlooBadge } from '../components/Qloo.jsx';
import Modal from '../components/Modal.jsx';

const STAGES = [
  { icon: 'globe', label: 'Scanning your site…' },
  { icon: 'sparkle', label: 'Reading your voice…' },
  { icon: 'qloo', label: "Matching your audience's taste…", qloo: true },
];

const TEMPLATES = [
  {
    id: 'aurora-roast', name: 'Aurora Roast', cat: 'Specialty coffee roaster',
    tagline: 'Small-batch coffee, roasted at first light.',
    colors: ['#6f4e37', '#c9a87c', '#e07a5f'],
  },
  {
    id: 'driftline', name: 'Driftline', cat: 'Coastal surf shop',
    tagline: 'Surf goods built for the long ride.',
    colors: ['#0d5c63', '#7fb6b9', '#f2a65a'],
  },
  {
    id: 'petal-and-stem', name: 'Petal & Stem', cat: 'Boutique florist',
    tagline: 'Wild, garden-grown florals for every day.',
    colors: ['#7d4f5e', '#d9a7b0', '#e8c547'],
  },
];

export default function Onboarding() {
  const { refresh, status, say } = useApp();
  const nav = useNavigate();
  const [url, setUrl] = useState('');
  const [listing, setListing] = useState(true);
  const [phase, setPhase] = useState('idle'); // idle | building | error
  const [err, setErr] = useState('');
  const [stage, setStage] = useState(0);
  const [altOpen, setAltOpen] = useState(false);
  const [scratchOpen, setScratchOpen] = useState(false);
  const [tplBusy, setTplBusy] = useState(null);

  const finish = async () => {
    await refresh();
    nav('/profile');
  };

  const build = async () => {
    const u = url.trim();
    if (!u) return say('Enter your website URL first');
    setPhase('building');
    setErr('');
    setStage(0);
    const timer = setInterval(() => setStage((s) => (s < STAGES.length - 1 ? s + 1 : s)), 2600);
    try {
      await api.buildProfile(/^https?:\/\//i.test(u) ? u : `https://${u}`);
      await finish();
    } catch (e) {
      setErr(e.message || 'build failed');
      say(`Couldn't build your profile — ${e.message}`);
      setPhase('error');
    } finally {
      clearInterval(timer);
    }
    return undefined;
  };

  const useTemplate = async (id) => {
    if (tplBusy) return;
    setTplBusy(id);
    try {
      await api.templateProfile(id);
      await finish();
    } catch (e) {
      say(`Template failed — ${e.message}`);
    } finally {
      setTplBusy(null);
    }
  };

  if (phase === 'building') return <Building stage={stage} status={status} url={url} />;

  return (
    <div className="ob-wrap">
      <div className="ob-hero">
        <Logo size={54} />
        <h1 className="display">Let&apos;s build your brand</h1>
        <p className="sub">
          Point Marque at your website and we&apos;ll draft your brand DNA — voice, palette,
          and your audience&apos;s taste — ready for campaigns, photoshoots and sites.
        </p>
      </div>

      <div className="card pad ob-url-card">
        <div className="ob-url-title">Enter your website</div>
        <div className="ob-url-row">
          <input
            className="ob-url-input"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && build()}
            placeholder="https://yourbusiness.com"
            autoFocus
          />
          <button type="button" className="btn lime" onClick={build}>
            <Icon name="sparkle" size={15} /> Generate Business Profile
          </button>
        </div>
        <label className="ob-check">
          <input type="checkbox" checked={listing} onChange={(e) => setListing(e.target.checked)} />
          <span>Include public business-listing details when available</span>
        </label>
        {phase === 'error' && (
          <div className="ob-error">
            <Icon name="x" size={14} />
            <span className="grow">{err || 'Something went wrong.'}</span>
            <button type="button" className="btn ghost sm" onClick={build}>
              <Icon name="refresh" size={13} /> Retry
            </button>
          </div>
        )}
      </div>

      <button type="button" className="ob-noSite" onClick={() => setAltOpen((o) => !o)}>
        {altOpen ? 'Hide options' : 'No website yet?'}
        <Icon name={altOpen ? 'x' : 'plus'} size={13} />
      </button>

      {altOpen && (
        <div className="ob-alt">
          <div className="card pad ob-opt">
            <Icon name="sparkle" size={20} />
            <h4>Build from scratch</h4>
            <p>Chat with the Marque agent — a few questions about what you do and who it&apos;s for, and we&apos;ll draft your brand DNA.</p>
            <button type="button" className="btn ghost" onClick={() => setScratchOpen(true)}>Start chatting</button>
          </div>
          <div className="card pad ob-opt">
            <Icon name="layout" size={20} />
            <h4>Use a template</h4>
            <p>Start from a ready-made brand and make it yours.</p>
            <div className="ob-tpls">
              {TEMPLATES.map((t) => (
                <button key={t.id} type="button" className="ob-tpl" onClick={() => useTemplate(t.id)} disabled={!!tplBusy} title={t.tagline}>
                  <span className="ob-tpl-sw">{t.colors.map((c) => <i key={c} style={{ background: c }} />)}</span>
                  <b>{tplBusy === t.id ? <><span className="spinner" /> Building…</> : t.name}</b>
                  <span className="ob-tpl-cat">{t.cat}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      <div className="disclaimer">Marque can make mistakes — review your profile before generating.</div>

      {scratchOpen && (
        <ScratchChat
          onClose={() => setScratchOpen(false)}
          onDone={async () => { setScratchOpen(false); await finish(); }}
          say={say}
        />
      )}
    </div>
  );
}

// ---------- staged build loader ----------
function Building({ stage, status, url }) {
  return (
    <div className="ob-wrap">
      <div className="loading-wrap" style={{ padding: '40px 20px' }}>
        <div className="spinner" />
        <h2 className="display" style={{ fontSize: 26 }}>Building your brand profile</h2>
        <div className="ob-stages">
          {STAGES.map((s, i) => (
            <div key={i} className={`ob-stage${i < stage ? ' done' : ''}${i === stage ? ' now' : ''}`}>
              <span className="ob-stage-ic">
                {i < stage ? <Icon name="check" size={13} sw={2.4} />
                  : i === stage ? <span className="spinner pf-spin-xs" />
                    : <Icon name={s.icon} size={13} />}
              </span>
              <span>{s.label}</span>
              {s.qloo && i === stage && <QlooBadge mode={status?.qloo === 'live' ? 'live' : 'demo'} />}
            </div>
          ))}
        </div>
        <p className="muted small">Reading {url} — this can take a minute.</p>
      </div>
    </div>
  );
}

// ---------- chat-driven scratch builder ----------
function ScratchChat({ onClose, onDone, say }) {
  const [msgs, setMsgs] = useState([
    { role: 'assistant', content: 'Tell me about your business — what do you sell, who is it for, and what should it feel like? You can also attach a logo or product shots.' },
  ]);
  const [input, setInput] = useState('');
  const [atts, setAtts] = useState([]); // staged {name,mime,dataB64}
  const [busy, setBusy] = useState(false);
  const fileRef = useRef(null);
  const bodyRef = useRef(null);

  useEffect(() => {
    bodyRef.current?.scrollTo({ top: bodyRef.current.scrollHeight, behavior: 'smooth' });
  }, [msgs, busy, atts]);

  const readB64 = (file) => new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve({
      name: file.name,
      mime: file.type || 'application/octet-stream',
      dataB64: String(r.result || '').split(',')[1] || '',
    });
    r.onerror = reject;
    r.readAsDataURL(file);
  });

  const onPick = async (e) => {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    if (!files.length) return;
    try {
      const read = await Promise.all(files.map(readB64));
      setAtts((a) => [...a, ...read]);
    } catch {
      say('Could not read that file');
    }
  };

  const send = async () => {
    const text = input.trim();
    if ((!text && !atts.length) || busy) return;
    const attach = atts;
    const userMsg = {
      role: 'user',
      content: text || 'Here are some brand references to work from.',
      attNames: attach.map((a) => a.name),
    };
    const next = [...msgs, userMsg];
    setMsgs(next);
    setInput('');
    setAtts([]);
    setBusy(true);
    try {
      const res = await api.scratchProfile(
        next.map((m) => ({ role: m.role, content: m.content })),
        attach.length ? attach.map(({ name, mime, dataB64 }) => ({ name, mime, dataB64 })) : undefined,
      );
      if (res.profile) {
        say('Profile built — welcome to your brand.');
        await onDone();
        return;
      }
      setMsgs((m) => [...m, { role: 'assistant', content: res.reply || 'Tell me a bit more.' }]);
    } catch (e) {
      setMsgs((m) => [...m, { role: 'assistant', content: `Hmm, that didn't work — ${e.message}. Try again?` }]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="Build from scratch" onClose={onClose} width={640}>
      <div className="ob-scratch">
        <div className="ob-scratch-body" ref={bodyRef}>
          {msgs.map((m, i) => (
            <div key={i} className={`msg ${m.role === 'user' ? 'user' : 'bot'}`}>
              {m.content}
              {!!m.attNames?.length && (
                <div className="tools">
                  {m.attNames.map((n, j) => <span key={j} className="tool-chip">{n}</span>)}
                </div>
              )}
            </div>
          ))}
          {busy && (
            <div className="msg bot pf-typing">
              <span className="pf-dot" /><span className="pf-dot" /><span className="pf-dot" />
            </div>
          )}
        </div>
        {!!atts.length && (
          <div className="ob-atts">
            {atts.map((a, i) => (
              <span key={i} className="chip">
                <Icon name="image" size={12} /> {a.name}
                <button type="button" onClick={() => setAtts(atts.filter((_, j) => j !== i))} aria-label="Remove attachment">✕</button>
              </span>
            ))}
          </div>
        )}
        <div className="ob-scratch-input">
          <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={onPick} />
          <button type="button" className="icon-btn" title="Attach brand images" onClick={() => fileRef.current?.click()}>
            <Icon name="upload" size={15} />
          </button>
          <input
            value={input}
            placeholder="Describe your business…"
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && send()}
          />
          <button type="button" className="send" onClick={send} disabled={busy || (!input.trim() && !atts.length)} title="Send">
            <Icon name="send" size={16} />
          </button>
        </div>
      </div>
    </Modal>
  );
}
