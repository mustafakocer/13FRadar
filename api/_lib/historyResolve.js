// Read-time resolution for the stored guru history.
//
// guru-history.json is written by a nightly build and stores, per position,
// the ticker OpenFIGI knew that night — null when it did not. A quarter's
// `top10` was stored as tickers-or-raw-CUSIPs. Both go stale the moment the
// security master learns a mapping (Chubb's H1467J104 sat as a raw code in
// Berkshire's history for months while the map already said CB), so the
// endpoint resolves them against the master on every read and, when even
// the master has nothing, shows the issuer name the filing carried rather
// than the identifier. Pure over the stored guru object.
import { tickerFor, labelFor, isCusipLike } from './securityMaster.js';

export const tickerOfPosition = (cusip, e) => e?.ticker || tickerFor(cusip) || null;

// One top-10 entry as the page should print it: { id, ticker, label } —
// `ticker` null when unresolved, `label` the issuer name then.
export function resolveTop10Entry(entry, positions = {}) {
  const raw = String(entry || '');
  if (!isCusipLike(raw)) return { id: raw, ticker: raw, label: raw };
  const e = positions[raw];
  const ticker = tickerOfPosition(raw, e);
  return { id: raw, ticker, label: ticker || labelFor(raw, e?.issuer || null) };
}

// The quarters with their top10 resolved, the label the UI prints in the
// place of the stored string, so a page needs no change to stop showing
// raw codes. `unresolved` counts entries that still have no ticker.
export function resolveQuarters(g) {
  let unresolved = 0;
  const quarters = (g?.quarters || []).map((q) => ({
    ...q,
    top10: (q.top10 || []).map((x) => {
      const r = resolveTop10Entry(x, g.positions);
      if (!r.ticker) unresolved++;
      return r.label;
    }),
  }));
  return { quarters, unresolved };
}

// { cusip: { quarters, ticker, firstSeen } } with tickers refreshed.
export function resolveTimeHeld(g) {
  const out = {};
  for (const [cusip, e] of Object.entries(g?.positions || {})) {
    if (e.heldQuarters > 0) out[cusip] = { quarters: e.heldQuarters, ticker: tickerOfPosition(cusip, e), firstSeen: e.firstSeen };
  }
  return out;
}

// The stored position for a ticker, by the ticker stored that night or the
// one the master knows now.
export function findPositionByTicker(g, ticker) {
  const sym = String(ticker || '').toUpperCase();
  if (!sym) return null;
  return Object.entries(g?.positions || {}).find(([cusip, e]) => tickerOfPosition(cusip, e) === sym) || null;
}

// A list of tickers-or-CUSIPs (related managers' shared names) with the
// CUSIPs resolved where the master can.
export const resolveSymbols = (list = []) => list.map((x) => (isCusipLike(x) ? tickerFor(x) || labelFor(x) : x));
