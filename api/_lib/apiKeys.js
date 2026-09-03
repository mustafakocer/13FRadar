// @ts-check
// API key helpers (P2-13): generation, hashing, in-memory rate limiting.
import { createHash, randomBytes } from 'node:crypto';

export const KEY_PREFIX = '13fr_';

/** Generate a new key. Only the hash is persisted; the key is shown once. */
export function generateKey() {
  const key = KEY_PREFIX + randomBytes(24).toString('base64url');
  return { key, hash: hashKey(key), prefix: key.slice(0, 12) };
}

/** @param {string} key */
export const hashKey = (key) => createHash('sha256').update(key).digest('hex');

/** @param {unknown} key */
export const looksLikeKey = (key) => typeof key === 'string' && key.startsWith(KEY_PREFIX) && key.length >= 30 && key.length <= 80;

/**
 * Sliding-window limiter. Per serverless instance only (documented): a
 * warm instance enforces the limit, cold starts reset it.
 * @param {{ limit?: number, windowMs?: number, now?: () => number }} [o]
 */
export function createRateLimiter(o = {}) {
  const limit = o.limit ?? 60;
  const windowMs = o.windowMs ?? 60_000;
  const now = o.now || (() => Date.now());
  /** @type {Map<string, number[]>} */
  const hits = new Map();
  return {
    /** @param {string} id @returns {{ ok: boolean, remaining: number, retryAfterSec: number }} */
    check(id) {
      const t = now();
      const arr = (hits.get(id) || []).filter((x) => t - x < windowMs);
      if (arr.length >= limit) {
        hits.set(id, arr);
        return { ok: false, remaining: 0, retryAfterSec: Math.ceil((windowMs - (t - arr[0])) / 1000) };
      }
      arr.push(t);
      hits.set(id, arr);
      if (hits.size > 5000) for (const k of [...hits.keys()].slice(0, 1000)) hits.delete(k);
      return { ok: true, remaining: limit - arr.length, retryAfterSec: 0 };
    },
    limit,
  };
}

/** Parse "/api/v1/<resource>/<a>/<b>" segments. @param {string[]} segs */
export function parseV1Path(segs) {
  const [resource, ...rest] = segs;
  return { resource: String(resource || '').toLowerCase(), params: rest.map((s) => decodeURIComponent(String(s))) };
}
