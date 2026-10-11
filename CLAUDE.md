# FundoCap — çalışma notları

## Vercel faturası: her push bir build demek

Vercel'de bu repo `13-f-radar` projesine bağlı. **Hangi dal olursa olsun her push bir build
tetikler** (main → production, diğer dallar → preview). Build yaklaşık 1 dakika ve ~2,5 ¢.
Ölçüm (2026-10-11, Vercel billing API):

- Kullanım ~$0,54/gün ≈ **$16/ay**; bunun **~%75'i build**. Sayfa sunumu + trafik ~$4/ay.
- $20'lık Pro kredisi aylık; `brh`, `masa-qr-website1`, `masa-qr-v2` projeleriyle **paylaşılıyor**.
- Normal gün 16–20 build (çoğu gece veri işlerinin main commit'leri); yoğun geliştirme günü 40+.
  Birkaç yoğun gün krediyi aşar.

Bu yüzden:

1. **Toplu çalış, toplu push et.** Küçük adımları yerelde commit'le; bir iş parçası bittiğinde
   (build + test temiz) tek push yap. Her düzeltmeden sonra push etme.
2. **Push'tan önce yerelde doğrula:** `npm run build && npm test` (ve gerekirse
   `AUDIT_REPORT=0 node scripts/audit-data.mjs`). CI/preview'ı deneme tahtası olarak kullanma.
3. **PR'ları toplu merge et.** İlgili değişiklikleri tek PR'da topla; birden fazla PR hazırsa
   aynı anda birleştir. Her merge bir production build.
4. **Deneme dalı açıp push etme.** Geçici dallar da preview build üretir.
5. **Yeni zamanlanmış iş (workflow) main'e commit atacaksa** maliyeti düşün: mevcut işlerle
   aynı commit'te birleştirmeyi ya da günlük tek toplu commit'i tercih et.
   `scripts/vercel-ignore.mjs` (vercel.json → `ignoreCommand`) logo, şirket domain'i ve
   Kongre veri commit'lerini tek başına yayınlamaz; bir sonraki yayın (insider ~03:00/~11:00
   UTC, gece konsensüsü, merge) onları da taşır, son yayın 12 saati geçtiyse yine build eder.
   Acil olmayan yeni bir veri işi eklersen commit mesajını oradaki `DEFERRABLE` listesine ekle.
6. Maliyet kontrolü: Vercel bağlayıcısında `list_billing_charges` (team
   `team_HX08q8PKoWadRHegEBiw5E9O`) ve `list_deployments`; kullanıcı panelde
   Settings → Billing → Spend Management ile harcama sınırı/uyarısı tutuyor.
