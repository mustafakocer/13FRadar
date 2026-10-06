// Lighthouse on a deployed site: performance, accessibility, best
// practices and SEO scores for the pages a reader lands on, as a markdown
// table (the job summary). Fails when accessibility drops below 90 on any
// page — the E paketi bar. Performance is reported, not gated: a drop of
// more than 10 points is a stop-and-ask condition, judged by a person.
//
//   node scripts/lighthouse-check.mjs https://preview.example [--min-a11y=90]
//
// Env: VERCEL_BYPASS — Vercel's protection-bypass secret for previews (sent
// as a header, never printed). Needs the `lighthouse` CLI on PATH (the
// workflow installs it) and a Chrome; headless, no sandbox on CI.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const base = (process.argv[2] || '').replace(/\/$/, '');
if (!/^https?:\/\//.test(base)) {
  console.error('usage: node scripts/lighthouse-check.mjs <baseUrl>');
  process.exit(2);
}
const minA11y = Number((process.argv.find((a) => a.startsWith('--min-a11y=')) || '').split('=')[1] || 90);
const PAGES = ['/tr', '/tr/guru/berkshire-hathaway-warren-buffett', '/tr/stock/AAPL', '/tr/insiders'];
const headers = process.env.VERCEL_BYPASS ? { 'x-vercel-protection-bypass': process.env.VERCEL_BYPASS, 'x-vercel-set-bypass-cookie': 'true' } : {};
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lh-'));

const rows = [];
let failed = false;
for (const p of PAGES) {
  const out = path.join(tmp, `${p.replace(/[^a-z0-9]+/gi, '_')}.json`);
  const args = [
    `${base}${p}`,
    '--quiet', '--output=json', `--output-path=${out}`,
    '--chrome-flags=--headless=new --no-sandbox --disable-gpu',
    '--only-categories=performance,accessibility,best-practices,seo',
  ];
  if (Object.keys(headers).length) args.push(`--extra-headers=${JSON.stringify(headers)}`);
  try {
    execFileSync('lighthouse', args, { stdio: ['ignore', 'ignore', 'inherit'], timeout: 180000 });
    const r = JSON.parse(fs.readFileSync(out, 'utf8'));
    const score = (k) => Math.round((r.categories[k]?.score ?? 0) * 100);
    const row = { page: p, perf: score('performance'), a11y: score('accessibility'), bp: score('best-practices'), seo: score('seo') };
    if (row.a11y < minA11y) failed = true;
    rows.push(row);
  } catch (e) {
    failed = true;
    rows.push({ page: p, error: String(e.message || e).slice(0, 80) });
  }
}

console.log(`## Lighthouse · ${base}\n`);
console.log('| Sayfa | Performans | Erişilebilirlik | En iyi uygulamalar | SEO |');
console.log('|---|---:|---:|---:|---:|');
for (const r of rows) {
  if (r.error) console.log(`| ${r.page} | — | — | — | — | ${r.error}`);
  else console.log(`| ${r.page} | ${r.perf} | ${r.a11y < minA11y ? `**${r.a11y}** ❌` : r.a11y} | ${r.bp} | ${r.seo} |`);
}
console.log(`\nErişilebilirlik sınırı: ${minA11y}. Performans yalnız raporlanır; 10 puandan fazla düşüş durup sorma koşuludur.`);
console.log('Ölçüm sitenin varsayılan temasında (koyu), mobil profille yapılır.');
process.exit(failed ? 1 : 0);
