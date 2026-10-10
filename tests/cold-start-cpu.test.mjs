// The cold-start CPU work moved out of the request path must not change an
// answer: the closed-form business-day count, the day-string cache in the
// price decoder, and the prebuilt insider dataset (accepted only when it was
// built from the inputs the instance carries).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { businessDaysBetween } from '../api/_lib/insiderModel.js';
import { decodeSeries, encodeSeries } from '../api/_lib/priceStore.js';
import { acceptPrebuilt, servedFingerprint } from '../api/_lib/insiderStore.js';

// the day-by-day loop the closed form replaced
function loopBusinessDays(transDate, filedDate) {
  const a = new Date(`${transDate}T00:00:00Z`);
  const b = new Date(`${filedDate}T00:00:00Z`);
  if (!(a <= b)) return null;
  let n = 0;
  const cur = new Date(a);
  while (cur < b) {
    cur.setUTCDate(cur.getUTCDate() + 1);
    const d = cur.getUTCDay();
    if (d !== 0 && d !== 6) n++;
  }
  return n;
}

const iso = (ms) => new Date(ms).toISOString().slice(0, 10);

test('businessDaysBetween matches the day-by-day count for every start weekday and gap', () => {
  const start = Date.parse('2023-12-25T00:00:00Z'); // a Monday, across a year end and a leap day
  for (let s = 0; s < 14; s++) {
    for (let gap = -3; gap <= 800; gap++) {
      const a = iso(start + s * 86400000);
      const b = iso(start + (s + gap) * 86400000);
      assert.equal(businessDaysBetween(a, b), loopBusinessDays(a, b), `${a} → ${b}`);
    }
  }
});

test('businessDaysBetween keeps the null answers', () => {
  for (const [a, b] of [[null, '2024-01-02'], ['2024-01-02', null], ['bad', '2024-01-02'], ['2024-01-05', '2024-01-02'], [undefined, undefined]]) {
    assert.equal(businessDaysBetween(a, b), loopBusinessDays(a, b), `${a} → ${b}`);
  }
  assert.equal(businessDaysBetween('2024-01-05', '2024-01-05'), 0);
});

test('decodeSeries round-trips an encoded series, weekends and gaps included', () => {
  const rows = [];
  let t = Date.parse('2015-01-02T00:00:00Z');
  for (let i = 0; i < 3000; i++) {
    t += (i % 5 === 4 ? 3 : 1) * 86400000 + (i % 97 === 0 ? 86400000 * 4 : 0);
    rows.push({ date: iso(t), close: 10 + (i % 50) / 4 });
  }
  const enc = encodeSeries(rows);
  const dec = decodeSeries(enc);
  assert.deepEqual(dec, rows);
  // a second decode answers from the day cache with the same strings
  assert.deepEqual(decodeSeries(enc), rows);
});

test('decodeSeries still rejects a file it cannot read', () => {
  assert.deepEqual(decodeSeries(null), []);
  assert.deepEqual(decodeSeries({ from: '2024-01-02', d: [0], c: null }), []);
  assert.throws(() => decodeSeries({ from: 'not-a-date', d: [0], c: [1] }), RangeError);
});

test('a prebuilt insider dataset is used only when its inputs match', () => {
  const served = { rows: [{ a: 'x', li: 0 }], lastFilingDay: '2026-10-09' };
  const warn = console.warn;
  console.warn = () => {};
  try {
    assert.equal(acceptPrebuilt({ fingerprint: '1:2:3', served }, '1:2:3'), served);
    assert.equal(acceptPrebuilt({ fingerprint: '1:2:3', served }, '1:2:4'), null);
    assert.equal(acceptPrebuilt({ fingerprint: '1:2:3' }, '1:2:3'), null);
    assert.equal(acceptPrebuilt(null, '1:2:3'), null);
  } finally {
    console.warn = warn;
  }
});

test('the fingerprint follows the stored inputs', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'served-'));
  const prev = process.env.INSIDER_DATA_DIR;
  process.env.INSIDER_DATA_DIR = dir;
  try {
    fs.writeFileSync(path.join(dir, 'insiders.json'), '{"rows":[]}');
    const a = servedFingerprint();
    fs.writeFileSync(path.join(dir, 'insiders.json'), '{"rows":[{"a":"x"}]}');
    assert.notEqual(servedFingerprint(), a);
  } finally {
    if (prev == null) delete process.env.INSIDER_DATA_DIR;
    else process.env.INSIDER_DATA_DIR = prev;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
