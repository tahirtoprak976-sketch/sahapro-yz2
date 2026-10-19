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
- Yerel yığın: `python3 tests/server_local_stack.py wipe --evet` — küme, binary'ler, çalışma
  dizini tamamen silinir. **wipe bir geri dönüş çözümü DEĞİLDİR; veri silmedir.** İki koruma
  vardır: açık `--evet` onayı ve `TEST_ORTAMI` işaret dosyası (ikisi de yoksa reddeder).
  Telefon/uygulama verisine dokunmaz (sunucu dilimi ayrı DB'dedir).
- Gerçek geri dönüş = yedekten geri yükleme: `backup` / `restore` komutları (bkz. §9.6).

## 8. Test kanıtı

- `tests/sunucu_api_test.py` — 33 kontrol: akış + saldırgan (rol aşımı, kiracı aşımı,
  oturumsuz, doğrudan tablo yazımı, SAME_ACTOR, eşzamanlı onay, transaction-ortası hata).
- `tests/sunucu_browser_test.py` — 17 kontrol: üç ayrı browser context, üç gerçek oturum,
  kayıp yanıt sabotajı ve çevrimdışı kuyruk dahil.
- Regresyon: node 58/58 dosya, akış tarayıcı 8/8, SP1 10/10, sertleştirme suitleri —
  temiz dal kopyasında tekrarlandı.

## 9. Yayın öncesi güvenlik ve kurulum kapısı (ikinci tur, 2026-10-18)

Bu bölüm yeni özellik EKLEMEZ; mevcut dilimin yayın öncesi kapı kontrollerini ve kanıtlarını
toplar. Testler: `tests/sunucu_rpc_denetim_test.py` (27 kontrol),
`tests/sunucu_oturum_kuyruk_test.py` (13 kontrol), `tests/sunucu_yedek_test.py` (17 kontrol).

### 9.1 Birleştirme sırası (teslimi sabitleme)

PR zinciri: **PR #3** (`yz2-sunucu-dilim` → base `yz2-akis-cekirdek`) ve
**PR #2** (`yz2-akis-cekirdek` → base `gh-pages`). Doğru sıra:

1. **Önce PR #3** birleştirilir → sunucu dosyaları çekirdek dalına tek seferde girer.
2. **Sonra PR #2** birleştirilir → çekirdek + sunucu birlikte gh-pages'e girer.
3. PR #3'ün base'i **asla elle gh-pages'e çevrilmez**: çevrilirse PR #3, PR #2'nin tüm
   commit'lerini de taşır ve PR #2 incelemesi fiilen atlanmış olur.
4. Sunucu dosyaları (`supabase/`, `sunucu.html`, `js/sunucu-*.js`, `tests/sunucu_*`,
   `tests/server_local_stack.py`) yalnızca `yz2-sunucu-dilim` dalında yaşar; başka dala
   elle kopyalanmaz veya cherry-pick edilmez — böylece "çift giriş" olmaz.
5. PR #2 yanlışlıkla önce birleştirilirse GitHub, PR #3'ün base'ini otomatik gh-pages'e
   çevirir; o durumda PR #3 yalnız kalan sunucu dilimini taşır — veri çiftlenmez, ama
   tercih edilen sıra 1→2'dir (inceleme bütünlüğü korunur).

### 9.2 SECURITY DEFINER RPC denetimi (D1–D9)

- **Grant matrisi katalogdan kanıtlı** (pg_proc ACL, grep değil): hiçbir RPC/yardımcıda
  PUBLIC EXECUTE yok (NULL proacl = varsayılan PUBLIC hakkı da dahil); anon hiçbirinde
  yok; `authenticated` yalnız 8 RPC + 2 RLS yardımcısı + 3 auth JWT yardımcısında var;
  iç yardımcılar (`flow_fingerprint`, `jsonb_diff`, `_req_uid`, `_actor_role`,
  `_report_locked`, `_audit`) yalnız sahibinde. Bulgu üzerine `0040_denetim_sertlestirme.sql`
  eklendi: 0010/0020 fonksiyonları `alter default privileges`'tan önce doğduğu için PUBLIC
  EXECUTE ile geliyordu — kapatıldı.
- **Yetki kaynağı**: tenant/rol yalnız JWT `sub` + `memberships` tablosundan türetilir.
  İstemcinin fazladan gönderdiği `p_user_id`/`p_tenant_id`/`p_role`/`p_approved_by`
  parametreleri PostgREST'te imza uyuşmazlığıyla (404/PGRST202) reddedilir (D6).
- **Fonksiyon sahipliği**: public fonksiyonların sahibi HTTP'e açık roller (anon,
  authenticated, authenticator, gotrue) DEĞİL; `authenticator` NOINHERIT'tir — üyelik
  üzerinden sahip yetkisi miras almaz (D2). Yerelde sahip `postgres`'tur ve yalnız
  127.0.0.1 trust ile erişilir; hosted geçişte sahiplik platformundadır.
- **search_path**: tüm public fonksiyonlarda `set search_path = public, pg_temp`
  (pg_temp sonda) sabitlendi (D3). GoTrue'nun kurduğu pgcrypto eklenti fonksiyonları
  kapsam dışıdır (tabloya dokunmazlar).
- **Dinamik SQL yok** (D4, statik tarama): tüm RPC parametreleri bildirim tipindedir;
  `EXECUTE format(...)`/`EXECUTE '…'` kalıbı migration'larda bulunmaz. Bu bir statik
  taramadır; kesinlik iddiası çalışma-zamanı testleriyle (D5–D7) desteklenir.
- **JWT doğrulama gerçek konfigürasyonda**: yanlış imza, süresi dolmuş, yanlış `aud`,
  `alg=none` ve var olmayan `role` claim'i taşıyan token'ların tamamı 401/4xx (D5).
  PostgREST `iss` doğrulamaz — bu bilinen sınırdır; iss güveni imza + aud + kısa exp
  üçlüsüne dayanır.
- **Üyelik kaldırma**: üyeliği silinen kullanıcının ELDEKİ (imzası hâlâ geçerli) JWT'si
  submit'te 403 alır, SELECT'te boş döner (D7) — yetki kararı her çağrıda memberships'tan
  okunur, JWT tek başına yetki vermez.
- **Devre dışı bırakma davranışı (dürüst not)**: GoTrue `banned_until` login ve refresh'i
  reddeder (D8); ancak ban öncesi üretilmiş access token, exp (8 saat) dolana kadar
  kriptografik olarak geçerlidir — JWT stateless'tır, PostgREST ban tablosuna bakmaz.
  **Bir kullanıcıyı etkin devre dışı bırakmanın doğru yolu üyeliği silmektir** (anında
  etkili, D7 ile kanıtlı); ban yalnız yeni token üretimini durdurur.

### 9.3 Oturum ve yerel kuyruk (O1–O4)

- **Kuyruk sahibi kilidi** eklendi: her kuyruk kaydı `owner_email` taşır; başka oturumla
  gönderim istemcide `OWNER_MISMATCH` ile engellenir, listede "şu anki oturum DEĞİL"
  göstergesi çıkar ve Gönder/Sil düğmeleri gizlenir (O3). Bu bir yanlışlık korumasıdır;
  asıl yetki her zaman sunucudadır. Sahipsiz (bu özellikten önceki) kayıtlar bilinçli
  olarak gönderilebilir kalır (O4) — geriye uyumluluk, raporda gizlenmez.
- **Oturum düşerse kuyruk kalır**: access+refresh geçersizleştiğinde uygulama giriş
  ekranına döner ama IndexedDB kuyruğu silinmez; yeniden girişte kayıtlar "bekliyor"
  durumuyla durur ve gönderilebilir (O1).
- **Refresh çift iş açmaz**: kayıp-yanıt sabotajı sonrası süresi dolmuş access token
  refresh ile yenilenir ve aynı `op_id` ile giden yeniden deneme sunucuda `existing`'e
  düşer — tek bildirim (O2). Sunucu tarafındaki tek transaction + unique(tenant,op_key)
  sayesinde.
- **SP1 bağlantı imzası ≠ sunucu oturumu**: SP1 HMAC imzası lab bağlantı anahtarına
  sahiplik kanıtıdır; bu dilimde sunucu kimliği GoTrue JWT'sidir. SP1 paketi sunucuya
  doğrulanmış kimlik olarak SUNULMAZ (lab tarafı da değişmedi).

### 9.4 İki gerçek telefonda en küçük deneme planı (kurulum bu turda YAPILMADI)

Tarayıcı context'leri gerçek ayrı oturumdur ama fiziksel cihaz DEĞİLDİR. Amaç, yalnız şu
akışı iki telefonda canlı görmektir: **şoför gönderir → ofis kontrol eder → yönetici
onaylar → şoför sonucu görür** (+ çevrimdışı gönderim ve tekrar denemede tek kayıt).
Fotoğraf, finans ve SOLO entegrasyonu bu denemenin de kapsamı dışındadır.

1. **HTTPS adresi**: tek hosted Supabase projesi; telefonlara verilen adres
   `https://<proje-ref>.supabase.co` olur. `localhost`/`127.0.0.1` telefonda çalışmaz —
   telefona asla localhost adresi verilmez. YZ2 istemcisi gh-pages önizlemesinden açılır;
   CSP `connect-src` listesine API origin'i eklenir, CORS yalnız o origin'e izin verir.
2. **Gerekli servisler**: yalnız Auth (GoTrue) + Data API (PostgREST) — hosted projede
   hazır gelir. Storage bu denemede gerekmez (fotoğraf kapsam dışı). Migration'lar 0001
   HARİÇ sırayla SQL editöründen uygulanır (roller hosted'da hazırdır; 0001 yalnız
   yereldir), 0040 dahil. Auth ayarları: Site URL telefonların göreceği adrese ayarlanır;
   TEST hesapları için e-posta doğrulaması kapalı/auto-confirm tutulur.
3. **Test kullanıcıları**: tohumdaki 5 TEST hesabı (`test-sofor-1`, `test-ofis-1`,
   `test-yonetici-1/2`, `test-rakip-sofor` @example.invalid, parola tohumda). Telefon 1:
   şoför; telefon 2: ofis + yönetici (üyelikler aynı hesapta toplanabilir; roller yine
   sunucuda denetlenir). Gerçek kişi hesabı açılmaz.
4. **Veri saklama**: sunucu verisi projenin Postgres'inde durur; telefonda yalnız oturum
   JWT'si + IndexedDB kuyruğu kalır (cihazlar arası kopyalanmaz). Yalnız TEST- önekli
   örnek kayıt girilir; gerçek iş verisi GİRİLMEZ. Yedek gerekirse Supabase panelinden
   alınır; istemci yedeğine sır konmaz.
5. **Güncel maliyet/kota** (2026-10-19'da supabase.com/pricing'den doğrulandı; kaynak
   listesi §9.7'de): Free plan = 500 MB veritabanı, 5 GB egress, 50.000 MAU, sınırsız
   API isteği, en çok 2 aktif proje; 1 hafta hareketsizlikte otomatik pause; otomatik
   yedek YOK. "Kesin ücretsiz" denmez — kota ekranı kurulum günü yeniden kontrol edilip
   kaydedilir. Bu denemenin yükü (5 hesap, düşük iki haneli RPC sayısı) sınırların çok
   altındadır.
6. **Kapatma adımları** (deneme bitince): (a) TEST verisi SQL ile temizlenir veya proje
   Settings → Pause ile duraklatılır; tam silme için Delete Project (geri alınamaz — önce
   yedek gerekip gerekmediği sorulur); (b) telefonlarda site verisi (IndexedDB + service
   worker önbelleği) tarayıcı ayarından temizlenir; (c) istemciye konan anon key + API
   URL'si geri alınır (localhost'a döndürülür).
7. **İstemci değişikliği** (kurulum günü, ayrı küçük commit): `js/sunucu-client.js`
   içindeki PGRST/GOTRUE sabitleri hosted adrese çevrilir ve isteklere publishable anon
   key (`apikey` header) eklenir. **service_role, JWT sırrı ve DB parolası istemciye
   ASLA konmaz.** `sw.js` önbellek sürümü bu dağıtımda da artırılır (sw-assets testi
   bunu zorunlu kılar).

### 9.5 Kurulum güvenliği

- **Sabitlenmiş sürümler + sha256**: PostgREST v16.4 ve GoTrue v2.197.0 binary'leri
  `server_local_stack.py` içindeki pinlerle doğrulanır; uyuşmazlıkta kurulum durur
  (fail-closed). İndirme yalnız resmi kanallardandır: GitHub release varlıkları veya
  resmi `ghcr.io/supabase/auth` OCI imajı (bu oturumda GitHub asset CDN'i ağdan
  erişilemezdi; GoTrue binary'si resmi imajdan çıkarıldı ve pini ayrı etiketle yazıldı —
  GitHub asset baytı doğrulanınca ikinci pin eklenecek). Pin sabotaj testi D9'da kanıtlı.
- **Örnek sır kabul edilmez**: jwt_secret çalışma anında üretilir (48 byte url-safe),
  bilinen örnek/placeholder sırlar ve 32 karakterden kısa değerler reddedilir.
- **Dosya izinleri**: `/tmp/yz2srv` 0700; `jwt_secret`, `postgrest.conf`, `gotrue.env`
  0600 (içlerinde sır/parola var).
- **İstek sınırları**: PostgREST `db-max-rows = 1000`; DB düzeyinde `statement_timeout=8s`
  ve `idle_in_transaction_session_timeout=30s` (postgres ve gotrue rolleri muaf).
  PostgREST'in gövde-boyutu sınırı YOKTUR; hosted Data API için de resmî bir gövde bayt
  sınırı doğrulanamadı (2026-10, §9.7) — bu sınır AÇIK kalır. RPC girişlerine eklenebilecek
  alan uzunluğu kontrolü yalnız uygulama seviyesinde bir önlemdir; sunucuya gelen toplam
  istek boyutunu ağ seviyesinde SINIRLAMAZ ve bu açık sınırın yerine geçmez. GoTrue token
  uçlarında yerelde oran sınırı yoktur; hosted'da Auth uçları için resmî IP-başına
  token-bucket oran sınırı vardır (aşımda 429; kaynak §9.7).
- **Loglar**: script sırları basmaz; GoTrue/PostgREST logları parola/token içermez
  (varsayılan seviye). Yedek dosyaları sır içermez ama veri içerir — depoya konmaz.

### 9.6 Yedek ve geri dönüş — kavram ayrımı

| Kavram | Komut | Ne yapar | Geri dönüş mü? |
|---|---|---|---|
| Test ortamı sıfırlama | `seed` | TEST tohumunu yeniden uygular | Hayır |
| Servis durdurma | `down` | postgrest/gotrue durur, veri durur | Hayır (duraklatma) |
| **Yedek** | `backup <dosya>` | pg_dump özel biçim + satır özeti | Yedeğin kendisi |
| **Geri yükleme** | `restore <dosya> <yz2_…>` | Ayrı/boş DB'ye yükler | **Evet** |
| wipe | `wipe --evet` | her şeyi siler (korumalı) | **Hayır — veri silme** |
| İleri-düzeltme | migration tekrarı | idempotent; veriyi bozmaz | Forward-fix |

Kanıt (Y1–Y6): örnek akış (onaylı iş + düzeltme istenmiş rapor) üzerinden alınan yedek,
farklı boş bir DB'ye geri yüklendi; 7 tablonun tamamı satır-satır JSON eşitliğiyle birebir
çıktı; works→reports, approvals→reports, audit→reports zincirlerinde kopuk kayıt yok;
örnek onaylı rapor ve iş aynı kimliklerle duruyor. `wipe` onaysız ve işaretsiz reddedilir.

### 9.7 Resmî kaynaklar ve hosted doğrulama notları (2026-10-19)

Hosted davranışına ilişkin iddialar yalnız aşağıdaki resmî kaynaklara dayanır (hepsi
2026-10-19'da açılıp metinden doğrulandı):

- Oturumlar ve JWT ömrü (varsayılan 1 saat; üstü güvenlik nedeniyle önerilmez; oturum
  sonlandırma koşulları; `session_id` ↔ `auth.sessions` kontrolü):
  https://supabase.com/docs/guides/auth/sessions
- Ban / kullanıcı silme davranışı (geçici ban oturumları iptal ETMEZ; silme
  `auth.sessions`'a cascade eder ama eldeki access token `exp`'e kadar geçerli; iki
  resmî telafi: kısa JWT ömrü + hassas işlemlerde `session_id` kontrolü):
  https://supabase.com/docs/guides/auth/managing-user-data
- JWT alanları, `iss` biçimi (`https://<proje-ref>.supabase.co/auth/v1`) ve JWKS ucu
  (`/auth/v1/.well-known/jwks.json`): https://supabase.com/docs/guides/auth/jwts
- Auth uçları oran sınırları (IP başına token bucket; aşımda 429; varsayılanlar ve
  panelden özelleştirme): https://supabase.com/docs/guides/auth/rate-limits
- Data API yanıt satır üst sınırı (varsayılan 1000; API Settings'ten değişir):
  https://supabase.com/docs/reference/javascript/select
- Plan ücret/kota koşulları: https://supabase.com/pricing

**Free plan, 2026-10-19'da pricing sayfasından doğrulandı:** 500 MB veritabanı, 5 GB
egress, 50.000 MAU, sınırsız API isteği, en çok 2 aktif proje; 1 hafta hareketsizlikte
otomatik pause (panelden elle geri açılır); otomatik yedek yok. **"Session timeouts"
(zaman kutusu / hareketsizlik sonlandırma) ve "Single session per user" Free plana
dahil DEĞİL** — kurulumda bu kontrollere güvenilmez; tek dayanak JWT ömrünün varsayılan
1 saatte tutulmasıdır (hosted varsayılanı zaten 1 saattir; panelden doğrulanması kurulum
checklist'indedir). "Kesin ücretsiz" denmez; kurulum günü kota ekranı yeniden kontrol
edilir.

**Açık kalan sınır (değişmedi):** Data API'ye gelen TEK isteğin gövde bayt üst sınırı
hosted için resmî kaynakla doğrulanamadı. RPC alan uzunluğu kontrolü uygulama
seviyesindedir; toplam istek boyutunu ağ seviyesinde sınırlamaz ve bu sınırın yerine
geçmez. Kurulum günü canlı projede doğrulanacak açık checklist maddesidir.
