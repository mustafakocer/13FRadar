// Foreign-issuer (FPI) Form 4 report, in plain Turkish, from the files in
// the repository (no network): what the lines look like, how many were
// converted to US dollars and how many could not be, the ADR ratio of the
// 20 FPIs with the most lines and where it comes from, and the home page's
// "ÖNE ÇIKAN" card and daily totals before and after the conversion.
//
//   node scripts/fpi-report.mjs            markdown to stdout
//   node scripts/fpi-report.mjs --json     the numbers
//   node scripts/fpi-report.mjs --gate     exit 1 when more than 20% of the
//                                          last six months' priced FPI lines
//                                          could not be converted
import { readJson, currentRows, readRawServed, files } from '../api/_lib/insiderStore.js';
import { normalizeRows, securityKind } from '../api/_lib/fpiNormalize.js';
import { fpiContext, loadFpi, loadMeta } from '../api/_lib/fpiContext.js';
import { currencyOf } from '../api/_lib/fx.js';
import { statedRatio } from '../api/_lib/adrRatio.js';
import { buildTeaser } from '../api/_lib/insiderTeaser.js';
import { categorize } from '../api/_lib/insiderClassify.js';
import { isListed } from '../api/_lib/insiderModel.js';

export const GATE = 0.2;
const KIND_TR = { ads: 'ADS / ADR', share: 'Ana hisse (ordinary / CPO / common)', preferred: 'İmtiyazlı hisse', other: 'Unit / varant / diğer', null: 'Bilinmiyor (form alanları yok)' };
const SRC_TR = { f6: 'SEC F-6', '20f': 'SEC 20-F kapak', footnote: 'Form 4 dipnotu', derived: 'türetilmiş', override: 'elle düzeltme', direct: 'doğrudan (ADR yok)', ads: 'ADS (oran 1)' };
const WHY_TR = { no_rate: 'kur yok (H.10 bu para birimini yayımlamıyor)', mismatch: 'hiçbir okuma o günün kapanışıyla uyuşmuyor', unverifiable: 'karşılaştıracak piyasa verisi yok', no_ratio: 'ADR oranı bulunamadı', non_market: 'piyasa fiyatı olmayan işlem' };
const fmt = (n) => (n == null ? '—' : Math.abs(n) >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : Math.abs(n) >= 1e3 ? `${(n / 1e3).toFixed(1)}K` : String(Math.round(n)));
const pct = (a, b) => (b ? `%${((a / b) * 100).toFixed(1)}` : '—');

export function compute({ since = null } = {}) {
  const db = readJson(files.data(), { rows: [], companies: {} });
  const all = currentRows(db.rows || []);
  const raw = readRawServed();
  const ctx = fpiContext({ raw });
  const fpi = loadFpi() || {};
  const issuers = fpi.issuers || {};
  const meta = loadMeta();
  const lastDay = all.reduce((m, r) => (r.f > m ? r.f : m), '');
  const from = since || new Date(Date.parse(lastDay) - 183 * 86400000).toISOString().slice(0, 10);
  const norm = normalizeRows(all, ctx);

  // ------- A1: FPI lines in the last six months
  const six = [];
  norm.forEach((n, i) => {
    const r = all[i];
    if (r.f < from || !issuers[r.ci]) return;
    six.push({ r, n, raw: ctx.rawOf(r) });
  });
  const kindCur = {};
  const kinds = {};
  const curs = {};
  let withTitle = 0;
  let withNotes = 0;
  let noteCur = 0;
  let noteRatio = 0;
  for (const { r, n, raw: x } of six) {
    const kind = String(securityKind(x?.st, issuers[r.ci]));
    const notes = x?.fn ? Object.values(x.fn).join(' ') : '';
    const cur = n.fx?.cu || (n.fx ? '?' : r.p > 0 ? 'USD' : '—');
    kinds[kind] = (kinds[kind] || 0) + 1;
    curs[cur] = (curs[cur] || 0) + 1;
    const k = `${kind}|${cur}`;
    kindCur[k] = (kindCur[k] || 0) + 1;
    if (x?.st) withTitle++;
    if (notes) withNotes++;
    if (currencyOf(notes)) noteCur++;
    if (statedRatio(notes)) noteRatio++;
  }

  // ------- B: normalised vs not (priced lines)
  const priced = six.filter(({ r }) => r.p > 0 && !['preferred', 'other'].includes(String(securityKind(ctx.rawOf(r)?.st, issuers[r.ci]))));
  const ok = priced.filter(({ n }) => n.fx?.ok);
  const failed = priced.filter(({ n }) => n.fx?.fail);
  const failWhy = {};
  const failTickers = {};
  for (const { r, n } of failed) {
    failWhy[n.fx.fail] = (failWhy[n.fx.fail] || 0) + 1;
    const m = (failTickers[n.fx.fail] ||= {});
    m[r.t || '—'] = (m[r.t || '—'] || 0) + 1;
  }
  // open-market lines of these issuers with no price at all: not in the
  // denominator (no amount to convert), listed for completeness
  const zeroPrice = six.filter(({ r }) => ['P', 'S'].includes(r.k) && !(r.p > 0));
  const zeroTickers = {};
  for (const { r } of zeroPrice) zeroTickers[r.t || '—'] = (zeroTickers[r.t || '—'] || 0) + 1;
  // data gaps: no exchange rate, no market data, no ratio and nothing to
  // derive it from. The rest failed the market check (a reading error or a
  // unit the rules do not know).
  const DATA_GAP = new Set(['no_rate', 'unverifiable', 'no_ratio', 'non_market']);
  const gap = failed.filter(({ n }) => DATA_GAP.has(n.fx.fail)).length;
  const topOf = (m) => Object.entries(m || {}).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([t, k]) => `${t} ${k}`);
  const reasons = [
    { key: 'no_rate', label: 'Kur yok (kaynakta bu para birimi yok)', n: failWhy.no_rate || 0, top: topOf(failTickers.no_rate), gap: true },
    { key: 'no_ratio', label: 'ADR oranı yok (belge yok, türetecek kapanış yok)', n: failWhy.no_ratio || 0, top: topOf(failTickers.no_ratio), gap: true },
    { key: 'unverifiable', label: 'Fiyat geçmişi yok (piyasa verisi yok)', n: failWhy.unverifiable || 0, top: topOf(failTickers.unverifiable), gap: true },
    { key: 'mismatch', label: 'Piyasa kontrolünü geçmedi (birim/oran uyuşmuyor)', n: failWhy.mismatch || 0, top: topOf(failTickers.mismatch), gap: false },
    { key: 'zero', label: 'Fiyat 0 (paydada değil)', n: zeroPrice.length, top: topOf(zeroTickers), gap: null },
    { key: 'non_market', label: 'Diğer: piyasa fiyatı olmayan işlem (opsiyon kullanımı, ödül, phantom hisse — fiyat kullanım/hibe fiyatı, kapanışla karşılaştırılamaz)', n: failWhy.non_market || 0, top: topOf(failTickers.non_market), gap: true },
    { key: 'other', label: 'Diğer', n: Object.entries(failWhy).filter(([k]) => !['no_rate', 'no_ratio', 'unverifiable', 'mismatch', 'non_market'].includes(k)).reduce((a, [, v]) => a + v, 0), top: [], gap: false },
  ];
  const openPriced = priced.filter(({ r }) => ['open_buy', 'open_sell'].includes(categorize(r)));
  const openFailed = openPriced.filter(({ n }) => n.fx?.fail);
  const bySrc = {};
  for (const { n } of ok) bySrc[n.fx.as] = (bySrc[n.fx.as] || 0) + 1;

  // ------- C: top 20 FPIs by lines
  const count = {};
  for (const { r } of six) count[r.ci] = (count[r.ci] || 0) + 1;
  const top = Object.entries(count)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([cik, lines]) => {
      const iss = issuers[cik];
      const mine = six.filter(({ r }) => r.ci === cik && r.p > 0);
      const conv = mine.filter(({ n }) => n.fx?.ok).length;
      const used = mine.find(({ n }) => n.fx?.ok)?.n.fx;
      return { t: iss.t, name: iss.name, country: iss.country, cur: iss.cur, ads: iss.ads, ratio: iss.ratio ?? null, src: iss.src || null, url: iss.url || null, quote: iss.quote || null, der: iss.der || null, lines, priced: mine.length, converted: conv, used: used ? { cu: used.cu, ar: used.ar, as: used.as } : null };
    });

  // ------- D: home page before/after
  const listedAll = all.filter(isListed);
  const listedNorm = norm.filter(isListed);
  const before = buildTeaser(listedAll, db.companies || {}, meta, Date.now(), { raw, seriesFor: ctx.seriesFor });
  const after = buildTeaser(listedNorm, db.companies || {}, meta, Date.now(), { raw, seriesFor: ctx.seriesFor });

  return {
    from,
    lastDay,
    fpiIssuers: Object.keys(issuers).length,
    fpiIssuers6m: new Set(six.map(({ r }) => r.ci)).size,
    adsIssuers: Object.values(issuers).filter((i) => i.ads).length,
    lines6m: six.length,
    kinds,
    curs,
    kindCur,
    fields: { withTitle, withNotes, noteCur, noteRatio },
    priced: priced.length,
    converted: ok.length,
    failed: failed.length,
    failRate: priced.length ? failed.length / priced.length : 0,
    failWhy,
    reasons,
    dataGapShare: failed.length ? gap / failed.length : 1,
    bySrc,
    openPriced: openPriced.length,
    openFailed: openFailed.length,
    failedExamples: failed.slice(0, 15).map(({ r, n }) => ({ t: r.t, d: r.d, k: r.k, p: r.p, s: r.s, cu: n.fx.cu, why: n.fx.fail })),
    top,
    home: {
      before: { highlight: before.highlight, pulse: before.pulse, cluster: before.signals.cluster.slice(0, 5) },
      after: { highlight: after.highlight, pulse: after.pulse, excluded: after.pulse.fxExcluded ?? null, cluster: after.signals.cluster.slice(0, 5) },
    },
  };
}

export function report(x = compute()) {
  const o = [];
  o.push(`## Yabancı şirket (FPI) Form 4 satırları — ${x.from} → ${x.lastDay}`);
  o.push('');
  o.push(`- Verideki FPI ihraççı: **${x.fpiIssuers}** (ADS'si olan: ${x.adsIssuers}); son 6 ayda satırı olan: **${x.fpiIssuers6m}**`);
  o.push(`- Son 6 aydaki FPI satırı: **${x.lines6m}**`);
  o.push('');
  o.push('### Menkul türü × para birimi (son 6 ay)');
  o.push('');
  const cursAll = Object.keys(x.curs).sort((a, b) => x.curs[b] - x.curs[a]);
  o.push(`| Menkul türü | ${cursAll.join(' | ')} | Toplam |`);
  o.push(`|---|${cursAll.map(() => '---:').join('|')}|---:|`);
  for (const k of Object.keys(x.kinds).sort((a, b) => x.kinds[b] - x.kinds[a]))
    o.push(`| ${KIND_TR[k] || k} | ${cursAll.map((c) => x.kindCur[`${k}|${c}`] || '').join(' | ')} | ${x.kinds[k]} |`);
  o.push('');
  o.push('"?" = para birimi belirlenemedi; "—" = fiyatsız satır (ödül vb.). Para birimi, dönüştürmede kabul edilen okumadır.');
  o.push('');
  o.push('### Form 4 alanları ne kadar işe yarıyor (son 6 ay FPI satırları)');
  o.push('');
  o.push('| Alan | Satır | Oran |');
  o.push('|---|---:|---:|');
  o.push(`| securityTitle (menkul adı) var | ${x.fields.withTitle} | ${pct(x.fields.withTitle, x.lines6m)} |`);
  o.push(`| Dipnot var | ${x.fields.withNotes} | ${pct(x.fields.withNotes, x.lines6m)} |`);
  o.push(`| Dipnot para birimini söylüyor | ${x.fields.noteCur} | ${pct(x.fields.noteCur, x.lines6m)} |`);
  o.push(`| Dipnot ADR oranını söylüyor | ${x.fields.noteRatio} | ${pct(x.fields.noteRatio, x.lines6m)} |`);
  o.push('| Para birimi alanı (priceCurrency vb.) | 0 | Form 4 XML şemasında böyle bir alan yok |');
  o.push('');
  o.push('### Dönüştürme sonucu (son 6 ay, fiyatlı FPI satırları; imtiyazlı/diğer menkuller hariç)');
  o.push('');
  o.push(`- Fiyatlı satır: ${x.priced} · USD'ye çevrilen/doğrulanan: **${x.converted}** · zaten dolar, dokunulmadı (ADR'si yok, dipnotta yabancı para yok): ${x.priced - x.converted - x.failed} · çevrilemeyen: **${x.failed}** (${pct(x.failed, x.priced)}; eşik %${GATE * 100})`);
  o.push(`- Açık piyasa alım/satım: ${x.openPriced}, çevrilemeyen ${x.openFailed} (${pct(x.openFailed, x.openPriced)})`);
  o.push(`- Çevrilenlerde oran kaynağı: ${Object.entries(x.bySrc).map(([s, n]) => `${SRC_TR[s] || s} ${n}`).join(' · ') || '—'}`);
  o.push('');
  o.push('| Neden | Satır | Veri eksikliği mi? | İlk 5 hisse (satır) |');
  o.push('|---|---:|---|---|');
  for (const r of x.reasons) o.push(`| ${r.label} | ${r.n} | ${r.gap == null ? '—' : r.gap ? 'evet' : 'hayır (kural/birim)'} | ${r.top.join(', ') || '—'} |`);
  o.push('');
  o.push(`- Başarısızların veri eksikliğinden gelen payı: **%${(x.dataGapShare * 100).toFixed(1)}**`);
  o.push('- Çevrilemeyen her satır sitede kendi para birimiyle gösterilir; dolar tutarı, getiri ve İsabet yoktur; sıralamalara ve günlük/küme toplamlarına girmez, toplamların altında "X işlem hariç" yazar.');
  o.push('');
  o.push('### İlk 20 FPI: oran ve kaynağı');
  o.push('');
  o.push('| Hisse | Ülke | Para b. | Oran (yerel/ABD menkulü) | Kaynak | Türetilmiş (uyum) | Satır | Çevrilen | Kaynak metni |');
  o.push('|---|---|---|---:|---|---|---:|---:|---|');
  for (const t of x.top) {
    const der = t.der ? `${t.der.ratio} ${t.der.cur} (${t.der.agree}/${t.der.n})` : '—';
    const ratio = t.ads ? t.ratio ?? '—' : '1 (ADR yok)';
    const src = t.url ? `[${SRC_TR[t.src] || t.src}](${t.url})` : SRC_TR[t.src] || (t.ads ? '—' : SRC_TR.direct);
    o.push(`| ${t.t} | ${t.country || '—'} | ${t.cur || '—'} | ${ratio} | ${src} | ${der} | ${t.lines} | ${t.converted}/${t.priced} | ${t.quote ? `"${t.quote.replace(/\|/g, '/').slice(0, 120)}"` : ''} |`);
  }
  o.push('');
  o.push('### Ana sayfa: önce / sonra');
  o.push('');
  const h = (v) => (v ? `${v.t} ${v.n} — $${fmt(v.v)} @ ${v.p}` : '—');
  o.push(`- ÖNE ÇIKAN: önce **${h(x.home.before.highlight)}** → sonra **${h(x.home.after.highlight)}**`);
  o.push(`- Günlük alım toplamı (${x.home.after.pulse.day}): önce **$${fmt(x.home.before.pulse.buyValue)}** (${x.home.before.pulse.buyCount} alım) → sonra **$${fmt(x.home.after.pulse.buyValue)}** (${x.home.after.pulse.buyCount} alım${x.home.after.pulse.fxExcluded ? `, ${x.home.after.pulse.fxExcluded} işlem para birimi doğrulanamadığı için hariç` : ''})`);
  o.push(`- Günlük satış toplamı: önce $${fmt(x.home.before.pulse.sellValue)} → sonra $${fmt(x.home.after.pulse.sellValue)}`);
  o.push(`- Küme (ilk 5): önce ${x.home.before.cluster.map((c) => `${c.t} ${c.insiders} kişi $${fmt(c.v)}`).join(' · ')}`);
  o.push(`  sonra ${x.home.after.cluster.map((c) => `${c.t} ${c.insiders} kişi $${fmt(c.v)}`).join(' · ')}`);
  if (x.failedExamples.length) {
    o.push('');
    o.push('### Çevrilemeyen satırlardan örnekler');
    o.push('');
    o.push('| Hisse | Tarih | Kod | Form fiyatı | Adet | Para b. | Neden |');
    o.push('|---|---|---|---:|---:|---|---|');
    for (const f of x.failedExamples) o.push(`| ${f.t} | ${f.d} | ${f.k} | ${f.p} | ${f.s} | ${f.cu || '?'} | ${WHY_TR[f.why] || f.why} |`);
  }
  return o.join('\n');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const x = compute();
  if (process.argv.includes('--json')) console.log(JSON.stringify(x, null, 1));
  else console.log(report(x));
  if (process.argv.includes('--gate') && x.failRate > GATE) {
    console.error(`::error::${(x.failRate * 100).toFixed(1)}% of priced FPI lines could not be converted (limit ${GATE * 100}%)`);
    process.exit(1);
  }
}
