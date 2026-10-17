import assert from "node:assert/strict";
import { dayGrid, payrollFor, payrollAll, payslipText, payrollSummary, monthDays, workDaysOf } from "../js/payroll-core.js";
import { costRows, costTotals } from "../js/costs-core.js";
import { monthlySeries } from "../js/finance-chart.js";
import { runAskTool } from "../js/day-summary.js";
const n = "x", per = "2026-10", today = "2026-10-15";
const W = (id, date, extra) => ({ id, date, customer_id: "C", unit: "Sefer", quantity: 1, created_at: n, ...extra });
const E = (id, date, pid, event_type, extra = {}) => ({ id, date, personnel_id: pid, event_type, created_at: n, ...extra });
const d = {
  personnel: [
    { id: "A", name: "Ali Şoför", pay_type: "Aylık", salary: 30000, overtime_rate: 200, created_at: n },
    { id: "B", name: "Bekir Operatör", pay_type: "Yevmiye", daily_wage: 1500, created_at: n },
    { id: "Z", name: "Eski", active: false, created_at: n },
  ],
  vehicles: [{ id: "V", name: "34GAM627", assignee_id: "A", created_at: n }, { id: "J", name: "JCB", created_at: n }],
  customers: [{ id: "C", name: "Kaya", created_at: n }],
  work_records: [
    W("1", "2026-10-01", { vehicle_id: "V" }), W("2", "2026-10-01", { vehicle_id: "V" }), W("3", "2026-10-02", { vehicle_id: "V" }),
    W("4", "2026-10-03", { vehicle_id: "J", personnel_id: "B" }), W("5", "2026-10-05", { vehicle_id: "J", personnel_id: "B" }),
    W("6", "2026-10-06", { vehicle_id: "V", personnel_id: "B" }), // başkası kullandı: Ali'ye sayılmaz
  ],
  personnel_events: [
    E("e1", "2026-10-07", "A", "Devamsızlık"), E("e2", "2026-10-08", "A", "İzin"), E("e3", "2026-10-09", "A", "Rapor"),
    E("e4", "2026-10-06", "A", "Mesai", { hours_days: 5 }), E("e5", "2026-10-10", "A", "Avans", { amount: 5000 }),
    E("e6", "2026-10-07", "B", "Çalıştı"), E("e7", "2026-10-08", "B", "Yarım Gün"),
    E("e8", "2026-09-30", "A", "Avans", { amount: 999 }), // geçen ay
    E("e9", "2026-10-11", "A", "Devamsızlık", { deleted_at: "y" }), // silinmiş
  ],
  payroll_entries: [{ id: "p1", date: "2026-10-12", period: per, personnel_id: "A", kind: "Avans", amount: 2000, method: "Nakit", created_at: n }],
};
assert.equal(monthDays(per).length, 31);
assert.deepEqual([...workDaysOf(d, d.personnel[0], per).keys()], ["2026-10-01", "2026-10-02"], "zimmetli aracın adsız işleri");
const g = dayGrid(d, d.personnel[0], per, { today });
const st = (date) => g.find((x) => x.date === date).st;
assert.equal(st("2026-10-01"), "C"); assert.equal(g.find((x) => x.date === "2026-10-01").works, 2);
assert.equal(st("2026-10-04"), "P", "pazar"); assert.equal(st("2026-10-07"), "D"); assert.equal(st("2026-10-08"), "I");
assert.equal(st("2026-10-13"), "?"); assert.equal(st("2026-10-20"), "", "gelecek");
assert.equal(st("2026-10-11"), "P", "silinen işaret sayılmaz (pazar)");

const a = payrollFor(d, d.personnel[0], per, { today });
assert.equal(a.type, "Aylık"); assert.equal(a.cnt.D, 1); assert.equal(a.base, 29000, "30.000 − 1 gün (1.000)");
assert.equal(a.otHours, 5); assert.equal(a.overtime, 1000); assert.equal(a.gross, 30000);
assert.equal(a.advances, 7000, "saha avansı + defter avansı; geçen ayınki yok");
assert.equal(a.remaining, 23000); assert.equal(a.closed, false);
assert.ok(a.warns.some((w) => /gün boş/.test(w)));

const b = payrollFor(d, d.personnel[1], per, { today });
assert.equal(b.type, "Yevmiye"); assert.equal(b.cnt.C, 4); assert.equal(b.cnt.Y, 1);
assert.equal(b.base, 6750, "4,5 gün × 1.500"); assert.equal(b.remaining, 6750);

// Ay kapatıldı + ödeme
d.payroll_entries.push({ id: "p2", date: "2026-10-31", period: per, personnel_id: "A", kind: "Ücret Tahakkuku", amount: 30000, created_at: n },
  { id: "p3", date: "2026-10-15", period: per, personnel_id: "A", kind: "Ücret Ödemesi", amount: 20000, method: "Nakit", created_at: n });
const a2 = payrollFor(d, d.personnel[0], per, { today });
assert.equal(a2.closed, true); assert.equal(a2.paid, 20000); assert.equal(a2.remaining, 3000);
// Puantaj sonradan değişirse uyarı
d.personnel_events.push(E("e10", "2026-10-13", "A", "Devamsızlık"));
const a3 = payrollFor(d, d.personnel[0], per, { today });
assert.ok(a3.warns.some((w) => /sonradan değişti/.test(w))); assert.equal(a3.remaining, 3000, "kapanış tutarı esas");

// Masraf: yalnız tahakkuk (avans ve ödeme sayılmaz)
const t = costTotals(costRows(d, { from: "2026-10-01", to: "2026-10-31" }));
assert.equal(t.personel, 30000);
const m = monthlySeries(d, { today: "2026-10-31", months: 1 })[0];
assert.equal(m.pay, 30000); assert.equal(m.cost, 30000 + m.expense + m.fuel + m.maint + m.esnaf + m.dump);

// Liste: pasif personel yok
assert.deepEqual(payrollAll(d, per, { today }).map((x) => x.p.id), ["A", "B"]);
const txt = payslipText(d.personnel[0], a2, { company: "Muratoğlu" });
assert.match(txt, /Avans: − 7\.000 ₺/); assert.match(txt, /Kalan: 3\.000 ₺/);
assert.equal(payrollSummary(d.personnel[1], b).hak_edilen_TL, 6750);
// Sohbet aracı
const r = runAskTool(d, "payroll_status", { personnel: "Bekir" }, today);
assert.equal(r.personeller.length, 1); assert.equal(r.personeller[0].kalan_TL, 6750);
assert.equal(runAskTool(d, "payroll_status", {}, today).personeller.length, 2);
console.log("payroll ok");
{
  const { payrollFor } = await import("../js/payroll-core.js");
  const dd = { personnel: [{ id: "A", name: "Ali", salary: 30000, created_at: "x" }], vehicles: [], work_records: [], personnel_events: [], payroll_entries: [],
    expense_records: [{ id: "x1", date: "2026-10-05", personnel_id: "A", payment_method: "Personel Ödedi", reimbursement_status: "Bekliyor", amount: 450, category: "Yemek", created_at: "x" },
      { id: "x2", date: "2026-10-06", personnel_id: "A", payment_method: "Personel Ödedi", reimbursement_status: "Ödendi", amount: 999, created_at: "x" }],
    maintenance_records: [{ id: "m1", date: "2026-10-07", paid_by_personnel_id: "A", reimbursement_status: "Bekliyor", cost: 1200, maint_type: "Lastik", created_at: "x" }] };
  const r = payrollFor(dd, dd.personnel[0], "2026-10", { today: "2026-10-31" });
  assert.equal(r.reimb, 1650); assert.equal(r.reimbItems.length, 2); assert.equal(r.remaining, 31650);
  console.log("payroll reimb ok");
}
