// Company names as a reader should see them. 13F and SEC names arrive as
// registry entries ("BERKSHIRE HATHAWAY INC DEL", "TAIWAN SEMICONDUCTOR
// MANUFAC"); the site shows a short, title-cased name and keeps the full
// name in `title` for anyone who hovers. The casing rules mirror
// api/_lib/companyNames.js so the server and the client print one name.

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

// Registry name → readable full name: EDGAR suffixes off, all-caps names in
// title case, a name that already carries lower case left as is.
export function prettyName(raw) {
  let s = String(raw || '').replace(/\s+/g, ' ').trim();
  if (!s) return '';
  // EDGAR's state suffixes: "CATERPILLAR INC /DE/", "XYZ CORP \NEW\"
  s = s.replace(/\s*[/\\][A-Z]{2,3}[/\\]?\s*$/i, '').replace(/\s*[/\\]NEW[/\\]?\s*$/i, '').trim();
  if (/[a-z]/.test(s)) return s;
  // bare registry tails on all-caps names: "BERKSHIRE HATHAWAY INC DEL"
  s = s.replace(/\s+(DEL|NEW)$/, '');
  return s.split(' ').map(titleWord).join(' ');
}

// trailing words the short display form drops; the full name keeps them
const TAIL_NOISE = new Set([
  'INC', 'CORP', 'CORPORATION', 'CO', 'COS', 'COMPANY', 'COMPANIES', 'LTD', 'LIMITED', 'PLC', 'LLC', 'LP', 'LLP', 'SA', 'NV', 'AG', 'SE', 'ASA', 'AB',
  'HOLDINGS', 'HOLDING', 'HLDGS', 'HLDG', 'GROUP', 'GRP', 'TRUST', 'ADR', 'ADS', 'DEL', 'NEW', 'COM',
  'MANUFACTURING', 'MANUFAC', 'MFG', 'INTL', 'INTERNATIONAL', 'ENTERPRISES', 'ENTERPRISE', 'INCORPORATED',
]);

// "BERKSHIRE HATHAWAY INC DEL" → { short: "Berkshire Hathaway",
// full: "Berkshire Hathaway Inc" }. Long names keep their first words:
// "TAIWAN SEMICONDUCTOR MANUFAC" → "Taiwan Semiconductor".
export function displayCompany(raw, { maxWords = 3 } = {}) {
  const full = prettyName(raw);
  if (!full) return { short: '', full: '' };
  let words = full.split(' ');
  const bare = (w) => w.replace(/[.,]+$/g, '').toUpperCase();
  while (words.length > 1 && (TAIL_NOISE.has(bare(words[words.length - 1])) || bare(words[words.length - 1]) === '&')) words.pop();
  if (words.length > 1 && bare(words[0]) === 'THE') words.shift();
  if (words.length > maxWords) words = words.slice(0, maxWords);
  const short = words.join(' ').replace(/[,]+$/g, '');
  return { short: short || full, full };
}

// "AMAZON COM INC" -> "Amazon Com Inc" — plain title casing, used for people
// (insider names) where the company rules above do not apply.
export const niceName = (s) =>
  String(s || '')
    .toLowerCase()
    .replace(/(^|\s)\S/g, (c) => c.toUpperCase());

const NOISE = /\b(inc|corp|corporation|co|ltd|plc|llc|lp|sa|nv|ag|holdings?|hldgs?|group|grp|trust|new|com|cl|class|[abc]|the|del|of)\b\.?/gi;

export function shortIssuer(issuer, max = 14) {
  const cleaned = niceName(String(issuer || '').replace(NOISE, ' ').replace(/\s+/g, ' ').trim());
  const base = cleaned || niceName(issuer);
  return base.length > max ? `${base.slice(0, max - 1).trimEnd()}…` : base;
}

// ticker, else the issuer, else the identifier — and whether it is a ticker
// (the caller decides whether that becomes a link).
export function securityLabel({ ticker, issuer, cusip } = {}) {
  if (ticker) return { text: ticker, isTicker: true, title: cusip || '' };
  const name = shortIssuer(issuer);
  return { text: name || cusip || '—', isTicker: false, title: [issuer, cusip].filter(Boolean).join(' · ') };
}
