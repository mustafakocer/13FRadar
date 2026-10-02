// Company fundamentals for every stock page, from SEC XBRL (companyfacts),
// written to api/_data/fundamentals.json — the file /api/stock reads, so a
// page never asks a data vendor for them (api/_lib/secFundamentals.js has the
// arithmetic and the reasons).
//
//   node scripts/build-fundamentals.mjs
//
// Source: SEC's nightly bulk file companyfacts.zip (every filer's XBRL facts,
// ~1.3 GB) when COMPANYFACTS_ZIP points at it — one download, then only the
// filers on the site are read out of it with `unzip -p`. Without the zip each
// filer is asked for on its own (data.sec.gov/api/xbrl/companyfacts), which is
// fine for a handful (FUNDAMENTALS_TICKERS=AAPL,TSM …) and too slow for all.
//
// Env: SEC_USER_AGENT, COMPANYFACTS_ZIP, FUNDAMENTALS_TICKERS (only these),
// FUNDAMENTALS_DRY=1 (print, write nothing), FUNDAMENTALS_PRINT=N (print the
// first N top-500 records as JSON lines, for a reviewer).
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { secGet, padCik } from '../api/_lib/sec.js';
import { fetchSecTickers } from '../api/_lib/marketData.js';
import { fundamentalsOf, weeklyBeta, valuationFor } from '../api/_lib/secFundamentals.js';
import { readSeries } from '../api/_lib/priceStore.js';
import { toUsdWith } from '../api/_lib/fpiContext.js';

const root = process.cwd();
const read = (rel, fallback = null) => {
  try {
    return JSON.parse(fs.readFileSync(path.join(root, rel), 'utf8'));
  } catch {
    return fallback;
  }
};
const OUT = path.join(root, 'api', '_data', 'fundamentals.json');
const ZIP = process.env.COMPANYFACTS_ZIP || '';
const DRY = process.env.FUNDAMENTALS_DRY === '1';
const today = new Date().toISOString().slice(0, 10);

// ---- the tickers the site has pages for ----
const top500 = (read('client/public/stocks.json')?.rows || []).map((r) => r.ticker).filter(Boolean);
const only = process.env.FUNDAMENTALS_TICKERS ? process.env.FUNDAMENTALS_TICKERS.split(',').map((t) => t.trim().toUpperCase()) : null;
const wanted = new Set(only || []);
if (!only) {
  for (const t of top500) wanted.add(t);
  for (const s of read('api/_data/guru-stocks.json')?.stocks || []) if (s.ticker) wanted.add(s.ticker);
  for (const t of Object.keys(read('api/_data/ticker-meta.json', {}))) wanted.add(t);
}
const tickers = [...wanted].map((t) => String(t).toUpperCase());

// ---- ticker → CIK (SEC's own index), ADR ratios, class rules ----
const secIndex = await fetchSecTickers();
const cikOf = (t) => secIndex.get(t)?.cik || secIndex.get(t.replace('.', '-'))?.cik || secIndex.get(t.replace('-', ''))?.cik || null;
const fpi = read('api/_data/fpi.json', {});
const overrides = read('config/adr-overrides.json', {})?.byTicker || {};
const classRules = read('config/share-classes.json', {})?.byTicker || {};
const sectorOf = read('api/_data/sector-map.json', {})?.bySymbol || {};
const adrRatioOf = (t, cik) => {
  const o = overrides[t];
  if (o?.force && o.ratio > 0) return o.ratio;
  const iss = fpi.issuers?.[cik];
  if (iss?.ads && iss.ratio > 0) return iss.ratio;
  return o?.ratio > 0 ? o.ratio : null;
};
const fx = toUsdWith(fpi);
// a rate on or before the day asked; the reporting currency at today's rate
const usd = (amount, cur) => fx(amount, cur, today);

// ---- companyfacts, one filer at a time ----
const fromZip = (cik) => {
  const r = spawnSync('unzip', ['-p', ZIP, `CIK${padCik(cik)}.json`], { maxBuffer: 512 * 1024 * 1024 });
  if (r.status !== 0 || !r.stdout?.length) return null;
  try {
    return JSON.parse(r.stdout.toString('utf8'));
  } catch {
    return null;
  }
};
const fromApi = async (cik) => {
  try {
    const { data } = await secGet(`https://data.sec.gov/api/xbrl/companyfacts/CIK${padCik(cik)}.json`);
    return data;
  } catch {
    return null;
  }
};

const spy = readSeries('SPY')?.prices || [];
const byCik = new Map();
const byTicker = {};
let noCik = 0;
let noFacts = 0;
for (const t of tickers) {
  const cik = cikOf(t);
  if (!cik) {
    noCik++;
    continue;
  }
  if (!byCik.has(cik)) byCik.set(cik, ZIP ? fromZip(cik) : await fromApi(cik));
  const cf = byCik.get(cik);
  if (!cf) {
    noFacts++;
    continue;
  }
  const rec = fundamentalsOf(cf, { cik, classRule: classRules[t] || null, fx: usd, adrRatio: adrRatioOf(t, padCik(cik)), asOf: today });
  const closes = readSeries(t)?.prices || null;
  const beta = closes ? weeklyBeta(closes, spy) : null;
  if (!rec.eps && !rec.shares && !rec.div && beta == null) continue;
  byTicker[t] = { ...rec, ...(beta != null ? { beta: { value: beta, basis: '2y-weekly-spy' } } : {}) };
}

// ---- coverage over the top 500 stocks by 13F value (ETFs set apart) ----
const isFund = (t) => sectorOf[t] === 'ETF';
const stocks500 = top500.filter((t) => !isFund(t));
const missEps = stocks500.filter((t) => byTicker[t]?.eps?.value == null);
const missShares = stocks500.filter((t) => byTicker[t]?.shares?.value == null);
const missAny = stocks500.filter((t) => byTicker[t]?.eps?.value == null || byTicker[t]?.shares?.value == null);
const pct = (n) => (stocks500.length ? ((n / stocks500.length) * 100).toFixed(1) : '0');
console.log(`fundamentals: ${Object.keys(byTicker).length} tickers written of ${tickers.length} (${noCik} without a CIK in SEC's index, ${noFacts} without XBRL facts)`);
console.log(`top 500 by 13F value: ${stocks500.length} stocks (+${top500.length - stocks500.length} ETFs set apart) — EPS missing ${missEps.length} (${pct(missEps.length)}%), shares missing ${missShares.length} (${pct(missShares.length)}%), either missing ${missAny.length} (${pct(missAny.length)}%)`);
console.log(`  missing either: ${missAny.join(' ') || '—'}`);
const px = (t) => readSeries(t)?.prices?.at(-1)?.close ?? null;
const showN = Number(process.env.FUNDAMENTALS_PRINT || 0);
for (const t of [...new Set([...(only || []), ...top500.slice(0, showN)])]) {
  const r = byTicker[t];
  const v = valuationFor(r, px(t));
  console.log(`FUND ${t} ${JSON.stringify({ px: px(t), ...v, eps: r?.eps, shares: r?.shares, div: r?.div, beta: r?.beta })}`);
}
// the raw lines behind the test tickers, for a reviewer checking by hand
for (const t of only || []) {
  const cf = cikOf(t) ? byCik.get(cikOf(t)) : null;
  if (!cf) continue;
  const sh = cf.facts?.dei?.EntityCommonStockSharesOutstanding?.units?.shares || [];
  const newest = sh.reduce((m, e) => (!m || String(e.filed) > String(m.filed) ? e : m), null);
  const epsUnits = {};
  for (const ns of ['us-gaap', 'ifrs-full']) for (const n of ['EarningsPerShareDiluted', 'EarningsPerShareBasic', 'DilutedEarningsLossPerShare', 'BasicEarningsLossPerShare']) {
    const u = cf.facts?.[ns]?.[n]?.units;
    if (u) epsUnits[`${ns}:${n}`] = Object.fromEntries(Object.entries(u).map(([k, v]) => [k, v.slice(-6).map((e) => `${e.start || ''}..${e.end} ${e.val} ${e.form} ${e.fp || ''}`)]));
  }
  console.log(`RAW ${t} ${cf.entityName} shares(newest ${newest?.accn}): ${JSON.stringify(sh.filter((e) => e.accn === newest?.accn).map((e) => [e.end, e.val]))}`);
  console.log(`RAW ${t} eps: ${JSON.stringify(epsUnits)}`);
}
if (process.env.FUNDAMENTALS_SEED) {
  // one JSON line per record, for building a seed file from a job's log
  // (FUNDAMENTALS_SEED=top500: the top 500 by 13F value only)
  const seed = process.env.FUNDAMENTALS_SEED === 'top500' ? top500 : Object.keys(byTicker);
  for (const t of seed) if (byTicker[t]) console.log(`SEED ${t} ${JSON.stringify(byTicker[t])}`);
}

if (DRY) {
  console.log('dry run — nothing written');
  process.exit(0);
}
const file = { updatedAt: new Date().toISOString(), source: 'SEC EDGAR XBRL (companyfacts)', byTicker };
fs.writeFileSync(OUT, JSON.stringify(file));
console.log(`api/_data/fundamentals.json: ${(fs.statSync(OUT).size / 1024).toFixed(0)} KB`);
