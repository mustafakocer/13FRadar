// Meta Pixel, browser half (the server half is api/_lib/metaCapi.js). Off
// unless the build has VITE_META_PIXEL_ID, and then loaded only after the
// visitor accepted marketing cookies (lib/consent.js). No personal data is
// passed to fbq(): matching by hashed e-mail happens on the server.
//
// Every conversion fires with an event id the server copy also uses, so
// Meta counts it once:
//   CompleteRegistration  reg_<user id>           (auth.jsx → reportRegistration)
//   InitiateCheckout      ic_<random>             (Pricing → /api/checkout)
//   Purchase              purchase_<session id>   (Checkout page ↔ Stripe webhook)
import { marketingAllowed, onConsentChange } from './consent.js';
import { api } from './api.js';

export const PIXEL_ID = String(import.meta.env?.VITE_META_PIXEL_ID || '').trim();
export const pixelConfigured = () => /^[0-9]{6,20}$/.test(PIXEL_ID);
const inBrowser = () => typeof window !== 'undefined' && typeof document !== 'undefined';
const active = () => inBrowser() && pixelConfigured() && marketingAllowed();

let loaded = false;
function load() {
  if (loaded || !active()) return;
  loaded = true;
  /* eslint-disable */
  // Meta's standard base code, unminified: queue calls until fbevents.js lands
  const w = window;
  if (!w.fbq) {
    const n = (w.fbq = function () {
      n.callMethod ? n.callMethod.apply(n, arguments) : n.queue.push(arguments);
    });
    if (!w._fbq) w._fbq = n;
    n.push = n;
    n.loaded = true;
    n.version = '2.0';
    n.queue = [];
    const s = document.createElement('script');
    s.async = true;
    s.src = 'https://connect.facebook.net/en_US/fbevents.js';
    document.head.appendChild(s);
  }
  /* eslint-enable */
  window.fbq('consent', 'grant');
  window.fbq('init', PIXEL_ID);
}

const fbq = (...args) => {
  if (!active()) return;
  load();
  try {
    window.fbq(...args);
  } catch {
    /* blocked: the server copy still reports conversions */
  }
};

// Withdrawn consent: stop sending and drop Meta's first-party cookies.
onConsentChange((state) => {
  if (state === 'granted') return;
  if (inBrowser() && window.fbq) window.fbq('consent', 'revoke');
  if (inBrowser()) {
    const host = window.location.hostname.replace(/^www\./, '');
    for (const c of ['_fbp', '_fbc']) {
      document.cookie = `${c}=; Max-Age=0; path=/`;
      document.cookie = `${c}=; Max-Age=0; path=/; domain=.${host}`;
    }
  }
});

export const pageView = () => fbq('track', 'PageView');

export const newEventId = (prefix) => {
  const rnd = inBrowser() && window.crypto?.randomUUID ? window.crypto.randomUUID().replace(/-/g, '') : Math.random().toString(36).slice(2) + Date.now().toString(36);
  return `${prefix}_${rnd.slice(0, 24)}`;
};

const cookie = (name) => {
  if (!inBrowser()) return null;
  const m = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return m ? decodeURIComponent(m[1]) : null;
};

// _fbc from the ad click itself when the pixel has not written it yet
function fbc() {
  const c = cookie('_fbc');
  if (c) return c;
  const clid = inBrowser() ? new URLSearchParams(window.location.search).get('fbclid') : null;
  return clid ? `fb.1.${Date.now()}.${clid}` : null;
}

// What /api/checkout and /api/meta-event take so the server copy matches
// this browser: null when marketing is not allowed (nothing goes to Meta).
export function metaParams(eventId = null) {
  if (!active()) return null;
  const p = { mc: '1', url: window.location.href.split('#')[0] };
  if (eventId) p.eid = eventId;
  const fbp = cookie('_fbp');
  const c = fbc();
  if (fbp) p.fbp = fbp;
  if (c) p.fbc = c;
  return p;
}

export function initiateCheckout(eventId, { value, currency, cycle }) {
  fbq('track', 'InitiateCheckout', { value, currency, content_ids: [`pro_${cycle}`], content_type: 'product' }, { eventID: eventId });
}

// The plan the visitor left for Stripe with, read back on the success page
// so the browser Purchase carries the same value as the server's.
const PENDING = 'fc_pending_checkout';
export function rememberCheckout(info) {
  try {
    sessionStorage.setItem(PENDING, JSON.stringify(info));
  } catch {
    /* fine: the server copy carries the value */
  }
}

export function purchase(sessionId) {
  if (!/^cs_[A-Za-z0-9_]+$/.test(String(sessionId || ''))) return;
  let info = {};
  try {
    info = JSON.parse(sessionStorage.getItem(PENDING) || '{}') || {};
    sessionStorage.removeItem(PENDING);
  } catch {
    /* no value on the browser copy */
  }
  const data = { content_ids: ['pro'], content_type: 'product' };
  if (Number.isFinite(info.value) && info.currency) Object.assign(data, { value: info.value, currency: info.currency });
  fbq('track', 'Purchase', data, { eventID: `purchase_${sessionId}` });
}

// CompleteRegistration, once per new account on this device: the browser
// copy plus the server copy (/api/meta-event, which checks the account is
// under a day old). Called on every sign-in; returns early for old accounts.
const NEW_ACCOUNT_MS = 24 * 3600 * 1000;
export function reportRegistration(user) {
  if (!active() || !user?.id) return;
  const created = Date.parse(user.created_at || '');
  if (!Number.isFinite(created) || Date.now() - created > NEW_ACCOUNT_MS) return;
  const flag = `fc_reg_sent_${user.id}`;
  try {
    if (localStorage.getItem(flag)) return;
    localStorage.setItem(flag, '1');
  } catch {
    /* storage blocked: Meta's dedup still keeps one */
  }
  fbq('track', 'CompleteRegistration', { status: 'registered' }, { eventID: `reg_${user.id}` });
  api.metaEvent('registration', metaParams()).catch(() => {});
}
