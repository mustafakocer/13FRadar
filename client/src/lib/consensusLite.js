// consensus.json without `updates` — the per-fund quarter cards, well over
// half the file, that only the consensus page's fund tab reads. Every other
// page (home, a stock, the rankings, the quarter report) is seeded with, and
// keeps, this smaller object under ['consensus-lite'].
export function consensusLite(c) {
  if (!c || typeof c !== 'object') return c;
  const { updates: _updates, ...rest } = c;
  return rest;
}
