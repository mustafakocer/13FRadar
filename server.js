// Local dev server that emulates Vercel's file-based API routing.
// Production uses the api/ directory directly as serverless functions.
import express from 'express';

const app = express();
const PORT = process.env.PORT || 3001;

const routes = [
  ['/api/search', () => import('./api/search.js')],
  ['/api/returns', () => import('./api/returns.js')],
  [/^\/api\/manager\/([^/]+)$/, () => import('./api/manager/[cik].js'), ['cik']],
  [/^\/api\/aum-history\/([^/]+)$/, () => import('./api/aum-history/[cik].js'), ['cik']],
  [/^\/api\/holdings\/([^/]+)\/([^/]+)$/, () => import('./api/holdings/[cik]/[acc].js'), ['cik', 'acc']],
  [/^\/api\/stock\/([^/]+)$/, () => import('./api/stock/[ticker].js'), ['ticker']],
  [/^\/api\/chart\/([^/]+)$/, () => import('./api/chart/[ticker].js'), ['ticker']],
];

app.use(async (req, res) => {
  const path = req.path;
  for (const [matcher, load, keys] of routes) {
    let params = null;
    if (typeof matcher === 'string') {
      if (path === matcher) params = {};
    } else {
      const m = matcher.exec(path);
      if (m) params = Object.fromEntries(keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
    }
    if (params) {
      req.query = { ...req.query, ...params };
      const mod = await load();
      return mod.default(req, res);
    }
  }
  res.status(404).json({ error: 'Not found' });
});

app.listen(PORT, () => console.log(`API dev server on http://localhost:${PORT}`));
