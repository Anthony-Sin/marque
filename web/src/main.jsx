import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App.jsx';
import './styles.css';

// strip injected overlays — browser-extension nodes AND, when the app is
// framed inside a same-origin preview host, the host's own debug toast
// ("No Datadog session ID found" is Devin's preview wrapper, not our UI)
const TOAST_RE = /datadog session id/i;
const stripDoc = (doc) => {
  doc.querySelectorAll('[id*="datadog" i], [class*="datadog" i], [id*="dd-rum" i], [data-testid*="datadog" i]').forEach((n) => n.remove());
  doc.querySelectorAll('*').forEach((n) => {
    if (n.tagName.toLowerCase().includes('datadog')) return n.remove();
    // host-page debug toast — a fixed bottom-right overlay naming datadog
    if (n.children.length === 0 && TOAST_RE.test(n.textContent || '')) n.closest('div')?.remove();
  });
};
const stripExtOverlays = () => {
  stripDoc(document);
  try { for (let w = window; w.parent && w.parent !== w; w = w.parent) stripDoc(w.parent.document); } catch { /* cross-origin host — unreachable */ }
};
stripExtOverlays();
new MutationObserver(stripExtOverlays).observe(document.documentElement, { childList: true, subtree: true });

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { err: null };
  }
  static getDerivedStateFromError(err) { return { err }; }
  componentDidCatch(err, info) { console.error('[marque] render crash:', err, info); }
  render() {
    if (this.state.err) {
      return (
        <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', fontFamily: 'Inter, system-ui, sans-serif' }}>
          <div style={{ textAlign: 'center', maxWidth: 420 }}>
            <h2 style={{ margin: '0 0 8px' }}>Something went wrong</h2>
            <p style={{ color: '#667', fontSize: 14 }}>{String(this.state.err?.message || this.state.err)}</p>
            <button
              onClick={() => { this.setState({ err: null }); location.assign('/'); }}
              style={{ marginTop: 12, padding: '10px 18px', borderRadius: 10, border: 0, background: '#d8f34e', fontWeight: 700, cursor: 'pointer' }}
            >Back to Dashboard</button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

createRoot(document.getElementById('root')).render(
  <BrowserRouter>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </BrowserRouter>
);
