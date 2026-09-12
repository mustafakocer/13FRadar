import test from 'node:test';
import assert from 'node:assert/strict';
import { ssr } from './helpers.mjs';
import { deadlineFor, currentPeriod, nextDeadline, inFilingSeason } from '../api/_lib/calendar.js';
import { contentByPath, GUIDES, COMPARES } from '../client/src/content/registry.js';
import { GUIDE_CONTENT } from '../client/src/content/guides.js';
import { COMPARE_CONTENT, BEST_TRACKERS, MATRIX_ROWS } from '../client/src/content/compare.js';
import { validateHtmlJsonLd } from '../client/src/lib/jsonldValidate.js';

test('13F deadlines: 45 days after quarter end, weekends roll forward', () => {
  assert.equal(deadlineFor('2026-03-31'), '2026-05-15');
  assert.equal(deadlineFor('2026-06-30'), '2026-08-14');
  assert.equal(deadlineFor('2026-09-30'), '2026-11-16', 'Nov 14 2026 is a Saturday');
  assert.equal(deadlineFor('2025-12-31'), '2026-02-16', 'Feb 14 2026 is a Saturday');
  const now = new Date('2026-09-11T00:00:00Z');
  assert.equal(currentPeriod(now).quarterEnd, '2026-06-30');
  assert.equal(nextDeadline(now).deadline, '2026-11-16');
  assert.equal(inFilingSeason(new Date('2026-08-10T00:00:00Z')), true);
  assert.equal(inFilingSeason(new Date('2026-08-25T00:00:00Z')), false);
});

test('calendar and emerging pages render answer box, tables and valid JSON-LD; calendar cache follows the season', async () => {
  for (const url of ['/en/calendar', '/tr/calendar', '/en/emerging-managers']) {
    const { status, html, headers } = await ssr(url);
    assert.equal(status, 200, url);
    assert.match(html, /data-answer-box/);
    assert.ok((html.match(/<table/g) || []).length >= 1);
    assert.deepEqual(validateHtmlJsonLd(html).problems, [], url);
    if (url.endsWith('calendar')) assert.match(headers['cache-control'], inFilingSeason() ? /s-maxage=3600/ : /s-maxage=86400/);
  }
});

test('quarterly report page: generated data, chart pack links, markdown export', async () => {
  const { status, html } = await ssr('/en/reports/2026-q2');
  assert.equal(status, 200);
  assert.match(html, /Q2 2026 Superinvestor Report/);
  assert.match(html, /data-answer-box[^>]*>The Q2 2026 report covers \d+ of \d+ tracked superinvestors/);
  assert.match(html, /\/api\/og\?type=report&amp;id=2026-q2&amp;chart=buys/);
  assert.match(html, /\/api\/report-id\/2026-q2\?format=md/);
  assert.deepEqual(validateHtmlJsonLd(html).problems, []);
  assert.equal((await ssr('/en/reports/2030-q4')).status, 404);
});

test('guides and comparison pages: real copy in both languages, question H2s, per-language slugs, TODO competitor cells', async () => {
  for (const g of GUIDES) {
    for (const lang of ['en', 'tr']) {
      assert.deepEqual(contentByPath(g.paths[lang]), { kind: 'guide', entry: g, lang });
      const c = g.id === 'best-13f-trackers' ? BEST_TRACKERS[lang] : GUIDE_CONTENT[g.id][lang];
      assert.ok(c.lead.length > 200, `${g.id} ${lang} lead`);
      for (const s of c.sections || []) assert.ok(s.h2.endsWith('?'), `H2 is a question: ${s.h2}`);
      assert.ok(c.faq.length >= 2 && c.links.length === 3);
      assert.doesNotMatch(JSON.stringify(c), /lorem|placeholder|TBD/i);
    }
    assert.ok(/[çğıöşü]/i.test(JSON.stringify(g.id === 'best-13f-trackers' ? BEST_TRACKERS.tr : GUIDE_CONTENT[g.id].tr)), 'Turkish copy uses Turkish letters');
  }
  for (const c of COMPARES) {
    for (const lang of ['en', 'tr']) {
      const m = COMPARE_CONTENT[c.id][lang].matrix;
      assert.deepEqual(Object.keys(m).sort(), [...MATRIX_ROWS].sort());
      assert.ok(Object.values(m).every((v) => v === 'TODO'), 'no invented competitor facts');
    }
  }
  const en = await ssr('/en/guides/what-is-13f');
  assert.equal(en.status, 200);
  assert.ok((en.html.match(/<h2/g) || []).length >= 5);
  assert.match(en.html, /hreflang="tr" href="https:\/\/example\.test\/tr\/rehber\/13f-nedir"/);
  assert.match(en.html, /<link rel="canonical" href="https:\/\/example\.test\/en\/guides\/what-is-13f"/);
  assert.deepEqual(validateHtmlJsonLd(en.html).blocks.map((b) => b['@type']), ['Article', 'FAQPage', 'BreadcrumbList']);
  const wrong = await ssr('/en/rehber/13f-nedir');
  assert.equal(wrong.status, 301);
  assert.equal(wrong.headers.location, '/en/guides/what-is-13f');
  const tr = await ssr('/tr/rehber/form-4-nasil-okunur');
  assert.match(tr.html, /Form 4 insider bildirimi nasıl okunur\?/);
});

test('Phase 5 linking: guru page has related managers, latest report and calendar links, dateModified', async () => {
  const { html } = await ssr('/en/guru/berkshire-hathaway-warren-buffett');
  assert.match(html, /Related managers/);
  assert.match(html, /href="\/en\/reports\/2026-q2"/);
  assert.match(html, /href="\/en\/calendar"/);
  assert.match(html, /property="article:modified_time" content="2026-08-14"/);
  const rank = await ssr('/tr/rankings/most-bought');
  assert.match(rank.html, /href="\/tr\/calendar"/);
  const guide = await ssr('/en/guides/13f-limitations');
  assert.ok((guide.html.match(/href="\/en\/(guru|rankings|stock|calendar|guides)\//g) || []).length >= 3, 'guide links to entity pages');
});
