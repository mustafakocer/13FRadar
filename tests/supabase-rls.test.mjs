// S2 acceptance against a real Supabase project, through PostgREST exactly as
// the client and the server reach it. Needs a project with migrations/
// applied and three secrets; without them every test is skipped, so CI
// without the secrets stays green and says why.
//
//   SUPABASE_TEST_URL          https://<ref>.supabase.co
//   SUPABASE_TEST_ANON_KEY     the anon (publishable) key
//   SUPABASE_TEST_SERVICE_KEY  the service_role key (creates and deletes the
//                              two throwaway users; never the production key
//                              of a project with real customers)
//
// The same checks run offline in tests/sql/0001_rls.test.sql (npm run test:db).
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import axios from 'axios';

const URL_ = (process.env.SUPABASE_TEST_URL || '').replace(/\/$/, '');
const ANON = process.env.SUPABASE_TEST_ANON_KEY || '';
const SERVICE = process.env.SUPABASE_TEST_SERVICE_KEY || '';
const enabled = Boolean(URL_ && ANON && SERVICE);
const skip = enabled ? false : 'SUPABASE_TEST_URL / _ANON_KEY / _SERVICE_KEY not set';

const http = axios.create({ baseURL: URL_, timeout: 15000, validateStatus: () => true });
const asKey = (key, token = key) => ({ apikey: key, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' });
const svc = () => asKey(SERVICE);
const user = (token) => asKey(ANON, token);

const users = [];
async function createUser(tag) {
  const email = `rls-${tag}-${crypto.randomBytes(4).toString('hex')}@example.com`;
  const password = crypto.randomBytes(12).toString('base64url');
  const r = await http.post('/auth/v1/admin/users', { email, password, email_confirm: true }, { headers: svc() });
  assert.equal(r.status, 200, `admin create user: ${JSON.stringify(r.data)}`);
  const s = await http.post('/auth/v1/token?grant_type=password', { email, password }, { headers: asKey(ANON) });
  assert.equal(s.status, 200, `sign in: ${JSON.stringify(s.data)}`);
  const u = { id: r.data.id, email, token: s.data.access_token };
  users.push(u);
  return u;
}

let A;
let B;
test.before(async () => {
  if (!enabled) return;
  A = await createUser('a');
  B = await createUser('b');
});
test.after(async () => {
  for (const u of users) await http.delete(`/auth/v1/admin/users/${u.id}`, { headers: svc() });
});

test('signup trigger made a free profile', { skip }, async () => {
  const r = await http.get('/rest/v1/profiles', { params: { select: 'id,plan' }, headers: user(A.token) });
  assert.equal(r.status, 200);
  assert.deepEqual(r.data, [{ id: A.id, plan: 'free' }]);
});

test('anon key + user JWT: update profiles set plan = pro → error, row unchanged', { skip }, async () => {
  for (const patch of [
    { plan: 'pro' },
    { plan_expires: '2099-01-01T00:00:00Z' },
    { stripe_customer_id: 'cus_forged' },
    { email: 'someone@else.test' },
  ]) {
    const r = await http.patch('/rest/v1/profiles', patch, {
      params: { id: `eq.${A.id}` },
      headers: { ...user(A.token), Prefer: 'return=representation' },
    });
    assert.ok(r.status >= 400, `${JSON.stringify(patch)} → HTTP ${r.status} ${JSON.stringify(r.data)}`);
    assert.equal(r.data?.code, '42501', JSON.stringify(r.data));
  }
  const pro = await http.post('/rest/v1/rpc/is_pro', {}, { headers: user(A.token) });
  assert.equal(pro.status, 200);
  assert.equal(pro.data, false);
});

test("another user's profiles / watchlists rows → 0 rows", { skip }, async () => {
  const ins = await http.post(
    '/rest/v1/watchlists',
    { user_id: B.id, cik: '0001067983', name: 'Berkshire' },
    { headers: { ...user(B.token), Prefer: 'return=minimal' } }
  );
  assert.equal(ins.status, 201, JSON.stringify(ins.data));

  const p = await http.get('/rest/v1/profiles', { params: { id: `eq.${B.id}`, select: 'id' }, headers: user(A.token) });
  assert.equal(p.status, 200);
  assert.deepEqual(p.data, []);

  const w = await http.get('/rest/v1/watchlists', { params: { user_id: `eq.${B.id}` }, headers: user(A.token) });
  assert.equal(w.status, 200);
  assert.deepEqual(w.data, []);

  const upd = await http.patch(
    '/rest/v1/watchlists',
    { name: 'x' },
    { params: { user_id: `eq.${B.id}` }, headers: { ...user(A.token), Prefer: 'return=representation' } }
  );
  assert.equal(upd.status, 200);
  assert.deepEqual(upd.data, []);

  const del = await http.delete('/rest/v1/watchlists', {
    params: { user_id: `eq.${B.id}` },
    headers: { ...user(A.token), Prefer: 'return=representation' },
  });
  assert.equal(del.status, 200);
  assert.deepEqual(del.data, []);

  const forged = await http.post(
    '/rest/v1/watchlists',
    { user_id: B.id, cik: '0001350694', name: 'forged' },
    { headers: { ...user(A.token), Prefer: 'return=minimal' } }
  );
  assert.ok(forged.status >= 400, `insert into B's watchlist → HTTP ${forged.status}`);

  const anon = await http.get('/rest/v1/profiles', { params: { select: 'id' }, headers: asKey(ANON) });
  assert.ok(anon.status >= 400 || anon.data.length === 0, `anon key sees ${JSON.stringify(anon.data)}`);
});

test('service_role: update plan → success; is_pro follows', { skip }, async () => {
  const r = await http.patch(
    '/rest/v1/profiles',
    { plan: 'pro', plan_expires: null },
    { params: { id: `eq.${A.id}` }, headers: { ...svc(), Prefer: 'return=representation' } }
  );
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data?.[0]?.plan, 'pro');

  const pro = await http.post('/rest/v1/rpc/is_pro', {}, { headers: user(A.token) });
  assert.equal(pro.data, true);
  // and only about themselves
  const other = await http.post('/rest/v1/rpc/is_pro', { uid: A.id }, { headers: user(B.token) });
  assert.equal(other.data, false);
});
