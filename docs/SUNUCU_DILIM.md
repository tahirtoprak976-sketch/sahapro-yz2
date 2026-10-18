# SAHAPRO YZ2 — İlk Ortak Sunucu Dilimi: Mimari ve Sözleşme

> Durum: **yerel geliştirme dilimi, taslak PR**. Canlı yayın yok, dış hesap yok, gerçek veri yok.
> Bu dilimde hakediş, tahsilat, OCR ve AI YOK. SOLO deposuna dokunulmadı; YZ2 ana kayıt yolu
> (IndexedDB ana kayıt) değiştirilmedi — sunucu dilimi ayrı ekran (`sunucu.html`) ve ayrı dalda.

## 1. Teknoloji tercihi ve gerekçe

**Seçim: Supabase bileşen seti (PostgreSQL + GoTrue + PostgREST) — yerel, hesapsız doğrulandı.**

Değerlendirilen gereksinimler ve karşılıkları:

| Gereksinim | Karşılık |
|---|---|
| İlişkisel veri + transaction | PostgreSQL: iş+onay+durum+audit tek DB transaction'ında (0030_rpc.sql `approve_report`) |
| Gerçek oturum | GoTrue (supabase/auth): parola girişi, imzalı JWT, refresh token |
| Şirket/kullanıcı yetkisi sunucuda | RLS SELECT politikaları + SECURITY DEFINER RPC'ler; rol `memberships` tablosundan okunur |
| İleride dosya deposu | Supabase Storage aynı hesapta (bu dilimde kurulmadı; tasarım notu §6) |
| Web uygulamasıyla uyum | PostgREST REST/RPC: tarayıcıdan düz `fetch` yeterli (SDK şart değil) |

Somut engel görülmediği için alternatif üretilmedi. Dış servis hesabı AÇILMADI; üç bileşen de
yerel makinede gerçek hâliyle koştu (`tests/server_local_stack.py`).

## 2. Kimlik ve yetki modeli

- Kimlik: GoTrue JWT (`sub` = kullanıcı). PostgREST JWT'yi paylaşılan sırla doğrular,
  `request.jwt.claims`'e koyar; `auth.uid()`/`auth.role()` buradan okur.
- **İstemciden gelen `user_id`/`role`/`tenant_id`/`approved_by` hiçbir yerde okunmaz.**
  Tenant, şoförün `memberships` kaydından türetilir; aktör JWT'den gelir.
- Okuma: RLS SELECT politikaları (ofis/yönetici şirket kayıtları; şoför **yalnız kendi**
  bildirimleri). Yazma: tablolarda insert/update/delete politikası ve GRANT **yok** — tüm
  yazmalar SECURITY DEFINER RPC'lerde, her biri `auth.uid()` + üyelik kontrolünü açıkça yapar.
- `anon` rolüne hiçbir hak yok → oturumsuz istek 401 (test: S10/B10).
- Şirketler arası sızıntı yok: kayıt yoksa da yetkisizse de **tek tip 403**
  (`FORBIDDEN: kayıt yok veya erişim yok`) — varlık bilgisi sızmaz (test: S9/B9).
- Kontrolü yapanın onaylaması **şirket politikasıdır**: `tenants.allow_same_actor_check_approve`.
  Kapalıysa `SAME_ACTOR` hatası (test: EkB1/B2).

## 3. Kayıt bütünlüğü (sunucuda)

Lab çekirdeğindeki (js/flow-core.js) saf durum makinesinin SQL yansıması — aynı durumlar,
aynı geçişler, aynı op-key/fingerprint girdileri:

| Kural | Lab (flow-core) | Sunucu (0030_rpc.sql) |
|---|---|---|
| Gönderim idempotent | op_key + fingerprint | `unique(tenant_id, op_key)` + `submit_work` → `created`/`existing`/`resubmitted`/`OP_CONFLICT` |
| Versiyon kontrolü | expected_version | her geçişte `VERSION_CONFLICT` |
| Geçerli durum geçişi | durum makinesi | her RPC'de `BAD_STATE` kontrolü |
| T12: onay beklerken düzeltme | kontrol geçersiz | `edit_report` → `kontrolde` + `check_revoked` + audit `kontrol_gecersiz` |
| Onay taze kontrole bağlı | checked_rev | `approve_report` → `REV_MISMATCH` / `CHECK_STALE` |
| Tek iş | tekil onay | `works.report_id` UNIQUE + `unique(tenant_id, op_key)` + advisory lock |
| Audit | olay günlüğü | `audit` tablosu, her geçişte satır |

Eşzamanlılık: `pg_advisory_xact_lock` (gönderimde tenant+op_key, geçişlerde report_id).
İki yönetici eşzamanlı onaylasa **tek iş** oluşur; ikinci çağrı `existing` + aynı work_id döner
(test: S6/B6). Transaction ortasında hata olursa ne iş ne onay kalıntısı kalır (test: S12).

## 4. Çevrimdışı gönderim kuyruğu (istemci)

`js/sunucu-client.js`: IndexedDB `sahapro_yz2_srv/outbox`, anahtar `op_id` (crypto.randomUUID).
Durumlar: **Telefonda bekliyor → Gönderiliyor → Sunucu aldı → Düzeltme istendi / Onaylandı / Reddedildi**.

- **"Sunucu aldı" ≠ "Onaylandı"**: sunucu_aldi yalnız kabul demektir; onay ayrı durumdur.
- Ağ koparsa kayıt kuyrukta kalır; yeniden deneme **aynı op_id** ile → sunucu `existing` döner,
  ikinci bildirim açılmaz (test: B5: yanıt gerçekten sunucuda işlenip istemciye dönmedi hâli).
- Kuyruk yeniden başlatmada korunur (IndexedDB; test B5b reload). **Vaat sınırı:** web
  uygulaması kapalıyken arka planda gönderim YOK — kuyruk ancak uygulama açıkken boşalır.

## 5. En küçük ekranlar

`sunucu.html` + `js/sunucu-ui.js`: üç ayrı panel (üyeliğe göre gösterim — **gösterim yetki
değildir**, yetki sunucuda denetlenir):

- **Şoför**: örnek iş formu → kuyruğa al ve gönder → durum listesi (gerekçeli düzeltme akışı dahil)
- **Ofis**: bekleyenler (yeni/kontrolde/düzeltme) → detay (alanlar + revizyon izi) → düzelt
  (sebep zorunlu) → kontrolü tamamla / düzeltme iste
- **Yönetici**: onay bekleyenler → kontrol edilmiş revizyon bilgisi → onayla / reddet (sebep zorunlu)

Yalnız TEST verisi (araç/müşteri adları TEST- öneki). SOLO/YZ2 verileri sunucuya taşınmaz;
otomatik geçiş yok.

## 6. Bilinçli sınırlar ve notlar

- **Fingerprint kanonikleştirmesi**: sunucu `jsonb_build_object(...)`'in anahtar-sıralı metninin
  sha256'sını alır; lab tarafındaki JS canonicalStringify ile **bayt-eşitliği iddia edilmez**.
  Fingerprint yalnız sunucuda, sunucunun ürettiği değerlerle karşılaştırılır. Bütünlük
  karşılaştırmasıdır; yetki veya değişmezlik garantisi değildir.
- **Fotoğraf eklenirse**: dosya deposu (Storage) ile SQL kaydı **tek transaction olamaz**.
  Tasarım ayrıca belgelenecek; öngörülen: (1) `reports` satırı `attachments=[]` ve
  `upload_status='eksik'` ile açılır, (2) dosyalar depoya ayrı yüklenir, (3) son dosya
  `attachments` listesini RPC ile işler, (4) yarım kalan yüklemeler ofis ekranında "eksik
  ek" olarak görünür; onay, ek tamamlanmadan engellenebilir (politika). Bu dilimde uygulanmadı.
- **Çok-tenant şoför**: bu dilimde desteklenmez (`AMBIGUOUS_TENANT`); şirket seçimi akışı
  ileride eklenecek.
- **Hosted geçiş** yapılmadı: kotası, yedeklemesi ve maliyeti kurulum günü doğrulanacak;
  "kesin ücretsiz" denmez.
- **Refresh token rotasyonu** GoTrue tarafından yönetilir; istemci 401'de tek kez yeniler.
  Oturum süresi yerelde 8 saat (GOTRUE_JWT_EXP).

## 7. Geri dönüş / temizlik

- Kod: `yz2-sunucu-dilim` dalı taslak PR'da durur; birleştirilmedikçe ana hat etkilenmez.
- Yerel yığın: `python3 tests/server_local_stack.py wipe` — küme, binary'ler, çalışma dizini
  tamamen silinir. Telefon/uygulama verisine dokunmaz (sunucu dilimi ayrı DB'dedir).

## 8. Test kanıtı

- `tests/sunucu_api_test.py` — 33 kontrol: akış + saldırgan (rol aşımı, kiracı aşımı,
  oturumsuz, doğrudan tablo yazımı, SAME_ACTOR, eşzamanlı onay, transaction-ortası hata).
- `tests/sunucu_browser_test.py` — 17 kontrol: üç ayrı browser context, üç gerçek oturum,
  kayıp yanıt sabotajı ve çevrimdışı kuyruk dahil.
- Regresyon: node 58/58 dosya, akış tarayıcı 8/8, SP1 10/10, sertleştirme suitleri —
  temiz dal kopyasında tekrarlandı.
