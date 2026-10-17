import assert from "node:assert/strict";
import { dumpAccounts, dumpAccountAlerts, depositSiteOf } from "../js/dump-account.js";
import { costRows, costTotals } from "../js/costs-core.js";
import { monthlySeries } from "../js/finance-chart.js";
const n = "x", today = "2026-10-16";
const d = {
  dump_sites: [{ id: "B", name: "Bolluca", fee: 160, fee_unit: "Ton", created_at: n }, { id: "C", name: "Cebeci", fee: 210, fee_unit: "Ton", created_at: n }],
  vehicles: [{ id: "V", name: "34GAM627", type: "Tır", created_at: n }], customers: [{ id: "K", name: "Kaya", created_at: n }],
  expense_records: [
    { id: "D1", date: "2026-10-01", category: "Döküm", amount: 30000, dump_site_id: "B", dump_deposit: true, created_at: n },
    { id: "X", date: "2026-10-02", category: "Yemek", amount: 500, created_at: n },
    { id: "L", date: "2026-09-01", category: "Döküm", company: "Cebeci döküm", amount: 10000, created_at: n },
  ],
  work_records: [
    ...Array.from({ length: 6 }, (_, i) => ({ id: "W" + i, date: "2026-10-1" + i, customer_id: "K", vehicle_id: "V", quantity: 1, unit: "Sefer", dump_site_id: "B", tonnage: i < 5 ? 25 : 0, created_at: n })),
    { id: "OLD", date: "2026-09-20", customer_id: "K", vehicle_id: "V", quantity: 1, unit: "Sefer", dump_site_id: "B", tonnage: 25, created_at: n }, // ilk yüklemeden önce
  ],
  fuel_records: [], maintenance_records: [], payables: [], payroll_entries: [], cash_records: [],
};
const [a] = dumpAccounts(d, { today });
assert.equal(a.site.id, "B"); assert.equal(a.dep, 30000);
assert.equal(a.trips, 6); assert.equal(a.used, 5 * 25 * 160 + 27 * 160, "5 fişli + 1 tahmini (tır 27 t)");
assert.equal(a.balance, 30000 - 24320); assert.equal(a.missingTon, 1);
assert.ok(a.daysLeft != null);
assert.ok(dumpAccountAlerts(d, { today }).some((x) => /Bolluca döküm hesabında/.test(x.text)), "günde ~1737 ₺, 5680 ₺ kaldı → 3 gün? ");
// Yükleme gider sayılmaz; döküm ücreti sayılır
const t = costTotals(costRows(d, { from: "2026-10-01", to: "2026-10-31" }));
assert.equal(t.gider, 500); assert.equal(t.dokum, 24320);
assert.equal(monthlySeries(d, { today: "2026-10-31", months: 1 })[0].expense, 500);
// Eski gider: firmasında saha adı geçiyor → Cebeci
assert.equal(depositSiteOf(d, d.expense_records[2]).id, "C");
assert.equal(depositSiteOf(d, d.expense_records[1]), null);
console.log("dump-account ok");
