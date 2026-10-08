// Who filed: the filer names on House and Senate PTRs matched to the
// unitedstates/congress-legislators records (public domain, maintained by
// the @unitedstates project) for party, state, district, chamber and the
// Bioguide ID, plus committee seats.
//
// The filings spell names their own way ("A. Mitchell" / "McConnell, Jr.",
// "James Conley" / "Justice, II"), so the match is on what is stable:
//   House  — state + district (FD.xml's StateDst, e.g. TX25) and last name
//   Senate — last name among senators, first-name tokens to break a tie
// A filer nobody matches is still listed, under the name on the filing and
// without a party.
import { slugify } from '../../client/src/lib/slugify.js';

const SUFFIX = /\b(jr|sr|ii|iii|iv|v)\b\.?/g;
export const normName = (s) =>
  String(s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\(.*?\)/g, ' ')
    .replace(/[^a-z\s-]/g, ' ')
    .replace(SUFFIX, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const lastTokens = (s) => normName(s).split(/[\s-]+/).filter(Boolean);
const PARTY = { Democrat: 'D', Republican: 'R', Independent: 'I', Libertarian: 'L' };

// Legislator records → candidates with the term that fits a filing date.
export function indexLegislators(list) {
  const out = [];
  for (const l of list || []) {
    for (const term of l.terms || []) {
      out.push({
        bioguide: l.id?.bioguide || null,
        first: l.name?.first || '',
        middle: l.name?.middle || '',
        nick: l.name?.nickname || '',
        last: l.name?.last || '',
        full: l.name?.official_full || [l.name?.first, l.name?.last].filter(Boolean).join(' '),
        chamber: term.type === 'sen' ? 'S' : 'H',
        state: term.state,
        district: term.district ?? null,
        party: PARTY[term.party] || (term.party ? term.party[0] : null),
        start: term.start,
        end: term.end,
      });
    }
  }
  return out;
}

const servedOn = (c, day) => !day || ((!c.start || c.start <= day) && (!c.end || c.end >= day));
const lastMatches = (c, filerLast) => {
  const want = lastTokens(filerLast);
  const have = lastTokens(c.last);
  return want.length > 0 && have.length > 0 && (have.join(' ') === want.join(' ') || want.some((w) => w.length > 2 && have.includes(w)));
};
const firstMatches = (c, filerFirst) => {
  const want = lastTokens(filerFirst).filter((w) => w.length >= 3);
  if (!want.length) return true;
  const have = [c.first, c.middle, c.nick, c.full.split(' ')[0]].flatMap(lastTokens);
  return want.some((w) => have.some((h) => h.startsWith(w) || w.startsWith(h)));
};

// The best candidate for a filer, preferring a term that covers the filing
// date, then the latest term.
function pick(cands, day) {
  if (!cands.length) return null;
  const on = cands.filter((c) => servedOn(c, day));
  const pool = on.length ? on : cands;
  return pool.slice().sort((a, b) => String(b.end).localeCompare(String(a.end)))[0];
}

export function matchHouse(idx, { first, last, stateDst }, day) {
  const st = String(stateDst || '').slice(0, 2);
  const dist = Number(String(stateDst || '').slice(2));
  const reps = idx.filter((c) => c.chamber === 'H');
  const byName = reps.filter((c) => lastMatches(c, last));
  const inSeat = byName.filter((c) => c.state === st && (Number.isNaN(dist) || Number(c.district ?? 0) === dist));
  return pick(inSeat, day) || pick(byName.filter((c) => c.state === st && firstMatches(c, first)), day) || null;
}

export function matchSenate(idx, { first, last }, day) {
  const sens = idx.filter((c) => c.chamber === 'S' && lastMatches(c, last));
  const people = new Set(sens.map((c) => c.bioguide));
  if (people.size <= 1) return pick(sens, day);
  return pick(sens.filter((c) => firstMatches(c, first)), day);
}

// Committee seats by Bioguide ID: { bioguide: [committeeId, ...] } and
// { committeeId: name } for the full committees (not subcommittees).
export function committeeSeats(committees, membership) {
  const names = {};
  for (const c of committees || []) if (c.thomas_id) names[c.thomas_id] = c.name;
  const seats = {};
  for (const [id, members] of Object.entries(membership || {})) {
    if (!names[id]) continue; // subcommittees carry a numeric suffix (SSAF13)
    for (const m of members || []) if (m.bioguide) (seats[m.bioguide] ||= []).push(id);
  }
  return { names, seats };
}

// A display name for a filer nobody matched: "Hon. Rudy C. Yakym III" → "Rudy C. Yakym III".
export const filerName = (first, last) =>
  [first, last]
    .map((s) => String(s || '').replace(/,/g, ' ').trim())
    .filter(Boolean)
    .join(' ')
    .replace(/^(hon\.?|mr\.?|mrs\.?|ms\.?|dr\.?)\s+/i, '')
    .replace(/\s+/g, ' ');

// Stable slugs: the name, and the state when two members share it.
export function assignSlugs(members) {
  const byBase = {};
  for (const [key, m] of Object.entries(members)) (byBase[slugify(m.n)] ||= []).push(key);
  for (const [base, keys] of Object.entries(byBase)) {
    for (const key of keys) {
      const m = members[key];
      members[key].slug = keys.length === 1 ? base : `${base}-${String(m.st || m.ch).toLowerCase()}${m.dist != null && m.ch === 'H' ? m.dist : ''}`;
    }
  }
  return members;
}
