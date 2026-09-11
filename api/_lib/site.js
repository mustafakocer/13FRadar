// Canonical site origin. SITE_URL must be set in production — a wrong
// origin poisons every canonical, hreflang and sitemap URL, so there is no
// silent fallback there. Preview deployments and local dev derive it.
export function siteUrl(req) {
  const env = (process.env.SITE_URL || '').replace(/\/$/, '');
  if (env) return env;
  if (process.env.VERCEL_ENV === 'production') {
    throw new Error('SITE_URL is not set: required in production for canonical URLs, hreflang and sitemaps');
  }
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  const host = req?.headers?.host || 'localhost:3001';
  const proto = req?.headers?.['x-forwarded-proto'] || (host.startsWith('localhost') ? 'http' : 'https');
  return `${proto}://${host}`;
}
