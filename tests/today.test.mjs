import assert from "node:assert/strict";
let todayBoard, smartAlerts, backupAgeDays, latestDocuments;
try {
  ({ todayBoard } = await import("../js/today.js"));
  ({ smartAlerts, backupAgeDays, latestDocuments } = await import("../js/core.js"));
} catch (e) {
  console.log("SKIP (tarayıcı gerektirir):", e.message);
  process.exit(0);
}
const today = "2026-10-13";
const data = {
  vehicles: [{ id: "v1", name: "Hyundai", plate: "34 ABC 123", next_maintenance_date: "2026-10-16" }],
  personnel: [{ id: "p1", name: "Ali" }],
  documents: [
    { id: "d1", vehicle_id: "v1", owner_type: "vehicle", category: "Muayene Belgesi", expiry_date: "2026-09-01" }, // eski, yenilendi
    { id: "d2", vehicle_id: "v1", owner_type: "vehicle", category: "Muayene Belgesi", expiry_date: "2027-09-01" },
    { id: "d3", vehicle_id: "v1", owner_type: "vehicle", category: "Kasko", expiry_date: "2026-10-10" },
    { id: "d4", personnel_id: "p1", owner_type: "personnel", category: "SRC", expiry_date: "2026-10-20" },
  ],
  suppliers: [{ id: "S", name: "Mesut Lastik" }],
  payables: [{ id: "b1", party_type: "supplier", party_id: "S", date: "2026-10-13", due_date: "2026-10-13", gross_total: 500, status: "Onaylandı", items: [] }],
  supplier_payments: [{ id: "p", party_id: "S", payable_id: "b1", amount: 200, date: "2026-10-13" }],
  maintenance_records: [],
};
// yenilenen eski belge uyarı vermez
const al = smartAlerts({ ...data, fuel_tank_movements: [] }, { today, lastBackupAt: new Date().toISOString() }).filter((a) => a.key === "doc_expiry");
assert.equal(al.length, 2, "yalnız Kasko ve SRC");
assert.equal(latestDocuments(data.documents).length, 3);
const b = todayBoard(data, { today, lastBackupAt: null });
const txt = b.items.map((i) => i.text).join("|");
assert.ok(txt.includes("34 ABC 123 · Kasko"));
assert.ok(txt.includes("Ali · SRC"));
assert.ok(!txt.includes("Muayene"), "yenilenmiş muayene çıkmamalı");
assert.ok(txt.includes("34 ABC 123 bakım"));
const esn = b.items.find((i) => i.group === "Esnaf");
assert.equal(esn.amount, 300);
assert.equal(esn.kind, "info", "esnaf borcu vade gecikmesi sayılmaz");
const y = b.items.find((i) => i.group === "Yedek");
assert.equal(y.kind, "alert");
assert.equal(b.items[0].kind, "alert");
// yedek yaşı
const now = new Date("2026-10-13T10:00:00");
assert.equal(backupAgeDays(null, today), null);
assert.equal(backupAgeDays(new Date("2026-10-13T08:00:00").toISOString(), today), 0);
assert.equal(backupAgeDays(new Date("2026-10-10T08:00:00").toISOString(), today), 3);
assert.equal(todayBoard(data, { today, lastBackupAt: new Date("2026-10-12T08:00:00").toISOString() }).items.some((i) => i.group === "Yedek"), false);
assert.equal(todayBoard(data, { today, lastBackupAt: new Date("2026-10-09T08:00:00").toISOString() }).items.find((i) => i.group === "Yedek").kind, "warn");
// ehliyet kaydı olmayan çalışan
const d2 = { ...data, personnel: [...data.personnel, { id: "p2", name: "Veli" }], work_records: [{ id: "w", date: "2026-10-10", personnel_id: "p2" }, { id: "w2", date: "2026-10-11", personnel_id: "p1" }, { id: "w3", date: "2026-01-01", personnel_id: "p1" }] };
const pl = todayBoard(d2, { today, lastBackupAt: new Date().toISOString() }).items.find((i) => i.group === "Personel");
assert.equal(pl.text, "2 çalışanın ehliyet kaydı yok");
const d3 = { ...d2, documents: [...d2.documents, { id: "e1", personnel_id: "p2", owner_type: "personnel", category: "Ehliyet", expiry_date: "2030-01-01" }, { id: "e2", personnel_id: "p1", owner_type: "personnel", category: "Ehliyet", expiry_date: "2030-01-01" }] };
assert.equal(todayBoard(d3, { today, lastBackupAt: new Date().toISOString() }).items.some((i) => i.group === "Personel"), false);
console.log("today PASS");
