import test from 'node:test';
import assert from 'node:assert/strict';
import { ssr, jsonLd, count, attr } from './helpers.mjs';

const GURU = '/en/guru/berkshire-hathaway-warren-buffett';

test('SSR: guru page returns table rows, H1 and metadata without JS', async () => {
  const { status, html, headers } = await ssr(GURU);
  assert.equal(status, 200);
  assert.ok(count(html, /<table/g) >= 1, 'has a table');
  assert.ok(count(html, /<tr/g) >= 11, 'has header + 10 rows');
  assert.match(html, /<h1>Berkshire Hathaway \(Warren Buffett\)<\/h1>/);
  assert.match(html, /<title>Berkshire Hathaway \(Warren Buffett\) Portfolio Q2 2026: Holdings, Buys &amp; Sells \| Fundocap<\/title>/);
  assert.match(html, /<meta name="description" content="[^"]*11 positions worth \$198\.16B[^"]*"/);
  assert.match(headers['cache-control'], /s-maxage=86400/);
  assert.ok(html.includes('window.__STATE__='), 'dehydrated query state present');
});

test('SSR: stock page carries the quote board and links the gurus that hold it', async () => {
  const { status, html } = await ssr('/en/stock/AAPL');
  assert.equal(status, 200);
  assert.match(html, /<title>AAPL — Which Superinvestors Hold Apple Inc\.\? \| Fundocap<\/title>/);
  assert.match(html, /class="kv-grid quote-grid/, 'quote board is server-rendered');
  assert.match(html, /Prev Close/, 'with its numbers, not an empty shell');
  // the funds a stock links to now come from the superinvestor set, not from
  // counting EDGAR full-text search hits
  const { html: amzn } = await ssr('/en/stock/AMZN');
  assert.match(amzn, /href="\/en\/guru\//, 'a held stock links to the gurus holding it');
});

test('SSR: a stock page states where it ranks among the gurus and who is most committed', async () => {
  const { html } = await ssr('/en/stock/OXY');
  // React splits adjacent text nodes with comment markers; drop them so the
  // assertions read like the rendered sentence rather than the transport.
  const plain = html.replace(/<!-- -->/g, '');
  assert.match(plain, /Guru Ownership/, 'the ownership block is server-rendered');
  assert.match(plain, /Popularity rank<\/span><span class="v">#1/, 'ranked first in the fixture panel');
  assert.match(plain, /of 13 securities/, 'and says what it is ranked against');
  assert.match(plain, /Top 5 by conviction/);
  assert.match(plain, /What changed this quarter/);
  // the two holder lists disagree, which is the point of showing both: Scion
  // has a quarter of its book in OXY, Berkshire a far larger dollar position
  const conviction = plain.indexOf('Top 5 by conviction');
  const value = plain.indexOf('Top 5 by value');
  assert.ok(conviction > 0 && value > conviction, 'both orderings are rendered');
  assert.match(plain.slice(conviction, value), /Scion/, 'conviction leads with the concentrated fund');
  assert.match(plain.slice(value), /Berkshire/, 'value leads with the big one');
});

test('SSR: the filing feed lists arrivals with their period and form type', async () => {
  const { status, html } = await ssr('/en/filings');
  assert.equal(status, 200);
  const plain = html.replace(/<!-- -->/g, '');
  assert.match(plain, /<title>Latest 13F Filings \| Fundocap<\/title>/);
  assert.match(plain, /13F-HR\/A/, 'amendments are shown as amendments');
  assert.match(plain, /Q2 2026/, 'the period reported, not only the date filed');
  assert.match(plain, /BlackRock/);
  // an amendment has no measured figures of its own and must not borrow the
  // original filing's
  const amendment = plain.slice(plain.indexOf('Nykredit'), plain.indexOf('Dodge'));
  assert.doesNotMatch(amendment, /\$\d/, 'no dollar figure on the amendment row');
});

test('SSR: the stock screener renders its table and what it filters by', async () => {
  const { status, html } = await ssr('/en/screen/stocks');
  assert.equal(status, 200);
  const plain = html.replace(/<!-- -->/g, '');
  assert.match(plain, /Funds holding/, 'the ownership column is server-rendered');
  assert.match(plain, /Top weight/);
  assert.match(plain, /Energy/, 'sectors the build classified are shown');
  // the fund screener and the stock screener link to each other
  assert.match(plain, /href="\/en\/screen"/);
});

test('SSR: the consensus page ships its segments, filters and a row you can open', async () => {
  const { status, html } = await ssr('/tr/consensus');
  assert.equal(status, 200);
  const plain = html.replace(/<!-- -->/g, '');
  // every segment is a control on the page, not a separate route
  for (const label of ['En Çok Tutulanlar', 'Alınanlar', 'Satılanlar', 'Yeni Pozisyonlar', 'Fonlar', 'Tüm Evren']) {
    assert.ok(plain.includes(label), `segment ${label}`);
  }
  // the strip that frames the quarter, from the static file alone
  assert.match(plain, /Takip edilen fon/);
  assert.match(plain, /En çok tutulan/);
  assert.match(plain, /aria-expanded="false"/, 'rows are openable');
  assert.match(plain, /href="\/tr\/guru\//, 'the funds holding a stock are links');
  assert.doesNotMatch(plain, /Sektör/, 'no filter the data cannot honour');

  // a Pro segment shows the paywall rather than the table
  const { html: bought } = await ssr('/tr/consensus?tab=bought');
  assert.doesNotMatch(bought.replace(/<!-- -->/g, ''), /<tr[^>]*role="button"/, 'no rows behind the paywall');

  // the fund segment is free and lists every tracked fund as a link
  const { html: funds } = await ssr('/tr/consensus?tab=funds');
  const plainFunds = funds.replace(/<!-- -->/g, '');
  assert.match(plainFunds, /Yeni aldı/);
  assert.ok((plainFunds.match(/href="\/tr\/guru\//g) || []).length >= 3, 'each fund links to its page');
});

test('SSR: home page renders content and site JSON-LD', async () => {
  const { status, html } = await ssr('/tr');
  assert.equal(status, 200);
  assert.ok(count(html, /<table/g) >= 1);
  const types = jsonLd(html).map((b) => b['@type']);
  assert.ok(types.includes('Organization') && types.includes('WebSite'));
  const site = jsonLd(html).find((b) => b['@type'] === 'WebSite');
  assert.match(site.potentialAction.target.urlTemplate, /^https:\/\/example\.test\/tr\/\?q=\{search_term_string\}$/);
});

test('metadata: TR and EN render distinct titles for the same entity', async () => {
  const en = await ssr(GURU);
  const tr = await ssr(GURU.replace('/en/', '/tr/'));
  assert.match(tr.html, /<title>Berkshire Hathaway \(Warren Buffett\) Portföyü 2026 Q2: Pozisyonlar, Alımlar ve Satışlar \| Fundocap<\/title>/);
  assert.notEqual(attr(en.html, /<title>([^<]*)/)[0], attr(tr.html, /<title>([^<]*)/)[0]);
  assert.match(tr.html, /<html lang="tr">/);
});

test('FAQ JSON-LD validates on guru and stock pages', async () => {
  for (const url of [GURU, '/en/stock/AAPL']) {
    const { html } = await ssr(url);
    const faq = jsonLd(html).find((b) => b['@type'] === 'FAQPage');
    assert.ok(faq, `${url} has FAQPage`);
    assert.equal(faq['@context'], 'https://schema.org');
    assert.ok(faq.mainEntity.length >= 2);
    for (const q of faq.mainEntity) {
      assert.equal(q['@type'], 'Question');
      assert.ok(q.name.endsWith('?'));
      assert.equal(q.acceptedAnswer['@type'], 'Answer');
      assert.ok(q.acceptedAnswer.text.length > 20);
      assert.ok(html.includes(q.name.replace(/&/g, '&amp;')), 'question is visible in the page body');
    }
    const crumbs = jsonLd(html).find((b) => b['@type'] === 'BreadcrumbList');
    assert.ok(crumbs && crumbs.itemListElement.length >= 3);
    assert.match(crumbs.itemListElement[0].item['@id'], /^https:\/\/example\.test\/en$/);
  }
});

test('hreflang pairs are symmetric and canonical is self-referencing', async () => {
  const en = await ssr(GURU);
  const tr = await ssr(GURU.replace('/en/', '/tr/'));
  const alts = (html) => Object.fromEntries([...html.matchAll(/hreflang="([^"]+)" href="([^"]+)"/g)].map((m) => [m[1], m[2]]));
  const a = alts(en.html);
  const b = alts(tr.html);
  assert.equal(a.en, `https://example.test${GURU}`);
  assert.equal(a.tr, `https://example.test${GURU.replace('/en/', '/tr/')}`);
  assert.deepEqual(a, b, 'both languages list the same alternates');
  assert.equal(a['x-default'], a.en);
  assert.equal(attr(en.html, /<link rel="canonical" href="([^"]+)"/)[0], a.en);
  assert.equal(attr(tr.html, /<link rel="canonical" href="([^"]+)"/)[0], b.tr);
});

test('redirects: bare URL → locale by country; numeric CIK → stored slug', async () => {
  const tr = await ssr('/manager/0001067983', { 'x-vercel-ip-country': 'TR' });
  assert.equal(tr.status, 302);
  assert.equal(tr.headers.location, '/tr/manager/0001067983');
  const cookie = await ssr('/manager/0001067983', { 'x-vercel-ip-country': 'TR', cookie: 'lang=en' });
  assert.equal(cookie.headers.location, '/en/manager/0001067983');
  const slug = await ssr('/en/manager/0001067983');
  assert.equal(slug.status, 301);
  assert.equal(slug.headers.location, GURU);
  const wrongKind = await ssr('/en/filer/berkshire-hathaway-warren-buffett');
  assert.equal(wrongKind.status, 301);
  assert.equal(wrongKind.headers.location, GURU);
});

test('noindex on account and watchlist; 404 on unknown routes', async () => {
  const acc = await ssr('/en/account');
  assert.match(acc.html, /<meta name="robots" content="noindex"/);
  assert.equal(acc.headers['cache-control'], 'no-store');
  const nope = await ssr('/en/does-not-exist');
  assert.equal(nope.status, 404);
  const badSlug = await ssr('/en/guru/no-such-guru');
  assert.equal(badSlug.status, 404);
});

test('SSR: penny board renders the full table, answer box and JSON-LD without JS', async () => {
  const { status, html, headers } = await ssr('/en/insiders/penny');
  assert.equal(status, 200);
  assert.match(html, /<title>Penny Stock Insider Buys: Form 4 Signals Under \$5 \| Fundocap<\/title>/);
  // the board ships inside the teaser, so every row is server-rendered
  assert.ok(count(html, /<tr/g) >= 20, 'header plus board rows');
  assert.match(html, /data-answer-box/);
  assert.match(html, /<meta name="description" content="[^"]*stocks trading under \$5[^"]*"/);
  const types = jsonLd(html).map((b) => b['@type']);
  for (const type of ['Article', 'ItemList', 'FAQPage', 'BreadcrumbList']) assert.ok(types.includes(type), type);
  assert.match(headers['cache-control'], /s-maxage=3600/);
});

test('SSR: penny board is translated and keeps its sibling signal pages', async () => {
  const tr = await ssr('/tr/insiders/penny');
  assert.match(tr.html, /Kuruş Hisse Insider Fırsatları/);
  assert.match(tr.html, /href="\/tr\/insiders\/cluster"/);
  // /insiders/:signal still serves the other two boards
  const cluster = await ssr('/en/insiders/cluster');
  assert.equal(cluster.status, 200);
  assert.ok(count(cluster.html, /<table/g) >= 1);
});

test('SSR: the report table, its filters and JSON-LD render without JS', async () => {
  const { status, html, headers } = await ssr('/en/report');
  assert.equal(status, 200);
  assert.match(html, /<title>What Superinvestors Bought and Sold — \d{4} Q[1-4] \| Fundocap<\/title>/);
  assert.ok(count(html, /<tr/g) >= 10, 'header plus rows');
  assert.match(html, /data-answer-box/);
  assert.match(html, /spark-bars/, 'the quarterly activity column is server-rendered');
  const types = jsonLd(html).map((b) => b['@type']);
  for (const type of ['Article', 'ItemList', 'FAQPage', 'BreadcrumbList']) assert.ok(types.includes(type), type);
  assert.match(headers['cache-control'], /s-maxage=3600/);
});

test('SSR: an older quarter is addressable and the page stays translated', async () => {
  const tr = await ssr('/tr/report');
  assert.equal(tr.status, 200);
  assert.match(tr.html, /Usta Alımları/);
  assert.match(tr.html, /Usta Satışları/);
  // the quarter selector drives ?q= and the page must still answer
  const older = await ssr('/en/report?q=2025-12-31');
  assert.equal(older.status, 200);
});
