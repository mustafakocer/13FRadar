import axios from 'axios';
import { cached, TTL } from './cache.js';
import { stooqDaily } from './stooq.js';

// Keyed free data providers — the reliable path from datacenter IPs
// (Yahoo 429s Vercel; Stooq serves a JS-challenge page).
//   FMP_API_KEY         financialmodelingprep.com  (free: 250 req/day)
//   TWELVEDATA_API_KEY  twelvedata.com             (free: 800 req/day)
const http = axios.create({ timeout: 15000, validateStatus: () => true });

const FMP_V3 = 'https://financialmodelingprep.com/api/v3';
const FMP_STABLE = 'https://financialmodelingprep.com/stable';
const TD = 'https://api.twelvedata.com';

export const hasFmp = () => !!process.env.FMP_API_KEY;
export const hasTd = () => !!process.env.TWELVEDATA_API_KEY;

async function fmpRaw(url, params) {
  const key = process.env.FMP_API_KEY;
  if (!key) throw new Error('FMP_API_KEY not set');
  const r = await http.get(url, { params: { ...params, apikey: key } });
  if (r.status !== 200) throw new Error(`FMP HTTP ${r.status}`);
  if (r.data?.['Error Message']) throw new Error(r.data['Error Message']);
  if (Array.isArray(r.data) && r.data.length === 0) throw new Error('FMP empty result');
  return r.data;
}

// New FMP accounts only get the "stable" API; legacy keys still use v3.
// Try stable (?symbol=) first, then the legacy v3 path-style endpoint.
export async function fmpGet(stablePath, symbol, v3Path, extra = {}) {
  try {
    return await fmpRaw(`${FMP_STABLE}${stablePath}`, { symbol, ...extra });
  } catch {
    return fmpRaw(`${FMP_V3}${v3Path}/${encodeURIComponent(symbol)}`, extra);
  }
}

export async function tdGet(path, params = {}) {
  const key = process.env.TWELVEDATA_API_KEY;
  if (!key) throw new Error('TWELVEDATA_API_KEY not set');
  const r = await http.get(`${TD}${path}`, { params: { ...params, apikey: key } });
  if (r.status !== 200 || r.data?.status === 'error') {
    throw new Error(`TwelveData: ${r.data?.message || `HTTP ${r.status}`}`);
  }
  return r.data;
}

// Daily close series [{date, close}] ascending — provider chain, cached 12h.
export function dailyCloses(symbol) {
  return cached(`closes:${symbol}`, TTL.HOUR_6 * 2, async () => {
    if (hasFmp()) {
      try {
        const d = await fmpGet('/historical-price-eod/light', symbol, '/historical-price-full', {
          serietype: 'line',
          timeseries: 1400,
        });
        // stable: [{date, price}] newest-first · v3: {historical: [{date, close}]}
        const hist = Array.isArray(d) ? d : d?.historical || [];
        if (hist.length) {
          return hist
            .map((h) => ({ date: h.date, close: h.close ?? h.price }))
            .filter((h) => Number.isFinite(h.close))
            .reverse();
        }
      } catch {
        /* try next provider */
      }
    }
    if (hasTd()) {
      try {
        const d = await tdGet('/time_series', {
          symbol,
          interval: '1day',
          outputsize: 1400,
        });
        const vals = d?.values || [];
        if (vals.length) {
          return vals
            .map((v) => ({ date: v.datetime.slice(0, 10), close: Number(v.close) }))
            .filter((v) => Number.isFinite(v.close))
            .reverse();
        }
      } catch {
        /* try next provider */
      }
    }
    return stooqDaily(symbol);
  });
}

const num = (x) => {
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
};

// Full stock snapshot from FMP: quote + profile + TTM ratios (3 calls, cached upstream).
export async function fmpStock(symbol) {
  const [quoteArr, profileArr, ratiosArr, kmArr] = await Promise.all([
    fmpGet('/quote', symbol, '/quote'),
    fmpGet('/profile', symbol, '/profile').catch(() => []),
    fmpGet('/ratios-ttm', symbol, '/ratios-ttm').catch(() => []),
    fmpGet('/key-metrics-ttm', symbol, '/key-metrics-ttm').catch(() => []),
  ]);
  const q = quoteArr?.[0];
  if (!q) throw new Error('FMP: symbol not found');
  const p = profileArr?.[0] || {};
  const rt = ratiosArr?.[0] || {};
  const km = kmArr?.[0] || {};

  return {
    source: 'fmp',
    price: {
      symbol: q.symbol,
      name: q.name || p.companyName || q.symbol,
      currency: p.currency || 'USD',
      price: num(q.price),
      change: num(q.change),
      changePercent: num(q.changesPercentage) ?? num(q.changePercentage),
      open: num(q.open),
      high: num(q.dayHigh),
      low: num(q.dayLow),
      prevClose: num(q.previousClose),
      volume: num(q.volume),
      marketCap: num(q.marketCap),
      high52: num(q.yearHigh),
      low52: num(q.yearLow),
    },
    valuation: {
      // stable vs v3 use different TTM field names — tolerate both
      trailingPE:
        num(q.pe) ??
        num(rt.peRatioTTM) ??
        num(rt.priceToEarningsRatioTTM) ??
        num(km.peRatioTTM),
      forwardPE: null,
      peg: num(rt.pegRatioTTM) ?? num(rt.priceToEarningsGrowthRatioTTM),
      priceToSales: num(rt.priceToSalesRatioTTM),
      priceToBook: num(rt.priceToBookRatioTTM),
      evToEbitda: num(rt.enterpriseValueMultipleTTM) ?? num(km.evToEBITDATTM),
      evToRevenue: num(km.evToSalesTTM) ?? num(rt.evToSalesTTM),
      bookValue: num(km.bookValuePerShareTTM),
    },
    fundamentals: {
      eps: num(q.eps) ?? num(km.netIncomePerShareTTM),
      grossMargin: num(rt.grossProfitMarginTTM),
      operatingMargin: num(rt.operatingProfitMarginTTM),
      profitMargin: num(rt.netProfitMarginTTM),
      roe: num(rt.returnOnEquityTTM) ?? num(km.returnOnEquityTTM),
      roa: num(rt.returnOnAssetsTTM) ?? num(km.returnOnAssetsTTM),
      debtToEquity:
        num(rt.debtEquityRatioTTM) ??
        num(rt.debtToEquityRatioTTM) ??
        num(km.debtToEquityTTM),
      currentRatio: num(rt.currentRatioTTM) ?? num(km.currentRatioTTM),
      quickRatio: num(rt.quickRatioTTM),
      dividendYield: num(rt.dividendYielTTM) ?? num(rt.dividendYieldTTM),
      payoutRatio: num(rt.payoutRatioTTM) ?? num(rt.dividendPayoutRatioTTM),
      freeCashflow: null,
      revenue: null,
    },
    trading: {
      beta: num(p.beta),
      avgVolume: num(q.avgVolume),
      fiftyDayAvg: num(q.priceAvg50),
      twoHundredDayAvg: num(q.priceAvg200),
      sharesOutstanding: num(q.sharesOutstanding),
    },
    analyst: {},
    income: [],
    balance: [],
    cashflow: [],
    earnings: [],
    profile: {
      sector: p.sector || null,
      industry: p.industry || null,
      employees: num(p.fullTimeEmployees),
      website: p.website || null,
      summary: p.description || null,
      country: p.country || null,
    },
  };
}

// Basic price snapshot from Twelve Data (1 call).
export async function tdStock(symbol) {
  const q = await tdGet('/quote', { symbol });
  if (!q?.close) throw new Error('TwelveData: symbol not found');
  return {
    source: 'twelvedata',
    price: {
      symbol: q.symbol,
      name: q.name || q.symbol,
      currency: q.currency || 'USD',
      price: num(q.close),
      change: num(q.change),
      changePercent: num(q.percent_change),
      open: num(q.open),
      high: num(q.high),
      low: num(q.low),
      prevClose: num(q.previous_close),
      volume: num(q.volume),
      marketCap: null,
      high52: num(q.fifty_two_week?.high),
      low52: num(q.fifty_two_week?.low),
    },
    valuation: {},
    fundamentals: {},
    trading: { avgVolume: num(q.average_volume) },
    analyst: {},
    income: [],
    balance: [],
    cashflow: [],
    earnings: [],
    profile: {},
  };
}
