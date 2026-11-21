import { renderToString } from 'react-dom/server';
import { StaticRouter } from 'react-router-dom/server';
import { QueryClient, dehydrate } from '@tanstack/react-query';
import Root, { queryDefaults } from './Root.jsx';
import { buildHead } from './seo.jsx';
import { withLang } from './lib/locale.js';
import { setFormatLang } from './lib/format.js';
import { preloadAllPages } from './pages/lazyPages.js';
import { preloadCharts } from './components/Charts/index.js';
import { recordAccess } from './lib/accessedSeed.js';

// Split modules must be in memory before renderToString (it cannot wait).
let warm = null;
export function preload() {
  if (!warm) warm = Promise.all([preloadAllPages(), preloadCharts()]);
  return warm;
}

// Server entry, called by api/ssr.js.
//   render({ lang, url, seeds, siteUrl })
//     lang    'en' | 'tr'
//     url     path WITHOUT the language prefix, query string included
//     seeds   [[queryKey, data], …] — pre-fetched data keyed like the pages' useQuery calls.
//             [key, data, { accessed: true }] marks a lookup table (symbol →
//             value) far larger than any one page reads: the render sees all
//             of it, the HTML carries only the entries the render looked up
//             (lib/accessedSeed.js)
//     notFound  the loader found no such entity: render the not-found page at this URL
// Returns { html, head, state } for the template.
export function render({ lang, url, seeds = [], siteUrl, notFound = false }) {
  const queryClient = new QueryClient(queryDefaults);
  const recorded = [];
  for (const [key, data, opts] of seeds) {
    if (opts?.accessed && data && typeof data === 'object') {
      const rec = recordAccess(data);
      recorded.push([key, rec]);
      queryClient.setQueryData(key, rec.proxy);
    } else queryClient.setQueryData(key, data);
  }
  const seo = { spec: null };
  // Number formatting follows the page language (lib/format.js). The render is
  // synchronous, so no other request can run between set and reset.
  let html;
  let head;
  setFormatLang(lang);
  try {
    html = renderToString(
      <Root queryClient={queryClient} lang={lang} seo={seo} notFound={notFound} router={StaticRouter} routerProps={{ location: withLang(lang, url) }} />
    );
    head = buildHead({ ...(seo.spec || {}), lang }, { siteUrl });
  } finally {
    setFormatLang('en');
  }
  // the page has been rendered: what it read is what the browser needs to
  // render the same markup, and nothing else is sent
  for (const [key, rec] of recorded) {
    const picked = rec.picked();
    queryClient.removeQueries({ queryKey: key, exact: true });
    queryClient.setQueryData(key, picked);
  }
  const state = dehydrate(queryClient);
  queryClient.clear();
  return { html, head, state, spec: seo.spec };
}
