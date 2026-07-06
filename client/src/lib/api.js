async function get(url) {
  const r = await fetch(url);
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
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
};
