import assert from "node:assert/strict";
import { receivables, customerOpenItems, reminderText, waPhone, waLink, collectBoardItems, bucketOf } from "../js/collect-core.js";

const n = "2026-01-01T00:00:00Z";
const d = {
  customers: [{ id: "C1", name: "Kaya İnşaat", phone: "0532 111 22 33", created_at: n }, { id: "C2", name: "Hisar Polat", created_at: n }, { id: "C3", name: "Ağırtaş", parent_customer_id: "C2", created_at: n }, { id: "Y", name: "Kendi Depo", internal: true, created_at: n }],
  sites: [{ id: "S1", name: "Maslak", created_at: n }],
  work_records: [
    { id: "W1", customer_id: "C1", date: "2026-07-01", quantity: 3, unit: "Sefer", work_type: "Moloz Nakliye", site_id: "S1", price_snapshot: { amount: 9000 }, created_at: n },
    { id: "W2", customer_id: "C1", date: "2026-09-20", quantity: 2, unit: "Sefer", work_type: "Moloz Nakliye", price_snapshot: { amount: 6000 }, created_at: n },
    { id: "W3", customer_id: "C1", date: "2026-10-10", quantity: 1, unit: "Sefer", work_type: "Gravak", price_snapshot: { amount: 0 }, created_at: n },
    { id: "W4", customer_id: "C2", date: "2026-08-01", quantity: 5, unit: "Saat", price_snapshot: { unit_price: 2000 }, created_at: n },
    { id: "W5", customer_id: "C3", date: "2026-10-01", quantity: 1, unit: "Sefer", price_snapshot: { amount: 4000 }, created_at: n },
    { id: "W6", customer_id: "C3", date: "2026-10-02", quantity: 1, unit: "Sefer", price_snapshot: { amount: 4000 }, created_at: n },
    { id: "WY", customer_id: "Y", date: "2026-01-02", quantity: 1, unit: "Sefer", price_snapshot: { amount: 999 }, created_at: n },
  ],
  hakedis: [{ id: "H1", customer_id: "C3", status: "Kesinleşti", items: [{ work_record_id: "W5" }, { work_record_id: "W6" }], created_at: n }],
  cari_movements: [
    { id: "M1", customer_id: "C1", date: "2026-08-15", type: "Tahsilat", amount: -5000, created_at: n },
    { id: "M2", customer_id: "C3", date: "2026-10-03", type: "Hakedis", amount: 8000, note: "Hakediş #7", ref_id: "H1", created_at: n },
    { id: "M3", customer_id: "C3", date: "2026-10-05", type: "Tahsilat", amount: -8000, created_at: n },
  ],
  cash_records: [{ id: "K1", customer_id: "C1", date: "2026-08-15", cash_type: "Müşteriden Para Alındı", amount: 5000, created_at: n }],
  instruments: [
    { id: "I1", kind: "Çek", direction: "Alınan", party_type: "customer", party_id: "C1", document_no: "123", due_date: "2026-10-16", amount: 3000, status: "Portföyde", created_at: n },
    { id: "I2", kind: "Senet", direction: "Verilen", party_type: "supplier", party_id: "X", document_no: "9", due_date: "2026-12-01", amount: 1000, status: "Portföyde", created_at: n },
    { id: "I3", kind: "Çek", direction: "Alınan", party_type: "customer", party_id: "C2", document_no: "77", due_date: "2026-09-01", amount: 500, status: "Karşılıksız", created_at: n },
  ],
};
const today = "2026-10-15";

// FIFO: 5000 tahsilat en eski işten (9000) düşer → 4000 kalan; W2 6000 açık
const o = customerOpenItems(d, "C1", today);
assert.deepEqual(o.open.map((x) => [x.ref, x.left, x.days]), [["W1", 4000, 106], ["W2", 6000, 25]]);
assert.equal(o.open[0].label, "3 sefer Moloz Nakliye · Maslak");

const r = receivables(d, { today, notes: { C1: { promise_date: "2026-10-10", promise_amount: 4000, reminded_at: "2026-10-01T09:00:00Z" } } });
assert.deepEqual(r.rows.map((x) => x.id), ["C1", "C2"], "C3 kapalı, iç müşteri yok");
const c1 = r.rows[0];
assert.equal(c1.total, 10000);
assert.deepEqual(c1.buckets, { b0: 6000, b30: 0, b60: 0, b90: 4000 });
assert.equal(c1.unbilled, 10000);
assert.equal(c1.promise.late, true);
assert.equal(c1.reminded_days, 14);
assert.equal(c1.cheque_total, 3000);
assert.equal(c1.last_payment.days, 61);
assert.equal(r.rows[1].total, 10000, "birim fiyat × miktar");
assert.equal(r.total, 20000);
assert.equal(r.cheques_in, 3000);
assert.equal(r.cheques_out, 1000);
assert.equal(bucketOf(30), "b0"); assert.equal(bucketOf(31), "b30"); assert.equal(bucketOf(91), "b90");

// Hatırlatma metni
const t = reminderText(c1, { tone: "net", company: "Muratoğlu Hafriyat", iban: "TR12" });
assert.match(t, /10\.000 ₺/);
assert.match(t, /106 gündür/);
assert.match(t, /01\.07\.2026 — 3 sefer Moloz Nakliye · Maslak: 4\.000 ₺ \(kalan\)/);
assert.match(t, /IBAN: TR12/);
assert.match(reminderText(c1), /bakiyeniz görünüyor/);

// Telefon
assert.equal(waPhone("0532 111 22 33"), "905321112233");
assert.equal(waPhone("+90 (532) 111 22 33"), "905321112233");
assert.equal(waPhone("5321112233"), "905321112233");
assert.equal(waPhone("212 555"), "");
assert.match(waLink("05321112233", "a b"), /^https:\/\/wa\.me\/905321112233\?text=a%20b$/);

// Pano
const items = collectBoardItems(d, { today, notes: { C1: { promise_date: "2026-10-10" } } });
const texts = items.map((i) => i.text);
assert.ok(texts.includes("Kaya İnşaat ödeme sözü geçti"));
assert.ok(texts.some((x) => /Hisar Polat: 10\.000 ₺ alacak/.test(x)), texts.join("|"));
assert.ok(!texts.some((x) => /Kaya İnşaat: /.test(x)), "sözü olan müşteri ayrıca 'alacak' diye tekrar çıkmaz");
assert.ok(texts.includes("Tahsil edilecek çek #123"));
assert.ok(texts.includes("Karşılıksız çek #77"));
assert.ok(!texts.some((x) => /#9/.test(x)), "vadesi uzak senet yok");
// Yakın zamanda hatırlatılan müşteri tekrar uyarı vermez
assert.ok(!collectBoardItems(d, { today, notes: { C2: { reminded_at: "2026-10-12T10:00:00Z" } } }).some((i) => /Hisar/.test(i.text)));
console.log("collect ok");
{
  const { customerLedgerMovements, customerBalances } = await import("../js/collect-core.js");
  const { customerStatement, statementText } = await import("../js/statement.js");
  const mv = customerLedgerMovements(d, "C1");
  assert.deepEqual(mv.map((m) => [m.type, m.amount]).sort(), [["Is", 6000], ["Is", 9000], ["Tahsilat", -5000]]);
  const b = customerBalances(d);
  assert.equal(b.bal.C1, 10000); assert.equal(b.unbilled.C1, 15000);
  assert.equal(b.bal.C3, 0, "hakedişe giren işler iki kez sayılmaz");
  const st = customerStatement(mv, "C1");
  assert.equal(st.closing, 10000);
  assert.match(statementText("Kaya", st), /İş \(3 sefer Moloz Nakliye · Maslak\): \+9\.000,00/);
  console.log("ledger ok");
}
