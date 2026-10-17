import assert from "node:assert/strict";
import { leaveDays, fullYears, daysForYear, leaveSummary, leaveRanges, leaveEvents } from "../js/leave-core.js";
// Pazar ve 29 Ekim sayılmaz
assert.deepEqual(leaveDays("2026-10-26", "2026-11-02"), ["2026-10-26", "2026-10-27", "2026-10-28", "2026-10-30", "2026-10-31", "2026-11-02"]);
assert.equal(fullYears("2020-10-20", "2026-10-17"), 5);
assert.equal(fullYears("2020-10-17", "2026-10-17"), 6);
assert.equal(daysForYear(1), 14); assert.equal(daysForYear(5), 14); assert.equal(daysForYear(6), 20); assert.equal(daysForYear(15), 26);
assert.equal(daysForYear(3, 52), 20); assert.equal(daysForYear(2, 18), 20); assert.equal(daysForYear(0), 0);
// İşe giriş 2023-03-01 → 2024-03-01 (14) + 2025-03-01 (14) + 2026-03-01 (14) = 42; 5 gün kullanıldı, 2 gün planlı
const ev = (date, kind) => ({ id: date + kind, personnel_id: "p", date, event_type: kind === "Rapor" ? "Rapor" : "İzin", leave_kind: kind });
const d = { personnel: [{ id: "p", name: "Ali", start_date: "2023-03-01" }],
  personnel_events: [...leaveDays("2026-06-01", "2026-06-05").map((x) => ev(x, "Yıllık izin")), ev("2026-10-20", "Yıllık izin"), ev("2026-10-21", "Yıllık izin"), ev("2026-07-01", "Rapor"), ev("2026-07-02", "Ücretsiz izin")] };
const s = leaveSummary(d, d.personnel[0], { today: "2026-10-17" });
assert.equal(s.earned, 42); assert.equal(s.used, 5); assert.equal(s.planned, 2); assert.equal(s.remaining, 35);
assert.equal(s.nextAt, "2027-03-01"); assert.equal(s.nextDays, 14);
assert.equal(s.year.report, 1); assert.equal(s.year.unpaid, 1);
// Aralıklar: 1-5 Haziran tek satır
const R = leaveRanges(leaveEvents(d, "p"));
assert.equal(R[0].from, "2026-06-01"); assert.equal(R[0].to, "2026-06-05"); assert.equal(R[0].days, 5);
// Açılış bakiyesi: 2026-09-01'de 10 gün kalan → sonraki yıldönümü yok (2027-03), 2 gün planlı → 8
const p2 = { id: "p", start_date: "2023-03-01", leave_open_days: 10, leave_open_date: "2026-09-01" };
const s2 = leaveSummary(d, p2, { today: "2026-10-17" });
assert.equal(s2.earned, 10); assert.equal(s2.used, 0); assert.equal(s2.remaining, 8);
// İşe giriş yoksa hak hesaplanmaz
assert.equal(leaveSummary(d, { id: "p" }, { today: "2026-10-17" }).remaining, null);
console.log("leave-core ok");
