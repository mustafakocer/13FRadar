// Launch audit 2: the positions table named every company twice in the
// server HTML ("COCA COLA CO COCA COLA CO" on Berkshire's page). The company
// column hides on a phone and the name is drawn under the ticker there; that
// copy is CSS (attr(data-text)), not text, so readers without the stylesheet
// (screen readers, search engines, copy and paste) get it once.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { ssr } from './helpers.mjs';

test('Berkshire positions table: each company name once in the server HTML', async () => {
  const { status, html } = await ssr('/tr/guru/berkshire-hathaway-warren-buffett');
  assert.equal(status, 200);
  const plain = html.replace(/<!-- -->/g, '').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ');
  assert.ok(html.includes('data-col="issuer"'), 'the positions table is in the server HTML');
  for (const name of ['COCA COLA CO', 'APPLE INC', 'AMERICAN EXPRESS CO']) assert.ok(!plain.includes(`${name} ${name}`), `${name} written twice`);
  assert.ok(html.includes('data-text="COCA COLA CO"'), 'the phone layout still has the name, from CSS');
  const css = fs.readFileSync(new URL('../client/src/styles/app.css', import.meta.url), 'utf8');
  assert.match(css, /\.only-narrow\[data-text\]::after \{ content: attr\(data-text\); \}/);
});
