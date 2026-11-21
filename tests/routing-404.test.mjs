import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { root, ssr, jsonLd, requireBuild } from './helpers.mjs';
import { entriesFor, default as sitemapHandler } from '../api/_handlers/sitemap.js';
import { matchRoute } from '../api/_lib/ssr/routes.js';
import { isUrlSymbol } from '../api/_lib/urlSymbol.js';
import { resolveSlug, slugTable } from '../api/_lib/slugs.js';

// The web root must not hold the page template. Vercel answers from the file
// system before the rewrites, so a client/dist/index.html is what `/` and
// `/index.html` returned: the unrendered template, no title, no canonical.
test('the build leaves no index.html in the web root; the renderer reads its template from dist/server', () => {
  requireBuild();
  const dist = path.join(root, 'client', 'dist');
  assert.equal(fs.existsSync(path.join(dist, 'index.html')), false, 'client/dist/index.html would be served at / instead of api/ssr.js');
  const tpl = fs.readFileSync(path.join(dist, 'server', 'template.html'), 'utf8');
  for (const mark of ['%LANG%', '<!--app-head-->', '<!--app-html-->', '<script type="module"']) assert.ok(tpl.includes(mark), mark);
});

test('vercel.json: a trailing slash is redirected away, and the catch-all still reaches the renderer', () => {
  const v = JSON.parse(fs.readFileSync(path.join(root, 'vercel.json'), 'utf8'));
  assert.equal(v.trailingSlash, false);
  assert.deepEqual(v.rewrites.at(-1), { source: '/:path*', destination: '/api/ssr?__path=:path*' });
  // nothing in the build may name the template as a public file
  assert.equal(v.outputDirectory, 'client/dist');
});

test('the root address gets the language redirect, query string kept', async () => {
  // as the rewrite delivers it (/api/ssr?__path=) and as a direct hit
  for (const url of ['/api/ssr?__path=', '/']) {
    const en = await ssr(url);
    assert.equal(en.status, 302, url);
    assert.equal(en.headers.location, '/en');
    const tr = await ssr(url, { 'accept-language': 'tr-TR,tr;q=0.9' });
    assert.equal(tr.headers.location, '/tr');
    assert.equal((await ssr(url, { cookie: 'lang=tr' })).headers.location, '/tr');
  }
  assert.equal((await ssr('/api/ssr?__path=&q=apple')).headers.location, '/en?q=apple');
  // /index.html is not a page either: it is redirected like any bare path and then 404s
  const idx = await ssr('/api/ssr?__path=index.html');
  assert.equal(idx.status, 302);
  assert.equal((await ssr('/en/index.html')).status, 404);
});

test('the home page opened with ?q= renders the query in the search box', async () => {
  const { status, html } = await ssr('/tr?q=apple');
  assert.equal(status, 200);
  assert.match(html, /<input[^>]*class="search-input"[^>]*value="apple"/);
  const site = jsonLd(html).find((b) => b['@type'] === 'WebSite');
  assert.equal(site.potentialAction.target.urlTemplate, 'https://example.test/tr?q={search_term_string}');
});

// A loader's 404 used to change the status line only: the entity template was
// still rendered around a name nobody has ("ZZZZZZ — ZZZZZZ Hissesini Hangi
// Usta Yatırımcılar Tutuyor?", FAQ structured data, indexable).
const assertNotFoundPage = (r, lang, label) => {
  assert.equal(r.status, 404, label);
  assert.equal(r.headers['cache-control'], 'no-store', label);
  assert.match(r.html, /data-not-found/, `${label}: generic not-found body`);
  assert.match(r.html, lang === 'tr' ? /<title>Sayfa bulunamadı — Fundocap<\/title>/ : /<title>Page not found — Fundocap<\/title>/, label);
  assert.match(r.html, /<meta name="robots" content="noindex"/, label);
  assert.doesNotMatch(r.html, /rel="canonical"/, `${label}: no canonical`);
  assert.doesNotMatch(r.html, /hreflang=/, `${label}: no alternates`);
  assert.deepEqual(jsonLd(r.html), [], `${label}: no structured data`);
  assert.match(r.html, /window\.__NOT_FOUND__=true/, `${label}: the client is told to render the same page`);
};

test('a loader 404 renders the generic not-found page: no entity title, no JSON-LD, noindex', async () => {
  const cases = [
    ['/tr/stock/ZZZZZZ', 'tr'],
    ['/en/stock/ZZZZZZ', 'en'],
    ['/tr/guru/bu-fon-hic-var-olmadi', 'tr'],
    ['/en/filer/no-such-filer-anywhere', 'en'],
    ['/en/guru/berkshire-hathaway-warren-buffett/ZZZZZZ', 'en'],
    ['/en/congress/nobody-by-this-name', 'en'],
    ['/en/congress/committee/no-such-committee', 'en'],
    ['/en/reports/2030-q4', 'en'],
  ];
  for (const [url, lang] of cases) {
    const r = await ssr(url);
    assertNotFoundPage(r, lang, url);
    assert.doesNotMatch(r.html, /ZZZZZZ —|FAQPage/, url);
  }
});

test('an unmatched path keeps the not-found page it always had, now without a canonical', async () => {
  const r = await ssr('/tr/zzz-nope');
  assert.equal(r.status, 404);
  assert.match(r.html, /data-not-found/);
  assert.match(r.html, /<meta name="robots" content="noindex"/);
  assert.doesNotMatch(r.html, /rel="canonical"|hreflang=/);
});

test('a page that exists is untouched: canonical, alternates, no not-found flag', async () => {
  const r = await ssr('/en/gurus');
  assert.equal(r.status, 200);
  assert.match(r.html, /rel="canonical" href="https:\/\/example\.test\/en\/gurus"/);
  assert.match(r.html, /hreflang="x-default"/);
  assert.doesNotMatch(r.html, /__NOT_FOUND__|data-not-found/);
});

// 274 guru × "ticker" addresses in the live sitemap were bonds and preferred
// shares (`WFC 7.5 PERP L`): spaces in <loc>, and a route that refuses them.
test('every guru sitemap address is one the router accepts, and is listed once', () => {
  const entries = entriesFor('gurus');
  const paths = entries.map((e) => e.path);
  assert.equal(new Set(paths).size, paths.length, 'duplicate sitemap paths');
  const pairs = paths.filter((p) => /^\/guru\/[^/]+\/[^/]+$/.test(p) && !/\/(changes|mix|history|backtest)$/.test(p));
  for (const p of paths) {
    assert.doesNotMatch(p, /\s|%20/, p);
    const m = matchRoute(p, '');
    assert.ok(m, `no route for ${p}`);
  }
  for (const p of pairs) {
    assert.equal(matchRoute(p, '').route.kind, 'guru-ticker', p);
    assert.ok(isUrlSymbol(p.split('/').pop()), p);
  }
  assert.equal(isUrlSymbol('WFC 7.5 PERP L'), false);
  assert.equal(isUrlSymbol('BRK.B'), true);
  assert.equal(isUrlSymbol('BF-B'), true);
  assert.equal(isUrlSymbol(''), false);
  assert.equal(isUrlSymbol('ABCDEFGHIJKLM'), false);
  assert.equal(isUrlSymbol(null), false);
});

test('the served gurus sitemap has no space inside a <loc>', async () => {
  const res = { statusCode: 200, headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(c) { this.statusCode = c; return this; }, send(b) { this.body = b; return this; }, end(b) { this.body = b; return this; } };
  await sitemapHandler({ query: { type: 'gurus' }, headers: { host: 'example.test' } }, res);
  const locs = [...String(res.body || '').matchAll(/<loc>([^<]*)<\/loc>/g)].map((m) => m[1]);
  assert.ok(locs.length > 0, 'the gurus sitemap is empty');
  for (const l of locs) assert.doesNotMatch(l, /\s/, l);
});

// A curated fund answers under the slug of its EDGAR registrant name too —
// the address every other filer has, so the one people guess.
test('EDGAR-name slugs of curated funds redirect to the guru page', async () => {
  const want = {
    'berkshire-hathaway-inc': 'berkshire-hathaway-warren-buffett',
    'bridgewater-associates-lp': 'bridgewater-associates-ray-dalio',
    'renaissance-technologies-llc': 'renaissance-technologies',
  };
  for (const [from, to] of Object.entries(want)) {
    const hit = resolveSlug(from);
    assert.equal(hit?.canonical, to, from);
    assert.equal(hit.alias, true);
    for (const section of ['filer', 'guru']) {
      const r = await ssr(`/tr/${section}/${from}`);
      assert.equal(r.status, 301, `/${section}/${from}`);
      assert.equal(r.headers.location, `/tr/guru/${to}`);
    }
  }
  const sub = await ssr('/en/filer/berkshire-hathaway-inc/changes');
  assert.equal(sub.status, 301);
  assert.equal(sub.headers.location, '/en/guru/berkshire-hathaway-warren-buffett/changes');
});

test('every pinned alias points at a slug that exists and shadows no live page', () => {
  const pinned = JSON.parse(fs.readFileSync(path.join(root, 'config', 'slug-aliases.json'), 'utf8')).aliases;
  const { bySlug } = slugTable();
  for (const [from, to] of Object.entries(pinned)) {
    assert.ok(bySlug[to], `${from} → ${to}: target missing`);
    assert.ok(!bySlug[from], `${from} is a live slug`);
    assert.equal(resolveSlug(from).canonical, to);
  }
});
