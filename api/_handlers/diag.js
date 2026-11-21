import crypto from 'node:crypto';
import axios from 'axios';
import { snapshot } from '../_lib/providerHealth.js';
import { hasTd, hasFinnhub } from '../_lib/providers.js';
import { priceCacheStatus } from '../_lib/priceStore.js';

// Diagnostics: which keys the instance has, the quote chain's health and
// quotas since the instance started (api/_lib/providerHealth.js), what the
// nightly price cache holds (api/_data/prices/_index.json), and what the
// keyed providers answer from THIS region's IPs — what it takes to read a
// day of X-Stock-Source: snapshot. Yahoo and Stooq are not probed: they are
// out of every chain (see _handlers/stock.js).
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

// The answer names which keys the instance has, how much provider quota is
// left and the region it runs in, and every call makes two outbound requests:
// not something to hand to anyone who finds the URL. It is served only to a
// caller that presents DIAG_TOKEN (`x-diag-token: <token>` or
// `Authorization: Bearer <token>`). Without the variable the endpoint does
// not exist (404, fail closed); a wrong token gets the same 404, so the
// response does not say whether a token is configured.
export function diagAuthorized(req, token = process.env.DIAG_TOKEN) {
  const want = String(token || '');
  if (want.length < 16) return false; // unset, or too short to be a secret
  const bearer = /^Bearer\s+(.+)$/i.exec(String(req.headers?.authorization || ''));
  const given = String(req.headers?.['x-diag-token'] || bearer?.[1] || '').trim();
  if (!given) return false;
  // compare digests: equal length whatever was sent, constant time
  const h = (v) => crypto.createHash('sha256').update(v).digest();
  return crypto.timingSafeEqual(h(given), h(want));
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (!diagAuthorized(req)) return res.status(404).json({ error: 'Not found' });
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
  // reachability only — no key is sent, so a 401/403 here is "reachable"
  await Promise.all([
    probe('twelvedata', 'https://api.twelvedata.com/quote?symbol=AAPL'),
    probe('finnhub', 'https://finnhub.io/api/v1/quote?symbol=AAPL'),
  ]);
  res.status(200).json({
    probes: out,
    priceCache: priceCacheStatus(),
    config: {
      TWELVEDATA_API_KEY: hasTd(),
      FINNHUB_API_KEY: hasFinnhub(),
      chain: ['twelvedata', 'finnhub'],
      OPENFIGI_API_KEY: Boolean(process.env.OPENFIGI_API_KEY),
      STOCK_UPSTREAM_MS: Number(process.env.STOCK_UPSTREAM_MS) || 3000,
      STOCK_SNAPSHOT_MS: Number(process.env.STOCK_SNAPSHOT_MS) || null,
      region: process.env.VERCEL_REGION || null,
    },
    // per provider: limit/per, usedToday (this instance), throttledToday,
    // lastThrottleAt, exhausted (until UTC midnight after a 429 on a daily
    // cap), conserve (past 90% of the cap: held back while a peer has room)
    quota: Object.fromEntries(Object.entries(snapshot().providers).map(([name, p]) => [name, p.quota])),
    health: snapshot(),
  });
}
