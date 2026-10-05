// Rebuild client/public/insiders-teaser.json from the committed dataset.
//
// build-insiders.mjs writes the teaser as the last step of its daily SEC
// crawl. This script does only that step, so the public preview can be
// regenerated after a change to buildTeaser without re-scraping EDGAR (and
// without an API key). The dataset's own updatedAt is carried over, so a
// rebuild never makes stale data look fresh; pricedAt is the price build it
// was computed on. The consensus job runs it after the nightly prices, so
// the home page and /insiders (computed per request) read the same closes.
//
//   node scripts/build-teaser.mjs      (npm run teaser)
//
// Env: INSIDERS_DB, TICKER_META_FILE, TEASER_OUT (tests), PRICES_DIR.
import fs from 'node:fs';
import path from 'node:path';
import { buildTeaser } from '../api/_lib/insiderTeaser.js';
import { currentRows, readRawServed } from '../api/_lib/insiderStore.js';
import { readSeries, priceCacheStatus } from '../api/_lib/priceStore.js';
import { normalizeRows } from '../api/_lib/fpiNormalize.js';
import { markCompensation } from '../api/_lib/insiderNotes.js';
import { fpiContext, toUsdWith, isForeignWith } from '../api/_lib/fpiContext.js';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const DB = process.env.INSIDERS_DB || path.join(root, 'api', '_data', 'insiders.json');
const META = process.env.TICKER_META_FILE || path.join(root, 'api', '_data', 'ticker-meta.json');
const OUT = process.env.TEASER_OUT || path.join(root, 'client', 'public', 'insiders-teaser.json');

const read = (file, fallback) => {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
};

const db = read(DB, null);
if (!db?.rows?.length) {
  console.error(`No dataset at ${DB} — run "node scripts/build-insiders.mjs" first.`);
  process.exit(1);
}
const meta = read(META, {});
const now = db.updatedAt ? Date.parse(db.updatedAt) : Date.now();
// the price check needs the raw Form 4 fields and the daily closes
// every stored Form 4 field: nightly, backfilled, foreign-issuer re-reads
const raw = readRawServed();
const seriesFor = (t) => readSeries(t)?.prices || null;
// foreign issuers' lines in US dollars, as the pages serve them (fpiNormalize.js)
// …and pay taken in shares is not an open-market buy (insiderNotes.js)
const rows = markCompensation(normalizeRows(currentRows(db.rows), fpiContext({ raw, seriesFor, meta })), (r) => raw[`${r.a}:${r.li}`] || null);
const pricedAt = priceCacheStatus()?.updatedAt || null;
const teaser = buildTeaser(rows, db.companies || {}, meta, now, { raw, seriesFor, toUsd: toUsdWith(), isForeign: isForeignWith(), pricedAt });
fs.writeFileSync(OUT, JSON.stringify(teaser));

const p = teaser.penny;
console.log(
  `teaser: ${db.rows.length} rows → ${Math.round(fs.statSync(OUT).size / 1024)} KB · last filing day ${teaser.lastDay} · priced ${pricedAt || '—'}`
);
console.log(
  `  penny board: ${p.rows.length} rows · ${p.stats.companies} companies · ${p.stats.buyCount} buys · ${p.stats.clusterCount} clusters`
);
