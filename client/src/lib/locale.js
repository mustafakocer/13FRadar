// Path-based locales: every public URL lives under /en or /tr.
//   /en/manager/0001067983   →  { lang: 'en', path: '/manager/0001067983' }
//   /manager/0001067983      →  { lang: null, path: '/manager/0001067983' }
// The server redirects unprefixed URLs; the client falls back to the stored
// or browser preference when it is served without SSR (vite dev).
export const LANGS = ['en', 'tr'];
export const DEFAULT_LANG = 'en';

export function splitLang(pathname) {
  const m = /^\/(en|tr)(?=\/|$)(.*)$/.exec(pathname || '/');
  if (!m) return { lang: null, path: pathname || '/' };
  return { lang: m[1], path: m[2] || '/' };
}

export const withLang = (lang, path) => `/${lang}${path === '/' ? '' : path}`;

export const isLang = (v) => LANGS.includes(v);

export function preferredLang({ cookie, country, acceptLanguage } = {}) {
  if (isLang(cookie)) return cookie;
  if (country) return country === 'TR' ? 'tr' : 'en';
  if (acceptLanguage && /^\s*tr\b|,\s*tr\b/i.test(acceptLanguage)) return 'tr';
  return DEFAULT_LANG;
}
