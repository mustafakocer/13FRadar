// Mirror of api/_lib/plan.js LIMITS (the server is authoritative).
export const LIMITS = {
  free: { quarters: 2, watchlist: 5, compareFunds: 2, alerts: 5, groups: 1, groupMembers: 5 },
  pro: { quarters: Infinity, watchlist: Infinity, compareFunds: 5, alerts: Infinity, groups: Infinity, groupMembers: 20 },
};
