// Which rows of the per-security table each ranking page lists. One place,
// because the server seeds a ranking page with exactly these rows
// (api/_lib/ssr/routes.js loadRankings) and the page must list the same ones.
// The options ranking reads its own table and none of these rows.
export const RANKING_ROWS = {
  'most-bought': (r) => r.netValue > 0,
  'most-sold': (r) => r.netValue < 0,
  consensus: () => true,
  conviction: (r) => r.holderCount >= 2,
  options: () => false,
};
