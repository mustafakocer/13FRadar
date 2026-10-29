// Stock lookup for the home search box, over /stocks.json rows
// ({ ticker, issuer, funds }): exact ticker, then ticker prefix, then (from
// three letters on) issuer name; ties go to the more widely held name.
export const TICKERISH = /^[A-Za-z][A-Za-z.\-]{0,6}$/;

export function matchStocks(rows, q, limit = 5) {
  const qu = q.trim().toUpperCase();
  if (!qu || !Array.isArray(rows)) return [];
  const scored = [];
  for (const r of rows) {
    if (!r?.ticker) continue;
    const tk = r.ticker.toUpperCase();
    const name = String(r.issuer || '').toUpperCase();
    const score = tk === qu ? 0 : tk.startsWith(qu) ? 1 : qu.length >= 3 && name.includes(qu) ? 2 : -1;
    if (score >= 0) scored.push({ score, funds: r.funds || 0, ticker: tk, issuer: r.issuer || '' });
  }
  scored.sort((a, b) => a.score - b.score || b.funds - a.funds);
  return scored.slice(0, limit);
}
