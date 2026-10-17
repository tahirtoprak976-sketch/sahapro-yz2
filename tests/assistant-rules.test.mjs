import assert from "node:assert/strict";
import { validatePlan, assistantSystem } from "../js/assistant-core.js";
import { vehicleNamed, senderPersonnel, planTotals, DEFAULT_RULES } from "../js/assistant-rules.js";
const today = "2026-10-14";
const d = {
  customers: [{ id: "KL", name: "Kılıç Hafriyat", fuel_per_trip: 75, fuel_rule_match: "gravak maslak" }, { id: "DN", name: "Danış Maden" }],
  sites: [], suppliers: [], dump_sites: [], aliases: [{ id: "a1", alias: "14 tonluk", target_type: "vehicle", target_id: "K14" }],
  personnel: [{ id: "PB", name: "Bayram Tırcı", vehicle_id: "VB" }, { id: "PT", name: "Tahir Toprak", vehicle_id: "VT" }],
  vehicles: [{ id: "VB", name: "34GAM627", plate: "34GAM627" }, { id: "VT", name: "34FY2482", plate: "34FY2482" }, { id: "K14", name: "14 Tonluk Kato" }],
  work_records: [], fuel_tank_movements: [],
};
const msg = `[13.10.2026 18:02] Tahir Toprak: Bugün Maslak Kılıç hafriyattan Göktürk son durağa 3 sefer gravak
[13.10.2026 18:30] Bayram Tırcı: Maslak kılıçtan binkılıça 1 sefer gravak
[13.10.2026 18:31] Bayram Tırcı: Maslak kılıçtan binkılıça 1 sefer gravak`;
const W = (o) => ({ date: "2026-10-13", customer_id: "KL", work_type: "Gravak Nakliye", unit: "Sefer", material: "gravak", date_source: "whatsapp", ...o });
const v = validatePlan({ works: [
  W({ reporter: "Tahir Toprak", vehicle_id: "VT", quantity: 3, from_place: "Maslak", to_place: "Göktürk son durağa" }),
  W({ reporter: "Bayram Tırcı", vehicle_id: "VB", quantity: 1, from_place: "Maslak", to_place: "binkılıça" }),
  W({ reporter: "Bayram Tırcı", vehicle_id: "VB", quantity: 1, from_place: "Maslak", to_place: "binkılıça" }),
] }, { message: msg, d, today });
const [a, b, c] = v.works;
// gönderenin zimmetli aracı: plaka yazmasa da kabul, not düşülür
assert.equal(a.vehicle_id, "VT"); assert.ok(a.vehicleNote); assert.equal(a.personnel_id, "PT"); assert.equal(a.reporter, "Tahir Toprak");
assert.equal(a.ok, true, a.issues.join());
// Kılıç sefer başı 75 L: 3 sefer = 225 L karşılık
assert.equal(a.fuelAllowance.liters, 225);
assert.equal(a.from_place, "Maslak"); assert.equal(a.to_place, "Göktürk son durağa");
// aynı yapıştırmada aynı araç/tarih/miktar iki kez → ikincisi mükerrer şüphesi
assert.equal(b.ok, true); assert.equal(c.ok, false); assert.ok(c.pasteDup);
// başkasının aracı tahmin edilirse işaretsiz
let v2 = validatePlan({ works: [W({ reporter: "Bayram Tırcı", vehicle_id: "VT", quantity: 1 })] }, { message: "[13.10.2026 18:30] Bayram Tırcı: Maslak kılıçtan binkılıça 1 sefer gravak", d, today });
assert.equal(v2.works[0].ok, false); assert.ok(v2.works[0].vehicleGuess);
// araç verilmemiş, gönderen biliniyorsa zimmetli araç atanır
v2 = validatePlan({ works: [W({ reporter: "Bayram Tırcı", quantity: 1 })] }, { message: "[13.10.2026 18:30] Bayram Tırcı: Maslak kılıçtan binkılıça 1 sefer gravak", d, today });
assert.equal(v2.works[0].vehicle_id, "VB");
// takma adla anılan araç kabul
assert.ok(vehicleNamed(d, d.vehicles[2], "14 tonluk mahir bey"));
// Danış Maden taşı: Kılıç kuralı uygulanmaz
v2 = validatePlan({ works: [W({ customer_id: "DN", reporter: "Tahir Toprak", vehicle_id: "VT", quantity: 2, material: "ocak taşı" })] }, { message: "[13.10.2026] Tahir Toprak: Danış madenden binkılıça 2 sefer ocak taşı", d, today });
assert.equal(v2.works[0].fuelAllowance, null);
// Kılıç ama gravak/maslak değil → kural yok
v2 = validatePlan({ works: [W({ reporter: "Tahir Toprak", vehicle_id: "VT", quantity: 2, material: "toprak" })] }, { message: "[13.10.2026] Tahir Toprak: Kılıç hafriyata 2 sefer toprak", d, today });
assert.equal(v2.works[0].fuelAllowance, null);
// tarih yok → işaretsiz
v2 = validatePlan({ works: [W({ reporter: "Tahir Toprak", vehicle_id: "VT", quantity: 3, date_source: "yok" })] }, { message: "Tahir Toprak: Maslak kılıçtan 3 sefer gravak", d, today });
assert.equal(v2.works[0].ok, false);
// müşterinin verdiği mazot: depodan düşmez, müşteri zorunlu
v2 = validatePlan({ fuel: [{ vehicle_id: "VT", liters: 75, source: "Müşteri Verdi", customer_id: "KL" }] }, { message: "Kılıçtan 75 litre mazot aldık 34FY2482", d, today });
assert.equal(v2.fuel[0].ok, true); assert.equal(v2.fuel[0].customer_id, "KL");
v2 = validatePlan({ fuel: [{ vehicle_id: "VT", liters: 75, source: "Müşteri Verdi" }] }, { message: "75 litre mazot aldık 34FY2482", d, today });
assert.equal(v2.fuel[0].ok, false);
// toplamlar: kesin ve teyit bekleyen ayrı
const t = planTotals(v.works, d);
const tv = t.vehicles.find((x) => x.name === "34GAM627");
assert.equal(tv.sure, "1 sefer"); assert.equal(tv.unsure, "1 sefer");
assert.equal(t.customers[0].sure, "4 sefer");
// kurallar talimata eklenir
assert.ok(assistantSystem(DEFAULT_RULES).includes("KILIÇ HAFRİYAT"));
assert.ok(!assistantSystem("").includes("İŞLETME KURALLARI"));
assert.equal(senderPersonnel(d, "Bayram Tırcı", msg).id, "PB");
console.log("assistant-rules PASS");
{
  const dd = { ...d, personnel: [{ id: "S1", name: "Tahir Toprak" }, { id: "PT", name: "Tahir Toprak", vehicle_id: "VT" }, { id: "B0", name: "Bayram", vehicle_id: "VB" }] };
  assert.equal(senderPersonnel(dd, "Tahir Toprak", "Tahir Toprak: x").id, "PT");
  assert.equal(senderPersonnel(dd, "Bayram Tırcı", "Bayram Tırcı: x").id, "B0");
  console.log("sender-pick PASS");
}
// malzeme ocağı ve döküm yeri kartları
{
  const dd = { ...d, quarries: [{ id: "QD", name: "Danış Maden" }], dump_sites: [{ id: "DB", name: "Binkılıç Dolgu" }] };
  const m = "[13.10.2026] Tahir Toprak: Danış madenden binkılıç dolguya 2 sefer ocak taşı, Öztaştan 1 sefer mıcır göktürk son durağa";
  const v3 = validatePlan({ works: [
    W({ customer_id: "DN", reporter: "Tahir Toprak", vehicle_id: "VT", quantity: 2, material: "ocak taşı", from_place: "Danış madenden", to_place: "binkılıç dolguya", to_is_dump: true }),
    W({ customer_id: "DN", reporter: "Tahir Toprak", vehicle_id: "VT", quantity: 1, material: "mıcır", from_place: "Öztaştan", to_place: "göktürk son durağa", to_is_dump: true }),
  ] }, { message: m, d: dd, today });
  assert.equal(v3.works[0].quarry_id, "QD"); assert.equal(v3.works[0].dump_site_id, "DB");
  assert.equal(v3.works[1].quarry_id, null); assert.equal(v3.works[1].new_quarry, "Öztaş"); assert.equal(v3.works[1].new_dump_site, "Göktürk son durağa");
  // uydurma ocak ID'si kabul edilmez
  const v4 = validatePlan({ works: [W({ reporter: "Tahir Toprak", vehicle_id: "VT", quantity: 1, quarry_id: "YOK" })] }, { message: "[13.10.2026] Tahir Toprak: 1 sefer gravak maslak", d: dd, today });
  assert.equal(v4.works[0].quarry_id, null);
  console.log("ocak PASS");
}
// mazotla ödeme: hakedişte 0 ₺, hak edilen litre; alınan mazot (araca + depoya) düşer
{
  const { applyFuelPay, customerFuelLedger, fuelLedgers } = await import("../js/assistant-rules.js");
  const base = { customer_id: "KL", unit: "Sefer", quantity: 3, material: "gravak", description: "Maslak kılıçtan göktürk", price_snapshot: { amount: 9000, unit_price: 3000, price_source: "Fiyat Listesi" } };
  let f = applyFuelPay(d, base, "");
  assert.equal(f.customer_fuel_allowance_l, 225); assert.equal(f.price_snapshot.amount, 0); assert.equal(f.price_snapshot.price_source, "Mazot karşılığı");
  // para + mazot müşterisi: fiyat korunur
  const d2 = { ...d, customers: [{ ...d.customers[0], fuel_only_pay: false }] };
  f = applyFuelPay(d2, base, ""); assert.equal(f.price_snapshot.amount, 9000); assert.equal(f.customer_fuel_allowance_l, 225);
  // eşleşmeyen iş (toprak): değişmez
  f = applyFuelPay(d, { ...base, material: "toprak", description: "kılıç" }, ""); assert.equal(f.customer_fuel_allowance_l, undefined); assert.equal(f.price_snapshot.amount, 9000);
  const led = { ...d, work_records: [{ id: "w1", customer_id: "KL", unit: "Sefer", quantity: 3, customer_fuel_allowance_l: 225 }, { id: "w2", customer_id: "KL", unit: "Sefer", quantity: 1, customer_fuel_allowance_l: 75 }],
    fuel_records: [{ id: "f1", fuel_source: "Müşteri Verdi", customer_id: "KL", liters: 150 }], fuel_tank_movements: [{ id: "m1", move_type: "GİRİŞ", customer_id: "KL", liters: 100 }] };
  const L = customerFuelLedger(led, "KL");
  assert.deepEqual([L.trips, L.earned, L.received, L.balance], [4, 300, 250, 50]);
  assert.equal(fuelLedgers(led)[0].balance, 50);
  const { todayBoard } = await import("../js/today.js");
  assert.ok(todayBoard(led, { today, lastBackupAt: new Date().toISOString() }).items.some((i) => /50 L mazot alacağı/.test(i.text)));
  const { runAskTool } = await import("../js/day-summary.js");
  assert.equal(runAskTool(led, "customer_fuel", { customer: "Kılıç" }, today).musteriler[0].kalan_litre, 50);
  // asistan: depoya müşteriden mazot
  const v5 = validatePlan({ tank_in: [{ liters: 300, customer_id: "KL", credit: true }] }, { message: "Kılıçtan depoya 300 litre mazot aldık", d, today });
  assert.equal(v5.tankIn[0].customer_id, "KL"); assert.equal(v5.tankIn[0].credit, false); assert.equal(v5.tankIn[0].ok, true);
  console.log("mazot-odeme PASS");
}
// iskelet: birden çok kural, birim, tarih aralığı, şantiye adında eşleşme
{
  const { applyFuelPay, fuelRulesOf, matchFuelRule } = await import("../js/assistant-rules.js");
  const dd = { ...d, sites: [{ id: "SM", name: "Kılıç Hafriyat Maslak", customer_id: "KL" }],
    customers: [{ id: "KL", name: "Kılıç Hafriyat", fuel_rules: [
      { id: "r1", per: 75, unit: "Sefer", match: "gravak maslak", only_pay: true },
      { id: "r2", per: 20, unit: "Saat", match: "", only_pay: false, from: "2026-10-01" } ] }] };
  // "maslak" yalnız şantiye adında: yine eşleşir (kullanıcının eski işi)
  let f = applyFuelPay(dd, { customer_id: "KL", site_id: "SM", unit: "Sefer", quantity: 1, material: "Gravak", dump_area: "Çatalca Binkılıç", date: "2026-10-10", price_snapshot: { amount: 3000 } });
  assert.equal(f.customer_fuel_allowance_l, 75); assert.equal(f.price_snapshot.amount, 0); assert.equal(f.fuel_rule_id, "r1");
  // saat kuralı: para + mazot → fiyat korunur
  f = applyFuelPay(dd, { customer_id: "KL", unit: "Saat", quantity: 8, date: "2026-10-12", price_snapshot: { amount: 8000 } });
  assert.equal(f.customer_fuel_allowance_l, 160); assert.equal(f.price_snapshot.amount, 8000);
  // tarih aralığı dışında uygulanmaz
  assert.equal(matchFuelRule(dd, { customer_id: "KL", unit: "Saat", quantity: 8, date: "2026-09-20" }), null);
  // eski tek alanlı kart okunur
  assert.equal(fuelRulesOf({ fuel_per_trip: 75, fuel_rule_match: "gravak" })[0].per, 75);
  console.log("mazot-iskelet PASS");
}
{
  const { fuelStatementText } = await import("../js/assistant-rules.js");
  const dd = { ...d, work_records: [{ id: "w1", date: "2026-10-10", customer_id: "KL", vehicle_id: "VT", unit: "Sefer", quantity: 3, material: "gravak", customer_fuel_allowance_l: 225, dump_area: "Binkılıç" }],
    fuel_records: [{ id: "f1", date: "2026-10-11", fuel_source: "Müşteri Verdi", customer_id: "KL", vehicle_id: "VT", liters: 150 }], fuel_tank_movements: [] };
  const t = fuelStatementText(dd, "KL");
  assert.ok(/10\.10\.2026  \+225 L  3 sefer gravak 34FY2482 → Binkılıç/.test(t), t);
  assert.ok(/−150 L  mazot alındı/.test(t)); assert.ok(/Kalan: 75 L/.test(t));
  console.log("mazot-ekstre PASS");
}
