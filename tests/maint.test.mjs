import assert from "node:assert/strict";
import { meterNow, lastDone, ruleStatus, maintenanceBoard, templatesFor, isRoadVehicle, newRule, maintSummary, meterAt } from "../js/maint-core.js";
const n = "x", today = "2026-10-16";
const T = { id: "T", name: "34GAM627", type: "Tır", km: 240000, meter_date: "2026-09-01", created_at: n,
  service_rules: [{ id: "r1", title: "Motor yağı + filtre", every_km: 20000, keywords: "motor yag,yag bakim" }, { id: "r2", title: "Fren kontrolü", every_days: 90, keywords: "fren" }, { id: "r3", title: "Hava filtresi", every_km: 40000 }] };
const J = { id: "J", name: "JCB", type: "Kazıcı Yükleyici", machine_hours: 4800, meter_date: "2026-09-01", created_at: n,
  service_rules: [{ id: "j1", title: "Motor yağı + filtre", every_hours: 500, last: { date: "2026-06-01", hours: 4500 } }] };
const d = {
  vehicles: [T, J],
  fuel_records: [
    { id: "f1", date: "2026-09-15", vehicle_id: "T", liters: 300, km: 243000, created_at: n },
    { id: "f2", date: "2026-10-10", vehicle_id: "T", liters: 300, km: 249000, created_at: n },
  ],
  meter_readings: [{ id: "m1", date: "2026-10-01", vehicle_id: "J", kind: "hours", value: 4950, created_at: n }],
  maintenance_records: [
    { id: "b1", date: "2026-08-20", vehicle_id: "T", maint_type: "Bakım", description: "Motor yağı değişimi", status: "Tamamlandı", created_at: n },
    { id: "b2", date: "2026-07-01", vehicle_id: "T", maint_type: "Bakım", description: "fren balata", status: "Tamamlandı", created_at: n },
    { id: "b3", date: "2026-10-12", vehicle_id: "T", maint_type: "Arıza", description: "motor yağ kaçağı", status: "Açık", created_at: n },
  ],
  work_records: [
    { id: "w1", date: "2026-10-05", vehicle_id: "J", unit: "Saat", quantity: 9, created_at: n },
    { id: "w2", date: "2026-10-06", vehicle_id: "J", unit: "Saat", quantity: 8, created_at: n },
    { id: "w0", date: "2026-09-20", vehicle_id: "J", unit: "Saat", quantity: 8, created_at: n },
  ],
};
assert.ok(isRoadVehicle(T)); assert.ok(!isRoadVehicle(J));
assert.equal(templatesFor(J)[0].every_hours, 500);
// Sayaç
const km = meterNow(d, T, "km", { today });
assert.equal(km.value, 249000); assert.equal(km.src, "yakıt");
assert.ok(Math.abs(km.perDay - 9000 / 39) < 1e-9, "kart 01.09 (240.000) → yakıt 10.10 (249.000): 9000 km / 39 gün");
const h = meterNow(d, J, "hours", { today });
assert.equal(h.value, 4967, "son okuma 4950 + sonraki 17 saat iş"); assert.equal(h.est, 17);
assert.equal(meterAt(d, T, "km", "2026-08-20"), null, "o tarihte okuma yok");
// Son bakım: açık arıza sayılmaz; anahtar kelime eşleşmesi
const ld = lastDone(d, T, T.service_rules[0]);
assert.equal(ld.date, "2026-08-20"); assert.equal(ld.km, null);
assert.equal(lastDone(d, T, T.service_rules[2]), null);
// Kural durumu
const s1 = ruleStatus(d, T, T.service_rules[0], { today });
assert.equal(s1.state, "?", "km bilinmiyor (bakımda km yok)"); assert.match(s1.text, /km bilinmiyor/);
T.service_rules[0].last = { date: "2026-08-20", km: 231000 };
// elle girilen başlangıç bakım kaydıyla aynı tarihte → bakım kaydı önce gelir ama km yoksa?
d.maintenance_records[0].km = 231000;
const s1b = ruleStatus(d, T, T.service_rules[0], { today });
assert.equal(s1b.leftKm, 2000); assert.equal(s1b.state, "soon"); assert.equal(s1b.estDays, 5, "20.08 (231.000) → 10.10 (249.000): ~353 km/gün"); assert.match(s1b.text, /2\.000 km kaldı \(~5 gün\)/);
const s2 = ruleStatus(d, T, T.service_rules[1], { today });
assert.equal(s2.leftDays, 90 - 107); assert.equal(s2.state, "late"); assert.match(s2.text, /17 gün geçti/);
const sj = ruleStatus(d, J, J.service_rules[0], { today });
assert.equal(sj.leftHours, 33); assert.equal(sj.state, "soon", "500 saatin %7si = 35 saat sınırı");
assert.ok(sj.estDays > 0);
// Pano: geciken önce
const board = maintenanceBoard(d, { today });
assert.deepEqual(board.map((r) => [r.v.id, r.rule.id, r.state]).slice(0, 2), [["T", "r2", "late"], ["T", "r1", "soon"]]);
assert.equal(maintSummary(board)[0].durum, "GECİKTİ");
// Bakım yapıldı: kurala bağlı kayıt son bakım olur
d.maintenance_records.push({ id: "b4", date: "2026-10-16", vehicle_id: "T", maint_type: "Bakım", description: "Fren kontrolü", status: "Tamamlandı", service_rule_id: "r2", created_at: n });
assert.equal(ruleStatus(d, T, T.service_rules[1], { today }).state, "ok");
const nr = newRule({ title: "Gresleme", every_hours: "50" });
assert.equal(nr.every_hours, 50); assert.equal(nr.every_km, null); assert.match(nr.id, /^r/);
console.log("maint ok");
