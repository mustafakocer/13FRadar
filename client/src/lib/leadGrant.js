// The download grant a confirmed address earned (api/_lib/leads.js), kept on
// the device so the portfolio matcher can show its full list without asking
// again. It names nobody; it only expires.
const KEY = 'fc_lead_grant';

export function saveGrant(g) {
  try {
    if (/^\d{9,11}\.[A-Za-z0-9_-]{32}$/.test(String(g || ''))) localStorage.setItem(KEY, g);
  } catch {
    /* storage blocked: the link still works this visit */
  }
}

export function readGrant() {
  try {
    const g = localStorage.getItem(KEY) || '';
    const exp = Number(g.split('.')[0]);
    return exp * 1000 > Date.now() ? g : null;
  } catch {
    return null;
  }
}
