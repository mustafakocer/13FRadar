import { fmtMoney, quarterLabel } from './format.js';

// Title / description templates per entity type, TR and EN. Every
// description carries real numbers from the data so no two pages read alike.
const q = (reportDate) => {
  if (!reportDate) return { q: '', y: '' };
  const [y, m] = reportDate.split('-').map(Number);
  return { q: Math.ceil(m / 3), y };
};
export const quarterText = (reportDate, lang) => {
  const { q: qq, y } = q(reportDate);
  if (!qq) return '';
  return lang === 'tr' ? `${y} Q${qq}` : `Q${qq} ${y}`;
};

const num = (n, lang) => (n == null ? '—' : n.toLocaleString(lang === 'tr' ? 'tr-TR' : 'en-US'));

export function managerSeo({ lang, cik, manager, filing, holdings }) {
  const name = manager?.name || `CIK ${cik}`;
  const qt = quarterText(filing?.reportDate, lang);
  const top = holdings?.positions?.[0];
  const topTxt = top ? `${top.ticker || top.issuer} (${top.weight.toFixed(1)}%)` : null;
  const count = holdings?.count;
  const aum = holdings?.aum;
  const title =
    lang === 'tr'
      ? `${name} Portföyü ${qt}: Pozisyonlar, Alımlar ve Satışlar | 13F Radar`
      : `${name} Portfolio ${qt}: Holdings, Buys & Sells | 13F Radar`;
  let description;
  if (lang === 'tr') {
    description = `${name}, ${qt} 13F bildiriminde ${num(count, lang)} pozisyon ve ${fmtMoney(aum)} portföy büyüklüğü raporladı.`;
    if (topTxt) description += ` En büyük pozisyon: ${topTxt}.`;
    description += ' Çeyreklik alım-satımlar, yeni girişler ve çıkışlar SEC EDGAR verisiyle.';
  } else {
    description = `${name} reported ${num(count, lang)} positions worth ${fmtMoney(aum)} in its ${qt} 13F filing.`;
    if (topTxt) description += ` Top holding: ${topTxt}.`;
    description += ' Quarterly buys, sells, new positions and exits from SEC EDGAR data.';
  }
  return { title, description, path: `/manager/${cik}`, image: `/api/og?type=guru&cik=${cik}`, type: 'article' };
}

export function stockSeo({ lang, ticker, cusip, stock, holders }) {
  const sym = (stock?.price?.symbol || ticker || '').toUpperCase();
  const company = stock?.price?.name || sym;
  const n = holders?.total ?? holders?.holders?.length;
  const price = stock?.price?.price;
  const title =
    lang === 'tr'
      ? `${sym} — ${company} Hissesini Hangi Usta Yatırımcılar Tutuyor? | 13F Radar`
      : `${sym} — Which Superinvestors Hold ${company}? | 13F Radar`;
  let description;
  if (lang === 'tr') {
    description = n != null ? `${num(n, lang)} kurumsal yatırımcı ${company} (${sym}) hissesini 13F bildiriminde raporluyor.` : `${company} (${sym}) hissesinin kurumsal sahipleri.`;
    if (price != null) description += ` Fiyat ${price.toFixed(2)} ${stock?.price?.currency || 'USD'}.`;
    description += ' En büyük sahipler, çeyreklik adet değişimleri, usta yatırımcı sinyali ve rasyolar.';
  } else {
    description = n != null ? `${num(n, lang)} institutional filers report ${company} (${sym}) on Form 13F.` : `Institutional owners of ${company} (${sym}).`;
    if (price != null) description += ` Price ${price.toFixed(2)} ${stock?.price?.currency || 'USD'}.`;
    description += ' Largest holders, quarterly share changes, superinvestor signal and valuation ratios.';
  }
  return {
    title,
    description,
    path: `/stock/${sym}${cusip ? `?cusip=${cusip}` : ''}`,
    image: `/api/og?type=stock&ticker=${encodeURIComponent(sym)}`,
    type: 'article',
  };
}

export function homeSeo({ lang }) {
  return {
    title: lang === 'tr' ? '13F Radar — Akıllı Parayı ve İçeriden Alımları Takip Edin' : '13F Radar — Track the Smart Money & Insiders',
    description:
      lang === 'tr'
        ? "8.000'den fazla fonun 13F portföyleri, usta yatırımcı konsensüsü ve SEC Form 4 insider sinyalleri. Warren Buffett'tan Michael Burry'ye kim ne alıyor, ne satıyor."
        : '13F portfolios of 8,000+ funds, superinvestor consensus and SEC Form 4 insider signals. From Warren Buffett to Michael Burry: who is buying and selling.',
    path: '/',
  };
}

export function consensusSeo({ lang, data }) {
  const n = data?.managers?.length;
  const latest = (data?.managers || []).reduce((m, x) => (x.reportDate > m ? x.reportDate : m), '');
  const qt = quarterText(latest, lang);
  const top = data?.mostHeld?.[0];
  return {
    title: lang === 'tr' ? `Usta Yatırımcı Konsensüsü ${qt}: En Çok Tutulan Hisseler | 13F Radar` : `Superinvestor Consensus ${qt}: Most Held Stocks | 13F Radar`,
    description:
      lang === 'tr'
        ? `${n || ''} efsane fonun birleşik 13F görünümü.${top ? ` En çok tutulan: ${top.ticker || top.issuer} (${top.holderCount} fon).` : ''} Bu çeyrek en çok alınan ve satılan hisseler.`
        : `Combined 13F view of ${n || ''} legendary funds.${top ? ` Most held: ${top.ticker || top.issuer} (${top.holderCount} funds).` : ''} Top buys and sells this quarter.`,
    path: '/consensus',
  };
}
