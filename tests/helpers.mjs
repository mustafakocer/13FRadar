import path from 'node:path';
import fs from 'node:fs';

export const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
export const fixtures = path.join(root, 'tests', 'fixtures', 'sec');
process.env.SEC_FIXTURE_DIR = process.env.SEC_FIXTURE_DIR || fixtures;
process.env.SITE_URL = process.env.SITE_URL || 'https://example.test';
process.env.GURU_HISTORY_FILE = process.env.GURU_HISTORY_FILE || path.join(root, 'tests', 'fixtures', 'guru-history.fixture.json');
process.env.GURU_STOCKS_FILE =
  process.env.GURU_STOCKS_FILE || path.join(root, 'tests', 'fixtures', 'guru-stocks.fixture.json');
process.env.FILINGS_FILE =
  process.env.FILINGS_FILE || path.join(root, 'tests', 'fixtures', 'filings.fixture.json');

export function requireBuild() {
  const f = path.join(root, 'client', 'dist', 'server', 'entry-server.js');
  if (!fs.existsSync(f)) throw new Error('SSR bundle missing — run `npm run build` before `npm test`');
  return f;
}

// Render a page through the real SSR handler and return { status, headers, html }.
export async function ssr(url, headers = {}) {
  requireBuild();
  const { default: handler } = await import(path.join(root, 'api', 'ssr.js'));
  return new Promise((resolve) => {
    const res = {
      statusCode: 200,
      headers: {},
      setHeader(k, v) {
        this.headers[k.toLowerCase()] = v;
      },
      end(body) {
        resolve({ status: this.statusCode, headers: this.headers, html: body || '' });
      },
    };
    handler({ url, headers: { host: 'example.test', ...headers }, query: {} }, res);
  });
}

export const jsonLd = (html) =>
  [...html.matchAll(/<script type="application\/ld\+json"[^>]*>(.*?)<\/script>/gs)].map((m) => JSON.parse(m[1]));
export const count = (html, re) => (html.match(re) || []).length;
export const attr = (html, re) => [...html.matchAll(new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g'))].map((m) => m[1]);
