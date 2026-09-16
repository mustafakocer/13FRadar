// GET /api/guru-stocks                        → the whole ranked table (screener)
// GET /api/guru-stocks?ticker=AAPL            → one security, with its holders
// GET /api/guru-stocks?cusip=037833100        → same, when no ticker resolved
// GET /api/guru-stocks?view=options           → PUT/CALL ownership, biggest first
//
// The summary of a security — how many curated funds hold it, its rank, what
// the quarter did to it — is free: it is the answer the page exists to give,
// and it is what an assistant quoting us needs. The holder list past the first
// few names is Pro, in line with the ten free rows on a portfolio.
import { isPro, noStore } from '../_lib/auth.js';
import { guruStockTable, guruStock, guruOptions, byConviction, byValue } from '../_lib/guruStocks.js';

const FREE_HOLDERS = 5;
// Enough for the screener's first page loads; the table is ranked, so the tail
// is the long list of names a single fund holds.
const LIST_LIMIT = 500;

const summarise = (s) => ({
  cusip: s.cusip,
  ticker: s.ticker,
  issuer: s.issuer,
  rank: s.rank,
  holderCount: s.holderCount,
  totalValue: s.totalValue,
  totalShares: s.totalShares,
  avgWeight: s.avgWeight,
  maxWeight: s.maxWeight,
  buyValue: s.buyValue,
  sellValue: s.sellValue,
  netValue: s.netValue,
  buyers: s.buyers,
  sellers: s.sellers,
  newBuyers: s.newBuyers,
  adders: s.adders,
  reducers: s.reducers,
  exiters: s.exiters,
});

export default async function handler(req, res) {
  const table = guruStockTable();
  if (!table) {
    // The daily Action has not written the file yet. Say so plainly instead of
    // 404-ing: the caller renders the rest of the page either way.
    res.setHeader('Cache-Control', 's-maxage=300');
    return res.status(200).json({ available: false, stocks: [], options: [] });
  }

  const meta = {
    available: true,
    updatedAt: table.updatedAt,
    managers: table.managers?.length ?? 0,
    reportDate: (table.managers || []).reduce((m, x) => (x.reportDate > m ? x.reportDate : m), ''),
    universe: table.stocks.length,
  };

  const { ticker, cusip, view } = req.query;
  const pro = await isPro(req);

  if (view === 'options') {
    const rows = guruOptions({ ticker, cusip });
    const all = ticker || cusip ? rows : table.options.slice(0, LIST_LIMIT);
    res.setHeader('Cache-Control', 's-maxage=86400, stale-while-revalidate=604800');
    return res.status(200).json({ ...meta, options: all });
  }

  if (ticker || cusip) {
    const s = guruStock({ ticker, cusip });
    if (!s) {
      res.setHeader('Cache-Control', 's-maxage=86400, stale-while-revalidate=604800');
      return res.status(200).json({ ...meta, held: false, stock: null, options: [] });
    }
    // Pro payloads must never reach the shared CDN cache.
    if (pro) noStore(res);
    else res.setHeader('Cache-Control', 's-maxage=86400, stale-while-revalidate=604800');
    return res.status(200).json({
      ...meta,
      held: true,
      stock: summarise(s),
      // Two orderings of the same list, because they answer different
      // questions: who owns the most of it, and who bet the most on it.
      topByValue: byValue(s, FREE_HOLDERS),
      topByConviction: byConviction(s, FREE_HOLDERS),
      holders: pro ? s.holders : s.holders.slice(0, FREE_HOLDERS),
      holdersTruncated: !pro && s.holderCount > FREE_HOLDERS,
      options: guruOptions({ ticker: s.ticker, cusip: s.cusip }),
    });
  }

  const limit = Math.min(Number(req.query.limit) || LIST_LIMIT, LIST_LIMIT);
  res.setHeader('Cache-Control', 's-maxage=86400, stale-while-revalidate=604800');
  return res.status(200).json({ ...meta, stocks: table.stocks.slice(0, limit).map(summarise) });
}
