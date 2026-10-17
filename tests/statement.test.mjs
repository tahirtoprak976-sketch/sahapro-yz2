import assert from "node:assert/strict";
let m;
try { m = await import("../js/statement.js"); } catch (e) { console.log("SKIP:", e.message); process.exit(0); }
const mv = [
  { id: "1", customer_id: "C", date: "2026-09-01", type: "Hakedis", amount: 1000.1, note: "Hakediş #1" },
  { id: "2", customer_id: "C", date: "2026-09-10", type: "Tahsilat", amount: -400.05, note: "Tahsilat" },
  { id: "3", customer_id: "C", date: "2026-10-02", type: "Duzeltme", amount: -50, reason: "iç not: pazarlık" },
  { id: "4", customer_id: "X", date: "2026-10-02", type: "Hakedis", amount: 999 },
  { id: "5", customer_id: "C", date: "2026-10-03", type: "Hakedis", amount: 7, deleted_at: "x" },
];
const st = m.customerStatement(mv, "C");
assert.equal(st.rows.length, 3); assert.equal(st.closing, 550.05); assert.equal(st.debit, 1000.1); assert.equal(st.credit, 450.05);
const per = m.customerStatement(mv, "C", { from: "2026-10-01" });
assert.equal(per.opening, 600.05); assert.equal(per.rows.length, 1); assert.equal(per.closing, 550.05);
const txt = m.statementText("Acme", st, { today: "2026-10-14" });
assert.match(txt, /Kalan bakiye: 550,05 ₺/);
assert.ok(!txt.includes("pazarlık"), "iç not müşteriye gitmemeli");
assert.ok(m.statementText("Acme", m.customerStatement(mv, "C", { to: "2026-09-10" }), {}).includes("Kalan bakiye: 600,05"));
assert.match(m.statementText("A", m.customerStatement([{ customer_id: "C", date: "2026-01-01", type: "Hakedis", amount: 10 }, { customer_id: "C", date: "2026-01-02", type: "Tahsilat", amount: -30 }], "C"), {}), /Alacağınız \(avans\): 20,00/);
const csv = m.statementCsv(st);
assert.ok(csv.startsWith("﻿Tarih;"));
assert.ok(csv.includes("TOPLAM"));
console.log("statement PASS");
