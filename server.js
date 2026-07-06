// Local dev server that emulates Vercel's catch-all API routing.
// Production uses api/[[...route]].js as a single serverless function.
import express from 'express';

const app = express();
const PORT = process.env.PORT || 3001;

app.use(async (req, res) => {
  const m = /^\/api(?:\/(.*))?$/.exec(req.path);
  if (!m) return res.status(404).json({ error: 'Not found' });
  req.query.route = (m[1] || '')
    .split('/')
    .filter(Boolean)
    .map(decodeURIComponent);
  const mod = await import('./api/[[...route]].js');
  return mod.default(req, res);
});

app.listen(PORT, () => console.log(`API dev server on http://localhost:${PORT}`));
