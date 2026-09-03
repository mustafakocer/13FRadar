// @ts-check
import { isPro } from './auth.js';

// Plan limits. Free users see the current and the previous quarter only and
// may follow 5 items; Pro is unlimited.
export const LIMITS = {
  free: { quarters: 2, watchlist: 5, compareFunds: 2, alerts: 5, groups: 1, groupMembers: 5 },
  pro: { quarters: Infinity, watchlist: Infinity, compareFunds: 5, alerts: Infinity, groups: Infinity, groupMembers: 20 },
};

/** @param {any} req @returns {Promise<'free'|'pro'>} */
export async function getPlan(req) {
  return (await isPro(req)) ? 'pro' : 'free';
}

/** Keep only the newest `n` entries of a newest-first list.
 * @template T @param {T[]} list @param {'free'|'pro'} plan */
export function trimQuarters(list, plan) {
  const n = LIMITS[plan].quarters;
  return n === Infinity ? list : list.slice(0, n);
}

/** Keep only the newest `n` entries of an oldest-first list.
 * @template T @param {T[]} list @param {'free'|'pro'} plan */
export function trimQuartersOldestFirst(list, plan) {
  const n = LIMITS[plan].quarters;
  return n === Infinity ? list : list.slice(Math.max(0, list.length - n));
}
