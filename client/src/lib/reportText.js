import { fmtMoney } from './format.js';

// Answer box for a quarterly report page (shared by the generator, the page
// and the markdown export).
export function reportAnswer(r, lang = 'en') {
  const b = r.topBuysByValue?.[0];
  const s = r.topSellsByValue?.[0];
  const sym = (x) => (x ? x.ticker || x.issuer : '—');
  if (lang === 'tr') {
    let t = `${r.year} Q${r.quarter} raporu, takip edilen ${r.coverage.tracked} usta yatırımcıdan ${r.coverage.onQuarter}'inin ${r.quarterEnd} tarihli 13F bildirimlerine dayanır.`;
    if (b) t += ` Dolar bazında en çok alınan hisse ${sym(b)} (${fmtMoney(b.netValue)} net alım, ${b.buyers} fon).`;
    if (s) t += ` En çok satılan ${sym(s)} (${fmtMoney(Math.abs(s.netValue))} net satış, ${s.sellers} fon).`;
    if (r.newConsensus?.length) t += ` ${r.newConsensus.length} hisse ilk kez 5 veya daha fazla usta yatırımcı tarafından tutuluyor.`;
    return t;
  }
  let t = `The Q${r.quarter} ${r.year} report covers ${r.coverage.onQuarter} of ${r.coverage.tracked} tracked superinvestors with 13F filings for ${r.quarterEnd}.`;
  if (b) t += ` The most bought stock by dollars was ${sym(b)} (${fmtMoney(b.netValue)} net, ${b.buyers} funds).`;
  if (s) t += ` The most sold was ${sym(s)} (${fmtMoney(Math.abs(s.netValue))} net, ${s.sellers} funds).`;
  if (r.newConsensus?.length) t += ` ${r.newConsensus.length} stocks became consensus positions (held by 5+ gurus) for the first time.`;
  return t;
}
