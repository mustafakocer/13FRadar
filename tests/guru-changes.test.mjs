// The guru page's FAQ and its Changes tab read one computation
// (client/src/lib/portfolioChanges.js through /api/changes). Checked on every
// curated guru's latest quarter from the stored history, and on Berkshire's
// 2026-Q2 filing against what the filing says.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { portfolioChanges, trimChanges } from '../client/src/lib/portfolioChanges.js';
import { managerFaq } from '../client/src/lib/seoTemplates.js';
import { changesFromHistory, historyBooks } from '../api/_lib/holdingsChanges.js';

const H = JSON.parse(fs.readFileSync(new URL('../api/_data/guru-history.json', import.meta.url), 'utf8'));
const label = (p) => p.ticker || p.issuer;
const faqFor = (g, lang = 'tr') => {
  const last = g.quarters.at(-1);
  const b = historyBooks(g, last.reportDate);
  const ch = trimChanges(changesFromHistory(g, last.reportDate), 5);
  const positions = [...b.current].sort((x, y) => y.value - x.value);
  const faq = managerFaq({ lang, name: g.name, filing: { reportDate: last.reportDate }, holdings: { positions, aum: last.aum, count: last.count }, changes: ch });
  return { ch, faq, current: b.current };
};
// "Azaltılan: A, B ve C." → ['A','B','C']
const listAfter = (text, head) => {
  const m = new RegExp(`${head}: ([^.]*?)(?: \\(toplam \\d+\\))?\\.`).exec(text);
  return m ? m[1].split(/, | ve /) : [];
};

test('portfolioChanges: by shares, complete books, keyed with put/call', () => {
  const prev = [
    { cusip: 'A', ticker: 'A', shares: 100, value: 1000 },
    { cusip: 'B', ticker: 'B', shares: 100, value: 1000 },
    { cusip: 'C', ticker: 'C', shares: 100, value: 1000 },
    { cusip: 'D', ticker: 'D', shares: 100, value: 1000 },
    { cusip: 'E', putCall: 'Call', ticker: 'E', shares: 10, value: 50 },
  ];
  const cur = [
    { cusip: 'A', ticker: 'A', shares: 100, value: 3000 }, // price tripled: not a buy
    { cusip: 'B', ticker: 'B', shares: 150, value: 1500 },
    { cusip: 'C', ticker: 'C', shares: 40, value: 400 },
    { cusip: 'E', ticker: 'E', shares: 10, value: 50 }, // the stock, not the call
    { cusip: 'F', ticker: 'F', shares: 5, value: 500 },
  ];
  const ch = portfolioChanges(cur, prev);
  assert.deepEqual(ch.counts, { new: 2, added: 1, reduced: 1, exited: 2 });
  assert.deepEqual(ch.new.map(label).sort(), ['E', 'F']);
  assert.deepEqual(ch.added.map(label), ['B']);
  assert.deepEqual(ch.reduced.map((p) => [p.ticker, p.pct]), [['C', -60]]);
  assert.deepEqual(ch.exited.map((p) => `${p.ticker}${p.putCall ? ` ${p.putCall}` : ''}`).sort(), ['D', 'E Call']);
  assert.equal(portfolioChanges(cur, null), null);
});

test('Berkshire 2026-Q2: sold out of STZ only; COF and BAC among the reductions; nothing still held is called an exit', () => {
  const g = H.gurus['0001067983'];
  const { ch, faq, current } = faqFor(g);
  assert.equal(g.quarters.at(-1).reportDate, '2026-06-30');
  assert.deepEqual(ch.exited.map(label), ['STZ']);
  const reduced = ch.reduced.map(label);
  assert.ok(reduced.includes('COF') && reduced.includes('BAC'), reduced.join(','));
  assert.equal(ch.reduced.find((p) => p.ticker === 'COF').pct, -58);
  const sell = faq[2][1];
  assert.deepEqual(listAfter(sell, 'Tamamen çıkılan'), ['STZ']);
  assert.ok(listAfter(sell, 'Azaltılan').includes('COF') && listAfter(sell, 'Azaltılan').includes('BAC'), sell);
  for (const held of ['KHC', 'DVA', 'KR', 'SIRI', 'DAL']) {
    assert.ok(current.some((p) => p.ticker === held), `${held} is still held`);
    assert.ok(!listAfter(sell, 'Tamamen çıkılan').includes(held), `${held} is not an exit`);
  }
});

test('every guru page: the FAQ lists are the Changes lists, and no exit is still in the book', () => {
  let pages = 0;
  for (const [cik, g] of Object.entries(H.gurus)) {
    if ((g.quarters || []).length < 2) continue;
    const { ch, faq, current } = faqFor(g);
    pages++;
    const held = new Set(current.map((p) => `${p.cusip}`));
    for (const x of ch.exited) assert.ok(!held.has(x.cusip), `${g.name}: ${label(x)} listed as exited but held`);
    for (const x of ch.reduced) assert.ok(x.shares > 0 && x.shares < x.prevShares, `${g.name}: ${label(x)}`);
    for (const x of ch.added) assert.ok(x.shares > x.prevShares, `${g.name}: ${label(x)}`);
    const [, buy, sell] = faq.map((f) => f[1]);
    // the FAQ sentence is exactly the Changes list, in the same order
    const trList = (a) => (a.length === 1 ? a[0] : `${a.slice(0, -1).join(', ')} ve ${a.at(-1)}`);
    for (const [text, head, key] of [[buy, 'Yeni alınan', 'new'], [buy, 'Artırılan', 'added'], [sell, 'Azaltılan', 'reduced'], [sell, 'Tamamen çıkılan', 'exited']]) {
      const lines = ch[key].map(label);
      if (!lines.length) assert.ok(!text.includes(`${head}:`), `${g.name}: no ${key}, no sentence`);
      else assert.ok(text.includes(`${head}: ${trList(lines)}`), `${g.name} ${key}: ${text}`);
    }
  }
  assert.ok(pages >= 80, `${pages} guru pages checked`);
});

test('English FAQ carries the same lists', () => {
  const { ch, faq } = faqFor(H.gurus['0001067983'], 'en');
  assert.match(faq[2][1], /Sold out entirely: STZ\./);
  assert.match(faq[2][1], new RegExp(`Reduced: ${ch.reduced.map(label).slice(0, 4).join(', ')}`));
});
