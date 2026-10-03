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
import { fundamentalsOf, weeklyBeta, valuationFor, mergeFacts, EPS_CONCEPTS, NET_INCOME_CONCEPTS, WAVG_SHARE_CONCEPTS } from '../api/_lib/secFundamentals.js';
import { inlineFacts } from '../api/_lib/inlineXbrl.js';
import { getSubmissions } from '../api/_lib/sec.js';
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
const predecessors = read('config/predecessors.json', {})?.byTicker || {};
const sectorOf = read('api/_data/sector-map.json', {})?.bySymbol || {};
const adrRatioOf = (t, cik) => {
  const o = overrides[t];
  if (o?.force && o.ratio > 0) return o.ratio;
  const iss = fpi.issuers?.[cik];
  if (iss?.ads && iss.ratio > 0) return iss.ratio;
  return o?.ratio > 0 ? o.ratio : null;
};
// The reporting currency at today's rate, else the newest one within three
// weeks: the H.10-only currencies (TWD, LKR) are published weekly with a
// lag, so a 7-day window left TSM's EPS without a rate every few days.
const FUNDAMENTALS_FX_STALE_DAYS = 21;
const fx = toUsdWith(fpi, { maxStaleDays: FUNDAMENTALS_FX_STALE_DAYS });
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
const byTicker = {};
const rawLines = [];
let noCik = 0;
let noFacts = 0;
// one filer at a time — a companyfacts file is up to a few hundred MB parsed,
// and keeping them would not fit in memory — with every ticker that maps to it
const byCik = new Map();
for (const t of tickers) {
  const cik = cikOf(t);
  if (!cik) {
    noCik++;
    continue;
  }
  if (!byCik.has(cik)) byCik.set(cik, []);
  byCik.get(cik).push(t);
}
const load = async (cik) => (ZIP ? fromZip(cik) : await fromApi(cik));

// When companyfacts lacks a filer's newest EPS or share count (Berkshire's
// per-class counts, some 20-F filers' whole 2025–2026 years), the numbers are
// read out of the newest periodic report's own document (inline XBRL),
// within FUNDAMENTALS_IXBRL_BUDGET documents, for the tickers that matter:
// the top 500 by 13F value, the curated funds' holdings, the ones asked for.
const IX_FORMS = new Set(['10-K', '10-Q', '20-F', '40-F', '10-K/A', '20-F/A']);
const IX_CONCEPTS = [...EPS_CONCEPTS, ...NET_INCOME_CONCEPTS, ...WAVG_SHARE_CONCEPTS].map(([ns, n]) => `${ns}:${n}`).concat('dei:EntityCommonStockSharesOutstanding');
let ixBudget = Number(process.env.FUNDAMENTALS_IXBRL_BUDGET || 150);
const ixUsed = [];
const important = new Set([...top500, ...(read('api/_data/guru-stocks.json')?.stocks || []).map((s) => s.ticker).filter(Boolean), ...(only || [])]);
async function fromDocument(cik) {
  if (ixBudget <= 0) return null;
  ixBudget--;
  try {
    const r = (await getSubmissions(cik))?.filings?.recent;
    if (!r) return null;
    const i = r.form.findIndex((f, k) => IX_FORMS.has(f) && r.primaryDocument?.[k]);
    if (i < 0) return null;
    const accn = r.accessionNumber[i];
    const url = `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${accn.replace(/-/g, '')}/${r.primaryDocument[i]}`;
    const { data } = await secGet(url, { responseType: 'text' });
    const f = inlineFacts(String(data), IX_CONCEPTS, { form: r.form[i], filed: r.filingDate[i], accn });
    ixUsed.push(`${cik} ${r.form[i]} ${r.filingDate[i]} ${Object.values(f.facts).reduce((n, c) => n + Object.keys(c).length, 0)} concepts`);
    return f;
  } catch (e) {
    ixUsed.push(`${cik} failed: ${e.message}`);
    return null;
  }
}
for (const [cik, list] of byCik) {
  let cf = await load(cik);
  const pred = list.map((t) => predecessors[t]?.cik).find(Boolean);
  if (pred) cf = mergeFacts(cf || { facts: {} }, await load(pred));
  if (!cf) {
    noFacts += list.length;
    continue;
  }
  const recOf = (t) => fundamentalsOf(cf, { cik, classRule: classRules[t] || null, fx: usd, adrRatio: adrRatioOf(t, padCik(cik)), asOf: today });
  // the filing's own document fills what companyfacts leaves out
  if (list.some((t) => important.has(t) && (recOf(t).eps?.value == null || !recOf(t).shares))) {
    const doc = await fromDocument(cik);
    if (doc) cf = mergeFacts(doc, cf);
  }
  for (const t of list) {
    const rec = recOf(t);
    const closes = readSeries(t)?.prices || null;
    const beta = closes ? weeklyBeta(closes, spy) : null;
    if (only?.includes(t)) rawLines.push(...rawOf(t, cf));
    if (!rec.eps && !rec.shares && !rec.div && beta == null) continue;
    byTicker[t] = { ...rec, ...(beta != null ? { beta: { value: beta, basis: '2y-weekly-spy' } } : {}) };
  }
}

// the raw lines behind a test ticker, for a reviewer checking by hand: the
// cover share count, and every concept with a period ending in the last
// fifteen months whose name speaks of earnings, profit or shares
function rawOf(t, cf) {
  const out = [];
  const sh = cf.facts?.dei?.EntityCommonStockSharesOutstanding?.units?.shares || [];
  const newest = sh.reduce((m, e) => (!m || String(e.filed) > String(m.filed) ? e : m), null);
  out.push(`RAW ${t} ${cf.entityName} cover shares (${newest?.accn || '—'}): ${JSON.stringify(sh.filter((e) => e.accn === newest?.accn).map((e) => [e.end, e.val]))}`);
  const since = new Date(Date.now() - 460 * 86400000).toISOString().slice(0, 10);
  for (const [ns, concepts] of Object.entries(cf.facts || {})) {
    for (const [name, c] of Object.entries(concepts)) {
      if (!/PerShare|Profit|NetIncome|WeightedAverage|SharesOutstanding|Dividend/i.test(name)) continue;
      for (const [u, entries] of Object.entries(c.units || {})) {
        const recent = entries.filter((e) => e.end >= since).slice(-4);
        if (recent.length) out.push(`RAW ${t} ${ns}:${name} [${u}] ${recent.map((e) => `${e.start || ''}..${e.end}=${e.val} ${e.form}`).join(' | ')}`);
      }
    }
  }
  return out;
}

// ---- coverage over the top 500 stocks by 13F value (ETFs set apart) ----
// a fund (ETF) has no earnings per share: set apart by the sector map or by
// the issuer name the 13F states ("ISHARES TR", "VANGUARD INDEX FDS", …)
const issuerOf = Object.fromEntries((read('client/public/stocks.json')?.rows || []).map((r) => [r.ticker, r.issuer || '']));
const FUND_NAME = /\b(ETF|ETFS|ISHARES|VANGUARD|SPDR|SELECT SECTOR|SCHWAB STRATEGIC|EXCHANGE TRADED|INDEX FDS|INVESCO QQQ|DIMENSIONAL|FIRST TR|J P MORGAN EXCHANGE)\b/i;
const isFund = (t) => sectorOf[t] === 'ETF' || FUND_NAME.test(issuerOf[t] || '');
const stocks500 = top500.filter((t) => !isFund(t));
const missEps = stocks500.filter((t) => byTicker[t]?.eps?.value == null);
const missShares = stocks500.filter((t) => byTicker[t]?.shares?.value == null);
const missAny = stocks500.filter((t) => byTicker[t]?.eps?.value == null || byTicker[t]?.shares?.value == null);
const pct = (n) => (stocks500.length ? ((n / stocks500.length) * 100).toFixed(1) : '0');
console.log(`fundamentals: ${Object.keys(byTicker).length} tickers written of ${tickers.length} (${noCik} without a CIK in SEC's index, ${noFacts} without XBRL facts)`);
console.log(`top 500 by 13F value: ${stocks500.length} stocks (+${top500.length - stocks500.length} ETFs set apart) — EPS missing ${missEps.length} (${pct(missEps.length)}%), shares missing ${missShares.length} (${pct(missShares.length)}%), either missing ${missAny.length} (${pct(missAny.length)}%)`);
console.log(`  EPS missing: ${missEps.join(' ') || '—'}`);
console.log(`  shares missing: ${missShares.join(' ') || '—'}`);
const px = (t) => readSeries(t)?.prices?.at(-1)?.close ?? null;
const showN = Number(process.env.FUNDAMENTALS_PRINT || 0);
for (const t of [...new Set([...(only || []), ...top500.slice(0, showN)])]) {
  const r = byTicker[t];
  const v = valuationFor(r, px(t));
  console.log(`FUND ${t} ${JSON.stringify({ px: px(t), ...v, eps: r?.eps, shares: r?.shares, div: r?.div, beta: r?.beta })}`);
}
for (const l of rawLines) console.log(l);
console.log(`filing documents read (inline XBRL): ${ixUsed.length}${ixUsed.length ? ` — ${ixUsed.slice(0, 40).join(' · ')}` : ''}`);
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
