import { cached, TTL, remember, recall } from '../_lib/cache.js';
import { readFixture } from '../_lib/fixtures.js';
import { yahooQuoteSummary, yahooQuote, yahooChart, rv } from '../_lib/yahooClient.js';
import { stooqDaily } from '../_lib/stooq.js';
import { hasFmp, hasTd, fmpStock, tdStock } from '../_lib/providers.js';
import { priceSnapshot, priceUnavailable } from '../_lib/priceSnapshot.js';

// GET /api/stock/:ticker — the quote board of a stock page.
//
// This answer is cache-first and always 200. The live providers are asked,
// but they get a fixed wall-clock budget for the whole chain, and when it
// runs out the request is answered from the freshest of: the last live
// answer this instance saw (`remember`), the nightly price file (dated, with
// `priceStale: true`), or a payload whose price fields are all null. The
// provider chain keeps running after the response so the next request on a
// warm instance finds it in the cache.
//
// Why the budget exists: the chain below used to run to completion before
// answering. Each Yahoo call retried four times against a 15-second socket
// timeout (plus a cookie/crumb refresh), then FMP tried two API generations,
// then a second Yahoo endpoint, TwelveData, a third Yahoo endpoint and
// Stooq — sequentially. From a region Yahoo throttles that is a minute of
// wall clock against a 30-second function limit (the gateway's 502/504), and
// when every provider failed fast the handler itself answered 502. The page
// then had nothing to render and crashed on `price` of undefined.
//
// Ownership data (which funds hold the name) never comes through here: it is
// /api/guru-stocks, read from a committed file, so a quote outage cannot take
// the ownership block down with it.
const UPSTREAM_BUDGET_MS = Math.max(500, Number(process.env.STOCK_UPSTREAM_MS) || 3000);
// With a dated close on file the page has something true to show, so the
// live chain gets half the budget before the file answers and the chain
// finishes in the background; only a symbol nothing has ever priced waits
// the full budget for a live quote.
const SNAPSHOT_BUDGET_MS = Math.max(500, Number(process.env.STOCK_SNAPSHOT_MS) || Math.round(UPSTREAM_BUDGET_MS / 2));

const MODULES = [
  'price',
  'summaryDetail',
  'defaultKeyStatistics',
  'financialData',
  'assetProfile',
  'incomeStatementHistory',
  'balanceSheetHistory',
  'cashflowStatementHistory',
  'earningsHistory',
];

function shapeFull(r) {
  const p = r.price || {};
  const sd = r.summaryDetail || {};
  const ks = r.defaultKeyStatistics || {};
  const fd = r.financialData || {};
  const ap = r.assetProfile || {};

  const changePct = rv(p.regularMarketChangePercent);

  return {
    source: 'quoteSummary',
    price: {
      symbol: p.symbol,
      name: p.longName || p.shortName,
      currency: p.currency,
      price: rv(p.regularMarketPrice),
      change: rv(p.regularMarketChange),
      changePercent: changePct != null ? changePct * 100 : null,
      open: rv(p.regularMarketOpen),
      high: rv(p.regularMarketDayHigh),
      low: rv(p.regularMarketDayLow),
      prevClose: rv(p.regularMarketPreviousClose),
      volume: rv(p.regularMarketVolume),
      marketCap: rv(p.marketCap),
      high52: rv(sd.fiftyTwoWeekHigh),
      low52: rv(sd.fiftyTwoWeekLow),
    },
    valuation: {
      trailingPE: rv(sd.trailingPE),
      forwardPE: rv(sd.forwardPE) ?? rv(ks.forwardPE),
      peg: rv(ks.pegRatio),
      priceToSales: rv(sd.priceToSalesTrailing12Months),
      priceToBook: rv(ks.priceToBook),
      evToEbitda: rv(ks.enterpriseToEbitda),
      evToRevenue: rv(ks.enterpriseToRevenue),
      enterpriseValue: rv(ks.enterpriseValue),
      bookValue: rv(ks.bookValue),
    },
    fundamentals: {
      revenue: rv(fd.totalRevenue),
      revenueGrowth: rv(fd.revenueGrowth),
      earningsGrowth: rv(fd.earningsGrowth),
      grossMargin: rv(fd.grossMargins),
      operatingMargin: rv(fd.operatingMargins),
      profitMargin: rv(fd.profitMargins),
      ebitda: rv(fd.ebitda),
      roe: rv(fd.returnOnEquity),
      roa: rv(fd.returnOnAssets),
      debtToEquity: rv(fd.debtToEquity),
      currentRatio: rv(fd.currentRatio),
      quickRatio: rv(fd.quickRatio),
      totalCash: rv(fd.totalCash),
      totalDebt: rv(fd.totalDebt),
      freeCashflow: rv(fd.freeCashflow),
      operatingCashflow: rv(fd.operatingCashflow),
      dividendYield: rv(sd.dividendYield),
      dividendRate: rv(sd.dividendRate),
      payoutRatio: rv(sd.payoutRatio),
      eps: rv(ks.trailingEps),
      forwardEps: rv(ks.forwardEps),
    },
    trading: {
      beta: rv(sd.beta),
      avgVolume: rv(sd.averageVolume),
      fiftyDayAvg: rv(sd.fiftyDayAverage),
      twoHundredDayAvg: rv(sd.twoHundredDayAverage),
      week52Change: rv(ks['52WeekChange']),
      sharesOutstanding: rv(ks.sharesOutstanding),
      floatShares: rv(ks.floatShares),
      heldInsiders: rv(ks.heldPercentInsiders),
      heldInstitutions: rv(ks.heldPercentInstitutions),
      shortRatio: rv(ks.shortRatio),
      shortPercentFloat: rv(ks.shortPercentOfFloat),
    },
    analyst: {
      targetMean: rv(fd.targetMeanPrice),
      targetHigh: rv(fd.targetHighPrice),
      targetLow: rv(fd.targetLowPrice),
      recommendation: fd.recommendationKey || null,
      analysts: rv(fd.numberOfAnalystOpinions),
    },
    income: (r.incomeStatementHistory?.incomeStatementHistory || []).map((y) => ({
      endDate: rv(y.endDate) ? new Date(rv(y.endDate) * 1000).toISOString().slice(0, 10) : null,
      revenue: rv(y.totalRevenue),
      grossProfit: rv(y.grossProfit),
      operatingIncome: rv(y.operatingIncome),
      netIncome: rv(y.netIncome),
      ebit: rv(y.ebit),
    })),
    balance: (r.balanceSheetHistory?.balanceSheetStatements || []).map((y) => ({
      endDate: rv(y.endDate) ? new Date(rv(y.endDate) * 1000).toISOString().slice(0, 10) : null,
      totalAssets: rv(y.totalAssets),
      totalLiabilities: rv(y.totalLiab),
      equity: rv(y.totalStockholderEquity),
      cash: rv(y.cash),
      longTermDebt: rv(y.longTermDebt),
    })),
    cashflow: (r.cashflowStatementHistory?.cashflowStatements || []).map((y) => ({
      endDate: rv(y.endDate) ? new Date(rv(y.endDate) * 1000).toISOString().slice(0, 10) : null,
      operating: rv(y.totalCashFromOperatingActivities),
      investing: rv(y.totalCashflowsFromInvestingActivities),
      financing: rv(y.totalCashFromFinancingActivities),
      capex: rv(y.capitalExpenditures),
    })),
    earnings: (r.earningsHistory?.history || []).map((q) => ({
      quarter: rv(q.quarter) ? new Date(rv(q.quarter) * 1000).toISOString().slice(0, 10) : null,
      epsEstimate: rv(q.epsEstimate),
      epsActual: rv(q.epsActual),
      surprisePercent: rv(q.surprisePercent),
    })),
    profile: {
      sector: ap.sector || null,
      industry: ap.industry || null,
      employees: ap.fullTimeEmployees || null,
      website: ap.website || null,
      summary: ap.longBusinessSummary || null,
      city: ap.city || null,
      country: ap.country || null,
    },
  };
}

const EMPTY = {
  valuation: {},
  fundamentals: {},
  trading: {},
  analyst: {},
  income: [],
  balance: [],
  cashflow: [],
  earnings: [],
  profile: {},
};

function shapeQuoteFallback(q) {
  return {
    ...EMPTY,
    source: 'quote',
    price: {
      symbol: q.symbol,
      name: q.longName || q.shortName,
      currency: q.currency,
      price: q.regularMarketPrice ?? null,
      change: q.regularMarketChange ?? null,
      changePercent: q.regularMarketChangePercent ?? null,
      open: q.regularMarketOpen ?? null,
      high: q.regularMarketDayHigh ?? null,
      low: q.regularMarketDayLow ?? null,
      prevClose: q.regularMarketPreviousClose ?? null,
      volume: q.regularMarketVolume ?? null,
      marketCap: q.marketCap ?? null,
      high52: q.fiftyTwoWeekHigh ?? null,
      low52: q.fiftyTwoWeekLow ?? null,
    },
    valuation: { trailingPE: q.trailingPE ?? null, forwardPE: q.forwardPE ?? null },
    fundamentals: { eps: q.epsTrailingTwelveMonths ?? null },
    trading: { avgVolume: q.averageDailyVolume3Month ?? null },
  };
}

// Last-resort fallback: the v8 chart endpoint is the least rate-limited and
// its meta block carries enough for a basic price header.
function shapeChartFallback(meta) {
  const price = meta.regularMarketPrice ?? null;
  const prev = meta.chartPreviousClose ?? meta.previousClose ?? null;
  return {
    ...EMPTY,
    source: 'chart',
    price: {
      symbol: meta.symbol,
      name: meta.longName || meta.shortName || meta.symbol,
      currency: meta.currency,
      price,
      change: price != null && prev != null ? price - prev : null,
      changePercent: price != null && prev ? ((price - prev) / prev) * 100 : null,
      open: null,
      high: meta.regularMarketDayHigh ?? null,
      low: meta.regularMarketDayLow ?? null,
      prevClose: prev,
      volume: meta.regularMarketVolume ?? null,
      marketCap: null,
      high52: meta.fiftyTwoWeekHigh ?? null,
      low52: meta.fiftyTwoWeekLow ?? null,
    },
  };
}

// Absolute last resort: Stooq daily closes. Yahoo can block the entire
// serverless region; this keeps the page rendering with real price data.
function shapeStooqFallback(symbol, prices) {
  const last = prices[prices.length - 1];
  const prev = prices.length > 1 ? prices[prices.length - 2] : null;
  const year = prices.slice(-252);
  return {
    ...EMPTY,
    source: 'stooq',
    price: {
      symbol,
      name: symbol,
      currency: 'USD',
      price: last.close,
      change: prev ? last.close - prev.close : null,
      changePercent: prev ? ((last.close - prev.close) / prev.close) * 100 : null,
      open: null,
      high: null,
      low: null,
      prevClose: prev?.close ?? null,
      volume: null,
      marketCap: null,
      high52: Math.max(...year.map((p) => p.close)),
      low52: Math.min(...year.map((p) => p.close)),
    },
  };
}

// The provider chain, most complete answer first. Each step is timed so the
// log says which provider is slow, not just that the page was.
async function fromProviders(ticker, log) {
  const step = async (name, fn) => {
    const t0 = Date.now();
    try {
      const out = await fn();
      if (out) {
        log(`${name} ok in ${Date.now() - t0}ms`);
        return out;
      }
      log(`${name} empty in ${Date.now() - t0}ms`);
    } catch (e) {
      log(`${name} failed in ${Date.now() - t0}ms: ${String(e?.message || e).slice(0, 120)}`);
    }
    return null;
  };
  return (
    (await step('yahoo:quoteSummary', async () => shapeFull(await yahooQuoteSummary(ticker, MODULES)))) ||
    // Yahoo blocks datacenter IPs — keyed providers are the reliable path.
    (hasFmp() && (await step('fmp', () => fmpStock(ticker)))) ||
    (await step('yahoo:quote', async () => {
      const [q] = await yahooQuote([ticker]);
      return q ? shapeQuoteFallback(q) : null;
    })) ||
    (hasTd() && (await step('twelvedata', () => tdStock(ticker)))) ||
    (await step('yahoo:chart', async () => {
      const chart = await yahooChart(ticker, { range: '5d' });
      return chart?.meta ? shapeChartFallback(chart.meta) : null;
    })) ||
    (await step('stooq', async () => shapeStooqFallback(ticker, await stooqDaily(ticker)))) ||
    null
  );
}

// Live within the budget, else the freshest fallback: last live answer on
// this instance → nightly price file → all-null price block. Exported so the
// SSR loader and tests exercise the same decision the HTTP handler makes.
export async function stockPayload(ticker, { budgetMs = null, log = () => {} } = {}) {
  const key = `stock:${ticker}`;
  const started = Date.now();
  const snap = priceSnapshot(ticker);
  if (budgetMs == null) budgetMs = snap ? SNAPSHOT_BUDGET_MS : UPSTREAM_BUDGET_MS;
  // One in-flight chain per symbol per instance; a second request within the
  // TTL joins it rather than starting another round of provider calls.
  const live = cached(key, TTL.MIN_5 * 2, async () => {
    const data = await fromProviders(ticker, log);
    if (!data) throw new Error('no provider answered');
    remember(key, data);
    return data;
  });
  live.catch(() => {});
  let timer;
  const budget = new Promise((resolve) => {
    timer = setTimeout(() => resolve(undefined), budgetMs);
  });
  const data = await Promise.race([live.catch(() => null), budget]).finally(() => clearTimeout(timer));
  if (data) return { data, served: 'live', ms: Date.now() - started };
  const why = data === null ? 'every provider failed' : `budget of ${budgetMs}ms exceeded`;
  const stale = recall(key);
  if (stale) {
    log(`${why} → last live answer`);
    return { data: { ...stale, stale: true, priceStale: true }, served: 'stale', ms: Date.now() - started };
  }
  if (snap) {
    log(`${why} → nightly snapshot (${snap.priceAsOf})`);
    return { data: snap, served: 'snapshot', ms: Date.now() - started };
  }
  log(`${why} → no price`);
  return { data: priceUnavailable(ticker), served: 'none', ms: Date.now() - started };
}

export default async function handler(req, res) {
  const ticker = String(req.query.ticker || '').trim().toUpperCase();
  if (!ticker) return res.status(400).json({ error: 'Missing ticker' });
  const fx = readFixture(`stock/${ticker}.json`);
  if (fx) {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json(fx);
  }

  const log = (msg) => console.log(`stock ${ticker}: ${msg}`);
  const { data, served, ms } = await stockPayload(ticker, { log });
  log(`served ${served} in ${ms}ms`);
  // A fallback answer is kept only briefly at the CDN so the live one takes
  // over as soon as a provider answers.
  res.setHeader(
    'Cache-Control',
    served === 'live' ? 's-maxage=600, stale-while-revalidate=3600' : 's-maxage=60, stale-while-revalidate=600'
  );
  res.setHeader('X-Stock-Source', served);
  res.status(200).json(data);
}
