// SheetJS is ~430KB — loaded on demand via dynamic import (code-split).
export async function exportHoldingsToExcel(positions, returns, filename) {
  const XLSX = await import('xlsx');
  const rows = positions.map((p, i) => ({
    '#': i + 1,
    Ticker: p.ticker || '',
    Company: p.issuer,
    Type: p.putCall || 'SH',
    'Mkt Value ($)': Math.round(p.value),
    '% Port.': Number(p.weight.toFixed(2)),
    Shares: p.shares,
    '1Y Return %': returns?.[p.ticker]?.ret1y != null ? Number(returns[p.ticker].ret1y.toFixed(2)) : '',
    'YTD Return %': returns?.[p.ticker]?.retYtd != null ? Number(returns[p.ticker].retYtd.toFixed(2)) : '',
  }));
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Holdings');
  XLSX.writeFile(wb, filename);
}

// Generic sheet export: rows are plain objects; keys become the header row.
export async function exportRowsToExcel(rows, filename = 'export.xlsx', sheet = 'Data') {
  const XLSX = await import('xlsx');
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheet);
  XLSX.writeFile(wb, filename);
}
