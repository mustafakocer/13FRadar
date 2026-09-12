// Build gate: render representative pages through the real SSR entry with
// the offline fixtures and validate every JSON-LD block. Exits non-zero on
// the first invalid block so a broken schema never ships.
import path from 'node:path';
import { validateHtmlJsonLd } from '../client/src/lib/jsonldValidate.js';

process.env.SEC_FIXTURE_DIR = process.env.SEC_FIXTURE_DIR || path.join(process.cwd(), 'tests', 'fixtures', 'sec');
process.env.GURU_HISTORY_FILE = process.env.GURU_HISTORY_FILE || path.join(process.cwd(), 'tests', 'fixtures', 'guru-history.fixture.json');
process.env.SITE_URL = process.env.SITE_URL || 'https://example.test';

const { default: handler } = await import('../api/ssr.js');
const render = (url) =>
  new Promise((resolve) => {
    const res = { statusCode: 200, headers: {}, setHeader() {}, end(body) { resolve({ status: this.statusCode, html: body || '' }); } };
    handler({ url, headers: { host: 'example.test' }, query: {} }, res);
  });

const PAGES = ['/en', '/tr', '/en/guru/berkshire-hathaway-warren-buffett', '/tr/guru/pershing-square-bill-ackman', '/en/stock/AAPL', '/tr/stock/AMZN', '/en/rankings/most-bought', '/tr/rankings/conviction', '/en/rankings/consensus'];
const EXPECT = {
  '/en$': ['Organization', 'WebSite'],
  '/tr$': ['Organization', 'WebSite'],
  '/en/guru/': ['Person', 'Dataset', 'BreadcrumbList', 'FAQPage'],
  '/tr/guru/': ['Person', 'Dataset', 'BreadcrumbList', 'FAQPage'],
  '/en/stock/': ['Corporation', 'Dataset', 'BreadcrumbList', 'FAQPage'],
  '/tr/stock/': ['Corporation', 'Dataset', 'BreadcrumbList', 'FAQPage'],
  '/en/rankings/': ['Article', 'ItemList', 'FAQPage', 'BreadcrumbList'],
  '/tr/rankings/': ['Article', 'ItemList', 'FAQPage', 'BreadcrumbList'],
};
let failed = 0;
for (const url of PAGES) {
  const { status, html } = await render(url);
  const { blocks, problems } = validateHtmlJsonLd(html);
  const types = blocks.map((b) => b['@type']);
  const want = Object.entries(EXPECT).find(([k]) => (k.endsWith('$') ? url === k.slice(0, -1) : url.startsWith(k)))?.[1] || [];
  const missing = want.filter((t) => !types.includes(t));
  const ok = status === 200 && !problems.length && !missing.length;
  console.log(`${ok ? '✓' : '✖'} ${url} [${types.join(', ')}]${missing.length ? ` missing ${missing.join(',')}` : ''}${problems.length ? `\n    ${problems.join('\n    ')}` : ''}`);
  if (!ok) failed++;
}
if (failed) {
  console.error(`\n✖ ${failed} page(s) with invalid or missing JSON-LD`);
  process.exit(1);
}
console.log('json-ld ok');
