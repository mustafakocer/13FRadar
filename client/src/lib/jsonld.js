// JSON-LD block builders. URLs use the __SITE__ placeholder, replaced with
// the real origin by seo.jsx (server and client) so the same blocks serve
// both. Every block is checked by validateJsonLd() in tests and at build.
const CTX = 'https://schema.org';
const LICENSE = 'https://creativecommons.org/licenses/by/4.0/';

// Social profiles come from the build environment (VITE_SOCIAL_LINKS, comma
// separated) so nothing is hardcoded; empty when unset.
export function socialLinks() {
  let raw = '';
  try {
    raw = (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_SOCIAL_LINKS) || '';
  } catch {
    raw = '';
  }
  if (!raw && typeof process !== 'undefined') raw = process.env?.VITE_SOCIAL_LINKS || process.env?.SOCIAL_LINKS || '';
  return String(raw)
    .split(',')
    .map((s) => s.trim())
    .filter((s) => /^https?:\/\//.test(s));
}

export const publisher = () => ({ '@type': 'Organization', name: 'Fundocap', url: '__SITE__/tr', logo: { '@type': 'ImageObject', url: '__SITE__/api/og' } });

export function organization(lang) {
  const sameAs = socialLinks();
  return {
    '@context': CTX,
    '@type': 'Organization',
    name: 'Fundocap',
    url: `__SITE__/${lang}`,
    logo: '__SITE__/api/og',
    ...(sameAs.length ? { sameAs } : {}),
  };
}

export function website(lang) {
  return {
    '@context': CTX,
    '@type': 'WebSite',
    name: 'Fundocap',
    url: `__SITE__/${lang}`,
    inLanguage: lang,
    potentialAction: {
      '@type': 'SearchAction',
      target: { '@type': 'EntryPoint', urlTemplate: `__SITE__/${lang}/?q={search_term_string}` },
      'query-input': 'required name=search_term_string',
    },
  };
}

const edgarUrl = (cik) => `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${String(cik).padStart(10, '0')}&type=13F-HR`;

// Guru entity: a Person (with worksFor) when the curated name carries one in
// parentheses — "Berkshire Hathaway (Warren Buffett)" — otherwise the firm.
export function guruEntity({ manager, lang, path, description }) {
  const display = manager.displayName || manager.name;
  const m = /^(.*?)\s*\(([^()]+)\)\s*$/.exec(display);
  const url = `__SITE__/${lang}${path}`;
  if (m && !/^(?:llc|inc|lp|l\.p\.|ltd)/i.test(m[2])) {
    return {
      '@context': CTX,
      '@type': 'Person',
      name: m[2].trim(),
      url,
      description,
      worksFor: { '@type': 'Organization', name: m[1].trim(), identifier: `CIK ${manager.cik}`, sameAs: edgarUrl(manager.cik) },
    };
  }
  return {
    '@context': CTX,
    '@type': 'Organization',
    name: manager.name,
    url,
    description,
    identifier: `CIK ${manager.cik}`,
    sameAs: edgarUrl(manager.cik),
  };
}

export function guruDataset({ manager, lang, path, description, filings = [], history = null }) {
  const dates = (history?.quarters || filings).map((f) => f.reportDate).filter(Boolean).sort();
  const latest = filings[0] || null;
  return {
    '@context': CTX,
    '@type': 'Dataset',
    name: `${manager.displayName || manager.name} — 13F holdings`,
    description,
    url: `__SITE__/${lang}${path}`,
    license: LICENSE,
    creator: publisher(),
    isBasedOn: edgarUrl(manager.cik),
    ...(dates.length ? { temporalCoverage: `${dates[0]}/${dates[dates.length - 1]}` } : {}),
    ...(latest?.filingDate ? { dateModified: latest.filingDate } : {}),
    keywords: ['13F', 'SEC EDGAR', 'institutional holdings', manager.displayName || manager.name],
    distribution: [
      {
        '@type': 'DataDownload',
        encodingFormat: 'text/csv',
        contentUrl: `__SITE__/api/export/holdings/${manager.cik}`,
        name: 'Holdings CSV (Pro)',
      },
    ],
  };
}

export function corporation({ company, ticker, lang, path, description }) {
  return {
    '@context': CTX,
    '@type': 'Corporation',
    name: company,
    tickerSymbol: ticker,
    url: `__SITE__/${lang}${path}`,
    description,
  };
}

export function stockDataset({ company, ticker, lang, path, description, reportDate }) {
  return {
    '@context': CTX,
    '@type': 'Dataset',
    name: `${company} (${ticker}) — institutional 13F ownership`,
    description,
    url: `__SITE__/${lang}${path}`,
    license: LICENSE,
    creator: publisher(),
    isBasedOn: 'https://www.sec.gov/cgi-bin/srch-edgar',
    ...(reportDate ? { temporalCoverage: reportDate, dateModified: reportDate } : {}),
    keywords: ['13F', ticker, company, 'institutional ownership'],
  };
}

// A dataset the page is the front of: the insider feed, the comparison
// tables. `isBasedOn` is the primary source (EDGAR).
export function dataset({ name, description, lang, path, isBasedOn = 'https://www.sec.gov/cgi-bin/srch-edgar', dateModified = null, temporalCoverage = null, keywords = [] }) {
  return {
    '@context': CTX,
    '@type': 'Dataset',
    name,
    description,
    url: `__SITE__/${lang}${path}`,
    license: LICENSE,
    creator: publisher(),
    isBasedOn,
    ...(temporalCoverage ? { temporalCoverage } : {}),
    ...(dateModified ? { dateModified: String(dateModified).slice(0, 10) } : {}),
    ...(keywords.length ? { keywords } : {}),
  };
}

export function webPage({ name, description, lang, path, dateModified = null }) {
  return {
    '@context': CTX,
    '@type': 'WebPage',
    name,
    ...(description ? { description } : {}),
    url: `__SITE__/${lang}${path}`,
    inLanguage: lang,
    isPartOf: { '@type': 'WebSite', name: 'Fundocap', url: `__SITE__/${lang}` },
    publisher: publisher(),
    ...(dateModified ? { dateModified: String(dateModified).slice(0, 10) } : {}),
  };
}

export function article({ headline, description, lang, path, datePublished, dateModified, image }) {
  return {
    '@context': CTX,
    '@type': 'Article',
    headline,
    description,
    inLanguage: lang,
    url: `__SITE__/${lang}${path}`,
    mainEntityOfPage: `__SITE__/${lang}${path}`,
    datePublished: datePublished || dateModified,
    dateModified: dateModified || datePublished,
    author: publisher(),
    publisher: publisher(),
    ...(image ? { image: image.startsWith('http') ? image : `__SITE__${image}` } : {}),
  };
}

export function itemList({ name, lang, items }) {
  return {
    '@context': CTX,
    '@type': 'ItemList',
    name,
    numberOfItems: items.length,
    itemListElement: items.map((it, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: it.name,
      url: `__SITE__/${lang}${it.path}`,
    })),
  };
}
