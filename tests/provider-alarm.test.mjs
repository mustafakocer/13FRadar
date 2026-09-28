// Provider refusals are known issues: one notification when it starts, silence
// while it lasts, a notification when it changes. Never a nightly red run.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { flushProviderHealth, isRefusal, issueTitle, noteProvider, providerActions } from '../api/_lib/providerAlarm.js';
import { runChecks } from '../api/_lib/freshnessChecks.js';

const rec = (dataset, { refusals = 0, calls_ok = 0 } = {}) => ({ dataset, kind: 'provider', refusals, calls_ok, last_error: refusals ? `${refusals} refusal(s): HTTP 402 Premium` : null });

test('first refusal opens one issue; the same refusal later stays quiet', () => {
  const night1 = providerActions([rec('fmp', { refusals: 3 })], []);
  assert.deepEqual(night1.map((a) => a.action), ['open']);
  assert.equal(night1[0].title, 'Veri sağlayıcı reddediyor: FMP (bilinen sorun)');
  const night2 = providerActions([rec('fmp', { refusals: 3 })], [issueTitle('fmp')]);
  assert.deepEqual(night2.map((a) => a.action), ['known'], 'already reported: warn only, nothing sent');
});

test('a change is announced: FMP recovering, or another provider starting to refuse', () => {
  const open = [issueTitle('fmp')];
  assert.deepEqual(providerActions([rec('fmp', { calls_ok: 40 })], open).map((a) => a.action), ['resolve']);
  const other = providerActions([rec('fmp', { refusals: 2 }), rec('twelvedata', { refusals: 1 }), rec('yahoo', { calls_ok: 900 })], open);
  assert.deepEqual(
    other.map((a) => [a.provider, a.action]),
    [['fmp', 'known'], ['twelvedata', 'open'], ['yahoo', 'ok']]
  );
});

test('a provider this run never called is left alone — not asked is not recovered', () => {
  assert.deepEqual(providerActions([rec('fmp')], [issueTitle('fmp')]), []);
});

test('refusal means an account problem; a used-up daily quota is not one', () => {
  assert.ok(isRefusal("HTTP 402 Premium Query Parameter: 'Special Endpoint'"));
  assert.ok(isRefusal('FMP HTTP 403'));
  assert.ok(isRefusal('Finnhub candles: not on this plan (HTTP 403)'));
  assert.ok(!isRefusal('TwelveData: You have run out of API credits for the day'));
  assert.ok(!isRefusal('Yahoo HTTP 429'));
  assert.ok(!isRefusal('ECONNRESET'));
});

test('two builds in one run add up; a later clean step does not mask an earlier refusal', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'prov-'));
  process.env.GITHUB_RUN_ID = '777';
  try {
    noteProvider('fmp', { error: 'HTTP 402 Premium' });
    noteProvider('fmp', { error: 'HTTP 402 Premium' });
    flushProviderHealth({ dir, log: { warn() {} } });
    noteProvider('fmp', { ok: true }); // the price step, same run
    const [r] = flushProviderHealth({ dir, log: { warn() {} } });
    assert.equal(r.refusals, 2);
    assert.equal(r.calls_ok, 1);
    assert.equal(r.kind, 'provider');
    assert.deepEqual(providerActions([r], []).map((a) => a.action), ['open']);
  } finally {
    delete process.env.GITHUB_RUN_ID;
  }
});

test('the freshness check shows a refusing provider as WARN, never as a failure', () => {
  const health = { fmp: { ...rec('fmp', { refusals: 3 }), last_error_at: '2026-09-28T08:00:00Z', last_success_at: '2026-09-17T08:00:00Z' } };
  const out = runChecks(() => null, { health }).find((r) => r.label === 'provider: fmp');
  assert.equal(out.status, 'WARN');
});
