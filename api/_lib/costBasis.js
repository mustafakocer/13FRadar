// What a guru probably paid for a position, from the quarterly 13F share
// counts and the daily closes on file.
//
// A 13F says how many shares were held at each quarter end, never what was
// paid. The estimate every tracker prints (Dataroma, Stockcircle) is the
// same one: a quarter in which the count went up is a purchase of the
// difference at that quarter's average close; a quarter in which it went
// down sells at the running average cost, which leaves the average
// untouched; a quarter with no line at all closes the lot, so the next
// purchase starts a new one. The result is a weighted average purchase
// price since the last full exit, comparable with today's close.
//
// Inputs are the history build's shapes (guru-history.json): `quarters` is
// the guru's quarter list oldest → newest, `series` the position's
// [reportDate, shares, value, weight] rows (split-adjusted), `prices` the
// [{date, close}] series the price store holds for the ticker. Pure: no
// file reads here, so the arithmetic can be tested on hand-made rows.
//
// Honesty rules:
//   - the quarter's average close stands in for an unknown purchase price;
//     a position that already existed in the first quarter of the data is
//     priced at that quarter's average and flagged `openedBeforeData`
//   - a purchase quarter with no closes on file leaves the estimate null
//     (`unpriced`): a number built on a guess is worse than a dash
//   - an option line (put/call) is a notional, not a share price — callers
//     skip those

const DAY = 86400 * 1000;
const isoDay = (ms) => new Date(ms).toISOString().slice(0, 10);

// The trading window a quarter end `to` reports on: after the previous
// quarter end, through `to`. Without a previous quarter (the first row of
// the data) a calendar quarter back.
export function quarterWindow(to, prevTo = null) {
  const from = prevTo || isoDay(Date.parse(`${to}T00:00:00Z`) - 91 * DAY);
  return { from, to };
}

// Index of the first row with date > `day` in an ascending series.
function firstAfter(prices, day) {
  let lo = 0;
  let hi = prices.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (prices[mid].date <= day) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

// { avg, lo, hi, n } over closes with from < date <= to, or null when the
// window holds no close.
export function quarterStats(prices, from, to) {
  if (!prices?.length) return null;
  const start = firstAfter(prices, from);
  const end = firstAfter(prices, to); // exclusive
  if (end <= start) return null;
  let sum = 0;
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = start; i < end; i++) {
    const c = prices[i].close;
    sum += c;
    if (c < lo) lo = c;
    if (c > hi) hi = c;
  }
  const n = end - start;
  return { avg: sum / n, lo, hi, n };
}

const round = (x, d = 2) => (Number.isFinite(x) ? Number(x.toFixed(d)) : null);

// → {
//     avgBuy        weighted average purchase price of the open lot (null when
//                   the position is closed or a purchase quarter had no closes)
//     lotShares     shares in the open lot (the latest quarter's count)
//     lotCost       what those shares cost at the estimate
//     since         report date of the first quarter of the open lot
//     openedBeforeData  the lot was already held in the first quarter on file
//     unpriced      a purchase quarter had no closes: avgBuy withheld
//     byQuarter     { [reportDate]: { avg, lo, hi, n } } for every quarter the
//                   position had a line or a change (the pair page's columns)
//   }
export function costBasis({ quarters = [], series = [], prices = [] }) {
  const byDate = new Map(series.map((r) => [r[0], r]));
  const byQuarter = {};
  let prevDate = null;
  let prevShares = 0;
  let lotShares = 0;
  let lotCost = 0;
  let since = null;
  let openedBeforeData = false;
  let unpriced = false;
  quarters.forEach((q, i) => {
    const r = byDate.get(q.reportDate);
    const shares = r ? r[1] : 0;
    const delta = shares - prevShares;
    if (r || prevShares > 0) {
      const w = quarterWindow(q.reportDate, prevDate);
      const stats = quarterStats(prices, w.from, w.to);
      if (stats) byQuarter[q.reportDate] = { avg: round(stats.avg), lo: round(stats.lo), hi: round(stats.hi), n: stats.n };
      if (shares === 0) {
        // closed out: the next line starts a fresh lot
        lotShares = 0;
        lotCost = 0;
        since = null;
        openedBeforeData = false;
        unpriced = false;
      } else if (delta > 0) {
        if (!lotShares) {
          since = q.reportDate;
          openedBeforeData = i === 0;
          unpriced = false;
        }
        if (stats) lotCost += delta * stats.avg;
        else unpriced = true;
        lotShares += delta;
      } else if (delta < 0 && lotShares > 0) {
        const avg = lotCost / lotShares;
        lotShares = Math.max(0, lotShares + delta);
        lotCost = avg * lotShares;
      }
    }
    prevDate = q.reportDate;
    prevShares = shares;
  });
  const open = lotShares > 0 && !unpriced;
  return {
    avgBuy: open ? round(lotCost / lotShares, lotCost / lotShares >= 10 ? 2 : 4) : null,
    lotShares,
    lotCost: open ? Math.round(lotCost) : null,
    since,
    openedBeforeData,
    unpriced,
    byQuarter,
  };
}

// Percent change from the estimate to `current`, or null.
export const gainPct = (avgBuy, current) => (avgBuy > 0 && current > 0 ? round(((current - avgBuy) / avgBuy) * 100, 1) : null);
