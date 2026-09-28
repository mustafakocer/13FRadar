// Is every dataset the site serves actually current?
//
//   node scripts/check-freshness.mjs        (npm run check:freshness)
//
// Exits non-zero when any dataset is behind, so the scheduled run turns red
// and the workflow's notify step emails us. The rules — every one judged by a
// date inside the data, not by when the file was written — live in
// api/_lib/freshnessChecks.js, next to their tests.
import fs from 'node:fs';
import path from 'node:path';
import { runChecks } from '../api/_lib/freshnessChecks.js';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const read = (file) => {
  try {
    return JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
  } catch {
    return null;
  }
};

// job health records (api/_data/freshness/<dataset>.json)
const health = {};
const dir = path.join(root, 'api', '_data', 'freshness');
for (const f of fs.existsSync(dir) ? fs.readdirSync(dir) : []) {
  if (f.endsWith('.json')) health[f.replace(/\.json$/, '')] = read(`api/_data/freshness/${f}`);
}

const rows = runChecks(read, { health });
const w = Math.max(...rows.map((r) => r.label.length));
for (const r of rows) console.log(`${r.label.padEnd(w)}  ${r.status.padEnd(7)}  ${r.detail}`);

const bad = rows.filter((r) => r.status !== 'ok' && r.status !== 'WARN');
if (bad.length) {
  console.error(`\n${bad.length} dataset(s) stale, missing or failing:`);
  for (const r of bad) console.error(`::error::${r.label}: ${r.detail}`);
  process.exit(1);
}
console.log('\nAll datasets current.');
