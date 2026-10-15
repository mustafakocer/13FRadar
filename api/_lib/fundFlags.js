// Which funds carry a data badge on the site (client/public/fund-flags.json,
// written nightly by scripts/check-universe-audit.mjs; read by the fund
// lists and the fund page). A fund whose current filing does not add up:
//   - a note checked by hand (config/filing-notes.json) on that filing: its
//     kind, 'cover-total' or 'incomplete-table';
//   - otherwise a deviation on tonight's list (±1% against the filer's own
//     declared total) not yet looked at: 'review', the page says it is
//     being checked;
//   - a deviation closed as a small gap (config/reviewed-deviations.json)
//     carries nothing: a few percent is not worth a badge.
//
// Pure: no files. → { byCik: { cik: { acc, kind, declared, table } } }
const pad = (cik) => String(cik || '').replace(/\D/g, '').padStart(10, '0');
const key = (cik, acc) => `${pad(cik)}|${acc || ''}`;

export const FLAG_KINDS = ['cover-total', 'incomplete-table', 'review'];

export function fundFlags({ rows = [], deviations = [], notes = [], reviewed = [] } = {}) {
  const current = new Map(rows.map((r) => [pad(r.cik), r]));
  const closed = new Set(reviewed.map((d) => key(d.cik, d.acc)));
  const byCik = {};
  for (const n of notes) {
    if (n.kind !== 'cover-total' && n.kind !== 'incomplete-table') continue;
    const row = current.get(pad(n.cik));
    // a note on an older filing says nothing about the one shown now
    if (!row || (n.acc && n.acc !== row.acc)) continue;
    byCik[pad(n.cik)] = { acc: row.acc, kind: n.kind, declared: n.declared ?? row.declared ?? null, table: n.table ?? row.aum ?? null };
  }
  for (const d of deviations) {
    const cik = pad(d.cik);
    if (byCik[cik] || closed.has(key(cik, d.acc))) continue;
    const row = current.get(cik);
    if (row && row.acc !== d.acc) continue;
    byCik[cik] = { acc: d.acc, kind: 'review', declared: d.declared ?? null, table: d.aum ?? null };
  }
  return { byCik };
}
