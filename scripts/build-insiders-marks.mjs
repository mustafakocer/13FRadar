// Re-applies the derived marks to the committed insider dataset, offline:
// roles under the current title rules, 4/A supersession, duplicate filings
// and mirror P/S pairs (api/_lib/insiderStore.markRows — the same function
// the nightly build runs after every crawl).
//
//   node scripts/build-insiders-marks.mjs            → api/_data/insiders.json
//   node scripts/build-insiders-marks.mjs --dry-run  counts only, writes nothing
//
// For a rule change that must reach the stored rows before the next crawl,
// without reading anything from EDGAR. Every other field of the file — the
// checkpoint, updatedAt, companies, price flags, outcomes — is kept as it is,
// so a re-run changes nothing. Afterwards rebuild what is derived from it:
//   node scripts/build-insiders-served.mjs && node scripts/build-teaser.mjs
//
// Env: INSIDER_DATA_DIR (tests) — read through the insider store.
import { currentRows, files, loadRaw, loadRawBackfill, markRows, readJson, rowId, saveDataset } from '../api/_lib/insiderStore.js';

const dry = process.argv.includes('--dry-run');
const db = readJson(files.data(), null);
if (!db?.rows?.length) {
  console.error(`No dataset at ${files.data()}`);
  process.exit(1);
}
const raw = { ...loadRawBackfill(), ...(loadRaw().rows || {}) };
const before = currentRows(db.rows).length;
const roleOf = new Map(db.rows.map((r) => [r, r.r]));
const marks = markRows(db.rows, { rawOf: (r) => raw[rowId(r)] || null, companies: db.companies || {} });
const after = currentRows(db.rows).length;

const changed = {};
for (const r of db.rows) {
  const was = roleOf.get(r);
  if (was !== r.r) changed[`${was}→${r.r}`] = (changed[`${was}→${r.r}`] || 0) + 1;
}
console.log(
  `insiders.json: ${db.rows.length} rows · current ${before} → ${after} · ${marks.superseded} superseded by 4/A · ` +
    `${marks.duplicates} duplicate line(s) · ${marks.mirrors} mirror P/S line(s) · ${marks.roles} role(s) changed ${JSON.stringify(changed)}`
);
if (!dry) saveDataset(db);
