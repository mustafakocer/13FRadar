import test from 'node:test';
import assert from 'node:assert/strict';
import './helpers.mjs';
import { invoke } from '../api/_lib/ssr/invoke.js';
import { resetProviderHealth, classify, shouldSkip, noteFail, snapshot, FAILS_TO_OPEN } from '../api/_lib/providerHealth.js';

// Ek A — the quote chain races its providers inside the budget and says
// which one answered.
process.env.STOCK_UPSTREAM_MS = '400';
const { raceProviders, stockPayload, default: handler } = await import('../api/_handlers/stock.js');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const payload = (source) => ({ source, price: { symbol: 'AAPL', price: 100 }, valuation: {}, fundamentals: {}, trading: {}, analyst: {}, income: [], balance: [], cashflow: [], earnings: [], profile: {} });
const P = (name, ms, out, opts = {}) => ({
  name,
  ...opts,
  run: async () => {
    await sleep(ms);
    if (out instanceof Error) throw out;
    return out;
  },
});
const http = (status) => Object.assign(new Error(`HTTP ${status}`), { response: { status } });

test('a slow top-ranked provider does not block a fast lower-ranked one: the answer is live within the budget', async () => {
  resetProviderHealth();
  const providers = [P('slow-best', 5000, payload('best')), P('fast', 30, payload('fast')), P('slower', 200, payload('slower'))];
  const t0 = Date.now();
  const { withinBudget, chain } = raceProviders('AAPL', { providers, budgetMs: 300 });
  const best = await withinBudget;
  const ms = Date.now() - t0;
  assert.equal(best.provider, 'fast', 'the best answer available at the budget');
  assert.ok(ms >= 280 && ms < 1500, `waited for the budget (${ms}ms), not for the slow provider`);
  assert.match(chain(), /slow-best=pending;fast=ok:\d+;slower=ok:\d+/);
});

test('when the top-ranked provider answers first the race ends early with it', async () => {
  resetProviderHealth();
  const providers = [P('best', 20, payload('best')), P('other', 400, payload('other'))];
  const t0 = Date.now();
  const { withinBudget } = raceProviders('AAPL', { providers, budgetMs: 1000 });
  const best = await withinBudget;
  assert.equal(best.provider, 'best');
  assert.ok(Date.now() - t0 < 300, 'did not wait for the budget');
});

test('failures are classified, a missing key is never called, and a provider that keeps failing is skipped', async () => {
  resetProviderHealth();
  assert.equal(classify(http(429)), 'throttle');
  assert.equal(classify(http(403)), 'forbidden');
  assert.equal(classify(new Error('FMP_API_KEY not set')), 'key');
  assert.equal(classify(new Error('timeout of 4000ms exceeded')), 'timeout');
  assert.equal(classify(new Error('No data')), 'parse');
  assert.equal(classify(http(503)), 'upstream');
  const providers = [P('throttled', 10, http(429)), P('keyed', 10, payload('keyed'), { needs: () => false }), P('ok', 40, payload('ok'))];
  const { withinBudget, chain } = raceProviders('AAPL', { providers, budgetMs: 500 });
  const best = await withinBudget;
  assert.equal(best.provider, 'ok');
  assert.match(chain(), /throttled=throttle:\d+;keyed=key:0;ok=ok:\d+/, 'provider order kept');
  for (let i = 1; i < FAILS_TO_OPEN; i++) noteFail('throttled', http(429), 5);
  assert.equal(shouldSkip('throttled'), true, `open after ${FAILS_TO_OPEN} consecutive failures`);
  const again = raceProviders('AAPL', { providers, budgetMs: 200 });
  await again.withinBudget;
  assert.match(again.chain(), /throttled=open:0/, 'not called while the breaker is open');
  const h = snapshot();
  assert.equal(h.providers.throttled.byKind.throttle, FAILS_TO_OPEN);
  assert.equal(h.providers.throttled.open, true);
});

test('stockPayload serves live with the provider named, and the handler exposes the chain in headers', async () => {
  resetProviderHealth();
  const providers = [P('a', 20, payload('a'))];
  const r = await stockPayload('INTC', { budgetMs: 300, providers });
  assert.equal(r.served, 'live');
  assert.equal(r.provider, 'a');
  assert.equal(r.data.provider, 'a');
  // the real handler in this sandbox (no network): every provider fails, the file answers, headers say so
  const res = await invoke(handler, { ticker: 'TSM' });
  assert.equal(res.status, 200);
  assert.ok(['snapshot', 'stale', 'none'].includes(res.headers['x-stock-source']));
  assert.match(res.headers['x-stock-chain'], /yahoo:quoteSummary=/);
  assert.match(res.headers['x-stock-served'], /live=\d+,stale=\d+,snapshot=\d+,none=\d+/);
  assert.ok(Number(res.headers['x-stock-ms']) >= 0);
});
