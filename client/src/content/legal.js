// Privacy notice and terms of use, in plain Turkish — not
// contract prose. The operator is KOCERLER LTD (UK). The contact address
// comes from the build (CONTACT_EMAIL → __CONTACT_EMAIL__ in
// client/vite.config.js) with a placeholder until it is set.
export const CONTACT_EMAIL = typeof __CONTACT_EMAIL__ !== 'undefined' && __CONTACT_EMAIL__ ? __CONTACT_EMAIL__ : 'hello@fundocap.co';
export const OPERATOR = 'KOCERLER LTD';
export const LEGAL_UPDATED = '2026-09-22';

export const LEGAL_CONTENT = {
  privacy: {
    tr: {
      title: 'Gizlilik Bildirimi',
      lead: `Fundocap, ${OPERATOR} (Birleşik Krallık) tarafından işletilir. Bu sayfa hangi verileri neden topladığımızı, kimlerle paylaştığımızı ve haklarınızı sade bir dille anlatır.`,
      sections: [
        { h2: 'Hangi verileri topluyoruz?', p: [
          'Hesap açarsanız e-posta adresiniz ve (şifreyle giriş yapıyorsanız) şifrenizin karması. Google ile giriş yaparsanız Google’dan yalnız adınız, e-postanız ve profil resminizin adresi gelir; şifreniz bize ulaşmaz.',
          'Kullanım verisi: izleme listeniz, kaydettiğiniz bildirimler, plan bilginiz (ücretsiz / Pro) ve e-posta özeti tercihiniz. Bunlar sizin için tutulur; başka bir amaçla işlenmez.',
          'Pro aboneliği alırsanız ödeme kart bilgileriniz Stripe’ta kalır; biz yalnız Stripe müşteri ve abonelik numaralarını ve abonelik durumunu saklarız. Kart numaranızı hiç görmeyiz.',
          'Teknik veri: barındırma sağlayıcımızın (Vercel) standart sunucu günlükleri (IP adresi, tarayıcı, istenen sayfa, zaman) kısa süre tutulur. Ziyaretçinin ülkesi yalnız bölgesel fiyat ve dil seçimi için, anlık olarak kullanılır; saklanmaz.',
        ] },
        { h2: 'Çerezler ve tarayıcı depolaması', p: [
          'Reklam veya davranış izleme çerezi kullanmıyoruz. Yalnız işlevsel kayıtlar vardır: dil tercihi (çerez), tema ve izleme listenizin cihazdaki kopyası (tarayıcı depolaması) ve giriş yaptıysanız oturum anahtarınız. Üçüncü taraf analitik veya reklam ağı yüklenmez.',
        ] },
        { h2: 'Verileri kim işliyor?', p: [
          'Supabase (kimlik doğrulama ve veritabanı; AB/ABD bölgeleri), Stripe (ödeme), Vercel (barındırma ve içerik dağıtımı), Resend (opt-in e-posta özetleri) ve GitHub (günlük veri üretimi). Her biri kendi gizlilik politikası altında, yalnız hizmeti sağlamak için işler. Verilerinizi satmıyor, reklam amacıyla paylaşmıyoruz.',
        ] },
        { h2: 'Sitedeki veriler nereden geliyor?', p: [
          'Portföy ve insider verileri SEC EDGAR’daki kamuya açık bildirimlerden (13F, Form 4, 13D/G) otomatik derlenir. Fiyat verileri lisanslı sağlayıcılardan (Financial Modeling Prep, Twelve Data, Finnhub) ve gece üretimlerinde Yahoo Finance’ten; menkul kıymet kimlikleri OpenFIGI’den alınır. Bu veriler kişisel veri değildir; şirket içi işlemlerdeki kişi adları SEC’in yayımladığı kamu kayıtlarıdır.',
        ] },
        { h2: 'Ne kadar süre saklıyoruz?', p: [
          'Hesap verileri hesabınız açık kaldığı sürece. Hesabınızı silmek isterseniz yazın; hesap, izleme listesi ve bildirimler silinir, Stripe’taki fatura kayıtları yasal süre boyunca Stripe’ta kalır. Sunucu günlükleri sağlayıcının standart süresi (en fazla 30 gün) sonunda silinir.',
        ] },
        { h2: 'Haklarınız', p: [
          'Verilerinize erişme, düzeltme, silme, taşıma ve işlemeye itiraz etme hakkınız var (UK GDPR ve, Türkiye’deki kullanıcılar için, KVKK). Talebinizi aşağıdaki adrese yazın; 30 gün içinde yanıtlarız. Şikâyet için Birleşik Krallık’ta ICO’ya, Türkiye’de KVKK’ya başvurabilirsiniz.',
        ] },
        { h2: 'Değişiklikler', p: ['Bu bildirimi güncellediğimizde tarihini bu sayfada değiştiririz; önemli değişiklikleri hesabı olan kullanıcılara e-postayla bildiririz.'] },
      ],
    },
  },
  terms: {
    tr: {
      title: 'Kullanım Şartları',
      lead: `Fundocap’i (fundocap.co) kullanarak bu şartları kabul etmiş olursunuz. Siteyi ${OPERATOR} (Birleşik Krallık) işletir.`,
      sections: [
        { h2: 'Bu site ne yapar, ne yapmaz?', p: [
          'Fundocap, SEC’e verilen kamuya açık bildirimleri (13F, Form 4, 13D/G) ve fiyat verilerini derleyip okunur hale getirir. Sitedeki hiçbir içerik yatırım tavsiyesi, alım-satım önerisi ya da belirli bir menkul kıymete ilişkin öneri değildir. Kararlarınız size aittir.',
          '13F verisi çeyrek sonunu izleyen 45 güne kadar gecikmeli, yalnız uzun pozisyonları kapsayan ve düzeltilebilen bir kaynaktır; fiyatlar sağlayıcılardan geldiği gibi gösterilir. Veriyi olduğu gibi sunarız; doğruluğu, eksiksizliği veya güncelliği için garanti vermeyiz.',
        ] },
        { h2: 'Hesap', p: [
          'Ücretsiz hesap açabilirsiniz; e-posta adresiniz doğru ve size ait olmalıdır. Hesabınızı başkasıyla paylaşmayın. Hesabınızı istediğiniz zaman kapatabilirsiniz.',
        ] },
        { h2: 'Pro abonelik, iptal ve iade', p: [
          'Pro, aylık ya da yıllık yenilenen bir aboneliktir; ödemeler Stripe üzerinden alınır ve fiyat, ödeme sayfasında gösterilen para birimi ve tutardır. Abonelik, dönem sonunda otomatik yenilenir.',
          'İstediğiniz zaman iptal edebilirsiniz (Hesabım → Aboneliği yönet). İptal sonrası ödenmiş dönemin sonuna kadar Pro erişiminiz sürer; kalan süre için kısmi iade yapılmaz. Yanlışlıkla yapılan bir ödeme ya da teknik bir sorun için ödemeden itibaren 14 gün içinde yazın; makul taleplerde iade yaparız. Yasal tüketici haklarınız saklıdır.',
          'Fiyatları değiştirirsek mevcut aboneler için değişiklik bir sonraki yenileme döneminden önce e-postayla bildirilir.',
        ] },
        { h2: 'Kabul edilebilir kullanım', p: [
          'Siteyi kişisel ya da kurum içi araştırma için kullanabilirsiniz. Otomatik toplu indirme, veriyi yeniden satmak ya da yeniden yayımlamak, güvenlik önlemlerini aşmak ve diğer kullanıcıların erişimini bozmak yasaktır. Pro özelliklerinin dışa aktarmaları kendi kullanımınız içindir.',
        ] },
        { h2: 'Fikrî mülkiyet', p: [
          'SEC bildirimleri kamu malıdır. Sitenin tasarımı, yazılımı, hesaplamaları ve derlenmiş veri kümeleri Fundocap’e aittir. Rehberler ve sayfa metinleri kaynak gösterilerek alıntılanabilir.',
        ] },
        { h2: 'Sorumluluğun sınırı', p: [
          'Site “olduğu gibi” sunulur. Yasaların izin verdiği ölçüde, sitedeki verilere dayanarak aldığınız kararlardan doğan zararlardan sorumlu değiliz. Bu sınırlama, yasal olarak sınırlanamayan sorumlulukları kapsamaz.',
        ] },
        { h2: 'Değişiklikler ve hukuk', p: [
          'Şartları güncellediğimizde tarihini bu sayfada değiştiririz; önemli değişiklikleri hesabı olan kullanıcılara e-postayla bildiririz. Bu şartlar İngiltere ve Galler hukukuna tabidir; tüketicilerin kendi ülkesindeki zorunlu koruma hükümleri saklıdır.',
        ] },
      ],
    },
  },
};
