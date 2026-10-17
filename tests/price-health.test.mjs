import assert from "node:assert/strict";
import { priceHealth, fuelPriceAt } from "../js/price-health.js";
const n = "x", today = "2026-10-16";
const W = (id, date, extra) => ({ id, date, customer_id: "C", vehicle_id: "V", work_type: "Hafriyat Nakliye", quantity: 1, unit: "Sefer", dump_site_id: "B", tonnage: 25, created_at: n, ...extra });
const d = {
  customers: [{ id: "C", name: "Kaya", created_at: n }, { id: "K", name: "Kılıç", created_at: n }],
  vehicles: [{ id: "V", name: "34GAM627", type: "Tır", created_at: n }],
  dump_sites: [{ id: "B", name: "Bolluca", fee: 160, fee_unit: "Ton", created_at: n }],
  work_records: [
    ...Array.from({ length: 10 }, (_, i) => W("W" + i, addD(i * 15), { price_snapshot: { unit_price: 6000, amount: 6000 } })),
    W("K1", "2026-10-10", { customer_id: "K", customer_fuel_allowance_l: 75 }),
  ],
  fuel_records: [
    { id: "F0", date: "2026-05-01", vehicle_id: "V", liters: 400, total: 16000, fuel_source: "İstasyon", created_at: n }, // 40 ₺
    { id: "F1", date: "2026-10-10", vehicle_id: "V", liters: 400, total: 20000, fuel_source: "İstasyon", created_at: n }, // 50 ₺
  ],
  fuel_tank_movements: [],
};
function addD(k) { const t = new Date("2026-06-01T12:00:00Z"); t.setUTCDate(t.getUTCDate() + k); return t.toISOString().slice(0, 10); }
assert.equal(Math.round(fuelPriceAt(d, "2026-05-20")), 40); assert.equal(Math.round(fuelPriceAt(d, today)), 50);
const [r] = priceHealth(d, { today });
assert.equal(r.customer, "Kaya"); assert.equal(r.price, 6000); assert.equal(r.since, "2026-06-01");
assert.equal(r.dump, 4000, "25 ton × 160");
assert.ok(r.fuelL > 0 && r.fuelCost > 0);
assert.equal(r.cost, r.dump + r.fuelCost); assert.ok(r.margin < 20);
assert.ok(r.suggest > 6000, "zam önerisi"); assert.match(r.why, /mazot litresi 40 → 50/);
assert.equal(priceHealth(d, { today }).length, 1, "mazotla ödenen iş sayılmaz");
console.log("price-health ok");
