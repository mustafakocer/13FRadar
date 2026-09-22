import { useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useFavorites } from '../hooks/useFavorites.js';
import { useAuth } from '../auth.jsx';
import { setPendingFavorite } from '../lib/pendingFavorite.js';
import LoginPrompt from './LoginPrompt.jsx';
import Ico from './Ico.jsx';
import { Star } from 'lucide-react';

// The star on a fund page. Signed in (or auth not configured): toggles the
// watchlist at once. Signed out with auth available: the fund is remembered
// and the sign-in dialog opens; after sign-in the auth provider adds it.
export default function FavoriteButton({ cik, name }) {
  const { isFavorite, toggleFavorite } = useFavorites();
  const { configured, user } = useAuth();
  const { pathname } = useLocation();
  const [ask, setAsk] = useState(false);
  const fav = isFavorite(cik);
  const mgr = { cik, name };
  const click = () => {
    if (configured && !user && !fav) {
      setPendingFavorite(mgr);
      setAsk(true);
      return;
    }
    toggleFavorite(mgr);
  };
  return (
    <>
      <button
        className="fav-btn"
        onClick={click}
        title={fav ? 'Remove from watchlist' : 'Add to watchlist'}
        aria-pressed={fav}
      >
        <Ico icon={Star} size={18} fill={fav ? 'currentColor' : 'none'} />
      </button>
      <LoginPrompt
        open={ask}
        onClose={() => setAsk(false)}
        next={pathname}
        mgr={mgr}
        onLocal={() => {
          toggleFavorite(mgr);
          setAsk(false);
        }}
      />
    </>
  );
}
