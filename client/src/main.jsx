import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, hydrate } from '@tanstack/react-query';
import Root, { queryDefaults } from './Root.jsx';
import { splitLang, withLang, DEFAULT_LANG } from './lib/locale.js';
import { preloadPagesFor } from './pages/lazyPages.js';
import { preloadCharts } from './components/Charts/index.js';
import './styles/tokens.css';
import './styles/app.css';

// apply persisted theme before first paint (the <html> element is outside
// React, so this never causes a hydration mismatch)
try {
  document.documentElement.dataset.theme = localStorage.getItem('theme') || 'dark';
} catch {
  /* storage blocked */
}

// The site is Turkish-only and every page lives under /tr. The server
// redirects bare and retired /en URLs; when the app is served without SSR
// (vite dev, static preview) do it here.
const lang = DEFAULT_LANG;
const split = splitLang(window.location.pathname);
if (split.lang !== lang) {
  window.history.replaceState(null, '', withLang(lang, split.path) + window.location.search + window.location.hash);
}
document.documentElement.lang = lang;

const queryClient = new QueryClient(queryDefaults);
const state = window.__STATE__;
if (state) hydrate(queryClient, state);

const tree = (
  <React.StrictMode>
    <Root queryClient={queryClient} lang={lang} router={BrowserRouter} />
  </React.StrictMode>
);
const rootEl = document.getElementById('root');
const { path: pagePath } = splitLang(window.location.pathname);
// the current page's split chunk (and charts, when the server rendered any)
// must be ready so the first client render matches the server HTML
const warm = [preloadPagesFor(pagePath)];
if (/^\/(manager|guru|filer|stock)\//.test(pagePath) || rootEl.querySelector('.recharts-responsive-container')) warm.push(preloadCharts());
Promise.all(warm).then(() => {
  if (state && rootEl.hasChildNodes()) ReactDOM.hydrateRoot(rootEl, tree);
  else ReactDOM.createRoot(rootEl).render(tree);
});
