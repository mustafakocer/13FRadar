import { lazyPreloadable } from '../lib/lazy.jsx';

// Pages outside the SEO-critical entity set are code-split. Each entry
// carries the path pattern it serves so the client can preload exactly the
// chunk the current URL needs before hydrating (see main.jsx); the server
// preloads all of them once (see entry-server.jsx).
export const LAZY_PAGES = {
  Insiders: { load: () => import('./Insiders.jsx'), match: /^\/insiders$/ },
  PennyStocks: { load: () => import('./PennyStocks.jsx'), match: /^\/insiders\/penny$/ },
  Screen: { load: () => import('./Screen.jsx'), match: /^\/screen$/ },
  Compare: { load: () => import('./Compare.jsx'), match: /^\/compare$/ },
  Report: { load: () => import('./Report.jsx'), match: /^\/report$/ },
  Watchlist: { load: () => import('./Watchlist.jsx'), match: /^\/watchlist$/ },
  Pricing: { load: () => import('./Pricing.jsx'), match: /^\/pricing$/ },
  Account: { load: () => import('./Account.jsx'), match: /^\/account$/ },
  Filers: { load: () => import('./Filers.jsx'), match: /^\/filers(\/|$)/ },
  ContentPage: { load: () => import('./ContentPage.jsx'), match: /^\/(guides|rehber|compare|karsilastir)\/[a-z0-9-]+$/ },
  ReportPage: { load: () => import('./ReportPage.jsx'), match: /^\/reports(\/|$)/ },
  Calendar: { load: () => import('./Calendar.jsx'), match: /^\/calendar$/ },
  Emerging: { load: () => import('./Emerging.jsx'), match: /^\/emerging-managers$/ },
  GuruTicker: { load: () => import('./GuruTicker.jsx'), match: /^\/guru\/[^/]+\/[^/]+$/ },
};

for (const p of Object.values(LAZY_PAGES)) p.component = lazyPreloadable(p.load);

export const preloadAllPages = () => Promise.all(Object.values(LAZY_PAGES).map((p) => p.component.preload()));
export const preloadPagesFor = (path) =>
  Promise.all(
    Object.values(LAZY_PAGES)
      .filter((p) => p.match.test(path))
      .map((p) => p.component.preload())
  );
