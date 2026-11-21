// What a non-Pro reader may see of one filing's information table.
//
// The free view is the FREE_ROWS largest rows of a filing. The portfolio page
// also shows how each of those rows changed since the quarter before, so a
// free client asks the previous filing for "these CUSIPs" (?cusips=). That
// list used to be honoured as sent: any ten CUSIPs per request, so three
// requests read a 30-line book and the top-10 limit was only a default.
//
// The rule now, decided on the server and never by the client:
//
//   of filing X, a non-Pro reader may see the rows whose CUSIP is among the
//   FREE_ROWS largest rows of X itself, or of the filing the same filer made
//   for the following period (the rows the free view of that later filing
//   shows, whose change against X the page draws).
//
// A requested CUSIP outside that set is dropped without a word; the answer
// is `locked` whenever the book holds more than it returns.
export const FREE_ROWS = 10;

const norm = (c) => String(c || '').trim().toUpperCase();

// ?cusips=A,B,C → at most FREE_ROWS well-formed CUSIPs, upper-cased.
export function parseCusipFilter(raw) {
  return [
    ...new Set(
      String(raw || '')
        .split(',')
        .map(norm)
        .filter((s) => /^[A-Z0-9]{8,9}$/.test(s))
    ),
  ].slice(0, FREE_ROWS);
}

// The CUSIPs of the largest `rows` rows of a book already sorted by value.
export function topCusips(positions = [], rows = FREE_ROWS) {
  return new Set((positions || []).slice(0, rows).map((p) => norm(p.cusip)).filter(Boolean));
}

// The rows a non-Pro answer carries. `positions` is the filing's book,
// largest first; `filter` the parsed ?cusips= list (empty = the plain free
// view); `nextTop` the following period's free-view CUSIPs (topCusips), or
// null when there is none or it could not be read (then only the filing's
// own top rows are allowed: failing closed).
export function freeRows(positions = [], filter = [], nextTop = null) {
  const list = positions || [];
  if (!filter.length) return list.slice(0, FREE_ROWS);
  const allowed = topCusips(list);
  for (const c of nextTop || []) allowed.add(norm(c));
  const want = new Set(filter.map(norm).filter((c) => allowed.has(c)));
  return list.filter((p) => want.has(norm(p.cusip)));
}

// The period filed right after `filing` in a newest-first list13F() list, or
// null when `filing` is the newest (or not in the list).
export function followingFiling(filings = [], filing = null) {
  if (!filing) return null;
  const i = filings.findIndex((f) => f.acc === filing.acc);
  return i > 0 ? filings[i - 1] : null;
}
