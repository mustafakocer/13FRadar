import test from 'node:test';
import assert from 'node:assert/strict';
import { ssr } from './helpers.mjs';
import {
  effectiveFilings,
  parseCoverPage,
  isoDate,
  applyAmendment,
  inferAmendmentType,
  effectiveSnapshot,
  RESTATEMENT,
  NEW_HOLDINGS,
} from '../api/_lib/amendments.js';
import { list13F, list13FAll, getSubmissions, getEffectiveHoldings, getHoldings, filingForAcc, fetchCoverPage } from '../api/_lib/sec.js';
import { turnover, heldQuarters } from '../api/_lib/turnover.js';
import { invoke } from '../api/_lib/ssr/invoke.js';

// 13F-HR/A handling: one effective snapshot per (filer, period). The fixture
// filer (tests/fixtures/make-fixtures.mjs, AMENDER) files a NEW HOLDINGS
// amendment for 2026 Q1 and a RESTATEMENT for 2025 Q4.
const CIK = '0009000001';
const KO = '191216100';
const CVX = '166764100';
const AAPL = '037833100';
const HLT = '43300A203';

// ---- pure: grouping ---------------------------------------------------------
const doc = (acc, form, filingDate, reportDate) => ({ acc, form, filingDate, reportDate });

test('effectiveFilings: one entry per period, newest period first, amendments attached in filing order', () => {
  const raw = [
    doc('B1', '13F-HR', '2025-08-14', '2025-06-30'),
    doc('A2', '13F-HR/A', '2025-08-14', '2025-03-31'),
    doc('A1', '13F-HR', '2025-05-15', '2025-03-31'),
    doc('D2', '13F-HR/A', '2024-05-15', '2023-12-31'),
    doc('C2', '13F-HR/A', '2024-05-15', '2023-09-30'),
    doc('D1', '13F-HR', '2024-02-14', '2023-12-31'),
    doc('C1', '13F-HR', '2023-11-14', '2023-09-30'),
    doc('C3', '13F-HR/A', '2024-06-01', '2023-09-30'),
  ];
  const out = effectiveFilings(raw);
  assert.deepEqual(out.map((f) => f.reportDate), ['2025-06-30', '2025-03-31', '2023-12-31', '2023-09-30'], 'sorted by period, never by filing date');
  assert.ok(out.every((f) => f.form === '13F-HR'), 'the base of every period is the original');
  assert.equal(new Set(out.map((f) => f.reportDate)).size, out.length, 'no period twice');
  const q1 = out.find((f) => f.reportDate === '2025-03-31');
  assert.equal(q1.acc, 'A1');
  assert.equal(q1.amended, true);
  assert.deepEqual(q1.amendments.map((a) => a.acc), ['A2']);
  const q3 = out.find((f) => f.reportDate === '2023-09-30');
  assert.deepEqual(q3.amendments.map((a) => a.acc), ['C2', 'C3'], 'oldest amendment first');
  assert.equal(out.find((f) => f.reportDate === '2025-06-30').amended, false);
});

test('effectiveFilings: a period with only amendments in the window keeps the earliest as its base, flagged', () => {
  const out = effectiveFilings([doc('E2', '13F-HR/A', '2021-02-16', '2020-09-30'), doc('E3', '13F-HR/A', '2021-03-01', '2020-09-30')]);
  assert.equal(out.length, 1);
  assert.equal(out[0].acc, 'E2');
  assert.equal(out[0].baseIsAmendment, true);
  assert.deepEqual(out[0].amendments.map((a) => a.acc), ['E3']);
  // two originals for one period: the later filed one is the base
  const two = effectiveFilings([doc('X1', '13F-HR', '2025-05-10', '2025-03-31'), doc('X2', '13F-HR', '2025-05-12', '2025-03-31')]);
  assert.equal(two[0].acc, 'X2');
  assert.equal(two[0].amended, false);
  // an amendment filed before the base corrects an earlier original, not this one
  const stale = effectiveFilings([doc('Y2', '13F-HR', '2025-06-01', '2025-03-31'), doc('Y1A', '13F-HR/A', '2025-05-20', '2025-03-31')]);
  assert.equal(stale[0].amended, false);
});

// ---- pure: cover page ---------------------------------------------------------
test('parseCoverPage reads the period and the amendment type, with or without a namespace prefix', () => {
  const plain = parseCoverPage('<coverPage><reportCalendarOrQuarter>03-31-2025</reportCalendarOrQuarter><isAmendment>true</isAmendment><amendmentNo>1</amendmentNo><amendmentInfo><amendmentType>NEW HOLDINGS</amendmentType></amendmentInfo></coverPage>');
  assert.deepEqual(plain, { periodOfReport: '2025-03-31', isAmendment: true, amendmentNo: 1, amendmentType: NEW_HOLDINGS, reportType: null });
  const ns = parseCoverPage('<ns1:coverPage><ns1:periodOfReport>12-31-2023</ns1:periodOfReport><ns1:amendmentInfo><ns1:amendmentType>RESTATEMENT</ns1:amendmentType></ns1:amendmentInfo></ns1:coverPage>');
  assert.equal(ns.periodOfReport, '2023-12-31');
  assert.equal(ns.amendmentType, RESTATEMENT);
  const original = parseCoverPage('<coverPage><reportCalendarOrQuarter>2026-06-30</reportCalendarOrQuarter><isAmendment>false</isAmendment></coverPage>');
  assert.equal(original.isAmendment, false);
  assert.equal(original.amendmentType, null);
  assert.equal(original.periodOfReport, '2026-06-30');
  assert.equal(parseCoverPage('').periodOfReport, null);
  assert.equal(isoDate('6/30/2026'), '2026-06-30');
  assert.equal(isoDate('nope'), null);
});

// ---- pure: applying ---------------------------------------------------------
const pos = (cusip, shares, value) => ({ cusip, putCall: '', issuer: cusip, class: 'COM', value, shares, weight: 0 });
const base = { aum: 1000, positions: [pos('A', 10, 600), pos('B', 10, 400)] };

test('a NEW HOLDINGS amendment is added to the original; a RESTATEMENT replaces it', () => {
  const added = applyAmendment(base, { aum: 100, positions: [pos('C', 5, 100)] }, NEW_HOLDINGS);
  assert.deepEqual(added.positions.map((p) => p.cusip), ['A', 'B', 'C']);
  assert.equal(added.aum, 1100);
  assert.equal(added.positions[0].weight.toFixed(2), '54.55', 'weights recomputed over the merged book');
  assert.equal(added.type, NEW_HOLDINGS);
  assert.equal(added.inferred, false);

  const restated = applyAmendment(base, { aum: 700, positions: [pos('A', 12, 700)] }, RESTATEMENT);
  assert.deepEqual(restated.positions.map((p) => p.cusip), ['A']);
  assert.equal(restated.positions[0].shares, 12);
  assert.equal(restated.aum, 700);

  // a name stated again in a NEW HOLDINGS amendment is corrected, not doubled
  const corrected = applyAmendment(base, { aum: 500, positions: [pos('B', 20, 500)] }, NEW_HOLDINGS);
  assert.equal(corrected.positions.find((p) => p.cusip === 'B').shares, 20);
  assert.equal(corrected.positions.length, 2);
});

test('an amendment whose cover page is unreadable is classified by its size', () => {
  assert.equal(inferAmendmentType(base, { positions: [pos('C', 1, 1)] }), NEW_HOLDINGS, 'a handful of lines is an addition');
  assert.equal(inferAmendmentType(base, { positions: [pos('A', 1, 1), pos('B', 1, 1)] }), RESTATEMENT, 'the whole book again is a restatement');
  assert.equal(inferAmendmentType({ positions: [] }, { positions: [pos('A', 1, 1)] }), RESTATEMENT);
  const r = applyAmendment(base, { aum: 1, positions: [pos('C', 1, 1)] }, null);
  assert.equal(r.type, NEW_HOLDINGS);
  assert.equal(r.inferred, true);
});

test('effectiveSnapshot applies amendments in order and records what it applied', () => {
  const snap = effectiveSnapshot(
    { ...base, unitFix: true },
    [
      { acc: 'X', filingDate: '2025-08-14', holdings: { aum: 100, positions: [pos('C', 5, 100)] }, cover: { amendmentType: NEW_HOLDINGS } },
      { acc: 'Y', filingDate: '2025-09-01', holdings: null, cover: null }, // unreadable: skipped
      { acc: 'Z', filingDate: '2025-10-01', holdings: { aum: 50, positions: [pos('D', 1, 50)] }, cover: null },
    ]
  );
  assert.equal(snap.amended, true);
  assert.deepEqual(snap.amendments.map((a) => a.acc), ['X', 'Z']);
  assert.deepEqual(snap.positions.map((p) => p.cusip), ['A', 'B', 'C', 'D']);
  assert.equal(snap.unitFix, true, 'the base filing flags travel with the snapshot');
  const untouched = effectiveSnapshot(base, []);
  assert.equal(untouched.amended, undefined);
  assert.equal(untouched.positions.length, 2);
});

// ---- against the fixture filer ---------------------------------------------
test('list13F: the amending filer has one entry per period, ordered by period, with no "(A)" quarter', async () => {
  const sub = await getSubmissions(CIK);
  assert.equal(list13FAll(sub).length, 5, 'five raw documents');
  const fl = list13F(sub);
  assert.deepEqual(fl.map((f) => f.reportDate), ['2026-06-30', '2026-03-31', '2025-12-31']);
  assert.ok(fl.every((f) => f.form === '13F-HR'));
  assert.deepEqual(fl.map((f) => f.amended), [false, true, true]);
  assert.equal(fl[1].amendments[0].acc, '0009000001-26-000025');
  assert.equal(filingForAcc(fl, '0009000001-26-000025').acc, '0009000001-26-000020', 'an amendment accession resolves to its period');
  const cover = await fetchCoverPage(CIK, '0009000001-26-000025');
  assert.equal(cover.amendmentType, NEW_HOLDINGS);
  assert.equal(cover.periodOfReport, '2026-03-31', 'the period comes from the document itself');
});

test('getEffectiveHoldings: NEW HOLDINGS merges into the original, RESTATEMENT replaces it', async () => {
  const fl = list13F(await getSubmissions(CIK));
  const q1 = await getEffectiveHoldings(CIK, fl[1]);
  assert.equal(q1.amended, true);
  assert.equal(q1.amendments[0].type, NEW_HOLDINGS);
  assert.equal(q1.amendments[0].inferred, false);
  assert.equal(q1.positions.length, 8, 'six original names plus the two disclosed later');
  assert.ok(q1.positions.some((p) => p.cusip === KO) && q1.positions.some((p) => p.cusip === CVX), 'the confidential names sit with the rest of the book');
  const raw = await getHoldings(CIK, fl[1].amendments[0].acc, fl[1].amendments[0].filingDate);
  assert.equal(raw.positions.length, 2, 'the raw amendment stays readable on its own');
  assert.equal(Math.round(q1.aum), Math.round(raw.aum + (await getHoldings(CIK, fl[1].acc, fl[1].filingDate)).aum));

  const q4 = await getEffectiveHoldings(CIK, fl[2]);
  assert.equal(q4.amendments[0].type, RESTATEMENT);
  assert.equal(q4.positions.length, 6, 'the restated table, not the five-line original');
  assert.equal(q4.positions.find((p) => p.cusip === AAPL).shares, 100e6, 'the corrected share count');
  assert.ok(q4.positions.some((p) => p.cusip === HLT));

  const q2 = await getEffectiveHoldings(CIK, fl[0]);
  assert.equal(q2.amended, undefined);
  assert.equal(q2.positions.length, 8);
});

test('/api/manager lists periods, not documents, and marks the amended ones', async () => {
  const { default: manager } = await import('../api/_handlers/manager.js');
  const r = await invoke(manager, { cik: CIK });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.filings.map((f) => f.reportDate), ['2026-06-30', '2026-03-31', '2025-12-31']);
  assert.ok(!r.body.filings.some((f) => f.form === '13F-HR/A'));
  assert.equal(r.body.filings[1].amended, true);
  assert.equal(r.body.filings[1].amendments.length, 1);
});

test('/api/holdings answers the effective snapshot for the period, for either accession', async () => {
  const { default: holdings } = await import('../api/_handlers/holdings.js');
  const byBase = await invoke(holdings, { cik: CIK, acc: '0009000001-26-000020', light: '1' });
  assert.equal(byBase.status, 200);
  assert.equal(byBase.body.count, 8);
  assert.equal(byBase.body.amended, true);
  assert.equal(byBase.body.amendments[0].type, NEW_HOLDINGS);
  assert.equal(byBase.body.reportDate, '2026-03-31');
  const byAmendment = await invoke(holdings, { cik: CIK, acc: '0009000001-26-000025', light: '1' });
  assert.equal(byAmendment.body.count, 8, 'the amendment accession lands on the same snapshot');
  assert.equal(byAmendment.body.acc, '0009000001-26-000020');
});

// ---- turnover and time held ---------------------------------------------------
test('turnover: one definition — trades over the average book, never 0% with a trade in it', () => {
  const prev = { aum: 1000, positions: [pos('A', 10, 600), pos('B', 10, 400)] };
  const cur = { aum: 1100, positions: [pos('A', 12, 720), pos('C', 4, 380)] };
  const t = turnover(prev, cur);
  // A: +2 shares × $60 = 120 · B exited: 400 · C new: 380 → 900 / 1050
  assert.equal(t.traded, 900);
  assert.equal(t.turnover, Number(((900 / 1050) * 100).toFixed(2)));
  assert.deepEqual([t.newCount, t.exitCount, t.addCount, t.reduceCount], [1, 1, 1, 0]);
  // a book that only went up in price is no turnover at all
  const up = turnover(prev, { aum: 2000, positions: [pos('A', 10, 1200), pos('B', 10, 800)] });
  assert.equal(up.turnover, 0);
  assert.equal(up.newCount + up.exitCount, 0);
  // a tiny trade is a positive number, not a rounded zero
  const tiny = turnover(prev, { aum: 1000.5, positions: [pos('A', 10, 600), pos('B', 10, 400), pos('Z', 1, 0.5)] });
  assert.ok(tiny.turnover > 0);
  assert.equal(tiny.newCount, 1);
  assert.equal(turnover(null, cur).turnover, null);
});

test('an amendment folded into its quarter does not read as a 200% turnover spike', async () => {
  const fl = list13F(await getSubmissions(CIK));
  const snaps = [];
  for (const f of [...fl].reverse()) {
    const { aum, positions } = await getEffectiveHoldings(CIK, f);
    snaps.push({ aum, positions: positions.filter((p) => !p.putCall) });
  }
  for (let i = 1; i < snaps.length; i++) {
    const { turnover: t } = turnover(snaps[i - 1], snaps[i]);
    assert.ok(t != null && t < 60, `quarter ${i}: ${t}%`);
  }
});

test('time held survives a CUSIP change when the security id is the ticker', () => {
  const sets = [new Set(['AAPL', 'KO']), new Set(['AAPL', 'KO']), new Set(['AAPL']), new Set(['AAPL', 'CVX'])];
  assert.equal(heldQuarters(sets, 'AAPL'), 4);
  assert.equal(heldQuarters(sets, 'CVX'), 1);
  assert.equal(heldQuarters(sets, 'KO'), 0, 'exited: not held now');
});

test('/api/manager-stats on effective snapshots: finite turnover, counts that agree with it', async () => {
  const { default: stats } = await import('../api/_handlers/manager-stats.js');
  const r = await invoke(stats, { cik: CIK });
  assert.equal(r.status, 200);
  assert.equal(r.body.quarters, 3);
  assert.ok(Number.isFinite(r.body.turnoverLatest) && r.body.turnoverLatest < 60, `turnover ${r.body.turnoverLatest}`);
  assert.equal(r.body.newCount, 0, '2026 Q2 vs the effective Q1: no name is new');
  assert.equal(r.body.exitCount, 0);
  assert.ok(r.body.avgHoldingQuarters >= 2, 'KO and CVX count as held since Q1, not since the amendment');
});

test('SSR: the fund page lists quarters, marks the amended ones and shows no "(A)" quarter', async () => {
  const { status, html } = await ssr(`/tr/manager/${CIK}`);
  assert.equal(status, 200);
  const plain = html.replace(/<!-- -->/g, '');
  assert.ok(!/\(A\)/.test(plain), 'no amendment shown as a quarter');
  assert.match(plain, /<option value="0009000001-26-000030"[^>]*>2026 Q2<\/option>/, 'the latest quarter, unamended');
  assert.match(plain, /<option value="0009000001-26-000020"[^>]*>2026 Q1 ✎<\/option>/, 'the amended quarter is marked, once');
  assert.match(plain, /<option value="0009000001-26-000010"[^>]*>2025 Q4 ✎<\/option>/);
  assert.equal((plain.match(/<option /g) || []).length, 3, 'three periods, five documents');
  // the latest quarter carries no amendment, so no badge on the default view
  assert.doesNotMatch(plain, /Includes amendment/);
  // the badge text is what the client renders once an amended quarter is
  // selected; it is served in the state the page hydrates from
  assert.match(html, /"amendments":\[\{"acc":"0009000001-26-000025","form":"13F-HR\/A","filingDate":"2026-08-14"\}\]/);
});
