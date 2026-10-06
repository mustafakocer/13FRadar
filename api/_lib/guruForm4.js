// The Form 4 lines a 13F filer itself reported.
//
// A fund that owns more than 10% of a company (Berkshire in Occidental,
// DaVita, Sirius; Icahn in IEP; Conifer in Group 1) files a Form 4 within
// two business days of every trade — dated, priced, mid-quarter — while the
// 13F says only what was held at the quarter end, 45 days later. The
// insider dataset already holds those lines; this joins them to the fund
// so the manager page can show "sold 0.6% of DVA on 31 Jul" next to the
// quarterly table instead of leaving the reader to find it under the
// stock.
//
// Two keys join a line to a fund:
//   1. `ow`, the reporting-owner CIK the crawl stores (lines filed since
//      2026-09-16): equal to the 13F filer's CIK when the same entity files
//      both
//   2. for older lines without `ow`, the reporting owner's name against the
//      filer's registered name from the universe build (BERKSHIRE HATHAWAY
//      INC on both), compared after the usual normalisation
// A subsidiary that files under its own name (National Indemnity for
// Berkshire) is not joined: better a line missing than a wrong one.
import { createRequire } from 'node:module';
import { readServed } from './insiderStore.js';

const require = createRequire(import.meta.url);
const pad = (cik) => String(cik || '').replace(/\D/g, '').padStart(10, '0');

// "BERKSHIRE HATHAWAY INC" / "Berkshire Hathaway, Inc." → "BERKSHIRE HATHAWAY"
// only the legal-form words go: "HOLDINGS", "CAPITAL", "PARTNERS" tell
// sister entities apart and stay
const SUFFIX = /\b(INC|INCORPORATED|LLC|L L C|LP|L P|LTD|LIMITED|CORP|CORPORATION|CO|COMPANY|PLC|DE)\b/g;
export const normName = (s) =>
  String(s || '')
    .toUpperCase()
    .replace(/[^A-Z0-9 ]+/g, ' ')
    .replace(SUFFIX, ' ')
    .replace(/\s+/g, ' ')
    .trim();

let names;
// cik → registered filer name, from the universe build (committed JSON).
export function filerName(cik, universe = null) {
  if (universe) return universe.rows?.find((r) => pad(r.cik) === pad(cik))?.name || null;
  if (names === undefined) {
    names = new Map();
    try {
      for (const r of require('../../client/public/universe.json').rows || []) names.set(pad(r.cik), r.name);
    } catch {
      /* no universe on disk: name matching is off */
    }
  }
  return names.get(pad(cik)) || null;
}

// The dataset's rows reported by the fund with this CIK, newest trade first.
export function guruForm4Rows(cik, { rows = readServed().rows, name = filerName(cik) } = {}) {
  const id = pad(cik);
  const nn = name ? normName(name) : null;
  const out = rows.filter((r) => {
    if (r.ow) return pad(r.ow) === id;
    return nn && normName(r.n) === nn;
  });
  return out.sort((a, b) => (a.d < b.d ? 1 : a.d > b.d ? -1 : (a.f < b.f ? 1 : -1)));
}

// One filing often carries a day's buying as many lines (Berkshire's Lennar
// buys: nine lots on 2 October). The reader wants the day: lines with the
// same security, trade date and code fold into one row — shares summed,
// value summed, price share-weighted. The stake change (`oc`) is kept only
// for a single line: each lot reports its own "owned after", and lots held
// directly and through a subsidiary carry different bases, so a change
// read across them is not a number. `lines` says how many folded; `o` is
// the largest holding any lot reported.
export function foldDays(rows) {
  const groups = new Map();
  for (const r of rows) {
    const key = `${r.t || r.ci}|${r.d}|${r.k}`;
    let g = groups.get(key);
    if (!g) groups.set(key, (g = { ...r, s: 0, v: 0, pw: 0, ps: 0, lines: 0, o: null, f: r.f }));
    g.lines++;
    g.s += r.s || 0;
    if (r.v != null) g.v += r.v;
    if (r.p > 0 && r.s > 0) {
      g.pw += r.p * r.s;
      g.ps += r.s;
    }
    if (r.o != null && (g.o == null || r.o > g.o)) g.o = r.o;
    if (r.f < g.f) g.f = r.f;
    if (r.fa) g.fa = r.fa;
    if (r.p5) g.p5 = r.p5;
  }
  return [...groups.values()]
    .map(({ pw, ps, ...g }) => ({
      ...g,
      p: ps > 0 ? Number((pw / ps).toFixed(pw / ps >= 10 ? 2 : 4)) : g.p ?? null,
      v: g.v || null,
      oc: g.lines === 1 ? g.oc ?? null : null,
    }))
    .sort((a, b) => (a.d < b.d ? 1 : a.d > b.d ? -1 : a.f < b.f ? 1 : a.f > b.f ? -1 : a.k < b.k ? -1 : a.k > b.k ? 1 : 0));
}

// Per ticker: the most recent line and how many there are — the badge the
// positions table shows beside the symbol.
export function byTicker(rows) {
  const out = {};
  for (const r of rows) {
    if (!r.t) continue;
    const e = out[r.t] || (out[r.t] = { count: 0, last: null });
    e.count++;
    if (!e.last || r.d > e.last.d) e.last = { d: r.d, f: r.f, k: r.k, s: r.s, p: r.p ?? null, v: r.v ?? null, oc: r.oc ?? null, a: r.a };
  }
  return out;
}
