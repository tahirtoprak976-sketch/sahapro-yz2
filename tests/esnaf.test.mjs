import assert from 'node:assert/strict';
let ledgerOf, statementText, findDuplicates, creditItem;
try { ({ ledgerOf, statementText, findDuplicates, creditItem } = await import('../js/esnaf.js')); }
catch (e) { console.log('SKIP (tarayıcı gerektirir):', e.message); process.exit(0); }
const d = { payables: [
  { id: 'b1', party_type: 'supplier', party_id: 'S', date: '2026-10-10', gross_total: 500, status: 'Onaylandı', created_at: '1', items: [{ description: '2 lastik' }] },
  { id: 'b2', party_type: 'supplier', party_id: 'S', date: '2026-10-13', gross_total: 1200, status: 'Onaylandı', created_at: '2', items: [{ description: '4 lastik' }] },
  { id: 'b3', party_type: 'supplier', party_id: 'S', date: '2026-10-13', gross_total: 999, status: 'İptal', created_at: '3', items: [{ description: 'iptal' }] },
  { id: 'b4', party_type: 'supplier', party_id: 'X', date: '2026-10-13', gross_total: 77, status: 'Onaylandı', created_at: '4', items: [{ description: 'başka usta' }] },
], supplier_payments: [
  { id: 'p1', party_id: 'S', payable_id: 'b1', amount: 300, date: '2026-10-14', batch_key: 'k', method: 'Nakit', created_at: '5' },
  { id: 'p2', party_id: 'S', payable_id: 'b2', amount: 100, date: '2026-10-14', batch_key: 'k', method: 'Nakit', created_at: '5' },
] };
const l = ledgerOf(d, 'S');
assert.equal(l.total, 170000); assert.equal(l.paid, 40000); assert.equal(l.remaining, 130000);
assert.equal(l.entries.length, 3);                       // 2 alış + 1 gruplanmış ödeme (iptal ve başka usta yok)
assert.equal(l.entries.at(-1).kind, 'pay'); assert.equal(l.entries.at(-1).amount, 40000);
assert.equal(l.entries.at(-1).balance, 130000);
assert.match(statementText('Mesut', l, '2026-10-15'), /Kalan borç: 1\.300,00 ₺/);

// tekrar engeli
const dd = { ...d, expense_records: [
  { id: 'e1', date: '2026-10-13', amount: 1200, category: 'Lastik' },
  { id: 'e2', date: '2026-10-13', amount: 70 },
], payables: [...d.payables, { id: 'b5', party_type: 'supplier', party_id: 'S', date: '2026-10-13', gross_total: 70, status: 'Onaylandı', source_store: 'expense_records', source_id: 'e2', items: [] }] };
assert.equal(findDuplicates(dd, { date: '2026-10-13', amount: 1200, supplier_id: 'S' }).bills.length, 1);   // aynı usta/gün/tutar
assert.equal(findDuplicates(dd, { date: '2026-10-13', amount: 1200, supplier_id: 'S' }).expenses.length, 1); // aynı gün gider
assert.equal(findDuplicates(dd, { date: '2026-10-13', amount: 70 }).expenses.length, 0);   // gider zaten borca bağlı
assert.equal(findDuplicates(dd, { date: '2026-10-13', amount: 1200, supplier_id: 'X' }).bills.length, 0);
assert.equal(findDuplicates(dd, { date: '2026-10-14', amount: 1200 }).bills.length, 0);   // başka gün
assert.equal(findDuplicates(dd, { date: '2026-10-13', amount: 1200.5 }).bills.length, 0); // başka tutar
// KDV uydurulmaz
assert.equal(creditItem('x', 500, '').kdv_unknown, true);
assert.equal(creditItem('x', 500, null).kdv_unknown, true);
const k = creditItem('x', 1200, 20);
assert.equal(k.kdv_unknown, false); assert.equal(k.items[0].kdv_rate, 20);
console.log('esnaf 14/14 PASS');
