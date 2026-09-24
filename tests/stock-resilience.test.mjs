import test from 'node:test';
import assert from 'node:assert/strict';
import './helpers.mjs';
import { invoke } from '../api/_lib/ssr/invoke.js';

// The quote endpoint and the stock page when every price provider is down.
//
// This sandbox has no route to Yahoo, TwelveData, Finnhub or Stooq, which is the
// production failure mode being tested: the chain must not be allowed to run
// for a minute, the answer must be 200, and the page must render with the
// price block saying the quote is unavailable rather than crashing on it.
process.env.STOCK_UPSTREAM_MS = '500';
const { default: stockHandler, stockPayload } = await import('../api/_handlers/stock.js');
const { priceSnapshot, priceUnavailable, knownSymbol } = await import('../api/_lib/priceSnapshot.js');
const { ssr } = await import('./helpers.mjs');

// a symbol the nightly build has priced but no fixture serves
const SNAPSHOT_SYMBOL = 'TSM';

test('the quote endpoint answers 200 inside its budget when no provider answers', async () => {
  const t0 = Date.now();
  const r = await invoke(stockHandler, { ticker: SNAPSHOT_SYMBOL });
  const ms = Date.now() - t0;
  assert.equal(r.status, 200);
  assert.ok(ms < 2000, `answered in ${ms}ms`);
  assert.equal(r.body.priceStale, true);
  assert.ok(r.body.price, 'the price block is always present');
  assert.equal(r.body.price.symbol, SNAPSHOT_SYMBOL);
  assert.ok(['snapshot', 'stale', 'none'].includes(r.body.source), r.body.source);
  assert.match(r.headers['cache-control'], /s-maxage=60/, 'a fallback answer is kept only briefly at the CDN');
});

test('an unknown symbol still answers 200 with an all-null price block', async () => {
  const { data, served } = await stockPayload('ZZZZNOPE', { budgetMs: 100 });
  assert.equal(served, 'none');
  assert.equal(data.priceUnavailable, true);
  assert.equal(data.price.price, null);
  for (const k of ['valuation', 'fundamentals', 'trading', 'analyst', 'profile']) assert.equal(typeof data[k], 'object', k);
  for (const k of ['income', 'balance', 'cashflow', 'earnings']) assert.ok(Array.isArray(data[k]), k);
});

test('the nightly price file is the cache that is always there', () => {
  const s = priceSnapshot(SNAPSHOT_SYMBOL);
  assert.ok(s, 'the symbol is in ticker-meta.json');
  assert.equal(s.source, 'snapshot');
  assert.equal(s.priceStale, true);
  assert.ok(s.price.price > 0);
  assert.match(s.priceAsOf, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(priceSnapshot('ZZZZNOPE'), null);
  assert.equal(priceUnavailable('x').price.symbol, 'X');
  assert.equal(knownSymbol('tsm'), true);
  assert.equal(knownSymbol('ZZZZNOPE'), false);
});
