import assert from "node:assert/strict";
let monthlySeries, vehicleSeries, lastMonths;
try { ({ monthlySeries, vehicleSeries, lastMonths } = await import("../js/finance-chart.js")); }
catch (e) { console.log("SKIP:", e.message); process.exit(0); }
assert.deepEqual(lastMonths("2026-02-10", 4), ["2025-11", "2025-12", "2026-01", "2026-02"]);
const data = {
  vehicles: [{ id: "v1", plate: "34 ABC 123" }, { id: "v2", name: "Kepçe" }],
  work_records: [
    { id: "1", date: "2026-10-05", vehicle_id: "v1", price_snapshot: { amount: 1000.5 } },
    { id: "2", date: "2026-10-06", vehicle_id: "v1" },
    { id: "3", date: "2026-09-30", vehicle_id: "v2", price_snapshot: { amount: 300 } },
    { id: "4", date: "2026-10-07", vehicle_id: "v2", price_snapshot: { amount: 999 }, deleted_at: "x", is_deleted: true },
  ],
  cash_records: [{ id: "c", date: "2026-10-08", cash_type: "Müşteriden Para Alındı", amount: 400.1 }, { id: "c2", date: "2026-10-08", cash_type: "Başka", amount: 5 }],
  expense_records: [{ id: "e", date: "2026-10-09", amount: 200.2, vehicle_id: "v1" }],
  fuel_records: [{ id: "f", date: "2026-10-10", total: 100.1, liters: 20, vehicle_id: "v1" }],
};
const m = monthlySeries(data, { today: "2026-10-14", months: 3 });
assert.equal(m.length, 3);
const oct = m.at(-1), sep = m.at(-2);
assert.equal(oct.work, 1000.5); assert.equal(oct.unpriced, 1); assert.equal(oct.works, 2);
assert.equal(oct.collected, 400.1); assert.equal(oct.cost, 300.3);
assert.equal(oct.profit, 700.2);
assert.equal(sep.work, 300);
const v = vehicleSeries(data, { today: "2026-10-14", days: 30 });
assert.equal(v[0].name, "34 ABC 123"); assert.equal(v[0].cost, 300.3); assert.equal(v[0].liters, 20);
console.log("finance-chart PASS");
// mazotla ödenen iş TL gelir sayılmaz, müşterinin verdiği mazot masraf sayılmaz: ikisi litre
{
  const { monthlySeries, vehicleSeries } = await import("../js/finance-chart.js");
  const dd = { fuel_tank_movements: [{ id: "m", date: "2026-09-01", move_type: "GİRİŞ", liters: 1000, unit_price: 40 }],
    work_records: [{ id: "w", date: "2026-10-10", vehicle_id: "V", customer_fuel_allowance_l: 300, price_snapshot: { amount: 0, price_source: "Mazot karşılığı" } }],
    fuel_records: [{ id: "f", date: "2026-10-11", vehicle_id: "V", liters: 100, fuel_source: "Müşteri Verdi", total: null }], expense_records: [], cash_records: [] };
  const m = monthlySeries(dd, { today: "2026-10-15", months: 1 })[0];
  assert.equal(m.fuelPay, 0); assert.equal(m.fuelPayL, 300); assert.equal(m.fuelGotL, 100); assert.equal(m.fuel, 0); assert.equal(m.profit, 0);
  assert.equal(vehicleSeries(dd, { today: "2026-10-15", days: 30 })[0].cost, 0);
  // parayla alınan mazot masraf olarak kalır
  const m3 = monthlySeries({ ...dd, fuel_records: [...dd.fuel_records, { id: "g", date: "2026-10-12", vehicle_id: "V", liters: 50, fuel_source: "Akaryakıt İstasyonu", total: 2250 }] }, { today: "2026-10-15", months: 1 })[0];
  assert.equal(m3.fuel, 2250); assert.equal(m3.profit, -2250);
  const { costRows } = await import("../js/costs-core.js");
  assert.equal(costRows(dd, { from: "2026-10-01", to: "2026-10-31" }).filter((r) => r.kind === "yakit").length, 0, "müşteri mazotu masraf listesinde yok");
  console.log("mazot-deger PASS");
}
