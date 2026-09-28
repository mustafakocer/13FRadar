// What happened after an insider bought: the stock's return over the next
// 30 and 90 calendar days minus SPY's over the same days (percentage
// points), and the "İsabet" (hit rate) built on it.
//
// The base is the close on the transaction date (or the next trading day),
// not the price on the form: the same close series is then used at both
// ends, so a price reported per ADR or in another unit (roadmap item 4)
// cannot distort it. An outcome is only computed once the horizon has
// fully passed inside the series.
//
// The build stores them on each open-market buy line as `x30` / `x90`.
import { SIGNAL } from './insiderSignalConfig.js';
import { classify } from './insiderClassify.js';
import { adjustedPrice } from './splitAdjust.js';

const DAY = 86400000;
const addDays = (day, n) => new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);

// First bar on or after `day` in an ascending [{date, close}] series.
export function closeOnOrAfter(series, day) {
  let lo = 0;
  let hi = series.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (series[mid].date < day) lo = mid + 1;
    else hi = mid;
  }
  return lo < series.length ? series[lo] : null;
}

const ret = (series, from, to) => {
  const a = closeOnOrAfter(series, from);
  const b = closeOnOrAfter(series, to);
  if (!a || !b || !(a.close > 0) || b.date < to) return null;
  // the end bar must be within a week of the target, or the series has a hole
  if (Date.parse(b.date) - Date.parse(to) > 7 * DAY) return null;
  return b.close / a.close - 1;
};

// Excess return in percentage points, or null when either series cannot say.
export function forwardExcess(series, spy, day, horizonDays) {
  if (!series?.length || !spy?.length || !day) return null;
  const to = addDays(day, horizonDays);
  const s = ret(series, day, to);
  const m = ret(spy, day, to);
  if (s == null || m == null) return null;
  return Number(((s - m) * 100).toFixed(1));
}

// Does the price on the form match the market? More than 25% away from the
// close of the transaction day (or the next trading day, within a week) is
// almost always a foreign currency (CEMEX reporting pesos) or a per-ADR vs
// per-share mix-up — roadmap item 4. Until that work converts prices, such a
// line gets `pu` (price unverified): no return, no İsabet, and the signal
// level capped. Lines with no close to compare against are left alone.
export const PRICE_TOLERANCE = 0.25;
// The daily closes are split-adjusted, so the form price is too before the
// comparison (splitAdjust.js) — a 4-for-1 split is not a currency problem.
export function priceMismatch(r, series, splits) {
  if (!series?.length || !(r?.p > 0) || !r?.d) return null;
  const bar = closeOnOrAfter(series, r.d);
  if (!bar || !(bar.close > 0) || Date.parse(bar.date) - Date.parse(r.d) > 7 * DAY) return null;
  const p = adjustedPrice(r, splits);
  return Math.abs(p / bar.close - 1) > PRICE_TOLERANCE ? { close: bar.close, date: bar.date, ratio: Number((p / bar.close).toFixed(3)) } : false;
}
export function checkPriceUnits(rows, seriesFor) {
  const flagged = [];
  const cache = new Map();
  for (const r of rows) {
    const cat = classify(r).category;
    if (!r.t || (cat !== 'open_buy' && cat !== 'open_sell')) continue;
    if (!cache.has(r.t)) cache.set(r.t, seriesFor(r.t));
    const m = priceMismatch(r, cache.get(r.t));
    if (m) {
      r.pu = 1;
      flagged.push({ t: r.t, d: r.d, p: r.p, close: m.close, ratio: m.ratio });
    } else if (m === false) delete r.pu;
  }
  return flagged;
}

// Store x30/x90 on every open-market buy line whose horizon has passed.
// `seriesFor(ticker)` → ascending [{date, close}] or null. A value already
// stored is kept when the series this run cannot compute it.
export function annotateOutcomes(rows, seriesFor, spy, { horizons = SIGNAL.horizons } = {}) {
  let done = 0;
  const cache = new Map();
  for (const r of rows) {
    if (!r.t || classify(r).category !== 'open_buy') continue;
    if (!cache.has(r.t)) cache.set(r.t, seriesFor(r.t));
    const series = cache.get(r.t);
    for (const h of horizons) {
      const x = forwardExcess(series, spy, r.d, h);
      if (x != null) {
        r[`x${h}`] = x;
        done++;
      }
    }
  }
  return done;
}

// Who a line belongs to, for the per-person hit rate: the owner CIK when the
// row has one, otherwise the name as filed.
export const personKey = (r) => (r.ow ? `cik:${r.ow}` : `name:${String(r.n || '').trim().toUpperCase()}`);

// "İsabet": of this person's open-market buys BEFORE this line, the share
// that beat SPY over the next 90 days. n = the earlier buys with a known
// 90-day outcome. Fewer than SIGNAL.minHitSample → { insufficient: true }.
// Funds and companies get null: their "track record" is a portfolio, not a
// person's judgement.
//   byPerson  Map personKey → that person's open-market buys, any order
export function hitRate(r, byPerson, { horizon = SIGNAL.hitRateHorizon, min = SIGNAL.minHitSample } = {}) {
  const c = classify(r);
  if (c.fund_insider) return null;
  // the form's price is in an unknown unit: say so instead of a number
  if (c.price_unverified) return { unverified: true };
  const key = `x${horizon}`;
  const earlier = (byPerson.get(personKey(r)) || []).filter((b) => b.d < r.d && b[key] != null);
  // one observation per filing: a buy split into lots is one decision
  const byFiling = new Map();
  for (const b of earlier) if (!byFiling.has(b.a)) byFiling.set(b.a, b[key]);
  const n = byFiling.size;
  if (n < min) return { n, insufficient: true };
  const hits = [...byFiling.values()].filter((x) => x > 0).length;
  return { n, hits, rate: Number(((hits / n) * 100).toFixed(1)) };
}

export function buysByPerson(rows) {
  const m = new Map();
  for (const r of rows) {
    if (classify(r).category !== 'open_buy') continue;
    const k = personKey(r);
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(r);
  }
  return m;
}
