import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { root, ssr } from './helpers.mjs';
import { guruAnswer, guruAnswerFromPage, stockAnswerFromPage, rankingAnswer, biggestMove, movesFromPositions, truncate155 } from '../client/src/lib/answerBox.js';

const consensus = JSON.parse(fs.readFileSync(path.join(root, 'client', 'public', 'consensus.json'), 'utf8'));
const NO_PLACEHOLDER = /\{|\}|undefined|null|NaN|\$—|—\)/;
const HAS_NUMBER = /\d/;

test('guru answer box renders in EN and TR with real numbers and no placeholders', () => {
  const update = consensus.updates?.[0];
  const input = { name: 'Berkshire Hathaway (Warren Buffett)', firm: 'BERKSHIRE HATHAWAY INC', count: 11, aum: 198.16e9, reportDate: '2026-06-30', filingDate: '2026-08-14', top: { ticker: 'AAPL', weight: 35.27 }, move: update ? biggestMove(update) : { kind: 'add', ticker: 'GOOGL', value: 8.77e9 } };
  const en = guruAnswer(input, 'en');
  const tr = guruAnswer(input, 'tr');
  assert.match(en, /^Berkshire Hathaway \(Warren Buffett\) \(BERKSHIRE HATHAWAY INC\) reported 11 positions worth \$198\.16B as of June 30, 2026 \(13F filed August 14, 2026\)\. Largest holding: AAPL \(35\.3%\)\. Biggest move: (new buy|add|reduce|exit) [A-Z.]+ \(\$[\d.]+[KMB]\)\.$/);
  assert.match(tr, /30 Haziran 2026 itibarıyla 11 pozisyon ve \$198\.16B portföy değeri bildirdi \(13F bildirimi 14 Ağustos 2026\)\. En büyük pozisyon: AAPL \(35\.3%\)\. En büyük hamle: (yeni alım|artırma|azaltma|çıkış) /);
  for (const s of [en, tr]) {
    assert.doesNotMatch(s, NO_PLACEHOLDER);
    assert.ok(s.split('. ').length >= 2 && s.split('. ').length <= 4, 'two to three sentences');
  }
  assert.equal(guruAnswer({ name: 'X' }, 'en'), null, 'incomplete data renders nothing rather than placeholders');
});

test('biggest move is derived from top-10 vs previous quarter when no update card exists', () => {
  const positions = [
    { cusip: 'A', ticker: 'AAA', issuer: 'A', shares: 100, value: 1000 },
    { cusip: 'B', ticker: 'BBB', issuer: 'B', shares: 50, value: 5000 },
  ];
  const prev = [
    { cusip: 'A', ticker: 'AAA', issuer: 'A', shares: 200, value: 2000 },
    { cusip: 'C', ticker: 'CCC', issuer: 'C', shares: 10, value: 9000 },
  ];
  const m = biggestMove(movesFromPositions(positions, prev));
  assert.deepEqual({ kind: m.kind, ticker: m.ticker }, { kind: 'exit', ticker: 'CCC' });
  const text = guruAnswerFromPage({ manager: { name: 'F', displayName: 'F' }, filing: { reportDate: '2026-06-30', filingDate: '2026-08-01' }, holdings: { positions, count: 2, aum: 6000 }, prevPositions: prev }, 'en');
  assert.match(text, /Biggest move: exit CCC \(\$9\.0K\)/);
});

test('stock answer box: consensus row and fallback both carry real numbers', () => {
  const row = consensus.mostHeld[0];
  const en = stockAnswerFromPage({ ticker: row.ticker, company: 'Amazon.com, Inc.', consensusRow: row, reportDate: '2026-06-30' }, 'en');
  const tr = stockAnswerFromPage({ ticker: row.ticker, company: 'Amazon.com, Inc.', consensusRow: row, reportDate: '2026-06-30' }, 'tr');
  assert.match(en, new RegExp(`^Amazon\\.com, Inc\\. \\(${row.ticker}\\) is held by ${row.holderCount} tracked superinvestors worth \\$[\\d.]+[MB] as of Q2 2026\\. ${row.buyers} increased, ${row.sellers} reduced; net flow -?\\$[\\d.]+[KMB]\\. Largest holder: .+ \\([\\d.]+% of their portfolio\\)\\.$`));
  assert.match(tr, /takip edilen \d+ usta yatırımcı tarafından toplam \$[\d.]+[MB] değerinde tutuluyor\. \d+ fon artırdı, \d+ fon azalttı; net akış/);
  const fb = stockAnswerFromPage(
    { ticker: 'ZZZ', company: 'Zeta Corp', consensusRow: null, quote: { price: 12.5, currency: 'USD', marketCap: 4.2e9 } },
    'en'
  );
  assert.match(fb, /^Zeta Corp \(ZZZ\) is not among the 30 most-held stocks of the tracked superinvestor set\. Price 12\.50 USD; market cap \$4\.20B\.$/);
  for (const s of [en, tr, fb]) assert.doesNotMatch(s, NO_PLACEHOLDER);
});

test('ranking answer: quarter, rule and #1 for every kind in both languages', () => {
  for (const kind of ['most-bought', 'most-sold', 'consensus', 'conviction']) {
    const rows = [...consensus.mostHeld].sort((a, b) => (kind === 'most-sold' ? a.netValue - b.netValue : kind === 'most-bought' ? b.netValue - a.netValue : kind === 'consensus' ? b.holderCount - a.holderCount : b.avgWeight - a.avgWeight));
    for (const lang of ['en', 'tr']) {
      const s = rankingAnswer({ kind, reportDate: '2026-06-30', first: rows[0], managers: consensus.managers.length }, lang);
      assert.ok(s && HAS_NUMBER.test(s) && !NO_PLACEHOLDER.test(s), `${kind} ${lang}: ${s}`);
      assert.match(s, lang === 'tr' ? /2026 Q2/ : /Q2 2026/);
      assert.match(s, lang === 'tr' ? /1\. sıra: / : /#1: /);
    }
  }
});

test('truncate155 keeps whole sentences under 155 chars', () => {
  const long = 'Sentence one is here. Sentence two is a bit longer than the first one and adds detail. Sentence three pushes the whole paragraph well past the meta description limit for sure.';
  const t = truncate155(long);
  assert.ok(t.length <= 155);
  assert.ok(t.endsWith('.'));
  assert.equal(truncate155('short'), 'short');
});

test('SSR: answer box text is in the HTML, the meta description and matches across languages', async () => {
  const en = await ssr('/en/guru/berkshire-hathaway-warren-buffett');
  const box = /<p class="answer-box" data-answer-box[^>]*>([^<]+)<\/p>/.exec(en.html);
  assert.ok(box, 'answer box rendered');
  assert.match(box[1], /reported 11 positions worth \$198\.16B as of June 30, 2026/);
  const desc = /<meta name="description" content="([^"]+)"/.exec(en.html)[1];
  assert.ok(desc.length <= 155 && box[1].replace(/&amp;/g, '&').startsWith(desc.replace(/&amp;/g, '&').replace(/…$/, '').slice(0, 40)));
  const tr = await ssr('/tr/guru/berkshire-hathaway-warren-buffett');
  assert.match(tr.html, /data-answer-box[^>]*>[^<]*30 Haziran 2026 itibarıyla 11 pozisyon/);
  const stock = await ssr('/en/stock/AAPL');
  assert.match(stock.html, /data-answer-box[^>]*>Apple Inc\. \(AAPL\) is /);
  const rank = await ssr('/tr/rankings/most-bought');
  assert.match(rank.html, /data-answer-box[^>]*>En çok alınanlar listesi 2026 Q2/);
});
