import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { root } from './helpers.mjs';
import { RateClock } from '../api/_lib/edgarClock.js';
import { planRebuild, estimateRequests, estimateSeconds, fingerprint } from '../api/_lib/historyPlan.js';

// Ek B — the EDGAR load: adaptive rate clock, disk cache, incremental history walk.

test('the rate clock backs off on a rate-limit answer and recovers after a clean run', () => {
  let now = 0;
  const c = new RateClock({ rps: 8, floor: 1, cooldownMs: 60_000, recoverAfter: 10, now: () => now });
  assert.equal(c.take(), 0, 'first request goes now');
  assert.equal(c.take(), 125, 'second waits one slot at 8/s');
  now = 10_000;
  c.noteRateLimited();
  assert.equal(c.rate, 4, 'halved');
  c.noteRateLimited();
  assert.equal(c.rate, 2);
  for (let i = 0; i < 5; i++) c.noteRateLimited();
  assert.equal(c.rate, 1, 'never under the floor');
  c.take();
  assert.equal(c.take(), 1000, 'now one request a second');
  for (let i = 0; i < 20; i++) c.noteOk();
  c.take();
  assert.equal(c.rate, 1, 'still inside the cool-down');
  now = 80_000;
  c.take();
  assert.equal(c.rate, 2, 'doubles after the cool-down with a clean run behind it');
  const s = c.snapshot();
  assert.equal(s.rateLimited, 7);
  assert.ok(s.requests >= 5);
});

test('the disk cache stores a document once and reports its hit ratio', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'edgar-cache-'));
  process.env.EDGAR_CACHE_DIR = dir;
  const cache = await import('../api/_lib/edgarCache.js');
  cache.resetCacheCounters();
  assert.equal(cache.cacheGet('1067983', '0000950123-26-008001', 'infotable.xml'), null);
  assert.equal(cache.cachePut('1067983', '0000950123-26-008001', 'infotable.xml', '<xml/>'), true);
  assert.equal(cache.cacheGet('0001067983', '000095012326008001', 'infotable.xml'), '<xml/>', 'same key however the ids are written');
  assert.equal(cache.cacheHas('1067983', '0000950123-26-008001', 'infotable.xml'), true);
  assert.equal(cache.cachePut('1067983', 'x', '../escape', 'no'), false, 'no path escape');
  const s = cache.cacheStats();
  assert.deepEqual([s.hits, s.misses, s.writes, s.files], [1, 1, 1, 1]);
  assert.equal(s.hitRate, 0.5);
  fs.rmSync(dir, { recursive: true, force: true });
  delete process.env.EDGAR_CACHE_DIR;
});

const filing = (reportDate, acc, amendments = []) => ({ reportDate, acc, filingDate: reportDate, amendments: amendments.map((a) => ({ acc: a })) });

test('the plan: reuse on an unchanged fingerprint, incremental on a new document, full for an old-format entry', () => {
  const filings = [filing('2026-03-31', 'A1'), filing('2026-06-30', 'A2')];
  const stored = { fp: fingerprint(filings), quarters: [{ reportDate: '2026-03-31', acc: 'A1' }, { reportDate: '2026-06-30', acc: 'A2' }] };
  assert.equal(planRebuild(stored, filings).mode, 'reuse');
  // a new quarter lands
  const next = [...filings, filing('2026-09-30', 'A3')];
  const p = planRebuild(stored, next);
  assert.equal(p.mode, 'incremental');
  assert.deepEqual(p.fetch.map((f) => f.acc), ['A2', 'A3'], 'the new period and the one before it (turnover)');
  assert.deepEqual([...p.recompute], ['2026-09-30']);
  assert.deepEqual(p.keep, ['2026-03-31', '2026-06-30']);
  // an amendment for an old period
  const amended = [filing('2026-03-31', 'A1', ['A1x']), filing('2026-06-30', 'A2')];
  const q = planRebuild(stored, amended);
  assert.equal(q.mode, 'incremental');
  assert.deepEqual(q.fetch.map((f) => f.acc), ['A1'], 'the amended period; nothing before it in the window');
  assert.deepEqual(q.keep, ['2026-06-30']);
  // the window rolled and dropped the oldest quarter: nothing to read
  assert.equal(planRebuild({ ...stored, quarters: [...stored.quarters] }, filings.slice(1)).mode, 'reuse');
  // a stored entry from the old snapshot logic is read in full
  assert.equal(planRebuild({ ...stored, fp: stored.fp.replace(/^v2\|/, '') }, next).mode, 'full');
  assert.equal(planRebuild(null, next).mode, 'full');
  assert.equal(planRebuild(stored, next, { force: true }).mode, 'full');
  assert.equal(planRebuild(stored, next, { incremental: false }).mode, 'full');
});

test('the request estimate counts listings, tables and cover pages, less what the cache holds', () => {
  const plan = { fetch: [filing('2026-06-30', 'A2'), filing('2026-09-30', 'A3', ['A3x'])] };
  const none = estimateRequests('1', plan, () => false);
  assert.deepEqual(none, { docs: 7, requests: 7, hits: 0 });
  const warm = estimateRequests('1', plan, (cik, acc, name) => acc === 'A2' || name === 'index.json');
  assert.deepEqual(warm, { docs: 7, requests: 3, hits: 4 });
  assert.equal(estimateSeconds(8500, 6, 85), Math.round(((8500 + 85) / 6) * 1.15));
});

// End to end over the offline fixtures: a full walk, a reuse, and an
// incremental walk after a new quarter appears — each compared with a
// fresh full walk of the same feed.
test('dry run reports the plan; an incremental walk merges onto the stored quarters and matches a full walk', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'history-walk-'));
  const fix = path.join(tmp, 'sec');
  fs.cpSync(path.join(root, 'tests', 'fixtures', 'sec'), fix, { recursive: true });
  const cik = '0001067983';
  const subFile = path.join(fix, 'submissions', `CIK${cik}.json`);
  const full = JSON.parse(fs.readFileSync(subFile, 'utf8'));
  // step 1: the feed without the newest quarter
  const older = JSON.parse(JSON.stringify(full));
  for (const k of Object.keys(older.filings.recent)) older.filings.recent[k] = older.filings.recent[k].slice(1);
  fs.writeFileSync(subFile, JSON.stringify(older));
  const out = path.join(tmp, 'guru-history.json');
  const run = (extra = {}) =>
    spawnSync(process.execPath, [path.join(root, 'scripts', 'build-guru-history.mjs')], {
      encoding: 'utf8',
      env: { ...process.env, SEC_FIXTURE_DIR: fix, GURU_HISTORY_CIKS: cik, GURU_HISTORY_OUT: out, EDGAR_CACHE_DIR: path.join(tmp, 'cache'), SECURITY_MASTER_FILE: path.join(tmp, 'master.json'), ...extra },
    });
  let r = run({ GURU_HISTORY_DRY: '1' });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /full\s+1 periods/, 'first walk is a full read');
  assert.match(r.stdout, /\[dry run\] 1 gurus: 0 reused, 0 incremental, 1 full/);
  assert.match(r.stdout, /EDGAR requests/);
  assert.equal(fs.existsSync(out), false, 'a dry run writes nothing');
  r = run();
  assert.equal(r.status, 0, r.stderr);
  const first = JSON.parse(fs.readFileSync(out, 'utf8')).gurus[cik];
  assert.equal(first.quarters.length, 1);
  assert.match(first.fp, /^v2\|/);
  // step 2: nothing changed → reuse
  r = run();
  assert.match(r.stdout, /reusing 1 quarters/);
  // step 3: the newest quarter lands → incremental
  fs.writeFileSync(subFile, JSON.stringify(full));
  r = run({ GURU_HISTORY_DRY: '1' });
  assert.match(r.stdout, /incremental\s+2 periods/, 'the new period plus the one before it');
  r = run();
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /incremental, 2 of 2 quarters read/);
  const inc = JSON.parse(fs.readFileSync(out, 'utf8')).gurus[cik];
  // step 4: a forced full walk of the same feed is the reference
  r = run({ GURU_HISTORY_FORCE: '1' });
  assert.equal(r.status, 0, r.stderr);
  const ref = JSON.parse(fs.readFileSync(out, 'utf8')).gurus[cik];
  assert.deepEqual(inc.quarters, ref.quarters, 'quarter rows (turnover, counts, top10) identical');
  assert.deepEqual(Object.keys(inc.positions).sort(), Object.keys(ref.positions).sort());
  for (const c of Object.keys(ref.positions)) {
    assert.deepEqual(inc.positions[c].series, ref.positions[c].series, `${c} series`);
    assert.equal(inc.positions[c].heldQuarters, ref.positions[c].heldQuarters, `${c} held`);
  }
  assert.match(r.stdout, /EDGAR: 0 requests/, 'fixtures: nothing fetched');
  fs.rmSync(tmp, { recursive: true, force: true });
});
