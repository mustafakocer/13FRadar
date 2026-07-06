import { useState } from 'react';
import { Routes, Route, NavLink } from 'react-router-dom';
import { useI18n } from './i18n.jsx';
import Search from './pages/Search.jsx';
import Manager from './pages/Manager.jsx';
import Stock from './pages/Stock.jsx';
import Screen from './pages/Screen.jsx';
import Compare from './pages/Compare.jsx';
import Watchlist from './pages/Watchlist.jsx';

export default function App() {
  const { t, lang, toggle } = useI18n();
  const [theme, setTheme] = useState(document.documentElement.dataset.theme);

  const toggleTheme = () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    localStorage.setItem('theme', next);
    setTheme(next);
  };

  const nav = [
    { to: '/', label: t('nav.search'), icon: '🔍', end: true },
    { to: '/screen', label: t('nav.screen'), icon: '📊' },
    { to: '/compare', label: t('nav.compare'), icon: '⚖️' },
    { to: '/watchlist', label: t('nav.watchlist'), icon: '⭐' },
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
          <Route path="/screen" element={<Screen />} />
          <Route path="/compare" element={<Compare />} />
          <Route path="/watchlist" element={<Watchlist />} />
        </Routes>
      </main>
    </div>
  );
}
