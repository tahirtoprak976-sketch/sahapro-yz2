# v3.9.02 doğrulama sonuçları

17 Ekim 2026, izole yerel geliştirme ortamı.

- `node --test tests/*.test.mjs`: 65 test girdisi PASS,0 FAIL. Önceden gelen54 test dosyasının her biri bir giriş, yeni hardening-redteam dosyası11 test oluşturur. Toplam55 adet .test.mjs dosyası vardır.
- `python tests/hardening_browser_test.py`:11/11 Chromium akışı PASS.
- `python tests/hardening_upgrade_test.py`:v3.9.01→v3.9.02 gerçek Service Worker yükseltmesi PASS; eski kilitli iş, alias ve şoför bağlantısı aynı kaldı.
- Altın set:80 mesaj,369 ölçülen alan,0 sessiz yanlış,0 satır-sayısı hatası.756 mutasyon kontrolü,0 sessiz yanlış. Bunlar projeyle gelen kümedir; bağımsız gerçek dünya doğruluğu yüzdesi değildir.
- JS sözdizimi, tüm Service Worker varlıklarının varlığı, ZIP CRC, kaynak SHA256 ve değişiklik boşluk kontrolü doğrulandı.

Yeni red-team kapsamı: dahil/hariç, %0, oran/onay eksikliği, geçersiz miktar/fiyat, gizli şoför yedeğinin açık dışa çıkamaması, GCM değişikliği ve yanlış şifre, küçük yanlış sayılar, metrik etiket değişimi, sahte kanıt kimliği,100 eşzamanlı adapter çağrısı, sayaç bozulması, izin iptali, Türkiye günü, JSON retry tavanı, aşırı istek/yanıt, bozuk JSON, süre aşımı ve geçersiz fiyat başlangıcı.

Tarayıcı kapsamı: gerçek asistan formu KDV ön kontrolü ve onay iptali; %0 kaydı; tarihli fiyat kuralı ve eski snapshot korunması;30 eşzamanlı IndexedDB rezervasyonu; iki sekmede ortak tavan; AI'ın model metnindeki tutarı özete taşıyamaması; gerçek DB'den şifreli yedek; geçerli/bozuk/iptal/tanınmayan/imzasız şoför denetimleri ve AI fallback engeli; ayar/kasa/AI/danışman ekranı;20 Enter olayında tek parola denemesi; çevrimdışı yeni modül yüklemesi.

Gemini yanıtları testlerde taklit edildi. Gerçek API'ye ücretli çağrı yapılmadı. Fiziksel Android/iPhone/Safari, çok büyük işletme arşivi, uzun süreli kullanım, bağımsız pentest ve tüm karma işlem atomikliği kabul edilmiş sayılmaz.

Kaynak/test paketindeki tarayıcı testleri Python Playwright ve /usr/bin/chromium ister. Upgrade testi önceki kaynak klasörünü /workspace/review3901/SAHAPRO_SOLO_v3.9.01/sahapro-cep-temp altında bekler; başka ortamda OLD yolunu önceki kaynaklara göre ayarlayın. Veriler TEST_ etiketli ayrı tarayıcı/test DB'sindedir; gerçek telefon DB'sinde test çalıştırmayın. Kanıtlar /workspace/SAHAPRO-v3.9.02-kanitlar dizinine yazılır.
