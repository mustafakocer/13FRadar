import { Suspense, useEffect, useState } from 'react';
import { Routes, Route, useLocation } from 'react-router-dom';
import ErrorBoundary from './components/ErrorBoundary.jsx';
import { useI18n } from './i18n.jsx';
import Home from './pages/Home.jsx';
import Manager from './pages/Manager.jsx';
import Stock from './pages/Stock.jsx';
import Consensus from './pages/Consensus.jsx';
import Gurus from './pages/Gurus.jsx';
import InsiderSignal from './pages/InsiderSignal.jsx';
import Rankings from './pages/Rankings.jsx';
import CommandPalette from './components/CommandPalette.jsx';
import Footer from './components/Footer.jsx';
import TopBar from './components/TopBar.jsx';
import { LAZY_PAGES } from './pages/lazyPages.js';

const { Insiders, PennyStocks, Screen, StockScreen, Compare, Report, Watchlist, Pricing, Checkout, Account, Filers, GuruTicker, Calendar, Filings, Emerging, ReportPage, ContentPage } = Object.fromEntries(
  Object.entries(LAZY_PAGES).map(([k, v]) => [k, v.component])
);
// Split pages get their own boundary: entity pages hydrate synchronously with
// the root, so tab clicks and fast query updates never race hydration.
const Lazy = ({ children }) => (
  <Suspense
    fallback={
      <div className="loading">
        <div className="spinner" />
      </div>
    }
  >
    {children}
  </Suspense>
);

export default function App() {
  const { t } = useI18n();
  const { pathname } = useLocation();
  // 'dark' (the default theme) on the server and for the first client render
  // (hydration must match); the persisted choice is applied right after mount.
  const [theme, setTheme] = useState('dark');
  useEffect(() => {
    setTheme(document.documentElement.dataset.theme || 'dark');
  }, []);

  const toggleTheme = () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    localStorage.setItem('theme', next);
    setTheme(next);
  };

  return (
    <div className="layout">
      <TopBar theme={theme} onToggleTheme={toggleTheme} />
      <main className="main">
        {/* One page's render error stays inside the page area; the shell and
            the other routes keep working, and moving to another route resets it. */}
        <ErrorBoundary resetKey={pathname} title={t('common.error')} message={t('common.renderFailed')} retry={t('common.retry')}>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/manager/:cik" element={<Manager />} />
          <Route path="/guru/:slug" element={<Manager />} />
          <Route path="/filer/:slug" element={<Manager />} />
          {/* A fund's sub-pages are fixed words, so they outrank the guru ×
              ticker route below, whose last segment is a symbol. */}
          {['changes', 'mix', 'history', 'backtest'].flatMap((seg) =>
            ['/manager/:cik', '/guru/:slug', '/filer/:slug'].map((base) => (
              <Route key={`${base}/${seg}`} path={`${base}/${seg}`} element={<Manager segment={seg} />} />
            ))
          )}
          <Route path="/guru/:slug/:ticker" element={<Lazy><GuruTicker /></Lazy>} />
          <Route path="/gurus" element={<Gurus />} />
          <Route path="/filers" element={<Lazy><Filers /></Lazy>} />
          <Route path="/filers/:letter" element={<Lazy><Filers /></Lazy>} />
          <Route path="/insiders/penny" element={<Lazy><PennyStocks /></Lazy>} />
          <Route path="/insiders/:signal" element={<InsiderSignal />} />
          <Route path="/rankings/:kind" element={<Rankings />} />
          <Route path="/calendar" element={<Lazy><Calendar /></Lazy>} />
          <Route path="/filings" element={<Lazy><Filings /></Lazy>} />
          <Route path="/reports" element={<Lazy><ReportPage /></Lazy>} />
          <Route path="/guides/:slug" element={<Lazy><ContentPage /></Lazy>} />
          <Route path="/rehber/:slug" element={<Lazy><ContentPage /></Lazy>} />
          <Route path="/compare/:slug" element={<Lazy><ContentPage /></Lazy>} />
          <Route path="/karsilastir/:slug" element={<Lazy><ContentPage /></Lazy>} />
          <Route path="/reports/:id" element={<Lazy><ReportPage /></Lazy>} />
          <Route path="/emerging-managers" element={<Lazy><Emerging /></Lazy>} />
          <Route path="/stock/:ticker" element={<Stock />} />
          <Route path="/consensus" element={<Consensus />} />
          <Route path="/consensus/:segment" element={<Consensus />} />
          <Route path="/report" element={<Lazy><Report /></Lazy>} />
          <Route path="/insiders" element={<Lazy><Insiders /></Lazy>} />
          <Route path="/screen" element={<Lazy><Screen /></Lazy>} />
          <Route path="/screen/stocks" element={<Lazy><StockScreen /></Lazy>} />
          <Route path="/compare" element={<Lazy><Compare /></Lazy>} />
          <Route path="/watchlist" element={<Lazy><Watchlist /></Lazy>} />
          <Route path="/pricing" element={<Lazy><Pricing /></Lazy>} />
          <Route path="/checkout/:outcome" element={<Lazy><Checkout /></Lazy>} />
          <Route path="/account" element={<Lazy><Account /></Lazy>} />
        </Routes>
        </ErrorBoundary>
        <Footer />
      </main>
      <CommandPalette />
    </div>
  );
}
