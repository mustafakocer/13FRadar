// @ts-check
// Türkiye Radarı (TR-14): which 13F filers hold US-listed Turkish exposure
// (TUR ETF, Turkish ADRs) and how that changed quarter over quarter, plus a
// Turkish plain-language summary generated from the numbers.
import { splitFactor } from './positionDiff.js';

/** @typedef {{ ticker: string, cusip: string, name: string, kind: 'etf'|'adr'|'other' }} Security */
/** @typedef {{ cusip: string, issuer: string, value: number, shares: number, weight: number, putCall?: string }} Pos */

/** Issuer-name heuristic for securities not in the curated list. @param {string} issuer */
export const looksTurkish = (issuer) => /\bTURK|TÜRK|TURKIYE|TURKEY|TURKCELL|ANADOLU|KOC HOLDING|SABANCI/i.test(String(issuer || ''));

/** Fresh accumulator. @param {Security[]} securities */
export function createTurkeyState(securities) {
  /** @type {Map<string, { security: Security, holders: any[], funds: number, value: number, shares: number, adding: number, reducing: number, newCount: number, exitCount: number, netFlow: number, diffFunds: number }>} */
  const m = new Map();
  for (const s of securities) m.set(s.cusip, { security: s, holders: [], funds: 0, value: 0, shares: 0, adding: 0, reducing: 0, newCount: 0, exitCount: 0, netFlow: 0, diffFunds: 0 });
  return m;
}

/**
 * Record one filer's positions in the tracked securities.
 * @param {ReturnType<typeof createTurkeyState>} state
 * @param {{ cik: string, name: string, filed?: string, aum?: number }} filer
 * @param {Pos[]} cur @param {Pos[] | null} prev
 */
export function collectTurkey(state, filer, cur, prev) {
  const curMap = new Map();
  for (const p of cur) if (!p.putCall && state.has(p.cusip)) curMap.set(p.cusip, p);
  const prevMap = new Map();
  if (prev) for (const p of prev) if (!p.putCall && state.has(p.cusip)) prevMap.set(p.cusip, p);
  if (!looksTurkish('') && !curMap.size && !prevMap.size) return;
  for (const cusip of new Set([...curMap.keys(), ...prevMap.keys()])) {
    const s = /** @type {any} */ (state.get(cusip));
    const p = curMap.get(cusip) || null;
    const q = prevMap.get(cusip) || null;
    /** @type {'NEW'|'ADD'|'REDUCE'|'EXIT'|'HOLD'|null} */
    let action = null;
    let dShares = null;
    if (prev) {
      s.diffFunds++;
      if (p && !q) {
        action = 'NEW';
        s.newCount++;
        s.adding++;
        s.netFlow += p.value;
        dShares = p.shares;
      } else if (!p && q) {
        action = 'EXIT';
        s.exitCount++;
        s.reducing++;
        s.netFlow -= q.value;
        dShares = -q.shares;
      } else if (p && q) {
        const base = q.shares * splitFactor(q, p);
        const d = p.shares - base;
        const px = p.shares ? p.value / p.shares : 0;
        if (d > base * 0.005) {
          action = 'ADD';
          s.adding++;
          s.netFlow += d * px;
        } else if (d < -base * 0.005) {
          action = 'REDUCE';
          s.reducing++;
          s.netFlow += d * px;
        } else action = 'HOLD';
        dShares = Math.round(d);
      }
    }
    if (p) {
      s.funds++;
      s.value += p.value;
      s.shares += p.shares;
      s.holders.push({ cik: filer.cik, name: filer.name, filed: filer.filed || null, value: p.value, shares: p.shares, weight: p.weight, action, dShares });
    } else if (q) {
      s.holders.push({ cik: filer.cik, name: filer.name, filed: filer.filed || null, value: 0, shares: 0, weight: 0, action, dShares, prevValue: q.value });
    }
  }
}

/** @param {ReturnType<typeof createTurkeyState>} state @param {string} period @param {number} [topHolders] */
export function finalizeTurkey(state, period, topHolders = 60) {
  return [...state.values()].map((s) => ({
    ...s.security,
    period,
    funds: s.funds,
    value: Math.round(s.value),
    shares: Math.round(s.shares),
    adding: s.adding,
    reducing: s.reducing,
    newCount: s.newCount,
    exitCount: s.exitCount,
    netFlow: Math.round(s.netFlow),
    diffFunds: s.diffFunds,
    holders: s.holders
      .sort((a, b) => b.value - a.value || (b.prevValue || 0) - (a.prevValue || 0))
      .slice(0, topHolders)
      .map((h) => ({ ...h, value: Math.round(h.value), weight: Number(h.weight.toFixed(3)) })),
  }));
}

/** Keep one totals row per period. @param {{ period: string, funds: number, value: number, shares: number, netFlow: number }[]} history @param {{ period: string, funds: number, value: number, shares: number, netFlow: number }} row */
export function upsertHistory(history, row) {
  const out = (history || []).filter((h) => h.period !== row.period);
  out.push({ period: row.period, funds: row.funds, value: row.value, shares: row.shares, netFlow: row.netFlow });
  return out.sort((a, b) => (a.period < b.period ? -1 : 1)).slice(-16);
}

const trQuarter = (/** @type {string} */ period) => {
  const [y, m] = period.split('-').map(Number);
  return `${y} yılı ${Math.ceil(m / 3)}. çeyreğinde`;
};
const trMoney = (/** @type {number} */ v) => {
  const a = Math.abs(v);
  const f = (/** @type {number} */ x, /** @type {number} */ d) => x.toFixed(d).replace(/\.0$/, '').replace('.', ',');
  if (a >= 1e9) return `${f(a / 1e9, a >= 1e10 ? 0 : 1)} milyar dolar`;
  if (a >= 1e6) return `${f(a / 1e6, a >= 1e8 ? 0 : 1)} milyon dolar`;
  if (a >= 1e3) return `${Math.round(a / 1e3)} bin dolar`;
  return `${Math.round(a)} dolar`;
};
const pct = (/** @type {number} */ v) => `%${v.toFixed(1).replace('.', ',')}`;

/**
 * Turkish plain-language summary, composed from the numbers (no hardcoded facts).
 * @param {ReturnType<typeof finalizeTurkey>[number]} s
 * @param {{ period: string, funds: number, value: number }[]} [history]
 */
export function narrativeTr(s, history = []) {
  const label = s.kind === 'etf' ? `${s.ticker} ETF'sinde` : `${s.ticker} (${s.name}) hissesinde`;
  const parts = [];
  if (!s.funds) {
    parts.push(`${trQuarter(s.period)} hiçbir 13F dosyalayıcısı ${label} pozisyon bildirmedi.`);
    return parts.join(' ');
  }
  parts.push(`${trQuarter(s.period)} ${s.funds} fon ${label} toplam ${trMoney(s.value)} tutarında pozisyon bildirdi.`);
  const prev = history.filter((h) => h.period < s.period).sort((a, b) => (a.period < b.period ? 1 : -1))[0];
  if (prev && prev.value) {
    const ch = s.value / prev.value - 1;
    const dir = ch > 0.005 ? 'arttı' : ch < -0.005 ? 'azaldı' : 'yatay kaldı';
    const fundsCh = s.funds - prev.funds;
    parts.push(`Toplam değer bir önceki çeyreğe göre ${pct(Math.abs(ch) * 100)} ${dir}; fon sayısı ${fundsCh > 0 ? `${fundsCh} arttı` : fundsCh < 0 ? `${-fundsCh} azaldı` : 'değişmedi'}.`);
  }
  if (s.diffFunds) {
    const bits = [];
    if (s.adding - s.newCount > 0) bits.push(`${s.adding - s.newCount} fon pozisyonunu artırdı`);
    if (s.reducing - s.exitCount > 0) bits.push(`${s.reducing - s.exitCount} fon azalttı`);
    if (s.newCount) bits.push(`${s.newCount} fon yeni girdi`);
    if (s.exitCount) bits.push(`${s.exitCount} fon tamamen çıktı`);
    if (bits.length) parts.push(bits.join(', ') + '.');
    if (s.netFlow) parts.push(`Tahmini net akış ${s.netFlow > 0 ? '+' : '−'}${trMoney(s.netFlow)} (${s.netFlow > 0 ? 'net alım' : 'net satım'}).`);
  }
  const top = s.holders.filter((h) => h.value > 0).slice(0, 3);
  if (top.length) {
    parts.push(`En büyük sahipler: ${top.map((h) => `${h.name} (${trMoney(h.value)}, portföyünün ${pct(h.weight)}'i)`).join(', ')}.`);
  }
  return parts.join(' ');
}
