import fs from 'node:fs';
import path from 'node:path';
import { seriesIndex } from './priceStore.js';
import { listingLookup } from '../../client/src/lib/newListings.js';

// The new-listings file (client/src/lib/newListings.js says what it is for):
// every priced security whose history starts later than the price store's
// ten-year floor, with the CUSIPs that map to its ticker.
//
// The floor is the earliest first day in the store (every series fetched in
// full starts there, 2016-09-23 today); a series starting within FLOOR_DAYS
// of it is an old stock. Only the last KEEP_DAYS of listings are kept: the
// rule looks at one quarter at a time. A new ETF (sector "ETF" in
// api/_data/sector-map.json) is neither an IPO nor a spin-off — a fund buys
// it in the market — so it is not listed.
const DAY = 86_400_000;
const FLOOR_DAYS = 30;
const KEEP_DAYS = 400;

export function buildNewListings({ index = seriesIndex(), cusipTickers = {}, sectorOf = {}, now = Date.now() } = {}) {
  const froms = [...index.values()].map((s) => s.from).filter(Boolean).sort();
  const floor = froms[0];
  if (!floor) return { updatedAt: new Date(now).toISOString(), rows: [] };
  const old = new Date(Date.parse(floor) + FLOOR_DAYS * DAY).toISOString().slice(0, 10);
  const since = new Date(now - KEEP_DAYS * DAY).toISOString().slice(0, 10);
  const cusipsOf = new Map();
  for (const [cusip, t] of Object.entries(cusipTickers)) {
    if (!t) continue;
    const k = String(t).toUpperCase();
    if (!cusipsOf.has(k)) cusipsOf.set(k, []);
    cusipsOf.get(k).push(String(cusip).toUpperCase());
  }
  const rows = [];
  for (const [t, s] of index) {
    if (!s.from || s.from <= old || s.from < since) continue;
    if (sectorOf[t] === 'ETF') continue;
    rows.push({ t, c: (cusipsOf.get(t.toUpperCase()) || []).sort(), d: s.from });
  }
  rows.sort((a, b) => a.d.localeCompare(b.d) || a.t.localeCompare(b.t));
  return { updatedAt: new Date(now).toISOString(), floor, rows };
}

const FILE = () => path.join(process.cwd(), 'client', 'public', 'new-listings.json');

export function writeNewListings(file, out = FILE()) {
  fs.writeFileSync(out, JSON.stringify(file));
  return file;
}

// id → first trading day, from the written file (null when there is none).
export function loadListedOn(file = FILE()) {
  try {
    return listingLookup(JSON.parse(fs.readFileSync(file, 'utf8')));
  } catch {
    return () => null;
  }
}
