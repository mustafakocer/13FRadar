import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useFavorites } from '../hooks/useFavorites.js';
import { useAuth } from '../auth.jsx';
import { useI18n } from '../i18n.jsx';
import { LIMITS } from '../lib/planLimits.js';

export default function FavoriteButton({ cik, name }) {
  const { t } = useI18n();
  const { isPro } = useAuth();
  const { favorites, isFavorite, toggleFavorite } = useFavorites();
  const [limited, setLimited] = useState(false);
  const fav = isFavorite(cik);
  const limit = isPro ? Infinity : LIMITS.free.watchlist;
  const onClick = () => {
    if (!fav && favorites.length >= limit) return setLimited(true);
    setLimited(false);
    toggleFavorite({ cik, name });
  };
  return (
    <span className="alert-bell-wrap">
      <button className="fav-btn" onClick={onClick} title={fav ? t('watchlist.remove') : t('watchlist.add')} aria-pressed={fav}>
        {fav ? '⭐' : '☆'}
      </button>
      {limited && (
        <span className="muted small">
          {t('watchlist.limit', { n: limit })} <Link to="/pricing">{t('paywall.cta')}</Link>
        </span>
      )}
    </span>
  );
}
