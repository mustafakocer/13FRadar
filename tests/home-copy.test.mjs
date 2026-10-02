// C — the home page's copy: the six texts in both languages, in the server
// HTML, with the counts read from the data (never typed into the text).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { ssr } from './helpers.mjs';
import { fundCountLabel } from '../client/src/lib/fundCount.js';

const text = (html) => html.replace(/<!-- -->/g, '').replace(/<[^>]+>/g, ' ').replace(/&#x27;|&#39;/g, "'").replace(/\s+/g, ' ');
const read = (f) => JSON.parse(fs.readFileSync(new URL(`../client/public/${f}`, import.meta.url), 'utf8'));
const summary = read('universe-summary.json');
const consensus = read('consensus.json');

const COPY = {
  tr: {
    locale: 'tr-TR',
    lead: (n) => `ABD'deki ${n} fonun portföyünü ve şirket yöneticilerinin kendi hisselerindeki alım-satımlarını SEC kayıtlarından derliyoruz. Her gün güncel, sade ve Türkçe.`,
    cta: 'Ücretsiz hesap aç',
    stats: ['Fon', 'Toplam portföy', 'Pozisyon', 'SEC EDGAR Kaynak: SEC'],
    guru: (n) => `Takip ettiğimiz ${n} ünlü yatırımcının ortak tercihleri: en çok tuttukları ve bu çeyrek en çok aldıkları.`,
    tracked: /(\d+) usta takip ediliyor/,
    guruN: /Takip ettiğimiz (\d+) ünlü yatırımcının/,
    how3: 'Bildirimler çeyrek sonundan itibaren 45 güne kadar gecikmeli gelir. Bu bir sinyal servisi değil; kayıtların düzenli ve anlaşılır hali.',
    why: ['Neden Fundocap?', 'Türkçe ve sade', 'Terimleri açıklıyoruz, rakamları yorumlanabilir hale getiriyoruz.', 'Kaynağı belli', 'Her rakamdan tek tıkla ilgili SEC bildirimine gidebilirsin.', 'Kontrol edilen veri', 'Hatalı bildirimler otomatik yakalanıyor ve listelerden çıkarılıyor.'],
    how: 'Nasıl Çalışır?',
  },
  en: {
    locale: 'en-US',
    lead: (n) => `We compile the portfolios of ${n} US funds and the trades executives make in their own companies' shares, straight from SEC filings. Updated daily, in plain language.`,
    cta: 'Create a free account',
    stats: ['Funds', 'Total portfolio value', 'Positions', 'SEC EDGAR Source: SEC'],
    guru: (n) => `What the ${n} famous investors we track have in common: their most-held stocks and their biggest buys this quarter.`,
    tracked: /(\d+) superinvestors tracked/,
    guruN: /What the (\d+) famous investors/,
    how3: "Filings arrive up to 45 days after quarter-end. This is not a signal service; it's the public record, organized and easy to read.",
    why: ['Why Fundocap?', 'Clear and simple', 'We explain the terms and make the numbers easy to interpret.', 'Sourced', 'Every figure links to its SEC filing in one click.', 'Checked data', 'Faulty filings are caught automatically and kept out of the rankings.'],
    how: 'How It Works',
  },
};

for (const [lang, c] of Object.entries(COPY)) {
  test(`${lang}: the six home page texts are in the server HTML`, async () => {
    const { status, html } = await ssr(`/${lang}`);
    assert.equal(status, 200);
    const plain = text(html);
    const funds = fundCountLabel(summary.count, { locale: c.locale });
    assert.ok(plain.includes(c.lead(funds)), 'hero lead with the fund count');
    // the lead's count is the first stat box's count
    assert.ok(plain.includes(`${funds} ${c.stats[0]} `), `stat box "${funds} ${c.stats[0]}"`);
    // the main button: new label, same destination
    assert.match(html, new RegExp(`<a[^>]*href="/${lang}/pricing"[^>]*>\\s*${c.cta}\\s*</a>`));
    for (const label of c.stats) assert.ok(plain.includes(label), `stat label ${label}`);
    // the guru count: the coverage line's "{n} … tracked"
    assert.ok(plain.includes(c.guru(consensus.coverage.tracked)), 'consensus lead with the guru count');
    assert.ok(plain.includes(c.how3), 'how it works, step 3');
    // "why" sits right above "how it works"
    const at = c.why.map((s) => plain.indexOf(s));
    assert.ok(at.every((i) => i >= 0), `why section ${at}`);
    assert.ok(at[at.length - 1] < plain.indexOf(c.how), 'why comes before how it works');
    assert.ok(plain.indexOf(c.how) - at[0] < 600, 'nothing in between');
  });
}

for (const [lang, c] of Object.entries(COPY)) {
  test(`${lang}: the consensus lead counts the gurus the coverage line counts`, async () => {
    const plain = text((await ssr(`/${lang}`)).html);
    const line = plain.match(c.tracked)?.[1];
    const lead = plain.match(c.guruN)?.[1];
    assert.ok(line && lead, `line ${line}, lead ${lead}`);
    assert.equal(lead, line);
  });
}
