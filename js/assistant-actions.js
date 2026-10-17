// Akıllı Asistan: "uygulamada istediğim her şeyi yapsın" katmanı.
// Gemini üç tür istek döndürür; hepsi telefonda doğrulanır ve kullanıcı kartı işaretleyip kaydetmeden hiçbir şey değişmez:
//  1) actions  — kartları (müşteri, şantiye, araç, personel, esnaf, ocak, döküm yeri, fiyat, belge) ekle / düzelt / sil
//  2) settings — ayarlar: asistan kuralı ekle, ödeme sözü, IBAN, mazot litre fiyatı, müşteriye mazotla ödeme kuralı
//  3) open     — ekran aç ("Leda'nın ekstresini aç", "tahsilat listesini göster")
// Rakamlar ve adlar mesajda yazmalı (uydurma yasağı); silme her zaman işaretsiz gelir.
import { isActive, todayStr, addDays } from "./core.js";
import { foldTr } from "./parser.js";
import { writtenNumbers } from "./ai-assist.js";
import { moneyInText } from "./assistant-core.js";
import { FUEL_RULE_UNITS } from "./assistant-rules.js";

const live = (d, s) => (d[s] || []).filter(isActive);
const norm = (s) => foldTr(s).replace(/[^\p{L}\p{N}]+/gu, " ").trim();
const words = (s) => norm(s).split(" ").filter(Boolean);
const said = (w, mw) => w.length >= 2 && mw.some((m) => m === w || (w.length >= 3 && m.startsWith(w) && m.length - w.length <= 5));
// Değer mesajda yazıyor mu (kelime kelime, Türkçe ek payıyla)
export function textInMessage(value, message) {
  const tw = words(value), mw = words(message);
  return tw.length > 0 && tw.every((w) => said(w, mw));
}
const digits = (s) => String(s || "").replace(/\D/g, "");

export const ACTION_STORES = {
  customers: { label: "Müşteri", create: true, del: true, fields: { name: "text", phone: "phone", note: "free", parent_customer_id: "ref:customers" } },
  sites: { label: "Şantiye", create: true, del: true, fields: { name: "text", address: "free", customer_id: "ref:customers" }, need: ["customer_id"] },
  vehicles: { label: "Araç / makine", create: true, del: true, fields: { name: "text", plate: "plate", type: "free", tank_capacity: "num", next_maintenance_date: "date" } },
  personnel: { label: "Personel", create: true, del: true, fields: { name: "text", phone: "phone", role: "free", vehicle_id: "ref:vehicles" } },
  suppliers: { label: "Esnaf / tedarikçi", create: true, del: true, fields: { name: "text", phone: "phone", type: "free" } },
  quarries: { label: "Malzeme ocağı", create: true, del: true, fields: { name: "text", address: "free" } },
  dump_sites: { label: "Döküm sahası", create: true, del: true, fields: { name: "text", address: "free" } },
  price_book: { label: "Fiyat kuralı", create: false, del: true, fields: { price: "num", active: "bool" } },
  documents: { label: "Belge", create: false, del: true, fields: { expiry_date: "date", doc_no: "text" } },
};
export const FIELD_TR = { name: "Ad", phone: "Telefon", note: "Not", parent_customer_id: "Ana firma", address: "Adres", customer_id: "Müşteri", plate: "Plaka", type: "Tür",
  tank_capacity: "Depo hacmi (L)", next_maintenance_date: "Sonraki bakım", role: "Görev", vehicle_id: "Araç", price: "Fiyat", active: "Aktif", expiry_date: "Bitiş tarihi", doc_no: "Belge no" };

// Açılabilecek ekranlar (yalnız bunlar)
export const SCREENS = {
  ana_sayfa: ["#/", "Ana sayfa"], isler: ["#/isler", "İşler"], yeni_is: ["#/isler/new", "Yeni iş kaydı"], yakit: ["#/yakit", "Yakıt"], depo: ["#/depo", "Depo tankı"],
  gider: ["#/gider", "Giderler"], kasa: ["#/finans/kasa", "Kasa"], tahsilat: ["#/tahsilat", "Tahsilat takibi"], teklif_asistani: ["#/teklif-hesap", "Teklif asistanı (fiyat hesapla)"], whatsapp_toplu: ["#/whatsapp-toplu", "WhatsApp grubu toplu işleme"], puantaj: ["#/puantaj", "Puantaj ve maaş"], sofor_baglantisi: ["#/sofor-kur", "Şoföre bağlantı gönder (şoför ekranı)"], puantaj_kisi: ["#/puantaj/{id}", "Personelin puantajı / maaşı"], tahsilat_musteri: ["#/tahsilat/{id}", "Müşteri tahsilatı"],
  cari: ["#/cari/{id}", "Cari ekstre"], musteri: ["#/musteriler/{id}", "Müşteri kartı"], musteriler: ["#/musteriler", "Müşteriler"], filo: ["#/filo", "Araçlar"],
  arac: ["#/filo/{id}", "Araç kartı"], belgeler: ["#/belgeler", "Belgeler"], fiyat: ["#/fiyat", "Fiyat listesi"], ceksenet: ["#/ceksenet", "Çek / senet"],
  mazot_hesaplari: ["#/mazot-hesaplari", "Mazotla ödeme hesapları"], kendi_depo: ["#/kendi-depo", "Kendi depo"], esnaf: ["#/esnaf", "Esnaf borçları"],
  bakim: ["#/bakim", "Bakım / arıza"], gun_sonu: ["#/gunsonu", "Gün sonu"], gun_ozeti: ["#/akilli-asistan/ozet", "Gün sonu özeti"], soru: ["#/akilli-asistan/soru", "Soru sor"],
  ayarlar: ["#/ayarlar", "Ayarlar"], yedek: ["#/ayarlar?tab=yedek", "Yedek"], kime_kontrol: ["#/kime-kontrol", "Kime çalışıldı"], kart_birlestir: ["#/kart-birlestir", "Kart birleştir"],
  hakedis: ["#/hakedis", "Hakedişler"], yonetici: ["#/yonetici", "Yönetici paneli"],
};
const SCREEN_STORE = { tahsilat_musteri: "customers", cari: "customers", musteri: "customers", arac: "vehicles", puantaj_kisi: "personnel" };

export const ACTIONS_PROMPT = [
  "UYGULAMAYI YÖNETME (kullanıcı kayıt dışı bir şey isterse):",
  "\"actions\":[{\"op\":\"create\"|\"update\"|\"delete\",\"store\":" + Object.keys(ACTION_STORES).map((s) => `"${s}"`).join("|") + ",\"id\" (update/delete için listedeki ID),\"fields\":{alan:değer},\"reason\"}]",
  "  alanlar: " + Object.entries(ACTION_STORES).map(([s, x]) => `${s}(${Object.keys(x.fields).join(",")})`).join("; ") + ". 'Leda'nın telefonu 0532…', 'Kaya'nın ana firması Hisar Polat', 'JCB'nin muayenesi 12.03.2027'de bitiyor', 'Ahmet artık 34ABC123'ü kullanıyor', 'Erdem Yapı kartını sil'.",
  "\"settings\":[{\"key\":\"rule\"|\"promise\"|\"iban\"|\"fuel_ref_price\"|\"fuel_rule\",\"value\",\"customer_id\",\"date\",\"amount\",\"per\",\"unit\",\"match\",\"only_pay\"}]",
  "  rule: 'bundan sonra şunu unutma / kural ekle' → value=kural metni (asistan kurallarına eklenir). promise: 'Kaya cuma ödeyecek' → customer_id, date, amount. iban: value. fuel_ref_price: mazot litre fiyatı value. fuel_rule: 'X sefer başı 75 litre mazotla ödüyor' → customer_id, per, unit, match (hangi işler: 'gravak maslak'), only_pay (yalnız mazotla mı).",
  "\"open\":{\"screen\":" + Object.keys(SCREENS).map((s) => `"${s}"`).join("|") + ",\"id\"} (kullanıcı bir ekranı görmek isterse: 'Leda'nın ekstresini aç' → cari + müşteri ID).",
  "Yapamayacağın bir şey istenirse answer'a kısaca neyin yapılamadığını yaz; 'kaydedilemedi' deme, yukarıdaki alanlardan biri uyuyorsa onu kullan.",
].join("\n");

export function actionsContext(d, message = "") {
  const t = norm(message);
  const ctx = {};
  if (/fiyat|tarife|ucret|saatlik|sefer basi|yevmiye/.test(t))
    ctx.price_rules = live(d, "price_book").slice(0, 80).map((p) => [p.id, p.customer_id || "", p.work_type || "", p.vehicle_id || "", p.unit, p.price]);
  if (/belge|muayene|sigorta|kasko|ruhsat|ehliyet|src|takograf|bitiy|suresi/.test(t))
    ctx.documents = live(d, "documents").slice(0, 80).map((x) => [x.id, x.category || "", x.owner_id || x.vehicle_id || x.personnel_id || "", x.expiry_date || ""]);
  return ctx;
}

export function actionsSchemaProps() {
  const NS = { type: ["string", "null"] }, NN = { type: ["number", "null"] }, NB = { type: ["boolean", "null"] };
  return {
    actions: { type: "array", items: { type: "object", properties: { op: NS, store: NS, id: NS, fields: { type: "object" }, reason: NS } } },
    settings: { type: "array", items: { type: "object", properties: { key: NS, value: NS, customer_id: NS, date: NS, amount: NN, per: NN, unit: NS, match: NS, only_pay: NB } } },
    open: { type: ["object", "null"], properties: { screen: NS, id: NS } },
  };
}

function checkValue(kind, v, { message, d, nums, money }) {
  if (v === null || v === "") return { ok: true, value: null };
  if (kind === "text") return textInMessage(v, message) ? { ok: true, value: String(v).trim().slice(0, 120) } : { ok: false, why: `"${v}" mesajda yazmıyor` };
  if (kind === "free") return { ok: true, value: String(v).trim().slice(0, 300) };
  if (kind === "phone") return digits(v).length >= 10 && digits(message).includes(digits(v).slice(-10)) ? { ok: true, value: String(v).trim() } : { ok: false, why: `Telefon ${v} mesajda yazmıyor` };
  if (kind === "plate") return digits(v) && norm(message).replace(/ /g, "").includes(norm(v).replace(/ /g, "")) ? { ok: true, value: String(v).toUpperCase().trim() } : { ok: false, why: `Plaka ${v} mesajda yazmıyor` };
  if (kind === "num") { const n = Math.round(Number(v) * 100) / 100; return Number.isFinite(n) && n > 0 && (nums.has(n) || money.has(n)) ? { ok: true, value: n } : { ok: false, why: `${v} mesajda yazmıyor` }; }
  if (kind === "bool") return { ok: true, value: !!v && v !== "false" };
  if (kind === "date") return /^\d{4}-\d{2}-\d{2}$/.test(String(v)) && Number.isFinite(new Date(v + "T12:00:00").getTime()) ? { ok: true, value: v } : { ok: false, why: `Tarih ${v} geçersiz` };
  if (kind.startsWith("ref:")) { const s = kind.slice(4); const x = live(d, s).find((r) => r.id === v); return x ? { ok: true, value: x.id, label: x.name } : { ok: false, why: `${v} listede yok` }; }
  return { ok: false, why: "bilinmeyen alan" };
}

export function validateActions(plan, { message = "", d } = {}) {
  const nums = writtenNumbers(message), money = moneyInText(message);
  const out = [];
  for (const a of (Array.isArray(plan?.actions) ? plan.actions : []).slice(0, 10)) {
    const def = ACTION_STORES[a.store];
    const op = ["create", "update", "delete"].includes(a.op) ? a.op : null;
    const r = { op, store: a.store, label: def?.label || a.store, id: null, rec: null, changes: {}, shown: [], reason: String(a.reason || "").slice(0, 200) || "Asistan", issues: [], ok: false };
    if (!def || !op) { r.issues.push("Bu işlem yapılamıyor"); out.push(r); continue; }
    if (op !== "create") {
      r.rec = live(d, a.store).find((x) => x.id === a.id) || null;
      if (!r.rec) { r.issues.push("Kayıt bulunamadı"); out.push(r); continue; }
      r.id = r.rec.id;
    } else if (!def.create) { r.issues.push(`${def.label} buradan eklenemez`); out.push(r); continue; }
    if (op === "delete") { r.issues.push("Silme — emin iseniz işaretleyin"); out.push(r); continue; }
    for (const [k, v] of Object.entries(a.fields && typeof a.fields === "object" ? a.fields : {})) {
      const kind = def.fields[k];
      if (!kind) { r.issues.push(`"${FIELD_TR[k] || k}" buradan değiştirilemez`); continue; }
      const c = checkValue(kind, v, { message, d, nums, money });
      if (!c.ok) { r.issues.push(c.why); continue; }
      if (r.rec && String(r.rec[k] ?? "") === String(c.value ?? "")) continue;
      r.changes[k] = c.value;
      const show = (val) => (kind.startsWith("ref:") ? live(d, kind.slice(4)).find((x) => x.id === val)?.name || "—" : val === true ? "Evet" : val === false ? "Hayır" : val ?? "—");
      r.shown.push([FIELD_TR[k] || k, r.rec ? show(r.rec[k]) : null, show(c.value)]);
    }
    if (op === "create") {
      if (!r.changes.name) r.issues.push("Ad yok");
      for (const k of def.need || []) if (!r.changes[k]) r.issues.push(`${FIELD_TR[k]} seçilmeli`);
      const twin = r.changes.name && live(d, a.store).find((x) => norm(x.name) === norm(r.changes.name));
      if (twin) r.issues.push(`"${twin.name}" zaten kayıtlı`);
    }
    if (!Object.keys(r.changes).length && op === "update") r.issues.push("Değişiklik yok");
    r.ok = !r.issues.length;
    out.push(r);
  }
  return out;
}

export function validateSettings(plan, { message = "", d, today = todayStr() } = {}) {
  const nums = writtenNumbers(message), money = moneyInText(message);
  const out = [];
  const cust = (id) => live(d, "customers").find((c) => c.id === id) || null;
  for (const s of (Array.isArray(plan?.settings) ? plan.settings : []).slice(0, 8)) {
    const r = { key: s.key, issues: [], ok: false };
    if (s.key === "rule") {
      r.title = "Asistan kuralı ekle";
      r.value = String(s.value || "").trim().slice(0, 500);
      if (r.value.length < 5) r.issues.push("Kural metni boş");
    } else if (s.key === "promise") {
      r.title = "Ödeme sözü";
      r.customer = cust(s.customer_id);
      r.date = /^\d{4}-\d{2}-\d{2}$/.test(String(s.date || "")) && s.date >= addDays(today, -7) ? s.date : null;
      const a = Math.round(Number(s.amount) * 100) / 100;
      r.amount = a > 0 && (money.has(a) || nums.has(a)) ? a : null;
      if (!r.customer) r.issues.push("Müşteri seçilmeli");
      if (!r.date) r.issues.push("Tarih yok");
      if (s.amount && !r.amount) r.issues.push(`Tutar ${s.amount} mesajda yazmıyor`);
    } else if (s.key === "iban") {
      r.title = "IBAN (hatırlatma mesajları)";
      r.value = String(s.value || "").toUpperCase().replace(/\s+/g, "");
      if (!/^TR\d{24}$/.test(r.value) || !digits(message).includes(digits(r.value))) r.issues.push("IBAN mesajda tam yazmıyor (TR + 24 rakam)");
    } else if (s.key === "fuel_ref_price") {
      r.title = "Mazot litre fiyatı";
      const n = Math.round(Number(s.value) * 100) / 100;
      r.value = n > 0 && n < 1000 && (money.has(n) || nums.has(n)) ? n : null;
      if (!r.value) r.issues.push("Fiyat mesajda yazmıyor");
    } else if (s.key === "fuel_rule") {
      r.title = "Mazotla ödeme kuralı";
      r.customer = cust(s.customer_id);
      const per = Number(s.per);
      r.per = per > 0 && nums.has(per) ? per : null;
      r.unit = FUEL_RULE_UNITS.includes(s.unit) ? s.unit : "Sefer";
      r.match = String(s.match || "").trim().slice(0, 80);
      if (r.match && !textInMessage(r.match, message)) r.match = "";
      r.only_pay = s.only_pay !== false;
      if (!r.customer) r.issues.push("Müşteri seçilmeli");
      if (!r.per) r.issues.push("Litre mesajda yazmıyor");
    } else { r.title = "Ayar"; r.issues.push("Bu ayar asistandan değiştirilemez"); }
    r.ok = !r.issues.length;
    out.push(r);
  }
  return out;
}

export function validateOpen(plan, { d } = {}) {
  const o = plan?.open;
  if (!o || !SCREENS[o.screen]) return null;
  let [href, label] = SCREENS[o.screen];
  if (href.includes("{id}")) {
    const rec = live(d, SCREEN_STORE[o.screen]).find((x) => x.id === o.id);
    if (!rec) return null;
    href = href.replace("{id}", encodeURIComponent(rec.id));
    label += ": " + rec.name;
  }
  return { href, label };
}
