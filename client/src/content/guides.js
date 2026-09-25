// Evergreen guides, answer-first, H2s phrased as questions. Each entry
// carries Turkish copy and three entity links so every guide feeds the
// entity graph.
export const GUIDE_CONTENT = {
  'what-is-13f': {
    tr: {
      title: '13F bildirimi nedir?',
      lead: 'Form 13F, en az 100 milyon dolarlık ABD menkul kıymeti yöneten her kurumsal yatırımcının, çeyrek sonunu izleyen 45 gün içinde SEC\'e vermek zorunda olduğu üç aylık rapordur. Yöneticinin çeyrek sonu tarihindeki ABD borsalarında işlem gören hisse, ETF ve bazı opsiyon pozisyonlarını adet ve piyasa değeriyle listeler. "Warren Buffett ne aldı?" başlıklı her haberin kaynağı bu bildirimdir.',
      sections: [
        { h2: 'Kimler 13F bildirimi yapmak zorunda?', p: ['100 milyon dolar ve üzeri "13(f) menkul kıymeti" (ağırlıklı olarak ABD borsalarındaki hisseler, ETF\'ler, dönüştürülebilir tahviller ve hisse opsiyonları) üzerinde yatırım kararı yetkisi olan her kurum. Hedge fonlar, yatırım fonu şirketleri, emeklilik fonları, bankalar, sigorta şirketleri ve aile ofisleri eşiği aştıklarında kapsama girer. Her çeyrek yaklaşık 8.000 kurum bildirim yapar.', 'Bireyler, ABD dışı varlıklar ve eşiğin altındaki yöneticiler bildirim yapmaz; bazı ünlü yatırımcıların 13F verisinde hiç görünmemesinin nedeni budur.'] },
        { h2: '13F neyi gösterir?', p: ['Her bildirim, takvim çeyreğinin son günü itibarıyla bir pozisyon tablosudur: ihraççı adı, menkul kıymet sınıfı, CUSIP kodu, piyasa değeri, adet ve pozisyonun put/call opsiyonu olup olmadığı. Fundocap bu satırları yönetici bazında toplar, portföy ağırlıklarını hesaplar ve önceki çeyrekle karşılaştırarak yeni alımları, artırmaları, azaltmaları ve çıkışları türetir.', 'Bildirimde alış fiyatları, çeyrek içindeki işlem tarihleri veya yöneticinin gerekçesi yer almaz.'] },
        { h2: '13F bildirimleri ne zaman yapılır?', p: ['Her çeyrek sonunu izleyen 45 gün içinde: yaklaşık 15 Mayıs, 14 Ağustos, 14 Kasım ve 14 Şubat. Büyük yöneticilerin çoğu sürenin son günlerinde bildirir; bu yüzden bilgi yayımlandığında en az altı haftalıktır. Bildirim takvimi sayfası bir sonraki son tarihi ve hangi usta yatırımcıların bildirim yaptığını izler.'] },
        { h2: '13F\'te ne yoktur?', p: ['Açığa satış pozisyonları, çoğu türev ürün, tahviller, nakit, özel yatırımlar ve ABD dışı menkul kıymetler kapsam dışıdır. Swap yoluyla net açığa pozisyonda olan bir yönetici 13F\'te hâlâ uzun pozisyon gösterebilir. Gizlilik talepleri bazı pozisyonların açıklanmasını geciktirebilir. Yorumlamaya etkisi için sınırlar rehberine bakın.'] },
        { h2: 'Yatırımcılar 13F verisini nasıl kullanır?', p: ['Üç yaygın kullanım: uzun sicili olan yatırımcıların portföy değişimlerini izlemek, konsensüsü ölçmek (bir hisseyi kaç yönetici tutuyor, artırıyor mu azaltıyor mu) ve en büyük pozisyonları gerçek kanaat taşıyan yoğunlaşmış yöneticileri taramak. Fundocap her birini bir sayfaya dönüştürür: usta yatırımcı sayfaları, sıralamalar ve yükselen yöneticiler taraması.'] },
        { h2: 'Fundocap net alımı ve devri nasıl hesaplar?', p: ['Bir hissedeki net alım, takip edilen her fonun adedinin bir önceki çeyreğe göre değişiminin çeyrek sonu fiyatıyla çarpılıp fonlar üzerinden toplanmasıdır: bu çeyrek açılan pozisyon tamamıyla sayılır (önceki adet sıfır), kapatılan pozisyon önceki adedin tamamının satışıdır, yalnızca fiyatı artan bir pozisyon hiçbir şey katmaz. Fiyat, bildirimlerin kendi ima ettiği fiyattır (bildirilen değer / adet). Anasayfa, sıralamalar, hisse sayfası ve çeyrek raporu aynı fonksiyonla, aynı ihtiyari fon paneli üzerinden üretilir; her tablonun altındaki satır kaç fonun takip edildiğini, kaçının o çeyrek bildirdiğini ve rakamın kaç fon üzerinden hesaplandığını söyler.', 'Devir bir işlem ölçüsüdür, değer değişimi değil: açılan pozisyonların değeri + kapatılan pozisyonların önceki değeri + her iki çeyrekte de tutulan isimlerde eklenen ya da azaltılan adetlerin çeyrek sonu fiyatıyla değeri, bölü iki çeyreğin ortalama portföy değeri. Menkul kıymetler ticker ile tanınır; bir pozisyonun altındaki CUSIP değişimi (yeniden yapılanma, yeni hisse sınıfı) ne satış ne alımdır ve 13F-HR/A düzelttiği çeyreğe katlanır, bir çeyreklik işlem sayılmaz. İşlem olan bir çeyrek asla %0 gösterilmez.'] },
      ],
      faq: [
        ['13F verisi ücretsiz mi?', 'Evet. Bildirimler SEC EDGAR\'da herkese açıktır. Fundocap bunları ayrıştırır; en büyük pozisyonlar, sıralamalar ve insider sinyalleri hesap gerektirmez, tam tablolar ve dışa aktarma Pro plandadır.'],
        ['13F verisi ne kadar güvenilir?', 'Yönetici tarafından imzalanan yasal bir bildirimdir; ancak gecikmelidir (45 güne kadar), yalnızca uzun pozisyonları kapsar ve düzeltme bildirimleri olabilir. Canlı portföy değil, çeyreklik bir fotoğraf olarak değerlendirin.'],
      ],
      links: [['Berkshire Hathaway (Warren Buffett)', '/guru/berkshire-hathaway-warren-buffett'], ['Konsensüs sıralaması', '/rankings/consensus'], ['13F bildirim takvimi', '/calendar']],
    },
  },
  'how-to-read-form-4': {
    tr: {
      title: 'Form 4 insider bildirimi nasıl okunur?',
      lead: 'Form 4, bir şirket yöneticisinin, yönetim kurulu üyesinin veya %10 üzeri ortağın kendi şirketinin hissesini alıp sattıktan sonra iki iş günü içinde SEC\'e vermek zorunda olduğu bildirimdir. Kilit alanlar işlem kodu (P = açık piyasa alımı, S = satış, A = hisse ödülü, M = opsiyon kullanımı, F = vergi stopajı), fiyat, adet ve işlem sonrası sahip olunan adettir. Yalnızca açık piyasa alımları (P kodu) temiz bir sinyaldir; diğer kodların çoğu ücretlendirme mekaniğidir.',
      sections: [
        { h2: 'İşlem kodları ne anlama gelir?', p: ['P, insider\'ın kendi parasıyla yaptığı açık piyasa veya özel alımdır. S satıştır. A şirketin verdiği hisse ödülüdür. M opsiyon gibi bir türevin kullanımı ya da dönüştürülmesidir. F, hak edişte vergi için kesilen hisselerdir. G hediye, W vasiyet yoluyla devir, C dönüştürme, D ihraççıya devirdir (çağrı yoluyla satış dâhil). J ve I genel kodlardır.', 'Fundocap bunları üç sınıfa ayırır: güçlü sinyal (P, C ve elde tutulan M/X kullanımları), likidite (S, D ve nakde çevrilen kullanımlar) ve gürültü (A, F, G, W, J, I). Insider akışı, siz istemedikçe gürültüyü gizler.'] },
        { h2: 'Alım neden satıştan daha önemli?', p: ['Insider\'lar şirketle ilgisi olmayan pek çok nedenle satar: çeşitlendirme, vergi, ev alımı, hak ediş takvimi. Açık piyasadan ise tek bir nedenle alırlar: hissenin daha değerli olacağını beklerler. Seyhun (1986) ile başlayan akademik çalışmalar, özellikle birden fazla insider\'ın aynı anda ve küçük şirketlerde yaptığı alımların ölçülebilir ileriye dönük getiri taşıdığını, satışların ise taşımadığını bulur.'] },
        { h2: '10b5-1 planı nedir, neden işaretlenir?', p: ['Kural 10b5-1 planı, insider\'ın içsel bilgiye sahip olmadığı bir anda önceden belirlenen bir işlem planıdır. Plan kapsamındaki işlemler mekaniktir, dolayısıyla daha az sinyal taşır. 2023\'ten beri Form 4\'te plan işlemleri için bir kutucuk vardır; Fundocap bu satırlarda 10b5-1 rozeti gösterir.'] },
        { h2: 'Küme alımı nedir?', p: ['İki veya daha fazla farklı insider\'ın kısa bir pencerede (Fundocap 7 gün kullanır) aynı şirketin hissesini açık piyasadan alması. Küme, insider verisindeki en güçlü tekil örüntüdür; çünkü birbirinden bağımsız kişiler kendi paralarıyla aynı sonuca varmıştır. Küme alımları sayfası güncel olanları listeler.'] },
        { h2: 'Form 4\'te başka nelere bakmalı?', p: ['Bildirim gecikmesine (iki iş günlük süreyi aşan geç bildirimler kırmızı gösterilir), alımın insider\'ın mevcut sahipliğine oranına (ikiye katlama %1\'lik ekleme\'den daha anlamlıdır), role (CEO ve CFO alımları yönetim kurulu üyesi alımlarından daha nadirdir) ve ödenen fiyatın bugünkü fiyata oranına.'] },
      ],
      faq: [
        ['Form 4 bildirimleri nereden geliyor?', 'SEC EDGAR\'dan. Fundocap insider veri setini her gün SEC\'in Form 4 akışından yeniden üretir ve bir yıllık alım geçmişi tutar.'],
        ['Opsiyon kullanımı alım sayılır mı?', 'Yalnızca hisseler elde tutulursa. Aynı bildirimde satışla devam eden bir kullanım nakde çevirmedir ve likidite olarak sınıflandırılır.'],
      ],
      links: [['Küme alımları', '/insiders/cluster'], ['CEO ve CFO alımları', '/insiders/csuite'], ['Insider akışı', '/insiders']],
    },
  },
  '13f-limitations': {
    tr: {
      title: '13F verisinin sınırları',
      lead: '13F verisi 45 güne kadar gecikmelidir, yalnızca ABD borsalarındaki uzun pozisyonları kapsar, açığa satışları ve çoğu türevi içermez ve sonradan düzeltilebilir. Bir yöneticinin her çeyrekte tek bir günde neye sahip olduğunu söyler; bugün neye sahip olduğunu ya da nedenini değil. Bu sınırlar akılda tutulursa, kurumsal pozisyonlanmanın herkese açık ve denetlenen tek kaydı olmaya devam eder.',
      sections: [
        { h2: '13F verisi ne kadar eski?', p: ['30 Haziran tarihli bir pozisyon genellikle 14 Ağustos\'ta yayımlanır ve çeyrek bitiminin ertesi günü değişmiş olabilir. Yüksek devir hızlı yöneticiler için fotoğraf temsil edici olmayabilir; Berkshire Hathaway gibi düşük devirli yatırımcılar için bilgi değeri korunur. Fundocap her usta yatırımcı sayfasında çeyrek sonu ve bildirim tarihlerini gösterir ve ikisini ayırt edebilmeniz için "elde tutma süresi"ni hesaplar.'] },
        { h2: 'Hangi pozisyonlar eksik?', p: ['Açığa satışlar, kredi temerrüt swapları, vadeli işlemler, tezgâh üstü türevlerin çoğu, tahviller, nakit, ABD dışı kotasyonlar ve özel yatırımlar. Bu nedenle 13F portföy değeri fonun yönettiği toplam varlık değildir ve büyük bir uzun pozisyon, bildirimde görünmeyen bir çift işlemin veya korumanın parçası olabilir.'] },
        { h2: 'Adetler neden sıçrar?', p: ['Hisse bölünmeleri hiçbir işlem olmadan adetleri değiştirir. Fundocap, bölünme verisi olan hisselerde geçmiş adetleri bir bölünme tablosuyla düzeltir ve bu tabloları "split-adjusted" olarak etiketler; verinin olmadığı yerde 4\'e 1 bölünme %300 artış gibi görünür. Birleşmeler, bölünerek ayrılmalar ve sembol değişiklikleri benzer kırılmalara yol açar.'] },
        { h2: 'Bildirimler hatalı olabilir veya değişebilir mi?', p: ['Evet. Yöneticiler bir çeyreği yeniden beyan eden düzeltme bildirimleri (13F-HR/A) verir; bazen haftalar sonra. Bazıları gizlilik talep eder ve pozisyonları ancak SEC kararından sonra açıklar. Fundocap her düzeltmeyi düzelttiği çeyreğe işler: RESTATEMENT orijinal tablonun yerine geçer, NEW HOLDINGS orijinalde eksik bırakılan pozisyonları ekler. Düzeltme ayrı bir çeyrek olarak gösterilmez; çeyrek düzeltme içerdiğini belirtir.'] },
        { h2: 'Bu, portföy kopyalamak için ne anlama gelir?', p: ['En az 45 gün geç ve farklı fiyatlardan alırsınız, korumaları göremezsiniz, pozisyon boyutlandırma mantığını göremezsiniz. Kopyalama; yoğunlaşmış, düşük devirli ve uzun elde tutma süreli yöneticilerde en iyi, kantitatif ya da çok stratejili fonlarda en kötü sonucu verir. Konsensüs ve yüksek kanaat sıralamaları bu ayrım etrafında tasarlanmıştır.'] },
      ],
      faq: [
        ['13F bir fonun bugün neye sahip olduğunu gösterir mi?', 'Hayır. 45 güne kadar gecikmeyle yayımlanan çeyrek sonu pozisyonlarını gösterir. O tarihten sonraki her şey bir sonraki bildirime kadar görünmezdir.'],
        ['Berkshire\'ın 13F değeri neden toplam varlıklarından farklı?', '13F yalnızca ABD borsalarındaki hisseleri kapsar. Faaliyet şirketleri, nakit, tahviller ve yabancı kotasyonlar bildirimin dışındadır.'],
      ],
      links: [['Berkshire Hathaway (Warren Buffett)', '/guru/berkshire-hathaway-warren-buffett'], ['Yüksek kanaat sıralaması', '/rankings/conviction'], ['13F bildirimi nedir?', '/rehber/13f-nedir']],
    },
  },
};
