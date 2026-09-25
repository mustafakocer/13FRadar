import { renderToString } from 'react-dom/server';
import { StaticRouter } from 'react-router-dom/server';
import { QueryClient, dehydrate } from '@tanstack/react-query';
import Root, { queryDefaults } from './Root.jsx';
import { buildHead } from './seo.jsx';
import { withLang } from './lib/locale.js';
import { preloadAllPages } from './pages/lazyPages.js';
import { preloadCharts } from './components/Charts/index.js';

// Split modules must be in memory before renderToString (it cannot wait).
let warm = null;
export function preload() {
  if (!warm) warm = Promise.all([preloadAllPages(), preloadCharts()]);
  return warm;
}

// Server entry, called by api/ssr.js.
//   render({ lang, url, seeds, siteUrl })
//     lang    'tr' (the only locale)
//     url     path WITHOUT the language prefix, query string included
//     seeds   [[queryKey, data], …] — pre-fetched data keyed like the pages' useQuery calls
// Returns { html, head, state } for the template.
export function render({ lang, url, seeds = [], siteUrl }) {
  const queryClient = new QueryClient(queryDefaults);
  for (const [key, data] of seeds) queryClient.setQueryData(key, data);
  const seo = { spec: null };
  const html = renderToString(
    <Root queryClient={queryClient} lang={lang} seo={seo} router={StaticRouter} routerProps={{ location: withLang(lang, url) }} />
  );
  const head = buildHead({ ...(seo.spec || {}), lang }, { siteUrl });
  const state = dehydrate(queryClient);
  queryClient.clear();
  return { html, head, state, spec: seo.spec };
}
