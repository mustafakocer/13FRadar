import axios from 'axios';
import { cached, TTL } from './cache.js';
import { readSeries, mergeSeries, seriesAgeDays } from './priceStore.js';
import { noteCall, noteOk, noteFail, quotaState, shouldSkip } from './providerHealth.js';

// Keyed free data providers — the reliable path from datacenter IPs
// (Yahoo 429s Vercel; Stooq serves a JS-challenge page). FMP is out of every
// chain: its free plan answers 402 on the historical endpoints and spends
// its 250 calls a day on the quote board's first visitors.
//   TWELVEDATA_API_KEY  twelvedata.com             (free: 800 req/day)
//   FINNHUB_API_KEY     finnhub.io                 (free: 60 req/min, no daily cap)
// Short sockets on Vercel: the stock handler answers from cache after a
// fixed budget and these calls only warm it (see _handlers/stock.js).
const http = axios.create({
  timeout: Number(process.env.PROVIDER_TIMEOUT_MS) || (process.env.VERCEL ? 4000 : 15000),
  validateStatus: () => true,
});

const TD = 'https://api.twelvedata.com';
const FINNHUB = 'https://finnhub.io/api/v1';

export const hasTd = () => !!process.env.TWELVEDATA_API_KEY;
export const hasFinnhub = () => !!process.env.FINNHUB_API_KEY;

export async function tdGet(path, params = {}) {
  const key = process.env.TWELVEDATA_API_KEY;
  if (!key) throw new Error('TWELVEDATA_API_KEY not set');
  const r = await http.get(`${TD}${path}`, { params: { ...params, apikey: key } });
  if (r.status !== 200 || r.data?.status === 'error') {
    throw new Error(`TwelveData: ${r.data?.message || `HTTP ${r.status}`}`);
  }
  return r.data;
}

// Daily close series [{date, close}] ascending, or null when nothing can
// price the symbol. The nightly cache first (api/_data/prices, ten years,
// see priceStore.js): a series whose last close is recent enough answers on
// its own; an older one is extended from a live provider (only the days
// since its last close) and answers as it is when none can; a symbol no
// build has priced goes to the live providers for the whole history. Live
// means TwelveData, through the same quota and breaker bookkeeping the
// quote board uses, so a build night's calls and a
// page's calls draw on one count. Yahoo and Stooq are not asked (see
// _handlers/stock.js). Cached 12h per instance; a null answer is not
// cached, so an outage does not pin a symbol empty for the day.
export const CLOSES_FRESH_DAYS = Number(process.env.CLOSES_FRESH_DAYS) || 4;

const LIVE = [
  {
    name: 'twelvedata',
    has: hasTd,
    run: async (symbol, from) => {
      const d = await tdGet('/time_series', { symbol, interval: '1day', outputsize: 5000, order: 'ASC', ...(from ? { start_date: from } : {}) });
      return (d?.values || [])
        .map((v) => ({ date: String(v.datetime).slice(0, 10), close: Number(v.close) }))
        .filter((v) => Number.isFinite(v.close));
    },
  },
];

async function liveCloses(symbol, from) {
  for (const p of LIVE) {
    if (!p.has() || shouldSkip(p.name) || quotaState(p.name).exhausted) continue;
    const t0 = Date.now();
    noteCall(p.name, t0);
    try {
      const rows = await p.run(symbol, from);
      if (rows.length) {
        noteOk(p.name, Date.now() - t0);
        return rows;
      }
      noteFail(p.name, new Error('empty'), Date.now() - t0);
    } catch (e) {
      noteFail(p.name, e, Date.now() - t0);
    }
  }
  return null;
}

class NoSeries extends Error {}

export async function dailyCloses(symbol) {
  try {
    return await cached(`closes:${symbol}`, TTL.HOUR_6 * 2, async () => {
      const stored = readSeries(symbol);
      if (stored && seriesAgeDays(stored.asOf) <= CLOSES_FRESH_DAYS) return stored.prices;
      const live = await liveCloses(symbol, stored?.asOf || null);
      if (live?.length) return stored ? mergeSeries(stored.prices, live) : live;
      if (stored) return stored.prices;
      throw new NoSeries(`no close series for ${symbol}`);
    });
  } catch (e) {
    if (e instanceof NoSeries) return null;
    throw e;
  }
}

const num = (x) => {
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
};

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

// Finnhub's quote: { c: current, d: change, dp: change %, h, l, o, pc: previous
// close, t: unix seconds }. A symbol it does not know answers all zeros with
// a 200, which is why a zero price is "not found" here. Pure over the
// parsed body so the shape is testable.
export function shapeFinnhub(symbol, q) {
  const price = num(q?.c);
  if (!q || price == null || price <= 0) throw new Error('Finnhub: symbol not found');
  return {
    source: 'finnhub',
    price: {
      symbol,
      name: symbol,
      currency: 'USD',
      price,
      change: num(q.d),
      changePercent: num(q.dp),
      open: num(q.o),
      high: num(q.h),
      low: num(q.l),
      prevClose: num(q.pc),
      volume: null,
      marketCap: null,
      high52: null,
      low52: null,
    },
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
}

// Basic price snapshot from Finnhub (1 call). 429 is a per-minute limit.
export async function finnhubStock(symbol) {
  const key = process.env.FINNHUB_API_KEY;
  if (!key) throw new Error('FINNHUB_API_KEY not set');
  const r = await http.get(`${FINNHUB}/quote`, { params: { symbol, token: key } });
  if (r.status === 429) throw new Error('Finnhub: rate limit (HTTP 429)');
  if (r.status !== 200) throw new Error(`Finnhub HTTP ${r.status}`);
  if (r.data?.error) throw new Error(`Finnhub: ${r.data.error}`);
  return shapeFinnhub(symbol, r.data);
}
