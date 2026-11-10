// A misfiled original the filer has restated (config/misfiled-books.json
// `correctedBy`), through the handlers. The fixture filer's 2025 Q4 original
// (five lines) stands in for another filer's table and its RESTATEMENT
// 13F-HR/A (six lines) for the filer's own book — KMT Wealth's 2026-06-30
// filing and its 2026-11-10 amendment, offline.
//
// The list is read once per process (MISFILED_BOOKS_FILE), so this file
// sets it before anything imports misfiledBooks.js.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import './helpers.mjs';
import { invoke } from '../api/_lib/ssr/invoke.js';
import { snapshotEntry } from '../api/_lib/latestHoldings.js';

const CIK = '0009000001';
const Q2 = '0009000001-26-000030';
const Q1 = '0009000001-26-000020';
const Q4 = '0009000001-26-000010'; // the "misfiled" original
const Q4A = '0009000001-26-000015'; // the filer's restatement
const AAPL = '037833100';
const HLT = '43300A203';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'misfiled-'));
const books = path.join(dir, 'misfiled-books.json');
fs.writeFileSync(
  books,
  JSON.stringify({
    filers: [
      { cik: CIK, acc: Q4, correctedBy: Q4A, copyOf: '0009000099', copyOfName: 'Somebody Else LP', declared: null },
      // the same slip, never corrected: the newest quarter of the same filer
      { cik: CIK, acc: Q2, copyOf: '0009000098', copyOfName: 'Another Filer LLC', declared: null },
    ],
  })
);
process.env.MISFILED_BOOKS_FILE = books;

// what the universe build stored before the amendment was filed: the
// original's table under the original's accession, no amendment applied
const stale = path.join(dir, 'latest-holdings.json');
const copyRows = Array.from({ length: 12 }, (_, i) => ({ cusip: `99999${String(i).padStart(4, '0')}`, putCall: '', issuer: `NOT OURS ${i}`, class: 'COM', value: 1e9 - i * 1e7, shares: 1000, weight: 100 / 12 }));
fs.writeFileSync(stale, JSON.stringify({ updatedAt: 'x', byCik: { [CIK]: snapshotEntry({ acc: Q4, filed: '2026-02-14', reportDate: '2025-12-31', aum: copyRows.reduce((s, p) => s + p.value, 0), positions: copyRows }) } }));
process.env.LATEST_HOLDINGS_FILE = stale;

test('/api/manager: an uncorrected newest quarter falls back to the newest valid one; the restated quarter is valid', async () => {
  const { default: manager } = await import('../api/_handlers/manager.js');
  const r = await invoke(manager, { cik: CIK });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.filings.map((f) => f.acc), [Q2, Q1, Q4]);
  // Q2 carries another filer's table: the page opens on Q1 and says so
  assert.equal(r.body.defaultAcc, Q1);
  assert.deepEqual(r.body.fallback, { reportDate: '2026-03-31', misfiled: { reportDate: '2026-06-30', acc: Q2, copyOf: '0009000098', copyOfName: 'Another Filer LLC' } });
  // the banner is the uncorrected filing's, never the restated one's
  assert.equal(r.body.misfiled.acc, Q2);
  // the site check's reading of the same answer
  const { misfiledBooks, misfiledState } = await import('../api/_lib/misfiledBooks.js');
  assert.deepEqual(
    misfiledBooks.map((e) => misfiledState(e, r.body.filings).state),
    ['retired', 'fallback'],
    'Q4 is behind two later periods; Q2 is the newest'
  );
  assert.equal(misfiledState(misfiledBooks[0], r.body.filings).corrected, true);
});

test('/api/holdings: the restated quarter is answered with the amendment applied, never from a snapshot stored before it', async () => {
  const { latestHoldings } = await import('../api/_lib/latestHoldings.js');
  assert.equal(latestHoldings(CIK, Q4).positions[0].issuer, 'NOT OURS 0', 'the stored snapshot is there, and it is the other table');
  const { default: holdings } = await import('../api/_handlers/holdings.js');
  const r = await invoke(holdings, { cik: CIK, acc: Q4, light: '1' });
  assert.equal(r.status, 200);
  assert.equal(r.body.acc, Q4);
  assert.equal(r.body.reportDate, '2025-12-31');
  assert.equal(r.body.amended, true);
  assert.deepEqual(r.body.amendments.map((a) => a.acc), [Q4A]);
  assert.equal(r.body.count, 6, 'the restated six lines, not the snapshot\'s twelve');
  assert.ok(r.body.positions.every((p) => !/NOT OURS/.test(p.issuer)));
  assert.equal(r.body.positions.find((p) => p.cusip === AAPL).shares, 100e6, 'the restated share count');
  assert.ok(r.body.positions.some((p) => p.cusip === HLT));
  // the amendment's own accession lands on the same snapshot
  const byAmendment = await invoke(holdings, { cik: CIK, acc: Q4A, light: '1' });
  assert.deepEqual([byAmendment.status, byAmendment.body.acc, byAmendment.body.count], [200, Q4, 6]);
});

test('/api/holdings: an uncorrected misfiled filing is still shown as EDGAR has it', async () => {
  const { default: holdings } = await import('../api/_handlers/holdings.js');
  const r = await invoke(holdings, { cik: CIK, acc: Q2, light: '1' });
  assert.equal(r.status, 200);
  assert.equal(r.body.count, 8);
});
