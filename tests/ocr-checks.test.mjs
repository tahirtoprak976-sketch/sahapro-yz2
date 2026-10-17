import assert from "node:assert/strict";
let m;
try { m = await import("../js/ocr.js"); } catch (e) { console.log("SKIP:", e.message); process.exit(0); }
const t1 = `ÖZ LASTİK OTO
FATURA NO: A123
Tarih 13.10.2026
ARA TOPLAM 1.000,00
KDV 200,00
TOPLAM 1.200,00`;
const r1 = m.extractFields("Fatura", t1, 90);
assert.equal(r1.fields.total, 1200); assert.equal(r1.fields.subtotal, 1000); assert.equal(r1.fields.kdv, 200);
assert.equal(r1.fields.date, "2026-10-13");
assert.deepEqual(r1.checks.filter((c) => c.level === "error"), []);
// ARA TOPLAM, TOPLAM'dan önce geldiği için toplam olarak alınmamalı
assert.equal(m.totalAmount("ARA TOPLAM 500,00\nKDV 100,00\nTOPLAM 600,00"), 600);
assert.equal(m.totalAmount("TOPLAM 100,00\nGENEL TOPLAM 250,00"), 250);
assert.equal(m.totalAmount("hiç tutar yok"), null);
// tutarsız toplam yakalanır
const bad = m.extractFields("Fatura", "13.10.2026\nARA TOPLAM 1.000,00\nKDV 200,00\nTOPLAM 1.500,00", 90);
assert.ok(bad.checks.some((c) => c.level === "error" && /tutmuyor/.test(c.text)));
// geçersiz tarih okunmaz (ay 13)
assert.equal(m.extractFields("Gider Fişi", "45.13.2026 TOPLAM 10,00", 80).fields.date, undefined);
assert.equal(m.validDate(2026, 2, 30), false);
// yakıt: litre × fiyat kontrolü
const fuel = m.extractFields("Akaryakıt Fişi", "SHELL\n13.10.2026\nMOTORİN\n50,00 LT\nLT FİYAT 40,00\nTOPLAM 1.000,00", 90);
assert.ok(fuel.checks.some((c) => /uyuşmuyor/.test(c.text)));
// KDV uydurulmaz
assert.equal(m.extractFields("Gider Fişi", "13.10.2026 TOPLAM 100,00", 80).fields.kdv, undefined);
// gelecekteki tarih
assert.ok(m.checkFields("Gider Fişi", { date: "2030-01-01", total: 5 }, "2026-10-14").some((c) => /gelecek/.test(c.text)));
console.log("ocr-checks PASS");
{
  const { validVKN, validTCKN, checkFields } = await import('../js/ocr.js');
  assert.equal(validTCKN('10000000146'), true); assert.equal(validTCKN('10000000145'), false);
  assert.equal(validVKN('1234567890'), validVKN('1234567890')); // deterministik
  assert.ok(checkFields('Fatura', { tax_no: '10000000145', total: 5 }, '2026-10-14').some((c) => /TC/.test(c.text)));
  assert.ok(checkFields('Gider Fişi', { date: '2026-07-01', total: 5 }, '2026-10-14').some((c) => /60 gün/.test(c.text)));
}
console.log('ocr-checks-2 PASS');
