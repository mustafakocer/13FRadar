// The rolling feed of 13F filings as they arrive, behind /filings.
//
// EDGAR publishes one index per business day listing every filing of every
// form. The pieces here are pure so the crawl in scripts/build-filings.mjs is
// the only part that needs the network: parsing a day's index, folding it into
// the stored window, and joining what the universe scan already knows about a
// filer.
//
// Amendments matter and are kept as their own rows. A 13F-HR/A can restate a
// quarter months later, and collapsing it into the original would hide both
// that the restatement happened and what the numbers were before it.
export const FORMS = ['13F-HR', '13F-HR/A'];

// Form Type   Company Name   CIK   Date Filed   File Name
// Company names carry spaces, so the CIK and the date anchor the split.
// EDGAR writes the filing date two ways. The quarterly full index dashes it,
// 2026-09-08; the daily index does not, 20260908. The feed reads daily indexes
// and the backfill reads quarterly ones, so the parser has to take both — a
// pattern that accepts only the dashed form matches nothing in a daily index
// and reports an empty day instead of an error, which is how this shipped
// returning zero filings for eight business days in a row.
const LINE_RE = /^(13F-HR(?:\/A)?)\s+(.+?)\s+(\d{1,10})\s+(\d{4}-\d{2}-\d{2}|\d{8})\s+(\S+)\s*$/;
const ACC_RE = /(\d{10}-\d{2}-\d{6})/;

export function parseFilingIndex(text) {
  const out = [];
  if (typeof text !== 'string') return out;
  for (const line of text.split('\n')) {
    const m = LINE_RE.exec(line.trim());
    if (!m) continue;
    const [, form, name, cik, filed, file] = m;
    const acc = ACC_RE.exec(file)?.[1];
    if (!acc) continue;
    out.push({
      form,
      name: name.trim(),
      cik: String(cik).padStart(10, '0'),
      // one shape downstream, whichever index this line came from
      filed: filed.includes('-') ? filed : `${filed.slice(0, 4)}-${filed.slice(4, 6)}-${filed.slice(6, 8)}`,
      acc,
      amended: form.endsWith('/A'),
    });
  }
  return out;
}

const dayBefore = (iso, days) =>
  new Date(new Date(`${iso}T00:00:00Z`).getTime() - days * 86400000).toISOString().slice(0, 10);

// Fold a crawl's rows into the stored window: newest first, one row per
// accession, older than the window or past the row cap dropped.
//
// A re-read day costs nothing — the accession de-duplicates it — which is what
// lets the crawl overlap days rather than trust a checkpoint exactly.
export function mergeFilings(existing = [], incoming = [], { today, windowDays = 120, maxRows = 6000 } = {}) {
  const byAcc = new Map();
  for (const r of [...existing, ...incoming]) {
    if (!r?.acc || !r?.filed) continue;
    // a later read of the same accession wins: names get corrected
    byAcc.set(r.acc, { ...(byAcc.get(r.acc) || {}), ...r });
  }
  const floor = today ? dayBefore(today, windowDays) : null;
  return [...byAcc.values()]
    .filter((r) => !floor || r.filed >= floor)
    .sort((a, b) => (a.filed === b.filed ? a.acc.localeCompare(b.acc) * -1 : a.filed < b.filed ? 1 : -1))
    .slice(0, maxRows);
}

// What the weekly universe scan knows about a filer — portfolio value, how
// many positions, which quarter — attached to the filing it was computed from.
//
// The join is on the accession, not the CIK: the universe row describes one
// specific filing, and pinning its numbers to a filer's later amendment would
// state figures that filing never reported.
export function joinUniverse(rows, universeRows = []) {
  const byAcc = new Map();
  for (const u of universeRows) {
    if (u?.acc) byAcc.set(u.acc, u);
  }
  return rows.map((r) => {
    const u = byAcc.get(r.acc);
    return {
      ...r,
      // the universe's measurement, else what the feed itself read for the
      // row (an amendment's own table, see build-filings.mjs), else nothing
      aum: u?.aum ?? r.aum ?? null,
      positions: u?.positions ?? r.positions ?? null,
      reportDate: u?.reportDate ?? r.reportDate ?? null,
    };
  });
}

// Quarter label for the report period a filing covers, e.g. "2026-06-30" →
// "Q2 2026". Filings whose period is unknown group under null rather than
// being guessed from the filing date: a 13F filed in August is usually Q2 but
// an amendment filed in August can restate any quarter.
export function quarterKey(reportDate) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(reportDate || ''))) return null;
  const y = reportDate.slice(0, 4);
  const q = Math.floor((Number(reportDate.slice(5, 7)) - 1) / 3) + 1;
  return `Q${q} ${y}`;
}

export function quartersOf(rows) {
  const seen = new Map();
  for (const r of rows) {
    const k = quarterKey(r.reportDate);
    if (k) seen.set(k, (seen.get(k) || 0) + 1);
  }
  return [...seen.entries()]
    .sort((a, b) => b[0].slice(3).localeCompare(a[0].slice(3)) || b[0].localeCompare(a[0]))
    .map(([quarter, count]) => ({ quarter, count }));
}
