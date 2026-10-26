// Meta Pixel + Conversions API. The server half end to end with Supabase,
// Stripe and the Graph API replaced by local HTTP stand-ins: hashing and the
// event shape, /api/checkout (InitiateCheckout + the consent riding on the
// session metadata), /api/meta-event (CompleteRegistration only for a new
// account), and that nothing reaches Meta without consent or configuration.
// The Purchase from the Stripe webhook is in stripe-webhook.test.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { root } from './helpers.mjs';

const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const USER = '11111111-2222-4333-8444-555555555555';
const OLD_USER = '99999999-2222-4333-8444-555555555555';
const FBP = 'fb.1.1761400000000.1234567890';

const read = (req) => new Promise((resolve) => {
  let b = '';
  req.on('data', (c) => (b += c));
  req.on('end', () => resolve(b));
});
const json = (res, code, data) => {
  res.writeHead(code, { 'content-type': 'application/json' });
  res.end(JSON.stringify(data));
};

// ---- stand-ins --------------------------------------------------------------
const metaCalls = [];
const meta = http.createServer(async (req, res) => {
  const body = JSON.parse((await read(req)) || '{}');
  metaCalls.push({ url: req.url, body });
  if (body.access_token !== 'capi-token') return json(res, 400, { error: { message: 'bad token' } });
  json(res, 200, { events_received: body.data.length });
});

const users = {
  'tok-new': { id: USER, email: 'New.User@Example.com ', created_at: new Date(Date.now() - 3600e3).toISOString() },
  'tok-old': { id: OLD_USER, email: 'old@example.com', created_at: '2025-01-01T00:00:00Z' },
};
const supabase = http.createServer(async (req, res) => {
  await read(req);
  const u = new URL(req.url, 'http://x');
  const tok = String(req.headers.authorization || '').replace(/^Bearer\s+/, '');
  if (u.pathname === '/auth/v1/user') return users[tok] ? json(res, 200, users[tok]) : json(res, 401, {});
  if (u.pathname === '/rest/v1/rpc/is_pro') return json(res, 200, false);
  if (u.pathname === '/rest/v1/profiles') return json(res, 200, [{ stripe_customer_id: null }]);
  json(res, 404, {});
});

const sessions = [];
const stripe = http.createServer(async (req, res) => {
  const body = await read(req);
  if (req.method === 'POST' && req.url === '/v1/checkout/sessions') {
    sessions.push(new URLSearchParams(body));
    return json(res, 200, { id: 'cs_test_1', url: 'https://checkout.stripe.test/cs_test_1' });
  }
  json(res, 404, { error: { message: 'no route' } });
});

const listen = (srv) => new Promise((resolve) => srv.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${srv.address().port}`)));
process.env.SUPABASE_URL = await listen(supabase);
process.env.SUPABASE_ANON_KEY = 'anon-key';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'svc-key';
process.env.STRIPE_SECRET_KEY = 'sk_test_x';
process.env.STRIPE_API_BASE = await listen(stripe);
process.env.STRIPE_PRICE_MONTHLY = 'price_m';
process.env.STRIPE_PRICE_YEARLY = 'price_y';
process.env.META_API_BASE = await listen(meta);

const { buildEvent, sendMetaEvent, cleanFbCookie, cleanEventId } = await import('../api/_lib/metaCapi.js');
const { default: checkout } = await import('../api/_handlers/checkout.js');
const { default: metaEvent } = await import('../api/_handlers/meta-event.js');

const configure = () => {
  process.env.META_PIXEL_ID = '123456789012345';
  process.env.META_CAPI_TOKEN = 'capi-token';
};
const unconfigure = () => {
  delete process.env.META_PIXEL_ID;
  delete process.env.META_CAPI_TOKEN;
};

test.after(() => {
  meta.close();
  supabase.close();
  stripe.close();
});

function call(handler, { query = {}, token, method = 'POST' } = {}) {
  const req = {
    method,
    query: { ...query },
    headers: {
      host: 'www.fundocap.test',
      'user-agent': 'Mozilla/5.0 test',
      'x-forwarded-for': '203.0.113.7, 10.0.0.1',
      'x-vercel-ip-country': 'DE',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
  };
  return new Promise((resolve) => {
    const res = {
      statusCode: 200,
      setHeader() {},
      status(c) {
        this.statusCode = c;
        return this;
      },
      json(b) {
        resolve({ status: this.statusCode, body: b });
      },
    };
    handler(req, res);
  });
}

// ---- pure parts -------------------------------------------------------------
test('buildEvent hashes the personal fields the way Meta asks (trimmed, lower-cased SHA-256)', () => {
  const ev = buildEvent({ name: 'Purchase', id: 'purchase_cs_1', time: 1761400000, email: ' A.B@Example.COM ', externalId: USER, country: 'TR', ip: '203.0.113.7', ua: 'UA', fbp: FBP, url: 'https://www.fundocap.co/en/pricing', custom: { value: 10, currency: 'USD' } });
  assert.equal(ev.event_name, 'Purchase');
  assert.equal(ev.event_id, 'purchase_cs_1');
  assert.equal(ev.event_time, 1761400000);
  assert.equal(ev.action_source, 'website');
  assert.deepEqual(ev.user_data.em, [sha('a.b@example.com')]);
  assert.deepEqual(ev.user_data.external_id, [sha(USER)]);
  assert.deepEqual(ev.user_data.country, [sha('tr')]);
  assert.equal(ev.user_data.client_ip_address, '203.0.113.7');
  assert.equal(ev.user_data.fbp, FBP);
  assert.equal(ev.event_source_url, 'https://www.fundocap.co/en/pricing');
  assert.deepEqual(ev.custom_data, { value: 10, currency: 'USD' });
  // no plain e-mail anywhere in the payload
  assert.ok(!JSON.stringify(ev).toLowerCase().includes('example.com'));
});

test('cookies and event ids from the browser are validated, junk dropped', () => {
  assert.equal(cleanFbCookie(FBP), FBP);
  assert.equal(cleanFbCookie('fb.1.1761400000000.IwAR0abc-_.x'), 'fb.1.1761400000000.IwAR0abc-_.x');
  assert.equal(cleanFbCookie('<script>'), null);
  assert.equal(cleanFbCookie(''), null);
  assert.equal(cleanEventId('ic_0123456789abcdef'), 'ic_0123456789abcdef');
  assert.equal(cleanEventId('x'), null);
  assert.equal(cleanEventId('ic_bad id'), null);
});

test('sendMetaEvent is a no-op without configuration and never throws on a Graph error', async () => {
  unconfigure();
  assert.deepEqual(await sendMetaEvent({ name: 'Lead', id: 'lead_12345678' }), { ok: false, skipped: 'not-configured' });
  configure();
  process.env.META_CAPI_TOKEN = 'wrong';
  const r = await sendMetaEvent({ name: 'Lead', id: 'lead_12345678' });
  assert.equal(r.ok, false);
  assert.match(r.error, /bad token/);
  configure();
  const ok = await sendMetaEvent({ name: 'Lead', id: 'lead_12345678' });
  assert.deepEqual(ok, { ok: true });
  assert.match(metaCalls.at(-1).url, /^\/v21\.0\/123456789012345\/events$/);
});

// ---- /api/checkout ----------------------------------------------------------
test('/api/checkout with consent: InitiateCheckout to Meta, browser context on the session metadata', async () => {
  configure();
  metaCalls.length = 0;
  const r = await call(checkout, { token: 'tok-new', query: { cycle: 'y', mc: '1', eid: 'ic_0123456789abcdef', fbp: FBP, fbc: 'junk', url: 'https://www.fundocap.co/en/pricing' } });
  assert.equal(r.status, 200);
  assert.equal(r.body.url, 'https://checkout.stripe.test/cs_test_1');
  const s = sessions.at(-1);
  assert.equal(s.get('metadata[user_id]'), USER);
  assert.equal(s.get('metadata[meta_consent]'), '1');
  assert.equal(s.get('metadata[meta_ip]'), '203.0.113.7');
  assert.equal(s.get('metadata[meta_fbp]'), FBP);
  assert.equal(s.get('metadata[meta_fbc]'), null, 'invalid _fbc dropped');
  assert.equal(s.get('metadata[meta_url]'), 'https://www.fundocap.co/en/pricing');
  assert.equal(metaCalls.length, 1);
  const ev = metaCalls[0].body.data[0];
  assert.equal(ev.event_name, 'InitiateCheckout');
  assert.equal(ev.event_id, 'ic_0123456789abcdef');
  assert.deepEqual(ev.user_data.em, [sha('new.user@example.com')]);
  assert.deepEqual(ev.custom_data, { currency: 'USD', value: 199, content_ids: ['pro_y'], content_type: 'product' });
});

test('/api/checkout without consent (or without config) sends nothing to Meta and stores no browser context', async () => {
  configure();
  metaCalls.length = 0;
  await call(checkout, { token: 'tok-new', query: { cycle: 'm', eid: 'ic_0123456789abcdef', fbp: FBP } });
  assert.equal(metaCalls.length, 0);
  assert.equal(sessions.at(-1).get('metadata[meta_consent]'), null);
  assert.equal(sessions.at(-1).get('metadata[meta_ip]'), null);
  unconfigure();
  await call(checkout, { token: 'tok-new', query: { cycle: 'm', mc: '1', eid: 'ic_0123456789abcdef' } });
  assert.equal(metaCalls.length, 0);
  assert.equal(sessions.at(-1).get('metadata[meta_consent]'), null);
});

// ---- /api/meta-event --------------------------------------------------------
test('/api/meta-event: CompleteRegistration for a new account, id reg_<user id>; old accounts and strangers get nothing', async () => {
  configure();
  metaCalls.length = 0;
  const ok = await call(metaEvent, { token: 'tok-new', query: { event: 'registration', mc: '1', fbp: FBP } });
  assert.deepEqual(ok, { status: 200, body: { ok: true } });
  assert.equal(metaCalls.length, 1);
  const ev = metaCalls[0].body.data[0];
  assert.equal(ev.event_name, 'CompleteRegistration');
  assert.equal(ev.event_id, `reg_${USER}`);
  assert.deepEqual(ev.user_data.country, [sha('de')]);

  const old = await call(metaEvent, { token: 'tok-old', query: { event: 'registration' } });
  assert.deepEqual(old.body, { ok: false, skipped: 'not-new' });
  assert.equal((await call(metaEvent, { query: { event: 'registration' } })).status, 401);
  assert.equal((await call(metaEvent, { token: 'tok-new', query: { event: 'Purchase' } })).status, 400);
  assert.equal((await call(metaEvent, { token: 'tok-new', method: 'GET', query: { event: 'registration' } })).status, 405);
  assert.equal(metaCalls.length, 1);
});

// ---- client wiring ----------------------------------------------------------
const src = (...p) => fs.readFileSync(path.join(root, 'client', 'src', ...p), 'utf8');

test('client: the pixel loads only after consent, carries no personal data, and dedups with the server ids', () => {
  const px = src('lib', 'metaPixel.js');
  assert.match(px, /VITE_META_PIXEL_ID/);
  assert.match(px, /marketingAllowed\(\)/);
  assert.match(px, /eventID: `purchase_\$\{sessionId\}`/);
  assert.match(px, /eventID: `reg_\$\{user\.id\}`/);
  for (const line of px.split('\n')) {
    if (/fbq\('track'/.test(line)) assert.ok(!/email|\bem\b/.test(line), line.trim());
  }
  // the banner offers Reject as plainly as Accept, and the footer reopens it
  const banner = src('components', 'ConsentBanner.jsx');
  assert.match(banner, /choose\('denied'\)/);
  assert.match(banner, /choose\('granted'\)/);
  assert.match(src('components', 'Footer.jsx'), /reopenConsent/);
  assert.match(src('pages', 'Checkout.jsx'), /purchase\(sessionId\)/);
  assert.match(src('pages', 'Pricing.jsx'), /api\.checkout\(c, meta\)/);
  // GA4 and Clarity: behind the same consent, no personal data to GA
  const ga = src('lib', 'ga.js');
  const cl = src('lib', 'clarity.js');
  assert.match(ga, /VITE_GA_MEASUREMENT_ID/);
  assert.match(ga, /marketingAllowed\(\)/);
  assert.match(ga, /send_page_view: false/);
  assert.match(ga, /transaction_id: sessionId/);
  assert.doesNotMatch(ga, /user_id|email/);
  assert.match(cl, /VITE_CLARITY_ID/);
  assert.match(cl, /marketingAllowed\(\)/);
  assert.match(src('lib', 'analytics.js'), /gaProductEvent\(name, props\)/);
  assert.match(src('pages', 'Checkout.jsx'), /gaPurchase\(sessionId, info\)/);
  assert.match(src('components', 'ConsentBanner.jsx'), /tagsConfigured\(\)/);
  // privacy notice names Meta and the consent, TR and EN
  const legal = src('content', 'legal.js');
  assert.ok(legal.includes('Meta Conversions API'));
  assert.ok(legal.includes('Çerez tercihleri') && legal.includes('Cookie preferences'));
  assert.ok(legal.includes('Google Analytics 4') && legal.includes('Microsoft Clarity'));
});
