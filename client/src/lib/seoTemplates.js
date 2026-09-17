import { fmtMoney, quarterLabel } from './format.js';
import { guruAnswerFromPage, stockAnswerFromPage, rankingAnswer, truncate155, RANK_NAME } from './answerBox.js';
import { organization, website, guruEntity, guruDataset, corporation, stockDataset, article, itemList } from './jsonld.js';

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

// segment: 'portfolio' is the fund's front page; 'changes' | 'mix' | 'history'
// | 'backtest' are its sub-pages, each with its own title and canonical. The
// Person/Dataset entities and the FAQ describe the fund, not a sub-page, so
// they are emitted on the front only — a segment carries breadcrumbs and no
// duplicate of the entity that lives one level up.
export function managerSeo({ lang, cik, manager, filing, holdings, prevPositions, history = null, segment = 'portfolio' }) {
  if (!cik) return { title: lang === 'tr' ? 'Yükleniyor… | Fundocap' : 'Loading… | Fundocap', path: '/gurus' };
  const name = manager?.displayName || manager?.name || `CIK ${cik}`;
  const qt = quarterText(filing?.reportDate, lang);
  const top = holdings?.positions?.[0];
  const topTxt = top ? `${top.ticker || top.issuer} (${top.weight.toFixed(1)}%)` : null;
  const count = holdings?.count;
  const aum = holdings?.aum;
  const title =
    lang === 'tr'
      ? `${name} Portföyü ${qt}: Pozisyonlar, Alımlar ve Satışlar | Fundocap`
      : `${name} Portfolio ${qt}: Holdings, Buys & Sells | Fundocap`;
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
  const front = manager?.path || `/manager/${cik}`;
  const answer = guruAnswerFromPage({ manager, filing, holdings, prevPositions, update: manager?.update }, lang);
  if (answer) description = truncate155(answer);
  const faq = managerFaq({ lang, name, filing, holdings, prevPositions });
  const parent = manager?.kind === 'guru' ? [lang === 'tr' ? 'Usta Yatırımcılar' : 'Superinvestors', '/gurus'] : [lang === 'tr' ? '13F Dosyalayan Kurumlar' : '13F Filers', '/filers'];

  if (segment !== 'portfolio') {
    const tr = lang === 'tr';
    const sub = {
      changes: {
        label: tr ? 'Değişimler' : 'Changes',
        title: tr ? `${name} ${qt}: Bu Çeyrek Ne Aldı, Ne Sattı` : `${name} ${qt}: What It Bought and Sold This Quarter`,
        description: tr
          ? `${name} portföyünün ${qt} çeyreğindeki değişimi: yeni alınan, artırılan, azaltılan ve tamamen çıkılan pozisyonlar, bir önceki 13F ile karşılaştırmalı.`
          : `How ${name}'s portfolio changed in ${qt}: positions opened, added to, reduced and exited, against the previous 13F.`,
      },
      mix: {
        label: tr ? 'Dağılım' : 'Mix',
        title: tr ? `${name} ${qt}: Portföy ve Sektör Dağılımı` : `${name} ${qt}: Portfolio and Sector Mix`,
        description: tr
          ? `${name} portföyünün ${qt} çeyreğinde pozisyon ve sektör dağılımı, getiri karşılaştırması ve opsiyon pozisyonları.`
          : `${name}'s ${qt} portfolio by position and by sector, return comparison and option positions.`,
      },
      history: {
        label: tr ? 'Geçmiş' : 'History',
        title: tr ? `${name}: Portföy Büyüklüğü ve Çeyreklik Geçmiş` : `${name}: Portfolio Value and Quarterly History`,
        description: tr
          ? `${name} için çeyreklik portföy büyüklüğü, tahmini para giriş-çıkışı ve geçmiş 13F bildirimleri.`
          : `${name}'s portfolio value by quarter, estimated net flows and past 13F filings.`,
      },
      backtest: {
        label: 'Backtest',
        title: tr ? `${name}: 13F Kopyalama Backtesti` : `${name}: Copy-the-13F Backtest`,
        description: tr
          ? `${name} portföyünü her çeyrek bildirim sonrası kopyalasaydınız ne olurdu — SPY ile karşılaştırmalı, deneysel.`
          : `What copying ${name}'s 13F each quarter after it was filed would have returned, against SPY — experimental.`,
      },
    }[segment];
    if (sub) {
      const path = `${front}/${segment}`;
      return {
        title: `${sub.title} | Fundocap`,
        description: sub.description,
        path,
        image: `/api/og?type=guru&cik=${cik}`,
        type: 'article',
        faq: [],
        answer: null,
        dateModified: filing?.filingDate || null,
        jsonLd: [breadcrumbs(lang, [parent, [name, front], [sub.label, path]])],
      };
    }
  }

  const path = front;
  const crumbs = breadcrumbs(lang, [parent, [name, path]]);
  return {
    title,
    description,
    path,
    image: `/api/og?type=guru&cik=${cik}`,
    type: 'article',
    faq,
    answer,
    dateModified: filing?.filingDate || null,
    jsonLd: [
      ...(manager
        ? [
            guruEntity({ manager, lang, path, description: answer || description }),
            guruDataset({ manager, lang, path, description: answer || description, filings: manager.filings || [], history }),
          ]
        : []),
      crumbs,
      ...(faq.length ? [faqJsonLd(faq)] : []),
    ],
  };
}

export function stockSeo({ lang, ticker, cusip, stock, consensusRow, reportDate }) {
  const sym = (stock?.price?.symbol || ticker || '').toUpperCase();
  const company = stock?.price?.name || sym;
  const n = consensusRow?.holderCount;
  const price = stock?.price?.price;
  const title =
    lang === 'tr'
      ? `${sym} — ${company} Hissesini Hangi Usta Yatırımcılar Tutuyor? | Fundocap`
      : `${sym} — Which Superinvestors Hold ${company}? | Fundocap`;
  let description;
  if (lang === 'tr') {
    description = n ? `${num(n, lang)} usta yatırımcı ${company} (${sym}) hissesini 13F bildiriminde raporluyor.` : `${company} (${sym}) hissesinin kurumsal sahipliği.`;
    if (price != null) description += ` Fiyat ${price.toFixed(2)} ${stock?.price?.currency || 'USD'}.`;
    description += ' Usta yatırımcı sinyali, çeyreklik adet değişimleri, içeriden işlemler ve rasyolar.';
  } else {
    description = n ? `${num(n, lang)} tracked superinvestors report ${company} (${sym}) on Form 13F.` : `Institutional ownership of ${company} (${sym}).`;
    if (price != null) description += ` Price ${price.toFixed(2)} ${stock?.price?.currency || 'USD'}.`;
    description += ' Superinvestor signal, quarterly share changes, insider trades and valuation ratios.';
  }
  const path = `/stock/${sym}`;
  const answer = stock
    ? stockAnswerFromPage({ ticker: sym, company, consensusRow, reportDate, quote: stock.price }, lang)
    : null;
  if (answer) description = truncate155(answer);
  const faq = stockFaq({ lang, ticker: sym, company, consensusRow });
  return {
    title,
    description,
    answer,
    // one canonical per ticker: the ?cusip variant is a query-time hint only
    path,
    image: `/api/og?type=stock&ticker=${encodeURIComponent(sym)}`,
    type: 'article',
    faq,
    dateModified: reportDate || null,
    jsonLd: [
      ...(stock
        ? [
            corporation({ company, ticker: sym, lang, path, description: answer || description }),
            stockDataset({ company, ticker: sym, lang, path, description: answer || description, reportDate }),
          ]
        : []),
      breadcrumbs(lang, [[lang === 'tr' ? 'Hisseler' : 'Stocks', '/consensus'], [`${company} (${sym})`, path]]),
      faqJsonLd(faq),
    ],
  };
}

export function homeSeo({ lang }) {
  return {
    jsonLd: siteJsonLd(lang),
    title: lang === 'tr' ? 'Fundocap — Akıllı Parayı ve İçeriden Alımları Takip Edin' : 'Fundocap — Track the Smart Money & Insiders',
    description:
      lang === 'tr'
        ? "8.000'den fazla fonun 13F portföyleri, usta yatırımcı konsensüsü ve SEC Form 4 insider sinyalleri. Warren Buffett'tan Michael Burry'ye kim ne alıyor, ne satıyor."
        : '13F portfolios of 8,000+ funds, superinvestor consensus and SEC Form 4 insider signals. From Warren Buffett to Michael Burry: who is buying and selling.',
    path: '/',
  };
}

export function consensusSeo({ lang, data, segment = 'held', t = null }) {
  const tr = lang === 'tr';
  const n = data?.managers?.length;
  const latest = (data?.managers || []).reduce((m, x) => (x.reportDate > m ? x.reportDate : m), '');
  const qt = quarterText(latest, lang);
  const top = data?.mostHeld?.[0];
  const buy = data?.topBought?.[0];
  const sell = data?.topSold?.[0];
  const fresh = data?.newPositions?.length;
  const path = segment === 'held' ? '/consensus' : `/consensus/${segment}`;
  const funds = n ? (tr ? `${n} efsane fon` : `${n} legendary funds`) : tr ? 'efsane fonlar' : 'legendary funds';

  // Each segment is its own page, so each gets a title that says what is on
  // it and a first sentence a reader — or an assistant — can quote alone.
  const copy = {
    held: {
      title: tr ? `Usta Yatırımcı Konsensüsü ${qt}: En Çok Tutulan Hisseler` : `Superinvestor Consensus ${qt}: Most Held Stocks`,
      description: tr
        ? `${funds}un birleşik 13F görünümü.${top ? ` En çok tutulan: ${top.ticker || top.issuer} (${top.holderCount} fon).` : ''} Her satırda hisseyi tutan fonlar açılır.`
        : `Combined 13F view of ${funds}.${top ? ` Most held: ${top.ticker || top.issuer} (${top.holderCount} funds).` : ''} Every row opens to the funds holding it.`,
      answer: top
        ? tr
          ? `${qt} 13F bildirimlerine göre takip edilen ${funds}un en çok tuttuğu hisse ${top.ticker || top.issuer} (${top.holderCount} fon). Liste, hisseyi tutan fon sayısına göre sıralanır; bir satıra tıklayınca tutan fonların tamamı ve ağırlıkları açılır.`
          : `By ${qt} 13F filings, the stock most widely held among the ${funds} tracked is ${top.ticker || top.issuer} (${top.holderCount} funds). The list ranks by how many funds hold each name; a row opens to every fund holding it and the weight each carries.`
        : null,
    },
    bought: {
      title: tr ? `Ustaların Bu Çeyrek Aldığı Hisseler ${qt}` : `What Superinvestors Bought ${qt}`,
      description: tr
        ? `${funds}un ${qt} çeyreğinde net alım yaptığı hisseler, dolar bazında.${buy ? ` En çok alınan: ${buy.ticker || buy.issuer}.` : ''}`
        : `Stocks ${funds} were net buyers of in ${qt}, in dollars.${buy ? ` Most bought: ${buy.ticker || buy.issuer}.` : ''}`,
      answer: buy
        ? tr
          ? `${qt} çeyreğinde takip edilen ${funds} arasında net alımın en yüksek olduğu hisse ${buy.ticker || buy.issuer} (${buy.buyers} fon aldı). Net alım = artırma ve yeni pozisyonların değeri eksi azaltmalar, önceki çeyreğe göre.`
          : `In ${qt}, the stock with the largest net buying across the ${funds} tracked was ${buy.ticker || buy.issuer} (${buy.buyers} funds bought). Net buying is adds and new positions minus reductions, quarter over quarter.`
        : null,
    },
    sold: {
      title: tr ? `Ustaların Bu Çeyrek Sattığı Hisseler ${qt}` : `What Superinvestors Sold ${qt}`,
      description: tr
        ? `${funds}un ${qt} çeyreğinde net satış yaptığı hisseler, dolar bazında.${sell ? ` En çok satılan: ${sell.ticker || sell.issuer}.` : ''}`
        : `Stocks ${funds} were net sellers of in ${qt}, in dollars.${sell ? ` Most sold: ${sell.ticker || sell.issuer}.` : ''}`,
      answer: sell
        ? tr
          ? `${qt} çeyreğinde takip edilen ${funds} arasında net satışın en yüksek olduğu hisse ${sell.ticker || sell.issuer} (${sell.sellers} fon sattı). Net satış = azaltma ve tam çıkışların değeri eksi alımlar.`
          : `In ${qt}, the stock with the largest net selling across the ${funds} tracked was ${sell.ticker || sell.issuer} (${sell.sellers} funds sold). Net selling is reductions and full exits minus buying.`
        : null,
    },
    new: {
      title: tr ? `Ustaların Portföyüne Yeni Giren Hisseler ${qt}` : `New Positions Superinvestors Opened ${qt}`,
      description: tr
        ? `${qt} çeyreğinde ${funds}un ilk kez aldığı hisseler, fon ve portföy ağırlığıyla.`
        : `Stocks ${funds} bought for the first time in ${qt}, with the fund and its portfolio weight.`,
      answer: fresh
        ? tr
          ? `${qt} çeyreğinde takip edilen ${funds}, ${fresh} yeni pozisyon açtı: bir önceki 13F'te yer almayıp bu çeyrek ilk kez görünen hisseler. Liste portföy ağırlığına göre sıralanır.`
          : `In ${qt} the ${funds} tracked opened ${fresh} new positions: stocks absent from the previous 13F and appearing for the first time this quarter. The list ranks by portfolio weight.`
        : null,
    },
    funds: {
      title: tr ? `Takip Edilen Usta Yatırımcılar ve Son Çeyrek Hamleleri` : `Tracked Superinvestors and Their Latest Moves`,
      description: tr
        ? `${funds}un her biri için ${qt} çeyreğinde yeni aldığı, artırdığı, azalttığı ve çıktığı hisseler.`
        : `For each of the ${funds}: what it bought new, added to, reduced and exited in ${qt}.`,
      answer: n
        ? tr
          ? `Konsensüs ${n} fonun 13F bildirimlerinden hesaplanır. Bu sayfa her fonu tek satırda gösterir: ${qt} çeyreğinde yeni aldığı, artırdığı, azalttığı ve tamamen çıktığı hisseler, adet değişim yüzdesiyle.`
          : `The consensus is computed from ${n} funds' 13F filings. This page lists each fund on one line: what it bought new, added to, reduced and exited in ${qt}, with the change in share count.`
        : null,
    },
    universe: {
      title: tr ? `Tüm Wall Street'in En Çok Tuttuğu Hisseler` : `Most Held Stocks Across All of Wall Street`,
      description: tr
        ? `13F bildiren tüm kurumların (8.000+ fon) en çok tuttuğu hisseler, fon sayısı ve toplam değerle.`
        : `The stocks held by the most institutions across every 13F filer (8,000+ funds), with fund count and total value.`,
      answer: tr
        ? `Bu liste yalnızca takip edilen ustaları değil, SEC'e 13F bildiren tüm kurumları sayar: bir hisseyi kaç fonun tuttuğu ve bu pozisyonların toplam değeri. Usta konsensüsüyle karşılaştırmak için kullanılır.`
        : `This list counts every institution filing a 13F with the SEC, not only the tracked superinvestors: how many funds hold a stock and what those positions are worth in total. It is the baseline the guru consensus is read against.`,
    },
  }[segment] || {};

  const crumbs = [[tr ? 'Usta Yatırımcılar' : 'Superinvestors', '/consensus']];
  if (segment !== 'held' && t) crumbs.push([t(`consensus.tab.${segment}`), path]);
  return {
    title: `${copy.title} | Fundocap`,
    description: copy.description,
    answer: copy.answer || null,
    path,
    jsonLd: [breadcrumbs(lang, crumbs)],
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
  return [organization(lang), website(lang)];
}

// Ranking pages: Article + ItemList (entity URLs) + FAQPage + BreadcrumbList
export function rankingJsonLd({ lang, kind, title, path, answer, rows, reportDate, updatedAt, managers }) {
  const items = rows.slice(0, 30).map((r) => ({ name: `${r.ticker || r.issuer} — ${r.issuer}`, path: r.ticker ? `/stock/${r.ticker}` : '/consensus' }));
  const qt = quarterText(reportDate, lang);
  const first = rows[0];
  const sym = first ? first.ticker || first.issuer : '';
  const faq = first
    ? lang === 'tr'
      ? [
          [`${qt} çeyreğinde usta yatırımcıların ${RANK_NAME.tr[kind].toLowerCase()} listesinde 1. sırada hangi hisse var?`, `${sym} (${first.issuer}), ${managers || ''} fonun ${qt} 13F bildirimlerine göre listenin başında; ${first.holderCount} fon tutuyor.`],
          [`Bu sıralama nasıl hesaplanır?`, `${RANK_NAME.tr[kind]} listesi ${answer ? answer.split('; ')[0].replace(/^.*?ve /, '') : 'takip edilen usta yatırımcı setinin çeyreklik 13F bildirimlerinden'} hesaplanır; veriler çeyrek sonunu 45 güne kadar geriden izler.`],
        ]
      : [
          [`Which stock is #1 on the superinvestor ${RANK_NAME.en[kind].toLowerCase()} list for ${qt}?`, `${sym} (${first.issuer}) tops the list based on ${qt} 13F filings from ${managers || ''} tracked funds; ${first.holderCount} of them hold it.`],
          [`How is this ranking computed?`, `${RANK_NAME.en[kind]} is ${answer ? answer.split('; ')[0].replace(/^.*?, ranked/, 'ranked') : 'computed from the quarterly 13F filings of the tracked superinvestor set'}; the data lags quarter end by up to 45 days.`],
        ]
    : [];
  return {
    faq,
    jsonLd: [
      article({ headline: title, description: answer || title, lang, path, datePublished: reportDate, dateModified: (updatedAt || '').slice(0, 10) || reportDate }),
      ...(items.length ? [itemList({ name: title, lang, items })] : []),
      ...(faq.length ? [faqJsonLd(faq)] : []),
      breadcrumbs(lang, [[lang === 'tr' ? 'Sıralamalar' : 'Rankings', '/rankings/consensus'], [title, path]]),
    ],
  };
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

// Programmatic FAQ for a stock page. Both answers come from the superinvestor
// consensus file: who holds the stock, and how the group moved last quarter.
export function stockFaq({ lang, ticker, company, consensusRow }) {
  const names = (consensusRow?.holders || []).slice(0, 5).map((h) => h.name);
  const total = consensusRow?.holderCount ?? names.length;
  const buyers = consensusRow?.buyers ?? 0;
  const sellers = consensusRow?.sellers ?? 0;
  const tone = buyers > sellers ? 'bullish' : sellers > buyers ? 'bearish' : 'neutral';
  const toneTr = { bullish: 'boğa (alıcı ağırlıklı)', bearish: 'ayı (satıcı ağırlıklı)', neutral: 'nötr' }[tone];
  if (lang === 'tr') {
    return [
      [
        `${ticker} hissesini hangi usta yatırımcılar tutuyor?`,
        names.length
          ? `${company} (${ticker}) hissesini takip edilen ${total} usta yatırımcı 13F bildiriminde raporluyor. Öne çıkan sahipler: ${list(names, lang)}.`
          : `${company} (${ticker}) takip edilen usta yatırımcı setinin en çok tutulan 30 hissesi arasında değil.`,
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
        ? `${total} tracked superinvestors report ${company} (${ticker}) on Form 13F. Notable holders include ${list(names, lang)}.`
        : `${company} (${ticker}) is not among the 30 most-held stocks of the tracked superinvestor set.`,
    ],
    [
      `Is institutional sentiment on ${ticker} bullish or bearish?`,
      consensusRow
        ? `Across the superinvestor set, ${buyers} funds bought and ${sellers} funds sold ${ticker} last quarter, so net sentiment is ${tone}.`
        : `${ticker} is not among the 30 most-held stocks of the superinvestor set, so net buyer/seller counts are not computed for it.`,
    ],
  ];
}
