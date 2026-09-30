// The job triggers (api/_lib/jobTriggers.js): the schedule matches the
// Supabase migration, the guard skips a run whose window is already built,
// and the start-time check flags late or missing slots and a broken
// fpi → insiders chain.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { TRIGGERS, WINDOWS, windowStart, decideRun, checkSlots, isAutomatic } from '../api/_lib/jobTriggers.js';

const sql = fs.readFileSync(new URL('../migrations/0005_job_triggers.up.sql', import.meta.url), 'utf8');

test('TRIGGERS and the pg_cron schedules in migrations/0005 are the same', () => {
  const inSql = [...sql.matchAll(/cron\.schedule\('(gh-[a-z-]+)', '(\d+) (\d+) \* \* \*', \$\$select ops\.dispatch\('([a-z-]+\.yml)'\)\$\$\)/g)]
    .map(([, job, m, h, workflow]) => ({ job, workflow, at: `${h.padStart(2, '0')}:${m.padStart(2, '0')}` }));
  assert.deepEqual(inSql, TRIGGERS);
  // each dispatched workflow accepts inputs.trigger (GitHub answers 422 otherwise)
  for (const w of new Set(TRIGGERS.map((t) => t.workflow))) {
    const yml = fs.readFileSync(new URL(`../.github/workflows/${w}`, import.meta.url), 'utf8');
    assert.match(yml, /workflow_dispatch:\n\s+inputs:\n\s+trigger:/, w);
  }
});

test('the guarded workflows run the guard, and their build job waits for it', () => {
  for (const w of Object.keys(WINDOWS)) {
    const yml = fs.readFileSync(new URL(`../.github/workflows/${w}`, import.meta.url), 'utf8');
    assert.match(yml, new RegExp(`WORKFLOW: ${w.replace('.', '\\.')}\\n`), w);
    assert.match(yml, /  build:\n    needs: guard\n(    #.*\n)*    if: \$\{\{ !cancelled\(\) && needs\.guard\.outputs\.run != 'false' \}\}/, w);
  }
  const ins = fs.readFileSync(new URL('../.github/workflows/insiders.yml', import.meta.url), 'utf8');
  assert.match(ins, /workflow_run:\n\s+workflows: \['Foreign issuer data \(FX \+ ADR ratios\)'\]\n\s+types: \[completed\]\n/);
  assert.doesNotMatch(ins, /types: \[completed\]\n\s+branches:/);
  // fpi.yml dispatches insiders.yml itself, as an automatic ('chain') run
  const fpi = fs.readFileSync(new URL('../.github/workflows/fpi.yml', import.meta.url), 'utf8');
  assert.match(fpi, /  chain:\n    needs: \[guard, build\]\n/);
  assert.match(fpi, /gh workflow run insiders\.yml --ref main -f trigger=chain/);
  assert.match(fpi, /  chain:[\s\S]*permissions:\n      actions: write/);
  const fpiName = fs.readFileSync(new URL('../.github/workflows/fpi.yml', import.meta.url), 'utf8').match(/^name: (.*)$/m)[1];
  assert.equal(fpiName, 'Foreign issuer data (FX + ADR ratios)');
});

test('windowStart: the latest slot at or before now, yesterday before the first slot', () => {
  assert.equal(windowStart(['02:47', '11:02'], '2026-09-30T03:05:00Z').toISOString(), '2026-09-30T02:47:00.000Z');
  assert.equal(windowStart(['02:47', '11:02'], '2026-09-30T17:00:00Z').toISOString(), '2026-09-30T11:02:00.000Z');
  assert.equal(windowStart(['02:47', '11:02'], '2026-09-30T01:00:00Z').toISOString(), '2026-09-29T11:02:00.000Z');
  assert.equal(windowStart(['02:47'], '2026-09-30T02:47:00Z').toISOString(), '2026-09-30T02:47:00.000Z');
});

const run = (id, created_at, event, built = true) => ({ id, created_at, event, built });

test('decideRun: a person and a push always run', () => {
  const runs = [run(1, '2026-09-30T02:48:00Z', 'workflow_dispatch')];
  for (const [event, trigger] of [['workflow_dispatch', 'manual'], ['workflow_dispatch', null], ['push', null], ['pull_request', null]]) {
    assert.equal(decideRun({ workflow: 'fpi.yml', event, trigger, now: '2026-09-30T09:00:00Z', runs, selfId: 2 }).run, true, `${event}/${trigger}`);
  }
});

test('decideRun: the late GitHub fallback skips a window the cron already built', () => {
  // fpi: cron 02:47 built; GitHub's 02:47 schedule arrives at 09:05
  const fpi = [run(2, '2026-09-30T09:05:00Z', 'schedule', false), run(1, '2026-09-30T02:47:10Z', 'workflow_dispatch')];
  const d = decideRun({ workflow: 'fpi.yml', event: 'schedule', now: '2026-09-30T09:05:30Z', runs: fpi, selfId: 2 });
  assert.equal(d.run, false);
  assert.match(d.reason, /run 1/);
  // insiders chained after that skipped fpi: the morning window is built by the 03:00 run
  const ins = [run(5, '2026-09-30T09:06:00Z', 'workflow_run', false), run(4, '2026-09-30T02:58:00Z', 'workflow_run')];
  assert.equal(decideRun({ workflow: 'insiders.yml', event: 'workflow_run', now: '2026-09-30T09:06:10Z', runs: ins, selfId: 5 }).run, false);
  // GitHub's 03:31 fallback at 10:00: same window, skip
  assert.equal(decideRun({ workflow: 'insiders.yml', event: 'schedule', now: '2026-09-30T10:00:00Z', runs: ins, selfId: 6 }).run, false);
});

test('decideRun: the fpi → insiders dispatch (chain) is automatic and skips a built window', () => {
  assert.equal(isAutomatic('workflow_dispatch', 'chain'), true);
  assert.equal(isAutomatic('workflow_dispatch', 'cron'), true);
  assert.equal(isAutomatic('workflow_dispatch', 'manual'), false);
  const ins = [run(4, '2026-09-30T02:49:00Z', 'workflow_dispatch')];
  assert.equal(decideRun({ workflow: 'insiders.yml', event: 'workflow_run', now: '2026-09-30T02:50:00Z', runs: ins, selfId: 5 }).run, false);
  assert.equal(decideRun({ workflow: 'insiders.yml', event: 'workflow_dispatch', trigger: 'chain', now: '2026-09-30T02:50:00Z', runs: ins, selfId: 5 }).run, false);
  assert.equal(decideRun({ workflow: 'insiders.yml', event: 'workflow_dispatch', trigger: 'chain', now: '2026-09-30T02:49:00Z', runs: [], selfId: 4 }).run, true);
});

test('decideRun: the 11:02 catch-up runs even though the morning built', () => {
  const ins = [run(4, '2026-09-30T02:58:00Z', 'workflow_run')];
  assert.equal(decideRun({ workflow: 'insiders.yml', event: 'workflow_dispatch', trigger: 'cron', now: '2026-09-30T11:02:20Z', runs: ins, selfId: 7 }).run, true);
});

test('decideRun: a failed or self-skipped run does not count; the fallback then does the work', () => {
  const fpi = [run(1, '2026-09-30T02:47:10Z', 'workflow_dispatch', false)];
  assert.equal(decideRun({ workflow: 'fpi.yml', event: 'schedule', now: '2026-09-30T09:05:30Z', runs: fpi, selfId: 2 }).run, true);
});

test('decideRun: a pull_request run never counts as the day built', () => {
  const fpi = [run(1, '2026-09-30T03:00:00Z', 'pull_request')];
  assert.equal(decideRun({ workflow: 'fpi.yml', event: 'schedule', now: '2026-09-30T09:05:30Z', runs: fpi, selfId: 2 }).run, true);
});

// a full day on time: every slot started by the cron within a minute
const onTime = () => ({
  'universe.yml': [{ created_at: '2026-09-30T01:23:08Z', updated_at: '2026-09-30T01:50:00Z', status: 'completed', event: 'workflow_dispatch' }],
  'fpi.yml': [{ created_at: '2026-09-30T02:47:09Z', updated_at: '2026-09-30T02:58:00Z', status: 'completed', event: 'workflow_dispatch' }],
  'insiders.yml': [
    { created_at: '2026-09-30T11:02:07Z', updated_at: '2026-09-30T11:20:00Z', status: 'completed', event: 'workflow_dispatch' },
    { created_at: '2026-09-30T02:58:20Z', updated_at: '2026-09-30T03:15:00Z', status: 'completed', event: 'workflow_run' },
  ],
  'freshness.yml': [
    { created_at: '2026-09-30T13:17:06Z', updated_at: '2026-09-30T13:18:00Z', status: 'in_progress', event: 'workflow_dispatch' },
    { created_at: '2026-09-30T07:23:05Z', updated_at: '2026-09-30T07:24:00Z', status: 'completed', event: 'workflow_dispatch' },
  ],
});

test('checkSlots: a day on time is all green, the chain included', () => {
  const rows = checkSlots({ now: '2026-09-30T13:40:00Z', runsByWorkflow: onTime() });
  assert.equal(rows.length, 6);
  assert.ok(rows.every((r) => r.ok), rows.map((r) => r.what).join('\n'));
  assert.ok(rows.some((r) => /insiders after fpi: fpi ended 02:58, insiders started 02:58/.test(r.what)));
});

test('checkSlots: the fallback 6 hours late is flagged, with the reason', () => {
  const runs = onTime();
  runs['fpi.yml'] = [{ created_at: '2026-09-30T09:05:00Z', updated_at: '2026-09-30T09:20:00Z', status: 'completed', event: 'schedule' }];
  runs['insiders.yml'].push({ created_at: '2026-09-30T09:20:30Z', updated_at: '2026-09-30T09:40:00Z', status: 'completed', event: 'workflow_run' });
  const bad = checkSlots({ now: '2026-09-30T13:40:00Z', runsByWorkflow: runs }).filter((r) => !r.ok);
  assert.equal(bad.length, 1);
  assert.match(bad[0].what, /fpi\.yml 02:47 UTC \(2026-09-30\): started 09:05 \(\+6h18m, schedule\) — late/);
});

test('checkSlots: a slot with no run at all, and insiders not following fpi', () => {
  const runs = onTime();
  runs['universe.yml'] = [];
  runs['insiders.yml'] = runs['insiders.yml'].filter((r) => r.event !== 'workflow_run');
  const bad = checkSlots({ now: '2026-09-30T13:40:00Z', runsByWorkflow: runs }).filter((r) => !r.ok).map((r) => r.what);
  assert.equal(bad.length, 2);
  assert.match(bad[0], /universe\.yml 01:23 UTC .*no run started/);
  assert.match(bad[1], /insiders after fpi: fpi ended 02:58, insiders started 11:02/);
});

test('checkSlots: a slot not yet 15 minutes old is judged on yesterday; activeFrom skips the days before go-live', () => {
  const rows = checkSlots({ now: '2026-09-30T07:30:00Z', runsByWorkflow: onTime(), activeFrom: '2026-09-30T00:00:00Z' });
  // 07:23 today is too fresh → yesterday's, before go-live → not judged; same for 11:02 and 13:17
  assert.deepEqual(rows.map((r) => r.what.slice(0, 13)), ['universe.yml ', 'fpi.yml 02:47', 'insiders afte']);
  assert.ok(rows.every((r) => r.ok));
});
