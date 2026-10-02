import { createRequire } from 'node:module';
import fs from 'node:fs';
import { valuationFor } from './secFundamentals.js';

// The nightly SEC fundamentals (scripts/build-fundamentals.mjs →
// api/_data/fundamentals.json), read from the deployment's own file: no
// request leaves the function while a page opens. The literal require path
// lets Vercel bundle it.
const require = createRequire(import.meta.url);
let file;
export function loadFundamentals() {
  if (file !== undefined) return file;
  try {
    file = process.env.FUNDAMENTALS_FILE ? JSON.parse(fs.readFileSync(process.env.FUNDAMENTALS_FILE, 'utf8')) : require('../_data/fundamentals.json');
  } catch {
    file = null;
  }
  return file;
}
export const resetFundamentals = () => {
  file = undefined;
};

const lookup = (ticker) => {
  const by = loadFundamentals()?.byTicker || {};
  const t = String(ticker || '').toUpperCase();
  return by[t] || by[t.replace('.', '-')] || by[t.replace('-', '.')] || null;
};

// What the stock page's fundamentals box shows for a ticker at a price:
//   { eps, pe ('loss' | number | null), marketCap, dividendYield, beta,
//     src: { eps, shares, div } — the filing behind each, with its link }
// null when the file has nothing for the ticker.
export function fundamentalsFor(ticker, price) {
  const r = lookup(ticker);
  if (!r) return null;
  const v = valuationFor(r, price);
  const src = (x) => (x ? { form: x.form, end: x.end, filed: x.filed, url: x.url, basis: x.basis || null, ...(x.perAds ? { perAds: x.perAds } : {}), ...(x.currency && x.currency !== 'USD' ? { currency: x.currency, local: x.local } : {}) } : null);
  return {
    eps: r.eps?.value ?? null,
    epsReason: r.eps?.reason || null,
    pe: v.pe,
    marketCap: v.marketCap,
    dividendYield: r.div ? v.dividendYield : null,
    beta: r.beta?.value ?? null,
    src: { eps: src(r.eps), shares: src(r.shares), div: src(r.div) },
    updatedAt: loadFundamentals()?.updatedAt || null,
  };
}
