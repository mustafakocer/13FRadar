// Cookieless page analytics (Vercel Web Analytics) — KVKK/GDPR friendly:
// no cookies, no cross-site identifier, nothing personal ever passed along.
// Page views are automatic (the <Analytics /> component in Root.jsx); the
// handful of product events below go through track(), which only ever sends
// an event name and coarse, non-personal props.
//
// The dashboard side is a one-click switch in Vercel: Project → Analytics →
// Enable. Until it is on, the injected script 404s quietly and track() is a
// no-op — nothing breaks.
import { track as vercelTrack } from '@vercel/analytics';

// the five product events the site reports, and nothing else
export const EVENTS = {
  signup: 'signup',
  proClick: 'pro_click',
  checkoutComplete: 'checkout_complete',
  watchlistAdd: 'watchlist_add',
  export: 'export',
  digestOn: 'digest_on',
  digestOff: 'digest_off',
};

export function track(name, props) {
  try {
    vercelTrack(name, props);
  } catch {
    /* analytics unavailable (blocked, SSR, not enabled): never an error */
  }
}
