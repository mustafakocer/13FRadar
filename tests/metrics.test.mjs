// The weekly business figures (api/_lib/metrics.js, scripts/send-metrics.mjs):
// the counts are right, the mail holds counts only, no address is ever read,
// and inside GitHub Actions — a public log — nothing is printed.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { root } from './helpers.mjs';
import { METRIC_READS, isProRow, renderMetricsMail, summarizeMetrics } from '../api/_lib/metrics.js';

const NOW = Date.parse('2026-11-16T05:13:00Z');
const ago = (days) => new Date(NOW - days * 86400000).toISOString();
const ahead = (days) => new Date(NOW + days * 86400000).toISOString();

const PROFILES = [
  { plan: 'free', plan_expires: null, created_at: ago(400) },
  { plan: 'free', plan_expires: null, created_at: ago(3) },
  { plan: 'free', plan_expires: null, created_at: ago(6.9) },
  { plan: 'free', plan_expires: null, created_at: ago(10) },
  { plan: 'free', plan_expires: null, created_at: ago(29) },
  { plan: 'pro', plan_expires: ahead(20), created_at: ago(60) },
  { plan: 'pro', plan_expires: ahead(3), created_at: ago(27) }, // renews or lapses this week
  { plan: 'pro', plan_expires: null, created_at: ago(200) }, // a manual grant
  { plan: 'pro', plan_expires: ago(2), created_at: ago(90) }, // expired, plan not yet reset
  { plan: 'free', plan_expires: ago(40), created_at: ago(120) },
];
const SUBSCRIBERS = [
  { status: 'confirmed', newsletter: true, lang: 'tr', source: 'newsletter', magnets: ['newsletter'], created_at: ago(2), confirmed_at: ago(2), unsubscribed_at: null },
  { status: 'confirmed', newsletter: true, lang: 'tr', source: 'report', magnets: ['report:2026-q3', 'newsletter', 'report:2026-q2'], created_at: ago(9), confirmed_at: ago(8), unsubscribed_at: null },
  { status: 'confirmed', newsletter: false, lang: 'en', source: 'guru', magnets: ['guru:0001067983'], created_at: ago(50), confirmed_at: ago(50), unsubscribed_at: null },
  { status: 'pending', newsletter: true, lang: 'tr', source: 'match', magnets: ['match'], created_at: ago(1), confirmed_at: null, unsubscribed_at: null },
  { status: 'pending', newsletter: false, lang: 'en', source: 'xl-insiders', magnets: ['xl-insiders'], created_at: ago(20), confirmed_at: null, unsubscribed_at: null },
  { status: 'unsubscribed', newsletter: false, lang: 'tr', source: 'newsletter', magnets: ['newsletter'], created_at: ago(25), confirmed_at: ago(25), unsubscribed_at: ago(4) },
];
const STRIPE = [
  { type: 'checkout.session.completed', outcome: 'applied', processed_at: ago(1) },
  { type: 'checkout.session.completed', outcome: 'applied', processed_at: ago(27) },
  { type: 'checkout.session.completed', outcome: 'ignored:unpaid', processed_at: ago(2) }, // not a subscription
  { type: 'customer.subscription.updated', outcome: 'applied', processed_at: ago(1) },
  { type: 'customer.subscription.deleted', outcome: 'applied', processed_at: ago(12) },
  { type: 'customer.subscription.deleted', outcome: 'skipped:no-user', processed_at: ago(3) },
  { type: 'invoice.payment_failed', outcome: 'logged', processed_at: ago(5) },
];
const WATCHLISTS = [{ user_id: 'a' }, { user_id: 'a' }, { user_id: 'b' }, { user_id: 'c' }];
const DIGEST = [{ user_id: 'a' }, { user_id: 'c' }];

const input = { profiles: PROFILES, subscribers: SUBSCRIBERS, stripeEvents: STRIPE, watchlists: WATCHLISTS, digestPrefs: DIGEST, now: NOW };

test('isProRow is the database’s is_pro(): pro with no expiry or one still ahead', () => {
  assert.equal(isProRow({ plan: 'pro', plan_expires: null }, NOW), true);
  assert.equal(isProRow({ plan: 'pro', plan_expires: ahead(1) }, NOW), true);
  assert.equal(isProRow({ plan: 'pro', plan_expires: ago(1) }, NOW), false);
  assert.equal(isProRow({ plan: 'pro', plan_expires: 'not a date' }, NOW), false);
  assert.equal(isProRow({ plan: 'free', plan_expires: ahead(1) }, NOW), false);
  assert.equal(isProRow(null, NOW), false);
});

test('summarizeMetrics: accounts, Pro, subscribers and use, each in its window', () => {
  const m = summarizeMetrics(input);
  assert.equal(m.asOf, '2026-11-16');
  assert.deepEqual(m.accounts, { total: 10, new7: 2, prev7: 1, new30: 5 });
  assert.equal(m.pro.active, 3);
  assert.equal(m.pro.share, 0.3);
  assert.equal(m.pro.openEnded, 1);
  assert.equal(m.pro.due7, 1);
  assert.equal(m.pro.lapsed, 1, 'pro on paper, expired two days ago');
  assert.deepEqual([m.pro.started7, m.pro.started30], [1, 2], 'only applied checkouts are new subscriptions');
  assert.deepEqual([m.pro.ended7, m.pro.ended30], [0, 1], 'a deletion with no account behind it is not a churned subscriber');
  assert.equal(m.pro.paymentFailed7, 1);
  const s = m.subscribers;
  assert.deepEqual([s.confirmed, s.pending, s.unsubscribed, s.newsletter], [3, 2, 1, 2]);
  assert.deepEqual([s.confirmed7, s.prevConfirmed7, s.confirmed30, s.unsubscribed30], [1, 1, 2, 1]);
  assert.equal(s.confirmRate30, 2 / 5, 'five addresses left in 30 days, two confirmed');
  assert.deepEqual(s.byLang, [['tr', 2], ['en', 1]]);
  assert.deepEqual(s.bySource, [['guru', 1], ['newsletter', 1], ['report', 1]]);
  assert.deepEqual(s.byMagnet, [['newsletter', 2], ['guru', 1], ['report', 1]], 'two reports asked by one reader count once');
  assert.deepEqual(m.activation, { withWatchlist: 3, digestOptIn: 2 });
});

test('summarizeMetrics: nothing in, zeros out, no division by zero', () => {
  const m = summarizeMetrics({ now: NOW });
  assert.equal(m.accounts.total, 0);
  assert.equal(m.pro.share, null);
  assert.equal(m.subscribers.confirmRate30, null);
  const mail = renderMetricsMail(m);
  assert.match(mail.text, /Aktif: 0 \(hesapların —'i\)/);
  assert.ok(!/NaN|undefined|null/.test(mail.text), mail.text);
});

test('the mail: Turkish, plain, counts only, and it says what it does not know', () => {
  const mail = renderMetricsMail(summarizeMetrics(input));
  assert.equal(mail.subject, 'Fundocap rakamlar 2026-11-16: 3 Pro · 10 hesap · 3 abone');
  assert.match(mail.text, /Son 7 gün: \+2 \(önceki 7 gün: \+1\)/);
  assert.match(mail.text, /Aktif: 3 \(hesapların %30,0'i\)/);
  assert.match(mail.text, /Yeni abonelik: 7 günde 1, 30 günde 2/);
  assert.match(mail.text, /Biten abonelik: 7 günde 0, 30 günde 1/);
  assert.match(mail.text, /DİKKAT: süresi geçmiş ama planı hâlâ "pro" yazan hesap: 1/);
  assert.match(mail.text, /30 günlük onay oranı: %40/);
  assert.match(mail.text, /Takip listesi olan hesap: 3/);
  assert.match(mail.text, /gelir ve MRR \(Stripe panosu\)/);
  assert.ok(!mail.text.includes('@'), 'no address in the mail');
  assert.ok(!/NaN|undefined/.test(mail.text));
});

test('the reads ask for no address, token or customer id', () => {
  for (const [table, q] of Object.entries(METRIC_READS)) assert.ok(!/email|token|customer|consent_ip/.test(q.select), `${table}: ${q.select}`);
});

// ---- the script, against a stand-in Supabase REST + Resend ----
// The script counts at the real clock, the fixtures are dated around NOW:
// these tests assert what does not move with the day (totals, wording, what
// is read, sent and printed); the windows are covered above.
function run(args, env) {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, ['scripts/send-metrics.mjs', ...args], { cwd: root, env: { ...process.env, GITHUB_ACTIONS: '', METRICS_TO: '', RESEND_API_KEY: '', LEAD_FROM: '', ALERT_FROM: '', ...env } });
    let out = '';
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => (out += d));
    p.on('close', (code) => resolve({ code, out }));
  });
}

function stub({ mailStatus = 200 } = {}) {
  const hits = [];
  const tables = { profiles: PROFILES, subscribers: SUBSCRIBERS, stripe_events: STRIPE, watchlists: WATCHLISTS, notification_prefs: DIGEST };
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (d) => (body += d));
    req.on('end', () => {
      hits.push({ method: req.method, url: req.url, body });
      res.setHeader('content-type', 'application/json');
      if (req.url.startsWith('/emails')) {
        res.statusCode = mailStatus;
        return res.end(JSON.stringify(mailStatus < 300 ? { id: 'em_1' } : { message: 'domain not verified' }));
      }
      const table = /^\/rest\/v1\/([a-z_]+)/.exec(req.url)?.[1];
      res.end(JSON.stringify(tables[table] || []));
    });
  });
  return new Promise((r) => server.listen(0, '127.0.0.1', () => r({ server, hits, url: `http://127.0.0.1:${server.address().port}` })));
}
const supa = (url) => ({ SUPABASE_URL: url, SUPABASE_ANON_KEY: 'anon', SUPABASE_SERVICE_ROLE_KEY: 'service-role' });
const mailEnv = (url) => ({ RESEND_API_KEY: 're_test', LEAD_FROM: 'Fundocap <bulten@example.test>', RESEND_BASE_URL: url });

test('a real run without METRICS_TO or a mail key exits 1, names them and reads nothing', async () => {
  const { server, hits, url } = await stub();
  try {
    const r = await run([], supa(url));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /RESEND_API_KEY \/ LEAD_FROM and METRICS_TO not set/);
    assert.deepEqual(hits, [], 'nothing was read');
    const noKey = await run(['--dry-run'], { SUPABASE_URL: url, SUPABASE_ANON_KEY: 'anon', SUPABASE_SERVICE_ROLE_KEY: '' });
    assert.equal(noKey.code, 1);
    assert.match(noKey.out, /SUPABASE_SERVICE_ROLE_KEY is not set/);
  } finally {
    server.close();
  }
});

test('a METRICS_TO that is not an address stops the run without printing it', async () => {
  const { server, hits, url } = await stub();
  try {
    const r = await run([], { ...supa(url), ...mailEnv(url), METRICS_TO: 'owner@example.test, not-an-address' });
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /1 value\(s\) that are not an email address/);
    assert.ok(!r.out.includes('not-an-address') && !r.out.includes('owner@example.test'), r.out);
    assert.deepEqual(hits, []);
  } finally {
    server.close();
  }
});

test('a dry run on a workstation prints the mail and sends nothing; it never asks for an address', async () => {
  const { server, hits, url } = await stub();
  try {
    const r = await run(['--dry-run'], supa(url));
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /\[dry run\] nothing sent/);
    assert.match(r.out, /Fundocap rakamlar \d{4}-\d{2}-\d{2}: \d+ Pro · 10 hesap · 3 abone/);
    assert.match(r.out, /Toplam: 10\n/);
    assert.ok(!hits.some((h) => h.url.startsWith('/emails')), 'nothing sent');
    assert.deepEqual([...new Set(hits.map((h) => /^\/rest\/v1\/([a-z_]+)/.exec(h.url)[1]))].sort(), ['notification_prefs', 'profiles', 'stripe_events', 'subscribers', 'watchlists']);
    for (const h of hits) {
      assert.equal(h.method, 'GET', 'the job only reads');
      const select = new URL(h.url, 'http://x').searchParams.get('select');
      assert.ok(select && !/email|token|customer/.test(select), `${h.url}`);
    }
    const stripe = new URL(hits.find((h) => h.url.startsWith('/rest/v1/stripe_events')).url, 'http://x').searchParams.get('processed_at');
    assert.match(stripe, /^gte\.\d{4}-\d{2}-\d{2}T/, 'only the recent Stripe deliveries are read');
  } finally {
    server.close();
  }
});

test('inside GitHub Actions a dry run prints no figure: the log is public', async () => {
  const { server, url } = await stub();
  try {
    const r = await run(['--dry-run'], { ...supa(url), GITHUB_ACTIONS: 'true' });
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /not printed: this log is public/);
    assert.ok(!/Aktif|Pro ·|hesap|abone/.test(r.out), r.out);
  } finally {
    server.close();
  }
});

test('a real run mails each recipient once and prints neither figures nor addresses', async () => {
  const { server, hits, url } = await stub();
  try {
    const r = await run([], { ...supa(url), ...mailEnv(url), METRICS_TO: 'Owner@Example.test, second@example.test', GITHUB_ACTIONS: 'true' });
    assert.equal(r.code, 0, r.out);
    const sends = hits.filter((h) => h.url.startsWith('/emails')).map((h) => JSON.parse(h.body));
    assert.deepEqual(sends.map((m) => m.to), [['owner@example.test'], ['second@example.test']]);
    assert.equal(sends[0].subject, sends[1].subject);
    assert.match(sends[0].subject, /^Fundocap rakamlar \d{4}-\d{2}-\d{2}: \d+ Pro · 10 hesap · 3 abone$/);
    assert.match(sends[0].text, /BÜLTEN VE LEAD/);
    assert.ok(!sends[0].text.includes('@'));
    assert.equal(r.out.trim(), 'metrics mail: 2 sent, 0 failed');
    assert.ok(!hits.some((h) => h.method !== 'GET' && !h.url.startsWith('/emails')), 'nothing written to the database');
  } finally {
    server.close();
  }
});

test('a database that cannot be reached: one line, exit 1, and the service key is not in it', async () => {
  const r = await run(['--dry-run'], { SUPABASE_URL: 'http://127.0.0.1:9', SUPABASE_ANON_KEY: 'anon', SUPABASE_SERVICE_ROLE_KEY: 'service-role-secret' });
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /^could not read the tables: /);
  assert.equal(r.out.trim().split('\n').length, 1, r.out);
  assert.ok(!r.out.includes('service-role-secret'));
});

test('a refused send turns the run red', async () => {
  const { server, url } = await stub({ mailStatus: 403 });
  try {
    const r = await run([], { ...supa(url), ...mailEnv(url), METRICS_TO: 'owner@example.test' });
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /resend HTTP 403/);
    assert.match(r.out, /0 sent, 1 failed/);
    assert.ok(!r.out.includes('owner@example.test'));
  } finally {
    server.close();
  }
});

test('the workflow: weekly, commits nothing, goes red naming a missing secret, and METRICS_TO is a secret', () => {
  const yml = fs.readFileSync(path.join(root, '.github', 'workflows', 'metrics.yml'), 'utf8');
  assert.match(yml, /cron: '13 5 \* \* 1'/);
  assert.match(yml, /METRICS_TO: \$\{\{ secrets\.METRICS_TO \}\}/);
  assert.match(yml, /missing="\$missing METRICS_TO"/);
  assert.match(yml, /Repository secrets not configured:\$missing[\s\S]{0,220}?exit 1/);
  assert.match(yml, /permissions:\n {2}contents: read/);
  assert.ok(!/git (commit|push)|GITHUB_STEP_SUMMARY|issues: write/.test(yml), 'no commit, no public summary, no issue');
});
