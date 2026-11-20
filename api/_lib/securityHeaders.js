// The security headers every response carries.
//
// They are declared twice on purpose. vercel.json `headers` covers what the
// CDN serves by itself (the static build output, redirects); the two
// functions (api/index.js, api/ssr.js) set the same list in code, so the
// headers do not depend on how the platform treats a rewritten function
// response, and they are there under the dev server too.
// tests/security-headers.test.mjs keeps the two lists identical.
//
// The enforced Content-Security-Policy is the part that cannot break a page:
// no framing (clickjacking), no <base> hijack, no plugins. The full
// script/style/connect policy ships as Report-Only first: the browser logs
// what it would have blocked and blocks nothing, so the list can be checked
// against real traffic before it is enforced.
//
// 'unsafe-inline' in the report-only policy is what the pages need today:
// the SSR state and JSON-LD are inline scripts (api/ssr.js, client/src/seo.jsx),
// React writes style attributes, and index.html swaps the font stylesheet in
// with an inline onload.
const CSP_REPORT_ONLY = [
  "default-src 'self'",
  // GA4 (gtag.js), Microsoft Clarity, the Meta pixel
  "script-src 'self' 'unsafe-inline' https://www.googletagmanager.com https://*.clarity.ms https://connect.facebook.net",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' data: https://fonts.gstatic.com",
  // logos come from a CDN and from many company domains; pixels are images
  "img-src 'self' data: blob: https:",
  // Supabase (auth + user tables) and the three analytics collectors
  "connect-src 'self' https://*.supabase.co https://*.google-analytics.com https://*.analytics.google.com https://*.googletagmanager.com https://*.clarity.ms https://c.bing.com https://www.facebook.com https://connect.facebook.net",
  // checkout and the billing portal are top-level navigations, not forms or frames
  "form-action 'self'",
  "frame-src 'none'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "object-src 'none'",
].join('; ');

export const SECURITY_HEADERS = [
  ['X-Frame-Options', 'DENY'],
  ['X-Content-Type-Options', 'nosniff'],
  ['Referrer-Policy', 'strict-origin-when-cross-origin'],
  ['Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()'],
  ['Strict-Transport-Security', 'max-age=63072000; includeSubDomains'],
  ['Content-Security-Policy', "frame-ancestors 'none'; base-uri 'self'; object-src 'none'"],
  ['Content-Security-Policy-Report-Only', CSP_REPORT_ONLY],
];

export function applySecurityHeaders(res) {
  for (const [key, value] of SECURITY_HEADERS) res.setHeader(key, value);
}
