import { guruForm4Rows, byTicker, foldDays, filerName } from '../_lib/guruForm4.js';
import { readServed } from '../_lib/insiderStore.js';
import { companyName } from '../_lib/companyNames.js';
import { CODES } from '../_lib/insiderModel.js';

// GET /api/guru-form4/:cik — the Form 4 lines this 13F filer reported as a
// 10% owner (or officer/director) of a company it holds: dated, priced,
// mid-quarter trades that the quarterly table cannot show. Public: the
// lines are already on the stock and insider pages; this is the same data
// keyed by the fund. Cached half a day, the dataset refreshes twice a day.
//
// → { cik, name, lastFilingDay, count, rows: [...MAX_ROWS newest days], byTicker }
// `count` is lines as filed; `rows` folds a day's lots into one (foldDays).
const MAX_ROWS = 60;

export default function handler(req, res) {
  const cik = String(req.query.cik || '').replace(/\D/g, '').padStart(10, '0');
  if (!/^\d{10}$/.test(cik) || cik === '0000000000') return res.status(400).json({ error: 'Invalid cik' });
  const served = readServed();
  const rows = guruForm4Rows(cik, { rows: served.rows });
  res.setHeader('Cache-Control', 's-maxage=1800, stale-while-revalidate=43200');
  res.status(200).json({
    cik,
    name: filerName(cik),
    lastFilingDay: served.lastFilingDay || null,
    count: rows.length,
    rows: foldDays(rows).slice(0, MAX_ROWS).map((r) => ({
      t: r.t || null,
      ci: r.ci,
      company: r.t ? companyName(r.t)?.name || served.companies?.[r.t] || null : null,
      d: r.d,
      f: r.f,
      k: r.k,
      kind: CODES[r.k] || 'other',
      s: r.s,
      p: r.p ?? null,
      v: r.v ?? null,
      o: r.o ?? null,
      oc: r.oc ?? null,
      a: r.a,
      lines: r.lines,
      ...(r.fa ? { amended: true } : {}),
      ...(r.p5 ? { planned: true } : {}),
    })),
    byTicker: byTicker(rows),
  });
}
