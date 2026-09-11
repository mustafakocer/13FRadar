import axios from 'axios';
import { cached, TTL } from '../_lib/cache.js';
import { padCik } from '../_lib/sec.js';
import { readFixture } from '../_lib/fixtures.js';

const UA = process.env.SEC_USER_AGENT || '13FRadar/1.0 (kocergpt@gmail.com)';

// GET /api/holders?q=<cusip or company name>
// Who reports this security on 13F-HR filings? Uses EDGAR full-text search
// (info tables are indexed, so a CUSIP query matches holders directly).
export default async function handler(req, res) {
  const q = String(req.query.q || '').trim();
  if (q.length < 2) return res.status(400).json({ error: 'Query too short' });
  const fx = readFixture(`holders/${q.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.json`);
  if (fx) return res.status(200).json(fx);

  try {
    const payload = await cached(`holders:${q.toLowerCase()}`, TTL.HOUR_6, async () => {
      const byCik = new Map();
      let total = 0;
      // 3 pages x 10 hits — up to ~30 distinct filers
      for (const from of [0, 10, 20]) {
        const { data } = await axios.get('https://efts.sec.gov/LATEST/search-index', {
          timeout: 20000,
          headers: { 'User-Agent': UA },
          params: { q: `"${q}"`, forms: '13F-HR', from },
        });
        total = data?.hits?.total?.value ?? total;
        const hits = data?.hits?.hits || [];
        for (const h of hits) {
          for (const dn of h._source?.display_names || []) {
            const m = /^(.*?)\s*\(CIK\s+(\d+)\)\s*$/.exec(dn);
            if (!m) continue;
            const cik = padCik(m[2]);
            const cur = byCik.get(cik) || { cik, name: m[1].trim(), filings: 0 };
            cur.filings++;
            byCik.set(cik, cur);
          }
        }
        if (hits.length < 10) break;
      }
      return {
        total,
        holders: [...byCik.values()].sort((a, b) => b.filings - a.filings).slice(0, 30),
      };
    });
    res.setHeader('Cache-Control', 's-maxage=21600, stale-while-revalidate=86400');
    res.status(200).json(payload);
  } catch (err) {
    res.status(502).json({ error: String(err.message || err) });
  }
}
