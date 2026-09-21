// Precomputes 10 years of quarterly history for the curated gurus so the
// site can show "time held", quarterly history and guru × ticker trade
// history without touching EDGAR per request.
//
//   node scripts/build-guru-history.mjs            (daily, via consensus.yml)
//   GURU_HISTORY_QUARTERS=8 node scripts/…           (shorter look-back)
//   GURU_HISTORY_FORCE=1 node scripts/…              (rebuild every guru)
//   GURU_HISTORY_CIKS=a,b node scripts/…             (only these)
//
// Output: api/_data/guru-history.json (see api/_lib/history.js for the shape).
// Share counts are split-adjusted with api/_data/splits.json when present.
//
// Every quarter is an effective snapshot: the 13F-HR for the period with its
// 13F-HR/A amendments applied (api/_lib/amendments.js). A quarter row says
// when that happened (`amended: [{acc, filed, type}]`). Turnover is the one
// definition in api/_lib/turnover.js, and "time held" runs over tickers so a
// CUSIP change inside a position is not a sale and a repurchase.
import fs from 'node:fs';
import path from 'node:path';
import { getSubmissions, list13F, getEffectiveHoldings } from '../api/_lib/sec.js';
import { mapLimit } from '../api/_lib/yahooClient.js';
import { mapCusipsToTickers } from '../api/_lib/figi.js';
import { CONSENSUS_MANAGERS } from '../api/_lib/consensusList.js';
import { POPULAR_MANAGERS, wantsHistory } from '../client/src/data/popular.js';
import { splitAdjust, topRankedCusips } from '../api/_lib/history.js';
import { turnover } from '../api/_lib/turnover.js';

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
// Market makers and multi-strats file thousands of names a quarter; forty of
// those info tables each would cost more CI than the rest of the job put
// together, so popular.js opts them out (see the note there).
for (const m of [...POPULAR_MANAGERS, ...CONSENSUS_MANAGERS]) {
  if (!wantsHistory(m.cik)) continue;
  gurus.set(m.cik, m.name);
}
const only = process.env.GURU_HISTORY_CIKS ? new Set(process.env.GURU_HISTORY_CIKS.split(',')) : null;
const FORCE = process.env.GURU_HISTORY_FORCE === '1';

// Downloading forty info tables per guru is the entire cost of this job —
// ~800 filings, an hour of CI, every single day, to rebuild numbers that
// cannot change: a quarter's holdings are fixed once filed, and an amendment
// arrives as a new accession. So when EDGAR lists exactly the documents the
// stored history was built from — originals and amendments — keep it and
// fetch nothing. The fingerprint's version prefix forces one rebuild when
// the snapshot logic changes (v2: amendments applied, turnover redefined).
const FP_VERSION = 'v2';
const fingerprint = (filings) =>
  `${FP_VERSION}|` + filings.map((f) => `${f.reportDate}:${f.acc}${f.amendments.length ? `+${f.amendments.map((a) => a.acc).join('+')}` : ''}`).join(',');

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
const reused = [];
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

const started = Date.now();
let tablesRead = 0;
for (const [cik, name] of gurus) {
  if (only && !only.has(cik)) continue;
  let filings;
  try {
    // one entry per period, newest period first; oldest → newest for the walk
    filings = list13F(await getSubmissions(cik)).slice(0, QUARTERS).reverse();
  } catch (e) {
    carryOver(cik, name, `submissions failed (${e.message})`);
    continue;
  }
  const fp = fingerprint(filings);
  if (!FORCE && previous[cik]?.fp === fp) {
    out.gurus[cik] = previous[cik];
    reused.push(name);
    console.log(`${name}: no new filing since the last build — reusing ${filings.length} quarters`);
    continue;
  }

  const snaps = (
    await mapLimit(filings, 3, async (f) => {
      try {
        const { aum, positions, amendments } = await getEffectiveHoldings(cik, f);
        tablesRead += 1 + (f.amendments?.length || 0);
        return { f, aum, positions: positions.filter((p) => !p.putCall), amendments: amendments || [] };
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
    const t = turnover(prev, s);
    quarters.push({
      reportDate: s.f.reportDate,
      filed: s.f.filingDate,
      acc: s.f.acc,
      aum: Math.round(s.aum),
      count: s.positions.length,
      turnover: t.turnover,
      newCount: prev ? t.newCount : null,
      exitCount: prev ? t.exitCount : null,
      top10: s.positions.slice(0, 10).map((p) => p.cusip),
      ...(s.amendments.length
        ? { amended: s.amendments.map((a) => ({ acc: a.acc, filed: a.filingDate, type: a.type, positions: a.positions })) }
        : {}),
    });
    for (const p of s.positions) {
      const e = positions[p.cusip] || { issuer: p.issuer, series: [] };
      e.issuer = p.issuer;
      e.series.push([s.f.reportDate, Math.round(p.shares), Math.round(p.value), Number(p.weight.toFixed(3))]);
      positions[p.cusip] = e;
    }
    prev = s;
  }
  const keep = topRankedCusips(positions, TOP);
  for (const c of Object.keys(positions)) {
    if (keep.has(c)) allCusips.add(c);
    else delete positions[c];
  }
  out.gurus[cik] = { name, fp, quarters, positions };
  console.log(`${name}: ${quarters.length} quarters, ${Object.keys(positions).length} securities${quarters.some((q) => q.amended) ? `, ${quarters.filter((q) => q.amended).length} with amendments applied` : ''}`);
}

// tickers (static map first, OpenFIGI for the rest), then time held over the
// ticker — a CUSIP that changed under a position (a split, a reorganisation)
// keeps its holding streak — and split adjustment
const tickers = await mapCusipsToTickers([...allCusips], { maxLive: 400 });
for (const [cik, g] of Object.entries(out.gurus)) {
  if (g === previous[cik]) continue; // carried over: already mapped and adjusted
  const dates = g.quarters.map((q) => q.reportDate);
  // the security id per quarter: ticker when known, else the CUSIP itself
  const idOf = (cusip, e) => e.ticker || cusip;
  const heldById = new Map(); // id → Set(reportDate)
  for (const [cusip, e] of Object.entries(g.positions)) {
    e.ticker = tickers[cusip] || null;
    const id = idOf(cusip, e);
    const set = heldById.get(id) || new Set();
    for (const r of e.series) set.add(r[0]);
    heldById.set(id, set);
  }
  for (const [cusip, e] of Object.entries(g.positions)) {
    const have = heldById.get(idOf(cusip, e));
    let held = 0;
    for (let i = dates.length - 1; i >= 0 && have.has(dates[i]); i--) held++;
    e.heldQuarters = held;
    e.firstSeen = [...have].sort()[0] || e.series[0][0];
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

// Reused entries are the normal state between filing seasons, so only a run
// that fetched nothing AND reused nothing means EDGAR was unreachable.
const refreshed = Object.keys(out.gurus).length - carried.length - reused.length;
if (!refreshed && !reused.length && Object.keys(previous).length) {
  console.error('guru-history.json: nothing refreshed (EDGAR unreachable?) — keeping the existing file untouched');
  process.exit(1);
}
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(out));
console.log(
  `guru-history.json: ${Object.keys(out.gurus).length} gurus (${refreshed} refreshed, ${reused.length} unchanged, ${carried.length} carried over, ${failed.length} missing), ${tablesRead} tables read in ${Math.round((Date.now() - started) / 1000)}s, ${(fs.statSync(OUT).size / 1024).toFixed(0)} KB`
);
if (carried.length) console.warn(`carried over: ${carried.join(', ')}`);
if (failed.length) console.warn(`missing: ${failed.join(', ')}`);
