import assert from "node:assert/strict";
import { planMergeCards, suggestCardGroups } from "../js/merge-core.js";
const n="x";
const d = { vehicles: [{ id: "A", name: "34GAM627", created_at: n }, { id: "B", name: "Bayram Tır", plate: "34 GAM 627", type: "Tır", created_at: n }, { id: "C", name: "JCB", created_at: n }],
  personnel: [{ id: "P", name: "Bayram", vehicle_id: "A", created_at: n }, { id: "P2", name: "Bayram Tırcı", phone: "0532", created_at: n }],
  work_records: [{ id: "W1", vehicle_id: "A", personnel_id: "P2", created_at: n }, { id: "W2", vehicle_id: "B", created_at: n }],
  documents: [{ id: "D", owner_type: "vehicle", owner_id: "A", created_at: n }], fuel_records: [{ id: "F", vehicle_id: "A", created_at: n }],
  inbox_messages: [{ id: "I", review_rows: [{ vehicle_id: "A" }], created_at: n }] };
const g = suggestCardGroups(d, "vehicles");
assert.equal(g.length, 1); assert.deepEqual(g[0].customers.map((c) => c.id).sort(), ["A", "B"]);
const p = planMergeCards(d, "vehicles", ["A"], "B");
assert.deepEqual(Object.keys(p.counts).sort(), ["documents", "fuel_records", "inbox_messages", "personnel", "work_records"]);
assert.equal(p.updates.find((u) => u.store === "inbox_messages").after.review_rows[0].vehicle_id, "B");
assert.equal(p.aliases[0].alias, "34GAM627");
const pp = planMergeCards(d, "personnel", ["P2"], "P");
assert.equal(pp.patch.phone, "0532"); assert.equal(suggestCardGroups(d, "personnel").length, 1);
console.log("merge cards ok");
