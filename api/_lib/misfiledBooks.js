// Filings that carry another filer's information table (config/misfiled-books.json):
// Sixth Street Partners' 2026-Q2 13F holds Charles Schwab Investment
// Management's $751B table while its own cover page declares $579M.
//
// markMisfiled() stamps such a universe row `misfiled`; every list or ranking
// by size, the stock totals and the headline total leave a stamped row out,
// and the filer's page says whose table it is (manager API `misfiled`). The
// entry names the accession, so the filer's next, correct filing is not
// affected.
//
// A filer that corrects the slip files a 13F-HR/A restating its own book
// (KMT Wealth, 2026-11-10). Once that amendment has been read by hand the
// entry names it in `correctedBy`; a filing that has it applied is the
// filer's own again — no stamp, no note, the quarter in every total — while
// the original read on its own (a snapshot stored before the amendment) is
// still another filer's table.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const pad = (cik) => String(cik || '').replace(/\D/g, '').padStart(10, '0');

// MISFILED_BOOKS_FILE points the offline tests at a list of their own.
function load() {
  try {
    const override = process.env.MISFILED_BOOKS_FILE;
    const file = override ? JSON.parse(fs.readFileSync(path.resolve(override), 'utf8')) : require('../../config/misfiled-books.json');
    return (file.filers || []).map((f) => ({ ...f, cik: pad(f.cik), copyOf: f.copyOf ? pad(f.copyOf) : null }));
  } catch {
    return [];
  }
}
export const misfiledBooks = load();

// the accessions of the amendments applied to a filing: list13F's
// `amendments` ([{ acc }]), a snapshot's, or a universe row's `amendedBy`
const accs = (amendments) => (Array.isArray(amendments) ? amendments : []).map((a) => (typeof a === 'string' ? a : a?.acc)).filter(Boolean);

// whether the filer's own restatement of the entry is among them
export const corrected = (entry, amendments) => Boolean(entry?.correctedBy) && accs(amendments).includes(entry.correctedBy);

// The entry for this filer (and accession, when given), or null.
// `amendments` are the 13F-HR/A documents applied to that filing: an entry
// whose `correctedBy` is among them no longer applies. Without them the
// entry stands — the original on its own is what the entry describes.
export function misfiledFor(cik, acc = null, books = misfiledBooks, amendments = null) {
  const c = pad(cik);
  return books.find((f) => f.cik === c && (!acc || !f.acc || f.acc === acc) && !corrected(f, amendments)) || null;
}

// the marker a universe row carries
export function misfiledMark(f) {
  return { copyOf: f.copyOf, copyOfName: f.copyOfName || null, declared: Number.isFinite(f.declared) ? f.declared : null, acc: f.acc || null };
}

// A misfiled original the filer has restated is only ever answered with the
// restatement applied: true when this accession is such an original and the
// amendments applied to what is about to be served do not include it (a
// snapshot stored before the 13F-HR/A, or an amendment that could not be read).
export function lacksCorrection(cik, acc, amendments = null, books = misfiledBooks) {
  const c = pad(cik);
  return books.some((f) => f.cik === c && f.acc === acc && f.correctedBy && !corrected(f, amendments));
}

// stamp (or clear) `misfiled` on universe rows; returns the number stamped
export function markMisfiled(rows, books = misfiledBooks) {
  let n = 0;
  for (const r of rows || []) {
    const f = misfiledFor(r.cik, r.acc, books, r.amendedBy);
    if (f) {
      r.misfiled = misfiledMark(f);
      n++;
    } else delete r.misfiled;
    // the reference-quarter filing a newer filer is counted from
    if (r.ref) {
      const g = misfiledFor(r.cik, r.ref.acc, books, r.ref.amendedBy);
      if (g) r.ref.misfiled = misfiledMark(g);
      else delete r.ref.misfiled;
    }
  }
  return n;
}

// rows that belong in a list or ranking of funds by size
export const ranked = (r) => !r?.misfiled;

// The quarter a filer's page opens on: its newest filing unless that one
// carries another filer's table, then the newest one that does not. Only an
// earlier *valid* filing is used — the misfiled quarter itself stays out of
// every total; the page says which quarter it shows and why. A filing the
// filer has restated (`correctedBy` among its amendments) is valid.
//   filings: newest first, as list13F() answers
//   → { acc, fallback: null | { reportDate, misfiled: { reportDate, acc, copyOf, copyOfName } } }
export function pageFiling(cik, filings = [], books = misfiledBooks) {
  const first = filings[0];
  if (!first) return { acc: null, fallback: null };
  const bad = misfiledFor(cik, first.acc, books, first.amendments);
  if (!bad) return { acc: first.acc, fallback: null };
  const valid = filings.find((f) => !misfiledFor(cik, f.acc, books, f.amendments));
  if (!valid) return { acc: first.acc, fallback: null };
  return {
    acc: valid.acc,
    fallback: { reportDate: valid.reportDate, misfiled: { reportDate: first.reportDate, acc: first.acc, copyOf: bad.copyOf, copyOfName: bad.copyOfName || null } },
  };
}

// The entry a filer's page still has to speak of: the first of its listed
// filings that carries another filer's table and has not been restated.
export function misfiledAmong(cik, filings = [], books = misfiledBooks) {
  for (const f of filings) {
    const e = misfiledFor(cik, f.acc, books, f.amendments);
    if (e) return e;
  }
  return null;
}

// Where one entry stands in the filing list the manager API answers — what
// the deployed page is held to (scripts/check-site.mjs):
//   'fallback'   the misfiled filing is the filer's newest period: the page
//                opens on an older valid filing and says so
//   'only'       …and nothing older is valid: it is shown, with its banner
//   'corrected'  it is the newest period and the filer's restatement is
//                applied: the page opens on it as on any quarter
//   'retired'    a later period has been filed: the page opens there
//   'absent'     the accession is not in the list
//   → { state, filing, newer, corrected }
export function misfiledState(entry, filings = [], books = misfiledBooks) {
  const i = filings.findIndex((f) => f.acc === entry.acc);
  if (i < 0) return { state: 'absent', filing: null, newer: null, corrected: false };
  const filing = filings[i];
  const fixed = corrected(entry, filing.amendments);
  const newer = filings.slice(0, i).find((f) => f.reportDate > filing.reportDate) || null;
  if (newer) return { state: 'retired', filing, newer, corrected: fixed };
  if (fixed) return { state: 'corrected', filing, newer: null, corrected: true };
  const older = filings.slice(i + 1).some((f) => !misfiledFor(entry.cik, f.acc, books, f.amendments));
  return { state: older ? 'fallback' : 'only', filing, newer: null, corrected: false };
}
