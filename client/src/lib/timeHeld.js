// "Time held": consecutive quarters up to and including the latest, as text.
// The one implementation for the server (api/_lib/history.js re-exports it)
// and the client bundle.
//
// The history reaches back 40 quarters (less for a guru whose feed starts
// later): a position held since the first quarter of the data may be held
// much longer — Berkshire has owned KO since 1988, not "9.8 years". Given
// `dataFrom` (the first quarter of the data, set when the streak reaches
// it) the label says so: "9.8+ Yıl (veri 2016'dan)".
export function timeHeldLabel(quarters, lang = 'en', { dataFrom = null } = {}) {
  if (!quarters) return null;
  if (quarters >= 40) return lang === 'tr' ? '>10 Yıl' : '>10 Years';
  const years = quarters / 4;
  const y = Math.round(years * 10) / 10;
  const since = dataFrom ? Number(String(dataFrom).slice(0, 4)) : null;
  if (since) {
    const len = years < 1 ? (lang === 'tr' ? `${quarters}+ Çeyrek` : `${quarters}+ Q`) : lang === 'tr' ? `${fmtYears(y, lang)}+ Yıl` : `${fmtYears(y, lang)}+ Years`;
    return lang === 'tr' ? `${len} (veri ${since}${trAblative(since)})` : `${len} (data from ${since})`;
  }
  if (years < 1) return lang === 'tr' ? `${quarters} Çeyrek` : `${quarters} Q`;
  return lang === 'tr' ? `${fmtYears(y, lang)} Yıl` : `${y} Year${y === 1 ? '' : 's'}`;
}

const fmtYears = (y, lang) => (lang === 'tr' ? String(y).replace('.', ',') : String(y));

// Turkish ablative after a numeral, by how it is read: 2016'dan (altı),
// 2017'den (yedi), 2014'ten (dört), 2020'den (yirmi), 2010'dan (on).
const UNIT = ['', "'den", "'den", "'ten", "'ten", "'ten", "'dan", "'den", "'den", "'dan"];
const TENS = ['', "'dan", "'den", "'dan", "'tan", "'den", "'tan", "'ten", "'den", "'dan"];
export function trAblative(n) {
  const x = Math.abs(Math.trunc(n));
  if (x % 10) return UNIT[x % 10];
  if (x % 100) return TENS[(x % 100) / 10];
  if (x % 1000) return "'den";
  return "'den";
}

// A position's streak reaches back to the first quarter of the data.
export const reachesDataStart = (heldQuarters, lookback) => Number.isFinite(lookback) && lookback > 0 && heldQuarters >= lookback;
