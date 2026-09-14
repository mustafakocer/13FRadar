// Comparison pages and the "best trackers" guide. Competitor cells are
// deliberately left as TODO — nothing about other products is asserted
// here until it has been verified by hand.
const TODO = 'TODO';
export const MATRIX_ROWS = ['coverage', 'history', 'insider', 'export', 'alerts', 'tr', 'price'];
export const MATRIX_LABEL = {
  en: { coverage: 'Coverage (13F filers)', history: 'History depth', insider: 'Insider (Form 4) data', export: 'Export', alerts: 'Alerts', tr: 'Turkish support', price: 'Price' },
  tr: { coverage: 'Kapsam (13F dosyalayıcı)', history: 'Geçmiş derinliği', insider: 'Insider (Form 4) verisi', export: 'Dışa aktarma', alerts: 'Uyarılar', tr: 'Türkçe desteği', price: 'Fiyat' },
};
export const US = {
  en: { coverage: 'All ~7,800 13F-HR filers; 20 curated gurus', history: '10 years (40 quarters) for curated gurus; 8 quarters for any filer', insider: 'Daily Form 4 feed, cluster / C-suite / penny signals, 10b5-1 flag', export: 'CSV and Excel (Pro)', alerts: 'Watchlist "new filing" badges; email alerts on the roadmap', tr: 'Full Turkish UI and content', price: 'Free tier; Pro from $10/month (Türkiye) or $19.90/month' },
  tr: { coverage: 'Tüm ~7.800 13F-HR dosyalayıcı; 20 küratörlü usta yatırımcı', history: 'Küratörlü ustalar için 10 yıl (40 çeyrek); her kurum için 8 çeyrek', insider: 'Günlük Form 4 akışı, küme / C-suite / kuruş hisse sinyalleri, 10b5-1 bayrağı', export: 'CSV ve Excel (Pro)', alerts: 'İzleme listesinde "yeni bildirim" rozeti; e-posta uyarıları yol haritasında', tr: 'Tam Türkçe arayüz ve içerik', price: 'Ücretsiz plan; Pro 10 $/ay (Türkiye) veya 19,90 $/ay' },
};
const todoRow = () => Object.fromEntries(MATRIX_ROWS.map((r) => [r, TODO]));

export const COMPARE_CONTENT = {
  whalewisdom: {
    en: { title: 'Fundocap vs WhaleWisdom', lead: 'This page compares Fundocap with WhaleWisdom on coverage, history depth, insider data, export, alerts, Turkish support and price. The Fundocap column is filled from this site\'s own features; the WhaleWisdom column is left as TODO until each cell has been checked against their current product page, so nothing here is guessed.', them: 'WhaleWisdom', matrix: todoRow(), faq: [['Which one should I use?', 'If you need a Turkish interface, curated guru pages with a 10-year history and a free daily insider signal page, Fundocap covers that. For the other product\'s strengths, see its own documentation; this page will not describe features we have not verified.']] },
    tr: { title: 'Fundocap vs WhaleWisdom', lead: 'Bu sayfa Fundocap ile WhaleWisdom\'ı kapsam, geçmiş derinliği, insider verisi, dışa aktarma, uyarılar, Türkçe desteği ve fiyat başlıklarında karşılaştırır. Fundocap sütunu sitenin kendi özelliklerinden doldurulmuştur; WhaleWisdom sütunu her hücre ürünün güncel sayfasıyla doğrulanana kadar TODO olarak bırakılmıştır, tahmin yürütülmez.', them: 'WhaleWisdom', matrix: todoRow(), faq: [['Hangisini kullanmalıyım?', 'Türkçe arayüz, 10 yıllık geçmişli küratörlü usta yatırımcı sayfaları ve ücretsiz günlük insider sinyal sayfası gerekiyorsa Fundocap bunları sunar. Diğer ürünün güçlü yanları için kendi belgelerine bakın; bu sayfa doğrulamadığımız özellikleri anlatmaz.']] },
  },
  dataroma: {
    en: { title: 'Fundocap vs Dataroma', lead: 'This page compares Fundocap with Dataroma across the same seven criteria. The Fundocap column reflects this site; the Dataroma column stays TODO until verified by hand against their current site.', them: 'Dataroma', matrix: todoRow(), faq: [['Is the comparison complete?', 'No. Competitor cells are intentionally empty until each fact is verified; only the Fundocap column is authoritative.']] },
    tr: { title: 'Fundocap vs Dataroma', lead: 'Bu sayfa Fundocap ile Dataroma\'yı aynı yedi ölçütte karşılaştırır. Fundocap sütunu bu siteyi yansıtır; Dataroma sütunu güncel sitelerine karşı elle doğrulanana kadar TODO kalır.', them: 'Dataroma', matrix: todoRow(), faq: [['Karşılaştırma tamam mı?', 'Hayır. Rakip hücreleri her bilgi doğrulanana kadar bilinçli olarak boştur; yalnızca Fundocap sütunu bağlayıcıdır.']] },
  },
  '13radar': {
    en: { title: 'Fundocap vs 13radar.com', lead: 'This page compares Fundocap with 13radar.com across coverage, history, insider data, export, alerts, Turkish support and price. Only the Fundocap column is filled; the 13radar.com column is TODO until verified.', them: '13radar.com', matrix: todoRow(), faq: [['Are these the same product?', 'No. Fundocap (this site) and 13radar.com are unrelated products with similar names.']] },
    tr: { title: 'Fundocap vs 13radar.com', lead: 'Bu sayfa Fundocap ile 13radar.com\'u kapsam, geçmiş, insider verisi, dışa aktarma, uyarılar, Türkçe desteği ve fiyat başlıklarında karşılaştırır. Yalnızca Fundocap sütunu doludur; 13radar.com sütunu doğrulanana kadar TODO\'dur.', them: '13radar.com', matrix: todoRow(), faq: [['Bunlar aynı ürün mü?', 'Hayır. Fundocap (bu site) ile 13radar.com birbirinden bağımsız, benzer isimli ürünlerdir.']] },
  },
};

export const BEST_TRACKERS = {
  en: {
    title: 'Best 13F trackers compared',
    lead: '13F trackers turn SEC filings into portfolio pages, rankings and alerts. The matrix below lists the criteria that matter — filer coverage, history depth, insider data, export, alerts, Turkish support and price — with Fundocap\'s own column filled in and every competitor column left as TODO until verified against the product itself.',
    columns: ['Fundocap', 'WhaleWisdom', 'Dataroma', '13radar.com'],
    faq: [['What should a 13F tracker do well?', 'Cover every filer (not just famous names), keep multi-year history so time held and turnover are measurable, separate insider signal from noise, export cleanly, and state the 45-day lag on every page.'], ['Why are competitor cells empty?', 'Because nothing about another product is stated here without checking it first.']],
    links: [['Superinvestor directory', '/gurus'], ['Most bought ranking', '/rankings/most-bought'], ['13F filing calendar', '/calendar']],
  },
  tr: {
    title: 'En iyi 13F takip araçları karşılaştırması',
    lead: '13F takip araçları SEC bildirimlerini portföy sayfalarına, sıralamalara ve uyarılara dönüştürür. Aşağıdaki matris önemli ölçütleri (dosyalayıcı kapsamı, geçmiş derinliği, insider verisi, dışa aktarma, uyarılar, Türkçe desteği ve fiyat) listeler; Fundocap sütunu doludur, her rakip sütunu ürünün kendisiyle doğrulanana kadar TODO olarak bırakılmıştır.',
    columns: ['Fundocap', 'WhaleWisdom', 'Dataroma', '13radar.com'],
    faq: [['İyi bir 13F takip aracı neyi iyi yapmalı?', 'Yalnızca ünlü isimleri değil her dosyalayıcıyı kapsamalı, elde tutma süresi ve devir hızı ölçülebilsin diye çok yıllık geçmiş tutmalı, insider sinyalini gürültüden ayırmalı, temiz dışa aktarma sunmalı ve 45 günlük gecikmeyi her sayfada belirtmelidir.'], ['Rakip hücreleri neden boş?', 'Çünkü başka bir ürün hakkında doğrulanmadan hiçbir şey yazılmaz.']],
    links: [['Usta yatırımcı rehberi', '/gurus'], ['En çok alınanlar sıralaması', '/rankings/most-bought'], ['13F bildirim takvimi', '/calendar']],
  },
};
