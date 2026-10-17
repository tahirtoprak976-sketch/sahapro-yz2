import assert from "node:assert/strict";
import { validateDocuments, plateKey, vehicleKind, docsSchemaProps } from "../js/assistant-docs.js";
import { templatesFor, isRoadVehicle } from "../js/maint-core.js";
const n = "x", today = "2026-10-16";
const d = { vehicles: [{ id: "V1", name: "34GAM627", plate: "34 GAM 627", type: "Tır", created_at: n }], personnel: [] };
const muayene = "ARAÇ MUAYENE RAPORU No: MR-55821 PLAKA: 34 ABC 123 CİNSİ: YARI RÖMORK MARKASI: TIRSAN MODEL YILI: 2018 Muayene Tarihi 10.10.2026 Geçerlilik 10.10.2027";
const binek = "MUAYENE No 7781 Plaka 34 XY 4455 Cinsi OTOMOBİL Marka FIAT Model Yılı 2015 Geçerlilik: 01.03.2027";
assert.equal(plateKey("34 abc 123"), "34ABC123"); assert.equal(plateKey("ABC"), ""); assert.equal(plateKey("99A12"), "");
assert.equal(vehicleKind("YARI RÖMORK"), "Yarı Römork"); assert.equal(vehicleKind("Römork"), "Römork");
assert.equal(vehicleKind("OTOMOBİL"), "Binek"); assert.equal(vehicleKind("ÇEKİCİ"), "Çekici"); assert.equal(vehicleKind("KAMYONET"), "Kamyonet");
assert.equal(vehicleKind("KAMYON"), "Kamyon"); assert.equal(vehicleKind("lastik tırnak"), "Araç/Makine");
assert.ok(docsSchemaProps().documents.items.properties.vehicle_kind);
const plan = { documents: [
  { photo: 0, category: "TÜVTÜRK / Periyodik Muayene", owner_id: null, doc_no: "MR-55821", date: "2026-10-10", expiry_date: "2027-10-10", plate: "34 ABC 123", vehicle_kind: "Yarı Römork", brand: "TIRSAN", model_year: 2018 },
  { photo: 1, category: "TÜVTÜRK / Periyodik Muayene", owner_id: null, doc_no: "7781", expiry_date: "2027-03-01", plate: "34XY4455", vehicle_kind: "Otomobil", brand: "FIAT", model_year: 2015 },
  { photo: 0, category: "TÜVTÜRK / Periyodik Muayene", owner_id: null, doc_no: "MR-55821", expiry_date: "2027-10-10", plate: "06 ZZ 999" }, // belgede yok
] };
const [a, b, c] = validateDocuments(plan, { d, today, photoTexts: [muayene, binek], photoCount: 2 });
assert.deepEqual(a.new_vehicle, { plate: "34ABC123", type: "Yarı Römork", brand: "TIRSAN", model: "", model_year: 2018, chassis_no: "", engine_no: "", color: "", fuel_type: "", km: null });
assert.equal(a.ok, true); assert.ok(a.issues.some((x) => /kayıtlı değil/.test(x)));
assert.equal(b.new_vehicle.type, "Binek"); assert.equal(b.ok, true);
assert.equal(c.new_vehicle, null, "uydurma plaka"); assert.equal(c.ok, false);
// Kayıtlı araç: yeni kart yok
const [e] = validateDocuments({ documents: [{ photo: 0, category: "TÜVTÜRK / Periyodik Muayene", doc_no: "1234", expiry_date: "2027-01-05", plate: "34GAM627" }] }, { d, today, photoTexts: ["no 1234 34 GAM 627 2027-01-05 05.01.2027"], photoCount: 1 });
assert.equal(e.owner_id, "V1"); assert.equal(e.new_vehicle, null);
// Bakım şablonları
assert.equal(templatesFor({ type: "Yarı Römork" })[0].title, "Fren / balata kontrolü");
assert.ok(isRoadVehicle({ type: "Binek" })); assert.equal(templatesFor({ type: "Binek" })[0].every_km, 20000);
// Kayıtlı araç: muayene raporundaki gerçek bilgilerle kart güncellemesi
{
  const { vehicleInfo, vehicleUpdate } = await import("../js/assistant-docs.js");
  const T = "TÜVTÜRK ARAÇ MUAYENE RAPORU Rapor No: 2026-778812 Plaka: 34 GAM 627 Markası: MERCEDES-BENZ Tipi: ACTROS 1845 LS Model Yılı: 2019 Cinsi: ÇEKİCİ Rengi: BEYAZ Şasi No: WDB9634031L123456 Motor No: 47197001234567 Yakıt Cinsi: DİZEL Kilometre: 612.345 Muayene Tarihi: 12.10.2026 Geçerlilik Tarihi: 12.10.2027";
  const X = { photo: 0, category: "TÜVTÜRK / Periyodik Muayene", doc_no: "2026-778812", date: "2026-10-12", expiry_date: "2027-10-12", plate: "34 GAM 627", vehicle_kind: "Çekici", brand: "MERCEDES-BENZ", model: "ACTROS 1845 LS", model_year: 2019, color: "BEYAZ", chassis_no: "WDB9634031L123456", engine_no: "47197001234567", fuel_type: "Dizel", km: 612345 };
  const info = vehicleInfo(X, T);
  assert.deepEqual(info, { type: "Çekici", brand: "MERCEDES-BENZ", model: "ACTROS 1845 LS", model_year: 2019, chassis_no: "WDB9634031L123456", engine_no: "47197001234567", color: "BEYAZ", fuel_type: "Dizel", km: 612345 });
  assert.equal(vehicleInfo({ ...X, model_year: 2021, km: 700000, chassis_no: "XXXXXXXX99", brand: "VOLVO" }, T).model_year, null, "belgede olmayan yıl");
  assert.equal(vehicleInfo({ ...X, km: 700000 }, T).km, null); assert.equal(vehicleInfo({ ...X, brand: "VOLVO" }, T).brand, "");
  const v = { id: "V1", name: "34GAM627", plate: "34 GAM 627", type: "Tır", model_year: 2017, km: 600000, brand: "Mercedes-Benz" };
  const u = vehicleUpdate(v, info);
  assert.deepEqual(u.map((x) => x.k), ["model", "model_year", "chassis_no", "engine_no", "color", "fuel_type", "km"], "Tır=Çekici, marka aynı");
  assert.ok(u.every((x) => x.on));
  assert.deepEqual(vehicleUpdate({ type: "Kamyon" }, { type: "Yarı Römork" }), [{ k: "type", from: "Kamyon", to: "Yarı Römork", on: false }], "farklı tür önerilir ama işaretsiz");
  assert.deepEqual(vehicleUpdate({ km: 700000 }, { km: 612345 }), [], "km geri gitmez");
  const [r] = validateDocuments({ documents: [X] }, { d: { vehicles: [v], personnel: [] }, today, photoTexts: [T], photoCount: 1 });
  assert.equal(r.owner_id, "V1"); assert.equal(r.card_update.length, 7); assert.equal(r.ok, true);
}
console.log("doc-vehicle ok");
// Plakasız kartla daha önce kaydedilmiş belge: aynı belge no → o araç, plaka ve bilgiler eklenir
{
  const { validateDocuments } = await import("../js/assistant-docs.js");
  const T = "MUAYENE Rapor No: 3415087327201 Plaka: 34 ZDD 92 Markası: MERCEDES-BENZ Model Yılı: 2006 22.02.2025 23.02.2026";
  const d2 = { vehicles: [{ id: "MV", name: "Mobil Vinç", type: "Araç/Makine", created_at: "x" }], personnel: [],
    documents: [{ id: "DD", category: "Muayene Belgesi", doc_no: "3415087327201", owner_type: "vehicle", owner_id: "MV", vehicle_id: "MV", date: "2025-02-22", expiry_date: "2026-02-23", created_at: "x" }] };
  const [r] = validateDocuments({ documents: [{ photo: 0, category: "Muayene Belgesi", doc_no: "3415087327201", date: "2025-02-22", expiry_date: "2026-02-23", plate: "34 ZDD 92", brand: "MERCEDES-BENZ", model_year: 2006 }] }, { d: d2, today: "2026-10-16", photoTexts: [T], photoCount: 1 });
  assert.equal(r.owner_id, "MV"); assert.equal(r.new_vehicle, null);
  assert.deepEqual(r.card_update.map((u) => [u.k, u.to]), [["plate", "34ZDD92"], ["brand", "MERCEDES-BENZ"], ["model_year", 2006]]);
  assert.equal(r.existing_doc_id, "DD"); assert.equal(r.ok, true, "belge eklenmez, kart güncellenir");
  console.log("doc-vehicle mobil vinç ok");
}
