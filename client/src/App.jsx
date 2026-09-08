import { useState } from 'react';
import { Routes, Route, NavLink } from 'react-router-dom';
import { useI18n } from './i18n.jsx';
import Search from './pages/Search.jsx';
import Manager from './pages/Manager.jsx';
import Stock from './pages/Stock.jsx';
import Screen from './pages/Screen.jsx';
import Compare from './pages/Compare.jsx';
import Watchlist from './pages/Watchlist.jsx';
import Consensus from './pages/Consensus.jsx';
import Report from './pages/Report.jsx';
import Insiders from './pages/Insiders.jsx';
import Pricing from './pages/Pricing.jsx';
import Account from './pages/Account.jsx';
import CommandPalette from './components/CommandPalette.jsx';
import Footer from './components/Footer.jsx';
import { useAuth } from './auth.jsx';

export default function App() {
  const { t, lang, toggle } = useI18n();
  const { configured, user, plan } = useAuth();
  const [theme, setTheme] = useState(document.documentElement.dataset.theme);

  const toggleTheme = () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    localStorage.setItem('theme', next);
    setTheme(next);
  };

  const nav = [
    { to: '/', label: t('nav.search'), icon: '🔍', end: true },
    { to: '/consensus', label: t('nav.consensus'), icon: '🧭' },
    { to: '/report', label: t('nav.report'), icon: '📰' },
    { to: '/insiders', label: t('nav.insiders'), icon: '🕵️' },
    { to: '/screen', label: t('nav.screen'), icon: '📊' },
    { to: '/compare', label: t('nav.compare'), icon: '⚖️' },
    { to: '/watchlist', label: t('nav.watchlist'), icon: '⭐' },
    { to: '/pricing', label: t('nav.pricing'), icon: '💎' },
  ];

  return (
    <div className="layout">
      <aside className="sidebar">
        <NavLink to="/" className="brand" style={{ color: 'var(--ink)' }}>
          📡 13F<span className="dot">Radar</span>
        </NavLink>
        {nav.map((n) => (
          <NavLink
            key={n.to}
            to={n.to}
            end={n.end}
            className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}
          >
            <span>{n.icon}</span> {n.label}
          </NavLink>
        ))}
        {configured && (
          <NavLink
            to="/account"
            className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}
          >
            <span>👤</span>{' '}
            {user ? (
              <>
                {t('nav.account')}
                {plan === 'pro' && <span className="badge pos" style={{ marginLeft: 6 }}>PRO</span>}
              </>
            ) : (
              t('account.signIn')
            )}
          </NavLink>
        )}
        <div className="kbd-hint muted small">⌘K / Ctrl+K</div>
        <div className="sidebar-footer">
          <button className="toggle-btn" onClick={toggleTheme} title="Theme">
            {theme === 'dark' ? '☀️' : '🌙'}
          </button>
          <button className="toggle-btn" onClick={toggle} title="Language">
            {lang === 'tr' ? 'EN' : 'TR'}
          </button>
        </div>
      </aside>
      <main className="main">
        <Routes>
          <Route path="/" element={<Search />} />
          <Route path="/manager/:cik" element={<Manager />} />
          <Route path="/stock/:ticker" element={<Stock />} />
          <Route path="/consensus" element={<Consensus />} />
          <Route path="/report" element={<Report />} />
          <Route path="/insiders" element={<Insiders />} />
          <Route path="/screen" element={<Screen />} />
          <Route path="/compare" element={<Compare />} />
          <Route path="/watchlist" element={<Watchlist />} />
          <Route path="/pricing" element={<Pricing />} />
          <Route path="/account" element={<Account />} />
        </Routes>
        <Footer />
      </main>
      <CommandPalette />
    </div>
  );
}
