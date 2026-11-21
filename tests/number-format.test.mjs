// Numbers follow the page language (client/src/lib/format.js): Turkish pages
// write 1.326.590 · %29,0 · $1,23B, English pages 1,326,590 · 29.0% · $1.23B.
// The language is module state set around the synchronous server render, so
// these tests also pin that it is put back and that two languages rendered
// side by side do not leak into each other.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ssr } from './helpers.mjs';
import {
  setFormatLang,
  getFormatLang,
  withFormatLang,
  locNum,
  pctText,
  fmtMoney,
  fmtNum,
  fmtPx,
  fmtPct,
  fmtFracPct,
  fmtRatio,
  fmtTurnover,
  fmtLocal,
  fmtFormPrice,
} from '../client/src/lib/format.js';
import { guruAnswer } from '../client/src/lib/answerBox.js';
import { renderDigest } from '../api/_lib/alerts.js';

const inLang = (lang, fn) => withFormatLang(lang, fn);

test('formatters: English is the default and is what it always was', () => {
  assert.equal(getFormatLang(), 'en');
  assert.equal(fmtNum(1326590), '1,326,590');
  assert.equal(fmtNum(1234.567, 2), '1,234.57');
  assert.equal(fmtNum(0), '0');
  assert.equal(fmtNum(-1234), '-1,234');
  assert.equal(fmtPct(29), '+29.0%');
  assert.equal(fmtPct(-20.84), '-20.8%');
  assert.equal(fmtPct(0), '0.0%');
  assert.equal(fmtPct(0.34, { sign: false, digits: 2 }), '0.34%');
  assert.equal(fmtFracPct(0.245), '24.5%');
  assert.equal(fmtMoney(304196581325), '$304.20B');
  assert.equal(fmtMoney(1.5e12), '$1.50T');
  assert.equal(fmtMoney(-2.5e6), '-$2.5M');
  assert.equal(fmtMoney(1500), '$1.5K');
  assert.equal(fmtMoney(12.5), '$12.50');
  assert.equal(fmtMoney(1234567, { compact: false }), '$1,234,567');
  assert.equal(fmtPx(253.5), '$253.50');
  assert.equal(fmtPx(0.1234), '$0.1234');
  assert.equal(fmtPx(1234.5), '$1,234.50');
  assert.equal(fmtRatio(1.2345), '1.23');
  assert.equal(fmtTurnover(0.01), '<0.1%');
  assert.equal(fmtTurnover(12.34), '12.3%');
  assert.equal(fmtLocal('MXN', 6.93e6), 'MXN 6.93M');
  assert.equal(fmtFormPrice('BRL', 17.98), 'R$17.98');
  assert.equal(fmtFormPrice('MXN', 1234.5), 'MXN 1,234.50');
  assert.equal(pctText('12.3'), '12.3%');
  assert.equal(locNum('1,234.5'), '1,234.5');
});

test('formatters: Turkish swaps the separators and puts % in front, after the sign', () => {
  inLang('tr', () => {
    assert.equal(fmtNum(1326590), '1.326.590');
    assert.equal(fmtNum(1234.567, 2), '1.234,57');
    assert.equal(fmtNum(0), '0');
    assert.equal(fmtNum(-1234), '-1.234');
    assert.equal(fmtPct(29), '+%29,0');
    assert.equal(fmtPct(14.2), '+%14,2');
    assert.equal(fmtPct(-20.84), '-%20,8');
    assert.equal(fmtPct(0), '%0,0');
    assert.equal(fmtPct(0.34, { sign: false, digits: 2 }), '%0,34');
    assert.equal(fmtPct(72, { sign: false, digits: 0 }), '%72');
    assert.equal(fmtFracPct(0.245), '%24,5');
    assert.equal(fmtMoney(304196581325), '$304,20B');
    assert.equal(fmtMoney(1.5e12), '$1,50T');
    assert.equal(fmtMoney(-2.5e6), '-$2,5M');
    assert.equal(fmtMoney(1500), '$1,5K');
    assert.equal(fmtMoney(12.5), '$12,50');
    assert.equal(fmtMoney(1234567, { compact: false }), '$1.234.567');
    assert.equal(fmtPx(253.5), '$253,50');
    assert.equal(fmtPx(0.1234), '$0,1234');
    assert.equal(fmtPx(1234.5), '$1.234,50');
    assert.equal(fmtRatio(1.2345), '1,23');
    assert.equal(fmtTurnover(0.01), '<%0,1');
    assert.equal(fmtTurnover(12.34), '%12,3');
    assert.equal(fmtLocal('MXN', 6.93e6), 'MXN 6,93M');
    assert.equal(fmtFormPrice('BRL', 17.98), 'R$17,98');
    assert.equal(fmtFormPrice('MXN', 1234.5), 'MXN 1.234,50');
    assert.equal(pctText('12.3'), '%12,3');
    assert.equal(pctText(57), '%57');
    assert.equal(locNum(12.5), '12,5');
  });
});

test('formatters: nothing to show is a dash in both languages', () => {
  for (const lang of ['en', 'tr']) {
    inLang(lang, () => {
      for (const f of [fmtMoney, fmtNum, fmtPx, fmtPct, fmtRatio, fmtTurnover]) {
        assert.equal(f(null), '—', `${f.name}(null) ${lang}`);
        assert.equal(f(undefined), '—', `${f.name}(undefined) ${lang}`);
        assert.equal(f(NaN), '—', `${f.name}(NaN) ${lang}`);
      }
      assert.equal(fmtFracPct(null), '—');
      assert.equal(fmtLocal('MXN', null), '—');
      assert.equal(fmtFormPrice('USD', null), '—');
    });
  }
});

test('the language is put back: after a scope, after a throw, and unknown values mean English', () => {
  assert.equal(inLang('tr', () => fmtNum(1000)), '1.000');
  assert.equal(fmtNum(1000), '1,000');
  assert.throws(() => inLang('tr', () => { throw new Error('boom'); }), /boom/);
  assert.equal(getFormatLang(), 'en');
  setFormatLang('de');
  assert.equal(getFormatLang(), 'en');
  // a text builder told its language does not depend on the page's
  const input = { name: 'X', count: 1234, aum: 2.5e9, reportDate: '2026-06-30', filingDate: '2026-08-14', top: { ticker: 'AAPL', weight: 35.27 } };
  assert.match(guruAnswer(input, 'tr'), /1\.234 pozisyon ve \$2,50B .*AAPL \(%35,3\)/);
  assert.match(inLang('tr', () => guruAnswer(input, 'en')), /1,234 positions worth \$2\.50B .*AAPL \(35\.3%\)/);
  assert.equal(getFormatLang(), 'en');
});

test('e-mail digest: a Turkish digest writes Turkish numbers, an English one is unchanged', () => {
  const data = { form4: [{ guru: 'G', t: 'AAPL', k: 'P', s: 1326590, p: 1234.5, d: '2026-11-18' }], insiders: [{ t: 'MSFT', n: 'N', k: 'P', v: 2500000, d: '2026-11-18' }] };
  const tr = renderDigest(data, 'tr');
  const en = renderDigest(data, 'en');
  const trText = typeof tr === 'string' ? tr : JSON.stringify(tr);
  const enText = typeof en === 'string' ? en : JSON.stringify(en);
  assert.match(trText, /1\.326\.590 adet @ \$1\.234,5/);
  assert.match(trText, /\$2\.500\.000/);
  assert.match(enText, /1,326,590 sh @ \$1,234\.5/);
  assert.match(enText, /\$2,500,000/);
});

// visible text of table cells and stat tiles, tags and React comment markers removed
const cells = (html) =>
  [...html.replace(/<!-- -->/g, '').matchAll(/<(td|b)\b[^>]*>([\s\S]*?)<\/\1>/g)]
    .map((m) => m[2].replace(/<[^>]+>/g, '').trim())
    .filter(Boolean);
const EN_GROUP = /\d,\d{3}(?!\d)/; // 1,326,590
const EN_PCT = /\d%/; // 29.0%
const TR_PCT = /%\d/; // %29,0

test('SSR: a Turkish fund page has no English-formatted number in its cells; the English page has no Turkish one', async () => {
  // rendered side by side on purpose: the language must not leak between requests
  const [tr, en, tr2] = await Promise.all([
    ssr('/tr/guru/berkshire-hathaway-warren-buffett'),
    ssr('/en/guru/berkshire-hathaway-warren-buffett'),
    ssr('/tr/guru/berkshire-hathaway-warren-buffett'),
  ]);
  assert.equal(tr.status, 200);
  assert.equal(en.status, 200);
  const trCells = cells(tr.html);
  assert.ok(cells(tr2.html).join('|') === trCells.join('|'), 'the same page renders the same cells twice');
  const enCells = cells(en.html);
  assert.ok(trCells.length > 20 && enCells.length > 20, 'the tables rendered');
  assert.deepEqual(trCells.filter((c) => EN_GROUP.test(c)), [], 'en-US digit grouping on the Turkish page');
  assert.deepEqual(trCells.filter((c) => EN_PCT.test(c)), [], '"29.0%" on the Turkish page');
  assert.deepEqual(enCells.filter((c) => TR_PCT.test(c)), [], '"%29,0" on the English page');
  assert.ok(trCells.some((c) => TR_PCT.test(c)), 'Turkish percentages are there');
  assert.ok(trCells.some((c) => /\d\.\d{3}(?!\d)/.test(c)), 'Turkish digit grouping is there');
  assert.ok(enCells.some((c) => EN_PCT.test(c)) && enCells.some((c) => EN_GROUP.test(c)), 'English page keeps its format');
  assert.equal(getFormatLang(), 'en', 'the render put the language back');
});

test('SSR: machine-readable output keeps plain numbers on a Turkish page', async () => {
  const { html } = await ssr('/tr/stock/AAPL');
  const blocks = [...html.matchAll(/<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]));
  assert.ok(blocks.length > 0);
  const walk = (o, f) => {
    if (Array.isArray(o)) o.forEach((x) => walk(x, f));
    else if (o && typeof o === 'object') for (const [k, v] of Object.entries(o)) (typeof v === 'object' ? walk(v, f) : f(k, v));
  };
  walk(blocks, (k, v) => {
    if (['price', 'value', 'ratingValue', 'position', 'numberOfItems'].includes(k)) {
      assert.ok(typeof v === 'number' || /^-?\d+(\.\d+)?$/.test(String(v)), `${k} must stay machine-readable, got ${v}`);
    }
  });
});
