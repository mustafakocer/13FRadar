import { cached, TTL } from '../_lib/cache.js';
import { yahooQuoteSummary, yahooQuote, yahooChart, rv } from '../_lib/yahooClient.js';
import { stooqDaily } from '../_lib/stooq.js';
import { hasFmp, hasTd, fmpStock, tdStock } from '../_lib/providers.js';

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

export default async function handler(req, res) {
  const ticker = String(req.query.ticker || '').trim().toUpperCase();
  if (!ticker) return res.status(400).json({ error: 'Missing ticker' });

  try {
    const data = await cached(`stock:${ticker}`, TTL.MIN_5 * 2, async () => {
      try {
        const r = await yahooQuoteSummary(ticker, MODULES);
        return shapeFull(r);
      } catch {
        // Yahoo blocks datacenter IPs — keyed providers are the reliable path.
        if (hasFmp()) {
          try {
            return await fmpStock(ticker);
          } catch {
            /* next provider */
          }
        }
        try {
          const [q] = await yahooQuote([ticker]);
          if (q) return shapeQuoteFallback(q);
        } catch {
          /* next provider */
        }
        if (hasTd()) {
          try {
            return await tdStock(ticker);
          } catch {
            /* next provider */
          }
        }
        try {
          const chart = await yahooChart(ticker, { range: '5d' });
          if (chart?.meta) return shapeChartFallback(chart.meta);
        } catch {
          /* fall through to stooq */
        }
        const prices = await stooqDaily(ticker);
        return shapeStooqFallback(ticker, prices);
      }
    });
    res.setHeader('Cache-Control', 's-maxage=600, stale-while-revalidate=3600');
    res.status(200).json(data);
  } catch (err) {
    res.status(502).json({ error: String(err.message || err) });
  }
}
