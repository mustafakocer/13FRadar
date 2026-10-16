// The weekly sample of trades (scripts/weekly-sample-trades.mjs,
// weekly-sample.yml): ten Form 4 filings and ten Congress reports of the
// past days, what the site shows next to the filing itself, as an issue with
// a box per filing for a human to tick. The Form 4s are also read here, on
// their own, from the filing's XML (not by the site's parser) and compared
// line by line (api/_lib/insiderDataset.js compareAccession).
//
// Pure: no network, no files.
import { seeded, SITE } from './sampleCheck.js';
import { normDate, num } from './insiderForm4.js';
import { compareAccession } from './insiderDataset.js';

export const TRADE_SAMPLE_SIZE = 10;

function draw(list, n, rand) {
  const pool = [...list];
  const out = [];
  while (out.length < n && pool.length) out.push(pool.splice(Math.floor(rand() * pool.length), 1)[0]);
  return out;
}
const daysBefore = (iso, n) => new Date(Date.parse(iso) - n * 86400000).toISOString().slice(0, 10);

// Form 4 filings of the last `days` filing days with a purchase or a sale
// (the trades a reader acts on), the same ten for the same week.
//   rows: insiders.json rows → [{ acc, cik, t, n, filed, rows }]
export function pickForm4s(rows, { week, now, days = 7, size = TRADE_SAMPLE_SIZE } = {}) {
  const from = daysBefore(now, days);
  const byAcc = new Map();
  for (const r of rows) {
    if (r.sb || !r.a || !r.f || r.f < from) continue;
    if (!byAcc.has(r.a)) byAcc.set(r.a, { acc: r.a, cik: r.ci, t: r.t, n: r.n, filed: r.f, rows: [] });
    byAcc.get(r.a).rows.push(r);
  }
  const eligible = [...byAcc.values()].filter((f) => f.t && f.rows.some((r) => r.k === 'P' || r.k === 'S')).sort((a, b) => a.acc.localeCompare(b.acc));
  return draw(eligible, size, seeded(`${week}:form4`)).sort((a, b) => b.filed.localeCompare(a.filed) || a.acc.localeCompare(b.acc));
}

// Congress reports disclosed in the last `days` days, by filing.
//   rows: congress.json rows → [{ src, m, f, rows }]
export function pickReports(rows, { week, now, days = 30, size = TRADE_SAMPLE_SIZE } = {}) {
  const from = daysBefore(now, days);
  const bySrc = new Map();
  for (const r of rows) {
    if (!r.src || !r.f || r.f < from) continue;
    if (!bySrc.has(r.src)) bySrc.set(r.src, { src: r.src, m: r.m, f: r.f, rows: [] });
    bySrc.get(r.src).rows.push(r);
  }
  const eligible = [...bySrc.values()].sort((a, b) => a.src.localeCompare(b.src));
  return draw(eligible, size, seeded(`${week}:congress`)).sort((a, b) => b.f.localeCompare(a.f) || a.src.localeCompare(b.src));
}

const tag = (block, name) => {
  const m = block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i'));
  return m ? m[1] : '';
};
const valueOf = (block, name) => {
  const inner = tag(block, name);
  const v = tag(inner, 'value');
  return (v || inner).replace(/<[^>]*>/g, '').trim();
};

// The non-derivative lines of a Form 4, read from its XML on their own.
//   → [{ k, d, s, p, o }] (the shape compareAccession takes)
export function form4Lines(text) {
  const doc = tag(String(text || ''), 'ownershipDocument') || String(text || '');
  const table = tag(doc, 'nonDerivativeTable');
  const out = [];
  const re = /<nonDerivativeTransaction(?:\s[^>]*)?>([\s\S]*?)<\/nonDerivativeTransaction>/gi;
  let m;
  while ((m = re.exec(table))) {
    const b = m[1];
    out.push({
      k: valueOf(tag(b, 'transactionCoding'), 'transactionCode').toUpperCase(),
      d: normDate(valueOf(b, 'transactionDate')),
      s: num(valueOf(tag(b, 'transactionAmounts'), 'transactionShares')),
      p: num(valueOf(tag(b, 'transactionAmounts'), 'transactionPricePerShare')),
      o: num(valueOf(tag(b, 'postTransactionAmounts'), 'sharesOwnedFollowingTransaction')),
    });
  }
  return out;
}

export const form4Url = (cik, acc) => `https://www.sec.gov/Archives/edgar/data/${Number(String(cik).replace(/\D/g, ''))}/${String(acc).replace(/-/g, '')}/${acc}.txt`;
const indexUrl = (cik, acc) => `https://www.sec.gov/Archives/edgar/data/${Number(String(cik).replace(/\D/g, ''))}/${String(acc).replace(/-/g, '')}/`;
const cell = (s) => String(s ?? '').replace(/\|/g, '/');
const n0 = (v) => (v == null ? '—' : Number(v).toLocaleString('en-US', { maximumFractionDigits: 4 }));
const money = (lo, hi) => (hi ? `$${n0(lo)} – $${n0(hi)}` : `$${n0(lo)}+`);
const ISSUE = { 'not-found': 'bildirimde yok', price: 'fiyat farklı', owned: 'sonrası adet farklı' };

// form4s: [{ filing, check?, error? }]; reports: [{ src, m, f, rows }];
// members: congress.json members (name, slug)
export function tradeSampleIssue({ week, form4s, reports, members = {}, mention }) {
  const failed = form4s.filter((r) => r.error || r.check.status !== 'match');
  const lines = [
    `${mention ? `${mention} ` : ''}Bu haftanın işlem örneği: ${form4s.length} insider bildirimi (Form 4) ve ${reports.length} Kongre bildirimi.`,
    '',
    failed.length
      ? `**Otomatik ön kontrol: ${form4s.length - failed.length} Form 4 tam uyuştu, ${failed.length} tanesinde fark var** (❌ işaretli olanlara bakın).`
      : `**Otomatik ön kontrol: ${form4s.length} Form 4'ün hepsi bildirimin kendisiyle tam uyuştu.**`,
    '',
    'Yapmanız gereken: her bildirim için "Sitede aç" ve "Bildirim" linklerini açın, sitedeki satırlar bildirimdekiyle aynı mı bakın, aynıysa kutuyu işaretleyin. Hepsi bitince issue\'yu kapatın. Bir şey tutmuyorsa altına yorum yazın.',
    '',
    'Form 4\'lerde "Bildirimde" sütunu bildirimin XML\'inden, sitenin kullandığı koddan bağımsız okunur. Kongre bildirimleri PDF olduğu için otomatik karşılaştırma yok; gözle bakılır.',
    '',
    '## Insider (Form 4)',
    '',
  ];
  form4s.forEach((r, i) => {
    const f = r.filing;
    const bad = r.error || r.check.status !== 'match';
    lines.push(`### ${i + 1}. ${bad ? '❌' : '✅'} ${cell(f.t)} — ${cell(f.n)}`, '');
    lines.push(`[Sitede aç](${SITE}/stock/${encodeURIComponent(f.t)}) · [Bildirim](${indexUrl(f.cik, f.acc)}) · verildi ${f.filed}`, '');
    if (r.error) lines.push(`Bildirim okunamadı: ${cell(r.error)}. Elle bakın.`, '');
    else {
      lines.push('| Kod | Tarih | Sitede adet · fiyat · sonrası | Bildirimde adet · fiyat · sonrası | |', '|---|---|---|---|---|');
      for (const l of r.check.lines) lines.push(`| ${l.ours.k} | ${l.ours.d} | ${n0(l.ours.s)} · ${n0(l.ours.p)} · ${n0(l.ours.o)} | ${l.sec ? `${n0(l.sec.s)} · ${n0(l.sec.p)} · ${n0(l.sec.o)}` : '—'} | ${l.issue ? `❌ ${ISSUE[l.issue]}` : '✅'} |`);
      lines.push('');
    }
    lines.push(`- [ ] Siteyi ve bildirimi açtım, ${cell(f.t)} satırları uyuşuyor`, '');
  });
  lines.push('## Kongre', '');
  reports.forEach((r, i) => {
    const m = members[r.m] || {};
    lines.push(`### ${i + 1}. ${cell(m.n || r.m)} — ${r.f}`, '');
    lines.push(`${m.slug ? `[Sitede aç](${SITE}/congress/${m.slug}) · ` : ''}[Bildirim](${r.src}) · ${r.rows.length} işlem`, '');
    lines.push('| Varlık | Kod | İşlem | Kimin | Tutar | Tarih |', '|---|---|---|---|---|---|');
    for (const x of r.rows.slice(0, 25)) lines.push(`| ${cell(x.a).slice(0, 80)} | ${x.t || (x.tf ? `${x.tf} ⚠` : '—')} | ${x.k} | ${x.o || '—'} | ${money(x.lo, x.hi)} | ${x.d} |`);
    if (r.rows.length > 25) lines.push('', `… ve ${r.rows.length - 25} işlem daha (sitede tamamı).`);
    lines.push('', `- [ ] Siteyi ve bildirimi açtım, işlemler uyuşuyor`, '');
  });
  return { title: `Haftalık işlem örneği (insider ve Kongre) — ${week}`, body: lines.join('\n').slice(0, 60000), failed: failed.length };
}

export { compareAccession };
