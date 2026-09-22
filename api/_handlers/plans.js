import { planCatalog, publicCatalog } from '../_lib/plans.js';

// GET /api/plans — the prices this visitor is offered, in one currency, as
// /api/checkout will charge them (api/_lib/plans.js). Private: the answer
// depends on the visitor's country.
export default async function handler(req, res) {
  const country = String(req.headers['x-vercel-ip-country'] || '').toUpperCase();
  const catalog = await planCatalog(country);
  res.setHeader('Cache-Control', 'private, max-age=300');
  res.status(200).json(publicCatalog(catalog));
}
