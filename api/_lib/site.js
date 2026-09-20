// Canonical site origin. Every canonical, hreflang, sitemap, OG image and
// JSON-LD URL is derived from it, so a wrong origin poisons all of them at
// once — which is what happened when the sitemap index went out under the
// project's *.vercel.app hostname while the canonicals said fundocap.co.
//
// Resolution:
//   1. SITE_URL, when it is a real origin — the build-time override.
//   2. In production a SITE_URL that points at a *.vercel.app host is the
//      deployment's own hostname pasted into the variable, never a canonical;
//      it is ignored (with a warning) and the canonical domain is used.
//   3. Production without SITE_URL: the canonical domain.
//   4. Preview: VERCEL_URL. Local: the request's host.
export const CANONICAL_SITE = 'https://www.fundocap.co';

const isVercelHost = (origin) => {
  try {
    return /\.vercel\.app$/i.test(new URL(origin).hostname);
  } catch {
    return false;
  }
};

let warned = false;

export function siteUrl(req) {
  const env = (process.env.SITE_URL || '').replace(/\/$/, '');
  const production = process.env.VERCEL_ENV === 'production';
  if (env && !(production && isVercelHost(env))) return env;
  if (production) {
    if (env && !warned) {
      warned = true;
      console.warn(`SITE_URL=${env} is a Vercel deployment host, not a canonical origin — using ${CANONICAL_SITE}`);
    }
    return CANONICAL_SITE;
  }
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  const host = req?.headers?.host || 'localhost:3001';
  const proto = req?.headers?.['x-forwarded-proto'] || (host.startsWith('localhost') ? 'http' : 'https');
  return `${proto}://${host}`;
}
