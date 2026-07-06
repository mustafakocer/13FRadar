// Tracks the last filing date the user has seen per manager (localStorage),
// so the watchlist can badge managers with a new 13F since the last visit.
const KEY = 'seenFilings13f';

function load() {
  try {
    return JSON.parse(localStorage.getItem(KEY)) || {};
  } catch {
    return {};
  }
}

export function markFilingSeen(cik, filingDate) {
  const seen = load();
  if (seen[cik] === filingDate) return;
  seen[cik] = filingDate;
  localStorage.setItem(KEY, JSON.stringify(seen));
}

export function getSeenFiling(cik) {
  return load()[cik] || null;
}
