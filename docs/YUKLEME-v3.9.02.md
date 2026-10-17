# v3.9.02 yükleme ve Android kabulü

1. Mevcut sürümden tam yedek alın; kişisel yedeği GitHub'a yüklemeyin. Şoför linkleri varsa eski şifresiz yedeğiniz gizli anahtarlar içerebilir; başka AI'a göndermeyin.
2. gh-pages dalından sahapro-v3902 dalı oluşturun.
3. Tam paket ZIP'ini çıkartın. Kök index.html, sofor.html, styles.css, sw.js, manifest.webmanifest ve .nojekyll dosyalarını; js, vendor, icons ve data klasörlerini aynı konuma yükleyin. ZIP'i veya kaynak/test paketini olduğu gibi yayınlamayın. Özellikle assistant-price.js, ai-guard.js ve evidence-report.js yeni modüllerdir.
4. PR base gh-pages, compare sahapro-v3902 olacak şekilde değişiklikleri inceleyip birleştirin. Bu paket henüz otomatik yayınlanmadı.
5. Pages yayını sonrası aynı tarayıcı/origin'de güncelleme bildirimini kabul edin. Tarayıcı site verisini silmeyin. Ayarlar sürümü v3.9.02, şema5 olabilir.
6. Eski gerçek iş, kilitli hakediş/fiş, müşteri takma adı ve şoför linkini açıp eski alanların korunduğunu kontrol edin. Kaydı sırf test için yeniden aktarmayın.
7. Yeni boş deneme mesajının önizlemesinde manuel fiyat verin: KDV bazı/oranı/onayı yokken Kaydet iş oluşturmamalı. Gerçek kayıt oluşturmadan bu kapıyı kontrol edin. %0 ve dahil fiyatı sentetik test ortamında sınayın.
8. Şoför aktif bağlantı ile çalışmalı; eski imzasız bağlantı reddedilirse yeni bağlantı üretin. Tanınmayan linki kabul ettirmek için imza kontrolünü kapatmayın.
9. Ayarlar → Yedek Şifresi'nde en az10 karakterli benzersiz parola belirleyin, ayrı güvenli yerde saklayın. Şoför sırlarını içeren tam yedek _SIFRELI.sahapro olmalı. Geri yükleme denemesini canlı telefonun üzerine değil ayrı test ortamına yapın.
10. AI günlük HTTP sınırı varsayılan60'tır. Düşük sınıra ulaşıldığında AI yeni istek göndermemeli, yerel işler açılmalıdır. Bu parasal limit değildir.
11. Gün sonu raporunda AI yalnız kanıt satırlarını sıralar; serbest finansal yorum yerine etiket ve değer görmeniz beklenen davranıştır.

Sorun çıkarsa site verisini silmeyin. Eski kod paketine geri dönüş kodu değiştirir, veritabanını eski tarihli yedekle körlemesine ezmek anlamına gelmez. Yeni sürümde yaptığınız kayıtları önce yedekleyin. Güncelleme öncesi v3.9.01 kaynak paketi ayrıca saklanmalı.
