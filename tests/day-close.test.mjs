import assert from "node:assert/strict";
import { dayCloseChecks } from "../js/day-close-core.js";
import { todayBoard } from "../js/today.js";
const n = "x", date = "2026-10-16"; // Cuma
const d = {
  customers: [{ id: "C1", name: "Kaya", created_at: n }, { id: "K", name: "Kılıç Hafriyat", created_at: n }, { id: "D", name: "Depo", internal: true, created_at: n }],
  vehicles: [{ id: "V1", name: "34GAM627", type: "Tır", assignee_id: "P1", created_at: n }, { id: "J", name: "JCB", type: "İş Makinesi", created_at: n }],
  personnel: [{ id: "P1", name: "Soner", created_at: n }, { id: "P2", name: "Olcay", vehicle_id: "J", created_at: n }, { id: "P3", name: "Ofis", created_at: n }],
  work_records: [
    { id: "W1", date, customer_id: "C1", vehicle_id: "V1", quantity: 2, unit: "Sefer", dump_site_id: "B", created_at: n }, // fiyat + fiş yok
    { id: "W2", date, customer_id: "C1", vehicle_id: "V1", quantity: 1, unit: "Sefer", dump_site_id: "B", slip_no: "A1", price_snapshot: { amount: 4000 }, created_at: n }, // tam
    { id: "W3", date, customer_id: "D", vehicle_id: "V1", quantity: 1, unit: "Sefer", created_at: n }, // iç iş: fiyat aranmaz
    { id: "W4", date: "2026-10-10", customer_id: "C1", vehicle_id: "V1", quantity: 1, unit: "Sefer", created_at: n }, // biriken fiyatsız
    ...[1, 2, 3].map((i) => ({ id: "K" + i, date: "2026-10-1" + i, customer_id: "K", vehicle_id: "V1", quantity: 1, unit: "Sefer", customer_fuel_allowance_l: 75, created_at: n })),
    { id: "H1", date: "2026-08-20", customer_id: "C1", vehicle_id: "V1", quantity: 1, unit: "Sefer", price_snapshot: { amount: 5000 }, created_at: n },
  ],
  fuel_records: [{ id: "F1", date, vehicle_id: "V1", liters: 300, created_at: n }, { id: "F0", date: "2026-10-01", vehicle_id: "V1", liters: 50, fuel_source: "Müşteri Verdi", customer_id: "K", created_at: n }],
  expense_records: [{ id: "X1", date, category: "Yemek", amount: 300, created_at: n }, { id: "X2", date, category: "Otoyol", amount: 100, created_at: n }],
  personnel_events: [], cash_records: [{ id: "CR", date, amount: 5000, cash_status: "PERSONELDE", personnel_id: "P1", created_at: n }],
  hakedis: [{ id: "HK", customer_id: "C1", status: "Kesinleşti", items: [{ work_record_id: "W2" }], created_at: n }], maintenance_records: [],
};
const r = dayCloseChecks(d, { date, attCount: { "expense:X2": 1 } });
const t = r.items.map((i) => i.text);
assert.ok(t.includes("Eksik: fiyat, döküm fişi"), t.join(" | "));
assert.equal(r.items.filter((i) => i.href === "#/isler/W2" || i.href === "#/isler/W3").length, 0, "tam iş ve iç iş temiz");
assert.ok(t.includes("Yakıtta km yok"));
assert.equal(t.filter((x) => x === "Fişsiz gider").length, 1, "fotoğraflı gider sayılmaz");
assert.ok(t.includes("Olcay: bugün kayıt yok")); assert.ok(!t.some((x) => /Soner: bugün/.test(x)), "Soner'in aracı çalıştı"); assert.ok(!t.some((x) => /Ofis/.test(x)), "aracı olmayan sayılmaz");
assert.ok(t.some((x) => /Personelde para/.test(x)));
assert.ok(t.some((x) => /^2 işin fiyatı yok|^1 işin fiyatı yok/.test(x)), t.join(" | "));
assert.ok(t.some((x) => /Kaya: 1 iş hakedişe girmemiş/.test(x)), "H1 (eski, fiyatlı, hakedişsiz)");
assert.ok(t.some((x) => /34GAM627: Kılıç Hafriyat'dan 175 L mazot alınmadı/.test(x)), t.join(" | "));
assert.equal(r.items[0].group, "Bugün");
// Puantajda izin işaretlenince uyarı kalkar
d.personnel_events.push({ id: "E", date, personnel_id: "P2", event_type: "İzin", created_at: n });
assert.ok(!dayCloseChecks(d, { date }).items.some((i) => /Olcay/.test(i.text)));
// Ana sayfa maddesi
const b = todayBoard(d, { today: date, lastBackupAt: new Date().toISOString(), dayCloseOpen: 4 });
assert.ok(b.items.some((i) => i.text === "Günü kapat: 4 eksik" && i.href === "#/gunsonu"));
assert.ok(!todayBoard(d, { today: date, lastBackupAt: new Date().toISOString() }).items.some((i) => /Günü kapat/.test(i.text)));
console.log("day-close ok");
{
  const { dayCloseChecks } = await import("../js/day-close-core.js");
  const n = "x", date = "2026-10-16";
  const d = { customers: [{ id: "C", name: "K", created_at: n }], vehicles: [{ id: "V", name: "34GA2261", type: "Kamyon", created_at: n }], personnel: [],
    work_records: [{ id: "Z", date, customer_id: "C", vehicle_id: "V", quantity: 1, unit: "Sefer", tonnage: 31, slip_no: "F-77", price_snapshot: { amount: 1 }, created_at: n },
      { id: "B", date: "2026-10-14", customer_id: "C", vehicle_id: "V", quantity: 1, unit: "Sefer", tonnage: 20, slip_no: "f77", price_snapshot: { amount: 1 }, created_at: n }],
    fuel_records: [], expense_records: [], personnel_events: [], cash_records: [], hakedis: [], maintenance_records: [] };
  const t = dayCloseChecks(d, { date }).items.map((i) => i.text);
  assert.ok(t.some((x) => /Tonaj yüksek: 31 ton/.test(x)), t.join("|")); assert.ok(t.some((x) => /Aynı fiş no iki işte: F-77/.test(x)), t.join("|"));
  console.log("day-close tonaj ok");
}
