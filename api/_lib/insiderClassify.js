// What kind of transaction a Form 4 line is — the one definition every page
// uses (the feed, its counts, the home widgets, the stock page, alerts).
//
// Before this module the site sorted lines into "conviction / liquidity /
// noise" by code alone, so an option exercise at $0.49 (M), a conversion (C)
// and a $0 share award all appeared in the default feed as "Güçlü sinyal".
// Now a line is one of these categories:
//
//   open_buy    P, not a derivative, price > 0     açık piyasa alımı
//   open_sell   S, not a derivative, price > 0     açık piyasa satışı
//   exercise    M, X                               opsiyon / hak kullanımı
//   award       A                                  hisse ödülü
//   tax         F                                  vergi kesintisi
//   gift        G                                  bağış / hediye
//   conversion  C                                  dönüşüm
//   other       everything else (D, J, I, W, L, and P/S with no price)
//
// plus flags that do not change the category but do change what a line
// means as a signal (insiderSignal.js):
//   plan_trade          Rule 10b5-1 box ticked, or a footnote says "10b5-1"
//                       / "trading plan" (`p5` / `pn` on the stored row)
//   ten_pct_owner_only  a 10% owner who is neither officer nor director
//   fund_insider        the reporting owner is a fund or company, not a person
//   zero_price          price is 0 or missing
//
// The stored dataset only holds non-derivative lines today, so `dv` (the
// derivative flag) is absent and read as false; the rule is here so a
// derivative line can never be taken for an open-market trade later.
export const CATEGORIES = ['open_buy', 'open_sell', 'exercise', 'award', 'tax', 'gift', 'conversion', 'other'];
export const OPEN_MARKET = new Set(['open_buy', 'open_sell']);

// Which way the shares moved, for the buy/sell tabs when "other types" are on.
const SELL_SIDE = new Set(['open_sell', 'tax', 'gift']);
const SELL_CODES = new Set(['S', 'D', 'F', 'G']);

const price = (r) => Number(r?.p);
export const hasPrice = (r) => Number.isFinite(price(r)) && price(r) > 0;

export function categorize(r) {
  const code = String(r?.k || '').trim().toUpperCase();
  const derivative = Boolean(r?.dv);
  switch (code) {
    case 'P':
      return !derivative && hasPrice(r) ? 'open_buy' : 'other';
    case 'S':
      return !derivative && hasPrice(r) ? 'open_sell' : 'other';
    case 'M':
    case 'X':
      return 'exercise';
    case 'A':
      return 'award';
    case 'F':
      return 'tax';
    case 'G':
      return 'gift';
    case 'C':
      return 'conversion';
    default:
      return 'other';
  }
}

// 'buy' or 'sell' for the tab a line belongs to; a P/S without a price
// ("other") still follows its code.
export function sideOf(r, category = categorize(r)) {
  if (SELL_SIDE.has(category)) return 'sell';
  if (category === 'other') return SELL_CODES.has(String(r?.k || '').toUpperCase()) ? 'sell' : 'buy';
  return 'buy';
}

// A person's name on Form 4 reads "Last First Middle"; an entity carries a
// legal form or an investment word. Matching the words, not the case, keeps
// "Mink Brook Asset Management LLC" and "HORIZON KINETICS ASSET MANAGEMENT
// LLC" out of the people column. A family trust is caught too, which is the
// intent: it is a holding vehicle, not an executive.
const ENTITY_RE =
  /\b(llc|l\.l\.c|lp|l\.p|llp|inc|incorporated|corp|corporation|company|ltd|limited|plc|gmbh|fund|funds|capital|partners|partnership|management|advisors|advisers|holdings?|trust|group|investments?|asset|assets|ventures|equity|associates|foundation|bank|bancorp|securities|enterprises)\b\.?/i;
export const isEntityName = (name) => ENTITY_RE.test(String(name || '').replace(/[,]/g, ' '));

const truthy = (x) => x === 1 || x === true || x === '1';

export function flagsOf(r) {
  const officerOrDirector = ['ceo', 'cfo', 'officer', 'director'].includes(r?.r);
  // `r` (role) is 'owner10' only when the owner is not an officer or
  // director; the raw flags, when the row carries them, say it directly
  const tenPctOnly = r?.tp != null || r?.of != null || r?.dr != null ? truthy(r.tp) && !truthy(r.of) && !truthy(r.dr) : r?.r === 'owner10' && !officerOrDirector;
  return {
    plan_trade: Boolean(r?.p5 || r?.pn),
    ten_pct_owner_only: tenPctOnly,
    fund_insider: isEntityName(r?.n),
    zero_price: !hasPrice(r),
  };
}

// Everything a page needs about a line's kind, in one call.
export function classify(r) {
  const category = categorize(r);
  return { category, side: sideOf(r, category), openMarket: OPEN_MARKET.has(category), ...flagsOf(r) };
}

// Footnote text that marks a planned trade even when the checkbox is empty
// (the box only exists on filings made after April 2023).
export const PLAN_NOTE_RE = /10b5-?1|trading plan/i;
