// Which funds carry a data badge on the site (client/public/fund-flags.json,
// written nightly by scripts/check-universe-audit.mjs; read by the fund
// lists and the fund page). A fund whose current filing does not add up:
//   - a note checked by hand (config/filing-notes.json) on that filing: its
//     kind, 'cover-total', 'incomplete-table' or 'previous-table';
//   - otherwise a deviation on tonight's list (±1% against the filer's own
//     declared total) not yet looked at: 'review', the page says it is
//     being checked;
//   - a deviation closed as a small gap (config/reviewed-deviations.json)
//     carries nothing: a few percent is not worth a badge;
//   - otherwise a fund whose latest filing is for a period before `quarter`
//     (the latest one past its filing deadline): 'stale', an old filing
//     with nothing newer.
//
// Pure: no files. → { byCik: { cik: { acc, kind, declared, table, reportDate? } } }
const pad = (cik) => String(cik || '').replace(/\D/g, '').padStart(10, '0');
const key = (cik, acc) => `${pad(cik)}|${acc || ''}`;

export const NOTE_KINDS = ['cover-total', 'incomplete-table', 'previous-table'];
export const FLAG_KINDS = [...NOTE_KINDS, 'review', 'stale'];

export function fundFlags({ rows = [], deviations = [], notes = [], reviewed = [], quarter = null } = {}) {
  const current = new Map(rows.map((r) => [pad(r.cik), r]));
  const closed = new Set(reviewed.map((d) => key(d.cik, d.acc)));
  const byCik = {};
  for (const n of notes) {
    if (!NOTE_KINDS.includes(n.kind)) continue;
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
  if (quarter) {
    for (const r of rows) {
      const cik = pad(r.cik);
      if (byCik[cik] || r.misfiled || !r.reportDate || r.reportDate >= quarter) continue;
      byCik[cik] = { acc: r.acc, kind: 'stale', declared: null, table: null, reportDate: r.reportDate };
    }
  }
  return { byCik };
}
