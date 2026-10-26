import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api.js';
import { useApp } from '../App.jsx';
import Icon, { Logo } from '../components/Icon.jsx';
import { QlooBadge } from '../components/Qloo.jsx';
import './onboarding.css';

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

// Honest link lamps — each LED reports a real status probe from ctx, never a
// decorative "on". `mode` drives color: on=teal (live), warn=amber, err=rose.
function Led({ mode = 'off', label, title }) {
  return (
    <span className={`ob-led ${mode}`} title={title || label}>
      <i />{label}
    </span>
  );
}

// The status cluster shown under the hero and in the chat head — agent link,
// taste graph, image engine. Same vocabulary as the nav rail LEDs.
function StatusLeds({ status, agentMode }) {
  const agentOk = status?.agent ? status.agent.ok : (status?.tensor || status?.devin);
  const agent = agentMode || (agentOk ? 'on' : 'warn');
  return (
    <div className="ob-leds">
      <Led mode={agent} label={`AGENT ${agent === 'on' ? 'READY' : agent === 'busy' ? 'LIVE' : agent === 'err' ? 'ERR' : 'OFFLINE'}`}
        title={status?.agent ? `Chat brain: ${status.agent.model || status.agent.provider}${status.agent.ok ? '' : ` — down (${status.agent.error || 'unreachable'})`}` : agentOk ? 'Chat backend configured' : 'No chat backend configured — agent replies will fail'} />
      <Led mode={status?.qloo === 'live' ? 'on' : 'off'} label={`TASTE ${status?.qloo === 'live' ? 'LIVE' : 'OFF'}`}
        title={status?.qlooNote || 'Taste graph'} />
      <Led mode={status?.localgen?.ok ? 'on' : 'off'} label={`GEN ${status?.localgen?.ok ? 'OK' : 'STBY'}`}
        title="Local image engine" />
    </div>
  );
}

export default function Onboarding() {
  const { refresh, status, say } = useApp();
  const nav = useNavigate();
  const [url, setUrl] = useState('');
  const [listing, setListing] = useState(true);
  const [phase, setPhase] = useState('idle'); // idle | building | chat | error
  const [err, setErr] = useState('');
  const [stage, setStage] = useState(0);
  const [tplBusy, setTplBusy] = useState(null);
  const [hasProfile, setHasProfile] = useState(false);

  useEffect(() => {
    api.getProfile().then((d) => setHasProfile(!!d?.profile)).catch(() => {});
  }, []);

  const finish = async () => {
    await refresh();
    nav('/strategy');   // strategy board is the app's landing + unlocks the rest
  };

  const build = async () => {
    const u = url.trim();
    if (!u) return say('Enter your website URL first');
    setPhase('building');
    setErr('');
    setStage(0);
    const timer = setInterval(() => setStage((s) => (s < STAGES.length - 1 ? s + 1 : s)), 2600);
    try {
      await api.buildProfile(/^https?:\/\//i.test(u) ? u : `https://${u}`, listing);
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
  if (phase === 'chat') {
    return (
      <AgentChat
        status={status}
        hasProfile={hasProfile}
        onClose={() => setPhase('idle')}
        onDone={finish}
      />
    );
  }

  return (
    <div className="ob-wrap">
      <div className="ob-col">
        <header className="ob-hero">
          <Logo size={44} />
          <span className="vh-kicker">MARQUE / FIRST RUN</span>
          <h1 className="display">Build your brand</h1>
          <p className="sub">
            Point Marque at your site and it drafts your brand DNA — voice, palette,
            and your audience&apos;s taste — ready for boards, output and sites.
          </p>
          <StatusLeds status={status} />
        </header>

        <section className="card hud ob-panel">
          <div className="zone-head">
            <span className="z-id">01</span>Scan a site
            <span className="z-tag">{hasProfile ? 'replaces current profile' : 'primary path'}</span>
          </div>
          <div className="ob-panel-body">
            <div className="ob-url-row">
              <input
                className="ob-url-input"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && build()}
                placeholder="https://yourbusiness.com"
                aria-label="Your website URL"
                autoFocus
              />
              <button type="button" className="btn lime ob-build-btn" onClick={build}>
                <Icon name="sparkle" size={15} /> Generate profile
              </button>
            </div>
            <label className="ob-check">
              <input type="checkbox" checked={listing} onChange={(e) => setListing(e.target.checked)} />
              <span>Include public business-listing details when available</span>
            </label>
            {hasProfile && (
              <div className="ob-note">
                <Icon name="info" size={13} />
                <span className="grow">
                  A Business Profile already exists — generating a new one replaces it.
                </span>
                <button type="button" className="btn ghost sm" onClick={() => nav('/dashboard')}>Open the deck →</button>
              </div>
            )}
            {phase === 'error' && (
              <div className="ob-error" role="alert">
                <Icon name="x" size={14} />
                <span className="grow">{err || 'Something went wrong.'}</span>
                <button type="button" className="btn ghost sm" onClick={build}>
                  <Icon name="refresh" size={13} /> Retry
                </button>
              </div>
            )}
          </div>
        </section>

        <div className="zone-head ob-div">
          <span className="z-id">02</span>No site? Other ways in
        </div>

        <div className="ob-alt">
          <section className="card ob-opt">
            <div className="ob-opt-k"><Icon name="send" size={13} />Agent interview</div>
            <h4>Build from scratch</h4>
            <p>A few questions about what you do and who it&apos;s for — the agent writes your brand DNA as you talk.</p>
            <button type="button" className="btn ghost" onClick={() => setPhase('chat')}>
              Open chat <Icon name="chevron-down" size={12} />
            </button>
          </section>
          <section className="card ob-opt">
            <div className="ob-opt-k"><Icon name="layout" size={13} />Template</div>
            <h4>Start from a template</h4>
            <p>Pick a ready-made brand and make it yours.</p>
            <div className="ob-tpls">
              {TEMPLATES.map((t) => (
                <button key={t.id} type="button" className="ob-tpl" onClick={() => useTemplate(t.id)} disabled={!!tplBusy} title={t.tagline}>
                  <span className="ob-tpl-sw">{t.colors.map((c) => <i key={c} style={{ background: c }} />)}</span>
                  <b>{tplBusy === t.id ? <><span className="spinner" /> Building…</> : t.name}</b>
                  <span className="ob-tpl-cat">{t.cat}</span>
                </button>
              ))}
            </div>
          </section>
        </div>

        <footer className="ob-foot">
          <span className="ob-fine">Marque can make mistakes — review your profile before generating.</span>
          {hasProfile && (
            <button type="button" className="ob-skip" onClick={() => nav('/dashboard')}>
              skip setup — open the deck →
            </button>
          )}
        </footer>
      </div>
    </div>
  );
}

// ---------- staged build loader ----------
function Building({ stage, status, url }) {
  let host = url;
  try { host = new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`).host; } catch { /* keep raw */ }
  return (
    <div className="ob-wrap">
      <div className="ob-col">
        <section className="card hud ob-build">
          <div className="zone-head">
            <span className="z-id">RUN</span>Building profile
            <span className="z-tag">{host || 'scanning'}</span>
          </div>
          <div className="ob-build-body">
            <div className="spinner" />
            <h2 className="display">Building your brand profile</h2>
            <div className="ob-stages">
              {STAGES.map((s, i) => (
                <div key={i} className={`ob-stage${i < stage ? ' done' : ''}${i === stage ? ' now' : ''}`}>
                  <span className="ob-stage-ic">
                    {i < stage ? <Icon name="check" size={13} sw={2.4} />
                      : i === stage ? <span className="spinner pf-spin-xs" />
                        : <Icon name={s.icon} size={13} />}
                  </span>
                  <span className="grow">{s.label}</span>
                  {s.qloo && i === stage && <QlooBadge mode={status?.qloo === 'live' ? 'live' : 'off'} label="Taste graph" />}
                  <span className="ob-stage-st">{i < stage ? 'DONE' : i === stage ? 'RUN' : 'WAIT'}</span>
                </div>
              ))}
            </div>
            <p className="ob-build-note">reading {url} — this can take a minute</p>
          </div>
        </section>
      </div>
    </div>
  );
}

// ---------- agent interview — streamed via /api/agent/stream (SSE) ----------
// The wire gets a hidden context turn first so the general brand agent knows
// this is a cold start; the visible transcript never shows it.
const GREET = 'Tell me about your business — what do you sell, who is it for, and what should it feel like?';
const SEED = [
  '[setup context — not a user turn]',
  'This is Marque first-run onboarding: the user has no website and wants to build a brand DNA profile by chatting.',
  'Interview them briefly — one or two short questions per reply — about what the business does, who it is for, and the vibe.',
  'As soon as you have enough, save it with the update_profile tool. Patch fields: name, tagline, description, tone[4-7], values[3-6], audience, colors{primary,secondary,accent,background,surface,text} as #rrggbb, fonts{heading,body}.',
  'After the tool succeeds, confirm what you saved in one short paragraph.',
].join(' ');
// stream watchdog — the SSE heartbeat keeps the socket alive, so a silent
// model stall would otherwise leave the composer spinning forever
const AGENT_TIMEOUT = 150000;

function AgentChat({ status, hasProfile, onClose, onDone }) {
  const { refresh } = useApp();
  const [msgs, setMsgs] = useState([{ role: 'assistant', content: GREET }]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState(null);      // in-flight reply {text, thinking, tools[]}
  const [chatErr, setChatErr] = useState('');    // honest failure + retry below
  const [saved, setSaved] = useState([]);        // profile fields the agent has written
  const msgsRef = useRef(msgs);
  const liveRef = useRef(true);
  const bodyRef = useRef(null);
  const inRef = useRef(null);

  useEffect(() => { msgsRef.current = msgs; }, [msgs]);
  useEffect(() => () => { liveRef.current = false; }, []);
  useEffect(() => { inRef.current?.focus({ preventScroll: true }); }, []);
  useEffect(() => {
    const k = (e) => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  useEffect(() => {
    bodyRef.current?.scrollTo({ top: bodyRef.current.scrollHeight, behavior: 'smooth' });
  }, [msgs, draft, busy, chatErr, saved]);

  const wireFor = (list) => [
    { role: 'user', content: SEED },
    ...list.map((m) => ({ role: m.role, content: m.content })),
  ];

  const run = async (list) => {
    setBusy(true);
    setChatErr('');
    let acc = ''; let think = ''; let tools = [];
    setDraft({ text: '', thinking: '', tools: [] });
    try {
      const final = await Promise.race([
        api.agentStream(wireFor(list), (ev, data) => {
          if (!liveRef.current) return;
          if (ev === 'token') {
            acc += data?.delta || '';
            setDraft({ text: acc, thinking: think, tools });
          } else if (ev === 'thinking') {
            think += data?.delta || '';
            setDraft({ text: acc, thinking: think.slice(-400), tools });
          } else if (ev === 'tool') {
            tools = [...tools, { label: data?.label || 'tool', detail: data?.detail || '' }];
            setDraft({ text: acc, thinking: think, tools });
          }
        }),
        new Promise((_, rej) => setTimeout(() => rej(new Error('the agent went quiet — no reply inside 2½ minutes')), AGENT_TIMEOUT)),
      ]);
      // a stream that closes with no 'done' frame AND no tokens is a failure,
      // not an empty success — surface it as a retryable error
      if (!final && !acc) throw new Error('stream closed without a reply');
      const reply = String(final?.reply || acc || '').trim() || 'Done.';
      if (!liveRef.current) return;
      setMsgs((m) => [...m, { role: 'assistant', content: reply, tools }]);
      const fields = final?.patch && typeof final.patch === 'object' ? Object.keys(final.patch) : [];
      if (fields.length) {
        setSaved((s) => [...new Set([...s, ...fields])]);
        refresh?.().catch(() => {});
      }
    } catch (e) {
      if (liveRef.current) setChatErr(String(e?.message || e || 'stream failed'));
    } finally {
      if (liveRef.current) { setDraft(null); setBusy(false); }
    }
  };

  const send = () => {
    const text = input.trim();
    if (!text || busy) return;
    const next = [...msgsRef.current, { role: 'user', content: text }];
    setMsgs(next);
    setInput('');
    if (inRef.current) inRef.current.style.height = 'auto';
    run(next);
  };
  // retry replays the transcript as-is — the failed user turn is already in it
  const retry = () => { if (!busy) run(msgsRef.current); };

  const autosize = (e) => {
    setInput(e.target.value);
    e.target.style.height = 'auto';
    e.target.style.height = `${Math.min(e.target.scrollHeight, 128)}px`;
  };

  const agentMode = chatErr ? 'err' : busy ? 'busy' : 'on';

  return (
    <div className="ob-chat">
      <header className="ob-chat-head">
        <button type="button" className="ob-back" onClick={onClose}>
          <span className="ob-back-arrow">←</span> back
        </button>
        <div className="ob-chat-title">
          <span className="vh-kicker">MARQUE / AGENT</span>
          <b>Brand interview</b>
        </div>
        <div className="ob-chat-leds">
          <Led mode={agentMode} label={`LINK ${chatErr ? 'ERR' : busy ? 'LIVE' : 'IDLE'}`}
            title={chatErr ? 'Last reply failed — retry below' : busy ? 'Streaming a reply' : 'Agent link standing by'} />
          <Led mode={status?.qloo === 'live' ? 'on' : 'off'} label={`TASTE ${status?.qloo === 'live' ? 'LIVE' : 'OFF'}`} title="Taste graph" />
        </div>
        <button type="button" className="icon-btn" onClick={onClose} aria-label="Close chat">
          <Icon name="x" size={14} />
        </button>
      </header>

      <div className="ob-chat-body" ref={bodyRef} role="log" aria-label="Agent transcript">
        {hasProfile && (
          <p className="ob-chat-note">
            heads up — a profile already exists on this deck; the agent edits it live as you talk.
          </p>
        )}
        {msgs.map((m, i) => (
          <div key={i} className={`msg ${m.role === 'user' ? 'user' : 'bot'}`}>
            {m.content}
            {!!m.tools?.length && (
              <div className="tools">
                {m.tools.map((t, j) => <span key={j} className="tool-chip" title={t.detail}>{t.label}</span>)}
              </div>
            )}
          </div>
        ))}
        {draft && !!(draft.text || draft.thinking || draft.tools?.length) && (
          <div className="msg bot streaming">
            {!!draft.thinking && !draft.text && (
              <span className="think-note">reasoning…</span>
            )}
            {draft.text}
            <span className="caret" />
            {!!draft.tools?.length && (
              <div className="tools">
                {draft.tools.map((t, j) => <span key={j} className="tool-chip" title={t.detail}>{t.label}</span>)}
              </div>
            )}
            {!!draft.thinking && (
              <div className="ob-think-tail">{draft.thinking.slice(-180)}</div>
            )}
          </div>
        )}
        {busy && !draft?.text && !draft?.thinking && !draft?.tools?.length && (
          <div className="msg bot pf-typing" aria-label="Agent is working">
            <span className="pf-dot" /><span className="pf-dot" /><span className="pf-dot" />
          </div>
        )}
      </div>

      {!!saved.length && (
        <div className="ob-ready" role="status">
          <span className="ob-led on"><i /></span>
          <div className="grow">
            <b>PROFILE SAVED</b>
            <span className="ob-ready-f">{saved.join(' · ')}</span>
          </div>
          <button type="button" className="btn lime sm" onClick={onDone}>Enter the deck →</button>
        </div>
      )}

      {!!chatErr && (
        <div className="ob-error ob-chat-err" role="alert">
          <Icon name="x" size={14} />
          <span className="grow">reply lost — {chatErr}</span>
          <button type="button" className="btn ghost sm" onClick={retry}>
            <Icon name="refresh" size={13} /> Retry
          </button>
        </div>
      )}

      <div className="ob-composer">
        <textarea
          ref={inRef}
          className="ob-chat-in"
          rows={1}
          value={input}
          placeholder="Describe your business…"
          aria-label="Message the brand agent — Enter sends, Shift+Enter adds a line"
          onChange={autosize}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
        />
        <button type="button" className="ob-send" onClick={send} disabled={busy || !input.trim()} title="Send" aria-label="Send">
          <Icon name="send" size={16} />
        </button>
      </div>
      <div className="ob-chat-foot">ENTER ↵ send · SHIFT+ENTER newline{saved.length ? '' : ' · the agent saves your profile when it has enough'}</div>
    </div>
  );
}
