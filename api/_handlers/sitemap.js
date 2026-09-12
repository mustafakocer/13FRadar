import { createRequire } from 'node:module';
import { slugTable } from '../_lib/slugs.js';
import { siteUrl } from '../_lib/site.js';
import { historyTable } from '../_lib/history.js';
import { reportIndex } from './report.js';
import { GUIDES, COMPARES } from '../../client/src/content/registry.js';

// Sitemap index + per-entity sitemaps + robots.txt.
//   /sitemap.xml            → index (type=index)
//   /sitemap-gurus.xml      → curated gurus, lastmod = latest filing date
//   /sitemap-filers.xml     → every other 13F filer
//   /sitemap-stocks.xml     → the 500 most-held securities with a ticker
//   /sitemap-insider.xml    → insider signal pages, lastmod = teaser build
//   /sitemap-pages.xml      → static/ranking pages
//   /robots.txt
// Every URL is emitted once per language with xhtml:link alternates.
const require = createRequire(import.meta.url);
const load = (f) => {
  try {
    return require(f);
  } catch {
    return null;
  }
};
const LANGS = ['en', 'tr'];
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

export function buildSitemap(type, site) {
  const slugs = slugTable();
  const universe = load('../../client/public/universe.json');
  const filedByCik = new Map((universe?.rows || []).map((r) => [r.cik, r.filed]));
  const latestFiled = [...filedByCik.values()].sort().pop() || null;

  if (type === 'index') {
    const parts = ['pages', 'gurus', 'filers', 'stocks', 'insider'];
    return {
      contentType: 'application/xml',
      body: `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${parts
        .map((p) => `<sitemap><loc>${esc(`${site}/sitemap-${p}.xml`)}</loc>${latestFiled ? `<lastmod>${latestFiled}</lastmod>` : ''}</sitemap>`)
        .join('\n')}\n</sitemapindex>`,
    };
  }
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
    return { contentType: 'application/xml', body: urlset(site, entries) };
  }
  if (type === 'stocks') {
    const stocks = load('../../client/public/stocks.json');
    const seen = new Set();
    const entries = [];
    for (const r of stocks?.rows || []) {
      if (!r.ticker || seen.has(r.ticker)) continue;
      seen.add(r.ticker);
      entries.push({ path: `/stock/${r.ticker}`, lastmod: day(stocks.updatedAt), changefreq: 'weekly', priority: '0.7' });
    }
    return { contentType: 'application/xml', body: urlset(site, entries) };
  }
  if (type === 'insider') {
    const teaser = load('../../client/public/insiders-teaser.json');
    const lastmod = day(teaser?.updatedAt);
    const entries = ['cluster', 'csuite', 'penny'].map((k) => ({ path: `/insiders/${k}`, lastmod, changefreq: 'daily', priority: '0.8' }));
    entries.push({ path: '/insiders', lastmod, changefreq: 'daily', priority: '0.7' });
    return { contentType: 'application/xml', body: urlset(site, entries) };
  }
  if (type === 'pages') {
    const consensus = load('../../client/public/consensus.json');
    const lastmod = day(consensus?.updatedAt) || latestFiled;
    const entries = [
      { path: '/', lastmod, changefreq: 'daily', priority: '1.0' },
      { path: '/gurus', lastmod: latestFiled, changefreq: 'weekly', priority: '0.9' },
      { path: '/consensus', lastmod, changefreq: 'daily', priority: '0.9' },
      { path: '/rankings/most-bought', lastmod, changefreq: 'daily', priority: '0.8' },
      { path: '/rankings/most-sold', lastmod, changefreq: 'daily', priority: '0.8' },
      { path: '/rankings/consensus', lastmod, changefreq: 'daily', priority: '0.8' },
      { path: '/rankings/conviction', lastmod, changefreq: 'daily', priority: '0.8' },
      { path: '/calendar', lastmod: latestFiled, changefreq: 'daily', priority: '0.8' },
      { path: '/emerging-managers', lastmod: latestFiled, changefreq: 'weekly', priority: '0.7' },
      { path: '/reports', lastmod, changefreq: 'weekly', priority: '0.7' },
      ...reportIndex().map((id) => ({ path: `/reports/${id}`, lastmod, changefreq: 'monthly', priority: '0.8' })),
      ...[...GUIDES, ...COMPARES].map((g) => ({ path: g.paths.en, paths: g.paths, changefreq: 'monthly', priority: '0.6' })),
      { path: '/screen', lastmod: latestFiled, changefreq: 'weekly', priority: '0.6' },
      { path: '/report', lastmod, changefreq: 'weekly', priority: '0.5' },
      { path: '/compare', changefreq: 'monthly', priority: '0.3' },
      { path: '/pricing', changefreq: 'monthly', priority: '0.4' },
      ...['0', ...'abcdefghijklmnopqrstuvwxyz'].map((l) => ({ path: `/filers/${l}`, lastmod: latestFiled, changefreq: 'weekly', priority: '0.4' })),
    ];
    return { contentType: 'application/xml', body: urlset(site, entries) };
  }
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
  return null;
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
