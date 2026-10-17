# SAHAPRO YZ2 — Onay Akışı Çekirdeği (yz2-akis-cekirdek dalı)

**Durum: laboratuvar.** Bu çekirdek tek cihazlı iş-kuralı deneyidir; "çok kullanıcılı sistem tamamlandı" anlamına GELMEZ.
Gerçek ayrı cihazlı şoför/ofis/yönetici sistemi, aynı kuralların sunucuya taşındığı sonraki fazdadır.
Tarayıcı tarafındaki hiçbir kontrol sunucu taraflı yetkilendirme sayılmaz.

## Dosyalar

| Dosya | Görev |
|---|---|
| `js/flow-core.js` | SAF durum makinesi: geçiş tablosu, guard'lar, op-key kararları, revizyon geçersizleştirme, iptal koruması. I/O yok. |
| `js/flow-store.js` | IndexedDB depolama adaptörü (`sahapro_yz2_flowlab` — ana veritabanından AYRI). Tek-transaction yazımlar. |
| `js/flow-identity.js` | Kimlik/yetki adaptörü sözleşmesi + LabIdentity (güvenlik DEĞİL; aktör etiketi). |
| `js/flow-service.js` | Orkestrasyon: alım, geçişler, düzeltme, atomik onay, red/iptal, fork, yeniden deneme. |
| `tests/flow-core.test.mjs` | 13 saf kural testi. |
| `tests/flow-service.test.mjs` | 14 kabul senaryosu (fake-indexeddb; gerçek transaction anlambilimi). |

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
| T1 taslak→gönderildi | şoför/sistem | – | – | – | report + değişmez kaynak + rev0 + audit | aynı op-key+içerik → mevcut döner |
| T2 gönderildi→kontrolde | ofis | – | state | expectedVersion | audit | VERSION_CONFLICT |
| T3 kontrolde→onay_bekliyor | ofis | – | state, check{aktör,rev,zaman} | expectedVersion | audit | VERSION_CONFLICT |
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

## İşlem kimliği (op-key) sözleşmesi

```
opKey = tenant + "/" + linkId + "/" + entryId      ör: yz2/lnk_1/e42
fingerprint = SHA-256( canonicalStringify({linkId, entryId, fields, rawText}) )
```

- Aynı anahtar + aynı içerik → mevcut sonuç döner (idempotent; ikinci kayıt ASLA).
- Aynı anahtar + farklı içerik → `OP_CONFLICT` (sessiz üzerine yazma/birleştirme yok).
- Farklı gerçek işler alanları birebir aynı olsa bile ayrı kayıt (H10).
- "Farklı kayıt olarak aç" eski anahtarı AŞAMAZ: yeni kimlik + gerekçe + `related_to` ilişkisi (`forkAsNewJob`).
- Unique zorlama veritabanında: `reports.op_key`, `works.op_key`, `approvals.op_key` unique indeks — yarışta ikinci yazım ConstraintError → abort → mevcut döner.
- **Bilinen sınır:** eklerin bayt içeriği fingerprint'e dahil değildir (ek sayısı gövdededir; hash'leri finalize'da saklanır). Tam bayt düzeyinde kaynak karşılaştırması sunucu fazında.

## Kaynak ve revizyon

- Ham metin/paket `reports.source` altında DEĞİŞMEZ saklanır; alım anında `fingerprint` hesaplanır. Hash, değişmezliğin **tespit** aracıdır; tek başına garanti diye sunulmaz (veritabanı yazma yetkisi olan hash'i de güncelleyebilir — asıl garanti sunucu fazında ayrıcalıklı yazım + audit zinciri olacak).
- Ofis düzeltmeleri kaynak üzerine yazılmaz: her düzeltme yeni `revisions` satırıdır (`rev_no`, `edited_by`, `at`).
- Onay kaydı: kaynak kimliği (`report_id`, `op_key`) + incelenen revizyon (`rev_no`) + onaylanan alanların snapshot'ı + aktör + zaman.
- İçerik değişimi eski kontrolü geçersizleştirir (`check.revoked`); `onay_bekliyor`'da değişiklik T12 ile otomatik `kontrolde`'ye düşürür — onay yeniden gerekir.

## Atomiklik ve ekler (yerel deney)

- Ek hazırlığı (SHA-256, boyut) transaction **dışında** (`prepareAttachment`).
- Onay finalize'ı: iş + ek ilişkilendirme + onay + durum + audit **tek IndexedDB transaction**'ı; herhangi adım patlarsa abort → yarım iş/bağsız ek kalmaz (H6/H7).
- Hata sonrası durum `onay_bekliyor` kalır, `last_tech_error` ayrı tx'te not edilir; yeniden deneme aynı op-key ile devam eder.

**İleride (sunucu + dosya deposu ayrıyken):** hazırlanmış yükleme → doğrulanmış dosya kimliği/hash → sunucuda atomik "iş kesinleştirme" → sahipsiz yükleme temizliği (zaman aşımı süpürmesi). Dosya deposu ile SQL'in TEK transaction olduğu iddia edilmez; kesinlik, sunucudaki kayıt transaction'ı + hash doğrulaması + orphan GC ile sağlanır.

## Onay sonrası iptal

- Onaylanmış işin finansal etkileri (hakediş/tahsilat/stok/yakıt) **bu turda kapsam dışıdır**; çekirdek yalnız `works.finalized_links` üzerinden "kesinleşmiş bağlı kayıt var mı?" kontrolü yapar.
- Bağlı kesinleşmiş kayıt varsa iptal `CANCEL_BLOCKED` — ters kayıt/revizyon süreci ayrıca tasarlanacak.
- Bağ yoksa iptal gerekçeli yazılır; iş kaydı silinmez, `status=iptal` + audit. **Yalnız status yazıp geçmek bu modelde yoktur** — gerekçe ve aktör zorunludur.

## Veri modeli (lab DB: `sahapro_yz2_flowlab`, v1)

| Store | keyPath | İndeksler | İçerik |
|---|---|---|---|
| reports | id | op_key (UNIQUE), state | durum, version, rev_no, source{rawText,received_at}, fingerprint, check, approved, related_to, last_tech_error |
| revisions | id | report_id | rev_no, fields (tam snapshot), edited_by, at |
| approvals | id | report_id, op_key (UNIQUE) | rev_no, snapshot, actor_id, role, at |
| works | id | op_key (UNIQUE), report_id | fields (onay snapshot'ı), source_rev, status, finalized_links, cancelled |
| attachments | id | report_id, work_id | hash, size, bytes, name |
| audit | id | report_id | actor_id, role, action, from→to, reason, at |

## Şema geçiş planı (ana uygulamaya entegrasyonda)

1. Lab DB bağımsız olduğundan mevcut `sahapro_yz2_db` (şema v5) **bu dalda hiç değişmedi** — risk sıfır.
2. Entegrasyon turunda: `SCHEMA_VERSION` 5→6, db.js `upgrade` zincirine yukarıdaki 5 store eklenir (audit_log mevcut — flow audit'i oraya `entity:"inbound_reports"` ile yazılabilir; karar entegrasyon turunda).
3. Mevcut asistan SP1 akışı (assistant.js) intake'e bağlanır: imza kontrolü security.js'de kalır, paket `intakePacket`'e düşer; kartlar `revisions` son revizyonundan dolar; "Kaydet" yerine ofis/yönetici geçişleri.
4. `work_records`'a `source_report_id` + `op_key` kolonları (v6'da); eski kayıtlarda boş — geriye dönük uyumlu.
5. Geri dönüş: v6 upgrade'i salt-ekleme (destructive yok) → eski sürüm v5 DB'yi açamaz; dönüş için `.sahapro` yedeği + eski sürüm (mevcut backup/restore mekanizması değişmeden çalışır).

## Çok cihazlı sunucu fazına kalan işler

1. **Sunucu adaptörü:** `FlowStore` arayüzünün HTTP/SQL implementasyonu; tüm guard'ların (canTransition, op-key, canCancel) sunucuda yeniden koşulması.
2. **Gerçek kimlik:** LabIdentity → oturum/token tabanlı ServerIdentity; şoför tarafında mevcut HMAC bağlantı imzası = "bağlantı anahtarına sahiplik" kanıtı olarak sunucuda doğrulanır (kişi kimliği/işin yapıldığı kanıtı DEĞİL).
3. **Çekim/Gönderim:** şoför cihazında giden kuyruğu (taslak→gönderildi gerçek ağ ile), ofis/yönetici cihazlarında bekleme listesi eşitlemesi; çevrimdışı kuyruk + çakışma çözümü (op-key sözleşmesi hazır).
4. **Dosya deposu:** yukarıdaki 4 adımlı desen (prepared upload → verify → finalize → GC).
5. **Bildirim:** reddedilen/düzeltme istenen bildirimin şoföre dönüşü (ilk sürümde WhatsApp'tan elle hazır metin).
6. **Kota/fiyat doğrulaması:** seçilecek servisin ücretsiz katman koşulları kurulum günü resmi sayfasından tarihli doğrulanır; bu raporda rakam yoktur.
7. **Finansal etki:** onaylı işin hakediş/tahsilat bağlantısı ve iptalde ters kayıt süreci.

## Veri temizliği ve geri dönüş

- **Lab verisi:** `indexedDB.deleteDatabase("sahapro_yz2_flowlab")` (testlerde `deleteFlowDB`). Ana veritabanına hiç yazılmadı.
- **Kod geri dönüşü:** dal birleştirilmezse hiçbir şey değişmez; birleştirilip vazgeçilirse dal `gh-pages`'ten tek merge commit'i geri alınır. SW cache adı `yz2-solo-v1-20261018-akis-lab-1` — birleştirme öncesi tekrar gözden geçirilir.
- **Test verisi:** tüm senaryolar `TEST-` etiketli örnek paketlerle çalışır; gerçek kayıt taşınmadı.
