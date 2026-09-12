// Precomputes 10 years of quarterly history for the curated gurus so the
// site can show "time held", quarterly history and guru × ticker trade
// history without touching EDGAR per request.
//
//   node scripts/build-guru-history.mjs            (daily, via consensus.yml)
//   GURU_HISTORY_QUARTERS=8 node scripts/…           (shorter look-back)
//
// Output: api/_data/guru-history.json (see api/_lib/history.js for the shape).
// Share counts are split-adjusted with api/_data/splits.json when present.
import fs from 'node:fs';
import path from 'node:path';
import { getSubmissions, list13F, getHoldings } from '../api/_lib/sec.js';
import { mapLimit } from '../api/_lib/yahooClient.js';
import { mapCusipsToTickers } from '../api/_lib/figi.js';
import { CONSENSUS_MANAGERS } from '../api/_lib/consensusList.js';
import { POPULAR_MANAGERS } from '../client/src/data/popular.js';
import { splitAdjust, topRankedCusips } from '../api/_lib/history.js';

const QUARTERS = Number(process.env.GURU_HISTORY_QUARTERS || 40);
// keep a position only if it ranked in some quarter's top N by value —
// the quant shops file 10–20k names a quarter and nothing on the site
// looks past the top holdings
const TOP = Number(process.env.GURU_HISTORY_TOP || 100);
const root = process.cwd();
const OUT = path.join(root, 'api', '_data', 'guru-history.json');
let splits = {};
try {
  splits = JSON.parse(fs.readFileSync(path.join(root, 'api', '_data', 'splits.json'), 'utf8')).byTicker || {};
} catch {
  /* no splits table yet */
}

const gurus = new Map();
for (const m of [...POPULAR_MANAGERS, ...CONSENSUS_MANAGERS]) gurus.set(m.cik, m.name);
const only = process.env.GURU_HISTORY_CIKS ? new Set(process.env.GURU_HISTORY_CIKS.split(',')) : null;

// Previous run, so a guru whose EDGAR fetch fails today keeps yesterday's
// history instead of vanishing from the site. Carried-over entries are
// reported at the end; a run that refreshes nothing exits non-zero.
let previous = {};
try {
  previous = JSON.parse(fs.readFileSync(OUT, 'utf8')).gurus || {};
} catch {
  /* first run */
}

const out = { updatedAt: new Date().toISOString(), quarters: QUARTERS, gurus: {} };
const allCusips = new Set();
const carried = [];
const failed = [];
const carryOver = (cik, name, why) => {
  if (previous[cik]) {
    out.gurus[cik] = previous[cik];
    carried.push(name);
    console.warn(`${name}: ${why} — keeping the previous run's history`);
  } else {
    failed.push(name);
    console.warn(`${name}: ${why} — no previous history to keep`);
  }
};

for (const [cik, name] of gurus) {
  if (only && !only.has(cik)) continue;
  let filings;
  try {
    filings = list13F(await getSubmissions(cik)).slice(0, QUARTERS).reverse(); // oldest → newest
  } catch (e) {
    carryOver(cik, name, `submissions failed (${e.message})`);
    continue;
  }
  const snaps = (
    await mapLimit(filings, 3, async (f) => {
      try {
        const { aum, positions } = await getHoldings(cik, f.acc, f.filingDate);
        return { f, aum, positions: positions.filter((p) => !p.putCall) };
      } catch (e) {
        console.warn(`${name} ${f.acc}: ${e.message}`);
        return null;
      }
    })
  ).filter(Boolean);
  // a partial fetch (rate-limited mid-way) would understate "time held" and
  // turnover, so only a complete look-back replaces the stored history
  if (snaps.length < filings.length) {
    carryOver(cik, name, `${filings.length - snaps.length} of ${filings.length} filings failed`);
    continue;
  }
  if (!snaps.length) {
    carryOver(cik, name, 'no 13F filings');
    continue;
  }

  const positions = {};
  const quarters = [];
  let prev = null;
  for (const s of snaps) {
    const byCusip = new Map(s.positions.map((p) => [p.cusip, p]));
    let newVal = 0;
    let exitVal = 0;
    if (prev) {
      for (const [c, p] of byCusip) if (!prev.byCusip.has(c)) newVal += p.value;
      for (const [c, p] of prev.byCusip) if (!byCusip.has(c)) exitVal += p.value;
    }
    const avgAum = prev ? (prev.aum + s.aum) / 2 : 0;
    quarters.push({
      reportDate: s.f.reportDate,
      filed: s.f.filingDate,
      acc: s.f.acc,
      aum: Math.round(s.aum),
      count: s.positions.length,
      turnover: prev && avgAum ? Number((((newVal + exitVal) / avgAum) * 100).toFixed(2)) : null,
      top10: s.positions.slice(0, 10).map((p) => p.cusip),
    });
    for (const p of s.positions) {
      const e = positions[p.cusip] || { issuer: p.issuer, series: [] };
      e.issuer = p.issuer;
      e.series.push([s.f.reportDate, Math.round(p.shares), Math.round(p.value), Number(p.weight.toFixed(3))]);
      positions[p.cusip] = e;
    }
    prev = { byCusip, aum: s.aum };
  }
  const keep = topRankedCusips(positions, TOP);
  for (const c of Object.keys(positions)) {
    if (keep.has(c)) allCusips.add(c);
    else delete positions[c];
  }
  // held quarters: consecutive quarters ending at the newest snapshot
  const dates = quarters.map((q) => q.reportDate);
  for (const e of Object.values(positions)) {
    const have = new Set(e.series.map((r) => r[0]));
    let held = 0;
    for (let i = dates.length - 1; i >= 0 && have.has(dates[i]); i--) held++;
    e.heldQuarters = held;
    e.firstSeen = e.series[0][0];
  }
  out.gurus[cik] = { name, quarters, positions };
  console.log(`${name}: ${quarters.length} quarters, ${Object.keys(positions).length} securities`);
}

// tickers (static map first, OpenFIGI for the rest) + split adjustment
const tickers = await mapCusipsToTickers([...allCusips], { maxLive: 400 });
for (const [cik, g] of Object.entries(out.gurus)) {
  if (g === previous[cik]) continue; // carried over: already mapped and adjusted
  for (const [cusip, e] of Object.entries(g.positions)) {
    e.ticker = tickers[cusip] || null;
    const sp = e.ticker ? splits[e.ticker] : null;
    if (sp?.length) {
      e.splitAdjusted = true;
      e.series = e.series.map(([d, sh, v, w]) => [d, Math.round(splitAdjust(sh, d, sp)), v, w]);
    }
    // keep the file small: full series only for the last 12 quarters unless
    // the position is still held (its whole history feeds the pair page)
    if (e.heldQuarters === 0) e.series = e.series.slice(-12);
  }
  for (const q of g.quarters) q.top10 = q.top10.map((c) => tickers[c] || c);
}

const refreshed = Object.keys(out.gurus).length - carried.length;
if (!refreshed && Object.keys(previous).length) {
  console.error('guru-history.json: nothing refreshed (EDGAR unreachable?) — keeping the existing file untouched');
  process.exit(1);
}
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(out));
console.log(
  `guru-history.json: ${Object.keys(out.gurus).length} gurus (${refreshed} refreshed, ${carried.length} carried over, ${failed.length} missing), ${(fs.statSync(OUT).size / 1024).toFixed(0)} KB`
);
if (carried.length) console.warn(`carried over: ${carried.join(', ')}`);
if (failed.length) console.warn(`missing: ${failed.join(', ')}`);
