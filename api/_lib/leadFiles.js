import { guruStockTable } from './guruStocks.js';
import { readServed } from './insiderStore.js';
import { companyName } from './companyNames.js';

// The two Excel lead magnets, as CSV (Excel opens it; the handler adds the
// UTF-8 BOM). Both are built from files the site already ships, at request
// time, so they are as fresh as the last nightly build.

const cell = (v) => {
  const s = v == null ? '' : String(v);
  return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
export const toCsv = (cols, rows) => [cols.map((c) => cell(c.h)).join(','), ...rows.map((r, i) => cols.map((c) => cell(c.v(r, i))).join(','))].join('\n');

// The 50 stocks the most tracked superinvestors hold (the consensus rank).
export function consensusCsv(table = guruStockTable()) {
  const stocks = [...(table?.stocks || [])].filter((s) => s.rank).sort((a, b) => a.rank - b.rank).slice(0, 50);
  const csv = toCsv(
    [
      { h: 'Rank', v: (s) => s.rank },
      { h: 'Ticker', v: (s) => s.ticker || '' },
      { h: 'Company', v: (s) => s.coName || s.issuer },
      { h: 'Sector', v: (s) => s.sector || '' },
      { h: 'Superinvestors holding', v: (s) => s.holderCount },
      { h: 'Combined value USD', v: (s) => Math.round(s.totalValue || 0) },
      { h: 'Average portfolio %', v: (s) => s.avgWeight },
      { h: 'Max portfolio %', v: (s) => s.maxWeight },
      { h: 'Bought this quarter', v: (s) => s.buyers },
      { h: 'Sold this quarter', v: (s) => s.sellers },
      { h: 'New positions', v: (s) => s.newBuyers },
      { h: 'Top holders', v: (s) => (s.holders || []).slice(0, 5).map((h) => h.name).join('; ') },
    ],
    stocks
  );
  return { name: `fundocap-superinvestor-top50-${table?.quarter || 'latest'}.csv`, csv, rows: stocks.length };
}

const ROLE = { ceo: 'CEO', cfo: 'CFO', coo: 'COO', president: 'President', director: 'Director', officer: 'Officer', owner10: '10% owner', other: 'Other' };

// Open-market purchases (code P) filed in the last 30 days, largest first.
export function insiderBuysCsv(rows = readServed().rows, now = new Date()) {
  const since = new Date(now.getTime() - 30 * 86400 * 1000).toISOString().slice(0, 10);
  const buys = rows
    .filter((r) => r.k === 'P' && r.f >= since && r.v > 0)
    .sort((a, b) => b.v - a.v)
    .slice(0, 500);
  const csv = toCsv(
    [
      { h: 'Filed', v: (r) => r.f },
      { h: 'Trade date', v: (r) => r.d },
      { h: 'Ticker', v: (r) => r.t },
      // no ticker match (and no stored issuer name): the issuer's SEC CIK,
      // so the row still says whose stock it is
      { h: 'Company', v: (r) => companyName(r.t)?.name || (r.ci ? `CIK ${Number(r.ci)}` : '') },
      { h: 'Insider', v: (r) => r.n },
      { h: 'Role', v: (r) => r.ti || ROLE[r.r] || r.r || '' },
      { h: 'Shares', v: (r) => r.s },
      { h: 'Price USD', v: (r) => r.p },
      { h: 'Value USD', v: (r) => Math.round(r.v) },
      { h: 'Ownership change %', v: (r) => (r.oc == null ? '' : r.oc) },
      { h: 'SEC filing', v: (r) => (r.a && r.ci ? `https://www.sec.gov/Archives/edgar/data/${Number(r.ci)}/${r.a.replace(/-/g, '')}/` : '') },
    ],
    buys
  );
  return { name: `fundocap-insider-buys-30d-${now.toISOString().slice(0, 10)}.csv`, csv, rows: buys.length };
}
