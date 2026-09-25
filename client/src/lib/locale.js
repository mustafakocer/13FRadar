// Path-based locale: the site is Turkish-only and every public URL lives
// under /tr. The retired /en prefix is still recognised so the server can
// 301 old links (and search-engine index entries) onto their /tr twin.
//   /tr/manager/0001067983   →  { lang: 'tr', path: '/manager/0001067983' }
//   /en/manager/0001067983   →  { lang: 'en', path: '/manager/0001067983' }  (legacy)
//   /manager/0001067983      →  { lang: null, path: '/manager/0001067983' }
export const LANGS = ['tr'];
export const DEFAULT_LANG = 'tr';

export function splitLang(pathname) {
  const m = /^\/(en|tr)(?=\/|$)(.*)$/.exec(pathname || '/');
  if (!m) return { lang: null, path: pathname || '/' };
  return { lang: m[1], path: m[2] || '/' };
}

export const withLang = (lang, path) => `/${lang}${path === '/' ? '' : path}`;

export const isLang = (v) => LANGS.includes(v);
