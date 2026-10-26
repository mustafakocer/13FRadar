// The quarterly report as a PDF, the lead magnet behind /api/lead-file.
//   node scripts/build-report-pdf.mjs 2026-q2      → api/_data/reports/2026-q2.tr.pdf + .en.pdf
//
// Prints the site's own report page (/tr/reports/<id>, /en/reports/<id>)
// with headless Chromium, so the PDF always matches what the page shows; the
// lead form and the chrome around the page carry `no-print`. Needs a built
// client (npm run build) and a Chromium: CHROMIUM_PATH, else Playwright's own.
// Run it after scripts/build-report.mjs each quarter and commit the two files.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';

const id = String(process.argv[2] || '').toLowerCase();
if (!/^\d{4}-q[1-4]$/.test(id)) {
  console.error('usage: node scripts/build-report-pdf.mjs <yyyy-qN>');
  process.exit(1);
}
const root = process.cwd();
if (!fs.existsSync(path.join(root, 'api', '_data', 'reports', `${id}.json`))) {
  console.error(`api/_data/reports/${id}.json missing — run scripts/build-report.mjs first`);
  process.exit(1);
}
if (!fs.existsSync(path.join(root, 'client', 'dist', 'index.html'))) {
  console.error('client/dist missing — run npm run build first');
  process.exit(1);
}

const PORT = Number(process.env.PDF_PORT || 3399);
const server = spawn(process.execPath, ['server.js'], { cwd: root, env: { ...process.env, PORT: String(PORT) }, stdio: 'ignore' });
const stop = () => server.kill('SIGTERM');
process.on('exit', stop);

async function waitUp(url, ms = 30000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try {
      const r = await fetch(url);
      if (r.ok) return;
    } catch {
      /* not yet */
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`server did not answer at ${url}`);
}

const LABEL = {
  tr: { note: 'fundocap.co · SEC 13F verisi · Yatırım tavsiyesi değildir', page: 'Sayfa' },
  en: { note: 'fundocap.co · SEC 13F data · Not investment advice', page: 'Page' },
};

try {
  await waitUp(`http://localhost:${PORT}/en`);
  const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  for (const lang of ['tr', 'en']) {
    const page = await browser.newPage({ viewport: { width: 1200, height: 1600 } });
    // nothing third-party in a PDF
    await page.route(/googletagmanager|clarity\.ms|facebook|brandfetch/, (r) => r.abort());
    await page.addInitScript(() => {
      try {
        localStorage.setItem('fc_consent_marketing', JSON.stringify({ v: 1, s: 'denied' }));
      } catch {
        /* fine */
      }
    });
    await page.goto(`http://localhost:${PORT}/${lang}/reports/${id}`, { waitUntil: 'networkidle' });
    await page.emulateMedia({ media: 'print' });
    const out = path.join(root, 'api', '_data', 'reports', `${id}.${lang}.pdf`);
    await page.pdf({
      path: out,
      format: 'A4',
      printBackground: true,
      margin: { top: '16mm', bottom: '18mm', left: '12mm', right: '12mm' },
      displayHeaderFooter: true,
      headerTemplate: '<span></span>',
      footerTemplate: `<div style="font-size:8px;color:#667;width:100%;padding:0 12mm;display:flex;justify-content:space-between"><span>${LABEL[lang].note}</span><span>${LABEL[lang].page} <span class="pageNumber"></span>/<span class="totalPages"></span></span></div>`,
    });
    console.log(`${path.relative(root, out)} · ${Math.round(fs.statSync(out).size / 1024)} KB`);
    await page.close();
  }
  await browser.close();
} finally {
  stop();
}
