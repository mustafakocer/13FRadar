// One SEC Form 4 / 4/A submission → dataset rows.
//
// Pure: text in, rows out, no network. The crawl (insiderCrawl.js) fetches,
// this parses, the store (insiderStore.js) keeps. A filing that cannot be
// read throws BadFilingError, which the crawl records in the ingest-error log
// and steps over — one malformed document never stops a day.
import { parseStringPromise, processors } from 'xml2js';
import { classifyRole, classifyTransaction, cleanSymbol, KEPT_CODES } from './insiderModel.js';

export class BadFilingError extends Error {
  constructor(message) {
    super(message);
    this.name = 'BadFilingError';
  }
}

const OWNERSHIP_RE = /<ownershipDocument>[\s\S]*?<\/ownershipDocument>/i;
const ACCESSION_RE = /(\d{10}-\d{2}-\d{6})/;

const arr = (x) => (x == null ? [] : Array.isArray(x) ? x : [x]);
// xml2js with attributes on: a text node carrying attributes arrives as
// { _: text, $: attrs }, a plain one as the string itself.
const text = (x) => {
  if (x == null) return null;
  if (typeof x === 'string') return x;
  if (typeof x === 'object' && typeof x._ === 'string') return x._;
  return null;
};
// Form 4 wraps most values as <x><value>…</value><footnoteId id="F1"/></x>.
const val = (x) => (x && typeof x === 'object' && 'value' in x ? text(x.value) : text(x));
const footnoteIds = (x) =>
  x && typeof x === 'object' ? arr(x.footnoteId).map((f) => f?.$?.id).filter(Boolean) : [];

export const truthy = (x) => ['1', 'true', 'Y', 'y'].includes(String(x ?? '').trim());
export const num = (x) => {
  const n = Number(String(x ?? '').replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
};

// SEC dates in the quarterly datasets are DD-MON-YYYY (04-SEP-2026) or ISO.
const MON = { JAN: '01', FEB: '02', MAR: '03', APR: '04', MAY: '05', JUN: '06', JUL: '07', AUG: '08', SEP: '09', OCT: '10', NOV: '11', DEC: '12' };
export function normDate(s) {
  if (!s) return null;
  const v = String(s).trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /^(\d{2})-([A-Z]{3})-(\d{4})/i.exec(v);
  if (m) return `${m[3]}-${MON[m[2].toUpperCase()] || '01'}-${m[1]}`;
  return null;
}

// The stored row. Short keys, because a year of these ships inside the
// serverless bundle — see the key legend in insiderModel.js. New keys:
//   li  line index: position of the transaction in the filing's
//       non-derivative table. (a, li) is the row's unique key.
//   ow  reporting-owner CIK (10 digits), used to match 4/A amendments
//   fa  '4/A' on rows that come from an amendment (absent on a plain 4)
//   sb  accession of the 4/A that superseded this row (set by the store)
export function makeRow({ s, o, code, cl, p5, d, shares, price, owned, acc, li, formType, ownerCik }) {
  const value = price != null ? shares * price : null;
  const acquired = ['P', 'M', 'X', 'C', 'A', 'G', 'W', 'J', 'I', 'L'].includes(code) && code !== 'G';
  const prev = owned != null ? owned - (acquired ? shares : -shares) : null;
  const oc = prev && prev > 0 ? ((owned - prev) / prev) * 100 : null;
  return {
    t: s.ticker,
    c: s.issuer, // stripped again once the ticker -> name map is built
    ci: s.cik,
    n: o.name,
    r: classifyRole(o),
    ti: o.title || null,
    d,
    f: s.filed,
    k: code,
    cl: cl || classifyTransaction(code),
    ...(p5 ? { p5: 1 } : {}),
    s: Math.round(shares),
    p: price != null ? Number(price.toFixed(4)) : null,
    v: value != null ? Math.round(value) : null,
    o: owned != null ? Math.round(owned) : null,
    oc: oc != null ? Number(oc.toFixed(1)) : null,
    a: acc,
    ...(li != null ? { li } : {}),
    ...(ownerCik ? { ow: ownerCik } : {}),
    ...(formType === '4/A' ? { fa: '4/A' } : {}),
  };
}

const padCik = (x) => {
  const digits = String(x ?? '').replace(/\D/g, '');
  return digits ? digits.padStart(10, '0') : null;
};

// Raw Form 4 fields kept per row in api/_data/insiders-raw.json (keyed by
// `${accession}:${li}`), for the features that come next and the Supabase
// move. Legend — each maps to one column of the future table; fields the row
// already has are not repeated here:
//   ad  transactionAcquiredDisposedCode (A / D)        → acquired_disposed
//   af  aff10b5One as filed ('1', 'true', '0' …)       → aff10b5one
//   st  securityTitle                                   → security_title
//   sr  transactionShares as filed ('2,500')            → shares_raw
//   pr  transactionPricePerShare as filed               → price_raw
//   dr / of / tp  isDirector / isOfficer / isTenPercentOwner (1 when set)
//   ot  officerTitle                                    → officer_title
//   fn  { footnoteId: text } for footnotes this transaction references
//   rm  the filing's remarks (free text at the end of the form)
// From the row: k → transaction_code, t → ticker, ci → issuer_cik,
// ow → owner_cik, fa → form_type ('4' when absent). Not stored because they
// are constant today: is_derivative (only the non-derivative table is read),
// adr_ratio and security_type (null until the ADR work fills them).
const compact = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v != null && v !== ''));

// Parse one submission (.txt as served by EDGAR, or the bare XML).
//   filed      filing date (the daily-index day), YYYY-MM-DD
//   path       archive path, used for the accession when the header lacks it
//   formType   the daily index's form column ('4' | '4/A'), a fallback for
//              the document's own <documentType>
// Returns { accession, formType, rows, raw } where `raw` holds, per row id
// (`${accession}:${li}`), the fields no page uses yet — kept so the next
// features (and the Supabase move) do not need a re-crawl.
export async function parseForm4Submission(body, { filed, path = '', formType: indexForm = null } = {}) {
  if (typeof body !== 'string' || !body.length) throw new BadFilingError('empty submission');
  const m = OWNERSHIP_RE.exec(body);
  if (!m) throw new BadFilingError('no <ownershipDocument> in submission');
  let doc;
  try {
    doc = await parseStringPromise(m[0], {
      explicitArray: false,
      ignoreAttrs: false,
      tagNameProcessors: [processors.stripPrefix],
    });
  } catch (e) {
    throw new BadFilingError(`XML parse error: ${String(e.message || e).split('\n')[0]}`);
  }
  const od = doc?.ownershipDocument;
  if (!od || typeof od !== 'object') throw new BadFilingError('empty <ownershipDocument>');

  const accession =
    ACCESSION_RE.exec(/ACCESSION NUMBER:\s*(\S+)/.exec(body)?.[1] || '')?.[1] || ACCESSION_RE.exec(path)?.[1] || null;
  if (!accession) throw new BadFilingError('no accession number');

  const docType = String(text(od.documentType) || indexForm || '4').trim().toUpperCase();
  const formType = docType === '4/A' ? '4/A' : '4';

  const issuer = od.issuer || {};
  const issuerCik = padCik(text(issuer.issuerCik));
  if (!issuerCik) throw new BadFilingError('no issuer CIK');
  const s = {
    ticker: cleanSymbol(text(issuer.issuerTradingSymbol)),
    issuer: String(text(issuer.issuerName) || '').trim(),
    cik: issuerCik,
    filed,
  };

  const ro = arr(od.reportingOwner)[0] || {};
  const rel = ro.reportingOwnerRelationship || {};
  const ownerCik = padCik(text(ro.reportingOwnerId?.rptOwnerCik));
  const o = {
    name: String(text(ro.reportingOwnerId?.rptOwnerName) || '—').trim(),
    title: String(text(rel.officerTitle) || '').trim(),
    isDirector: truthy(val(rel.isDirector)),
    isOfficer: truthy(val(rel.isOfficer)),
    isTenPercentOwner: truthy(val(rel.isTenPercentOwner)),
  };

  const footnotes = {};
  for (const f of arr(od.footnotes?.footnote)) {
    const id = f?.$?.id;
    const t = text(f);
    if (id && t) footnotes[id] = t.replace(/\s+/g, ' ').trim();
  }
  const aff10b5One = val(od.aff10b5One);
  // kept only when it says something about how the shares were bought (a
  // power-of-attorney line on every form is not worth shipping nightly)
  const remarksText = String(text(od.remarks) || '').replace(/\s+/g, ' ').trim();
  const remarks = /plan|offering|placement|issuer|remunerat|compensat|incentive|reinvest|bonus|program/i.test(remarksText) ? remarksText.slice(0, 600) : null;
  const p5 = truthy(aff10b5One);

  const txs = arr(od.nonDerivativeTable?.nonDerivativeTransaction);
  const codeOf = (tx) => String(val(tx.transactionCoding?.transactionCode) || '').trim().toUpperCase();
  const sameFilingSale = txs.some((tx) => codeOf(tx) === 'S');

  const rows = [];
  const raw = {};
  txs.forEach((tx, li) => {
    const code = codeOf(tx);
    if (!KEPT_CODES.has(code)) return;
    const d = normDate(val(tx.transactionDate));
    const amounts = tx.transactionAmounts || {};
    const sharesRaw = val(amounts.transactionShares);
    const priceRaw = val(amounts.transactionPricePerShare);
    const shares = num(sharesRaw);
    const price = num(priceRaw);
    const owned = num(val(tx.postTransactionAmounts?.sharesOwnedFollowingTransaction));
    if (!d || !shares || shares <= 0) return;
    const cl = classifyTransaction(code, { sameFilingSale });
    const row = makeRow({ s, o, code, cl, p5, d, shares, price, owned, acc: accession, li, formType, ownerCik });
    rows.push(row);

    const ids = new Set([
      ...footnoteIds(tx.transactionCoding),
      ...footnoteIds(tx.transactionDate),
      ...footnoteIds(amounts.transactionShares),
      ...footnoteIds(amounts.transactionPricePerShare),
      ...footnoteIds(amounts.transactionAcquiredDisposedCode),
      ...footnoteIds(tx.postTransactionAmounts?.sharesOwnedFollowingTransaction),
      ...footnoteIds(tx.securityTitle),
    ]);
    const notes = Object.fromEntries([...ids].filter((id) => footnotes[id]).map((id) => [id, footnotes[id]]));
    // Only what the row itself does not already carry, and nothing empty:
    // the file is committed nightly, so every byte is paid for daily.
    raw[`${accession}:${li}`] = compact({
      ad: val(amounts.transactionAcquiredDisposedCode),
      af: aff10b5One,
      st: val(tx.securityTitle),
      sr: sharesRaw,
      pr: priceRaw,
      dr: o.isDirector ? 1 : null,
      of: o.isOfficer ? 1 : null,
      ot: o.title || null,
      tp: o.isTenPercentOwner ? 1 : null,
      fn: Object.keys(notes).length ? notes : null,
      // the filing's free-text remarks ("Shares acquired under the Company's
      // share-based remuneration program") — the cluster rules read them
      rm: remarks,
    });
  });

  return { accession, formType, rows, raw };
}
