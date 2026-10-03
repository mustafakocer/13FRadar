// Checks on the universe against the filers' own words and against itself
// (scripts/audit-universe.mjs).
//
// compareTotal   our total for a filing vs the "Form 13F Information Table
//                Value Total" on its summary page, the declared figure put
//                through the same unit factor our table was (a filer that
//                wrote thousands wrote them in both places)
// overlapPairs   filers whose books are the same book: more than 90% of each
//                side's lines match the other's by CUSIP, put/call and share
//                count

export const TOTAL_TOLERANCE = 0.01;

export function compareTotal({ ours, declared, factor = 1 }) {
  if (!Number.isFinite(ours) || !Number.isFinite(declared) || declared <= 0) return { declaredAdj: null, diffPct: null, ok: null };
  const declaredAdj = declared * (factor || 1);
  const diffPct = (ours - declaredAdj) / declaredAdj;
  return { declaredAdj, diffPct, ok: Math.abs(diffPct) <= TOTAL_TOLERANCE };
}

export const lineKey = (p) => `${String(p.cusip || '').toUpperCase()}|${p.putCall || ''}|${Math.round(p.shares || 0)}`;

// books: [{ id, keys: string[] }] → [{ a, b, matched, shareA, shareB }]
// A key held by very many filers (a round lot of an index name) says nothing
// about two books being one; those are left out of the pairing and counted
// back as matches only when both books hold them.
export function overlapPairs(books, { min = 0.9, minLines = 10, maxHolders = 200 } = {}) {
  const holders = new Map();
  books.forEach((b, i) => {
    for (const k of new Set(b.keys)) {
      let h = holders.get(k);
      if (!h) holders.set(k, (h = []));
      h.push(i);
    }
  });
  const counts = new Map();
  for (const h of holders.values()) {
    if (h.length < 2 || h.length > maxHolders) continue;
    for (let x = 0; x < h.length; x++) {
      for (let y = x + 1; y < h.length; y++) {
        const key = h[x] * 1e6 + h[y];
        counts.set(key, (counts.get(key) || 0) + 1);
      }
    }
  }
  const out = [];
  for (const [key, c] of counts) {
    const a = Math.floor(key / 1e6);
    const b = key % 1e6;
    const A = new Set(books[a].keys);
    const B = new Set(books[b].keys);
    if (A.size < minLines || B.size < minLines) continue;
    // a quick bound before the exact count
    if (c < min * Math.max(A.size, B.size) * 0.5) continue;
    let matched = 0;
    const [small, large] = A.size <= B.size ? [A, B] : [B, A];
    for (const k of small) if (large.has(k)) matched++;
    const shareA = matched / A.size;
    const shareB = matched / B.size;
    if (shareA > min && shareB > min) out.push({ a: books[a].id, b: books[b].id, matched, shareA, shareB });
  }
  return out;
}

// The declared total of a period whose filing was amended, the way the
// effective snapshot reads the tables: a RESTATEMENT replaces the total, a
// NEW HOLDINGS amendment adds to it. `amendments`: oldest first, each
// { type, total } (type from the latest-holdings record or the cover page).
// Null when a needed total is missing.
// Many NEW HOLDINGS amendments put the period's cumulative total on their
// cover, not the added lines' (about 25 of the 2026-Q2 amended filers sat at
// −30…−50% under the sum): declaredCandidates() lists every reading — the
// chain below, the original's total, each amendment's own — and a filer
// matches when any of them does.
export function declaredCandidates(base, amendments = []) {
  const out = [effectiveDeclared(base, amendments), base, ...amendments.map((a) => a?.total)];
  return [...new Set(out.filter((v) => Number.isFinite(v) && v > 0))];
}

export function effectiveDeclared(base, amendments = []) {
  let total = Number.isFinite(base) ? base : null;
  for (const a of amendments) {
    const t = Number.isFinite(a?.total) ? a.total : null;
    if (/^RESTATEMENT$/i.test(a?.type || '')) total = t;
    else if (/^NEW HOLDINGS$/i.test(a?.type || '')) total = total == null || t == null ? null : total + t;
    else total = null;
  }
  return total;
}

// Our stored total against a fresh read of the same filing (full table,
// amendments applied, unit judged on every priced line): a pure unit slip
// the stored copy missed is a factor of 1000 either way.
export function storedUnitSlip(stored, fresh) {
  if (!(stored > 0) || !(fresh > 0)) return null;
  const r = fresh / stored;
  if (Math.abs(r / 1000 - 1) <= 0.001) return 1000;
  if (Math.abs(r * 1000 - 1) <= 0.001) return 0.001;
  return null;
}

// ---- the nightly check (scripts/check-universe-audit.mjs) -----------------
export const NIGHTLY_TOP = 500;
export const NIGHTLY_TOLERANCE = 0.05;
const pad = (cik) => String(cik || '').replace(/\D/g, '').padStart(10, '0');
export const pairKey = (a, b) => [pad(a), pad(b)].sort().join('|');

// Our total against the declared one among the `top` largest current funds
// (a filing that carries another filer's table is not ranked). A filer that
// wrote the table and the cover in different units matches at ×1000 or
// ÷1000: the unit is checked elsewhere, not here.
export function totalDeviations(rows, { quarter, top = NIGHTLY_TOP, tolerance = NIGHTLY_TOLERANCE } = {}) {
  const ranked = rows
    .filter((r) => !r.misfiled && r.aum > 0 && (!quarter || (r.reportDate || '') >= quarter))
    .sort((a, b) => b.aum - a.aum)
    .slice(0, top);
  const out = [];
  ranked.forEach((r, i) => {
    if (!(r.declared > 0)) return;
    const candidates = [r.declared, ...(r.declaredAlt || [])];
    const near = candidates.some((d) => [1, 1000, 1 / 1000].some((f) => Math.abs(r.aum / (d * f) - 1) <= tolerance));
    if (!near) out.push({ cik: r.cik, name: r.name, acc: r.acc, rank: i + 1, aum: r.aum, declared: r.declared, diffPct: Number(((r.aum / r.declared - 1) * 100).toFixed(1)) });
  });
  return out;
}

// What is new against the previous night's state. `known` is
// { deviations: ['cik|acc'], pairs: ['cik|cik'] }; `reviewed` pair keys
// (config/misfiled-books.json, config/duplicate-books.json) never alarm.
export function newFindings({ deviations, pairs }, known = {}, reviewed = new Set()) {
  const kd = new Set(known.deviations || []);
  const kp = new Set(known.pairs || []);
  return {
    deviations: deviations.filter((d) => !kd.has(`${d.cik}|${d.acc}`)),
    pairs: pairs.filter((p) => !kp.has(pairKey(p.a, p.b)) && !reviewed.has(pairKey(p.a, p.b))),
  };
}

// What to do about a near-identical pair (the nightly check's advice; never
// applied by itself). For each side: the filing the universe uses and any
// other original 13F-HR it sent for the same quarter. A side with such an
// alternative gets a suggestion to use it once its copy is marked; a side
// without one would be marked misfiled. A filing of another quarter is never
// offered as a replacement.
//   side: { cik, name, acc, reportDate, filings: [{ acc, form, filingDate, reportDate }] }
//   → [{ cik, name, kind: 'alternative' | 'misfiled', acc?, filingDate?, reportDate }]
export function copyAdvice(sides) {
  return sides.map((s) => {
    const alt = (s.filings || [])
      .filter((f) => f.reportDate === s.reportDate && f.acc !== s.acc && !/\/A/i.test(String(f.form || '')))
      .sort((x, y) => (x.filingDate === y.filingDate ? String(y.acc).localeCompare(String(x.acc)) : x.filingDate < y.filingDate ? 1 : -1))[0];
    return alt
      ? { cik: s.cik, name: s.name, kind: 'alternative', acc: alt.acc, filingDate: alt.filingDate, reportDate: s.reportDate }
      : { cik: s.cik, name: s.name, kind: 'misfiled', reportDate: s.reportDate };
  });
}

// One line of the alarm per side (Turkish, the alarm issue's language).
export function adviceLine(a, usedAcc, filed) {
  if (a.kind === 'alternative') {
    return `Öneri: ${a.name} (${a.cik}) ${a.reportDate} için başka bir orijinal bildirim de vermiş (${a.acc}, ${a.filingDate}). Kopya bu fonunsa ${usedAcc} bildirimini config/misfiled-books.json'a ekleyin ve ${a.acc} kullanılsın.`;
  }
  return `${a.name} (${a.cik}): ${a.reportDate} için başka orijinal bildirim yok (kullanılan ${usedAcc}, ${filed}). Kopya bu fonunsa yanlış dosyalanmış olarak işaretlenmeli; başka bir çeyreğin bildirimi yerine konmaz.`;
}
