import assert from "node:assert/strict";
import { tankUnitCost, tankStatus } from "../js/core.js";
import { todayBoard } from "../js/today.js";
import { runAskTool } from "../js/day-summary.js";
import { validatePlan } from "../js/assistant-core.js";
const today = "2026-10-14";
const mv = [
  { id: "a", date: "2026-10-01", move_type: "GİRİŞ", liters: 1000, unit_price: 40 },
  { id: "b", date: "2026-10-10", move_type: "GİRİŞ", liters: 1000, total: 44000 },
  { id: "c", date: "2026-10-12", move_type: "GİRİŞ", liters: 500 }, // fiyatsız: ortalamaya girmez
  { id: "x", date: "2026-10-12", move_type: "ÇIKIŞ", liters: 1400 },
];
assert.equal(tankUnitCost(mv, "2026-10-05"), 40);
assert.equal(tankUnitCost(mv, today), 42);
assert.equal(tankUnitCost([], today), null);
const t = tankStatus(mv, today);
assert.equal(t.remaining, 1100); assert.equal(t.daily, 100); assert.equal(t.daysLeft, 11); assert.equal(t.unitCost, 42);
// pano: 3 günden az kaldıysa uyarı, eksi ise acil
let b = todayBoard({ fuel_tank_movements: [...mv, { id: "y", date: today, move_type: "ÇIKIŞ", liters: 900 }] }, { today, lastBackupAt: new Date().toISOString() });
let it = b.items.find((i) => i.group === "Depo");
assert.ok(it && /200 L kaldı/.test(it.text), JSON.stringify(b.items));
b = todayBoard({ fuel_tank_movements: [...mv, { id: "y", date: today, move_type: "ÇIKIŞ", liters: 1500 }] }, { today, lastBackupAt: new Date().toISOString() });
assert.equal(b.items.find((i) => i.group === "Depo").kind, "alert");
b = todayBoard({ fuel_tank_movements: mv }, { today, lastBackupAt: new Date().toISOString() });
assert.ok(!b.items.some((i) => i.group === "Depo"), "11 gün yeter: uyarı yok");
// soru aracı
const r = runAskTool({ fuel_tank_movements: mv }, "tank_status", {}, today);
assert.equal(r.kalan_litre, 1100); assert.equal(r.ortalama_litre_fiyati_TL, 42);
// asistan: depo girişi litre fiyatı ve veresiye
const d = { vehicles: [], customers: [], sites: [], personnel: [], suppliers: [{ id: "S", name: "Ahmet Petrol" }], fuel_tank_movements: [] };
let v = validatePlan({ tank_in: [{ liters: 5000, unit_price: 42.5, supplier_id: "S", credit: true }] }, { message: "depoya 5000 litre geldi litresi 42,5 Ahmet petrole veresiye", d, today });
assert.equal(v.tankIn[0].ok, true); assert.equal(v.tankIn[0].total, 212500); assert.equal(v.tankIn[0].supplier_id, "S");
v = validatePlan({ tank_in: [{ liters: 5000, unit_price: 45, credit: true }] }, { message: "depoya 5000 litre geldi litresi 42,5 veresiye", d, today });
assert.equal(v.tankIn[0].ok, false);
console.log("tank-cost PASS");
