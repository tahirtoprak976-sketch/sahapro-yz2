import assert from "node:assert/strict";
import { costRows, costTotals } from "../js/costs-core.js";
import { monthlySeries } from "../js/finance-chart.js";
const n = "x";
const d = {
  vehicles: [{ id: "V", name: "Kamyon 1", created_at: n }], suppliers: [{ id: "S", name: "Lastikçi Ali", created_at: n }],
  expense_records: [{ id: "E1", date: "2026-10-02", amount: 1000, category: "Yemek", created_at: n }],
  fuel_records: [{ id: "F1", date: "2026-10-03", vehicle_id: "V", liters: 100, total: 4500, fuel_source: "Depo Tankı", created_at: n }],
  fuel_tank_movements: [{ id: "T1", date: "2026-10-01", move_type: "GİRİŞ", liters: 1000, total: 45000, created_at: n }],
  maintenance_records: [{ id: "M1", date: "2026-10-04", vehicle_id: "V", cost: 3000, maint_type: "Arıza", created_at: n }],
  payables: [
    { id: "P1", date: "2026-10-05", party_type: "supplier", party_id: "S", gross_total: 2400, cost_category: "Lastik", created_at: n },
    { id: "P2", date: "2026-10-05", party_type: "supplier", party_id: "S", gross_total: 3000, source_store: "maintenance_records", source_id: "M1", created_at: n },
    { id: "P3", date: "2026-10-01", party_type: "supplier", party_id: "S", gross_total: 45000, source_store: "fuel_tank_movements", source_id: "T1", created_at: n },
  ],
  work_records: [{ id: "W", date: "2026-10-06", quantity: 2, unit: "Sefer", price_snapshot: { amount: 20000 }, created_at: n }],
};
const rows = costRows(d, { from: "2026-10-01", to: "2026-10-31" });
const t = costTotals(rows);
assert.deepEqual(t, { gider: 1000, yakit: 4500, bakim: 3000, esnaf: 2400, dokum: 0, personel: 0, total: 10900 }, "bakıma bağlı ve depo alışı esnaf faturası iki kez sayılmaz");
const m = monthlySeries(d, { today: "2026-10-15", months: 1 })[0];
assert.equal(m.cost, 10900, "grafik ve Giderler aynı");
assert.equal(m.profit, 20000 - 10900);
console.log("costs ok");
