// The second source (scripts/sec-dataset-check.mjs, sec-dataset.yml): the
// SEC's own Form 13F data sets. Every quarter the SEC publishes every 13F
// it received in a three-month filing window as flat files (SUBMISSION,
// SUMMARYPAGE, INFOTABLE …, tab-separated), read by the SEC's systems and
// not by ours. Each filing the universe uses is put against that reading:
// the table's total (× the unit correction we applied), its position count,
// and the share count of the ten lines the site shows.
//
// Pure: no network, no files. The script streams the files.

export const DATASET_PAGE = 'https://www.sec.gov/data-research/sec-markets-data/form-13f-data-sets';
export const VALUE_TOLERANCE = 0.005;

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const isoOf = (d, mon, y) => `${y}-${String(MONTHS[mon.toLowerCase()]).padStart(2, '0')}-${d.padStart(2, '0')}`;

// The data set links on the SEC's page, newest window first.
//   → [{ url, name, from, to }]
export function pickDatasets(html, base = 'https://www.sec.gov') {
  const seen = new Map();
  const re = /href="([^"]*?(\d{1,2})([a-z]{3})(\d{4})-(\d{1,2})([a-z]{3})(\d{4})_form13f\.zip)"/gi;
  let m;
  while ((m = re.exec(String(html || '')))) {
    if (!MONTHS[m[3].toLowerCase()] || !MONTHS[m[6].toLowerCase()]) continue;
    const url = m[1].startsWith('http') ? m[1] : `${base}${m[1].startsWith('/') ? '' : '/'}${m[1]}`;
    const name = url.split('/').pop().replace(/\.zip$/i, '');
    seen.set(name, { url, name, from: isoOf(m[2], m[3], m[4]), to: isoOf(m[5], m[6], m[7]) });
  }
  return [...seen.values()].sort((a, b) => (a.to < b.to ? 1 : a.to > b.to ? -1 : 0));
}

// A TSV header row → { COLUMN: index }; the SEC's column names, upper case.
export function columns(headerLine) {
  const out = {};
  String(headerLine || '')
    .replace(/\r$/, '')
    .split('\t')
    .forEach((c, i) => {
      out[c.trim().toUpperCase()] = i;
    });
  return out;
}

const lineKey = (cusip, putCall) => `${String(cusip || '').trim().toUpperCase()}|${String(putCall || '').trim()}`;

// The running reading of one accession from INFOTABLE rows.
export function newReading() {
  return { rows: 0, value: 0, shares: 0, keys: new Map(), values: new Map() };
}
export function addRow(reading, { cusip, putCall, value, shares }) {
  const k = lineKey(cusip, putCall);
  reading.rows += 1;
  reading.value += Number(value) || 0;
  reading.shares += Number(shares) || 0;
  reading.keys.set(k, (reading.keys.get(k) || 0) + (Number(shares) || 0));
  reading.values.set(k, (reading.values.get(k) || 0) + (Number(value) || 0));
  return reading;
}

// One filing of ours against the SEC's reading of it.
//   ours: { aum, count, top: [{ cusip, putCall, shares }], unitFix? }
//   sec:  newReading() result, or undefined when the data set lacks it
export function compareFiling(ours, sec, { tolerance = VALUE_TOLERANCE } = {}) {
  if (!sec) return { status: 'missing' };
  const factor = Number(ours.unitFix?.factor) || 1;
  const secValue = sec.value * factor;
  const valueDiff = secValue > 0 ? ours.aum / secValue - 1 : null;
  const valueOk = valueDiff != null && Math.abs(valueDiff) <= tolerance;
  const countOk = ours.count === sec.keys.size;
  const lines = (ours.top || []).map((p) => {
    const s = sec.keys.get(lineKey(p.cusip, p.putCall));
    return { cusip: p.cusip, putCall: p.putCall || '', issuer: p.issuer, ours: p.shares, sec: s ?? null, ok: s != null && Math.abs(s - p.shares) <= 0.5 };
  });
  const linesOk = lines.every((l) => l.ok);
  // a filer that wrote the value and share columns the other way round
  // (CalSTRS 2026-Q2): the build swaps them back, the data set keeps them
  // as filed. Our total is then the SEC's share column and our share counts
  // its value column.
  if (!(valueOk && linesOk) && countOk && sec.shares > 0 && Math.abs(ours.aum / sec.shares - 1) <= tolerance) {
    const swapped = (ours.top || []).every((p) => Math.abs((sec.values.get(lineKey(p.cusip, p.putCall)) ?? NaN) - p.shares) <= 0.5);
    if (swapped) return { status: 'match', swapped: true, factor, secValue: sec.shares, valueDiff: ours.aum / sec.shares - 1, valueOk: true, count: { ours: ours.count, sec: sec.keys.size, ok: true }, lines: lines.map((l) => ({ ...l, ok: true })), linesOk: true, rows: sec.rows };
  }
  return { status: valueOk && countOk && linesOk ? 'match' : 'differs', factor, secValue, valueDiff, valueOk, count: { ours: ours.count, sec: sec.keys.size, ok: countOk }, lines, linesOk, rows: sec.rows };
}

const usd = (v) => (Math.abs(v) >= 1e9 ? `$${(v / 1e9).toFixed(2)} mlr` : `$${(v / 1e6).toFixed(1)} mn`);
const cell = (s) => String(s ?? '').replace(/\|/g, '/');
const pct = (x) => (x == null ? '—' : `${x > 0 ? '+' : ''}${(x * 100).toFixed(2)}%`);
const filingUrl = (cik, acc) => `https://www.sec.gov/Archives/edgar/data/${Number(String(cik).replace(/\D/g, ''))}/${String(acc).replace(/-/g, '')}/`;

// results: [{ fund: { cik, name, acc, aum }, check }]; skipped: { amended, missing }
export function datasetIssue({ dataset, results, skipped = {}, mention }) {
  const compared = results.filter((r) => r.check.status !== 'missing');
  const differs = compared.filter((r) => r.check.status === 'differs').sort((a, b) => b.fund.aum - a.fund.aum);
  const lines = [
    `${differs.length && mention ? `${mention} ` : ''}SEC'in kendi toplu 13F verisi (${dataset.name}, ${dataset.from} – ${dataset.to} arası verilen bildirimler) ile sitedeki veri karşılaştırıldı.`,
    '',
    differs.length
      ? `**${compared.length} bildirimden ${compared.length - differs.length} tanesi birebir tuttu, ${differs.length} tanesinde fark var.**`
      : `**${compared.length} bildirimin hepsi birebir tuttu.**`,
    '',
    `Karşılaştırılan: toplam değer (±%${VALUE_TOLERANCE * 100}, bizim birim düzeltmemiz uygulanarak), pozisyon sayısı, sitede gösterilen ilk 10 pozisyonun adetleri. Bu veriyi SEC kendi sistemiyle okuyor; bizim kodumuzdan tamamen bağımsız.`,
    '',
    ...(compared.some((r) => r.check.swapped) ? [`Değer ve adet sütunlarını ters yazan ${compared.filter((r) => r.check.swapped).length} fon tuttu sayıldı: SEC verisi bildirimi olduğu gibi tutuyor, biz sütunları düzeltip gösteriyoruz (${compared.filter((r) => r.check.swapped).map((r) => cell(r.fund.name)).join(', ')}).`, ''] : []),
    `Karşılaştırılmayan: düzeltme bildirimi olan ${skipped.amended || 0} fon (SEC verisinde her bildirim ayrı durur), bu veri setinde olmayan ${skipped.missing || 0} bildirim (başka bir dönemde verilmiş).`,
    '',
  ];
  if (differs.length) {
    lines.push('### Fark çıkanlar (büyükten küçüğe)', '', '| Fon | Bizim toplam | SEC verisi | Fark | Pozisyon (biz / SEC) | İlk 10 adet | Bildirim |', '|---|---|---|---|---|---|---|');
    for (const r of differs.slice(0, 200)) {
      const c = r.check;
      lines.push(`| ${cell(r.fund.name)} (${r.fund.cik}) | ${usd(r.fund.aum)} | ${usd(c.secValue)}${c.factor !== 1 ? ` (×${c.factor})` : ''} | ${c.valueOk ? '✅' : '❌'} ${pct(c.valueDiff)} | ${c.count.ok ? '✅' : '❌'} ${c.count.ours} / ${c.count.sec} | ${c.linesOk ? '✅' : `❌ ${c.lines.filter((l) => !l.ok).length} satır`} | [SEC](${filingUrl(r.fund.cik, r.fund.acc)}) |`);
    }
    if (differs.length > 200) lines.push('', `… ve ${differs.length - 200} fon daha (tam liste çalışmanın özet sayfasında).`);
    lines.push('');
  }
  return { title: `SEC toplu verisiyle karşılaştırma — ${dataset.name}`, body: lines.join('\n').slice(0, 60000), differs: differs.length, compared: compared.length };
}
