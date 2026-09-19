// Sector and market cap for the securities the curated funds hold, so the
// ownership rankings and the screener can filter by them.
//
// Sector comes from the SIC code on each filer's SEC submissions feed, one
// request per company, which is why it is kept in a committed map
// (api/_data/sector-map.json) and never refetched: a company's sector changes
// about as often as its name. Market cap is a share count times today's
// price and is re-priced every run (see stockMetaBuild.js).
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

export function loadSectorMap() {
  const override = process.env.SECTOR_MAP_FILE;
  try {
    const raw = override
      ? JSON.parse(fs.readFileSync(path.resolve(override), 'utf8'))
      : require('../_data/sector-map.json');
    return raw?.bySymbol && typeof raw.bySymbol === 'object' ? raw : { updatedAt: null, bySymbol: {} };
  } catch {
    return { updatedAt: null, bySymbol: {} };
  }
}

// Which symbols still need a profile lookup, most-held first, bounded by the
// per-run budget. A symbol already resolved to null (no sector reported) is
// not retried: the provider is not going to change its mind tomorrow.
export function sectorsToFetch(stocks, map, budget) {
  const known = map?.bySymbol || {};
  const out = [];
  for (const s of stocks) {
    if (out.length >= budget) break;
    if (!s.ticker || s.ticker in known) continue;
    out.push(s.ticker);
  }
  return out;
}

// Fold a batch of lookups into the stored map. Values are kept even when they
// are null so the symbol is not asked about again.
export function mergeSectors(map, found) {
  const bySymbol = { ...(map?.bySymbol || {}) };
  for (const [sym, sector] of Object.entries(found || {})) {
    bySymbol[String(sym).toUpperCase()] = sector ?? null;
  }
  // the file also carries market caps and the fund flags; they ride along
  return { ...(map || {}), updatedAt: new Date().toISOString(), bySymbol };
}

// Market cap buckets, matching the sizes the rest of the site filters by.
export function capBucket(marketCap) {
  if (!marketCap || marketCap <= 0) return null;
  if (marketCap >= 200e9) return 'mega';
  if (marketCap >= 10e9) return 'large';
  if (marketCap >= 2e9) return 'mid';
  if (marketCap >= 300e6) return 'small';
  return 'micro';
}

// Stamp sector, market cap and its bucket onto the per-security rows. Missing
// values stay null — the UI hides a filter it has no data for rather than
// silently dropping rows that simply were not looked up yet.
export function applyStockMeta(stocks, { sectors = {}, marketCaps = {} } = {}) {
  return stocks.map((s) => {
    const sym = s.ticker ? String(s.ticker).toUpperCase() : null;
    const marketCap = sym && marketCaps[sym] != null ? marketCaps[sym] : null;
    return {
      ...s,
      sector: (sym && sectors[sym]) || null,
      marketCap,
      cap: capBucket(marketCap),
    };
  });
}
