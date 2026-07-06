import axios from 'axios';

// CUSIP -> ticker resolution via OpenFIGI. Without an API key the limit is
// 10 jobs/request & 25 req/min; with a free key (OPENFIGI_API_KEY) it is
// 100 jobs/request. Results are cached per instance.
const figiCache = new Map();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function mapCusipsToTickers(cusips) {
  const key = process.env.OPENFIGI_API_KEY;
  const batchSize = key ? 100 : 10;
  const need = [...new Set(cusips)].filter((c) => c && !figiCache.has(c));

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
