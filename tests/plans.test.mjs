import test from 'node:test';
import assert from 'node:assert/strict';
import './helpers.mjs';

// #12 — one currency per visitor, the same one the checkout charges; the
// TRY prices from env when they exist, USD with an FX hint when they do not.
delete process.env.STRIPE_PRICE_MONTHLY_TRY;
delete process.env.STRIPE_PRICE_YEARLY_TRY;
process.env.STRIPE_PRICE_MONTHLY = 'price_m_usd';
process.env.STRIPE_PRICE_YEARLY = 'price_y_usd';
process.env.STRIPE_PRICE_MONTHLY_TR = 'price_m_tr';
process.env.STRIPE_PRICE_YEARLY_TR = 'price_y_tr';

const { planCatalog, suggestTry, discountPct, regionFor, publicCatalog } = await import('../api/_lib/plans.js');
const { ssr } = await import('./helpers.mjs');

const fxHttp = { get: async () => ({ status: 200, data: { date: '2026-09-22', rates: { TRY: 41 } } }) };

test('the TRY suggestion is USD × rate × 1.03 rounded up to a …49/…99 ending; the yearly discount is the real one', () => {
  assert.equal(suggestTry(10, 41), 449);
  assert.equal(suggestTry(100, 41), 4249);
  assert.equal(suggestTry(19.9, 41), 849);
  assert.equal(discountPct(19.9, 199), 17);
  assert.equal(discountPct(10, 100), 17);
  assert.equal(discountPct(449, 4249), 21);
  assert.equal(regionFor('tr'), 'tr');
  assert.equal(regionFor('DE'), 'global');
});

test('a visitor outside Türkiye gets the global USD prices and ids', async () => {
  const c = await planCatalog('US');
  assert.equal(c.region, 'global');
  assert.equal(c.currency, 'USD');
  assert.deepEqual([c.m, c.y], [19.9, 199]);
  assert.deepEqual(c.priceIds, { m: 'price_m_usd', y: 'price_y_usd' });
  assert.equal(c.anchorUsd, null);
  assert.ok(!('priceIds' in publicCatalog(c)), 'ids never reach the client');
});

test('Türkiye without TRY prices: USD regional price, "≈ ₺" from the daily rate, the global price as anchor, and the TRY price to create', async () => {
  const c = await planCatalog('TR', { http: fxHttp });
  assert.equal(c.currency, 'USD');
  assert.deepEqual([c.m, c.y], [10, 100]);
  assert.deepEqual(c.priceIds, { m: 'price_m_tr', y: 'price_y_tr' });
  assert.deepEqual(c.anchorUsd, { m: 19.9, y: 199 });
  assert.equal(c.fx.rate, 41);
  assert.deepEqual(c.fx.approx, { m: 410, y: 4100 });
  assert.deepEqual(c.suggestedTry, { m: 449, y: 4249 });
});

test('Türkiye with TRY prices: the amounts come from Stripe, the page is in ₺ only, checkout gets the TRY ids', async () => {
  process.env.STRIPE_SECRET_KEY = 'sk_test_x';
  process.env.STRIPE_PRICE_MONTHLY_TRY = 'price_m_try';
  process.env.STRIPE_PRICE_YEARLY_TRY = 'price_y_try';
  const getPrice = async (id) => ({ id, currency: 'try', unit_amount: id === 'price_m_try' ? 44900 : 424900 });
  const c = await planCatalog('TR', { getPrice, http: fxHttp });
  assert.equal(c.currency, 'TRY');
  assert.deepEqual([c.m, c.y], [449, 4249]);
  assert.equal(c.discountPct, 21);
  assert.deepEqual(c.priceIds, { m: 'price_m_try', y: 'price_y_try' });
  assert.equal(c.fx, null, 'no FX hint when the price is already in ₺');
  assert.equal(c.suggestedTry, null);
  // a broken TRY price (wrong currency) falls back to USD rather than showing nothing
  process.env.STRIPE_PRICE_MONTHLY_TRY = 'price_m_bad';
  const bad = await planCatalog('TR', { getPrice: async (id) => ({ id, currency: 'usd', unit_amount: 1000 }), http: fxHttp });
  assert.equal(bad.currency, 'USD');
  delete process.env.STRIPE_SECRET_KEY;
  delete process.env.STRIPE_PRICE_MONTHLY_TRY;
  delete process.env.STRIPE_PRICE_YEARLY_TRY;
});

test('SSR /tr/pricing: one currency on the page, "Pro’ya Başla" as the call to action, no "sign in first"; /checkout/success and /cancel are 200', async () => {
  const { status, html, headers } = await ssr('/tr/pricing');
  assert.equal(status, 200);
  assert.match(headers['cache-control'], /no-store/, 'the price depends on the country, so the HTML is not CDN-cached');
  assert.match(html, /data-currency="USD"/);
  assert.match(html, /\$0/);
  assert.match(html, /\$19,90/);
  assert.ok(!/₺/.test(html), 'no lira next to dollars');
  assert.match(html, /Pro(?:'|&#x27;|’)ya Başla/, 'the call to action (React escapes the apostrophe)');
  assert.ok(!/Önce giriş yapın/.test(html));
  assert.match(html, /%17 indirim/);
  const tr = await ssr('/tr/pricing', { 'x-vercel-ip-country': 'TR' });
  assert.match(tr.html, /\$10/, 'the regional USD price for a Turkish visitor without TRY prices');
  assert.match(tr.html, /data-currency="USD"/, 'still one currency');
  assert.match(tr.html, /≈ ₺410/, 'the ≈ ₺ hint from the (cached) daily rate, marked as an approximation');
  assert.match(tr.html, /tahsilat USD/);
  const ok = await ssr('/tr/checkout/success');
  assert.equal(ok.status, 200);
  assert.match(ok.html, /Ödemen alındı/);
  assert.match(ok.html, /href="\/tr\/account"/);
  const cancel = await ssr('/tr/checkout/cancel');
  assert.equal(cancel.status, 200);
  assert.match(cancel.html, /Ödeme iptal edildi/);
  assert.match(cancel.html, /href="\/tr\/pricing"/);
});
