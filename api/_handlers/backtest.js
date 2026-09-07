import { cached, TTL } from '../_lib/cache.js';
import { requirePro } from '../_lib/auth.js';
import { getSubmissions, list13F, getHoldings } from '../_lib/sec.js';
import { mapCusipsToTickers } from '../_lib/figi.js';
import { yahooChartPrices, mapLimit } from '../_lib/yahooClient.js';
import { dailyCloses } from '../_lib/providers.js';

const addDays = (dateStr, d) => {
  const t = new Date(dateStr + 'T00:00:00Z');
  t.setUTCDate(t.getUTCDate() + d);
  return t.toISOString().slice(0, 10);
};

// Copy-the-13F backtest (experimental): each quarter, buy the manager's top-N
// equity positions at their filed weights on reportDate+46d (when the filing
// is public) and hold until the next rebalance. Compared against SPY over the
// same windows. Positions without price data are dropped and weights
// renormalized; `coverage` reports how much of the portfolio was simulated.
export default async function handler(req, res) {
  if (!(await requirePro(req, res))) return;
  const cik = String(req.query.cik || '').replace(/\D/g, '');
  const quarters = Math.min(Number(req.query.quarters) || 8, 12);
  const topN = Math.min(Number(req.query.top) || 15, 25);
  if (!cik) return res.status(400).json({ error: 'Missing CIK' });

  try {
    const data = await cached(`backtest:${cik}:${quarters}:${topN}`, TTL.HOUR_6, async () => {
      const sub = await getSubmissions(cik);
      const filings = list13F(sub).slice(0, quarters + 1).reverse(); // oldest -> newest
      if (filings.length < 2) return { points: [], error: 'not-enough-filings' };

      const snaps = await mapLimit(filings, 4, async (f) => {
        const { positions } = await getHoldings(cik, f.acc, f.filingDate);
        return { f, top: positions.filter((p) => !p.putCall).slice(0, topN) };
      });
      const valid = snaps.filter(Boolean);

      const cusips = [...new Set(valid.flatMap((s) => s.top.map((p) => p.cusip)))].slice(0, 150);
      const tickers = await mapCusipsToTickers(cusips);
      const uniq = [...new Set(Object.values(tickers).filter(Boolean))];

      const t0 = new Date(valid[0].f.reportDate + 'T00:00:00Z').getTime() / 1000;
      const now = Date.now() / 1000;
      const startDate = valid[0].f.reportDate;
      const priceSeries = {};
      await mapLimit([...uniq, 'SPY'], 6, async (sym) => {
        priceSeries[sym] = await cached(`px:${sym}:${startDate}`, TTL.DAY_1, () =>
          yahooChartPrices(sym, t0, now)
            .then((r) => r.prices)
            .catch(() => dailyCloses(sym).then((all) => all.filter((p) => p.date >= startDate)))
        );
      });

      const priceAt = (sym, date) => {
        const arr = priceSeries[sym];
        if (!arr?.length) return null;
        for (const p of arr) if (p.date >= date) return p.close;
        return null;
      };

      let nav = 1;
      let spyNav = 1;
      const start0 = addDays(valid[0].f.reportDate, 46);
      const points = [{ date: start0, port: 1, spy: 1 }];
      const coverages = [];
      const today = new Date().toISOString().slice(0, 10);

      for (let i = 0; i < valid.length; i++) {
        const start = addDays(valid[i].f.reportDate, 46);
        const end = i + 1 < valid.length ? addDays(valid[i + 1].f.reportDate, 46) : today;
        if (start >= end || start > today) break;

        let wSum = 0;
        let ret = 0;
        let totalW = 0;
        for (const p of valid[i].top) {
          totalW += p.weight;
          const sym = tickers[p.cusip];
          if (!sym) continue;
          const p0 = priceAt(sym, start);
          const p1 = priceAt(sym, end);
          if (!p0 || !p1) continue;
          wSum += p.weight;
          ret += p.weight * (p1 / p0 - 1);
        }
        if (wSum <= 0) continue;
        coverages.push(totalW ? wSum / totalW : 0);
        nav *= 1 + ret / wSum;

        const s0 = priceAt('SPY', start);
        const s1 = priceAt('SPY', end);
        if (s0 && s1) spyNav *= s1 / s0;
        points.push({ date: end, port: Number(nav.toFixed(4)), spy: Number(spyNav.toFixed(4)) });
      }

      return {
        points,
        totalPort: (nav - 1) * 100,
        totalSpy: (spyNav - 1) * 100,
        coverage: coverages.length
          ? (coverages.reduce((s, c) => s + c, 0) / coverages.length) * 100
          : null,
        topN,
        quarters: points.length - 1,
      };
    });
    res.status(200).json(data);
  } catch (err) {
    res.status(502).json({ error: String(err.message || err) });
  }
}
