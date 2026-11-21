// scripts/reconcile-edgar.mjs: the comparison itself, on made-up books (the
// script's network half is run by hand and by weekly-sample.yml). The real
// filings are in tests/edgar-reconcile.test.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { reconcile, secBook } from '../scripts/reconcile-edgar.mjs';

const raw = (lines) => new Map(lines.map(([cusip, putCall, shares, value]) => [`${cusip}|${putCall}`, { cusip, putCall, shares, value, lines: 1 }]));
const A = raw([['AAA', '', 100, 5000], ['BBB', '', 10, 3000], ['BBB', 'Put', 5, 2000]]);
// the book the site's code would make of A, in dollars
const bookOf = (m) => {
  const positions = [...m.values()].map((p) => ({ cusip: p.cusip, putCall: p.putCall, shares: p.shares, value: p.value })).sort((a, b) => b.value - a.value);
  const aum = positions.reduce((s, p) => s + p.value, 0);
  for (const p of positions) p.weight = (p.value / aum) * 100;
  return { aum, positions };
};
const storedOf = (full, n = 10) => ({ aum: Math.round(full.aum), count: full.positions.length, top: full.positions.slice(0, n).map((p) => ({ cusip: p.cusip, ...(p.putCall ? { putCall: p.putCall } : {}), shares: p.shares, value: p.value, weight: Number(p.weight.toFixed(3)) })) });

test('a book that is its filing matches on every line, the count, the total and the stored entry', () => {
  const sec = secBook([{ raw: A, type: null }], 1);
  const full = bookOf(sec);
  const r = reconcile({ stored: storedOf(full), full, sec, declared: 10000 });
  assert.equal(r.ok, true);
  assert.deepEqual(r.lines, { checked: 3, bad: 0 });
  assert.equal(r.storedOk, true);
  assert.equal(r.coverOk, true);
  assert.deepEqual(r.notes, []);
});

test('one share, one dollar, one missing line, one invented line: each is caught', () => {
  const sec = secBook([{ raw: A, type: null }], 1);
  const good = bookOf(sec);
  const tweak = (fn) => {
    const full = { aum: good.aum, positions: good.positions.map((p) => ({ ...p })) };
    fn(full);
    return reconcile({ stored: null, full, sec });
  };
  assert.equal(tweak((b) => (b.positions[0].shares += 1)).ok, false);
  assert.equal(tweak((b) => (b.positions[1].value += 2)).ok, false);
  assert.equal(tweak((b) => (b.positions[2].weight += 0.01)).ok, false);
  const missing = tweak((b) => b.positions.pop());
  assert.equal(missing.ok, false);
  assert.match(missing.notes.join(' '), /missing from the book/);
  const invented = tweak((b) => b.positions.push({ cusip: 'ZZZ', putCall: '', shares: 1, value: 1, weight: 0 }));
  assert.equal(invented.ok, false);
  assert.match(invented.notes.join(' '), /not in the filing/);
  // within rounding: half a share, a dollar
  assert.equal(tweak((b) => { b.positions[0].shares += 0.4; b.positions[0].value += 0.9; }).ok, true);
});

test('the stored entry is checked against the book: count, total, the ten largest in order', () => {
  const sec = secBook([{ raw: A, type: null }], 1);
  const full = bookOf(sec);
  const bad = (fn) => {
    const stored = storedOf(full);
    fn(stored);
    return reconcile({ stored, full, sec });
  };
  assert.equal(bad((s) => (s.count += 1)).storedOk, false);
  assert.equal(bad((s) => (s.aum *= 1000)).storedOk, false);
  assert.equal(bad((s) => s.top.reverse()).storedOk, false);
  assert.equal(bad((s) => (s.top[0].shares += 5)).ok, false);
});

test('values are compared in the unit the site settled on; the cover page says whether that unit is right', () => {
  // thousands written into a dollars filing: the table says 5, 3, 2; the cover 10
  const thousands = raw([['AAA', '', 100, 5], ['BBB', '', 10, 3], ['BBB', 'Put', 5, 2]]);
  const sec = secBook([{ raw: thousands, type: null }], 1000);
  const full = bookOf(sec);
  assert.equal(full.aum, 10000);
  assert.equal(reconcile({ stored: storedOf(full), full, sec, declared: 10 * 1000 }).ok, true);
  // a filer whose cover page disagrees with its own table is noted, not failed
  const r = reconcile({ stored: storedOf(full), full, sec, declared: 99000 });
  assert.equal(r.ok, true);
  assert.equal(r.coverOk, false);
  assert.match(r.notes.join(' '), /cover page declares/);
});

test('amendments: a restatement replaces the book, new holdings add to it, a line stated again is not doubled', () => {
  const restated = raw([['AAA', '', 90, 4500], ['CCC', '', 1, 100]]);
  assert.deepEqual([...secBook([{ raw: A, type: null }, { raw: restated, type: 'RESTATEMENT' }], 1).keys()], ['AAA|', 'CCC|']);
  const added = raw([['DDD', '', 7, 700], ['AAA', '', 100, 5000], ['BBB', '', 4, 1200]]);
  const b = secBook([{ raw: A, type: null }, { raw: added, type: 'NEW HOLDINGS' }], 1);
  assert.equal(b.size, 4);
  assert.equal(b.get('DDD|').shares, 7);
  assert.equal(b.get('AAA|').shares, 100, 'the same line stated again');
  assert.equal(b.get('BBB|').shares, 14, 'another lot of a name the book carries');
  assert.equal(b.get('BBB|').value, 4200);
});

test('a line the site corrected is compared at the corrected figure and said out loud', () => {
  const sec = secBook([{ raw: A, type: null }], 1);
  const full = bookOf(new Map([...sec].map(([k, v]) => [k, k === 'AAA|' ? { ...v, value: v.value * 0.1 } : v])));
  full.positions.find((p) => p.cusip === 'AAA').lineFix = { factor: 0.1, by: 'close' };
  const r = reconcile({ stored: null, full, sec });
  assert.equal(r.ok, true);
  assert.match(r.notes.join(' '), /1 line\(s\) corrected by the site: AAA ×0\.1/);
  // the caller's map is not touched
  assert.equal(sec.get('AAA|').value, 5000);
});

test('the weekly workflow runs it, alarms on a difference, and never on a pull request', () => {
  const wf = fs.readFileSync(new URL('../.github/workflows/weekly-sample.yml', import.meta.url), 'utf8');
  assert.match(wf, /node scripts\/reconcile-edgar\.mjs/);
  assert.match(wf, /steps\.reconcile\.outcome == 'failure' && github\.event_name != 'pull_request'/);
  assert.match(wf, /notify\.mjs --title "13F mutabakatı[^"]*" --resolve/);
  assert.doesNotMatch(wf, /contents: write/);
  const funds = JSON.parse(fs.readFileSync(new URL('../config/reconcile-funds.json', import.meta.url), 'utf8')).funds;
  assert.ok(funds.length >= 12);
  for (const f of funds) assert.match(f.cik, /^\d{10}$/);
  assert.equal(new Set(funds.map((f) => f.cik)).size, funds.length);
});
