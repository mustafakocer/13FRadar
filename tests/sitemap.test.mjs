import test from 'node:test';
import assert from 'node:assert/strict';
import './helpers.mjs';
import { buildSitemap } from '../api/_handlers/sitemap.js';
import { slugTable, slugify } from '../api/_lib/slugs.js';

const SITE = 'https://example.test';
const locs = (xml) => [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);

test('sitemap index lists every entity sitemap', () => {
  const { body, contentType } = buildSitemap('index', SITE);
  assert.equal(contentType, 'application/xml');
  assert.deepEqual(locs(body), ['pages', 'gurus', 'filers', 'stocks', 'insider'].map((p) => `${SITE}/sitemap-${p}.xml`));
});

test('sitemap-gurus / sitemap-filers contain every stored slug once per language', () => {
  const t = slugTable();
  const gurus = Object.values(t.bySlug).filter((v) => v.kind === 'guru').length;
  const filers = Object.values(t.bySlug).filter((v) => v.kind === 'filer').length;
  assert.ok(gurus >= 10 && filers > 5000, `have ${gurus} gurus, ${filers} filers`);
  const g = locs(buildSitemap('gurus', SITE).body);
  const f = locs(buildSitemap('filers', SITE).body);
  assert.equal(g.length, gurus * 2);
  assert.equal(f.length, filers * 2);
  assert.equal(new Set(g).size, g.length, 'no duplicate URLs');
  assert.ok(g.every((u) => /^https:\/\/example\.test\/(en|tr)\/guru\/[a-z0-9-]+$/.test(u)));
  assert.ok(f.length < 50000, 'under the 50k per-file limit');
  assert.match(buildSitemap('gurus', SITE).body, /<lastmod>\d{4}-\d{2}-\d{2}<\/lastmod>/);
  assert.match(buildSitemap('gurus', SITE).body, /hreflang="x-default"/);
});

test('sitemap-stocks and sitemap-insider have entries with lastmod', () => {
  const s = buildSitemap('stocks', SITE).body;
  assert.ok(locs(s).length >= 100);
  assert.match(s, /\/en\/stock\/[A-Z]/);
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
