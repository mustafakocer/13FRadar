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
// the readings that are possible — home currency × ADR ratio, US dollars ×
// ADR ratio, US dollars per ADS… A reading is accepted only when the US
// dollar price it gives per US security matches the market: within 25% of
// that day's close, or inside the 52-week range when there is no daily
// series. Nothing is guessed: a line no reading fits is kept in its own
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
  if (/american depositary|\bads\b|\badrs?\b|depositary (shares?|receipts?)/i.test(s)) return 'ads';
  if (/warrants?|\brights?\b|\bnotes?\b|debentures?|\bbonds?\b|\boptions?\b/i.test(s) && !/common|ordinary/i.test(s.replace(/to (purchase|acquire|buy) .*/i, ''))) return 'other';
  if (/\bunits?\b/i.test(s) && !/common units?|limited partner\w* units?|\blp units?|class [a-z] units?|op units?|partnership units?/i.test(s)) return 'other';
  return 'share';
}

const notesOf = (raw) => (raw?.fn ? Object.values(raw.fn).join(' ') : '');

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
const fits = (px, ref) =>
  ref.close ? Math.abs(px / ref.close - 1) <= PRICE_TOLERANCE : px >= ref.lo / RANGE_SLACK && px <= ref.hi * RANGE_SLACK;
const distance = (px, ref) => Math.abs(Math.log(px / (ref.close || Math.sqrt(ref.lo * ref.hi))));

// Is this line one to normalise at all? Lines of a known foreign private
// issuer, lines whose footnotes name a non-dollar currency, and ADS lines.
export function needsNormalizing(r, raw, issuer) {
  if (!(r?.p > 0)) return false;
  if (issuer?.fpi) return true;
  const cur = currencyOf(notesOf(raw));
  if (cur && cur !== 'USD') return true;
  return securityKind(raw?.st, issuer) === 'ads';
}

// "Price per ADS" while the share count is in home-market units — CEMEX's
// sale of 21,268 ADSs was filed as 212,680 CPOs at $10.68 "per ADS".
const PRICE_PER_ADS_RE = /\bprice[s]? (is |are )?(reported |shown )?per (ads|adr|american depositary (share|receipt))\b|\bper ads\b/i;

// → null (untouched) | { kind } (a non-quoted security) | { ok, … } | { fail, … }
//
// A reading is (cu, pr, sr): the currency, how many home-market units the
// PRICE is for, and how many the SHARE COUNT is in, per US security.
//   per home share, count in home shares   pr = sr = ratio
//   per ADS, count in home shares          pr = 1, sr = ratio
//   per ADS, count in ADSs                 pr = sr = 1
// US price = p × rate × pr; US shares = s / sr; dollars = US price × US shares.
// The first reading, in priority order, whose US price matches the market
// is taken — priority, not closeness: TSMC's ADS trades ~20% above five
// Taipei shares, so the documented ratio (5) must win over a "closer" 6.
export function normalizeRow(r, { raw = null, issuer = null, override = null, rates = null, series = null, meta = null, splits } = {}) {
  const kind = securityKind(raw?.st, issuer);
  if (kind === 'preferred' || kind === 'other') return { kind };
  if (!needsNormalizing(r, raw, issuer)) return null;

  const notes = notesOf(raw);
  const stated = currencyOf(notes);
  const home = override?.cur || issuer?.cur || null;
  const rowNote = statedRatio(notes);
  const hasAds = Boolean(issuer?.ads || override?.ratio || rowNote || kind === 'ads');
  const doc = hasAds ? ratioFor(issuer, override, rowNote) : { ratio: 1, src: 'direct' };
  // a documented ratio can be out of date (Vipshop's 2012 F-6 says 2; the
  // ADS has been 0.2 share since): the market-derived one is tried after it
  const der = issuer?.der?.ratio > 0 && issuer.der.n >= 3 && issuer.der.agree / issuer.der.n >= 0.8 ? issuer.der.ratio : null;
  const ratios = [];
  if (doc) ratios.push({ ratio: doc.ratio, src: doc.src });
  if (hasAds && der && !ratios.some((x) => x.ratio === der)) ratios.push({ ratio: der, src: 'derived' });
  const perAds = PRICE_PER_ADS_RE.test(notes);
  const curs = stated ? [stated] : [...new Set([home, 'USD'].filter(Boolean))];
  // a US-dollar price of a company with no ADS and no foreign currency on
  // the form: nothing to convert — a mismatch there is a split or a data
  // problem (NCT), which the price check already handles
  if (!hasAds && curs.every((c) => c === 'USD')) return null;

  const ref = marketRef(r, series, meta);
  // the daily closes are split-adjusted: so is the price compared with them
  const split = splitFactor(r.t, r.d, splits);

  const cands = [];
  const add = (cu, pr, sr, as) => {
    if (!cu || !(pr > 0) || !(sr > 0) || cands.some((c) => c.cu === cu && c.pr === pr && c.sr === sr)) return;
    cands.push({ cu, pr, sr, as });
  };
  for (const cu of curs) {
    if (kind === 'ads') {
      add(cu, 1, 1, 'ads');
      continue;
    }
    if (!hasAds) {
      add(cu, 1, 1, 'direct');
      continue;
    }
    for (const { ratio, src } of ratios) {
      if (perAds) add(cu, 1, ratio, src);
      add(cu, ratio, ratio, src);
      if (!perAds && kind === 'share') add(cu, 1, ratio, src);
    }
    // no title stored: possibly a trade in the ADSs themselves
    if (kind == null && cu === 'USD') add('USD', 1, 1, 'ads');
  }

  const tried = cands.map((c) => {
    const rate = usdPerUnit(c.cu, r.d, rates);
    if (rate == null) return { ...c, why: 'no_rate' };
    const px = (r.p * rate * c.pr) / split;
    return { ...c, rate, px, fit: ref ? fits(px, ref) : null };
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
    for (const cu of curs) {
      const rate = usdPerUnit(cu, r.d, rates);
      const ar = deriveRatio(ref.close * split, r.p, rate);
      if (ar) {
        pick = { cu, pr: ar, sr: ar, as: 'derived', rate, px: (r.p * rate * ar) / split };
        break;
      }
    }
  } else if (!ref && (stated || kind === 'ads')) {
    // no market data to check against: the form's own statement of the
    // currency with a documented ratio is taken as it stands
    const first = tried.find((t) => t.rate != null && t.as !== 'derived');
    if (first && (kind === 'ads' || !perAds || first.pr === 1)) pick = first;
  }

  const lv = Math.round(r.s * r.p);
  if (!pick) {
    // no ratio anywhere: a data gap when there is nothing to derive it from,
    // a failed market check when a close was there and no common ratio fit
    const why = !tried.length ? (ref?.close ? 'mismatch' : 'no_ratio') : !tried.some((t) => t.rate != null) ? 'no_rate' : ref ? 'mismatch' : 'unverifiable';
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
