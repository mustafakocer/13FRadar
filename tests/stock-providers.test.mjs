import test from 'node:test';
import assert from 'node:assert/strict';
import './helpers.mjs';
import { invoke } from '../api/_lib/ssr/invoke.js';
import { resetProviderHealth, classify, shouldSkip, noteFail, noteCall, quotaState, snapshot, FAILS_TO_OPEN, QUOTAS } from '../api/_lib/providerHealth.js';
import { shapeFinnhub } from '../api/_lib/providers.js';

// Ek A — the quote chain races its providers inside the budget and says
// which one answered.
process.env.STOCK_UPSTREAM_MS = '400';
const { raceProviders, stockPayload, eligibleProviders, default: handler } = await import('../api/_handlers/stock.js');

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
  const providers = [P('throttled', 10, http(429)), P('keyed', 10, payload('keyed'), { needs: () => false }), P('broken', 10, http(500)), P('ok', 40, payload('ok'))];
  const { withinBudget, chain } = raceProviders('AAPL', { providers, budgetMs: 500 });
  const best = await withinBudget;
  assert.equal(best.provider, 'ok');
  assert.match(chain(), /throttled=throttle:\d+;keyed=key:0;broken=upstream:\d+;ok=ok:\d+/, 'provider order kept');
  // a 429 is a quota signal: the provider is spent for the day, not broken
  assert.equal(shouldSkip('throttled'), false);
  assert.equal(quotaState('throttled').exhausted, true);
  // a provider that keeps erroring trips the breaker
  for (let i = 1; i < FAILS_TO_OPEN; i++) noteFail('broken', http(500), 5);
  assert.equal(shouldSkip('broken'), true, `open after ${FAILS_TO_OPEN} consecutive failures`);
  const again = raceProviders('AAPL', { providers, budgetMs: 200 });
  await again.withinBudget;
  assert.match(again.chain(), /throttled=quota:0;keyed=key:0;broken=open:0;ok=ok:\d+/, 'neither is called while a peer can answer');
  const h = snapshot();
  assert.equal(h.providers.broken.byKind.upstream, FAILS_TO_OPEN);
  assert.equal(h.providers.broken.open, true);
  assert.equal(h.providers.throttled.quota.throttledToday, 1);
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
  assert.match(res.headers['x-stock-chain'], /^fmp=[a-z]+:\d+;twelvedata=[a-z]+:\d+;finnhub=[a-z]+:\d+$/, 'keyed providers only: no Yahoo, no Stooq');
  assert.match(res.headers['x-stock-served'], /live=\d+,stale=\d+,snapshot=\d+,none=\d+/);
  assert.ok(Number(res.headers['x-stock-ms']) >= 0);
});

test('quota: a 429 from a daily-capped provider exhausts it until UTC midnight, a per-minute one for a minute', () => {
  resetProviderHealth();
  const now = Date.parse('2026-09-22T15:00:00Z');
  noteCall('fmp', now);
  noteFail('fmp', http(429), 22, { now });
  const q = quotaState('fmp', now);
  assert.equal(q.exhausted, true);
  assert.equal(q.throttledToday, 1);
  assert.equal(q.exhaustedUntil, '2026-09-23T00:00:00.000Z');
  assert.equal(shouldSkip('fmp', now), false, 'a quota answer does not open the breaker');
  assert.equal(quotaState('fmp', now + 10 * 3600 * 1000).exhausted, false, 'clear the next UTC day');
  assert.equal(quotaState('fmp', now + 10 * 3600 * 1000).usedToday, 0, 'daily counters roll');
  noteFail('finnhub', http(429), 10, { now });
  assert.equal(quotaState('finnhub', now + 30_000).exhausted, true);
  assert.equal(quotaState('finnhub', now + 61_000).exhausted, false);
  // near the cap: conserve
  resetProviderHealth();
  for (let i = 0; i < Math.ceil(QUOTAS.twelvedata.limit * 0.9); i++) noteCall('twelvedata', now);
  const t = quotaState('twelvedata', now);
  assert.equal(t.conserve, true);
  assert.equal(t.exhausted, false);
  assert.equal(t.remaining, QUOTAS.twelvedata.limit - 720);
});

test('eligibility: near its daily limit TwelveData steps aside for FMP/Finnhub, and is still asked when it is the only one left', () => {
  resetProviderHealth();
  const now = Date.parse('2026-09-22T15:00:00Z');
  const providers = [P('fmp', 10, payload('fmp'), { needs: () => true }), P('twelvedata', 10, payload('td'), { needs: () => true }), P('finnhub', 10, payload('fh'), { needs: () => true })];
  const why = (list) => list.map((x) => `${x.p.name}:${x.why || 'run'}`).join(' ');
  assert.equal(why(eligibleProviders(providers, { now })), 'fmp:run twelvedata:run finnhub:run');
  for (let i = 0; i < 720; i++) noteCall('twelvedata', now);
  assert.equal(why(eligibleProviders(providers, { now })), 'fmp:run twelvedata:conserve finnhub:run', 'weight shifts to the peers with room');
  // FMP exhausted for the day, Finnhub breaker open: TwelveData is asked after all
  noteFail('fmp', http(429), 22, { now });
  for (let i = 0; i < FAILS_TO_OPEN; i++) noteFail('finnhub', http(500), 10, { now });
  assert.equal(why(eligibleProviders(providers, { now })), 'fmp:quota twelvedata:run finnhub:open', 'better a metered call than the nightly file');
  // everything exhausted: still ask rather than serve a day-old close
  for (let i = 0; i < 80; i++) noteCall('twelvedata', now);
  noteFail('twelvedata', http(429), 5, { now });
  const all = eligibleProviders(providers, { now });
  assert.deepEqual(all.filter((x) => !x.why).map((x) => x.p.name), ['fmp', 'twelvedata'], 'both spent providers are still asked; only the broken one is not');
  // a missing key is never called
  const keyless = [P('finnhub', 10, payload('fh'), { needs: () => false })];
  assert.equal(why(eligibleProviders(keyless, { now })), 'finnhub:key');
});

test('Finnhub quote shape: zeros mean not found, otherwise a basic price block', () => {
  const s = shapeFinnhub('AAPL', { c: 336.13, d: 1.2, dp: 0.36, h: 338, l: 333, o: 334, pc: 334.93, t: 1 });
  assert.equal(s.source, 'finnhub');
  assert.deepEqual([s.price.price, s.price.change, s.price.changePercent, s.price.prevClose], [336.13, 1.2, 0.36, 334.93]);
  assert.throws(() => shapeFinnhub('ZZZZ', { c: 0, d: null, dp: null, h: 0, l: 0, o: 0, pc: 0, t: 0 }), /not found/);
  assert.equal(classify(new Error('Finnhub: rate limit (HTTP 429)')), 'throttle');
  assert.equal(classify(new Error('Stooq data unavailable: <!DOCTYPE html>')), 'parse');
});
