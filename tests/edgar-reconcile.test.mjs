// The 13F pipeline against the SEC filings themselves, offline.
//
// tests/fixtures/edgar holds real information tables as filed (the funds of
// config/reconcile-funds.json; tests/fixtures/make-edgar-fixtures.mjs fetches
// them). Each is run through the code the nightly build and /api/holdings use
// — parse13F → aggregatePositions → effectiveSnapshot → snapshotEntry — and
// every position of the result is compared with a reading of the same XML
// made here, by a parser and arithmetic of this file's own: nothing below the
// "independent reading" line calls the code under test, so a bug there cannot
// agree with itself.
//
// Three things are pinned per fund:
//   1. every position (not the ten the site stores): shares, value, weight;
//      the position count; the total
//   2. the filer's own cover page (table entry total, table value total)
//   3. what the site stored for the filing on the day the fixture was made
//      (manifest `site`, from api/_data/latest-holdings.json)
//
// The live counterpart, over the network and today's data, is
// scripts/reconcile-edgar.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import './helpers.mjs';
import { root } from './helpers.mjs';
import { parse13F, aggregatePositions } from '../api/_lib/sec.js';
import { effectiveSnapshot, parseCoverPage } from '../api/_lib/amendments.js';
import { snapshotEntry } from '../api/_lib/latestHoldings.js';

const dir = path.join(root, 'tests', 'fixtures', 'edgar');
const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
const fileOf = (cik, acc, name) => path.join(dir, 'filings', String(Number(cik)), acc.replace(/-/g, ''), name);
const readOf = (cik, acc, name) => fs.readFileSync(fileOf(cik, acc, name), 'utf8');
const closesOf = (cik, acc) => JSON.parse(readOf(cik, acc, 'closes.json'));

// ---------------------------------------------------------------------------
// The pipeline under test, fed from the fixtures. The period-end closes come
// from the fixture too, so the unit and column checks see the prices they saw
// on the day of the fetch and not tonight's archive.
// (Line corrections — lineCorrections.js, a nightly data file — are left out:
// none of these filings has one, and the test must not read live data.)
// ---------------------------------------------------------------------------
async function pipelineOne(cik, acc, filed, period) {
  const closes = closesOf(cik, acc);
  const rows = await parse13F(readOf(cik, acc, 'infotable.xml'));
  return aggregatePositions(rows, filed, { period, closeOf: (row) => closes[String(row.cusip || '').toUpperCase()] ?? null });
}
async function pipeline(f) {
  const base = await pipelineOne(f.cik, f.acc, f.filed, f.reportDate);
  if (!f.amendments.length) return base;
  const read = [];
  for (const a of f.amendments) {
    read.push({ acc: a.acc, filingDate: a.filingDate, holdings: await pipelineOne(f.cik, a.acc, a.filingDate, f.reportDate), cover: parseCoverPage(readOf(f.cik, a.acc, 'primary_doc.xml')) });
  }
  return effectiveSnapshot(base, read);
}

// ---------------------------------------------------------------------------
// The independent reading. Regular expressions over the raw XML; no import
// from api/ is used from here to the end of the section.
// ---------------------------------------------------------------------------
const field = (block, name) => {
  const m = new RegExp(`<(?:[\\w-]+:)?${name}(?:\\s[^>]*)?>\\s*([^<]*?)\\s*</(?:[\\w-]+:)?${name}\\s*>`, 'i').exec(block);
  return m ? m[1] : '';
};
const number = (s) => {
  const n = Number(String(s).replace(/,/g, ''));
  assert.ok(Number.isFinite(n), `not a number in the filing: ${JSON.stringify(s)}`);
  return n;
};
function rawRows(xml) {
  const rows = [];
  for (const m of xml.matchAll(/<(?:[\w-]+:)?infoTable(?:\s[^>]*)?>([\s\S]*?)<\/(?:[\w-]+:)?infoTable\s*>/gi)) {
    rows.push({
      cusip: field(m[1], 'cusip').toUpperCase(),
      putCall: field(m[1], 'putCall'),
      value: number(field(m[1], 'value')),
      amount: number(field(m[1], 'sshPrnamt')),
      amountType: field(m[1], 'sshPrnamtType').toUpperCase(),
    });
  }
  return rows;
}
// A 13F book is keyed by security and option side: the shares, the calls and
// the puts on one CUSIP are three positions; the same key on several lines
// (one per co-manager, per voting authority) is one.
const keyOf = (r) => `${r.cusip}|${r.putCall}`;
function book(rows, unit) {
  const map = new Map();
  for (const r of rows) {
    const cur = map.get(keyOf(r)) || { cusip: r.cusip, putCall: r.putCall, value: 0, shares: 0, lines: 0, prn: false };
    cur.value += r.value * unit;
    cur.shares += r.amount;
    cur.lines += 1;
    if (r.amountType === 'PRN') cur.prn = true;
    map.set(keyOf(r), cur);
  }
  return map;
}
// SEC rule: filings made on or after 2023-01-03 state values in dollars.
const statedUnit = (filed) => (filed >= '2023-01-03' ? 1 : 1000);
// The unit a filing is really in, from the fixture's period-end closes: the
// median of (value ÷ shares) ÷ close over the share rows that have a price.
// Near 1 is dollars; near 1/1000 is thousands written into a dollars filing.
function medianPriceRatio(rows, closes) {
  const ratios = rows
    .filter((r) => !r.putCall && r.amountType !== 'PRN' && r.value > 0 && r.amount > 0 && closes[r.cusip] > 0)
    .map((r) => r.value / r.amount / closes[r.cusip])
    .sort((a, b) => a - b);
  return ratios.length ? ratios[Math.floor(ratios.length / 2)] : null;
}
// The filer's cover page, read the same way.
function cover(xml) {
  return { entries: number(field(xml, 'tableEntryTotal')), value: number(field(xml, 'tableValueTotal')), amendmentType: field(xml, 'amendmentType').toUpperCase() };
}
// ---------------------------------------------------------------------------

// The two filers of the set known to write thousands into a dollars filing
// (their cover pages declare $5.05M and $4.47M for books of $5.05B and
// $4.47B). Everyone else is in dollars. Stated here, not read from the site.
const THOUSANDS = new Set(['0001061768', '0001536411']);

// What the book of one fund should be, from the XML alone.
function expected(f) {
  const unitOf = () => statedUnit(f.filed) * (THOUSANDS.has(f.cik) ? 1000 : 1);
  const baseRows = rawRows(readOf(f.cik, f.acc, 'infotable.xml'));
  const baseCover = cover(readOf(f.cik, f.acc, 'primary_doc.xml'));
  let positions = book(baseRows, unitOf());
  let rowCount = baseRows.length;
  let declared = { entries: baseCover.entries, value: baseCover.value };
  for (const a of f.amendments) {
    const rows = rawRows(readOf(f.cik, a.acc, 'infotable.xml'));
    const c = cover(readOf(f.cik, a.acc, 'primary_doc.xml'));
    const amended = book(rows, unitOf());
    if (c.amendmentType === 'RESTATEMENT') {
      // the amendment is the whole book; the original is discarded
      positions = amended;
      rowCount = rows.length;
      declared = { entries: c.entries, value: c.value };
    } else {
      assert.equal(c.amendmentType, 'NEW HOLDINGS', `${f.name}: unexpected amendment type on the cover page`);
      // the fixture's new-holdings amendment adds names the original does
      // not carry, so the book is simply both tables; a fixture that breaks
      // this needs its own expectation written, not a silent merge
      for (const k of amended.keys()) assert.ok(!positions.has(k), `${f.name}: the NEW HOLDINGS amendment repeats ${k}`);
      for (const [k, v] of amended) positions.set(k, v);
      rowCount += rows.length;
      declared = { entries: declared.entries + c.entries, value: declared.value + c.value };
    }
  }
  const total = [...positions.values()].reduce((s, p) => s + p.value, 0);
  return { positions, total, rowCount, declared, unit: unitOf(), baseRows };
}

test('fixtures: thirteen real filings, every class the list promises', () => {
  assert.ok(manifest.funds.length >= 12, `only ${manifest.funds.length} funds in the fixture set`);
  for (const f of manifest.funds) {
    for (const acc of [f.acc, ...f.amendments.map((a) => a.acc)]) {
      for (const name of ['infotable.xml', 'primary_doc.xml', 'closes.json']) assert.ok(fs.existsSync(fileOf(f.cik, acc, name)), `${f.name} ${acc}: ${name} missing`);
    }
  }
  const all = manifest.funds.map((f) => ({ f, e: expected(f) }));
  const some = (label, pred) => assert.ok(all.some(pred), `no fixture covers: ${label}`);
  some('one CUSIP on several lines', ({ e }) => [...e.positions.values()].some((p) => p.lines > 1));
  some('thousands written into a dollars filing', ({ f }) => THOUSANDS.has(f.cik));
  some('put/call rows', ({ e }) => [...e.positions.values()].some((p) => p.putCall));
  some('shares and an option on the same CUSIP', ({ e }) => [...e.positions.values()].some((p) => p.putCall && e.positions.has(`${p.cusip}|`)));
  some('principal amounts (convertible notes)', ({ e }) => [...e.positions.values()].some((p) => p.prn));
  some('a restating amendment', ({ f }) => f.amendments.some((a) => a.type === 'RESTATEMENT'));
  some('a new-holdings amendment', ({ f }) => f.amendments.some((a) => a.type === 'NEW HOLDINGS'));
  some('a book of two hundred positions or more', ({ e }) => e.positions.size >= 200);
  some('a book of ten positions or fewer', ({ e }) => e.positions.size <= 10);
  some('a foreign security (non-US CUSIP prefix)', ({ e }) => [...e.positions.keys()].some((k) => /^[A-Z]/.test(k)));
});

for (const f of manifest.funds) {
  const label = `${f.name} (${f.cik}, ${f.reportDate})`;

  test(`${label}: the unit the test assumes is the unit the prices show`, () => {
    const rows = rawRows(readOf(f.cik, f.acc, 'infotable.xml'));
    const m = medianPriceRatio(rows, closesOf(f.cik, f.acc));
    // a book with too few priced rows cannot vote; the cover-page check below still holds it
    if (m == null) return;
    if (THOUSANDS.has(f.cik)) assert.ok(m > 1 / 3000 && m < 1 / 300, `${f.name}: median implied price ÷ close is ${m}, not a thousandth`);
    else assert.ok(m > 0.5 && m < 2, `${f.name}: median implied price ÷ close is ${m}, not 1`);
  });

  test(`${label}: every position matches the filing — shares, value, weight, count, total`, async () => {
    const e = expected(f);
    const got = await pipeline(f);

    // the filer's own cover page agrees with the table we read (in the
    // filing's own unit), so the fixture is the document the filer signed
    assert.equal(e.rowCount, e.declared.entries, `${f.name}: the cover page declares ${e.declared.entries} lines, the table has ${e.rowCount}`);
    assert.ok(Math.abs(e.total / e.unit - e.declared.value) <= Math.max(2, e.declared.value * 1e-6), `${f.name}: the cover page declares ${e.declared.value}, the table sums to ${e.total / e.unit}`);

    // count and total
    assert.equal(got.positions.length, e.positions.size, `${f.name}: position count`);
    assert.ok(Math.abs(got.aum - e.total) <= 1, `${f.name}: total ${got.aum} against ${e.total} in the filing`);

    // every position, both ways: none missing, none invented, none doubled
    const seen = new Set();
    let weights = 0;
    for (const p of got.positions) {
      const k = `${p.cusip}|${p.putCall || ''}`;
      assert.ok(!seen.has(k), `${f.name}: ${k} appears twice`);
      seen.add(k);
      const x = e.positions.get(k);
      assert.ok(x, `${f.name}: ${k} is not in the filing`);
      assert.ok(Math.abs(p.shares - x.shares) <= 0.5, `${f.name} ${k}: shares ${p.shares} against ${x.shares}`);
      assert.ok(Math.abs(p.value - x.value) <= 1, `${f.name} ${k}: value ${p.value} against ${x.value}`);
      const w = e.total ? (x.value / e.total) * 100 : 0;
      assert.ok(Math.abs(p.weight - w) <= 1e-9, `${f.name} ${k}: weight ${p.weight} against ${w}`);
      assert.equal(Boolean(p.prn), x.prn, `${f.name} ${k}: principal-amount flag`);
      weights += p.weight;
    }
    assert.equal(seen.size, e.positions.size);
    assert.ok(Math.abs(weights - 100) <= 1e-6, `${f.name}: weights sum to ${weights}`);
    // largest first: the "top ten" is the ten largest
    for (let i = 1; i < got.positions.length; i++) assert.ok(got.positions[i - 1].value >= got.positions[i].value, `${f.name}: not sorted by value at row ${i}`);

    // the unit correction is recorded when one was made, and only then
    const factor = got.unitFix?.factor ?? 1;
    assert.equal(factor, THOUSANDS.has(f.cik) ? 1000 : 1, `${f.name}: unit factor`);
  });

  test(`${label}: what the site stored is what the filing says`, async () => {
    const e = expected(f);
    const got = await pipeline(f);
    const entry = snapshotEntry({ acc: f.acc, filed: f.filed, reportDate: f.reportDate, aum: got.aum, positions: got.positions, amendments: got.amendments || null, unitFix: got.unitFix || null });
    const site = f.site;

    // the stored entry against the independent reading
    assert.equal(site.count, e.positions.size, `${f.name}: stored position count`);
    assert.ok(Math.abs(site.aum - e.total) <= 1, `${f.name}: stored total ${site.aum} against ${e.total}`);
    const ranked = [...e.positions.values()].sort((a, b) => b.value - a.value);
    assert.equal(site.top.length, Math.min(10, ranked.length));
    site.top.forEach((p, i) => {
      const x = e.positions.get(`${p.cusip}|${p.putCall || ''}`);
      assert.ok(x, `${f.name}: stored row ${p.cusip} is not in the filing`);
      assert.ok(Math.abs(p.shares - x.shares) <= 0.5, `${f.name} ${p.cusip}: stored shares ${p.shares} against ${x.shares}`);
      assert.ok(Math.abs(p.value - x.value) <= 1, `${f.name} ${p.cusip}: stored value ${p.value} against ${x.value}`);
      assert.ok(Math.abs(p.weight - (x.value / e.total) * 100) <= 0.0006, `${f.name} ${p.cusip}: stored weight ${p.weight}`);
      // the i-th stored row is the i-th largest of the filing (ties by value may swap)
      assert.ok(Math.abs(x.value - ranked[i].value) <= 1, `${f.name}: stored row ${i + 1} is not the ${i + 1}th largest position`);
    });
    const options = [...e.positions.values()].reduce((s, p) => s + (p.putCall ? p.value : 0), 0);
    if (site.putCallValue != null) assert.ok(Math.abs(site.putCallValue - options) <= 1, `${f.name}: stored option notional ${site.putCallValue} against ${options}`);
    assert.equal(site.unitFactor, THOUSANDS.has(f.cik) ? 1000 : 1, `${f.name}: stored unit factor`);

    // and the pipeline reproduces the stored entry field for field
    assert.equal(entry.aum, site.aum);
    assert.equal(entry.count, site.count);
    assert.deepEqual(
      entry.top.map((p) => [p.cusip, p.putCall || '', p.shares, p.value, p.weight]),
      site.top.map((p) => [p.cusip, p.putCall || '', p.shares, p.value, p.weight])
    );
    assert.deepEqual((entry.amendments || []).map((a) => [a.acc, a.type]), f.amendments.map((a) => [a.acc, a.type]));
  });
}

test('Berkshire: 30 positions out of more lines than that, Apple the sum of its lines', async () => {
  const f = manifest.funds.find((x) => x.cik === '0001067983');
  const e = expected(f);
  assert.ok(e.rowCount > e.positions.size, 'the table has one line per position: nothing to aggregate');
  const apple = e.positions.get('037833100|');
  assert.ok(apple.lines > 1, 'Apple is on a single line');
  const got = await pipeline(f);
  const p = got.positions.find((x) => x.cusip === '037833100');
  assert.equal(p.shares, apple.shares);
  assert.equal(p.value, apple.value);
});

test('an option on a CUSIP is a position of its own, never added to the shares', async () => {
  for (const f of manifest.funds) {
    const e = expected(f);
    const got = await pipeline(f);
    for (const x of e.positions.values()) {
      if (!x.putCall || !e.positions.has(`${x.cusip}|`)) continue;
      const shares = got.positions.find((p) => p.cusip === x.cusip && !p.putCall);
      const option = got.positions.find((p) => p.cusip === x.cusip && p.putCall === x.putCall);
      assert.ok(shares && option, `${f.name} ${x.cusip}: shares and ${x.putCall} are not both in the book`);
      assert.ok(Math.abs(shares.shares - e.positions.get(`${x.cusip}|`).shares) <= 0.5);
      assert.ok(Math.abs(option.shares - x.shares) <= 0.5);
    }
  }
});

test('Vision Capital: the restatement replaces the original, whose cover total was a typo', async () => {
  const f = manifest.funds.find((x) => x.cik === '0001764403');
  const original = cover(readOf(f.cik, f.acc, 'primary_doc.xml'));
  const restated = cover(readOf(f.cik, f.amendments[0].acc, 'primary_doc.xml'));
  const got = await pipeline(f);
  assert.equal(got.amended, true);
  assert.equal(got.amendments[0].type, 'RESTATEMENT');
  assert.ok(Math.abs(got.aum - restated.value) <= 2, 'the book is the restated total');
  assert.notEqual(original.value, restated.value);
});

test('Cisco: the new-holdings amendment adds its line to the original five', async () => {
  const f = manifest.funds.find((x) => x.cik === '0000858877');
  const base = rawRows(readOf(f.cik, f.acc, 'infotable.xml'));
  const added = rawRows(readOf(f.cik, f.amendments[0].acc, 'infotable.xml'));
  const got = await pipeline(f);
  assert.equal(got.amendments[0].type, 'NEW HOLDINGS');
  assert.equal(got.positions.length, new Set([...base, ...added].map(keyOf)).size);
  for (const r of added) assert.ok(got.positions.some((p) => p.cusip === r.cusip), `${r.cusip} from the amendment is missing`);
});
