// Google Analytics 4, loaded only after the visitor accepted the cookie
// banner (lib/consent.js) and only in a build with VITE_GA_MEASUREMENT_ID.
// Page views are sent by hand on every SPA route change (send_page_view off,
// so the first page is not counted twice). No personal data is passed:
// no user id, no e-mail, IP anonymised by GA4 itself.
import { marketingAllowed, onConsentChange } from './consent.js';

export const GA_ID = String(import.meta.env?.VITE_GA_MEASUREMENT_ID || '').trim();
export const gaConfigured = () => /^G-[A-Z0-9]{4,20}$/.test(GA_ID);
const inBrowser = () => typeof window !== 'undefined' && typeof document !== 'undefined';
const active = () => inBrowser() && gaConfigured() && marketingAllowed();

let loaded = false;
function load() {
  if (loaded || !active()) return;
  loaded = true;
  window[`ga-disable-${GA_ID}`] = false;
  window.dataLayer = window.dataLayer || [];
  window.gtag = function gtag() {
    window.dataLayer.push(arguments); // gtag.js reads the arguments object, not an array
  };
  window.gtag('consent', 'default', { ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied', analytics_storage: 'granted' });
  window.gtag('js', new Date());
  window.gtag('config', GA_ID, { send_page_view: false });
  const s = document.createElement('script');
  s.async = true;
  s.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(GA_ID)}`;
  document.head.appendChild(s);
}

export function gaEvent(name, params = {}) {
  if (!active()) return;
  load();
  try {
    window.gtag('event', name, params);
  } catch {
    /* blocked: nothing to do */
  }
}

export const gaPageView = () =>
  gaEvent('page_view', { page_location: window.location.href.split('#')[0], page_title: document.title });

// The site's product events (lib/analytics.js) under GA4's recommended names.
const GA_NAMES = {
  signup: 'sign_up',
  watchlist_add: 'add_to_wishlist',
  export: 'file_download',
};
export function gaProductEvent(name, props = {}) {
  if (name === 'checkout_complete') return; // gaPurchase carries the value
  gaEvent(GA_NAMES[name] || name, props);
}

export const gaBeginCheckout = ({ value, currency, cycle }) =>
  gaEvent('begin_checkout', { value, currency, items: [{ item_id: `pro_${cycle}`, item_name: 'Fundocap Pro' }] });

// transaction_id = the Stripe session: GA4 drops a repeat of the same id
export function gaPurchase(sessionId, info = {}) {
  if (!/^cs_[A-Za-z0-9_]+$/.test(String(sessionId || ''))) return;
  const p = { transaction_id: sessionId, items: [{ item_id: info.cycle ? `pro_${info.cycle}` : 'pro', item_name: 'Fundocap Pro' }] };
  if (Number.isFinite(info.value) && info.currency) Object.assign(p, { value: info.value, currency: info.currency });
  gaEvent('purchase', p);
}

// Withdrawn consent: stop GA and drop its cookies (_ga, _ga_<id>).
onConsentChange((state) => {
  if (state === 'granted' || !inBrowser() || !gaConfigured()) return;
  window[`ga-disable-${GA_ID}`] = true;
  const host = window.location.hostname.replace(/^www\./, '');
  for (const c of document.cookie.split('; ').map((x) => x.split('=')[0]).filter((n) => n === '_ga' || n.startsWith('_ga_'))) {
    document.cookie = `${c}=; Max-Age=0; path=/`;
    document.cookie = `${c}=; Max-Age=0; path=/; domain=.${host}`;
  }
});
