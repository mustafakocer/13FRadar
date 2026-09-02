import { cached, TTL } from '../_lib/cache.js';
import { build } from '../_lib/consensusBuild.js';

export default async function handler(req, res) {
  try {
    const data = await cached('consensus:v1', TTL.HOUR_6, build);
    res.setHeader('Cache-Control', 's-maxage=43200, stale-while-revalidate=172800');
    res.status(200).json(data);
  } catch (err) {
    res.status(502).json({ error: String(err.message || err) });
  }
}
