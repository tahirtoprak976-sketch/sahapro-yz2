import assert from "node:assert/strict";
import { vehicleKpis, customerKpis, priceCheck, businessReview, workDays } from "../js/expert-core.js";
const n = "x";
const d = {
  vehicles: [{ id: "T", name: "34GAM627", type: "Tır", created_at: n }, { id: "J", name: "JCB", created_at: n }, { id: "U", name: "34UL9492", type: "Kamyon", created_at: n }],
  customers: [{ id: "K", name: "Kaya", created_at: n }, { id: "L", name: "Leda", created_at: n }],
  dump_sites: [{ id: "B", name: "Bolluca", fee: 160, fee_unit: "Ton", created_at: n }],
  work_records: [
    { id: "1", date: "2026-10-05", customer_id: "K", vehicle_id: "T", unit: "Sefer", quantity: 2, dump_site_id: "B", price_snapshot: { amount: 20000 }, created_at: n },
    { id: "2", date: "2026-10-06", customer_id: "L", vehicle_id: "T", unit: "Sefer", quantity: 2, dump_site_id: "B", price_snapshot: { amount: 12000 }, created_at: n },
    { id: "3", date: "2026-10-06", customer_id: "L", vehicle_id: "J", unit: "Saat", quantity: 8, price_snapshot: { amount: 16000 }, created_at: n },
    { id: "4", date: "2026-09-01", customer_id: "L", vehicle_id: "U", unit: "Sefer", quantity: 1, price_snapshot: { amount: 9000 }, created_at: n },
  ],
  fuel_records: [{ id: "F", date: "2026-10-05", vehicle_id: "T", liters: 120, total: 5400, created_at: n }],
  maintenance_records: [{ id: "M", date: "2026-10-07", vehicle_id: "J", cost: 20000, created_at: n }],
};
assert.equal(workDays("2026-10-01", "2026-10-15"), 13, "pazarlar hariç");
const v = vehicleKpis(d, { from: "2026-10-01", to: "2026-10-15" });
const t = v.find((x) => x.arac === "34GAM627");
assert.equal(t.gelir_TL, 32000); assert.equal(t.dokum_TL, 4 * 27 * 160); assert.equal(t.kar_TL, 32000 - 5400 - 17280); assert.equal(t.L_sefer, 30); assert.equal(t.calisilan_gun, 2);
const j = v.find((x) => x.arac === "JCB"); assert.equal(j.kar_TL, -4000);
const u = v.find((x) => x.arac === "34UL9492"); assert.equal(u.is, 0); assert.equal(u.bos_gun, 44);
const c = customerKpis(d, { from: "2026-10-01", to: "2026-10-15", today: "2026-10-15" });
assert.equal(c.find((x) => x.musteri === "Kaya").sefer_basi_net_TL, (20000 - 8640) / 2);
const p = priceCheck(d, { from: "2026-09-01", to: "2026-10-15" });
const sefer = p.find((x) => /Sefer/.test(x.is_turu));
assert.equal(sefer.kayit, 3); assert.equal(sefer.orta_fiyat_TL, 9000); assert.deepEqual(sefer.dusuk_kalan_musteriler.map((x) => x.musteri), ["Leda"]);
const R = businessReview(d, { from: "2026-10-01", to: "2026-10-15", today: "2026-10-15" });
const kinds = R.bulgular.map((b) => b.kind);
assert.ok(kinds.includes("bos") && kinds.includes("zarar") && kinds.includes("fiyat"), kinds.join());
console.log("expert ok");
{
  const { checkAnswer } = await import("../js/assistant-core.js");
  assert.deepEqual(checkAnswer("Kâr 9.320 ₺ oldu", [{ kar: 10720, gun: 9 }]), [9320], "binlik yazım yuvarlanıp 9'a kaçmaz");
  assert.deepEqual(checkAnswer("Kâr 10.720 ₺, 9 gündür boşta", [{ kar: 10720, gun: 9 }]), []);
  assert.deepEqual(checkAnswer("27,22 ton", [{ t: 27.22 }]), []);
  console.log("checkAnswer thousands ok");
}
