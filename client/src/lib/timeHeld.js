// Mirrors api/_lib/history.js timeHeldLabel for the client bundle.
export function timeHeldLabel(quarters, lang = 'en') {
  if (!quarters) return null;
  if (quarters >= 40) return lang === 'tr' ? '>10 Yıl' : '>10 Years';
  const years = quarters / 4;
  if (years < 1) return lang === 'tr' ? `${quarters} Çeyrek` : `${quarters} Q`;
  const y = Math.round(years * 10) / 10;
  return lang === 'tr' ? `${y} Yıl` : `${y} Year${y === 1 ? '' : 's'}`;
}
