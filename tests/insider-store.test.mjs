// Insider storage rules: idempotent upserts, 4/A superseding, one summary
// for the home page and /insiders, and freshness judged by the data's own
// dates.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import './helpers.mjs';
import {
  assignLineIndexes,
  currentRows,
  duplicateIds,
  loadDataset,
  markSuperseded,
  mergeFilings,
  readServed,
  resetServedCache,
  sameTradeGroups,
} from '../api/_lib/insiderStore.js';
import { daySummary } from '../api/_lib/insiderModel.js';
import { buildTeaser } from '../api/_lib/insiderTeaser.js';
import { businessDaysBehind, dataFreshness, isSecBusinessDay } from '../client/src/lib/secCalendar.js';
import { expectedQuarter, judgeHealth, runChecks } from '../api/_lib/freshnessChecks.js';

const row = (o) => ({ t: 'EXMP', ci: '0000111111', n: 'Doe Jane', r: 'director', d: '2026-09-17', f: '2026-09-18', k: 'P', s: 100, p: 10, v: 1000, a: '0000000001-26-000001', li: 0, ...o });

test('upsert is idempotent: the same filings merged twice change nothing', () => {
  const base = [row({ a: 'A1', li: 0 }), row({ a: 'A1', li: 1, s: 200 }), row({ a: 'A2', li: 0 })];
  const fresh = [row({ a: 'A2', li: 0, p: 11 }), row({ a: 'A3', li: 0 })];
  const once = mergeFilings(base, fresh, ['A2', 'A3']);
  const twice = mergeFilings(once, fresh, ['A2', 'A3']);
  assert.equal(once.length, 4);
  assert.deepEqual(twice, once);
  assert.deepEqual(duplicateIds(twice), []);
  assert.equal(once.find((r) => r.a === 'A2').p, 11, 'a re-read filing replaces its old rows');
  // a re-read filing that now yields fewer rows drops the stale ones
  const shrunk = mergeFilings(once, [row({ a: 'A1', li: 0 })], ['A1']);
  assert.equal(shrunk.filter((r) => r.a === 'A1').length, 1);
});

test('two lines of one filing are two rows (the LIFE / Colis 23,333 case)', () => {
  // same accession, same owner, same share count — different trade dates:
  // two transactions, not a duplicate
  const rows = [
    row({ t: 'LIFE', n: 'Colis Peter George', k: 'C', s: 23333, p: 0, v: 0, d: '2026-09-17', a: '0002089362-26-000018', li: 0 }),
    row({ t: 'LIFE', n: 'Colis Peter George', k: 'C', s: 23333, p: 0, v: 0, d: '2026-09-18', a: '0002089362-26-000018', li: 1 }),
  ];
  assert.deepEqual(duplicateIds(rows), []);
  assert.equal(markSuperseded(rows), 0);
  assert.equal(currentRows(rows).length, 2);
});

test('rows stored before line indexes get one per filing, in order', () => {
  const rows = [{ a: 'X' }, { a: 'X' }, { a: 'Y' }, { a: 'X', li: 5 }];
  assignLineIndexes(rows);
  assert.deepEqual(rows.map((r) => r.li), [6, 7, 0, 5]);
  assert.deepEqual(duplicateIds(rows), []);
});

test('4/A supersedes the original on owner + issuer + trade date + code + shares; both stay stored', () => {
  const original = row({ a: 'ORIG', ow: '0002222222', f: '2026-09-18' });
  const amendment = row({ a: 'AMND', ow: '0002222222', f: '2026-09-22', fa: '4/A', p: 10.5, v: 1050 });
  const unrelated = row({ a: 'OTHER', ow: '0003333333', n: 'Someone Else', f: '2026-09-18' });
  const differentShares = row({ a: 'ORIG2', ow: '0002222222', s: 999, f: '2026-09-18' });
  const rows = [original, amendment, unrelated, differentShares];
  assert.equal(markSuperseded(rows), 1);
  assert.equal(original.sb, 'AMND', 'the original is marked, not deleted');
  assert.equal(rows.length, 4);
  assert.deepEqual(currentRows(rows).map((r) => r.a).sort(), ['AMND', 'ORIG2', 'OTHER']);
  // idempotent
  assert.equal(markSuperseded(rows), 1);
  assert.equal(original.sb, 'AMND');
});

test('4/A matching falls back to the owner name for rows stored before owner CIKs, and never crosses owners', () => {
  const legacy = row({ a: 'OLD', f: '2026-09-10' }); // no ow
  const amendment = row({ a: 'AM', ow: '0002222222', fa: '4/A', f: '2026-09-22' });
  const otherOwnerSameName = row({ a: 'OLD2', ow: '0009999999', f: '2026-09-10' });
  const rows = [legacy, amendment, otherOwnerSameName];
  markSuperseded(rows);
  assert.equal(legacy.sb, 'AM');
  assert.equal(otherOwnerSameName.sb, undefined, 'a different owner CIK is a different person');
  assert.equal(sameTradeGroups(currentRows(rows)).length, 1, 'only the genuinely different-owner pair remains');
});

test('a plain Form 4 never supersedes anything, and an amendment never supersedes a later filing', () => {
  const a = row({ a: 'A', f: '2026-09-18' });
  const b = row({ a: 'B', f: '2026-09-19' });
  const late = row({ a: 'LATE', f: '2026-09-25' });
  const am = row({ a: 'AM', fa: '4/A', f: '2026-09-20' });
  markSuperseded([a, b, late, am]);
  assert.equal(a.sb, 'AM');
  assert.equal(b.sb, 'AM');
  assert.equal(late.sb, undefined);
});

test('home page and /insiders headline numbers come from one function and agree', async () => {
  const rows = [
    row({ a: 'B1', t: 'AAA', k: 'P', v: 1000, f: '2026-09-25' }),
    row({ a: 'B2', t: 'BBB', k: 'P', v: 2000, f: '2026-09-25' }),
    row({ a: 'B3', t: null, k: 'P', v: 9_700_000, f: '2026-09-25' }), // no ticker: counted by neither
    row({ a: 'B4', t: 'CCC', k: 'P', v: 5000, f: '2026-09-25', sb: 'AMX' }), // superseded: counted by neither
    row({ a: 'S1', t: 'AAA', k: 'S', v: 3000, f: '2026-09-25' }),
    row({ a: 'OLD', t: 'AAA', k: 'P', v: 7000, f: '2026-09-24' }),
  ];
  const s = daySummary(rows);
  assert.deepEqual(
    { day: s.day, buyCount: s.buyCount, buyValue: s.buyValue, sellCount: s.sellCount, sellValue: s.sellValue, companies: s.companies },
    { day: '2026-09-25', buyCount: 2, buyValue: 3000, sellCount: 1, sellValue: 3000, companies: 2 }
  );

  const teaser = buildTeaser(rows, {}, {}, Date.parse('2026-09-26'));
  assert.equal(teaser.pulse.buyCount, s.buyCount);
  assert.equal(teaser.pulse.buyValue, s.buyValue);

  // the feed handler, over the same rows through the store
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ins-'));
  fs.writeFileSync(path.join(dir, 'insiders.json'), JSON.stringify({ updatedAt: '2026-09-26T04:00:00Z', rows, companies: {} }));
  process.env.INSIDER_DATA_DIR = dir;
  resetServedCache();
  try {
    const { default: feed } = await import('../api/_handlers/insider-feed.js');
    const res = { headers: {}, setHeader() {}, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };
    await feed({ query: {} }, res);
    assert.equal(res.body.stats.buyCount, teaser.pulse.buyCount, 'same count on both pages');
    assert.equal(res.body.stats.buyValue, teaser.pulse.buyValue, 'same value on both pages');
    assert.equal(res.body.lastFilingDay, '2026-09-25', 'the date shown is the newest filing, not the write time');
    assert.ok(!res.body.rows.some((r) => r.value === 5000 && r.ticker === 'CCC'), 'superseded rows are never listed');
  } finally {
    delete process.env.INSIDER_DATA_DIR;
    resetServedCache();
  }
});

test('a dataset stored before checkpoints existed resumes from its newest filing, not the old lastDay', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ins-'));
  // the production file on 2026-09-27: lastDay said 09-25, the rows ended 09-18
  fs.writeFileSync(path.join(dir, 'insiders.json'), JSON.stringify({ lastDay: '2026-09-25', rows: [row({ f: '2026-09-17' }), row({ a: 'Z', f: '2026-09-18' })] }));
  process.env.INSIDER_DATA_DIR = dir;
  try {
    const db = loadDataset();
    assert.equal(db.checkpoint, '2026-09-18', 'the five lost days are read again automatically');
  } finally {
    delete process.env.INSIDER_DATA_DIR;
  }
});

test('served data exposes only current rows and the real newest filing date', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ins-'));
  fs.writeFileSync(
    path.join(dir, 'insiders.json'),
    JSON.stringify({ lastDay: '2026-09-25', rows: [row({ a: 'A', f: '2026-09-18' }), row({ a: 'B', f: '2026-09-22', sb: 'C' })] })
  );
  process.env.INSIDER_DATA_DIR = dir;
  resetServedCache();
  try {
    const db = readServed();
    assert.equal(db.rows.length, 1);
    assert.equal(db.lastFilingDay, '2026-09-18');
  } finally {
    delete process.env.INSIDER_DATA_DIR;
    resetServedCache();
  }
});

// ---- freshness ---------------------------------------------------------------

test('SEC calendar: weekends, holidays incl. Columbus and Veterans Day, business days behind', () => {
  assert.equal(isSecBusinessDay('2026-10-12'), false, 'Columbus Day');
  assert.equal(isSecBusinessDay('2026-11-11'), false, 'Veterans Day');
  assert.equal(isSecBusinessDay('2026-04-03'), true, 'Good Friday: exchanges closed, SEC open');
  assert.equal(isSecBusinessDay('2026-09-26'), false);
  assert.equal(businessDaysBehind('2026-09-25', '2026-09-28'), 0, 'Monday morning with Friday data');
  assert.equal(businessDaysBehind('2026-09-25', '2026-09-29'), 1);
  assert.equal(businessDaysBehind('2026-10-09', '2026-10-13'), 0, 'Tuesday after Columbus Day');
});

test('"Canlı veri" only while at most one business day behind; otherwise "Son veri"', () => {
  const at = (iso) => Date.parse(`${iso}T09:00:00Z`);
  assert.equal(dataFreshness('2026-09-25', at('2026-09-28')).live, true);
  assert.equal(dataFreshness('2026-09-25', at('2026-09-29')).live, true, 'one late night is tolerated');
  assert.equal(dataFreshness('2026-09-25', at('2026-09-30')).live, false);
  const outage = dataFreshness('2026-09-18', at('2026-09-27'));
  assert.deepEqual(outage, { lastDay: '2026-09-18', behind: 5, live: false }, 'the September outage reads as five business days behind');
  assert.equal(dataFreshness(null).live, false);
});

test('freshness checks judge data dates, not write times or checkpoints', () => {
  const now = Date.parse('2026-09-27T13:00:00Z');
  const files = {
    // the real 2026-09-27 state: rewritten today, checkpoint 09-25, rows end 09-18
    'api/_data/insiders.json': { updatedAt: '2026-09-27T10:15:08Z', lastDay: '2026-09-25', rows: [row({ f: '2026-09-18' })] },
    'client/public/insiders-teaser.json': { updatedAt: '2026-09-27T10:15:08Z', lastDay: '2026-09-18' },
    'client/public/consensus.json': { updatedAt: '2026-09-27T08:00:00Z', quarter: '2026-03-31' },
    'client/public/returns.json': { updatedAt: '2026-09-27T08:00:00Z', returns: { AAPL: { asOf: '2026-09-25' } } },
    'client/public/universe.json': { updatedAt: '2026-09-27T07:00:00Z', rows: [{ filed: '2026-09-25' }] },
    'client/public/stocks.json': { updatedAt: '2026-09-20T07:00:00Z' },
  };
  const out = Object.fromEntries(runChecks((f) => files[f] ?? null, { now }).map((r) => [r.label, r]));
  assert.equal(out['insider transactions'].status, 'STALE', 'a fresh write time does not hide stale rows');
  assert.equal(out['insider teaser (public)'].status, 'STALE');
  assert.equal(out['consensus (public)'].status, 'STALE', 'Q1 when Q2 is due');
  assert.equal(out['price returns'].status, 'ok');
  assert.equal(out['13F universe'].status, 'ok');
  assert.equal(out['stock directory'].status, 'STALE', 'not rebuilt with the universe');
  assert.equal(out['share splits'].status, 'MISSING');
  assert.equal(expectedQuarter(now), '2026-06-30');
  assert.equal(expectedQuarter(Date.parse('2026-11-25T00:00:00Z')), '2026-09-30');
});

test('job health: failing while the last error is newer than the last success (FMP 402)', () => {
  const failing = judgeHealth({ last_success_at: '2026-09-17T08:00:00Z', last_error_at: '2026-09-18T10:03:57Z', last_error: "3 refusal(s): HTTP 402 Premium Query Parameter" });
  assert.equal(failing.ok, false);
  assert.match(failing.detail, /402/);
  assert.equal(judgeHealth({ last_success_at: '2026-09-19T08:00:00Z', last_error_at: '2026-09-18T10:03:57Z', last_error: null }).ok, true);
});

test('stock page reads the same current rows as the feed, newest trade first', async () => {
  const { fromDataset } = await import('../api/_handlers/insiders.js');
  const db = {
    rows: currentRows([
      row({ t: 'AAPL', a: 'A1', d: '2026-09-17', k: 'S', n: 'Cook Tim', ti: 'CEO' }),
      row({ t: 'AAPL', a: 'A2', d: '2026-09-22', k: 'P', r: 'director', ti: null }),
      row({ t: 'AAPL', a: 'A3', d: '2026-09-23', k: 'P', sb: 'A9' }), // superseded
      row({ t: 'MSFT', a: 'M1', d: '2026-09-24' }),
    ]),
  };
  const tx = fromDataset(db, 'AAPL');
  assert.deepEqual(tx.map((x) => [x.date, x.side, x.title]), [
    ['2026-09-22', 'buy', 'Director'],
    ['2026-09-17', 'sell', 'CEO'],
  ]);
});
