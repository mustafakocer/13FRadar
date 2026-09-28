// Can the price on a Form 4 line be compared with today's market price?
// Checked when a page is served (feed, cards, stock page) and when the home
// teaser is built — not only by the nightly build — so a wrong return is
// never shown while waiting for the next crawl.
//
// A line fails, and shows no return, no İsabet and at most "Küçük alım", when
//   form      the nightly build already flagged it (`pu`, insiderOutcome.js)
//   security  the shares bought are not the common stock the price tracks —
//             preferred stock, warrants, notes, units (DFDV's "Variable Rate
//             Series C Perpetual Preferred Stock" at $8.96 read as −32%)
//   currency  a footnote gives the price in another currency or unit
//             (CEMEX: "Price in Mexican Pesos (MXN)", per participation
//             certificate — shown as −43.8%)
//   mismatch  the price cache has the trade day's close and the form price,
//             split-adjusted, is more than 25% away from it
//   unverifiable  no daily closes to check against, and the split-adjusted
//             form price is more than 2× away from today's price (NCT: $0.40
//             on the form, $4.43 today after an unrecorded reverse split —
//             shown as +1,007.5%)
// Pure: the caller passes the raw Form 4 fields, a series lookup and the
// splits; api/_lib/insiderStore.readRawServed() and priceStore.readSeries()
// are the production sources.
import { priceMismatch } from './insiderOutcome.js';
import { adjustedPrice } from './splitAdjust.js';

// Security titles that are not the common/ordinary shares a ticker quotes.
const NOT_COMMON_RE = /\b(preferred|pref\.?|warrants?|debentures?|notes?|bonds?|units?|rights?|depositary shares? representing .*preferred)\b/i;
// A footnote that puts the price in a foreign currency or a non-share unit.
const CURRENCY_RE =
  /\b(pesos?|mxn|reais|brl|r\$|rmb|renminbi|cny|yuan|hk\$|hkd|nt\$|twd|yen|jpy|euros?|eur|€|gbp|pence|pounds sterling|£|chf|swiss francs?|cad|c\$|aud|a\$|inr|rupees?|krw|ils|shekels?|zar|rand|sek|nok|dkk|kroner|kronor|ars)\b|€|£|price (is )?in (?!u\.?s\.? dollars)[a-z]+ (currency|dollars|pesos|reais)|per (ordinary )?participation certificate|per ordinary share\b.*\bads\b/i;
export const MAX_RATIO_UNVERIFIED = 2;

export function priceCheck(r, { raw = null, series = null, current = null, splits } = {}) {
  if (!(r?.p > 0)) return { ok: true, reason: null };
  // a foreign issuer's line (fpiNormalize.js): converted to US dollars per
  // US security and checked against the market, or kept in its currency
  if (r.fx?.fail) return { ok: false, reason: 'currency' };
  if (r.sk === 'preferred' || r.sk === 'other') return { ok: false, reason: 'security' };
  if (r.fx?.ok) {
    const m = series?.length ? priceMismatch(r, series, splits) : null;
    return m ? { ok: false, reason: 'mismatch' } : { ok: true, reason: null };
  }
  if (r.pu) return { ok: false, reason: 'form' };
  // "Common Units" of a partnership and "Class B Ordinary Shares" are the
  // quoted security; anything preferred never is
  if (raw?.st && (/preferred/i.test(raw.st) || (NOT_COMMON_RE.test(raw.st) && !/\b(common|ordinary)\b/i.test(raw.st))))
    return { ok: false, reason: 'security' };
  const notes = raw?.fn ? Object.values(raw.fn).join(' ') : '';
  if (notes && CURRENCY_RE.test(notes)) return { ok: false, reason: 'currency' };
  const m = series?.length ? priceMismatch(r, series, splits) : null;
  if (m) return { ok: false, reason: 'mismatch' };
  if (m === false) return { ok: true, reason: null };
  // no close for the trade day: fall back to today's price
  const p = adjustedPrice(r, splits);
  if (current > 0 && p > 0) {
    const ratio = p / current;
    if (ratio > MAX_RATIO_UNVERIFIED || ratio < 1 / MAX_RATIO_UNVERIFIED) return { ok: false, reason: 'unverifiable' };
  }
  return { ok: true, reason: null };
}
