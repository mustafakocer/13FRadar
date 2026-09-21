// Local dev server that emulates Vercel's routing:
//   /api/*      → api/index.js (single catch-all function)
//   /assets/*, static files → client/dist (after `npm run build`)
//   everything else → api/ssr.js (server-rendered pages)
// For hot-reloading UI work use `npm run dev:client` (Vite, client-only).
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';

const app = express();
const PORT = process.env.PORT || 3001;
const dist = path.join(process.cwd(), 'client', 'dist');

app.use(async (req, res, next) => {
  // sitemap / robots live behind the API function in production (vercel.json)
  const sm = /^\/(sitemap(?:-([a-z0-9-]+))?\.xml|robots\.txt)$/.exec(req.path);
  if (sm) {
    req.query.route = ['sitemap'];
    req.query.type = sm[1] === 'robots.txt' ? 'robots' : sm[2] || 'index';
    const mod = await import('./api/index.js');
    return mod.default(req, res);
  }
  const m = /^\/api(?:\/(.*))?$/.exec(req.path);
  if (!m) return next();
  req.query.route = (m[1] || '')
    .split('/')
    .filter(Boolean)
    .map(decodeURIComponent);
  const mod = await import('./api/index.js');
  return mod.default(req, res);
});

if (fs.existsSync(dist)) {
  app.use(express.static(dist, { index: false, extensions: [] }));
}

app.use(async (req, res) => {
  if (!fs.existsSync(path.join(dist, 'server', 'entry-server.js'))) {
    return res
      .status(503)
      .type('text/plain')
      .send('SSR bundle missing — run `npm run build` first (or use `npm run dev:client` for the client-only dev server).');
  }
  const mod = await import('./api/ssr.js');
  return mod.default(req, res);
});

app.listen(PORT, () => console.log(`Fundocap dev server on http://localhost:${PORT}`));
