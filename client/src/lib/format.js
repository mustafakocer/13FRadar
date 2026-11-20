// Numbers follow the page language: "1,326,590" / "+29.0%" / "$1.23B" in
// English, "1.326.590" / "+%29,0" / "$1,23B" in Turkish (unit letters and the
// leading "$" stay, as the Turkish copy already writes "100M–1B $").
//
// The language is one module-level value, not an argument on ~450 call sites.
// That is safe because a page is rendered in one language from start to end:
//   server  entry-server.jsx sets it, runs the synchronous renderToString and
//           resets it in `finally`, so concurrent requests cannot interleave;
//   client  main.jsx sets it once before hydration — switching language is a
//           full page load (i18n.jsx setLang).
// Anything outside a page render (scripts, e-mails, exports) gets English.
//
// Every formatter builds the en-US string first and swaps the separators for
// Turkish, so server and browser cannot disagree the way two ICU versions can.
let active = 'en';
export function setFormatLang(lang) {
  active = lang === 'tr' ? 'tr' : 'en';
}
export const getFormatLang = () => active;

const SWAP = { '.': ',', ',': '.' };
// "1,234.5" → "1.234,5" on a Turkish page. Pass digits and separators only.
export const locNum = (s) => (active === 'tr' ? String(s).replace(/[.,]/g, (c) => SWAP[c]) : String(s));

// A percentage the way the language writes it: "12.3%" / "%12,3". The number
// comes with its own sign, which stays in front: "+%12,3", "-%4,0", "<%0,1".
const PCT_PARTS = /^([^0-9]*)(.*)$/;
export function pctText(signed) {
  const m = PCT_PARTS.exec(String(signed));
  return active === 'tr' ? `${m[1]}%${locNum(m[2])}` : `${m[1]}${m[2]}%`;
}

export function fmtMoney(v, { compact = true } = {}) {
  if (v == null || Number.isNaN(v)) return '—';
  const abs = Math.abs(v);
  if (!compact) return '$' + locNum(v.toLocaleString('en-US', { maximumFractionDigits: 0 }));
  const sign = v < 0 ? '-' : '';
  if (abs >= 1e12) return `${sign}$${locNum((abs / 1e12).toFixed(2))}T`;
  if (abs >= 1e9) return `${sign}$${locNum((abs / 1e9).toFixed(2))}B`;
  if (abs >= 1e6) return `${sign}$${locNum((abs / 1e6).toFixed(1))}M`;
  if (abs >= 1e3) return `${sign}$${locNum((abs / 1e3).toFixed(1))}K`;
  return `${sign}$${locNum(abs.toFixed(2))}`;
}

export function fmtNum(v, digits = 0) {
  if (v == null || Number.isNaN(v)) return '—';
  return locNum(v.toLocaleString('en-US', { maximumFractionDigits: digits }));
}

// A share price: two decimals from ten dollars up, four below ($253.50,
// $0.1234), the way the price store rounds a close.
export function fmtPx(v) {
  if (v == null || Number.isNaN(v)) return '—';
  const d = Math.abs(v) >= 10 ? 2 : 4;
  return '$' + locNum(v.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }));
}

// "−22,6" / "-22.6": an off-market price's distance from the close
export function fmtOffPct(v, lang = 'tr') {
  if (v == null || Number.isNaN(v)) return '—';
  const s = `${v > 0 ? '+' : ''}${Number(v).toFixed(1)}`;
  return lang === 'tr' ? s.replace('.', ',') : s;
}

export function fmtPct(v, { sign = true, digits = 1 } = {}) {
  if (v == null || Number.isNaN(v)) return '—';
  const s = sign && v > 0 ? '+' : '';
  return pctText(`${s}${v.toFixed(digits)}`);
}

// Yahoo ratios like margins/ROE come as fractions (0.245 -> 24.5%)
export const fmtFracPct = (v, opts) => (v == null ? '—' : fmtPct(v * 100, { sign: false, ...opts }));

export const fmtRatio = (v, digits = 2) =>
  v == null || Number.isNaN(v) ? '—' : locNum(Number(v).toFixed(digits));

// buy = increase, sell = decrease; zero is neither, so it stays uncoloured
export const deltaClass = (v) => (v == null || v === 0 ? '' : v > 0 ? 'delta-pos' : 'delta-neg');

// Turnover is a trading measure (see api/_lib/turnover.js): a quarter with
// any trade is never "0%", it is "<0.1%" — otherwise the number sits next to
// "1 new · 1 exited" and contradicts it.
export function fmtTurnover(v) {
  if (v == null || Number.isNaN(v)) return '—';
  if (v > 0 && v < 0.05) return pctText('<0.1');
  return fmtPct(v, { sign: false });
}

// "30.09.2025 – 19.11.2026" / "Sep 30, 2025 – Nov 19, 2026": the window a
// chained return covers. Null unless both ends are ISO days.
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
export function fmtDay(iso, lang = 'tr') {
  if (!ISO_DAY.test(String(iso || ''))) return null;
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  return lang === 'tr'
    ? d.toLocaleDateString('tr-TR', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' })
    : d.toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}
export function fmtDayRange(from, to, lang = 'tr') {
  const a = fmtDay(from, lang);
  const b = fmtDay(to, lang);
  return a && b ? `${a} – ${b}` : null;
}

export function quarterLabel(dateStr) {
  if (!dateStr) return '—';
  const [y, m] = dateStr.split('-').map(Number);
  return `${y} Q${Math.ceil(m / 3)}`;
}

// An amount in the currency a foreign issuer's Form 4 was filed in, when it
// could not be verified in US dollars: "MXN 6.93M" (never with "$").
export function fmtLocal(cu, v) {
  if (v == null || Number.isNaN(v)) return '—';
  const abs = Math.abs(v);
  const sign = v < 0 ? '-' : '';
  const n = abs >= 1e9 ? `${locNum((abs / 1e9).toFixed(2))}B` : abs >= 1e6 ? `${locNum((abs / 1e6).toFixed(2))}M` : abs >= 1e3 ? `${locNum((abs / 1e3).toFixed(1))}K` : locNum(abs.toFixed(2));
  return `${cu || '?'} ${sign}${n}`;
}

// A price in the currency a form was filed in: "R$17.98", "$50.00", "MXN 17.28".
const CUR_SIGN = { USD: '$', BRL: 'R$', EUR: '€', GBP: '£', JPY: '¥' };
export function fmtFormPrice(cu, p) {
  if (p == null || Number.isNaN(p)) return '—';
  const n = locNum(Number(p).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 }));
  return CUR_SIGN[cu] ? `${CUR_SIGN[cu]}${n}` : `${cu || ''} ${n}`.trim();
}

// Run `fn` with the formatters in `lang`, then put the page's language back.
// For text builders that are told their language (SEO templates, answer box)
// and may be called outside a page render: scripts, tests, the report build.
export function withFormatLang(lang, fn) {
  const prev = active;
  setFormatLang(lang);
  try {
    return fn();
  } finally {
    active = prev;
  }
}
