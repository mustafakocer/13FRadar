// Exit non-zero when a job's health record (api/_data/freshness/<name>.json)
// says it is failing now — used by workflows right after the build, so a
// refusal pages us the same night instead of at the next freshness check.
//
//   node scripts/check-job-health.mjs fmp
import fs from 'node:fs';
import path from 'node:path';
import { judgeHealth } from '../api/_lib/freshnessChecks.js';

const name = process.argv[2];
const file = path.join(process.cwd(), 'api', '_data', 'freshness', `${name}.json`);
if (!name || !fs.existsSync(file)) {
  console.log(`no health record for ${name || '(none given)'} — nothing to check`);
  process.exit(0);
}
const v = judgeHealth(JSON.parse(fs.readFileSync(file, 'utf8')));
console.log(`${name}: ${v.ok ? 'ok' : 'FAILING'} — ${v.detail}`);
if (!v.ok) {
  console.error(`::error::${name}: ${v.detail}`);
  process.exit(1);
}
