// Notes on a fund's own filing error, shown on its page
// (config/filing-notes.json): Sanctuary Advisors' 2026-Q2 cover page declares
// $215.85B for a table that sums to $21.59B at market prices.
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const pad = (cik) => String(cik || '').replace(/\D/g, '').padStart(10, '0');

function load() {
  try {
    return (require('../../config/filing-notes.json').notes || []).map((n) => ({ ...n, cik: pad(n.cik) }));
  } catch {
    return [];
  }
}
export const filingNotes = load();

// the notes for a filer, as the page shows them
export function notesFor(cik, notes = filingNotes) {
  const c = pad(cik);
  return notes.filter((n) => n.cik === c).map(({ acc, kind, declared, table }) => ({ acc: acc || null, kind, declared: declared ?? null, table: table ?? null }));
}
