// Does the ticker on a Congress trade belong to the company the member
// named? A member writes the asset by hand ("AutoZone, Inc. Common Stock")
// and a ticker beside it; the ticker drives the price, the return, the
// stock link and the committee-field flag. A wrong one prices the trade
// with another company's series:
//   - a ticker reused since the trade (PARA: Paramount Global's in 2024,
//     Banzai International's after the Skydance merger);
//   - a slip on the form ("Crexendo, Inc." filed under EXE, Expand Energy).
// The check puts the asset text against the issuer's registered name in
// SEC's company_tickers.json (api/_data/company-names.json). A ticker SEC
// does not list (funds, delisted names) cannot be checked and is left as
// filed.
//
// Pure: no files.

// words that say nothing about which company it is
const STOP = new Set(
  'inc incorporated corp corporation co company companies ltd limited plc holdings holding group class common stock the sa nv ag se llc lp ordinary shares share ads adr adrs new com sponsored cl series of and trust fund etf de del international intl technologies technology tech'.split(' '),
);

// renames SEC's list does not carry: the ticker's earlier names, as words
// a member's form may still use
export const FORMER_NAMES = {
  GE: ['ge aerospace'],
  SLB: ['schlumberger'],
  WAB: ['wabtec'],
  PCG: ['pacific gas'],
  MSTR: ['microstrategy'],
  RTX: ['raytheon'],
  RUM: ['rumble'],
  NTTYY: ['ntt'],
  SQM: ['sociedad quimica'],
};

export const nameWords = (s) =>
  String(s || '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter((w) => w.length >= 2 && !STOP.has(w));

const sameWord = (a, b) => a === b || (b.length >= 4 && a.startsWith(b)) || (a.length >= 4 && b.startsWith(a));

// → true (the names agree, or there is nothing to judge) | false
export function tickerNameMatches(ticker, asset, secName) {
  if (!ticker || !secName) return true;
  const filed = nameWords(asset);
  // an asset written as the ticker alone, or as words that name nothing
  if (!filed.length) return true;
  const registered = [...nameWords(secName), ...(FORMER_NAMES[ticker] || []).flatMap(nameWords)];
  return registered.some((w) => filed.some((x) => sameWord(x, w)));
}

// The kinds of line whose text names the issuer.
export const CHECKED_TYPES = new Set(['stock', 'option']);
