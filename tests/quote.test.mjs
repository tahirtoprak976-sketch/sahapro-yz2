import assert from "node:assert/strict";
import { priceHistory, fuelPerUnit, dumpPerUnit, quoteCalc, quoteFor, quoteRecord, quoteSummary, validateQuoteFill, grossUnitPrice } from "../js/quote-core.js";
const n = "x", today = "2026-10-15";
const W = (id, date, c, v, q, price, extra = {}) => ({ id, date, customer_id: c, vehicle_id: v, work_type: "Hafriyat Nakliye", unit: "Sefer", quantity: q, price_snapshot: price ? { amount: price * q, unit_price: price, kdv_included: true } : null, created_at: n, ...extra });
const d = {
  customers: [{ id: "A", name: "Ahmet Yapı", created_at: n }, { id: "B", name: "Bora İnşaat", created_at: n }, { id: "C", name: "Can Hafriyat", created_at: n }, { id: "I", name: "Kendi Depo", internal: true, created_at: n }],
  vehicles: [{ id: "T", name: "34GAM627", type: "Tır", created_at: n }, { id: "T2", name: "34FY2482", type: "Tır", created_at: n }, { id: "K", name: "34UL9492", type: "Kamyon", created_at: n }],
  dump_sites: [{ id: "BL", name: "Bolluca", fee: 160, fee_unit: "Ton", created_at: n }, { id: "GK", name: "Göktürk dolgu", created_at: n }, { id: "SF", name: "Kemer saha", fee: 2000, fee_unit: "Sefer", created_at: n }],
  fuel_tank_movements: [{ id: "F", date: "2026-10-01", move_type: "GİRİŞ", liters: 1000, unit_price: 45, created_at: n }],
  fuel_records: [{ id: "f1", date: "2026-10-05", vehicle_id: "T", liters: 400, created_at: n }],
  work_records: [
    W("1", "2026-10-02", "A", "T", 4, 9000), W("2", "2026-10-06", "A", "T", 4, 9500),
    W("3", "2026-10-07", "B", "T2", 5, 8000), W("4", "2026-10-08", "C", "K", 3, 10000), W("5", "2026-10-09", "B", "T2", 2, 8200),
    W("6", "2026-10-10", "I", "T", 1, null),
    { id: "7", date: "2026-10-11", customer_id: "C", vehicle_id: "K", work_type: "Hafriyat Nakliye", unit: "Sefer", quantity: 1, price_snapshot: { amount: 10000, kdv_included: false, kdv_rate: 20 }, created_at: n },
  ],
};
// KDV hariç kayıt → dahile çevrilir
assert.equal(grossUnitPrice(d.work_records[6]), 12000);
const h = priceHistory(d, { customer_id: "A", work_type: "Hafriyat Nakliye", unit: "Sefer", today });
assert.equal(h.customer.last, 9500); assert.equal(h.customer.n, 2);
assert.equal(h.all.n, 6, "iç iş ve fiyatsız sayılmaz");
assert.equal(h.all.median, 9250);
assert.ok(h.others.every((o) => o.name !== "Ahmet Yapı"));
// Mazot: T 400 L ÷ 9 sefer (iç iş dahil gerçek sefer)
const fu = fuelPerUnit(d, { vehicle_id: "T", unit: "Sefer", today });
assert.equal(fu.per, 44.4); assert.equal(fu.own, true);
assert.equal(fuelPerUnit(d, { vehicle_id: "K", unit: "Sefer", today }), null, "veri yok");
const fu2 = fuelPerUnit(d, { vehicle_id: "T2", unit: "Sefer", today });
assert.equal(fu2.own, false, "aynı türden (tır) ortalama"); assert.equal(fu2.per, 44.4);
// Döküm
assert.equal(dumpPerUnit(d, { dump_site_id: "BL", vehicle_id: "T", unit: "Sefer" }).amount, 4320, "27 ton × 160");
assert.equal(dumpPerUnit(d, { dump_site_id: "BL", vehicle_id: "K", unit: "Sefer" }).amount, 3520, "22 ton × 160");
assert.equal(dumpPerUnit(d, { dump_site_id: "BL", vehicle_id: null, unit: "Ton" }).amount, 160);
assert.equal(dumpPerUnit(d, { dump_site_id: "GK", vehicle_id: "T", unit: "Sefer" }).amount, null);
assert.equal(dumpPerUnit(d, { dump_site_id: "SF", vehicle_id: "T", unit: "Sefer" }).amount, 2000);
assert.equal(dumpPerUnit(d, { dump_site_id: "BL", vehicle_id: "T", unit: "Saat" }), null);
// Hesap
const c = quoteCalc({ unit: "Sefer", quantity: 10, dump: 4320, fuel_l: 40, fuel_price: 45, extra: 1000, margin: 20, kdv: 20, history: {} });
assert.equal(c.cost.total, 4320 + 1800 + 1000);
assert.equal(c.byCost, 8550, "7120 × 1,2 = 8544 → 50'ye yuvarla");
assert.equal(c.suggest, 8550); assert.equal(c.suggestNet, 7125); assert.equal(c.total, 85500); assert.equal(c.floor, 7120);
assert.equal(c.profitTotal, 14300);
// Müşteri daha önce daha yükseğe aldıysa fiyat düşürülmez
const c2 = quoteCalc({ unit: "Sefer", quantity: 1, dump: 4320, fuel_l: 40, fuel_price: 45, extra: 1000, margin: 20, history: { customer: { last: 9500 }, all: { median: 9250, n: 6 } } });
assert.equal(c2.suggest, 9500); assert.match(c2.why, /son fiyat/);
// Piyasanın altında uyarısı
const c3 = quoteCalc({ unit: "Sefer", quantity: 1, dump: 2000, fuel_l: 20, fuel_price: 45, extra: 500, margin: 10, history: { all: { median: 9250, n: 6 } } });
assert.ok(c3.warns.some((w) => /orta fiyatı/.test(w.text)));
// Eksik maliyet bildirilir
const c4 = quoteCalc({ unit: "Sefer", quantity: 1, dump: null, dump_expected: true, fuel_l: null, extra: 0, history: {} });
assert.equal(c4.suggest, null); assert.ok(/döküm ücreti, mazot, şoför/.test(c4.warns[0].text));
// Uçtan uca
const q = quoteFor(d, { customer_id: "A", work_type: "Hafriyat Nakliye", unit: "Sefer", quantity: 10, vehicle_id: "T", dump_site_id: "BL" }, { today, settings: { extra: { Sefer: 1500 } } });
assert.equal(q.input.fuel_price, 45); assert.equal(q.input.fuel_l, 44.4); assert.equal(q.input.dump, 4320);
assert.equal(q.calc.cost.total, 4320 + 1998 + 1500);
assert.equal(q.calc.suggest, 9500, "maliyet+kâr 9380 < son fiyat 9500");
const rec = quoteRecord(d, q, { today });
assert.equal(rec.items[0].unit_price, q.calc.suggestNet); assert.equal(rec.dump_terms, "Döküm ücreti dahil"); assert.equal(rec.valid_until, "2026-10-30");
assert.match(rec.items[0].label, /Bolluca/);
const s = quoteSummary(d, q);
assert.equal(s.musteri, "Ahmet Yapı"); assert.equal(s.zarar_siniri_TL, 7818); assert.equal(s.bu_musteriye_son_fiyat_TL, 9500);
// Döküm hariç
const q2 = quoteFor(d, { unit: "Sefer", quantity: 1, vehicle_id: "T", dump_site_id: "BL", dump_included: false, extra: 0 }, { today });
assert.equal(q2.calc.cost.dump, 0);
// Doldurma doğrulaması
const named = { customer: (c, t) => t.toLowerCase().includes(c.name.split(" ")[0].toLowerCase()), vehicle: (v, t) => t.toLowerCase().includes(v.name.toLowerCase()), place: (s, t) => t.toLowerCase().includes(s.name.split(" ")[0].toLowerCase()) };
const msg = "Ahmet 20 sefer bolluca hafriyat soruyor 34gam627 ile";
const v = validateQuoteFill({ customer_id: "A", vehicle_id: "T", dump_site_id: "BL", quantity: 20, unit: "Sefer", work_type: "Hafriyat Nakliye" }, { d, message: msg, numbers: new Set([20, 34]), named });
assert.deepEqual(v.fill, { customer_id: "A", vehicle_id: "T", dump_site_id: "BL", unit: "Sefer", work_type: "Hafriyat Nakliye", quantity: 20 });
const v2 = validateQuoteFill({ customer_id: "B", quantity: 30, dump_site_id: "SF" }, { d, message: msg, numbers: new Set([20]), named });
assert.deepEqual(v2.fill, {}); assert.equal(v2.issues.length, 3);
console.log("quote ok");
{
  const { quoteRules, staleQuotes } = await import("../js/quote-core.js");
  const q = { customer_id: "A", site_id: null, date: "2026-10-10", kdv_rate: 20, items: [
    { label: "Hafriyat Nakliye (döküm: Bolluca)", unit: "Sefer", quantity: 20, unit_price: 7916.67 },
    { label: "JCB çalışma", unit: "Saat", unit_price: 2500, work_type: "JCB Çalışması" },
    { label: "Boş", unit: "Sefer", unit_price: 0 } ] };
  const r = quoteRules(q);
  assert.equal(r.length, 2); assert.equal(r[0].work_type, "Hafriyat Nakliye"); assert.equal(r[0].price, 7916.67); assert.equal(r[0].kdv_included, false);
  assert.equal(r[1].work_type, "JCB Çalışması");
  assert.deepEqual(quoteRules({ ...q, customer_id: null }), []);
  const sq = staleQuotes({ quotes: [{ id: "1", status: "Gönderildi", sent_at: "2026-10-10T09:00:00Z", created_at: "x" }, { id: "2", status: "Gönderildi", sent_at: "2026-10-14T09:00:00Z", created_at: "x" }, { id: "3", status: "Kabul", date: "2026-09-01", created_at: "x" }] }, { today: "2026-10-16" });
  assert.deepEqual(sq.map((x) => [x.q.id, x.age]), [["1", 6]]);
  console.log("quote rules ok");
}
