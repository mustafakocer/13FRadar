import { createRequire } from 'node:module';
import { slugTable } from '../_lib/slugs.js';
import { siteUrl } from '../_lib/site.js';
import { historyTable } from '../_lib/history.js';
import { guruStockTable } from '../_lib/guruStocks.js';
import { reportIndex } from './report.js';
import { GUIDES, COMPARES, LEGAL } from '../../client/src/content/registry.js';

// Sitemap index + per-entity sitemaps + robots.txt.
//   /sitemap.xml            → index (type=index)
//   /sitemap-pages.xml      → static / ranking / listing pages
//   /sitemap-gurus.xml      → curated gurus, their sub-pages and guru × ticker pages
//   /sitemap-filers.xml     → every other 13F filer
//   /sitemap-stocks.xml     → every security the curated funds hold, plus the
//                             universe's most-held names
//   /sitemap-guides.xml     → guides and comparisons (language-specific slugs)
//   /sitemap-insider.xml    → insider signal pages, lastmod = teaser build
//   /robots.txt
// Every URL is emitted once per language with xhtml:link alternates. A
// family that would exceed the protocol's 50,000-URL limit is split into
// /sitemap-<type>-<n>.xml parts and the index lists each part.
//
// The origin comes from api/_lib/site.js — never from the request's host —
// so the index can only ever name the canonical domain.
const require = createRequire(import.meta.url);
const load = (f) => {
  try {
    return require(f);
  } catch {
    return null;
  }
};
const LANGS = ['en', 'tr'];
export const URL_LIMIT = 50000;
export const TYPES = ['pages', 'gurus', 'filers', 'stocks', 'guides', 'insider'];
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function urlset(site, entries) {
  const body = entries
    .flatMap(({ path, paths, lastmod, changefreq, priority }) =>
      LANGS.map((lang) => {
        const p = (l) => {
          const x = paths?.[l] || path;
          return x === '/' ? '' : x;
        };
        const alts = LANGS.map((l) => `<xhtml:link rel="alternate" hreflang="${l}" href="${esc(`${site}/${l}${p(l)}`)}"/>`).join('');
        const xdef = `<xhtml:link rel="alternate" hreflang="x-default" href="${esc(`${site}/en${p('en')}`)}"/>`;
        return `<url><loc>${esc(`${site}/${lang}${p(lang)}`)}</loc>${lastmod ? `<lastmod>${lastmod}</lastmod>` : ''}${changefreq ? `<changefreq>${changefreq}</changefreq>` : ''}${priority ? `<priority>${priority}</priority>` : ''}${alts}${xdef}</url>`;
      })
    )
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n${body}\n</urlset>`;
}

const day = (iso) => (iso ? String(iso).slice(0, 10) : null);
// each entry becomes one URL per language
const PER_PART = Math.floor(URL_LIMIT / LANGS.length);

function context() {
  const slugs = slugTable();
  const universe = load('../../client/public/universe.json');
  const filedByCik = new Map((universe?.rows || []).map((r) => [r.cik, r.filed]));
  const latestFiled = [...filedByCik.values()].sort().pop() || null;
  return { slugs, filedByCik, latestFiled };
}

// The entries of one family, before language expansion and chunking.
export function entriesFor(type, ctx = context()) {
  const { slugs, filedByCik, latestFiled } = ctx;
  if (type === 'gurus' || type === 'filers') {
    const want = type === 'gurus' ? 'guru' : 'filer';
    const entries = Object.entries(slugs.bySlug)
      .filter(([, v]) => v.kind === want)
      .map(([slug, v]) => ({
        path: `/${want}/${slug}`,
        lastmod: day(filedByCik.get(v.cik)) || latestFiled,
        changefreq: 'weekly',
        priority: want === 'guru' ? '0.9' : '0.5',
      }));
    if (want === 'guru') {
      // each guru's sub-pages; filers keep only their front, four more URLs
      // apiece across eight thousand of them is weight without readers
      for (const e of [...entries]) {
        for (const seg of ['changes', 'mix', 'history', 'backtest']) {
          entries.push({ path: `${e.path}/${seg}`, lastmod: e.lastmod, changefreq: 'weekly', priority: '0.6' });
        }
      }
      // guru × ticker trade-history pages for positions currently held
      const hist = historyTable();
      for (const [slug, v] of Object.entries(slugs.bySlug)) {
        const g = v.kind === 'guru' && hist?.gurus?.[v.cik];
        if (!g) continue;
        const lastmod = day(g.quarters[g.quarters.length - 1]?.filed) || latestFiled;
        for (const e of Object.values(g.positions)) {
          if (e.ticker && e.heldQuarters > 0) entries.push({ path: `/guru/${slug}/${e.ticker}`, lastmod, changefreq: 'weekly', priority: '0.6' });
        }
      }
    }
    return entries;
  }
  if (type === 'stocks') {
    // Every name the curated funds hold (the per-security table the stock
    // page is built from), then the universe's most-held list. A symbol is
    // listed once, under the date its table was last rebuilt.
    const seen = new Set();
    const entries = [];
    const add = (ticker, lastmod, priority) => {
      const sym = String(ticker || '').toUpperCase();
      if (!sym || !/^[A-Z0-9.\-]{1,12}$/.test(sym) || seen.has(sym)) return;
      seen.add(sym);
      entries.push({ path: `/stock/${sym}`, lastmod, changefreq: 'weekly', priority });
    };
    const gs = guruStockTable();
    const gsDate = day(gs?.updatedAt) || latestFiled;
    for (const s of gs?.stocks || []) add(s.ticker, gsDate, s.rank <= 100 ? '0.8' : '0.7');
    for (const o of gs?.options || []) add(o.ticker, gsDate, '0.6');
    const stocks = load('../../client/public/stocks.json');
    for (const r of stocks?.rows || []) add(r.ticker, day(stocks.updatedAt) || latestFiled, '0.7');
    return entries;
  }
  if (type === 'guides') {
    const consensus = load('../../client/public/consensus.json');
    const lastmod = day(consensus?.updatedAt) || latestFiled;
    return [...GUIDES, ...COMPARES, ...LEGAL].map((g) => ({ path: g.paths.en, paths: g.paths, lastmod: g.updatedAt || lastmod, changefreq: 'monthly', priority: g.id === 'privacy' || g.id === 'terms' ? '0.3' : '0.6' }));
  }
  if (type === 'insider') {
    const teaser = load('../../client/public/insiders-teaser.json');
    const lastmod = day(teaser?.updatedAt);
    const entries = ['cluster', 'csuite', 'penny'].map((k) => ({ path: `/insiders/${k}`, lastmod, changefreq: 'daily', priority: '0.8' }));
    entries.push({ path: '/insiders', lastmod, changefreq: 'daily', priority: '0.7' });
    return entries;
  }
  if (type === 'pages') {
    const consensus = load('../../client/public/consensus.json');
    const lastmod = day(consensus?.updatedAt) || latestFiled;
    return [
      { path: '/', lastmod, changefreq: 'daily', priority: '1.0' },
      { path: '/gurus', lastmod: latestFiled, changefreq: 'weekly', priority: '0.9' },
      { path: '/consensus', lastmod, changefreq: 'daily', priority: '0.9' },
      { path: '/rankings/most-bought', lastmod, changefreq: 'daily', priority: '0.8' },
      { path: '/rankings/most-sold', lastmod, changefreq: 'daily', priority: '0.8' },
      { path: '/rankings/consensus', lastmod, changefreq: 'daily', priority: '0.8' },
      { path: '/rankings/conviction', lastmod, changefreq: 'daily', priority: '0.8' },
      { path: '/rankings/options', lastmod, changefreq: 'daily', priority: '0.7' },
      { path: '/filings', lastmod, changefreq: 'daily', priority: '0.7' },
      ...['bought', 'sold', 'new', 'funds', 'universe'].map((k) => ({ path: `/consensus/${k}`, lastmod, changefreq: 'daily', priority: '0.8' })),
      { path: '/screen/stocks', lastmod, changefreq: 'daily', priority: '0.7' },
      { path: '/calendar', lastmod: latestFiled, changefreq: 'daily', priority: '0.8' },
      { path: '/emerging-managers', lastmod: latestFiled, changefreq: 'weekly', priority: '0.7' },
      { path: '/reports', lastmod, changefreq: 'weekly', priority: '0.7' },
      ...reportIndex().map((id) => ({ path: `/reports/${id}`, lastmod, changefreq: 'monthly', priority: '0.8' })),
      { path: '/screen', lastmod: latestFiled, changefreq: 'weekly', priority: '0.6' },
      { path: '/report', lastmod, changefreq: 'weekly', priority: '0.5' },
      { path: '/compare', changefreq: 'monthly', priority: '0.3' },
      { path: '/pricing', changefreq: 'monthly', priority: '0.4' },
      ...['0', ...'abcdefghijklmnopqrstuvwxyz'].map((l) => ({ path: `/filers/${l}`, lastmod: latestFiled, changefreq: 'weekly', priority: '0.4' })),
    ];
  }
  return null;
}

// How many files a family needs: one URL per language per entry.
export const partsOf = (entries) => Math.max(1, Math.ceil(entries.length / PER_PART));

// "stocks" → { family: 'stocks', part: 1 }; "filers-3" → part 3.
export function parseType(type) {
  const m = /^([a-z]+)(?:-(\d+))?$/.exec(String(type || ''));
  if (!m) return null;
  return { family: m[1], part: m[2] ? Number(m[2]) : 1 };
}

export function buildSitemap(type, site) {
  if (type === 'robots') {
    // AI crawlers are welcome (GEO): explicit Allow blocks so a future
    // blanket rule can never shut them out by accident. Only private and
    // machine endpoints are disallowed.
    const AI_BOTS = ['GPTBot', 'ChatGPT-User', 'OAI-SearchBot', 'ClaudeBot', 'Claude-User', 'anthropic-ai', 'PerplexityBot', 'Perplexity-User', 'Google-Extended', 'Bingbot', 'Applebot', 'CCBot'];
    const disallow = ['/api/', '/user/', '/account', '/auth/', '/en/account', '/tr/account', '/en/auth/', '/tr/auth/'];
    const block = (ua) => `User-agent: ${ua}\nAllow: /\n${disallow.map((d) => `Disallow: ${d}`).join('\n')}\n`;
    return {
      contentType: 'text/plain',
      body: `${block('*')}\n${AI_BOTS.map(block).join('\n')}\nSitemap: ${site}/sitemap.xml\n`,
    };
  }
  const ctx = context();
  if (type === 'index') {
    const rows = [];
    for (const family of TYPES) {
      const entries = entriesFor(family, ctx) || [];
      const n = partsOf(entries);
      const lastmod = entries.reduce((m, e) => (e.lastmod && e.lastmod > m ? e.lastmod : m), '') || ctx.latestFiled;
      for (let i = 1; i <= n; i++) {
        const name = n === 1 ? family : `${family}-${i}`;
        rows.push(`<sitemap><loc>${esc(`${site}/sitemap-${name}.xml`)}</loc>${lastmod ? `<lastmod>${lastmod}</lastmod>` : ''}</sitemap>`);
      }
    }
    return {
      contentType: 'application/xml',
      body: `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${rows.join('\n')}\n</sitemapindex>`,
    };
  }
  const parsed = parseType(type);
  if (!parsed || !TYPES.includes(parsed.family)) return null;
  const entries = entriesFor(parsed.family, ctx);
  if (!entries || parsed.part < 1 || parsed.part > partsOf(entries)) return null;
  const slice = partsOf(entries) === 1 ? entries : entries.slice((parsed.part - 1) * PER_PART, parsed.part * PER_PART);
  return { contentType: 'application/xml', body: urlset(site, slice) };
}

export default function handler(req, res) {
  let site;
  try {
    site = siteUrl(req);
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
  const out = buildSitemap(String(req.query.type || 'index'), site);
  if (!out) return res.status(404).json({ error: 'Unknown sitemap' });
  res.setHeader('Content-Type', `${out.contentType}; charset=utf-8`);
  res.setHeader('Cache-Control', 's-maxage=21600, stale-while-revalidate=86400');
  res.status(200).send(out.body);
}
