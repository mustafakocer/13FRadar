import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { pickDatasets, columns, newReading, addRow, compareFiling, datasetIssue } from '../api/_lib/secDataset.js';

test('pickDatasets: the zip links on the SEC page, newest window first, relative and absolute', () => {
  const html = `
    <a href="/files/structureddata/data/form-13f-data-sets/01mar2026-31may2026_form13f.zip">Mar–May</a>
    <a href="https://www.sec.gov/files/structureddata/data/form-13f-data-sets/01jun2026-31aug2026_form13f.zip">Jun–Aug</a>
    <a href="/files/structureddata/data/form-13f-data-sets/01jun2026-31aug2026_form13f.zip">dup</a>
    <a href="/files/other.zip">no</a>
    <a href="/files/x/01xyz2026-31aug2026_form13f.zip">bad month</a>`;
  const d = pickDatasets(html);
  assert.equal(d.length, 2);
  assert.deepEqual(d[0], { url: 'https://www.sec.gov/files/structureddata/data/form-13f-data-sets/01jun2026-31aug2026_form13f.zip', name: '01jun2026-31aug2026_form13f', from: '2026-06-01', to: '2026-08-31' });
  assert.equal(d[1].from, '2026-03-01');
  assert.deepEqual(pickDatasets(''), []);
});

test('columns: by name, whatever the order, CRLF tolerated', () => {
  const c = columns('ACCESSION_NUMBER\tINFOTABLE_SK\tNAMEOFISSUER\tCUSIP\tVALUE\tSSHPRNAMT\tPUTCALL\r');
  assert.equal(c.ACCESSION_NUMBER, 0);
  assert.equal(c.CUSIP, 3);
  assert.equal(c.PUTCALL, 6);
});

const reading = (rows) => rows.reduce((r, x) => addRow(r, x), newReading());

test('compareFiling: total × our unit factor, position count, the ten lines by share count', () => {
  const sec = reading([
    { cusip: 'aaa', putCall: '', value: 600, shares: 60 },
    { cusip: 'AAA', putCall: '', value: 400, shares: 40 }, // same line twice (another manager): summed
    { cusip: 'BBB', putCall: 'Put', value: 100, shares: 5 },
  ]);
  const ours = { aum: 1100, count: 2, top: [{ cusip: 'AAA', shares: 100 }, { cusip: 'BBB', putCall: 'Put', shares: 5 }] };
  const ok = compareFiling(ours, sec);
  assert.equal(ok.status, 'match');
  assert.equal(ok.rows, 3);
  // a filing we rescaled ×1000: the SEC's reading is as filed
  assert.equal(compareFiling({ ...ours, aum: 1100e3, unitFix: { factor: 1000 } }, sec).status, 'match');
  // a total 1% off, a missing line, a share count off
  assert.equal(compareFiling({ ...ours, aum: 1111 }, sec).valueOk, false);
  assert.equal(compareFiling({ ...ours, aum: 1104 }, sec).valueOk, true); // within ±0.5%
  const bad = compareFiling({ aum: 1100, count: 3, top: [{ cusip: 'AAA', shares: 99 }, { cusip: 'ZZZ', shares: 1 }] }, sec);
  assert.equal(bad.status, 'differs');
  assert.equal(bad.count.ok, false);
  assert.deepEqual(bad.lines.map((l) => l.ok), [false, false]);
  assert.equal(bad.lines[1].sec, null);
  assert.equal(compareFiling(ours, undefined).status, 'missing');
});

test('datasetIssue: verdict first, differing funds largest first, mention only when something differs', () => {
  const sec = reading([{ cusip: 'A', value: 100, shares: 1 }]);
  const fund = (cik, aum) => ({ cik, name: `F|${cik}`, acc: '0000000001-26-000001', aum });
  const ds = { name: '01jun2026-31aug2026_form13f', from: '2026-06-01', to: '2026-08-31' };
  const match = { fund: fund('1', 100), check: compareFiling({ aum: 100, count: 1, top: [{ cusip: 'A', shares: 1 }] }, sec) };
  const small = { fund: fund('2', 200), check: compareFiling({ aum: 200, count: 1, top: [] }, sec) };
  const big = { fund: fund('3', 5e9), check: compareFiling({ aum: 5e9, count: 1, top: [] }, sec) };
  const { title, body, differs, compared } = datasetIssue({ dataset: ds, results: [match, small, big], skipped: { amended: 4, missing: 7 }, mention: '@x' });
  assert.equal(title, 'SEC toplu verisiyle karşılaştırma — 01jun2026-31aug2026_form13f');
  assert.equal(differs, 2);
  assert.equal(compared, 3);
  assert.match(body, /^@x /);
  assert.match(body, /3 bildirimden 1 tanesi birebir tuttu, 2 tanesinde fark var/);
  assert.match(body, /düzeltme bildirimi olan 4 fon/);
  assert.match(body, /olmayan 7 bildirim/);
  assert.ok(body.indexOf('(3)') < body.indexOf('(2)'));
  assert.match(body, /F\/3/); // a pipe in a name does not break the table
  const clean = datasetIssue({ dataset: ds, results: [match], mention: '@x' });
  assert.doesNotMatch(clean.body, /@x/);
  assert.match(clean.body, /hepsi birebir tuttu/);
});

test('sec-dataset workflow: weekly, outside the night window, no email in the user agent, dry run on a PR, one issue per data set', () => {
  const wf = fs.readFileSync(new URL('../.github/workflows/sec-dataset.yml', import.meta.url), 'utf8');
  const cron = wf.match(/cron: '(\d+) (\d+) \* \* (\d)'/);
  const minutes = Number(cron[2]) * 60 + Number(cron[1]);
  assert.ok(minutes < 60 || minutes > 210);
  assert.doesNotMatch(wf, /@[a-z0-9-]+\.[a-z]+/i);
  assert.match(wf, /--dry-run/);
  assert.match(wf, /issues: write/);
  const src = fs.readFileSync(new URL('../scripts/sec-dataset-check.mjs', import.meta.url), 'utf8');
  assert.match(src, /anyWithLabel/);
  assert.match(src, /not raised twice/);
});

test('compareFiling: a filer that swapped the value and share columns matches once swapped back (CalSTRS)', () => {
  // as filed: value column holds shares, share column holds dollars
  const sec = reading([
    { cusip: 'NVDA', value: 35021490, shares: 7007449934 },
    { cusip: 'AAPL', value: 22278223, shares: 6446426607 },
  ]);
  const ours = { aum: 7007449934 + 6446426607, count: 2, top: [{ cusip: 'NVDA', shares: 35021490 }, { cusip: 'AAPL', shares: 22278223 }] };
  const c = compareFiling(ours, sec);
  assert.equal(c.status, 'match');
  assert.equal(c.swapped, true);
  // not every line swapped: still a difference
  const half = compareFiling({ ...ours, top: [{ cusip: 'NVDA', shares: 35021490 }, { cusip: 'AAPL', shares: 1 }] }, sec);
  assert.equal(half.status, 'differs');
  const ds = { name: 'n', from: 'a', to: 'b' };
  const body = datasetIssue({ dataset: ds, results: [{ fund: { cik: '1081019', name: 'CALSTRS', acc: 'x', aum: ours.aum }, check: c }] }).body;
  assert.match(body, /hepsi birebir tuttu/);
  assert.match(body, /ters yazan 1 fon tuttu sayıldı.*CALSTRS/);
});
