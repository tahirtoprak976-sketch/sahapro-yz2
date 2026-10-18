// SAHAPRO YZ2 — SP1 paket katmanı (SAF; DOM/IndexedDB/ağ YOK).
// Mevcut şoför uygulamasının GERÇEK üretici/doğrulayıcı yardımcılarını yeniden kullanır:
//   - driver-core.js   : SP1 kod çözümü (extractPayloads) — aynı üretici driverMessage'dır
//   - security-core.js : HMAC imza + bağlantı kararı (hmacOk, linkVerdict)
// İMPORT ZİNCİRİ YAN ETKİ KONTROLÜ: driver-core.js yalnız core.js'i içe aktarır; core.js ve
// security-core.js modül düzeyinde DOM/IndexedDB/ağ/localStorage KULLANMAZ (saf katman).
// Dolayısıyla bu modülü içe aktarmak ana uygulama durumuna DOKUNMAZ.
//
// DÜRÜSTLÜK: İmza doğrulaması yalnız "mesajı gönderenin bağlantı anahtarına sahip olduğunu"
// gösterir. Gerçek kişi kimliğini veya işin gerçekten yapıldığını KANITLAMAZ.

import { extractPayloads } from "./driver-core.js";
import { hmacOk, linkVerdict } from "./security-core.js";
import { ERR } from "./flow-core.js";

export { extractPayloads };

// SP1 entry türleri: k yok/'w' = iş; 'g' gider, 'm' bakım, 'f' yakıt.
// Laboratuvar onay akışı yalnız İŞ bildirimlerini modeller; diğerleri atlanır (iş ÜRETİLMEZ).
export const isWorkEntry = (e) => e && (e.k === undefined || e.k === null || e.k === "w");
export const ENTRY_KINDS = { w: "iş", g: "gider", m: "bakım", f: "yakıt" };
export const kindLabel = (e) => ENTRY_KINDS[e.k || "w"] || e.k || "?";

// SP1 iş kaydı → akış alanları. Metindeki miktar (q) ile fişteki tonaj (ton) AYRI alanlardır;
// biri diğerinin üzerine ASLA yazılmaz. İsim çözümü (ana DB listeleri) lab'da yapılmaz —
// bağlantının taşıdığı kimlikler/adlar aynen korunur.
export function entryToFields(e) {
  const f = {
    date: e.date || "",
    vehicle_id: e.vid || "",
    customer_id: e.cid || e.cn || "",
    site_id: e.sid || "",
    work_type: e.wt || "",
    quantity: Number(e.q),
    unit: e.u || "",
  };
  if (e.ton !== undefined && e.ton !== null && e.ton !== "") f.tonnage = Number(e.ton) || null; // döküm fişi tonajı — metin miktarından AYRI
  if (e.mat) f.material = e.mat;
  if (e.note) f.description = e.note;
  const slip = e.slip || e.dfs || "";
  if (slip) f.slip_no = slip;
  return f;
}

// Beyan edilen medya sayısı (şoför 📷n yazar; baytlar mesajda TAŞINMAZ, WhatsApp'ta ayrı gelir).
export const requiredMedia = (e) => Math.max(0, Number(e && e.ph) || 0);

// Paket kapısı — entry'lere BAKMADAN önce bütün paket reddedilir.
// Sıra: imzasız → tanınmayan → iptal/süre/personel-pasif → imza → personel uyuşması.
// Dönen reason metinleri ana uygulamanın security.js checkPayloads ifadeleriyle aynı ailedendir.
export async function verifyPacketGate(payload, link, { today } = {}) {
  if (!payload.lid || !payload._sig)
    return { ok: false, code: ERR.SP1_UNSIGNED, reason: "İmzasız şoför paketi kabul edilmez; imzalı bağlantı gerekli" };
  if (!link)
    return { ok: false, code: ERR.LINK_UNKNOWN, reason: "Şoför bağlantısı bu laboratuvarda tanınmıyor" };
  const v = linkVerdict(link, { today, personnelActive: true });
  if (!v.ok)
    return { ok: false, code: v.level === "expired" ? ERR.LINK_EXPIRED : ERR.LINK_REVOKED, reason: v.why };
  if (!(await hmacOk(link.secret, payload._code, payload._sig)))
    return { ok: false, code: ERR.SP1_BAD_SIGNATURE, reason: "Mesajın imzası tutmuyor: kod değiştirilmiş ya da eksik kopyalanmış" };
  if (link.pid !== payload.p)
    return { ok: false, code: ERR.SP1_PERSONNEL_MISMATCH, reason: `Bağlantı ${link.name || link.lid} adına; mesaj başka kişi adına` };
  return { ok: true };
}

// Değişmez ZARF kanıtı (sources store'a yazılır). Ham mesajın tamamı saklanır; entry'lerin
// içeriği buradan AYRI modellenir (fingerprint yalnız entry'ye bakar — zarf yeniden gönderimi
// sahte çakışma üretmez).
export function envelopeRecord(payload, rawText) {
  return {
    kind: "sp1",
    raw_text: String(rawText || ""),       // ham SP1 mesajı — DEĞİŞMEZ
    code: payload._code,                    // deflate+base64url paket kodu
    code_hash: null,                        // servis hesaplar (async sha256)
    sig_status: payload._sig ? "dogrulandi" : "yok", // 'dogrulandi' = lab anahtarı tuttu — kişi/iş kanıtı DEĞİL
    link_id: payload.lid || null,
    personnel_id: payload.p || null,
    personnel_name: payload.n || "",
    entry_count: Array.isArray(payload.e) ? payload.e.length : 0,
  };
}
