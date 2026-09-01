import axios from 'axios';

// Temporary diagnostics: what do the upstream data providers return from
// THIS serverless region's IPs? Helps choose the right data source/fallback.
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

export default async function handler(req, res) {
  const out = {};
  const probe = async (name, url) => {
    try {
      const r = await axios.get(url, {
        timeout: 8000,
        validateStatus: () => true,
        responseType: 'text',
        transformResponse: [(d) => d],
        headers: { 'User-Agent': UA, Accept: '*/*' },
      });
      out[name] = { status: r.status, body: String(r.data).slice(0, 140).replace(/\s+/g, ' ') };
    } catch (e) {
      out[name] = { error: e.code || e.message };
    }
  };
  await Promise.all([
    probe('yahoo_chart_q1', 'https://query1.finance.yahoo.com/v8/finance/chart/AAPL?range=5d&interval=1d'),
    probe('yahoo_chart_q2', 'https://query2.finance.yahoo.com/v8/finance/chart/AAPL?range=5d&interval=1d'),
    probe('yahoo_fc', 'https://fc.yahoo.com/'),
    probe('yahoo_quote', 'https://query1.finance.yahoo.com/v7/finance/quote?symbols=AAPL'),
    probe('stooq_com', 'https://stooq.com/q/d/l/?s=aapl.us&i=d'),
    probe('stooq_pl', 'https://stooq.pl/q/d/l/?s=aapl.us&i=d'),
  ]);
  res.status(200).json(out);
}
