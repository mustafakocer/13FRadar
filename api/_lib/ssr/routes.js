import { createRequire } from 'node:module';
import { invoke, withBudget } from './invoke.js';
import managerHandler from '../../_handlers/manager.js';
import holdingsHandler from '../../_handlers/holdings.js';
import stockHandler from '../../_handlers/stock.js';
import holdersHandler from '../../_handlers/holders.js';
import slugHandler from '../../_handlers/slug.js';
import { cikForSlug, filerPath } from '../slugs.js';

const require = createRequire(import.meta.url);
const json = (file) => {
  try {
    return require(file);
  } catch {
    return null;
  }
};
// Static files written by the GitHub Actions (same files the client fetches).
const staticConsensus = () => json('../../../client/public/consensus.json');
const staticTeaser = () => json('../../../client/public/insiders-teaser.json');
const staticReturns = () => json('../../../client/public/returns.json');
const staticSummary = () => json('../../../client/public/universe-summary.json');
const staticStocks = () => json('../../../client/public/stocks.json');

// CDN cache policy per page kind — the ISR equivalent for a Vite app.
export const CACHE = {
  hour: 's-maxage=3600, stale-while-revalidate=86400',
  day: 's-maxage=86400, stale-while-revalidate=604800',
  none: 'no-store',
};

const ok = (r) => (r && r.status === 200 && r.body && !r.body.error ? r.body : null);

async function loadHome() {
  const seeds = [];
  const c = staticConsensus();
  if (c) seeds.push([['consensus'], c]);
  const t = staticTeaser();
  if (t) seeds.push([['insiders-teaser'], t]);
  const r = staticReturns();
  if (r) seeds.push([['static-returns'], r.returns || {}]);
  const s = staticSummary();
  if (s) seeds.push([['universe-summary'], s]);
  return seeds;
}

async function loadManager({ cik, slug, kind }) {
  const seeds = [];
  if (slug) {
    const e = cikForSlug(slug);
    if (!e || (kind && e.kind !== kind && !(kind === 'filer' && e.kind === 'guru'))) return { seeds, status: 404 };
    if (kind === 'filer' && e.kind === 'guru') return { redirect: `/guru/${slug}`, status: 301 };
    cik = e.cik;
    seeds.push([['slug', slug], { ...e, slug }]);
  } else if (cik) {
    // numeric route: 301 to the stored slug so one URL carries the ranking
    const canonical = filerPath(cik);
    if (!canonical.startsWith('/manager/')) return { redirect: canonical, status: 301 };
  }
  const mgr = ok(await withBudget(invoke(managerHandler, { cik }), 8000));
  if (!mgr) return { seeds, status: 404 };
  seeds.push([['manager', cik], mgr]);
  const acc = mgr.filings?.[0]?.acc;
  if (acc) {
    // free tier: top 10 rows + true totals (isPro is false on the server)
    const hold = ok(await withBudget(invoke(holdingsHandler, { cik, acc }), 9000));
    if (hold) {
      seeds.push([['holdings', cik, acc, false], hold]);
      const prev = mgr.filings?.[1];
      const visible = (hold.positions || []).slice(0, 10).map((p) => p.cusip);
      if (prev && visible.length) {
        const light = ok(
          await withBudget(invoke(holdingsHandler, { cik, acc: prev.acc, light: '1', cusips: visible.join(',') }), 6000)
        );
        if (light) seeds.push([['holdings-light', cik, prev.acc, false, visible.join(',')], light]);
      }
    }
  }
  const r = staticReturns();
  if (r) seeds.push([['static-returns'], r.returns || {}]);
  const c = staticConsensus();
  if (c) seeds.push([['consensus'], c]);
  return { seeds };
}

async function loadStock({ ticker, cusip }) {
  const seeds = [];
  const stock = ok(await withBudget(invoke(stockHandler, { ticker }), 8000));
  if (!stock) return { seeds, status: 404 };
  seeds.push([['stock', ticker], stock]);
  const holdersQ = cusip || stock?.price?.name?.replace(/\.$/, '') || null;
  if (holdersQ) {
    const h = ok(await withBudget(invoke(holdersHandler, { q: holdersQ }), 8000));
    if (h) seeds.push([['holders', holdersQ], h]);
  }
  const c = staticConsensus();
  if (c) seeds.push([['consensus'], c]);
  return { seeds };
}

async function loadConsensus() {
  const seeds = [];
  const c = staticConsensus();
  if (c) seeds.push([['consensus'], c]);
  const s = staticStocks();
  if (s) seeds.push([['stocksUniverse'], { ...s, rows: (s.rows || []).slice(0, 60) }]);
  return seeds;
}

async function loadGurus() {
  const r = ok(await invoke(slugHandler, { kind: 'guru' }));
  return r ? [[['gurus'], r]] : [];
}
async function loadFilers({ letter }) {
  const r = ok(await invoke(slugHandler, { letter }));
  return r ? [[['filers', letter], r]] : [];
}
async function loadRankings() {
  const seeds = await loadConsensus();
  const r = staticReturns();
  if (r) seeds.push([['static-returns'], r.returns || {}]);
  return seeds;
}

async function loadTeaserOnly() {
  const t = staticTeaser();
  return t ? [[['insiders-teaser'], t]] : [];
}

// Public routes rendered on the server. Anything else renders the shell
// (client-only pages) with a no-store header.
export const ROUTES = [
  { kind: 'home', re: /^\/$/, load: loadHome, cache: 'hour' },
  { kind: 'manager', re: /^\/manager\/(\d{1,10})$/, params: (m) => ({ cik: m[1].padStart(10, '0') }), load: loadManager, cache: 'day' },
  { kind: 'guru', re: /^\/guru\/([a-z0-9-]{1,120})$/, params: (m) => ({ slug: m[1], kind: 'guru' }), load: loadManager, cache: 'day' },
  { kind: 'filer', re: /^\/filer\/([a-z0-9-]{1,120})$/, params: (m) => ({ slug: m[1], kind: 'filer' }), load: loadManager, cache: 'day' },
  { kind: 'gurus', re: /^\/gurus$/, load: loadGurus, cache: 'day' },
  { kind: 'filers', re: /^\/filers(?:\/([a-z0-9]))?$/, params: (m) => ({ letter: m[1] || 'a' }), load: loadFilers, cache: 'day' },
  { kind: 'insider-signal', re: /^\/insiders\/(cluster|csuite|penny)$/, load: loadTeaserOnly, cache: 'hour' },
  { kind: 'rankings', re: /^\/rankings\/(most-bought|most-sold|consensus|conviction)$/, load: loadRankings, cache: 'hour' },
  { kind: 'stock', re: /^\/stock\/([A-Za-z0-9.\-]{1,12})$/, params: (m, qs) => ({ ticker: m[1].toUpperCase(), cusip: qs.get('cusip') }), load: loadStock, cache: 'day' },
  { kind: 'consensus', re: /^\/consensus$/, load: loadConsensus, cache: 'hour' },
  { kind: 'insiders', re: /^\/insiders$/, load: loadTeaserOnly, cache: 'hour' },
  { kind: 'pricing', re: /^\/pricing$/, load: async () => [], cache: 'day' },
  { kind: 'report', re: /^\/report$/, load: loadConsensus, cache: 'hour' },
  { kind: 'screen', re: /^\/screen$/, load: async () => [], cache: 'hour' },
  { kind: 'compare', re: /^\/compare$/, load: async () => [], cache: 'hour' },
  { kind: 'watchlist', re: /^\/watchlist$/, load: async () => [], cache: 'none' },
  { kind: 'account', re: /^\/account$/, load: async () => [], cache: 'none' },
];

export function matchRoute(pathname, search) {
  const qs = new URLSearchParams(search || '');
  for (const r of ROUTES) {
    const m = r.re.exec(pathname);
    if (m) return { route: r, params: r.params ? r.params(m, qs) : {} };
  }
  return null;
}
