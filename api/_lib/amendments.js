// 13F-HR/A handling: one effective snapshot per (filer, period of report).
//
// A 13F-HR/A is not a quarter. It is a correction to the 13F-HR for the same
// period, and its cover page says which of two kinds it is:
//
//   RESTATEMENT   the whole table is filed again and REPLACES the original;
//   NEW HOLDINGS  only positions omitted from the original (typically ones
//                 that had confidential treatment) — they are ADDED to it.
//
// Treating an amendment as its own quarter, or letting "the most recently
// filed document per period wins" pick it over the original, is how a
// four-line NEW HOLDINGS amendment became "Berkshire 2025 Q1: 4 positions,
// $1.1B", how a one-line Chubb disclosure became all of 2023 Q3 and Q4, and
// how every derived number — turnover spiking to 200%, Apple "held 1.3
// years", quarters out of order — went wrong downstream.
//
// So: the raw filings stay raw (each accession is its own row, for the audit
// trail), and every consumer reads the *effective* snapshot — the original
// with its amendments applied in filing order — through
// sec.js getEffectiveHoldings. Everything here is pure; sec.js does the I/O.

export const RESTATEMENT = 'RESTATEMENT';
export const NEW_HOLDINGS = 'NEW HOLDINGS';

const byFiled = (a, b) => (a.filingDate === b.filingDate ? String(a.acc).localeCompare(String(b.acc)) : a.filingDate < b.filingDate ? -1 : 1);

// Group a filer's raw 13F filings by period of report. The result has one
// entry per period, newest period first (the order the pages show quarters
// in — by the quarter reported, never by the date filed):
//
//   { acc, form, filingDate, reportDate,          // the base document
//     amended: boolean,                            // an amendment applies
//     baseIsAmendment: boolean,                    // no original in the window
//     amendments: [{ acc, form, filingDate }] }    // oldest first
//
// The base is the most recently filed 13F-HR for the period (a filer that
// files two originals for one quarter is rare but exists). When the window
// holds only amendments for a period — the submissions feed keeps a bounded
// number of filings, so a very old original can fall out of it while a late
// amendment stays in — the earliest amendment is the base, flagged so a
// reader knows the numbers may be partial.
export function effectiveFilings(raw = []) {
  const byPeriod = new Map();
  for (const f of raw) {
    if (!f?.acc || !f.reportDate) continue;
    let g = byPeriod.get(f.reportDate);
    if (!g) byPeriod.set(f.reportDate, (g = { originals: [], amendments: [] }));
    (isAmendmentForm(f.form) ? g.amendments : g.originals).push({ ...f, amended: isAmendmentForm(f.form) });
  }
  const out = [];
  for (const [reportDate, g] of byPeriod) {
    g.originals.sort(byFiled);
    g.amendments.sort(byFiled);
    let base = g.originals[g.originals.length - 1] || null;
    let baseIsAmendment = false;
    let amendments = g.amendments;
    if (!base) {
      base = amendments[0];
      amendments = amendments.slice(1);
      baseIsAmendment = true;
    }
    // an amendment filed before the base document corrects an earlier
    // original, not this one; it has nothing left to apply to
    amendments = amendments.filter((a) => a.filingDate >= base.filingDate);
    out.push({
      acc: base.acc,
      form: base.form,
      filingDate: base.filingDate,
      reportDate,
      amended: amendments.length > 0,
      baseIsAmendment,
      amendments: amendments.map((a) => ({ acc: a.acc, form: a.form, filingDate: a.filingDate })),
    });
  }
  return out.sort((a, b) => (a.reportDate < b.reportDate ? 1 : a.reportDate > b.reportDate ? -1 : byFiled(b, a)));
}

export const isAmendmentForm = (form) => /^13F-HR\/A/i.test(String(form || ''));

// The cover page (primary_doc.xml) of a 13F submission, reduced to what the
// snapshot logic needs. Tag names carry a namespace prefix in some filings
// and none in others; the values are read the same way either way.
//   { periodOfReport: 'YYYY-MM-DD'|null, isAmendment: boolean,
//     amendmentNo: number|null, amendmentType: 'RESTATEMENT'|'NEW HOLDINGS'|null,
//     reportType: string|null }
export function parseCoverPage(xml) {
  const text = String(xml || '');
  const tag = (name) => {
    const m = new RegExp(`<(?:[A-Za-z0-9_.-]+:)?${name}(?:\\s[^>]*)?>([^<]*)</(?:[A-Za-z0-9_.-]+:)?${name}>`, 'i').exec(text);
    return m ? m[1].trim() : null;
  };
  const period = tag('periodOfReport') || tag('reportCalendarOrQuarter');
  const typeRaw = (tag('amendmentType') || '').toUpperCase().replace(/\s+/g, ' ');
  const amendmentType = /RESTATE/.test(typeRaw) ? RESTATEMENT : /NEW/.test(typeRaw) ? NEW_HOLDINGS : null;
  const isAmendment = /^(true|y|yes|1)$/i.test(tag('isAmendment') || '') || amendmentType != null;
  const no = Number(tag('amendmentNo'));
  return {
    periodOfReport: isoDate(period),
    isAmendment,
    amendmentNo: Number.isFinite(no) && no > 0 ? no : null,
    amendmentType,
    reportType: tag('reportType'),
  };
}

// Cover pages write the period as MM-DD-YYYY (the form's own format) and,
// in some filer software, as YYYY-MM-DD already.
export function isoDate(s) {
  if (!s) return null;
  const v = String(s).trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /^(\d{1,2})[-/](\d{1,2})[-/](\d{4})/.exec(v);
  if (m) return `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
  return null;
}

// When the cover page did not say (older filings, an unreadable document),
// the table itself is the evidence: a restatement re-files the whole book,
// a new-holdings amendment adds a handful of names. More than half the
// original's row count is the line; a base with no rows makes any amendment
// a restatement.
export function inferAmendmentType(base, amendment) {
  const n = base?.positions?.length || 0;
  const m = amendment?.positions?.length || 0;
  if (!n) return RESTATEMENT;
  return m * 2 > n ? RESTATEMENT : NEW_HOLDINGS;
}

const key = (p) => `${String(p.cusip || '').toUpperCase()}|${p.putCall || ''}`;

// Fold one amendment into a snapshot. Positions keep the aggregatePositions
// shape ({ cusip, putCall, issuer, class, value, shares, weight }); weights
// and the total are recomputed over the result.
export function applyAmendment(base, amendment, type) {
  const kind = type === RESTATEMENT || type === NEW_HOLDINGS ? type : inferAmendmentType(base, amendment);
  let positions;
  if (kind === RESTATEMENT) {
    positions = (amendment.positions || []).map((p) => ({ ...p }));
  } else {
    const map = new Map();
    for (const p of base.positions || []) map.set(key(p), { ...p });
    for (const p of amendment.positions || []) {
      const k = key(p);
      const cur = map.get(k);
      // a name the original already carried is stated again: the amendment's
      // figure is the corrected one, not an addition to it
      if (cur) map.set(k, { ...cur, value: p.value, shares: p.shares, issuer: p.issuer || cur.issuer, class: p.class || cur.class });
      else map.set(k, { ...p });
    }
    positions = [...map.values()];
  }
  positions.sort((a, b) => b.value - a.value);
  const aum = positions.reduce((s, p) => s + (p.value || 0), 0);
  for (const p of positions) p.weight = aum ? (p.value / aum) * 100 : 0;
  return { aum, positions, type: kind, inferred: type !== kind };
}

// The effective snapshot of a period: the base document with every
// amendment applied in filing order. `amendments` is [{ acc, filingDate,
// holdings, cover }] oldest first; `cover` may be null.
export function effectiveSnapshot(base, amendments = []) {
  let snap = { aum: base.aum, positions: (base.positions || []).map((p) => ({ ...p })) };
  const applied = [];
  for (const a of amendments) {
    if (!a?.holdings) continue;
    const r = applyAmendment(snap, a.holdings, a.cover?.amendmentType || null);
    snap = { aum: r.aum, positions: r.positions };
    applied.push({
      acc: a.acc,
      filingDate: a.filingDate,
      type: r.type,
      inferred: r.inferred,
      positions: (a.holdings.positions || []).length,
    });
  }
  return {
    aum: snap.aum,
    positions: snap.positions,
    ...(base.unitFix ? { unitFix: true } : {}),
    ...(applied.length ? { amended: true, amendments: applied } : {}),
  };
}
