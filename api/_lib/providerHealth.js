// Per-provider health and quota for the quote chain (api/_handlers/stock.js),
// kept per serverless instance.
//
// Two things a fixed-order chain could not tell anyone: which provider is
// actually failing, and how (a throttle, a forbidden region, a missing key,
// a timeout, an empty answer) — and whether the page is being served live
// or from a file. Both are counted here and printed on every answer as
// X-Stock-* headers and in the function log, so a day of "priceStale: true"
// reads as "fmp throttle ×40 (quota), twelvedata ok" instead of a mystery.
//
// A provider that fails FAILS_TO_OPEN times in a row is skipped for
// OPEN_MS (a circuit breaker): the budget is spent on providers that can
// answer, and the dead one is tried again a few minutes later.
//
// Quotas: the free tiers are daily caps (FMP 250, TwelveData 800) and a
// per-minute cap (Finnhub 60). Calls are counted per UTC day; a 429 from a
// daily-capped provider marks it exhausted until midnight UTC (that is what
// FMP's 22 ms throttle answer means: the day's calls are gone, not the
// network), and a provider past CONSERVE_AT of its cap is held back while
// a peer with room can answer. Counts are per instance — Vercel runs
// several — so they understate the true daily total; they are a lower
// bound and an early warning, not the provider's own meter.

export const FAILS_TO_OPEN = 3;
export const OPEN_MS = 5 * 60 * 1000;
export const CONSERVE_AT = 0.9;

// { limit, per: 'day' | 'minute' }; null = no known cap
export const QUOTAS = {
  twelvedata: { limit: 800, per: 'day' },
  finnhub: { limit: 60, per: 'minute' },
};

const providers = new Map();
const served = { live: 0, stale: 0, snapshot: 0, none: 0 };
const startedAt = Date.now();

const utcDay = (ms) => new Date(ms).toISOString().slice(0, 10);

const entry = (name) => {
  let e = providers.get(name);
  if (!e)
    providers.set(
      name,
      (e = {
        ok: 0,
        fail: 0,
        consecutiveFails: 0,
        lastStatus: null,
        lastError: null,
        lastMs: null,
        lastOkAt: null,
        lastFailAt: null,
        skipUntil: 0,
        byKind: {},
        // quota bookkeeping
        day: null,
        callsToday: 0,
        throttledToday: 0,
        lastThrottleAt: null,
        exhaustedUntil: 0,
        minuteWindow: 0,
        callsThisMinute: 0,
      })
    );
  return e;
};

// Roll the daily counters at UTC midnight.
const roll = (e, now) => {
  const d = utcDay(now);
  if (e.day !== d) {
    e.day = d;
    e.callsToday = 0;
    e.throttledToday = 0;
    if (e.exhaustedUntil && e.exhaustedUntil <= now) e.exhaustedUntil = 0;
  }
  const w = Math.floor(now / 60_000);
  if (e.minuteWindow !== w) {
    e.minuteWindow = w;
    e.callsThisMinute = 0;
  }
};

const nextUtcMidnight = (now) => {
  const d = new Date(now);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1);
};

// Why a call failed, from the error it threw: the categories the user has
// to act on differently.
export function classify(err) {
  const msg = String(err?.message || err || '');
  const status = err?.response?.status || Number((/HTTP (\d{3})/.exec(msg) || [])[1]) || null;
  if (/not set|key/i.test(msg) && !/socket/i.test(msg)) return 'key';
  if (status === 429 || /throttl|rate limit|too many|limit reached|quota/i.test(msg)) return 'throttle';
  if (status === 401 || status === 402 || status === 403 || /forbidden|unauthori/i.test(msg)) return 'forbidden';
  if (/timeout|ECONNABORTED|AbortError|ETIMEDOUT|budget/i.test(msg)) return 'timeout';
  if (status && status >= 500) return 'upstream';
  if (/no data|not found|empty|no chart|unavailable|no rows|parse|JSON|<html|<!doctype/i.test(msg)) return 'parse';
  if (/ENOTFOUND|EAI_AGAIN|ECONNRESET|ECONNREFUSED|network/i.test(msg)) return 'network';
  return 'error';
}

// A call is about to be made: count it against today's and this minute's quota.
export function noteCall(name, now = Date.now()) {
  const e = entry(name);
  roll(e, now);
  e.callsToday++;
  e.callsThisMinute++;
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
  roll(e, now);
  const kind = classify(err);
  e.fail++;
  e.consecutiveFails++;
  e.lastStatus = kind;
  e.lastError = String(err?.message || err || '').slice(0, 120);
  e.lastMs = ms;
  e.lastFailAt = now;
  e.byKind[kind] = (e.byKind[kind] || 0) + 1;
  if (e.consecutiveFails >= FAILS_TO_OPEN) e.skipUntil = now + OPEN_MS;
  if (kind === 'throttle') {
    e.throttledToday++;
    e.lastThrottleAt = now;
    const q = QUOTAS[name];
    // a daily cap answering 429 is spent for the day; a per-minute cap
    // clears with the minute
    e.exhaustedUntil = q?.per === 'minute' ? now + 60_000 : nextUtcMidnight(now);
    // a quota answer is not a dead provider: the breaker stays closed so
    // it is asked again as soon as the quota clears
    e.consecutiveFails = 0;
    e.skipUntil = 0;
  }
  return kind;
}

export const shouldSkip = (name, now = Date.now()) => entry(name).skipUntil > now;

// { limit, per, usedToday, usedThisMinute, throttledToday, lastThrottleAt,
//   exhausted, conserve, remaining }
export function quotaState(name, now = Date.now()) {
  const e = entry(name);
  roll(e, now);
  const q = QUOTAS[name] || null;
  const used = q?.per === 'minute' ? e.callsThisMinute : e.callsToday;
  const remaining = q ? Math.max(0, q.limit - used) : null;
  return {
    limit: q?.limit ?? null,
    per: q?.per ?? null,
    usedToday: e.callsToday,
    usedThisMinute: e.callsThisMinute,
    throttledToday: e.throttledToday,
    lastThrottleAt: e.lastThrottleAt ? new Date(e.lastThrottleAt).toISOString() : null,
    exhausted: e.exhaustedUntil > now || (q ? remaining === 0 : false),
    exhaustedUntil: e.exhaustedUntil > now ? new Date(e.exhaustedUntil).toISOString() : null,
    conserve: q ? used >= q.limit * CONSERVE_AT : false,
    remaining,
  };
}

export function noteServed(kind) {
  if (kind in served) served[kind]++;
}

export function snapshot(now = Date.now()) {
  const out = {};
  for (const [name, e] of providers) {
    const { day, callsToday, throttledToday, lastThrottleAt, exhaustedUntil, minuteWindow, callsThisMinute, ...rest } = e;
    out[name] = { ...rest, open: e.skipUntil > now, quota: quotaState(name, now) };
  }
  // providers with a quota but no call yet still show their cap
  for (const name of Object.keys(QUOTAS)) if (!out[name]) out[name] = { ok: 0, fail: 0, open: false, quota: quotaState(name, now) };
  return { since: new Date(startedAt).toISOString(), served: { ...served }, providers: out };
}

// The compact form that fits a response header: live=3,stale=0,snapshot=12,none=0
export const servedHeader = () => Object.entries(served).map(([k, v]) => `${k}=${v}`).join(',');

// Test seam.
export function resetProviderHealth() {
  providers.clear();
  for (const k of Object.keys(served)) served[k] = 0;
}
