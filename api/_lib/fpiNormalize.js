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
  if (issuer?.der?.ratio > 0) return { ratio: issuer.der.ratio, src: 'derived', quote: null };
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

// → null (untouched) | { kind } (a non-quoted security) | { ok, … } | { fail, … }
export function normalizeRow(r, { raw = null, issuer = null, override = null, rates = null, series = null, meta = null, splits } = {}) {
  const kind = securityKind(raw?.st, issuer);
  if (kind === 'preferred' || kind === 'other') return { kind };
  if (!needsNormalizing(r, raw, issuer)) return null;

  const notes = notesOf(raw);
  const stated = currencyOf(notes);
  const home = override?.cur || issuer?.cur || null;
  const rowNote = statedRatio(notes);
  const ratio = issuer?.ads || override?.ratio || rowNote ? ratioFor(issuer, override, rowNote) : { ratio: 1, src: 'direct' };
  const ref = marketRef(r, series, meta);
  // the daily closes are split-adjusted: so is the price compared with them
  const split = splitFactor(r.t, r.d, splits);

  // the readings that are possible for this line, most likely first
  const cands = [];
  const add = (cu, ar, as) => {
    if (!cu || !(ar > 0) || cands.some((c) => c.cu === cu && c.ar === ar)) return;
    cands.push({ cu, ar, as });
  };
  if (kind === 'ads') {
    add(stated && stated !== 'USD' ? stated : 'USD', 1, 'ads');
  } else {
    const curs = stated ? [stated] : [home, 'USD'];
    for (const cu of curs) {
      if (ratio) add(cu, ratio.ratio, ratio.src);
      // a line with no title may be an ADS trade in dollars
      if (kind == null && cu === 'USD') add('USD', 1, 'ads');
      if (!issuer?.ads && !ratio) add(cu, 1, 'direct');
    }
  }

  const tried = [];
  for (const c of cands) {
    const rate = usdPerUnit(c.cu, r.d, rates);
    if (rate == null) {
      tried.push({ ...c, why: 'no_rate' });
      continue;
    }
    const px = (r.p * rate * c.ar) / split;
    tried.push({ ...c, rate, px, fit: ref ? fits(px, ref) : null, dist: ref ? distance(px, ref) : null });
  }

  let pick = null;
  const fitting = tried.filter((t) => t.fit);
  if (fitting.length) {
    // a line that fits two readings (the range check is wide) is accepted
    // only when they agree on the dollar amount within 25% — otherwise it is
    // ambiguous and stays unconverted
    fitting.sort((a, b) => a.dist - b.dist);
    const spread = Math.max(...fitting.map((t) => t.px)) / Math.min(...fitting.map((t) => t.px));
    const sameValue = fitting.every((t) => t.cu === fitting[0].cu);
    if (ref.close || fitting.length === 1 || (sameValue && spread <= 1 + PRICE_TOLERANCE)) pick = fitting[0];
  } else if (ref?.close && !ratio && issuer?.ads) {
    // no documented ratio: derive it from the close (±10% of a common ratio)
    for (const cu of stated ? [stated] : [home, 'USD']) {
      const rate = usdPerUnit(cu, r.d, rates);
      const ar = deriveRatio(ref.close * split, r.p, rate);
      if (ar) {
        pick = { cu, ar, as: 'derived', rate, px: (r.p * rate * ar) / split };
        break;
      }
    }
  } else if (!ref && (stated || kind === 'ads') && tried.length && tried[0].rate != null && (kind === 'ads' || ratio?.src !== 'derived')) {
    // no market data to check against: the form's own statement of the
    // currency plus a documented ratio is taken as it stands
    pick = tried[0];
  }

  const lv = Math.round(r.s * r.p);
  if (!pick) {
    const why = !tried.some((t) => t.rate != null) ? 'no_rate' : ref ? 'mismatch' : 'unverifiable';
    return { fail: why, cu: stated || (kind === 'ads' ? 'USD' : home) || null, lp: r.p, lv };
  }
  return {
    ok: 1,
    cu: pick.cu,
    rate: pick.rate,
    ar: pick.ar,
    as: pick.as,
    quote: pick.as === ratio?.src ? ratio?.quote || null : null,
    url: pick.as === ratio?.src ? ratio?.url || null : null,
    p: Number((r.p * pick.rate * pick.ar).toFixed(4)),
    s: Math.round(r.s / pick.ar),
    v: Math.round(r.s * r.p * pick.rate),
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
    const copy = { ...r, p: n.p, s: n.s, v: n.v, fx: { cu: n.cu, rate: n.rate, ar: n.ar, as: n.as, lp: n.lp, ls: n.ls, lv: n.lv, ok: 1, ...(n.quote ? { q: n.quote } : {}), ...(n.url ? { u: n.url } : {}) } };
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
