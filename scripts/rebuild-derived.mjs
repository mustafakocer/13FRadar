// Recomputes every derived dataset from effective snapshots, in dependency
// order, resumably.
//
//   node scripts/rebuild-derived.mjs                 everything, forced
//   node scripts/rebuild-derived.mjs --dry           print the plan and cost
//   node scripts/rebuild-derived.mjs --only=history,consensus
//   REBUILD_CIKS=0001067983,0001336528 node scripts/rebuild-derived.mjs --only=history
//
// Why this exists: the snapshot logic changed (13F-HR/A amendments are now
// folded into the quarter they correct instead of standing in for it), so
// every number derived from stored snapshots — quarterly history, time held,
// turnover, consensus, per-stock ownership, the activity pivot, related
// managers, the universe's latest-holdings snapshot, the filings feed — has
// to be recomputed once. Each step is the same script the nightly Action
// runs; each is idempotent (it rewrites its files from its inputs) and the
// history step keys on the documents it read, so a run that dies halfway is
// simply run again and only redoes the gurus it did not finish.
//
// Cost, measured against EDGAR's fair-access rate (8 req/s, SEC_RPS):
//   history    ~99 gurus × up to 40 periods × (1 table + 1 index request,
//              +2 per amendment) ≈ 8–9k requests ≈ 20–30 min; forced once,
//              then incremental (only gurus with a new document)
//   consensus  ~30 funds × 2 periods ≈ 150 requests + one Yahoo chart per
//              ticker for the returns columns ≈ 10 min
//   activity, related   local pivots over guru-history.json, seconds
//   filings    10 daily indexes + ≤150 amendment reads ≈ 2 min
//   universe   ~8,000 filers × 2 requests ≈ 45–60 min at 3 workers
//              (only its snapshot changes here: filers whose latest document
//              is an amendment now publish the folded period, ~1–3% of them)
// Memory is the history build's: the full ten-year walk of one guru at a
// time, under 1 GB. Run it where the Actions run (a 2-vCPU runner is fine)
// with SEC_USER_AGENT set; the audit gate (scripts/audit-data.mjs) runs last
// and refuses to publish a collapsed file.
import { spawnSync } from 'node:child_process';

const args = process.argv.slice(2);
const DRY = args.includes('--dry');
const only = (args.find((a) => a.startsWith('--only='))?.slice(7) || '').split(',').filter(Boolean);

const STEPS = [
  { key: 'history', cmd: 'node scripts/build-guru-history.mjs', env: { GURU_HISTORY_FORCE: '1', ...(process.env.REBUILD_CIKS ? { GURU_HISTORY_CIKS: process.env.REBUILD_CIKS } : {}) }, cost: '20–30 min (forced), ~8–9k EDGAR requests' },
  { key: 'splits', cmd: 'node scripts/build-splits.mjs', cost: '2–5 min' },
  { key: 'consensus', cmd: 'node scripts/build-consensus.mjs', cost: '~10 min' },
  { key: 'activity', cmd: 'node scripts/build-guru-activity.mjs', cost: 'seconds' },
  { key: 'related', cmd: 'node scripts/build-related.mjs', cost: 'seconds' },
  { key: 'filings', cmd: 'node scripts/build-filings.mjs', cost: '~2 min' },
  { key: 'universe', cmd: 'node scripts/build-universe.mjs && node scripts/build-slugs.mjs', cost: '45–60 min', optional: true },
  {
    key: 'audit',
    cmd: 'node scripts/audit-data.mjs --only=consensus,consensus-pro,guru-stocks,guru-history,guru-activity,returns,splits,related,filings,filer-states,sector-map,security-master',
    cost: 'seconds',
  },
];

// the universe walk is an hour on its own; it runs nightly anyway, so it is
// opt-in here (--only=universe or --all)
const wanted = STEPS.filter((s) => (only.length ? only.includes(s.key) : !s.optional || args.includes('--all')));
console.log(`${DRY ? '[dry] ' : ''}rebuild plan:`);
for (const s of wanted) console.log(`  ${s.key.padEnd(10)} ${s.cmd}   (${s.cost})`);
if (DRY) process.exit(0);

const started = Date.now();
for (const s of wanted) {
  const t0 = Date.now();
  console.log(`\n=== ${s.key} ===`);
  const r = spawnSync(s.cmd, { shell: true, stdio: 'inherit', env: { ...process.env, ...(s.env || {}) } });
  console.log(`=== ${s.key}: exit ${r.status} in ${Math.round((Date.now() - t0) / 1000)}s`);
  if (r.status !== 0) {
    console.error(`${s.key} failed — fix and re-run (completed steps are idempotent; the history build resumes from what it stored)`);
    process.exit(r.status || 1);
  }
}
console.log(`\nrebuild complete in ${Math.round((Date.now() - started) / 60000)} min — commit client/public and api/_data as the Actions do`);
