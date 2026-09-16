import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { root } from './helpers.mjs';

// /api/guru-stocks over the fixture table: what a security's page may show
// for free, what stays behind the paywall, and what happens on a checkout
// where the daily Action has not written the table yet.
process.env.GURU_STOCKS_FILE = path.join(root, 'tests', 'fixtures', 'guru-stocks.fixture.json');

const { invoke } = await import('../api/_lib/ssr/invoke.js');
const { authConfigured } = await import('../api/_lib/auth.js');
const { resetGuruStockCache, ownedShareOfCompany, byConviction } = await import('../api/_lib/guruStocks.js');
const handler = (await import('../api/_handlers/guru-stocks.js')).default;

// With Supabase reachable an anonymous request is a free one; without it the
// whole site is treated as Pro (see auth.js), and the paywall assertions below
// would be testing nothing.
const anonymousIsFree = authConfigured();

test('a security carries its rank, holder count and quarter activity', async () => {
  const { status, body } = await invoke(handler, { ticker: 'OXY' });
  assert.equal(status, 200);
  assert.equal(body.available, true);
  assert.equal(body.held, true);
  assert.equal(body.stock.ticker, 'OXY');
  assert.equal(body.stock.rank, 1);
  assert.equal(body.stock.holderCount, 2);
  assert.equal(body.stock.buyers, body.stock.newBuyers + body.stock.adders);
  assert.ok(body.stock.netValue !== 0);
  assert.equal(body.managers, 3);
  assert.ok(body.reportDate);
});

test('holders come back in both orderings, most committed first', async () => {
  const { body } = await invoke(handler, { ticker: 'OXY' });
  const conviction = body.topByConviction.map((h) => h.weight);
  assert.deepEqual(conviction, [...conviction].sort((a, b) => b - a));
  const value = body.topByValue.map((h) => h.value);
  assert.deepEqual(value, [...value].sort((a, b) => b - a));
  // Scion's small position is a quarter of its book; Berkshire's much larger
  // one is a rounding error of theirs. The two lists must disagree.
  assert.notEqual(body.topByConviction[0].cik, body.topByValue[0].cik);
});

test('a name none of the curated funds hold answers plainly', async () => {
  const { status, body } = await invoke(handler, { ticker: 'TSLA' });
  assert.equal(status, 200);
  assert.equal(body.held, false);
  assert.equal(body.stock, null);
});

test('the option table keeps the put apart from the common', async () => {
  const { body } = await invoke(handler, { view: 'options' });
  const put = body.options.find((o) => o.ticker === 'NVDA');
  assert.equal(put.putCall, 'Put');
  assert.equal(put.totalShares, 200000);

  const common = await invoke(handler, { ticker: 'NVDA' });
  assert.equal(common.body.stock.totalShares, 5500000);
  assert.equal(common.body.options.length, 1);
});

test('the ranked list is returned in order and respects the limit', async () => {
  const { body } = await invoke(handler, { limit: '3' });
  assert.equal(body.stocks.length, 3);
  assert.deepEqual(
    body.stocks.map((s) => s.rank),
    [1, 2, 3]
  );
  // the list view carries a name preview for the "held by" column, not the roll
  for (const row of body.stocks) {
    assert.ok(row.holders.length <= 3, 'at most three names travel with a list row');
    for (const h of row.holders) {
      assert.deepEqual(Object.keys(h).sort(), ['cik', 'name'], 'and only their identity');
    }
  }
});

test('the sector list offered is the one the table can honour', async () => {
  const { body } = await invoke(handler, {});
  assert.ok(body.sectors.includes('Energy'));
  assert.ok(!body.sectors.includes(null), 'unclassified rows do not become a filter option');
  assert.deepEqual(body.sectors, [...body.sectors].sort(), 'and it is ordered');
});

test('filtering by sector drops the rows that have not been classified', async () => {
  const { body } = await invoke(handler, { sector: 'Energy' });
  assert.ok(body.stocks.length > 0);
  for (const s of body.stocks) assert.equal(s.sector, 'Energy');
  // HLT and BABA carry no sector in the fixture — a sector filter must not
  // sweep them in on the grounds that nobody looked them up yet
  assert.ok(!body.stocks.some((s) => s.ticker === 'HLT' || s.ticker === 'BABA'));
  assert.equal(body.matched, body.stocks.length);
});

test('market cap filtering uses the bucket the build stamped', async () => {
  const { body } = await invoke(handler, { cap: 'mega' });
  for (const s of body.stocks) assert.equal(s.cap, 'mega');
  assert.ok(body.stocks.every((s) => s.marketCap >= 200e9));
});

test('"new positions only" keeps names a fund actually opened this quarter', async () => {
  const { body } = await invoke(handler, { strongBuy: '1' });
  assert.ok(body.stocks.length > 0);
  for (const s of body.stocks) {
    assert.ok(s.newBuyers > 0, `${s.ticker} has no new buyer`);
    assert.ok(s.netValue > 0, `${s.ticker} is not a net buy`);
  }
  const all = await invoke(handler, {});
  assert.ok(body.stocks.length < all.body.stocks.length, 'the filter actually narrows');
});

test('filters compose, and an empty result is still a well-formed answer', async () => {
  const { status, body } = await invoke(handler, { sector: 'Energy', cap: 'micro' });
  assert.equal(status, 200);
  assert.equal(body.matched, 0);
  assert.deepEqual(body.stocks, []);
  assert.ok(body.sectors.length > 0, 'the filter options survive an empty match');
});

test('free callers get a cacheable summary and a trimmed holder list', async (t) => {
  if (!anonymousIsFree) return t.skip('auth not configured — every caller is Pro here');
  const res = await invoke(handler, { ticker: 'OXY' });
  assert.ok(res.body.holders.length <= 5);
  assert.equal(res.body.holdersTruncated, res.body.stock.holderCount > 5);
});

test('a checkout without the generated table degrades instead of failing', async () => {
  process.env.GURU_STOCKS_FILE = path.join(root, 'tests', 'fixtures', 'does-not-exist.json');
  resetGuruStockCache();
  try {
    const { status, body } = await invoke(handler, { ticker: 'OXY' });
    assert.equal(status, 200);
    assert.equal(body.available, false);
    assert.deepEqual(body.stocks, []);
  } finally {
    process.env.GURU_STOCKS_FILE = path.join(root, 'tests', 'fixtures', 'guru-stocks.fixture.json');
    resetGuruStockCache();
  }
});

test('ownership of the company needs a share count to be knowable', () => {
  const stock = { totalShares: 1_000_000 };
  assert.equal(ownedShareOfCompany(stock, 100_000_000), 1);
  assert.equal(ownedShareOfCompany(stock, 0), null);
  assert.equal(ownedShareOfCompany(stock, null), null);
  assert.equal(ownedShareOfCompany(null, 100), null);
  assert.deepEqual(byConviction(null), []);
});
