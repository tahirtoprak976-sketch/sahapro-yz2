import assert from "node:assert/strict";
import { yardStock, applyYard, vehicleFactor, yardHint, yardMaterial } from "../js/yard-core.js";
import { validatePlan } from "../js/assistant-core.js";
import { todayBoard } from "../js/today.js";
import { runAskTool } from "../js/day-summary.js";
const today = "2026-10-14";
const d = {
  dump_sites: [{ id: "Y", name: "Muratoğlu Depo", own_yard: true }, { id: "BL", name: "Boluca Döküm" }],
  customers: [{ id: "IC", name: "Kendi Depo (iç iş)", internal: true }, { id: "HA", name: "Hurdacı Aydın" }, { id: "KI", name: "Kaya İnşaat" }],
  vehicles: [{ id: "KT", name: "Kamyonet", type: "Kamyonet", plate: "34KT1" }, { id: "TR", name: "34FY2482", type: "Tır", plate: "34FY2482" }, { id: "X", name: "Bilinmez" }],
  sites: [], personnel: [], suppliers: [], aliases: [], quarries: [],
  work_records: [
    { id: "a", date: "2026-10-10", customer_id: "HA", vehicle_id: "KT", unit: "Sefer", quantity: 5, material: "çöp", dump_site_id: "Y" },
    { id: "b", date: "2026-10-11", customer_id: "KI", vehicle_id: "KT", unit: "Sefer", quantity: 8, work_type: "Moloz Nakliye", dump_site_id: "Y" },
    { id: "c", date: "2026-10-12", customer_id: "IC", vehicle_id: "TR", unit: "Sefer", quantity: 1, material: "moloz", dump_site_id: "BL" },
    { id: "z", date: "2026-10-12", customer_id: "KI", vehicle_id: "KT", unit: "Sefer", quantity: 2, dump_site_id: "BL" }, // depoya değil
  ],
};
assert.equal(vehicleFactor(d.vehicles[0]).f, 1); assert.equal(vehicleFactor(d.vehicles[1]).f, 6); assert.equal(vehicleFactor(d.vehicles[2]).known, false);
assert.equal(vehicleFactor(d.vehicles[1], { byVehicle: { TR: 7 } }).f, 7);
let st = yardStock(d, { today });
const m = Object.fromEntries(st.rows.map((r) => [r.mat, r.stock]));
assert.equal(m["Çöp"], 5); assert.equal(m["Moloz / Hafriyat"], 2); assert.equal(st.total, 7); // 8 moloz − 1 tır (6)
// açılış stoku ve tarih
st = yardStock(d, { today, settings: { opening: { "Moloz / Hafriyat": 10 }, opening_date: "2026-10-11" } });
assert.equal(Object.fromEntries(st.rows.map((r) => [r.mat, r.stock]))["Moloz / Hafriyat"], 12); assert.ok(!st.rows.some((r) => r.mat === "Çöp" && r.in));
// iç iş: hakedişe para yok
assert.equal(applyYard(d, { customer_id: "IC", site_id: "S", price_snapshot: { amount: 5000 } }).price_snapshot.amount, 0);
assert.equal(applyYard(d, { customer_id: "KI", price_snapshot: { amount: 5000 } }).price_snapshot.amount, 5000);
// ipuçları
assert.ok(yardHint("Şantiyeden 1sefer harfiyat boluca döküm").out);
assert.ok(yardHint("Hurdacı aydından 3 sefer çöp depoya döküldü").in);
assert.ok(!yardHint("Kaya İnşaat 3 sefer moloz").out);
assert.equal(yardMaterial({ material: "harfiyat" }), "Moloz / Hafriyat"); assert.equal(yardMaterial({ material: "çöp" }), "Çöp");
// asistan: "şantiyeden … boluca" → iç iş müşterisi, işaretli; "depoya döküldü" → döküm yeri depo
let v = validatePlan({ works: [{ date: today, vehicle_id: "TR", work_type: "Hafriyat Nakliye", quantity: 1, unit: "Sefer", dump_site_id: "BL" }] }, { message: "34FY2482 Şantiyeden 1sefer harfiyat boluca döküm", d, today });
assert.equal(v.works[0].customer_id, "IC"); assert.equal(v.works[0].yard, "out"); assert.equal(v.works[0].ok, true, v.works[0].issues.join());
v = validatePlan({ works: [{ date: today, customer_id: "HA", vehicle_id: "KT", work_type: "Çöp Nakliye", quantity: 3, unit: "Sefer" }] }, { message: "Kamyonet Hurdacı aydından 3 sefer çöp depoya döküldü", d, today });
assert.equal(v.works[0].customer_id, "HA"); assert.equal(v.works[0].dump_site_id, "Y");
// pano ve soru
const big = { ...d, work_records: [...d.work_records, { id: "q", date: today, customer_id: "KI", vehicle_id: "KT", unit: "Sefer", quantity: 20, material: "moloz", dump_site_id: "Y" }] };
assert.ok(todayBoard(big, { today, lastBackupAt: new Date().toISOString() }).items.some((i) => /Kendi depoda/.test(i.text)));
assert.ok(!todayBoard(d, { today, lastBackupAt: new Date().toISOString() }).items.some((i) => /Kendi depoda/.test(i.text)));
assert.equal(runAskTool(d, "yard_stock", {}, today).depoda_kamyonet_yuku, 7);
console.log("yard PASS");
{
  const { yardHint } = await import("../js/yard-core.js");
  assert.ok(yardHint("1 seferi bizim depoya döküldü").in);
  assert.ok(yardHint("depoya 3 sefer moloz döktük").in);
  const h = yardHint("depodaki stoktan moloz 1 sefer bolluca döküm"); assert.ok(h.out && h.strong);
  assert.ok(!yardHint("depoya 5000 litre mazot boşaltıldı").in);
  assert.ok(!yardHint("1 seferi göktürk son durak dolguya döküldü").in);
  console.log("yard hint ok");
}
{
  const { seedVehicleTypes } = await import("../js/yard-core.js");
  const vs = [{ id: "1", name: "34GAM627", created_at: "x" }, { id: "2", name: "Kamyon", plate: "34 UL 9492", type: "Araç/Makine", created_at: "x" }, { id: "3", name: "34FY2482", type: "Kamyonet", created_at: "x" }];
  const meta = {};
  const db = { metaGet: async (k) => meta[k], metaSet: async (k, v) => { meta[k] = v; }, getAll: async () => vs, saveExisting: async (s, r, f) => Object.assign(r, f) };
  assert.equal(await seedVehicleTypes(db), 2);
  assert.deepEqual(vs.map((v) => v.type), ["Tır", "Kamyon", "Kamyonet"], "elle girilmiş tür değişmez");
  assert.equal(await seedVehicleTypes(db), 0);
  console.log("vehicle types ok");
}
{
  // Depo kâr–zarar: mazotla ödenen giriş değeri sayılır; eksik çıkışların nedeni satır satır döner
  const { yardPL } = await import("../js/yard-core.js");
  const { dumpFee } = await import("../js/dump-fees.js");
  const { workAmount } = await import("../js/collect-core.js");
  const dd = {
    dump_sites: [{ id: "Y", name: "Depo", own_yard: true }, { id: "BL", name: "Bolluca", fee: 160, fee_unit: "Ton" }, { id: "GK", name: "Göktürk dolgu" }],
    customers: [{ id: "IC", name: "İç", internal: true }, { id: "KL", name: "Kılıç" }, { id: "AY", name: "Ayşe" }],
    vehicles: [{ id: "T", name: "34GAM627", type: "Tır" }],
    work_records: [
      { id: "i1", date: "2026-10-12", customer_id: "KL", vehicle_id: "T", unit: "Sefer", quantity: 1, dump_site_id: "Y", customer_fuel_allowance_l: 100, price_snapshot: { price_source: "Mazot karşılığı", amount: 0 } },
      { id: "i2", date: "2026-10-12", customer_id: "AY", vehicle_id: "T", unit: "Sefer", quantity: 1, dump_site_id: "Y" },
      { id: "o1", date: "2026-10-12", customer_id: "IC", vehicle_id: "T", unit: "Sefer", quantity: 1, dump_site_id: "BL" },
      { id: "o2", date: "2026-10-12", customer_id: "IC", vehicle_id: "T", unit: "Sefer", quantity: 1 },
      { id: "o3", date: "2026-10-12", customer_id: "IC", vehicle_id: "T", unit: "Sefer", quantity: 1, dump_site_id: "GK" },
    ],
  };
  const st = yardStock(dd, { today });
  const p = yardPL(dd, st, { dumpFee, workAmount });
  assert.equal(p.income, 0, "mazotla ödenen iş TL sayılmaz"); assert.equal(p.fuelL, 100);
  assert.equal(p.unpriced, 1);
  assert.equal(p.dump, 0, "depodan çıkışta otomatik döküm ücreti yok");
  assert.equal(p.noCost, 3);
  dd.work_records[2].dump_cost = 3500;
  const p2 = yardPL(dd, yardStock(dd, { today }), { dumpFee, workAmount });
  assert.equal(p2.dump, 3500, "elle yazılan maliyet");
  assert.equal(p2.result, -3500);
  // müşteri işinde otomatik hesap sürer, elle yazılırsa o geçerli
  assert.equal(dumpFee(dd, { customer_id: "AY", vehicle_id: "T", unit: "Sefer", quantity: 1, dump_site_id: "BL" }).amount, 4320);
  assert.equal(dumpFee(dd, { customer_id: "AY", vehicle_id: "T", unit: "Sefer", quantity: 1, dump_site_id: "BL", dump_cost: 4000 }).amount, 4000);
  console.log("yard P&L ok");
}
