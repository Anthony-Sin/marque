import React, { useEffect, useState, useRef, createContext, useContext } from 'react';
import { Routes, Route, useNavigate, useLocation, Navigate } from 'react-router-dom';
import api from './api.js';
import Icon from './components/Icon.jsx';
import Wayfind from './components/Wayfind.jsx';
import Onboarding from './views/Onboarding.jsx';
import DashboardPage from './views/Dashboard.jsx';
import ProfilePage from './views/Profile.jsx';
import StrategyPage from './views/Strategy.jsx';
import CampaignsPage from './views/Campaigns.jsx';
import PhotoshootPage from './views/Photoshoot.jsx';
import WebsitesPage from './views/Websites.jsx';
import BrandBookPage from './views/BrandBook.jsx';

export const Ctx = createContext(null);
export const useApp = () => useContext(Ctx);

// No persistent nav chrome — the Dashboard is the hub and every other view
// offers a quiet "← Dashboard" wayfinding link at its top-left instead.
// Locked routes still gate on ctx.board (see Gate below).

// Small "locked" placeholder for routes gated behind a generated strategy board.
function LockedScreen() {
  const nav = useNavigate();
  return (
    <>
      <div className="section"><Wayfind /></div>
      <div className="locked-wrap" style={{ paddingTop: 60 }}>
        <div className="locked-ic"><Icon name="lock" size={26} /></div>
        <h2 className="display">Locked</h2>
        <p>Generate a strategy on the Strategy board first — this section unlocks once your board exists.</p>
        <button className="btn lime" onClick={() => nav('/strategy')}>
          <Icon name="sparkle" size={15} /> Go to Strategy
        </button>
      </div>
    </>
  );
}

// Gate: spinner while the board lookup is in flight, LockedScreen when confirmed absent.
function Gate({ board, children }) {
  if (board === undefined) {
    return <div className="loading-wrap"><div className="spinner" /></div>;
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
  useEffect(() => {
    refresh();
    api.status().then(setStatus).catch(() => setStatus(null));
    api.getStrategy()
      // only fill if nothing set yet — a fresh generate() may have landed first
      .then(({ board, boards }) => {
        setBoard((b) => (b === undefined ? board || null : b));
        if (Array.isArray(boards)) setBoards(boards);
      })
      .catch(() => setBoard(null));
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
      <div className="shell">
        <div className="main">
          {profile === undefined ? (
            <div className="loading-wrap"><div className="spinner" /></div>
          ) : (
          <Routes>
            <Route path="/onboarding" element={<Onboarding />} />
            <Route path="/" element={<DashboardPage />} />
            <Route path="/dashboard" element={<DashboardPage />} />
            <Route path="/strategy/*" element={<StrategyPage />} />
            <Route path="/profile/*" element={<Gate board={board}><ProfilePage /></Gate>} />
            <Route path="/campaigns/*" element={<Gate board={board}><CampaignsPage /></Gate>} />
            <Route path="/photoshoot" element={<Gate board={board}><PhotoshootPage /></Gate>} />
            <Route path="/websites" element={<Gate board={board}><WebsitesPage /></Gate>} />
            <Route path="/brandbook" element={<Gate board={board}><BrandBookPage /></Gate>} />
            <Route path="*" element={<Navigate to={inApp ? '/dashboard' : '/onboarding'} replace />} />
          </Routes>
          )}
        </div>
      </div>
      {toast && <div className="toast">{toast}</div>}
    </Ctx.Provider>
  );
}
