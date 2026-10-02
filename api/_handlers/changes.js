import { filingChanges } from '../_lib/holdingsChanges.js';
import { trimChanges } from '../../client/src/lib/portfolioChanges.js';
import { mapCusipsToTickers } from '../_lib/figi.js';
import { isPro, noStore } from '../_lib/auth.js';

// GET /api/changes/:cik/:acc?full=1
// What the filing bought and sold against the filing before it
// (_lib/holdingsChanges.js). The guru page's FAQ and its Changes tab both
// read this one answer. Free: the true counts and the five largest lines of
// each list; Pro (full=1 with a Pro token): every line.
const FREE_LINES = 5;
const ACC_RE = /^\d{10}-\d{2}-\d{6}$/;

export default async function handler(req, res) {
  const cik = String(req.query.cik || '').replace(/\D/g, '');
  const acc = String(req.query.acc || '');
  if (!cik || cik.length > 10 || !ACC_RE.test(acc)) return res.status(400).json({ error: 'Invalid cik/acc' });
  const wantFull = req.query.full === '1';
  try {
    const ch = await filingChanges(cik, acc);
    if (!ch) {
      res.setHeader('Cache-Control', 's-maxage=21600, stale-while-revalidate=604800');
      return res.status(200).json({ cik, acc, available: false });
    }
    const pro = wantFull ? await isPro(req) : false;
    const out = pro ? ch : trimChanges(ch, FREE_LINES);
    // tickers for lines the history or the filing left without one
    const lines = [...out.new, ...out.added, ...out.reduced, ...out.exited];
    const missing = lines.filter((p) => !p.ticker).map((p) => p.cusip);
    if (missing.length) {
      const t = await mapCusipsToTickers([...new Set(missing)].slice(0, 250), { maxLive: 0 }).catch(() => ({}));
      for (const p of lines) if (!p.ticker && t[p.cusip]) p.ticker = t[p.cusip];
    }
    if (wantFull) noStore(res);
    else res.setHeader('Cache-Control', 's-maxage=21600, stale-while-revalidate=604800');
    return res.status(200).json({ cik, acc, available: true, ...out });
  } catch (err) {
    return res.status(502).json({ error: String(err.message || err) });
  }
}
