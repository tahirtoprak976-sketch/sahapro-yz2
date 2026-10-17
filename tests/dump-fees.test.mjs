import assert from "node:assert/strict";
import { dumpFee, seedOfficialDumps } from "../js/dump-fees.js";
import { costRows, costTotals } from "../js/costs-core.js";
import { monthlySeries } from "../js/finance-chart.js";
const n = "x";
const d = {
  dump_sites: [{ id: "B", name: "Bolluca", fee: 160, fee_unit: "Ton", created_at: n }, { id: "G", name: "Göktürk Dolgu", fee: 1500, fee_unit: "Sefer", created_at: n }, { id: "Y", name: "Depo", own_yard: true, created_at: n }],
  vehicles: [{ id: "T", name: "34GAM627", load_ton: 27, created_at: n }],
  customers: [{ id: "I", name: "Kendi Depo", internal: true, created_at: n }],
  work_records: [
    { id: "W1", date: "2026-10-12", customer_id: "K", vehicle_id: "T", unit: "Sefer", quantity: 1, dump_site_id: "B", tonnage: 27.22, created_at: n },
    { id: "W2", date: "2026-10-13", customer_id: "K", vehicle_id: "T", unit: "Sefer", quantity: 2, dump_site_id: "B", created_at: n },
    { id: "W3", date: "2026-10-13", customer_id: "K", vehicle_id: "T", unit: "Sefer", quantity: 2, dump_site_id: "G", price_snapshot: { amount: 20000 }, created_at: n },
    { id: "W4", date: "2026-10-13", customer_id: "K", vehicle_id: "X", unit: "Sefer", quantity: 1, dump_site_id: "B", created_at: n },
    { id: "W5", date: "2026-10-13", customer_id: "K", vehicle_id: "T", unit: "Sefer", quantity: 1, dump_site_id: "Y", created_at: n },
    { id: "W6", date: "2026-10-13", customer_id: "I", vehicle_id: "T", unit: "Sefer", quantity: 1, dump_site_id: "B", material: "stabilize", created_at: n },
    { id: "W7", date: "2026-10-14", customer_id: "I", vehicle_id: "T", unit: "Sefer", quantity: 1, dump_site_id: "B", dump_cost: 3800, created_at: n },
  ],
};
assert.equal(dumpFee(d, d.work_records[0]).amount, 4355.2, "27,22 ton × 160");
const f2 = dumpFee(d, d.work_records[1]); assert.equal(f2.amount, 8640); assert.equal(f2.estimated, true, "fiş yok: 2 × 27 ton tahmini");
assert.equal(dumpFee(d, d.work_records[2]).amount, 3000, "sefer başı");
assert.equal(dumpFee(d, d.work_records[3]).missing, true, "ton bilinmiyor");
assert.equal(dumpFee(d, d.work_records[4]), null, "ücretsiz yer");
assert.equal(dumpFee(d, d.work_records[5]), null, "depodan çıkış: elle yazılmadıysa maliyet yok (stabilize)");
assert.equal(dumpFee(d, d.work_records[6]).amount, 3800, "depodan çıkış: elle yazılan");
const t = costTotals(costRows(d, { from: "2026-10-01", to: "2026-10-31" }));
assert.equal(t.dokum, 4355.2 + 8640 + 3000 + 3800);
assert.equal(monthlySeries(d, { today: "2026-10-15", months: 1 })[0].dump, t.dokum);
// İlk açılış: resmi sahalar
const store = { dump_sites: [{ id: "B", name: "BOLLUCA DÖKÜM", created_at: n }], meta: {} };
const db = {
  metaGet: async (k) => store.meta[k], metaSet: async (k, v) => { store.meta[k] = v; },
  getAll: async (s) => store[s] || [],
  saveExisting: async (s, r, f) => Object.assign(r, f),
  saveNew: async (s, f) => { store[s].push({ id: "N" + store[s].length, ...f }); },
};
assert.equal(await seedOfficialDumps(db), 3);
assert.deepEqual(store.dump_sites.map((x) => [x.name, x.fee]), [["BOLLUCA DÖKÜM", 160], ["Cebeci", 210], ["İSTAÇ Döküm", 235]]);
assert.equal(await seedOfficialDumps(db), 0, "bir kez");
console.log("dump-fees ok");
{
  const { dumpFee, loadTon } = await import("../js/dump-fees.js");
  assert.equal(loadTon({ type: "Tır" }), 27); assert.equal(loadTon({ type: "Kamyon" }), 22); assert.equal(loadTon({ type: "Kamyon", load_ton: 20 }), 20); assert.equal(loadTon({ type: "Kamyonet" }), 0);
  const dd = { dump_sites: [{ id: "B", name: "Bolluca", fee: 160, fee_unit: "Ton", created_at: "x" }], vehicles: [{ id: "K", name: "34UL9492", type: "Kamyon", created_at: "x" }] };
  const f = dumpFee(dd, { vehicle_id: "K", unit: "Sefer", quantity: 2, dump_site_id: "B" });
  assert.equal(f.ton, 44); assert.equal(f.amount, 7040); assert.equal(f.estimated, true);
  console.log("load ton ok");
}
