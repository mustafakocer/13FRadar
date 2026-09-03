// @ts-check
// Thematic ETF flow pages (P2-12). Themes are lists of tickers; CUSIPs are
// resolved from the static cusip->ticker map (explicit cusip wins). Holder
// collection reuses the Türkiye Radarı accumulator.
import { createTurkeyState, collectTurkey, finalizeTurkey, upsertHistory, narrativeTr } from './turkey.js';

/** @typedef {{ id: string, name: string, nameEn: string, icon: string, securities: { ticker: string, cusip?: string, name: string, kind: 'etf'|'adr'|'other' }[] }} ThemeDef */

/** Resolve each security's CUSIP. @param {ThemeDef[]} themes @param {Record<string, string>} cusipToTicker */
export function resolveThemes(themes, cusipToTicker) {
  /** @type {Record<string, string>} */
  const byTicker = {};
  for (const [c, t] of Object.entries(cusipToTicker || {})) if (t && !byTicker[t]) byTicker[t] = c;
  return themes.map((th) => ({
    ...th,
    securities: th.securities
      .map((s) => ({ ...s, cusip: s.cusip || byTicker[s.ticker] || null }))
      .filter((s) => /** @type {boolean} */ (!!s.cusip)),
  }));
}

/** One accumulator per theme. @param {ReturnType<typeof resolveThemes>} themes */
export function createThemeStates(themes) {
  return themes.map((th) => ({ theme: th, state: createTurkeyState(/** @type {any} */ (th.securities)) }));
}

/** @param {ReturnType<typeof createThemeStates>} states @param {any} filer @param {any[]} cur @param {any[] | null} prev */
export function collectThemes(states, filer, cur, prev) {
  for (const s of states) collectTurkey(s.state, filer, cur, prev);
}

/**
 * @param {ReturnType<typeof createThemeStates>} states
 * @param {string} period
 * @param {{ themes?: { id: string, securities: { cusip: string, history?: any[] }[], history?: any[] }[] } | null} previous  previous themes.json
 */
export function finalizeThemes(states, period, previous) {
  return states.map(({ theme, state }) => {
    const old = previous?.themes?.find((t) => t.id === theme.id);
    const securities = finalizeTurkey(state, period).map((s) => {
      const oldSec = old?.securities?.find((x) => x.cusip === s.cusip);
      const history = upsertHistory(oldSec?.history || [], { period, funds: s.funds, value: s.value, shares: s.shares, netFlow: s.netFlow });
      return { ...s, history, narrative: narrativeTr(s, history) };
    });
    const holders = new Set();
    for (const s of securities) for (const h of s.holders) if (h.value > 0) holders.add(h.cik);
    const totals = {
      funds: holders.size,
      value: securities.reduce((a, s) => a + s.value, 0),
      shares: securities.reduce((a, s) => a + s.shares, 0),
      netFlow: securities.reduce((a, s) => a + s.netFlow, 0),
      adding: securities.reduce((a, s) => a + s.adding, 0),
      reducing: securities.reduce((a, s) => a + s.reducing, 0),
    };
    const history = upsertHistory(old?.history || [], { period, ...totals });
    return { id: theme.id, name: theme.name, nameEn: theme.nameEn, icon: theme.icon, period, ...totals, history, securities: securities.sort((a, b) => b.value - a.value) };
  });
}
