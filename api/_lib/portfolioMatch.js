import { guruStockTable } from './guruStocks.js';
import { filerPath } from './slugs.js';

// "Which superinvestors is my portfolio most like?" A reader types up to 25
// tickers; each tracked guru in the latest consensus quarter is scored on two
// plain numbers, both shown on the page:
//   coverage    the share of the reader's tickers the guru also holds
//   guruWeight  the share of the guru's own book that sits in those tickers
// score = 0.6 × coverage + 0.4 × guruWeight (both 0–1), so a guru who holds
// many of your names ranks first and one whose book is mostly your names
// breaks the tie. Positions under 0.1% of a guru's book do not count. Pure apart from the table it reads.

export const MAX_TICKERS = 25;
export const FREE_MATCHES = 3;
// a position under this share of a guru's book is a rounding error, not conviction
const MIN_WEIGHT = 0.1;
const FULL_MATCHES = 30;

// BRK.B / BRK-B / brk b → BRK.B
export function cleanTickers(raw) {
  const list = (Array.isArray(raw) ? raw : String(raw || '').split(/[\s,;]+/))
    .map((t) => String(t).trim().toUpperCase().replace(/-/g, '.'))
    .filter((t) => /^[A-Z][A-Z0-9.]{0,9}$/.test(t));
  return [...new Set(list)].slice(0, MAX_TICKERS);
}

export function matchPortfolio(rawTickers, { full = false, table = guruStockTable(), pathOf = filerPath } = {}) {
  const tickers = cleanTickers(rawTickers);
  if (!tickers.length) return { quarter: table?.quarter || null, tickers: [], matches: [], total: 0, full };
  const stocks = table?.stocks || [];
  const byTicker = new Map();
  for (const s of stocks) if (s.ticker) byTicker.set(s.ticker.toUpperCase().replace(/-/g, '.'), s);

  const gurus = new Map();
  const guru = (h) => {
    if (!gurus.has(h.cik)) gurus.set(h.cik, { cik: h.cik, name: h.name, shared: [], guruWeight: 0 });
    return gurus.get(h.cik);
  };
  const known = [];
  for (const t of tickers) {
    const s = byTicker.get(t);
    known.push({ ticker: t, company: s ? s.coName || s.issuer : null, holders: s ? s.holderCount : 0 });
    if (!s) continue;
    for (const h of s.holders || []) {
      if (!(h.weight >= MIN_WEIGHT)) continue;
      const g = guru(h);
      g.shared.push({ ticker: t, weight: h.weight });
      g.guruWeight += h.weight || 0;
    }
  }

  const ranked = [...gurus.values()]
    .map((g) => {
      const coverage = g.shared.length / tickers.length;
      const weight = Math.min(g.guruWeight, 100) / 100;
      return {
        cik: g.cik,
        name: g.name,
        path: pathOf(g.cik),
        shared: g.shared.sort((a, b) => b.weight - a.weight),
        coverage: Math.round(coverage * 1000) / 10,
        guruWeight: Math.round(Math.min(g.guruWeight, 100) * 10) / 10,
        score: Math.round((0.6 * coverage + 0.4 * weight) * 100),
      };
    })
    .sort((a, b) => b.score - a.score || b.shared.length - a.shared.length || b.guruWeight - a.guruWeight);

  return {
    quarter: table?.quarter || null,
    tickers: known,
    total: ranked.length,
    full,
    matches: ranked.slice(0, full ? FULL_MATCHES : FREE_MATCHES),
  };
}
