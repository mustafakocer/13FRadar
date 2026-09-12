import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

// GET /api/report                → { reports: [ids] }
// GET /api/report/:id            → report JSON
// GET /api/report/:id?format=md  → markdown (text/markdown)
const require = createRequire(import.meta.url);
const dir = path.join(process.cwd(), 'api', '_data', 'reports');

export function reportIndex() {
  try {
    return require('../_data/reports/index.json').reports || [];
  } catch {
    return [];
  }
}

export default function handler(req, res) {
  res.setHeader('Cache-Control', 's-maxage=86400, stale-while-revalidate=604800');
  const id = String(req.query.id || '').toLowerCase();
  if (!id) return res.status(200).json({ reports: reportIndex() });
  if (!/^\d{4}-q[1-4]$/.test(id)) return res.status(400).json({ error: 'bad report id' });
  if (req.query.format === 'md') {
    const file = path.join(process.cwd(), 'reports', `${id}.md`);
    if (!fs.existsSync(file)) return res.status(404).json({ error: 'no markdown for this report' });
    res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
    return res.status(200).send(fs.readFileSync(file, 'utf8'));
  }
  const file = path.join(dir, `${id}.json`);
  if (!fs.existsSync(file)) return res.status(404).json({ error: 'report not found' });
  res.status(200).json(JSON.parse(fs.readFileSync(file, 'utf8')));
}
