# SAHAPRO SOLO v3.9.02 — Güçlendirme ve red-team raporu

Tarih: 17 Ekim 2026. Temel: kullanıcının gönderdiği v3.9.01 kaynak paketi. Değişiklikler izole kopyada yapıldı. Canlı yayın ve kullanıcının gerçek telefon verisine yazım yapılmadı.

## Sonuç ve tehdit modeli

Bu sürüm, doğrulanan finansal varsayımları ve kimlik doğrulama açıklarını kapatır; AI raporlarını yerel kanıtlara bağlar, istek sayısını ve kaynak tüketimini sınırlar. Tam güvenlik sertifikası veya her mesajda %100 doğruluk garantisi değildir.

Hedeflenen senaryolar: KDV dahil fiyatın hariç sayılması; %0 oranının %20'ye dönüşmesi; geçersiz ikinci fiyat kartı yüzünden kısmi finansal yazım; imzasız/tanınmayan/değiştirilmiş/iptal şoför paketi; AI'ın gelir rakamını tahsilat diye sunması; retry ve eşzamanlı sekmelerle istek limitinin aşılması; şoför imza sırlarının şifresiz dışa aktarımı; aşırı büyük AI yanıtı ve bozuk yedek.

## 1. Uygulanan finans kapıları

### İş satırına manuel fiyat

Asistan iş satırında birim fiyat varsa KDV dahil/hariç, açık oran ve kullanıcı onayı gerekir. İlk durum boş ve onaysızdır; mesajdaki KDV dahil/hariç ifadesi kullanıcı yerine nihai onay sayılmaz. Oran 0–100, fiyat/miktar pozitif ve sonlu olmalı. %0 korunur. Dahil fiyat dahil olarak snapshot'a yazılır. Fiyat boşsa mevcut tarihli fiyat listesi yolu devam eder; eski kayıtların fiyatı topluca dönüştürülmez.

Tüm seçili manuel fiyatlar, ilk kart/iş yazımından önce doğrulanır. Fiyat, oran, miktar, müşteri, araç, şantiye ve ilgili bağlam değişikliği onayı kaldırır. Bu finans ön kontrolü bütün karma asistan işlemlerinin tek IndexedDB transaction olduğu anlamına gelmez.

Dosyalar: assistant-price.js, assistant.js.

### Fiyat kuralı

Fiyat kuralı kartı da KDV baz/oran/onay ve gerçek geçerlilik başlangıcı ister. Yeni tarihli kural eski tarihli kuralı ezmez; aynı kapsam ve aynı başlangıç tarihli kural güncellenebilir. Yeni tarih, önceden kaydedilmiş iş snapshot'larını değiştirmez. Eski fiyatı boş işlere uygulama kutusu başlangıçta kapalıdır. Kullanıcı açıkça işaretlerse mevcut tarih ve kilit kontrolleriyle uygulanır. Aynı kapsamlı, aynı tarihli kural güncellemesi hâlâ açık kullanıcı işlemidir; bu ekranda varsayılan olarak tüm geçmişe uygulanmaz.

Dosyalar: assistant-price.js, assistant.js, price-rule-core.js.

## 2. Şoför imzası — kapalı hata davranışı

Tanınmayan link ID, imzasız eski paket, tutmayan HMAC, süresi geçmiş, pasif personel veya iptal bağlantı reddedilir. Tanınmayan bağlantı artık yalnız uyarıyla geçemez. Reddedilen paket bulunan mesaj AI'a alternatif yazıdan işleme yoluyla gönderilmez; kullanıcı paketi doğrulamalı/yeni bağlantı oluşturmalıdır. Geçerli mevcut imzalı bağlantılar değiştirilmedi.

Uyumluluk etkisi: eski imzasız bağlantıya yeni imzalı bağlantı gerekir. Link başka yönetici telefonunda oluşturulduysa doğru şifreli kurtarma yedeğini geri yüklemek veya bu telefondan yeni bağlantı vermek gerekir. İmzasız paketi sadece uyarı göstererek kabul etmek güvenli geçiş çözümü değildir.

Yönetici kilidinde aynı anda çok sayıda Enter ile paralel parola doğrulama başlatılması önlendi. Bu yerel ekran korumasıdır; işletim sistemi veya origin'de çalışan kötü amaçlı kod üzerinde sunucu yetkisi kurmaz. HTML sayfalarına no-referrer eklendi. Şoför bağlantısının kendi URL'sini bilen kişi bağlantı sırrına erişebilir; hosting logları, telefon geçmişi ve bağlantı paylaşımı ayrı risklerdir.

Dosyalar: security.js, assistant.js, index.html, sofor.html.

## 3. Yedek ve sır ayrımı

fullBackup(db) varsayılan veri/ek dışa aktarımında driver_links, API anahtarı, Gemini onayı, yedek şifresi ve yerel kilit verilerini dışlar. Tam kurtarma için includeDriverSecrets:true açık seçeneği vardır. Ayarlar'daki tam yedek, şoför bağlantıları varsa bu tam yolu kullanır ve en az 10 karakterli yedek parolası olmadan devam etmez. encodeBackup da anahtar içeren nesneyi şifresiz/kısa parolayla dışa çıkarmayı reddeder.

AES-GCM şifreleme, rastgele tuz/IV ve PBKDF2-SHA256 mevcut formatıyla sürer. Yeni parola ayarlarında en az10 karakter gerekir; daha uzun benzersiz parola önerilir. Parolayı ayrı güvenli yerde tutun; unutulan yedek parolası kurtarılamaz. Var olan kısa parola, sır içeren yeni tam yedek almak için uzatılmalıdır. Eski şifreli dosyaların okunması engellenmedi.

Geçmiş aktarım ekranındaki JSON, 'Veri ve Ek Yedeği' olarak yeniden adlandırıldı; şoför anahtarlarını içermez. Yerel kurtarma veritabanı tam bağlantı sırlarını korur; bu cihaz içi snapshot'tır, paylaşılabilir şifresiz dosya değildir. Kaynak dışa aktarım kodunu çağıran başka geliştiriciler açık sır seçeneğini keyfi JSON indirerek yayınlamamalıdır.

Yedek giriş dosyası en fazla64 MB, açılmış veri en fazla128 MB. Akışla açma sınırda durur; eksik şifreli başlık, GCM değişikliği ve yanlış şifre reddedilir. Encoder kendi geri okuyamayacağı kadar büyük dosyayı üretmez. Büyük işletme arşivi için parçalı/akışlı yedekleme sonraki iştir; büyük dosyada sınırı kaldırmak çözüm değildir. Sıkıştırma şifreleme değildir. Sır içermeyen veri yedeği dahi iş ve kişisel bilgiler içerir; herkese açık GitHub'a konulmamalıdır.

Dosyalar: backup.js, backup-crypt.js, m-crm.js, history-ui.js.

## 4. AI raporları — modelden rakam alma yerine kanıt seçimi

Gün sonu, yönetim değerlendirmesi, sabah brifingi, nakit ve teklif yorumunda model yalnız yerel kanıt satırı kimliklerini seçer. Ekrandaki etiket, isim ve değerler telefonda hesaplanan katalogdan üretilir. Modelin eklediği text/amount/label dikkate alınmaz. Bilinmeyen veya aşırı sayıda kanıt kimliği reddedilir. Model geçersiz yanıt verirse yerel rapor kullanılabilir; veritabanına yeni kayıt yazılmaz.

Soru Sor araçlarında modelin serbest son cümlesi yerine çalıştırılan yerel araçların sonuçları, araç adı ve parametreleri gösterilir. Böylece sayı doğru olsa bile yanlış metrik adıyla yayınlanması önlenir. Modelin doğru aracı/dönemi seçmesi hâlâ kullanıcı denetimi gerektirir; yanlış araç seçimi anlamsal olarak çözülmüş değildir. Görünen hesap adı ve parametreler bu kontrolü mümkün kılar.

Ana asistanın kalan serbest answer alanı açıkça 'AI yorumu — doğrulanmış hesap değildir' etiketlidir. Bu metin için anlam doğruluğu iddiası yoktur. Genel checkAnswer artık küçük sayıları veya2000–2100 arası tutarları otomatik tarih kabul etmez; ancak tek başına anlamsal doğrulayıcı değildir. Eski keepVerified yalnız birebir yerel etiket-değer kanıt satırını kabul eder.

Davranış farkı: AI'ın serbest, akıcı finansal yorumları yerine kanıt satırları gösterilir. Yalnız sayıları metinde arayıp buna 'doğrulanmış yorum' demek güvenli değildi. Bundan sonraki daha akıcı anlatım, yine sunucu/yerel şablon ve kanıtla bağlanmalıdır.

Dosyalar: evidence-report.js, assistant-tools.js, day-summary.js, assistant-core.js, brief.js, cashflow.js, quote-calc.js, assistant.js.

## 5. AI istek koruması

Varsayılan günlük60 HTTP denemesi; Ayarlar → Yapay Zeka'da1–500 arası tam sayı seçilebilir. İstek öncesi IndexedDB readwrite transaction ile rezervasyon yapılır. Başarısız istek, JSON şablon tekrarı, fonksiyon turları, model listeleme/arama ve fallback denemeleri ayrı sayılır. Eşzamanlı sekmeler ortak sayacı kullanır. Türkiye günü esas alınır. Kayıt yapılamıyorsa veya sayaç bozuksa çağrı gönderilmez. Onay her rezervasyonda kontrol edilir. İzin kutusu kapatılınca yeni istekler durur; halihazırda gönderilmiş isteği geri çekme garantisi değildir.

HTTP zaman aşımı45 saniye, istek16 MB, yanıt4 MB sınırı var. Giriş boyutu sınırı dosyaları ayrı gönderme gerektirebilir. Kullanıcının yerel kayıt akışı çalışmaya devam eder. Asistan sadece bulutla çalışan özelliğinde doğal olarak öneri veremez; AI'sız iş modülleri kullanılabilir.

Bu yerel sayaç parasal tavan veya sağlayıcı taraflı güvenlik değildir. Tarayıcı verisini değiştiren kullanıcı/origin kodu sayacı değiştirebilir; saat manipülasyonu da mümkündür. Modelin çalışması ücretsiz olduğunu kanıtlamaz. API hâlâ kullanıcının cihazındaki BYOK anahtarla doğrudan Google'a gider. Sağlayıcı hesabı bütçesi/izinleri ayrıca yapılandırılmalıdır. Güçlü tenant ve harcama kontrolü için kimlik doğrulamalı sunucu gerekir.

Dosyalar: ai-guard.js, ai-gemini.js, ai-screen.js. Genel bulut/mahremiyet yazıları gerçek AI veri gönderimini belirtecek şekilde düzeltildi.

## 6. Kabul ve test sınırları

TEST-SONUCLARI.md güncel koşuların sayısını ve kanıtlarını listeler. Sahte Gemini kullanılarak doğrulama kapıları test edildi; ücretli gerçek API çağrısı yapılmadı. Gerçek modelin her mesajda doğru anlaması veya gerçek faturaların kusursuz okunması kanıtlanmış değildir. Fiziksel Android/iPhone ve gerçek Safari motoru kabulü kullanıcı cihazında yapılmalıdır.

Şema5 ve ana veritabanı adı korundu. Eski işler, alias'lar ve şoför linkleri otomatik dönüştürülmedi. v3.9.01→v3.9.02 gerçek Service Worker yükseltme denemesinde kilitli iş snapshot'ı, alias ve link değerlerinin değişmediği kontrol edildi. Bu sentetik geçiş testi, kullanıcıdaki her eski veri varyantı için tam göç garantisi değildir.

## 7. Kalan sınırlar ve sonraki aşama

Tamamlandı diye sunulmayan işler:

- Kötü amaçlı aynı origin kodu/cihaz ele geçirilmesi, tarayıcı veritabanı hırsızlığı ve hosting hesabı ele geçirilmesi. Ekran kilidi tüm IndexedDB'yi şifrelemez.
- API anahtarının sunucuya alınması, sunucu taraflı kota ve kullanıcı/şirket yetkisi. Şu an ortak çok kullanıcı sistemi yoktur.
- Asistanın bütün iş/gider/yakıt/kart değişikliklerini tek atomik transaction'a dönüştürme. Fiyatlar için ön kontrol vardır; diğer çalışma zamanı hatalarında mevcut kısmi işlem/geri alma tasarımı devam eder.
- İmzalı şoför mesajı işin gerçekten yapıldığını ispat etmez; bağlantı anahtarı sahibi o bağlantıyla veri üretebilir. Denetim, fiş ve insan kontrolü gerekir.
- Genel doğal dil doğruluğu, gönderen/personel rol politikası, belirsiz müşteri/şantiye seçimi. Eksik veri uydurulmamalı; mevcut soru/aday kapıları sürer.
- Bağımsız gerçek mesaj kör kümesi, yük/uzun süre testleri, sağlayıcı ve dış model bağımlılıklarının tedarik zinciri denetimi.
- Hosting güvenlik başlıkları, CI zorunlu test kapısı ve ayrı dış pentest. Mevcut CSP/no-referrer katmanı tam sandbox değildir.
- Çok büyük arşivlerde parçalı yedek, düzenli şifreli dış yedek ve gerçek geri dönüş tatbikatı.

Önerilen sıra: (1) fiziksel cihaz kabulü; (2) asistan transaction/rollback ve değişiklik onay özeti; (3) bağımsız gerçek mesaj ve uzun süreli test seti; (4) ortak sisteme geçilecekse sunucuya anahtar/kimlik/yetki/kota; (5) CI ve bağımsız güvenlik denetimi. Bunlar bu ZIP'te uygulanmış gibi gösterilmez.
