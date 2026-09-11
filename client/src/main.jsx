import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, hydrate } from '@tanstack/react-query';
import Root, { queryDefaults } from './Root.jsx';
import { splitLang, withLang, isLang } from './lib/locale.js';
import './styles/tokens.css';
import './styles/app.css';

// apply persisted theme before first paint (the <html> element is outside
// React, so this never causes a hydration mismatch)
try {
  document.documentElement.dataset.theme = localStorage.getItem('theme') || 'light';
} catch {
  /* storage blocked */
}

// Language comes from the URL prefix. The server redirects bare URLs; when
// the app is served without SSR (vite dev, static preview) do it here.
let { lang } = splitLang(window.location.pathname);
if (!lang) {
  let pref = null;
  try {
    pref = localStorage.getItem('lang');
  } catch {
    /* ignore */
  }
  if (!isLang(pref)) pref = (navigator.language || '').toLowerCase().startsWith('tr') ? 'tr' : 'en';
  lang = pref;
  const { path } = splitLang(window.location.pathname);
  window.history.replaceState(null, '', withLang(lang, path) + window.location.search + window.location.hash);
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
if (state && rootEl.hasChildNodes()) ReactDOM.hydrateRoot(rootEl, tree);
else ReactDOM.createRoot(rootEl).render(tree);
