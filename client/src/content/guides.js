// Evergreen guides, answer-first, H2s phrased as questions. Each entry
// carries EN and TR copy (real Turkish, not placeholders) and three entity
// links so every guide feeds the entity graph.
export const GUIDE_CONTENT = {
  'what-is-13f': {
    en: {
      title: 'What is a 13F filing?',
      lead: 'Form 13F is a quarterly report that every institutional investment manager with at least $100 million in qualifying US securities must file with the SEC within 45 days of quarter end. It lists the manager\'s long positions in US-listed stocks, ETFs and some options at the quarter-end date, with share counts and market values. It is the public source behind every "what did Warren Buffett buy" article.',
      sections: [
        { h2: 'Who has to file a 13F?', p: ['Any institution exercising investment discretion over $100 million or more of "Section 13(f) securities" — mostly US exchange-listed equities, ETFs, convertible bonds and equity options. Hedge funds, mutual fund complexes, pension funds, banks, insurers and family offices all qualify once they cross the threshold. Roughly 8,000 filers report each quarter.', 'Individuals, non-US assets and managers under the threshold do not file, which is why some famous investors never appear in 13F data.'] },
        { h2: 'What does a 13F show?', p: ['Each filing is a table of holdings as of the last day of the calendar quarter: issuer name, security class, CUSIP, market value, number of shares, and whether the position is a put or call option. 13F Radar aggregates these rows per manager, computes portfolio weights and compares them with the previous quarter to derive new buys, adds, reductions and exits.', 'The filing does not show purchase prices, dates of trades within the quarter, or the manager\'s reasoning.'] },
        { h2: 'When are 13F filings due?', p: ['Within 45 days after each quarter end: around 15 May, 14 August, 14 November and 14 February. Most large managers file in the last days of the window, so the information is at least six weeks old when it appears. The filing calendar page tracks the next deadline and which superinvestors have already filed.'] },
        { h2: 'What is not in a 13F?', p: ['Short positions, most derivatives, bonds, cash, private investments and non-US securities are excluded. A manager that is net short a stock through swaps can still show a long position in the 13F. Confidential treatment requests can also delay disclosure of specific positions. See the limitations guide for how this affects interpretation.'] },
        { h2: 'How do investors use 13F data?', p: ['Three common uses: following the portfolio changes of investors with long track records, measuring consensus (how many managers hold a stock and whether they are adding or reducing), and screening for concentrated managers whose top positions carry real conviction. 13F Radar turns each into a page: guru pages, rankings and the emerging managers screen.'] },
      ],
      faq: [
        ['Is 13F data free?', 'Yes. Filings are public on SEC EDGAR. 13F Radar parses them and shows the top positions, rankings and insider signals without an account; full tables and exports are part of the Pro plan.'],
        ['How reliable is 13F data?', 'It is a legal filing signed by the manager, but it is dated (up to 45 days old), long-only and can contain amendments. Treat it as a quarterly snapshot, not a live portfolio.'],
      ],
      links: [['Berkshire Hathaway (Warren Buffett)', '/guru/berkshire-hathaway-warren-buffett'], ['Consensus ranking', '/rankings/consensus'], ['13F filing calendar', '/calendar']],
    },
    tr: {
      title: '13F bildirimi nedir?',
      lead: 'Form 13F, en az 100 milyon dolarlık ABD menkul kıymeti yöneten her kurumsal yatırımcının, çeyrek sonunu izleyen 45 gün içinde SEC\'e vermek zorunda olduğu üç aylık rapordur. Yöneticinin çeyrek sonu tarihindeki ABD borsalarında işlem gören hisse, ETF ve bazı opsiyon pozisyonlarını adet ve piyasa değeriyle listeler. "Warren Buffett ne aldı?" başlıklı her haberin kaynağı bu bildirimdir.',
      sections: [
        { h2: 'Kimler 13F bildirimi yapmak zorunda?', p: ['100 milyon dolar ve üzeri "13(f) menkul kıymeti" (ağırlıklı olarak ABD borsalarındaki hisseler, ETF\'ler, dönüştürülebilir tahviller ve hisse opsiyonları) üzerinde yatırım kararı yetkisi olan her kurum. Hedge fonlar, yatırım fonu şirketleri, emeklilik fonları, bankalar, sigorta şirketleri ve aile ofisleri eşiği aştıklarında kapsama girer. Her çeyrek yaklaşık 8.000 kurum bildirim yapar.', 'Bireyler, ABD dışı varlıklar ve eşiğin altındaki yöneticiler bildirim yapmaz; bazı ünlü yatırımcıların 13F verisinde hiç görünmemesinin nedeni budur.'] },
        { h2: '13F neyi gösterir?', p: ['Her bildirim, takvim çeyreğinin son günü itibarıyla bir pozisyon tablosudur: ihraççı adı, menkul kıymet sınıfı, CUSIP kodu, piyasa değeri, adet ve pozisyonun put/call opsiyonu olup olmadığı. 13F Radar bu satırları yönetici bazında toplar, portföy ağırlıklarını hesaplar ve önceki çeyrekle karşılaştırarak yeni alımları, artırmaları, azaltmaları ve çıkışları türetir.', 'Bildirimde alış fiyatları, çeyrek içindeki işlem tarihleri veya yöneticinin gerekçesi yer almaz.'] },
        { h2: '13F bildirimleri ne zaman yapılır?', p: ['Her çeyrek sonunu izleyen 45 gün içinde: yaklaşık 15 Mayıs, 14 Ağustos, 14 Kasım ve 14 Şubat. Büyük yöneticilerin çoğu sürenin son günlerinde bildirir; bu yüzden bilgi yayımlandığında en az altı haftalıktır. Bildirim takvimi sayfası bir sonraki son tarihi ve hangi usta yatırımcıların bildirim yaptığını izler.'] },
        { h2: '13F\'te ne yoktur?', p: ['Açığa satış pozisyonları, çoğu türev ürün, tahviller, nakit, özel yatırımlar ve ABD dışı menkul kıymetler kapsam dışıdır. Swap yoluyla net açığa pozisyonda olan bir yönetici 13F\'te hâlâ uzun pozisyon gösterebilir. Gizlilik talepleri bazı pozisyonların açıklanmasını geciktirebilir. Yorumlamaya etkisi için sınırlar rehberine bakın.'] },
        { h2: 'Yatırımcılar 13F verisini nasıl kullanır?', p: ['Üç yaygın kullanım: uzun sicili olan yatırımcıların portföy değişimlerini izlemek, konsensüsü ölçmek (bir hisseyi kaç yönetici tutuyor, artırıyor mu azaltıyor mu) ve en büyük pozisyonları gerçek kanaat taşıyan yoğunlaşmış yöneticileri taramak. 13F Radar her birini bir sayfaya dönüştürür: usta yatırımcı sayfaları, sıralamalar ve yükselen yöneticiler taraması.'] },
      ],
      faq: [
        ['13F verisi ücretsiz mi?', 'Evet. Bildirimler SEC EDGAR\'da herkese açıktır. 13F Radar bunları ayrıştırır; en büyük pozisyonlar, sıralamalar ve insider sinyalleri hesap gerektirmez, tam tablolar ve dışa aktarma Pro plandadır.'],
        ['13F verisi ne kadar güvenilir?', 'Yönetici tarafından imzalanan yasal bir bildirimdir; ancak gecikmelidir (45 güne kadar), yalnızca uzun pozisyonları kapsar ve düzeltme bildirimleri olabilir. Canlı portföy değil, çeyreklik bir fotoğraf olarak değerlendirin.'],
      ],
      links: [['Berkshire Hathaway (Warren Buffett)', '/guru/berkshire-hathaway-warren-buffett'], ['Konsensüs sıralaması', '/rankings/consensus'], ['13F bildirim takvimi', '/calendar']],
    },
  },
  'how-to-read-form-4': {
    en: {
      title: 'How to read a Form 4 insider filing',
      lead: 'Form 4 is the SEC filing an officer, director or 10% owner must submit within two business days of buying or selling their own company\'s stock. The key fields are the transaction code (P = open-market purchase, S = sale, A = grant, M = option exercise, F = tax withholding), the price, the number of shares and the shares owned afterwards. Only open-market purchases (code P) are a clean signal; most other codes are compensation mechanics.',
      sections: [
        { h2: 'What do the transaction codes mean?', p: ['P is an open-market or private purchase paid with the insider\'s own money. S is a sale. A is a grant or award from the company. M is an exercise or conversion of a derivative such as an option. F is shares withheld to pay taxes on a vesting award. G is a gift, W a transfer by will, C a conversion, D a disposition to the issuer (including tenders). J and I are catch-all codes.', '13F Radar groups them into three classes: high conviction (P, C and exercise-and-hold M/X), liquidity (S, D and exercise cash-outs) and noise (A, F, G, W, J, I). The insider feed hides noise unless you ask for it.'] },
        { h2: 'Why does a purchase matter more than a sale?', p: ['Insiders sell for many reasons that say nothing about the company — diversification, taxes, a house, a vesting schedule. They buy on the open market for one reason: they expect the stock to be worth more. Academic work since Seyhun (1986) finds that purchases, especially by several insiders at once and in smaller companies, carry a measurable forward return; sales do not.'] },
        { h2: 'What is a 10b5-1 plan and why is it flagged?', p: ['A Rule 10b5-1 plan is a pre-scheduled trading plan adopted when the insider has no material non-public information. Trades executed under a plan are mechanical, so they carry less signal. Since 2023 Form 4 has a checkbox for plan trades; 13F Radar shows a 10b5-1 badge on those rows.'] },
        { h2: 'What is a cluster buy?', p: ['Two or more different insiders buying the same company\'s stock on the open market within a short window — 13F Radar uses 7 days. A cluster is the strongest single pattern in insider data because independent people reached the same conclusion with their own money. The cluster buys page lists the current ones.'] },
        { h2: 'What else should I check on a Form 4?', p: ['The filing lag (a late filing past the two-business-day deadline is shown in red), the size of the purchase relative to what the insider already owned (a doubling matters more than a 1% top-up), the role (CEO and CFO purchases are rarer than director purchases) and the price paid versus today\'s price.'] },
      ],
      faq: [
        ['Where do Form 4 filings come from?', 'From SEC EDGAR. 13F Radar rebuilds its insider dataset daily from the SEC\'s Form 4 feed and keeps one year of buys.'],
        ['Do option exercises count as buying?', 'Only when the shares are kept. An exercise followed by a sale in the same filing is a cash-out and is classified as liquidity.'],
      ],
      links: [['Cluster buys', '/insiders/cluster'], ['CEO and CFO buys', '/insiders/csuite'], ['Insider feed', '/insiders']],
    },
    tr: {
      title: 'Form 4 insider bildirimi nasıl okunur?',
      lead: 'Form 4, bir şirket yöneticisinin, yönetim kurulu üyesinin veya %10 üzeri ortağın kendi şirketinin hissesini alıp sattıktan sonra iki iş günü içinde SEC\'e vermek zorunda olduğu bildirimdir. Kilit alanlar işlem kodu (P = açık piyasa alımı, S = satış, A = hisse ödülü, M = opsiyon kullanımı, F = vergi stopajı), fiyat, adet ve işlem sonrası sahip olunan adettir. Yalnızca açık piyasa alımları (P kodu) temiz bir sinyaldir; diğer kodların çoğu ücretlendirme mekaniğidir.',
      sections: [
        { h2: 'İşlem kodları ne anlama gelir?', p: ['P, insider\'ın kendi parasıyla yaptığı açık piyasa veya özel alımdır. S satıştır. A şirketin verdiği hisse ödülüdür. M opsiyon gibi bir türevin kullanımı ya da dönüştürülmesidir. F, hak edişte vergi için kesilen hisselerdir. G hediye, W vasiyet yoluyla devir, C dönüştürme, D ihraççıya devirdir (çağrı yoluyla satış dâhil). J ve I genel kodlardır.', '13F Radar bunları üç sınıfa ayırır: güçlü sinyal (P, C ve elde tutulan M/X kullanımları), likidite (S, D ve nakde çevrilen kullanımlar) ve gürültü (A, F, G, W, J, I). Insider akışı, siz istemedikçe gürültüyü gizler.'] },
        { h2: 'Alım neden satıştan daha önemli?', p: ['Insider\'lar şirketle ilgisi olmayan pek çok nedenle satar: çeşitlendirme, vergi, ev alımı, hak ediş takvimi. Açık piyasadan ise tek bir nedenle alırlar: hissenin daha değerli olacağını beklerler. Seyhun (1986) ile başlayan akademik çalışmalar, özellikle birden fazla insider\'ın aynı anda ve küçük şirketlerde yaptığı alımların ölçülebilir ileriye dönük getiri taşıdığını, satışların ise taşımadığını bulur.'] },
        { h2: '10b5-1 planı nedir, neden işaretlenir?', p: ['Kural 10b5-1 planı, insider\'ın içsel bilgiye sahip olmadığı bir anda önceden belirlenen bir işlem planıdır. Plan kapsamındaki işlemler mekaniktir, dolayısıyla daha az sinyal taşır. 2023\'ten beri Form 4\'te plan işlemleri için bir kutucuk vardır; 13F Radar bu satırlarda 10b5-1 rozeti gösterir.'] },
        { h2: 'Küme alımı nedir?', p: ['İki veya daha fazla farklı insider\'ın kısa bir pencerede (13F Radar 7 gün kullanır) aynı şirketin hissesini açık piyasadan alması. Küme, insider verisindeki en güçlü tekil örüntüdür; çünkü birbirinden bağımsız kişiler kendi paralarıyla aynı sonuca varmıştır. Küme alımları sayfası güncel olanları listeler.'] },
        { h2: 'Form 4\'te başka nelere bakmalı?', p: ['Bildirim gecikmesine (iki iş günlük süreyi aşan geç bildirimler kırmızı gösterilir), alımın insider\'ın mevcut sahipliğine oranına (ikiye katlama %1\'lik ekleme\'den daha anlamlıdır), role (CEO ve CFO alımları yönetim kurulu üyesi alımlarından daha nadirdir) ve ödenen fiyatın bugünkü fiyata oranına.'] },
      ],
      faq: [
        ['Form 4 bildirimleri nereden geliyor?', 'SEC EDGAR\'dan. 13F Radar insider veri setini her gün SEC\'in Form 4 akışından yeniden üretir ve bir yıllık alım geçmişi tutar.'],
        ['Opsiyon kullanımı alım sayılır mı?', 'Yalnızca hisseler elde tutulursa. Aynı bildirimde satışla devam eden bir kullanım nakde çevirmedir ve likidite olarak sınıflandırılır.'],
      ],
      links: [['Küme alımları', '/insiders/cluster'], ['CEO ve CFO alımları', '/insiders/csuite'], ['Insider akışı', '/insiders']],
    },
  },
  '13f-limitations': {
    en: {
      title: 'Limitations of 13F data',
      lead: '13F data is dated by up to 45 days, covers only long positions in US-listed securities, omits shorts and most derivatives, and can be amended after the fact. It tells you what a manager owned on one day per quarter, not what they own today or why. Used with those limits in mind it is still the only public, audited record of institutional positioning.',
      sections: [
        { h2: 'How stale is 13F data?', p: ['A position dated 30 June is typically published on 14 August and may have changed the day after quarter end. For high-turnover managers the snapshot can be unrepresentative; for low-turnover investors such as Berkshire Hathaway it remains informative. 13F Radar shows the quarter-end and filing dates on every guru page and computes "time held" so you can tell the two apart.'] },
        { h2: 'What positions are missing?', p: ['Short positions, credit default swaps, futures, most OTC derivatives, bonds, cash, non-US listings and private holdings. A 13F portfolio value is therefore not the fund\'s assets under management, and a large long position can be part of a pair trade or hedge that the filing does not show.'] },
        { h2: 'Why do share counts jump?', p: ['Stock splits change share counts without any trade. 13F Radar adjusts historical share counts with a splits table where it has split data and labels those tables split-adjusted; where it does not, a 4-for-1 split looks like a 300% increase. Mergers, spin-offs and ticker changes cause similar breaks.'] },
        { h2: 'Can filings be wrong or changed?', p: ['Yes. Managers file amendments (13F-HR/A) that restate a quarter, occasionally weeks later. Some request confidential treatment and disclose positions only after the SEC decision. 13F Radar keeps the most recently filed document for each quarter, so an amendment replaces the original.'] },
        { h2: 'What does this mean for copying a portfolio?', p: ['You buy at least 45 days late at different prices, cannot see the hedges, and cannot see the sizing logic. Copying works best for concentrated, low-turnover managers with long holding periods; it works worst for quantitative or multi-strategy funds. The consensus and conviction rankings are designed around that distinction.'] },
      ],
      faq: [
        ['Does 13F show what a fund owns today?', 'No. It shows quarter-end positions published up to 45 days later. Anything since then is invisible until the next filing.'],
        ['Why is Berkshire\'s 13F value different from its total assets?', 'The 13F covers US-listed equities only. Operating businesses, cash, bonds and foreign listings are outside the filing.'],
      ],
      links: [['Berkshire Hathaway (Warren Buffett)', '/guru/berkshire-hathaway-warren-buffett'], ['High conviction ranking', '/rankings/conviction'], ['What is a 13F filing?', '/guides/what-is-13f']],
    },
    tr: {
      title: '13F verisinin sınırları',
      lead: '13F verisi 45 güne kadar gecikmelidir, yalnızca ABD borsalarındaki uzun pozisyonları kapsar, açığa satışları ve çoğu türevi içermez ve sonradan düzeltilebilir. Bir yöneticinin her çeyrekte tek bir günde neye sahip olduğunu söyler; bugün neye sahip olduğunu ya da nedenini değil. Bu sınırlar akılda tutulursa, kurumsal pozisyonlanmanın herkese açık ve denetlenen tek kaydı olmaya devam eder.',
      sections: [
        { h2: '13F verisi ne kadar eski?', p: ['30 Haziran tarihli bir pozisyon genellikle 14 Ağustos\'ta yayımlanır ve çeyrek bitiminin ertesi günü değişmiş olabilir. Yüksek devir hızlı yöneticiler için fotoğraf temsil edici olmayabilir; Berkshire Hathaway gibi düşük devirli yatırımcılar için bilgi değeri korunur. 13F Radar her usta yatırımcı sayfasında çeyrek sonu ve bildirim tarihlerini gösterir ve ikisini ayırt edebilmeniz için "elde tutma süresi"ni hesaplar.'] },
        { h2: 'Hangi pozisyonlar eksik?', p: ['Açığa satışlar, kredi temerrüt swapları, vadeli işlemler, tezgâh üstü türevlerin çoğu, tahviller, nakit, ABD dışı kotasyonlar ve özel yatırımlar. Bu nedenle 13F portföy değeri fonun yönettiği toplam varlık değildir ve büyük bir uzun pozisyon, bildirimde görünmeyen bir çift işlemin veya korumanın parçası olabilir.'] },
        { h2: 'Adetler neden sıçrar?', p: ['Hisse bölünmeleri hiçbir işlem olmadan adetleri değiştirir. 13F Radar, bölünme verisi olan hisselerde geçmiş adetleri bir bölünme tablosuyla düzeltir ve bu tabloları "split-adjusted" olarak etiketler; verinin olmadığı yerde 4\'e 1 bölünme %300 artış gibi görünür. Birleşmeler, bölünerek ayrılmalar ve sembol değişiklikleri benzer kırılmalara yol açar.'] },
        { h2: 'Bildirimler hatalı olabilir veya değişebilir mi?', p: ['Evet. Yöneticiler bir çeyreği yeniden beyan eden düzeltme bildirimleri (13F-HR/A) verir; bazen haftalar sonra. Bazıları gizlilik talep eder ve pozisyonları ancak SEC kararından sonra açıklar. 13F Radar her çeyrek için en son verilen belgeyi tutar; düzeltme orijinalin yerini alır.'] },
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
