import axios from 'axios';

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

const HOSTS = ['https://query2.finance.yahoo.com', 'https://query1.finance.yahoo.com'];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const http = axios.create({
  timeout: 15000,
  headers: {
    'User-Agent': UA,
    Accept: 'application/json, text/plain, */*',
    'Accept-Language': 'en-US,en;q=0.9',
  },
  validateStatus: () => true,
});

let auth = { cookie: '', crumb: '', ts: 0 };
const AUTH_TTL = 30 * 60 * 1000;

const cookieFrom = (r) => (r.headers['set-cookie'] || []).map((c) => c.split(';')[0]).join('; ');

async function getAuth(force = false) {
  if (!force && auth.ts && Date.now() - auth.ts < AUTH_TTL) return auth;

  // Cookie: fc.yahoo.com is the cheap source; fall back to the full site.
  let cookie = '';
  try {
    const r = await http.get('https://fc.yahoo.com/');
    cookie = cookieFrom(r);
  } catch {
    /* ignore */
  }
  if (!cookie) {
    try {
      const r = await http.get('https://finance.yahoo.com/quote/AAPL', {
        headers: { 'User-Agent': UA, Accept: 'text/html' },
        maxRedirects: 3,
      });
      cookie = cookieFrom(r);
    } catch {
      /* ignore */
    }
  }

  let crumb = '';
  for (const host of HOSTS) {
    try {
      const c = await http.get(`${host}/v1/test/getcrumb`, {
        headers: { 'User-Agent': UA, ...(cookie ? { Cookie: cookie } : {}) },
      });
      if (c.status === 200 && typeof c.data === 'string' && c.data && !c.data.includes('<')) {
        crumb = c.data.trim();
        break;
      }
    } catch {
      /* try next host */
    }
  }

  auth = { cookie, crumb, ts: Date.now() };
  return auth;
}

// GET with host rotation + exponential backoff; refreshes cookie/crumb once
// when Yahoo starts rejecting (401/403/429 are common from datacenter IPs).
async function yahooGet(path, params = {}, { withCrumb = true } = {}) {
  let a = await getAuth();
  let lastErr = null;
  let refreshed = false;

  for (let attempt = 0; attempt < 4; attempt++) {
    const host = HOSTS[attempt % HOSTS.length];
    try {
      const r = await http.get(`${host}${path}`, {
        params: withCrumb && a.crumb ? { ...params, crumb: a.crumb } : params,
        headers: { 'User-Agent': UA, ...(a.cookie ? { Cookie: a.cookie } : {}) },
      });
      if (r.status === 200) return r.data;
      lastErr = new Error(
        r.data?.finance?.error?.description ||
          r.data?.quoteSummary?.error?.description ||
          `HTTP ${r.status}`
      );
      if ([401, 403, 429].includes(r.status) && !refreshed) {
        refreshed = true;
        a = await getAuth(true);
      }
    } catch (e) {
      lastErr = e;
    }
    await sleep(400 * (attempt + 1) + Math.random() * 300);
  }
  throw new Error(`Yahoo request failed: ${lastErr?.message || lastErr}`);
}

// Unwrap Yahoo's {raw, fmt} value objects into plain numbers.
export const rv = (x) =>
  x == null ? null : typeof x === 'object' ? (x.raw ?? null) : typeof x === 'number' ? x : null;

export async function yahooQuoteSummary(symbol, modules) {
  const data = await yahooGet(
    `/v10/finance/quoteSummary/${encodeURIComponent(symbol)}`,
    { modules: modules.join(','), formatted: 'false' }
  );
  const result = data?.quoteSummary?.result?.[0];
  if (!result) throw new Error(data?.quoteSummary?.error?.description || 'No data');
  return result;
}

export async function yahooQuote(symbols) {
  const data = await yahooGet('/v7/finance/quote', { symbols: symbols.join(',') });
  return data?.quoteResponse?.result || [];
}

export async function yahooChart(symbol, params = {}) {
  const data = await yahooGet(
    `/v8/finance/chart/${encodeURIComponent(symbol)}`,
    { interval: '1d', ...params },
    { withCrumb: false }
  );
  const result = data?.chart?.result?.[0];
  if (!result) throw new Error(data?.chart?.error?.description || 'No chart data');
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
