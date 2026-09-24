// Where an email link or an OAuth round trip lands: always /account, with
// the page that asked for sign-in carried in ?next= so the account page can
// send the reader back (a pricing plan, the watchlist, a fund). Only an
// in-site path rides along; anything else is dropped.
export const safeNext = (next) => (typeof next === 'string' && /^\/(?!\/)/.test(next) && next.length <= 300 ? next : null);

export function authReturnUrl(origin, next = null) {
  const n = safeNext(next);
  return `${String(origin).replace(/\/$/, '')}/account${n ? `?next=${encodeURIComponent(n)}` : ''}`;
}
