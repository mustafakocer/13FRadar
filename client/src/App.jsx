import { useState } from 'react';
import { Routes, Route } from 'react-router-dom';
import Home from './pages/Home.jsx';
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
import TopBar from './components/TopBar.jsx';

export default function App() {
  const [theme, setTheme] = useState(document.documentElement.dataset.theme);

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
        <Routes>
          <Route path="/" element={<Home />} />
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
