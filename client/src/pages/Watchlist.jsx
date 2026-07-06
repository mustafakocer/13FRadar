import { Link } from 'react-router-dom';
import { useFavorites } from '../hooks/useFavorites.js';
import { useI18n } from '../i18n.jsx';

export default function Watchlist() {
  const { t } = useI18n();
  const { favorites, toggleFavorite } = useFavorites();

  return (
    <div>
      <div className="page-head">
        <h1>⭐ {t('watchlist.title')}</h1>
      </div>
      {!favorites.length && <div className="card muted">{t('watchlist.empty')}</div>}
      {favorites.map((f) => (
        <div className="card row" key={f.cik} style={{ justifyContent: 'space-between', marginTop: 10 }}>
          <Link to={`/manager/${f.cik}`} style={{ fontWeight: 700, fontSize: 16 }}>
            {f.name}
          </Link>
          <div className="row">
            <span className="muted small">CIK {f.cik}</span>
            <button className="btn ghost" onClick={() => toggleFavorite(f)}>
              {t('watchlist.remove')}
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
