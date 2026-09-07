import { getHoldings, getSubmissions, list13F } from '../_lib/sec.js';
import { mapCusipsToTickers } from '../_lib/figi.js';
import { isPro, noStore } from '../_lib/auth.js';

// GET /api/holdings/:cik/:acc?light=1&full=1&cusips=A,B,C
//   light=1   skip CUSIP->ticker resolution (comparisons / previous quarter)
//   full=1    Pro clients ask for the whole portfolio; the response is then
//             private (never CDN-cached) and complete only if the bearer token
//             belongs to a Pro user
//   cusips=   free clients may ask for up to 10 specific CUSIPs (used to
//             compute quarter-over-quarter changes for the visible top 10)
//
// Free tier: the top FREE_ROWS positions plus the true totals (aum, count).
// Everything below that line is Pro data and never leaves the server.
const FREE_ROWS = 10;
const ACC_RE = /^\d{10}-\d{2}-\d{6}$/;

export default async function handler(req, res) {
  const cik = String(req.query.cik || '').replace(/\D/g, '');
  const acc = String(req.query.acc || '');
  const light = req.query.light === '1';
  const wantFull = req.query.full === '1';
  const cusipFilter = String(req.query.cusips || '')
    .split(',')
    .map((s) => s.trim().toUpperCase())
    .filter((s) => /^[A-Z0-9]{8,9}$/.test(s))
    .slice(0, FREE_ROWS);
  if (!cik || cik.length > 10 || !ACC_RE.test(acc)) {
    return res.status(400).json({ error: 'Invalid cik/acc' });
  }

  try {
    // The filing date decides the ×1000 rule, so it is derived from EDGAR,
    // never taken from the client (a wrong value would poison the cache).
    const { aum, positions } = await getHoldings(cik, acc, null);

    let meta = { filingDate: null, reportDate: null };
    try {
      const f = list13F(await getSubmissions(cik)).find((x) => x.acc === acc);
      if (f) meta = { filingDate: f.filingDate, reportDate: f.reportDate };
    } catch {
      /* non-fatal */
    }

    const pro = wantFull ? await isPro(req) : false;
    let out = positions;
    let locked = false;
    if (!pro) {
      out = cusipFilter.length
        ? positions.filter((p) => cusipFilter.includes(p.cusip))
        : positions.slice(0, FREE_ROWS);
      locked = positions.length > out.length;
    }

    let tickers = {};
    if (!light) {
      // Resolve tickers for the largest positions only (rate-limit friendly).
      tickers = await mapCusipsToTickers(out.slice(0, 250).map((p) => p.cusip));
    }

    if (wantFull) noStore(res);
    else res.setHeader('Cache-Control', 's-maxage=21600, stale-while-revalidate=604800');
    res.status(200).json({
      cik,
      acc,
      ...meta,
      aum,
      count: positions.length,
      locked,
      positions: out.map((p) => ({ ...p, ticker: tickers[p.cusip] ?? null })),
    });
  } catch (err) {
    res.status(502).json({ error: String(err.message || err) });
  }
}
