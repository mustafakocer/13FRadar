import { cached, TTL } from '../_lib/cache.js';
import { yahooQuoteSummary, yahooQuote, rv } from '../_lib/yahooClient.js';

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

  return {
    source: 'quoteSummary',
    price: {
      symbol: p.symbol,
      name: p.longName || p.shortName,
      currency: p.currency,
      price: rv(p.regularMarketPrice),
      change: rv(p.regularMarketChange),
      changePercent: rv(p.regularMarketChangePercent) * 100 || rv(p.regularMarketChangePercent),
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
    },
    fundamentals: {
      revenue: rv(fd.totalRevenue),
      revenueGrowth: rv(fd.revenueGrowth),
      grossMargin: rv(fd.grossMargins),
      operatingMargin: rv(fd.operatingMargins),
      profitMargin: rv(fd.profitMargins),
      roe: rv(fd.returnOnEquity),
      roa: rv(fd.returnOnAssets),
      debtToEquity: rv(fd.debtToEquity),
      freeCashflow: rv(fd.freeCashflow),
      dividendYield: rv(sd.dividendYield),
      dividendRate: rv(sd.dividendRate),
      payoutRatio: rv(sd.payoutRatio),
      beta: rv(sd.beta),
      shortRatio: rv(ks.shortRatio),
      eps: rv(ks.trailingEps),
      forwardEps: rv(ks.forwardEps),
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

function shapeQuoteFallback(q) {
  return {
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
    income: [],
    balance: [],
    cashflow: [],
    earnings: [],
    profile: {},
  };
}

export default async function handler(req, res) {
  const ticker = String(req.query.ticker || '').trim().toUpperCase();
  if (!ticker) return res.status(400).json({ error: 'Missing ticker' });

  try {
    const data = await cached(`stock:${ticker}`, TTL.MIN_5, async () => {
      try {
        const r = await yahooQuoteSummary(ticker, MODULES);
        return shapeFull(r);
      } catch {
        const [q] = await yahooQuote([ticker]);
        if (!q) throw new Error('Symbol not found');
        return shapeQuoteFallback(q);
      }
    });
    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=1800');
    res.status(200).json(data);
  } catch (err) {
    res.status(502).json({ error: String(err.message || err) });
  }
}
