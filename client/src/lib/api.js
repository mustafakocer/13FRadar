let authToken = null;
export const setAuthToken = (t) => {
  authToken = t;
};

async function get(url) {
  const r = await fetch(url, {
    headers: authToken ? { Authorization: `Bearer ${authToken}` } : {},
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    const err = new Error(data.error || `HTTP ${r.status}`);
    err.status = r.status;
    throw err;
  }
  return data;
}

async function post(url) {
  const r = await fetch(url, {
    method: 'POST',
    headers: authToken ? { Authorization: `Bearer ${authToken}` } : {},
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    const err = new Error(data.error || `HTTP ${r.status}`);
    err.status = r.status;
    throw err;
  }
  return data;
}

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
  holders: (q) => get(`/api/holders?q=${encodeURIComponent(q)}`),
  positionHistory: (cik, cusip) =>
    get(`/api/position-history/${cik}/${encodeURIComponent(cusip)}`),
  consensus: () => get('/api/consensus'),
  insiders: (ticker) => get(`/api/insiders/${encodeURIComponent(ticker)}`),
  backtest: (cik, opts = {}) => {
    const qs = new URLSearchParams(opts).toString();
    return get(`/api/backtest/${cik}${qs ? `?${qs}` : ''}`);
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
  stockOwnership: (cusip) => get(`/api/stock-ownership?cusip=${encodeURIComponent(cusip)}`),
  managerStats: (cik) => get(`/api/manager-stats/${cik}`),
  filings13dg: (ticker) => get(`/api/filings13dg/${encodeURIComponent(ticker)}`),
  guruHistory: (cik) => get(`/api/guru-history/${cik}`),
  guruTicker: (cik, ticker) => get(`/api/guru-history-ticker/${cik}/${encodeURIComponent(ticker)}`),
  slug: (slug) => get(`/api/slug-of/${encodeURIComponent(slug)}`),
  gurus: () => get('/api/slug?kind=guru'),
  filersByLetter: (letter) => get(`/api/slug?letter=${encodeURIComponent(letter)}`),
  insiderFeed: (params) => get(`/api/insider-feed?${new URLSearchParams(params).toString()}`),
};
