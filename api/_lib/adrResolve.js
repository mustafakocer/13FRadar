// Which ADR ratio the fundamentals build applies to a ticker, and when it
// must refuse to guess.
//
// EPS in a 20-F is per home-market share and the cover count is home-market
// shares; the price the page has is the US security's. Where that security is
// an ADS of N shares, P/E and market cap are off by N unless the ratio is
// applied (api/_lib/secFundamentals.js fundamentalsOf, `adrRatio`). A ratio
// nobody documented used to fall back to 1, so HSBC (5 shares per ADS) read
// a P/E of 80 and a $1.65T market cap. A listing known to be an ADS with no
// known ratio now gets no per-share figures at all: "—" beats a number off
// by five.
//
// Ratio precedence (same as before):
//   1. config/adr-overrides.json with force: true — a reviewed correction
//      that beats the documents (a programme that ended: AZN, INDV, SMMT)
//   2. api/_data/fpi.json, the F-6 / 20-F ratio, for an issuer it marks ADS
//   3. config/adr-overrides.json without force
//
// Is the US security an ADS? fpi.json's own answer for the issuers it covers;
// otherwise the 13F titles of class the funds file it under ("SPONSORED ADR",
// "ADS") — by majority, since a stray filer labels Comfort Systems "ADR".

import fs from 'node:fs';
import path from 'node:path';

const ADS_TITLE = /\b(ADRS?|ADSS?|SPON(SORED|S|SORD|SERED)?|DEPOSITAR(Y|IES))\b/;
const NOT_ADS_TITLE = /\bUNITS?\b|N\s*Y\s*REG/;

export function isAdsTitle(title) {
  const s = String(title || '').toUpperCase();
  return ADS_TITLE.test(s) && !NOT_ADS_TITLE.test(s);
}

// ticker → { ads, total }: how many 13F lines title it as a depositary share.
// latestHoldings: api/_data/latest-holdings.json; tickerOf: cusip → ticker.
export function adsVotes(latestHoldings, tickerOf) {
  const votes = new Map();
  for (const f of Object.values(latestHoldings?.byCik || {})) {
    for (const h of f.top || []) {
      if (h.putCall) continue;
      const t = tickerOf(h.cusip);
      if (!t) continue;
      const v = votes.get(t) || { ads: 0, total: 0 };
      v.total++;
      if (isAdsTitle(h.class)) v.ads++;
      votes.set(t, v);
    }
  }
  return votes;
}

export function isAdsListing({ issuer = null, votes = null } = {}) {
  if (issuer) return issuer.ads === 1;
  return Boolean(votes && votes.total > 0 && votes.ads / votes.total > 0.5);
}

// { ratio, unknown }: ratio null with unknown true means "an ADS, ratio not
// known — publish no per-share figures".
export function resolveAdrRatio({ override = null, issuer = null, votes = null } = {}) {
  if (override?.force && override.ratio > 0) return { ratio: override.ratio, unknown: false };
  if (issuer?.ads && issuer.ratio > 0) return { ratio: issuer.ratio, unknown: false };
  if (override?.ratio > 0) return { ratio: override.ratio, unknown: false };
  return { ratio: null, unknown: isAdsListing({ issuer, votes }) };
}

export const ADR_UNKNOWN_REASON = 'ADS oranı doğrulanamadı';

// A record with its per-share figures and share count withdrawn (beta, which
// is price-only, stays).
export function withoutPerShare(rec) {
  const out = { ...rec };
  out.eps = rec.eps ? { value: null, reason: ADR_UNKNOWN_REASON, ...(rec.eps.url ? { url: rec.eps.url, form: rec.eps.form, end: rec.eps.end, filed: rec.eps.filed } : {}) } : null;
  out.div = null;
  out.shares = null;
  out.adrUnknown = true;
  return out;
}

// Everything resolveAdrRatio needs, read from the repository's files once:
// (ticker, cik) → { ratio, unknown }. Used by the fundamentals build and by
// the market cap in ticker-meta.json, so the two never disagree.
export function adrResolver(root) {
  const read = (rel) => {
    try {
      return JSON.parse(fs.readFileSync(path.join(root, rel), 'utf8'));
    } catch {
      return null;
    }
  };
  const issuers = read('api/_data/fpi.json')?.issuers || {};
  const ratios = read('config/adr-ratios.json')?.byTicker || {};
  const overrides = read('config/adr-overrides.json')?.byTicker || {};
  const master = read('api/_data/security-master.json')?.byCusip || {};
  const votes = adsVotes(read('api/_data/latest-holdings.json'), (c) => master[c]?.ticker || null);
  return (ticker, cik) =>
    resolveAdrRatio({
      override: ratios[ticker] || overrides[ticker] || null,
      issuer: cik ? issuers[String(cik).replace(/\D/g, '').padStart(10, '0')] || null : null,
      votes: votes.get(ticker) || null,
    });
}
