// Sector allocation arithmetic for the guru page donut (Charts/SectorPie.jsx),
// kept pure so it is testable without a browser.
// A weight as a number, whatever shape it arrived in: 39.2, "39.2", "39.2%".
const num = (v) => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  const n = parseFloat(String(v ?? '').replace('%', ''));
  return Number.isFinite(n) ? n : 0;
};

// A sector label as a string, or null for anything that is not one: the
// /api/sectors answer is a plain string per symbol, but a null (no profile,
// an ETF), an object from another provider, or a percentage string must not
// become a slice of their own.
const sectorName = (s) => {
  if (s == null) return null;
  if (typeof s === 'object') return sectorName(s.sector ?? s.name ?? null);
  const v = String(s).trim();
  return v && !/^\d/.test(v) && v.toUpperCase() !== 'ETF' ? v : null;
};

// Sector allocation over the positions the page shows. Every position is
// in the total — a name whose sector is unknown (an ETF such as SPCX, a
// CUSIP that never resolved, a provider that answered null) goes into an
// "Unclassified" slice rather than being dropped and the rest inflated —
// so the legend always adds up to 100%.
//
// Pure, so the arithmetic is testable without a browser.
export function sectorSlices(positions, sectors, { unclassified = 'Unclassified', other = 'Other', maxSlices = 8 } = {}) {
  const bySector = new Map();
  let total = 0;
  let known = 0;
  for (const p of positions || []) {
    const w = num(p?.weight);
    if (w <= 0) continue;
    total += w;
    const s = p?.ticker ? sectorName(sectors?.[p.ticker]) : null;
    if (s) known += w;
    const key = s || unclassified;
    bySector.set(key, (bySector.get(key) || 0) + w);
  }
  if (!total) return { data: [], coverage: 0 };
  let data = [...bySector.entries()]
    .map(([name, w]) => ({ name, value: (w / total) * 100, unclassified: name === unclassified }))
    .sort((a, b) => (a.unclassified ? 1 : b.unclassified ? -1 : b.value - a.value));
  const named = data.filter((d) => !d.unclassified);
  const rest = data.filter((d) => d.unclassified);
  if (named.length > maxSlices - rest.length) {
    const keep = maxSlices - rest.length - 1;
    const tail = named.slice(keep).reduce((s, d) => s + d.value, 0);
    data = [...named.slice(0, keep), { name: other, value: tail }, ...rest];
  }
  return { data, coverage: (known / total) * 100 };
}

