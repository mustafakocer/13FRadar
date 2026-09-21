// Build-time guard: production must know its public origin. Everything SEO
// (canonical, hreflang, sitemaps, OG image URLs) is derived from SITE_URL,
// with https://www.fundocap.co as the production default (api/_lib/site.js).
import { CANONICAL_SITE } from '../api/_lib/site.js';

const site = process.env.SITE_URL || '';
const production = process.env.VERCEL_ENV === 'production';

if (site && !/^https?:\/\/[^/]+$/.test(site)) {
  console.error(`\n✖ SITE_URL must be an origin without a path, got "${site}"\n`);
  process.exit(1);
}
if (production && /\.vercel\.app$/i.test(new URL(site || CANONICAL_SITE).hostname)) {
  // the deployment hostname is not a canonical origin: every sitemap and
  // canonical would point at it, which is the bug this check exists for
  console.error(`\n✖ SITE_URL="${site}" is a Vercel deployment host. Set it to the public domain (${CANONICAL_SITE}) in Vercel → Project → Settings → Environment Variables, or unset it to use the default.\n`);
  process.exit(1);
}
if (production && !site) {
  console.log(`SITE_URL is not set — production uses the canonical default ${CANONICAL_SITE}`);
}
console.log(`env ok (SITE_URL=${site || (production ? CANONICAL_SITE : '(unset, non-production)')})`);
