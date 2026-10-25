// Marketing-cookie consent (KVKK / UK GDPR): the Meta Pixel and the
// Conversions API calls run only after the visitor pressed "Accept" on the
// banner (components/ConsentBanner.jsx). "Reject" is as easy as "Accept",
// the answer is remembered on the device, and the footer link reopens the
// banner to change it. Nothing here is needed when no pixel is configured.
const KEY = 'fc_consent_marketing';
export const CONSENT_VERSION = 1; // bump to ask everyone again after a material change

const store = () => {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
};

// 'granted' | 'denied' | null (not asked yet, or asked under an older version)
export function readConsent() {
  try {
    const v = JSON.parse(store()?.getItem(KEY) || 'null');
    return v && v.v === CONSENT_VERSION && (v.s === 'granted' || v.s === 'denied') ? v.s : null;
  } catch {
    return null;
  }
}

let memo; // the answer read once per page view, then kept in step by setConsent
const listeners = new Set();
export function onConsentChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function setConsent(state) {
  try {
    store()?.setItem(KEY, JSON.stringify({ v: CONSENT_VERSION, s: state, at: new Date().toISOString() }));
  } catch {
    /* storage blocked: the choice holds for this page view only */
  }
  memo = state;
  for (const fn of listeners) fn(state);
}

export const marketingAllowed = () => (memo === undefined ? (memo = readConsent()) : memo) === 'granted';

// the footer's "Cookie preferences" link asks the banner to open again
const reopeners = new Set();
export const onConsentReopen = (fn) => {
  reopeners.add(fn);
  return () => reopeners.delete(fn);
};
export const reopenConsent = () => reopeners.forEach((fn) => fn());
