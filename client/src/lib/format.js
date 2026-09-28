export function fmtMoney(v, { compact = true } = {}) {
  if (v == null || Number.isNaN(v)) return '—';
  const abs = Math.abs(v);
  if (!compact) return '$' + v.toLocaleString('en-US', { maximumFractionDigits: 0 });
  const sign = v < 0 ? '-' : '';
  if (abs >= 1e12) return `${sign}$${(abs / 1e12).toFixed(2)}T`;
  if (abs >= 1e9) return `${sign}$${(abs / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `${sign}$${(abs / 1e3).toFixed(1)}K`;
  return `${sign}$${abs.toFixed(2)}`;
}

export function fmtNum(v, digits = 0) {
  if (v == null || Number.isNaN(v)) return '—';
  return v.toLocaleString('en-US', { maximumFractionDigits: digits });
}

export function fmtPct(v, { sign = true, digits = 1 } = {}) {
  if (v == null || Number.isNaN(v)) return '—';
  const s = sign && v > 0 ? '+' : '';
  return `${s}${v.toFixed(digits)}%`;
}

// Yahoo ratios like margins/ROE come as fractions (0.245 -> 24.5%)
export const fmtFracPct = (v, opts) => (v == null ? '—' : fmtPct(v * 100, { sign: false, ...opts }));

export const fmtRatio = (v, digits = 2) =>
  v == null || Number.isNaN(v) ? '—' : Number(v).toFixed(digits);

// buy = increase, sell = decrease; zero is neither, so it stays uncoloured
export const deltaClass = (v) => (v == null || v === 0 ? '' : v > 0 ? 'delta-pos' : 'delta-neg');

// Turnover is a trading measure (see api/_lib/turnover.js): a quarter with
// any trade is never "0%", it is "<0.1%" — otherwise the number sits next to
// "1 new · 1 exited" and contradicts it.
export function fmtTurnover(v) {
  if (v == null || Number.isNaN(v)) return '—';
  if (v > 0 && v < 0.05) return '<0.1%';
  return fmtPct(v, { sign: false });
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
  const n = abs >= 1e9 ? `${(abs / 1e9).toFixed(2)}B` : abs >= 1e6 ? `${(abs / 1e6).toFixed(2)}M` : abs >= 1e3 ? `${(abs / 1e3).toFixed(1)}K` : abs.toFixed(2);
  return `${cu || '?'} ${sign}${n}`;
}

// A price in the currency a form was filed in: "R$17.98", "$50.00", "MXN 17.28".
const CUR_SIGN = { USD: '$', BRL: 'R$', EUR: '€', GBP: '£', JPY: '¥' };
export function fmtFormPrice(cu, p) {
  if (p == null || Number.isNaN(p)) return '—';
  const n = Number(p).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 });
  return CUR_SIGN[cu] ? `${CUR_SIGN[cu]}${n}` : `${cu || ''} ${n}`.trim();
}
