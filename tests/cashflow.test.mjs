import assert from "node:assert/strict";
import { cashForecast, payLag, forecastSummary } from "../js/cashflow-core.js";
const n = "x", today = "2026-10-16";
const d = {
  customers: [{ id: "C1", name: "Kaya", created_at: n }, { id: "C2", name: "Leda", created_at: n }],
  work_records: [
    { id: "W1", date: "2026-08-25", customer_id: "C1", quantity: 1, unit: "Sefer", price_snapshot: { amount: 100000 }, created_at: n },
    { id: "W2", date: "2026-10-10", customer_id: "C2", quantity: 1, unit: "Sefer", price_snapshot: { amount: 50000 }, created_at: n },
  ],
  cari_movements: [{ id: "M1", date: "2026-09-20", customer_id: "C2", type: "Tahsilat", amount: -1, created_at: n }, { id: "M2", date: "2026-10-05", customer_id: "C2", type: "Tahsilat", amount: -1, created_at: n }],
  hakedis: [], cash_records: [],
  instruments: [{ id: "Q1", kind: "Çek", direction: "Alınan", party_type: "customer", party_id: "C1", amount: 30000, due_date: "2026-10-25", status: "Portföyde", created_at: n }],
  suppliers: [{ id: "E1", name: "Lastikçi", created_at: n }],
  payables: [{ id: "B1", party_type: "supplier", party_id: "E1", gross_total: 20000, date: "2026-10-01", due_date: "2026-10-20", status: "Açık", created_at: n }],
  supplier_payments: [{ id: "SP", party_id: "E1", amount: 5000, date: "2026-10-05", created_at: n }],
  personnel: [{ id: "P1", name: "Soner", salary: 30000, created_at: n }, { id: "P2", name: "Bekir", daily_wage: 1500, pay_type: "Yevmiye", created_at: n }],
  payroll_entries: [{ id: "PE", date: "2026-10-10", period: "2026-10", personnel_id: "P2", kind: "Avans", amount: 1000, created_at: n }],
  personnel_events: [], vehicles: [],
  fuel_records: [{ id: "F1", date: "2026-10-10", liters: 300, total: 13500, fuel_source: "İstasyon", created_at: n }, { id: "F2", date: "2026-10-11", liters: 100, fuel_source: "Müşteri Verdi", created_at: n }],
  fuel_tank_movements: [], expense_records: [{ id: "X", date: "2026-10-01", amount: 6000, created_at: n }], maintenance_records: [],
  documents: [{ id: "D1", category: "Kasko", vehicle_id: "V", expiry_date: "2026-11-01", amount: 25000, date: "2025-11-01", created_at: n }],
};
assert.equal(payLag(d, "C2", today), 15, "2 tahsilat arası 15 gün");
assert.equal(payLag(d, "C1", today), 45, "veri yok");
const F = cashForecast(d, { today, notes: { C1: { promise_date: "2026-10-20", promise_amount: 40000 } }, cashOnHand: 10000 });
const all = F.weeks.flatMap((w) => w.items);
const find = (re) => all.find((i) => re.test(i.label));
assert.equal(find(/Kaya — ödeme sözü/).amount, 40000); assert.ok(find(/Kaya — ödeme sözü/).sure);
assert.equal(find(/Kaya — alacak/).amount, 30000, "100.000 − 40.000 söz − 30.000 çek"); assert.ok(!find(/Kaya — alacak/).sure);
assert.ok(find(/Kaya — alacak/).late, "25 Ağustos + 45 gün geçti");
assert.equal(find(/Çek tahsili/).amount, 30000);
assert.equal(find(/Lastikçi borcu/).amount, 15000); assert.equal(find(/Lastikçi borcu/).date, "2026-10-20");
assert.equal(find(/Leda — alacak/).date, "2026-10-25", "10 Ekim + 15 gün");
assert.equal(find(/kartındaki ücret/).amount, 30000, "puantaj kullanmayan Soner");
assert.equal(find(/Kasko yenileme/).amount, 25000);
assert.equal(find(/Mazot/).amount, 3150, "13.500 / 30 × 7 (müşteri verdiği hariç)");
assert.equal(F.weeks.length, 5); assert.equal(F.start, 10000);
const w0 = F.weeks[0];
assert.equal(w0.good, 10000 + w0.inSure + w0.inEst - w0.outSure - w0.outEst);
assert.ok(F.lowBad.amount <= F.lowGood.amount);
assert.ok(forecastSummary(F).haftalar.length === 5);
// Elde para yazılmamışsa
assert.equal(cashForecast(d, { today }).start, null);
console.log("cashflow ok");
