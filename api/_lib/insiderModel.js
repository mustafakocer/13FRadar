// Shared shape + classification for SEC Form 4 (insider) transactions.
//
// Rows are stored with short keys because the dataset holds a year of
// transactions and ships inside the serverless bundle:
//   t ticker · c company · ci issuer CIK · n insider · r role · ti title
//   d transaction date · f filing date · k transaction code
//   s shares · p price · v value · o shares owned after · oc ownership change %
//   a accession
export const ROLES = ['ceo', 'cfo', 'officer', 'director', 'owner10'];

// SEC transaction codes we keep. P/S are open-market trades — the only ones
// that carry a real signal; A (grant) and M (option exercise) are compensation.
export const CODES = { P: 'buy', S: 'sell', A: 'award', M: 'exercise' };

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

// Cluster buys: two or more distinct insiders buying the same issuer inside
// `windowDays`. Returns a Map ticker -> {insiders, value, from, to}.
export function findClusters(rows, windowDays = 30) {
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
