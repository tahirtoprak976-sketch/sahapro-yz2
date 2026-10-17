import assert from "node:assert/strict";
import { invoiceDraft, invoiceQueue, uninvoicedWorks, draftText, workNet } from "../js/invoice-core.js";
const n = "x";
const W = (id, date, extra) => ({ id, date, customer_id: "C", site_id: "S", work_type: "Hafriyat Nakliye", quantity: 1, unit: "Sefer", price_snapshot: { unit_price: 4000, amount: 4000, kdv_rate: 20, kdv_included: false }, created_at: n, ...extra });
const d = {
  customers: [{ id: "C", name: "Kaya", tax_title: "KAYA İNŞAAT LTD. ŞTİ.", tax_no: "1234567890", tax_office: "Kozyatağı", address: "Ataşehir", kdv_withholding: "2/10", created_at: n }, { id: "D", name: "Depo", internal: true, created_at: n }, { id: "E", name: "Eksik", created_at: n }],
  sites: [{ id: "S", name: "Kütükevler", customer_id: "C", created_at: n }],
  work_records: [
    W("1", "2026-10-01"), W("2", "2026-10-03", { quantity: 2, price_snapshot: { unit_price: 4000, amount: 8000, kdv_rate: 20 } }),
    W("3", "2026-10-05", { work_type: "Makine Çalışması", unit: "Saat", quantity: 8, price_snapshot: { unit_price: 1800, amount: 14400, kdv_rate: 20, kdv_included: true } }),
    W("4", "2026-10-06", { invoice_no: "ABC2026000001" }), W("5", "2026-10-07", { customer_id: "D" }), W("6", "2026-10-08", { customer_fuel_allowance_l: 75 }),
    W("7", "2026-10-02", { customer_id: "E" }),
  ],
};
assert.equal(workNet(d.work_records[2]).net, 12000, "KDV dahil 14.400 → 12.000");
assert.deepEqual(uninvoicedWorks(d, { customerId: "C" }).map((w) => w.id), ["1", "2", "3"]);
const F = invoiceDraft(d, "C");
assert.equal(F.lines.length, 2); assert.equal(F.lines[0].qty, 3); assert.equal(F.lines[0].net, 12000); assert.match(F.lines[0].desc, /Kütükevler \(01\.10\.2026–03\.10\.2026\)/);
assert.equal(F.net, 24000); assert.equal(F.kdv, 4800); assert.equal(F.withheld, 960); assert.equal(F.payable, 27840);
assert.match(draftText(F), /VKN\/TCKN: 1234567890/); assert.match(draftText(F), /tevkifatı \(2\/10\): −960,00/);
const Q = invoiceQueue(d, { today: "2026-10-16" });
assert.deepEqual(Q.map((q) => q.customer.id), ["C", "E"]); assert.equal(Q[0].oldestDays, 15);
assert.deepEqual(Q[1].missing, ["vergi / TC no", "vergi dairesi", "adres"]);
console.log("invoice-core ok");
