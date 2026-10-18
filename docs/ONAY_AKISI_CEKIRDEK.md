# SAHAPRO YZ2 — Onay Akışı Çekirdeği (yz2-akis-cekirdek dalı)

**Durum: laboratuvar.** Bu çekirdek tek cihazlı iş-kuralı deneyidir; "çok kullanıcılı sistem tamamlandı" anlamına GELMEZ.
Gerçek ayrı cihazlı şoför/ofis/yönetici sistemi, aynı kuralların sunucuya taşındığı sonraki fazdadır.
Tarayıcı tarafındaki hiçbir kontrol sunucu taraflı yetkilendirme sayılmaz.

**Bu turdaki değişiklik (SP1 bağlantısı):** mevcut şoför uygulamasının ürettiği GERÇEK SP1 mesajı artık
lab ekranına yapıştırılıp lab onay akışına alınabiliyor. Bağlantı **yalnız laboratuvara** yapıldı:
ana asistanın kayıt yolu, ana veritabanı şeması (`sahapro_yz2_db`, v5) ve ana uygulamanın şoför
bağlantı kayıtları (`security.js` / `driver_links`) bu turda DEĞİŞMEDİ.

## Dosyalar

| Dosya | Görev |
|---|---|
| `js/flow-core.js` | SAF durum makinesi: geçiş tablosu, guard'lar (T3 medya kapısı dahil), op-key kararları, revizyon geçersizleştirme, iptal koruması. I/O yok. |
| `js/flow-sp1.js` | SAF SP1 katmanı: paket kapısı (imza/bağlantı/personel/süre/iptal), entry→alan dönüşümü, zarf kaydı. Gerçek üretici/doğrulayıcı yardımcılarını yeniden kullanır. |
| `js/flow-store.js` | IndexedDB depolama adaptörü (`sahapro_yz2_flowlab`, şema **v2** — ana veritabanından AYRI). Tek-transaction yazımlar. |
| `js/flow-identity.js` | Kimlik/yetki adaptörü sözleşmesi + LabIdentity (güvenlik DEĞİL; aktör etiketi). |
| `js/flow-service.js` | Orkestrasyon: SP1 alımı, manuel alım, zarf zinciri, medya eşleştirme, geçişler, düzeltme, atomik onay, red/iptal, fork, yeniden deneme, lab bağlantıları. |
| `lab.html` + `js/flow-lab-ui.js` | İzole laboratuvar ekranı (yalnız lab DB; ana asistan kayıt yoluna DOKUNMAZ). |
| `tests/flow-core.test.mjs` | 15 saf kural testi. |
| `tests/flow-service.test.mjs` | 19 kabul senaryosu (fake-indexeddb; gerçek transaction anlambilimi). |
| `tests/flow-sp1.test.mjs` | 10 SP1 senaryosu: gerçek `driverMessage` üretimi + gerçek HMAC ile uçtan uca (node). |
| `tests/flow-browser-harness.html/.js` | Tarayıcı test köprüsü (uygulamanın parçası değil; ASSETS'e girmez). |
| `tests/flow_browser_test.py` | 8 gerçek tarayıcı senaryosu: Playwright + gerçek IndexedDB, iki GERÇEK sekme aynı DB'de. |
| `tests/flow_sp1_browser_test.py` | 10 SP1 tarayıcı senaryosu (T1–T10): gerçek şoför mesajı, iki sekme yarışları, ana-uygulama davranış probu, çevrimdışı akış. |

## Durum / geçiş tablosu

```
taslak → gönderildi → kontrolde → onay_bekliyor → onaylandı
                     kontrolde → düzeltme_istendi → kontrolde (yeni revizyon)
                     kontrolde → reddedildi · onay_bekliyor → reddedildi
                     onaylandı → iptal (bağlı kesinleşmiş kayıt varsa BLOKE)
                     gönderildi → teknik_hata → gönderildi (aynı op-key ile resume)
                     onay_bekliyor → kontrolde (içerik değişti — otomatik, T12)
```

| Geçiş | Kim | Gerekçe | Hangi alanlar değişir | Sürüm beklentisi | Oluşan kayıt | Yeniden denemede |
|---|---|---|---|---|---|---|
| T1 taslak→gönderildi | şoför/sistem | – | – | – | report + değişmez zarf (sources) + rev0 + audit | aynı op-key+içerik → mevcut döner |
| T2 gönderildi→kontrolde | ofis | – | state | expectedVersion | audit | VERSION_CONFLICT |
| T3 kontrolde→onay_bekliyor | ofis | – | state, check{aktör,rev,zaman} | expectedVersion | audit | VERSION_CONFLICT · **medya eksikse ATTACHMENT_MISSING** |
| T4 kontrolde→düzeltme_istendi | ofis | EVET | state | expectedVersion | audit | VERSION_CONFLICT |
| T5 düzeltme_istendi→kontrolde | ofis/sistem | – | state, rev_no+1 | expectedVersion | revision + audit | VERSION_CONFLICT |
| T6 kontrolde→reddedildi | ofis | EVET | state | expectedVersion | audit | terminal; aynı anahtarla farklı içerik → OP_CONFLICT |
| T7 onay_bekliyor→reddedildi | yönetici | EVET | state | expectedVersion | audit | aynı |
| T8 onay_bekliyor→onaylandı | yönetici | – | state, approved | expectedVersion + revNo | **work + ek bağları + approval + audit — TEK TX** | state onaylandı → mevcut work+approval döner |
| T9 onaylandı→iptal | yönetici | EVET | state, work.status | expectedVersion | audit (iş SİLİNMEZ) | finalized bağ varsa CANCEL_BLOCKED |
| T10 gönderildi→teknik_hata | sistem | – | state, last_tech_error | – | audit | – |
| T11 teknik_hata→gönderildi | sistem | – | state | expectedVersion | attachments + audit | tekrar hata → teknik_hata'da kalır |
| T12 onay_bekliyor→kontrolde | sistem | – | state, check.revoked=true | – | audit ×2 | – |

**T8 ek guard'ları:** geçerli (revoke edilmemiş) kontrol şart; kontrol güncel revizyona ait olmalı (`CHECK_STALE`/`REV_MISMATCH`); `allowSameActor=false` iken kontrolü yapan onaylayamaz (`SAME_ACTOR`). Ofis/yönetici ayrımı `makeFlowConfig` ile yapılandırılabilir.

**T3 medya guard'ı (yeni):** kaynağın beyan ettiği ek (SP1'deki `📷n` fotoğraf sayısı → `media.required`)
tamamlanmadan kontrol kapatılamaz: `media.confirmed` kullanıcının açık onayını ve
`media.attached >= media.required` koşulunu birlikte ister; eksikse `ATTACHMENT_MISSING`.
Fotoğraf **sırası** tek başına kesin iş eşleştirmesi sayılmaz — eşleşme onayı kullanıcıya sorulur
(`attachMedia` yalnız `gonderildi`/`kontrolde` durumlarında çalışır ve `confirmed` ancak açık
onayla true olur; SP1-6/T7 kanıtı). Lab ekranında "Kontrolü tamamla" düğmesi bu durumda
devre dışıdır; çekirdek guard'ı ikinci katman olarak yine reddeder.

## İşlem kimliği (op-key) sözleşmesi

```
opKey = enc(tenant) + "/" + enc(linkId) + "/" + enc(entryId)    enc = encodeURIComponent
fingerprint = SHA-256( fingerprintPayload({ fields, entry, attachmentHashes }) )
```

**Ayraç çakışması üretilemez (kanıt):** `encodeURIComponent` `/` karakterini `%2F`'ye çevirir;
kodlanmış bileşen asla ham `/` içermez → anahtardaki `/` yalnız gerçek ayraçtır.
`(tenant="a/b", linkId="c")` ile `(tenant="a", linkId="b/c")` farklı anahtarlar üretir
(testte kanıtlı: `flow-core.test.mjs` "op-key ayraç çakışması"). Bileşen karakterinde kısıt
yoktur; `parseOpKey` birebir round-trip sağlar.

**Fingerprint girdileri (yalnız bunlar) — sözleşme bu turda güncellendi:**
1. `fields` — ofisin gördüğü iş içeriği (tarih, müşteri, şantiye, araç, miktar, birim fiyat...)
2. `entry` — kaynağın ilettiği **ham kayıt nesnesi** (SP1 paketindeki entry'nin kendisi; manuel alımda `null`).
   Entry = iş içeriğidir; teslim **zarfı** (paket/envelope) DEĞİLDİR.
3. `attachmentHashes` — eklerin SHA-256 içerik hash'leri, **sıralı** liste (ek sırası da içeriktir)

- Kimlik (tenant/linkId/entryId) fingerprint'e girmez — o kapsam op-key'dedir.
- **Zarf fingerprint'e GİRMEZ (yeni):** aynı işin başka bir SP1 paketinde (farklı paket kodu,
  farklı okunur metin, yanında başka kayıtlarla) yeniden gönderilmesi gerçek iş içeriği
  değişikliği DEĞİLDİR; dahil edilseydi sahte OP_CONFLICT üretirdi (SP1-3/T3 kanıtı). Zarf
  kanıtları ayrı modellenir (aşağıda "Zarf ve kanıt zinciri").
- **Taşıma meta'sı (alınma/gönderim zamanı, yeniden gönderim sayısı, kanal) fingerprint'e GİRMEZ** —
  yeniden gönderim içeriği değiştirmez (H16 kanıtı; çekirdek testi `_code`/`_sig`/`rawText`/`envelope`
  dahil 8 meta anahtarının payload'a sızmadığını doğrular).
- Miktar/müşteri/**ek içeriği veya ek sırası**/entry içeriği değişince aynı op-id ile sessiz kabul YOK:
  fingerprint değişir → `OP_CONFLICT` (H2/H15/SP1-4/T4 kanıtı).
- Aynı anahtar + aynı içerik → mevcut sonuç döner (idempotent; ikinci kayıt ASLA).
- Farklı gerçek işler alanları birebir aynı olsa bile ayrı kayıt (H10).
- "Farklı kayıt olarak aç" eski anahtarı AŞAMAZ: yeni kimlik + gerekçe + `related_to` ilişkisi (`forkAsNewJob`).
- Unique zorlama veritabanında: `reports.op_key`, `works.op_key`, `approvals.op_key`, `sources.code_hash`
  unique indeks — yarışta ikinci yazım ConstraintError → abort → mevcut döner.
- Hash yalnız **bütünlük karşılaştırmasıdır** — yetkilendirme veya değişmezlik garantisi DEĞİLDİR.

## SP1 paket alımı (yeni)

Mevcut şoför uygulamasının GERÇEK üreticisi (`driver-core.driverMessage`) ile üretilmiş mesaj lab
ekranına yapıştırılır; lab, mesajı **ana uygulamadan bağımsız** doğrular:

- Lab, ana uygulamanın gizli bağlantı listesine (`driver_links`) veya ana veritabanına **bakmaz**.
- Lab bağlantı kayıtları ve imza anahtarları yalnız lab veritabanının `links` store'unda yaşar;
  üretim anahtarı koda **gömülmez** (her anahtar bu cihazda, bu lab için üretilir).
- SAF yardımcılar yeniden kullanılır (`driver-core.js`, `security-core.js`); import zinciri
  yan etkisizdir (modül düzeyinde DOM/IndexedDB/ağ yok — zincir: driver-core → core.js, ikisi de saf).

**Paket kapısı (sıralı; kapı geçilemezse hiçbir entry işlenmez, rapor AÇILMAZ, okunur metinden
alternatif iş ÜRETİLMEZ; red kanıtı `rejections` store'una yazılır):**

| Sıra | Kontrol | Red kodu |
|---|---|---|
| 1 | `lid` + imza var mı | `SP1_UNSIGNED` |
| 2 | bağlantı lab'da tanınıyor mu | `LINK_UNKNOWN` |
| 3 | bağlantı iptalli / süresi dolmuş mu | `LINK_REVOKED` / `LINK_EXPIRED` |
| 4 | HMAC imzası bağlantı anahtarıyla tutuyor mu | `SP1_BAD_SIGNATURE` |
| 5 | bağlantının personeli paketin personeli mi | `SP1_PERSONNEL_MISMATCH` |

Kapıyı geçen paket **otomatik onaylanmaz**: her iş kaydı (`k` yok/`'w'`) ayrı bildirim olarak
`gonderildi` durumunda açılır; gider/bakım/yakıt kayıtları `skipped_kind` olarak atlanır (iş
üretilmez). Metindeki miktar (`q`) ile fiş tonajı (`ton`) **ayrı alanlardır** — biri diğerinin
üzerine yazılmaz (SP1-7). Kalıcı işlem anahtarı kapsamı tenant/bağlantı/entry'dir (paket veya
gönderim kapsamı DEĞİL): A+B paketi ardından B+C paketi geldiğinde B çiftlenmez, C yeni açılır
(SP1-3/T3).

**Dürüstlük sınırı:** imza doğrulaması yalnız "mesajı gönderenin bağlantı anahtarına sahip
olduğunu" gösterir. Gerçek kişi kimliğini veya işin gerçekten yapıldığını KANITLAMAZ; ekranda
ve kayıtlarda bu şekilde sunulmaz.

## Zarf (envelope) ve kanıt zinciri (yeni)

- Her teslim zarfı `sources` store'unda **değişmez** saklanır: ham SP1 mesajının tamamı
  (`raw_text`), paket kodu, kod özeti (`code_hash`, unique), imza durumu, bağlantı/personel
  beyanı, entry sayısı, alınma zamanı.
- Rapor ile zarf **ayrı modellenir:** raporda `source_ids[]` listesi + `entry_index` (paket içi
  sıra — kayıt amaçlıdır, işe eşleşme kanıtı DEĞİLDİR).
- Aynı iş **farklı zarfla** tekrar gelirse: içerik aynı → yeni rapor YOK; yeni zarf raporun kanıt
  zincirine eklenir (`attachEnvelope`, audit'e `yeniden_gonderim` düşülür; içerik/version alanları
  korunur — yalnız `source_ids` uzar). Aynı zarf (aynı `code_hash`) tekrar gelirse hiçbir şey
  yazılmaz (SP1-8/SP1-10 kanıtı).
- Onaylanmış bildirim yeniden gönderilirse aynı lab işine yönlendirilir (`existing` + aynı
  `workId`); durum geri alınmaz (SP1-8).

## Kaynak ve revizyon

- Ham paket/zarf `sources` store'unda DEĞİŞMEZ saklanır; alım anında `fingerprint` hesaplanır
  (girdisi entry'dir, zarf değil). Hash, değişmezliğin **tespit** aracıdır; tek başına garanti diye
  sunulmaz (veritabanı yazma yetkisi olan hash'i de güncelleyebilir — asıl garanti sunucu fazında
  ayrıcalıklı yazım + audit zinciri olacak).
- Ofis düzeltmeleri kaynak üzerine yazılmaz: her düzeltme yeni `revisions` satırıdır; değişen her
  alan **eski → yeni** değeriyle (`changes`) ve **gerekçeyle** (`reason`) işlenir — yönetici hangi
  revizyonu onayladığını ve kimin neyi neden değiştirdiğini görür (SP1-9).
- Onay kaydı: kaynak kimliği (`report_id`, `op_key`) + incelenen revizyon (`rev_no`) + onaylanan
  alanların snapshot'ı + aktör + zaman.
- İçerik değişimi eski kontrolü geçersizleştirir (`check.revoked`); `onay_bekliyor`'da değişiklik
  T12 ile otomatik `kontrolde`'ye düşürür — onay yeniden gerekir.

## Atomiklik ve ekler (yerel deney)

- Ek hazırlığı (SHA-256, boyut) transaction **dışında** ve rapor açılmadan **önce** (`prepareAttachment`) — hash'ler fingerprint'e girdiği için karar anında hazır olmalı. Biçimi bozuk ek (Uint8Array olmayan) `PACKET_INVALID`'dir: rapor hiç açılmaz, yarım kayıt kalmaz (H13b).
- Ek baytlarının **yazımı** rapor açıldıktan sonra ayrı tx'te; yazım patlarsa rapor T10 ile `teknik_hata` (iş reddi DEĞİL), aynı paketle yeniden deneme T11 ile resume eder (H13).
- Onay finalize'ı: iş + ek ilişkilendirme + onay + durum + audit **tek IndexedDB transaction**'ı; herhangi adım patlarsa abort → yarım iş/bağsız ek kalmaz (H6/H7, tarayıcı S5/S6).
- Hata sonrası durum `onay_bekliyor` kalır; yeniden deneme aynı op-key ile devam eder.
- SP1 paketleri bayt taşımaz (fotoğraflar WhatsApp'ta ayrı gelir); medya eşleştirme ofis adımıdır
  ve yukarıdaki T3 medya guard'ına tabidir. Eşleştirilen ekler `origin: "ofis-eslestirme"` ile
  kaynak paketi eklerinden (`origin: "kaynak"`) ayrı işaretlenir.

**Geç kalan hata yazımı yarış koruması:**
- `approve` başarısız olduğunda atılan `last_tech_error` notu koşulludur: kayıt bu arada `onaylandi`/`iptal` olduysa (yarışı başka sekme kazandı) not **yazılmaz**; kazanan işlem asla `teknik_hata`'ya düşürülemez, kaydı kirlenmez (H17).
- Durum/sürüm, başarısız tx'in gördüğünden ilerlediyse (düzenleme/başka geçiş) not yine yazılmaz — bayat hata güncel kaydın bağlamı değildir.
- `markTechError` isteğe bağlı `expect {state, version}` kontrolü alır; uyuşmazsa SKIP (H18). Final durumlara her koşulda dokunmaz.

**İleride (sunucu + dosya deposu ayrıyken):** hazırlanmış yükleme → doğrulanmış dosya kimliği/hash → sunucuda atomik "iş kesinleştirme" → sahipsiz yükleme temizliği (zaman aşımı süpürmesi). Dosya deposu ile SQL'in TEK transaction olduğu iddia edilmez; kesinlik, sunucudaki kayıt transaction'ı + hash doğrulaması + orphan GC ile sağlanır.

## Onay sonrası iptal

- Onaylanmış işin finansal etkileri (hakediş/tahsilat/stok/yakıt) **bu turda kapsam dışıdır**; çekirdek yalnız `works.finalized_links` üzerinden "kesinleşmiş bağlı kayıt var mı?" kontrolü yapar.
- Bağlı kesinleşmiş kayıt varsa iptal `CANCEL_BLOCKED` — ters kayıt/revizyon süreci ayrıca tasarlanacak.
- Bağ yoksa iptal gerekçeli yazılır; iş kaydı silinmez, `status=iptal` + audit. **Yalnız status yazıp geçmek bu modelde yoktur** — gerekçe ve aktör zorunludur.
- Lab'dan ana uygulamanın iş/hakediş/tahsilat/stok/yakıt store'larına **hiçbir yazma yoktur**
  (davranış kanıtı: T9 probu — aşağıda).

**Dürüstlük notu (CANCEL_BLOCKED testi):** H12'deki `finalized_links` kaydı test tarafından
**elle** yazılır (lab simülasyonu). Bu, gerçek hakediş entegrasyonunun testi **değildir** —
çünkü lab'da ana uygulamanın hakediş tablolarına bağlantı yoktur; o bağlantı henüz kurulmadı.
Gerçek entegrasyonda `canCancel`'a giden `finalizedCount`, lab alanı yerine ana veritabanının
hakediş/tahsilat store'larından **depolamadan okunarak** sayılacak (sorgu: `work.op_key` veya
`work.id` üzerinden `status === "Kesinleşti"` kayıtlar). Bu sorgu entegrasyon turunda
yazılacak; bu rapor o sorgunun çalıştığını iddia etmez.

## Veri modeli (lab DB: `sahapro_yz2_flowlab`, şema v2)

| Store | keyPath | İndeksler | İçerik |
|---|---|---|---|
| reports | id | op_key (UNIQUE), state | durum, version, rev_no, **source_ids[]**, **entry_index**, **media{required,attached,confirmed}**, fingerprint, check, approved, related_to, last_tech_error |
| revisions | id | report_id | rev_no, fields (tam snapshot), **changes{alan:{from,to}}**, **reason**, edited_by, at |
| approvals | id | report_id, op_key (UNIQUE) | rev_no, snapshot, actor_id, role, at |
| works | id | op_key (UNIQUE), report_id | fields (onay snapshot'ı), source_rev, status, finalized_links, cancelled |
| attachments | id | report_id, work_id | hash, size, bytes, name, **origin** (kaynak / ofis-eslestirme) |
| audit | id | report_id | actor_id, role, action, from→to, reason, at |
| **sources** (v2) | id | code_hash (UNIQUE; null indexe girmez) | kind (sp1/manual), raw_text (DEĞİŞMEZ), code, sig_status, link_id, personnel beyanı, entry_count, received_at |
| **links** (v2) | lid | – | LAB şoför bağlantıları + imza anahtarları (yalnız lab'da üretilir/saklanır) |
| **rejections** (v2) | id | – | reddedilen paket kanıtı: reason_code, reason, link/personel beyanı, code_hash, at |

## Şema geçiş ve SABİT geri dönüş planı

**Şimdi:** bu dal ana veritabanının şemasına (`sahapro_yz2_db`, v5) hiç dokunmaz; akış verisi
ayrı lab veritabanında (`sahapro_yz2_flowlab`) kalır. Lab şeması bu turda **v1 → v2** yükseldi:
yalnız 3 store eklendi (`sources`, `links`, `rejections`); yükseltme kodu her store'u
`objectStoreNames.contains` kontrolüyle kurar — mevcut store'lara ve kayıtlara yazmaz.
v1 lab tabanında yalnız TEST verisi vardı; gerçek kayıt taşınması söz konusu değildir (lab verisi
her durumda atılabilir deney verisidir). Ana uygulama kayıt yolu değişmedi; lab'ın ana uygulamaya
yazmadığı **davranış testiyle** kanıtlanır (T9: senaryolar öncesi/sonrası ana DB store sayıları,
meta anahtarları, localStorage ve Cache API içeriği birebir aynı; yalnız grep sayımı değil).

**Gelecek entegrasyon için karar (iki seçenek, öneri A):**

- **Seçenek A (önerilen) — akış verisi kalıcı olarak AYRI DB'de kalır.**
  Ana DB hiç yükseltilmez → geri dönüş "eski sürüme dönmek" kadar basittir: eski kod yeni
  DB'yi hiç açmaz, akış kayıtları `sahapro_yz2_flowlab`'de dokunulmadan durur.
- **Seçenek B — ana DB'ye salt-ekleme upgrade (v5→v6).**
  9 flow store'u eklenir; mevcut store'lara dokunulmaz (destructive yok).

**Geri dönüş planının sabit kuralları (her iki seçenek için):**

1. **Sürüm düşürme iddiası YOK.** IndexedDB'de veritabanı sürümü düşürülemez; v6'ya çıkmış DB'yi
   v5 bekleyen eski kod açamaz (`VersionError`). Geri dönüş planı sürüm düşürmeye DAYANMAZ.
   (Aynı kural lab DB için de geçerlidir: eski lab kodu v2 tabanını açamaz.)
2. **Eski kodun davranışı tanımlı:** ana DB yükseltilmişse eski sürüm açılışta `VersionError`
   alır; uygulama bunu yakalayıp "uygulama güncellemesi gerekli" ekranı gösterir (sessiz çöküş
   yok). Bu yakalayıcı entegrasyon turunda db.js'e eklenecek — bu dalda YOK, burada vaat de
   edilmiyor, yalnız plan yazılıyor.
3. **Açık eski sekmeler engellenir:** yükseltme `versionchange` olayıyla açık bağlantıları
   kapatmaya zorlar; eski sekme ya kendini kapatır ya da engellenir (`onblocked` döngüsüne
   girmemesi için `close()` + kullanıcıya "yeniden yükleyin" bildirimi).
4. **Güncelleme sonrası oluşan yeni kayıtlar korunur:** Seçenek A'da akış kayıtları ayrı DB'de
   durduğu için ana uygulama geri dönse bile kayıtlar yerinde kalır. Seçenek B'de v6 store'ları
   eski kod tarafından görülmez ama **silinmez**; ileride tekrar güncellenince veri oradadır.
   Hiçbir geri dönüş adımı "telefonun verilerini silmek" değildir — bu çözüm sayılmaz.
5. **Yedek doğrulaması + kontrollü geri yükleme:** entegrasyon öncesi mevcut `.sahapro`
   yedeği alınır; doğrulama = yedeğin geri yükleme ÖNİZLEMESİNDEN (mevcut `previewBackup`)
   geçmesi + kayıt sayılarının raporlanması. Geri yükleme yalnız mevcut kontrollü restore
   akışıyla yapılır; lab DB'nin kendi dışa aktarımı entegrasyon turunda tasarlanır.

**Entegrasyon turunda (bu turda yapılmadı):** SP1 paket alımı bu turda **yalnız laboratuvara**
bağlandı. Ana asistanın SP1 akışının çekirdeğe bağlanması (asistan kartlarının son revizyondan
dolması, "Kaydet" yerine ofis/yönetici geçişleri) ayrı görevdir; ana asistanın mevcut kayıt yolu
bu dalda DEĞİŞMEDİ. İmza kontrolü ana uygulamada security.js'de kalır.

## Çok cihazlı sunucu fazına kalan işler

1. **Sunucu adaptörü:** `FlowStore` arayüzünün HTTP/SQL implementasyonu; tüm guard'ların (canTransition, op-key, canCancel, paket kapısı) sunucuda yeniden koşulması.
2. **Gerçek kimlik:** LabIdentity → oturum/token tabanlı ServerIdentity; şoför tarafında mevcut HMAC bağlantı imzası = "bağlantı anahtarına sahiplik" kanıtı olarak sunucuda doğrulanır (kişi kimliği/işin yapıldığı kanıtı DEĞİL).
3. **Çekim/Gönderim:** şoför cihazında giden kuyruğu (taslak→gönderildi gerçek ağ ile), ofis/yönetici cihazlarında bekleme listesi eşitlemesi; çevrimdışı kuyruk + çakışma çözümü (op-key sözleşmesi hazır).
4. **Dosya deposu:** yukarıdaki 4 adımlı desen (prepared upload → verify → finalize → GC). SP1 medya eşleştirmesinin gerçek fotoğraf baytlarıyla yapılması da bu fazdadır (bu turda TEST baytları).
5. **Bildirim:** reddedilen/düzeltme istenen bildirimin şoföre dönüşü (ilk sürümde WhatsApp'tan elle hazır metin).
6. **Kota/fiyat doğrulaması:** seçilecek servisin ücretsiz katman koşulları kurulum günü resmi sayfasından tarihli doğrulanır; bu raporda rakam yoktur.
7. **Finansal etki:** onaylı işin hakediş/tahsilat bağlantısı ve iptalde ters kayıt süreci.
8. **OCR:** fiş/fotoğraftan miktar okuma bu turda kapsam dışıdır; metin ile fiş değerleri ayrı alanlarda taşınır, biri diğerinin üzerine yazılmaz.

## Test envanteri (dosya / girdi / iş senaryosu ayrı)

Assert sayısı kalite ölçütü değildir; aşağıda dosya, girdi ve senaryo ayrı listelenir.

**node (sahte depolama: fake-indexeddb — gerçek tx anlambilimi, gerçek tarayıcı değil):**

| Dosya | Test | İş senaryosu |
|---|---|---|
| `tests/flow-core.test.mjs` | 15 | kapalı geçiş tablosu, rol disiplini, gerekçe, T8 guard'ları, teknik hata≠red, op-key biçim+çakışma kanıtı, kararlı serileştirme, fingerprint sözleşmesi (entry+zarf ayrımı, 8 meta anahtarı sızıntı kontrolü), opKeyDecision, fork, alan kilidi, geçersizleştirme, sürüm, iptal koruması |
| `tests/flow-service.test.mjs` | 19 | H1–H12 kabul senaryoları + H13/H13b teknik hata & bozuk ek + H14 fork + H15 ek içerik/sıra çakışması + H16 taşıma meta'sı + H17/H18 geç kalan hata yarışı (H8: ham kaynak artık sources store'dan doğrulanır) |
| `tests/flow-sp1.test.mjs` | 10 | SP1-1 geçerli paket (2 ayrı bildirim, ortak zarf, otomatik onay yok) · SP1-2 altı kapı reddi (imzasız/tanınmayan/iptalli/süresi dolmuş/bozuk imza/yanlış personel; 0 rapor, 6 red kanıtı) · SP1-3 A+B→B+C zarf zinciri · SP1-4 içerik değişimi OP_CONFLICT · SP1-5 iş dışı kayıt atlama · SP1-6 medya kapısı + onaylı eşleşme · SP1-7 q/ton ayrı alanlar · SP1-8 onay sonrası tekrar gönderim → aynı iş · SP1-9 düzeltme eski→yeni+gerekçe · SP1-10 okunur metin kurcalanmış aynı kod |

**gerçek tarayıcı (Playwright + Chromium, gerçek IndexedDB, iki GERÇEK sekme aynı DB):**

| Dosya | Senaryo | Sonuç |
|---|---|---|
| `tests/flow_browser_test.py` | S1 eşzamanlı alım, S2 eşzamanlı onay, S3 onay+düzenleme yarışı, S4 kapanış/açılış, S5 abort→retry, S6 yarım iş yok (audit+work), S7 tamamlanmış işlem tekrarı | 8/8 PASS (2026-10-18 koşusu) |
| `tests/flow_sp1_browser_test.py` | T1 gerçek SP1 kabul, T2 altı kapı reddi, T3 A+B→B+C, T4 OP_CONFLICT, T5 iki sekme tek bildirim, T6 iki sekme tek iş, T7 eksik ek→aynı op, T8 kapanış kalıcılığı, T9 ana uygulama davranış probu (ana DB sayıları + meta + localStorage + Cache API birebir aynı), T10 çevrimdışı uçtan uca SP1 akışı | 10/10 PASS (2026-10-18 koşusu) |

- Tarayıcı girdileri de `TEST-` etiketli örnek paketlerdir; testler kendi lab DB'lerini (`flowlab_bt_*`, `flowlab_sp1_*`) siler.
- T9'daki ana-uygulama probu **davranış kontrolüdür** (dosya/grep taraması değil): prob ana DB'yi
  salt-okunur açar, tüm store'ların kayıt sayılarını + meta anahtarlarını + localStorage'ı + Cache
  API içeriğini önce/sonra birebir karşılaştırır; tarayıcıya eklenen tek veritabanı `flowlab_sp1_*`
  olmalıdır.
- **Hata enjeksiyonu katmanı:** `failAt` kancası (`'attachments'` alım ek yazımı; `'work' | 'attachment' | 'approval' | 'audit'` finalize) tx **içinde** bilinçli hata fırlatır. Üretim yolu bu kancayı kullanmaz; varlığı abort anlambilimini kanıtlamak içindir.
- Sahte-depolama ile gerçek tarayıcı sonuçları ayrı raporlanır: **node 109/109** (65 mevcut + 15 çekirdek + 19 servis + 10 SP1), **tarayıcı 8/8 + 10/10**. Ana uygulamanın sertleştirme regresyonu (`tests/hardening_browser_test.py`) bu değişikliklerle yeniden koşuldu: **11/11** (hoş geldin ekranı tek başına regresyon sayılmamıştır; 11 senaryonun tamamı gerçek asistan/güvenlik/yedekleme/çevrimdışı akışlarıdır).

## Veri temizliği ve geri dönüş (bu dal)

- **Lab verisi:** lab ekranındaki "Lab veritabanını sil" veya `indexedDB.deleteDatabase("sahapro_yz2_flowlab")`. Ana veritabanına hiç yazılmadı (davranış kanıtı: T9 probu; ayrıca `flow-*.js` ve lab ekranı yalnız `FLOW_DB_NAME`/`?db=` kullanır).
- **Kod geri dönüşü:** dal birleştirilmezse hiçbir şey değişmez; birleştirilip vazgeçilirse tek merge commit'i geri alınır. SW cache adı `yz2-solo-v1-20261018-akis-sp1-1` — birleştirme öncesi tekrar gözden geçirilir.
- **Test verisi:** tüm senaryolar `TEST-` etiketli örnek paketlerle çalışır; gerçek kayıt taşınmadı.
  Lab bağlantı anahtarları yalnız lab DB'de üretilir/saklanır; hiçbir üretim anahtarı koda gömülmedi.
