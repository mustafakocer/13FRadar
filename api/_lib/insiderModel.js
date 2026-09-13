// Shared shape + classification for SEC Form 4 (insider) transactions.
//
// Rows are stored with short keys because the dataset holds a year of
// transactions and ships inside the serverless bundle:
//   t ticker · c company · ci issuer CIK · n insider · r role · ti title
//   d transaction date · f filing date · k transaction code
//   s shares · p price · v value · o shares owned after · oc ownership change %
//   a accession
export const ROLES = ['ceo', 'cfo', 'officer', 'director', 'owner10'];

// SEC Form 4 transaction codes and how they are classified:
//   High conviction — P open-market buy · C conversion · M/X option exercise
//                      when nothing was sold in the same filing (exercise-and-hold)
//   Liquidity       — S open-market sale · D disposition to the issuer / tender
//                      · M/X exercise with a same-filing sale (cash-out)
//   Noise           — A grant/award · F tax withholding · G gift · W will/
//                      inheritance · J other · I discretionary · L small
// The feed hides Noise unless asked; rows carry `cl` (class) and `p5`
// (Rule 10b5-1 planned trade) from the build script.
export const CODES = { P: 'buy', S: 'sell', A: 'award', M: 'exercise', X: 'exercise', C: 'conversion', D: 'disposition', F: 'tax', G: 'gift', W: 'will', J: 'other', I: 'discretionary', L: 'small' };
export const KEPT_CODES = new Set(Object.keys(CODES));
export const CLASSES = ['conviction', 'liquidity', 'noise'];

export function classifyTransaction(code, { sameFilingSale = false } = {}) {
  switch (String(code || '').toUpperCase()) {
    case 'P':
    case 'C':
      return 'conviction';
    case 'M':
    case 'X':
      return sameFilingSale ? 'liquidity' : 'conviction';
    case 'S':
    case 'D':
      return 'liquidity';
    default:
      return 'noise';
  }
}
export const rowClass = (r) => r.cl || classifyTransaction(r.k);

const CEO_RE = /\b(chief executive|ceo|president and chief executive|pres(ident)? & ceo)\b/i;
const CFO_RE = /\b(chief financial|cfo|principal financial officer|treasurer)\b/i;

// Officer title strings are free text on Form 4; classify them once at build
// time so the API can filter on a stable value.
export function classifyRole({ title = '', isDirector, isOfficer, isTenPercentOwner }) {
  const t = String(title || '');
  if (CEO_RE.test(t)) return 'ceo';
  if (CFO_RE.test(t)) return 'cfo';
  if (isOfficer) return 'officer';
  if (isDirector) return 'director';
  if (isTenPercentOwner) return 'owner10';
  return 'officer';
}

export const isBuy = (r) => r.k === 'P';
export const isSell = (r) => r.k === 'S';

// Business days between the transaction and the filing. The SEC deadline is
// 2 business days; anything later is a "late filing".
export function filingLagDays(transDate, filedDate) {
  if (!transDate || !filedDate) return null;
  const a = new Date(`${transDate}T00:00:00Z`);
  const b = new Date(`${filedDate}T00:00:00Z`);
  const days = Math.round((b - a) / 86400000);
  return days >= 0 && days < 400 ? days : null;
}

export function businessDaysBetween(transDate, filedDate) {
  const a = new Date(`${transDate}T00:00:00Z`);
  const b = new Date(`${filedDate}T00:00:00Z`);
  if (!(a <= b)) return null;
  let n = 0;
  const cur = new Date(a);
  while (cur < b) {
    cur.setUTCDate(cur.getUTCDate() + 1);
    const d = cur.getUTCDay();
    if (d !== 0 && d !== 6) n++;
  }
  return n;
}

export const isLate = (r) => {
  const bd = businessDaysBetween(r.d, r.f);
  return bd != null && bd > 2;
};

// Market-cap buckets, matching the labels used across the app.
export function sizeBucket(marketCap) {
  if (!Number.isFinite(marketCap) || marketCap <= 0) return null;
  if (marketCap >= 200e9) return 'mega';
  if (marketCap >= 10e9) return 'large';
  if (marketCap >= 2e9) return 'mid';
  if (marketCap >= 300e6) return 'small';
  return 'micro';
}

// Cluster buys: two or more distinct insiders with open-market purchases
// (code P) of the same issuer inside a 7-day window.
// Returns a Map ticker -> {insiders, value, from, to}.
export function findClusters(rows, windowDays = 7) {
  const byTicker = new Map();
  for (const r of rows) {
    if (!isBuy(r) || !r.t) continue;
    if (!byTicker.has(r.t)) byTicker.set(r.t, []);
    byTicker.get(r.t).push(r);
  }
  const out = new Map();
  const ms = windowDays * 86400000;
  for (const [ticker, list] of byTicker) {
    list.sort((a, b) => (a.d < b.d ? -1 : 1));
    // sliding window over transaction dates
    let best = null;
    for (let i = 0; i < list.length; i++) {
      const start = new Date(`${list[i].d}T00:00:00Z`).getTime();
      const names = new Set();
      let value = 0;
      let j = i;
      for (; j < list.length; j++) {
        if (new Date(`${list[j].d}T00:00:00Z`).getTime() - start > ms) break;
        names.add(list[j].n);
        value += list[j].v || 0;
      }
      if (names.size >= 2 && (!best || names.size > best.insiders || value > best.value)) {
        best = { insiders: names.size, value, from: list[i].d, to: list[j - 1].d };
      }
    }
    if (best) out.set(ticker, best);
  }
  return out;
}

// ---------------------------------------------------------------- crawl plan
export const prevDay = (day) =>
  new Date(new Date(`${day}T00:00:00Z`).getTime() - 86400000).toISOString().slice(0, 10);

// Which days the daily-index crawl should fetch next, and where the checkpoint
// lands if it fetches none of them.
//
// EDGAR answers 403 — not 404 — for a daily-index file that does not exist,
// and every federal holiday is such a day, so a holiday is indistinguishable
// from a rate-limit refusal. `published(day)` returns the set of days EDGAR
// actually listed for that day's quarter (or null when the listing could not
// be read, in which case the day is kept and probed as before).
//
// The checkpoint moves past every settled day — already stored, or never
// published — even when the fetch fails. Without that, a single holiday
// stalls the crawl on the same date forever.
export function selectScanDays({ fromDay, today, published = () => null, maxDays = 25, lookback = 400 }) {
  const all = [];
  const start = new Date(`${today}T00:00:00Z`).getTime();
  for (let i = 0; i < lookback; i++) {
    const d = new Date(start - i * 86400000);
    const day = d.toISOString().slice(0, 10);
    if (day <= fromDay) break;
    const dow = d.getUTCDay();
    if (dow === 0 || dow === 6) continue;
    all.push(day);
  }
  all.reverse();

  const candidates = [];
  const skipped = [];
  for (const day of all) {
    const set = published(day);
    if (!set || set.has(day)) candidates.push(day);
    else skipped.push(day);
  }

  const days = candidates.slice(0, maxDays);
  const checkpoint = days.length ? prevDay(days[0]) : all.length ? all[all.length - 1] : fromDay;
  return { days, skipped, checkpoint, remaining: candidates.length - days.length };
}
