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
//   preferred   any code, in a preferred stock that is not the quoted
//               security (DFDV's Series C Perpetual Preferred) — own label,
//               never a return computed from the common stock's price
//   other_security  warrants, rights, notes, SPAC units… (same rule)
// The last two come from the Form 4 security title (`sk` on the served
// row, api/_lib/fpiNormalize.securityKind).
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
export const CATEGORIES = ['open_buy', 'open_sell', 'exercise', 'award', 'tax', 'gift', 'conversion', 'preferred', 'other_security', 'other'];
export const OPEN_MARKET = new Set(['open_buy', 'open_sell']);

// Which way the shares moved, for the buy/sell tabs when "other types" are on.
const SELL_SIDE = new Set(['open_sell', 'tax', 'gift']);
const SELL_CODES = new Set(['S', 'D', 'F', 'G']);

const price = (r) => Number(r?.p);
export const hasPrice = (r) => Number.isFinite(price(r)) && price(r) > 0;

export function categorize(r) {
  const code = String(r?.k || '').trim().toUpperCase();
  const derivative = Boolean(r?.dv);
  if (r?.sk === 'preferred') return 'preferred';
  if (r?.sk === 'other') return 'other_security';
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
  if (category === 'other' || category === 'preferred' || category === 'other_security') return SELL_CODES.has(String(r?.k || '').toUpperCase()) ? 'sell' : 'buy';
  return 'buy';
}

// Is the reporting owner a fund or company rather than a person? Form 4 has
// no "entity" box, so this reads what the form does say:
//   · the relationship flags: an owner filing as an officer (with a title),
//     CEO or CFO is a person, whatever the name looks like;
//   · the owner's name ending in / containing a legal-form or investment
//     word — LLC, LP, Fund, Capital, Management, Trust, Holdings, Inc…
// A 10% owner who is a PERSON is not a fund: "White Parker" (DFDV) is an
// individual filing only as a 10% owner and used to be labelled "Büyük ortak
// (fon)" because every 10%-only owner was. Those now get their own label
// (ten_pct_owner_only without fund_insider).
// Legal forms: only a company carries these — never a person, whatever role
// the form gives it. Checked anywhere in the name, and the short ones (Co,
// SA, AG, NV…) only as the last word, where they cannot be an initial.
const LEGAL_RE = /\b(llc|l\.l\.c|l\.?\s?p|llp|l\.l\.p|inc|incorporated|corp|corporation|company|ltd|limited|plc|gmbh)\b\.?/i;
const LEGAL_TAIL_RE = /\b(co|s\.?a|a\.?g|n\.?v|b\.?v|s\.?p\.?a|s\.?e|a\.?b)\.?$/i;
// Investment words: a fund or vehicle — unless the form says this owner is
// a director, an officer (with a title), CEO or CFO, which only a person can be
// ("HOLDING FRANK B JR" is Mr Holding).
const VEHICLE_RE =
  /\b(fund|funds|capital|partners|partnership|management|advisors|advisers|holdings?|trust|investments?|ventures|foundation|bank|bancorp|insurance|pension|plan|endowment|association|university|investors|sponsor|retirement|caisse|placement|sicav|ucits)\b/i;
const clean = (name) => String(name || '').replace(/,/g, ' ').replace(/\s+/g, ' ').trim();
export const isEntityName = (name) => LEGAL_RE.test(clean(name)) || LEGAL_TAIL_RE.test(clean(name)) || VEHICLE_RE.test(clean(name));

const truthy = (x) => x === 1 || x === true || x === '1';

export function isFundInsider(r) {
  const name = clean(r?.n);
  if (LEGAL_RE.test(name) || LEGAL_TAIL_RE.test(name)) return true;
  if (!VEHICLE_RE.test(name)) return false;
  // a person's role on the form wins over a name that happens to look like a fund
  if (r?.r === 'ceo' || r?.r === 'cfo' || r?.r === 'director') return false;
  if (r?.r === 'officer' && r?.ti) return false;
  return true;
}

export function flagsOf(r) {
  const officerOrDirector = ['ceo', 'cfo', 'officer', 'director'].includes(r?.r);
  // `r` (role) is 'owner10' only when the owner is not an officer or
  // director; the raw flags, when the row carries them, say it directly
  const tenPctOnly = r?.tp != null || r?.of != null || r?.dr != null ? truthy(r.tp) && !truthy(r.of) && !truthy(r.dr) : r?.r === 'owner10' && !officerOrDirector;
  return {
    plan_trade: Boolean(r?.p5 || r?.pn),
    ten_pct_owner_only: tenPctOnly,
    fund_insider: isFundInsider(r),
    zero_price: !hasPrice(r),
    // the price on the form is more than 25% away from that day's market
    // close — almost always a foreign currency or a per-ADR/per-share unit
    // mix-up (set by the nightly build, insiderOutcome.checkPriceUnits)
    price_unverified: Boolean(r?.pu),
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
