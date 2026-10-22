import React, { useEffect, useState, useRef, createContext, useContext } from 'react';
import { Routes, Route, NavLink, useNavigate, useLocation, Navigate } from 'react-router-dom';
import api from './api.js';
import Icon, { Logo } from './components/Icon.jsx';
import Onboarding from './views/Onboarding.jsx';
import ProfilePage from './views/Profile.jsx';
import StrategyPage from './views/Strategy.jsx';
import CampaignsPage from './views/Campaigns.jsx';
import PhotoshootPage from './views/Photoshoot.jsx';
import WebsitesPage from './views/Websites.jsx';
import BrandBookPage from './views/BrandBook.jsx';

export const Ctx = createContext(null);
export const useApp = () => useContext(Ctx);

const NAV = [
  { group: 'Plan', items: [
    { to: '/strategy', icon: 'sparkle', label: 'Strategy' },
    { to: '/profile', icon: 'dna', label: 'Business', sub: ['Overview', 'Catalog', 'Assets'] },
  ] },
  { group: 'Create', items: [
    { to: '/campaigns', icon: 'campaign', label: 'Campaigns' },
    { to: '/photoshoot', icon: 'photo', label: 'Photoshoot' },
  ] },
  { group: 'Publish', items: [
    { to: '/brandbook', icon: 'book', label: 'Brand Book' },
    { to: '/websites', icon: 'site', label: 'Websites' },
  ] },
];

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
      .then(({ board }) => setBoard((b) => (b === undefined ? board || null : b)))
      .catch(() => setBoard(null));
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
  const ctx = { profile, setProfile, refresh, status, say, board, setBoard, hasStrategy };
  const inApp = !!profile;

  return (
    <Ctx.Provider value={ctx}>
      <div className="shell">
        {inApp && (
          <nav className="rail">
            <div className="logo" title="Marque"><Logo size={40} /></div>
            {NAV.map((g) => (
              <React.Fragment key={g.group}>
                <span className="rail-group">{g.group}</span>
                {g.items.map((n) => {
                  const locked = n.to !== '/strategy' && !board;
                  if (locked) {
                    return (
                      <button key={n.to} type="button" className="rail-item locked"
                        title="Generate a strategy first" onClick={() => nav('/strategy')}>
                        <Icon name={n.icon} />
                        <span className="lbl">{n.label.split(' ')[0]}</span>
                        <span className="rail-lock"><Icon name="lock" size={9} sw={2.4} /></span>
                      </button>
                    );
                  }
                  return (
                    <NavLink key={n.to} to={n.to} className={({ isActive }) => `rail-item${isActive ? ' active' : ''}`} title={n.label}>
                      <Icon name={n.icon} />
                      <span className="lbl">{n.label.split(' ')[0]}</span>
                    </NavLink>
                  );
                })}
              </React.Fragment>
            ))}
          </nav>
        )}
        <div className="main">
          {inApp && (
            <div className="topbar">
              <div className="brand"><Logo size={22} /> Marque <span className="exp">STUDIO</span></div>
            </div>
          )}
          {profile === undefined ? (
            <div className="loading-wrap"><div className="spinner" /></div>
          ) : (
          <Routes>
            <Route path="/onboarding" element={<Onboarding />} />
            <Route path="/" element={<Navigate to="/strategy" replace />} />
            <Route path="/strategy/*" element={<StrategyPage />} />
            <Route path="/profile/*" element={<Gate board={board}><ProfilePage /></Gate>} />
            <Route path="/campaigns/*" element={<Gate board={board}><CampaignsPage /></Gate>} />
            <Route path="/photoshoot" element={<Gate board={board}><PhotoshootPage /></Gate>} />
            <Route path="/websites" element={<Gate board={board}><WebsitesPage /></Gate>} />
            <Route path="/brandbook" element={<Gate board={board}><BrandBookPage /></Gate>} />
            <Route path="*" element={<Navigate to={inApp ? '/strategy' : '/onboarding'} replace />} />
          </Routes>
          )}
        </div>
      </div>
      {toast && <div className="toast">{toast}</div>}
    </Ctx.Provider>
  );
}
