import { renderToString } from 'react-dom/server';
import { StaticRouter } from 'react-router-dom/server';
import { QueryClient, dehydrate } from '@tanstack/react-query';
import Root, { queryDefaults } from './Root.jsx';
import { buildHead } from './seo.jsx';
import { withLang } from './lib/locale.js';

// Server entry, called by api/ssr.js.
//   render({ lang, url, seeds, siteUrl })
//     lang    'en' | 'tr'
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
