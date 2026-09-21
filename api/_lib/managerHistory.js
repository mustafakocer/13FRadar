// The manager page's history cards, answered from the nightly guru history
// instead of EDGAR.
//
// /api/aum-history and /api/manager-stats used to read eight to twelve
// quarters of 13F info tables from SEC on every cold request — two round
// trips and an XML parse per quarter, sequentially rate-limited, for a chart
// and four numbers. On a guru page that was the slowest thing on the screen
// and, for a wide book, past the function's time limit. The nightly build
// already walks those filings for every curated fund and stores per-quarter
// AUM, count and turnover plus the top-ranked positions' series; everything
// the two endpoints report can be read off that in microseconds.
//
// Filers outside the curated set still take the EDGAR path.

const round = (x, d = 2) => (x == null || !Number.isFinite(x) ? null : Number(x.toFixed(d)));

// Quarter-over-quarter and year-over-year AUM change on an oldest→newest
// series of { reportDate, aum }. Shared with the EDGAR path so both answer
// in the same shape.
export function annotateAum(history) {
  for (let i = 0; i < history.length; i++) {
    const cur = history[i];
    const prev = history[i - 1];
    cur.qoq = prev?.aum ? ((cur.aum - prev.aum) / prev.aum) * 100 : null;
    const yearAgo = history.find(
      (h) => h.reportDate.slice(0, 4) == cur.reportDate.slice(0, 4) - 1 && h.reportDate.slice(5, 7) === cur.reportDate.slice(5, 7)
    );
    cur.yoy = yearAgo?.aum ? ((cur.aum - yearAgo.aum) / yearAgo.aum) * 100 : null;
  }
  return history;
}

// Estimated net flow = ΔAUM − previous AUM × the benchmark's return over the
// quarter. `spyAt(date)` answers the benchmark close on or before a date, or
// null, in which case the flow columns stay null rather than pretend.
export function attachFlows(history, spyAt) {
  for (let i = 0; i < history.length; i++) {
    const cur = history[i];
    const prev = history[i - 1];
    if (!prev) {
      cur.spyRet = null;
      cur.estFlow = null;
      continue;
    }
    const s0 = spyAt ? spyAt(prev.reportDate) : null;
    const s1 = spyAt ? spyAt(cur.reportDate) : null;
    cur.spyRet = s0 && s1 ? ((s1 - s0) / s0) * 100 : null;
    cur.estFlow = s0 && s1 ? cur.aum - prev.aum * (1 + (s1 - s0) / s0) : null;
  }
  return history;
}

// The last `limit` quarters of a guru's stored history, oldest first, in the
// shape /api/aum-history answers.
export function aumHistoryFromGuru(guru, limit = 12) {
  const quarters = Array.isArray(guru?.quarters) ? guru.quarters : [];
  if (!quarters.length) return null;
  const history = quarters.slice(-limit).map((q) => ({
    acc: q.acc,
    filingDate: q.filed,
    reportDate: q.reportDate,
    aum: q.aum,
    positions: q.count,
    ...(q.amended ? { amended: true } : {}),
  }));
  return annotateAum(history);
}

// Positions held in a quarter, from the stored series: Map cusip → value.
function bookAt(guru, reportDate) {
  const out = new Map();
  for (const [cusip, e] of Object.entries(guru.positions || {})) {
    const row = (e.series || []).find((r) => r[0] === reportDate);
    if (row) out.set(cusip, row[2]);
  }
  return out;
}

// Turnover, average holding period and the latest quarter's new / exited
// counts over the last eight stored quarters, in the shape /api/manager-stats
// answers. Turnover comes from the build (computed over the complete book);
// the counts and holding period come from the stored positions, which are
// every name that ever ranked in a quarter's top hundred — the whole book for
// a concentrated fund, the part that matters for a wide one.
export function managerStatsFromGuru(guru, { window = 8 } = {}) {
  const quarters = Array.isArray(guru?.quarters) ? guru.quarters.slice(-window) : [];
  if (quarters.length < 2) return { quarters: quarters.length };
  const turnovers = quarters.slice(1).map((q) => (Number.isFinite(q.turnover) ? q.turnover : null));
  const tvals = turnovers.filter((x) => x != null);

  const books = quarters.map((q) => bookAt(guru, q.reportDate));
  const latest = books[books.length - 1];
  const before = books[books.length - 2];
  // the build counts over the complete book (turnover.js); the stored
  // positions are a subset, so its counts win when it stored them
  const lastQ = quarters[quarters.length - 1];
  let newCount = 0;
  let exitCount = 0;
  for (const c of latest.keys()) if (!before.has(c)) newCount++;
  for (const c of before.keys()) if (!latest.has(c)) exitCount++;
  if (Number.isFinite(lastQ.newCount)) newCount = lastQ.newCount;
  if (Number.isFinite(lastQ.exitCount)) exitCount = lastQ.exitCount;

  const top50 = [...latest.entries()].sort((a, b) => b[1] - a[1]).slice(0, 50);
  let heldSum = 0;
  for (const [cusip] of top50) {
    let held = 1;
    for (let i = books.length - 2; i >= 0; i--) {
      if (books[i].has(cusip)) held++;
      else break;
    }
    heldSum += held;
  }

  return {
    quarters: quarters.length,
    turnoverLatest: round(turnovers[turnovers.length - 1]),
    turnoverAvg: tvals.length ? round(tvals.reduce((s, x) => s + x, 0) / tvals.length) : null,
    avgHoldingQuarters: top50.length ? round(heldSum / top50.length) : null,
    newCount,
    exitCount,
    source: 'guru-history',
  };
}
