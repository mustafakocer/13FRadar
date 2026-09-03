let authToken = null;
export const setAuthToken = (t) => {
  authToken = t;
};

async function get(url, init = {}) {
  const headers = { ...(init.body ? { 'Content-Type': 'application/json' } : {}), ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}) };
  const r = await fetch(url, { ...init, headers, body: init.body ? JSON.stringify(init.body) : undefined });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    const err = new Error(data.error || `HTTP ${r.status}`);
    err.status = r.status;
    throw err;
  }
  return data;
}

export const api = {
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
  positionHistory: (cik, cusip, opts = {}) => {
    const qs = new URLSearchParams(opts).toString();
    return get(`/api/position-history/${cik}/${encodeURIComponent(cusip)}${qs ? `?${qs}` : ''}`);
  },
  holdingsHistory: (cik) => get(`/api/holdings-history/${cik}`),
  alerts: {
    list: () => get('/api/alerts'),
    add: (kind, key, label) => get('/api/alerts', { method: 'POST', body: { kind, key, label } }),
    remove: (kind, key) => get('/api/alerts', { method: 'DELETE', body: { kind, key } }),
  },
  watchlistStocks: {
    list: () => get('/api/watchlist-stocks'),
    add: (cusip, ticker, name) => get('/api/watchlist-stocks', { method: 'POST', body: { cusip, ticker, name } }),
    remove: (cusip) => get('/api/watchlist-stocks', { method: 'DELETE', body: { cusip } }),
  },
  groups: {
    list: () => get('/api/groups'),
    create: (name, weighting) => get('/api/groups', { method: 'POST', body: { action: 'create', name, weighting } }),
    rename: (id, patch) => get('/api/groups', { method: 'POST', body: { action: 'rename', id, ...patch } }),
    addMember: (id, cik, name) => get('/api/groups', { method: 'POST', body: { action: 'add', id, cik, name } }),
    removeMember: (id, cik) => get('/api/groups', { method: 'POST', body: { action: 'remove', id, cik } }),
    remove: (id) => get('/api/groups', { method: 'DELETE', body: { id } }),
  },
  groupPortfolio: (ciks, weighting) =>
    get(`/api/group-portfolio?ciks=${ciks.map(encodeURIComponent).join(',')}&weighting=${weighting}`),
  insidersFeed: async () => {
    const r = await fetch('/insiders.json');
    if (!r.ok) throw new Error('no-insiders-feed');
    return r.json();
  },
  stocksPrev: async () => {
    const r = await fetch('/stocks-prev.json');
    if (!r.ok) return null;
    return r.json();
  },
  overlap: (ciks) => get(`/api/overlap?ciks=${ciks.map(encodeURIComponent).join(',')}`),
  consensus: () => get('/api/consensus'),
  insiders: (ticker) => get(`/api/insiders/${encodeURIComponent(ticker)}`),
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
};
