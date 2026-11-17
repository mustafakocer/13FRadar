// Second-line resolution for identifiers OpenFIGI could not map, from the
// SEC's own files — so the security master's `unresolved` list holds only
// what nobody has looked at yet, not what was looked at and has no ticker.
//
// Sources (all www.sec.gov, the same host every build already reads):
//   · the Official List of Section 13(f) Securities (13flistYYYYqN.txt):
//     every 13(f) CUSIP with issuer, class and status (*A* added, *D*
//     deleted). Its CALL/PUT lines are the codes filers use for option
//     positions; each sits under the security it is written on.
//   · company_tickers_exchange.json: issuer name → listed ticker(s).
//   · api/_data/cusip-overrides.json: hand-checked answers for what the two
//     files cannot settle (ETF series, ISIN fragments, reorganised issuers),
//     each with a note saying where it was checked.
//
// Decision order for one unresolved identifier (decide()):
//   1. an override, as written;
//   2. a CALL/PUT code of the 13(f) list → classified `option`, with the
//      underlying when the code is used by exactly one security of the
//      issuer (iShares/SPDR trusts reuse a code across funds: then none);
//   3. a warrant / right / unit / note line → classified by kind, with the
//      issuer's ticker for display only;
//   4. an equity line whose issuer name matches exactly one listed company
//      → that ticker;
//   5. an equity line the list marks deleted, with no listed company left
//      → classified `delisted`;
//   6. not on the list and not a well-formed CUSIP (check digit, all-zero
//      placeholder) → classified `invalid`.
//   7. well-formed, not on the list, and OpenFIGI has missed it on
//      UNLISTED_AFTER nights → classified `unlisted`.
// Anything else stays unresolved for the next night: a valid CUSIP the list
// does not carry yet is usually a new issue OpenFIGI learns within days.
import { secGet } from './sec.js';
import { loadCusipOverrides } from './cusipOverrides.js';
import { classify, record, securityEntry, unresolvedEntries } from './securityMaster.js';

// ---- identifiers ------------------------------------------------------------

// CUSIP check digit (modulus 10, double-add-double). Letters count 10–35,
// '*' 36, '@' 37, '#' 38, as the CUSIP standard sets them.
export function cusipCheckDigit(base8) {
  let sum = 0;
  for (let i = 0; i < 8; i++) {
    const ch = base8[i];
    let v;
    if (/[0-9]/.test(ch)) v = Number(ch);
    else if (/[A-Z]/.test(ch)) v = ch.charCodeAt(0) - 55;
    else if (ch === '*') v = 36;
    else if (ch === '@') v = 37;
    else if (ch === '#') v = 38;
    else return null;
    if (i % 2 === 1) v *= 2;
    sum += Math.floor(v / 10) + (v % 10);
  }
  return (10 - (sum % 10)) % 10;
}

export function isValidCusip(c) {
  const s = String(c || '').toUpperCase();
  if (!/^[0-9A-Z*@#]{8}[0-9]$/.test(s)) return false;
  if (/^0{8}/.test(s)) return false; // a placeholder, whatever its last digit
  return cusipCheckDigit(s.slice(0, 8)) === Number(s[8]);
}

// ---- the 13(f) list -----------------------------------------------------------

// Fixed-width text: CUSIP (9), a '*' when options are listed on it, issuer
// name (cols 11–40), class description (41–67), status (68–72).
export function parse13fList(text) {
  const rows = new Map();
  const optionUses = new Map(); // option code → Set of underlying CUSIPs
  const lastEquity = new Map(); // issuer (6) → the security the next CALL/PUT is on
  for (const line of String(text || '').split(/\r?\n/)) {
    const cusip = line.slice(0, 9).trim().toUpperCase();
    if (cusip.length !== 9) continue;
    const name = line.slice(10, 40).replace(/\s+/g, ' ').trim();
    const desc = line.slice(40, 67).replace(/\s+/g, ' ').trim();
    const status = line.slice(67, 72).trim();
    const putCall = desc === 'CALL' ? 'CALL' : desc === 'PUT' ? 'PUT' : null;
    if (putCall) {
      const under = lastEquity.get(cusip.slice(0, 6)) || null;
      if (!optionUses.has(cusip)) optionUses.set(cusip, new Set());
      if (under) optionUses.get(cusip).add(under);
    } else {
      lastEquity.set(cusip.slice(0, 6), cusip);
    }
    if (!rows.has(cusip)) rows.set(cusip, { name, desc, status, putCall });
  }
  for (const [code, set] of optionUses) {
    const r = rows.get(code);
    if (r) r.underlyings = [...set];
  }
  return rows;
}

// What kind of line a class description is. Warrants carry "*W EXP …".
export function lineKind(desc) {
  const d = String(desc || '').toUpperCase();
  if (d === 'CALL' || d === 'PUT') return 'option';
  if (/^\*W\b|WARRANT|\bWT\b/.test(d)) return 'warrant';
  if (/^RIGHT\b|\bRTS?\b/.test(d)) return 'right';
  if (/^UNIT\b/.test(d)) return 'unit';
  if (/^(DEBT|NOTE|BOND)\b|\d+(\.\d+)?%/.test(d)) return 'debt';
  return 'equity';
}

// ---- issuer name → ticker -----------------------------------------------------

const STOP = new Set(['INC', 'CORP', 'CO', 'LTD', 'PLC', 'THE', 'HOLDINGS', 'HLDGS', 'HLDG', 'GROUP', 'NV', 'SA', 'AG', 'AS', 'CORPORATION', 'COMPANY', 'INCORPORATED', 'LIMITED', 'DEL', 'NEW']);
export function nameKey(name) {
  return String(name || '')
    .toUpperCase()
    .replace(/&/g, ' ')
    .replace(/[^A-Z0-9 ]/g, ' ')
    .split(/\s+/)
    .filter((t) => t && !STOP.has(t))
    .join(' ');
}

const LISTED = new Set(['NASDAQ', 'NYSE', 'CBOE']);
// company_tickers_exchange.json → nameKey → [{ ticker, exchange }]
export function indexListed(json) {
  const fields = json?.fields || [];
  const it = fields.indexOf('ticker');
  const in_ = fields.indexOf('name');
  const ie = fields.indexOf('exchange');
  const idx = new Map();
  for (const r of json?.data || []) {
    const key = nameKey(r[in_]);
    if (!key) continue;
    if (!idx.has(key)) idx.set(key, []);
    idx.get(key).push({ ticker: String(r[it] || '').toUpperCase(), exchange: r[ie] || null });
  }
  return idx;
}

// The one common-stock ticker of a company, or null when the name is
// unknown or carries more than one line that could be it (GOOG/GOOGL).
// Warrant/unit/right symbols (base + W/U/R/RT, dashed preferreds) are not
// the common stock and are dropped first.
export function companyTicker(idx, name) {
  const hits = idx.get(nameKey(name)) || [];
  if (!hits.length) return null;
  const listed = hits.filter((h) => LISTED.has(String(h.exchange || '').toUpperCase()));
  const pool = listed.length ? listed : hits;
  const tickers = [...new Set(pool.map((h) => h.ticker).filter(Boolean))];
  const base = tickers.filter((t) => !t.includes('-') && !tickers.some((o) => o !== t && t.startsWith(o) && /^(W|WS|U|R|RT)$/.test(t.slice(o.length))));
  return base.length === 1 ? base[0] : null;
}

// ---- the decision -------------------------------------------------------------

// One identifier → { action: 'resolve', ticker, name, note }
//                 | { action: 'classify', kind, name, reason, … }
//                 | null (leave it unresolved)
export const UNLISTED_AFTER = 7;
export function decide(cusip, { name = null, attempts = 0 } = {}, { list, listed, overrides = {}, tickerOf = () => null }) {
  const c = String(cusip || '').toUpperCase();
  const o = overrides[c];
  if (o) {
    if (o.ticker) return { action: 'resolve', ticker: o.ticker, name: o.name || name, source: 'override' };
    return { action: 'classify', kind: o.kind, name: o.name || name, reason: o.reason || null, lastTicker: o.lastTicker, underlying: o.underlying, underlyingTicker: o.underlyingTicker || (o.underlying ? tickerOf(o.underlying) : null), putCall: o.putCall, source: 'override' };
  }
  const row = list?.get(c);
  if (row) {
    const kind = lineKind(row.desc);
    if (kind === 'option') {
      const unders = row.underlyings || [];
      const underlying = unders.length === 1 ? unders[0] : null;
      return {
        action: 'classify',
        kind: 'option',
        putCall: row.putCall,
        name: row.name,
        underlying,
        underlyingTicker: underlying ? tickerOf(underlying) : null,
        reason: underlying ? `${row.putCall} code of the SEC 13(f) list on ${underlying}` : `${row.putCall} code the SEC 13(f) list uses for ${unders.length} securities of ${row.name}`,
        source: 'sec-13f-list',
      };
    }
    const co = listed ? companyTicker(listed, row.name) : null;
    if (kind !== 'equity') {
      return { action: 'classify', kind, name: `${row.name} ${row.desc}`.trim(), underlyingTicker: co, reason: `${kind} line of the SEC 13(f) list (${row.desc})`, source: 'sec-13f-list' };
    }
    if (co) return { action: 'resolve', ticker: co, name: row.name, source: 'sec-name' };
    if (row.status === '*D*') return { action: 'classify', kind: 'delisted', name: row.name, reason: 'deleted from the SEC 13(f) list; no listed company of that name', source: 'sec-13f-list' };
    return null;
  }
  if (!isValidCusip(c)) return { action: 'classify', kind: 'invalid', name, reason: 'not a valid CUSIP (check digit or format) and not on the SEC 13(f) list', source: 'check-digit' };
  // well-formed but on no list and unknown to OpenFIGI for a week of
  // nightly retries: a private placement, an internal code that happens to
  // pass the check digit, a long-dead issue
  if ((attempts || 0) >= UNLISTED_AFTER) return { action: 'classify', kind: 'unlisted', name, reason: `not on the SEC 13(f) list; OpenFIGI found nothing in ${attempts} nightly tries`, source: 'sec-13f-list' };
  return null;
}

// ---- the build step -----------------------------------------------------------

const quarterOf = (d) => `${d.getUTCFullYear()}q${Math.floor(d.getUTCMonth() / 3) + 1}`;
// The newest published list: the SEC posts the next quarter's list near the
// end of the current one, so walk back from next quarter.
async function fetch13fList(now = new Date()) {
  for (let back = -1; back <= 3; back++) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 3 * back, 1));
    const q = quarterOf(d);
    try {
      const r = await secGet(`https://www.sec.gov/files/investment/13flist${q}.txt`, { responseType: 'text', transformResponse: (x) => x });
      if (typeof r.data === 'string' && r.data.length > 100000) return { quarter: q, text: r.data };
    } catch (e) {
      if (e.response?.status !== 404) throw e;
    }
  }
  throw new Error('no SEC 13(f) list found');
}

// Runs over the whole unresolved table; returns counts for the build log.
export async function resolveFromSec({ fetchList = fetch13fList, fetchListed = () => secGet('https://www.sec.gov/files/company_tickers_exchange.json').then((r) => r.data), overrides = loadCusipOverrides() } = {}) {
  const pending = unresolvedEntries();
  const out = { pending: pending.length, resolved: 0, classified: 0, left: 0, byKind: {}, list: null };
  if (!pending.length) return out;
  const [{ quarter, text }, listedJson] = await Promise.all([fetchList(), fetchListed()]);
  out.list = quarter;
  const ctx = { list: parse13fList(text), listed: indexListed(listedJson), overrides, tickerOf: (c) => securityEntry(c)?.ticker || null };
  for (const u of pending) {
    const d = decide(u.cusip, u, ctx);
    if (!d) {
      out.left++;
      continue;
    }
    if (d.action === 'resolve') {
      record(u.cusip, { ticker: d.ticker, name: d.name }, { source: d.source });
      out.resolved++;
    } else {
      classify(u.cusip, d, { source: d.source });
      out.classified++;
      out.byKind[d.kind] = (out.byKind[d.kind] || 0) + 1;
    }
  }
  return out;
}
