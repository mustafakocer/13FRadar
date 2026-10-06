// What a guru's 13F portfolio returned, chained quarter by quarter, against
// SPY over the same windows — the 1 / 3 / 5 / 10-year figures a guru page
// and the "best performance" list show.
//
// A 13F is a snapshot of weights at a quarter end. The portfolio's return
// over the next quarter is those weights times each holding's price change
// to the next quarter end (a buy-and-hold of the filed book, rebalanced to
// the new filing each quarter). Chain the quarters and the stub from the
// latest quarter end to the last close, and a window of N years is the
// product of the last 4N quarters and the stub. SPY is read at the same
// dates. The stored history holds every name that ever ranked in a
// quarter's top hundred, so for a concentrated fund this is the whole book
// and for a wide one the part that matters; `coverage` says how much of
// the filed weight was priced, and a quarter below MIN_COVERAGE answers
// null rather than a number built on a third of the portfolio.
//
// This is not the fund's reported return: 13F covers long US equities only,
// says nothing about cash, shorts, options or fees, and lands 45 days late.
// The page says so.
//
// Pure: `priceAt(ticker, date)` is injected (valueUnits.closeOn in
// production), so the arithmetic is testable on hand-made series.

export const MIN_COVERAGE = 0.5;
export const HORIZONS = { y1: 1, y3: 3, y5: 5, y10: 10 }; // years
// a 13F is due 45 days after the quarter; past 200 days the fund stopped filing
export const STUB_MAX_DAYS = 200;
export const daysBetween = (a, b) => (Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000;

const round = (x, d = 1) => (Number.isFinite(x) ? Number(x.toFixed(d)) : null);

// The weights filed at `reportDate`: [{ cusip, ticker, weight }].
export function bookAt(positions, reportDate, tickerOf = (cusip, e) => e.ticker || null) {
  const out = [];
  for (const [cusip, e] of Object.entries(positions || {})) {
    const row = (e.series || []).find((r) => r[0] === reportDate);
    if (row && row[3] > 0) out.push({ cusip, ticker: tickerOf(cusip, e), weight: row[3] });
  }
  return out;
}

// The book's return from `from` to `to`: { ret (percent), coverage (0..1) }
// — null ret when too little of the filed weight could be priced.
export function periodReturn(book, from, to, priceAt) {
  let w = 0;
  let acc = 0;
  for (const p of book) {
    if (!p.ticker) continue;
    const p0 = priceAt(p.ticker, from);
    const p1 = priceAt(p.ticker, to);
    if (!(p0 > 0) || !(p1 > 0)) continue;
    w += p.weight;
    acc += p.weight * (p1 / p0 - 1);
  }
  const coverage = w / 100;
  return { ret: coverage >= MIN_COVERAGE ? (acc / w) * 100 : null, coverage };
}

// Every quarter-to-quarter return in the history plus the stub to `asOf`,
// oldest first: [{ from, to, port, spy, coverage }].
export function quarterlyReturns({ quarters = [], positions = {}, priceAt, asOf, benchmark = 'SPY', tickerOf }) {
  const out = [];
  const spyRet = (a, b) => {
    const s0 = priceAt(benchmark, a);
    const s1 = priceAt(benchmark, b);
    return s0 > 0 && s1 > 0 ? (s1 / s0 - 1) * 100 : null;
  };
  for (let i = 1; i < quarters.length; i++) {
    const from = quarters[i - 1].reportDate;
    const to = quarters[i].reportDate;
    const { ret, coverage } = periodReturn(bookAt(positions, from, tickerOf), from, to, priceAt);
    out.push({ from, to, port: round(ret, 2), spy: round(spyRet(from, to), 2), coverage: round(coverage, 3) });
  }
  // the stub runs only while the fund is still filing: a book last filed
  // two years ago is history, not a position held to today
  const last = quarters[quarters.length - 1]?.reportDate;
  if (last && asOf && asOf > last && daysBetween(last, asOf) <= STUB_MAX_DAYS) {
    const { ret, coverage } = periodReturn(bookAt(positions, last, tickerOf), last, asOf, priceAt);
    out.push({ from: last, to: asOf, port: round(ret, 2), spy: round(spyRet(last, asOf), 2), coverage: round(coverage, 3), stub: true });
  }
  return out;
}

// The N-year window ending at the last period's end: every period that
// ends after `end − N years`, so the window starts at the quarter end on
// or just before that date (quarter data cannot split a quarter). Null
// when the periods do not reach back that far, when a quarter is missing
// in between (a gap in the filings), or when any link is null.
export const yearsBefore = (iso, n) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCFullYear(d.getUTCFullYear() - n);
  return d.toISOString().slice(0, 10);
};
// a quarter-to-quarter period spans ~91 days; past 100 a quarter is missing
const MAX_GAP_DAYS = 100;

export function chain(periods, years) {
  const none = { port: null, spy: null, coverage: null, from: null };
  if (!periods.length) return none;
  const end = periods[periods.length - 1].to;
  const target = yearsBefore(end, years);
  const win = periods.filter((p) => p.to > target);
  if (!win.length || win[0].from > target) return none; // does not reach back far enough
  let port = 1;
  let spy = 1;
  let minCov = Infinity;
  for (let i = 0; i < win.length; i++) {
    const p = win[i];
    if (i > 0 && p.from !== win[i - 1].to) return { ...none, from: win[0].from }; // a filing is missing
    if (!p.stub && daysBetween(p.from, p.to) > MAX_GAP_DAYS) return { ...none, from: win[0].from };
    if (p.port == null || p.spy == null) return { ...none, from: win[0].from };
    port *= 1 + p.port / 100;
    spy *= 1 + p.spy / 100;
    if (p.coverage < minCov) minCov = p.coverage;
  }
  return { port: round((port - 1) * 100), spy: round((spy - 1) * 100), coverage: round(minCov, 2), from: win[0].from, to: end };
}

// { y1: { port, spy, diff, coverage, from }, … } over HORIZONS.
export function horizonReturns(periods) {
  const out = {};
  for (const [key, years] of Object.entries(HORIZONS)) {
    const h = chain(periods, years);
    out[key] = { ...h, diff: h.port != null && h.spy != null ? round(h.port - h.spy) : null };
  }
  return out;
}

// One guru, end to end, from the history build's shapes.
export function guruPerformance(g, { priceAt, asOf, tickerOf, benchmark = 'SPY' }) {
  const quarters = g.quarters || [];
  const last = quarters[quarters.length - 1]?.reportDate || null;
  const current = Boolean(last && asOf && daysBetween(last, asOf) <= STUB_MAX_DAYS);
  const periods = quarterlyReturns({ quarters, positions: g.positions || {}, priceAt, asOf, tickerOf, benchmark });
  // a fund no longer filing is measured to its last quarter end
  return { asOf: current ? asOf : last, current, periods, horizons: horizonReturns(periods) };
}
