import path from 'node:path';

// How heavy the server HTML of a page is, and how much of it is the
// dehydrated query state (window.__STATE__) rather than markup. Run after a
// build:  node scripts/page-weight.mjs [/tr/filings …]
// tests/page-weight.test.mjs holds the pages to a byte budget with this.
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
export const PAGES = ['/tr', '/tr/filings', '/tr/rankings/most-bought', '/tr/compare'];

export async function renderPage(url, headers = {}) {
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

// { html, state, queries: { '<query key>': bytes } } — bytes as sent (UTF-8).
export function weigh(html) {
  const m = /<script>window\.__STATE__=(.*?)(?:;window\.__NOT_FOUND__=true)?<\/script>/s.exec(html);
  const raw = m ? m[1] : '';
  const queries = {};
  try {
    for (const q of JSON.parse(raw)?.queries || []) {
      queries[JSON.stringify(q.queryKey)] = Buffer.byteLength(JSON.stringify(q.state?.data ?? null));
    }
  } catch {
    /* no state: a client-rendered shell */
  }
  return { html: Buffer.byteLength(html), state: Buffer.byteLength(raw), queries };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const kb = (n) => `${(n / 1024).toFixed(0)} KB`;
  for (const url of process.argv.slice(2).length ? process.argv.slice(2) : PAGES) {
    const r = await renderPage(url);
    const w = weigh(r.html);
    console.log(`${url}  ${r.status}  html ${kb(w.html)}  state ${kb(w.state)}`);
    for (const [k, v] of Object.entries(w.queries).sort((a, b) => b[1] - a[1]).slice(0, 6)) console.log(`    ${kb(v).padStart(8)}  ${k}`);
  }
  process.exit(0);
}
