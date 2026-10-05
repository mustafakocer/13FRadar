// ---------------------------------------------------------------------------
// Bölüm açıklamaları — tek dosya, elle düzenlenebilir.
//
// Her anahtar sitedeki bir başlığın altındaki (ya da üzerine gelince çıkan)
// açıklama cümlesidir. Buradaki metni değiştirmek yeterlidir; kod değişikliği
// gerekmez. Anahtarlar i18n sözlüğüne aynen eklenir (client/src/i18n.jsx),
// aynı adlı bir anahtar varsa buradaki metin onu ezer.
//
// Not — iki kartın verisi şudur, cümleler ona göre eşlenmiştir:
//   "Portföy Payına Göre"  = bir ustanın portföyünde EN BÜYÜK paya ulaşan hisseler
//   "Yüksek Kanaat"        = tutan ustaların ORTALAMA portföy payı en yüksek hisseler
// ---------------------------------------------------------------------------

export const EXPLANATIONS = {
  tr: {
    // Ana sayfa · Usta Yatırımcı Konsensüsü kartları
    'explain.guru.mostOwned': 'En çok usta tarafından tutulan hisseler.',
    'explain.guru.byPct': 'Ustaların portföyünün en büyük payını verdiği hisseler.',
    'explain.guru.conviction': 'Bu hisseyi tutan ustaların, portföylerinin ortalama yüzde kaçını ona ayırdığı.',

    // Ana sayfa · Seçilmiş Insider Alımları sekmeleri
    'explain.ins.cluster': 'Aynı şirketten birden fazla yöneticinin kısa sürede alım yapması.',
    'explain.ins.csuite': 'CEO, CFO gibi üst düzey yöneticilerin kendi şirket hissesini alması.',

    // Insider sayfası girişi
    'explain.ins.intro': "Şirket yöneticileri kendi hisselerini alıp sattığında 2 iş günü içinde SEC'e bildirir. Burada o işlemleri her gün derli toplu görürsün.",

    // "Sahiplik artışı (ort.)" etiketinin açıklaması (üzerine gelince)
    'ins.cluster.ownTip': 'Yöneticinin elindeki hisse bu alımla ortalama % kaç arttı.',

    // Fon sayfası · "İlk 10 Hissenin Ağırlığı" açıklaması (üzerine gelince)
    'tips.top10': 'Portföyün yüzde kaçı en büyük 10 hissede. Yüksekse fon az sayıda hisseye odaklı.',

    // Fon sayfası · işlem sıklığı çok düşükken gösterilen cümle
    'manager.kpi.lowTurnover': 'Bu çeyrek az işlem yaptı',
  },
  en: {
    'explain.guru.mostOwned': 'The stocks held by the most gurus.',
    'explain.guru.byPct': "Stocks that take the largest single share of a guru's portfolio.",
    'explain.guru.conviction': 'Of the gurus holding this stock, the average share of their portfolios they commit to it.',

    'explain.ins.cluster': 'Several executives of the same company buying within a short window.',
    'explain.ins.csuite': "Top executives — CEO, CFO — buying their own company's stock.",

    'explain.ins.intro': 'Company insiders must report trades in their own stock to the SEC within 2 business days. Here you see those trades, organized daily.',

    'ins.cluster.ownTip': "How much this purchase grew the insider's own stake, on average (%).",

    'tips.top10': 'Percent of the portfolio in the 10 largest holdings. High means the fund is concentrated in few stocks.',

    'manager.kpi.lowTurnover': 'Few trades this quarter',
  },
};
