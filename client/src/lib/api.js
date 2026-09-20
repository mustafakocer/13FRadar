let authToken = null;
export const setAuthToken = (t) => {
  authToken = t;
};

// A request that never answers used to leave the page on its spinner for as
// long as the browser cared to wait. Every call now carries a deadline; when
// it passes the fetch is aborted and the page gets an error it can show.
export const REQUEST_TIMEOUT_MS = 10000;

async function request(url, { method = 'GET', timeoutMs = REQUEST_TIMEOUT_MS } = {}) {
  const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), timeoutMs) : null;
  let r;
  try {
    r = await fetch(url, {
      method,
      headers: authToken ? { Authorization: `Bearer ${authToken}` } : {},
      ...(ctrl ? { signal: ctrl.signal } : {}),
    });
  } catch (e) {
    const timedOut = e?.name === 'AbortError';
    const err = new Error(timedOut ? `timeout after ${Math.round(timeoutMs / 1000)}s` : e?.message || 'network error');
    err.timeout = timedOut;
    err.status = 0;
    throw err;
  } finally {
    if (timer) clearTimeout(timer);
  }
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    const err = new Error(data.error || `HTTP ${r.status}`);
    err.status = r.status;
    throw err;
  }
  return data;
}

const get = (url, opts) => request(url, opts);
const post = (url, opts) => request(url, { ...opts, method: 'POST' });

export const api = {
  checkout: (cycle) => post(`/api/checkout?cycle=${cycle === 'y' ? 'y' : 'm'}`),
  portal: () => post('/api/portal'),
  search: (q) => get(`/api/search?q=${encodeURIComponent(q)}`),
  manager: (cik) => get(`/api/manager/${cik}`),
  holdings: (cik, acc, opts = {}) => {
    const qs = new URLSearchParams(opts).toString();
    return get(`/api/holdings/${cik}/${acc}${qs ? `?${qs}` : ''}`);
  },
  aumHistory: (cik) => get(`/api/aum-history/${cik}`),
  returns: (symbols) => get(`/api/returns?symbols=${symbols.join(',')}`),
  stock: (ticker) => get(`/api/stock/${encodeURIComponent(ticker)}`),
  chart: (ticker, range = '1y') =>
    get(`/api/chart/${encodeURIComponent(ticker)}?range=${range}`),
  sectors: (symbols) => get(`/api/sectors?symbols=${symbols.join(',')}`),
  positionHistory: (cik, cusip) =>
    get(`/api/position-history/${cik}/${encodeURIComponent(cusip)}`),
  consensus: () => get('/api/consensus'),
  insiders: (ticker) => get(`/api/insiders/${encodeURIComponent(ticker)}`),
  // the backtest reads price series for up to 150 names; it earns a longer leash
  backtest: (cik, opts = {}) => {
    const qs = new URLSearchParams(opts).toString();
    return get(`/api/backtest/${cik}${qs ? `?${qs}` : ''}`, { timeoutMs: 30000 });
  },
  universe: async () => {
    const r = await fetch('/universe.json');
    if (!r.ok) throw new Error('no-universe');
    return r.json();
  },
  stocksUniverse: async () => {
    const r = await fetch('/stocks.json');
    if (!r.ok) throw new Error('no-stocks-universe');
    return r.json();
  },
  stockOwnership: (cusip) => get(`/api/stock-ownership?cusip=${encodeURIComponent(cusip)}`, { timeoutMs: 30000 }),
  managerStats: (cik) => get(`/api/manager-stats/${cik}`),
  calendar: () => get('/api/calendar'),
  reports: () => get('/api/report'),
  related: (cik) => get(`/api/related/${cik}`),
  report: (id) => get(`/api/report-id/${encodeURIComponent(id)}`),
  emerging: () => get('/api/emerging'),
  guruHistory: (cik) => get(`/api/guru-history/${cik}`),
  guruStock: ({ ticker, cusip }) =>
    get(`/api/guru-stocks?${cusip ? `cusip=${encodeURIComponent(cusip)}` : `ticker=${encodeURIComponent(ticker)}`}`),
  guruStocks: ({ limit, sector, cap, minHolders, strongBuy } = {}) => {
    const qs = new URLSearchParams();
    if (limit) qs.set('limit', limit);
    if (sector) qs.set('sector', sector);
    if (cap) qs.set('cap', cap);
    if (minHolders) qs.set('minHolders', minHolders);
    if (strongBuy) qs.set('strongBuy', '1');
    const q = qs.toString();
    return get(`/api/guru-stocks${q ? `?${q}` : ''}`);
  },
  guruOptions: () => get('/api/guru-stocks?view=options'),
  guruTicker: (cik, ticker) => get(`/api/guru-history-ticker/${cik}/${encodeURIComponent(ticker)}`),
  slug: (slug) => get(`/api/slug-of/${encodeURIComponent(slug)}`),
  gurus: () => get('/api/slug?kind=guru'),
  filersByLetter: (letter) => get(`/api/slug?letter=${encodeURIComponent(letter)}`),
  insiderFeed: (params) => get(`/api/insider-feed?${new URLSearchParams(params).toString()}`),
};
