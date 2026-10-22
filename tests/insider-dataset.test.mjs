import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { pickInsiderDatasets, compareAccession, insiderDatasetIssue, datasetOf } from '../api/_lib/insiderDataset.js';

test('insider data sets: the links on the SEC page, newest first, with the filing days they cover', () => {
  const html = '<a href="/files/structureddata/data/insider-transactions-data-sets/2026q1_form345.zip">x</a><a href="https://www.sec.gov/files/structureddata/data/insider-transactions-data-sets/2026q2_form345.zip">y</a>';
  const [a, b] = pickInsiderDatasets(html);
  assert.deepEqual(a, { url: 'https://www.sec.gov/files/structureddata/data/insider-transactions-data-sets/2026q2_form345.zip', name: '2026q2_form345', from: '2026-04-01', to: '2026-06-30' });
  assert.equal(b.name, '2026q1_form345');
  assert.equal(datasetOf(2025, 4).to, '2025-12-31');
  assert.deepEqual(pickInsiderDatasets(''), []);
});

test('insider data sets: each row paired by code, day and shares, then judged on price and shares after', () => {
  const ours = [
    { k: 'S', d: '2026-05-01', s: 1000, p: 10.25, o: 5000, li: 0 },
    { k: 'S', d: '2026-05-01', s: 1000, p: 10.5, o: 4000, li: 1 },
    { k: 'P', d: '2026-05-02', s: 10, p: 0, o: null, li: 2 },
  ];
  const sec = [
    { k: 'S', d: '2026-05-01', s: 1000, p: 10.5, o: 4000 },
    { k: 'S', d: '2026-05-01', s: 1000.4, p: 10.2501, o: 5000.2 },
    { k: 'P', d: '2026-05-02', s: 10, p: null, o: null },
  ];
  assert.equal(compareAccession(ours, sec).status, 'match', 'the order of the lines does not matter, nor a rounding');
  const one = [
    { k: 'S', d: '2026-05-01', s: 1000, p: 10.5, o: 4000 },
    { k: 'S', d: '2026-05-01', s: 2000, p: 10.25, o: 5000 },
    { k: 'P', d: '2026-05-02', s: 10, p: null, o: null },
  ];
  const off = compareAccession(
    [
      { k: 'S', d: '2026-05-01', s: 1000, p: 11, o: 4000 },
      { k: 'S', d: '2026-05-01', s: 2000, p: 10.25, o: 1 },
      { k: 'P', d: '2026-05-02', s: 11, p: 0, o: null },
    ],
    one,
  );
  assert.equal(off.status, 'differs');
  assert.deepEqual(off.lines.map((l) => l.issue), ['price', 'owned', 'not-found']);
  assert.equal(compareAccession(ours, undefined).status, 'missing');
  // the SEC's file rounds the price to the cent
  const cents = (p, q) => compareAccession([{ k: 'P', d: '2026-07-01', s: 100, p, o: 100 }], [{ k: 'P', d: '2026-07-01', s: 100, p: q, o: 100.5 }]).status;
  assert.equal(cents(0.0231, 0.02), 'match');
  assert.equal(cents(0.0004, 0), 'match');
  assert.equal(cents(0.05, 0.02), 'differs');
  assert.equal(cents(212, 210), 'differs');
  assert.equal(cents(210.4, 210), 'match', "half a percent: the filer's own rounding");

  const issue = insiderDatasetIssue({
    dataset: { name: '2026q2_form345', from: '2026-04-01', to: '2026-06-30' },
    results: [{ acc: '0001-26-1', cik: '0000000001', t: 'ABC', n: 'Doe Jane', check: off }, { acc: '0001-26-2', cik: '1', t: 'XYZ', n: 'Roe', check: compareAccession(ours, sec) }],
    absent: [{ acc: '0002-26-1', cik: '2', t: 'QQQ', k: 'P', d: '2026-05-03', s: 5, p: 2, filed: '2026-05-04' }],
    mention: '@x',
  });
  assert.match(issue.title, /2026q2_form345/);
  assert.match(issue.body, /^@x /);
  assert.match(issue.body, /2 bildirimin \(6 işlem satırı\) 1 tanesi birebir tuttu; 1 bildirimde 3 satır farklı/);
  assert.match(issue.body, /sitede hiç olmayan alım\/satım: 1 satır/);
  assert.equal(issue.badLines, 3);
});

test('insider data sets: the script reads the SEC files and finds a changed price and a purchase the site lacks', () => {
  const db = JSON.parse(fs.readFileSync(new URL('../api/_data/insiders.json', import.meta.url), 'utf8'));
  const day = db.rows.map((r) => r.f).sort().at(-1);
  const pick = db.rows.filter((r) => r.f === day).slice(0, 3);
  assert.ok(pick.length, 'rows on the newest filing day');
  const mon = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
  const sd = (d) => `${d.slice(8)}-${mon[Number(d.slice(5, 7)) - 1]}-${d.slice(0, 4)}`;
  const accs = [...new Set(db.rows.filter((r) => pick.some((p) => p.a === r.a)).map((r) => r.a))];
  const rows = db.rows.filter((r) => accs.includes(r.a));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ids-'));
  fs.writeFileSync(path.join(dir, 'SUBMISSION.tsv'), ['ACCESSION_NUMBER\tFILING_DATE\tDOCUMENT_TYPE\tISSUERCIK\tISSUERTRADINGSYMBOL', ...accs.map((a) => `${a}\t${sd(day)}\t4\t1\tX`), `9999999999-26-000001\t${sd(day)}\t4\t2\tNEWCO`].join('\n'));
  // the first line's price moved by 10% + $5: a flat $5 on a $1,240 share
  // (LLY, 2026-10-20) fell inside the half-percent rounding tolerance
  const lines = rows.map((r, i) => `${r.a}\t${r.k}\t${sd(r.d)}\t${r.s}\t${i === 0 ? (r.p || 0) * 1.1 + 5 : r.p ?? ''}\t${r.o ?? ''}`);
  lines.push(`9999999999-26-000001\tP\t${sd(day)}\t100\t12.5\t100`);
  fs.writeFileSync(path.join(dir, 'NONDERIV_TRANS.tsv'), ['ACCESSION_NUMBER\tTRANS_CODE\tTRANS_DATE\tTRANS_SHARES\tTRANS_PRICEPERSHARE\tSHRS_OWND_FOLWNG_TRANS', ...lines].join('\n'));
  const out = execFileSync('node', ['scripts/insider-dataset-check.mjs', '--dir', dir, '--name', 'test', '--from', day, '--to', day, '--dry-run'], { cwd: new URL('..', import.meta.url).pathname, encoding: 'utf8', env: { ...process.env, GITHUB_STEP_SUMMARY: '' } });
  fs.rmSync(dir, { recursive: true, force: true });
  assert.match(out, new RegExp(`${accs.length} of \\d+ filings of ours in this data set`));
  assert.match(out, /differ \(1 lines\); 1 purchase\/sale lines absent/);
  assert.match(out, /"price":1/);
  assert.match(out, /ABSENT 9999999999-26-000001 NEWCO P/);
});
