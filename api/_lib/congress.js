// @ts-check
// STOCK Act periodic transaction reports (PTR) for the House and Senate.
//
// SOURCE (documented for the ingest job): there is no EDGAR-style machine
// feed. The House Clerk publishes PTRs as PDFs with a yearly XML index
// (https://disclosures-clerk.house.gov/FinancialDisclosure) and the Senate eFD
// site (https://efdsearch.senate.gov) is an HTML search behind a session
// cookie. We therefore ingest the maintained open datasets that parse those
// sources — House Stock Watcher and Senate Stock Watcher — whose JSON schemas
// are normalised here. Party/state come from the unitedstates/congress-
// legislators dataset. Refresh cadence: daily (see workflows/congress.yml);
// PTRs themselves are due within 45 days of a trade.

/** @typedef {{ id: string, chamber: 'house'|'senate', member: string, party: 'D'|'R'|'I'|null, state: string|null, district: string|null, transactionDate: string, disclosureDate: string|null, ticker: string|null, asset: string, type: 'buy'|'sell'|'exchange'|'other', typeRaw: string, amountMin: number|null, amountMax: number|null, amountBand: string, owner: string|null, link: string|null }} CongressTx */

const BANDS = [
  [1001, 15000],
  [15001, 50000],
  [50001, 100000],
  [100001, 250000],
  [250001, 500000],
  [500001, 1000000],
  [1000001, 5000000],
  [5000001, 25000000],
  [25000001, 50000000],
  [50000001, Infinity],
];

/** "$1,001 - $15,000" / "$1,000,001 - $5,000,000" / "Over $50,000,000" → [min, max]
 * @param {string} s */
export function parseAmount(s) {
  const nums = String(s || '').replace(/,/g, '').match(/\d+(?:\.\d+)?/g)?.map(Number) || [];
  if (!nums.length) return { min: null, max: null, band: String(s || '').trim() || '—' };
  if (/over|\+/i.test(String(s)) && nums.length === 1) return { min: nums[0], max: null, band: `$${fmt(nums[0])}+` };
  const [a, b] = nums;
  return { min: a, max: b ?? a, band: b ? `$${fmt(a)} – $${fmt(b)}` : `$${fmt(a)}` };
}
const fmt = (/** @type {number} */ n) => (n >= 1e6 ? `${(n / 1e6).toFixed(1).replace(/\.0$/, '')}M` : n >= 1e3 ? `${Math.round(n / 1e3)}K` : String(n));

/** Amount band index (0..9) for filtering, from a min value. @param {number|null} min */
export function bandIndex(min) {
  if (min == null) return -1;
  const i = BANDS.findIndex(([lo, hi]) => min >= lo && min <= hi);
  return i;
}

/** @param {string} raw */
export function normalizeType(raw) {
  const t = String(raw || '').toLowerCase();
  if (/purchase|buy/.test(t)) return 'buy';
  if (/sale|sell/.test(t)) return 'sell';
  if (/exchange/.test(t)) return 'exchange';
  return 'other';
}

/** @param {string} d  accepts YYYY-MM-DD or MM/DD/YYYY */
export function isoDate(d) {
  const s = String(d || '').trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(s);
  if (m) return `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
  return null;
}

/** @param {string} t */
export function cleanTicker(t) {
  const s = String(t || '').trim().toUpperCase();
  if (!s || s === '--' || s === 'N/A' || s === 'NONE') return null;
  return /^[A-Z0-9.-]{1,10}$/.test(s) ? s : null;
}

const strip = (/** @type {string} */ s) =>
  String(s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\b(hon|mr|mrs|ms|dr|jr|sr|ii|iii|iv)\.?\b/g, '')
    .replace(/[^a-z\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/**
 * Build a lookup from congress-legislators rows.
 * @param {{ name: { first: string, last: string, official_full?: string }, terms: { type: 'rep'|'sen', party: string, state: string, district?: number, end: string }[] }[]} legislators
 */
export function legislatorIndex(legislators) {
  /** @type {Map<string, { party: 'D'|'R'|'I', state: string, district: string|null, chamber: 'house'|'senate' }>} */
  const byName = new Map();
  for (const l of legislators) {
    const term = l.terms[l.terms.length - 1];
    if (!term) continue;
    const party = /^dem/i.test(term.party) ? 'D' : /^rep/i.test(term.party) ? 'R' : 'I';
    const info = { party, state: term.state, district: term.district != null ? String(term.district) : null, chamber: term.type === 'sen' ? /** @type {const} */ ('senate') : /** @type {const} */ ('house') };
    const keys = new Set([strip(`${l.name.first} ${l.name.last}`), strip(l.name.official_full || ''), strip(`${l.name.last} ${l.name.first}`)]);
    for (const k of keys) if (k) byName.set(`${info.chamber}|${k}`, info);
  }
  return byName;
}

/** Best-effort member → party/state. Tries full name, then "first last" from
 * "Last, First" / "Hon. First M. Last" forms, then unique last-name match.
 * @param {ReturnType<typeof legislatorIndex>} idx @param {'house'|'senate'} chamber @param {string} name */
export function matchLegislator(idx, chamber, name) {
  const s = strip(name.includes(',') ? name.split(',').reverse().join(' ') : name);
  if (!s) return null;
  const direct = idx.get(`${chamber}|${s}`);
  if (direct) return direct;
  const parts = s.split(' ');
  if (parts.length >= 2) {
    const fl = idx.get(`${chamber}|${parts[0]} ${parts[parts.length - 1]}`);
    if (fl) return fl;
  }
  const last = parts[parts.length - 1];
  const hits = [];
  for (const [k, v] of idx) {
    if (!k.startsWith(`${chamber}|`)) continue;
    if (k.split('|')[1].split(' ').pop() === last) hits.push(v);
  }
  const uniq = [...new Set(hits.map((h) => JSON.stringify(h)))];
  return uniq.length === 1 ? JSON.parse(uniq[0]) : null;
}

/**
 * House Stock Watcher row → CongressTx
 * @param {any} r @param {ReturnType<typeof legislatorIndex>} idx
 */
export function normalizeHouse(r, idx) {
  const td = isoDate(r.transaction_date);
  if (!td) return null;
  const amt = parseAmount(r.amount);
  const member = String(r.representative || '').replace(/^hon\.?\s*/i, '').trim();
  const leg = matchLegislator(idx, 'house', member);
  const ticker = cleanTicker(r.ticker);
  return /** @type {CongressTx} */ ({
    id: `H|${member}|${td}|${ticker || r.asset_description}|${r.type}|${r.amount}`,
    chamber: 'house',
    member,
    party: leg?.party || null,
    state: leg?.state || (r.district ? String(r.district).slice(0, 2) : null),
    district: r.district ? String(r.district) : leg?.district || null,
    transactionDate: td,
    disclosureDate: isoDate(r.disclosure_date),
    ticker,
    asset: String(r.asset_description || '').trim(),
    type: normalizeType(r.type),
    typeRaw: String(r.type || ''),
    amountMin: amt.min,
    amountMax: amt.max,
    amountBand: amt.band,
    owner: r.owner ? String(r.owner) : null,
    link: r.ptr_link || null,
  });
}

/** Senate Stock Watcher row → CongressTx @param {any} r @param {ReturnType<typeof legislatorIndex>} idx */
export function normalizeSenate(r, idx) {
  const td = isoDate(r.transaction_date);
  if (!td) return null;
  const amt = parseAmount(r.amount);
  const member = String(r.senator || '').trim();
  const leg = matchLegislator(idx, 'senate', member);
  const ticker = cleanTicker(r.ticker);
  return /** @type {CongressTx} */ ({
    id: `S|${member}|${td}|${ticker || r.asset_description}|${r.type}|${r.amount}`,
    chamber: 'senate',
    member,
    party: leg?.party || null,
    state: leg?.state || null,
    district: null,
    transactionDate: td,
    disclosureDate: isoDate(r.disclosure_date),
    ticker,
    asset: String(r.asset_description || '').trim(),
    type: normalizeType(r.type),
    typeRaw: String(r.type || ''),
    amountMin: amt.min,
    amountMax: amt.max,
    amountBand: amt.band,
    owner: r.owner ? String(r.owner) : null,
    link: r.ptr_link || null,
  });
}

/** Dedupe, keep the last `keepDays`, newest first. @param {CongressTx[]} rows @param {{ now?: string, keepDays?: number, maxRows?: number }} [o] */
export function mergeCongress(rows, o = {}) {
  const now = o.now || new Date().toISOString().slice(0, 10);
  const keepDays = o.keepDays ?? 365;
  const cutoff = new Date(new Date(now + 'T00:00:00Z').getTime() - keepDays * 86400000).toISOString().slice(0, 10);
  const m = new Map();
  for (const r of rows) {
    if (!r || r.transactionDate < cutoff || r.transactionDate > now) continue;
    m.set(r.id, r);
  }
  return [...m.values()].sort((a, b) => (a.transactionDate < b.transactionDate ? 1 : a.transactionDate > b.transactionDate ? -1 : (b.amountMin || 0) - (a.amountMin || 0))).slice(0, o.maxRows ?? 6000);
}
