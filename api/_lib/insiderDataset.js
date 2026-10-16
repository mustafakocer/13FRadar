// The second source for insider trades (scripts/insider-dataset-check.mjs,
// sec-dataset.yml): the SEC's own "Insider Transactions Data Sets". Every
// quarter the SEC publishes every Form 3/4/5 filed in it as flat files
// (SUBMISSION, NONDERIV_TRANS …, tab-separated), read by the SEC's systems
// and not by ours. Each Form 4 the site holds for that quarter is put
// against that reading, line by line: the code, the trade day, the shares,
// the price and the shares owned after. And the other way: a purchase or
// sale in the SEC's reading that the site does not hold at all.
//
// Pure: no network, no files. The script streams the files.
import { normDate, num } from './insiderForm4.js';

export const INSIDER_DATASET_PAGE = 'https://www.sec.gov/data-research/sec-markets-data/insider-transactions-data-sets';
export const INSIDER_ZIP_BASE = 'https://www.sec.gov/files/structureddata/data/insider-transactions-data-sets';
// the price is stored to 4 decimals, the SEC's flat file to 2 (0.0231 → 0.02,
// 0.0004 → 0): a gap within half a cent is the file's rounding; past that,
// a filer's own rounding stays inside half a percent
export const PRICE_TOLERANCE = 0.005;
export const CENT_ROUNDING = 0.005;

const quarterRange = (y, q) => {
  const m = (q - 1) * 3 + 1;
  const end = { 1: '03-31', 2: '06-30', 3: '09-30', 4: '12-31' }[q];
  return { from: `${y}-${String(m).padStart(2, '0')}-01`, to: `${y}-${end}` };
};
export const datasetOf = (y, q) => ({ url: `${INSIDER_ZIP_BASE}/${y}q${q}_form345.zip`, name: `${y}q${q}_form345`, ...quarterRange(y, q) });

// The data set links on the SEC's page, newest first.
//   → [{ url, name, from, to }] (from/to: the filing days it covers)
export function pickInsiderDatasets(html, base = 'https://www.sec.gov') {
  const seen = new Map();
  const re = /href="([^"]*?(\d{4})q([1-4])_form345\.zip)"/gi;
  let m;
  while ((m = re.exec(String(html || '')))) {
    const url = m[1].startsWith('http') ? m[1] : `${base}${m[1].startsWith('/') ? '' : '/'}${m[1]}`;
    const d = { ...datasetOf(Number(m[2]), Number(m[3])), url };
    seen.set(d.name, d);
  }
  return [...seen.values()].sort((a, b) => (a.to < b.to ? 1 : a.to > b.to ? -1 : 0));
}

// One NONDERIV_TRANS row, as the comparison needs it.
export const secLine = (f, col) => ({
  k: String(f[col.TRANS_CODE] ?? '').trim().toUpperCase(),
  d: normDate(f[col.TRANS_DATE]),
  s: num(f[col.TRANS_SHARES]),
  p: num(f[col.TRANS_PRICEPERSHARE]),
  o: col.SHRS_OWND_FOLWNG_TRANS != null ? num(f[col.SHRS_OWND_FOLWNG_TRANS]) : null,
});

const near = (a, b, tol) => Math.abs(a - b) <= tol;
const samePrice = (ours, sec) => {
  const a = Number(ours) || 0;
  const b = Number(sec) || 0;
  if (!a && !b) return true;
  return near(a, b, Math.max(CENT_ROUNDING + 1e-9, Math.abs(b) * PRICE_TOLERANCE));
};
// the site stores whole shares, the SEC the figure as filed (6529.5)
const sameOwned = (ours, sec) => (ours == null || sec == null ? ours == null && sec == null : Math.abs(ours - sec) < 1);

// The site's rows of one filing against the SEC's lines of it. A row is
// paired with an unused line of the same code, day and shares (one that
// also agrees on the price and shares after, if there is one); the pair is
// then judged on price and shares owned after.
//   ours: [{ k, d, s, p, o, li }]; sec: [secLine()] | undefined
//   → { status: 'missing' | 'match' | 'differs', lines: [{ ours, sec, issue }] }
//   issue: null | 'not-found' | 'price' | 'owned'
export function compareAccession(ours, sec) {
  if (!sec) return { status: 'missing', lines: [] };
  const used = new Set();
  const lines = ours.map((r) => {
    const fits = (l, j) => !used.has(j) && l.k === r.k && l.d === r.d && l.s != null && Math.abs(l.s - r.s) < 1;
    // two lots alike but for the price: the one that agrees in full first
    let i = sec.findIndex((l, j) => fits(l, j) && samePrice(r.p, l.p) && sameOwned(r.o, l.o));
    if (i === -1) i = sec.findIndex(fits);
    if (i === -1) return { ours: r, sec: null, issue: 'not-found' };
    used.add(i);
    const l = sec[i];
    const issue = !samePrice(r.p, l.p) ? 'price' : !sameOwned(r.o, l.o) ? 'owned' : null;
    return { ours: r, sec: l, issue };
  });
  return { status: lines.some((l) => l.issue) ? 'differs' : 'match', lines };
}

const cell = (s) => String(s ?? '').replace(/\|/g, '/');
const filingUrl = (cik, acc) => `https://www.sec.gov/Archives/edgar/data/${Number(String(cik).replace(/\D/g, ''))}/${String(acc).replace(/-/g, '')}/`;
const fmt = (n) => (n == null ? '—' : Number(n).toLocaleString('en-US', { maximumFractionDigits: 4 }));
const ISSUE = { 'not-found': 'SEC verisinde aynı kod/tarih/adetle satır yok', price: 'fiyat farklı', owned: 'işlem sonrası adet farklı' };

// results: [{ acc, cik, t, n, check }]; absent: [{ acc, cik, t, k, d, s, p, filed }]
// (purchases and sales in the SEC's reading the site does not hold)
export function insiderDatasetIssue({ dataset, results, absent = [], skipped = {}, mention }) {
  const compared = results.filter((r) => r.check.status !== 'missing');
  const differs = compared.filter((r) => r.check.status === 'differs');
  const lineCount = compared.reduce((s, r) => s + r.check.lines.length, 0);
  const badLines = differs.flatMap((r) => r.check.lines.filter((l) => l.issue).map((l) => ({ r, l })));
  const bad = differs.length || absent.length;
  const lines = [
    `${bad && mention ? `${mention} ` : ''}SEC'in kendi toplu insider verisi (${dataset.name}, ${dataset.from} – ${dataset.to} arası verilen Form 3/4/5 bildirimleri) ile sitedeki veri karşılaştırıldı.`,
    '',
    differs.length
      ? `**${compared.length} bildirimin (${lineCount} işlem satırı) ${compared.length - differs.length} tanesi birebir tuttu; ${differs.length} bildirimde ${badLines.length} satır farklı.**`
      : `**${compared.length} bildirimin (${lineCount} işlem satırı) hepsi birebir tuttu.**`,
    '',
    absent.length ? `**SEC verisinde olup sitede hiç olmayan alım/satım: ${absent.length} satır** (${new Set(absent.map((a) => a.acc)).size} bildirim).` : '**SEC verisindeki alım/satımların hepsi sitede var.**',
    '',
    'Karşılaştırılan: işlem kodu, işlem tarihi, adet, fiyat (SEC dosyası fiyatı kuruşa yuvarladığı için yarım sent ya da %0,5 içi aynı sayılır) ve işlem sonrası elde kalan adet. Bu veriyi SEC kendi sistemiyle okuyor; bizim kodumuzdan tamamen bağımsız.',
    '',
    `Karşılaştırılmayan: bu veri setinde olmayan ${skipped.missing || 0} bildirimimiz (başka bir çeyrekte verilmiş ya da SEC henüz eklememiş).`,
    '',
  ];
  if (badLines.length) {
    lines.push('### Farklı satırlar', '', '| Şirket | Kişi | Kod / tarih | Bizim adet · fiyat · sonrası | SEC adet · fiyat · sonrası | Sorun | Bildirim |', '|---|---|---|---|---|---|---|');
    for (const { r, l } of badLines.slice(0, 150)) {
      const o = l.ours;
      const s = l.sec;
      lines.push(`| ${cell(r.t || r.cik)} | ${cell(r.n)} | ${o.k} ${o.d} | ${fmt(o.s)} · ${fmt(o.p)} · ${fmt(o.o)} | ${s ? `${fmt(s.s)} · ${fmt(s.p)} · ${fmt(s.o)}` : '—'} | ${ISSUE[l.issue]} | [SEC](${filingUrl(r.cik, r.acc)}) |`);
    }
    if (badLines.length > 150) lines.push('', `… ve ${badLines.length - 150} satır daha (tam liste çalışmanın özet sayfasında).`);
    lines.push('');
  }
  if (absent.length) {
    lines.push('### Sitede olmayan alım/satımlar', '', '| Şirket | Kod / tarih | Adet · fiyat | Verildiği gün | Bildirim |', '|---|---|---|---|---|');
    for (const a of absent.slice(0, 100)) lines.push(`| ${cell(a.t || a.cik)} | ${a.k} ${a.d} | ${fmt(a.s)} · ${fmt(a.p)} | ${a.filed} | [SEC](${filingUrl(a.cik, a.acc)}) |`);
    if (absent.length > 100) lines.push('', `… ve ${absent.length - 100} satır daha.`);
    lines.push('');
  }
  return { title: `SEC toplu insider verisiyle karşılaştırma — ${dataset.name}`, body: lines.join('\n').slice(0, 60000), differs: differs.length, badLines: badLines.length, absent: absent.length, compared: compared.length, lineCount };
}
