// Per-provider health for the quote chain (api/_handlers/stock.js), kept
// per serverless instance.
//
// Two things a fixed-order chain could not tell anyone: which provider is
// actually failing, and how (a throttle, a forbidden region, a missing key,
// a timeout, an empty answer) — and whether the page is being served live
// or from a file. Both are counted here and printed on every answer as
// X-Stock-* headers and in the function log, so a day of "priceStale: true"
// reads as "yahoo:quoteSummary throttled ×40, fmp key missing" instead of
// a mystery.
//
// A provider that fails FAILS_TO_OPEN times in a row is skipped for
// OPEN_MS (a circuit breaker): the budget is spent on providers that can
// answer, and the dead one is tried again a few minutes later.

export const FAILS_TO_OPEN = 3;
export const OPEN_MS = 5 * 60 * 1000;

const providers = new Map();
const served = { live: 0, stale: 0, snapshot: 0, none: 0 };
const startedAt = Date.now();

const entry = (name) => {
  let e = providers.get(name);
  if (!e) providers.set(name, (e = { ok: 0, fail: 0, consecutiveFails: 0, lastStatus: null, lastError: null, lastMs: null, lastOkAt: null, lastFailAt: null, skipUntil: 0, byKind: {} }));
  return e;
};

// Why a call failed, from the error it threw: the categories the user has
// to act on differently.
export function classify(err) {
  const msg = String(err?.message || err || '');
  const status = err?.response?.status || Number((/HTTP (\d{3})/.exec(msg) || [])[1]) || null;
  if (/not set|key/i.test(msg) && !/socket/i.test(msg)) return 'key';
  if (status === 429 || /throttl|rate limit|too many/i.test(msg)) return 'throttle';
  if (status === 401 || status === 402 || status === 403 || /forbidden|unauthori/i.test(msg)) return 'forbidden';
  if (/timeout|ECONNABORTED|AbortError|ETIMEDOUT|budget/i.test(msg)) return 'timeout';
  if (status && status >= 500) return 'upstream';
  if (/no data|not found|empty|no chart|unavailable|no rows|parse|JSON/i.test(msg)) return 'parse';
  if (/ENOTFOUND|EAI_AGAIN|ECONNRESET|ECONNREFUSED|network/i.test(msg)) return 'network';
  return 'error';
}

export function noteOk(name, ms) {
  const e = entry(name);
  e.ok++;
  e.consecutiveFails = 0;
  e.lastStatus = 'ok';
  e.lastError = null;
  e.lastMs = ms;
  e.lastOkAt = Date.now();
  e.skipUntil = 0;
}

export function noteFail(name, err, ms, { now = Date.now() } = {}) {
  const e = entry(name);
  const kind = classify(err);
  e.fail++;
  e.consecutiveFails++;
  e.lastStatus = kind;
  e.lastError = String(err?.message || err || '').slice(0, 120);
  e.lastMs = ms;
  e.lastFailAt = now;
  e.byKind[kind] = (e.byKind[kind] || 0) + 1;
  if (e.consecutiveFails >= FAILS_TO_OPEN) e.skipUntil = now + OPEN_MS;
  return kind;
}

export const shouldSkip = (name, now = Date.now()) => entry(name).skipUntil > now;

export function noteServed(kind) {
  if (kind in served) served[kind]++;
}

export function snapshot() {
  const out = {};
  for (const [name, e] of providers) out[name] = { ...e, open: e.skipUntil > Date.now() };
  return { since: new Date(startedAt).toISOString(), served: { ...served }, providers: out };
}

// The compact form that fits a response header: live=3,stale=0,snapshot=12,none=0
export const servedHeader = () => Object.entries(served).map(([k, v]) => `${k}=${v}`).join(',');

// Test seam.
export function resetProviderHealth() {
  providers.clear();
  for (const k of Object.keys(served)) served[k] = 0;
}
