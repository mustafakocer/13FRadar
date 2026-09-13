// Single serverless function for the whole API. vercel.json rewrites
// /api/* here; the path is parsed from req.url. This keeps the deployment
// at one function (Hobby plan caps at 12) and shares the in-memory cache
// across all endpoints on a warm instance.
import search from './_handlers/search.js';
import returns from './_handlers/returns.js';
import sectors from './_handlers/sectors.js';
import holders from './_handlers/holders.js';
import consensus from './_handlers/consensus.js';
import stockOwnership from './_handlers/stock-ownership.js';
import manager from './_handlers/manager.js';
import aumHistory from './_handlers/aum-history.js';
import holdings from './_handlers/holdings.js';
import stock from './_handlers/stock.js';
import chart from './_handlers/chart.js';
import insiders from './_handlers/insiders.js';
import backtest from './_handlers/backtest.js';
import positionHistory from './_handlers/position-history.js';
import managerStats from './_handlers/manager-stats.js';
import diag from './_handlers/diag.js';
import stripeWebhook from './_handlers/stripe-webhook.js';
import checkout from './_handlers/checkout.js';
import portal from './_handlers/portal.js';
import insiderFeed from './_handlers/insider-feed.js';
import geo from './_handlers/geo.js';
import slug from './_handlers/slug.js';
import sitemap from './_handlers/sitemap.js';
import og from './_handlers/og.js';
import guruHistoryH from './_handlers/guru-history.js';
import exportH from './_handlers/export.js';
import calendar from './_handlers/calendar.js';
import emerging from './_handlers/emerging.js';
import report from './_handlers/report.js';
import related from './_handlers/related.js';

// [handler, ...param names bound to path segments after the endpoint name]
const ROUTES = {
  diag: [diag],
  'stripe-webhook': [stripeWebhook],
  checkout: [checkout],
  'insider-feed': [insiderFeed],
  portal: [portal],
  geo: [geo],
  slug: [slug],
  sitemap: [sitemap],
  og: [og],
  'guru-history': [guruHistoryH, 'cik'],
  'guru-history-ticker': [guruHistoryH, 'cik', 'ticker'],
  export: [exportH, 'kind', 'id'],
  calendar: [calendar],
  emerging: [emerging],
  report: [report],
  related: [related, 'cik'],
  'report-id': [report, 'id'],
  'slug-of': [slug, 'slug'],
  search: [search],
  returns: [returns],
  sectors: [sectors],
  holders: [holders],
  consensus: [consensus],
  'stock-ownership': [stockOwnership],
  manager: [manager, 'cik'],
  'aum-history': [aumHistory, 'cik'],
  stock: [stock, 'ticker'],
  chart: [chart, 'ticker'],
  insiders: [insiders, 'ticker'],
  backtest: [backtest, 'cik'],
  'manager-stats': [managerStats, 'cik'],
  holdings: [holdings, 'cik', 'acc'],
  'position-history': [positionHistory, 'cik', 'cusip'],
};

export default async function handler(req, res) {
  // Path arrives one of three ways:
  //  1. __path query param, injected by the vercel.json rewrite (production)
  //  2. req.query.route, injected by the dev server
  //  3. parsed from req.url as a last resort
  const raw = req.query.__path ?? req.query.route ?? null;
  let route = Array.isArray(raw)
    ? raw.filter(Boolean)
    : decodeURIComponent(String(raw || '')).split('/').filter(Boolean);
  if (!route.length) {
    const path = String(req.url || '').split('?')[0];
    route = path
      .replace(/^\/api\/?/, '')
      .split('/')
      .filter(Boolean)
      .map(decodeURIComponent);
  }
  delete req.query.route;
  delete req.query.__path;

  const def = ROUTES[route[0]];
  if (!def || route.length - 1 !== def.length - 1) {
    return res.status(404).json({ error: 'Not found' });
  }
  const [fn, ...params] = def;
  params.forEach((name, i) => {
    req.query[name] = route[i + 1];
  });
  return fn(req, res);
}
