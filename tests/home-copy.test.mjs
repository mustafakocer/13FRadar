// C — the home page's copy: the headline, the lead with the fund count read
// from the data (never typed into the text), the three tabs, the FAQ card
// and the methodology link, in both languages, in the server HTML.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { ssr } from './helpers.mjs';
import { fundCountLabel } from '../client/src/lib/fundCount.js';

const text = (html) => html.replace(/<!-- -->/g, '').replace(/<[^>]+>/g, ' ').replace(/&#x27;|&#39;/g, "'").replace(/\s+/g, ' ');
const read = (f) => JSON.parse(fs.readFileSync(new URL(`../client/public/${f}`, import.meta.url), 'utf8'));
const summary = read('universe-summary.json');
const cards = read('guru-cards.json');

const COPY = {
  tr: {
    locale: 'tr-TR',
    h1: 'En iyi yatırımcılar nasıl yatırım yapıyor?',
    lead: (n) => `ABD'deki ${n} fonun portföyünü ve şirket yöneticilerinin kendi hisselerindeki alım-satımlarını SEC kayıtlarından derliyoruz. Her gün güncel, sade ve Türkçe.`,
    tabs: ['Usta Yatırımcılar', 'Insider Alımları', 'Hisse Seçimleri'],
    faq: ['Bu veriler nereden geliyor?', 'Performans nasıl hesaplanıyor?', 'Ücretsiz mi?'],
    method: ['/tr/rehber/veri-kaynaklari-ve-yontem', 'Veri kaynakları ve yöntem'],
    all: (n) => `Tüm usta yatırımcılar (${n})`,
  },
  en: {
    locale: 'en-US',
    h1: 'See how the best investors invest.',
    lead: (n) => `We compile the portfolios of ${n} US funds and the trades executives make in their own companies' shares, straight from SEC filings. Updated daily, in plain language.`,
    tabs: ['Top Investors', 'Insider Buys', 'Stock Picks'],
    faq: ['Where does the data come from?', 'How is performance computed?', 'Is it free?'],
    method: ['/en/guides/data-sources-and-methodology', 'Data sources &amp; methodology'],
    all: (n) => `All superinvestors (${n})`,
  },
};

for (const [lang, c] of Object.entries(COPY)) {
  test(`${lang}: the home page texts are in the server HTML`, async () => {
    const { status, html } = await ssr(`/${lang}`);
    assert.equal(status, 200);
    const plain = text(html);
    assert.ok(plain.includes(c.h1), 'headline');
    const funds = fundCountLabel(summary.count, { locale: c.locale });
    assert.ok(plain.includes(c.lead(funds)), 'lead with the fund count');
    for (const tab of c.tabs) assert.ok(plain.includes(tab), `tab ${tab}`);
    for (const q of c.faq) assert.ok(plain.includes(q), `faq ${q}`);
    assert.match(html, new RegExp(`<a[^>]*href="${c.method[0]}"[^>]*>${c.method[1]}`));
    assert.ok(plain.includes(c.all(cards.count)), 'the "all superinvestors" button counts the cards file');
  });
}

test('the investor cards render on the server: who, firm, last year, portfolio, three stocks, the rest', async () => {
  const { html } = await ssr('/tr');
  const plain = text(html);
  const n = (html.match(/data-guru-card="/g) || []).length;
  assert.equal(n, 11, 'eleven investor cards and the FAQ card');
  assert.match(plain, /Warren Buffett/);
  assert.match(plain, /Berkshire Hathaway/);
  assert.match(plain, /\$[\d.]+[BMT] portföy/);
  assert.match(plain, /\d+ hisse daha/);
  assert.match(plain, /son 1 yıl/);
  assert.match(html, /data-home-faq/);
});
