import axios from 'axios';
import { createRequire } from 'node:module';

// CUSIP -> ticker resolution.
// A static map (built weekly by the universe GitHub Action, covering the
// most-held securities) answers instantly; OpenFIGI is only consulted for
// unknown CUSIPs, bounded by maxLive to keep responses fast.
// Without OPENFIGI_API_KEY: 10 jobs/request & 25 req/min; with a free key: 100/request.
const require = createRequire(import.meta.url);
let STATIC_MAP = {};
try {
  STATIC_MAP = require('../_data/cusip-tickers.json');
} catch {
  /* map optional */
}

const figiCache = new Map(Object.entries(STATIC_MAP));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function mapCusipsToTickers(cusips, { maxLive = 60 } = {}) {
  const key = process.env.OPENFIGI_API_KEY;
  const batchSize = key ? 100 : 10;
  const need = [...new Set(cusips)]
    .filter((c) => c && !figiCache.has(c))
    .slice(0, maxLive);

  for (let i = 0; i < need.length; i += batchSize) {
    const slice = need.slice(i, i + batchSize);
    const jobs = slice.map((c) => ({ idType: 'ID_CUSIP', idValue: c }));
    let attempts = 0;
    while (attempts < 3) {
      attempts++;
      try {
        const r = await axios.post('https://api.openfigi.com/v3/mapping', jobs, {
          timeout: 15000,
          validateStatus: () => true,
          headers: {
            'Content-Type': 'application/json',
            ...(key ? { 'X-OPENFIGI-APIKEY': key } : {}),
          },
        });
        if (r.status === 429) {
          await sleep(1500 * attempts);
          continue;
        }
        if (r.status !== 200 || !Array.isArray(r.data)) break;
        r.data.forEach((res, j) => {
          const hits = res?.data || [];
          const best =
            hits.find((d) => d.exchCode === 'US' && d.ticker) ||
            hits.find((d) => d.ticker);
          figiCache.set(slice[j], best?.ticker ? best.ticker.replace(/\//g, '-') : null);
        });
        break;
      } catch {
        await sleep(1000 * attempts);
      }
    }
    // stay under the anonymous rate limit
    if (!key && i + batchSize < need.length) await sleep(2600);
  }

  const out = {};
  for (const c of cusips) out[c] = figiCache.get(c) ?? null;
  return out;
}
