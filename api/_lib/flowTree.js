// @ts-check
// Sector -> stock tree of net institutional flow for the heat map (P2-10).
// Input rows come from stocks.json (see universeAgg.js). Tile size = |flow|,
// colour = sign / intensity of the flow relative to the stock's total value.

/**
 * @param {{ cusip: string, ticker?: string|null, issuer: string, sector?: string|null, netFlow?: number|null, value?: number, funds?: number, adding?: number, reducing?: number, diffFunds?: number }[]} rows
 * @param {{ maxPerSector?: number, minAbsFlow?: number, metric?: 'net'|'in'|'out' }} [o]
 */
export function buildFlowTree(rows, o = {}) {
  const maxPerSector = o.maxPerSector ?? 25;
  const minAbsFlow = o.minAbsFlow ?? 0;
  const metric = o.metric || 'net';
  /** @type {Map<string, { name: string, flow: number, inflow: number, outflow: number, value: number, stocks: any[] }>} */
  const sectors = new Map();
  for (const r of rows) {
    if (!r.diffFunds || r.netFlow == null) continue;
    const flow = r.netFlow;
    if (metric === 'in' && flow <= 0) continue;
    if (metric === 'out' && flow >= 0) continue;
    if (Math.abs(flow) < minAbsFlow) continue;
    const key = r.sector || 'Other';
    const s = sectors.get(key) || { name: key, flow: 0, inflow: 0, outflow: 0, value: 0, stocks: [] };
    s.flow += flow;
    if (flow > 0) s.inflow += flow;
    else s.outflow += flow;
    s.value += r.value || 0;
    s.stocks.push({
      name: r.ticker || r.issuer,
      cusip: r.cusip,
      ticker: r.ticker || null,
      issuer: r.issuer,
      flow,
      size: Math.abs(flow),
      value: r.value || 0,
      intensity: r.value ? flow / r.value : 0, // flow as share of institutional value held
      funds: r.funds || 0,
      adding: r.adding || 0,
      reducing: r.reducing || 0,
    });
    sectors.set(key, s);
  }
  const children = [...sectors.values()]
    .map((s) => ({
      name: s.name,
      flow: Math.round(s.flow),
      inflow: Math.round(s.inflow),
      outflow: Math.round(s.outflow),
      value: Math.round(s.value),
      size: s.stocks.reduce((sum, st) => sum + st.size, 0),
      intensity: s.value ? s.flow / s.value : 0,
      count: s.stocks.length,
      children: s.stocks.sort((a, b) => b.size - a.size).slice(0, maxPerSector),
    }))
    .sort((a, b) => b.size - a.size);
  return { name: 'root', children, totalIn: children.reduce((s, c) => s + c.inflow, 0), totalOut: children.reduce((s, c) => s + c.outflow, 0) };
}
