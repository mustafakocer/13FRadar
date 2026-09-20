import fs from 'node:fs';
import { createRequire } from 'node:module';
import { invoke, withBudget } from './invoke.js';
import managerHandler from '../../_handlers/manager.js';
import holdingsHandler from '../../_handlers/holdings.js';
import stockHandler from '../../_handlers/stock.js';
import guruStocksHandler from '../../_handlers/guru-stocks.js';
import slugHandler from '../../_handlers/slug.js';
import guruHistoryHandler from '../../_handlers/guru-history.js';
import calendarHandler from '../../_handlers/calendar.js';
import emergingHandler from '../../_handlers/emerging.js';
import reportHandler from '../../_handlers/report.js';
import relatedHandler from '../../_handlers/related.js';
import { inFilingSeason } from '../calendar.js';
import { contentByPath } from '../../../client/src/content/registry.js';
import { cikForSlug, resolveSlug, filerPath } from '../slugs.js';
import { knownSymbol, priceUnavailable } from '../priceSnapshot.js';
import { guruStock } from '../guruStocks.js';

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
const staticActivity = () => json('../../../client/public/guru-activity.json');
const staticTeaser = () => json('../../../client/public/insiders-teaser.json');
const staticReturns = () => json('../../../client/public/returns.json');
const staticSummary = () => json('../../../client/public/universe-summary.json');
const staticStocks = () => json('../../../client/public/stocks.json');
// FILINGS_FILE points the offline tests at a fixture feed; production reads
// the file the daily Action writes, and renders nothing when it is absent.
const staticFilings = () => {
  const override = process.env.FILINGS_FILE;
  if (!override) return json('../../../client/public/filings.json');
  try {
    return JSON.parse(fs.readFileSync(override, 'utf8'));
  } catch {
    return null;
  }
};

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

async function loadManager({ cik, slug, kind, segment = 'portfolio' }) {
  const tail = segment === 'portfolio' ? '' : `/${segment}`;
  const seeds = [];
  if (slug) {
    const hit = resolveSlug(slug);
    if (!hit) return { seeds, status: 404 };
    const e = hit.entry;
    if (kind && e.kind !== kind && !(kind === 'filer' && e.kind === 'guru')) return { seeds, status: 404 };
    // A slug we used to link to is sent to the one that exists, under the
    // section the entry actually belongs to.
    if (hit.alias || (kind === 'filer' && e.kind === 'guru')) {
      return { redirect: `/${e.kind === 'guru' ? 'guru' : 'filer'}/${hit.canonical}${tail}`, status: 301 };
    }
    cik = e.cik;
    seeds.push([['slug', slug], { ...e, slug }]);
  } else if (cik) {
    // numeric route: 301 to the stored slug so one URL carries the ranking
    const canonical = filerPath(cik);
    if (!canonical.startsWith('/manager/')) return { redirect: `${canonical}${tail}`, status: 301 };
  }
  const mgr = ok(await withBudget(invoke(managerHandler, { cik }), 8000));
  if (!mgr) return { seeds, status: 404 };
  seeds.push([['manager', cik], mgr]);
  const acc = mgr.filings?.[0]?.acc;
  if (acc) {
    // free tier: top 10 rows + true totals (isPro is false on the server)
    // Usually answered from the stored snapshot in a few milliseconds; the
    // budget only binds when a filing newer than the snapshot has to be read.
    const hold = ok(await withBudget(invoke(holdingsHandler, { cik, acc }), 9000));
    if (hold) seeds.push([['holdings', cik, acc, false], hold]);
    // The previous quarter (for the change arrows) is always an EDGAR read
    // and used to cost the render up to six more seconds; the client fetches
    // it after hydration and the arrows fill in.
  }
  // returns/consensus are only used by the holdings tab and are fetched by
  // the client — keeping them out trims ~40 KB from every guru page
  const h = await invoke(guruHistoryHandler, { cik });
  if (h.status === 200) seeds.push([['guru-history', cik], h.body]);
  const rel = await invoke(relatedHandler, { cik });
  if (rel.status === 200) seeds.push([['related', cik], rel.body]);
  return { seeds };
}

async function loadGuruTicker({ slug, ticker }) {
  const hit = resolveSlug(slug);
  if (!hit || hit.entry.kind !== 'guru') return { seeds: [], status: 404 };
  if (hit.alias) return { redirect: `/guru/${hit.canonical}/${ticker}`, status: 301 };
  const e = hit.entry;
  const seeds = [[['slug', slug], { ...e, slug }]];
  const p = await invoke(guruHistoryHandler, { cik: e.cik, ticker });
  if (p.status !== 200) return { seeds, status: 404 };
  seeds.push([['guru-ticker', e.cik, ticker], p.body]);
  return { seeds };
}

// A stock page's status is decided by whether the symbol is ours to serve,
// never by whether a quote provider answered. The quote handler answers 200
// within its own budget (a live quote, the last one seen, the nightly close,
// or an empty price block), so the only 404 is a symbol no committed dataset
// has ever carried and no provider knows. Tying the status to the provider
// chain is what made every /stock/* URL a soft 404 on a throttled day.
async function loadStock({ ticker, cusip }) {
  const seeds = [];
  const stock = ok(await withBudget(invoke(stockHandler, { ticker }), 8000));
  const priced = stock?.price?.price != null;
  if (!priced && !knownSymbol(ticker) && !guruStock({ ticker, cusip })) return { seeds, status: 404 };
  seeds.push([['stock', ticker], stock || priceUnavailable(ticker)]);
  const c = staticConsensus();
  if (c) seeds.push([['consensus'], c]);
  // The guru standing is the free hook and the answer an assistant quotes, so
  // it has to be in the HTML rather than arrive after hydration. Anonymous
  // render = the free payload, which is what the CDN may keep.
  const g = ok(await invoke(guruStocksHandler, { ticker, ...(cusip ? { cusip } : {}) }));
  if (g?.available) seeds.push([['guru-stock', cusip || ticker], g]);
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

// The consensus page itself: the static file above plus the per-security
// table its default segment renders, under the exact key the unfiltered page
// asks for — a seed only counts when the key matches.
async function loadConsensusPage() {
  const seeds = await loadConsensus();
  const r = staticReturns();
  if (r) seeds.push([['static-returns'], r.returns || {}]);
  const g = ok(await invoke(guruStocksHandler, { limit: '500' }));
  if (g?.available) seeds.push([['guru-stocks', 500, '', '', 0, 0], g]);
  const o = ok(await invoke(guruStocksHandler, { view: 'options' }));
  if (o?.available) seeds.push([['guru-options'], o]);
  return seeds;
}

// /report renders its whole table from the activity pivot, so that file has to
// be seeded or the page ships empty to crawlers.
async function loadReport() {
  const seeds = await loadConsensus();
  // the index alone: it carries the newest quarter, which is what renders
  const a = staticActivity();
  if (a) seeds.push([['guru-activity'], a]);
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
  // The full ranked table, under the key the unfiltered page asks for, so a
  // crawler sees the whole list rather than the thirty public rows.
  const g = ok(await invoke(guruStocksHandler, { limit: '300' }));
  if (g?.available) seeds.push([['guru-stocks', 300, '', '', 0, 0], g]);
  const o = ok(await invoke(guruStocksHandler, { view: 'options' }));
  if (o?.available) seeds.push([['guru-options'], o]);
  return seeds;
}

// The stock screener asks for a bigger page than the ranking pages do, and a
// seed only counts when its key matches exactly.
async function loadStockScreen() {
  const seeds = [];
  const r = staticReturns();
  if (r) seeds.push([['static-returns'], r.returns || {}]);
  const g = ok(await invoke(guruStocksHandler, { limit: '500' }));
  if (g?.available) seeds.push([['guru-stocks', 500, '', '', 0, 0], g]);
  return seeds;
}

async function loadFilings() {
  const f = staticFilings();
  return f ? [[['filings'], f]] : [];
}

async function loadCalendar() {
  const r = await invoke(calendarHandler, {});
  return r.status === 200 ? [[['calendar'], r.body]] : [];
}
async function loadEmerging() {
  const r = await invoke(emergingHandler, {});
  return r.status === 200 ? [[['emerging'], r.body]] : [];
}

async function loadReports({ id }) {
  if (!id) {
    const r = await invoke(reportHandler, {});
    return r.status === 200 ? [[['reports'], r.body]] : [];
  }
  const r = await invoke(reportHandler, { id });
  if (r.status !== 200) return { seeds: [], status: 404 };
  return { seeds: [[['report', id], r.body]] };
}

async function loadTeaserOnly() {
  const t = staticTeaser();
  return t ? [[['insiders-teaser'], t]] : [];
}

// Public routes rendered on the server. Anything else renders the shell
// (client-only pages) with a no-store header.
export const ROUTES = [
  { kind: 'home', re: /^\/$/, load: loadHome, cache: 'hour' },
  // A fund's sub-pages are the fixed words after its slug; they are matched
  // before the guru × ticker route, whose last segment is a symbol.
  { kind: 'manager', re: /^\/manager\/(\d{1,10})(?:\/(changes|mix|history|backtest))?$/, params: (m) => ({ cik: m[1].padStart(10, '0'), segment: m[2] || 'portfolio' }), load: loadManager, cache: 'day' },
  { kind: 'guru', re: /^\/guru\/([a-z0-9-]{1,120})(?:\/(changes|mix|history|backtest))?$/, params: (m) => ({ slug: m[1], kind: 'guru', segment: m[2] || 'portfolio' }), load: loadManager, cache: 'day' },
  { kind: 'guru-ticker', re: /^\/guru\/([a-z0-9-]{1,120})\/(?!(?:changes|mix|history|backtest)$)([A-Za-z0-9.\-]{1,12})$/, params: (m) => ({ slug: m[1], ticker: m[2].toUpperCase() }), load: loadGuruTicker, cache: 'day' },
  { kind: 'filer', re: /^\/filer\/([a-z0-9-]{1,120})(?:\/(changes|mix|history|backtest))?$/, params: (m) => ({ slug: m[1], kind: 'filer', segment: m[2] || 'portfolio' }), load: loadManager, cache: 'day' },
  { kind: 'gurus', re: /^\/gurus$/, load: loadGurus, cache: 'day' },
  { kind: 'filers', re: /^\/filers(?:\/([a-z0-9]))?$/, params: (m) => ({ letter: m[1] || 'a' }), load: loadFilers, cache: 'day' },
  { kind: 'insider-signal', re: /^\/insiders\/(cluster|csuite|penny)$/, load: loadTeaserOnly, cache: 'hour' },
  { kind: 'reports', re: /^\/reports(?:\/(\d{4}-q[1-4]))?$/, params: (m) => ({ id: m[1] || null }), load: loadReports, cache: 'day' },
  { kind: 'calendar', re: /^\/calendar$/, load: loadCalendar, cache: () => (inFilingSeason() ? 'hour' : 'day') },
  { kind: 'filings', re: /^\/filings$/, load: loadFilings, cache: 'hour' },
  { kind: 'stock-screen', re: /^\/screen\/stocks$/, load: loadStockScreen, cache: 'hour' },
  { kind: 'emerging', re: /^\/emerging-managers$/, load: loadEmerging, cache: 'day' },
  { kind: 'rankings', re: /^\/rankings\/(most-bought|most-sold|consensus|conviction|options)$/, load: loadRankings, cache: 'hour' },
  { kind: 'stock', re: /^\/stock\/([A-Za-z0-9.\-]{1,12})$/, params: (m, qs) => ({ ticker: m[1].toUpperCase(), cusip: qs.get('cusip') }), load: loadStock, cache: 'day' },
  { kind: 'consensus', re: /^\/consensus(?:\/(bought|sold|new|funds|universe))?$/, params: (m) => ({ segment: m[1] || 'held' }), load: loadConsensusPage, cache: 'hour' },
  { kind: 'insiders', re: /^\/insiders$/, load: loadTeaserOnly, cache: 'hour' },
  { kind: 'pricing', re: /^\/pricing$/, load: async () => [], cache: 'day' },
  { kind: 'report', re: /^\/report$/, load: loadReport, cache: 'hour' },
  { kind: 'screen', re: /^\/screen$/, load: async () => [], cache: 'hour' },
  { kind: 'compare', re: /^\/compare$/, load: async () => [], cache: 'hour' },
  { kind: 'watchlist', re: /^\/watchlist$/, load: async () => [], cache: 'none' },
  { kind: 'account', re: /^\/account$/, load: async () => [], cache: 'none' },
];

// static content: language-specific slugs; a slug from the other language
// 301s to the right one (handled in ssr.js via `redirect`)
function contentRoute(pathname, lang) {
  const hit = contentByPath(pathname);
  if (!hit) return null;
  return { route: { kind: 'content', load: async () => (hit.lang === lang ? [] : { redirect: hit.entry.paths[lang], status: 301 }), cache: 'day' }, params: {} };
}

export function matchRoute(pathname, search, lang = 'en') {
  const c = contentRoute(pathname, lang);
  if (c) return c;
  const qs = new URLSearchParams(search || '');
  for (const r of ROUTES) {
    const m = r.re.exec(pathname);
    if (m) return { route: r, params: r.params ? r.params(m, qs) : {} };
  }
  return null;
}
