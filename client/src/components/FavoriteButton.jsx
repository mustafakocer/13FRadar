import { useFavorites } from '../hooks/useFavorites.js';

export default function FavoriteButton({ cik, name }) {
  const { isFavorite, toggleFavorite } = useFavorites();
  const fav = isFavorite(cik);
  return (
    <button
      className="fav-btn"
      onClick={() => toggleFavorite({ cik, name })}
      title={fav ? 'Remove from watchlist' : 'Add to watchlist'}
      aria-pressed={fav}
    >
      {fav ? '⭐' : '☆'}
    </button>
  );
}
