import React, { useEffect, useState, useRef, createContext, useContext } from 'react';
import { Routes, Route, useNavigate, useLocation, Navigate, NavLink } from 'react-router-dom';
import api from './api.js';
import Icon, { Logo } from './components/Icon.jsx';
import Onboarding from './views/Onboarding.jsx';
import DashboardPage from './views/Dashboard.jsx';
import StrategyPage from './views/Strategy.jsx';
import CampaignsPage from './views/Campaigns.jsx';
import WebsitesPage from './views/Websites.jsx';
import BrandBookPage from './views/BrandBook.jsx';

export const Ctx = createContext(null);
export const useApp = () => useContext(Ctx);

// Nav rail — the deck's always-on instrument strip. One icon+label per surface;
// gated sections stay visible but dimmed until a strategy board exists.
const RAIL = [
  { to: '/dashboard', icon: 'layout', label: 'deck' },
  { to: '/strategy', icon: 'sparkle', label: 'board' },
  { to: '/campaigns', icon: 'campaign', label: 'output', gate: true },
  { to: '/websites', icon: 'site', label: 'sites', gate: true },
  { to: '/brandbook', icon: 'book', label: 'book', gate: true },
];
function Rail() {
  const { hasStrategy, status } = useApp();
  const live = status?.qloo === 'live';
  return (
    <nav className="rail" aria-label="Studio sections">
      <NavLink to="/dashboard" className="rail-brand" title="Marque Studio — dashboard">
        <Logo size={26} />
        <span className="rail-brand-name">MARQUE</span>
      </NavLink>
      <div className="rail-nav">
        {RAIL.map((r) => (
          <NavLink key={r.to} to={r.to}
            className={({ isActive }) => `rail-link${isActive ? ' on' : ''}${r.gate && !hasStrategy ? ' locked' : ''}`}
            title={r.gate && !hasStrategy ? `${r.label} — unlocks with a strategy board` : r.label}>
            <Icon name={r.gate && !hasStrategy ? 'lock' : r.icon} size={17} />
            <span className="rl-lbl">{r.label}</span>
          </NavLink>
        ))}
      </div>
      <div className="rail-foot" title={live ? 'Qloo taste graph — live' : 'Qloo — offline / demo'}>
        <span className={`rail-lamp${live ? '' : ' off'}`} />
        <span className="rl-lbl">{live ? 'qloo live' : 'qloo'}</span>
      </div>
    </nav>
  );
}

// Small "locked" placeholder for routes gated behind a generated strategy board.
function LockedScreen() {
  const nav = useNavigate();
  return (
    <div className="locked-wrap">
      <div className="locked-ic"><Icon name="lock" size={26} /></div>
      <h2 className="display">Locked</h2>
      <p>Generate a strategy on the Strategy board first — this section unlocks once your board exists.</p>
      <button className="btn lime" onClick={() => nav('/strategy')}>
        <Icon name="sparkle" size={15} /> Go to Strategy
      </button>
    </div>
  );
}

// Gate: spinner while the board lookup is in flight, LockedScreen when confirmed
// absent, and an honest retry state when the fetch itself failed (network blip
// must not masquerade as "you have no board").
function Gate({ board, onRetry, children }) {
  if (board === undefined) {
    return <div className="loading-wrap"><div className="spinner" /></div>;
  }
  if (board === 'error') {
    return (
      <div className="locked-wrap">
        <div className="locked-ic"><Icon name="refresh" size={26} /></div>
        <h2 className="display">Can't reach the studio</h2>
        <p>The strategy board didn't respond — check the server and try again.</p>
        <button className="btn lime" onClick={onRetry}><Icon name="refresh" size={15} /> Retry</button>
      </div>
    );
  }
  return board ? children : <LockedScreen />;
}

export default function App() {
  const [profile, setProfile] = useState(undefined); // undefined = loading
  const [board, setBoard] = useState(undefined);     // undefined = loading, null = no strategy yet
  const [boards, setBoards] = useState([]);          // every plan/board summary, for switchers
  const [status, setStatus] = useState(null);
  const [toast, setToast] = useState(null);
  const nav = useNavigate();
  const loc = useLocation();

  const refresh = async () => {
    try {
      const { profile } = await api.getProfile();
      setProfile(profile);
    } catch { setProfile(null); }
  };
  const loadBoard = () => {
    setBoard((b) => (b && b !== 'error' ? b : undefined));
    api.getStrategy()
      // only fill if nothing set yet — a fresh generate() may have landed first
      .then(({ board, boards }) => {
        setBoard((b) => (b === undefined || b === 'error' ? board || null : b));
        if (Array.isArray(boards)) setBoards(boards);
      })
      .catch(() => setBoard((b) => (b === undefined ? 'error' : b)));
  };
  useEffect(() => {
    refresh();
    api.status().then(setStatus).catch(() => setStatus(null));
    loadBoard();
    api.boards()
      .then(({ boards }) => { if (Array.isArray(boards)) setBoards(boards); })
      .catch(() => {}); // older backends — the switcher simply stays empty
  }, []);
  useEffect(() => {
    if (profile === null && loc.pathname !== '/onboarding') nav('/onboarding');
  }, [profile, loc.pathname]);

  const toastT = useRef(null);
  const say = (t, ms = 3200) => {
    setToast(t);
    clearTimeout(toastT.current);
    toastT.current = setTimeout(() => setToast(null), ms);
  };

  const hasStrategy = !!board;
  // shared board activation — POST activate, then pull the full board into ctx
  const openBoard = async (id) => {
    await api.activateBoard(id);
    const { board: full } = await api.board(id);
    setBoard(full);
    return full;
  };
  const ctx = { profile, setProfile, refresh, status, say, board, setBoard, boards, setBoards, openBoard, hasStrategy };
  const inApp = !!profile;

  return (
    <Ctx.Provider value={ctx}>
      <div className={`shell${inApp && loc.pathname !== '/onboarding' ? '' : ' no-rail'}`}>
        {inApp && loc.pathname !== '/onboarding' && <Rail />}
        <div className="main">
          {profile === undefined ? (
            <div className="loading-wrap"><div className="spinner" /></div>
          ) : (
          <Routes>
            <Route path="/onboarding" element={<Onboarding />} />
            <Route path="/" element={<DashboardPage />} />
            <Route path="/dashboard" element={<DashboardPage />} />
            <Route path="/strategy/*" element={<StrategyPage />} />
            {/* retired surfaces — the pipeline runs board → output now; old
                links land on the hub instead of a dead route */}
            <Route path="/profile/*" element={<Navigate to="/dashboard" replace />} />
            <Route path="/campaigns/*" element={<Gate board={board} onRetry={loadBoard}><CampaignsPage /></Gate>} />
            <Route path="/photoshoot" element={<Navigate to="/dashboard" replace />} />
            <Route path="/websites" element={<Gate board={board} onRetry={loadBoard}><WebsitesPage /></Gate>} />
            <Route path="/brandbook" element={<Gate board={board} onRetry={loadBoard}><BrandBookPage /></Gate>} />
            <Route path="/brand-book" element={<Navigate to="/brandbook" replace />} />
            <Route path="*" element={<Navigate to={inApp ? '/dashboard' : '/onboarding'} replace />} />
          </Routes>
          )}
        </div>
      </div>
      {toast && <div className="toast" role="status" aria-live="polite">{toast}</div>}
    </Ctx.Provider>
  );
}
