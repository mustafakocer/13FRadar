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

// ---- Supabase stand-in ------------------------------------------------------
const db = {
  profiles: new Map([
    [USER, { id: USER, plan: 'free', plan_expires: null, stripe_customer_id: null, stripe_subscription_id: null }],
  ]),
  events: new Map(),
};
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
      const c = eq('stripe_customer_id');
      return json(200, [...db.profiles.values()].filter((p) => p.stripe_customer_id === c).map((p) => ({ id: p.id })));
    }
    if (req.method === 'POST' && u.pathname === '/rest/v1/rpc/apply_stripe_event') {
      const b = JSON.parse(body);
      if (db.events.has(b.p_event_id)) return json(200, 'duplicate');
      db.events.set(b.p_event_id, { type: b.p_event_type, outcome: b.p_outcome });
      if (b.p_user_id && b.p_patch && Object.keys(b.p_patch).length) {
        const row = db.profiles.get(b.p_user_id);
        if (!row) return json(200, 'skipped:no-profile');
        for (const k of PATCHABLE) if (k in b.p_patch) row[k] = b.p_patch[k];
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
    if (req.method === 'GET' && req.url === '/v1/subscriptions/sub_1') {
      return json(200, { id: 'sub_1', status: 'active', customer: 'cus_1', current_period_end: PERIOD1 });
    }
    if (req.method === 'POST' && req.url === '/v1/customers/cus_1') return json(200, { id: 'cus_1' });
    json(404, { error: { message: `no route ${req.method} ${req.url}` } });
  });
});

const listen = (srv) =>
  new Promise((resolve) => srv.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${srv.address().port}`)));

process.env.SUPABASE_URL = await listen(supabase);
process.env.SUPABASE_ANON_KEY = 'anon-key';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'svc-key';
process.env.STRIPE_SECRET_KEY = 'sk_test_x';
process.env.STRIPE_WEBHOOK_SECRET = SECRET;
process.env.STRIPE_API_BASE = await listen(stripe);

const { default: handler } = await import('../api/_handlers/stripe-webhook.js');

test.after(() => {
  supabase.close();
  stripe.close();
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
    data: { object: { id: 'sub_1', status: 'active', customer: 'cus_1', metadata: { user_id: USER }, current_period_end: PERIOD2 } },
  });
  record('customer.subscription.updated (active)', r);
  assert.equal(r.status, 200);
  assert.equal(profile().plan, 'pro');
  assert.equal(profile().plan_expires, iso(PERIOD2));
});

test('customer.subscription.updated (past_due) → still pro until the period ends', async () => {
  const r = await deliver({
    id: 'evt_pastdue',
    type: 'customer.subscription.updated',
    data: { object: { id: 'sub_1', status: 'past_due', customer: 'cus_1', items: { data: [{ current_period_end: PERIOD3 }] } } },
  });
  record('customer.subscription.updated (past_due)', r);
  assert.equal(profile().plan, 'pro');
  assert.equal(profile().plan_expires, iso(PERIOD3));
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
    data: { object: { id: 'sub_1', status: 'canceled', customer: 'cus_1', metadata: { user_id: USER }, current_period_end: PERIOD3 } },
  });
  record('customer.subscription.updated (canceled)', r);
  assert.equal(profile().plan, 'free');
  assert.equal(profile().plan_expires, null);
});

test('customer.subscription.deleted (no metadata: matched by customer id) → free, expiry and subscription cleared', async () => {
  const r = await deliver({
    id: 'evt_deleted',
    type: 'customer.subscription.deleted',
    data: { object: { id: 'sub_1', status: 'canceled', customer: 'cus_1' } },
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
