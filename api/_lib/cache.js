// Simple in-memory TTL cache. Persists per serverless instance (warm lambda)
// and for the lifetime of the dev server.
//
// Both maps are bounded. Keys are built from request input (a ticker, a CIK,
// a search string), so without a ceiling a client walking through made-up
// keys grows a warm instance until it is killed. At the ceiling the expired
// entries go first, then the oldest ones (a Map iterates in insertion order).
export const MAX_ENTRIES = 5000;
const store = new Map();

function makeRoom(map, max, now = Date.now()) {
  if (map.size < max) return;
  for (const [k, v] of map) {
    if (v?.exp != null && v.exp <= now) map.delete(k);
  }
  for (const k of map.keys()) {
    if (map.size < max) break;
    map.delete(k);
  }
}

export function cached(key, ttlMs, fn) {
  const hit = store.get(key);
  if (hit && hit.exp > Date.now()) return hit.promise;
  const promise = Promise.resolve()
    .then(fn)
    .catch((err) => {
      // only this call's entry: a newer one under the same key stays
      if (store.get(key)?.promise === promise) store.delete(key);
      throw err;
    });
  store.delete(key); // re-insert at the young end
  makeRoom(store, MAX_ENTRIES);
  store.set(key, { promise, exp: Date.now() + ttlMs });
  return promise;
}

// Last-known-good store: survives cache TTL expiry so endpoints can serve
// slightly stale data instead of erroring when every provider is rate-limited.
const good = new Map();
export const remember = (key, val) => {
  good.delete(key);
  makeRoom(good, MAX_ENTRIES);
  good.set(key, val);
};
export const recall = (key) => good.get(key);

// Test seam.
export const cacheSizes = () => ({ store: store.size, good: good.size });

export const TTL = {
  MIN_5: 5 * 60 * 1000,
  HOUR_1: 60 * 60 * 1000,
  HOUR_6: 6 * 60 * 60 * 1000,
  DAY_1: 24 * 60 * 60 * 1000,
  DAY_7: 7 * 24 * 60 * 60 * 1000,
};
