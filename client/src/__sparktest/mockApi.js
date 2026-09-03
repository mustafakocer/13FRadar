export const setAuthToken = () => {};
const sectors = ['Technology', 'Healthcare', 'Financials', 'Energy', 'Industrials', 'Consumer Discretionary'];
const rows = Array.from({ length: 120 }, (_, i) => ({ cusip: `C${i}`, ticker: `T${i}`, issuer: `Company ${i}`, sector: sectors[i % sectors.length], netFlow: (i % 3 === 0 ? -1 : 1) * (5e6 + (i * 7919) % 900e6), value: 1e9 + i * 3e8, funds: 50 + i, adding: 10 + (i % 7), reducing: 5 + (i % 5), diffFunds: 40 }));
export const api = { stocksUniverse: async () => ({ period: '2026-06-30', prevPeriod: '2026-03-31', rows }), stocksPrev: async () => null };
