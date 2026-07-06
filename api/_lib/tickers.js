import axios from 'axios';
import { cached, TTL } from './cache.js';

const UA = process.env.SEC_USER_AGENT || '13FRadar/1.0 (kocergpt@gmail.com)';

// ticker -> issuer CIK via SEC's official mapping (cached 1 day)
export function tickerMap() {
  return cached('company_tickers', TTL.DAY_1, async () => {
    const { data } = await axios.get('https://www.sec.gov/files/company_tickers.json', {
      timeout: 20000,
      headers: { 'User-Agent': UA },
    });
    const map = new Map();
    for (const row of Object.values(data)) {
      map.set(String(row.ticker).toUpperCase(), String(row.cik_str));
    }
    return map;
  });
}

export async function tickerToCik(ticker) {
  const map = await tickerMap();
  const t = ticker.toUpperCase();
  return map.get(t) || map.get(t.replace('-', '')) || null;
}
