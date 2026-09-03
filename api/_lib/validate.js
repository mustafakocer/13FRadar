// @ts-check
// Small request validators. Each returns the normalised value or null.

/** @param {unknown} v */
export const cik = (v) => {
  const s = String(v ?? '').replace(/\D/g, '');
  return s.length >= 1 && s.length <= 10 ? s : null;
};

/** @param {unknown} v */
export const cusip = (v) => {
  const s = String(v ?? '').toUpperCase().trim();
  return /^[0-9A-Z]{9}$/.test(s) ? s : null;
};

/** @param {unknown} v */
export const ticker = (v) => {
  const s = String(v ?? '').toUpperCase().trim();
  return /^[A-Z0-9.-]{1,10}$/.test(s) ? s : null;
};

/** @param {unknown} v */
export const accession = (v) => {
  const s = String(v ?? '').trim();
  return /^\d{10}-\d{2}-\d{6}$/.test(s) ? s : null;
};

/** YYYY-MM-DD @param {unknown} v */
export const isoDate = (v) => {
  const s = String(v ?? '').trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s)) ? s : null;
};

/** @param {unknown} v @param {number} min @param {number} max @param {number} dflt */
export const intIn = (v, min, max, dflt) => {
  if (v === undefined || v === null || v === '') return dflt;
  const n = Number(v);
  if (!Number.isInteger(n)) return null;
  return Math.min(max, Math.max(min, n));
};

/** @param {unknown} v @param {readonly string[]} allowed @param {string} dflt */
export const oneOf = (v, allowed, dflt) => {
  if (v === undefined || v === null || v === '') return dflt;
  const s = String(v);
  return allowed.includes(s) ? s : null;
};

/** @param {any} res @param {string} msg */
export const bad = (res, msg) => res.status(400).json({ error: msg });
