// Precomputes 10 years of quarterly history for the curated gurus so the
// site can show "time held", quarterly history and guru × ticker trade
// history without touching EDGAR per request.
//
//   node scripts/build-guru-history.mjs            (daily, via consensus.yml)
//   GURU_HISTORY_QUARTERS=8 node scripts/…           (shorter look-back)
//   GURU_HISTORY_FORCE=1 node scripts/…              (rebuild every guru, every quarter)
//   GURU_HISTORY_CIKS=a,b node scripts/…             (only these)
//   GURU_HISTORY_DRY=1 node scripts/…                (plan only: requests, cache hits, minutes)
//   GURU_HISTORY_INCREMENTAL=0 node scripts/…        (on a changed fingerprint read every quarter)
//
// Output: api/_data/guru-history.json (see api/_lib/history.js for the shape).
// Share counts are split-adjusted with api/_data/splits.json when present.
//
// Every quarter is an effective snapshot: the 13F-HR for the period with its
// 13F-HR/A amendments applied (api/_lib/amendments.js). A quarter row says
// when that happened (`amended: [{acc, filed, type}]`). Turnover is the one
// definition in api/_lib/turnover.js, and "time held" runs over tickers so a
// CUSIP change inside a position is not a sale and a repurchase.
//
// Cost. A guru is forty periods, each a directory listing and an info
// table (an amendment adds a listing, a table and a cover page). Three
// things keep that off EDGAR:
//   · the fingerprint: when EDGAR lists exactly the documents the stored
//     history was built from, nothing is read (api/_lib/historyPlan.js);
//   · incremental: when it lists a new filing, only the changed periods
//     (plus the one before, for turnover) are read and the other quarter
//     rows are kept;
//   · the disk cache (api/_lib/edgarCache.js, restored by the Action): a
//     document read once is never fetched again, so even a forced full
//     walk costs no more than what the cache does not yet hold.
// The dry run prints the plan before a request is made.
import fs from 'node:fs';
import path from 'node:path';
import { getSubmissions, list13F, getEffectiveHoldings, edgarStats } from '../api/_lib/sec.js';
import { cacheHas, cacheEnabled } from '../api/_lib/edgarCache.js';
import { planRebuild, estimateRequests, estimateSeconds } from '../api/_lib/historyPlan.js';
import { mapLimit } from '../api/_lib/yahooClient.js';
import { mapCusipsToTickers } from '../api/_lib/figi.js';
import { persist as persistMaster, stats as masterStats, tickerFor } from '../api/_lib/securityMaster.js';
import { historyPanel } from '../api/_lib/gurus.js';
import { splitAdjust, topRankedCusips } from '../api/_lib/history.js';
import { turnover, turnoverOutliers, TURNOVER_OUTLIER } from '../api/_lib/turnover.js';

const QUARTERS = Number(process.env.GURU_HISTORY_QUARTERS || 40);
// keep a position only if it ranked in some quarter's top N by value —
// the quant shops file 10–20k names a quarter and nothing on the site
// looks past the top holdings
const TOP = Number(process.env.GURU_HISTORY_TOP || 100);
const RPS = Math.max(1, Number(process.env.SEC_RPS) || 6);
const root = process.cwd();
const OUT = process.env.GURU_HISTORY_OUT || path.join(root, 'api', '_data', 'guru-history.json');
let splits = {};
try {
  splits = JSON.parse(fs.readFileSync(path.join(root, 'api', '_data', 'splits.json'), 'utf8')).byTicker || {};
} catch {
  /* no splits table yet */
}

const gurus = new Map();
// Market makers and multi-strats file thousands of names a quarter; forty of
// those info tables each would cost more CI than the rest of the job put
// together, so the registry opts them out (`history: false`, gurus.js).
// Closed funds stay in: their history is exactly what their page shows.
for (const m of historyPanel()) gurus.set(m.cik, m.name);
const only = process.env.GURU_HISTORY_CIKS ? new Set(process.env.GURU_HISTORY_CIKS.split(',')) : null;
const FORCE = process.env.GURU_HISTORY_FORCE === '1';
const DRY = process.env.GURU_HISTORY_DRY === '1';
const INCREMENTAL = process.env.GURU_HISTORY_INCREMENTAL !== '0';

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
const incremental = [];
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

// The position rows of the stored quarters a plan keeps, and the quarter
// rows themselves, so a partial walk merges onto them.
function keptFromPrevious(prev, keep) {
  const dates = new Set(keep);
  const quarters = (prev?.quarters || []).filter((q) => dates.has(q.reportDate));
  const positions = {};
  for (const [cusip, e] of Object.entries(prev?.positions || {})) {
    const series = (e.series || []).filter((r) => dates.has(r[0]));
    if (!series.length) continue;
    positions[cusip] = { issuer: e.issuer, series, splitAdjusted: Boolean(e.splitAdjusted), keptTicker: e.ticker || null };
  }
  return { quarters, positions };
}

const started = Date.now();
let tablesRead = 0;
const dry = { gurus: 0, full: 0, incremental: 0, reuse: 0, docs: 0, requests: 0, hits: 0 };
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
  const plan = planRebuild(previous[cik], filings, { force: FORCE, incremental: INCREMENTAL });
  if (DRY) {
    const est = estimateRequests(cik, plan, cacheHas);
    dry.gurus++;
    dry[plan.mode]++;
    dry.docs += est.docs;
    dry.requests += est.requests;
    dry.hits += est.hits;
    console.log(`${name.padEnd(48)} ${plan.mode.padEnd(11)} ${String(plan.fetch.length).padStart(2)} periods · ${String(est.docs).padStart(3)} docs · ${String(est.hits).padStart(3)} cached · ${String(est.requests).padStart(3)} requests`);
    continue;
  }
  if (plan.mode === 'reuse') {
    out.gurus[cik] = previous[cik];
    reused.push(name);
    console.log(`${name}: no new document since the last build — reusing ${filings.length} quarters`);
    continue;
  }

  const snaps = (
    await mapLimit(plan.fetch, 3, async (f) => {
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
  // turnover, so only a complete read of the plan replaces the stored history
  if (snaps.length < plan.fetch.length) {
    carryOver(cik, name, `${plan.fetch.length - snaps.length} of ${plan.fetch.length} filings failed`);
    continue;
  }
  if (!snaps.length) {
    carryOver(cik, name, 'no 13F filings');
    continue;
  }

  // Resolve this guru's identifiers into the security master before the
  // arithmetic: turnover and "time held" are keyed by ticker where one is
  // known, so a CUSIP change under a position is neither a sale nor a
  // break in the holding streak.
  const names = {};
  for (const s of snaps) for (const p of s.positions) if (!names[p.cusip]) names[p.cusip] = p.issuer;
  await mapCusipsToTickers(Object.keys(names), { maxLive: Number(process.env.GURU_HISTORY_FIGI_BUDGET || 200), names });
  const idOf = (p) => tickerFor(p.cusip) || String(p.cusip || '').toUpperCase();

  // start from the stored quarters the plan keeps (none on a full walk)
  const kept = keptFromPrevious(previous[cik], plan.keep);
  const positions = kept.positions;
  const quarters = [...kept.quarters];
  const fresh = new Set(); // report dates computed this run (split-adjusted below)
  let prev = null;
  for (const s of snaps) {
    if (plan.recompute.has(s.f.reportDate)) {
      const t = turnover(prev, s, { idOf });
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
      fresh.add(s.f.reportDate);
      for (const p of s.positions) {
        const e = positions[p.cusip] || { issuer: p.issuer, series: [] };
        e.issuer = p.issuer;
        e.series.push([s.f.reportDate, Math.round(p.shares), Math.round(p.value), Number(p.weight.toFixed(3))]);
        positions[p.cusip] = e;
      }
    }
    prev = s;
  }
  quarters.sort((a, b) => (a.reportDate < b.reportDate ? -1 : 1));
  for (const e of Object.values(positions)) e.series.sort((a, b) => (a[0] < b[0] ? -1 : 1));
  const keep = topRankedCusips(positions, TOP);
  for (const c of Object.keys(positions)) {
    if (keep.has(c)) allCusips.add(c);
    else delete positions[c];
  }
  out.gurus[cik] = { name, fp: plan.fp, quarters, positions, fresh };
  if (plan.mode === 'incremental') incremental.push(name);
  console.log(
    `${name}: ${plan.mode}, ${plan.fetch.length} of ${quarters.length} quarters read, ${Object.keys(positions).length} securities${quarters.some((q) => q.amended) ? `, ${quarters.filter((q) => q.amended).length} with amendments applied` : ''}`
  );
  const odd = turnoverOutliers(quarters);
  if (odd.length) console.warn(`${name}: turnover above ${TURNOVER_OUTLIER}% in ${odd.map((q) => `${q.reportDate} (${q.turnover}%)`).join(', ')} — check the snapshot for that period`);
}

if (DRY) {
  const seconds = estimateSeconds(dry.requests, RPS, dry.gurus);
  console.log(
    `\n[dry run] ${dry.gurus} gurus: ${dry.reuse} reused, ${dry.incremental} incremental, ${dry.full} full · ${dry.docs} documents, ${dry.hits} already cached (${dry.docs ? Math.round((dry.hits / dry.docs) * 100) : 0}%), ${dry.requests} EDGAR requests` +
      `\n[dry run] at ${RPS} req/s ≈ ${Math.round(seconds / 60)} min${cacheEnabled() ? '' : ' (disk cache disabled: EDGAR_CACHE_DIR is empty)'}`
  );
  process.exit(0);
}

// tickers from the security master (resolved above, per guru), then time
// held over the ticker — a CUSIP that changed under a position (a split, a
// reorganisation) keeps its holding streak — and split adjustment
const tickers = await mapCusipsToTickers([...allCusips], { maxLive: 0 });
for (const [cik, g] of Object.entries(out.gurus)) {
  if (g === previous[cik]) continue; // carried over or reused: already mapped and adjusted
  const fresh = g.fresh || new Set();
  delete g.fresh;
  const dates = g.quarters.map((q) => q.reportDate);
  // the security id per quarter: ticker when known, else the CUSIP itself
  const idOf = (cusip, e) => e.ticker || cusip;
  const heldById = new Map(); // id → Set(reportDate)
  for (const [cusip, e] of Object.entries(g.positions)) {
    e.ticker = tickers[cusip] || e.keptTicker || null;
    delete e.keptTicker;
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
      // rows kept from the stored file are already adjusted; only the rows
      // read this run are
      e.series = e.series.map(([d, sh, v, w]) => (fresh.has(d) || !e.splitAdjusted ? [d, Math.round(splitAdjust(sh, d, sp)), v, w] : [d, sh, v, w]));
      e.splitAdjusted = true;
    } else delete e.splitAdjusted;
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
persistMaster();
{
  const ms = masterStats();
  const noTicker = Object.values(out.gurus).reduce((n, g) => n + Object.values(g.positions).filter((e) => !e.ticker).length, 0);
  console.log(`security master: ${ms.resolved} resolved, ${ms.unresolved} unresolved; ${noTicker} stored positions without a ticker`);
}
const es = edgarStats();
console.log(
  `guru-history.json: ${Object.keys(out.gurus).length} gurus (${refreshed} refreshed — ${incremental.length} incremental, ${reused.length} unchanged, ${carried.length} carried over, ${failed.length} missing), ${tablesRead} tables read in ${Math.round((Date.now() - started) / 1000)}s, ${(fs.statSync(OUT).size / 1024).toFixed(0)} KB`
);
console.log(
  `EDGAR: ${es.requests} requests, ${es.rateLimited} rate-limit answers, ${es.retries} retries, final rate ${es.rate.toFixed(1)}/s (ceiling ${es.max}); cache ${es.cache.hits} hits / ${es.cache.misses} misses${es.cache.hitRate != null ? ` (${Math.round(es.cache.hitRate * 100)}%)` : ''}, ${es.cache.writes} written, ${es.cache.files} files ${(es.cache.bytes / 1e6).toFixed(0)} MB${es.cache.dir ? ` in ${es.cache.dir}` : ' (cache disabled)'}`
);
if (carried.length) console.warn(`carried over: ${carried.join(', ')}`);
if (failed.length) console.warn(`missing: ${failed.join(', ')}`);
