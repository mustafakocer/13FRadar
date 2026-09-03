// @ts-check
// Schedule 13D / 13G parsing (P2-11). Since December 2024 the SEC requires
// these schedules as structured XML (form types "SCHEDULE 13D", "SCHEDULE
// 13G" and amendments); earlier filings are HTML/text. The parser walks the
// XML for the well-known cover-page tags wherever they sit in the tree, so
// schema variations still yield the holder name, % of class and shares.
// Text/HTML filings return an entry with parsed=false (link only).
import { parseStringPromise, processors } from 'xml2js';

/** @typedef {{ acc: string, form: string, filingDate: string, url: string, parsed: boolean, activist: boolean, amendment: boolean, eventDate: string|null, subject: string|null, holders: { name: string, percent: number|null, shares: number|null, purpose?: string|null }[], percent: number|null, shares: number|null, holder: string|null }} Schedule13 */

const NAME_TAGS = new Set(['reportingpersonname', 'nameofreportingperson', 'rptownername', 'reportingownername', 'name']);
const PCT_TAGS = new Set(['percentofclass', 'percentofclassrepresentedbyamountinrow', 'percentclass', 'percentownership']);
const AMT_TAGS = new Set(['aggregateamountowned', 'aggregateamountbeneficiallyowned', 'amountbeneficiallyowned', 'sharesbeneficiallyowned', 'aggregateamountbeneficiallyownedbyeachreportingperson']);
const DATE_TAGS = new Set(['dateofevent', 'eventdaterequiresfilingthisstatement', 'dateofeventwhichrequiresfiling']);
const SUBJECT_TAGS = new Set(['issuername', 'nameofissuer', 'subjectcompanyname']);
const PURPOSE_TAGS = new Set(['purposeoftransaction', 'item4', 'purpose']);

const num = (/** @type {any} */ x) => {
  const s = String(x ?? '').replace(/[%,$\s]/g, '');
  const n = Number(s);
  return s && Number.isFinite(n) ? n : null;
};
const text = (/** @type {any} */ x) => (x && typeof x === 'object' ? (x._ ?? x.value ?? '') : x ?? '');

/**
 * @param {string} raw XML @param {{ acc: string, form: string, filingDate: string, url: string }} meta
 * @returns {Promise<Schedule13>}
 */
export async function parseSchedule13Xml(raw, meta) {
  const base = /** @type {Schedule13} */ ({ ...meta, parsed: false, activist: /13D/i.test(meta.form), amendment: /\/A$/i.test(meta.form.trim()), eventDate: null, subject: null, holders: [], percent: null, shares: null, holder: null });
  let doc;
  try {
    doc = await parseStringPromise(raw, { explicitArray: false, ignoreAttrs: true, tagNameProcessors: [processors.stripPrefix] });
  } catch {
    return base;
  }
  if (!doc || typeof doc !== 'object') return base;
  /** @type {{ name?: string, percent?: number|null, shares?: number|null, purpose?: string|null }[]} */
  const persons = [];
  /** @type {{ name?: string, percent?: number|null, shares?: number|null, purpose?: string|null }} */
  let current = {};
  const flush = () => {
    if (current.name || current.percent != null || current.shares != null) persons.push(current);
    current = {};
  };
  (function walk(/** @type {any} */ node, /** @type {string} */ key) {
    if (node == null) return;
    const k = key.toLowerCase();
    if (Array.isArray(node)) {
      for (const n of node) walk(n, key);
      return;
    }
    if (typeof node === 'object') {
      const isPerson = /^(reportingperson|reportingowner|coverpageheader)/.test(k) && !/name$/.test(k);
      if (isPerson) flush();
      for (const [ck, cv] of Object.entries(node)) walk(cv, ck);
      if (isPerson) flush();
      return;
    }
    const val = String(text(node)).trim();
    if (!val) return;
    if (NAME_TAGS.has(k) && !current.name) current.name = val;
    else if (PCT_TAGS.has(k) && current.percent == null) current.percent = num(val);
    else if (AMT_TAGS.has(k) && current.shares == null) current.shares = num(val);
    else if (PURPOSE_TAGS.has(k) && !current.purpose) current.purpose = val.slice(0, 400);
    else if (DATE_TAGS.has(k) && !base.eventDate) base.eventDate = /^\d{4}-\d{2}-\d{2}/.test(val) ? val.slice(0, 10) : val;
    else if (SUBJECT_TAGS.has(k) && !base.subject) base.subject = val;
  })(doc, 'root');
  flush();
  const holders = persons.filter((p) => p.name).map((p) => ({ name: /** @type {string} */ (p.name), percent: p.percent ?? null, shares: p.shares ?? null, purpose: p.purpose ?? null }));
  const top = [...holders].sort((a, b) => (b.percent ?? -1) - (a.percent ?? -1))[0] || null;
  return { ...base, parsed: holders.length > 0, holders, percent: top?.percent ?? null, shares: top?.shares ?? null, holder: top?.name ?? null };
}

/** Group a stock's schedules into a holder timeline (latest % per holder).
 * @param {Schedule13[]} list newest first */
export function holderTimeline(list) {
  /** @type {Map<string, { name: string, latest: Schedule13, events: { filingDate: string, form: string, percent: number|null, shares: number|null }[] }>} */
  const m = new Map();
  for (const f of list) {
    for (const h of f.holders) {
      const key = h.name.toUpperCase().replace(/[^A-Z0-9]/g, '');
      const row = m.get(key) || { name: h.name, latest: f, events: [] };
      row.events.push({ filingDate: f.filingDate, form: f.form, percent: h.percent, shares: h.shares });
      m.set(key, row);
    }
  }
  return [...m.values()].map((r) => ({ ...r, events: r.events.sort((a, b) => (a.filingDate < b.filingDate ? -1 : 1)) })).sort((a, b) => (b.events[b.events.length - 1].percent ?? -1) - (a.events[a.events.length - 1].percent ?? -1));
}
