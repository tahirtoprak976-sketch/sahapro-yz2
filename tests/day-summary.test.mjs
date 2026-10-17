import assert from "node:assert/strict";
import { fuelFlags } from "../js/fuel-rules.js";
import { dayFacts, localSummary, keepVerified, runAskTool, ASK_TOOLS } from "../js/day-summary.js";
import { geminiAsk } from "../js/ai-gemini.js";
const today = "2026-10-14";
const add = (n) => { const x = new Date(today + "T12:00:00"); x.setDate(x.getDate() + n); return x.toISOString().slice(0, 10); };

// ---- yakıt kuralları ----
const works = [], fuel = [];
for (let i = 15; i <= 80; i += 3) { works.push({ id: "w" + i, date: add(-i), vehicle_id: "V1", customer_id: "C1", unit: "Saat", quantity: 8 }); fuel.push({ id: "f" + i, date: add(-i), vehicle_id: "V1", liters: 80 }); }
for (let i = 1; i <= 12; i += 3) { works.push({ id: "r" + i, date: add(-i), vehicle_id: "V1", customer_id: "C1", unit: "Saat", quantity: 8 }); fuel.push({ id: "g" + i, date: add(-i), vehicle_id: "V1", liters: 120 }); }
const data = {
  vehicles: [{ id: "V1", name: "JCB", plate: "34 J 1" }, { id: "V2", name: "Kamyon", plate: "34 K 2", tank_capacity: 300 }],
  customers: [{ id: "C1", name: "Hisar Polat" }, { id: "C2", name: "Kaya İnşaat" }],
  aliases: [{ id: "a1", alias: "Mahir Bey", target_type: "customer", target_id: "C1" }],
  work_records: works,
  fuel_records: [...fuel,
    { id: "x1", date: today, vehicle_id: "V2", liters: 100, unit_price: 45, total: 5000 }, // 4500 olmalı
    { id: "x2", date: add(-2), vehicle_id: "V2", liters: 350 }, // depo 300
  ],
  expense_records: [{ id: "e1", date: today, amount: 750, category: "Lastik" }],
  cash_records: [{ id: "k1", date: today, cash_type: "Müşteriden Para Alındı", customer_id: "C1", amount: 20000 }],
  cari_movements: [{ id: "m1", customer_id: "C1", amount: 45000 }],
  suppliers: [{ id: "S", name: "Mesut Lastik" }],
  payables: [{ id: "b1", party_type: "supplier", party_id: "S", date: today, gross_total: 1500, status: "Onaylandı", items: [] }],
  supplier_payments: [],
  documents: [], dump_sites: [], maintenance_records: [], personnel_events: [], slips: [],
};
const ff = fuelFlags(data, { today });
const rules = ff.map((f) => f.rule + ":" + (f.id || f.vehicle_id));
assert.ok(rules.includes("total:x1"), rules.join());
assert.ok(rules.includes("capacity:x2"));
assert.ok(rules.includes("nowork:x1") && rules.includes("nowork:x2"));
assert.ok(rules.includes("consumption:V1"), "120/8 vs 80/8 = %50 fazla");
assert.ok(!rules.some((r) => r.startsWith("nowork:g")), "işli gündeki yakıt sorun değil");

// ---- gün sonu ----
data.work_records.push({ id: "t1", date: today, vehicle_id: "V1", customer_id: "C1", unit: "Sefer", quantity: 6, price_snapshot: { amount: 9000 } });
const f = dayFacts(data, today);
assert.equal(f.is_sayisi, 1); assert.equal(f.toplam.sefer, 6); assert.equal(f.tahsilat_TL, 20000); assert.equal(f.gider_TL, 750);
assert.deepEqual(f.bos_araclar, []); // V1 bugün çalıştı, V2 hiç çalışmadı
assert.ok(f.uyarilar.some((u) => /4500|5000/.test(u)));
const ls = localSummary(f);
assert.ok(/6 sefer/.test(ls) && /Hisar Polat/.test(ls) && /20\.000/.test(ls), ls);
// uydurma rakamlı cümle atılır
const k = keepVerified("Bugün Hisar Polat'a 6 sefer yapıldı. Tahsilat 20.000 TL oldu. Kâr 35.000 TL arttı.", f);
assert.equal(k.dropped.length, 1); assert.ok(/6 sefer/.test(k.text) && !/35/.test(k.text));

// ---- soru araçları ----
let r = runAskTool(data, "work_totals", { customer: "mahir bey" }, today);
assert.equal(r.musteri, "Hisar Polat"); assert.equal(r.sefer, 6); assert.equal(r.is_degeri_TL, 9000);
r = runAskTool(data, "customer_balance", { customer: "Hisar" }, today);
assert.equal(r.cari_bakiye_TL, 54000); assert.equal(r.son_tahsilat.TL, 20000); // 45.000 cari + 9.000 hakedişe girmemiş iş
r = runAskTool(data, "customer_balance", { customer: "Yok Böyle" }, today);
assert.ok(r.error);
r = runAskTool(data, "esnaf_debt", {}, today);
assert.equal(r.toplam_TL, 1500);
r = runAskTool(data, "fuel_totals", { from: today, to: today }, today);
assert.equal(r.litre, 100); assert.equal(r.TL, 5000);
assert.equal(ASK_TOOLS.length, 17);
r = runAskTool(data, "quote_price", { customer: "Hisar", unit: "sefer", quantity: 10, extra: 1 }, today, {}, { quoteSettings: { extra: { Sefer: 3000 } } });
assert.equal(r.musteri, "Hisar Polat"); assert.equal(r.birim, "Sefer"); assert.equal(r.birim_maliyet_TL.diger, 3000); assert.ok(r.onerilen_birim_KDV_dahil_TL >= 3600);
assert.ok(runAskTool(data, "quote_price", { customer: "Yok Böyle" }, today).error);

// ---- fonksiyon çağrısı döngüsü (sahte Gemini) ----
const sent = [];
let n = 0;
const fetchFn = async (url, opts) => {
  const body = JSON.parse(opts.body);
  sent.push(body);
  n++;
  const reply = n === 1
    ? { candidates: [{ content: { role: "model", parts: [{ functionCall: { name: "work_totals", args: { customer: "Mahir Bey" } }, thoughtSignature: "SIG123" }] } }] }
    : { candidates: [{ content: { role: "model", parts: [{ text: "Hisar Polat'a bu ay 6 sefer yapıldı." }] } }] };
  return { ok: true, status: 200, json: async () => reply };
};
const res = await geminiAsk("Mahir beye kaç sefer?", { key: "k", model: "m", system: "s", tools: ASK_TOOLS, runTool: (nm, a) => runAskTool(data, nm, a, today), fetchFn });
assert.equal(res.answer, "Hisar Polat'a bu ay 6 sefer yapıldı.");
assert.equal(res.trace.length, 1); assert.equal(res.trace[0].result.sefer, 6);
// ikinci istekte model parçası imzasıyla aynen, ardından fonksiyon sonucu
const c2 = sent[1].contents;
assert.equal(c2[1].role, "model"); assert.equal(c2[1].parts[0].thoughtSignature, "SIG123");
assert.equal(c2[2].parts[0].functionResponse.name, "work_totals");
assert.equal(c2[2].parts[0].functionResponse.response.result.sefer, 6);
assert.equal(sent[0].toolConfig.functionCallingConfig.mode, "AUTO");
// model durmadan araç isterse son turda NONE ile cevaba zorlanır
n = 0; sent.length = 0;
const loopFetch = async (url, opts) => { const b = JSON.parse(opts.body); sent.push(b); return { ok: true, status: 200, json: async () => (b.toolConfig.functionCallingConfig.mode === "NONE" ? { candidates: [{ content: { parts: [{ text: "Bitti" }] } }] } : { candidates: [{ content: { parts: [{ functionCall: { name: "esnaf_debt", args: {} } }] } }] }) }; };
const res2 = await geminiAsk("?", { key: "k", model: "m", tools: ASK_TOOLS, runTool: (nm, a) => runAskTool(data, nm, a, today), fetchFn: loopFetch, maxRounds: 3 });
assert.equal(res2.answer, "Bitti"); assert.equal(sent.length, 4); assert.equal(res2.trace.length, 3);
console.log("day-summary PASS");
{
  const { isQuestion } = await import("../js/assistant-tools.js").catch(() => ({}));
  if (isQuestion) {
    assert.ok(isQuestion("Leda'dan ne kadar alacağım var"));
    assert.ok(isQuestion("bu ay kaç sefer yaptık?"));
    assert.ok(!isQuestion("Kaya İnşaat 3 sefer moloz"));
  }
  const rr = runAskTool({ customers: [{ id: "C", name: "Leda", created_at: "x" }], work_records: [{ id: "W", customer_id: "C", date: "2026-07-01", quantity: 2, unit: "Sefer", price_snapshot: { amount: 5000 }, created_at: "x" }] }, "receivables", {}, "2026-10-15");
  assert.equal(rr.toplam_alacak_TL, 5000); assert.equal(rr.gun_90_ustu_TL, 5000); assert.equal(rr.en_riskli[0].en_eski_gun, 106);
  const r1 = runAskTool({ customers: [{ id: "C", name: "Leda", created_at: "x" }], work_records: [] }, "receivables", { customer: "Leda" }, "2026-10-15");
  assert.equal(r1.alacak_TL, 0);
  console.log("receivables tool ok");
}
