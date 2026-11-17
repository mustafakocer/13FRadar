import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// The SEC second-line pass over identifiers OpenFIGI could not map
// (api/_lib/secSecurities.js) and the master's `classified` bucket.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fundocap-secsec-'));
process.env.SECURITY_MASTER_FILE = path.join(tmp, 'security-master.json');

const master = await import('../api/_lib/securityMaster.js');
const sec = await import('../api/_lib/secSecurities.js');
const { auditDataset, DATASETS } = await import('../api/_lib/dataAudit.js');

// Fixed-width lines as the SEC prints them: CUSIP, '*'/' ', name (30), class (27), status.
const line = (cusip, star, name, desc, status = '') => `${cusip}${star}${name.padEnd(30)}${desc.padEnd(27)}${status.padEnd(5)}E`;
const LIST = [
  line('037833100', '*', 'APPLE INC', 'COM'),
  line('037833900', ' ', 'APPLE INC', 'CALL'),
  line('037833950', ' ', 'APPLE INC', 'PUT'),
  line('464287101', '*', 'ISHARES TR', 'S&P 100 ETF'),
  line('464287900', ' ', 'ISHARES TR', 'CALL'),
  line('464287150', '*', 'ISHARES TR', 'CORE S&P TTL STK'),
  line('464287900', ' ', 'ISHARES TR', 'CALL'),
  line('182744300', '*', 'KIDZ AI INC', 'CL B NEW', '*D*'),
  line('36467W117', ' ', 'GAMESTOP CORP NEW', '*W EXP 10/30/202'),
  line('G4474Y214', ' ', 'JANUS HENDERSON GROUP PLC', 'ORD SHS', '*D*'),
  line('02079K305', '*', 'ALPHABET INC', 'CAP STK CL A'),
  line('02079K107', '*', 'ALPHABET INC', 'CAP STK CL C'),
].join('\n');
const LISTED = {
  fields: ['cik', 'name', 'ticker', 'exchange'],
  data: [
    [1, 'Apple Inc.', 'AAPL', 'Nasdaq'],
    [2, 'KIDZ AI Inc.', 'KIDZ', 'Nasdaq'],
    [2, 'KIDZ AI Inc.', 'KIDZW', 'Nasdaq'],
    [3, 'GameStop Corp.', 'GME', 'NYSE'],
    [4, 'Alphabet Inc.', 'GOOGL', 'Nasdaq'],
    [4, 'Alphabet Inc.', 'GOOG', 'Nasdaq'],
  ],
};

test('CUSIP check digit: published CUSIPs pass, typos and placeholders do not', () => {
  for (const c of ['037833100', '594918104', '02079K305', 'G5876H105', 'H1467J104']) assert.ok(sec.isValidCusip(c), c);
  for (const c of ['037833101', 'US5128073', '000000000', '000000004', 'DK0061412', 'abc', '']) assert.ok(!sec.isValidCusip(c), c);
});

test('13(f) list: a CALL/PUT code points at its security only when one security uses it', () => {
  const rows = sec.parse13fList(LIST);
  assert.deepEqual(rows.get('037833900').underlyings, ['037833100']);
  assert.equal(rows.get('037833950').putCall, 'PUT');
  assert.deepEqual(rows.get('464287900').underlyings.sort(), ['464287101', '464287150'], 'iShares reuses the code');
  assert.equal(rows.get('182744300').status, '*D*');
});

test('companyTicker: one common line wins; warrant symbols drop out; two classes stay ambiguous', () => {
  const idx = sec.indexListed(LISTED);
  assert.equal(sec.companyTicker(idx, 'KIDZ AI INC'), 'KIDZ');
  assert.equal(sec.companyTicker(idx, 'APPLE INC'), 'AAPL');
  assert.equal(sec.companyTicker(idx, 'ALPHABET INC'), null);
  assert.equal(sec.companyTicker(idx, 'NOBODY CORP'), null);
});

test('decide: option, warrant, delisted, invalid, unlisted, override, and a fresh CUSIP left alone', () => {
  const ctx = { list: sec.parse13fList(LIST), listed: sec.indexListed(LISTED), overrides: { '316092121': { ticker: 'FDIF' } }, tickerOf: (c) => ({ '037833100': 'AAPL' })[c] || null };
  assert.deepEqual(
    (({ action, kind, putCall, underlying, underlyingTicker }) => ({ action, kind, putCall, underlying, underlyingTicker }))(sec.decide('037833950', {}, ctx)),
    { action: 'classify', kind: 'option', putCall: 'PUT', underlying: '037833100', underlyingTicker: 'AAPL' }
  );
  const ish = sec.decide('464287900', {}, ctx);
  assert.equal(ish.kind, 'option');
  assert.equal(ish.underlying, null, 'ambiguous code: no underlying guessed');
  const w = sec.decide('36467W117', {}, ctx);
  assert.equal(w.kind, 'warrant');
  assert.equal(w.underlyingTicker, 'GME');
  assert.deepEqual([sec.decide('182744300', {}, ctx).action, sec.decide('182744300', {}, ctx).ticker], ['resolve', 'KIDZ'], 'deleted CUSIP of a company still listed');
  assert.equal(sec.decide('G4474Y214', {}, ctx).kind, 'delisted');
  assert.equal(sec.decide('US5128073', {}, ctx).kind, 'invalid');
  assert.equal(sec.decide('316092121', {}, ctx).ticker, 'FDIF');
  assert.equal(sec.decide('100001999', { attempts: 2 }, ctx), null, 'a valid unknown CUSIP waits for OpenFIGI');
  assert.equal(sec.decide('100001999', { attempts: sec.UNLISTED_AFTER }, ctx).kind, 'unlisted');
});

test('resolveFromSec: empties the unresolved table; classified codes keep tickerFor null and are not retried', async () => {
  fs.writeFileSync(
    process.env.SECURITY_MASTER_FILE,
    JSON.stringify({
      byCusip: { '037833100': { ticker: 'AAPL', source: 'static' } },
      unresolved: {
        '037833950': { name: null, attempts: 40, lastTried: null, lastError: null },
        '182744300': { name: 'KIDZ AI INC', attempts: 1, lastTried: null, lastError: null },
        '000000000': { name: null, attempts: 40, lastTried: null, lastError: null },
      },
    })
  );
  master.resetSecurityMaster();
  const r = await sec.resolveFromSec({ fetchList: async () => ({ quarter: '2026q3', text: LIST }), fetchListed: async () => LISTED, overrides: {} });
  assert.deepEqual([r.pending, r.resolved, r.classified, r.left], [3, 1, 2, 0]);
  assert.equal(master.stats().unresolved, 0);
  assert.equal(master.tickerFor('182744300'), 'KIDZ');
  assert.equal(master.tickerFor('037833950'), null, 'an option line is never priced as the stock');
  assert.equal(master.labelFor('037833950'), 'AAPL PUT');
  assert.deepEqual(master.needsLookup(['037833950', '000000000', '999999999']), ['999999999']);
  master.record('037833950', null); // an OpenFIGI miss does not put it back
  assert.equal(master.stats().unresolved, 0);
  master.persist({ force: true });
  const saved = JSON.parse(fs.readFileSync(process.env.SECURITY_MASTER_FILE, 'utf8'));
  assert.equal(Object.keys(saved.classified).length, 2);
});

test('data audit: the unresolved backlog shrinking is not a drift finding, growing still is', async () => {
  const spec = DATASETS.find((s) => s.key === 'security-master');
  const mk = (n) => ({ byCusip: Object.fromEntries(Array.from({ length: 4000 }, (_, i) => [String(i), {}])), unresolved: Object.fromEntries(Array.from({ length: n }, (_, i) => [String(i), {}])) });
  assert.equal(auditDataset({ spec, current: mk(0), baseline: mk(144) }).findings.filter((f) => f.rule === 'drift').length, 0);
  assert.equal(auditDataset({ spec, current: mk(300), baseline: mk(144) }).findings.filter((f) => f.rule === 'drift').length, 1);
});
