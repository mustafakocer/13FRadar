// Writes the quarterly archive report (scripts/build-report.mjs) once per
// quarter, from the nightly consensus job — it used to be a command somebody
// had to remember, and the fund pages kept linking last quarter's report.
//   node scripts/build-report-if-due.mjs            → builds when due
//   node scripts/build-report-if-due.mjs --dry-run  → says what it would do
// "Due" is reportDue() in client/src/lib/reportLink.js: the consensus quarter
// has no report yet, the 13F deadline plus a few days has passed and most of
// the tracked funds have filed. Reads only files in the repo; no network.
// The PDF (scripts/build-report-pdf.mjs) needs a built client and a Chromium
// and stays a manual step.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { reportDue } from '../client/src/lib/reportLink.js';

const root = process.cwd();
const dry = process.argv.includes('--dry-run');
const load = (rel) => {
  try {
    return JSON.parse(fs.readFileSync(path.join(root, rel), 'utf8'));
  } catch {
    return null;
  }
};

const coverage = load('api/_data/consensus-pro.json')?.coverage || load('client/public/consensus.json')?.coverage || null;
const existing = load('api/_data/reports/index.json')?.reports || [];
const today = new Date().toISOString().slice(0, 10);
const d = reportDue({ coverage, existing, today });

if (!d.due) {
  console.log(`quarterly report: nothing to build (${d.reason}; quarter ${coverage?.quarter || '?'}, filed ${coverage?.filed ?? '?'}/${coverage?.tracked ?? '?'}, on file: ${existing.join(', ') || 'none'})`);
  process.exit(0);
}
console.log(`quarterly report: ${d.id} is due (filed ${coverage.filed}/${coverage.tracked}, ${coverage.included} counted)`);
if (dry) process.exit(0);

const r = spawnSync(process.execPath, ['scripts/build-report.mjs', String(d.year), String(d.quarter)], { cwd: root, stdio: 'inherit' });
process.exit(r.status ?? 1);
