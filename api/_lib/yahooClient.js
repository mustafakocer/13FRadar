import axios from 'axios';

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

const http = axios.create({
  timeout: 15000,
  headers: { 'User-Agent': UA, Accept: 'application/json, text/plain, */*' },
  validateStatus: () => true,
});

let auth = { cookie: '', crumb: '', ts: 0 };
const AUTH_TTL = 30 * 60 * 1000;

async function getAuth(force = false) {
  if (!force && auth.crumb && Date.now() - auth.ts < AUTH_TTL) return auth;
  const r = await http.get('https://fc.yahoo.com/');
  const setCookie = r.headers['set-cookie'] || [];
  const cookie = setCookie.map((c) => c.split(';')[0]).join('; ');
  const c = await http.get('https://query2.finance.yahoo.com/v1/test/getcrumb', {
    headers: { 'User-Agent': UA, Cookie: cookie },
  });
  const crumb =
    typeof c.data === 'string' && c.data && !c.data.includes('<') ? c.data.trim() : '';
  auth = { cookie, crumb, ts: Date.now() };
  return auth;
}

async function authedGet(url, params = {}) {
  let a = await getAuth();
  let r = await http.get(url, {
    params: { ...params, crumb: a.crumb },
    headers: { 'User-Agent': UA, Cookie: a.cookie },
  });
  if ([401, 403, 429].includes(r.status)) {
    a = await getAuth(true);
    r = await http.get(url, {
      params: { ...params, crumb: a.crumb },
      headers: { 'User-Agent': UA, Cookie: a.cookie },
    });
  }
  if (r.status !== 200) {
    const msg = r.data?.finance?.error?.description || r.data?.error || `HTTP ${r.status}`;
    throw new Error(`Yahoo request failed: ${msg}`);
  }
  return r.data;
}

// Unwrap Yahoo's {raw, fmt} value objects into plain numbers.
export const rv = (x) =>
  x == null ? null : typeof x === 'object' ? (x.raw ?? null) : typeof x === 'number' ? x : null;

export async function yahooQuoteSummary(symbol, modules) {
  const data = await authedGet(
    `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(symbol)}`,
    { modules: modules.join(','), formatted: 'false' }
  );
  const result = data?.quoteSummary?.result?.[0];
  if (!result) throw new Error(data?.quoteSummary?.error?.description || 'No data');
  return result;
}

export async function yahooQuote(symbols) {
  const data = await authedGet('https://query1.finance.yahoo.com/v7/finance/quote', {
    symbols: symbols.join(','),
  });
  return data?.quoteResponse?.result || [];
}

export async function yahooChart(symbol, params = {}) {
  const a = await getAuth();
  const r = await http.get(
    `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}`,
    {
      params: { interval: '1d', ...params },
      headers: { 'User-Agent': UA, Cookie: a.cookie },
    }
  );
  if (r.status !== 200) throw new Error(`Yahoo chart failed: HTTP ${r.status}`);
  const result = r.data?.chart?.result?.[0];
  if (!result) throw new Error(r.data?.chart?.error?.description || 'No chart data');
  return result;
}

// Daily close series as [{date: 'YYYY-MM-DD', close}] using regular closes
// (not adjclose) so values match Yahoo/Google Finance quote pages.
export async function yahooChartPrices(symbol, period1, period2) {
  const result = await yahooChart(symbol, {
    period1: Math.floor(period1),
    period2: Math.floor(period2),
    interval: '1d',
  });
  const ts = result.timestamp || [];
  const closes = result.indicators?.quote?.[0]?.close || [];
  const out = [];
  for (let i = 0; i < ts.length; i++) {
    if (closes[i] == null) continue;
    out.push({ date: new Date(ts[i] * 1000).toISOString().slice(0, 10), close: closes[i] });
  }
  return { prices: out, meta: result.meta || {} };
}

// 1Y / YTD / 1D returns for a single symbol from one chart request.
export async function yahooChartReturns(symbol) {
  const now = Math.floor(Date.now() / 1000);
  const { prices, meta } = await yahooChartPrices(symbol, now - 400 * 86400, now);
  if (!prices.length) return { symbol, ret1y: null, retYtd: null, ret1d: null, price: null };
  const last = prices[prices.length - 1];
  const price = meta.regularMarketPrice ?? last.close;

  const yearAgo = new Date(Date.now() - 365 * 86400 * 1000).toISOString().slice(0, 10);
  const base1y = prices.find((p) => p.date >= yearAgo) || prices[0];

  const jan1 = `${new Date().getUTCFullYear()}-01-01`;
  const prevYearCloses = prices.filter((p) => p.date < jan1);
  const baseYtd = prevYearCloses.length ? prevYearCloses[prevYearCloses.length - 1] : null;

  const prevClose =
    meta.previousClose ?? (prices.length > 1 ? prices[prices.length - 2].close : null);

  return {
    symbol,
    price,
    ret1y: base1y?.close ? ((price - base1y.close) / base1y.close) * 100 : null,
    retYtd: baseYtd?.close ? ((price - baseYtd.close) / baseYtd.close) * 100 : null,
    ret1d: prevClose ? ((price - prevClose) / prevClose) * 100 : null,
  };
}

export async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      try {
        out[idx] = await fn(items[idx], idx);
      } catch {
        out[idx] = null;
      }
    }
  });
  await Promise.all(workers);
  return out;
}
