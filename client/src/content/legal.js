// Privacy notice and terms of use, in plain Turkish and English — not
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
    en: {
      title: 'Privacy Notice',
      lead: `Fundocap is operated by ${OPERATOR} (United Kingdom). This page says, in plain words, what data we collect and why, who processes it, and what your rights are.`,
      sections: [
        { h2: 'What we collect', p: [
          'If you create an account: your email address and, for password sign-in, a hash of your password. If you sign in with Google, we receive only your name, email and profile picture URL from Google; your password never reaches us.',
          'Usage data: your watchlist, the alerts you save, your plan (free / Pro) and your email digest preference. These are kept for you and not processed for any other purpose.',
          'If you subscribe to Pro, your card details stay with Stripe; we store only the Stripe customer and subscription ids and the subscription status. We never see your card number.',
          'Technical data: our hosting provider (Vercel) keeps standard server logs (IP address, browser, requested page, time) for a short period. A visitor’s country is used momentarily for regional pricing and language, and is not stored.',
        ] },
        { h2: 'Cookies and browser storage', p: [
          'We use no advertising or behavioural tracking cookies. Only functional records exist: your language preference (a cookie), your theme and a copy of your watchlist on the device (browser storage), and, when signed in, your session key. No third-party analytics or ad network is loaded.',
        ] },
        { h2: 'Who processes the data', p: [
          'Supabase (authentication and database; EU/US regions), Stripe (payments), Vercel (hosting and content delivery), Resend (opt-in email digests) and GitHub (the nightly data builds). Each processes data only to provide its service, under its own privacy policy. We do not sell your data or share it for advertising.',
        ] },
        { h2: 'Where the site’s data comes from', p: [
          'Portfolio and insider data is compiled automatically from public filings on SEC EDGAR (13F, Form 4, 13D/G). Prices come from licensed providers (Financial Modeling Prep, Twelve Data, Finnhub) and, in the nightly builds, Yahoo Finance; security identifiers from OpenFIGI. This is not personal data; the names in insider transactions are public records published by the SEC.',
        ] },
        { h2: 'How long we keep it', p: [
          'Account data for as long as your account exists. Write to us to delete your account: the account, watchlist and alerts are removed; invoice records stay with Stripe for the statutory period. Server logs are deleted after the provider’s standard retention (30 days at most).',
        ] },
        { h2: 'Your rights', p: [
          'You can access, correct, delete and port your data and object to its processing (UK GDPR; KVKK for users in Türkiye). Write to the address below; we answer within 30 days. You may complain to the ICO in the United Kingdom or to KVKK in Türkiye.',
        ] },
        { h2: 'Changes', p: ['When we update this notice we change the date on this page; material changes are emailed to account holders.'] },
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
    en: {
      title: 'Terms of Use',
      lead: `By using Fundocap (fundocap.co) you accept these terms. The site is operated by ${OPERATOR} (United Kingdom).`,
      sections: [
        { h2: 'What this site does and does not do', p: [
          'Fundocap compiles public filings made to the SEC (13F, Form 4, 13D/G) and price data into a readable form. Nothing on the site is investment advice, a recommendation to buy or sell, or a recommendation about any particular security. Your decisions are your own.',
          '13F data is delayed by up to 45 days after quarter end, covers long positions only and can be amended; prices are shown as the providers deliver them. We present the data as it is and do not warrant its accuracy, completeness or timeliness.',
        ] },
        { h2: 'Accounts', p: ['You may create a free account; the email address must be real and yours. Do not share your account. You can close it at any time.'] },
        { h2: 'Pro subscription, cancellation and refunds', p: [
          'Pro is a monthly or yearly renewing subscription; payments are taken through Stripe at the currency and amount shown on the checkout page. The subscription renews automatically at the end of each period.',
          'You can cancel at any time (Account → Manage subscription). After cancelling, Pro access continues until the end of the paid period; no partial refund is made for the remainder. For a payment made by mistake or a technical fault, write to us within 14 days of the payment; reasonable requests are refunded. Your statutory consumer rights are not affected.',
          'If we change prices, existing subscribers are told by email before the next renewal.',
        ] },
        { h2: 'Acceptable use', p: [
          'You may use the site for personal or internal research. Automated bulk downloading, reselling or republishing the data, circumventing security measures and disrupting other users’ access are not allowed. Pro exports are for your own use.',
        ] },
        { h2: 'Intellectual property', p: ['SEC filings are public domain. The site’s design, software, calculations and compiled datasets belong to Fundocap. Guides and page text may be quoted with attribution.'] },
        { h2: 'Limitation of liability', p: [
          'The site is provided “as is”. To the extent the law allows, we are not liable for losses arising from decisions taken on the basis of the site’s data. This does not limit liability that cannot be limited by law.',
        ] },
        { h2: 'Changes and governing law', p: [
          'When we update these terms we change the date on this page; material changes are emailed to account holders. These terms are governed by the law of England and Wales; mandatory consumer protections of your own country are not affected.',
        ] },
      ],
    },
  },
};
