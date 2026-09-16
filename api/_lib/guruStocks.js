// Per-security view of the curated funds' latest quarter, precomputed by
// scripts/build-consensus.mjs into api/_data/guru-stocks.json (daily Action).
// Nothing here touches EDGAR at request time.
//
//   {
//     updatedAt, managers: [{ name, cik, reportDate }],
//     stocks: [{
//       cusip, ticker, issuer, rank, holderCount, totalValue, totalShares,
//       avgWeight, maxWeight, buyValue, sellValue, netValue,
//       buyers, sellers, newBuyers, adders, reducers, exiters,
//       holders: [{ cik, name, weight, shares, value, change, activity }]
//     }],
//     options: [{ cusip, ticker, issuer, putCall, holderCount, totalValue, totalShares, holders }]
//   }
//
// The file is written by CI, so it can legitimately be missing on a fresh
// checkout: every reader here degrades to null rather than throwing.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
let cache;

export function guruStockTable() {
  if (cache !== undefined) return cache;
  // GURU_STOCKS_FILE points the offline tests at a fixture table.
  const override = process.env.GURU_STOCKS_FILE;
  try {
    cache = override
      ? JSON.parse(fs.readFileSync(path.resolve(override), 'utf8'))
      : require('../_data/guru-stocks.json');
    if (!Array.isArray(cache?.stocks)) cache = null;
  } catch {
    cache = null;
  }
  return cache;
}

// Test seam: the table is memoised for the life of the process.
export const resetGuruStockCache = () => {
  cache = undefined;
};

const upper = (s) => String(s || '').trim().toUpperCase();

// A security by ticker, or by CUSIP when the ticker was never resolved.
export function guruStock({ ticker, cusip } = {}) {
  const t = guruStockTable();
  if (!t) return null;
  const sym = upper(ticker);
  const cu = upper(cusip);
  return (
    t.stocks.find((s) => (cu && s.cusip === cu) || (sym && upper(s.ticker) === sym)) || null
  );
}

// PUT and CALL lines on the same security, biggest first.
export function guruOptions({ ticker, cusip } = {}) {
  const t = guruStockTable();
  if (!t) return [];
  const sym = upper(ticker);
  const cu = upper(cusip);
  return t.options.filter((o) => (cu && o.cusip === cu) || (sym && upper(o.ticker) === sym));
}

// What share of the company the curated funds hold between them. Needs the
// share count from the quote provider; without it the number is not knowable
// and the caller shows nothing rather than a wrong percentage.
export function ownedShareOfCompany(stock, sharesOutstanding) {
  if (!stock?.totalShares || !sharesOutstanding || sharesOutstanding <= 0) return null;
  return (stock.totalShares / sharesOutstanding) * 100;
}

// The funds most committed to a name by portfolio weight — a different list
// from the biggest holders by dollars, and usually the more interesting one:
// it answers "who bet the most on this", not "who is the largest fund here".
export function byConviction(stock, n = 5) {
  if (!stock?.holders?.length) return [];
  return [...stock.holders].sort((a, b) => b.weight - a.weight).slice(0, n);
}

export function byValue(stock, n = 5) {
  if (!stock?.holders?.length) return [];
  return [...stock.holders].sort((a, b) => b.value - a.value).slice(0, n);
}
