// Structural validator for the JSON-LD we emit. Not a full schema.org
// validator — it enforces the fields Google's rich-result and dataset
// docs treat as required, plus hygiene rules (no empty strings, no
// placeholders, absolute URLs). Used by tests and scripts/check-jsonld.mjs,
// which fails the build on any violation.
const isUrl = (v) => typeof v === 'string' && /^https?:\/\/[^\s"]+$/.test(v);
const nonEmpty = (v) => typeof v === 'string' && v.trim().length > 0;
const isDate = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}(T[\d:.]+Z?)?$/.test(v);

const RULES = {
  Organization: (b, e) => {
    nonEmpty(b.name) || e.push('Organization.name');
    b.url && !isUrl(b.url) && e.push('Organization.url not absolute');
    b.sameAs && (Array.isArray(b.sameAs) ? b.sameAs : [b.sameAs]).some((u) => !isUrl(u)) && e.push('Organization.sameAs not absolute');
  },
  Person: (b, e) => {
    nonEmpty(b.name) || e.push('Person.name');
    b.url && !isUrl(b.url) && e.push('Person.url not absolute');
  },
  Corporation: (b, e) => {
    nonEmpty(b.name) || e.push('Corporation.name');
    nonEmpty(b.tickerSymbol) || e.push('Corporation.tickerSymbol');
    isUrl(b.url) || e.push('Corporation.url');
  },
  WebSite: (b, e) => {
    isUrl(b.url) || e.push('WebSite.url');
    const t = b.potentialAction?.target?.urlTemplate;
    if (b.potentialAction) {
      (t && t.includes('{search_term_string}')) || e.push('WebSite.potentialAction.target.urlTemplate');
      b.potentialAction['query-input'] === 'required name=search_term_string' || e.push('WebSite.potentialAction.query-input');
    }
  },
  Dataset: (b, e) => {
    nonEmpty(b.name) || e.push('Dataset.name');
    (nonEmpty(b.description) && b.description.length >= 50) || e.push('Dataset.description (≥50 chars)');
    isUrl(b.url) || e.push('Dataset.url');
    isUrl(b.license) || e.push('Dataset.license');
    b.temporalCoverage && !/^\d{4}-\d{2}-\d{2}(\/\d{4}-\d{2}-\d{2})?$/.test(b.temporalCoverage) && e.push('Dataset.temporalCoverage');
    for (const d of b.distribution || []) {
      d['@type'] === 'DataDownload' || e.push('Dataset.distribution @type');
      isUrl(d.contentUrl) || e.push('Dataset.distribution.contentUrl');
      nonEmpty(d.encodingFormat) || e.push('Dataset.distribution.encodingFormat');
    }
    b.isBasedOn && !isUrl(b.isBasedOn) && e.push('Dataset.isBasedOn');
  },
  Article: (b, e) => {
    nonEmpty(b.headline) || e.push('Article.headline');
    b.headline?.length > 110 && e.push('Article.headline > 110 chars');
    isDate(b.datePublished) || e.push('Article.datePublished');
    isDate(b.dateModified) || e.push('Article.dateModified');
    (b.author?.name && b.publisher?.name) || e.push('Article.author/publisher');
    isUrl(b.url) || e.push('Article.url');
  },
  ItemList: (b, e) => {
    (Array.isArray(b.itemListElement) && b.itemListElement.length > 0) || e.push('ItemList.itemListElement');
    (b.itemListElement || []).forEach((it, i) => {
      it['@type'] === 'ListItem' || e.push(`ItemList[${i}] @type`);
      it.position === i + 1 || e.push(`ItemList[${i}] position`);
      isUrl(it.url) || e.push(`ItemList[${i}] url`);
      nonEmpty(it.name) || e.push(`ItemList[${i}] name`);
    });
  },
  FAQPage: (b, e) => {
    (Array.isArray(b.mainEntity) && b.mainEntity.length > 0) || e.push('FAQPage.mainEntity');
    (b.mainEntity || []).forEach((q, i) => {
      q['@type'] === 'Question' || e.push(`FAQ[${i}] @type`);
      nonEmpty(q.name) || e.push(`FAQ[${i}] name`);
      q.acceptedAnswer?.['@type'] === 'Answer' || e.push(`FAQ[${i}] acceptedAnswer @type`);
      nonEmpty(q.acceptedAnswer?.text) || e.push(`FAQ[${i}] answer text`);
    });
  },
  BreadcrumbList: (b, e) => {
    (Array.isArray(b.itemListElement) && b.itemListElement.length > 0) || e.push('BreadcrumbList.itemListElement');
    (b.itemListElement || []).forEach((it, i) => {
      it.position === i + 1 || e.push(`Breadcrumb[${i}] position`);
      nonEmpty(it.name) || e.push(`Breadcrumb[${i}] name`);
      const id = typeof it.item === 'string' ? it.item : it.item?.['@id'];
      isUrl(id) || e.push(`Breadcrumb[${i}] item`);
    });
  },
};

function walk(v, e, p = '') {
  if (v == null) {
    e.push(`${p}: null/undefined`);
    return;
  }
  if (typeof v === 'string') {
    if (v.trim() === '') e.push(`${p}: empty string`);
    if (/__SITE__|undefined|\bNaN\b|\{\w+\}/.test(v.replace('{search_term_string}', ''))) e.push(`${p}: placeholder in "${v.slice(0, 40)}"`);
    return;
  }
  if (Array.isArray(v)) return v.forEach((x, i) => walk(x, e, `${p}[${i}]`));
  if (typeof v === 'object') for (const [k, x] of Object.entries(v)) walk(x, e, p ? `${p}.${k}` : k);
}

export function validateJsonLd(block) {
  const errors = [];
  if (!block || typeof block !== 'object') return ['not an object'];
  if (block['@context'] !== 'https://schema.org') errors.push('@context');
  const type = block['@type'];
  if (!RULES[type]) errors.push(`unsupported @type ${type}`);
  else RULES[type](block, errors);
  walk(block, errors, type || 'block');
  return errors;
}

// Validate every ld+json block embedded in an HTML document.
export function validateHtmlJsonLd(html) {
  const blocks = [...html.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/gs)].map((m) => JSON.parse(m[1].replace(/\\u003c/g, '<')));
  const problems = [];
  for (const b of blocks) for (const err of validateJsonLd(b)) problems.push(`${b['@type']}: ${err}`);
  return { blocks, problems };
}
