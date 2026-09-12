import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import { useI18n } from '../i18n.jsx';
import { useAuth } from '../auth.jsx';
import Ico from './Ico.jsx';
import { Radar, Search, Landmark, UserSearch, Star, Gem, Compass, ChartColumn, Scale, Newspaper, UserRound, Moon, Sun, ChevronDown } from 'lucide-react';

// Top navigation: brand · tabs (one of them a drop-down group) · search
// (opens the ⌘K palette) · theme · TR/EN · account. Below 900px the tabs
// collapse behind a hamburger that opens and closes a stacked panel.
const openPalette = () =>
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true, bubbles: true }));

function Dropdown({ label, icon, items, active }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const timer = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  // hover opens on desktop; a short grace period keeps it from flickering
  const enter = () => {
    clearTimeout(timer.current);
    setOpen(true);
  };
  const leave = () => {
    timer.current = setTimeout(() => setOpen(false), 120);
  };

  return (
    <div className={`nav-dd${open ? ' open' : ''}`} ref={ref} onMouseEnter={enter} onMouseLeave={leave}>
      <button
        className={`nav-tab${active ? ' active' : ''}`}
        onClick={() => setOpen(true)}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <span className="ico"><Ico icon={icon} size={18} /></span> {label} <Ico icon={ChevronDown} size={14} className="caret" />
      </button>
      {open && (
        <div className="nav-menu" role="menu">
          {items.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              role="menuitem"
              className={({ isActive }) => `nav-menu-item${isActive ? ' active' : ''}`}
              onClick={() => setOpen(false)}
            >
              <span className="ico"><Ico icon={n.icon} size={18} /></span>
              <span>
                <b>{n.label}</b>
                {n.desc && <small>{n.desc}</small>}
              </span>
            </NavLink>
          ))}
        </div>
      )}
    </div>
  );
}

export default function TopBar({ theme, onToggleTheme }) {
  const { t, lang, toggle } = useI18n();
  const { configured, user, plan } = useAuth();
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);

  // any navigation closes the mobile panel
  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname]);

  const funds = [
    { to: '/consensus', label: t('nav.consensus'), icon: Compass, desc: t('topnav.d.consensus') },
    { to: '/screen', label: t('nav.screen'), icon: ChartColumn, desc: t('topnav.d.screen') },
    { to: '/compare', label: t('nav.compare'), icon: Scale, desc: t('topnav.d.compare') },
    { to: '/report', label: t('nav.report'), icon: Newspaper, desc: t('topnav.d.report') },
  ];
  const fundsActive = funds.some((n) => location.pathname.startsWith(n.to)) || location.pathname.startsWith('/manager/');

  const tabs = [
    { to: '/', label: t('nav.search'), icon: Search, end: true },
    { group: true, label: t('topnav.funds'), icon: Landmark, items: funds, active: fundsActive },
    { to: '/insiders', label: t('nav.insiders'), icon: UserSearch },
    { to: '/watchlist', label: t('nav.watchlist'), icon: Star },
    { to: '/pricing', label: t('nav.pricing'), icon: Gem },
  ];

  const accountLink = configured ? (
    <NavLink to="/account" className="btn ghost topbar-account">
      {user ? (
        <>
          <Ico icon={UserRound} /> {t('nav.account')}
          {plan === 'pro' && <span className="badge pro">PRO</span>}
        </>
      ) : (
        t('account.signIn')
      )}
    </NavLink>
  ) : null;

  return (
    <header className="topbar no-print">
      <div className="topbar-inner">
        <Link to="/" className="brand">
          <Ico icon={Radar} size={22} /> 13F<span className="dot">Radar</span>
        </Link>

        <nav className="nav-tabs" aria-label="Main">
          {tabs.map((n) =>
            n.group ? (
              <Dropdown key={n.label} label={n.label} icon={n.icon} items={n.items} active={n.active} />
            ) : (
              <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => `nav-tab${isActive ? ' active' : ''}`}>
                <span className="ico"><Ico icon={n.icon} size={18} /></span> {n.label}
              </NavLink>
            )
          )}
        </nav>

        <div className="topbar-tools">
          <button className="topbar-search" onClick={openPalette} title="⌘K / Ctrl+K">
            <Ico icon={Search} />
            <span className="ph">{t('topnav.searchPh')}</span>
            <kbd>⌘K</kbd>
          </button>
          <button className="toggle-btn" onClick={onToggleTheme} title="Theme" aria-label="Theme">
            <Ico icon={theme === 'dark' ? Sun : Moon} />
          </button>
          <button className="toggle-btn" onClick={toggle} title="Language">
            {lang === 'tr' ? 'EN' : 'TR'}
          </button>
          {accountLink}
          <button
            className={`burger${mobileOpen ? ' on' : ''}`}
            onClick={() => setMobileOpen((o) => !o)}
            aria-label="Menu"
            aria-expanded={mobileOpen}
          >
            <i /><i /><i />
          </button>
        </div>
      </div>

      {mobileOpen && (
        <div className="mobile-panel">
          {tabs.map((n) =>
            n.group ? (
              <div key={n.label} className="mobile-group">
                <div className="mobile-group-title"><Ico icon={n.icon} /> {n.label}</div>
                {n.items.map((m) => (
                  <NavLink key={m.to} to={m.to} className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}>
                    <Ico icon={m.icon} size={18} /> {m.label}
                  </NavLink>
                ))}
              </div>
            ) : (
              <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}>
                <Ico icon={n.icon} size={18} /> {n.label}
              </NavLink>
            )
          )}
          {configured && (
            <NavLink to="/account" className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}>
              <Ico icon={UserRound} size={18} /> {user ? t('nav.account') : t('account.signIn')}
            </NavLink>
          )}
          <div className="row" style={{ padding: '10px 12px', gap: 8 }}>
            <button className="toggle-btn" onClick={onToggleTheme} aria-label="Theme"><Ico icon={theme === 'dark' ? Sun : Moon} /></button>
            <button className="toggle-btn" onClick={toggle}>{lang === 'tr' ? 'EN' : 'TR'}</button>
            <button className="toggle-btn" onClick={openPalette}><Ico icon={Search} /> ⌘K</button>
          </div>
        </div>
      )}
    </header>
  );
}
