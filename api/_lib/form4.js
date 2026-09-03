// @ts-check
// Form 4 (insider transaction) parsing and feed maintenance.
import { parseStringPromise, processors } from 'xml2js';

/** @typedef {'CEO'|'CFO'|'COO'|'PRESIDENT'|'OFFICER'|'DIRECTOR'|'TEN_PCT'|'OTHER'} Role */
/** @typedef {{ acc: string, date: string, filed: string|null, issuerCik: string, issuer: string, symbol: string|null, owner: string, title: string|null, role: Role, code: string|null, side: 'buy'|'sell'|null, shares: number, price: number|null, value: number|null, ownedAfter: number|null, derivative: boolean }} InsiderTx */

const arr = (/** @type {any} */ x) => (x == null ? [] : Array.isArray(x) ? x : [x]);
const val = (/** @type {any} */ x) => (x && typeof x === 'object' ? x.value : x) ?? null;
const truthy = (/** @type {any} */ x) => {
  const v = val(x);
  return v === '1' || v === 'true' || v === true;
};

/** Classify an insider's relationship into a coarse role.
 * @param {{ officerTitle?: string|null, isDirector?: any, isOfficer?: any, isTenPercentOwner?: any }} rel */
export function classifyRole(rel) {
  const t = String(rel.officerTitle || '').toLowerCase();
  if (/chief executive|\bceo\b|\bc\.e\.o/.test(t)) return 'CEO';
  if (/chief financial|\bcfo\b|\bc\.f\.o/.test(t)) return 'CFO';
  if (/chief operating|\bcoo\b/.test(t)) return 'COO';
  if (/\bpresident\b/.test(t) && !/vice/.test(t)) return 'PRESIDENT';
  if (t || truthy(rel.isOfficer)) return 'OFFICER';
  if (truthy(rel.isDirector)) return 'DIRECTOR';
  if (truthy(rel.isTenPercentOwner)) return 'TEN_PCT';
  return 'OTHER';
}

/**
 * Parse one Form 4 XML document.
 * @param {string} raw @param {{ acc: string, filed?: string|null }} meta
 * @returns {Promise<InsiderTx[]>}
 */
export async function parseForm4Xml(raw, meta) {
  const doc = await parseStringPromise(raw, { explicitArray: false, ignoreAttrs: true, tagNameProcessors: [processors.stripPrefix] });
  const od = doc?.ownershipDocument;
  if (!od) return [];
  const issuerCik = String(od.issuer?.issuerCik || '').replace(/\D/g, '').replace(/^0+/, '') || '';
  const issuer = String(od.issuer?.issuerName || '').trim();
  const symbol = od.issuer?.issuerTradingSymbol ? String(od.issuer.issuerTradingSymbol).trim().toUpperCase() : null;
  const owner = arr(od.reportingOwner)[0];
  const ownerName = String(owner?.reportingOwnerId?.rptOwnerName || '—').trim();
  const rel = owner?.reportingOwnerRelationship || {};
  const role = classifyRole(rel);
  const title = rel.officerTitle ? String(rel.officerTitle).trim() : role === 'DIRECTOR' ? 'Director' : role === 'TEN_PCT' ? '10% Owner' : null;

  /** @param {any} tx @param {boolean} derivative */
  const mk = (tx, derivative) => {
    const shares = Number(val(tx.transactionAmounts?.transactionShares)) || 0;
    const priceRaw = val(tx.transactionAmounts?.transactionPricePerShare);
    const price = priceRaw == null || priceRaw === '' ? null : Number(priceRaw);
    const ad = val(tx.transactionAmounts?.transactionAcquiredDisposedCode);
    const after = val(tx.postTransactionAmounts?.sharesOwnedFollowingTransaction);
    return /** @type {InsiderTx} */ ({
      acc: meta.acc,
      date: String(val(tx.transactionDate) || ''),
      filed: meta.filed || null,
      issuerCik,
      issuer,
      symbol: symbol && /^[A-Z0-9.-]{1,10}$/.test(symbol) ? symbol : null,
      owner: ownerName,
      title,
      role,
      code: tx.transactionCoding?.transactionCode ? String(tx.transactionCoding.transactionCode).trim().toUpperCase() : null,
      side: ad === 'A' ? 'buy' : ad === 'D' ? 'sell' : null,
      shares,
      price: Number.isFinite(price) ? price : null,
      value: Number.isFinite(price) && price != null ? Math.round(shares * price) : null,
      ownedAfter: after == null ? null : Number(after),
      derivative,
    });
  };
  const out = [
    ...arr(od.nonDerivativeTable?.nonDerivativeTransaction).map((tx) => mk(tx, false)),
    ...arr(od.derivativeTable?.derivativeTransaction).map((tx) => mk(tx, true)),
  ];
  return out.filter((t) => /^\d{4}-\d{2}-\d{2}$/.test(t.date) && t.shares > 0);
}

/** Open-market purchase / sale codes: the ones that carry signal. */
export const OPEN_MARKET = new Set(['P', 'S']);

/**
 * Merge freshly parsed transactions into the stored feed, dedupe, prune.
 * @param {InsiderTx[]} existing @param {InsiderTx[]} fresh
 * @param {{ now?: string, keepDays?: number, maxRows?: number, minValue?: number }} [o]
 */
export function mergeFeed(existing, fresh, o = {}) {
  const now = o.now || new Date().toISOString().slice(0, 10);
  const keepDays = o.keepDays ?? 30;
  const maxRows = o.maxRows ?? 4000;
  const minValue = o.minValue ?? 0;
  const cutoff = new Date(new Date(now + 'T00:00:00Z').getTime() - keepDays * 86400000).toISOString().slice(0, 10);
  /** @type {Map<string, InsiderTx>} */
  const m = new Map();
  const key = (/** @type {InsiderTx} */ t) => `${t.acc}|${t.date}|${t.code}|${t.shares}|${t.price}|${t.derivative ? 1 : 0}`;
  for (const t of [...existing, ...fresh]) {
    if (t.date < cutoff || t.date > now) continue;
    if (t.derivative) continue; // feed = equity transactions only
    if (!OPEN_MARKET.has(t.code || '')) continue;
    if ((t.value || 0) < minValue) continue;
    m.set(key(t), t);
  }
  return [...m.values()]
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : (b.value || 0) - (a.value || 0)))
    .slice(0, maxRows);
}

/** Parse an EDGAR daily form index (form.YYYYMMDD.idx) into Form 4 entries.
 * @param {string} text @returns {{ form: string, company: string, cik: string, filed: string, acc: string }[]} */
export function parseDailyIndex(text) {
  const out = [];
  for (const line of text.split('\n')) {
    // Form Type | Company Name | CIK | Date Filed | File Name  (fixed-width columns in .idx, pipe in *.idx? use regex)
    const m = /^(4(?:\/A)?)\s{2,}(.+?)\s{2,}(\d+)\s{2,}(\d{8})\s{2,}(edgar\/data\/\d+\/(\d{10}-\d{2}-\d{6})\.txt)\s*$/.exec(line);
    if (!m) continue;
    const filed = `${m[4].slice(0, 4)}-${m[4].slice(4, 6)}-${m[4].slice(6, 8)}`;
    out.push({ form: m[1], company: m[2].trim(), cik: m[3], filed, acc: m[6] });
  }
  return out;
}
