// How strong a signal one insider line is: Güçlü / Orta / Zayıf / Sinyal yok
// (strong / medium / weak / none), with the reason spelled out so every
// label on the site can say why it is what it is.
//
// Only OPEN-MARKET BUYS are rated. A sale, an option exercise, an award, a
// tax withholding — anything else — is 'none'. Thresholds live in
// insiderSignalConfig.js. The rules, in order:
//
//   none    not an open-market buy · a planned (10b5-1) trade · no price ·
//           value under SIGNAL.minValue
//   strong  a CEO, CFO, President/Chair or COO buying ≥ strongTopValue, or
//           any officer/director buying ≥ strongInsiderValue AND raising
//           their holding by ≥ strongOwnIncreasePct
//   medium  an officer/director buying ≥ mediumValue, or anyone raising
//           their holding by ≥ mediumOwnIncreasePct
//   weak    every other open-market buy that got this far
//
// A 10% owner who is not an officer or director, and a fund or company, is
// capped at 'weak' and carries `largeHolder` ("Büyük ortak (fon)" on the
// page): a fund topping up a stake is not an executive betting their own
// money.
//
// `context` is where later rules plug in without touching these: the
// cluster-buy work (roadmap item 3) will pass `{ cluster }` here.
import { classify } from './insiderClassify.js';
import { SIGNAL } from './insiderSignalConfig.js';

export const LEVELS = ['none', 'weak', 'medium', 'strong'];
const rank = (l) => LEVELS.indexOf(l);

const TOP_TITLE_RE = /\b(president|chair(man|woman|person)?|coo|chief operating officer)\b/i;
const NOT_TOP_RE = /\b(vice|vp|svp|evp|assistant|division|regional)\b/i;
export function isTopExecutive(r) {
  if (r?.r === 'ceo' || r?.r === 'cfo') return true;
  const title = String(r?.ti || '');
  return TOP_TITLE_RE.test(title) && !NOT_TOP_RE.test(title);
}
const isOfficerOrDirector = (r) => ['ceo', 'cfo', 'officer', 'director'].includes(r?.r);

// How much the buy raised the holding, in percent; Infinity for a new
// position (the shares bought are all the shares held).
export function ownIncreasePct(r) {
  if (r?.o != null && r?.s != null && r.o > 0 && r.o === r.s) return Infinity;
  return Number.isFinite(r?.oc) ? r.oc : null;
}

// A short role word for the reason line.
function roleWord(r, c) {
  if (c.fund_insider) return 'fund';
  if (r?.r === 'ceo') return 'ceo';
  if (r?.r === 'cfo') return 'cfo';
  if (isTopExecutive(r)) return 'top';
  if (c.ten_pct_owner_only || r?.r === 'owner10') return 'owner10';
  if (r?.r === 'director') return 'director';
  return 'officer';
}

// → { level, why, role, value, ownIncrease, largeHolder }
//   why  the rule that decided it: not_open_buy · plan · zero_price · small ·
//        top_value · insider_value_own · insider_value · own_increase · base
export function signalLevel(r, context = {}) {
  const c = context.classification || classify(r);
  const value = Number.isFinite(r?.v) ? r.v : null;
  const inc = ownIncreasePct(r);
  const out = (level, why) => ({ level, why, role: roleWord(r, c), value, ownIncrease: inc, largeHolder: c.ten_pct_owner_only || c.fund_insider });

  if (c.category !== 'open_buy') return out('none', 'not_open_buy');
  if (c.plan_trade) return out('none', 'plan');
  if (c.zero_price) return out('none', 'zero_price');
  if (!(value >= SIGNAL.minValue)) return out('none', 'small');

  let level = 'weak';
  let why = 'base';
  const insider = isOfficerOrDirector(r) && !c.fund_insider;
  if (isTopExecutive(r) && !c.fund_insider && value >= SIGNAL.strongTopValue) [level, why] = ['strong', 'top_value'];
  else if (insider && value >= SIGNAL.strongInsiderValue && inc != null && inc >= SIGNAL.strongOwnIncreasePct) [level, why] = ['strong', 'insider_value_own'];
  else if (insider && value >= SIGNAL.mediumValue) [level, why] = ['medium', 'insider_value'];
  else if (inc != null && inc >= SIGNAL.mediumOwnIncreasePct) [level, why] = ['medium', 'own_increase'];

  // funds and pure 10% owners: at most weak
  if ((c.ten_pct_owner_only || c.fund_insider) && rank(level) > rank('weak')) {
    level = 'weak';
    why = 'large_holder_cap';
  }
  return out(level, why);
}
