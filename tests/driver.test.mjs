import assert from "node:assert/strict";
import { pack, unpack, driverConfig, driverMessage, extractPayloads, stripDriverBlocks, payloadsToPlan, seenDriverIds, entryLine } from "../js/driver-core.js";
import { validatePlan } from "../js/assistant-core.js";
const n = "x";
const d = {
  personnel: [{ id: "A", name: "Ali Şoför", vehicle_id: "T", created_at: n }],
  vehicles: [{ id: "T", name: "34GAM627", plate: "34GAM627", type: "Tır", created_at: n }, { id: "K", name: "Kamyon", plate: "34UL9492", type: "Kamyon", created_at: n }],
  customers: [{ id: "C", name: "Kılıç Hafriyat", created_at: n }, { id: "I", name: "Kendi Depo (iç iş)", internal: true, created_at: n }],
  sites: [{ id: "S", name: "Göktürk Şantiye", customer_id: "C", created_at: n }],
  dump_sites: [{ id: "B", name: "Bolluca", created_at: n }], quarries: [], work_records: [], fuel_records: [], aliases: [],
};
// Sıkıştırma gidiş-dönüş
const big = { a: "ç".repeat(500), b: [1, 2, 3] };
assert.deepEqual(await unpack(await pack(big)), big);
const cfg = driverConfig(d, { personnel_id: "A", company: "Muratoğlu" });
assert.equal(cfg.veh, "T"); assert.deepEqual(cfg.C, [["C", "Kılıç Hafriyat"]], "iç müşteri listede yok"); assert.equal(cfg.Y, "I");
assert.deepEqual(cfg.V[1], ["K", "Kamyon (34UL9492)"]);
assert.ok((await pack(cfg)).length < 2000);

const entries = [
  { id: "e1", date: "2026-10-16", vid: "T", cid: "C", sid: "S", wt: "Hafriyat Nakliye", q: 3, u: "Sefer", ds: "B", ton: 27.5, slip: "A123", ph: 1 },
  { id: "e2", date: "2026-10-16", vid: "T", cn: "Yeni Yapı", wt: "Moloz Nakliye", q: 2, u: "Sefer", dn: "Göktürk dolgu" },
  { id: "f1", k: "f", date: "2026-10-16", vid: "T", L: 300, src: "Akaryakıt İstasyonu", tl: 13500, km: 245300 },
];
assert.match(entryLine(entries[0], cfg), /16\.10\.2026 · 34GAM627 · Kılıç Hafriyat \/ Göktürk Şantiye · Hafriyat Nakliye 3 sefer → Bolluca · 27\.5 ton · fiş A123 · 📷1/);
const msg = await driverMessage(entries, cfg);
assert.match(msg, /^📋 SAHAPRO şoför kaydı — Ali Şoför\n/); assert.match(msg, /\nSP1:[A-Za-z0-9_-]+$/);
// WhatsApp toplu biçiminde de bulunur
const wa = `[16.10.2026 18:00] Ali Şoför: ${msg.split("\n").join("\n")}\n[16.10.2026 18:05] Veli: 34UL9492 2 sefer kum`;
const ps = await extractPayloads(wa);
assert.equal(ps.length, 1); assert.equal(ps[0].e.length, 3); assert.equal(ps[0].n, "Ali Şoför");
assert.equal(stripDriverBlocks(wa), "[16.10.2026 18:05] Veli: 34UL9492 2 sefer kum", "geriye yalnız serbest metin");
assert.deepEqual(await extractPayloads("SP1:bozukkod123"), []);
// Plan
const { plan, meta, fuelMeta } = payloadsToPlan(ps, d, { photoCount: 1 });
assert.equal(plan.works.length, 2); assert.equal(plan.fuel.length, 1);
assert.deepEqual(meta.map((m) => [m.driver_entry_id, m.photos, m.tonnage]), [["e1", [0], 27.5], ["e2", [], null]]);
assert.equal(plan.works[1].new_customer, "Yeni Yapı"); assert.equal(plan.works[1].to_place, "Göktürk dolgu");
assert.equal(fuelMeta[0].driver_entry_id, "f1");
// Asistanın doğrulaması okunur metinle geçer
const v = validatePlan(plan, { message: msg, d, today: "2026-10-16", photoCount: 1 });
assert.equal(v.works[0].customer_id, "C"); assert.equal(v.works[0].site_id, "S"); assert.equal(v.works[0].vehicle_id, "T"); assert.equal(v.works[0].quantity, 3);
assert.equal(v.works[0].dump_site_id, "B"); assert.equal(v.works[0].slip_no, "A123"); assert.equal(v.works[0].personnel_id, "A");
assert.ok(!v.works[0].guessed); assert.equal(v.works[1].new_customer, "Yeni Yapı");
assert.equal(v.fuel[0].liters, 300); assert.equal(v.fuel[0].km, 245300); assert.equal(v.fuel[0].source, "Akaryakıt İstasyonu");
// Daha önce alınanlar
assert.deepEqual([...seenDriverIds({ work_records: [{ id: "w", driver_entry_id: "e1", created_at: n }], fuel_records: [] })], ["e1"]);
console.log("driver ok");
{
  // Şoför gideri ve arıza/bakım
  const d2 = { ...d, suppliers: [{ id: "L", name: "Yıldız Lastik", created_at: n }], expense_records: [], maintenance_records: [] };
  const cfg2 = driverConfig(d2, { personnel_id: "A" });
  assert.deepEqual(cfg2.E, [["L", "Yıldız Lastik"]]);
  const ents = [
    { id: "g1", k: "g", date: "2026-10-16", cat: "Yemek", tl: 450, pay: "cep", ph: 1 },
    { id: "m1", k: "m", date: "2026-10-16", vid: "T", mt: "Lastik", desc: "sol arka lastik patladı", st: "Tamamlandı", tl: 1200, pay: "veresiye", sup: "L", km: 245500, ph: 1 },
    { id: "g2", k: "g", date: "2026-10-16", cat: "Otoyol / HGS", tl: 180, pay: "sirket", vid: "T" },
  ];
  const msg2 = await driverMessage(ents, cfg2);
  assert.match(msg2, /💸 16\.10\.2026 · Yemek · 450 TL · cebimden ödedim · 📷1/);
  assert.match(msg2, /🔧 16\.10\.2026 · 34GAM627 · Lastik: sol arka lastik patladı \(yapıldı\) · 1200 TL · Yıldız Lastik · veresiye/);
  assert.equal(stripDriverBlocks(msg2), "");
  const { plan: p2, expMeta, mainMeta } = payloadsToPlan(await extractPayloads(msg2), d2, { photoCount: 2 });
  assert.equal(p2.expenses.length, 2); assert.equal(p2.maintenance.length, 1);
  assert.equal(p2.expenses[0].photo, 0, "ilk foto gidere"); assert.deepEqual(mainMeta[0].photos, [1], "ikinci foto arızaya");
  assert.equal(p2.maintenance[0].supplier_id, "L"); assert.equal(p2.maintenance[0].credit, true); assert.equal(p2.maintenance[0].status, "Tamamlandı");
  assert.equal(expMeta[0].pay, "cep"); assert.equal(expMeta[0].personnel_id, "A");
  const v2 = validatePlan(p2, { message: msg2, d: d2, today: "2026-10-16", photoCount: 2 });
  assert.equal(v2.expenses[0].amount, 450); assert.equal(v2.expenses[0].category, "Yemek"); assert.equal(v2.expenses[1].category, "Otoyol / HGS"); assert.equal(v2.expenses[1].vehicle_id, "T");
  const { validateExtras } = await import("../js/assistant-core.js");
  const x2 = validateExtras(p2, { message: msg2, d: d2, today: "2026-10-16", photoTexts: [] });
  assert.equal(x2.maintenance[0].cost, 1200); assert.equal(x2.maintenance[0].ok, true);
  console.log("driver expense/maint ok");
}
{
  const { slipNo, siteContact, driverSlipSpec, slipShareText, payloadsToPlan: p2p, extractPayloads: ex, driverMessage: dm } = await import("../js/driver-core.js");
  const d3 = { ...d, sites: [{ id: "S", name: "Göktürk Şantiye", customer_id: "C", contact: "Ahmet Şef", phone: "05321112233", created_at: n }] };
  const cfg3 = driverConfig(d3, { personnel_id: "A", company: "Muratoğlu" });
  assert.equal(slipNo(cfg3, 12), "ASA-0012", "Ali Şoför → AS + kimlik sonu A");
  assert.match(slipNo(cfg3, 12), /^[A-Z]{1,2}[A-Z0-9]{0,2}-0012$/);
  assert.deepEqual(siteContact(cfg3, "S"), { name: "Ahmet Şef", phone: "05321112233" });
  const e = { id: "e9", date: "2026-10-16", vid: "T", cid: "C", sid: "S", wt: "Hafriyat Nakliye", q: 3, u: "Sefer", ds: "B", ton: 27.5, dfs: "AS-0012", rcv: "Ahmet Şef", sgt: "2026-10-16T08:30:00.000Z" };
  const spec = driverSlipSpec(e, cfg3, { no: "AS-0012", receiver: "Ahmet Şef", signedAt: e.sgt, sigBlob: { fake: 1 } });
  assert.equal(spec.number, "AS-0012"); assert.equal(spec.signatures, null);
  assert.deepEqual(spec.sections[1].pairs.slice(0, 2), [["Yapılan iş", "Hafriyat Nakliye"], ["Miktar", "3 sefer"]]);
  assert.match(slipShareText(e, cfg3, "AS-0012", "Ahmet Şef"), /dijital iş fişi AS-0012\n16\.10\.2026 · 34GAM627 · Kılıç Hafriyat \/ Göktürk Şantiye/);
  const msg = await dm([e], cfg3);
  assert.match(msg, /🧾 dijital fiş AS-0012 \(imzalayan: Ahmet Şef\)/);
  const { plan } = p2p(await ex(msg), d3);
  assert.equal(plan.works[0].slip_no, "AS-0012"); assert.match(plan.works[0].description, /Dijital fiş AS-0012 · imzalayan Ahmet Şef/);
  const v = validatePlan(plan, { message: msg, d: d3, today: "2026-10-16" });
  assert.equal(v.works[0].slip_no, "AS-0012");
  console.log("driver slip ok");
}
{
  const { driverMessage: dm, extractPayloads: ex, payloadsToPlan: p2p, workSlipSpec } = await import("../js/driver-core.js");
  const cfg4 = driverConfig(d, { personnel_id: "A", company: "Muratoğlu" });
  const ents = [{ id: "w1", date: "2026-10-16", vid: "T", cid: "C", wt: "Hafriyat Nakliye", q: 2, u: "Sefer", ph: 1, dfs: "ASA-0001", rcv: "Ahmet", sgt: "2026-10-16T08:00:00Z", sg: 1 },
    { id: "w2", date: "2026-10-16", vid: "T", cid: "C", wt: "Hafriyat Nakliye", q: 1, u: "Sefer", ph: 1 }];
  const { meta } = p2p(await ex(await dm(ents, cfg4)), d, { photoCount: 3 });
  assert.deepEqual(meta[0].photos, [0]); assert.equal(meta[0].digital.sigPhoto, 1, "imza fişten sonra"); assert.deepEqual(meta[1].photos, [2], "sonraki işin fotoğrafı kaymaz");
  assert.equal(meta[0].digital.no, "ASA-0001"); assert.equal(meta[1].digital, undefined);
  const w = { date: "2026-10-16", vehicle_id: "T", customer_id: "C", site_id: null, personnel_id: "A", work_type: "Hafriyat Nakliye", quantity: 2, unit: "Sefer", digital_slip_no: "ASA-0001", slip_no: "ASA-0001", slip_receiver: "Ahmet", slip_signed_at: "2026-10-16T08:00:00Z" };
  const names = { customers: { C: "Kılıç Hafriyat" }, vehicles: { T: "34GAM627" }, personnel: { A: "Ali Şoför" }, sites: {}, dump_sites: {} };
  const spec = workSlipSpec(w, names, { company: "Muratoğlu", sigBlob: { x: 1 } });
  assert.equal(spec.number, "ASA-0001"); assert.equal(spec.sections[0].pairs[2][1], "Kılıç Hafriyat"); assert.equal(spec.sections[0].pairs[5][1], "Ali Şoför");
  assert.ok(!spec.sections[1].pairs.some(([k]) => k === "Döküm fişi no"), "dijital fiş no kâğıt fiş gibi tekrar yazılmaz");
  console.log("driver slip to owner ok");
}
{
  const { driverMessage: dm, extractPayloads: ex, payloadsToPlan: p2p } = await import("../js/driver-core.js");
  const cfg5 = driverConfig(d, { personnel_id: "A" });
  const sig = Buffer.from("PNGDATA".repeat(300)).toString("base64");
  const msg = await dm([{ id: "s1", date: "2026-10-16", vid: "T", cid: "C", wt: "Hafriyat Nakliye", q: 1, u: "Sefer", dfs: "ASA-0002", rcv: "Ahmet", sig }], cfg5);
  const { meta } = p2p(await ex(msg), d, { photoCount: 0 });
  assert.equal(meta[0].digital.sigData, sig, "imza kodun içinden gelir"); assert.equal(meta[0].digital.sigPhoto, null);
  console.log("driver embedded sig ok");
}
