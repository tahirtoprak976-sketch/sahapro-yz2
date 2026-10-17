import assert from "node:assert/strict";
import { validateActions, validateSettings, validateOpen, textInMessage, actionsContext } from "../js/assistant-actions.js";
const n = "2026-01-01T00:00:00Z";
const d = {
  customers: [{ id: "L", name: "Leda", created_at: n }, { id: "H", name: "Hisar Polat", created_at: n }, { id: "K", name: "Kaya İnşaat", phone: "", created_at: n }],
  vehicles: [{ id: "J", name: "JCB", created_at: n }], personnel: [{ id: "A", name: "Ahmet", created_at: n }],
  documents: [{ id: "D1", category: "Muayene Belgesi", owner_id: "J", expiry_date: "2026-11-01", created_at: n }],
  price_book: [{ id: "P1", customer_id: "L", unit: "Saat", price: 2500, created_at: n }],
};
assert.ok(textInMessage("Leda", "Ledanın telefonu"));
// Telefon ve ana firma
let a = validateActions({ actions: [{ op: "update", store: "customers", id: "K", fields: { phone: "0532 111 22 33", parent_customer_id: "H" } }] }, { message: "Kaya İnşaatın telefonu 05321112233, ana firması Hisar Polat", d });
assert.equal(a[0].ok, true, a[0].issues.join());
assert.deepEqual(a[0].changes, { phone: "0532 111 22 33", parent_customer_id: "H" });
assert.deepEqual(a[0].shown[1], ["Ana firma", "—", "Hisar Polat"]);
// Uydurma telefon
a = validateActions({ actions: [{ op: "update", store: "customers", id: "K", fields: { phone: "05329999999" } }] }, { message: "Kayanın telefonunu güncelle", d });
assert.equal(a[0].ok, false); assert.match(a[0].issues.join(), /mesajda yazmıyor/);
// Belge bitiş tarihi
a = validateActions({ actions: [{ op: "update", store: "documents", id: "D1", fields: { expiry_date: "2027-03-12" } }] }, { message: "JCB muayenesi 12.03.2027 bitiyor", d });
assert.equal(a[0].ok, true);
// Yeni kart: aynısı var
a = validateActions({ actions: [{ op: "create", store: "customers", fields: { name: "Leda" } }, { op: "create", store: "quarries", fields: { name: "Öztaş" } }] }, { message: "Leda ve Öztaş ekle", d });
assert.match(a[0].issues.join(), /zaten kayıtlı/); assert.equal(a[1].ok, true);
// Silme: işaretsiz; olmayan kayıt; izin verilmeyen alan
a = validateActions({ actions: [{ op: "delete", store: "customers", id: "L" }, { op: "delete", store: "customers", id: "X" }, { op: "update", store: "vehicles", id: "J", fields: { deleted_at: "x" } }, { op: "update", store: "work_records", id: "W" }] }, { message: "sil", d });
assert.equal(a[0].ok, false); assert.match(a[0].issues.join(), /Silme/);
assert.match(a[1].issues.join(), /bulunamadı/);
assert.match(a[2].issues.join(), /değiştirilemez/);
assert.match(a[3].issues.join(), /yapılamıyor/);
// Fiyat güncelle
a = validateActions({ actions: [{ op: "update", store: "price_book", id: "P1", fields: { price: 3000 } }] }, { message: "Leda saatlik fiyatı 3.000 tl yap", d });
assert.equal(a[0].ok, true); assert.equal(a[0].changes.price, 3000);
// Ayarlar
const s = validateSettings({ settings: [
  { key: "rule", value: "Ağırtaş işleri Hisar Polat'a yazılmasın" },
  { key: "promise", customer_id: "K", date: "2026-10-16", amount: 20000 },
  { key: "fuel_rule", customer_id: "L", per: 75, unit: "Sefer", match: "gravak", only_pay: true },
  { key: "fuel_ref_price", value: "48.5" },
  { key: "iban", value: "TR12 0001 0000 0000 0000 0000 01" },
  { key: "gemini_key", value: "x" },
] }, { message: "Kaya cuma 20 bin ödeyecek, Leda gravak seferi 75 litre mazot, mazot 48,5 TL, IBAN TR120001000000000000000001", d, today: "2026-10-15" });
assert.deepEqual(s.map((x) => x.ok), [true, true, true, true, true, false]);
assert.equal(s[1].amount, 20000); assert.equal(s[2].match, "gravak");
// Ekran aç
assert.deepEqual(validateOpen({ open: { screen: "cari", id: "L" } }, { d }), { href: "#/cari/L", label: "Cari ekstre: Leda" });
assert.equal(validateOpen({ open: { screen: "javascript:alert(1)" } }, { d }), null);
assert.equal(validateOpen({ open: { screen: "cari", id: "nope" } }, { d }), null);
assert.ok(actionsContext(d, "JCB muayenesi").documents.length === 1);
assert.ok(!actionsContext(d, "bugün 3 sefer").documents);
console.log("assistant-actions ok");
