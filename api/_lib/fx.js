// Daily exchange rates for converting Form 4 prices filed in a foreign
// currency (a Mexican director reporting pesos, a Brazilian bank reais).
//
// Source: the Federal Reserve's H.10 release (noon buying rates in New
// York), served by FRED as one CSV per currency — public data, no licence,
// no key. scripts/build-fpi.mjs downloads it nightly into api/_data/fpi.json;
// this module only reads it. Every rate is stored as US dollars per ONE unit
// of the currency, whatever way round FRED quotes it.
//
// H.10 has no rate for some currencies (Israeli shekel, Argentine peso,
// Chilean peso…): a price in those stays unconverted and the page says so.

// currency → [FRED series, true when the series is USD per unit]
export const FRED_SERIES = {
  AUD: ['DEXUSAL', true],
  BRL: ['DEXBZUS', false],
  CAD: ['DEXCAUS', false],
  CHF: ['DEXSZUS', false],
  CNY: ['DEXCHUS', false],
  DKK: ['DEXDNUS', false],
  EUR: ['DEXUSEU', true],
  GBP: ['DEXUSUK', true],
  HKD: ['DEXHKUS', false],
  INR: ['DEXINUS', false],
  JPY: ['DEXJPUS', false],
  KRW: ['DEXKOUS', false],
  LKR: ['DEXSLUS', false],
  MXN: ['DEXMXUS', false],
  MYR: ['DEXMAUS', false],
  NOK: ['DEXNOUS', false],
  NZD: ['DEXUSNZ', true],
  SEK: ['DEXSDUS', false],
  SGD: ['DEXSIUS', false],
  THB: ['DEXTHUS', false],
  TWD: ['DEXTAUS', false],
  ZAR: ['DEXSFUS', false],
};
export const fredUrl = (series, from) =>
  `https://fred.stlouisfed.org/graph/fredgraph.csv?id=${series}${from ? `&cosd=${from}` : ''}`;

// FRED CSV ("observation_date,DEXMXUS\n2026-09-25,18.43\n2026-09-24,.") →
// ascending [[day, usdPerUnit]]. Holidays come as "." or empty and are dropped.
export function parseFredCsv(text, usdPerUnit) {
  const out = [];
  for (const line of String(text || '').split(/\r?\n/).slice(1)) {
    const [day, v] = line.split(',');
    const x = Number(v);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day || '') || !(x > 0)) continue;
    const rate = usdPerUnit ? x : 1 / x;
    out.push([day, Number(rate.toPrecision(6))]);
  }
  return out.sort((a, b) => (a[0] < b[0] ? -1 : 1));
}

// The Federal Reserve Board's own download of the whole H.10 release (all
// currencies, daily) — the primary source; FRED republishes the same series.
// Columns are identified like "H10/H10/RXI_N.B.MX" (units per USD) or
// "H10/H10/RXI$US_N.B.EU" (USD per unit).
export const FED_H10_URL = (from, to) =>
  `https://www.federalreserve.gov/datadownload/Output.aspx?rel=H10&series=60f32914ab61dfab590e0e470153e3ae&lastobs=&from=${from}&to=${to}&filetype=csv&label=include&layout=seriescolumn&type=package`;
const FED_CODE = {
  AL: 'AUD', BZ: 'BRL', CA: 'CAD', CH: 'CNY', DN: 'DKK', EU: 'EUR', HK: 'HKD', IN: 'INR', JA: 'JPY', KO: 'KRW', MA: 'MYR', MX: 'MXN',
  NO: 'NOK', NZ: 'NZD', SD: 'SEK', SF: 'ZAR', SI: 'SGD', SL: 'LKR', SZ: 'CHF', TA: 'TWD', TH: 'THB', UK: 'GBP',
};
export function parseFedH10Csv(text) {
  const lines = String(text || '').split(/\r?\n/).map((l) => l.split(',').map((x) => x.replace(/^"|"$/g, '').trim()));
  const idRow = lines.find((l) => /unique identifier/i.test(l[0] || ''));
  if (!idRow) return {};
  const cols = idRow.map((id) => {
    const m = /RXI(\$US)?_N\.B\.([A-Z]{2})$/.exec(id || '');
    return m && FED_CODE[m[2]] ? { cur: FED_CODE[m[2]], usdPer: Boolean(m[1]) } : null;
  });
  const out = {};
  for (const l of lines) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(l[0] || '')) continue;
    cols.forEach((c, i) => {
      const x = Number(l[i]);
      if (!c || !(x > 0)) return;
      (out[c.cur] ||= []).push([l[0], Number((c.usdPer ? x : 1 / x).toPrecision(6))]);
    });
  }
  for (const k of Object.keys(out)) out[k].sort((a, b) => (a[0] < b[0] ? -1 : 1));
  return out;
}

// European Central Bank reference rates (via the public Frankfurter API) —
// only for the currencies H.10 does not publish (Israeli shekel, Philippine
// peso…) or when the Federal Reserve cannot be reached. Units per USD.
export const ECB_URL = (from, to, symbols) => `https://api.frankfurter.app/${from}..${to}?from=USD&to=${symbols.join(',')}`;
export function parseEcb(json) {
  const out = {};
  for (const [day, row] of Object.entries(json?.rates || {}))
    for (const [cur, x] of Object.entries(row || {})) if (x > 0) (out[cur] ||= []).push([day, Number((1 / x).toPrecision(6))]);
  for (const k of Object.keys(out)) out[k].sort((a, b) => (a[0] < b[0] ? -1 : 1));
  return out;
}
export const ECB_EXTRA = ['ILS', 'PHP', 'IDR', 'TRY', 'PLN', 'CZK', 'HUF', 'ISK', 'RON'];

// Pence sterling: London prices are often quoted in GBp (1/100 GBP).
const SUB_UNITS = { GBX: ['GBP', 0.01], ZAC: ['ZAR', 0.01], ILA: ['ILS', 0.01] };

// USD per unit of `cur` on `day`: that day's rate, else the last published
// one within MAX_STALE_DAYS before it (weekends, US holidays). null when the
// currency has no series or there is no rate close enough.
export const MAX_STALE_DAYS = 7;
export function usdPerUnit(cur, day, rates) {
  if (!cur || !day) return null;
  if (cur === 'USD') return 1;
  if (SUB_UNITS[cur]) {
    const [base, k] = SUB_UNITS[cur];
    const r = usdPerUnit(base, day, rates);
    return r == null ? null : r * k;
  }
  const s = rates?.[cur];
  if (!s?.length) return null;
  let lo = 0;
  let hi = s.length - 1;
  let hit = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (s[mid][0] <= day) {
      hit = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  if (hit < 0) return null;
  const gap = (Date.parse(day) - Date.parse(s[hit][0])) / 86400000;
  return gap <= MAX_STALE_DAYS ? s[hit][1] : null;
}

// Which currency a footnote or security title names. Order matters: the
// Argentine peso before the Mexican one, pence before pounds.
const CURRENCY_WORDS = [
  ['ARS', /argentin\w* pesos?|\bars\b/i],
  ['CLP', /chilean pesos?|\bclp\b/i],
  ['COP', /colombian pesos?|\bcop\b/i],
  ['PHP', /philippine pesos?|\bphp\b/i],
  ['MXN', /mexican pesos?|\bmxn\b|pesos? mexicanos|\bm\.n\.|\bpesos?\b/i],
  ['BRL', /\breais\b|brazilian reals?\b|\bbrl\b|r\$/i],
  ['TWD', /new taiwan dollars?|\bnt\$|\bntd\b|\btwd\b/i],
  ['HKD', /hong kong dollars?|\bhk\$|\bhkd\b/i],
  ['CNY', /\brmb\b|renminbi|\bcny\b|\byuan\b/i],
  ['JPY', /\byen\b|\bjpy\b|¥/i],
  ['KRW', /korean won|\bkrw\b/i],
  ['INR', /indian rupees?|\brupees?\b|\binr\b/i],
  ['SGD', /singapore dollars?|\bsgd\b|\bs\$/i],
  ['GBX', /\bpence\b|\bgbp?x\b|\bgbp\s?p\b/i],
  ['GBP', /pounds? sterling|british pounds?|\bgbp\b|£/i],
  ['EUR', /\beuros?\b|\beur\b|€/i],
  ['CHF', /swiss francs?|\bchf\b/i],
  ['SEK', /swedish kron\w*|\bsek\b/i],
  ['NOK', /norwegian kron\w*|\bnok\b/i],
  ['DKK', /danish kron\w*|\bdkk\b/i],
  ['CAD', /canadian dollars?|\bcad\b|\bc\$|\bcdn\$?/i],
  ['AUD', /australian dollars?|\baud\b|\ba\$/i],
  ['NZD', /new zealand dollars?|\bnzd\b/i],
  ['ZAR', /south african rand|\bzar\b/i],
  ['ILS', /shekels?|\bnis\b|\bils\b/i],
  ['THB', /\bbaht\b|\bthb\b/i],
  ['MYR', /ringgit|\bmyr\b/i],
];
const USD_RE = /\bu\.?s\.? ?dollars?\b|\bus\$|\busd\b|united states dollars?/i;

// → 'MXN' | 'USD' | … | null. A note that names both (a price "in Mexican
// pesos, approximately US$0.93") is read as the foreign one: the dollar
// figure there is a translation, the reported price is the local one.
// A note that says the price was CONVERTED into dollars ("The price was
// translated from New Taiwan dollars, NT$1,795, at the rate of NT$32.092 to
// US$1" — TSMC; "converted from Argentine pesos to U.S. dollars" — Galicia;
// "converted from Canadian price of C$2.41 per share using an exchange rate
// of C$1.4 = US$1.00" — Aptose) reports a dollar price: the foreign currency
// there is where it came from.
const CONVERTED_TO_USD_RE =
  /(translated|converted|conversion)\b(?:[^.]|\.\d){0,160}?\b(in)?to\s+(u\.?s\.?\s?dollars?|us\$|usd|united states dollars?)|\bat (the|an) (exchange )?rate of (?:[^.]|\.\d){0,40}?\bto (us\$|u\.?s\.?\s?\$?)\s?1\b|(price|prices|amount)s? (is |are |has been |have been )?(reported |presented |stated )?in u\.?s\.? dollars|\brate of (?:[^.]|\.\d){0,40}?=\s?(us\$|u\.?s\.?\s?\$)\s?1(?:\.0+)?\b/i;
export function currencyOf(text) {
  if (!text) return null;
  const s = String(text);
  if (CONVERTED_TO_USD_RE.test(s)) return 'USD';
  for (const [cur, re] of CURRENCY_WORDS) if (re.test(s)) return cur;
  return USD_RE.test(s) ? 'USD' : null;
}
