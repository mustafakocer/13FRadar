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
};
