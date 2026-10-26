import crypto from 'node:crypto';
import axios from 'axios';

// Meta Conversions API: the server half of the Meta Pixel. The browser fires
// the same event through fbq() with the same event_id, and Meta keeps one of
// the pair (deduplication), so an ad blocker or Safari's ITP losing the
// browser copy no longer loses the conversion. Env:
//   META_PIXEL_ID          the dataset / pixel id (also VITE_META_PIXEL_ID for the client)
//   META_CAPI_TOKEN        Events Manager → Settings → Conversions API → Generate access token
//   META_TEST_EVENT_CODE   optional, TEST12345: events show under "Test events" only
// META_API_BASE points the client at a stand-in during tests.
//
// Consent: callers send an event only for a visitor who accepted marketing
// cookies on the banner (client/src/lib/consent.js). Personal fields are
// SHA-256 hashed as Meta requires; nothing is sent when the env is unset.
const GRAPH_VERSION = 'v21.0';
const apiBase = () => (process.env.META_API_BASE || 'https://graph.facebook.com').replace(/\/$/, '');

export const metaConfigured = () => !!(process.env.META_PIXEL_ID && process.env.META_CAPI_TOKEN);

const sha256 = (s) => crypto.createHash('sha256').update(s, 'utf8').digest('hex');

// the same id on the browser and server copy is what deduplicates them
export const EVENT_ID_RE = /^[A-Za-z0-9_-]{8,80}$/;
// _fbp: fb.1.<ms>.<random>; _fbc: fb.1.<ms>.<fbclid>
const FB_COOKIE_RE = /^fb\.[0-9]\.[0-9]{10,16}\.[A-Za-z0-9_.-]{1,300}$/;

export const cleanFbCookie = (v) => {
  const s = String(v || '').trim();
  return FB_COOKIE_RE.test(s) ? s : null;
};
export const cleanEventId = (v) => {
  const s = String(v || '').trim();
  return EVENT_ID_RE.test(s) ? s : null;
};
export const cleanUrl = (v) => {
  const s = String(v || '').trim();
  return /^https?:\/\/[^\s]{1,500}$/.test(s) ? s : null;
};

// the visitor's address as Vercel forwards it (first hop of x-forwarded-for)
export function clientIp(req) {
  const xff = String(req.headers?.['x-forwarded-for'] || '').split(',')[0].trim();
  return xff || String(req.headers?.['x-real-ip'] || '').trim() || null;
}

// What a request can tell Meta about the browser that made it.
export function browserContext(req, q = {}) {
  return {
    ip: clientIp(req),
    ua: String(req.headers?.['user-agent'] || '').slice(0, 500) || null,
    fbp: cleanFbCookie(q.fbp),
    fbc: cleanFbCookie(q.fbc),
    url: cleanUrl(q.url),
  };
}

// One event in the shape the Graph API takes. Pure, for the tests.
export function buildEvent({ name, id, time, email, externalId, country, ip, ua, fbp, fbc, url, custom }) {
  const user = {};
  const em = String(email || '').trim().toLowerCase();
  if (em.includes('@')) user.em = [sha256(em)];
  if (externalId) user.external_id = [sha256(String(externalId))];
  const cc = String(country || '').trim().toLowerCase();
  if (/^[a-z]{2}$/.test(cc)) user.country = [sha256(cc)];
  if (ip) user.client_ip_address = ip;
  if (ua) user.client_user_agent = ua;
  if (fbp) user.fbp = fbp;
  if (fbc) user.fbc = fbc;
  const ev = {
    event_name: name,
    event_time: Math.floor(Number(time) || Date.now() / 1000),
    event_id: id,
    action_source: 'website',
    user_data: user,
  };
  if (url) ev.event_source_url = url;
  if (custom && Object.keys(custom).length) ev.custom_data = custom;
  return ev;
}

// Send one event. Never throws: a conversion that fails to report must not
// fail the checkout or the webhook that carried it.
export async function sendMetaEvent(event, { timeoutMs = 3000 } = {}) {
  if (!metaConfigured()) return { ok: false, skipped: 'not-configured' };
  if (!event?.name || !cleanEventId(event.id)) return { ok: false, skipped: 'bad-event' };
  const body = { data: [buildEvent(event)], access_token: process.env.META_CAPI_TOKEN };
  if (process.env.META_TEST_EVENT_CODE) body.test_event_code = process.env.META_TEST_EVENT_CODE;
  try {
    const r = await axios.post(`${apiBase()}/${GRAPH_VERSION}/${encodeURIComponent(process.env.META_PIXEL_ID)}/events`, body, {
      timeout: timeoutMs,
      validateStatus: () => true,
      headers: { 'Content-Type': 'application/json' },
    });
    if (r.status >= 400) {
      const msg = r.data?.error?.message || `HTTP ${r.status}`;
      console.warn(`meta capi: ${event.name} ${event.id} rejected: ${msg}`);
      return { ok: false, error: msg };
    }
    return { ok: true };
  } catch (err) {
    console.warn(`meta capi: ${event.name} ${event.id} failed: ${err.message || err}`);
    return { ok: false, error: String(err.message || err) };
  }
}
