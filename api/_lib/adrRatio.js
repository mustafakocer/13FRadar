// How many home-market shares one US-listed depositary share (ADS / ADR)
// stands for — the "ADR ratio". Taiwan Semiconductor directors report
// their trades per common share in New Taiwan dollars; the stock the site
// quotes is the ADS, which is several of those shares. Without the ratio
// both the price and the share count are off by that factor.
//
// Convention everywhere: ratio = home-market units per ONE US security.
//   "each ADS represents five common shares"          → 5
//   "each ADS represents one-fifth of one ordinary share" → 0.2
//   "five ADSs represent one ordinary share"          → 0.2
//
// Where a ratio comes from, most trusted first (recorded as `src`):
//   f6        the depositary's F-6 registration statement at the SEC
//   20f       the cover page of the issuer's 20-F annual report (the
//             exchange-registration table names the ADS and its ratio)
//   footnote  a Form 4 footnote ("Each ADS represents 8 ordinary shares")
//   override  config/adr-overrides.json, a person's reviewed correction
//   derived   ADS close ÷ (home price × exchange rate), accepted only when it
//             lands within ±10% of a common ratio — see deriveRatio
// scripts/build-fpi.mjs collects the first two nightly; fpiNormalize.js
// applies them.

const WORDS = {
  one: 1, a: 1, an: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, fifteen: 15, sixteen: 16, twenty: 20, 'twenty-five': 25, thirty: 30, forty: 40, fifty: 50,
  hundred: 100, 'one hundred': 100, 'two hundred': 200, thousand: 1000, 'one thousand': 1000,
};
const FRACTIONS = {
  half: 2, third: 3, quarter: 4, fourth: 4, fifth: 5, sixth: 6, eighth: 8, tenth: 10, twentieth: 20, fortieth: 40, fiftieth: 50, hundredth: 100,
};
const NUM = String.raw`(\d+(?:[.,]\d+)?|one[- ]hundred|one[- ]thousand|(?:twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)[- ](?:one|two|three|four|five|six|seven|eight|nine)|[a-z]+)(?:\s*\(\s*(\d+(?:\.\d+)?)\s*\))?`;
const FRACTION = String.raw`(one|a|an)[- ](half|third|quarter|fourth|fifth|sixth|eighth|tenth|twentieth|fortieth|fiftieth|hundredth)`;
const ADS = String.raw`(?:american depositary shares?|american depositary receipts?|adss?|adrs?|depositary shares?)`;
const UNDERLYING = String.raw`(?:of\s+(?:one|an?|1)\s+)?(?:fully[- ]paid\s+|issued\s+)?(ordinary|common|class\s+[a-z]|series\s+[a-z]|preferred|preference|non[- ]voting|voting|cpos?|participation|equity|h|a|b|registered|bearer|units?|shares?)`;

const TENS = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
const toNumber = (w, digits) => {
  if (digits) return Number(digits);
  const s = String(w || '').toLowerCase().replace(/\s+/g, ' ').replace('-', ' ');
  if (/^\d/.test(s)) return Number(s.replace(',', '.'));
  const [a, b] = s.split(' ');
  if (TENS[a] && b && WORDS[b] < 10) return TENS[a] + WORDS[b]; // "forty-five"
  return WORDS[s] ?? WORDS[s.replace(' ', '-')] ?? TENS[s] ?? null;
};

// The underlying class a sentence names, for telling BBD's preferred ADS
// (the ADS IS preferred stock) from a preferred-stock trade elsewhere.
const underlyingOf = (word) => {
  const w = String(word || '').toLowerCase();
  if (/preferred|preference/.test(w)) return 'preferred';
  if (/cpo|participation/.test(w)) return 'cpo';
  if (/unit/.test(w)) return 'unit';
  return 'ordinary';
};

// Every ratio statement in `text` → [{ ratio, underlying, quote }].
export function parseRatios(text) {
  if (!text) return [];
  const s = String(text).replace(/\s+/g, ' ');
  const out = [];
  const push = (ratio, underlying, index, len) => {
    if (!(ratio > 0) || ratio > 10000) return;
    const quote = s.slice(Math.max(0, index - 20), Math.min(s.length, index + len + 20)).trim();
    out.push({ ratio: Number(ratio.toPrecision(6)), underlying: underlyingOf(underlying), quote });
  };
  // "each ADS represents one-fifth of one Class A ordinary share"
  const fracRe = new RegExp(String.raw`${ADS}[^.;]{0,60}?(?:represents?|representing|evidencing|evidences?)\s+(?:the right to receive\s+)?${FRACTION}\s+${UNDERLYING}`, 'gi');
  for (const m of s.matchAll(fracRe)) push(1 / FRACTIONS[m[2].toLowerCase()], m[3], m.index, m[0].length);
  // "each ADS represents five (5) common shares", "ADSs, each representing 10 CPOs"
  const fwdRe = new RegExp(String.raw`${ADS}[^.;]{0,60}?(?:represents?|representing|evidencing|evidences?|equals?|equal to)\s+(?:the right to receive\s+)?${NUM}\s+${UNDERLYING}`, 'gi');
  for (const m of s.matchAll(fwdRe)) {
    if (new RegExp(`^${FRACTION}`, 'i').test(s.slice(m.index + m[0].indexOf(m[1])))) continue;
    // "five ADSs represent one share" is the inverse form, read below
    const before = s.slice(Math.max(0, m.index - 20), m.index);
    if (/\b(\d+|two|three|four|five|six|seven|eight|nine|ten|twenty|fifty|hundred)\s+$/i.test(before)) continue;
    push(toNumber(m[1], m[2]), m[3], m.index, m[0].length);
  }
  // "five ADSs represent one ordinary share", "one ordinary share per 5 ADSs"
  const invRe = new RegExp(String.raw`\b${NUM}\s+${ADS}\s+(?:represent|representing|each representing|equals?|equal to|evidence)\s+(?:one|an?|1)\s+${UNDERLYING}`, 'gi');
  for (const m of s.matchAll(invRe)) {
    const n = toNumber(m[1], m[2]);
    if (n > 1) push(1 / n, m[3], m.index, m[0].length);
  }
  const perRe = new RegExp(String.raw`\b${NUM}\s+${UNDERLYING}[^.;]{0,20}?\s+(?:per|for each|for every)\s+(?:one\s+|1\s+)?${ADS}`, 'gi');
  for (const m of s.matchAll(perRe)) push(toNumber(m[1], m[2]), m[3], m.index, m[0].length);
  return out;
}

// The ratio a document states, when its statements agree (the most frequent
// one otherwise, since an F-6 also quotes the ratio of older ADR series).
// "changed the ratio … from one ADS representing fifteen Class A ordinary
// shares to one ADS representing forty-five" — the ratio now is the second.
const CHANGE_RE = new RegExp(String.raw`from\s+(?:one|1)\s+${ADS}\s+(?:representing|to)\s+[^.;]{0,80}?\bto\s+(?:one|1)\s+${ADS}\s+(?:representing|to)\s+`, 'i');
export function statedRatio(text) {
  const s = String(text || '').replace(/\s+/g, ' ');
  const change = CHANGE_RE.exec(s);
  if (change) {
    const after = parseRatios(`each ADS representing ${s.slice(change.index + change[0].length, change.index + change[0].length + 120)}`);
    if (after.length) return { ...after[0], quote: s.slice(change.index, change.index + change[0].length + 60).trim() };
  }
  const all = parseRatios(text);
  if (!all.length) return null;
  const count = new Map();
  for (const x of all) count.set(x.ratio, (count.get(x.ratio) || 0) + 1);
  const best = [...count.entries()].sort((a, b) => b[1] - a[1])[0][0];
  return all.find((x) => x.ratio === best);
}

// Common ratios; a derived ratio must land within ±10% of one of them.
export const COMMON_RATIOS = [0.01, 0.02, 0.025, 0.04, 0.05, 0.1, 0.125, 0.2, 0.25, 1 / 3, 0.5, 1, 2, 3, 4, 5, 6, 8, 10, 12, 15, 16, 20, 25, 30, 40, 50, 100];
export const DERIVE_TOLERANCE = 0.1;

// usClose (USD per US security) ÷ (home price × USD per home unit) → the
// nearest common ratio, or null when nothing is within ±10%.
export function snapRatio(x) {
  if (!(x > 0) || !Number.isFinite(x)) return null;
  let best = null;
  for (const c of COMMON_RATIOS) {
    const off = Math.abs(x / c - 1);
    if (off <= DERIVE_TOLERANCE && (!best || off < best.off)) best = { ratio: Number(c.toPrecision(6)), off };
  }
  return best ? best.ratio : null;
}
export function deriveRatio(usClose, homePrice, usdPerHomeUnit) {
  if (!(usClose > 0) || !(homePrice > 0) || !(usdPerHomeUnit > 0)) return null;
  return snapRatio(usClose / (homePrice * usdPerHomeUnit));
}
