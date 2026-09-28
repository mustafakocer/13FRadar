// The insider crawl: which EDGAR days are read, skipped or waited for, and
// what happens when EDGAR misbehaves. Regression tests for the September 2026
// outage (docs/postmortems/2026-09-insider-outage.md): the crawl "skipped"
// every morning's not-yet-published index as if it were a holiday and never
// came back, losing 2026-09-21 → 09-25 behind green runs.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { root } from './helpers.mjs';
import { advanceCheckpoint, crawlDay, crawlOnce, getWithRetry, parseFormIndex, planScan } from '../api/_lib/insiderCrawl.js';
import { BadFilingError, parseForm4Submission } from '../api/_lib/insiderForm4.js';

const fixture = (name) => fs.readFileSync(path.join(root, 'tests', 'fixtures', 'form4', name), 'utf8');
const noSleep = { backoffMs: [2000, 4000, 8000, 16000], sleep: async () => {} };

// ---- a fake EDGAR ----------------------------------------------------------
// `days` maps a published day to how many Form 4 filings it has. The quarter
// listing lists exactly the published days; everything else answers 403,
// which is what EDGAR really sends for an index that does not exist.
function form4Txt({ acc, day, ticker = 'EXMP', issuerCik = '0000111111', owner = 'Doe Jane', ownerCik = '0002222222', code = 'P', shares = 1000, price = 10, formType = '4' }) {
  return `<SEC-DOCUMENT>${acc}.txt : ${day.replace(/-/g, '')}
<SEC-HEADER>
ACCESSION NUMBER:		${acc}
CONFORMED SUBMISSION TYPE:	${formType}
</SEC-HEADER>
<XML>
<ownershipDocument>
  <documentType>${formType}</documentType>
  <issuer><issuerCik>${issuerCik}</issuerCik><issuerName>${ticker} Corp</issuerName><issuerTradingSymbol>${ticker}</issuerTradingSymbol></issuer>
  <reportingOwner><reportingOwnerId><rptOwnerCik>${ownerCik}</rptOwnerCik><rptOwnerName>${owner}</rptOwnerName></reportingOwnerId>
    <reportingOwnerRelationship><isDirector>1</isDirector></reportingOwnerRelationship></reportingOwner>
  <nonDerivativeTable><nonDerivativeTransaction>
    <securityTitle><value>Common Stock</value></securityTitle>
    <transactionDate><value>${day}</value></transactionDate>
    <transactionCoding><transactionCode>${code}</transactionCode></transactionCoding>
    <transactionAmounts><transactionShares><value>${shares}</value></transactionShares><transactionPricePerShare><value>${price}</value></transactionPricePerShare><transactionAcquiredDisposedCode><value>A</value></transactionAcquiredDisposedCode></transactionAmounts>
    <postTransactionAmounts><sharesOwnedFollowingTransaction><value>${shares * 3}</value></sharesOwnedFollowingTransaction></postTransactionAmounts>
  </nonDerivativeTransaction></nonDerivativeTable>
</ownershipDocument>
</XML>
</SEC-DOCUMENT>`;
}

function fakeEdgar({ days = {}, filingStatus = () => 200, indexStatus = () => null, extraFilings = {} } = {}) {
  const calls = [];
  const dayOf = new Map(); // archive path -> filing day
  const acc = (day, i) => `${('9' + day.replace(/-/g, '')).padStart(10, '0')}-26-${String(i).padStart(6, '0')}`;
  const get = async (url) => {
    calls.push(url);
    let m = /daily-index\/(\d{4})\/QTR(\d)\/index\.json$/.exec(url);
    if (m) {
      const item = Object.keys(days)
        .filter((d) => d.startsWith(m[1]) && Math.floor((Number(d.slice(5, 7)) - 1) / 3) + 1 === Number(m[2]))
        .map((d) => ({ name: `form.${d.replace(/-/g, '')}.idx` }));
      return { status: 200, data: JSON.stringify({ directory: { item } }) };
    }
    m = /form\.(\d{4})(\d{2})(\d{2})\.idx$/.exec(url);
    if (m) {
      const day = `${m[1]}-${m[2]}-${m[3]}`;
      const forced = indexStatus(day);
      if (forced) return { status: forced, data: null };
      if (!(day in days)) return { status: 403, data: null };
      const lines = ['Form Type   Company Name   CIK   Date Filed   File Name', '-----'];
      for (let i = 0; i < days[day]; i++) {
        const p = `edgar/data/111111/${acc(day, i)}.txt`;
        dayOf.set(p, day);
        lines.push(`4           EXAMPLE CORP   111111   ${day.replace(/-/g, '')}   ${p}`);
      }
      for (const p of Object.keys(extraFilings[day] || {})) lines.push(`4           EXAMPLE CORP   111111   ${day.replace(/-/g, '')}   ${p}`);
      lines.push(`10-K        OTHER CORP     222222   ${day.replace(/-/g, '')}   edgar/data/222222/0000222222-26-000001.txt`);
      return { status: 200, data: lines.join('\n') };
    }
    m = /Archives\/(edgar\/data\/\d+\/(\d{10}-\d{2}-\d{6})\.txt)$/.exec(url);
    if (m) {
      const [, p, a] = m;
      const extraDay = Object.keys(extraFilings).find((d) => extraFilings[d]?.[p]);
      if (extraDay) return { status: 200, data: extraFilings[extraDay][p] };
      const day = dayOf.get(p);
      if (!day) return { status: 404, data: null };
      const st = filingStatus(p);
      if (st !== 200) return { status: st, data: null };
      return { status: 200, data: form4Txt({ acc: a, day, ticker: `T${a.slice(-4)}` }) };
    }
    return { status: 404, data: null };
  };
  return { get, calls };
}

// The listing lookup the crawl gets, built from what the fake publishes.
async function listingFor(edgar, day) {
  const r = await edgar.get(`https://www.sec.gov/Archives/edgar/daily-index/${day.slice(0, 4)}/QTR${Math.floor((Number(day.slice(5, 7)) - 1) / 3) + 1}/index.json`);
  const set = new Set(JSON.parse(r.data).directory.item.map((i) => /form\.(\d{4})(\d{2})(\d{2})/.exec(i.name).slice(1).join('-')));
  return () => set;
}

const run = async (edgar, { checkpoint, today, minForm4PerDay = 5, rescanBusinessDays = 0 }) =>
  crawlOnce({ checkpoint, today, published: await listingFor(edgar, today), get: edgar.get, minForm4PerDay, rescanBusinessDays, maxDays: 45, ...noSleep });

// ---- the regression --------------------------------------------------------

test('regression 2026-09-21: the morning run does not skip today, and the day is read the next morning', async () => {
  // Monday 2026-09-21, 10:14 UTC — the real run. EDGAR has published through
  // Friday 09-18; Monday's index comes out that evening.
  const edgar = fakeEdgar({ days: { '2026-09-17': 8, '2026-09-18': 8 } });
  const monday = await run(edgar, { checkpoint: '2026-09-18', today: '2026-09-21' });
  const state = Object.fromEntries(monday.plan.timeline.map((t) => [t.day, t.state]));
  assert.equal(state['2026-09-21'], 'pending', 'an unpublished weekday is waited for, not skipped');
  assert.equal(monday.newCheckpoint, '2026-09-20', 'the checkpoint stops before Monday (the weekend is settled)');
  assert.notEqual(monday.newCheckpoint, '2026-09-21', 'the bug: the checkpoint jumped over the unread day');
  assert.deepEqual(monday.problems, [], 'waiting for today is normal, not an alarm');

  // Tuesday morning: Monday is published now, and must be read.
  const edgar2 = fakeEdgar({ days: { '2026-09-18': 8, '2026-09-21': 8 } });
  const tuesday = await run(edgar2, { checkpoint: monday.newCheckpoint, today: '2026-09-22' });
  assert.deepEqual(tuesday.results.map((r) => r.day), ['2026-09-21']);
  assert.equal(tuesday.results[0].rows.length, 8, 'every filing of Monday is ingested');
  assert.equal(tuesday.newCheckpoint, '2026-09-21');
});

test('regression: a week of morning runs loses no day (09-21 → 09-25 were lost in production)', async () => {
  const published = {};
  let cp = '2026-09-18';
  const got = new Set();
  // each morning EDGAR has published through the previous business day
  for (const [today, yesterday] of [
    ['2026-09-21', null],
    ['2026-09-22', '2026-09-21'],
    ['2026-09-23', '2026-09-22'],
    ['2026-09-24', '2026-09-23'],
    ['2026-09-25', '2026-09-24'],
    ['2026-09-26', '2026-09-25'],
    ['2026-09-27', null],
    ['2026-09-28', null],
  ]) {
    if (yesterday) published[yesterday] = 6;
    const r = await run(fakeEdgar({ days: { ...published } }), { checkpoint: cp, today });
    for (const x of r.results) if (x.ok) got.add(x.day);
    assert.deepEqual(r.problems, [], `${today}: ${r.problems.join('; ')}`);
    cp = r.newCheckpoint;
  }
  assert.deepEqual([...got].sort(), ['2026-09-21', '2026-09-22', '2026-09-23', '2026-09-24', '2026-09-25']);
  assert.equal(cp, '2026-09-27', 'Monday 09-28 is still pending on its own morning');
});

test('Friday → Monday: the weekend is settled, Monday waits, Friday is re-read', async () => {
  const edgar = fakeEdgar({ days: { '2026-09-23': 6, '2026-09-24': 6, '2026-09-25': 6 } });
  const r = await run(edgar, { checkpoint: '2026-09-25', today: '2026-09-28', rescanBusinessDays: 3 });
  assert.deepEqual(r.plan.rescan, ['2026-09-23', '2026-09-24', '2026-09-25'], 'the last three business days are read again');
  const state = Object.fromEntries(r.plan.timeline.map((t) => [t.day, `${t.state}${t.reason ? `:${t.reason}` : ''}`]));
  assert.deepEqual(state, { '2026-09-26': 'settled:weekend', '2026-09-27': 'settled:weekend', '2026-09-28': 'pending' });
  assert.equal(r.newCheckpoint, '2026-09-27');
  assert.deepEqual(r.problems, []);
});

test('federal holiday 2026-10-12 (Columbus Day: exchanges open, SEC closed) is settled by the calendar', async () => {
  const edgar = fakeEdgar({ days: { '2026-10-09': 6 } }); // no 10-12, no 10-13 yet
  const r = await run(edgar, { checkpoint: '2026-10-09', today: '2026-10-13' });
  const state = Object.fromEntries(r.plan.timeline.map((t) => [t.day, `${t.state}${t.reason ? `:${t.reason}` : ''}`]));
  assert.equal(state['2026-10-12'], 'settled:holiday');
  assert.equal(state['2026-10-13'], 'pending');
  assert.equal(r.newCheckpoint, '2026-10-12', 'the holiday never holds the checkpoint');
  assert.ok(!edgar.calls.some((u) => u.includes('form.20261012.idx')), 'the holiday index is never requested');
  assert.deepEqual(r.problems, []);

  const next = await run(fakeEdgar({ days: { '2026-10-09': 6, '2026-10-13': 6 } }), { checkpoint: r.newCheckpoint, today: '2026-10-14' });
  assert.deepEqual(next.results.map((x) => x.day), ['2026-10-13']);
  assert.equal(next.newCheckpoint, '2026-10-13');
});

test('a late index waits, alarms after a full business day, and is read when it appears', async () => {
  // Wednesday 11:00: Tuesday 09-22 still unpublished, nothing later either
  const wed = await run(fakeEdgar({ days: { '2026-09-21': 6 } }), { checkpoint: '2026-09-21', today: '2026-09-23' });
  assert.equal(wed.newCheckpoint, '2026-09-21', 'held on the pending day');
  assert.deepEqual(wed.problems, [], 'one day late is still just late');

  // Thursday: still nothing — now it is an outage and somebody must look
  const thu = await run(fakeEdgar({ days: { '2026-09-21': 6 } }), { checkpoint: '2026-09-21', today: '2026-09-24' });
  assert.equal(thu.newCheckpoint, '2026-09-21');
  assert.ok(thu.problems.some((p) => p.startsWith('2026-09-22') && /pending for over a business day/.test(p)), thu.problems.join('; '));

  // It finally appears, with Wednesday: both are read
  const fri = await run(fakeEdgar({ days: { '2026-09-21': 6, '2026-09-22': 6, '2026-09-23': 6 } }), { checkpoint: '2026-09-21', today: '2026-09-24' });
  assert.deepEqual(fri.results.map((x) => x.day), ['2026-09-22', '2026-09-23']);
  assert.equal(fri.newCheckpoint, '2026-09-23');
});

test('rule (c): a weekday EDGAR skipped is settled once a later day is published', async () => {
  // an unscheduled closure on 09-22 that the holiday list does not know
  const r = await run(fakeEdgar({ days: { '2026-09-21': 6, '2026-09-23': 6 } }), { checkpoint: '2026-09-21', today: '2026-09-24' });
  const state = Object.fromEntries(r.plan.timeline.map((t) => [t.day, `${t.state}${t.reason ? `:${t.reason}` : ''}`]));
  assert.equal(state['2026-09-22'], 'settled:unpublished');
  assert.equal(r.newCheckpoint, '2026-09-23');
  assert.deepEqual(r.problems, []);
});

test('403/429 are retried with exponential backoff, then fail the day — the checkpoint holds', async () => {
  const waits = [];
  const sleep = async (ms) => waits.push(ms);
  // the index always answers 403
  const edgar = fakeEdgar({ days: { '2026-09-21': 6, '2026-09-22': 6 }, indexStatus: (d) => (d === '2026-09-22' ? 403 : null) });
  const r = await crawlOnce({ checkpoint: '2026-09-21', today: '2026-09-23', published: await listingFor(edgar, '2026-09-23'), get: edgar.get, minForm4PerDay: 5, rescanBusinessDays: 0, backoffMs: [2000, 4000, 8000, 16000], sleep });
  assert.deepEqual(waits, [2000, 4000, 8000, 16000], 'four retries: 2s, 4s, 8s, 16s');
  assert.equal(edgar.calls.filter((u) => u.endsWith('form.20260922.idx')).length, 5, 'one try plus four retries');
  assert.equal(r.results[0].ok, false);
  assert.match(r.results[0].error, /HTTP 403 after 4 retries/);
  assert.equal(r.newCheckpoint, '2026-09-21', 'a refused day is read again next run');
  assert.ok(r.problems.some((p) => /2026-09-22: daily index HTTP 403/.test(p)));
  assert.ok(r.problems.some((p) => /none was read/.test(p)), 'no progress is its own alarm');

  // a 429 that clears on the second try is just a slow request
  let n = 0;
  const flaky = async () => (++n === 1 ? { status: 429, data: null } : { status: 200, data: 'ok' });
  const ok = await getWithRetry(flaky, 'x', { backoffMs: [1, 2], sleep: async () => {} });
  assert.equal(ok.status, 200);
  assert.equal(n, 2);
});

test('a filing EDGAR keeps refusing fails its day instead of leaving a silent hole', async () => {
  const edgar = fakeEdgar({ days: { '2026-09-21': 6 }, filingStatus: (p) => (p.endsWith('-000003.txt') ? 429 : 200) });
  const r = await crawlDay('2026-09-21', { get: edgar.get, minForm4PerDay: 5, ...noSleep });
  assert.equal(r.ok, false);
  assert.equal(r.fetchFailed.length, 1);
  assert.match(r.error, /1 of 6 filings refused after retries/);
  assert.equal(r.rows.length, 5, 'the readable filings are still collected');
});

test('a malformed filing is logged and the batch carries on', async () => {
  const bad = 'edgar/data/111111/0000999999-26-000099.txt';
  const edgar = fakeEdgar({ days: { '2026-09-22': 6 }, extraFilings: { '2026-09-22': { [bad]: fixture('broken.txt') } } });
  const r = await crawlDay('2026-09-22', { get: edgar.get, minForm4PerDay: 5, ...noSleep });
  assert.equal(r.ok, true, 'one bad document does not fail the day');
  assert.equal(r.form4, 7);
  assert.equal(r.rows.length, 6, 'all good filings parsed');
  assert.equal(r.errors.length, 1);
  assert.equal(r.errors[0].accession, '0000999999-26-000099');
  assert.match(r.errors[0].error, /XML parse error/);
  await assert.rejects(parseForm4Submission(fixture('broken.txt'), { filed: '2026-09-22' }), BadFilingError);
  await assert.rejects(parseForm4Submission('<html>maintenance</html>', { filed: '2026-09-22' }), /no <ownershipDocument>/);
});

test('volume floor: a business day with fewer Form 4s than the floor fails (floor is configurable)', async () => {
  const edgar = fakeEdgar({ days: { '2026-09-21': 150 } });
  const thin = await crawlDay('2026-09-21', { get: edgar.get, minForm4PerDay: 200, ...noSleep });
  assert.equal(thin.ok, false);
  assert.match(thin.error, /only 150 Form 4 filings in the index \(floor 200\)/);
  const lowered = await crawlDay('2026-09-21', { get: edgar.get, minForm4PerDay: 100, ...noSleep });
  assert.equal(lowered.ok, true);
});

test('checkpoint only moves over read or rule-settled days', () => {
  const timeline = [
    { day: '2026-09-19', state: 'settled', reason: 'weekend' },
    { day: '2026-09-20', state: 'settled', reason: 'weekend' },
    { day: '2026-09-21', state: 'scan' },
    { day: '2026-09-22', state: 'scan' },
    { day: '2026-09-23', state: 'pending' },
  ];
  assert.equal(advanceCheckpoint('2026-09-18', timeline, new Set(['2026-09-21', '2026-09-22'])), '2026-09-22');
  assert.equal(advanceCheckpoint('2026-09-18', timeline, new Set(['2026-09-22'])), '2026-09-20', 'a failed day holds it');
  assert.equal(advanceCheckpoint('2026-09-18', timeline, new Set()), '2026-09-20');
});

test('backlog is capped per run and the remainder deferred', () => {
  const all = new Set();
  for (let d = Date.parse('2026-08-03'); d <= Date.parse('2026-09-25'); d += 86400000) all.add(new Date(d).toISOString().slice(0, 10));
  const plan = planScan({ checkpoint: '2026-07-31', today: '2026-09-28', published: () => all, rescanBusinessDays: 0, maxDays: 5 });
  assert.equal(plan.scan.length, 5);
  assert.equal(plan.scan[0].day, '2026-08-03');
  assert.ok(plan.timeline.some((t) => t.state === 'deferred'));
  assert.equal(advanceCheckpoint('2026-07-31', plan.timeline, new Set(plan.scan.map((s) => s.day))), '2026-08-09', 'up to the last read day plus the weekend after it');
});

test('daily form index: Form 4 and 4/A lines only', () => {
  const idx = [
    '4           ACME   1   20260921   edgar/data/1/0000000001-26-000001.txt',
    '4/A         ACME   1   20260921   edgar/data/1/0000000001-26-000002.txt',
    '424B2       ACME   1   20260921   edgar/data/1/0000000001-26-000003.txt',
    '40-F        ACME   1   20260921   edgar/data/1/0000000001-26-000004.txt',
  ].join('\n');
  assert.deepEqual(parseFormIndex(idx), [
    { path: 'edgar/data/1/0000000001-26-000001.txt', form: '4' },
    { path: 'edgar/data/1/0000000001-26-000002.txt', form: '4/A' },
  ]);
});

test('Form 4 parser keeps raw fields, footnotes, the owner CIK and the 4/A flag', async () => {
  const p = await parseForm4Submission(fixture('amendment-4a.txt'), { filed: '2026-09-22' });
  assert.equal(p.accession, '0000999999-26-000077');
  assert.equal(p.formType, '4/A');
  assert.equal(p.rows.length, 1, 'holdings are not transactions');
  const r = p.rows[0];
  assert.deepEqual(
    { t: r.t, ci: r.ci, n: r.n, r: r.r, k: r.k, s: r.s, p: r.p, v: r.v, o: r.o, p5: r.p5, li: r.li, ow: r.ow, fa: r.fa, f: r.f, d: r.d },
    { t: 'EXMP', ci: '0000111111', n: 'Doe Jane', r: 'cfo', k: 'P', s: 2500, p: 12.34, v: 30850, o: 10000, p5: 1, li: 0, ow: '0002222222', fa: '4/A', f: '2026-09-22', d: '2026-09-17' }
  );
  const raw = p.raw['0000999999-26-000077:0'];
  assert.equal(raw.sr, '2,500', 'shares as filed');
  assert.equal(raw.pr, '12.34', 'price as filed');
  assert.equal(raw.ad, 'A');
  assert.equal(raw.st, 'Common Stock, par value $0.01');
  assert.equal(raw.af, '1');
  assert.equal(raw.of, 1);
  assert.equal(raw.dr, undefined, 'unset flags are not stored');
  assert.equal(raw.ot, 'Chief Financial Officer');
  assert.deepEqual(raw.fn, {
    F1: 'The price reported is a weighted average price. Purchases ranged from $12.10 to $12.50.',
    F2: 'Amended to correct the ownership reported after the transaction.',
  });
});

// ---- the holiday list runs out ------------------------------------------------

test('past the end of the holiday list the crawl goes red and says the calendar must be updated', async () => {
  const { calendarCoverage, HOLIDAYS_LAST_YEAR } = await import('../client/src/lib/secCalendar.js');
  assert.equal(HOLIDAYS_LAST_YEAR, 2027);
  // Monday 2028-01-03, data published through Thursday 2027-12-30 (12-31 is a holiday)
  const r = await run(fakeEdgar({ days: { '2027-12-30': 6 } }), { checkpoint: '2027-12-30', today: '2028-01-03' });
  assert.ok(r.problems.some((p) => /holiday calendar ends 2027-12-31/.test(p) && /tatil takvimi güncellenmeli/.test(p)), r.problems.join('; '));
  assert.equal(calendarCoverage('2028-06-01').warning, null, 'an error, not a warning');
});

test('from 1 October of the last covered year every run warns (not red) that next year must be added', async () => {
  const { calendarCoverage } = await import('../client/src/lib/secCalendar.js');
  assert.deepEqual(calendarCoverage('2027-09-30'), { error: null, warning: null });
  const oct = await run(fakeEdgar({ days: { '2027-09-30': 6 } }), { checkpoint: '2027-09-30', today: '2027-10-01' });
  assert.deepEqual(oct.problems, [], 'the run stays green');
  assert.equal(oct.warnings.length, 1);
  assert.match(oct.warnings[0], /2028 SEC holiday list must be added.*2028 tatil listesi eklenmeli/);
  assert.match(calendarCoverage('2027-12-31').warning, /2028/);
  assert.deepEqual((await run(fakeEdgar({ days: { '2026-09-25': 6 } }), { checkpoint: '2026-09-25', today: '2026-09-28' })).warnings, [], 'no warning in 2026');
});
