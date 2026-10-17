// One-time, offline repair of api/_data/guru-history.json (no EDGAR, no
// network): the stored rows carried three defects the nightly build could not
// undo on its own, because it never re-reads a quarter it already stored.
//
//   node scripts/repair-guru-history.mjs           (writes the file)
//   REPAIR_DRY=1 node scripts/repair-guru-history.mjs   (report only)
//
// 1. Spin-off price factors applied to share counts. splits.json comes from
//    Twelve Data's adjustment factors, which include spin-offs (GE 1.253,
//    MMM 1.196); the build used to multiply share counts by them, so Trian's
//    unchanged 4,030,213 GE read as a 20% sale in 2024Q2.
// 2. Real splits that never reached stored rows: a split splits.json learnt
//    after a position was first adjusted (or a guru reused unchanged that
//    night) was never applied (RenTech INMD 2:1, Citadel ACGL 3:1).
// 3. Turnover computed on raw share counts, so a split counted as trading.
//
// Which factors a stored row actually carries is read off the row itself:
// value / shares is the price per stored share, and the price cache
// (api/_data/prices, Twelve Data closes adjusted for every factor) gives the
// fully adjusted close on the report date. Their ratio is the product of the
// factors the row is missing; the subset of the ticker's factors that
// explains it is the set applied. A row the prices cannot decide (no close,
// two subsets equally close, nothing close) falls back to what the build did:
// every factor for a position marked `splitAdjusted`, none otherwise.
//
// It also re-points positions whose old CUSIP the security master had under a
// foreign-listing symbol (CCL1EUR, LRCXEUR, TEL1USD …; corrected there with
// source 'manual') at the US ticker, recomputes "time held" for them, fills
// the quarter rows' `putCallValue` / `optionLines` where the stored data says
// what they were, and leaves every position with `splitsApplied`, so the build
// from now on applies only splits a row does not carry yet.
import fs from 'node:fs';
import path from 'node:path';
import { isShareSplit, splitKey, factorsCarried } from '../api/_lib/history.js';
import { tickerFor, securityEntry } from '../api/_lib/securityMaster.js';
import { decodeSeries, seriesKey, pricesDir } from '../api/_lib/priceStore.js';
import { turnover } from '../api/_lib/turnover.js';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const FILE = process.env.GURU_HISTORY_FILE || path.join(root, 'api', '_data', 'guru-history.json');
const SPLITS = path.join(root, 'api', '_data', 'splits.json');
const UNIVERSE = path.join(root, 'client', 'public', 'universe.json');
const DRY = process.env.REPAIR_DRY === '1';

const hist = JSON.parse(fs.readFileSync(FILE, 'utf8'));
// Turnover is corrected by a difference against the raw-share figure the old
// build stored, so it must run once: every quarter it (or the fixed build)
// wrote says `turnoverBasis: 'split-adjusted'`, and a file with any such
// quarter is left alone.
if (Object.values(hist.gurus || {}).some((g) => (g.quarters || []).some((q) => q.turnoverBasis))) {
  console.log(`${FILE}: already repaired (turnoverBasis present) — nothing to do`);
  process.exit(0);
}
const splits = JSON.parse(fs.readFileSync(SPLITS, 'utf8')).byTicker || {};
let universe = [];
try {
  universe = JSON.parse(fs.readFileSync(UNIVERSE, 'utf8')).rows || [];
} catch {
  /* no universe table: the latest quarter's options stay unknown */
}

// ---- prices ----------------------------------------------------------------
const series = new Map();
function closeOn(ticker, day) {
  if (!series.has(ticker)) {
    let s = null;
    try {
      s = decodeSeries(JSON.parse(fs.readFileSync(path.join(pricesDir(), `${seriesKey(ticker)}.json`), 'utf8')));
    } catch {
      s = null;
    }
    series.set(ticker, s?.length ? s : null);
  }
  const s = series.get(ticker);
  if (!s || s[0].date > day) return null;
  let c = null;
  for (const r of s) {
    if (r.date > day) break;
    c = r.close;
  }
  return c;
}

const product = (list) => list.reduce((f, s) => f * s.ratio, 1);
const factorsAfter = (sp, d) => (sp || []).filter((s) => s.date > d && s.ratio > 0 && s.ratio !== 1);

// ---- 0. old identities, for the turnover delta -----------------------------
const oldTicker = new Map(); // `${cik}|${cusip}` → ticker before the repair
for (const [cik, g] of Object.entries(hist.gurus)) for (const [c, e] of Object.entries(g.positions || {})) oldTicker.set(`${cik}|${c}`, e.ticker || null);

const stats = { retickered: 0, rowsChanged: 0, positionsChanged: 0, byPrice: 0, fallback: 0, turnoverChanged: 0, pcvLatest: 0, pcvComplete: 0, heldChanged: 0 };
const examples = [];

for (const [cik, g] of Object.entries(hist.gurus)) {
  const retickered = new Map(); // old ticker → new ticker, for top10
  // ---- 1. tickers the master now corrects ---------------------------------
  for (const [c, e] of Object.entries(g.positions || {})) {
    const m = securityEntry(c);
    if (m?.source === 'manual' && m.ticker && m.ticker !== e.ticker) {
      if (e.ticker) retickered.set(e.ticker, m.ticker);
      e.ticker = m.ticker;
      e.retickered = true;
      stats.retickered++;
    }
  }
  if (retickered.size) for (const q of g.quarters) q.top10 = (q.top10 || []).map((t) => retickered.get(t) || t);

  // ---- 2. share counts in today's shares, real splits only ------------------
  for (const [c, e] of Object.entries(g.positions || {})) {
    const sp = e.ticker ? splits[e.ticker] : null;
    let changed = false;
    if (sp?.length) {
      e.series = e.series.map((r) => {
        const after = factorsAfter(sp, r[0]);
        if (!after.length) return r;
        const target = product(after.filter((s) => isShareSplit(s.ratio)));
        let carried = factorsCarried(r, after, closeOn(e.ticker, r[0]));
        if (carried == null) {
          carried = e.splitAdjusted && !e.retickered ? product(after) : 1;
          stats.fallback++;
        } else stats.byPrice++;
        const shares = Math.round((r[1] * target) / carried);
        if (shares === r[1]) return r;
        changed = true;
        stats.rowsChanged++;
        return [r[0], shares, ...r.slice(2)];
      });
    }
    const keys = (sp || []).filter((s) => isShareSplit(s.ratio)).map(splitKey).sort();
    if (keys.length) {
      e.splitsApplied = keys;
      e.splitAdjusted = true;
    } else {
      delete e.splitsApplied;
      delete e.splitAdjusted;
    }
    if (changed) {
      stats.positionsChanged++;
      e.repaired = true;
    }
  }

  // ---- 3. time held for re-pointed positions -------------------------------
  if (retickered.size) {
    const dates = g.quarters.map((q) => q.reportDate);
    const idOf = (c, e) => e.ticker || c;
    const have = new Map();
    for (const [c, e] of Object.entries(g.positions)) {
      const s = have.get(idOf(c, e)) || new Set();
      for (const r of e.series) s.add(r[0]);
      have.set(idOf(c, e), s);
    }
    const touched = new Set([...Object.entries(g.positions)].filter(([, e]) => e.retickered).map(([c, e]) => idOf(c, e)));
    for (const [c, e] of Object.entries(g.positions)) {
      if (!touched.has(idOf(c, e))) continue;
      const set = have.get(idOf(c, e));
      let held = 0;
      for (let i = dates.length - 1; i >= 0 && set.has(dates[i]); i--) held++;
      const first = [...set].sort()[0];
      if (held !== e.heldQuarters) stats.heldChanged++;
      e.heldQuarters = held;
      if (first && first < e.firstSeen) e.firstSeen = first;
    }
  }

  // ---- 4. turnover on split-adjusted shares, one holding per ticker ---------
  // Recomputing turnover needs the whole book, which the file does not keep
  // for every quarter; the stored books are enough for the difference,
  // though: everything that is not a split or a re-pointed CUSIP contributes
  // the same to both sides and cancels.
  const book = (d, basisDate, idOf) => {
    const out = [];
    for (const [c, e] of Object.entries(g.positions)) {
      const r = e.series.find((x) => x[0] === d);
      if (!r) continue;
      const sp = e.ticker ? splits[e.ticker] : null;
      // rows are now in today's shares; divide back out the real splits after
      // basisDate to get the count as of that date
      const f = product(factorsAfter(sp, basisDate).filter((s) => isShareSplit(s.ratio)));
      out.push({ cusip: c, id: idOf(c, e), shares: r[1] / f, value: r[2] });
    }
    return { positions: out };
  };
  const oldId = (c) => oldTicker.get(`${cik}|${c}`) || c;
  const newId = (c, e) => e.ticker || c;
  if (g.quarters[0]) g.quarters[0].turnoverBasis = 'split-adjusted';
  for (let i = 1; i < g.quarters.length; i++) {
    const q = g.quarters[i];
    const p = g.quarters[i - 1];
    q.turnoverBasis = 'split-adjusted';
    if (!Number.isFinite(q.turnover)) continue;
    // before: each row in its own report date's raw shares, old identities
    const rawPrev = book(p.reportDate, p.reportDate, oldId);
    const rawCur = book(q.reportDate, q.reportDate, oldId);
    const before = turnover({ ...rawPrev, aum: p.aum }, { ...rawCur, aum: q.aum }, { idOf: (x) => x.id });
    // after: both books in this quarter's shares, tickers where known
    const adjPrev = book(p.reportDate, q.reportDate, newId);
    const adjCur = book(q.reportDate, q.reportDate, newId);
    const after = turnover({ ...adjPrev, aum: p.aum }, { ...adjCur, aum: q.aum }, { idOf: (x) => x.id });
    const avg = (p.aum + q.aum) / 2;
    const dTraded = after.traded - before.traded;
    const dNew = after.newCount - before.newCount;
    const dExit = after.exitCount - before.exitCount;
    if (!(avg > 0) || (Math.abs(dTraded) < 0.5 && !dNew && !dExit)) continue;
    const t = Math.max(0, Number((((q.turnover * avg) / 100 + dTraded) / avg * 100).toFixed(2)));
    if (examples.length < 400) examples.push({ guru: g.name, quarter: q.reportDate, from: q.turnover, to: t, newCount: [q.newCount, q.newCount + dNew], exitCount: [q.exitCount, q.exitCount + dExit] });
    q.turnover = t;
    if (Number.isFinite(q.newCount)) q.newCount = Math.max(0, q.newCount + dNew);
    if (Number.isFinite(q.exitCount)) q.exitCount = Math.max(0, q.exitCount + dExit);
    stats.turnoverChanged++;
  }

  // ---- 5. option notional per quarter, where the stored data says it ---------
  const uni = universe.find((r) => r.cik === cik);
  for (const q of g.quarters) {
    if (Number.isFinite(q.putCallValue)) continue;
    if (uni && uni.acc === q.acc && Number.isFinite(uni.putCallValue)) {
      q.putCallValue = uni.putCallValue;
      if (Number.isFinite(uni.positions) && uni.positions >= q.count) q.optionLines = uni.positions - q.count;
      stats.pcvLatest++;
      continue;
    }
    // every equity line of the quarter is stored: the rest of `aum` is options
    let n = 0;
    let v = 0;
    for (const e of Object.values(g.positions)) {
      const r = e.series.find((x) => x[0] === q.reportDate);
      if (r) {
        n++;
        v += r[2];
      }
    }
    if (n === q.count && v <= q.aum * 1.001) {
      q.putCallValue = Math.max(0, Math.round(q.aum - v));
      stats.pcvComplete++;
    }
  }

  for (const e of Object.values(g.positions)) {
    delete e.retickered;
    delete e.repaired;
  }
}

console.log(stats);
const show = (name, q) => examples.filter((x) => x.guru.startsWith(name) && x.quarter === q).forEach((x) => console.log('  turnover', x.guru, x.quarter, x.from, '→', x.to, 'new', x.newCount.join('→'), 'exit', x.exitCount.join('→')));
show('RV Capital', '2026-06-30');
show('Pershing', '2024-06-30');
show('Altimeter', '2024-06-30');
if (!DRY) {
  fs.writeFileSync(FILE, JSON.stringify(hist));
  console.log(`wrote ${FILE}`);
}
