import test from 'node:test';
import assert from 'node:assert/strict';
import './helpers.mjs';
import { buildSitemap, entriesFor, parseType, partsOf, TYPES, URL_LIMIT } from '../api/_handlers/sitemap.js';
import { slugTable, slugify } from '../api/_lib/slugs.js';
import { guruStockTable } from '../api/_lib/guruStocks.js';
import { siteUrl, CANONICAL_SITE } from '../api/_lib/site.js';

const SITE = 'https://example.test';
const locs = (xml) => [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);

test('sitemap index lists every family, under the origin it was given, with lastmod', () => {
  const { body, contentType } = buildSitemap('index', SITE);
  assert.equal(contentType, 'application/xml');
  assert.deepEqual(locs(body), TYPES.map((p) => `${SITE}/sitemap-${p}.xml`));
  assert.equal((body.match(/<lastmod>\d{4}-\d{2}-\d{2}<\/lastmod>/g) || []).length, TYPES.length, 'every part carries a lastmod');
  assert.doesNotMatch(body, /vercel\.app/);
});

test('every listed sitemap builds and names only the canonical origin', () => {
  for (const loc of locs(buildSitemap('index', CANONICAL_SITE).body)) {
    const type = /sitemap-([a-z0-9-]+)\.xml$/.exec(loc)[1];
    const out = buildSitemap(type, CANONICAL_SITE);
    assert.ok(out, `sitemap-${type}.xml builds`);
    const urls = locs(out.body);
    assert.ok(urls.length >= 1, `sitemap-${type}.xml has entries`);
    assert.ok(urls.length <= URL_LIMIT, `sitemap-${type}.xml under the limit (${urls.length})`);
    assert.ok(urls.every((u) => u.startsWith(`${CANONICAL_SITE}/`)), `sitemap-${type}.xml uses the canonical origin`);
    assert.equal((out.body.match(/vercel\.app/g) || []).length, 0);
  }
  assert.equal(buildSitemap('nope', SITE), null);
  assert.equal(buildSitemap('stocks-9', SITE), null, 'a part past the last is unknown');
  assert.deepEqual(parseType('filers-2'), { family: 'filers', part: 2 });
});

test('sitemap-gurus / sitemap-filers contain every stored slug once per language', () => {
  const t = slugTable();
  const gurus = Object.values(t.bySlug).filter((v) => v.kind === 'guru').length;
  const filers = Object.values(t.bySlug).filter((v) => v.kind === 'filer').length;
  assert.ok(gurus >= 10 && filers > 5000, `have ${gurus} gurus, ${filers} filers`);
  const gAll = locs(buildSitemap('gurus', SITE).body);
  const g = gAll.filter((u) => /\/guru\/[a-z0-9-]+$/.test(u));
  const pairs = gAll.filter((u) => /\/guru\/[a-z0-9-]+\/[A-Z0-9.\-]+$/.test(u));
  const subs = gAll.filter((u) => /\/guru\/[a-z0-9-]+\/(changes|mix|history|backtest)$/.test(u));
  const fAll = locs(buildSitemap('filers', SITE).body);
  const f = fAll.filter((u) => /\/filer\/[a-z0-9-]+$/.test(u));
  assert.equal(g.length, gurus * 2);
  assert.equal(subs.length, gurus * 2 * 4, 'four sub-pages per guru per language');
  assert.equal(g.length + subs.length + pairs.length, gAll.length, 'only guru, guru sub-page and guru×ticker URLs');
  assert.equal(f.length, filers * 2);
  assert.equal(fAll.length, f.length, 'filer sub-pages are not listed');
  assert.equal(new Set(gAll).size, gAll.length, 'no duplicate URLs');
  assert.ok(f.length < URL_LIMIT, 'under the 50k per-file limit');
  assert.match(buildSitemap('gurus', SITE).body, /<lastmod>\d{4}-\d{2}-\d{2}<\/lastmod>/);
  assert.match(buildSitemap('gurus', SITE).body, /hreflang="x-default"/);
});

test('sitemap-stocks carries every symbol the curated funds hold', () => {
  const s = buildSitemap('stocks', SITE).body;
  const urls = locs(s);
  const held = new Set((guruStockTable()?.stocks || []).map((x) => x.ticker).filter(Boolean));
  assert.ok(held.size >= 10, 'the per-security table is available');
  for (const sym of held) {
    if (!/^[A-Z0-9.\-]{1,12}$/.test(sym)) continue;
    assert.ok(urls.includes(`${SITE}/en/stock/${sym}`), `${sym} listed (en)`);
    assert.ok(urls.includes(`${SITE}/tr/stock/${sym}`), `${sym} listed (tr)`);
  }
  assert.equal(new Set(urls).size, urls.length, 'each symbol once per language');
  assert.match(s, /<lastmod>\d{4}-\d{2}-\d{2}<\/lastmod>/);
});

test('sitemap-guides lists guides and comparisons under their own language slugs', () => {
  const urls = locs(buildSitemap('guides', SITE).body);
  assert.ok(urls.includes(`${SITE}/en/guides/what-is-13f`));
  assert.ok(urls.includes(`${SITE}/tr/rehber/13f-nedir`));
  assert.ok(!urls.includes(`${SITE}/tr/guides/what-is-13f`), 'no English slug under /tr');
  // and they are not repeated in the pages family
  assert.ok(!locs(buildSitemap('pages', SITE).body).some((u) => /\/(guides|rehber)\//.test(u)));
});

test('a family past the URL limit is split into numbered parts', () => {
  const entry = (i) => ({ path: `/stock/S${i}`, lastmod: '2026-09-01' });
  assert.equal(partsOf(Array.from({ length: 25000 }, (_, i) => entry(i))), 1, '25,000 entries × 2 languages fit one file');
  assert.equal(partsOf(Array.from({ length: 25001 }, (_, i) => entry(i))), 2, 'one more needs a second');
  assert.equal(partsOf([]), 1, 'an empty family is still one (empty) file');
  const ctx = { slugs: { bySlug: {} }, filedByCik: new Map(), latestFiled: '2026-09-01' };
  assert.ok(entriesFor('pages', ctx).length > 10, 'entriesFor runs against a supplied context');
  assert.deepEqual(parseType('stocks-2'), { family: 'stocks', part: 2 });
  assert.equal(buildSitemap('stocks-0', SITE), null);
});

test('sitemap-insider has entries with lastmod', () => {
  const i = buildSitemap('insider', SITE).body;
  assert.ok(locs(i).includes(`${SITE}/en/insiders/cluster`));
  assert.match(i, /<lastmod>/);
});

test('robots.txt references the sitemap index and blocks private routes', () => {
  const { body, contentType } = buildSitemap('robots', SITE);
  assert.equal(contentType, 'text/plain');
  assert.match(body, /^User-agent: \*\nAllow: \/\n/);
  assert.match(body, /Disallow: \/api\//);
  assert.match(body, /Disallow: \/en\/account/);
  assert.match(body, new RegExp(`Sitemap: ${SITE}/sitemap.xml`));
});

test('the production origin is never a Vercel deployment host', () => {
  const env = { ...process.env };
  try {
    process.env.VERCEL_ENV = 'production';
    process.env.SITE_URL = 'https://13-f-radar-omega.vercel.app';
    assert.equal(siteUrl(), CANONICAL_SITE, 'a *.vercel.app SITE_URL is ignored in production');
    delete process.env.SITE_URL;
    assert.equal(siteUrl(), CANONICAL_SITE, 'production defaults to the canonical domain');
    process.env.SITE_URL = 'https://www.fundocap.co';
    assert.equal(siteUrl(), 'https://www.fundocap.co');
    process.env.VERCEL_ENV = 'preview';
    process.env.SITE_URL = 'https://13-f-radar-omega-git-x.vercel.app';
    assert.equal(siteUrl(), 'https://13-f-radar-omega-git-x.vercel.app', 'previews keep their own host');
    delete process.env.SITE_URL;
    process.env.VERCEL_URL = 'preview-abc.vercel.app';
    assert.equal(siteUrl(), 'https://preview-abc.vercel.app');
  } finally {
    for (const k of Object.keys(process.env)) if (!(k in env)) delete process.env[k];
    Object.assign(process.env, env);
  }
});

test('slugs: deterministic, ASCII, never truncated, unique in the stored table', () => {
  assert.equal(slugify('Ronald Muhlenkamp & Co'), 'ronald-muhlenkamp-and-co');
  assert.equal(slugify('Ünlü Yatırım A.Ş.'), 'unlu-yatirim-a-s');
  assert.equal(slugify('  BlackRock, Inc.  '), 'blackrock-inc');
  assert.equal(slugify('Pershing Square Capital Management, L.P.'), 'pershing-square-capital-management-l-p');
  const t = slugTable();
  const ciks = Object.values(t.bySlug).map((v) => v.cik);
  assert.equal(new Set(ciks).size, ciks.length, 'one slug per CIK');
  for (const [slug, v] of Object.entries(t.bySlug)) {
    assert.match(slug, /^[a-z0-9]+(-[a-z0-9]+)*$/, slug);
    assert.equal(t.byCik[v.cik].slug, slug, 'reverse map agrees');
    assert.ok(slug.length >= 3, `slug too short: ${slug}`);
  }
  assert.equal(t.byCik['0001067983'].slug, 'berkshire-hathaway-warren-buffett');
});
