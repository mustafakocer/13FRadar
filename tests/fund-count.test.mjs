// The fund count reads the same on the home page and the pricing page (both
// from universe-summary.json through client/src/lib/fundCount.js), and the
// headline total carries its definition.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { ssr } from './helpers.mjs';
import { fundCountLabel } from '../client/src/lib/fundCount.js';

const text = (html) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
const summary = JSON.parse(fs.readFileSync(new URL('../client/public/universe-summary.json', import.meta.url), 'utf8'));

for (const [lang, locale, home, pricing] of [
  ['tr', 'tr-TR', /([\d.]+) Fon(?![\wçğıöşü])/, /Tam evren tarayıcı \(([^)]*) fon\)/],
  ['en', 'en-US', /([\d,]+) Funds(?!\w)/, /Full-universe screener \(([^)]*) funds\)/],
]) {
  test(`${lang}: home and pricing state the same number of funds`, async () => {
    const h = text((await ssr(`/${lang}`)).html).match(home)?.[1];
    const p = text((await ssr(`/${lang}/pricing`)).html).match(pricing)?.[1];
    assert.ok(h && p, `home ${h}, pricing ${p}`);
    assert.equal(h, p);
    assert.equal(h, fundCountLabel(summary.count, { locale }));
  });
}

test('the headline total says what it counts', async () => {
  const html = (await ssr('/tr')).html;
  assert.match(text(html), new RegExp(`\\$${Math.floor(summary.totalAum / 1e12)}T\\+`));
  assert.match(html, /En son çeyrek \(2026 Q2\), fon başına tek bildirim, SEC 13F; opsiyonlar hariç; aynı hisse farklı fonlarda ayrı sayılır\./);
});
