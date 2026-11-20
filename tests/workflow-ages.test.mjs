// A scheduled workflow that stops succeeding must be reported, once.
// metrics.yml failed every Monday (no METRICS_TO secret) with no alarm; the
// alert e-mails, newsletter, backup, logo and domain jobs had none either.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { EXPECTED, ageActions, ageIssueTitle, judgeWorkflowAges, lastSuccessfulRun } from '../api/_lib/workflowAges.js';

const NOW = '2026-11-20T13:17:00Z';
const expected = [
  { workflow: 'alerts.yml', maxAgeHours: 48, every: 'daily' },
  { workflow: 'metrics.yml', maxAgeHours: 9 * 24, every: 'Mondays' },
  { workflow: 'db-backup.yml', maxAgeHours: 9 * 24, every: 'Mondays' },
];

test('a workflow is overdue past its limit, or when it has never succeeded', () => {
  const rows = judgeWorkflowAges({
    now: NOW,
    expected,
    lastSuccess: { 'alerts.yml': '2026-11-19T17:26:00Z', 'metrics.yml': null, 'db-backup.yml': '2026-11-09T11:23:00Z' },
  });
  assert.deepEqual(rows.map((r) => [r.workflow, r.status]), [['alerts.yml', 'ok'], ['metrics.yml', 'overdue'], ['db-backup.yml', 'overdue']]);
  assert.match(rows[0].what, /last success 2026-11-19T17:26Z \(19h ago, limit 48h/);
  assert.match(rows[1].what, /no successful run on record/);
  assert.match(rows[2].what, /11d ago, limit 9d/);
});

test('the limit itself is still on time; one hour past it is not', () => {
  const at = (iso) => judgeWorkflowAges({ now: NOW, expected: expected.slice(0, 1), lastSuccess: { 'alerts.yml': iso } })[0].status;
  assert.equal(at('2026-11-18T13:17:00Z'), 'ok');
  assert.equal(at('2026-11-18T12:17:00Z'), 'overdue');
  assert.equal(at('2026-11-20T14:00:00Z'), 'ok', 'a run newer than the clock (skew) is not overdue');
});

test('what GitHub could not answer is unknown: it opens nothing and closes nothing', () => {
  const rows = judgeWorkflowAges({ now: NOW, expected, lastSuccess: { 'alerts.yml': 'yesterday', 'db-backup.yml': '2026-11-16T11:23:00Z' } });
  assert.deepEqual(rows.map((r) => r.status), ['unknown', 'unknown', 'ok']);
  const acts = ageActions(rows, [ageIssueTitle('alerts.yml'), ageIssueTitle('metrics.yml')]);
  assert.deepEqual(acts.map((a) => a.action), ['unknown', 'unknown', 'ok']);
});

test('reported once: open, then quiet, then closed by the next success', () => {
  const late = judgeWorkflowAges({ now: NOW, expected: expected.slice(1, 2), lastSuccess: { 'metrics.yml': null } });
  assert.deepEqual(ageActions(late, []).map((a) => [a.action, a.title]), [['open', 'Zamanlanmış iş başarıyla çalışmıyor: metrics.yml']]);
  assert.deepEqual(ageActions(late, [ageIssueTitle('metrics.yml')]).map((a) => a.action), ['known']);
  const back = judgeWorkflowAges({ now: NOW, expected: expected.slice(1, 2), lastSuccess: { 'metrics.yml': '2026-11-16T13:34:00Z' } });
  assert.deepEqual(ageActions(back, [ageIssueTitle('metrics.yml')]).map((a) => a.action), ['resolve']);
  assert.deepEqual(ageActions(back, []).map((a) => a.action), ['ok']);
});

test('the table names real workflow files, each once, and every scheduled workflow is in it', () => {
  const dir = new URL('../.github/workflows/', import.meta.url);
  const names = EXPECTED.map((e) => e.workflow);
  assert.equal(new Set(names).size, names.length);
  for (const e of EXPECTED) {
    assert.ok(fs.existsSync(new URL(e.workflow, dir)), `${e.workflow} exists`);
    assert.ok(e.maxAgeHours >= 24, `${e.workflow}: a limit under a day would ring on one late run`);
  }
  // a new scheduled workflow must be given a limit here, or listed as exempt
  const exempt = new Set([
    'freshness.yml', // runs this check; it cannot watch itself
    'insider-calibration.yml', // monthly report, also opened by pull requests
  ]);
  const scheduled = fs.readdirSync(dir).filter((f) => f.endsWith('.yml') && /^\s*schedule:/m.test(fs.readFileSync(new URL(f, dir), 'utf8')));
  assert.deepEqual(scheduled.filter((f) => !names.includes(f) && !exempt.has(f)), []);
});

test('the last success is asked for on main, successful runs only', async () => {
  const seen = [];
  const fetchImpl = async (url, init) => {
    seen.push([url, init.headers.Authorization]);
    return { ok: true, json: async () => ({ workflow_runs: url.includes('alerts.yml') ? [{ created_at: '2026-11-19T17:26:00Z' }] : [] }) };
  };
  assert.equal(await lastSuccessfulRun({ token: 't', workflow: 'alerts.yml', repo: 'o/r', fetchImpl }), '2026-11-19T17:26:00Z');
  assert.equal(await lastSuccessfulRun({ token: 't', workflow: 'metrics.yml', repo: 'o/r', fetchImpl }), null);
  assert.equal(seen[0][0], 'https://api.github.com/repos/o/r/actions/workflows/alerts.yml/runs?branch=main&status=success&per_page=1');
  assert.equal(seen[0][1], 'Bearer t');
  await assert.rejects(lastSuccessfulRun({ workflow: 'alerts.yml', repo: 'o/r', fetchImpl: async () => ({ ok: false, status: 403 }) }), /GitHub 403 listing alerts.yml runs/);
});
