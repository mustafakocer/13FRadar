// What a history rebuild has to fetch, decided before anything is fetched.
//
// A guru's stored history carries, per quarter, the accession it was built
// from and the amendments folded into it. When EDGAR lists a new filing —
// or a new 13F-HR/A for an old period — only the periods whose document
// set changed are read again (plus the one before the earliest change, for
// that quarter's turnover and new/exited counts); every other quarter row
// and its position rows are kept as they are. A stored entry built by the
// old snapshot logic (no `v2|` fingerprint) is read in full: its rows are
// exactly what the rebuild exists to replace.
//
// Pure, so the plan — and the dry run's request count — is testable.

export const FP_VERSION = 'v2';
export const fingerprint = (filings) =>
  `${FP_VERSION}|` + filings.map((f) => `${f.reportDate}:${f.acc}${f.amendments?.length ? `+${f.amendments.map((a) => a.acc).join('+')}` : ''}`).join(',');

const docSet = (acc, amendments = []) => [acc, ...amendments.map((a) => a.acc)].sort().join('+');

// filings: oldest → newest, from list13F. previous: the stored guru entry.
//   { mode: 'reuse' | 'incremental' | 'full',
//     fetch: [filing…]  — periods to read (the changed ones + the one before the earliest change)
//     recompute: Set(reportDate) — periods whose row is computed this run
//     keep: [reportDate…] — periods whose stored row and position rows are kept }
export function planRebuild(previous, filings, { force = false, incremental = true } = {}) {
  const fp = fingerprint(filings);
  if (!force && previous?.fp === fp) return { mode: 'reuse', fp, fetch: [], recompute: new Set(), keep: filings.map((f) => f.reportDate) };
  const stored = new Map((previous?.quarters || []).map((q) => [q.reportDate, docSet(q.acc, (q.amended || []).map((a) => ({ acc: a.acc })))]));
  const v2 = typeof previous?.fp === 'string' && previous.fp.startsWith(`${FP_VERSION}|`);
  if (force || !incremental || !v2 || !stored.size) {
    return { mode: 'full', fp, fetch: filings, recompute: new Set(filings.map((f) => f.reportDate)), keep: [] };
  }
  const changed = filings.filter((f) => stored.get(f.reportDate) !== docSet(f.acc, f.amendments || []));
  if (!changed.length) {
    // the fingerprint moved (a quarter fell out of the window) but every period
    // in it is stored as listed
    return { mode: 'reuse', fp, fetch: [], recompute: new Set(), keep: filings.map((f) => f.reportDate) };
  }
  const recompute = new Set(changed.map((f) => f.reportDate));
  const first = filings.findIndex((f) => recompute.has(f.reportDate));
  const fetch = filings.filter((f, i) => recompute.has(f.reportDate) || i === first - 1);
  const keep = filings.map((f) => f.reportDate).filter((d) => !recompute.has(d));
  return { mode: 'incremental', fp, fetch, recompute, keep };
}

// How many EDGAR requests a plan costs: a filing is a directory listing and
// an information table; an amendment adds a listing, a table and a cover
// page. `cached(cik, acc, name)` says which documents are already on disk.
export function estimateRequests(cik, plan, cached = () => false) {
  let requests = 0;
  let hits = 0;
  let docs = 0;
  const need = (acc, name) => {
    docs++;
    if (cached(cik, acc, name)) hits++;
    else requests++;
  };
  for (const f of plan.fetch) {
    need(f.acc, 'index.json');
    need(f.acc, 'infotable.xml');
    for (const a of f.amendments || []) {
      need(a.acc, 'index.json');
      need(a.acc, 'infotable.xml');
      need(a.acc, 'primary_doc.xml');
    }
  }
  return { docs, requests, hits };
}

// Seconds a request count takes at a rate, with a little slack for the
// submissions feeds and retries.
export const estimateSeconds = (requests, rps = 6, gurus = 0) => Math.round((requests + gurus) / Math.max(0.5, rps) * 1.15);
