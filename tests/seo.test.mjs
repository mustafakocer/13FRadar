import test from 'node:test';
import assert from 'node:assert/strict';
import { ssr, jsonLd, count, attr } from './helpers.mjs';

const GURU = '/tr/guru/berkshire-hathaway-warren-buffett';

test('SSR: guru page returns table rows, H1 and metadata without JS', async () => {
  const { status, html, headers } = await ssr(GURU);
  assert.equal(status, 200);
  assert.ok(count(html, /<table/g) >= 1, 'has a table');
  assert.ok(count(html, /<tr/g) >= 11, 'has header + 10 rows');
  assert.match(html, /<h1>Berkshire Hathaway \(Warren Buffett\)<\/h1>/);
  assert.match(html, /<title>Berkshire Hathaway \(Warren Buffett\) Portföyü 2026 Q2: Pozisyonlar, Alımlar ve Satışlar \| Fundocap<\/title>/);
  assert.match(html, /<meta name="description" content="[^"]*11 pozisyon ve \$198\.16B portföy değeri[^"]*"/);
  assert.match(headers['cache-control'], /s-maxage=86400/);
  assert.ok(html.includes('window.__STATE__='), 'dehydrated query state present');
});

test('SSR: stock page carries the quote board and links the gurus that hold it', async () => {
  const { status, html } = await ssr('/tr/stock/AAPL');
  assert.equal(status, 200);
  assert.match(html, /<title>AAPL — Apple Inc\. Hissesini Hangi Usta Yatırımcılar Tutuyor\? \| Fundocap<\/title>/);
  assert.match(html, /class="kv-grid quote-grid/, 'quote board is server-rendered');
  assert.match(html, /Önceki Kapanış/, 'with its numbers, not an empty shell');
  // the funds a stock links to now come from the superinvestor set, not from
  // counting EDGAR full-text search hits
  const { html: amzn } = await ssr('/tr/stock/AMZN');
  assert.match(amzn, /href="\/tr\/guru\//, 'a held stock links to the gurus holding it');
});

test('SSR: a stock page states where it ranks among the gurus and who is most committed', async () => {
  const { html } = await ssr('/tr/stock/OXY');
  // React splits adjacent text nodes with comment markers; drop them so the
  // assertions read like the rendered sentence rather than the transport.
  const plain = html.replace(/<!-- -->/g, '');
  assert.match(plain, /Usta Sahipliği/, 'the ownership block is server-rendered');
  assert.match(plain, /Popülerlik sırası<\/span><span class="v">#1/, 'ranked first in the fixture panel');
  assert.match(plain, /13 menkul içinde/, 'and says what it is ranked against');
  assert.match(plain, /Ağırlığa göre ilk 5/);
  assert.match(plain, /Bu çeyrek ne oldu/);
  // the two holder lists disagree, which is the point of showing both: Scion
  // has a quarter of its book in OXY, Berkshire a far larger dollar position
  const conviction = plain.indexOf('Ağırlığa göre ilk 5');
  const value = plain.indexOf('Büyüklüğe göre ilk 5');
  assert.ok(conviction > 0 && value > conviction, 'both orderings are rendered');
  assert.match(plain.slice(conviction, value), /Scion/, 'conviction leads with the concentrated fund');
  assert.match(plain.slice(value), /Berkshire/, 'value leads with the big one');
});

test('SSR: the filing feed lists arrivals with their period and form type', async () => {
  const { status, html } = await ssr('/tr/filings');
  assert.equal(status, 200);
  const plain = html.replace(/<!-- -->/g, '');
  assert.match(plain, /<title>Son 13F Bildirimleri \| Fundocap<\/title>/);
  assert.match(plain, /13F-HR\/A/, 'amendments are shown as amendments');
  assert.match(plain, /Q2 2026/, 'the period reported, not only the date filed');
  assert.match(plain, /BlackRock/);
  // an amendment has no measured figures of its own and must not borrow the
  // original filing's
  const amendment = plain.slice(plain.indexOf('Nykredit'), plain.indexOf('Dodge'));
  assert.doesNotMatch(amendment, /\$\d/, 'no dollar figure on the amendment row');
});

test('SSR: the stock screener renders its table and what it filters by', async () => {
  const { status, html } = await ssr('/tr/screen/stocks');
  assert.equal(status, 200);
  const plain = html.replace(/<!-- -->/g, '');
  assert.match(plain, /Tutan fon/, 'the ownership column is server-rendered');
  assert.match(plain, /En yüksek ağırlık/);
  assert.match(plain, /Energy/, 'sectors the build classified are shown');
  // the fund screener and the stock screener link to each other
  assert.match(plain, /href="\/tr\/screen"/);
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
  const { html: bought } = await ssr('/tr/consensus/bought');
  assert.doesNotMatch(bought.replace(/<!-- -->/g, ''), /<tr[^>]*role="button"/, 'no rows behind the paywall');

  // the fund segment is free and lists every tracked fund as a link
  const { html: funds } = await ssr('/tr/consensus/funds');
  const plainFunds = funds.replace(/<!-- -->/g, '');
  assert.match(plainFunds, /Yeni aldı/);
  assert.ok((plainFunds.match(/href="\/tr\/guru\//g) || []).length >= 3, 'each fund links to its page');
  // each segment is its own page with its own title, and the chips are links
  assert.match(plainFunds, /<title>Takip Edilen Usta Yatırımcılar[^<]*<\/title>/);
  assert.match(plainFunds, /<link rel="canonical" href="[^"]*\/tr\/consensus\/funds"/);
  assert.match(plain, /href="\/tr\/consensus\/bought"/, 'the bought segment is a link from the front');
  assert.doesNotMatch(plainFunds, /Takip edilen fon<\/div>/, 'the four-number strip frames the front page only');
});

test('SSR: the fund page frames the quarter in four numbers, then one table', async () => {
  const { html } = await ssr('/tr/guru/berkshire-hathaway-warren-buffett');
  const plain = html.replace(/<!-- -->/g, '');
  for (const label of ['Pozisyonlar', 'Değişimler', 'Dağılım', 'Geçmiş']) {
    assert.ok(plain.includes(label), `segment ${label}`);
  }
  assert.match(plain, /Portföy Büyüklüğü/, 'the strip names AUM');
  assert.match(plain, /İlk 10 Hissenin Ağırlığı/, 'and concentration');
  // the one table carries the time-held column the old top-ten table had
  assert.match(plain, /Elde Tutma/);
  // the default segment is the holdings table itself, not a top-ten preview
  // that repeats it a tab later; the related-managers table below is the
  // only other one on the page
  assert.ok((plain.match(/<table/g) || []).length <= 2, 'one table for the segment, one for related managers');
  assert.doesNotMatch(plain, /En Büyük Yatırımları/, 'no top-ten preview duplicating the table');
  // each segment is its own page with its own canonical and title; the chips
  // link between them
  assert.match(plain, /href="\/tr\/guru\/berkshire-hathaway-warren-buffett\/changes"/);
  const { html: hist } = await ssr('/tr/guru/berkshire-hathaway-warren-buffett/history');
  const plainHist = hist.replace(/<!-- -->/g, '');
  assert.match(plainHist, /Portföy Büyüklüğü Geçmişi/);
  assert.match(plainHist, /<link rel="canonical" href="[^"]*\/tr\/guru\/berkshire-hathaway-warren-buffett\/history"/);
  assert.match(plainHist, /<title>Berkshire Hathaway \(Warren Buffett\): Portföy Büyüklüğü ve Çeyreklik Geçmiş \| Fundocap<\/title>/);
  // the sub-page carries breadcrumbs but not a second copy of the fund entity
  assert.doesNotMatch(plainHist, /"@type":"Dataset"/, 'the Dataset lives on the front only');
  // the guru × ticker page still resolves — a symbol is not a segment word
  const { status: tick } = await ssr('/tr/guru/berkshire-hathaway-warren-buffett/AAPL');
  assert.equal(tick, 200);
  // and the numeric route keeps the segment through its redirect
  const { status: red, headers } = await ssr('/tr/manager/1067983/changes');
  assert.equal(red, 301);
  assert.match(headers.location, /\/guru\/berkshire-hathaway-warren-buffett\/changes$/);
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

test('metadata: the page renders in Turkish', async () => {
  const tr = await ssr(GURU);
  assert.match(tr.html, /<title>Berkshire Hathaway \(Warren Buffett\) Portföyü 2026 Q2: Pozisyonlar, Alımlar ve Satışlar \| Fundocap<\/title>/);
  assert.match(tr.html, /<html lang="tr">/);
  assert.match(tr.html, /<meta property="og:locale" content="tr_TR"/);
});

test('FAQ JSON-LD validates on guru and stock pages', async () => {
  for (const url of [GURU, '/tr/stock/AAPL']) {
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
    assert.match(crumbs.itemListElement[0].item['@id'], /^https:\/\/example\.test\/tr$/);
  }
});

test('Turkish-only: no hreflang alternates, canonical is self-referencing', async () => {
  const tr = await ssr(GURU);
  assert.doesNotMatch(tr.html, /hreflang=/, 'a single-language site carries no alternates');
  assert.doesNotMatch(tr.html, /og:locale:alternate/);
  assert.equal(attr(tr.html, /<link rel="canonical" href="([^"]+)"/)[0], `https://example.test${GURU}`);
});

test('redirects: bare and retired /en URLs → /tr; numeric CIK → stored slug', async () => {
  for (const headers of [{}, { 'x-vercel-ip-country': 'US' }, { cookie: 'lang=en' }, { 'accept-language': 'en-US' }]) {
    const bare = await ssr('/manager/0001067983', headers);
    assert.equal(bare.status, 301);
    assert.equal(bare.headers.location, '/tr/manager/0001067983');
  }
  const en = await ssr('/en/stock/AAPL?tab=x');
  assert.equal(en.status, 301);
  assert.equal(en.headers.location, '/tr/stock/AAPL?tab=x', 'the query string survives');
  assert.match(en.headers['cache-control'], /s-maxage=/, 'the redirect is cacheable');
  const enHome = await ssr('/en');
  assert.equal(enHome.headers.location, '/tr');
  // an English content slug lands on its Turkish twin in one hop
  const guide = await ssr('/en/guides/what-is-13f');
  assert.equal(guide.status, 301);
  assert.equal(guide.headers.location, '/tr/rehber/13f-nedir');
  const slug = await ssr('/tr/manager/0001067983');
  assert.equal(slug.status, 301);
  assert.equal(slug.headers.location, GURU);
  const wrongKind = await ssr('/tr/filer/berkshire-hathaway-warren-buffett');
  assert.equal(wrongKind.status, 301);
  assert.equal(wrongKind.headers.location, GURU);
});

test('noindex on account and watchlist; 404 on unknown routes', async () => {
  const acc = await ssr('/tr/account');
  assert.match(acc.html, /<meta name="robots" content="noindex"/);
  assert.equal(acc.headers['cache-control'], 'no-store');
  const nope = await ssr('/tr/does-not-exist');
  assert.equal(nope.status, 404);
  const badSlug = await ssr('/tr/guru/no-such-guru');
  assert.equal(badSlug.status, 404);
});

test('SSR: penny board renders the full table, answer box and JSON-LD without JS', async () => {
  const { status, html, headers } = await ssr('/tr/insiders/penny');
  assert.equal(status, 200);
  assert.match(html, /<title>Kuruş Hisse Insider Alımları: 5 \$ Altı Form 4 Sinyalleri \| Fundocap<\/title>/);
  // the board ships inside the teaser: the first ten rows are server-rendered
  // for a free reader, the lock box under them says how many follow
  assert.ok(count(html, /<tr/g) >= 11, 'header plus ten board rows');
  assert.match(html, /data-pro-gate/);
  assert.match(html, /Kalan \d+ işlem Pro ile/);
  assert.match(html, /data-answer-box/);
  assert.match(html, /<meta name="description" content="[^"]*5 \$ altındaki[^"]*"/);
  const types = jsonLd(html).map((b) => b['@type']);
  for (const type of ['Article', 'ItemList', 'FAQPage', 'BreadcrumbList']) assert.ok(types.includes(type), type);
  assert.match(headers['cache-control'], /s-maxage=3600/);
});

test('SSR: penny board is translated and keeps its sibling signal pages', async () => {
  const tr = await ssr('/tr/insiders/penny');
  assert.match(tr.html, /Kuruş Hisse Insider Fırsatları/);
  assert.match(tr.html, /href="\/tr\/insiders\/cluster"/);
  // /insiders/:signal still serves the other two boards
  const cluster = await ssr('/tr/insiders/cluster');
  assert.equal(cluster.status, 200);
  assert.ok(count(cluster.html, /<table/g) >= 1);
});

test('SSR: the report table, its filters and JSON-LD render without JS', async () => {
  const { status, html, headers } = await ssr('/tr/report');
  assert.equal(status, 200);
  assert.match(html, /<title>Usta Yatırımcılar Ne Aldı, Ne Sattı — \d{4} Q[1-4] \| Fundocap<\/title>/);
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
  const older = await ssr('/tr/report?q=2025-12-31');
  assert.equal(older.status, 200);
});
