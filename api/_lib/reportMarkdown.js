import { fmtMoney } from '../../client/src/lib/format.js';

// Distribution copy of a quarterly report (reports/<id>.md, served by
// /api/report/:id?format=md). Rendered from the report JSON alone, so an
// existing report can be re-rendered without rebuilding its data.
const MOVE = { add: 'Artırdı', reduce: 'Azalttı' };

export function reportMarkdown(report, { site = '' } = {}) {
  const md = [];
  const money = (v) => fmtMoney(v);
  const sym = (r) => r.ticker || r.issuer;
  const managers = report.managers || [];
  md.push(`# Fundocap — ${report.year} Q${report.quarter} Usta Yatırımcı Raporu`);
  md.push('');
  if (report.answer?.tr) md.push(`> ${report.answer.tr}`, '');
  md.push(
    `${String(report.generatedAt || '').slice(0, 10)} tarihinde, takip edilen ${managers.length} fonun SEC 13F-HR bildirimlerinden üretildi (${managers.map((m) => m.name).join(', ')}). 13F verisi 45 güne kadar gecikmelidir, yalnız uzun pozisyonları ve ABD'de işlem gören menkul kıymetleri kapsar. Yatırım tavsiyesi değildir.`
  );
  const table = (title, rows, cols) => {
    md.push('', `## ${title}`, '', `| ${cols.map((c) => c[0]).join(' | ')} |`, `| ${cols.map(() => '---').join(' | ')} |`);
    for (const r of rows || []) md.push(`| ${cols.map((c) => c[1](r)).join(' | ')} |`);
  };
  table('Dolar bazında en çok net alınan 20 hisse', report.topBuysByValue, [['Hisse', sym], ['Şirket', (r) => r.issuer], ['Net alım', (r) => money(r.netValue)], ['Alıcı', (r) => r.buyers], ['Tutan', (r) => r.holderCount]]);
  table('Dolar bazında en çok net satılan 20 hisse', report.topSellsByValue, [['Hisse', sym], ['Şirket', (r) => r.issuer], ['Net satış', (r) => money(Math.abs(r.netValue))], ['Satıcı', (r) => r.sellers], ['Tutan', (r) => r.holderCount]]);
  table('Alan usta sayısına göre ilk 20', report.topBuysByCount, [['Hisse', sym], ['Alıcı', (r) => r.buyers], ['Net alım', (r) => money(r.netValue)]]);
  table('Satan usta sayısına göre ilk 20', report.topSellsByCount, [['Hisse', sym], ['Satıcı', (r) => r.sellers], ['Net satış', (r) => money(Math.abs(r.netValue))]]);
  if (report.newConsensus) {
    table('Yeni konsensüs pozisyonları (ilk kez ≥5 usta)', report.newConsensus, [['Hisse', sym], ['Şimdi tutan', (r) => r.holderCount], ['Önceki çeyrek', (r) => r.prevHolderCount]]);
  } else {
    md.push('', '## Yeni konsensüs pozisyonları', '', '_guru-history.json (çeyreklik geçmiş ön hesabı) gerektirir; rapor üretilirken mevcut değildi._');
  }
  table('En büyük çıkışlar', report.biggestExits, [['Yönetici', (r) => r.manager], ['Hisse', sym], ['Satılan değer', (r) => money(r.value)]]);
  md.push('', '## Sektör akışı', '', '_TODO: hisse → sektör kaynağı henüz bağlanmadı (bkz. issue #2)._');
  table('Dikkat çeken hamleler (adette en büyük % değişim)', report.notableMoves, [
    ['Yönetici', (r) => r.manager],
    ['Hamle', (r) => MOVE[r.kind] || r.kind],
    ['Hisse', sym],
    ['Değişim', (r) => `${r.change > 0 ? '+' : ''}${r.change.toFixed(1)}%`],
    ['Değer', (r) => money(r.value)],
  ]);
  md.push('', '---', `Kaynak: Fundocap${site ? ` · ${site}/tr/reports/${report.id}` : ''}`);
  return md.join('\n') + '\n';
}
