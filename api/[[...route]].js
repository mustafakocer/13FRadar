// Single catch-all serverless function for the whole API.
// Vercel's Hobby plan caps deployments at 12 functions; routing everything
// through one function avoids the limit and shares the in-memory cache
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
import filings13dg from './_handlers/filings13dg.js';

// [handler, ...param names bound to path segments after the endpoint name]
const ROUTES = {
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
  filings13dg: [filings13dg, 'ticker'],
  holdings: [holdings, 'cik', 'acc'],
  'position-history': [positionHistory, 'cik', 'cusip'],
};

export default async function handler(req, res) {
  const route = [].concat(req.query.route || []).filter(Boolean);
  delete req.query.route;

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
