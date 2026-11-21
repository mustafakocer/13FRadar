// The positions table's "since quarter end" column: the percent move from
// the close at the filing's quarter end (the 13F report date) to the latest
// close. The base is the QUARTER END, never the day the 13F was filed —
// a 13F shows the book as of the report date, ~45 days before it is public.
// Both closes must come from one split-adjusted series. One decimal; null
// when either side is missing or not a positive finite price.
export function sinceQuarterEnd(quarterEndClose, lastClose) {
  const qe = Number(quarterEndClose);
  const last = Number(lastClose);
  if (!Number.isFinite(qe) || !Number.isFinite(last) || qe <= 0 || last <= 0) return null;
  return Number((((last - qe) / qe) * 100).toFixed(1));
}
