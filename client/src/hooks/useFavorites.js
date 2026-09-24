import { useCallback, useSyncExternalStore } from 'react';
import { getSupabase } from '../lib/supabase.js';

// The watchlist, kept in localStorage and mirrored to the account's
// `watchlists` rows when signed in. Every change is optimistic: the list
// updates at once, the cloud write follows, and a failed write puts the
// list back the way it was and says so (`error`).
const KEY = 'favorites13f';
const listeners = new Set();
const EMPTY = [];
let snapshot = load();
let lastError = null;

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
function setError(e) {
  lastError = e;
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

// The cloud write: resolves when the row is written (or when there is no
// session / no auth, which is not a failure); rejects when Supabase does.
async function cloudWrite(mgr, adding) {
  const supabase = await getSupabase();
  if (!supabase) return;
  const { data } = await supabase.auth.getSession();
  const uid = data.session?.user?.id;
  if (!uid) return;
  const r = adding
    ? await supabase.from('watchlists').upsert({ user_id: uid, cik: mgr.cik, name: mgr.name })
    : await supabase.from('watchlists').delete().eq('user_id', uid).eq('cik', mgr.cik);
  if (r?.error) throw r.error;
}
let cloud = cloudWrite;
// Test seam.
export const _setCloud = (fn) => {
  cloud = fn || cloudWrite;
};

// Add or remove one fund, optimistically; roll back on a failed write.
export async function setFavorite(mgr, adding) {
  const before = snapshot;
  const has = before.some((f) => f.cik === mgr.cik);
  if (adding === has) return true;
  save(adding ? [...before, { cik: mgr.cik, name: mgr.name }] : before.filter((f) => f.cik !== mgr.cik));
  setError(null);
  try {
    await cloud(mgr, adding);
    return true;
  } catch (e) {
    save(before);
    setError({ message: String(e?.message || e), cik: mgr.cik, adding });
    return false;
  }
}
export const addFavorite = (mgr) => setFavorite(mgr, true);

export function useFavorites() {
  const favorites = useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => snapshot,
    () => EMPTY // server render + hydration: no favorites yet
  );
  const error = useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => lastError,
    () => null
  );

  const isFavorite = useCallback((cik) => favorites.some((f) => f.cik === cik), [favorites]);

  const toggleFavorite = useCallback((mgr) => setFavorite(mgr, !favorites.some((f) => f.cik === mgr.cik)), [favorites]);

  const clearError = useCallback(() => setError(null), []);

  return { favorites, isFavorite, toggleFavorite, addFavorite, error, clearError };
}
