import assert from "node:assert/strict";
import { customerReportData, customerReportSpec, periodRange } from "../js/customer-report.js";
const n = "x";
const d = {
  customers: [{ id: "H", name: "Hisar Polat", created_at: n }, { id: "A", name: "Ağırtaş", parent_customer_id: "H", created_at: n }],
  vehicles: [{ id: "V", name: "34GAM627", created_at: n }], personnel: [{ id: "P", name: "Bayram", created_at: n }], dump_sites: [{ id: "D", name: "Bolluca", created_at: n }], quarries: [{ id: "Q", name: "Ento Maden", created_at: n }],
  work_records: [
    { id: "W1", date: "2026-10-02", customer_id: "H", vehicle_id: "V", personnel_id: "P", work_type: "Mıcır Nakliye", quantity: 2, unit: "Sefer", quarry_id: "Q", dump_site_id: "D", tonnage: 54.4, slip_no: "777", price_snapshot: { unit_price: 5000, amount: 10000 }, created_at: n },
    { id: "W2", date: "2026-09-10", customer_id: "H", vehicle_id: "V", work_type: "JCB Çalışması", quantity: 8, unit: "Saat", created_at: n },
    { id: "W3", date: "2026-10-05", customer_id: "A", vehicle_id: "V", work_type: "Moloz Nakliye", quantity: 1, unit: "Sefer", price_snapshot: { amount: 3000 }, created_at: n },
    { id: "W0", date: "2026-08-01", customer_id: "H", vehicle_id: "V", work_type: "Moloz Nakliye", quantity: 1, unit: "Sefer", price_snapshot: { amount: 4000 }, created_at: n },
  ],
  cash_records: [{ id: "K1", date: "2026-10-03", customer_id: "H", cash_type: "Müşteriden Para Alındı", amount: 6000, payment_method: "Nakit", created_at: n }],
  cari_movements: [{ id: "M1", date: "2026-10-03", customer_id: "H", type: "Tahsilat", amount: -6000, ref_id: "K1", note: "Tahsilat", created_at: n }],
};
const rg = periodRange("month", "2026-10-15");
assert.deepEqual([rg.from, rg.to], ["2026-10-01", "2026-10-15"]);
assert.deepEqual(Object.values(periodRange("last", "2026-10-15")).slice(0, 2), ["2026-09-01", "2026-09-30"]);
const R = customerReportData(d, "H", { from: rg.from, to: rg.to, today: "2026-10-15" });
assert.equal(R.works.length, 1); assert.equal(R.totals.workTotal, 10000); assert.equal(R.totals.collected, 6000);
assert.equal(R.statement.opening, 4000, "Ağustos işi devir"); assert.equal(R.statement.closing, 8000);
assert.equal(R.works[0].from, "Ento Maden"); assert.equal(R.works[0].to, "Bolluca"); assert.equal(R.works[0].personnel, "Bayram");
assert.equal(R.collections[0].method, "Nakit");
assert.equal(R.months.length, 12); assert.equal(R.months.at(-1).work, 10000); assert.equal(R.months.at(-1).collected, 6000);
const RS = customerReportData(d, "H", { from: rg.from, to: rg.to, subs: true, today: "2026-10-15" });
assert.equal(RS.works.length, 2); assert.equal(RS.works[1].customer, "Ağırtaş");
const spec = customerReportSpec(RS, { audience: "internal" });
const titles = spec.sections.map((s) => s.title).filter(Boolean);
for (const t of ["Müşteri ve Dönem", "Özet", "İş Dökümü", "Tahsilatlar", "Cari Ekstre", "Yaşlandırma"]) assert.ok(titles.some((x) => x.startsWith(t)), t);
assert.equal(spec.sections.find((s) => s.title === "İş Dökümü").rows[0][5], "Ento Maden → Bolluca");
assert.ok(!customerReportSpec(R, { audience: "customer" }).sections.some((s) => s.title === "Yaşlandırma"), "müşteri nüshasında yaşlandırma yok");
console.log("customer-report ok");
