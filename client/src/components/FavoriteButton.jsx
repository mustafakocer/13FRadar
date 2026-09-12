import { useFavorites } from '../hooks/useFavorites.js';
import Ico from './Ico.jsx';
import { Star } from 'lucide-react';

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
      <Ico icon={Star} size={18} fill={fav ? 'currentColor' : 'none'} />
    </button>
  );
}
