// The buy/sell split of a day summary (api/_lib/insiderModel.js daySummary),
// in whole percents that add up to 100 — computed from the server's sell
// share only, so the home page and /insiders cannot round differently.
export const pulsePercents = (s) => {
  if (s?.sellShare == null) return { buy: null, sell: null };
  const sell = Math.round(s.sellShare);
  return { buy: 100 - sell, sell };
};

export const pulseDate = (day, locale) =>
  day ? new Date(`${day}T00:00:00Z`).toLocaleDateString(locale, { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }) : '—';
