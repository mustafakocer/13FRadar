import { createContext, useContext, useEffect } from 'react';
import { useI18n } from './i18n.jsx';
import { withLang } from './lib/locale.js';

// Per-page <head> data. On the server the page's spec is collected during
// renderToString and turned into tags by buildHead(); on the client the same
// spec is mirrored into the live document after every navigation.
//
//   useSeo({
//     title, description,
//     path,            // canonical path WITHOUT the language prefix
//     image,           // absolute or site-relative og:image
//     type,            // og:type (website | article)
//     jsonLd: [{...}], // structured data blocks
//     noindex: false,
//   })
const SeoCtx = createContext(null);

export function SeoProvider({ collector = null, children }) {
  return <SeoCtx.Provider value={collector}>{children}</SeoCtx.Provider>;
}

const isServer = typeof document === 'undefined';

export function useSeo(spec) {
  const collector = useContext(SeoCtx);
  const { lang } = useI18n();
  if (isServer && collector && spec) collector.spec = { ...spec, lang };

  useEffect(() => {
    if (!spec) return;
    applyToDocument({ ...spec, lang });
  }, [spec?.title, spec?.description, spec?.path, spec?.image, lang]); // eslint-disable-line react-hooks/exhaustive-deps
}

const esc = (s) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

export const DEFAULT_TITLE = { en: '13F Radar — Track the Smart Money & Insiders', tr: '13F Radar — Akıllı Parayı ve İçeriden Alımları Takip Edin' };
export const DEFAULT_DESC = {
  en: "Follow the real money flows of Wall Street's top funds and corporate insiders with SEC 13F and Form 4 data.",
  tr: "Wall Street'in en büyük fonlarının ve şirket yöneticilerinin gerçek para akışını SEC 13F ve Form 4 verisiyle izleyin.",
};

// Tags shared by the server template and the client mirror.
export function headTags(spec, { siteUrl }) {
  const lang = spec.lang || 'en';
  const path = spec.path || '/';
  const title = spec.title || DEFAULT_TITLE[lang];
  const description = spec.description || DEFAULT_DESC[lang];
  const url = `${siteUrl}${withLang(lang, path)}`;
  const image = spec.image ? (spec.image.startsWith('http') ? spec.image : `${siteUrl}${spec.image}`) : `${siteUrl}/api/og`;
  const tags = [
    { tag: 'title', text: title },
    { tag: 'meta', name: 'description', content: description },
    { tag: 'link', rel: 'canonical', href: url },
    { tag: 'link', rel: 'alternate', hreflang: 'en', href: `${siteUrl}${withLang('en', path)}` },
    { tag: 'link', rel: 'alternate', hreflang: 'tr', href: `${siteUrl}${withLang('tr', path)}` },
    { tag: 'link', rel: 'alternate', hreflang: 'x-default', href: `${siteUrl}${withLang('en', path)}` },
    { tag: 'meta', property: 'og:title', content: title },
    { tag: 'meta', property: 'og:description', content: description },
    { tag: 'meta', property: 'og:url', content: url },
    { tag: 'meta', property: 'og:type', content: spec.type || 'website' },
    { tag: 'meta', property: 'og:site_name', content: '13F Radar' },
    { tag: 'meta', property: 'og:locale', content: lang === 'tr' ? 'tr_TR' : 'en_US' },
    { tag: 'meta', property: 'og:locale:alternate', content: lang === 'tr' ? 'en_US' : 'tr_TR' },
    { tag: 'meta', property: 'og:image', content: image },
    { tag: 'meta', property: 'og:image:width', content: '1200' },
    { tag: 'meta', property: 'og:image:height', content: '630' },
    { tag: 'meta', name: 'twitter:card', content: 'summary_large_image' },
    { tag: 'meta', name: 'twitter:title', content: title },
    { tag: 'meta', name: 'twitter:description', content: description },
    { tag: 'meta', name: 'twitter:image', content: image },
  ];
  if (spec.noindex) tags.push({ tag: 'meta', name: 'robots', content: 'noindex' });
  for (const block of spec.jsonLd || []) tags.push({ tag: 'script', type: 'application/ld+json', text: JSON.stringify(block) });
  return tags;
}

export function buildHead(spec, opts) {
  return headTags(spec, opts)
    .map((t) => {
      if (t.tag === 'title') return `<title>${esc(t.text)}</title>`;
      if (t.tag === 'script') return `<script type="application/ld+json">${t.text.replace(/</g, '\\u003c')}</script>`;
      const attrs = Object.entries(t)
        .filter(([k]) => k !== 'tag')
        .map(([k, v]) => `${k}="${esc(v)}"`)
        .join(' ');
      return `<${t.tag} ${attrs} data-seo>`;
    })
    .join('\n    ');
}

function applyToDocument(spec) {
  const siteUrl = window.location.origin;
  document.querySelectorAll('[data-seo]').forEach((n) => n.remove());
  document.title = spec.title || DEFAULT_TITLE[spec.lang || 'en'];
  const frag = document.createDocumentFragment();
  for (const t of headTags(spec, { siteUrl })) {
    if (t.tag === 'title') continue;
    const el = document.createElement(t.tag);
    for (const [k, v] of Object.entries(t)) {
      if (k === 'tag') continue;
      if (k === 'text') el.textContent = v;
      else el.setAttribute(k, v);
    }
    el.setAttribute('data-seo', '');
    frag.appendChild(el);
  }
  document.head.appendChild(frag);
}
