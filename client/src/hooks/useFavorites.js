import { useCallback, useSyncExternalStore } from 'react';

const KEY = 'favorites13f';
const listeners = new Set();
let snapshot = load();

function load() {
  try {
    return JSON.parse(localStorage.getItem(KEY)) || [];
  } catch {
    return [];
  }
}

function save(next) {
  snapshot = next;
  localStorage.setItem(KEY, JSON.stringify(next));
  listeners.forEach((l) => l());
}

export function useFavorites() {
  const favorites = useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => snapshot
  );

  const isFavorite = useCallback((cik) => favorites.some((f) => f.cik === cik), [favorites]);

  const toggleFavorite = useCallback(
    (mgr) => {
      if (favorites.some((f) => f.cik === mgr.cik)) {
        save(favorites.filter((f) => f.cik !== mgr.cik));
      } else {
        save([...favorites, { cik: mgr.cik, name: mgr.name }]);
      }
    },
    [favorites]
  );

  return { favorites, isFavorite, toggleFavorite };
}
