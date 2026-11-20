// Which quarterly report a fund page links to, and when one is due to be
// built. Shared by the page (client/src/pages/Manager.jsx) and the nightly
// job (scripts/build-report-if-due.mjs), so both read a quarter the same way.

const ID_RE = /^(\d{4})-q([1-4])$/;
const DATE_RE = /^(\d{4})-(\d{2})-\d{2}$/;

// '2026-09-30' → '2026-q3'; null for anything that is not a quarter end.
export function reportIdForQuarter(quarterEnd) {
  const m = DATE_RE.exec(String(quarterEnd || ''));
  if (!m) return null;
  const month = Number(m[2]);
  if (month % 3 !== 0) return null;
  return `${m[1]}-q${month / 3}`;
}

// '2026-q3' → 20263, so ids compare as numbers; null for a malformed id.
function ordinal(id) {
  const m = ID_RE.exec(String(id || '').toLowerCase());
  return m ? Number(m[1]) * 10 + Number(m[2]) : null;
}

// The link under a fund's page.
//   latest       — newest archived report id (api/_data/reports/index.json), or null
//   quarterEnd   — the quarter the consensus is on now ('2026-09-30'), or null
// An archived report is named only while it is the current quarter's. Once
// the consensus has moved on and the new report is not written yet, the link
// goes to the live quarter page (/report) instead of calling last quarter's
// report the one to read ("2026-Q2 çeyrek raporunu oku" in mid-November).
// → { to, id }  id is null for the live page; null when there is nothing to link.
export function reportLink({ latest = null, quarterEnd = null } = {}) {
  const have = ordinal(latest);
  const want = ordinal(reportIdForQuarter(quarterEnd));
  if (have == null) return want == null ? null : { to: '/report', id: null };
  if (want != null && have < want) return { to: '/report', id: null };
  return { to: `/reports/${String(latest).toLowerCase()}`, id: String(latest).toLowerCase() };
}

// 13F-HR is due 45 days after the quarter ends; the report waits a few more
// days so late filers and amendments are in.
export const REPORT_GRACE_DAYS = 4;
// …and for most of the panel: the share of tracked funds that have filed.
export const REPORT_MIN_FILED = 0.85;

// Whether the nightly job should write the archive report for the consensus
// quarter now. Pure: the caller passes the clock.
//   coverage — consensus `coverage` { quarter, tracked, filed, included }
//   existing — report ids already on file
//   today    — 'YYYY-MM-DD' (UTC)
// → { due: true, id, year, quarter } | { due: false, reason }
export function reportDue({ coverage = null, existing = [], today = '' } = {}) {
  const id = reportIdForQuarter(coverage?.quarter);
  if (!id) return { due: false, reason: 'no-quarter' };
  if ((existing || []).map((x) => String(x).toLowerCase()).includes(id)) return { due: false, reason: 'exists' };
  const end = Date.parse(`${coverage.quarter}T00:00:00Z`);
  const now = Date.parse(`${today}T00:00:00Z`);
  if (!Number.isFinite(end) || !Number.isFinite(now)) return { due: false, reason: 'no-date' };
  const ready = end + (45 + REPORT_GRACE_DAYS) * 86400000;
  if (now < ready) return { due: false, reason: 'before-deadline' };
  const tracked = Number(coverage.tracked);
  const filed = Number(coverage.filed);
  if (!(tracked > 0) || !Number.isFinite(filed) || filed / tracked < REPORT_MIN_FILED) return { due: false, reason: 'coverage' };
  if (!(Number(coverage.included) > 0)) return { due: false, reason: 'coverage' };
  const [year, q] = id.split('-q').map(Number);
  return { due: true, id, year, quarter: q };
}
