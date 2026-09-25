import { createContext, useContext, useEffect } from 'react';
import { useI18n } from './i18n.jsx';
import { withLang } from './lib/locale.js';
import { scriptText, domTagSpec, planHead } from './lib/head.js';
export { tagSignature, domTagSpec, planHead } from './lib/head.js';

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

  // spec objects are memoized by the pages, so the identity changes exactly
  // when the underlying data does
  useEffect(() => {
    if (!spec) return;
    applyToDocument({ ...spec, lang });
  }, [spec, lang]);
}

const esc = (s) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

export const DEFAULT_TITLE = { tr: 'Fundocap — Akıllı Parayı ve İçeriden Alımları Takip Edin' };
export const DEFAULT_DESC = {
  tr: "Wall Street'in en büyük fonlarının ve şirket yöneticilerinin gerçek para akışını SEC 13F ve Form 4 verisiyle izleyin.",
};

// Tags shared by the server template and the client mirror.
export function headTags(spec, { siteUrl }) {
  const lang = spec.lang || 'tr';
  const path = spec.path || '/';
  // per-language slugs (guides) override the shared path
  const pathFor = (l) => spec.paths?.[l] || path;
  const title = spec.title || DEFAULT_TITLE[lang];
  const description = spec.description || DEFAULT_DESC[lang];
  const url = `${siteUrl}${withLang(lang, pathFor(lang))}`;
  const image = spec.image ? (spec.image.startsWith('http') ? spec.image : `${siteUrl}${spec.image}`) : `${siteUrl}/api/og`;
  const tags = [
    { tag: 'title', text: title },
    { tag: 'meta', name: 'description', content: description },
    { tag: 'link', rel: 'canonical', href: url },
    { tag: 'meta', property: 'og:title', content: title },
    { tag: 'meta', property: 'og:description', content: description },
    { tag: 'meta', property: 'og:url', content: url },
    { tag: 'meta', property: 'og:type', content: spec.type || 'website' },
    { tag: 'meta', property: 'og:site_name', content: 'Fundocap' },
    { tag: 'meta', property: 'og:locale', content: 'tr_TR' },
    { tag: 'meta', property: 'og:image', content: image },
    { tag: 'meta', property: 'og:image:width', content: '1200' },
    { tag: 'meta', property: 'og:image:height', content: '630' },
    { tag: 'meta', name: 'twitter:card', content: 'summary_large_image' },
    { tag: 'meta', name: 'twitter:title', content: title },
    { tag: 'meta', name: 'twitter:description', content: description },
    { tag: 'meta', name: 'twitter:image', content: image },
  ];
  if (spec.noindex) tags.push({ tag: 'meta', name: 'robots', content: 'noindex' });
  if (spec.dateModified) tags.push({ tag: 'meta', property: 'article:modified_time', content: spec.dateModified });
  for (const block of spec.jsonLd || [])
    tags.push({ tag: 'script', type: 'application/ld+json', text: JSON.stringify(block).split('__SITE__').join(siteUrl) });
  return tags;
}

export function buildHead(spec, opts) {
  return headTags(spec, opts)
    .map((t) => {
      if (t.tag === 'title') return `<title>${esc(t.text)}</title>`;
      // Every tag the page owns carries data-seo — the JSON-LD scripts
      // included. The scripts used to go out without the marker, so the
      // client-side mirror could not recognise them as its own: it removed
      // the marked meta/link tags, appended a fresh set of everything, and
      // every structured-data block ended up in the DOM twice (SSR copy +
      // client copy) on every server-rendered page.
      if (t.tag === 'script') return `<script type="application/ld+json" data-seo>${scriptText(t.text)}</script>`;
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
  const title = spec.title || DEFAULT_TITLE[spec.lang || 'tr'];
  if (document.title !== title) document.title = title;
  const desired = headTags(spec, { siteUrl }).filter((t) => t.tag !== 'title');
  const existing = [...document.querySelectorAll('head [data-seo]')];
  const plan = planHead(existing.map(domTagSpec), desired);
  if (plan.same) return;
  existing.forEach((n) => n.remove());
  const frag = document.createDocumentFragment();
  for (const t of plan.replace) {
    const el = document.createElement(t.tag);
    for (const [k, v] of Object.entries(t)) {
      if (k === 'tag') continue;
      if (k === 'text') el.textContent = t.tag === 'script' ? scriptText(v) : v;
      else el.setAttribute(k, v);
    }
    el.setAttribute('data-seo', '');
    frag.appendChild(el);
  }
  document.head.appendChild(frag);
}
