// Comparison pages and the "best trackers" guide. Competitor cells are
// deliberately left as TODO — nothing about other products is asserted
// here until it has been verified by hand.
const TODO = 'TODO';
export const MATRIX_ROWS = ['coverage', 'history', 'insider', 'export', 'alerts', 'tr', 'price'];
export const MATRIX_LABEL = {
  tr: { coverage: 'Kapsam (13F dosyalayıcı)', history: 'Geçmiş derinliği', insider: 'Insider (Form 4) verisi', export: 'Dışa aktarma', alerts: 'Uyarılar', tr: 'Türkçe desteği', price: 'Fiyat' },
};
export const US = {
  tr: { coverage: 'Tüm ~7.800 13F-HR dosyalayıcı; 20 küratörlü usta yatırımcı', history: 'Küratörlü ustalar için 10 yıl (40 çeyrek); her kurum için 8 çeyrek', insider: 'Günlük Form 4 akışı, küme / C-suite / kuruş hisse sinyalleri, 10b5-1 bayrağı', export: 'CSV ve Excel (Pro)', alerts: 'İzleme listesinde "yeni bildirim" rozeti; e-posta uyarıları yol haritasında', tr: 'Tam Türkçe arayüz ve içerik', price: 'Ücretsiz plan; Pro 10 $/ay (Türkiye) veya 19,90 $/ay' },
};
const todoRow = () => Object.fromEntries(MATRIX_ROWS.map((r) => [r, TODO]));

export const COMPARE_CONTENT = {
  whalewisdom: {
    tr: { title: 'Fundocap vs WhaleWisdom', lead: 'Bu sayfa Fundocap ile WhaleWisdom\'ı kapsam, geçmiş derinliği, insider verisi, dışa aktarma, uyarılar, Türkçe desteği ve fiyat başlıklarında karşılaştırır. Fundocap sütunu sitenin kendi özelliklerinden doldurulmuştur; WhaleWisdom sütunu her hücre ürünün güncel sayfasıyla doğrulanana kadar TODO olarak bırakılmıştır, tahmin yürütülmez.', them: 'WhaleWisdom', matrix: todoRow(), faq: [['Hangisini kullanmalıyım?', 'Türkçe arayüz, 10 yıllık geçmişli küratörlü usta yatırımcı sayfaları ve ücretsiz günlük insider sinyal sayfası gerekiyorsa Fundocap bunları sunar. Diğer ürünün güçlü yanları için kendi belgelerine bakın; bu sayfa doğrulamadığımız özellikleri anlatmaz.']] },
  },
  dataroma: {
    tr: { title: 'Fundocap vs Dataroma', lead: 'Bu sayfa Fundocap ile Dataroma\'yı aynı yedi ölçütte karşılaştırır. Fundocap sütunu bu siteyi yansıtır; Dataroma sütunu güncel sitelerine karşı elle doğrulanana kadar TODO kalır.', them: 'Dataroma', matrix: todoRow(), faq: [['Karşılaştırma tamam mı?', 'Hayır. Rakip hücreleri her bilgi doğrulanana kadar bilinçli olarak boştur; yalnızca Fundocap sütunu bağlayıcıdır.']] },
  },
  '13radar': {
    tr: { title: 'Fundocap vs 13radar.com', lead: 'Bu sayfa Fundocap ile 13radar.com\'u kapsam, geçmiş, insider verisi, dışa aktarma, uyarılar, Türkçe desteği ve fiyat başlıklarında karşılaştırır. Yalnızca Fundocap sütunu doludur; 13radar.com sütunu doğrulanana kadar TODO\'dur.', them: '13radar.com', matrix: todoRow(), faq: [['Bunlar aynı ürün mü?', 'Hayır. Fundocap (bu site) ile 13radar.com birbirinden bağımsız, benzer isimli ürünlerdir.']] },
  },
};

export const BEST_TRACKERS = {
  tr: {
    title: 'En iyi 13F takip araçları karşılaştırması',
    lead: '13F takip araçları SEC bildirimlerini portföy sayfalarına, sıralamalara ve uyarılara dönüştürür. Aşağıdaki matris önemli ölçütleri (dosyalayıcı kapsamı, geçmiş derinliği, insider verisi, dışa aktarma, uyarılar, Türkçe desteği ve fiyat) listeler; Fundocap sütunu doludur, her rakip sütunu ürünün kendisiyle doğrulanana kadar TODO olarak bırakılmıştır.',
    columns: ['Fundocap', 'WhaleWisdom', 'Dataroma', '13radar.com'],
    faq: [['İyi bir 13F takip aracı neyi iyi yapmalı?', 'Yalnızca ünlü isimleri değil her dosyalayıcıyı kapsamalı, elde tutma süresi ve devir hızı ölçülebilsin diye çok yıllık geçmiş tutmalı, insider sinyalini gürültüden ayırmalı, temiz dışa aktarma sunmalı ve 45 günlük gecikmeyi her sayfada belirtmelidir.'], ['Rakip hücreleri neden boş?', 'Çünkü başka bir ürün hakkında doğrulanmadan hiçbir şey yazılmaz.']],
    links: [['Usta yatırımcı rehberi', '/gurus'], ['En çok alınanlar sıralaması', '/rankings/most-bought'], ['13F bildirim takvimi', '/calendar']],
  },
};
