import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  parseAmount,
  parseHouseIndex,
  parseHousePtr,
  parseSenatePtr,
  parseSenateIndexRow,
  splitHouseAsset,
  houseKind,
  cleanTicker,
} from '../api/_lib/congressParse.js';

const fx = (f) => readFileSync(new URL(`./fixtures/congress/${f}`, import.meta.url), 'utf8');

// "y| x:text x:text" — one pdf.js text line per row, as the probe printed it;
// ␀ stands for the NULs pdf.js returns for the PDF's label font.
function pageFromFixture(text) {
  return text
    .trim()
    .split('\n')
    .map((row) => {
      const [y, rest] = row.split('| ');
      const items = [];
      const re = /(?:^| )(\d+):/g;
      const marks = [...rest.matchAll(re)];
      marks.forEach((m, i) => {
        const start = m.index + m[0].length;
        const end = i + 1 < marks.length ? marks[i + 1].index : rest.length;
        items.push({ x: Number(m[1]), s: rest.slice(start, end).replace(/␀/g, '\u0000') });
      });
      return { y: Number(y), items };
    });
}

test('amount ranges', () => {
  assert.deepEqual(parseAmount('$1,001 - $15,000'), { lo: 1001, hi: 15000 });
  assert.deepEqual(parseAmount('$15,001 - $50,000'), { lo: 15001, hi: 50000 });
  assert.deepEqual(parseAmount('Over $50,000,000'), { lo: 50000001, hi: null });
  assert.deepEqual(parseAmount('--'), { lo: null, hi: null });
});

test('House asset text and type codes', () => {
  assert.deepEqual(splitHouseAsset('Chevron Corporation Common Stock (CVX) [ST]'), { name: 'Chevron Corporation Common Stock', ticker: 'CVX', code: 'ST' });
  assert.deepEqual(splitHouseAsset('Diamondback Energy, Inc. - Common Stock (FANG) [ST]').ticker, 'FANG');
  assert.equal(splitHouseAsset('Treasury Bill (3-Month, Matures 7/9/2026) [GS]').ticker, null);
  assert.equal(houseKind('S (partial)'), 'sell_partial');
  assert.equal(houseKind('P'), 'buy');
  assert.equal(cleanTicker('BRK/B'), 'BRK.B');
  assert.equal(cleanTicker('--'), null);
});

test('House index keeps only PTRs', () => {
  const xml = `<FinancialDisclosure><Member><Prefix>Hon.</Prefix><Last>Williams</Last><First>Roger</First><Suffix /><FilingType>P</FilingType><StateDst>TX25</StateDst><Year>2026</Year><FilingDate>1/15/2026</FilingDate><DocID>20033783</DocID></Member><Member><Prefix /><Last>Aaron</Last><First>Richard</First><Suffix /><FilingType>W</FilingType><StateDst>MI04</StateDst><Year>2026</Year><FilingDate>4/15/2026</FilingDate><DocID>8068</DocID></Member></FinancialDisclosure>`;
  assert.deepEqual(parseHouseIndex(xml), [
    { docId: '20033783', year: 2026, prefix: 'Hon.', first: 'Roger', last: 'Williams', suffix: '', stateDst: 'TX25', filed: '2026-01-15' },
  ]);
});

test('House PTR PDF table (Roger Williams, 20033783)', () => {
  const r = parseHousePtr([pageFromFixture(fx('house-20033783.txt'))]);
  assert.equal(r.name, 'Hon. Roger Williams');
  assert.equal(r.stateDst, 'TX25');
  assert.equal(r.tx.length, 4);
  assert.deepEqual(r.tx[0], { d: '2025-12-22', t: 'CVX', a: 'Chevron Corporation Common Stock', at: 'stock', k: 'sell_partial', o: 'self', lo: 15001, hi: 50000 });
  assert.deepEqual(
    r.tx.map((x) => [x.t, x.k, x.o, x.lo, x.hi]),
    [
      ['CVX', 'sell_partial', 'self', 15001, 50000],
      ['FANG', 'sell_partial', 'self', 1001, 15000],
      ['JPM', 'buy', 'spouse', 1001, 15000],
      ['RTX', 'buy', 'self', 1001, 15000],
    ],
  );
  assert.equal(r.tx[1].a, 'Diamondback Energy, Inc. - Common Stock');
});

test('House PTR: a Treasury bill has no ticker', () => {
  const r = parseHousePtr([pageFromFixture(fx('house-20034298.txt'))]);
  assert.equal(r.tx.length, 1);
  assert.equal(r.tx[0].t, null);
  assert.equal(r.tx[0].at, 'bond');
  assert.equal(r.tx[0].lo, 15001);
});

test('House PTR: a scan with no text', () => {
  const r = parseHousePtr([[]]);
  assert.equal(r.text, false);
  assert.deepEqual(r.tx, []);
});

test('Senate index row and PTR table', () => {
  const row = parseSenateIndexRow([
    'Sheldon',
    'Whitehouse',
    'Whitehouse, Sheldon (Senator)',
    '<a href="/search/view/ptr/6bf3b6f7-9e1b-499a-bd5a-990292ce2e72/" target="_blank">Periodic Transaction Report for 10/01/2026</a>',
    '10/01/2026',
  ]);
  assert.equal(row.id, '6bf3b6f7-9e1b-499a-bd5a-990292ce2e72');
  assert.equal(row.filed, '2026-10-01');
  assert.equal(row.paper, false);
  const tx = parseSenatePtr(fx('senate-ptr.html'));
  assert.equal(tx.length, 4);
  assert.deepEqual(tx[0], { d: '2026-09-04', t: 'JPM', a: 'JP Morgan Chase & Co. Common Stock', at: 'stock', k: 'sell_partial', o: 'spouse', lo: 15001, hi: 50000 });
  assert.equal(tx[1].k, 'buy');
  assert.equal(tx[2].t, null);
  assert.equal(tx[2].at, 'bond');
  assert.equal(tx[2].a, 'DELL INTL LLC/EMC CORP');
  assert.equal(tx[3].at, 'other');
  assert.deepEqual([tx[3].lo, tx[3].hi], [50000001, null]);
});
