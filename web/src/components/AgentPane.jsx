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
    // optimistic assistant bubble — tokens stream into it live
    setMsgs((m) => [...m, { role: 'assistant', content: '', tools: [], streaming: true }]);
    try {
      const res = await api.agentStream(next.map((m) => ({ role: m.role, content: m.content })), (ev, data) => {
        if (ev === 'token') {
          setMsgs((m) => {
            const c = [...m];
            c[c.length - 1] = { ...c[c.length - 1], content: c[c.length - 1].content + (data?.delta || ''), thinking: false };
            return c;
          });
        } else if (ev === 'thinking') {
          setMsgs((m) => {
            const c = [...m];
            if (!c[c.length - 1].content) c[c.length - 1] = { ...c[c.length - 1], thinking: true };
            return c;
          });
        } else if (ev === 'tool') {
          const label = { qloo_search: 'Searching taste graph', qloo_insights: 'Reading affinities', update_profile: 'Patching profile' }[data?.label] || data?.label;
          setMsgs((m) => {
            const c = [...m];
            c[c.length - 1] = { ...c[c.length - 1], tools: [...(c[c.length - 1].tools || []), `${label}${data?.detail ? ` — ${data.detail}` : ''}`] };
            return c;
          });
        }
      });
      const tools = [];
      if (res?.patch) tools.push('profile updated');
      setMsgs((m) => {
        const c = [...m];
        const last = c[c.length - 1];
        c[c.length - 1] = { ...last, content: res?.reply || last.content || 'Done.', tools: [...(last.tools || []), ...tools], streaming: false };
        return c;
      });
      if (res?.patch) await refresh();
    } catch (e) {
      setMsgs((m) => {
        const c = [...m];
        c[c.length - 1] = { ...c[c.length - 1], content: `Something went wrong — ${e.message}. Try again?`, streaming: false };
        return c;
      });
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
        <QlooBadge mode={status?.qloo === 'live' ? 'live' : 'off'} label="Qloo API" />
      </div>
      <div className="agent-body" ref={bodyRef}>
        {msgs.map((m, i) => (
          <div key={i} className={`msg ${m.role === 'user' ? 'user' : 'bot'}${m.streaming ? ' streaming' : ''}`}>
            {m.thinking && !m.content && <span className="think-note">reasoning…</span>}
            {m.content || (m.streaming ? ' ' : '')}
            {m.streaming && <span className="caret" />}
            {!!m.tools?.length && (
              <div className="tools">
                {m.tools.map((t, j) => <span key={j} className="tool-chip">{t}</span>)}
              </div>
            )}
          </div>
        ))}
        {busy && !msgs.at(-1)?.streaming && (
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
