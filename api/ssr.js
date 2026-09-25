import fs from 'node:fs';
import path from 'node:path';
import { render, preload } from '../client/dist/server/entry-server.js';
import { matchRoute, CACHE } from './_lib/ssr/routes.js';
import { siteUrl } from './_lib/site.js';
import { splitLang, withLang, DEFAULT_LANG } from '../client/src/lib/locale.js';
import { contentByPath } from '../client/src/content/registry.js';

// Server-side rendering for every public page. vercel.json rewrites all
// non-API, non-static paths here (`__path` carries the original path).
//
//   /manager/123        → 301 /tr/manager/123
//   /en/manager/123     → 301 /tr/manager/123  (English was retired; content
//                         slugs such as /en/guides/… map to their Turkish twin)
//   /tr/manager/123     → full HTML: <head> metadata + rendered app + dehydrated
//                         query state, cached at the CDN per page kind
let templateCache = null;
function template() {
  if (!templateCache) {
    templateCache = fs.readFileSync(path.join(process.cwd(), 'client', 'dist', 'index.html'), 'utf8');
  }
  return templateCache;
}

const safeJson = (obj) =>
  JSON.stringify(obj).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');

export default async function handler(req, res) {
  const rawUrl = String(req.url || '/');
  const qIndex = rawUrl.indexOf('?');
  const search = qIndex >= 0 ? rawUrl.slice(qIndex) : '';
  const qs = new URLSearchParams(search);
  let pathname = qs.get('__path');
  pathname = pathname != null ? `/${String(pathname).replace(/^\/+/, '')}` : rawUrl.split('?')[0];
  qs.delete('__path');
  const cleanSearch = qs.toString() ? `?${qs.toString()}` : '';

  const { lang, path: bare } = splitLang(pathname);
  if (lang !== DEFAULT_LANG) {
    const target = contentByPath(bare)?.entry.paths[DEFAULT_LANG] || bare;
    res.setHeader('Cache-Control', CACHE.day);
    res.statusCode = 301;
    res.setHeader('Location', withLang(DEFAULT_LANG, target) + cleanSearch);
    return res.end();
  }

  const origin = siteUrl(req);
  const matched = matchRoute(bare, cleanSearch, lang);
  let seeds = [];
  let status = 200;
  let cache = CACHE.none;
  if (matched) {
    try {
      // the visitor's country rides along for loaders whose answer depends on it (pricing)
      const out = await matched.route.load({ ...matched.params, _country: String(req.headers['x-vercel-ip-country'] || '').toUpperCase() });
      if (Array.isArray(out)) seeds = out;
      else {
        if (out.redirect) {
          res.setHeader('Cache-Control', CACHE.day);
          res.statusCode = out.status || 301;
          res.setHeader('Location', withLang(lang, out.redirect) + cleanSearch);
          return res.end();
        }
        seeds = out.seeds || [];
        if (out.status) status = out.status;
      }
    } catch (e) {
      console.error('ssr loader failed', bare, e?.message || e);
    }
    const policy = typeof matched.route.cache === 'function' ? matched.route.cache() : matched.route.cache;
    cache = CACHE[policy] || CACHE.none;
  } else {
    status = 404;
  }

  let rendered;
  try {
    await preload();
    rendered = render({ lang, url: bare + cleanSearch, seeds, siteUrl: origin });
  } catch (e) {
    // never leave a crawler with a 500: fall back to the client-rendered shell
    console.error('ssr render failed', bare, e?.stack || e);
    rendered = { html: '', head: '', state: null };
    cache = CACHE.none;
  }

  // replacer functions, not strings: rendered text such as "5 $'ın altında"
  // would otherwise be read as a `$'` substitution pattern and splice the
  // rest of the template into the page
  const html = template()
    .replace('%LANG%', () => lang)
    .replace('<!--app-head-->', () => rendered.head)
    .replace('<!--app-html-->', () => rendered.html)
    .replace(
      '<script type="module"',
      () => `<script>window.__STATE__=${safeJson(rendered.state)}</script>\n    <script type="module"`
    );

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', status === 200 ? cache : 'no-store');
  res.setHeader('Vary', 'Accept-Encoding');
  res.statusCode = status;
  res.end(html);
}
