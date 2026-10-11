// Congress trades: the served file built from the parsed filings (build
// time), and the views the API answers with (request time). Pure — files in,
// objects out — so tests pin every rule without the network.
//
// A row: { id, m (member key), d (trade day), f (disclosed day), t (ticker
// or null), a (asset as filed), at (asset type), k (buy | sell |
// sell_partial | exchange), o (self | spouse | joint | child), lo, hi
// (amount range in dollars; hi null for "Over $X"), src (filing URL), pt
// (close on the trade day, when priced), jx (the member's committees whose
// field the company is in, api/_lib/congressJurisdiction.js) }.
import { closeOnOrAfter } from './insiderOutcome.js';
import { amountMid, cleanTicker } from './congressParse.js';
import { assignSlugs, filerName, matchHouse, matchSenate, normName } from './congressMembers.js';
import { slugify } from '../../client/src/lib/slugify.js';
import { JURISDICTION, jurisdictionLabel, matchingCommittees } from './congressJurisdiction.js';

const DAY = 86400000;
const isoDay = (t) => new Date(t).toISOString().slice(0, 10);
// the oldest trade a report can plausibly disclose: three years back
const floor = (filed) => `${Number(String(filed).slice(0, 4)) - 3}${String(filed).slice(4)}`;
export const isBuy = (k) => k === 'buy';
export const isSell = (k) => k === 'sell' || k === 'sell_partial';

// ------------------------------------------------------------ build time

// A stock line filed without a ticker often carries it in the name:
// "Electronic Arts Inc. (EA)", "EA - Electronic Arts Inc", "SDZNY- Sandoz Group AG ADR".
export function tickerFromName(a) {
  const s = String(a || '');
  const m = /\(([A-Z][A-Z0-9]{0,5}(?:[./][A-Z])?)\)/.exec(s) || /^([A-Z][A-Z0-9]{0,5}(?:[./][A-Z])?)\s*-\s/.exec(s);
  return m ? cleanTicker(m[1]) : null;
}

// filings: { key: { ch, id, filed, first, last, stateDst, url, status, tx } }
export function buildServed(filings, { legislators, seats = {}, committeeNames = {}, seriesFor = () => null, sicFor = () => null, since, now = Date.now() }) {
  const members = {};
  const rows = [];
  const unmatched = new Set();
  const seen = new Set();
  const px = {};
  const sics = {};
  const priceOf = (t) => {
    if (!t) return null;
    if (px[t] !== undefined) return px[t] ? seriesFor(t) : null;
    const s = seriesFor(t);
    const last = s?.prices?.[s.prices.length - 1];
    px[t] = last && last.close > 0 ? { c: last.close, d: last.date } : null;
    return px[t] ? s : null;
  };

  const list = Object.values(filings).filter((f) => f.status === 'ok' && f.tx?.length && (!since || f.filed >= since));
  // the newest filing first, so an amendment's rows win over the original's
  list.sort((a, b) => b.filed.localeCompare(a.filed) || String(b.id).localeCompare(String(a.id)));
  for (const f of list) {
    const who = f.ch === 'S' ? matchSenate(legislators, f, f.filed) : matchHouse(legislators, f, f.filed);
    const key = who?.bioguide || `${f.ch}:${slugify(filerName(f.first, f.last))}`;
    if (!members[key]) {
      members[key] = who
        ? { n: who.full, ch: f.ch, p: who.party, st: who.state, dist: f.ch === 'H' ? (who.district ?? null) : null, bg: who.bioguide, cm: (seats[who.bioguide] || []).slice() }
        : { n: filerName(f.first, f.last), ch: f.ch, p: null, st: f.stateDst ? String(f.stateDst).slice(0, 2) : null, dist: null, bg: null, cm: [] };
      if (!who) unmatched.add(`${f.ch} ${filerName(f.first, f.last)}${f.stateDst ? ` (${f.stateDst})` : ''}`);
    }
    f.tx.forEach((tx, i) => {
      // no date, or one after the report that discloses it: a typo on the form
      // no date, a date after the report that discloses it, or one years
      // before it (2015 on a 2025 report): a typo on the form
      if (!tx.d || tx.d > f.filed || tx.d < floor(f.filed)) return;
      // an amended report repeats the original's lines: one row per trade
      const dup = [key, tx.d, tx.t || normName(tx.a), tx.k, tx.o, tx.lo, tx.hi].join('|');
      if (seen.has(dup)) return;
      seen.add(dup);
      const t = tx.t || (tx.at === 'stock' || tx.at === 'etf' ? tickerFromName(tx.a) : null);
      const row = { id: `${f.ch}:${f.id}:${i}`, m: key, d: tx.d, f: f.filed, t, a: tx.a, at: tx.at, k: tx.k, o: tx.o, lo: tx.lo, hi: tx.hi, src: f.url };
      const s = priceOf(row.t);
      if (s) {
        const bar = closeOnOrAfter(s.prices, row.d);
        if (bar && Date.parse(bar.date) - Date.parse(row.d) <= 7 * DAY) row.pt = bar.close;
      }
      const sic = row.t ? sicFor(row.t) : null;
      if (sic) {
        sics[row.t] = sic;
        const jx = matchingCommittees(members[key].cm, sic);
        if (jx.length) row.jx = jx;
      }
      rows.push(row);
    });
  }
  assignSlugs(members);
  for (const t of Object.keys(px)) if (!px[t]) delete px[t];
  const usedCommittees = {};
  for (const m of Object.values(members)) for (const c of m.cm) if (committeeNames[c]) usedCommittees[c] = committeeNames[c];
  rows.sort((a, b) => b.f.localeCompare(a.f) || b.d.localeCompare(a.d) || a.id.localeCompare(b.id));
  return annotateYtd({
    updatedAt: new Date(now).toISOString(),
    since: since || null,
    counts: {
      rows: rows.length,
      members: Object.keys(members).length,
      house: rows.filter((r) => r.id.startsWith('H:')).length,
      senate: rows.filter((r) => r.id.startsWith('S:')).length,
      priced: rows.filter((r) => r.pt).length,
      inField: rows.filter((r) => r.jx).length,
    },
    lastFiled: rows[0]?.f || null,
    members,
    committees: usedCommittees,
    px,
    sic: sics,
    rows,
    unmatched: [...unmatched].sort(),
  }, seriesFor, now);
}

// ------------------------------------------------------------ year to date

export const BENCH = 'SPY';

// The last close before `day`, when it is within ten days of it (else the
// stock was not trading at the turn of the year, or the series has a hole).
function closeBefore(prices, day) {
  if (!prices?.length) return null;
  const at = closeOnOrAfter(prices, day);
  const i = at ? prices.indexOf(at) - 1 : prices.length - 1;
  const bar = prices[i];
  return bar && bar.close > 0 && Date.parse(day) - Date.parse(bar.date) <= 10 * DAY ? bar.close : null;
}

// What the YTD board needs at request time, stamped at build time: each
// priced ticker's close at the turn of the year (px[t].y), SPY's then and
// now (bench), and SPY's close on the day of every priced trade this year
// (row.ps), so each position is measured against SPY over the same days.
// Idempotent: a re-run for a new year replaces the old stamps.
export function annotateYtd(served, seriesFor, now = Date.now()) {
  const year = new Date(now).getUTCFullYear();
  const from = `${year}-01-01`;
  for (const t of Object.keys(served.px || {})) {
    const y = closeBefore(seriesFor(t)?.prices, from);
    if (y) served.px[t].y = y;
    else delete served.px[t].y;
  }
  const spy = seriesFor(BENCH)?.prices;
  const last = spy?.[spy.length - 1];
  const y = closeBefore(spy, from);
  served.bench = last && y ? { t: BENCH, y, c: last.close, d: last.date } : null;
  for (const r of served.rows) {
    delete r.ps;
    if (!(r.pt > 0) || r.d < from || !spy) continue;
    const bar = closeOnOrAfter(spy, r.d);
    if (bar && Date.parse(bar.date) - Date.parse(r.d) <= 7 * DAY) r.ps = bar.close;
  }
  served.ytd = { year, from };
  return served;
}

// ------------------------------------------------------------ request time

// Price change since the trade, from the trade-day close to the last close.
export const rowReturn = (r, px) => {
  const c = r.t ? px?.[r.t]?.c : null;
  return r.pt > 0 && c > 0 ? c / r.pt - 1 : null;
};

// What a row looks like on the wire: the member's name and slug ride along.
export function present(db, r) {
  const m = db.members[r.m] || {};
  const field = r.jx?.length ? r.jx.map((c) => ({ id: c, name: db.committees?.[c] || c, slug: committeeSlug(db.committees?.[c] || c), label: jurisdictionLabel(c, db.sic?.[r.t]) })) : undefined;
  return { ...r, field, mid: amountMid(r), ret: rowReturn(r, db.px), cur: r.t ? db.px?.[r.t]?.c ?? null : null, n: m.n, slug: m.slug, ch: m.ch, p: m.p, st: m.st };
}

export function memberCard(db, key, rows) {
  const m = db.members[key];
  if (!m) return null;
  const mine = rows || db.rows.filter((r) => r.m === key);
  const buys = mine.filter((r) => isBuy(r.k));
  const rets = buys.map((r) => rowReturn(r, db.px)).filter((v) => v != null);
  return {
    key,
    slug: m.slug,
    n: m.n,
    ch: m.ch,
    p: m.p,
    st: m.st,
    dist: m.dist,
    bg: m.bg,
    trades: mine.length,
    buys: buys.length,
    sells: mine.filter((r) => isSell(r.k)).length,
    inField: mine.filter((r) => r.jx).length,
    volume: mine.reduce((s, r) => s + (amountMid(r) || 0), 0),
    last: mine.reduce((d, r) => (r.f > d ? r.f : d), '') || null,
    lastTrade: mine.reduce((d, r) => (r.d > d ? r.d : d), '') || null,
    // the average price change since each priced buy — not a portfolio
    // return: amounts are ranges and holdings are not disclosed
    avgBuyRet: rets.length ? rets.reduce((s, v) => s + v, 0) / rets.length : null,
    pricedBuys: rets.length,
  };
}

// A member's disclosed positions, year to date. Holdings are not disclosed
// and amounts are ranges, so this replays the trades on file as positions
// weighted by the range's midpoint:
//   - a buy opens a position: this year's at the trade-day close, an older
//     one (on file since the data starts) at the year-start close;
//   - a full sale this year closes every open position in that stock at the
//     sale-day close; a full sale before the year drops them; a partial
//     sale leaves them open (how much was sold is a range);
//   - a sale this year with no buy on file was held since at least Jan 1:
//     a position from the year-start close to the sale;
//   - what is still open is marked at the latest close;
//   - options are left out: the underlying's move is not the option's.
// The return is the amount-weighted average of the positions' returns over
// the days each was held this year; `spy` is SPY's over the very same days,
// so `excess` is skill, not timing of when the year started.
export function memberYtd(db, rows) {
  const Y = db.ytd;
  const B = db.bench;
  if (!Y || !B) return null;
  const from = Y.from;
  // a position marked at a close weeks older than SPY's (delisted, acquired)
  // cannot be compared over the same days
  const fresh = (t) => db.px?.[t]?.c > 0 && Date.parse(B.d) - Date.parse(db.px[t].d) <= 10 * DAY;
  const open = new Map();
  const lots = [];
  const sorted = rows.filter((r) => r.t && r.at !== 'option' && db.px?.[r.t]).sort((a, b) => a.d.localeCompare(b.d) || a.id.localeCompare(b.id));
  for (const r of sorted) {
    const px = db.px[r.t];
    const w = amountMid(r) || 0;
    if (isBuy(r.k)) {
      const inYear = r.d >= from;
      const s = inYear ? r.pt : px.y;
      const sp = inYear ? r.ps : B.y;
      if (w > 0 && s > 0 && sp > 0) {
        if (!open.has(r.t)) open.set(r.t, []);
        open.get(r.t).push({ t: r.t, w, s, sp, d: inYear ? r.d : from });
      }
      continue;
    }
    if (!isSell(r.k)) continue;
    const held = open.get(r.t);
    if (r.d < from) {
      if (r.k === 'sell') open.delete(r.t);
      continue;
    }
    if (held?.length) {
      if (r.k !== 'sell') continue;
      // an unpriced sale closes the positions at a price we do not know
      if (r.pt > 0 && r.ps > 0) for (const l of held) lots.push({ ...l, e: r.pt, ep: r.ps, closed: r.d });
      open.delete(r.t);
      continue;
    }
    if (w > 0 && px.y > 0 && r.pt > 0 && r.ps > 0) lots.push({ t: r.t, w, s: px.y, sp: B.y, d: from, e: r.pt, ep: r.ps, closed: r.d });
  }
  for (const held of open.values()) for (const l of held) if (fresh(l.t)) lots.push({ ...l, e: db.px[l.t].c, ep: B.c, closed: null });
  if (!lots.length) return null;
  let w = 0;
  let ret = 0;
  let spy = 0;
  const byTicker = new Map();
  for (const l of lots) {
    const r = l.e / l.s - 1;
    w += l.w;
    ret += l.w * r;
    spy += l.w * (l.ep / l.sp - 1);
    const b = byTicker.get(l.t) || { t: l.t, w: 0, x: 0 };
    b.w += l.w;
    b.x += l.w * r;
    byTicker.set(l.t, b);
  }
  const picks = [...byTicker.values()].map((b) => ({ t: b.t, r: b.x / b.w })).sort((a, b) => b.r - a.r);
  return {
    ret: ret / w,
    spy: spy / w,
    excess: (ret - spy) / w,
    positions: lots.length,
    open: lots.filter((l) => !l.closed).length,
    tickers: byTicker.size,
    weight: w,
    best: picks[0],
    worst: picks.length > 1 ? picks[picks.length - 1] : null,
  };
}

const median = (xs) => {
  if (!xs.length) return null;
  const s = xs.slice().sort((a, b) => a - b);
  const i = s.length >> 1;
  return s.length % 2 ? s[i] : (s[i - 1] + s[i]) / 2;
};

// Every member with a position this year, best first, and how Congress did
// against SPY. The summary counts only members with at least `minPositions`
// positions: one lucky stock is not a record.
export function ytdBoard(db, { minPositions = 3 } = {}) {
  if (!db.ytd || !db.bench) return null;
  const members = [];
  for (const [key, list] of groupBy(db.rows, (r) => r.m)) {
    const y = memberYtd(db, list);
    const m = db.members[key];
    if (!y || !m) continue;
    members.push({ key, slug: m.slug, n: m.n, ch: m.ch, p: m.p, st: m.st, ...y });
  }
  members.sort((a, b) => b.ret - a.ret || a.n.localeCompare(b.n));
  const q = members.filter((m) => m.positions >= minPositions);
  const group = (list) => ({ n: list.length, median: median(list.map((m) => m.ret)), beat: list.length ? list.filter((m) => m.excess > 0).length / list.length : null });
  return {
    year: db.ytd.year,
    from: db.ytd.from,
    asOf: db.bench.d,
    spy: db.bench.c / db.bench.y - 1,
    minPositions,
    summary: {
      all: group(q),
      D: group(q.filter((m) => m.p === 'D')),
      R: group(q.filter((m) => m.p === 'R')),
      H: group(q.filter((m) => m.ch === 'H')),
      S: group(q.filter((m) => m.ch === 'S')),
    },
    members,
  };
}

const groupBy = (rows, key) => {
  const out = new Map();
  for (const r of rows) {
    const k = key(r);
    if (k == null) continue;
    if (!out.has(k)) out.set(k, []);
    out.get(k).push(r);
  }
  return out;
};

function tickerBoard(db, rows, side) {
  const picked = rows.filter((r) => r.t && (side === 'buy' ? isBuy(r.k) : isSell(r.k)));
  return [...groupBy(picked, (r) => r.t)]
    .map(([t, list]) => ({
      t,
      a: list[0].a,
      trades: list.length,
      members: new Set(list.map((r) => r.m)).size,
      volume: list.reduce((s, r) => s + (amountMid(r) || 0), 0),
      cur: db.px?.[t]?.c ?? null,
    }))
    .sort((a, b) => b.members - a.members || b.trades - a.trades || b.volume - a.volume)
    .slice(0, 15);
}

export function overview(db, { days = 90, now = Date.now() } = {}) {
  const from = isoDay(now - days * DAY);
  const recent = db.rows.filter((r) => r.d >= from);
  const active = [...groupBy(recent, (r) => r.m)]
    .map(([key, list]) => memberCard(db, key, list))
    .filter(Boolean)
    .sort((a, b) => b.trades - a.trades || b.volume - a.volume)
    .slice(0, 20);
  const largest = recent
    .slice()
    .sort((a, b) => (amountMid(b) || 0) - (amountMid(a) || 0) || b.d.localeCompare(a.d))
    .slice(0, 20)
    .map((r) => present(db, r));
  const party = { D: 0, R: 0, I: 0, other: 0 };
  for (const r of recent) {
    const p = db.members[r.m]?.p;
    party[p in party ? p : 'other'] += 1;
  }
  return {
    updatedAt: db.updatedAt,
    lastFiled: db.lastFiled || db.rows[0]?.f || null,
    since: db.since,
    counts: db.counts,
    window: { days, from },
    recentCount: recent.length,
    party,
    buys: recent.filter((r) => isBuy(r.k)).length,
    sells: recent.filter((r) => isSell(r.k)).length,
    topBought: tickerBoard(db, recent, 'buy'),
    topSold: tickerBoard(db, recent, 'sell'),
    active,
    largest,
    latest: db.rows.slice(0, 50).map((r) => present(db, r)),
    // trades in the field of a committee the member sits on, newest first
    inField: db.rows.filter((r) => r.jx).slice(0, 100).map((r) => present(db, r)),
    inFieldCount: db.rows.filter((r) => r.jx).length,
    inFieldRecent: recent.filter((r) => r.jx).length,
    committees: committeeIndex(db),
    ytd: ytdBoard(db),
  };
}

// The filterable trade list. Filters: chamber H|S, party D|R|I, kind
// buy|sell, ticker, member slug, q (asset or member name).
export function feed(db, { ch, p, kind, ticker, member, q, field, offset = 0, limit = 100 } = {}) {
  const key = member ? db.bySlug?.[member] : null;
  if (member && !key) return { total: 0, offset: 0, rows: [] };
  const want = q ? normName(q) : '';
  const T = ticker ? String(ticker).toUpperCase() : null;
  const out = db.rows.filter((r) => {
    const m = db.members[r.m] || {};
    if (key && r.m !== key) return false;
    if (ch && m.ch !== ch) return false;
    if (p && m.p !== p) return false;
    if (kind === 'buy' && !isBuy(r.k)) return false;
    if (kind === 'sell' && !isSell(r.k)) return false;
    if (T && r.t !== T) return false;
    if (field && !r.jx) return false;
    if (want && !normName(`${r.a} ${r.t || ''} ${m.n}`).includes(want)) return false;
    return true;
  });
  const lim = Math.max(1, Math.min(500, Number(limit) || 100));
  const off = Math.max(0, Number(offset) || 0);
  return { total: out.length, offset: off, rows: out.slice(off, off + lim).map((r) => present(db, r)) };
}

export function memberView(db, slug) {
  const key = db.bySlug?.[slug];
  if (!key) return null;
  const mine = db.rows.filter((r) => r.m === key);
  const card = memberCard(db, key, mine);
  const m = db.members[key];
  const tickers = [...groupBy(mine.filter((r) => r.t), (r) => r.t)]
    .map(([t, list]) => ({
      t,
      a: list[0].a,
      buys: list.filter((r) => isBuy(r.k)).length,
      sells: list.filter((r) => isSell(r.k)).length,
      volume: list.reduce((s, r) => s + (amountMid(r) || 0), 0),
      last: list.reduce((d, r) => (r.d > d ? r.d : d), ''),
      cur: db.px?.[t]?.c ?? null,
    }))
    .sort((a, b) => b.volume - a.volume || b.last.localeCompare(a.last))
    .slice(0, 30);
  return {
    updatedAt: db.updatedAt,
    member: { ...card, ytd: memberYtd(db, mine), committees: (m.cm || []).filter((c) => db.committees?.[c]).map((id) => ({ id, name: db.committees[id], slug: committeeSlug(db.committees[id]) })) },
    tickers,
    rows: mine.map((r) => present(db, r)),
  };
}

// Congress trades in one ticker, for the stock page.
export function tickerView(db, ticker, { limit = 50 } = {}) {
  const T = String(ticker || '').toUpperCase();
  const list = db.rows.filter((r) => r.t === T);
  return {
    updatedAt: db.updatedAt,
    ticker: T,
    total: list.length,
    members: new Set(list.map((r) => r.m)).size,
    buys: list.filter((r) => isBuy(r.k)).length,
    sells: list.filter((r) => isSell(r.k)).length,
    rows: list.slice(0, limit).map((r) => present(db, r)),
  };
}

// Every member with at least one trade, for the directory and the sitemap.
export function membersList(db) {
  const by = groupBy(db.rows, (r) => r.m);
  return [...by]
    .map(([key, list]) => memberCard(db, key, list))
    .filter(Boolean)
    .sort((a, b) => (b.last || '').localeCompare(a.last || '') || b.trades - a.trades);
}

// ------------------------------------------------------------ committees

// "Senate Committee on Banking, Housing, and Urban Affairs" →
// senate-committee-on-banking-housing-and-urban-affairs. The names carry the
// chamber, so they are unique.
export const committeeSlug = (name) => slugify(String(name || ''));
const committeeChamber = (id) => (id[0] === 'H' ? 'H' : id[0] === 'J' ? 'J' : 'S');

// Members sitting on each committee, by committee id.
function seatsOf(db) {
  const out = {};
  for (const [key, m] of Object.entries(db.members)) for (const c of m.cm || []) if (db.committees?.[c]) (out[c] ||= []).push(key);
  return out;
}

// Every committee with at least one member on file, busiest first.
export function committeeIndex(db) {
  const seats = seatsOf(db);
  const byMember = groupBy(db.rows, (r) => r.m);
  return Object.entries(seats)
    .map(([id, all]) => {
      // members with at least one trade on file
      const keys = all.filter((k) => byMember.has(k));
      const rows = keys.flatMap((k) => byMember.get(k));
      return {
        id,
        slug: committeeSlug(db.committees[id]),
        name: db.committees[id],
        ch: committeeChamber(id),
        members: keys.length,
        trades: rows.length,
        buys: rows.filter((r) => isBuy(r.k)).length,
        sells: rows.filter((r) => isSell(r.k)).length,
        inField: rows.filter((r) => r.jx?.includes(id)).length,
        volume: rows.reduce((s, r) => s + (amountMid(r) || 0), 0),
        last: rows.reduce((d, r) => (r.f > d ? r.f : d), '') || null,
      };
    })
    .filter((c) => c.trades > 0)
    .sort((a, b) => b.trades - a.trades || a.name.localeCompare(b.name));
}

// One committee: who on it trades, what they trade, their latest trades.
export function committeeView(db, slug) {
  const id = Object.keys(db.committees || {}).find((c) => committeeSlug(db.committees[c]) === slug);
  if (!id) return null;
  const mine = new Set(seatsOf(db)[id] || []);
  const rows = db.rows.filter((r) => mine.has(r.m));
  const byMember = groupBy(rows, (r) => r.m);
  const members = [...byMember.keys()]
    .map((k) => memberCard(db, k, byMember.get(k)))
    .filter(Boolean)
    .sort((a, b) => b.trades - a.trades || a.n.localeCompare(b.n));
  const tickers = tickerBoard(db, rows, 'buy');
  const sold = tickerBoard(db, rows, 'sell');
  return {
    updatedAt: db.updatedAt,
    committee: committeeIndex(db).find((c) => c.id === id) || { id, slug, name: db.committees[id], ch: committeeChamber(id), members: 0, trades: 0, buys: 0, sells: 0, volume: 0, last: null },
    members,
    topBought: tickers,
    topSold: sold,
    rows: rows.slice(0, 100).map((r) => present(db, r)),
    total: rows.length,
    // trades in this committee's own field
    inField: rows.filter((r) => r.jx?.includes(id)).slice(0, 100).map((r) => present(db, r)),
    hasJurisdiction: Boolean(JURISDICTION[id]),
  };
}
