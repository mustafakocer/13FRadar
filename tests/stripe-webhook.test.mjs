// The Stripe webhook end to end, with Stripe and Supabase replaced by two
// local HTTP stand-ins: the real handler, real signature verification, real
// axios calls, and the same REST/RPC surface the production code talks to.
// The Supabase stand-in mirrors public.apply_stripe_event (whose SQL is
// tested in tests/sql/0003_stripe_events.test.sql).
//
// Prints the profiles row after every delivery, then proves a re-delivered
// event answers 200 and changes nothing.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';
import { Readable } from 'node:stream';

const SECRET = 'whsec_test_secret';
const USER = '11111111-2222-4333-8444-555555555555';
const PERIOD1 = 1_800_000_000; // 2027-01-15
const PERIOD2 = PERIOD1 + 31 * 86400;
const PERIOD3 = PERIOD2 + 31 * 86400;
// our price, and the price of another product sold from the same Stripe account
const PRICE = 'price_fundocap_monthly';
const FOREIGN_PRICE = 'price_other_product';
const OWN_ITEMS = { data: [{ price: { id: PRICE } }] };
const OTHER = '99999999-2222-4333-8444-555555555555';

// ---- Supabase stand-in ------------------------------------------------------
const db = {
  profiles: new Map([
    [USER, { id: USER, plan: 'free', plan_expires: null, stripe_customer_id: null, stripe_subscription_id: null }],
    [OTHER, { id: OTHER, plan: 'free', plan_expires: null, stripe_customer_id: null, stripe_subscription_id: null }],
  ]),
  events: new Map(),
  rpcCalls: [],
  legacy: false,
  profilesDown: false,
};
// what GET /v1/subscriptions/<id> and /v1/charges/<id> answer, set per test
const stripeObjects = new Map();
const PATCHABLE = ['plan', 'plan_expires', 'stripe_customer_id', 'stripe_subscription_id'];

const supabase = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    const json = (code, data) => {
      res.writeHead(code, { 'content-type': 'application/json' });
      res.end(JSON.stringify(data));
    };
    if (req.headers.apikey !== 'svc-key' || req.headers.authorization !== 'Bearer svc-key') {
      return json(401, { message: 'service key expected' });
    }
    const eq = (k) => (u.searchParams.get(k) || '').replace(/^eq\./, '');
    if (req.method === 'GET' && u.pathname === '/rest/v1/stripe_events') {
      return json(200, db.events.has(eq('id')) ? [{ id: eq('id') }] : []);
    }
    if (req.method === 'GET' && u.pathname === '/rest/v1/profiles') {
      if (db.profilesDown) return json(503, { message: 'upstream unavailable' });
      const c = eq('stripe_customer_id');
      return json(
        200,
        [...db.profiles.values()]
          .filter((p) => p.stripe_customer_id === c)
          .map((p) => ({ id: p.id, plan: p.plan, stripe_subscription_id: p.stripe_subscription_id }))
      );
    }
    if (req.method === 'POST' && u.pathname === '/rest/v1/rpc/apply_stripe_event') {
      const b = JSON.parse(body);
      db.rpcCalls.push(Object.keys(b).sort().join(','));
      // a database without migration 0008: the function has no p_event_at
      if (db.legacy && 'p_event_at' in b) {
        return json(404, { code: 'PGRST202', message: 'Could not find the function public.apply_stripe_event(...) in the schema cache' });
      }
      if (db.events.has(b.p_event_id)) return json(200, 'duplicate');
      db.events.set(b.p_event_id, { type: b.p_event_type, outcome: b.p_outcome });
      if (b.p_user_id && b.p_patch && Object.keys(b.p_patch).length) {
        const row = db.profiles.get(b.p_user_id);
        if (!row) return json(200, 'skipped:no-profile');
        // 0008: an event older than the last one applied to the row is stale
        if (b.p_event_at && row.stripe_event_at && Date.parse(b.p_event_at) < Date.parse(row.stripe_event_at)) {
          db.events.get(b.p_event_id).outcome = 'ignored:stale';
          return json(200, 'ignored:stale');
        }
        for (const k of PATCHABLE) if (k in b.p_patch) row[k] = b.p_patch[k];
        if (b.p_event_at) row.stripe_event_at = b.p_event_at;
      }
      return json(200, b.p_outcome);
    }
    json(404, { message: `no route ${req.method} ${u.pathname}` });
  });
});

// ---- Stripe stand-in --------------------------------------------------------
const stripeCalls = [];
const stripe = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    stripeCalls.push(`${req.method} ${req.url}`);
    const json = (code, data) => {
      res.writeHead(code, { 'content-type': 'application/json' });
      res.end(JSON.stringify(data));
    };
    if (req.headers.authorization !== 'Bearer sk_test_x') return json(401, { error: { message: 'bad key' } });
    if (req.method === 'GET' && stripeObjects.has(req.url)) return json(200, stripeObjects.get(req.url));
    if (req.method === 'GET' && req.url === '/v1/subscriptions/sub_1') {
      return json(200, { id: 'sub_1', status: 'active', customer: 'cus_1', current_period_end: PERIOD1, items: OWN_ITEMS });
    }
    if (req.method === 'GET' && req.url === '/v1/subscriptions/sub_other') {
      return json(200, {
        id: 'sub_other',
        status: 'trialing',
        customer: 'cus_other',
        items: { data: [{ current_period_end: PERIOD1, price: { id: FOREIGN_PRICE } }] },
      });
    }
    if (req.method === 'POST' && req.url === '/v1/customers/cus_1') return json(200, { id: 'cus_1' });
    json(404, { error: { message: `no route ${req.method} ${req.url}` } });
  });
});

// ---- Meta Graph API stand-in (the Purchase sent for a consenting buyer) ----
const metaCalls = [];
const meta = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    metaCalls.push(JSON.parse(body || '{}'));
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end('{"events_received":1}');
  });
});

const listen = (srv) =>
  new Promise((resolve) => srv.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${srv.address().port}`)));

process.env.SUPABASE_URL = await listen(supabase);
process.env.SUPABASE_ANON_KEY = 'anon-key';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'svc-key';
process.env.STRIPE_SECRET_KEY = 'sk_test_x';
process.env.STRIPE_WEBHOOK_SECRET = SECRET;
for (const k of Object.keys(process.env)) if (k.startsWith('STRIPE_PRICE_')) delete process.env[k];
process.env.STRIPE_PRICE_MONTHLY = PRICE;
process.env.STRIPE_API_BASE = await listen(stripe);
process.env.META_API_BASE = await listen(meta);
process.env.META_PIXEL_ID = '123456789012345';
process.env.META_CAPI_TOKEN = 'capi-token';

const { default: handler } = await import('../api/_handlers/stripe-webhook.js');

test.after(() => {
  supabase.close();
  stripe.close();
  meta.close();
});

// ---- driving the handler ----------------------------------------------------
function sign(raw, secret = SECRET, ts = Math.floor(Date.now() / 1000)) {
  const sig = crypto.createHmac('sha256', secret).update(`${ts}.${raw}`).digest('hex');
  return `t=${ts},v1=${sig}`;
}

function deliver(event, { signature } = {}) {
  const raw = JSON.stringify(event);
  const req = Readable.from([Buffer.from(raw)]);
  req.method = 'POST';
  req.headers = { 'stripe-signature': signature ?? sign(raw), 'content-type': 'application/json' };
  req.query = {};
  return new Promise((resolve) => {
    const res = {
      statusCode: 200,
      headers: {},
      setHeader(k, v) {
        this.headers[k] = v;
      },
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

const profile = () => ({ ...db.profiles.get(USER) });
const iso = (s) => new Date(s * 1000).toISOString();
const log = [];
const record = (label, r) => {
  const p = profile();
  log.push({ event: label, http: r.status, result: r.body.duplicate ? 'duplicate' : r.body.result || r.body.error, ...p });
};

test('rejects a bad signature and a payload without an event id', async () => {
  const r1 = await deliver({ id: 'evt_x', type: 'checkout.session.completed', data: { object: {} } }, { signature: sign('other') });
  assert.equal(r1.status, 401);
  const r2 = await deliver({ type: 'checkout.session.completed', data: { object: {} } });
  assert.equal(r2.status, 400);
  assert.equal(db.events.size, 0);
});

test('checkout.session.completed → pro, ids, plan_expires = current_period_end', async () => {
  const r = await deliver({
    id: 'evt_checkout',
    type: 'checkout.session.completed',
    data: {
      object: {
        id: 'cs_1',
        mode: 'subscription',
        payment_status: 'paid',
        client_reference_id: USER,
        metadata: { user_id: USER },
        customer: 'cus_1',
        subscription: 'sub_1',
      },
    },
  });
  record('checkout.session.completed', r);
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { ok: true, duplicate: false, event: 'checkout.session.completed', result: 'applied', plan: 'pro' });
  assert.deepEqual(profile(), {
    id: USER,
    plan: 'pro',
    plan_expires: iso(PERIOD1),
    stripe_customer_id: 'cus_1',
    stripe_subscription_id: 'sub_1',
  });
  assert.ok(stripeCalls.includes('GET /v1/subscriptions/sub_1'));
});

test('customer.subscription.updated (renewal) → plan_expires moves', async () => {
  const r = await deliver({
    id: 'evt_renew',
    type: 'customer.subscription.updated',
    data: { object: { id: 'sub_1', status: 'active', customer: 'cus_1', metadata: { user_id: USER }, current_period_end: PERIOD2, items: OWN_ITEMS } },
  });
  record('customer.subscription.updated (active)', r);
  assert.equal(r.status, 200);
  assert.equal(profile().plan, 'pro');
  assert.equal(profile().plan_expires, iso(PERIOD2));
});

// The renewal at PERIOD2 failed: Stripe has already moved the period to
// PERIOD2..PERIOD3 and marked the subscription past_due. Access runs for the
// grace from the start of that unpaid period, not to its end.
test('customer.subscription.updated (past_due) → pro for the grace only, never to the unpaid period end', async () => {
  const { PAST_DUE_GRACE_DAYS, planForSubscription } = await import('../api/_lib/stripe.js');
  const graceEnd = PERIOD2 + PAST_DUE_GRACE_DAYS * 86400;
  assert.ok(graceEnd < PERIOD3);
  const pastDue = (id) => ({
    id,
    type: 'customer.subscription.updated',
    data: {
      object: {
        id: 'sub_1',
        status: 'past_due',
        customer: 'cus_1',
        items: { data: [{ current_period_start: PERIOD2, current_period_end: PERIOD3, price: { id: PRICE } }] },
      },
    },
  });
  const r = await deliver(pastDue('evt_pastdue'));
  record('customer.subscription.updated (past_due)', r);
  assert.equal(r.body.result, 'applied');
  assert.equal(profile().plan, 'pro');
  assert.equal(profile().plan_expires, iso(graceEnd));
  // Stripe repeats the update while it retries: the expiry does not creep
  await deliver(pastDue('evt_pastdue2'));
  assert.equal(profile().plan_expires, iso(graceEnd));

  // the rule itself, both object shapes
  assert.deepEqual(planForSubscription({ status: 'past_due', current_period_start: PERIOD2, current_period_end: PERIOD3 }), {
    plan: 'pro',
    expires: iso(graceEnd),
  });
  // a period shorter than the grace ends with the period
  assert.deepEqual(planForSubscription({ status: 'past_due', current_period_start: PERIOD2, current_period_end: PERIOD2 + 86400 }), {
    plan: 'pro',
    expires: iso(PERIOD2 + 86400),
  });
  // nothing to count the grace from: the event decides nothing
  assert.equal(planForSubscription({ status: 'past_due', current_period_end: PERIOD3 }), null);
  // paid states still run to the period end
  assert.deepEqual(planForSubscription({ status: 'active', current_period_start: PERIOD2, current_period_end: PERIOD3 }), {
    plan: 'pro',
    expires: iso(PERIOD3),
  });
});

test('past_due without a period start → ignored, the expiry is not moved', async () => {
  const before = profile();
  const r = await deliver({
    id: 'evt_pastduebare',
    type: 'customer.subscription.updated',
    data: { object: { id: 'sub_1', status: 'past_due', customer: 'cus_1', items: { data: [{ current_period_end: PERIOD3, price: { id: PRICE } }] } } },
  });
  assert.equal(r.status, 200);
  assert.equal(r.body.result, 'ignored:past_due');
  assert.deepEqual(profile(), before);
});

test('invoice.payment_failed → logged, nothing changes', async () => {
  const before = profile();
  const r = await deliver({
    id: 'evt_failed',
    type: 'invoice.payment_failed',
    data: { object: { id: 'in_1', customer: 'cus_1', subscription: 'sub_1' } },
  });
  record('invoice.payment_failed', r);
  assert.equal(r.status, 200);
  assert.equal(r.body.result, 'logged');
  assert.deepEqual(profile(), before);
  assert.equal(db.events.get('evt_failed').outcome, 'logged');
});

test('customer.subscription.updated (canceled) → free', async () => {
  const r = await deliver({
    id: 'evt_canceled',
    type: 'customer.subscription.updated',
    data: { object: { id: 'sub_1', status: 'canceled', customer: 'cus_1', metadata: { user_id: USER }, current_period_end: PERIOD3, items: OWN_ITEMS } },
  });
  record('customer.subscription.updated (canceled)', r);
  assert.equal(profile().plan, 'free');
  assert.equal(profile().plan_expires, null);
});

test('customer.subscription.deleted (no metadata: matched by customer id) → free, expiry and subscription cleared', async () => {
  const r = await deliver({
    id: 'evt_deleted',
    type: 'customer.subscription.deleted',
    data: { object: { id: 'sub_1', status: 'canceled', customer: 'cus_1', items: OWN_ITEMS } },
  });
  record('customer.subscription.deleted', r);
  assert.deepEqual(profile(), {
    id: USER,
    plan: 'free',
    plan_expires: null,
    stripe_customer_id: 'cus_1',
    stripe_subscription_id: null,
  });
});

test('the same event delivered twice → 200, duplicate, database unchanged', async () => {
  const before = profile();
  const events = db.events.size;
  const calls = stripeCalls.length;
  const r = await deliver({
    id: 'evt_checkout',
    type: 'checkout.session.completed',
    data: {
      object: {
        id: 'cs_1',
        mode: 'subscription',
        payment_status: 'paid',
        client_reference_id: USER,
        customer: 'cus_1',
        subscription: 'sub_1',
      },
    },
  });
  record('checkout.session.completed (again)', r);
  assert.equal(r.status, 200);
  assert.equal(r.body.duplicate, true);
  assert.deepEqual(profile(), before, 'a replayed checkout must not re-grant pro');
  assert.equal(db.events.size, events);
  assert.equal(stripeCalls.length, calls, 'no Stripe call for a duplicate');
});

test('checkout without marketing consent sends nothing to Meta', () => {
  assert.equal(metaCalls.length, 0, 'the earlier checkout carried no meta_consent');
});

test('checkout.session.completed with meta_consent=1 → one Purchase to Meta, id purchase_<session>, value and hashed e-mail', async () => {
  const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
  const event = {
    id: 'evt_checkoutmeta',
    type: 'checkout.session.completed',
    created: 1761400000,
    data: {
      object: {
        id: 'cs_meta_1',
        mode: 'subscription',
        payment_status: 'paid',
        client_reference_id: USER,
        customer: 'cus_1',
        subscription: 'sub_1',
        amount_total: 19900,
        currency: 'usd',
        customer_details: { email: 'Buyer@Example.com', address: { country: 'TR' } },
        metadata: { user_id: USER, meta_consent: '1', meta_ip: '203.0.113.7', meta_ua: 'UA', meta_fbp: 'fb.1.1761400000000.1234567890', meta_url: 'https://www.fundocap.co/en/pricing' },
      },
    },
  };
  const r = await deliver(event);
  assert.equal(r.status, 200);
  assert.equal(r.body.result, 'applied');
  assert.equal(metaCalls.length, 1);
  const ev = metaCalls[0].data[0];
  assert.equal(ev.event_name, 'Purchase');
  assert.equal(ev.event_id, 'purchase_cs_meta_1');
  assert.equal(ev.event_time, 1761400000);
  assert.deepEqual(ev.custom_data, { currency: 'USD', value: 199, content_type: 'product', content_ids: ['pro'] });
  assert.deepEqual(ev.user_data.em, [sha('buyer@example.com')]);
  assert.deepEqual(ev.user_data.external_id, [sha(USER)]);
  assert.equal(ev.user_data.client_ip_address, '203.0.113.7');
  assert.equal(ev.user_data.fbp, 'fb.1.1761400000000.1234567890');
  // a re-delivery is a duplicate: no second Purchase
  const again = await deliver(event);
  assert.equal(again.body.duplicate, true);
  assert.equal(metaCalls.length, 1);
});

// The Stripe account sells another product too, and Stripe sends that
// product's events to this endpoint. None of them may touch a profile, even
// when they name one of our users.
test("another product's checkout naming our user → ignored:foreign-price, no Pro", async () => {
  const before = { ...db.profiles.get(OTHER) };
  const metaBefore = metaCalls.length;
  const r = await deliver({
    id: 'evt_foreigncheckout',
    type: 'checkout.session.completed',
    data: {
      object: {
        id: 'cs_other',
        mode: 'subscription',
        payment_status: 'paid',
        client_reference_id: OTHER,
        customer: 'cus_other',
        subscription: 'sub_other',
        metadata: { meta_consent: '1' },
      },
    },
  });
  assert.equal(r.status, 200);
  assert.equal(r.body.result, 'ignored:foreign-price');
  assert.equal(r.body.plan, null);
  assert.deepEqual(db.profiles.get(OTHER), before);
  // recorded, so Stripe does not retry it; and no Purchase goes to Meta
  assert.equal(db.events.get('evt_foreigncheckout').outcome, 'ignored:foreign-price');
  assert.equal(metaCalls.length, metaBefore);
});

test("another product's subscription events (created, renewed, cancelled) change nothing", async () => {
  // give our user a live plan first, so a wrongly applied cancellation shows
  const live = await deliver({
    id: 'evt_regrant',
    type: 'customer.subscription.updated',
    data: { object: { id: 'sub_1', status: 'active', customer: 'cus_1', metadata: { user_id: USER }, current_period_end: PERIOD3, items: OWN_ITEMS } },
  });
  assert.equal(live.body.result, 'applied');
  const mine = profile();
  assert.equal(mine.plan, 'pro');
  const other = { ...db.profiles.get(OTHER) };
  const sub = (status) => ({
    id: 'sub_other',
    status,
    customer: 'cus_1', // even on a customer id one of our profiles carries
    metadata: { user_id: USER },
    items: { data: [{ current_period_end: PERIOD1, price: { id: FOREIGN_PRICE } }] },
  });
  for (const [id, type, status] of [
    ['evt_foreigncreated', 'customer.subscription.created', 'trialing'],
    ['evt_foreignupdated', 'customer.subscription.updated', 'active'],
    ['evt_foreigncanceled', 'customer.subscription.updated', 'canceled'],
    ['evt_foreigndeleted', 'customer.subscription.deleted', 'canceled'],
  ]) {
    const r = await deliver({ id, type, data: { object: sub(status) } });
    assert.equal(r.status, 200, id);
    assert.equal(r.body.result, 'ignored:foreign-price', id);
    assert.equal(db.events.get(id).outcome, 'ignored:foreign-price', id);
  }
  // a subscription object that names no price at all is not ours either
  const bare = await deliver({
    id: 'evt_bare',
    type: 'customer.subscription.updated',
    data: { object: { id: 'sub_x', status: 'active', metadata: { user_id: OTHER }, current_period_end: PERIOD3 } },
  });
  assert.equal(bare.body.result, 'ignored:foreign-price');
  assert.deepEqual(profile(), mine);
  assert.deepEqual(db.profiles.get(OTHER), other);
});

test('a retired price listed in STRIPE_PRICE_LEGACY still counts as ours', async () => {
  process.env.STRIPE_PRICE_LEGACY = ' price_old_a , price_old_b ';
  try {
    const r = await deliver({
      id: 'evt_legacy',
      type: 'customer.subscription.updated',
      data: { object: { id: 'sub_old', status: 'active', metadata: { user_id: OTHER }, plan: { id: 'price_old_b' }, current_period_end: PERIOD2 } },
    });
    assert.equal(r.body.result, 'applied');
    assert.equal(db.profiles.get(OTHER).plan, 'pro');
    assert.equal(db.profiles.get(OTHER).plan_expires, iso(PERIOD2));
  } finally {
    delete process.env.STRIPE_PRICE_LEGACY;
  }
});

test('no price id configured: nothing is granted, a cancellation still downgrades', async () => {
  delete process.env.STRIPE_PRICE_MONTHLY;
  try {
    const before = profile();
    const grant = await deliver({
      id: 'evt_unconfgrant',
      type: 'customer.subscription.updated',
      data: { object: { id: 'sub_1', status: 'active', metadata: { user_id: USER }, items: OWN_ITEMS, current_period_end: PERIOD1 } },
    });
    assert.equal(grant.body.result, 'ignored:prices-not-configured');
    assert.deepEqual(profile(), before);
    const checkout = await deliver({
      id: 'evt_unconfcheckout',
      type: 'checkout.session.completed',
      data: { object: { id: 'cs_u', mode: 'subscription', payment_status: 'paid', client_reference_id: USER, customer: 'cus_1', subscription: 'sub_1' } },
    });
    assert.equal(checkout.body.result, 'ignored:prices-not-configured');
    assert.deepEqual(profile(), before);
    assert.equal(db.profiles.get(OTHER).plan, 'pro');
    const gone = await deliver({
      id: 'evt_unconfdeleted',
      type: 'customer.subscription.deleted',
      data: { object: { id: 'sub_old', status: 'canceled', metadata: { user_id: OTHER }, plan: { id: 'price_old_b' } } },
    });
    assert.equal(gone.body.result, 'applied');
    assert.equal(db.profiles.get(OTHER).plan, 'free');
  } finally {
    process.env.STRIPE_PRICE_MONTHLY = PRICE;
  }
});

// ---- refunds, disputes, ordering --------------------------------------------
// A third account with its own customer and subscription, so the tables
// printed for USER above stay as they were.
const THIRD = '33333333-2222-4333-8444-555555555555';
const T0 = 1_900_000_000;
const MONTH = 30 * 86400;
const third = () => ({ ...db.profiles.get(THIRD) });
const sub3 = (over = {}) => ({
  id: 'sub_3',
  status: 'active',
  customer: 'cus_3',
  metadata: { user_id: THIRD },
  items: { data: [{ current_period_start: T0, current_period_end: T0 + MONTH, price: { id: PRICE } }] },
  ...over,
});
// (re)open Pro for THIRD with a subscription event created at `at`
async function grantThird(id, at) {
  stripeObjects.set('/v1/subscriptions/sub_3', sub3());
  const r = await deliver({ id, type: 'customer.subscription.updated', created: at, data: { object: sub3() } });
  assert.equal(r.body.result, 'applied', id);
  assert.equal(third().plan, 'pro', id);
}
// anything the handler writes to Stripe, apart from the best-effort user_id
// note it leaves on the customer after a subscription event
const writesToStripe = () => stripeCalls.filter((c) => !c.startsWith('GET ') && !c.startsWith('POST /v1/customers/'));

test('charge.refunded in full for the current period → free, and nothing is written to Stripe', async () => {
  db.profiles.set(THIRD, { id: THIRD, plan: 'free', plan_expires: null, stripe_customer_id: null, stripe_subscription_id: null });
  await grantThird('evt_rgrant', T0);
  assert.equal(third().plan_expires, iso(T0 + MONTH));
  const writes = writesToStripe().length;
  const r = await deliver({
    id: 'evt_refund',
    type: 'charge.refunded',
    created: T0 + 3600,
    data: { object: { id: 'ch_1', customer: 'cus_3', amount: 1990, amount_refunded: 1990, refunded: true, created: T0 + 5 } },
  });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { ok: true, duplicate: false, event: 'charge.refunded', result: 'applied', plan: 'free' });
  assert.equal(third().plan, 'free');
  assert.equal(third().plan_expires, null);
  // the subscription is the owner's to cancel; the ids stay for the portal
  assert.equal(third().stripe_subscription_id, 'sub_3');
  assert.equal(third().stripe_customer_id, 'cus_3');
  assert.equal(writesToStripe().length, writes, 'the handler never cancels or refunds');
  assert.ok(stripeCalls.includes('GET /v1/subscriptions/sub_3'));
});

test('a partial refund, and a refund of an earlier period, are logged and change nothing', async () => {
  await grantThird('evt_rgrant2', T0 + 2 * 3600);
  const before = third();
  const partial = await deliver({
    id: 'evt_refundpartial',
    type: 'charge.refunded',
    created: T0 + 3 * 3600,
    data: { object: { id: 'ch_1', customer: 'cus_3', amount: 1990, amount_refunded: 500, refunded: false, created: T0 + 5 } },
  });
  assert.equal(partial.body.result, 'logged:partial-refund');
  assert.equal(partial.body.plan, null);
  const earlier = await deliver({
    id: 'evt_refundearlier',
    type: 'charge.refunded',
    created: T0 + 3 * 3600,
    data: { object: { id: 'ch_0', customer: 'cus_3', amount: 1990, amount_refunded: 1990, refunded: true, created: T0 - MONTH } },
  });
  assert.equal(earlier.body.result, 'logged:refund-earlier-period');
  assert.deepEqual(third(), before);
  assert.equal(db.events.get('evt_refundpartial').outcome, 'logged:partial-refund');
});

test("another product's refund or dispute never touches a profile", async () => {
  const before = third();
  const calls = stripeCalls.length;
  // its customer is on none of our profiles: stops without a call to Stripe
  const r1 = await deliver({
    id: 'evt_refundforeign',
    type: 'charge.refunded',
    created: T0 + 4 * 3600,
    data: { object: { id: 'ch_f', customer: 'cus_otherproduct', amount: 129900, amount_refunded: 129900, refunded: true, created: T0 + 10 } },
  });
  assert.equal(r1.status, 200);
  assert.equal(r1.body.result, 'skipped:no-user');
  assert.equal(stripeCalls.length, calls);
  // even with the customer id on a profile, the subscription must be on one of our prices…
  stripeObjects.set('/v1/subscriptions/sub_3', sub3({ items: { data: [{ current_period_start: T0, current_period_end: T0 + MONTH, price: { id: FOREIGN_PRICE } }] } }));
  const r2 = await deliver({
    id: 'evt_refundforeignprice',
    type: 'charge.refunded',
    created: T0 + 4 * 3600,
    data: { object: { id: 'ch_f2', customer: 'cus_3', amount: 1990, amount_refunded: 1990, refunded: true, created: T0 + 10 } },
  });
  assert.equal(r2.body.result, 'ignored:foreign-price');
  // …and belong to the customer that was charged
  stripeObjects.set('/v1/subscriptions/sub_3', sub3({ customer: 'cus_someone_else' }));
  stripeObjects.set('/v1/charges/ch_f3', { id: 'ch_f3', customer: 'cus_3', created: T0 + 10 });
  const r3 = await deliver({
    id: 'evt_disputeforeign',
    type: 'charge.dispute.created',
    created: T0 + 4 * 3600,
    data: { object: { id: 'dp_f', charge: 'ch_f3', status: 'needs_response' } },
  });
  assert.equal(r3.body.result, 'ignored:customer-mismatch');
  // a charge with no customer at all
  const r4 = await deliver({
    id: 'evt_refundnocustomer',
    type: 'charge.refunded',
    created: T0 + 4 * 3600,
    data: { object: { id: 'ch_f4', customer: null, amount: 100, amount_refunded: 100, refunded: true, created: T0 + 10 } },
  });
  assert.equal(r4.body.result, 'skipped:no-user');
  assert.deepEqual(third(), before);
  stripeObjects.set('/v1/subscriptions/sub_3', sub3());
});

test('a refund is not dropped when the profile lookup fails: 500, nothing recorded, Stripe retries', async () => {
  const before = third();
  const event = {
    id: 'evt_refundoutage',
    type: 'charge.refunded',
    created: T0 + 5 * 3600,
    data: { object: { id: 'ch_2', customer: 'cus_3', amount: 1990, amount_refunded: 1990, refunded: true, created: T0 + 20 } },
  };
  db.profilesDown = true;
  try {
    const r = await deliver(event);
    assert.equal(r.status, 500);
    assert.equal(db.events.has('evt_refundoutage'), false);
    assert.deepEqual(third(), before);
  } finally {
    db.profilesDown = false;
  }
  const retry = await deliver(event);
  assert.equal(retry.body.result, 'applied');
  assert.equal(third().plan, 'free');
});

test('charge.dispute.created → free at once; closed won restores nothing; closed lost → free', async () => {
  await grantThird('evt_dgrant', T0 + 6 * 3600);
  stripeObjects.set('/v1/charges/ch_3', { id: 'ch_3', customer: 'cus_3', created: T0 - 2 * MONTH });
  const opened = await deliver({
    id: 'evt_dispute',
    type: 'charge.dispute.created',
    created: T0 + 7 * 3600,
    data: { object: { id: 'dp_1', charge: 'ch_3', status: 'needs_response' } },
  });
  assert.equal(opened.body.result, 'applied');
  assert.equal(opened.body.plan, 'free');
  // any disputed charge ends access, whichever period it paid for
  assert.equal(third().plan, 'free');
  assert.equal(third().plan_expires, null);
  assert.ok(stripeCalls.includes('GET /v1/charges/ch_3'));

  const won = await deliver({
    id: 'evt_disputewon',
    type: 'charge.dispute.closed',
    created: T0 + 8 * 3600,
    data: { object: { id: 'dp_1', charge: 'ch_3', status: 'won' } },
  });
  assert.equal(won.body.result, 'logged:dispute-won');
  assert.equal(third().plan, 'free', 'a won dispute does not re-open Pro by itself');

  await grantThird('evt_dgrant2', T0 + 9 * 3600);
  const lost = await deliver({
    id: 'evt_disputelost',
    type: 'charge.dispute.closed',
    created: T0 + 10 * 3600,
    // the charge expanded in the event: no call to Stripe for it
    data: { object: { id: 'dp_2', charge: { id: 'ch_4', customer: 'cus_3', created: T0 }, status: 'lost' } },
  });
  assert.equal(lost.body.result, 'applied');
  assert.equal(third().plan, 'free');
  assert.equal(stripeCalls.includes('GET /v1/charges/ch_4'), false);
});

// Stripe does not order deliveries. The subscription was renewed at +11h and
// deleted at +12h; the renewal's event arrives after the deletion's.
test('an older event delivered after a newer one → ignored:stale, the plan stays; its redelivery is a duplicate', async () => {
  const deleted = await deliver({
    id: 'evt_odeleted',
    type: 'customer.subscription.deleted',
    created: T0 + 12 * 3600,
    data: { object: sub3({ status: 'canceled' }) },
  });
  assert.equal(deleted.body.result, 'applied');
  const before = third();
  assert.equal(before.plan, 'free');
  assert.equal(before.stripe_event_at, iso(T0 + 12 * 3600));
  const late = {
    id: 'evt_olate',
    type: 'customer.subscription.updated',
    created: T0 + 11 * 3600,
    data: { object: sub3() },
  };
  const r = await deliver(late);
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { ok: true, duplicate: false, event: 'customer.subscription.updated', result: 'ignored:stale', plan: null });
  assert.deepEqual(third(), before, 'a late active event must not re-open Pro');
  assert.equal(db.events.get('evt_olate').outcome, 'ignored:stale');
  const again = await deliver(late);
  assert.equal(again.status, 200);
  assert.equal(again.body.duplicate, true);
  assert.deepEqual(third(), before);
  // a genuinely newer event still applies
  await grantThird('evt_onewer', T0 + 13 * 3600);
  assert.equal(third().stripe_event_at, iso(T0 + 13 * 3600));
});

test('a database without migration 0008 still takes events (no ordering check, same idempotency)', async () => {
  db.legacy = true;
  db.rpcCalls.length = 0;
  try {
    const r = await deliver({
      id: 'evt_legacydb',
      type: 'customer.subscription.deleted',
      created: T0 + 14 * 3600,
      data: { object: sub3({ status: 'canceled' }) },
    });
    assert.equal(r.status, 200);
    assert.equal(r.body.result, 'applied');
    assert.equal(third().plan, 'free');
    // first with the event time, then the five-argument call the old function has
    assert.deepEqual(db.rpcCalls, [
      'p_event_at,p_event_id,p_event_type,p_outcome,p_patch,p_user_id',
      'p_event_id,p_event_type,p_outcome,p_patch,p_user_id',
    ]);
    const again = await deliver({
      id: 'evt_legacydb',
      type: 'customer.subscription.deleted',
      created: T0 + 14 * 3600,
      data: { object: sub3({ status: 'canceled' }) },
    });
    assert.equal(again.body.duplicate, true);
  } finally {
    db.legacy = false;
  }
});

test('an event Stripe sends that we do not act on is recorded and answered 200', async () => {
  const r = await deliver({ id: 'evt_other', type: 'customer.created', data: { object: { id: 'cus_9' } } });
  assert.equal(r.status, 200);
  assert.equal(r.body.result, 'ignored');
  assert.equal(db.events.get('evt_other').outcome, 'ignored');
});

test.after(() => {
  const cols = ['event', 'http', 'result', 'plan', 'plan_expires', 'stripe_customer_id', 'stripe_subscription_id'];
  const lines = [
    `| ${cols.join(' | ')} |`,
    `|${cols.map(() => '---').join('|')}|`,
    ...log.map((r) => `| ${cols.map((c) => String(r[c] ?? 'null')).join(' | ')} |`),
  ];
  console.log(`\nprofiles row after each delivery:\n${lines.join('\n')}\n`);
});
