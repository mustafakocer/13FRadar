import { Link, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api.js';
import SearchBox from '../components/SearchBox.jsx';
import { POPULAR_MANAGERS } from '../data/popular.js';
import { useFavorites } from '../hooks/useFavorites.js';
import { useI18n } from '../i18n.jsx';
import { usePageTitle } from '../hooks/usePageTitle.js';

const FEATURES = [
  ['📁', 'f1', '/manager/0001067983'],
  ['🧭', 'f2', '/consensus'],
  ['🐋', 'f3', '/stock/AAPL'],
  ['📊', 'f4', '/screen'],
  ['⚖️', 'f5', '/compare'],
  ['⬇️', 'f6', '/watchlist'],
];

export default function Search() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const { favorites } = useFavorites();
  const qc = useQueryClient();
  usePageTitle(null);

  // warm the cache while the cursor is still over the chip
  const prefetch = (cik) =>
    qc.prefetchQuery({
      queryKey: ['manager', cik],
      queryFn: () => api.manager(cik),
      staleTime: 30 * 60 * 1000,
    });

  return (
    <div>
      <div className="hero">
        <h1>{t('search.title')}</h1>
        <p>{t('search.subtitle')}</p>
        <SearchBox autoFocus onSelect={(m) => navigate(`/manager/${m.cik}`)} />
        <div className="row" style={{ justifyContent: 'center', marginTop: 18 }}>
          <Link to="/consensus" className="btn" style={{ textDecoration: 'none' }}>
            🧭 {t('landing.cta.consensus')}
          </Link>
          <Link to="/screen" className="btn ghost" style={{ textDecoration: 'none' }}>
            📊 {t('landing.cta.screen')}
          </Link>
        </div>
      </div>

      <div className="stat-band">
        <div>
          <b>8.000+</b>
          <span>{t('landing.stat.funds')}</span>
        </div>
        <div>
          <b>{t('landing.stat.data.v')}</b>
          <span>{t('landing.stat.data')}</span>
        </div>
        <div>
          <b>{t('landing.stat.price.v')}</b>
          <span>{t('landing.stat.price')}</span>
        </div>
      </div>

      {favorites.length > 0 && (
        <>
          <div className="section-title">⭐ {t('search.favorites')}</div>
          <div className="chip-grid">
            {favorites.map((f) => (
              <Link key={f.cik} to={`/manager/${f.cik}`} className="chip">
                {f.name}
              </Link>
            ))}
          </div>
        </>
      )}

      <div className="section-title">{t('search.popular')}</div>
      <div className="chip-grid">
        {POPULAR_MANAGERS.map((m) => (
          <Link
            key={m.cik}
            to={`/manager/${m.cik}`}
            className="chip"
            onMouseEnter={() => prefetch(m.cik)}
          >
            {m.name}
          </Link>
        ))}
      </div>

      <div className="section-title">{t('landing.features')}</div>
      <div className="grid grid-3 mt16">
        {FEATURES.map(([icon, key, to]) => (
          <Link key={key} to={to} className="card feature-card">
            <div className="feature-icon">{icon}</div>
            <h3>{t(`landing.${key}.t`)}</h3>
            <p className="muted small">{t(`landing.${key}.d`)}</p>
          </Link>
        ))}
      </div>

      <div className="section-title">{t('landing.how')}</div>
      <div className="grid grid-3 mt16">
        {[1, 2, 3].map((n) => (
          <div key={n} className="card how-card">
            <div className="how-num">{n}</div>
            <p className="muted">{t(`landing.how${n}`)}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
