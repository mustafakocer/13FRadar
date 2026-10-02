// The quarterly index read: the first days of a quarter publish a short index
// (the header alone on 2026-10-01), which is an index, not a failed fetch.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readMasterIdx } from '../scripts/build-universe.mjs';

const HEADER = `Description:           Master Index of EDGAR Dissemination Feed
Last Data Received:    October 1, 2026
Comments:              webmaster@sec.gov
Anonymous FTP:         ftp://ftp.sec.gov/edgar/

CIK|Company Name|Form Type|Date Filed|Filename
--------------------------------------------------------------------------------
`;

test('readMasterIdx: a header-only index on a quarter\'s first day is an index', () => {
  assert.ok(HEADER.length < 1000);
  assert.equal(readMasterIdx(200, HEADER), 'ok');
  assert.equal(readMasterIdx(200, `${HEADER}1067983|BERKSHIRE HATHAWAY INC|13F-HR|2026-10-01|edgar/data/1067983/0000950123-26-000001.txt\n`), 'ok');
});

test('readMasterIdx: not published, throttled or an error page', () => {
  assert.equal(readMasterIdx(404, ''), 'empty');
  assert.equal(readMasterIdx(403, '<html>Request Rate Threshold Exceeded</html>'), 'retry');
  assert.equal(readMasterIdx(200, '<html><body>Undeclared Automated Tool</body></html>'), 'retry');
  assert.equal(readMasterIdx(200, ''), 'retry');
  assert.equal(readMasterIdx(200, undefined), 'retry');
  // a cut transfer before the header
  assert.equal(readMasterIdx(200, 'Description:           Master Index of EDGAR'), 'retry');
});

test('build-universe: only the previous quarter is required', async () => {
  const fs = await import('node:fs');
  const src = fs.readFileSync(new URL('../scripts/build-universe.mjs', import.meta.url), 'utf8');
  assert.match(src, /if \(qt === cur\) \{[\s\S]*?continue;/);
});
