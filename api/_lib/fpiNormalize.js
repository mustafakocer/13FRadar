// Foreign private issuers (FPIs) on Form 4: price, amount and share count
// in US dollars per US-listed security.
//
// Since 18 March 2026 (HFIAA) directors and officers of foreign companies
// file Form 4 too, and they report the way their home market counts:
//   · CEMEX: 400,800 CPOs at 17.28 Mexican pesos — the site showed
//     "$6,926,305" for a ~$370K purchase;
//   · Bradesco: preferred shares in reais;
//   · Taiwan Semiconductor: common shares in New Taiwan dollars, while the
//     stock the site quotes is the ADS (five of those shares).
//
// normalizeRow reads the line's own words first (security title and
// footnotes: "Price in Mexican Pesos (MXN)", "Each ADS represents 8
// ordinary shares"), then what is known about the issuer
// (api/_data/fpi.json, built by scripts/build-fpi.mjs from SEC filings and
// the Federal Reserve's H.10 rates; config/adr-overrides.json), and tries
// the readings that are possible — the form's price as it stands, home
// currency × ADR ratio, US dollars × ADR ratio, US dollars per ADS… A reading
// is accepted only when the US dollar price it gives per US security matches
// the market: within 15% of that day's close (25% for a conversion the filer
// declares, for an ADS premium), or inside the 52-week range when there is no
// daily series. A price that already matches the close is dollars: it is
// neither converted nor divided by an ADR ratio (see normalizeRow).
// Nothing is guessed: a line no reading fits is kept in its own
// currency and marked "USD karşılığı doğrulanamadı" — no dollar amount, no
// return, no İsabet, and it stays out of every ranking and total.
//
// Raw fields are never changed. A normalised line is served as a copy with
//   p  USD per US security      s  number of US securities
//   v  USD total                fx { cu, rate, ar, as, lp, ls, lv, ok: 1 }
// and a line that could not be normalised as a copy with v = null, pu = 1
// and fx { cu, lp, lv, fail }. Domestic lines are served untouched.
import { currencyOf, usdPerUnit } from './fx.js';
import { statedRatio, deriveRatio } from './adrRatio.js';
import { closeOnOrAfter, PRICE_TOLERANCE } from './insiderOutcome.js';
import { splitFactor } from './splitAdjust.js';

const DAY = 86400000;
// the 52-week range is the fallback check when there is no daily close
const RANGE_SLACK = 1.25;

// What the line's shares are, from the Form 4 security title.
//   ads        American Depositary Shares / Receipts (already US securities)
//   share      common / ordinary / CPO — or the preferred class an issuer's
//              ADS itself represents (Bradesco's ADS is one preferred share)
//   preferred  preferred stock that is not the quoted security (DFDV's
//              Series C Perpetual Preferred) — own label, no return
//   other      warrants, rights, notes, SPAC units…
//   null       no title stored (lines filed before the raw fields were kept)
export function securityKind(title, issuer = null) {
  if (!title) return null;
  const s = String(title);
  if (/prefer|preference/i.test(s)) {
    if (issuer?.und === 'preferred' && !/series|perpetual|convertible|cumulative|depositary/i.test(s)) return 'share';
    return 'preferred';
  }
  if (/american deposit[ao]ry|\badss?\b|\badrs?\b|depositary (shares?|receipts?)/i.test(s)) return 'ads';
  if (/warrants?|\brights?\b|\bnotes?\b|debentures?|\bbonds?\b|\boptions?\b/i.test(s) && !/common|ordinary/i.test(s.replace(/to (purchase|acquire|buy) .*/i, ''))) return 'other';
  if (/\bunits?\b/i.test(s) && !/common units?|limited partner\w* units?|\blp units?|class [a-z] units?|op units?|partnership units?/i.test(s)) return 'other';
  return 'share';
}

const notesOf = (raw) => (raw?.fn ? Object.values(raw.fn).join(' ') : '');

// A share's par or nominal value is not its price: "nominal value EUR 0.09
// per share" (Merus, whose $97 tender offer was read as euros), "nominal
// value 0.001 GBP" (Arm), "par value five cents of euro ((euro)0.05)" (Turbo
// Energy). Those clauses are dropped before a currency is looked for.
const PAR_VALUE_RE = /\b(?:par|nominal) value\b(?:[^.;]|\.\d){0,60}?(?=\bper\b|[;,]|\.(?!\d)|$)/gi;
export const withoutParValue = (s) => String(s || '').replace(PAR_VALUE_RE, ' ');

// Amounts with a currency in a footnote or the remarks: "at CAD$0.34
// (approximately US$0.249)", "offering price of euro 24.50 per share (or
// equivalent $28.27 per share)".
// "$17.20 MXN" (CEMEX) is pesos: a currency after the amount wins.
const MONEY_RE = /(?<![A-Za-z$])(R\$|C\$|CDN\$|CAD\s?\$?|NT\$|HK\$|S\$|A\$|MX\$|MXN\s?\$?|US\s?\$|U\.S\.\s?\$|USD|EUR|euros?|€|GBP|£|JPY|¥|\$)\s?(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)(?:\s?(MXN|CAD|EUR|GBP|BRL|JPY|TWD|HKD|SGD|AUD|pesos?|euros?|reais)\b)?/gi;
const moneyCurrency = (sym) => {
  const s = sym.toUpperCase().replace(/\s/g, '');
  if (s === 'R$') return 'BRL';
  if (s === 'C$' || s.startsWith('CAD') || s === 'CDN$') return 'CAD';
  if (s === 'NT$') return 'TWD';
  if (s === 'HK$') return 'HKD';
  if (s === 'S$') return 'SGD';
  if (s === 'A$') return 'AUD';
  if (s.startsWith('MX') || s.startsWith('PESO')) return 'MXN';
  if (s === 'BRL' || s === 'REAIS') return 'BRL';
  if (['TWD', 'HKD', 'SGD', 'AUD'].includes(s)) return s;
  if (s.startsWith('EUR') || s === '€') return 'EUR';
  if (s === 'GBP' || s === '£') return 'GBP';
  if (s === 'JPY' || s === '¥') return 'JPY';
  return 'USD';
};
// The currency of the amount in the text that IS the form's price.
export function figureCurrency(text, price) {
  if (!(price > 0) || !text) return null;
  const found = new Set();
  for (const m of String(text).matchAll(MONEY_RE)) {
    const x = Number(m[2].replace(/,/g, ''));
    // the same figure, to the cent (0.249 for a form price of 0.25)
    if (x > 0 && Math.abs(x - price) <= Math.max(0.0051, price * 0.001)) found.add(moneyCurrency(m[3] || m[1]));
  }
  return found.size === 1 ? [...found][0] : null;
}

// The currency the filer says the reported price is in, or null:
//   · a price converted INTO dollars (TSMC, Galicia, Gerdau, Aptose, SMFG);
//   · an amount in the footnotes or remarks equal to the form's price
//     (SBLK's "equivalent $28.27", Kidoz's "approximately US$0.249" next to
//     CAD$0.34).
// A currency merely mentioned (a sale "ranging from C$6.20 to C$6.42" while
// the form says 4.57; "paid in New Israeli Shekels" next to a dollar price)
// is not a declaration: the market check decides.
export function declaredCurrency(raw, price) {
  const text = withoutParValue([notesOf(raw), raw?.rm || ''].join(' '));
  // first: Gerdau's "translated into U.S. dollars at … R$5.1017 per US$1.00"
  // quotes a rate that happens to equal the price
  if (currencyOf(text) === 'USD') return 'USD';
  return figureCurrency(text, price);
}

// A foreign private issuer on the trade day: a 20-F, 40-F or 6-K in the 24
// months before it (build-fpi keeps the newest one's date, `lf`; a record
// without it predates that field and counts as foreign). A company that has
// since become a US filer (Summit, AVITA, Indivior) keeps its old ADR ratio
// in the SEC documents; it is not applied to its lines.
const FOREIGN_WINDOW_DAYS = 730;
export function foreignOn(issuer, day) {
  if (!issuer?.fpi) return false;
  if (!issuer.lf || !day) return true;
  return issuer.lf >= new Date(Date.parse(day) - FOREIGN_WINDOW_DAYS * DAY).toISOString().slice(0, 10);
}

// The ADR ratio for this issuer. Order (config/adr-overrides.json may force
// its value with "force": true — a reviewed correction):
//   the line's own footnote → F-6 / 20-F at the SEC → derived → override
export function ratioFor(issuer, override, rowNote) {
  if (override?.force && override.ratio > 0) return { ratio: override.ratio, src: 'override', quote: override.source || null };
  if (rowNote?.ratio > 0) return { ratio: rowNote.ratio, src: 'footnote', quote: rowNote.quote };
  if (issuer?.ratio > 0) return { ratio: issuer.ratio, src: issuer.src, quote: issuer.quote || null, url: issuer.url || null };
  if (issuer?.der?.ratio > 0 && issuer.der.n >= 3 && issuer.der.agree / issuer.der.n >= 0.8) return { ratio: issuer.der.ratio, src: 'derived', quote: null };
  if (override?.ratio > 0) return { ratio: override.ratio, src: 'override', quote: override.source || null };
  return null;
}

// Market reference for the trade day: the close (within a week after) when
// there is a daily series, else the 52-week range when the trade is inside
// that window.
function marketRef(r, series, meta) {
  if (series?.length) {
    const bar = closeOnOrAfter(series, r.d);
    if (bar && bar.close > 0 && Date.parse(bar.date) - Date.parse(r.d) <= 7 * DAY) return { close: bar.close };
  }
  if (meta?.lo > 0 && meta?.hi > 0 && meta.asOf && Date.parse(meta.asOf) - Date.parse(r.d) <= 365 * DAY) return { lo: meta.lo, hi: meta.hi };
  return null;
}
// How far from the trade day's US close a reading may land:
//   MATCH_TOLERANCE     the form's price as it stands, and every conversion
//                       the filer did not declare — ±15%
//   DECLARED_TOLERANCE  a conversion in the currency the filer declares, with
//                       a documented ratio — ±25%, for the premium an ADS
//                       can carry over its home shares (TSMC: 15–21%)
export const MATCH_TOLERANCE = 0.15;
export const DECLARED_TOLERANCE = PRICE_TOLERANCE;
const fits = (px, ref, tol) => (ref.close ? Math.abs(px / ref.close - 1) <= tol : px >= ref.lo / RANGE_SLACK && px <= ref.hi * RANGE_SLACK);

// Is this line one to normalise at all? Lines of a foreign private issuer
// (on the trade day), lines whose footnotes name a non-dollar currency, ADS
// lines, and lines of a ticker with a reviewed override.
export function needsNormalizing(r, raw, issuer, override = null) {
  if (!(r?.p > 0)) return false;
  if (foreignOn(issuer, r.d) || override) return true;
  const cur = declaredCurrency(raw, r.p) || currencyOf(withoutParValue(notesOf(raw)));
  if (cur && cur !== 'USD') return true;
  return securityKind(raw?.st, issuer) === 'ads';
}

// "Price per ADS" while the share count is in home-market units — CEMEX's
// sale of 21,268 ADSs was filed as 212,680 CPOs at $10.68 "per ADS"; 51Talk:
// "a weighted average price of ADS" for a count in Class A shares.
// codes priced at the market: an open-market buy or sale, and shares
// withheld for tax (valued at the day's price)
const MARKET_CODES = new Set(['P', 'S', 'F']);
const PRICE_PER_ADS_RE = /\bprice[s]? (is |are )?(reported |shown )?per (ads|adr|american depositary (share|receipt))\b|\bper ads\b|\bprice\b[^.]{0,40}?\bof (the |each |one )?(adss?|adrs?|american depositar(y|ies) (shares?|receipts?))\b/i;
// "The Class A ordinary shares are held in the form of American depositary
// shares" (51Talk): the count is in those shares, whatever the price is per
const HELD_AS_ADS_RE = /\b(held|represented)\s+(in the form of|as|by)\s+(american depositar(y|ies) (shares?|receipts?)|adss?|adrs?)\b/i;

// → null (untouched) | { kind } (a non-quoted security) | { ok, … } | { fail, … }
//
// A reading is (cu, pr, sr): the currency, how many home-market units the
// PRICE is for, and how many the SHARE COUNT is in, per US security.
//   per home share, count in home shares   pr = sr = ratio
//   per ADS, count in home shares          pr = 1, sr = ratio
//   per ADS, count in ADSs                 pr = sr = 1
// US price = p × rate × pr; US shares = s / sr; dollars = US price × US shares.
//
// With the trade day's US close, readings are tried in this order and the
// first that lands near the close is taken:
//   1. the currency the filer declares (declaredCurrency: converted into
//      dollars, or an amount equal to the price) — only that one, ±25%
//      with a documented ratio;
//   otherwise, ±15%:
//   2. price per ADS with the count in home shares, when a footnote (or a
//      reviewed override) says so: "price of each ADR" (Telecom Argentina),
//      shares "held in the form of ADSs" (51Talk), CEMEX's override;
//   3. the form's price as it stands — US dollars, no conversion, no ADR
//      ratio (Summit, Indivior, AVITA: a price equal to the close is not in
//      another unit);
//   4. a currency the footnotes mention, US dollars × the ADR ratio, then
//      the home currency — documented ratio before a derived one (TSMC's
//      ADS trades ~20% above five Taipei shares: 5 must beat a "closer" 6).
// Nothing near the close: "USD karşılığı doğrulanamadı" — no dollar amount,
// out of clusters and day totals. Without a daily close (no price data) the
// readings are ordered the same way and checked against the 52-week range,
// or, with no range either, a declared currency and a documented ratio are
// taken as they stand.
export function normalizeRow(r, { raw = null, issuer = null, override = null, rates = null, series = null, meta = null, splits } = {}) {
  const kind = securityKind(raw?.st, issuer);
  if (kind === 'preferred' || kind === 'other') return { kind };
  if (!needsNormalizing(r, raw, issuer, override)) return null;

  const foreign = foreignOn(issuer, r.d);
  const known = foreign ? issuer : null;
  const notes = withoutParValue(notesOf(raw));
  const declared = declaredCurrency(raw, r.p);
  const mentioned = declared ? null : currencyOf(notes);
  // a price the filer puts in dollars is never read in the home currency
  const home = declared === 'USD' ? null : override?.cur || known?.cur || null;
  const rowNote = statedRatio(notes);
  const hasAds = Boolean(known?.ads || override?.ratio || rowNote || kind === 'ads');
  const doc = hasAds ? ratioFor(known, override, rowNote) : { ratio: 1, src: 'direct' };
  // a documented ratio can be out of date (Vipshop's 2012 F-6 says 2; the
  // ADS has been 0.2 share since): the market-derived one is tried after it
  const der = known?.der?.ratio > 0 && known.der.n >= 3 && known.der.agree / known.der.n >= 0.8 ? known.der.ratio : null;
  const ratios = [];
  if (doc) ratios.push({ ratio: doc.ratio, src: doc.src });
  if (hasAds && der && !ratios.some((x) => x.ratio === der)) ratios.push({ ratio: der, src: 'derived' });
  const perAds = PRICE_PER_ADS_RE.test(notes) || (kind === 'share' && HELD_AS_ADS_RE.test(notes)) || override?.count === 'home';
  const homeTrusted = home && (override?.cur || known?.curSrc !== 'derived') ? home : null;
  const homeDerived = home && !homeTrusted ? home : null;
  const stated = declared || mentioned;
  // a dollar-priced line with no ADS and no foreign currency on the form:
  // nothing to convert — a mismatch there is a split or a data problem
  // (NCT), which the price check already handles
  if (!hasAds && (!stated || stated === 'USD') && !homeTrusted && !homeDerived) return null;

  const ref = marketRef(r, series, meta);
  // the daily closes are split-adjusted: so is the price compared with them
  const split = splitFactor(r.t, r.d, splits);

  const cands = [];
  const add = (cu, pr, sr, as, tol) => {
    if (!cu || !(pr > 0) || !(sr > 0) || cands.some((c) => c.cu === cu && c.pr === pr && c.sr === sr)) return;
    cands.push({ cu, pr, sr, as, tol });
  };
  const docRatios = ratios.filter((x) => x.src !== 'derived');
  const derRatios = ratios.filter((x) => x.src === 'derived');
  const perAdsReadings = (cu, list, tol) => {
    if (perAds && hasAds && kind !== 'ads') for (const { ratio, src } of list) add(cu, 1, ratio, src, tol);
  };
  const readings = (cu, list, tol) => {
    if (kind === 'ads') return add(cu, 1, 1, 'ads', tol);
    if (!hasAds) return add(cu, 1, 1, 'direct', tol);
    for (const { ratio, src } of list) {
      add(cu, ratio, ratio, src, tol);
      if (!perAds && kind === 'share' && cu !== 'USD') add(cu, 1, ratio, src, tol);
    }
    // no title stored: possibly a trade in the ADSs themselves
    if (kind == null && cu === 'USD') add('USD', 1, 1, 'ads', tol);
  };
  const asIs = (tol) => add('USD', 1, 1, 'asis', tol);
  if (declared) {
    perAdsReadings(declared, docRatios, DECLARED_TOLERANCE);
    if (declared === 'USD') asIs(DECLARED_TOLERANCE);
    readings(declared, docRatios, DECLARED_TOLERANCE);
    perAdsReadings(declared, derRatios, MATCH_TOLERANCE);
    readings(declared, derRatios, MATCH_TOLERANCE);
  } else {
    perAdsReadings('USD', docRatios, MATCH_TOLERANCE);
    asIs(MATCH_TOLERANCE);
    const tiers = [...new Set([mentioned, 'USD', homeTrusted, homeDerived].filter(Boolean))];
    for (const cu of tiers) readings(cu, docRatios, MATCH_TOLERANCE);
    perAdsReadings('USD', derRatios, MATCH_TOLERANCE);
    for (const cu of tiers) readings(cu, derRatios, MATCH_TOLERANCE);
  }

  const tried = cands.map((c) => {
    const rate = usdPerUnit(c.cu, r.d, rates);
    if (rate == null) return { ...c, why: 'no_rate' };
    const px = (r.p * rate * c.pr) / split;
    return { ...c, rate, px, fit: ref ? fits(px, ref, c.tol) : null };
  });

  let pick = null;
  const fitting = tried.filter((t) => t.fit);
  if (fitting.length) {
    if (ref.close) pick = fitting[0];
    else {
      // the 52-week range is wide: two readings that both fit must agree on
      // the dollar amount, or the line is ambiguous
      const vals = fitting.map((t) => (r.s / t.sr) * t.px);
      if (Math.max(...vals) / Math.min(...vals) <= 1 + PRICE_TOLERANCE) pick = fitting[0];
    }
  } else if (ref?.close && hasAds && !ratios.length) {
    // no ratio at all: derive it from the close (±10% of a common ratio)
    const tiers = declared ? [declared] : [...new Set([mentioned, 'USD', homeTrusted, homeDerived].filter(Boolean))];
    for (const cu of tiers) {
      const rate = usdPerUnit(cu, r.d, rates);
      const ar = deriveRatio(ref.close * split, r.p, rate);
      if (ar) {
        pick = { cu, pr: ar, sr: ar, as: 'derived', rate, px: (r.p * rate * ar) / split };
        break;
      }
    }
  } else if (!ref && (declared || mentioned || kind === 'ads')) {
    // no market data to check against: the form's own statement of the
    // currency with a documented ratio is taken as it stands
    const first = tried.find((t) => t.rate != null && t.as !== 'derived' && (t.as !== 'asis' || declared === 'USD' || kind === 'ads'));
    if (first && (kind === 'ads' || !perAds || first.pr === 1)) pick = first;
  }

  const lv = Math.round(r.s * r.p);
  if (!pick) {
    // no ratio anywhere: a data gap when there is nothing to derive it from,
    // a failed market check when a close was there and no common ratio fit
    // …and a currency that could not be tested for want of a rate (YPF in
    // Argentine pesos, ASE in New Taiwan dollars) is a missing rate, not a
    // failed check
    // …and an option exercise, award or phantom unit is priced at a strike
    // or a grant value, not the market: it cannot fail a market check
    const conv = tried.filter((t) => t.as !== 'asis');
    const why = !conv.length ? (ref?.close ? 'mismatch' : 'no_ratio') : conv.some((t) => t.rate == null) ? 'no_rate' : !MARKET_CODES.has(r.k) ? 'non_market' : ref ? 'mismatch' : 'unverifiable';
    return { fail: why, cu: stated || (kind === 'ads' ? 'USD' : home) || null, lp: r.p, lv };
  }
  const src = pick.as === doc?.src ? doc : null;
  const p = r.p * pick.rate * pick.pr;
  const s = r.s / pick.sr;
  return {
    ok: 1,
    cu: pick.cu,
    rate: pick.rate,
    ar: pick.sr,
    ...(pick.pr !== pick.sr ? { pa: 1 } : {}),
    as: pick.as,
    quote: src?.quote || null,
    url: src?.url || null,
    p: Number(p.toFixed(4)),
    s: Math.round(s),
    v: Math.round(p * s),
    lp: r.p,
    ls: r.s,
    lv,
  };
}

// The served copy of every row: normalised lines replaced by a copy with US
// dollar fields, lines that could not be normalised by a copy with no dollar
// amount. `ctx`:
//   fpi        api/_data/fpi.json ({ rates, issuers: { cik → issuer }, raw })
//   overrides  config/adr-overrides.json ({ TICKER → { ratio, cur, … } })
//   rawOf(r)   the raw Form 4 fields of a row
//   seriesFor(ticker), meta (ticker-meta.json), splits
export function normalizeRows(rows, ctx = {}) {
  const issuers = ctx.fpi?.issuers || {};
  const rates = ctx.fpi?.rates || null;
  const overrides = ctx.overrides || {};
  const seriesMemo = new Map();
  const series = (t) => {
    if (!t || !ctx.seriesFor) return null;
    if (!seriesMemo.has(t)) seriesMemo.set(t, ctx.seriesFor(t) || null);
    return seriesMemo.get(t);
  };
  const stats = { normalized: 0, failed: 0, security: 0 };
  const out = rows.map((r) => {
    const raw = ctx.rawOf ? ctx.rawOf(r) : null;
    const issuer = issuers[r.ci] || null;
    const override = (r.t && overrides[r.t]) || null;
    if (!raw && !issuer && !override) return r;
    const n = normalizeRow(r, { raw, issuer, override, rates, series: series(r.t), meta: r.t ? ctx.meta?.[r.t] : null, splits: ctx.splits });
    if (!n) return r;
    if (n.kind) {
      stats.security++;
      return { ...r, sk: n.kind };
    }
    if (n.fail) {
      stats.failed++;
      return { ...r, v: null, pu: 1, fx: { cu: n.cu, lp: n.lp, lv: n.lv, fail: n.fail } };
    }
    stats.normalized++;
    const copy = { ...r, p: n.p, s: n.s, v: n.v, fx: { cu: n.cu, rate: n.rate, ar: n.ar, as: n.as, lp: n.lp, ls: n.ls, lv: n.lv, ok: 1, ...(n.pa ? { pa: 1 } : {}), ...(n.quote ? { q: n.quote } : {}), ...(n.url ? { u: n.url } : {}) } };
    delete copy.pu;
    // ownership after the trade is in home-market shares too
    if (copy.o != null && n.ar !== 1) copy.o = Math.round(copy.o / n.ar);
    return copy;
  });
  normalizeRows.lastStats = stats;
  return out;
}

// A row's dollar amount for sums and rankings: null when the line's
// currency could not be verified (it is then left out and counted).
export const usdValue = (r) => (r?.fx?.fail ? null : Number.isFinite(r?.v) ? r.v : null);
export const fxUnverified = (r) => Boolean(r?.fx?.fail);
