// The weekly sample check (scripts/weekly-sample.mjs, weekly-sample.yml).
//
// Ten funds a week, picked by the ISO week so a re-run picks the same ten:
// four of the gurus (the funds the site features), six of the other filers
// above $100M. For each, the lines
// the site shows (api/_data/latest-holdings.json, the ten largest) are put
// next to the same lines read straight from the SEC information table with
// a parser of its own (rawLines — not parse13F/aggregatePositions, so a bug
// there cannot hide itself). Share counts are compared: they carry no unit,
// so a value-unit correction does not show up as a difference. A human then
// opens each fund on the site and ticks its box in the issue.
//
// Pure: no network, no files. The script does the reading.

export const SAMPLE_SIZE = 10;
export const SAMPLE_TOP_PICKS = 4;
export const SAMPLE_MIN_AUM = 100e6;
export const SITE = 'https://www.fundocap.co';

// ISO 8601 week of a date, e.g. '2026-W42'.
export function isoWeek(date = new Date()) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const y = d.getUTCFullYear();
  const week = Math.ceil(((d - Date.UTC(y, 0, 1)) / 864e5 + 1) / 7);
  return `${y}-W${String(week).padStart(2, '0')}`;
}

// A small seeded generator (mulberry32 over a string hash): the same week,
// the same funds.
export function seeded(seed) {
  let h = 1779033703 ^ String(seed).length;
  for (const ch of String(seed)) {
    h = Math.imul(h ^ ch.charCodeAt(0), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function draw(list, n, rand) {
  const pool = [...list];
  const out = [];
  while (out.length < n && pool.length) out.push(pool.splice(Math.floor(rand() * pool.length), 1)[0]);
  return out;
}

// funds: [{ cik, name, aum, reportDate, amended, misfiled, slug, kind }]
// Only the current quarter; a fund with an amendment is left out (its raw
// original is not what the site shows, and the nightly check covers it).
export function pickSample(funds, { week, quarter, size = SAMPLE_SIZE, topPicks = SAMPLE_TOP_PICKS, minAum = SAMPLE_MIN_AUM } = {}) {
  const rand = seeded(week);
  const eligible = funds
    .filter((f) => f.aum > 0 && !f.misfiled && !f.amended && f.slug && (!quarter || f.reportDate >= quarter))
    .sort((a, b) => b.aum - a.aum || String(a.cik).localeCompare(String(b.cik)));
  const big = eligible.filter((f) => f.kind === 'guru');
  const rest = eligible.filter((f) => f.kind !== 'guru' && f.aum >= minAum);
  const picked = [...draw(big, topPicks, rand), ...draw(rest, size - topPicks, rand)];
  // fewer other filers than asked: fill from the gurus
  if (picked.length < size) picked.push(...draw(big.filter((f) => !picked.includes(f)), size - picked.length, rand));
  return picked.sort((a, b) => b.aum - a.aum);
}

const tag = (block, name) => {
  const m = block.match(new RegExp(`<(?:[\\w-]+:)?${name}>\\s*([^<]*?)\\s*</(?:[\\w-]+:)?${name}>`, 'i'));
  return m ? m[1] : '';
};

// The information table read on its own: every <infoTable>, summed by
// CUSIP and put/call the way a 13F book is keyed.
//   → Map('CUSIP|Put' → { cusip, putCall, issuer, shares, lines })
export function rawLines(xml) {
  const out = new Map();
  const re = /<(?:[\w-]+:)?infoTable>([\s\S]*?)<\/(?:[\w-]+:)?infoTable>/gi;
  let m;
  while ((m = re.exec(String(xml || '')))) {
    const b = m[1];
    const cusip = tag(b, 'cusip').toUpperCase();
    const putCall = tag(b, 'putCall');
    const key = `${cusip}|${putCall}`;
    const cur = out.get(key) || { cusip, putCall, issuer: tag(b, 'nameOfIssuer'), shares: 0, value: 0, lines: 0 };
    cur.shares += Number(tag(b, 'sshPrnamt').replace(/,/g, '')) || 0;
    cur.value += Number(tag(b, 'value').replace(/,/g, '')) || 0;
    cur.lines += 1;
    out.set(key, cur);
  }
  return out;
}

// Our lines against the raw ones. A share count within half a share is the
// same (fractional shares are rounded by some filers, not by others).
export function compareSample(ours, raw) {
  const lines = (ours.top || []).map((p) => {
    const r = raw.get(`${String(p.cusip || '').toUpperCase()}|${p.putCall || ''}`);
    const sec = r ? r.shares : null;
    return { cusip: p.cusip, putCall: p.putCall || '', issuer: p.issuer, value: p.value, ours: p.shares, sec, ok: sec != null && Math.abs(sec - p.shares) <= 0.5 };
  });
  const countOk = ours.count === raw.size;
  // a filer that wrote the value and share columns the other way round
  // (CalSTRS 2026-Q2): the build swaps them back, so our share counts are
  // the table's value column
  if (countOk && lines.length && !lines.every((l) => l.ok)) {
    const swapped = (ours.top || []).every((p) => {
      const r = raw.get(`${String(p.cusip || '').toUpperCase()}|${p.putCall || ''}`);
      return r && Math.abs(r.value - p.shares) <= 0.5;
    });
    if (swapped) return { lines: lines.map((l) => ({ ...l, ok: true })), count: { ours: ours.count, sec: raw.size, ok: true }, ok: true, swapped: true };
  }
  return { lines, count: { ours: ours.count, sec: raw.size, ok: countOk }, ok: lines.length > 0 && lines.every((l) => l.ok) && countOk };
}

const n0 = (v) => (v == null ? '—' : Math.round(v).toLocaleString('en-US'));
const usd = (v) => (v >= 1e9 ? `$${(v / 1e9).toFixed(2)} mlr` : `$${(v / 1e6).toFixed(1)} mn`);
const cell = (s) => String(s ?? '').replace(/\|/g, '/');
export const fundUrl = (f) => `${SITE}/${f.kind === 'guru' ? 'guru' : 'filer'}/${f.slug}`;
export const filingIndexUrl = (cik, acc) => `https://www.sec.gov/Archives/edgar/data/${Number(String(cik).replace(/\D/g, ''))}/${String(acc).replace(/-/g, '')}/`;

// results: [{ fund, check } | { fund, error }]
// The whole-universe pass of the same check (every current fund without an
// amendment), the funds that differ listed largest first.
//   scan: { checked, unreadable, skipped, differs: [{ fund, check }] }
export const SCAN_LIST_MAX = 150;
export function scanSection(scan) {
  if (!scan) return [];
  const differs = [...scan.differs].sort((a, b) => b.fund.aum - a.fund.aum);
  const lines = [
    '## Tüm fon taraması',
    '',
    differs.length
      ? `**${scan.checked} fon tarandı: ${scan.checked - differs.length} tanesi SEC ile birebir tuttu, ${differs.length} tanesinde fark var.**`
      : `**${scan.checked} fon tarandı: hepsi SEC ile birebir tuttu.**`,
    '',
    `Her fonun sitede gösterilen ilk 10 pozisyonunun adedi ve pozisyon sayısı, SEC bildiriminin kendisiyle karşılaştırıldı (yukarıdaki örnek kontrolle aynı yöntem). Taranmayan: düzeltme bildirimi olan ya da başka bir dönemin bildirimini kullanan ${scan.skipped || 0} fon; SEC'ten okunamayan ${scan.unreadable || 0} bildirim (bir sonraki hafta yeniden denenir).`,
    '',
  ];
  if (differs.length) {
    lines.push('| Fon | Toplam | Pozisyon (site / SEC) | İlk 10 adet | Bildirim |', '|---|---|---|---|---|');
    for (const r of differs.slice(0, SCAN_LIST_MAX)) {
      const c = r.check;
      lines.push(`| ${cell(r.fund.name)} (${r.fund.cik}) | ${usd(r.fund.aum)} | ${c.count.ok ? '✅' : '❌'} ${c.count.ours} / ${c.count.sec} | ${c.lines.every((l) => l.ok) ? '✅' : `❌ ${c.lines.filter((l) => !l.ok).length} satır`} | [SEC](${filingIndexUrl(r.fund.cik, r.fund.acc)}) |`);
    }
    if (differs.length > SCAN_LIST_MAX) lines.push('', `… ve ${differs.length - SCAN_LIST_MAX} fon daha (tam liste çalışmanın özet sayfasında).`);
    lines.push('');
  }
  return lines;
}

export function sampleIssue({ week, results, mention, scan = null }) {
  const failed = results.filter((r) => r.error || !r.check.ok);
  const lines = [
    `${mention ? `${mention} ` : ''}Bu haftanın örnek kontrolü: ${results.length} fon.${scan ? ` Ayrıca ${scan.checked} fonun tamamı otomatik tarandı: ${scan.differs.length ? `**${scan.differs.length} fonda fark var** (en altta).` : 'hepsi tuttu.'}` : ''}`,
    '',
    failed.length
      ? `**Otomatik ön kontrol: ${results.length - failed.length} fon tam uyuştu, ${failed.length} fonda fark var** (❌ işaretli satırlara bakın).`
      : `**Otomatik ön kontrol: ${results.length} fonun hepsi SEC ile tam uyuştu.**`,
    '',
    'Yapmanız gereken: her fon için "Sitede aç" linkine tıklayın, sitedeki ilk 10 pozisyonun adetleri aşağıdaki tabloyla ve SEC bildirimiyle aynı mı bakın, aynıysa kutuyu işaretleyin. Hepsi bitince issue\'yu kapatın. Bir şey tutmuyorsa altına yorum yazın.',
    '',
    'Adetler karşılaştırılır (birim içermez). "SEC\'te adet" bildirimin kendisinden, sitenin kullandığı koddan bağımsız okunur.',
    '',
  ];
  results.forEach((r, i) => {
    const f = r.fund;
    lines.push(`### ${i + 1}. ${r.error || !r.check.ok ? '❌' : '✅'} ${cell(f.name)} — ${usd(f.aum)}`, '');
    lines.push(`[Sitede aç](${fundUrl(f)}) · [SEC bildirimi](${filingIndexUrl(f.cik, f.acc)}) · dönem ${f.reportDate} · CIK ${f.cik}`, '');
    if (r.error) {
      lines.push(`SEC bildirimi okunamadı: ${cell(r.error)}. Elle bakın.`, '');
    } else {
      const c = r.check;
      lines.push(`Pozisyon sayısı: sitede ${c.count.ours}, SEC'te ${c.count.sec} ${c.count.ok ? '✅' : '❌'}`, '');
      lines.push('| Hisse | Değer (sitede) | Sitede adet | SEC\'te adet | |', '|---|---|---|---|---|');
      for (const l of c.lines) lines.push(`| ${cell(l.issuer)}${l.putCall ? ` (${l.putCall})` : ''} | ${usd(l.value)} | ${n0(l.ours)} | ${n0(l.sec)} | ${l.ok ? '✅' : '❌'} |`);
      lines.push('');
    }
    lines.push(`- [ ] Siteyi açtım, ${cell(f.name)} SEC ile uyuşuyor`, '');
  });
  lines.push(...scanSection(scan));
  return { title: `Haftalık örnek kontrol — ${week}`, body: lines.join('\n').slice(0, 60000), failed: failed.length, scanDiffers: scan ? scan.differs.length : 0 };
}
