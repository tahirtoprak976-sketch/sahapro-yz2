// SAHAPRO YZ2 — kimlik/yetki ADAPTÖRÜ sözleşmesi ve laboratuvar implementasyonu.
//
// SÖZLEŞME (sunucu fazında aynı kalır):
//   identity.current() → { id, role }   (role: "sofor" | "ofis" | "yonetici" | "sistem")
//   Her geçiş çağrısı actor'ü service'e verir; guard'lar flow-core.canTransition'dadır.
//
// DÜRÜSTLÜK NOTU: LabIdentity bir GÜVENLİK mekanizması DEĞİLDİR.
// Tek cihazlı laboratuvarda "kimin" işlem yaptığını etiketlemek içindir; hiçbir şeyi kanıtlamaz.
// Tarayıcı tarafındaki hiçbir kontrol sunucu taraflı yetkilendirme sayılmaz:
// çok cihazlı fazda bu adaptör oturum/token tabanlı bir ServerIdentity ile değişecek
// ve aynı guard'lar sunucuda yeniden koşulacak.

import { ROLES, ERR } from "./flow-core.js";

// Lab aktörü üretir. role ROLES dışındaysa hata (geçiş tablosu bilinmeyen rolü zaten reddeder).
export function labIdentity(id, role) {
  if (!id || typeof id !== "string") throw Error("Aktör kimliği gerekli");
  if (!ROLES.includes(role)) throw Error("Bilinmeyen rol: " + role);
  return Object.freeze({ id, role, lab: true }); // lab:true = "bu kimlik kanıt değildir" damgası
}

// Akış yapılandırması: ofis/yönetici ayrımı YAPILANDIRILABİLİR.
//   tenant: şirket kapsamı (op-key'in ilk parçası)
//   allowSameActor: false → kontrolü yapan onaylayamaz (varsayılan; iki kişi disiplini)
//                   true  → aynı kişi hem kontrol hem onay yapabilir ama yine İKİ AYRI adım + iki audit
//   knownLinks: tanınan şoför bağlantı kimlikleri (boş dizi = lab'da serbest; canlıda security.js listesi besler)
//   revokedLinks: iptal edilmiş bağlantılar
// NOT: İmza (HMAC) doğrulaması bu çekirdeğin işi değil; mevcut security-core.js katmanında kalır.
//      İmza yalnız "bağlantı anahtarına sahip olunduğunu" kanıtlar — kişi kimliğini veya
//      işin gerçekten yapıldığını kanıtlamaz.
export function makeFlowConfig({ tenant = "yz2", allowSameActor = false, knownLinks = [], revokedLinks = [] } = {}) {
  if (!tenant || typeof tenant !== "string") throw Error("tenant gerekli");
  return Object.freeze({
    tenant,
    allowSameActor: !!allowSameActor,
    knownLinks: Object.freeze([...knownLinks]),
    revokedLinks: Object.freeze([...revokedLinks]),
  });
}

// Bağlantı kabul kontrolü — paket alımından ÖNCE (rapor bile açılmaz).
export function linkVerdict(config, linkId) {
  if (!linkId || typeof linkId !== "string") return { ok: false, code: ERR.PACKET_INVALID, detail: "linkId eksik" };
  if (config.revokedLinks.includes(linkId)) return { ok: false, code: ERR.LINK_REVOKED, detail: linkId };
  if (config.knownLinks.length && !config.knownLinks.includes(linkId)) return { ok: false, code: ERR.LINK_UNKNOWN, detail: linkId };
  return { ok: true };
}
