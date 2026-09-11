import { useCallback, useSyncExternalStore } from 'react';
import { getSupabase } from '../lib/supabase.js';

const KEY = 'favorites13f';
const listeners = new Set();
const EMPTY = [];
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
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* storage blocked */
  }
  listeners.forEach((l) => l());
}

// Merge cloud rows into local storage (called after sign-in).
export function mergeFavorites(remote) {
  const merged = [...snapshot];
  for (const r of remote) {
    if (!merged.some((f) => f.cik === r.cik)) merged.push({ cik: r.cik, name: r.name });
  }
  save(merged);
  return merged;
}

function cloudToggle(mgr, adding) {
  getSupabase().then((supabase) => {
    if (!supabase) return;
    return supabase.auth.getSession().then(({ data }) => {
    const uid = data.session?.user?.id;
    if (!uid) return;
    if (adding) {
      supabase.from('watchlists').upsert({ user_id: uid, cik: mgr.cik, name: mgr.name }).then(() => {});
    } else {
      supabase.from('watchlists').delete().eq('user_id', uid).eq('cik', mgr.cik).then(() => {});
    }
    });
  });
}

export function useFavorites() {
  const favorites = useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => snapshot,
    () => EMPTY // server render + hydration: no favorites yet
  );

  const isFavorite = useCallback((cik) => favorites.some((f) => f.cik === cik), [favorites]);

  const toggleFavorite = useCallback(
    (mgr) => {
      if (favorites.some((f) => f.cik === mgr.cik)) {
        save(favorites.filter((f) => f.cik !== mgr.cik));
        cloudToggle(mgr, false);
      } else {
        save([...favorites, { cik: mgr.cik, name: mgr.name }]);
        cloudToggle(mgr, true);
      }
    },
    [favorites]
  );

  return { favorites, isFavorite, toggleFavorite };
}
