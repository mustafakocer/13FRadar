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
// Supabase: the server (api/_lib/auth.js) and the client bundle
// (client/src/lib/supabase.js) read their project URL and anon key from the
// environment only. A production build without them ships a site whose Pro
// tier is locked for everyone, so it stops here instead.
const SUPABASE_VARS = ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY'];
const missing = SUPABASE_VARS.filter((k) => !process.env[k]);
if (missing.length && production) {
  console.error(`\n✖ Missing ${missing.join(', ')} — set them in Vercel → Project → Settings → Environment Variables (Production) and redeploy. Server: SUPABASE_URL + SUPABASE_ANON_KEY; client bundle: VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY (same values).\n`);
  process.exit(1);
}
if (missing.length) console.log(`supabase: ${missing.join(', ')} not set — auth off, Pro locked (fine outside production)`);
console.log(`env ok (SITE_URL=${site || (production ? CANONICAL_SITE : '(unset, non-production)')})`);
