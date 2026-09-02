// Simple in-memory TTL cache. Persists per serverless instance (warm lambda)
// and for the lifetime of the dev server.
const store = new Map();

export function cached(key, ttlMs, fn) {
  const hit = store.get(key);
  if (hit && hit.exp > Date.now()) return hit.promise;
  const promise = Promise.resolve()
    .then(fn)
    .catch((err) => {
      store.delete(key);
      throw err;
    });
  store.set(key, { promise, exp: Date.now() + ttlMs });
  return promise;
}

// Last-known-good store: survives cache TTL expiry so endpoints can serve
// slightly stale data instead of erroring when every provider is rate-limited.
const good = new Map();
export const remember = (key, val) => good.set(key, val);
export const recall = (key) => good.get(key);

export const TTL = {
  MIN_5: 5 * 60 * 1000,
  HOUR_1: 60 * 60 * 1000,
  HOUR_6: 6 * 60 * 60 * 1000,
  DAY_1: 24 * 60 * 60 * 1000,
  DAY_7: 7 * 24 * 60 * 60 * 1000,
};
