// D paketi — anlaşılırlık: okunur şirket adları, teknik kodların (CIK, "SH")
// sayfa metninden çıkması, bölüm başlıklarının altındaki tek cümlelik
// açıklamalar ve ana sayfadaki üç kısa yol.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ssr } from './helpers.mjs';
import { displayCompany, prettyName, personName } from '../client/src/lib/label.js';
import { EXPLANATIONS } from '../client/src/copy/explanations.js';

// visible text only: scripts (JSON-LD, state), tags and title attributes out
const visible = (html) =>
  html
    .replace(/<script[\s\S]*?<\/script>/g, ' ')
    .replace(/title="[^"]*"/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/\s+/g, ' ');

test('registry names read like company names', () => {
  assert.equal(displayCompany('BERKSHIRE HATHAWAY INC DEL').short, 'Berkshire Hathaway');
  assert.equal(displayCompany('BERKSHIRE HATHAWAY INC DEL').full, 'Berkshire Hathaway Inc');
  assert.equal(displayCompany('TAIWAN SEMICONDUCTOR MANUFAC').short, 'Taiwan Semiconductor');
  assert.equal(displayCompany('Apple Inc.').short, 'Apple');
  assert.equal(displayCompany('COCA COLA CO').short, 'Coca-Cola');
  // a name that is nothing but its one word stays whole
  assert.equal(displayCompany('VISA INC.').short, 'Visa');
  assert.equal(prettyName('CATERPILLAR INC /DE/'), 'Caterpillar Inc');
  // initials, brands, small words, mostly-caps names
  assert.equal(displayCompany('FULLER H B CO').short, 'H.B. Fuller');
  assert.equal(displayCompany('D R HORTON INC').short, 'D.R. Horton');
  assert.equal(displayCompany('BANK OF AMER CORP').short, 'Bank of America');
  assert.equal(displayCompany('ELI LILLY & Co').short, 'Eli Lilly');
  assert.equal(displayCompany('O REILLY AUTOMOTIVE INC').short, "O'Reilly Automotive");
  assert.equal(personName('COHEN RYAN'), 'Ryan Cohen');
  assert.equal(personName('MURDOCH LACHLAN K'), 'Lachlan K. Murdoch');
  assert.equal(personName("O'BRIEN DEIRDRE"), "Deirdre O'Brien");
  assert.equal(personName('SMITH JOHN JR'), 'John Smith Jr.');
});

test('the seven section explanations exist in both languages', () => {
  const KEYS = [
    'explain.guru.mostOwned',
    'explain.guru.byPct',
    'explain.guru.conviction',
    'explain.ins.cluster',
    'explain.ins.csuite',
    'ins.cluster.ownTip',
    'tips.top10',
  ];
  for (const lang of ['tr', 'en']) {
    for (const k of KEYS) assert.ok(EXPLANATIONS[lang][k]?.length > 10, `${lang} ${k}`);
  }
  assert.ok(EXPLANATIONS.tr['explain.ins.intro'].includes("SEC'e bildirir"));
  assert.ok(EXPLANATIONS.en['explain.ins.intro'].includes('2 business days'));
});

test('home: card explanations are in the server HTML, in both languages', async () => {
  for (const lang of ['tr', 'en']) {
    const { status, html } = await ssr(`/${lang}`);
    assert.equal(status, 200);
    const text = visible(html);
    for (const k of ['explain.guru.mostOwned', 'explain.guru.byPct', 'explain.guru.conviction', 'explain.ins.cluster']) {
      assert.ok(text.includes(EXPLANATIONS[lang][k]), `${lang}: ${k} on the home page`);
    }
    // the three plain-language entry points under the hero
    assert.ok(html.includes('hero-quick'), 'hero quick row rendered');
    const QUICK = {
      tr: ['Buffett bu çeyrek ne aldı?', 'Bugün hangi yöneticiler alım yaptı?', 'Bir hisseyi kim tutuyor?'],
      en: ['What did Buffett buy this quarter?', 'Which executives bought today?', 'Who owns a stock?'],
    };
    for (const q of QUICK[lang]) assert.ok(text.includes(q), `${lang}: "${q}"`);
    assert.ok(!/\bCIK\s+\d/.test(text), `${lang}: no CIK in the visible home text`);
  }
});

test('Berkshire page: clean names, no CIK or type column in the visible text', async () => {
  const { status, html } = await ssr('/tr/guru/berkshire-hathaway-warren-buffett');
  assert.equal(status, 200);
  const text = visible(html);
  assert.ok(!text.includes('BERKSHIRE HATHAWAY INC DEL'), 'raw registry name gone');
  assert.ok(!/\bCIK\s+\d/.test(text), 'no CIK in the visible text (tooltip only)');
  assert.ok(html.includes(`title="SEC EDGAR · CIK `), 'CIK still available on the SEC link tooltip');
  assert.ok(!html.includes('data-col="putCall"'), 'the type column is gone');
  assert.ok(text.includes("SEC'e bildirim"), 'filing date is labelled in plain language');
});

test('insiders page: the plain-language intro is there', async () => {
  for (const lang of ['tr', 'en']) {
    const { status, html } = await ssr(`/${lang}/insiders`);
    assert.equal(status, 200);
    assert.ok(visible(html).includes(EXPLANATIONS[lang]['explain.ins.intro']), `${lang} intro`);
  }
});
