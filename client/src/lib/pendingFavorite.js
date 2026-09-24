// The fund a signed-out reader starred: kept until they are signed in, then
// added to the watchlist by the auth provider. One at a time; the newest
// wins.
const KEY = 'pendingFavorite13f';

const storage = () => (typeof localStorage !== 'undefined' ? localStorage : null);

export function setPendingFavorite(mgr) {
  if (!mgr?.cik) return;
  try {
    storage()?.setItem(KEY, JSON.stringify({ cik: mgr.cik, name: mgr.name || null, at: Date.now() }));
  } catch {
    /* storage blocked */
  }
}

export function getPendingFavorite() {
  try {
    const v = JSON.parse(storage()?.getItem(KEY) || 'null');
    return v?.cik ? v : null;
  } catch {
    return null;
  }
}

export function clearPendingFavorite() {
  try {
    storage()?.removeItem(KEY);
  } catch {
    /* storage blocked */
  }
}

// Read-and-clear: the auth provider takes it once.
export function consumePendingFavorite() {
  const v = getPendingFavorite();
  if (v) clearPendingFavorite();
  return v;
}
