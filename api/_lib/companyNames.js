// The company name a stock page shows beside its ticker.
//
// The live quote comes from Finnhub first (api/_handlers/stock.js), and its
// /quote answer carries no name: shapeFinnhub fills the symbol in, and every
// stock page read "AAPL (AAPL)" from 2026-10-03 on. The name is identity,
// not a quote, so it comes from files the nightly builds commit:
//   1. SEC's company_tickers.json (api/_data/company-names.json, written by
//      scripts/build-company-names.mjs), the issuer's registered name;
//   2. the 13F issuer name (ticker-meta.json, then guru-stocks.json) for a
//      symbol SEC's list does not carry (most foreign listings, funds).
// SEC and 13F names are often upper case ("COCA COLA CO"); displayName()
// sets those in title case and leaves a name with lower-case letters as is.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const load = (rel, override) => {
  try {
    if (override) return JSON.parse(fs.readFileSync(path.resolve(override), 'utf8'));
    return require(rel);
  } catch {
    return null;
  }
};

// words that stay upper case: legal forms, roman numerals, common acronyms
const KEEP_UPPER = new Set([
  'AB', 'ADR', 'ADS', 'AG', 'AS', 'ASA', 'BV', 'ETF', 'ETN', 'II', 'III', 'IV', 'IX', 'KGAA', 'LLC', 'LP', 'LLP', 'NA', 'NV', 'PLC',
  'REIT', 'SA', 'SAB', 'SE', 'SPA', 'SPDR', 'UK', 'US', 'USA', 'VI', 'VII', 'VIII', 'XL',
]);
// abbreviations with vowels removed that read as words in title case
const TITLE_ABBR = new Set(['LTD', 'CORP', 'CO', 'INC', 'HLDGS', 'HLDG', 'GRP', 'INTL', 'TR', 'MFG', 'BK', 'BANCORP', 'FINL', 'SVCS', 'TECH', 'PPTYS', 'CL', 'CTR', 'DEV', 'NATL']);

function titleWord(w) {
  const bare = w.replace(/[^A-Z0-9&]/g, '');
  if (!bare) return w;
  if (/\d/.test(bare) || KEEP_UPPER.has(bare)) return w;
  // vowel-less short words are tickers or initials (CVS, PNC, TJX, JPM), but
  // the usual abbreviations (LTD, CORP) read as words
  if (!TITLE_ABBR.has(bare) && bare.length <= 4 && !/[AEIOUY]/.test(bare)) return w;
  // each part of a hyphenated or slashed word: COCA-COLA → Coca-Cola
  return w.toLowerCase().replace(/(^|[-/'.(])([a-z])/g, (_, p, c) => p + c.toUpperCase());
}

export function displayName(raw) {
  let s = String(raw || '').replace(/\s+/g, ' ').trim();
  if (!s) return null;
  // EDGAR's state suffixes: "CATERPILLAR INC /DE/", "XYZ CORP \NEW\"
  s = s.replace(/\s*[/\\][A-Z]{2,3}[/\\]?\s*$/i, '').replace(/\s*[/\\]NEW[/\\]?\s*$/i, '').trim();
  if (/[a-z]/.test(s)) return s;
  return s.split(' ').map(titleWord).join(' ');
}

let sec;
let meta;
let guru;
const secNames = () => (sec === undefined ? (sec = load('../_data/company-names.json', process.env.COMPANY_NAMES_FILE)?.names || {}) : sec);
const metaNames = () => (meta === undefined ? (meta = load('../_data/ticker-meta.json', process.env.TICKER_META_FILE) || {}) : meta);
const guruNames = () => {
  if (guru !== undefined) return guru;
  guru = {};
  const gs = load('../_data/guru-stocks.json', process.env.GURU_STOCKS_FILE);
  for (const s of gs?.stocks || []) if (s.ticker && s.issuer && !guru[s.ticker]) guru[s.ticker] = s.issuer;
  return guru;
};

// BRK-B (SEC, the URL) and BRK.B (13F tables, ticker-meta) are one symbol
const variants = (t) => [...new Set([t, t.replace(/\./g, '-'), t.replace(/-/g, '.')])];

// → { name, source: 'sec' | '13f' } or null
export function companyName(ticker) {
  const sym = String(ticker || '').trim().toUpperCase();
  if (!sym) return null;
  const pick = (table, source) => {
    for (const v of variants(sym)) {
      const n = table[v];
      const raw = typeof n === 'string' ? n : n?.name;
      if (raw && raw.toUpperCase() !== v) return { name: displayName(raw), source };
    }
    return null;
  };
  return pick(secNames(), 'sec') || pick(metaNames(), '13f') || pick(guruNames(), '13f');
}

// The stock payload with the name from the files, whichever provider (or
// snapshot) answered: one name per symbol on every path. A symbol the files
// do not know keeps the provider's name when it is more than the symbol.
export function withCompanyName(data, ticker) {
  if (!data || typeof data !== 'object' || !data.price || typeof data.price !== 'object') return data;
  const sym = String(data.price.symbol || ticker || '').toUpperCase();
  const found = companyName(sym);
  if (found) return { ...data, price: { ...data.price, name: found.name } };
  const current = data.price.name;
  if (current && String(current).toUpperCase() !== sym) return { ...data, price: { ...data.price, name: displayName(current) } };
  return data;
}

// Test seam: the tables are memoised for the life of the process.
export function resetCompanyNames() {
  sec = undefined;
  meta = undefined;
  guru = undefined;
}

// SEC's company_tickers.json ({"0": {cik_str, ticker, title}, …}) as
// { TICKER: title }; the first title seen for a ticker wins.
export function namesFromCompanyTickers(data) {
  const names = {};
  for (const row of Object.values(data || {})) {
    const t = String(row?.ticker || '').trim().toUpperCase();
    const title = String(row?.title || '').trim();
    if (t && title && !names[t]) names[t] = title;
  }
  return names;
}
