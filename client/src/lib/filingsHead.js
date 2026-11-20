// The head of filings.json: what the filings page renders before anyone
// touches a control — its first rows, and the figures it states about the
// whole feed (how many filings, how many are amendments, the per-quarter
// counts for the filter). The server seeds this instead of the 6,000-row
// file; the page fetches the file when a filter, a search or a page past
// these rows needs it.
export const FILINGS_HEAD_ROWS = 100;

export function filingsHead(f, n = FILINGS_HEAD_ROWS) {
  if (!f || !Array.isArray(f.rows)) return f || null;
  const { rows, ...rest } = f;
  return {
    ...rest,
    rows: rows.slice(0, n),
    total: rows.length,
    amendments: rows.reduce((k, r) => k + (r.amended ? 1 : 0), 0),
  };
}
