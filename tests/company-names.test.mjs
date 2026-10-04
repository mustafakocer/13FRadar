// Launch audit 1: a stock page names the company beside its ticker. The live
// quote (Finnhub /quote) carries no name and every page read "AAPL (AAPL)";
// the name now comes from SEC's company_tickers.json, then the 13F issuer.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ssr } from './helpers.mjs';
import { displayName, companyName, withCompanyName, namesFromCompanyTickers, resetCompanyNames } from '../api/_lib/companyNames.js';
import { shapeFinnhub } from '../api/_lib/providers.js';

const plain = (h) => h.replace(/<!-- -->/g, '').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&#x27;|&#39;/g, "'").replace(/\s+/g, ' ').trim();

// first: the stock handler keeps one race per symbol for the process, and
// the server renders below would leave a snapshot answer in its place
test('stockPayload: a live Finnhub answer is served with the company name, not the symbol', async () => {
  const { stockPayload } = await import('../api/_handlers/stock.js');
  for (const t of ['AAPL', 'TSM', 'BRK-B', 'SLBT']) {
    const providers = [{ name: 'finnhub', run: async (s) => shapeFinnhub(s, { c: 10, d: 0, dp: 0, o: 10, h: 10, l: 10, pc: 10 }) }];
    const r = await stockPayload(t, { providers, budgetMs: 2000 });
    assert.equal(r.served, 'live', t);
    assert.ok(r.data.price.name && r.data.price.name.toUpperCase() !== t, `${t}: "${r.data.price.name}"`);
  }
});

test('displayName: upper-case filings names in title case, mixed case kept', () => {
  assert.equal(displayName('Apple Inc.'), 'Apple Inc.');
  assert.equal(displayName('TAIWAN SEMICONDUCTOR MANUFACTURING CO LTD'), 'Taiwan Semiconductor Manufacturing Co Ltd');
  assert.equal(displayName('BERKSHIRE HATHAWAY INC'), 'Berkshire Hathaway Inc');
  assert.equal(displayName('COCA-COLA CO'), 'Coca-Cola Co');
  assert.equal(displayName('CATERPILLAR INC /DE/'), 'Caterpillar Inc');
  assert.equal(displayName('CVS HEALTH CORP'), 'CVS Health Corp');
  assert.equal(displayName('PROSUS NV'), 'Prosus NV');
  assert.equal(displayName('SPDR S&P 500 ETF TR'), 'SPDR S&P 500 ETF Tr');
  assert.equal(displayName(''), null);
});

test('namesFromCompanyTickers: SEC rows keyed by ticker, the first title wins', () => {
  const names = namesFromCompanyTickers({
    0: { cik_str: 320193, ticker: 'AAPL', title: 'Apple Inc.' },
    1: { cik_str: 1067983, ticker: 'BRK-B', title: 'BERKSHIRE HATHAWAY INC' },
    2: { cik_str: 1, ticker: 'aapl', title: 'Later Row' },
    3: { cik_str: 2, ticker: '', title: 'No Ticker' },
  });
  assert.deepEqual(names, { AAPL: 'Apple Inc.', 'BRK-B': 'BERKSHIRE HATHAWAY INC' });
});

test('companyName: SEC first, then the 13F issuer; BRK-B and BRK.B are one symbol', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'names-'));
  const sec = path.join(dir, 'company-names.json');
  const meta = path.join(dir, 'ticker-meta.json');
  fs.writeFileSync(sec, JSON.stringify({ names: { AAPL: 'Apple Inc.', 'BRK-B': 'BERKSHIRE HATHAWAY INC', ODD: 'ODD' } }));
  fs.writeFileSync(meta, JSON.stringify({ AAPL: { name: 'APPLE INC' }, TSM: { name: 'TAIWAN SEMICONDUCTOR MANUFACTURING CO LTD' }, ODD: { name: 'Odd Corp' } }));
  process.env.COMPANY_NAMES_FILE = sec;
  process.env.TICKER_META_FILE = meta;
  resetCompanyNames();
  try {
    assert.deepEqual(companyName('AAPL'), { name: 'Apple Inc.', source: 'sec' });
    assert.deepEqual(companyName('BRK.B'), { name: 'Berkshire Hathaway Inc', source: 'sec' });
    assert.deepEqual(companyName('TSM'), { name: 'Taiwan Semiconductor Manufacturing Co Ltd', source: '13f' });
    // a "name" that is only the symbol is no name: the next source answers
    assert.deepEqual(companyName('ODD'), { name: 'Odd Corp', source: '13f' });
    assert.equal(companyName('ZZZZ'), null);
  } finally {
    delete process.env.COMPANY_NAMES_FILE;
    delete process.env.TICKER_META_FILE;
    resetCompanyNames();
  }
});

test('withCompanyName: a Finnhub quote (name = symbol) gets the company name', () => {
  const q = shapeFinnhub('AAPL', { c: 250, d: 1, dp: 0.4, o: 249, h: 251, l: 248, pc: 249 });
  assert.equal(q.price.name, 'AAPL', 'the bug: /quote has no name');
  for (const t of ['AAPL', 'TSM', 'BRK-B', 'SLBT']) {
    const out = withCompanyName({ price: { symbol: t, name: t } }, t);
    assert.ok(out.price.name && out.price.name.toUpperCase() !== t, `${t}: ${out.price.name}`);
  }
  // nothing known: the payload is left as it is
  assert.equal(withCompanyName({ price: { symbol: 'ZZZZ9', name: 'ZZZZ9' } }, 'ZZZZ9').price.name, 'ZZZZ9');
});

for (const lang of ['tr', 'en']) {
  test(`${lang}: AAPL, TSM, BRK-B and SLBT pages name the company in the title, H1 and description`, async () => {
    for (const t of ['AAPL', 'TSM', 'BRK-B', 'SLBT']) {
      const { status, html } = await ssr(`/${lang}/stock/${t}`);
      assert.equal(status, 200, t);
      const title = plain(html.match(/<title[^>]*>([\s\S]*?)<\/title>/)?.[1] || '');
      const h1 = plain(html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/)?.[1] || '');
      const desc = html.match(/<meta name="description" content="([^"]*)"/)?.[1] || '';
      const name = h1.replace(/\s*\([A-Z.-]+\)\s*$/, '');
      assert.ok(name && name.toUpperCase() !== t, `${t} H1: "${h1}"`);
      assert.ok(title.includes(name) && !title.includes(`${t} — ${t} `), `${t} title: "${title}"`);
      assert.ok(!desc.includes(`${t} (${t})`) && !html.includes(`${t} (${t})`), `${t}: no "${t} (${t})" anywhere`);
    }
  });
}
