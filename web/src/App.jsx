import React, { useEffect, useState, createContext, useContext } from 'react';
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
  { to: '/profile', icon: 'dna', label: 'Business', sub: ['Overview', 'Catalog', 'Assets'] },
  { to: '/strategy', icon: 'sparkle', label: 'Strategy' },
  { to: '/campaigns', icon: 'campaign', label: 'Campaigns' },
  { to: '/photoshoot', icon: 'photo', label: 'Photoshoot' },
  { to: '/brandbook', icon: 'book', label: 'Brand Book' },
  { to: '/websites', icon: 'site', label: 'Websites' },
];

export default function App() {
  const [profile, setProfile] = useState(undefined); // undefined = loading
  const [status, setStatus] = useState(null);
  const [banner, setBanner] = useState(true);
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
  }, []);
  useEffect(() => {
    if (profile === null && loc.pathname !== '/onboarding') nav('/onboarding');
  }, [profile, loc.pathname]);

  const say = (t, ms = 3200) => {
    setToast(t);
    clearTimeout(say._t);
    say._t = setTimeout(() => setToast(null), ms);
  };

  const ctx = { profile, setProfile, refresh, status, say };
  const inApp = !!profile;

  return (
    <Ctx.Provider value={ctx}>
      <div className="shell">
        {inApp && (
          <nav className="rail">
            <div className="logo" title="Marque"><Logo size={40} /></div>
            {NAV.map((n) => (
              <NavLink key={n.to} to={n.to} className={({ isActive }) => `rail-item${isActive ? ' active' : ''}`} title={n.label}>
                <Icon name={n.icon} />
                <span className="lbl">{n.label.split(' ')[0]}</span>
              </NavLink>
            ))}
          </nav>
        )}
        <div className="main">
          {inApp && banner && (
            <div className="banner">
              <Icon name="megaphone" />
              <span>New: Qloo taste-graph evidence is attached to every campaign — open any creative's signals panel.</span>
              <button className="x" onClick={() => setBanner(false)}>✕</button>
            </div>
          )}
          {inApp && (
            <div className="topbar">
              <div className="brand"><Logo size={22} /> Marque <span className="exp">STUDIO</span></div>
              <div className="spacer" />
              <div className="chips">
                <StatusChip label="agent" ok={status?.tensor} />
                <StatusChip label="media" ok={status?.gemini} />
                <span className={`chip qloo${status?.qloo === 'live' ? ' on' : ' demo'}`}>
                  <span className="dot" /> Qloo {status?.qloo === 'live' ? 'live' : 'demo'}
                </span>
              </div>
            </div>
          )}
          <Routes>
            <Route path="/onboarding" element={<Onboarding />} />
            <Route path="/profile/*" element={<ProfilePage />} />
            <Route path="/strategy" element={<StrategyPage />} />
            <Route path="/campaigns/*" element={<CampaignsPage />} />
            <Route path="/photoshoot" element={<PhotoshootPage />} />
            <Route path="/websites" element={<WebsitesPage />} />
            <Route path="/brandbook" element={<BrandBookPage />} />
            <Route path="*" element={<Navigate to={inApp ? '/profile' : '/onboarding'} replace />} />
          </Routes>
        </div>
      </div>
      {toast && <div className="toast">{toast}</div>}
    </Ctx.Provider>
  );
}

function StatusChip({ label, ok }) {
  return <span className={`chip${ok ? ' on' : ''}`}><span className="dot" />{label}</span>;
}
