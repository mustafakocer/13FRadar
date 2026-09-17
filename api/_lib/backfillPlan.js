// Planning for the historical backfill: which quarters to read, in what
// order, and where a run that stops halfway picks up.
//
// The work is one EDGAR quarterly index per quarter plus one info table per
// filing — about 115 million positions for 2013 onward — so it cannot run in
// one pass and must be resumable. Everything here is pure; the script around
// it does the fetching and the writing.

export const FIRST_QUARTER = { y: 2013, q: 1 };

export const quarterOf = (date) => ({
  y: date.getUTCFullYear(),
  q: Math.floor(date.getUTCMonth() / 3) + 1,
});

export const quarterKey = ({ y, q }) => `${y}Q${q}`;

export function parseQuarter(key) {
  const m = /^(\d{4})Q([1-4])$/.exec(String(key || ''));
  return m ? { y: Number(m[1]), q: Number(m[2]) } : null;
}

export const prevQuarter = ({ y, q }) => (q === 1 ? { y: y - 1, q: 4 } : { y, q: q - 1 });
export const nextQuarter = ({ y, q }) => (q === 4 ? { y: y + 1, q: 1 } : { y, q: q + 1 });

const cmp = (a, b) => a.y - b.y || a.q - b.q;

// Newest first. A backfill that starts at the oldest quarter leaves the site
// without recent depth for as long as it runs; starting at the newest means
// every completed run has made the most-asked-about years available.
export function quartersToBackfill({ from = null, today = new Date(), oldest = FIRST_QUARTER, max = 4 } = {}) {
  const newest = quarterOf(today);
  const start = from ? parseQuarter(from) : newest;
  if (!start) return [];
  const out = [];
  let cur = cmp(start, newest) > 0 ? newest : start;
  while (out.length < max && cmp(cur, oldest) >= 0) {
    out.push(quarterKey(cur));
    cur = prevQuarter(cur);
  }
  return out;
}

// Where the cursor lands after a run. It moves only past quarters that were
// actually completed: a quarter that failed halfway is read again, and the
// duplicate rows it already wrote are absorbed by the upsert.
export function advanceCursor(done, { oldest = FIRST_QUARTER } = {}) {
  if (!done.length) return { cursor: null, finished: false };
  const parsed = done.map(parseQuarter).filter(Boolean).sort(cmp);
  const lowest = parsed[0];
  if (cmp(lowest, oldest) <= 0) return { cursor: quarterKey(oldest), finished: true };
  return { cursor: quarterKey(prevQuarter(lowest)), finished: false };
}

// Rows go to the database in batches: one statement per position would take a
// week, and one statement for a quarter would exceed every payload limit.
export function chunk(rows, size = 1000) {
  if (size <= 0) throw new RangeError('chunk size must be positive');
  const out = [];
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
  return out;
}

// A filing is worth reading only once. Given what the store already has for a
// quarter, return the filings still missing — this is what makes a re-run of a
// half-finished quarter cheap instead of a full repeat.
export function missingFilings(indexRows, storedAccessions = []) {
  const have = new Set(storedAccessions);
  const seen = new Set();
  const out = [];
  for (const r of indexRows) {
    if (!r?.acc || have.has(r.acc) || seen.has(r.acc)) continue;
    seen.add(r.acc);
    out.push(r);
  }
  return out;
}

// A position as the holdings table stores it. Weight is recomputed per filing
// rather than trusted from anywhere else, and a row with no CUSIP is dropped:
// it cannot be joined to anything, and a filing that carries one is malformed
// rather than interesting.
export function holdingRows(acc, positions) {
  return positions
    .filter((p) => p && p.cusip)
    .map((p) => ({
      acc,
      cusip: String(p.cusip).toUpperCase(),
      put_call: p.putCall || '',
      issuer: p.issuer || null,
      class: p.class || null,
      value: Math.round(p.value || 0),
      shares: Math.round(p.shares || 0),
      weight: p.weight == null ? null : Number(p.weight.toFixed(4)),
    }));
}
