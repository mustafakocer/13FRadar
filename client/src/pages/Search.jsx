import { Link, useNavigate } from 'react-router-dom';
import SearchBox from '../components/SearchBox.jsx';
import { POPULAR_MANAGERS } from '../data/popular.js';
import { useFavorites } from '../hooks/useFavorites.js';
import { useI18n } from '../i18n.jsx';

export default function Search() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const { favorites } = useFavorites();

  return (
    <div>
      <div className="hero">
        <h1>{t('search.title')}</h1>
        <p>{t('search.subtitle')}</p>
        <SearchBox autoFocus onSelect={(m) => navigate(`/manager/${m.cik}`)} />
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
          <Link key={m.cik} to={`/manager/${m.cik}`} className="chip">
            {m.name}
          </Link>
        ))}
      </div>
    </div>
  );
}
