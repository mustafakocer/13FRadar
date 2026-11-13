// Notes on a fund's own filing error, shown on its page
// (config/filing-notes.json): Sanctuary Advisors' 2026-Q2 cover page declares
// $215.85B for a table that sums to $21.59B at market prices (kind
// 'cover-total'); WealthPLAN's cover counts 787 lines for a table that
// carries 264 (kind 'incomplete-table').
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const pad = (cik) => String(cik || '').replace(/\D/g, '').padStart(10, '0');

const read = (f, key) => {
  try {
    return require(f)[key] || [];
  } catch {
    return [];
  }
};
// the hand-checked notes, then the cover errors the nightly check closed by
// itself (api/_data/auto-reviews.json, api/_lib/deviationFix.js autoReview);
// a hand note on the same filing wins
function load() {
  const hand = read('../../config/filing-notes.json', 'notes').map((n) => ({ ...n, cik: pad(n.cik) }));
  const have = new Set(hand.map((n) => `${n.cik}|${n.acc}`));
  const auto = read('../_data/auto-reviews.json', 'reviews')
    .filter((a) => a.kind === 'cover-total' && !have.has(`${pad(a.cik)}|${a.acc}`))
    .map((a) => ({ cik: pad(a.cik), acc: a.acc, kind: 'cover-total', declared: a.declared ?? null, table: a.table ?? null, reason: a.reason, auto: true }));
  return [...hand, ...auto];
}
export const filingNotes = load();

// the notes for a filer, as the page shows them
export function notesFor(cik, notes = filingNotes) {
  const c = pad(cik);
  return notes
    .filter((n) => n.cik === c)
    .map(({ acc, kind, declared, table, declaredLines, tableLines }) => ({
      acc: acc || null,
      kind,
      declared: declared ?? null,
      table: table ?? null,
      ...(declaredLines != null ? { declaredLines, tableLines: tableLines ?? null } : {}),
    }));
}
