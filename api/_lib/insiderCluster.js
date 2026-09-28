// Cluster buys: several insiders of the same company buying on the open
// market within a short time. The ONE definition every page uses — the
// home page table, /insiders/cluster, the /insiders cards, the feed's
// cluster tab and per-row context, the penny board — so they can no longer
// disagree (before this module each called insiderModel.findClusters with
// its own rows and window).
//
// A buy counts toward a cluster when it is
//   · an open-market purchase (P) with a real price (insiderClassify),
//   · in US dollars or verified as such (fpiNormalize: no `fx.fail`), with a
//     price that passed the market check (no `pu`),
//   · not a planned trade (10b5-1 box or footnote),
//   · by an officer or director — not a fund, not a pure 10% holder (they are
//     listed separately in the detail, never counted),
// and the person's counted buys in the window add up to at least $10,000.
//
// A cluster is at least 2 such people buying the same company within 10
// business days. Two patterns that look like clusters are NOT clusters
// and carry their own label instead:
//   plan_bulk  "Toplu plan alımı" — ≥5 people on the same day at (nearly)
//              the same price with a median under $10,000 each (TSMC's
//              employee purchase plan), or footnotes naming an employee stock
//              purchase plan / dividend reinvestment
//   offering   "Hisse arzına katılım" — footnotes naming a public offering,
//              a private placement or a purchase directly from the issuer
//              (Star Bulk's directors buying in the underwritten offering)
// A group whose every amount is unverified (Wix in shekels) is not listed.
//
// Strength, shown as facts, never as a promise of return, and used for the
// order: people, total dollars, whether the CEO or CFO is among them, and
// the average increase in the buyers' own holdings.
import { businessDaysBetween, isListed } from './insiderModel.js';
import { classify } from './insiderClassify.js';

export const CLUSTER = {
  windowBusinessDays: 10,
  minPeople: 2,
  minPersonValue: 10000,
  planMinPeople: 5,
  planMedianMax: 10000,
  samePriceTolerance: 0.01,
};

export const EMPLOYEE_PLAN_RE = /employee stock purchase|\bespp\b|employee (share|stock) (purchase|ownership) plan|dividend reinvestment|\bdrip\b|payroll deduction/i;
export const OFFERING_RE = /\b(public|underwritten|registered|secondary|follow-on|best efforts)\b[^.]{0,40}\boffering\b|\bin the (company's |issuer's )?offering\b|\boffering\b[^.]{0,60}\b(price|underwrit)|private placement|directly from the (issuer|company)|from the issuer in|subscription agreement|securities purchase agreement/i;

// footnotes and the filing's remarks
const notesOf = (raw) => [raw?.fn ? Object.values(raw.fn).join(' ') : '', raw?.rm || ''].join(' ').trim();
const roleOk = (r) => ['ceo', 'cfo', 'officer', 'director'].includes(r?.r);

// Why a buy does or does not count. `rawOf(r)` gives the raw Form 4 fields.
//   null = counts; otherwise 'not_open_buy' | 'fx' | 'price' | 'plan' | 'fund'
//   | 'owner10' | 'role'
export function exclusionOf(r, c = classify(r)) {
  if (c.category !== 'open_buy') return 'not_open_buy';
  if (r.fx?.fail) return 'fx';
  if (r.pu || c.price_unverified) return 'price';
  if (c.plan_trade) return 'plan';
  if (c.fund_insider) return 'fund';
  if (c.ten_pct_owner_only) return 'owner10';
  if (!roleOk(r)) return 'role';
  return null;
}

// Labels per line, for one company's open-market buys:
//   'offering'  its footnotes name an offering / private placement / a
//               purchase directly from the issuer
//   'plan_bulk' its footnotes name an employee purchase plan or dividend
//               reinvestment, or it is one of ≥5 people buying that day at
//               (nearly) the same price with a median under $10,000 each
// → Map line → { label, why, quote? }
//   'offering' also for a line bought at the offering price another line's
//               footnote states, converted to dollars at that day's rate
//               (Star Bulk: "at the offering price … euro 24.50" = $28.27)
//   toUsd(amount, currency, day) converts a stated offering price
export function lineLabels(lines, rawOf = () => null, toUsd = (x, cu) => (cu === 'USD' ? x : null)) {
  const out = new Map();
  const offerPrices = [];
  for (const r of lines) {
    // sentences about the HOLDING ("Includes shares acquired through the
    // dividend reinvestment plan") say nothing about how this purchase was
    // made: they are left out before the plan/offering words are read
    const t = aboutTheTrade(notesOf(rawOf(r)));
    if (!t) continue;
    if (OFFERING_RE.test(t)) {
      out.set(r, { label: 'offering', why: 'footnote', quote: sentence(t, OFFERING_RE) });
      for (const { amount, cu } of statedPrices(t)) {
        const usd = toUsd(amount, cu, r.d);
        if (usd > 0) offerPrices.push({ usd, d: r.d, cu, amount });
      }
    } else if (EMPLOYEE_PLAN_RE.test(t)) out.set(r, { label: 'plan_bulk', why: 'footnote', quote: sentence(t, EMPLOYEE_PLAN_RE) });
  }
  for (const r of lines) {
    if (out.has(r) || !(r.p > 0)) continue;
    const hit = offerPrices.find((o) => Math.abs(r.p / o.usd - 1) <= CLUSTER.samePriceTolerance && Math.abs(businessDaysBetween(...[o.d, r.d].sort())) <= 5);
    if (hit) out.set(r, { label: 'offering', why: 'offering_price', quote: `offering price ${hit.cu} ${hit.amount} ≈ $${hit.usd.toFixed(2)}` });
  }
  const byDay = new Map();
  for (const r of lines) {
    if (!(r.p > 0)) continue;
    if (!byDay.has(r.d)) byDay.set(r.d, []);
    byDay.get(r.d).push(r);
  }
  for (const [, day] of byDay) {
    const people = new Map();
    for (const r of day) people.set(r.n, (people.get(r.n) || 0) + (r.fx?.fail ? 0 : r.v || 0));
    if (people.size < CLUSTER.planMinPeople) continue;
    const prices = day.map((r) => r.p);
    if (Math.max(...prices) / Math.min(...prices) > 1 + CLUSTER.samePriceTolerance) continue;
    const vals = [...people.values()].sort((a, b) => a - b);
    const median = vals.length % 2 ? vals[vals.length >> 1] : (vals[vals.length / 2 - 1] + vals[vals.length / 2]) / 2;
    if (median >= CLUSTER.planMedianMax) continue;
    for (const r of day) if (!out.has(r)) out.set(r, { label: 'plan_bulk', why: 'same_day_price', people: people.size, median: Math.round(median) });
  }
  return out;
}
// Prices a footnote states with their currency: "euro 24.50", "€24.50",
// "$28.27", "US$ 5.00", "R$ 17,98".
const MONEY_RE = /(€|\beuros?\b|\beur\b|us\$|\busd\b|\$|£|\bgbp\b|r\$)\s*([\d]+(?:[.,]\d+)?)|([\d]+(?:[.,]\d+)?)\s*(€|euros?\b|eur\b|usd\b|dollars?\b)/gi;
const CUR = (w) => {
  const x = String(w || '').toLowerCase();
  if (/€|euro|eur/.test(x)) return 'EUR';
  if (/£|gbp/.test(x)) return 'GBP';
  if (/r\$/.test(x)) return 'BRL';
  return 'USD';
};
function statedPrices(t) {
  const out = [];
  for (const m of t.matchAll(MONEY_RE)) {
    const amount = Number(String(m[2] ?? m[3]).replace(',', '.'));
    if (amount > 0 && amount < 100000) out.push({ amount, cu: CUR(m[1] ?? m[4]) });
  }
  return out;
}
const HOLDING_NOTE_RE = /^(this (amount|total|number) )?(also )?includes\b|^(the )?(amount|number|total) of (securities|shares) (beneficially )?owned[^.]*includes\b/i;
export function aboutTheTrade(text) {
  if (!text) return '';
  return text
    .split(/(?<=\.)\s+(?=[A-Z(])/)
    .filter((x) => !HOLDING_NOTE_RE.test(x.trim()))
    .join(' ')
    .trim();
}
function sentence(t, re) {
  const m = re.exec(t);
  if (!m) return null;
  const start = Math.max(0, t.lastIndexOf('.', m.index) + 1);
  const end = t.indexOf('.', m.index + m[0].length);
  return t.slice(start, end < 0 ? undefined : end + 1).trim().slice(0, 240);
}

// Holding change of one person over their counted buys: from before the
// first to after the last (%), Infinity for a new position, null unknown.
function ownIncrease(lines) {
  const sorted = [...lines].sort((a, b) => (a.d === b.d ? (a.li ?? 0) - (b.li ?? 0) : a.d < b.d ? -1 : 1));
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  if (last.o == null || first.o == null || first.s == null) return null;
  const before = first.o - first.s;
  if (before <= 0) return last.o > 0 ? Infinity : null;
  return ((last.o - before) / before) * 100;
}

const round1 = (x) => (Number.isFinite(x) ? Number(x.toFixed(1)) : x === Infinity ? 'new' : null);

// All clusters (and labelled look-alikes) among `rows`.
//   rows      served rows (current, normalised); any codes — only P lines are read
//   rawOf     r → raw Form 4 fields (footnotes), optional
//   from/to   transaction-date window (inclusive), optional
//   toUsd     (amount, currency, day) → dollars, for offering prices a
//             footnote states in another currency
// → { clusters: [...], excluded: [...], byTicker: Map ticker → cluster }
export function buildClusters(rows, { rawOf = () => null, from = null, to = null, toUsd } = {}) {
  const byTicker = new Map();
  for (const r of rows) {
    if (r.k !== 'P' || !r.t || !isListed(r) || r.sb) continue;
    if ((from && r.d < from) || (to && r.d > to)) continue;
    if (!byTicker.has(r.t)) byTicker.set(r.t, []);
    byTicker.get(r.t).push(r);
  }

  const clusters = [];
  const excluded = [];
  for (const [t, lines] of byTicker) {
    lines.sort((a, b) => (a.d < b.d ? -1 : a.d > b.d ? 1 : 0));
    const cls = new Map(lines.map((r) => [r, classify(r)]));
    const labels = lineLabels(lines, rawOf, toUsd);
    const why = (r) => labels.get(r)?.label || exclusionOf(r, cls.get(r));
    let best = null;
    for (let i = 0; i < lines.length; i++) {
      const win = windowFrom(lines, i);
      // who counts: eligible, unlabelled lines, then people ≥ $10K in total
      const counted = new Map();
      for (const r of win) {
        if (why(r)) continue;
        if (!counted.has(r.n)) counted.set(r.n, []);
        counted.get(r.n).push(r);
      }
      const members = [...counted.entries()]
        .map(([n, ls]) => ({ n, lines: ls, value: ls.reduce((s, r) => s + (r.v || 0), 0) }))
        .filter((m) => m.value >= CLUSTER.minPersonValue);
      if (members.length < CLUSTER.minPeople) continue;
      const value = members.reduce((s, m) => s + m.value, 0);
      if (!best || members.length > best.members.length || (members.length === best.members.length && value > best.value)) best = { lines: win, members, value };
    }
    if (best) {
      clusters.push(shapeCluster(t, best, why));
      continue;
    }
    // no cluster: a labelled group of several people is listed separately
    const labelled = lines.filter((r) => labels.has(r));
    let group = null;
    for (let i = 0; i < labelled.length; i++) {
      const win = windowFrom(labelled, i);
      const people = new Set(win.map((r) => r.n)).size;
      if (people >= CLUSTER.minPeople && (!group || people > group.people)) group = { lines: win, people };
    }
    if (!group) continue;
    // every amount unverified (Wix in shekels): not listed at all
    if (group.lines.every((r) => r.fx?.fail)) continue;
    excluded.push(shapeLookalike(t, group.lines, labels));
  }

  clusters.sort(compareClusters);
  excluded.sort((a, b) => b.people - a.people || b.value - a.value);
  return { clusters, excluded, byTicker: new Map(clusters.map((c) => [c.t, c])) };
}

// the lines of `lines` from index i within the window (10 business days)
function windowFrom(lines, i) {
  const out = [];
  for (let j = i; j < lines.length; j++) {
    const gap = businessDaysBetween(lines[i].d, lines[j].d);
    if (gap == null || gap >= CLUSTER.windowBusinessDays) break;
    out.push(lines[j]);
  }
  return out;
}

function shapeCluster(t, best, why) {
  const memberNames = new Set(best.members.map((m) => m.n));
  const members = best.members
    .map((m) => {
      const first = m.lines[0];
      const inc = ownIncrease(m.lines);
      return { n: m.n, r: first.r, ti: first.ti || null, d: m.lines.map((r) => r.d).sort()[0], v: Math.round(m.value), p: first.p, ownIncrease: round1(inc) };
    })
    .sort((a, b) => b.v - a.v);
  // same-period buyers who do not count, and why
  const others = new Map();
  for (const r of best.lines) {
    if (memberNames.has(r.n)) continue;
    const o = others.get(r.n) || { n: r.n, r: r.r, d: r.d, v: 0, why: why(r) || 'small' };
    o.v += r.fx?.fail ? 0 : r.v || 0;
    others.set(r.n, o);
  }
  const incs = members.map((m) => m.ownIncrease).filter((x) => typeof x === 'number');
  const dates = best.members.flatMap((m) => m.lines.map((r) => r.d)).sort();
  return {
    t,
    insiders: members.length,
    value: Math.round(best.value),
    from: dates[0],
    to: dates[dates.length - 1],
    spanDays: businessDaysBetween(dates[0], dates[dates.length - 1]),
    ceoCfo: members.some((m) => m.r === 'ceo' || m.r === 'cfo'),
    roles: [...new Set(members.map((m) => m.r).filter((x) => x === 'ceo' || x === 'cfo'))],
    ownIncreaseAvg: incs.length ? Number((incs.reduce((a, b) => a + b, 0) / incs.length).toFixed(1)) : null,
    newPositions: members.filter((m) => m.ownIncrease === 'new').length,
    members,
    others: [...others.values()].map((o) => ({ ...o, v: Math.round(o.v) })).sort((a, b) => b.v - a.v),
  };
}

function shapeLookalike(t, lines, labels) {
  const people = new Map();
  for (const r of lines) people.set(r.n, (people.get(r.n) || 0) + (r.fx?.fail ? 0 : r.v || 0));
  const counts = {};
  for (const r of lines) {
    const l = labels.get(r).label;
    counts[l] = (counts[l] || 0) + 1;
  }
  const label = Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
  const ev = lines.map((r) => labels.get(r)).find((x) => x.label === label && x.quote) || lines.map((r) => labels.get(r)).find((x) => x.label === label);
  const dates = lines.map((r) => r.d).sort();
  return {
    t,
    label,
    why: ev.why,
    quote: ev.quote || null,
    people: people.size,
    value: Math.round([...people.values()].reduce((a, b) => a + b, 0)),
    from: dates[0],
    to: dates[dates.length - 1],
    ...(ev.median != null ? { median: ev.median } : {}),
  };
}

// Every line that belongs to SOME cluster (any window, not only each
// company's strongest), for the calibration report: cluster buys vs buys by
// one person alone. → Set of row objects
export function clusteredLines(rows, { rawOf = () => null, toUsd } = {}) {
  const byTicker = new Map();
  for (const r of rows) {
    if (r.k !== 'P' || !r.t || !isListed(r) || r.sb) continue;
    if (!byTicker.has(r.t)) byTicker.set(r.t, []);
    byTicker.get(r.t).push(r);
  }
  const out = new Set();
  for (const [, lines] of byTicker) {
    lines.sort((a, b) => (a.d < b.d ? -1 : a.d > b.d ? 1 : 0));
    const cls = new Map(lines.map((r) => [r, classify(r)]));
    const labels = lineLabels(lines, rawOf, toUsd);
    for (let i = 0; i < lines.length; i++) {
      const counted = new Map();
      for (const r of windowFrom(lines, i)) {
        if (labels.has(r) || exclusionOf(r, cls.get(r))) continue;
        if (!counted.has(r.n)) counted.set(r.n, []);
        counted.get(r.n).push(r);
      }
      const members = [...counted.values()].filter((ls) => ls.reduce((s, r) => s + (r.v || 0), 0) >= CLUSTER.minPersonValue);
      if (members.length >= CLUSTER.minPeople) for (const ls of members) for (const r of ls) out.add(r);
    }
  }
  return out;
}

// people → dollars → CEO/CFO present → average holding increase
export function compareClusters(a, b) {
  return (
    b.insiders - a.insiders ||
    b.value - a.value ||
    Number(b.ceoCfo) - Number(a.ceoCfo) ||
    (b.ownIncreaseAvg ?? -Infinity) - (a.ownIncreaseAvg ?? -Infinity)
  );
}

// Density of a cluster (how tightly packed), for the feed's filter.
export const DENSITY = ['blitz', 'tight', 'standard', 'extended'];
export function densityOf(c) {
  const span = c?.spanDays;
  if (span == null) return null;
  if (span <= 1) return 'blitz';
  if (span <= 3) return 'tight';
  if (span <= 6) return 'standard';
  return 'extended';
}
