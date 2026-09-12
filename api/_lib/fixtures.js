import fs from 'node:fs';
import path from 'node:path';

// Offline provider fixtures (see sec.js). Only active when SEC_FIXTURE_DIR
// is set — production never reads them.
export function readFixture(rel) {
  const dir = process.env.SEC_FIXTURE_DIR;
  if (!dir) return null;
  const file = path.join(dir, rel);
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}
