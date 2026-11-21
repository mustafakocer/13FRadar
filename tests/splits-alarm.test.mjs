// The split table's nightly re-check must not fail in silence. Twelve Data
// refused /splits on the free plan from 2026-10-02: every run was green, the
// table was rewritten unchanged, `checked` stayed {} and the freshness check
// (which read the file's write time) said "ok" for seven weeks.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { classifySplitError, recheckSpan, recheckSplits, splitsRunRecord } from '../api/_lib/splitsRun.js';
import { flushProviderHealth, noteProvider, providerActions, issueTitle } from '../api/_lib/providerAlarm.js';
import { judgeSplits, runChecks, SPLITS_RECHECK_MAX_DAYS, SPLITS_ROTATION_MAX_DAYS } from '../api/_lib/freshnessChecks.js';

// the provider's own words, from the nightly log of 2026-11-20
const PLAN_REFUSAL = 'TwelveData: /splits is available exclusively with grow or pro or ultra or venture or enterprise plans. Consider upgrading your API Key now at https://twelvedata.com/pricing';
const QUOTA = 'TwelveData: You have run out of API credits for the current minute. 9 API credits were used, with the current limit being 8. Wait for the next minute or consider switching to a higher tier plan at https://twelvedata.com/pricing';
const quiet = { warn() {}, log() {} };
const NOW = Date.parse('2026-11-20T08:00:00Z');

test('a plan refusal, a used-up quota and a blip are told apart', () => {
  assert.equal(classifySplitError(PLAN_REFUSAL), 'refused');
  assert.equal(classifySplitError('TwelveData: HTTP 403'), 'refused');
  assert.equal(classifySplitError(QUOTA), 'quota', 'the quota message also says "plan"; it is still a quota');
  assert.equal(classifySplitError('TwelveData: HTTP 429'), 'quota');
  assert.equal(classifySplitError('timeout of 15000ms exceeded'), 'error');
  assert.equal(classifySplitError('TwelveData: **symbol** not found: ZZZZ'), 'error');
});

test('the provider refusing /splits is recorded and opens the provider alarm once', async () => {
  const notes = [];
  const byTicker = { AAPL: [{ date: '2020-08-31', ratio: 4 }] };
  const checked = {};
  const run = await recheckSplits({
    queue: ['AAPL', 'SOXX', 'ITA'],
    today: '2026-11-20',
    byTicker,
    checked,
    log: quiet,
    get: async () => {
      throw new Error(PLAN_REFUSAL);
    },
    note: (name, answer) => {
      notes.push([name, answer]);
      noteProvider(name, answer);
    },
  });
  assert.deepEqual({ candidates: run.candidates, rechecked: run.rechecked, failed: run.failed }, { candidates: 3, rechecked: 0, failed: 1 }, 'stops at the first refusal');
  assert.equal(run.refusal, PLAN_REFUSAL);
  assert.deepEqual(checked, {}, 'nothing is marked as checked');
  assert.deepEqual(byTicker, { AAPL: [{ date: '2020-08-31', ratio: 4 }] }, 'the table keeps its entries');
  assert.equal(notes.length, 1);
  assert.equal(notes[0][1].refused, true);

  // the provider record a workflow run would commit, and what it leads to
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'splits-alarm-'));
  const [rec] = flushProviderHealth({ dir, now: '2026-11-20T03:39:00.000Z', log: quiet });
  assert.equal(rec.dataset, 'twelvedata');
  assert.equal(rec.refusals, 1);
  assert.match(rec.last_error, /split table not refreshed — \/splits/, 'the issue says which data the refusal costs');
  assert.deepEqual(providerActions([rec], []).map((a) => a.action), ['open'], 'first night: one issue');
  assert.deepEqual(providerActions([rec], [issueTitle('twelvedata')]).map((a) => a.action), ['known'], 'later nights: quiet');

  // the job's own record
  const job = splitsRunRecord({ now: '2026-11-20T03:39:00.000Z', run });
  assert.equal(job.rechecked, 0);
  assert.equal(job.refused, 1);
  assert.equal(job.known_issue, 'twelvedata');
  assert.match(job.last_error, /refuses \/splits/);
  assert.equal(job.last_success_at, null);
});

test('answers are parsed, marked as checked and counted; a quota stop is not an error', async () => {
  const byTicker = {};
  const checked = {};
  const bodies = {
    AAPL: { splits: [{ date: '2020-08-31', from_factor: 1, to_factor: 4 }, { date: '2014-06-09', from_factor: 1, to_factor: 7 }] },
    KO: { splits: [] },
    BAD: { splits: [{ date: 'n/a', from_factor: 1, to_factor: 2 }, { date: '2021-01-04', from_factor: 0, to_factor: 2 }, { date: '2022-01-04', from_factor: 3, to_factor: 3 }] },
  };
  const run = await recheckSplits({
    queue: ['AAPL', 'KO', 'BAD', 'MSFT', 'NVDA'],
    today: '2026-11-20',
    byTicker,
    checked,
    log: quiet,
    get: async (t) => {
      if (!bodies[t]) throw new Error(QUOTA);
      return bodies[t];
    },
  });
  assert.deepEqual(byTicker.AAPL, [{ date: '2014-06-09', ratio: 7 }, { date: '2020-08-31', ratio: 4 }], 'oldest first');
  assert.deepEqual(byTicker.KO, []);
  assert.deepEqual(byTicker.BAD, [], 'no date, a zero factor and a 1:1 are not splits');
  assert.deepEqual(checked, { AAPL: '2026-11-20', KO: '2026-11-20', BAD: '2026-11-20' });
  assert.equal(run.rechecked, 3);
  assert.ok(run.quota && !run.refusal);
  const job = splitsRunRecord({ now: '2026-11-20T03:39:00.000Z', run });
  assert.equal(job.last_error, null);
  assert.equal(job.last_success_at, '2026-11-20T03:39:00.000Z');
  assert.equal(job.quota_stop, true);
});

test('zero re-checks with candidates is an error unless the quota cut the night short', () => {
  const prev = { last_success_at: '2026-11-18T03:00:00.000Z' };
  const failedAll = splitsRunRecord({ prev, now: '2026-11-20T03:00:00.000Z', run: { candidates: 60, rechecked: 0, failed: 60 } });
  assert.equal(failedAll.last_error, '0 of 60 tickers re-checked (60 failed)');
  assert.equal(failedAll.last_success_at, prev.last_success_at, 'the last real success is kept');
  assert.equal(failedAll.known_issue, null, 'not a known issue: this one must turn the check red');

  const quotaOnly = splitsRunRecord({ prev, now: '2026-11-20T03:00:00.000Z', run: { candidates: 60, rechecked: 0, failed: 1, quota: QUOTA } });
  assert.equal(quotaOnly.last_error, null, 'one night without credits is not an alarm; the date rule speaks if it lasts');

  const noKey = splitsRunRecord({ now: '2026-11-20T03:00:00.000Z', run: { candidates: 3290 }, reason: 'split table not refreshed: TWELVEDATA_API_KEY is not set' });
  assert.match(noKey.last_error, /TWELVEDATA_API_KEY is not set/);

  const nothingToDo = splitsRunRecord({ now: '2026-11-20T03:00:00.000Z', run: { candidates: 0, rechecked: 0, failed: 0 } });
  assert.equal(nothingToDo.last_error, null);
});

test('the freshness check reads the re-check days, not when the file was written', () => {
  // the table as it stood on 2026-11-20: written that night, nothing checked
  const rotten = { updatedAt: '2026-11-20T03:39:01.000Z', dataChangedAt: '2026-09-22', checked: {}, byTicker: { AAPL: [], SOXX: [] } };
  const v = judgeSplits(rotten, NOW);
  assert.equal(v.ok, false);
  assert.match(v.detail, /no ticker has been re-checked \(0 of 2\)/);
  assert.equal(judgeSplits({ updatedAt: '2026-11-20T03:39:01.000Z', byTicker: {} }, NOW).ok, false, 'no `checked` at all');

  assert.deepEqual(recheckSpan({ checked: { A: '2026-11-19', B: '2026-10-01', C: 'soon' } }), { count: 2, newest: '2026-11-19', oldest: '2026-10-01' });
  assert.equal(judgeSplits({ checked: { A: '2026-11-19', B: '2026-10-01' }, byTicker: { A: [], B: [] } }, NOW).ok, true);

  const stopped = judgeSplits({ checked: { A: '2026-11-10', B: '2026-10-01' }, byTicker: { A: [], B: [] } }, NOW);
  assert.equal(stopped.ok, false, `no re-check for more than ${SPLITS_RECHECK_MAX_DAYS} days`);
  assert.match(stopped.detail, /newest re-check 2026-11-10/);

  const stuck = judgeSplits({ checked: { A: '2026-11-19', B: '2026-06-01' }, byTicker: { A: [], B: [] } }, NOW);
  assert.equal(stuck.ok, false, `a ticker not reached for more than ${SPLITS_ROTATION_MAX_DAYS} days`);
  assert.match(stuck.detail, /rotation is not reaching every ticker/);
});

test('in the report: STALE on its own, WARN while the provider refusal is the known cause', () => {
  const rotten = { updatedAt: '2026-11-20T03:39:01.000Z', dataChangedAt: '2026-09-22', checked: {}, byTicker: { AAPL: [] } };
  const read = (f) => (f === 'api/_data/splits.json' ? rotten : null);
  const row = (health) => runChecks(read, { now: NOW, health }).filter((r) => /splits/.test(r.label));

  const alone = row({});
  assert.deepEqual(alone.map((r) => [r.label, r.status]), [['share splits', 'STALE']], 'a table nobody re-checks is a failure');

  const refused = splitsRunRecord({ now: '2026-11-20T03:39:00.000Z', run: { candidates: 60, rechecked: 0, failed: 1, refusal: PLAN_REFUSAL } });
  const known = row({ splits: refused });
  assert.deepEqual(known.map((r) => [r.label, r.status]), [['share splits', 'WARN'], ['job: splits', 'WARN']], 'reported once by the provider alarm, not twice a day here');
  assert.match(known[0].detail, /known issue \(twelvedata alarm\)/);

  const broken = splitsRunRecord({ now: '2026-11-20T03:39:00.000Z', run: { candidates: 60, rechecked: 0, failed: 60 } });
  assert.deepEqual(row({ splits: broken }).map((r) => [r.label, r.status]), [['share splits', 'STALE'], ['job: splits', 'FAILING']], 'any other cause stays red');

  // the refusal ended (a plan or another source): the old record no longer excuses a stale table
  const recovered = { ...refused, last_success_at: '2026-11-21T03:39:00.000Z', last_error: null, known_issue: null };
  assert.deepEqual(row({ splits: recovered }).map((r) => [r.label, r.status]), [['share splits', 'STALE'], ['job: splits', 'ok']]);
});

test('datasets that had no date rule are judged by a date inside them', () => {
  const files = {
    'api/_data/guru-performance.json': { updatedAt: '2026-11-20T03:39:03.475Z', asOf: '2026-11-19' },
    'client/public/guru-cards.json': { updatedAt: '2026-11-20T03:39:03.663Z', rows: [] },
    'api/_data/related.json': { updatedAt: '2026-11-20T03:39:01.853Z', related: {} },
    'client/public/filings.json': { updatedAt: '2026-11-20T03:42:51.830Z', rows: [{ filed: '2026-11-19' }, { filed: '2026-11-18' }] },
    'api/_data/fundamentals.json': { updatedAt: '2026-11-20T03:38:12.562Z', byTicker: { NVDA: { eps: { filed: '2026-08-26' }, shares: { filed: '2026-11-19' } }, KO: {} } },
    'api/_data/fpi.json': { updatedAt: '2026-11-20T02:47:37.953Z', rates: { AUD: [['2026-11-18', 0.65], ['2026-11-19', 0.65]], LKR: [['2026-11-18', 0.003]], XXX: [] } },
  };
  const labels = ['guru performance', 'guru cards (public)', 'related managers', '13F filing feed', 'fundamentals (SEC XBRL)', 'exchange rates (FPI)'];
  const status = (over = {}) => {
    const all = { ...files, ...over };
    const rows = runChecks((f) => all[f] ?? null, { now: NOW });
    return Object.fromEntries(labels.map((l) => [l, rows.find((r) => r.label === l)?.status]));
  };
  assert.deepEqual(status(), Object.fromEntries(labels.map((l) => [l, 'ok'])));

  // each file rewritten tonight with the content three weeks old
  const tonight = '2026-11-20T03:39:03.000Z';
  assert.equal(status({ 'api/_data/guru-performance.json': { updatedAt: tonight, asOf: '2026-10-30' } })['guru performance'], 'STALE');
  assert.equal(status({ 'client/public/filings.json': { updatedAt: tonight, rows: [{ filed: '2026-10-30' }] } })['13F filing feed'], 'STALE');
  assert.equal(status({ 'api/_data/fundamentals.json': { updatedAt: tonight, byTicker: { NVDA: { eps: { filed: '2026-08-26' } } } } })['fundamentals (SEC XBRL)'], 'STALE');
  assert.equal(status({ 'api/_data/fpi.json': { updatedAt: tonight, rates: { AUD: [['2026-10-30', 0.65]] } } })['exchange rates (FPI)'], 'STALE');
  assert.equal(status({ 'api/_data/fpi.json': { updatedAt: tonight, rates: {} } })['exchange rates (FPI)'], 'STALE', 'an empty table is not current');
  // the cards and the related list carry no date: they must come from the performance run
  assert.equal(status({ 'client/public/guru-cards.json': { updatedAt: '2026-11-17T03:39:03.000Z', rows: [] } })['guru cards (public)'], 'STALE');
  assert.equal(status({ 'api/_data/related.json': { updatedAt: '2026-11-17T03:39:03.000Z', related: {} } })['related managers'], 'STALE');
});
