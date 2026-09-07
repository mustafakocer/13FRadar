import { createRequire } from 'node:module';
import { cached, TTL } from '../_lib/cache.js';
import { requirePro } from '../_lib/auth.js';
import { build } from '../_lib/consensusBuild.js';

// GET /api/consensus — Pro: buys, sells and fresh positions of the curated
// managers. The public part (most-held) is the static /consensus.json file.
// The daily Action writes the full dataset to api/_data/consensus-pro.json
// (outside the public folder); the live build is only a fallback.
const require = createRequire(import.meta.url);

function precomputed() {
  try {
    const d = require('../_data/consensus-pro.json');
    return d?.mostHeld?.length ? d : null;
  } catch {
    return null;
  }
}

export default async function handler(req, res) {
  if (!(await requirePro(req, res))) return;
  try {
    const data = precomputed() || (await cached('consensus:v1', TTL.HOUR_6, build));
    res.status(200).json(data);
  } catch (err) {
    res.status(502).json({ error: String(err.message || err) });
  }
}
