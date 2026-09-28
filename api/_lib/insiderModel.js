// Shared shape + classification for SEC Form 4 (insider) transactions.
//
// Rows are stored with short keys because the dataset holds a year of
// transactions and ships inside the serverless bundle:
//   t ticker · c company · ci issuer CIK · n insider · r role · ti title
//   d transaction date · f filing date · k transaction code
//   s shares · p price · v value · o shares owned after · oc ownership change %
//   a accession
import { categorize } from './insiderClassify.js';

export const ROLES = ['ceo', 'cfo', 'officer', 'director', 'owner10'];

// SEC Form 4 transaction codes and how they are classified:
//   High conviction — P open-market buy · C conversion · M/X option exercise
//                      when nothing was sold in the same filing (exercise-and-hold)
//   Liquidity       — S open-market sale · D disposition to the issuer / tender
//                      · M/X exercise with a same-filing sale (cash-out)
//   Noise           — A grant/award · F tax withholding · G gift · W will/
//                      inheritance · J other · I discretionary · L small
// The feed hides Noise unless asked; rows carry `cl` (class) and `p5`
// (Rule 10b5-1 planned trade) from the build script.
export const CODES = { P: 'buy', S: 'sell', A: 'award', M: 'exercise', X: 'exercise', C: 'conversion', D: 'disposition', F: 'tax', G: 'gift', W: 'will', J: 'other', I: 'discretionary', L: 'small' };
export const KEPT_CODES = new Set(Object.keys(CODES));
export const CLASSES = ['conviction', 'liquidity', 'noise'];

export function classifyTransaction(code, { sameFilingSale = false } = {}) {
  switch (String(code || '').toUpperCase()) {
    case 'P':
    case 'C':
      return 'conviction';
    case 'M':
    case 'X':
      return sameFilingSale ? 'liquidity' : 'conviction';
    case 'S':
    case 'D':
      return 'liquidity';
    default:
      return 'noise';
  }
}
export const rowClass = (r) => r.cl || classifyTransaction(r.k);

const CEO_RE = /\b(chief executive|ceo|president and chief executive|pres(ident)? & ceo)\b/i;
const CFO_RE = /\b(chief financial|cfo|principal financial officer|treasurer)\b/i;

// Officer title strings are free text on Form 4; classify them once at build
// time so the API can filter on a stable value.
export function classifyRole({ title = '', isDirector, isOfficer, isTenPercentOwner }) {
  const t = String(title || '');
  if (CEO_RE.test(t)) return 'ceo';
  if (CFO_RE.test(t)) return 'cfo';
  if (isOfficer) return 'officer';
  if (isDirector) return 'director';
  if (isTenPercentOwner) return 'owner10';
  return 'officer';
}

export const isBuy = (r) => r.k === 'P';
export const isSell = (r) => r.k === 'S';

// Business days between the transaction and the filing. The SEC deadline is
// 2 business days; anything later is a "late filing".
// A transaction cannot postdate the filing that reports it. The dataset
// carried a row dated a year after its filing — the filer's typo — and the
// feed showed it as an upcoming trade. Rows failing this are dropped at
// build time and the audit counts any that get through.
export const plausibleDates = (transDate, filedDate) =>
  Boolean(transDate && filedDate && String(transDate) <= String(filedDate));

export function filingLagDays(transDate, filedDate) {
  if (!transDate || !filedDate) return null;
  const a = new Date(`${transDate}T00:00:00Z`);
  const b = new Date(`${filedDate}T00:00:00Z`);
  const days = Math.round((b - a) / 86400000);
  return days >= 0 && days < 400 ? days : null;
}

export function businessDaysBetween(transDate, filedDate) {
  const a = new Date(`${transDate}T00:00:00Z`);
  const b = new Date(`${filedDate}T00:00:00Z`);
  if (!(a <= b)) return null;
  let n = 0;
  const cur = new Date(a);
  while (cur < b) {
    cur.setUTCDate(cur.getUTCDate() + 1);
    const d = cur.getUTCDay();
    if (d !== 0 && d !== 6) n++;
  }
  return n;
}

export const isLate = (r) => {
  const bd = businessDaysBetween(r.d, r.f);
  return bd != null && bd > 2;
};

// Market-cap buckets, matching the labels used across the app.
export function sizeBucket(marketCap) {
  if (!Number.isFinite(marketCap) || marketCap <= 0) return null;
  if (marketCap >= 200e9) return 'mega';
  if (marketCap >= 10e9) return 'large';
  if (marketCap >= 2e9) return 'mid';
  if (marketCap >= 300e6) return 'small';
  return 'micro';
}

// Cluster buys live in insiderCluster.js — the one definition every page uses.

// How tightly a cluster is packed. Two insiders buying on the same morning is
// a different event from two buying eleven days apart, and the dollar total
// cannot tell them apart. Measured on transaction dates, not filing dates:
// filings trail trades by up to two business days and would smear the window.
export const CLUSTER_DENSITY = ['blitz', 'tight', 'standard', 'extended'];

export function clusterSpanDays(cluster) {
  if (!cluster?.from || !cluster?.to) return null;
  const a = new Date(`${cluster.from}T00:00:00Z`).getTime();
  const b = new Date(`${cluster.to}T00:00:00Z`).getTime();
  if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return null;
  return Math.round((b - a) / 86400000);
}

export function clusterDensity(cluster) {
  const span = clusterSpanDays(cluster);
  if (span == null) return null;
  if (span <= 1) return 'blitz';
  if (span <= 3) return 'tight';
  if (span <= 7) return 'standard';
  return 'extended';
}

// Does a ticker's cluster satisfy the size and packing the reader asked for?
// With neither asked for, every row passes — including rows with no cluster
// at all, which is why the caller cannot simply test the cluster for null.
export function clusterMatches(cluster, { min = 0, density = '' } = {}) {
  if (!min && !density) return true;
  if (!cluster) return false;
  if (min && !(cluster.insiders >= min)) return false;
  if (density && clusterDensity(cluster) !== density) return false;
  return true;
}

// Share of a ticker's past open-market insider buys that are in the green at
// the current price. It is a hit rate over a handful of trades, not a
// forecast: reported alongside the sample size so a 100% built on one buy
// reads as what it is. Rows priced at zero are skipped rather than counted
// as wins.
export function winRate(rows, currentPrice) {
  if (!Number.isFinite(currentPrice) || currentPrice <= 0) return null;
  let n = 0;
  let wins = 0;
  for (const r of rows) {
    if (!isBuy(r) || !(r.p > 0)) continue;
    n++;
    if (currentPrice > r.p) wins++;
  }
  return n ? { n, wins, rate: Number(((wins / n) * 100).toFixed(1)) } : null;
}

// ------------------------------------------------------------------ symbols
// EDGAR's issuerTradingSymbol is free text a filer types, so it arrives as
// "OMEX", [ENTX], (SIRI), NYSE:XYF, NONE, or the issuer's CIK. Anything that
// is not a symbol a reader can click through to is better stored as null than
// rendered as a dead ticker.
const SYMBOL_RE = /^[A-Z][A-Z.\-]{0,6}$/;
const NOT_A_SYMBOL = new Set(['NONE', 'N/A', 'NA', 'NULL', 'NOTAPPLICABLE', 'NOTLISTED', 'PRIVATE', 'NIL']);
export function cleanSymbol(raw) {
  let v = String(raw ?? '').trim().toUpperCase();
  if (v.includes(':')) v = v.slice(v.lastIndexOf(':') + 1); // NYSE:XYF, NASDAQ: AAPL
  v = v.replace(/[^A-Z0-9.\-]/g, ''); // quotes, brackets, parentheses, spaces
  v = v.replace(/^[.\-]+|[.\-]+$/g, '');
  if (!v || NOT_A_SYMBOL.has(v)) return null;
  if (!SYMBOL_RE.test(v)) return null; // all-digit CIKs and long prose both fail here
  return v;
}

// ---------------------------------------------------------------- day summary
// The one definition of the headline numbers. The home page ("Insider
// Duyarlılığı") and /insiders both print these, and they used to compute them
// separately — 62 buys / $21.6M on one, 63 / $31.3M on the other for the same
// day, because one dropped rows without a ticker and the other did not.
//
//   rows       current rows only (superseded 4/A originals already removed —
//              see insiderStore.currentRows) with a listed ticker; a row with
//              no ticker is nothing a reader can click through to or buy
//   day        the newest FILING date among those rows (not the trade date)
//   buyCount   open-market purchase lines filed that day (insiderClassify:
//              code P, not a derivative, price > 0); one Form 4 with three
//              such lines counts three
//   buyValue   sum of shares × price over those lines, in dollars
//   sellCount  open-market sale lines filed that day (S, price > 0)
//   sellValue  sum of shares × price over those lines
//   sellShare  sellValue / (buyValue + sellValue) × 100, null when both are 0
//   companies  distinct tickers with any line filed that day, any code
// `scope` narrows the rows first (the penny tab passes its price test).
export const isListed = (r) => Boolean(r?.t && r.t !== 'NONE' && r?.d);
export function daySummary(all, scope = null) {
  const rows = all.filter((r) => isListed(r) && !r.sb && (!scope || scope(r)));
  const day = rows.reduce((m, r) => (r.f > m ? r.f : m), '');
  const today = rows.filter((r) => r.f === day);
  // lines of a foreign issuer whose currency could not be verified have no
  // dollar amount (fpiNormalize.js): out of the counts and totals, counted
  // separately so the page can say so
  // …and a line whose dollar price is off the market (a placement: amount
  // shown on its row, never in the day's open-market totals)
  const fxOut = (r) => Boolean(r.fx?.fail) || r.fx?.off != null;
  const open = today.filter((r) => ['open_buy', 'open_sell'].includes(categorize(r)));
  const buys = open.filter((r) => !fxOut(r) && categorize(r) === 'open_buy');
  const sells = open.filter((r) => !fxOut(r) && categorize(r) === 'open_sell');
  const fxExcluded = open.filter((r) => r.fx?.fail).length;
  const offMarket = open.filter((r) => r.fx?.off != null).length;
  const sum = (list) => list.reduce((s, r) => s + (r.v || 0), 0);
  const buyValue = Math.round(sum(buys));
  const sellValue = Math.round(sum(sells));
  return {
    day: day || null,
    rows: today,
    buys,
    sells,
    companies: new Set(today.map((r) => r.t)).size,
    buyCount: buys.length,
    sellCount: sells.length,
    buyValue,
    sellValue,
    sellShare: buyValue + sellValue > 0 ? Number(((sellValue / (buyValue + sellValue)) * 100).toFixed(1)) : null,
    fxExcluded,
    offMarket,
  };
}
