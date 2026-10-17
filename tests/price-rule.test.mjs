import assert from "node:assert/strict";
import { validatePriceRules, pastWorksFor, sameRule, priceSnapshotFor, unitInText, customerNamed } from "../js/price-rule-core.js";

const n = "2026-01-01T00:00:00Z";
const d = {
  customers: [{ id: "L", name: "Leda Yapı", created_at: n }, { id: "K", name: "Kaya İnşaat", created_at: n }],
  vehicles: [{ id: "M", name: "Manitou MTX 1840", created_at: n }, { id: "J", name: "JCB", created_at: n }],
  sites: [],
  price_book: [{ id: "P0", customer_id: "L", work_type: "Manitou Çalışması", unit: "Saat", price: 2500, active: true, created_at: n }],
  work_records: [
    { id: "W1", customer_id: "L", date: "2026-10-01", work_type: "Manitou Çalışması", vehicle_id: "M", unit: "Saat", quantity: 8, created_at: n },
    { id: "W2", customer_id: "L", date: "2026-10-02", work_type: "Manitou Çalışması", vehicle_id: "M", unit: "Saat", quantity: 4, price_snapshot: { unit_price: 2500, amount: 10000 }, created_at: n },
    { id: "W3", customer_id: "L", date: "2026-10-03", work_type: "Makine Çalışması", vehicle_id: "M", unit: "Saat", quantity: 5, created_at: n },
    { id: "W4", customer_id: "L", date: "2026-10-04", work_type: "Manitou Çalışması", vehicle_id: "M", unit: "Saat", quantity: 3, price_snapshot: { unit_price: 2500, amount: 7500, locked: true }, created_at: n },
    { id: "W5", customer_id: "K", date: "2026-10-04", work_type: "Manitou Çalışması", vehicle_id: "M", unit: "Saat", quantity: 3, created_at: n },
    { id: "W6", customer_id: "L", date: "2026-10-05", work_type: "Manitou Çalışması", vehicle_id: "M", unit: "Yevmiye", quantity: 1, created_at: n },
  ],
};
const msg = "Ledaya manitou çalışmalarında saatlik 3000 tl fiyat kurali uygula";
assert.deepEqual(unitInText(msg), ["Saat"]);
assert.ok(customerNamed(d.customers[0], msg));
assert.ok(!customerNamed(d.customers[1], msg));

// Model müşteriyi boş bıraksa ve birimi yanlış dese bile mesajdan bulunur
const [r] = validatePriceRules({ price_rules: [{ customer_id: null, work_type: "Manitou Çalışması", unit: "Sefer", price: 3000, quote: msg }] }, { message: msg, d });
assert.equal(r.ok, true, r.issues.join());
assert.equal(r.customer_id, "L");
assert.equal(r.unit, "Saat");
assert.equal(r.price, 3000);
const wt = r.scopes.find((s) => s.key === "wt"), veh = r.scopes.find((s) => s.key === "veh");
assert.equal(wt.unpriced, 1); assert.equal(wt.differ, 1); assert.equal(wt.locked, 1); assert.equal(wt.existing.id, "P0");
assert.equal(veh.unpriced, 2, "araç kapsamı 'Makine Çalışması' yazılan işi de kapsar");
assert.equal(r.scopes[0].key, "veh", "en çok eski işi kapsayan önce");

// Uydurma fiyat ve belirsiz birim
const [bad] = validatePriceRules({ price_rules: [{ customer_id: "L", unit: "Saat", price: 3500 }] }, { message: msg, d });
assert.equal(bad.ok, false); assert.match(bad.issues.join(), /3500 mesajda yazmıyor/);
const [amb] = validatePriceRules({ price_rules: [{ customer_id: "L", price: 3000 }] }, { message: "Leda saat ve sefer 3000", d });
assert.equal(amb.unit, null);
// Müşteri adı yoksa: tüm müşteriler uyarısı, işaretsiz
const [gen] = validatePriceRules({ price_rules: [{ unit: "Saat", price: 3000 }] }, { message: "manitou saatlik 3000", d });
assert.equal(gen.ok, false); assert.match(gen.issues.join(), /TÜM müşterilere/);
// Yeni müşteri
const [nw] = validatePriceRules({ price_rules: [{ new_customer: "Delta Yapı", unit: "Sefer", price: 2500 }] }, { message: "Delta Yapıya sefer başı 2500", d });
assert.equal(nw.new_customer, "Delta Yapı"); assert.equal(nw.ok, true);

// Yardımcılar
assert.equal(sameRule(d, { customer_id: "L", site_id: null, work_type: "Manitou Çalışması", vehicle_id: null, unit: "Saat" }).id, "P0");
assert.equal(sameRule(d, { customer_id: "L", site_id: null, work_type: null, vehicle_id: "M", unit: "Saat" }), null);
const s = priceSnapshotFor({ customer_id: "L", price: 3000, unit: "Saat" }, { quantity: 8 }, "P1");
assert.equal(s.amount, 24000); assert.equal(s.price_source, "Müşteriye Özel Fiyat"); assert.equal(s.price_rule_id, "P1");
assert.equal(pastWorksFor({ ...d, work_records: [{ ...d.work_records[0], fuel_rule_id: "x" }] }, { customer_id: "L", unit: "Saat", price: 3000 }).unpriced.length, 0, "mazotla ödenen işe dokunulmaz");
console.log("price-rule ok");
