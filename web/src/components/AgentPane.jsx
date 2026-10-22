import React, { useEffect, useRef, useState } from 'react';
import api from '../api.js';
import { useApp } from '../App.jsx';
import Icon from './Icon.jsx';
import { QlooBadge } from './Qloo.jsx';

// Right-rail chat with the profile-editing agent (POST /api/agent).
// Shows replies + returned tool chips (msg.tools); when the response carries a
// `patch`, the server already applied it — we ctx.refresh() to pull the new profile.
export default function AgentPane() {
  const { status, refresh } = useApp() || {};
  const [msgs, setMsgs] = useState([
    {
      role: 'assistant',
      content: "Hey — I'm the Marque agent. Ask me to tune your brand voice, swap palette colors, rewrite the tagline, or draft copy.",
    },
  ]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const bodyRef = useRef(null);

  useEffect(() => {
    bodyRef.current?.scrollTo({ top: bodyRef.current.scrollHeight, behavior: 'smooth' });
  }, [msgs, busy]);

  const send = async () => {
    const text = input.trim();
    if (!text || busy) return;
    const next = [...msgs, { role: 'user', content: text }];
    setMsgs(next);
    setInput('');
    setBusy(true);
    try {
      const res = await api.agent(next.map((m) => ({ role: m.role, content: m.content })));
      const tools = [];
      if (Array.isArray(res.tools)) tools.push(...res.tools);
      if (res.patch) tools.push('profile updated');
      setMsgs((m) => [...m, { role: 'assistant', content: res.reply || 'Done.', tools }]);
      if (res.patch) await refresh();
    } catch (e) {
      setMsgs((m) => [...m, { role: 'assistant', content: `Something went wrong — ${e.message}. Try again?` }]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <aside className="agent-pane">
      <div className="agent-head">
        <Icon name="sparkle" size={16} />
        Marque Agent
        <span className="grow" />
        <QlooBadge mode={status?.qloo === 'live' ? 'live' : 'demo'} />
      </div>
      <div className="agent-body" ref={bodyRef}>
        {msgs.map((m, i) => (
          <div key={i} className={`msg ${m.role === 'user' ? 'user' : 'bot'}`}>
            {m.content}
            {!!m.tools?.length && (
              <div className="tools">
                {m.tools.map((t, j) => <span key={j} className="tool-chip">{t}</span>)}
              </div>
            )}
          </div>
        ))}
        {busy && (
          <div className="msg bot pf-typing" aria-label="thinking">
            <span className="pf-dot" /><span className="pf-dot" /><span className="pf-dot" />
          </div>
        )}
      </div>
      <div className="agent-input">
        <input
          value={input}
          placeholder="Ask Marque to edit your profile…"
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && send()}
        />
        <button type="button" className="send" onClick={send} disabled={busy || !input.trim()} title="Send">
          {busy ? <span className="spinner" /> : <Icon name="send" size={17} />}
        </button>
      </div>
    </aside>
  );
}
