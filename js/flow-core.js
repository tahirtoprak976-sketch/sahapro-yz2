// SAHAPRO YZ2 — onay akışı çekirdeği (SAF katman).
// Bu dosya hiçbir I/O yapar mı? Hayır: IndexedDB, DOM, ağ, saat ve kimlik burada YOK.
// Tüm iş kuralları saf fonksiyonlardır; yazma/okuma flow-store.js ve flow-service.js'tedir.
// Amaç: kurallar ileride sunucuya AYNEN taşınabilsin — burada ne izinliyse sunucuda da o izinli olacak.
//
// ÖNEMLİ SINIR: Bu çekirdek tek cihazlı laboratuvar içindir. Tarayıcı tarafındaki hiçbir kontrol
// "sunucu taraflı yetkilendirme" sayılmaz. Çok cihazlı sistemde aynı guard'lar sunucuda yeniden koşulur.

// ---------------------------------------------------------------- durumlar
export const STATES = Object.freeze([
  "taslak",            // kaynak cihazda taslak (lab'da paket alımı doğrudan 'gonderildi' açar)
  "gonderildi",        // bildirim alındı, ham kaynak değişmez saklandı, henüz kimse incelemedi
  "kontrolde",         // ofis incelemeye aldı (inceleme kilidi)
  "duzeltme_istendi",  // ofis düzeltme istedi; kaynaktan yeni revizyon bekleniyor
  "onay_bekliyor",     // ofis kontrolü tamam; yönetici onayı bekleniyor
  "onaylandi",         // yönetici onayladı; iş kaydı oluştu (tek sefer, atomik)
  "reddedildi",        // İŞ reddi — insan kararı, gerekçe zorunlu (teknik hatadan ayrı!)
  "iptal",             // onay sonrası iptal; bağlı kesinleşmiş kayıt varsa bloke edilir
  "teknik_hata",       // TEKNİK alım/işleme hatası — iş reddi DEĞİL; aynı op-key ile yeniden denenebilir
]);

export const ROLES = Object.freeze(["sofor", "ofis", "yonetici", "sistem"]);

// ---------------------------------------------------------------- geçiş tablosu
// Her kural: { from, to, roles, reason: gerekçe zorunlu mu }
// Burada OLMAYAN hiçbir geçiş yapılamaz (tablo kapalı dünyadır).
export const TRANSITIONS = Object.freeze([
  { id: "T1",  from: "taslak",          to: "gonderildi",       roles: ["sofor", "sistem"], reason: false },
  { id: "T2",  from: "gonderildi",      to: "kontrolde",        roles: ["ofis"],            reason: false },
  { id: "T3",  from: "kontrolde",       to: "onay_bekliyor",    roles: ["ofis"],            reason: false },
  { id: "T4",  from: "kontrolde",       to: "duzeltme_istendi", roles: ["ofis"],            reason: true  },
  { id: "T5",  from: "duzeltme_istendi",to: "kontrolde",        roles: ["ofis", "sistem"],  reason: false }, // yeni revizyon geldi
  { id: "T6",  from: "kontrolde",       to: "reddedildi",       roles: ["ofis"],            reason: true  },
  { id: "T7",  from: "onay_bekliyor",   to: "reddedildi",       roles: ["yonetici"],        reason: true  },
  { id: "T8",  from: "onay_bekliyor",   to: "onaylandi",        roles: ["yonetici"],        reason: false }, // finalize = tek transaction
  { id: "T9",  from: "onaylandi",       to: "iptal",            roles: ["yonetici"],        reason: true  }, // canCancel guard'ı ayrı
  { id: "T10", from: "gonderildi",      to: "teknik_hata",      roles: ["sistem"],          reason: false },
  { id: "T11", from: "teknik_hata",     to: "gonderildi",       roles: ["sistem"],          reason: false }, // aynı op-key ile yeniden deneme
  { id: "T12", from: "onay_bekliyor",   to: "kontrolde",        roles: ["sistem"],          reason: false }, // içerik değişti → kontrol geçersiz
]);

// Durum başına düzenlenebilir çıkarılmış alanlar.
// Ham kaynak HİÇBİR durumda değişmez; düzeltmeler yeni revizyon olarak saklanır.
export const EDITABLE_FIELDS = Object.freeze({
  taslak: "source",          // kaynak cihaz serbest (lab kapsamı dışı)
  gonderildi: [],            // alıcı taraf salt-okunur
  kontrolde: ["date", "customer_id", "site_id", "vehicle_id", "work_type", "quantity", "unit", "tonnage", "material", "description", "unit_price"],
  duzeltme_istendi: [],      // kaynak cihazdan yeni revizyon bekleniyor
  // onay_bekliyor'da ofis düzeltmesi YAPILABİLİR ama bedeli var: içerik değişimi eski kontrolü
  // geçersizleştirir ve akış T12 ile otomatik kontrolde'ye düşer (E maddesi) — onay yeniden gerekir.
  onay_bekliyor: ["date", "customer_id", "site_id", "vehicle_id", "work_type", "quantity", "unit", "tonnage", "material", "description", "unit_price"],
  onaylandi: [],             // donmuş — düzeltme ancak yeni süreç (iptal/revizyon) ile
  reddedildi: [],
  iptal: [],
  teknik_hata: [],
});

// ---------------------------------------------------------------- hata kodları
export const ERR = Object.freeze({
  TRANSITION_DENIED: "TRANSITION_DENIED",   // tablo izin vermiyor
  ROLE_DENIED: "ROLE_DENIED",               // aktörün rolü bu geçişe yetmiyor
  REASON_REQUIRED: "REASON_REQUIRED",       // gerekçe zorunlu
  VERSION_CONFLICT: "VERSION_CONFLICT",     // beklenen sürüm uyuşmadı (eşzamanlılık)
  FIELD_LOCKED: "FIELD_LOCKED",             // bu durumda alan düzenlenemez
  OP_CONFLICT: "OP_CONFLICT",               // aynı işlem anahtarı + farklı içerik
  OP_KEY_REUSE: "OP_KEY_REUSE",             // "farklı kayıt olarak aç" eski anahtarı aşamaz
  ALREADY_FINAL: "ALREADY_FINAL",           // işlem tamamlanmış — yeniden deneme mevcut sonucu döndürür
  CHECK_STALE: "CHECK_STALE",               // kontrol başka revizyona ait / geçersizleşmiş
  REV_MISMATCH: "REV_MISMATCH",             // onaylanmak istenen revizyon güncel değil
  CANCEL_BLOCKED: "CANCEL_BLOCKED",         // bağlı kesinleşmiş kayıt var — basit iptal yok
  LINK_UNKNOWN: "LINK_UNKNOWN",             // tanınmayan şoför bağlantısı
  LINK_REVOKED: "LINK_REVOKED",             // iptal edilmiş bağlantı
  LINK_EXPIRED: "LINK_EXPIRED",             // süresi dolmuş bağlantı
  PACKET_INVALID: "PACKET_INVALID",         // zorunlu alanı eksik paket / SP1 kodu bulunamadı
  SAME_ACTOR: "SAME_ACTOR",                 // kontrolü yapan onaylayamaz (yapılandırma)
  SP1_UNSIGNED: "SP1_UNSIGNED",             // imzasız SP1 paketi (lid/sig yok)
  SP1_BAD_SIGNATURE: "SP1_BAD_SIGNATURE",   // imza bağlantı anahtarıyla uyuşmuyor (değiştirilmiş/eksik kod)
  SP1_PERSONNEL_MISMATCH: "SP1_PERSONNEL_MISMATCH", // bağlantı başka personel adına, paket başka
  ATTACHMENT_MISSING: "ATTACHMENT_MISSING", // gerekli ek (beyan edilen fotoğraf) tamamlanmadan kontrol kapanamaz
});

const fail = (code, detail) => ({ ok: false, code, detail: detail || "" });
const pass = (extra) => ({ ok: true, ...(extra || {}) });

// ---------------------------------------------------------------- op-key sözleşmesi
// Kalıcı işlem anahtarı kapsamı: şirket(tenant) / bağlantı(linkId) / kayıt(entryId).
// Aynı şirkette aynı bağlantıdan aynı entry ancak bir kez işlem açar.
//
// AYRAÇ ÇAKIŞMASI KANITI: bileşenler encodeURIComponent ile kodlanır; bu kodlama "/"
// karakterini "%2F"ye çevirir, dolayısıyla kodlanmış bileşen ASLA ham "/" içermez.
// Sonuç: anahtardaki "/" yalnızca gerçek ayraçtır. (tenant="a/b", linkId="c", entryId="d")
// ile (tenant="a", linkId="b/c", entryId="d") FARKLI anahtarlar üretir — çakışma üretilemez.
// Bileşen karakterlerinde kısıt yoktur (unicode, boşluk, "%", "?" serbesttir).
const enc = (s) => encodeURIComponent(s);

export function opKeyOf({ tenant, linkId, entryId }) {
  for (const [k, v] of [["tenant", tenant], ["linkId", linkId], ["entryId", entryId]])
    if (!v || typeof v !== "string") throw Error("op-key eksik: " + k);
  return enc(tenant) + "/" + enc(linkId) + "/" + enc(entryId);
}

// Ters çözüm (denetim/görüntüleme içindir; yetki kanıtı DEĞİL). Round-trip garantili.
export function parseOpKey(key) {
  const parts = String(key || "").split("/");
  if (parts.length !== 3) throw Error("op-key biçimi bozuk: 3 bileşen bekleniyor");
  try {
    return { tenant: decodeURIComponent(parts[0]), linkId: decodeURIComponent(parts[1]), entryId: decodeURIComponent(parts[2]) };
  } catch {
    throw Error("op-key çözülemedi (bozuk kodlama)");
  }
}

// İçerik parmak izi için kararlı (anahtar-sıralı) JSON — hash hesabı service'te (async) yapılır.
export function canonicalStringify(v) {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return "[" + v.map(canonicalStringify).join(",") + "]";
  return "{" + Object.keys(v).sort().map((k) => JSON.stringify(k) + ":" + canonicalStringify(v[k])).join(",") + "}";
}

// ---------------------------------------------------------------- parmak izi sözleşmesi
// Fingerprint girdileri YALNIZCA bunlardır:
//   1) fields      — ofisin gördüğü iş içeriği (tarih, müşteri, şantiye, araç, miktar...)
//   2) entry       — kaynağın ilettiği HAM kayıt nesnesi (SP1 paketindeki entry'nin kendisi;
//                    manuel alımda null). Entry = iş içeriği; ZARF (paket/envelope) DEĞİL.
//   3) attachments — eklerin İÇERİK hash'leri (SHA-256 hex), SIRALI liste — ek sırası da içeriktir
// Kimlik (tenant/linkId/entryId) fingerprint'e GİRMEZ — o kapsam op-key'de zaten var.
// ZARF fingerprint'e GİRMEZ: aynı işin başka bir SP1 paketinde (farklı paket kodu, farklı
// okunur metin, yanında başka kayıtlarla) yeniden gönderilmesi içerik değişikliği DEĞİLDİR —
// dahil edilseydi sahte OP_CONFLICT üretirdi. Zarf kanıtları ayrı modellenir (sources store;
// aynı rapora birden çok zarf ilişkilenebilir). Taşıma bilgisi (alınma/gönderim zamanı,
// yeniden gönderim sayısı, kanal meta'sı) da GİRMEZ.
// Tersi de zorunludur: aynı entry kimliğiyle miktar/müşteri/EK İÇERİĞİ değişimi SESSİZCE kabul
// EDİLMEZ (fingerprint değişir → OP_CONFLICT).
// NOT: hash yalnız bütünlük karşılaştırmasıdır — yetkilendirme veya değişmezlik garantisi DEĞİLDİR.
export function fingerprintPayload({ fields, entry = null, attachmentHashes = [] }) {
  return canonicalStringify({ attachments: attachmentHashes, entry, fields: fields || {} });
}

// Aynı/farklı içerik kararı:
//  - kayıt yok                 → create
//  - aynı anahtar + aynı içerik → return-existing (yeniden deneme güvenli)
//  - aynı anahtar + farklı içerik → conflict (sessiz üzerine yazma / birleştirme YOK)
export function opKeyDecision(existing, fingerprint) {
  if (!existing) return pass({ action: "create" });
  if (existing.fingerprint === fingerprint) return pass({ action: "return-existing", report: existing });
  return fail(ERR.OP_CONFLICT, "Aynı işlem anahtarı farklı içerikle geldi");
}

// "Farklı kayıt olarak aç" = fork. Eski anahtarın engelini AŞMAZ:
// yeni iş ancak YENİ kimlik + gerekçe + kaynak ilişkisiyle açılır.
export function forkDecision({ originalKey, newKey, reason }) {
  if (!newKey || newKey === originalKey) return fail(ERR.OP_KEY_REUSE, "Yeni iş için yeni işlem kimliği gerekli");
  if (!reason || !String(reason).trim()) return fail(ERR.REASON_REQUIRED, "Yeni iş gerekçesi zorunlu");
  return pass({ relation: { type: "yeni_is", from: originalKey } });
}

// ---------------------------------------------------------------- geçiş guard'ları
export function findTransition(from, to) {
  return TRANSITIONS.find((t) => t.from === from && t.to === to) || null;
}

// actor: { id, role } — role LabIdentity'den gelir; sunucu fazında token'dan gelecek.
// config: { allowSameActor: bool } — ofis/yönetici ayrımı yapılandırılabilir;
//   false iken kontrolü yapan kişi onaylayamaz (T8 özel guard'ı).
// opts.reason: gerekçe isteyen geçişlerde zorunlu metin.
export function canTransition(report, to, actor, config = {}, opts = {}) {
  const t = findTransition(report.state, to);
  if (!t) return fail(ERR.TRANSITION_DENIED, report.state + " → " + to + " tanımsız");
  if (!t.roles.includes(actor.role)) return fail(ERR.ROLE_DENIED, actor.role + " rolü " + t.id + " geçişini yapamaz");
  if (t.reason && !(opts.reason && String(opts.reason).trim())) return fail(ERR.REASON_REQUIRED, t.id + " için gerekçe zorunlu");
  // T3 (kontrol tamam → onay_bekliyor): kaynağın beyan ettiği ekler (ör. fiş/fotoğraf sayısı)
  // tamamlanmadan iş onaya HAZIR SAYILMAZ. Eşleştirme kullanıcı onayı ister — fotoğraf sırası
  // tek başına kesin iş eşleştirmesi değildir.
  if (t.id === "T3" && report.media && report.media.required > 0) {
    const m = report.media;
    if (!m.confirmed || (m.attached || 0) < m.required)
      return fail(ERR.ATTACHMENT_MISSING, "Gerekli ek eksik: beyan " + m.required + ", bağlı " + (m.attached || 0) + (m.confirmed ? "" : ", eşleşme onayı yok"));
  }
  if (t.id === "T8") {
    if (!report.check || report.check.revoked) return fail(ERR.CHECK_STALE, "Geçerli ofis kontrolü yok");
    if (report.check.rev_no !== report.rev_no) return fail(ERR.REV_MISMATCH, "Kontrol eski revizyona ait (r" + report.check.rev_no + " ≠ r" + report.rev_no + ")");
    if (!config.allowSameActor && report.check.actor_id === actor.id)
      return fail(ERR.SAME_ACTOR, "Kontrolü yapan onaylayamaz (yapılandırma: allowSameActor=false)");
  }
  return pass({ transition: t });
}

// Eşzamanlılık: her yazım beklenen sürümü doğrular (optimistic concurrency).
export function assertVersion(report, expectedVersion) {
  if (report.version !== expectedVersion)
    return fail(ERR.VERSION_CONFLICT, "beklenen v" + expectedVersion + ", güncel v" + report.version);
  return pass();
}

// Alan düzenleme izni: yalnız durumun izinli alanları; dönen patch yeni REVİZYON olur, kaynak üzerine yazılmaz.
export function editablePatch(report, patch) {
  const allowed = EDITABLE_FIELDS[report.state];
  if (allowed === "source") return pass({ patch }); // taslak: kaynak cihaz serbest
  const bad = Object.keys(patch).filter((k) => !allowed.includes(k));
  if (bad.length) return fail(ERR.FIELD_LOCKED, report.state + " durumunda düzenlenemez: " + bad.join(", "));
  return pass({ patch });
}

// İçerik değişince kontrol geçersizleşir (E maddesi): onay_bekliyor'da değişiklik → T12 ile kontrolde.
export function invalidationPlan(report) {
  if (report.state === "onay_bekliyor") return { revokeCheck: true, autoTransition: findTransition("onay_bekliyor", "kontrolde") };
  if (report.state === "kontrolde" && report.check) return { revokeCheck: true, autoTransition: null };
  return { revokeCheck: false, autoTransition: null };
}

// ---------------------------------------------------------------- onay sonrası iptal (G maddesi)
// Onaylanmış işin finansal etkileri olabilir (hakediş/tahsilat/stok/yakıt).
// links.finalizedCount > 0 iken basit iptal YOK — ters kayıt/revizyon süreci gerekir.
export function canCancel(report, links = {}) {
  if (report.state !== "onaylandi") return fail(ERR.TRANSITION_DENIED, "Yalnız onaylanmış iş iptal edilir");
  const n = links.finalizedCount || 0;
  if (n > 0)
    return fail(ERR.CANCEL_BLOCKED, "Bağlı kesinleşmiş kayıt var (" + n + " adet). Basit iptal engellendi; ters kayıt/revizyon süreci gerekir.");
  return pass();
}
