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

// small words that stay lower case inside a name: "Bank of America"
const SMALL = new Set(['OF', 'AND', 'THE', 'DE', 'DEL', 'LA', 'DA', 'DI', 'Y', 'EN', 'FOR']);
// registry abbreviations spelled out
const ABBR = { FINL: 'Financial', PETE: 'Petroleum', PHARMS: 'Pharmaceuticals', SVCS: 'Services', MTRS: 'Motors', HLTH: 'Health', INDS: 'Industries', ELEC: 'Electric', AMER: 'American' };
// brands whose spelling the registry flattens; matched on the all-caps name's start
const BRAND = [
  ['COCA COLA', 'Coca-Cola'], ['BANK OF AMER', 'Bank of America'], ['JPMORGAN CHASE', 'JPMorgan Chase'], ['MCDONALDS', "McDonald's"],
  ['PEPSICO', 'PepsiCo'], ['EBAY', 'eBay'], ['UNITEDHEALTH', 'UnitedHealth'], ['NVIDIA', 'NVIDIA'], ['AMAZON COM', 'Amazon'],
  ['ABBVIE', 'AbbVie'], ['PAYPAL', 'PayPal'], ['SERVICENOW', 'ServiceNow'], ['GAMESTOP', 'GameStop'], ['DOORDASH', 'DoorDash'],
  ['LOWES', "Lowe's"], ['KOHLS', "Kohl's"], ['MACYS', "Macy's"], ['MASTERCARD', 'Mastercard'], ['LULULEMON', 'Lululemon'],
  ['BLACKROCK', 'BlackRock'], ['BIONTECH', 'BioNTech'], ['GLAXOSMITHKLINE', 'GlaxoSmithKline'], ['ASTRAZENECA', 'AstraZeneca'],
  ['EXXON MOBIL', 'Exxon Mobil'], ['INTL BUSINESS MACHINES', 'IBM'], ['WALMART', 'Walmart'], ['SALESFORCE', 'Salesforce'], ['ALIBABA GROUP', 'Alibaba'], ['LINDE', 'Linde'], ['O REILLY AUTOMOTIVE', "O'Reilly Automotive"],
];
// "FULLER H B CO" → "H.B. Fuller Co": one or two single letters after the
// surname are initials that belong in front
function initialsFirst(words) {
  const isInitial = (w) => /^[A-Z]$/.test(w);
  // already in front: "D R HORTON INC" → "D.R. Horton Inc"
  if (isInitial(words[0]) && isInitial(words[1] || '') && words[2] && !isInitial(words[2])) return [`${words[0]}.${words[1]}.`, ...words.slice(2)];
  if (words.length < 2 || !isInitial(words[1])) return words;
  const n = isInitial(words[2] || '') ? 2 : 1;
  const rest = words.slice(1 + n);
  if (rest.length && !TAIL_NOISE.has(rest[0])) return words;
  return [`${words.slice(1, 1 + n).join('.')}.`, words[0], ...rest];
}
function capsToTitle(s) {
  const brand = BRAND.find(([k]) => s === k || s.startsWith(`${k} `));
  let words = (brand ? s.slice(brand[0].length).trim() : s).split(' ').filter(Boolean);
  words = initialsFirst(words).map((w, i) => {
    const bare = w.replace(/[^A-Z0-9&]/g, '');
    if (ABBR[bare]) return ABBR[bare];
    if (i > 0 && SMALL.has(bare)) return w.toLowerCase();
    return /^[A-Z]\.([A-Z]\.)*$/.test(w) ? w : titleWord(w);
  });
  return [brand ? brand[1] : null, ...words].filter(Boolean).join(' ');
}

// Registry name → readable full name: EDGAR suffixes off, all-caps names in
// title case, a name that already carries lower case left as is.
export function prettyName(raw) {
  let s = String(raw || '').replace(/\s+/g, ' ').trim();
  if (!s) return '';
  // EDGAR's state suffixes: "CATERPILLAR INC /DE/", "XYZ CORP \NEW\"
  s = s.replace(/\s*[/\\][A-Z]{2,3}[/\\]?\s*$/i, '').replace(/\s*[/\\]NEW[/\\]?\s*$/i, '').trim();
  const upper = (s.match(/[A-Z]/g) || []).length;
  const lower = (s.match(/[a-z]/g) || []).length;
  // a name that already carries real lower case is left as it is; a mostly
  // upper-case one ("ELI LILLY & Co") is a registry name
  if (lower > 0 && lower * 2 >= upper) return s;
  s = s.toUpperCase();
  // bare registry tails on all-caps names: "BERKSHIRE HATHAWAY INC DEL"
  s = s.replace(/\s+(DEL|NEW)$/, '');
  return capsToTitle(s);
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

// Form 4 names arrive surname first ("COHEN RYAN", "MURDOCH LACHLAN K",
// "O'BRIEN DEIRDRE"); readers expect "Ryan Cohen". A single middle initial
// gets its period; generational suffixes stay at the end.
const SUFFIX = new Set(['JR', 'SR', 'II', 'III', 'IV', 'MD', 'PHD', 'ESQ', 'CPA']);
const capWord = (w) =>
  w
    .toLowerCase()
    .replace(/(^|[-'’])([a-z])/g, (_, p, c) => p + c.toUpperCase())
    .replace(/^Mc([a-z])/, (_, c) => `Mc${c.toUpperCase()}`);
export function personName(raw) {
  let s = String(raw || '').replace(/\s+/g, ' ').trim();
  if (!s) return '';
  if (s.includes(',')) {
    const [last, first] = s.split(',').map((x) => x.trim());
    s = `${last} ${first || ''}`.trim();
  }
  const words = s.split(' ');
  if (words.length < 2) return capWord(s);
  const suffix = [];
  while (words.length > 2 && SUFFIX.has(words[words.length - 1].replace(/\./g, '').toUpperCase())) suffix.unshift(words.pop());
  const [last, ...given] = words;
  const parts = given.map((w) => (/^[A-Za-z]$/.test(w) ? `${w.toUpperCase()}.` : capWord(w)));
  return [...parts, capWord(last), ...suffix.map((x) => capWord(x.replace(/\./g, '')) + (x.length <= 3 ? '.' : ''))].join(' ').replace(/\bIi\b/g, 'II').replace(/\bIii\b/g, 'III');
}
