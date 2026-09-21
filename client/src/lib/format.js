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
