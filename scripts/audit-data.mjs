// The gate. Run it after a build writes its files and before anything commits
// them: a non-zero exit means the data is not publishable and the run should
// stop with the old files still live.
//
//   node scripts/audit-data.mjs              audit everything
//   node scripts/… --only=insiders,…         audit only what this build wrote
//   AUDIT_ALLOW_DRIFT=1 node scripts/…       an intended jump is a warning
//   AUDIT_REPORT=0 node scripts/…            do not write the report file
//
// A build audits what it produced. Auditing everything from every workflow
// would let one bad file stop three unrelated jobs, and a gate that locks the
// whole pipeline over something it did not touch gets switched off.
//
// The baseline is the last committed copy of each file, read straight out of
// git. That is exactly the version now live, so "how far has this moved" is
// asked against what readers are looking at rather than some stored snapshot
// that can itself go stale.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { DATASETS, auditAll, worstOf } from '../api/_lib/dataAudit.js';

const root = process.cwd();
const ALLOW_DRIFT = process.env.AUDIT_ALLOW_DRIFT === '1';
const WRITE_REPORT = process.env.AUDIT_REPORT !== '0';
const REPORT = path.join(root, 'client', 'public', 'data-audit.json');

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
  } catch {
    return null;
  }
}

// The committed version of a file. A file added in this very run has none, and
// neither does a fresh clone with no history, so failure here is ordinary.
function readCommitted(file) {
  try {
    const out = execFileSync('git', ['show', `HEAD:${file}`], {
      encoding: 'utf8',
      maxBuffer: 256 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return JSON.parse(out);
  } catch {
    return null;
  }
}

const onlyArg = process.argv.find((a) => a.startsWith('--only='));
const only = onlyArg
  ? onlyArg
      .slice('--only='.length)
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
  : null;

if (only) {
  const known = new Set(DATASETS.map((d) => d.key));
  const unknown = only.filter((k) => !known.has(k));
  // A typo here would quietly audit nothing at all, which is worse than no
  // gate, because the log would still say the data is clear to commit.
  if (unknown.length) {
    console.error(`Unknown dataset(s): ${unknown.join(', ')}\nKnown: ${[...known].join(', ')}`);
    process.exit(2);
  }
}

const specs = only ? DATASETS.filter((d) => only.includes(d.key)) : DATASETS;
const entries = specs.map((spec) => ({
  spec,
  current: readJson(spec.path),
  baseline: readCommitted(spec.path),
}));

const report = auditAll(entries, { allowDrift: ALLOW_DRIFT });

const MARK = { ok: 'ok   ', info: 'info ', warn: 'WARN ', error: 'ERROR' };
for (const d of report.datasets) {
  const worst = d.findings.reduce(
    (w, f) => (['ok', 'info', 'warn', 'error'].indexOf(f.severity) > ['ok', 'info', 'warn', 'error'].indexOf(w) ? f.severity : w),
    'ok'
  );
  const counts = Object.entries(d.metrics)
    .map(([k, v]) => `${k} ${v}`)
    .join(', ');
  console.log(`${MARK[worst]} ${d.key.padEnd(16)} ${counts}`);
  for (const f of d.findings) {
    if (f.severity === 'info' && f.rule === 'drift') continue; // first build, nothing to say
    console.log(`        ${f.severity === 'error' ? '✗' : f.severity === 'warn' ? '!' : '·'} ${f.rule}: ${f.message}`);
  }
}

// The report is deliberately free of a wall-clock stamp: it would change on
// every run and turn a no-op rebuild into a commit. It moves only when the
// data moves, which is what makes it safe to commit alongside.
if (WRITE_REPORT) {
  const fresh = new Map(
    report.datasets.map((d) => [
      d.key,
      {
        key: d.key,
        path: d.path,
        metrics: d.metrics,
        findings: d.findings.map(({ rule, severity, message }) => ({ rule, severity, message })),
      },
    ])
  );
  // A partial run must not blank out the datasets it did not look at: each
  // build refreshes its own rows and leaves the others as the last build that
  // owned them left them.
  const kept = (readJson('client/public/data-audit.json')?.datasets || []).filter((d) => !fresh.has(d.key));
  const order = DATASETS.map((d) => d.key);
  const datasets = [...fresh.values(), ...kept].sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key));
  const slim = { worst: worstOf(datasets.flatMap((d) => d.findings.map((f) => f.severity))), datasets };
  fs.mkdirSync(path.dirname(REPORT), { recursive: true });
  fs.writeFileSync(REPORT, `${JSON.stringify(slim, null, 2)}\n`);
}

const errors = report.datasets.flatMap((d) => d.findings.filter((f) => f.severity === 'error'));
const warns = report.datasets.flatMap((d) => d.findings.filter((f) => f.severity === 'warn'));

console.log('');
for (const f of warns) console.log(`::warning::${f.dataset}: ${f.message}`);

if (errors.length) {
  for (const f of errors) console.log(`::error::${f.dataset}: ${f.message}`);
  console.error(
    `\n${errors.length} blocking problem(s). Nothing is committed — the live data stays as it is.\n` +
      'If this jump is real and intended, re-run with AUDIT_ALLOW_DRIFT=1 (drift only; a floor or a missing key is never waved through).'
  );
  process.exit(1);
}
console.log(`Data audit: ${report.worst}${warns.length ? ` (${warns.length} warning(s))` : ''} — clear to commit.`);
