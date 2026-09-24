// The copy-the-13F simulation, pure over data the handler fetched: each
// quarter, buy the manager's top-N positions at their filed weights on
// reportDate + 46 days (the filing is public by then) and hold until the
// next rebalance. Compared against the benchmark over the same windows.
//
// A position with no price series is dropped and the rest renormalised;
// `coverage` is the average share of filed weight the simulation actually
// held, and `skipped` names what was dropped and why, so the page can say
// how much of the portfolio the number describes. Without a benchmark
// series the benchmark is null, never a flat 0.0%.
export const addDays = (dateStr, d) => {
  const t = new Date(dateStr + 'T00:00:00Z');
  t.setUTCDate(t.getUTCDate() + d);
  return t.toISOString().slice(0, 10);
};

export const PUBLIC_LAG_DAYS = 46;

export function simulate({ snapshots, tickers, priceSeries, benchmark = 'SPY', today = new Date().toISOString().slice(0, 10), topN = 15 }) {
  const valid = (snapshots || []).filter((s) => s && s.f && Array.isArray(s.top));
  if (valid.length < 2) return { points: [], error: 'not-enough-filings', skipped: [], coverage: null, benchmark: null };

  const priceAt = (sym, date) => {
    const arr = sym ? priceSeries[sym] : null;
    if (!arr?.length) return null;
    for (const p of arr) if (p.date >= date) return p.close;
    return null;
  };
  const hasSeries = (sym) => Boolean(sym && priceSeries[sym]?.length);

  let nav = 1;
  let benchNav = 1;
  let benchSeen = false;
  const start0 = addDays(valid[0].f.reportDate, PUBLIC_LAG_DAYS);
  const points = [{ date: start0, port: 1, spy: 1 }];
  const coverages = [];
  const skipped = new Map();
  const note = (p, sym, reason) => {
    const key = p.cusip || sym;
    if (!skipped.has(key)) skipped.set(key, { cusip: p.cusip || null, ticker: sym || null, issuer: p.issuer || p.name || null, reason });
  };

  for (let i = 0; i < valid.length; i++) {
    const start = addDays(valid[i].f.reportDate, PUBLIC_LAG_DAYS);
    const end = i + 1 < valid.length ? addDays(valid[i + 1].f.reportDate, PUBLIC_LAG_DAYS) : today;
    if (start >= end || start > today) break;

    let wSum = 0;
    let ret = 0;
    let totalW = 0;
    for (const p of valid[i].top) {
      totalW += p.weight;
      const sym = tickers[p.cusip];
      if (!sym) {
        note(p, null, 'no-ticker');
        continue;
      }
      if (!hasSeries(sym)) {
        note(p, sym, 'no-prices');
        continue;
      }
      const p0 = priceAt(sym, start);
      const p1 = priceAt(sym, end);
      if (!p0 || !p1) {
        note(p, sym, 'no-prices');
        continue;
      }
      wSum += p.weight;
      ret += p.weight * (p1 / p0 - 1);
    }
    if (wSum <= 0) continue;
    coverages.push(totalW ? wSum / totalW : 0);
    nav *= 1 + ret / wSum;

    const s0 = priceAt(benchmark, start);
    const s1 = priceAt(benchmark, end);
    if (s0 && s1) {
      benchNav *= s1 / s0;
      benchSeen = true;
    }
    points.push({ date: end, port: Number(nav.toFixed(4)), spy: benchSeen ? Number(benchNav.toFixed(4)) : null });
  }

  const coverage = coverages.length ? (coverages.reduce((s, c) => s + c, 0) / coverages.length) * 100 : null;
  return {
    points: benchSeen ? points : points.map(({ date, port }) => ({ date, port })),
    totalPort: (nav - 1) * 100,
    totalSpy: benchSeen ? (benchNav - 1) * 100 : null,
    benchmark: benchSeen ? benchmark : null,
    coverage,
    skipped: [...skipped.values()],
    topN,
    quarters: points.length - 1,
  };
}
