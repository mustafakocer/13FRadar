// Filings that carry another filer's information table (config/misfiled-books.json):
// Sixth Street Partners' 2026-Q2 13F holds Charles Schwab Investment
// Management's $751B table while its own cover page declares $579M.
//
// markMisfiled() stamps such a universe row `misfiled`; every list or ranking
// by size, the stock totals and the headline total leave a stamped row out,
// and the filer's page says whose table it is (manager API `misfiled`). The
// entry names the accession, so the filer's next, correct filing is not
// affected.
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const pad = (cik) => String(cik || '').replace(/\D/g, '').padStart(10, '0');

function load() {
  try {
    return (require('../../config/misfiled-books.json').filers || []).map((f) => ({ ...f, cik: pad(f.cik), copyOf: f.copyOf ? pad(f.copyOf) : null }));
  } catch {
    return [];
  }
}
export const misfiledBooks = load();

// the entry for this filer (and accession, when given), or null
export function misfiledFor(cik, acc = null, books = misfiledBooks) {
  const c = pad(cik);
  return books.find((f) => f.cik === c && (!acc || !f.acc || f.acc === acc)) || null;
}

// the marker a universe row carries
export function misfiledMark(f) {
  return { copyOf: f.copyOf, copyOfName: f.copyOfName || null, declared: Number.isFinite(f.declared) ? f.declared : null, acc: f.acc || null };
}

// stamp (or clear) `misfiled` on universe rows; returns the number stamped
export function markMisfiled(rows, books = misfiledBooks) {
  let n = 0;
  for (const r of rows || []) {
    const f = misfiledFor(r.cik, r.acc, books);
    if (f) {
      r.misfiled = misfiledMark(f);
      n++;
    } else delete r.misfiled;
  }
  return n;
}

// rows that belong in a list or ranking of funds by size
export const ranked = (r) => !r?.misfiled;
