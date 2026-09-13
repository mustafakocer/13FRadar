import { requirePro } from '../_lib/auth.js';
import { invoke } from '../_lib/ssr/invoke.js';
import manager from './manager.js';
import holdings from './holdings.js';

// CSV export (Pro). Excel opens CSV natively; the client keeps its own
// SheetJS export for .xlsx.
//   GET /api/export/holdings/:cik            latest quarter (or ?acc=…)
const csvCell = (v) => {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const csv = (rows, cols) => [cols.map((c) => csvCell(c.h)).join(','), ...rows.map((r, i) => cols.map((c) => csvCell(c.v(r, i))).join(','))].join('\n');

export default async function handler(req, res) {
  if (!(await requirePro(req, res))) return;
  const kind = String(req.query.kind || '');
  const id = String(req.query.id || '');
  try {
    if (kind === 'holdings') {
      const cik = id.replace(/\D/g, '').padStart(10, '0');
      const m = await invoke(manager, { cik }, { authorization: req.headers.authorization });
      if (m.status !== 200) return res.status(m.status).json(m.body);
      const acc = String(req.query.acc || m.body.filings?.[0]?.acc || '');
      const f = m.body.filings.find((x) => x.acc === acc);
      const h = await invoke(holdings, { cik, acc, full: '1' }, { authorization: req.headers.authorization });
      if (h.status !== 200) return res.status(h.status).json(h.body);
      const body = csv(h.body.positions, [
        { h: '#', v: (_, i) => i + 1 },
        { h: 'Ticker', v: (r) => r.ticker || '' },
        { h: 'Company', v: (r) => r.issuer },
        { h: 'CUSIP', v: (r) => r.cusip },
        { h: 'Type', v: (r) => r.putCall || 'SH' },
        { h: 'Shares', v: (r) => r.shares },
        { h: 'Value USD', v: (r) => Math.round(r.value) },
        { h: 'Portfolio %', v: (r) => r.weight.toFixed(2) },
      ]);
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="13fradar-${cik}-${f?.reportDate || acc}.csv"`);
      res.setHeader('Cache-Control', 'private, no-store');
      return res.status(200).send(body);
    }
    return res.status(400).json({ error: 'kind must be holdings' });
  } catch (err) {
    res.status(502).json({ error: String(err.message || err) });
  }
}
