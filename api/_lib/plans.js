// The plan catalog: what a visitor is offered and in which currency, decided
// once here for the pricing page (/api/plans, the server render) and the
// checkout (/api/checkout), so the amount shown is the amount charged.
//
// Region comes from Vercel's IP country on the server. Türkiye gets the
// regional prices; in TRY when the four STRIPE_PRICE_*_TRY ids are set (the
// amounts are read from Stripe and cached), in USD otherwise — then the page
// shows the USD amount with "≈ ₺" from a daily FX rate and this module
// suggests the TRY price to create (USD × rate × 1.03 FX margin, rounded up
// to a …49 / …99 ending). Everyone else gets the global USD prices.
//
// Env: STRIPE_PRICE_MONTHLY / _YEARLY (USD global), STRIPE_PRICE_MONTHLY_TR /
// _YEARLY_TR (USD, Türkiye), STRIPE_PRICE_MONTHLY_TRY / _YEARLY_TRY (TRY,
// Türkiye). FX_RATE_URL overrides the rate source (tests).
import axios from 'axios';
import { cached, TTL, remember, recall } from './cache.js';
import { hasStripe, stripeGet } from './stripe.js';

// The list prices behind the Stripe products (docs/STRIPE-KURULUM.md);
// yearly = 10 × monthly. The USD amounts are known without Stripe.
export const LIST_USD = { global: { m: 19.9, y: 199 }, tr: { m: 10, y: 100 } };

export const regionFor = (country) => (String(country || '').toUpperCase() === 'TR' ? 'tr' : 'global');

// USD × rate, a 3% FX margin, then up to the next …49 / …99 — the kind of
// number a Turkish price list carries.
export const suggestTry = (usd, rate) => (usd > 0 && rate > 0 ? Math.ceil((usd * rate * 1.03 + 1) / 50) * 50 - 1 : null);

// The real yearly discount against twelve months at the monthly rate.
export const discountPct = (m, y) => (m > 0 && y > 0 ? Math.round((1 - y / (12 * m)) * 100) : null);

const tryIds = () => ({ m: process.env.STRIPE_PRICE_MONTHLY_TRY || null, y: process.env.STRIPE_PRICE_YEARLY_TRY || null });
export const hasTryPrices = () => Boolean(tryIds().m && tryIds().y);

// USD→TRY, once a day. Two keyless sources; the last good rate survives an
// outage; null only when there has never been one.
export async function usdTry({ http = axios } = {}) {
  const key = 'fx:usdtry';
  try {
    return await cached(key, TTL.DAY_1, async () => {
      const sources = process.env.FX_RATE_URL
        ? [process.env.FX_RATE_URL]
        : ['https://api.frankfurter.app/latest?from=USD&to=TRY', 'https://open.er-api.com/v6/latest/USD'];
      for (const url of sources) {
        try {
          const r = await http.get(url, { timeout: 6000, validateStatus: () => true });
          const rate = Number(r.data?.rates?.TRY);
          if (r.status === 200 && rate > 0) {
            const out = { rate: Number(rate.toFixed(4)), asOf: r.data.date || new Date().toISOString().slice(0, 10), source: new URL(url).hostname };
            remember(key, out);
            return out;
          }
        } catch {
          /* next source */
        }
      }
      throw new Error('no FX source answered');
    });
  } catch {
    return recall(key) || null;
  }
}

// The TRY amounts behind the configured price ids, from Stripe, cached 6h.
// `getPrice` is the seam for tests.
async function tryAmounts({ getPrice = (id) => stripeGet(`/v1/prices/${id}`) } = {}) {
  const ids = tryIds();
  if (!ids.m || !ids.y || !hasStripe()) return null;
  return cached(`plans:try:${ids.m}:${ids.y}`, TTL.HOUR_6, async () => {
    const [m, y] = await Promise.all([getPrice(ids.m), getPrice(ids.y)]);
    const amount = (p) => (p?.currency?.toLowerCase() === 'try' && p.unit_amount > 0 ? p.unit_amount / 100 : null);
    const out = { m: amount(m), y: amount(y) };
    if (!out.m || !out.y) throw new Error('TRY prices are not TRY-denominated or have no amount');
    return out;
  }).catch(() => null);
}

// Everything the pricing page and the checkout need for one visitor:
//   { region, currency, m, y, discountPct, priceIds: {m, y}, anchorUsd,
//     fx: {rate, asOf, approx: {m, y}} | null, suggestedTry: {m, y} | null,
//     configured }
export async function planCatalog(country, { getPrice, http } = {}) {
  const region = regionFor(country);
  const usd = LIST_USD[region];
  const base = {
    region,
    configured: hasStripe(),
    // the global USD list price is the reference struck through on the TR card
    anchorUsd: region === 'tr' ? LIST_USD.global : null,
  };
  if (region === 'tr') {
    const amounts = await tryAmounts({ ...(getPrice ? { getPrice } : {}) });
    if (amounts) {
      const ids = tryIds();
      return { ...base, currency: 'TRY', m: amounts.m, y: amounts.y, discountPct: discountPct(amounts.m, amounts.y), priceIds: { m: ids.m, y: ids.y }, fx: null, suggestedTry: null };
    }
    const fx = await usdTry(http ? { http } : {});
    return {
      ...base,
      currency: 'USD',
      m: usd.m,
      y: usd.y,
      discountPct: discountPct(usd.m, usd.y),
      priceIds: { m: process.env.STRIPE_PRICE_MONTHLY_TR || process.env.STRIPE_PRICE_MONTHLY || null, y: process.env.STRIPE_PRICE_YEARLY_TR || process.env.STRIPE_PRICE_YEARLY || null },
      fx: fx ? { ...fx, approx: { m: Math.round(usd.m * fx.rate), y: Math.round(usd.y * fx.rate) } } : null,
      suggestedTry: fx ? { m: suggestTry(usd.m, fx.rate), y: suggestTry(usd.y, fx.rate) } : null,
    };
  }
  return {
    ...base,
    currency: 'USD',
    m: usd.m,
    y: usd.y,
    discountPct: discountPct(usd.m, usd.y),
    priceIds: { m: process.env.STRIPE_PRICE_MONTHLY || null, y: process.env.STRIPE_PRICE_YEARLY || null },
    fx: null,
    suggestedTry: null,
  };
}

// What the client is allowed to see (no price ids).
export const publicCatalog = ({ priceIds, ...rest }) => rest;
