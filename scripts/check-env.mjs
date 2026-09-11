// Build-time guard: production must know its public origin. Everything SEO
// (canonical, hreflang, sitemaps, OG image URLs) is derived from SITE_URL.
if (process.env.VERCEL_ENV === 'production' && !process.env.SITE_URL) {
  console.error('\n✖ SITE_URL is not set. Add it in Vercel → Project → Settings → Environment Variables (e.g. https://13fradar.com) and redeploy.\n');
  process.exit(1);
}
if (process.env.SITE_URL && !/^https?:\/\/[^/]+$/.test(process.env.SITE_URL)) {
  console.error(`\n✖ SITE_URL must be an origin without a path, got "${process.env.SITE_URL}"\n`);
  process.exit(1);
}
console.log(`env ok (SITE_URL=${process.env.SITE_URL || '(unset, non-production)'})`);
