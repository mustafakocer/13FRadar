// Rebuild client/public/insiders-teaser.json from the committed dataset.
//
// build-insiders.mjs writes the teaser as the last step of its daily SEC
// crawl. This script does only that step, so the public preview can be
// regenerated after a change to buildTeaser without re-scraping EDGAR (and
// without an API key). The dataset's own updatedAt is carried over, so a
// rebuild never makes stale data look fresh.
//
//   node scripts/build-teaser.mjs      (npm run teaser)
import fs from 'node:fs';
import path from 'node:path';
import { buildTeaser } from '../api/_lib/insiderTeaser.js';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const DB = path.join(root, 'api', '_data', 'insiders.json');
const META = path.join(root, 'api', '_data', 'ticker-meta.json');
const OUT = path.join(root, 'client', 'public', 'insiders-teaser.json');

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
const teaser = buildTeaser(db.rows, db.companies || {}, meta, now);
fs.writeFileSync(OUT, JSON.stringify(teaser));

const p = teaser.penny;
console.log(
  `teaser: ${db.rows.length} rows → ${Math.round(fs.statSync(OUT).size / 1024)} KB · last filing day ${teaser.lastDay}`
);
console.log(
  `  penny board: ${p.rows.length} rows · ${p.stats.companies} companies · ${p.stats.buyCount} buys · ${p.stats.clusterCount} clusters`
);
