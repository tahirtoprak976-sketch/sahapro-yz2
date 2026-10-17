import assert from "node:assert/strict";
import { datesInText, validateTickets, validateDocuments, ticketReconcile, heardText } from "../js/assistant-docs.js";
import { assistantSchema, assistantSystem } from "../js/assistant-core.js";
const today = "2026-10-14";

// tarih biçimleri
const ds = datesInText("Tarih: 13.10.2026 Saat 14:22  geçerlilik 5/3/27  2027-12-01  15 Mart 2028");
for (const x of ["2026-10-13", "2027-03-05", "2027-12-01", "2028-03-15"]) assert.ok(ds.has(x), x);
assert.ok(!datesInText("31.02.2026").size, "geçersiz gün alınmaz");

const d = {
  vehicles: [{ id: "V1", name: "Kamyon 1", plate: "34 ABC 123" }, { id: "V2", name: "Kamyon 2", plate: "34 XYZ 99" }],
  personnel: [{ id: "P1", name: "Soner Yılmaz" }],
  customers: [{ id: "C1", name: "Kaya İnşaat" }],
  sites: [],
  dump_sites: [{ id: "D1", name: "Kemerburgaz" }],
  work_records: [{ id: "W1", date: "2026-10-13", vehicle_id: "V1", customer_id: "C1", unit: "Sefer", quantity: 2 }],
  documents: [{ id: "OLD", category: "Döküm Fişi", doc_no: "A-555", date: "2026-10-12", owner_type: "work", owner_id: "W1" }],
};
const ticketText = "KEMERBURGAZ DÖKÜM SAHASI\nFiş No: A-1042\nTarih 13.10.2026\nPlaka 34ABC123\nBrüt 31.420 Dara 13.000 Net 18.420 kg";

// doğru fiş: işaretli, mevcut sefer işine bağlanır
let t = validateTickets({ tickets: [{ photo: 0, ticket_no: "A-1042", date: "2026-10-13", plate: "34 ABC 123", tonnage: 18.42, dump_site_name: "Kemerburgaz" }] }, { d, today, photoTexts: [ticketText], photoCount: 1 });
assert.equal(t[0].ok, true, t[0].issues.join());
assert.equal(t[0].vehicle_id, "V1"); assert.equal(t[0].tonnage, 18.42); assert.equal(t[0].dump_site_id, "D1");
assert.equal(t[0].link, "W1"); assert.equal(t[0].customer_id, "C1");
// uydurma fiş no / tarih / tonaj → işaretsiz
t = validateTickets({ tickets: [{ photo: 0, ticket_no: "B-9", date: "2026-10-14", plate: "34 ABC 123", tonnage: 25 }] }, { d, today, photoTexts: [ticketText], photoCount: 1 });
assert.equal(t[0].ok, false); assert.equal(t[0].ticket_no, ""); assert.equal(t[0].tonnage, null); assert.equal(t[0].date, today);
// fişteki plaka başka araç → yanlış araç seçilse bile uyarı
t = validateTickets({ tickets: [{ photo: 0, ticket_no: "A-1042", date: "2026-10-13", vehicle_id: "V2" }] }, { d, today, photoTexts: [ticketText], photoCount: 1 });
assert.equal(t[0].ok, false); assert.ok(t[0].issues.some((x) => /görünmüyor/.test(x)));
// var olmayan fotoğraf, mükerrer fiş
t = validateTickets({ tickets: [{ photo: 3, ticket_no: "A-1042" }] }, { d, today, photoTexts: [ticketText], photoCount: 1 });
assert.equal(t[0].ok, false);
t = validateTickets({ tickets: [{ photo: 0, ticket_no: "A-555", date: "2026-10-13" }] }, { d, today, photoTexts: ["Fiş A-555 13.10.2026 34ABC123"], photoCount: 1 });
assert.equal(t[0].ok, false); assert.ok(t[0].dup);
// fiş yeni günde → yeni sefer işi önerilir
t = validateTickets({ tickets: [{ photo: 0, ticket_no: "77", date: "2026-10-14" }] }, { d, today, photoTexts: ["No 77 14.10.2026 34 ABC 123"], photoCount: 1 });
assert.equal(t[0].link, "new"); assert.equal(t[0].ok, true);

// belge: muayene, bitiş tarihi ve plaka belgede
const docText = "ARAÇ MUAYENE RAPORU\nRapor No: TM2026-88123\nPlaka: 34 ABC 123\nMuayene Tarihi: 10.10.2026\nGeçerlilik: 10.10.2027";
let r = validateDocuments({ documents: [{ photo: 0, category: "Muayene Belgesi", owner_id: "V1", doc_no: "TM2026-88123", date: "2026-10-10", expiry_date: "2027-10-10" }] }, { d, today, photoTexts: [docText], photoCount: 1 });
assert.equal(r[0].ok, true, r[0].issues.join()); assert.equal(r[0].owner_type, "vehicle"); assert.equal(r[0].expiry_date, "2027-10-10");
// uydurma bitiş tarihi → alınmaz
r = validateDocuments({ documents: [{ photo: 0, category: "Muayene Belgesi", owner_id: "V1", doc_no: "TM2026-88123", expiry_date: "2028-10-10" }] }, { d, today, photoTexts: [docText], photoCount: 1 });
assert.equal(r[0].ok, false); assert.equal(r[0].expiry_date, null);
// araç ID verilmese de plakadan bulunur; yanlış araç verilirse uyarı
r = validateDocuments({ documents: [{ photo: 0, category: "Muayene Belgesi", doc_no: "TM2026-88123", expiry_date: "2027-10-10" }] }, { d, today, photoTexts: [docText], photoCount: 1 });
assert.equal(r[0].owner_id, "V1");
r = validateDocuments({ documents: [{ photo: 0, category: "Muayene Belgesi", owner_id: "V2", doc_no: "TM2026-88123", expiry_date: "2027-10-10" }] }, { d, today, photoTexts: [docText], photoCount: 1 });
assert.equal(r[0].ok, false);
// personel belgesi (SRC) personele gider
r = validateDocuments({ documents: [{ photo: 0, category: "SRC", owner_id: "P1", doc_no: "SRC-4411", expiry_date: "2031-05-01" }] }, { d, today, photoTexts: ["SRC BELGESİ Soner Yılmaz Belge No SRC-4411 Geçerlilik 01.05.2031"], photoCount: 1 });
assert.equal(r[0].ok, true, r[0].issues.join()); assert.equal(r[0].owner_type, "personnel");
// süresi dolmuş belge uyarılır
r = validateDocuments({ documents: [{ photo: 0, category: "Kasko", owner_id: "V1", doc_no: "K-1", expiry_date: "2026-09-01" }] }, { d, today, photoTexts: ["Kasko K-1 34 ABC 123 bitiş 01.09.2026"], photoCount: 1 });
assert.ok(r[0].issues.some((x) => /süresi dolmuş/.test(x)));

// mutabakat: 3 fiş 2 sefer → uyarı; eşitse yok; fişi olmayan gün sessiz
const data = { ...d, documents: [
  { id: "a", category: "Döküm Fişi", date: "2026-10-13", owner_type: "work", owner_id: "W1" },
  { id: "b", category: "Döküm Fişi", date: "2026-10-13", owner_type: "work", owner_id: "W1" },
  { id: "c", category: "Döküm Fişi", date: "2026-10-13", owner_type: "work", owner_id: "W1", ticket_vehicle_id: "V1" },
] };
let rc = ticketReconcile(data, { today });
assert.deepEqual(rc, [{ date: "2026-10-13", vehicle_id: "V1", tickets: 3, sefer: 2 }]);
data.documents.pop();
assert.equal(ticketReconcile(data, { today }).length, 0);

// ses: duyulan metin temizlenir
assert.equal(heardText({ heard_text: " <mesaj>Kaya 3 sefer</mesaj> " }), "Kaya 3 sefer");
assert.equal(heardText({}), "");
// şablon ve talimat yeni alanları içerir
const sc = assistantSchema();
assert.ok(sc.properties.tickets && sc.properties.documents && sc.properties.heard_text);
assert.ok(/tickets/.test(assistantSystem()) && /heard_text/.test(assistantSystem()));
console.log("assistant-docs PASS");

// ---- yakıt kaynağı: varsayılan depo; stok yetmezse işaretsiz; depo girişi stoğa eklenir ----
{
  const { validatePlan } = await import("../js/assistant-core.js");
  const dd = { ...d, fuel_tank_movements: [{ id: "m", move_type: "GİRİŞ", liters: 100 }] };
  let v = validatePlan({ fuel: [{ vehicle_id: "V1", liters: 44 }] }, { message: "34 ABC 123 44 litre mazot", d: dd, today });
  assert.equal(v.fuel[0].source, "Depo Tankı"); assert.equal(v.fuel[0].ok, true);
  v = validatePlan({ fuel: [{ vehicle_id: "V1", liters: 150 }] }, { message: "34 ABC 123 150 litre mazot", d: dd, today });
  assert.equal(v.fuel[0].ok, false); assert.ok(v.fuel[0].stockShort);
  v = validatePlan({ tank_in: [{ liters: 5000 }], fuel: [{ vehicle_id: "V1", liters: 150 }] }, { message: "depoya 5000 litre geldi, 34 ABC 123 150 litre aldı", d: dd, today });
  assert.equal(v.tankIn[0].ok, true); assert.equal(v.fuel[0].ok, true);
  v = validatePlan({ fuel: [{ vehicle_id: "V1", liters: 150 }] }, { message: "34 ABC 123 Opet istasyondan 150 litre", d: dd, today });
  assert.equal(v.fuel[0].source, "Akaryakıt İstasyonu"); assert.equal(v.fuel[0].ok, true);
  v = validatePlan({ tank_in: [{ liters: 9999 }] }, { message: "depoya 5000 litre geldi", d: dd, today });
  assert.equal(v.tankIn[0].ok, false);
  console.log("assistant-fuel-source PASS");
}
// iş + fiş tek satır
{
  const { mergeTicketsIntoWorks } = await import("../js/assistant-docs.js");
  const w = () => ({ date: "2026-10-10", vehicle_id: "V1", unit: "Sefer", quantity: 1, issues: [], slip_no: "" });
  let vv = { works: [w()], tickets: [{ photo: 0, ticket_no: "T802", date: "2026-10-10", vehicle_id: "V1", tonnage: 26.74 }], docs: [], expenses: [], fuel: [] };
  mergeTicketsIntoWorks(vv, { photoCount: 1 });
  assert.equal(vv.tickets.length, 0); assert.equal(vv.works[0].slip_no, "T802"); assert.equal(vv.works[0].tonnage, 26.74); assert.deepEqual(vv.works[0].photos, [0]);
  // farklı gün (mevcut işin fişi) → ayrı kart kalır
  vv = { works: [{ ...w(), date: "2026-10-14" }], tickets: [{ photo: 0, ticket_no: "A1", date: "2026-10-13", vehicle_id: "V1" }], docs: [], expenses: [], fuel: [] };
  mergeTicketsIntoWorks(vv, { photoCount: 1 });
  assert.equal(vv.tickets.length, 1); assert.equal((vv.works[0].photos || []).length, 0);
  // iki iş aynı gün aynı araç → hangisi belli değil, ayrı kalır
  vv = { works: [w(), { ...w(), quantity: 2 }], tickets: [{ photo: 0, ticket_no: "X", date: "2026-10-10", vehicle_id: "V1" }], docs: [], expenses: [], fuel: [] };
  mergeTicketsIntoWorks(vv, { photoCount: 1 }); assert.equal(vv.tickets.length, 1);
  // fiş kartı çıkmadıysa bile bağlanmamış fotoğraf tek işe eklenir
  vv = { works: [w()], tickets: [], docs: [], expenses: [], fuel: [] };
  mergeTicketsIntoWorks(vv, { photoCount: 1 }); assert.deepEqual(vv.works[0].photos, [0]);
  // ton biriminde fiş tonu farklıysa uyarı
  vv = { works: [{ ...w(), unit: "Ton", quantity: 20 }], tickets: [{ photo: 0, date: "2026-10-10", vehicle_id: "V1", tonnage: 26.74 }], docs: [], expenses: [], fuel: [] };
  mergeTicketsIntoWorks(vv, { photoCount: 1 }); assert.ok(vv.works[0].issues.some((x) => /26.74 ton/.test(x)));
  // Aynı plaka iki kartta (V1 "34GAM627", V9 "Bayram Tır" plaka 34 GAM 627) → yine birleşir, uyarı verir
  const dd = { vehicles: [{ id: "V1", name: "34GAM627" }, { id: "V9", name: "Bayram Tır", plate: "34 GAM 627" }] };
  vv = { works: [{ ...w(), vehicle_id: "V9" }], tickets: [{ photo: 0, ticket_no: "777843", date: "2026-10-10", vehicle_id: "V1", tonnage: 27.22 }], docs: [], expenses: [], fuel: [] };
  mergeTicketsIntoWorks(vv, { photoCount: 1, d: dd });
  assert.equal(vv.tickets.length, 0); assert.equal(vv.works[0].tonnage, 27.22); assert.ok(vv.works[0].issues.some((x) => /iki ayrı araç kartında/.test(x)));
  // Mesajda tarih yoksa fişin tarihi alınır
  vv = { works: [{ ...w(), date: "2026-10-15", customer_id: "C1", work_type: "Mıcır Nakliye", ok: false, dateUnsure: true, vehicleGuess: true, issues: ['Araç "34GAM627" mesajda yazmıyor — kontrol edin', "İş tarihi mesajda yazmıyor — teyit edin"] }], tickets: [{ photo: 0, ticket_no: "B2", date: "2026-10-12", vehicle_id: "V1" }], docs: [], expenses: [], fuel: [] };
  mergeTicketsIntoWorks(vv, { photoCount: 1 });
  assert.equal(vv.tickets.length, 0); assert.equal(vv.works[0].date, "2026-10-12"); assert.ok(vv.works[0].issues.some((x) => /Tarih fişten alındı/.test(x)));
  assert.equal(vv.works[0].ok, true, "fiş aracı ve tarihi teyit etti: kart işaretli gelir " + vv.works[0].issues.join());
  // Gemini mesajda tarih yokken bugünü yazdı (date_source ≠ yok): mesajda tarih yoksa fiş tarihi geçerli
  vv = { works: [{ ...w(), date: "2026-10-15", issues: [] }], tickets: [{ photo: 0, ticket_no: "777843", date: "2026-10-12", vehicle_id: "V1" }], docs: [], expenses: [], fuel: [] };
  mergeTicketsIntoWorks(vv, { photoCount: 1, message: "Entodan 3no mocır 1sefer muarem sef arnavutkoy" });
  assert.equal(vv.tickets.length, 0); assert.equal(vv.works[0].date, "2026-10-12");
  // mesajda "bugün" varsa eski fiş ayrı kalır
  vv = { works: [{ ...w(), date: "2026-10-15", issues: [] }], tickets: [{ photo: 0, ticket_no: "X9", date: "2026-10-12", vehicle_id: "V1" }], docs: [], expenses: [], fuel: [] };
  mergeTicketsIntoWorks(vv, { photoCount: 1, message: "bugün 1 sefer mıcır" });
  assert.equal(vv.tickets.length, 1);
  // Fiş tarihi okunamadıysa (bugün yazıldı) işe "fişten alındı" diye aktarılmaz
  vv = { works: [{ ...w(), date: "2026-10-15", dateUnsure: true, issues: ["İş tarihi mesajda yazmıyor — teyit edin"] }], tickets: [{ photo: 0, ticket_no: "", date: "2026-10-15", dateRead: false, vehicle_id: "V1" }], docs: [], expenses: [], fuel: [] };
  mergeTicketsIntoWorks(vv, { photoCount: 1, message: "1 sefer" });
  assert.equal(vv.tickets.length, 0); assert.ok(!vv.works[0].issues.some((x) => /Tarih fişten alındı/.test(x))); assert.equal(vv.works[0].dateUnsure, true);
  console.log("is-fis-birlesik PASS");
}
// malzeme: fişten okunur, işle çelişirse uyarı, boş iş türü doldurulur
{
  const { materialKind, mergeTicketsIntoWorks, validateTickets: vt } = await import("../js/assistant-docs.js");
  assert.equal(materialKind("06 MM KUM"), "kum"); assert.equal(materialKind("MICIR 0-5"), "mıcır"); assert.equal(materialKind("Süleyman Kaya"), null); assert.equal(materialKind("Öztaş"), null);
  assert.equal(materialKind("Ocak taşı"), "taş");
  const tk = vt({ tickets: [{ photo: 0, ticket_no: "T1", date: "2026-10-13", plate: "34 ABC 123", material: "mıcır" }] }, { d, today, photoTexts: ["Fiş T1 13.10.2026 34ABC123 Malzeme: 06 MM KUM 26,74 ton"], photoCount: 1 });
  assert.equal(tk[0].material, "Kum", "fişte kum yazıyor: model mıcır dese de kum");
  const w = { date: "2026-10-13", vehicle_id: "V1", unit: "Sefer", quantity: 1, issues: [], material: "mıcır", work_type: "Mıcır Nakliye" };
  const vv = { works: [w], tickets: [{ ...tk[0], vehicle_id: "V1" }], docs: [], expenses: [], fuel: [] };
  mergeTicketsIntoWorks(vv, { photoCount: 1 });
  assert.ok(w.issues.some((x) => /Fişte malzeme "Kum"/.test(x)));
  const w2 = { date: "2026-10-13", vehicle_id: "V1", unit: "Sefer", quantity: 1, issues: [], material: "", work_type: null };
  mergeTicketsIntoWorks({ works: [w2], tickets: [{ ...tk[0], vehicle_id: "V1" }], docs: [], expenses: [], fuel: [] }, { photoCount: 1 });
  assert.equal(w2.material, "Kum"); assert.equal(w2.work_type, "Kum Nakliye");
  const { slipFill } = await import("../js/slip-read.js");
  const f = slipFill({ rows: [{ photo: 0, net_ton: 26.74, material: "", text: "06 MM KUM", slip_no: "", date: null, vehicle_id: null, from_place: "", to_place: "" }], total_ton: 26.74, read: 1, count: 1 }, { unit: "Sefer", work_type: "" }, { d: {}, today });
  assert.equal(f.work_type, "Kum Nakliye");
  const f2 = slipFill({ rows: [{ photo: 0, net_ton: 26.74, material: "Kum", text: "KUM", slip_no: "", date: null, vehicle_id: null, from_place: "", to_place: "" }], total_ton: 26.74, read: 1, count: 1 }, { unit: "Sefer", work_type: "Hafriyat Nakliye" }, { d: {}, today });
  assert.ok(/Kum Nakliye mi/.test(f2.material_hint));
  console.log("malzeme PASS");
}
