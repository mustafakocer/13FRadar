// Security headers, the symbol guard in front of the quote providers, the
// bounded in-memory cache, and the token on /api/diag.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { root } from './helpers.mjs';

// no provider key, no network: a guarded request must answer without either
delete process.env.TWELVEDATA_API_KEY;
delete process.env.FINNHUB_API_KEY;

const { SECURITY_HEADERS, applySecurityHeaders } = await import('../api/_lib/securityHeaders.js');
const { servableSymbol, wellFormedSymbol } = await import('../api/_lib/symbolGuard.js');
const { cached, remember, recall, cacheSizes, MAX_ENTRIES } = await import('../api/_lib/cache.js');
const { default: api } = await import('../api/index.js');
const { default: diag, diagAuthorized } = await import('../api/_handlers/diag.js');
const { siteUrl, CANONICAL_SITE } = await import('../api/_lib/site.js');

function call(handler, { url = '/', query = {}, headers = {}, method = 'GET' } = {}) {
  return new Promise((resolve, reject) => {
    const res = {
      statusCode: 200,
      headers: {},
      setHeader(k, v) {
        this.headers[k.toLowerCase()] = v;
      },
      status(c) {
        this.statusCode = c;
        return this;
      },
      json(b) {
        resolve({ status: this.statusCode, headers: this.headers, body: b });
      },
      end(b) {
        resolve({ status: this.statusCode, headers: this.headers, body: b });
      },
    };
    Promise.resolve(handler({ url, method, query: { ...query }, headers: { host: 'example.test', ...headers } }, res)).catch(reject);
  });
}

// ------------------------------------------------------------- headers ---
test('security headers: the full set, and nothing that can break a page is enforced', () => {
  const h = Object.fromEntries(SECURITY_HEADERS);
  assert.equal(h['X-Frame-Options'], 'DENY');
  assert.equal(h['X-Content-Type-Options'], 'nosniff');
  assert.equal(h['Referrer-Policy'], 'strict-origin-when-cross-origin');
  assert.match(h['Strict-Transport-Security'], /^max-age=63072000; includeSubDomains$/);
  assert.match(h['Permissions-Policy'], /camera=\(\).*microphone=\(\).*geolocation=\(\)/);
  // enforced: framing, <base>, plugins — no script/style/connect directive
  assert.equal(h['Content-Security-Policy'], "frame-ancestors 'none'; base-uri 'self'; object-src 'none'");
  assert.ok(!/script-src|style-src|connect-src|default-src/.test(h['Content-Security-Policy']));
  // the full policy only reports
  const ro = h['Content-Security-Policy-Report-Only'];
  for (const d of ["default-src 'self'", 'script-src', 'style-src', 'connect-src', 'img-src', "frame-ancestors 'none'"]) assert.ok(ro.includes(d), d);
});

test('security headers: every third-party origin the client loads is in the report-only policy', () => {
  const ro = Object.fromEntries(SECURITY_HEADERS)['Content-Security-Policy-Report-Only'];
  const directive = (name) => (ro.split('; ').find((d) => d.startsWith(`${name} `)) || '').split(' ').slice(1);
  const allows = (list, host) =>
    list.some((src) => src === 'https:' || src === `https://${host}` || (src.startsWith('https://*.') && host.endsWith(src.slice('https://*'.length))));
  const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
  const hostsIn = (text) => [...text.matchAll(/https:\/\/([a-z0-9.-]+\.[a-z]{2,})/g)].map((m) => m[1]);
  // scripts injected at run time
  for (const rel of ['client/src/lib/ga.js', 'client/src/lib/clarity.js', 'client/src/lib/metaPixel.js']) {
    const hosts = hostsIn(read(rel)).filter((h) => /googletagmanager|clarity\.ms|facebook\.net/.test(h));
    assert.ok(hosts.length, `${rel} names its script host`);
    for (const h of hosts) assert.ok(allows(directive('script-src'), h), `script-src allows ${h}`);
  }
  // stylesheet and font hosts in the HTML shell
  const shell = read('client/index.html');
  assert.ok(shell.includes('https://fonts.googleapis.com'));
  assert.ok(allows(directive('style-src'), 'fonts.googleapis.com'));
  assert.ok(allows(directive('font-src'), 'fonts.gstatic.com'));
  // logos: a CDN and any company domain
  assert.ok(allows(directive('img-src'), 'cdn.brandfetch.io'));
  // Supabase auth and tables
  assert.ok(allows(directive('connect-src'), 'abcdefgh.supabase.co'));
  // inline SSR state, JSON-LD and style attributes still run
  assert.ok(directive('script-src').includes("'unsafe-inline'"));
  assert.ok(directive('style-src').includes("'unsafe-inline'"));
});

test('security headers: vercel.json carries the same list for every path', () => {
  const cfg = JSON.parse(fs.readFileSync(path.join(root, 'vercel.json'), 'utf8'));
  assert.equal(cfg.headers.length, 1);
  assert.equal(cfg.headers[0].source, '/(.*)');
  assert.deepEqual(cfg.headers[0].headers.map((h) => [h.key, h.value]), SECURITY_HEADERS);
});

test('security headers: both functions set them, on a hit and on a 404', async () => {
  const expectAll = (headers) => {
    for (const [k, v] of SECURITY_HEADERS) assert.equal(headers[k.toLowerCase()], v, k);
  };
  expectAll((await call(api, { url: '/api/nope' })).headers);
  expectAll((await call(api, { url: '/api/plans' })).headers);
  const res = { headers: {}, setHeader(k, v) { this.headers[k.toLowerCase()] = v; } };
  applySecurityHeaders(res);
  expectAll(res.headers);
  // the page renderer imports the same helper and calls it first
  const ssr = fs.readFileSync(path.join(root, 'api', 'ssr.js'), 'utf8');
  assert.match(ssr, /export default async function handler\(req, res\) \{\n  applySecurityHeaders\(res\);/);
});

// -------------------------------------------------------- symbol guard ---
test('symbol guard: what the site links to passes, made-up and malformed symbols do not', () => {
  for (const t of ['AAPL', 'SPY', 'QQQ', 'IWM', 'BRK.B', 'BRK-B', 'brk.b', ' aapl ']) assert.ok(servableSymbol(t), t);
  for (const t of ['ZZQQXA', 'ZZZZZZ', 'QXZJW', '', null, undefined, 'A B', '../etc', 'AAPL;DROP', 'A'.repeat(13), '.AAPL', '-']) {
    assert.ok(!servableSymbol(t), String(t));
  }
  assert.ok(wellFormedSymbol('BF-B'));
  assert.ok(!wellFormedSymbol('bf-b'), 'the guard upper-cases; the pattern itself is strict');
});

test('symbol guard: an unknown symbol is answered before any provider or cache is touched', async () => {
  const before = cacheSizes();
  const stock = await call(api, { url: '/api/stock/ZZQQXA' });
  assert.equal(stock.status, 404);
  assert.deepEqual(stock.body, { error: 'unknown-symbol' });
  assert.match(stock.headers['cache-control'], /s-maxage=300/);
  assert.equal(stock.headers['x-stock-chain'], undefined, 'the provider chain never ran');

  const chart = await call(api, { url: '/api/chart/ZZQQXA' });
  assert.equal(chart.status, 404);
  assert.deepEqual(chart.body, { error: 'unknown-symbol' });

  // returns: the made-up symbols are dropped, the request still answers
  const none = await call(api, { url: '/api/returns', query: { symbols: 'ZZQQXA,ZZQQXB,../x' } });
  assert.equal(none.status, 200);
  assert.deepEqual(none.body, {});
  assert.deepEqual(cacheSizes(), before, 'nothing was cached under a made-up key');
});

test('symbol guard: a known symbol still gets its answer, and returns keeps only the known ones', async () => {
  const mixed = await call(api, { url: '/api/returns', query: { symbols: 'AAPL,ZZQQXA,aapl' } });
  assert.equal(mixed.status, 200);
  assert.deepEqual(Object.keys(mixed.body), ['AAPL']);
  assert.ok(mixed.body.AAPL.price > 0);
  const chart = await call(api, { url: '/api/chart/AAPL', query: { range: '1mo' } });
  assert.equal(chart.status, 200);
  assert.ok(chart.body.prices.length > 5);
});

// --------------------------------------------------------------- cache ---
test('cache: both maps stop growing at the ceiling, newest entries survive', async () => {
  const n = MAX_ENTRIES + 250;
  for (let i = 0; i < n; i++) {
    await cached(`bound:${i}`, 60_000, () => i);
    remember(`bound:${i}`, i);
  }
  const sizes = cacheSizes();
  assert.ok(sizes.store <= MAX_ENTRIES, `store ${sizes.store}`);
  assert.ok(sizes.good <= MAX_ENTRIES, `good ${sizes.good}`);
  assert.equal(recall(`bound:${n - 1}`), n - 1);
  assert.equal(recall('bound:0'), undefined, 'the oldest entry made room');
  // a live entry is still a hit: fn does not run twice
  let runs = 0;
  await cached('bound:hit', 60_000, () => ++runs);
  await cached('bound:hit', 60_000, () => ++runs);
  assert.equal(runs, 1);
  // a failed call is not kept
  await assert.rejects(cached('bound:fail', 60_000, () => Promise.reject(new Error('x'))));
  assert.equal(await cached('bound:fail', 60_000, () => 'ok'), 'ok');
});

// ---------------------------------------------------------------- diag ---
test('diag: 404 without DIAG_TOKEN, with a wrong one, and when the variable is unset', async () => {
  const token = 'diag-token-0123456789abcdef';
  assert.ok(!diagAuthorized({ headers: { 'x-diag-token': token } }, undefined), 'unset → closed');
  assert.ok(!diagAuthorized({ headers: { 'x-diag-token': 'short' } }, 'short'), 'a short token is not a secret');
  assert.ok(!diagAuthorized({ headers: {} }, token));
  assert.ok(!diagAuthorized({ headers: { 'x-diag-token': `${token}x` } }, token));
  assert.ok(diagAuthorized({ headers: { 'x-diag-token': token } }, token));
  assert.ok(diagAuthorized({ headers: { authorization: `Bearer ${token}` } }, token));

  const prev = process.env.DIAG_TOKEN;
  try {
    delete process.env.DIAG_TOKEN;
    const closed = await call(diag, { headers: { 'x-diag-token': token } });
    assert.equal(closed.status, 404);
    assert.equal(closed.headers['cache-control'], 'no-store');
    process.env.DIAG_TOKEN = token;
    const wrong = await call(diag, { headers: { 'x-diag-token': 'not-the-token-000000000' } });
    assert.equal(wrong.status, 404);
    assert.deepEqual(wrong.body, { error: 'Not found' }, 'nothing about keys, quota or region');
    const anon = await call(api, { url: '/api/diag' });
    assert.equal(anon.status, 404);
  } finally {
    if (prev === undefined) delete process.env.DIAG_TOKEN;
    else process.env.DIAG_TOKEN = prev;
  }
});

// -------------------------------------------------- checkout return URL ---
test('checkout and portal take their return origin from siteUrl(), never the Host header', () => {
  for (const f of ['checkout.js', 'portal.js']) {
    const src = fs.readFileSync(path.join(root, 'api', '_handlers', f), 'utf8');
    assert.ok(src.includes('const origin = siteUrl(req);'), f);
    assert.ok(!src.includes('req.headers.host'), `${f} no longer reads Host`);
  }
  const env = { SITE_URL: process.env.SITE_URL, VERCEL_ENV: process.env.VERCEL_ENV, VERCEL_URL: process.env.VERCEL_URL };
  try {
    delete process.env.SITE_URL;
    delete process.env.VERCEL_URL;
    process.env.VERCEL_ENV = 'production';
    assert.equal(siteUrl({ headers: { host: 'evil.example' } }), CANONICAL_SITE);
  } finally {
    for (const [k, v] of Object.entries(env)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
});
