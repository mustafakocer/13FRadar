import { matchPortfolio } from '../_lib/portfolioMatch.js';
import { verifyGrant } from '../_lib/leads.js';

// GET /api/portfolio-match?t=AAPL,MSFT,KO[&g=<grant>]
// The top three matches are free; a grant from a confirmed email address
// (api/_lib/leads.js) returns the full ranked list.
export default function handler(req, res) {
  const full = verifyGrant(req.query.g);
  res.setHeader('Cache-Control', full ? 'private, no-store' : 's-maxage=3600, stale-while-revalidate=86400');
  const result = matchPortfolio(req.query.t, { full });
  if (!result.tickers.length) return res.status(400).json({ error: 'no-tickers', ...result });
  res.status(200).json(result);
}
