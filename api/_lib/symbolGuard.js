// Which client-supplied symbols may reach a quote provider.
//
// /api/stock, /api/chart and /api/returns are anonymous, and each used to
// hand whatever symbol it was given to Finnhub and Twelve Data. A loop over
// made-up symbols (ZZQQXA, ZZQQXB, …) is never answered by a cache, so it
// spends the day's provider quota for everybody. A symbol is served only when
// it is well formed AND some committed dataset has carried it; anything else
// is answered here, before any upstream call.
//
// "Carried" is deliberately wide — every page that links to /stock/<symbol>
// takes its symbols from one of these:
//   1. knownSymbol(): ticker-meta, returns.json, cusip-tickers, stocks.json,
//      guru-stocks (the curated funds' books)
//   2. the nightly price archive (api/_data/prices) — benchmarks, ETFs, and
//      BRK.B / BRK-B as one file
//   3. the security master (every CUSIP a 13F filer reported that resolved
//      to a ticker) and the Congress rows — read only when 1 and 2 miss, so
//      the common case costs no extra parse on a cold start
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { knownSymbol } from './priceSnapshot.js';
import { pricesDir, seriesKey } from './priceStore.js';
import { readServed } from './congressStore.js';

const require = createRequire(import.meta.url);

// Letters and digits, with a class/unit separator inside (BRK.B, BF-B). The
// page route accepts the same shape (api/_lib/ssr/routes.js).
export const SYMBOL_RE = /^[A-Z0-9][A-Z0-9.\-]{0,11}$/;
export const wellFormedSymbol = (s) => SYMBOL_RE.test(String(s || ''));

let archive;
function archiveKeys() {
  if (archive) return archive;
  archive = new Set();
  try {
    for (const name of fs.readdirSync(pricesDir())) {
      if (name.endsWith('.json') && !name.startsWith('_')) archive.add(name.slice(0, -5));
    }
  } catch {
    /* the archive is not bundled with every function */
  }
  return archive;
}

let longTail;
function longTailSymbols() {
  if (longTail) return longTail;
  longTail = new Set();
  const add = (t) => {
    if (t) longTail.add(seriesKey(t));
  };
  try {
    // the literal path is what lets Vercel's tracer bundle the file
    const master = process.env.SECURITY_MASTER_FILE
      ? JSON.parse(fs.readFileSync(process.env.SECURITY_MASTER_FILE, 'utf8'))
      : require('../_data/security-master.json');
    for (const e of Object.values(master?.byCusip || {})) add(e?.ticker);
  } catch {
    /* no master: the other sets still answer */
  }
  try {
    for (const r of readServed().rows || []) add(r.t);
  } catch {
    /* no Congress data */
  }
  return longTail;
}

// Test seam: the sets are memoised for the life of the process.
export const resetSymbolGuardCache = () => {
  archive = undefined;
  longTail = undefined;
};

// True when the symbol is one of ours. BRK.B and BRK-B are one security: the
// separator is normalised the way the price archive names its files.
export function servableSymbol(raw) {
  const s = String(raw || '').trim().toUpperCase();
  if (!wellFormedSymbol(s)) return false;
  if (knownSymbol(s)) return true;
  const key = seriesKey(s);
  if (!key) return false;
  if (key !== s && (knownSymbol(key) || knownSymbol(key.replace(/-/g, '.')))) return true;
  if (archiveKeys().has(key)) return true;
  return longTailSymbols().has(key);
}
