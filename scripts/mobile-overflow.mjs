// Horizontal-overflow check at phone widths: every page in PAGES at every
// viewport in VIEWPORTS must not scroll sideways (document.scrollWidth ≤
// window.innerWidth) after hydration. Prints one row per page × viewport
// and exits 1 on any overflow — the CI gate in .github/workflows/mobile.yml.
//
//   node scripts/mobile-overflow.mjs                 (server on BASE, default http://localhost:3001)
//   BASE=http://localhost:3001 SHOTS=out/ node …      also saves screenshots
//   MOBILE_PAGES=/tr,/tr/pricing node …               a subset
//
// Needs Chromium: `npx playwright install chromium` on a runner, or
// PLAYWRIGHT_CHROMIUM (an executable path) when a browser is pre-installed.
import fs from 'node:fs';
import path from 'node:path';

const BASE = (process.env.BASE || 'http://localhost:3001').replace(/\/$/, '');
const SHOTS = process.env.SHOTS || '';
export const VIEWPORTS = [
  { name: '390x844', width: 390, height: 844 },
  { name: '360x800', width: 360, height: 800 },
];
export const PAGES = (process.env.MOBILE_PAGES ? process.env.MOBILE_PAGES.split(',') : [
  '/tr',
  '/tr/guru/berkshire-hathaway-warren-buffett',
  '/tr/guru/berkshire-hathaway-warren-buffett/changes',
  '/tr/guru/berkshire-hathaway-warren-buffett/mix',
  '/tr/guru/berkshire-hathaway-warren-buffett/history',
  '/tr/stock/AAPL',
  '/tr/insiders',
  '/tr/consensus',
  '/tr/calendar',
  '/tr/filings',
  '/tr/rankings/most-bought',
  '/tr/pricing',
  '/tr/account',
  '/tr/compare',
  '/tr/gizlilik',
]).map((p) => p.trim()).filter(Boolean);

async function launch() {
  let chromium;
  try {
    ({ chromium } = await import('playwright'));
  } catch {
    ({ chromium } = await import('playwright-core'));
  }
  const executablePath = process.env.PLAYWRIGHT_CHROMIUM || undefined;
  return chromium.launch({ executablePath });
}

// Overflow is judged against the device width, not window.innerWidth: a
// mobile browser widens its layout viewport to fit content with a minimum
// width, so innerWidth follows the bug instead of exposing it. An element
// inside its own horizontal scroller (a wide table in .table-wrap) is
// meant to stick out and is not a culprit.
const measure = (deviceWidth) => {
  const scrolls = (el) => {
    for (let n = el.parentElement; n && n !== document.body; n = n.parentElement) {
      const o = getComputedStyle(n).overflowX;
      if (o === 'auto' || o === 'scroll') return true;
    }
    return false;
  };
  let worst = null;
  for (const el of document.querySelectorAll('body *')) {
    const r = el.getBoundingClientRect();
    if (r.right > deviceWidth + 1 && r.width > 0 && !scrolls(el) && (!worst || r.right > worst.right)) {
      worst = { right: Math.round(r.right), tag: el.tagName.toLowerCase(), cls: String(el.className?.baseVal ?? el.className ?? '').slice(0, 60) };
    }
  }
  return { scrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth, deviceWidth, worst };
};

const browser = await launch();
const rows = [];
let bad = 0;
for (const vp of VIEWPORTS) {
  const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  for (const p of PAGES) {
    let r;
    try {
      await page.goto(`${BASE}${p}`, { waitUntil: 'networkidle', timeout: 45000 });
      await page.waitForTimeout(600);
      r = await page.evaluate(measure, vp.width);
    } catch (e) {
      r = { error: String(e.message || e).slice(0, 80) };
    }
    const overflow = r.error ? null : r.scrollWidth > r.deviceWidth || Boolean(r.worst);
    if (overflow || r.error) bad++;
    rows.push({ vp: vp.name, page: p, ...r, overflow });
    console.log(`${overflow === null ? 'ERR ' : overflow ? 'FAIL' : 'ok  '} ${vp.name} ${p.padEnd(58)} ${r.error || `${r.scrollWidth}/${r.deviceWidth}${r.worst ? ` ← <${r.worst.tag} class="${r.worst.cls}"> right=${r.worst.right}` : ''}`}`);
    if (SHOTS) {
      fs.mkdirSync(SHOTS, { recursive: true });
      await page.screenshot({ path: path.join(SHOTS, `${vp.name}${p.replace(/[^a-z0-9]+/gi, '_')}.png`), fullPage: true }).catch(() => {});
    }
  }
  await ctx.close();
}
await browser.close();
console.log(`\n${rows.length - bad}/${rows.length} page×viewport checks without horizontal overflow`);
if (process.env.GITHUB_STEP_SUMMARY) {
  fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, ['## Mobile overflow', '', '| viewport | page | scrollWidth / innerWidth | widest element |', '|---|---|---|---|', ...rows.map((r) => `| ${r.vp} | ${r.page} | ${r.error || `${r.scrollWidth} / ${r.deviceWidth}`} ${r.overflow ? '❌' : r.error ? '⚠️' : '✅'} | ${r.worst ? `<${r.worst.tag} class="${r.worst.cls}">` : ''} |`), ''].join('\n'));
}
process.exit(bad ? 1 : 0);
