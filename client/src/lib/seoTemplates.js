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

export function managerSeo({ lang, cik, manager, filing, holdings, prevPositions }) {
  if (!cik) return { title: lang === 'tr' ? 'Yükleniyor… | 13F Radar' : 'Loading… | 13F Radar', path: '/gurus' };
  const name = manager?.displayName || manager?.name || `CIK ${cik}`;
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
  const path = manager?.path || `/manager/${cik}`;
  const faq = managerFaq({ lang, name, filing, holdings, prevPositions });
  const crumbs = breadcrumbs(lang, [
    manager?.kind === 'guru' ? [lang === 'tr' ? 'Usta Yatırımcılar' : 'Superinvestors', '/gurus'] : [lang === 'tr' ? '13F Dosyalayan Kurumlar' : '13F Filers', '/filers'],
    [name, path],
  ]);
  return {
    title,
    description,
    path,
    image: `/api/og?type=guru&cik=${cik}`,
    type: 'article',
    faq,
    jsonLd: [crumbs, ...(faq.length ? [faqJsonLd(faq)] : [])],
  };
}

export function stockSeo({ lang, ticker, cusip, stock, holders, consensusRow }) {
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
  const path = `/stock/${sym}`;
  const faq = stockFaq({ lang, ticker: sym, company, holders, consensusRow });
  return {
    title,
    description,
    // one canonical per ticker: the ?cusip variant is a query-time hint only
    path,
    image: `/api/og?type=stock&ticker=${encodeURIComponent(sym)}`,
    type: 'article',
    faq,
    jsonLd: [breadcrumbs(lang, [[lang === 'tr' ? 'Hisseler' : 'Stocks', '/consensus'], [`${company} (${sym})`, path]]), faqJsonLd(faq)],
  };
}

export function homeSeo({ lang }) {
  return {
    jsonLd: siteJsonLd(lang),
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

// ---- structured data ------------------------------------------------------
// Paths here are language-free; the SSR head builder and the client apply
// the /en or /tr prefix. JSON-LD needs absolute URLs, so blocks that carry
// URLs are finished by absolutize() in seo.jsx with the site origin.
export const HOME_NAME = { en: 'Home', tr: 'Ana Sayfa' };

export function breadcrumbs(lang, items) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [[HOME_NAME[lang] || HOME_NAME.en, '/'], ...items].map(([name, path], i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name,
      item: { '@id': `__SITE__/${lang}${path === '/' ? '' : path}` },
    })),
  };
}

export function siteJsonLd(lang) {
  return [
    {
      '@context': 'https://schema.org',
      '@type': 'Organization',
      name: '13F Radar',
      url: `__SITE__/${lang}`,
      logo: '__SITE__/api/og',
    },
    {
      '@context': 'https://schema.org',
      '@type': 'WebSite',
      name: '13F Radar',
      url: `__SITE__/${lang}`,
      inLanguage: lang,
      potentialAction: {
        '@type': 'SearchAction',
        target: { '@type': 'EntryPoint', urlTemplate: `__SITE__/${lang}/?q={search_term_string}` },
        'query-input': 'required name=search_term_string',
      },
    },
  ];
}

export function faqJsonLd(items) {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: items.map(([q, a]) => ({
      '@type': 'Question',
      name: q,
      acceptedAnswer: { '@type': 'Answer', text: a },
    })),
  };
}

const list = (arr, lang) => {
  if (!arr.length) return '';
  const sep = lang === 'tr' ? ' ve ' : ' and ';
  return arr.length === 1 ? arr[0] : `${arr.slice(0, -1).join(', ')}${sep}${arr[arr.length - 1]}`;
};
const sym = (p) => p.ticker || p.issuer;

// Programmatic FAQ for a guru page — answers computed from the free tier
// data (top 10 positions and their previous-quarter counterparts).
export function managerFaq({ lang, name, filing, holdings, prevPositions }) {
  if (!holdings?.positions?.length || !filing) return [];
  const qt = quarterText(filing.reportDate, lang);
  const pos = holdings.positions.slice(0, 10);
  const prev = new Map((prevPositions || []).map((p) => [p.cusip, p]));
  const top = pos.slice(0, 5).map((p) => `${sym(p)} (${p.weight.toFixed(1)}%)`);
  const bought = pos.filter((p) => !prev.has(p.cusip) || p.shares > prev.get(p.cusip).shares).map(sym);
  const sold = pos.filter((p) => prev.has(p.cusip) && p.shares < prev.get(p.cusip).shares).map(sym);
  const exits = (prevPositions || []).filter((q) => !pos.some((p) => p.cusip === q.cusip)).map(sym);
  const count = holdings.count ?? holdings.positions.length;
  const hasPrev = prevPositions != null;
  if (lang === 'tr') {
    return [
      [
        `${name} ${qt} itibarıyla hangi hisseleri tutuyor?`,
        `${name}, ${qt} 13F bildiriminde ${count} pozisyon ve ${fmtMoney(holdings.aum)} portföy büyüklüğü raporladı. En büyük pozisyonlar: ${list(top, lang)}.`,
      ],
      [
        `${name} ${qt} çeyreğinde ne aldı?`,
        hasPrev
          ? bought.length
            ? `En büyük 10 pozisyon arasında ${qt} çeyreğinde yeni alınan veya artırılan hisseler: ${list(bought, lang)}.`
            : `En büyük 10 pozisyon arasında ${qt} çeyreğinde artırılan hisse yok.`
          : 'Önceki çeyrek verisi henüz yok; karşılaştırma bir sonraki bildirimle mümkün olacak.',
      ],
      [
        `${name} ${qt} çeyreğinde ne sattı?`,
        hasPrev
          ? sold.length || exits.length
            ? `${sold.length ? `Azaltılan pozisyonlar: ${list(sold, lang)}.` : ''}${exits.length ? ` Tamamen çıkılan pozisyonlar (görünen kısım): ${list(exits.slice(0, 5), lang)}.` : ''}`.trim()
            : `En büyük 10 pozisyon arasında ${qt} çeyreğinde azaltılan hisse yok.`
          : 'Önceki çeyrek verisi henüz yok.',
      ],
    ];
  }
  return [
    [
      `What stocks does ${name} hold as of ${qt}?`,
      `${name} reported ${count} positions worth ${fmtMoney(holdings.aum)} in its ${qt} 13F filing. Largest positions: ${list(top, lang)}.`,
    ],
    [
      `What did ${name} buy in ${qt}?`,
      hasPrev
        ? bought.length
          ? `Among its top 10 positions, ${name} opened or added to ${list(bought, lang)} in ${qt}.`
          : `${name} did not add to any of its top 10 positions in ${qt}.`
        : 'No previous quarter is available yet; the comparison appears with the next filing.',
    ],
    [
      `What did ${name} sell in ${qt}?`,
      hasPrev
        ? sold.length || exits.length
          ? `${sold.length ? `Reduced positions: ${list(sold, lang)}.` : ''}${exits.length ? ` Positions sold out entirely (visible portion): ${list(exits.slice(0, 5), lang)}.` : ''}`.trim()
          : `${name} did not reduce any of its top 10 positions in ${qt}.`
        : 'No previous quarter is available yet.',
    ],
  ];
}

// Programmatic FAQ for a stock page — holders from EDGAR full-text search and
// buyer/seller counts from the superinvestor consensus file.
export function stockFaq({ lang, ticker, company, holders, consensusRow }) {
  const names = (holders?.holders || []).slice(0, 5).map((h) => h.name);
  const total = holders?.total ?? holders?.holders?.length ?? 0;
  const buyers = consensusRow?.buyers ?? 0;
  const sellers = consensusRow?.sellers ?? 0;
  const tone = buyers > sellers ? 'bullish' : sellers > buyers ? 'bearish' : 'neutral';
  const toneTr = { bullish: 'boğa (alıcı ağırlıklı)', bearish: 'ayı (satıcı ağırlıklı)', neutral: 'nötr' }[tone];
  if (lang === 'tr') {
    return [
      [
        `${ticker} hissesini hangi usta yatırımcılar tutuyor?`,
        names.length
          ? `${company} (${ticker}) hissesini 13F bildiriminde raporlayan ${total} kurum var. Öne çıkan sahipler: ${list(names, lang)}.`
          : `${company} (${ticker}) için henüz 13F sahiplik verisi yok.`,
      ],
      [
        `${ticker} için kurumsal duyarlılık boğa mı ayı mı?`,
        consensusRow
          ? `Usta yatırımcı setinde son çeyrekte ${buyers} fon ${ticker} alırken ${sellers} fon sattı; net duyarlılık ${toneTr}.`
          : `${ticker} usta yatırımcı setinin en çok tutulan 30 hissesi arasında değil; net alım-satım verisi bu sette hesaplanmıyor.`,
      ],
    ];
  }
  return [
    [
      `Which superinvestors own ${ticker}?`,
      names.length
        ? `${total} institutional filers report ${company} (${ticker}) on Form 13F. Notable holders include ${list(names, lang)}.`
        : `No 13F ownership data is available for ${company} (${ticker}) yet.`,
    ],
    [
      `Is institutional sentiment on ${ticker} bullish or bearish?`,
      consensusRow
        ? `Across the superinvestor set, ${buyers} funds bought and ${sellers} funds sold ${ticker} last quarter, so net sentiment is ${tone}.`
        : `${ticker} is not among the 30 most-held stocks of the superinvestor set, so net buyer/seller counts are not computed for it.`,
    ],
  ];
}
