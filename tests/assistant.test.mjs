import assert from 'node:assert/strict';
import { validatePlan, similarCard, assistantContext } from '../js/assistant-core.js';
import { fixture } from './gold/fixture.mjs';
const d = { ...fixture(), suppliers: [{ id: 'S', name: 'Mesut Lastik' }] };
const today = '2026-10-14';
// tam ve doğru satır işaretli gelir
let v = validatePlan({ works: [{ date: '2026-10-14', customer_id: 'CMH', vehicle_id: 'T14', work_type: 'Makine Çalışması', quantity: 1, unit: 'Yevmiye' }] }, { message: 'Mahir bey 14 tonluk 1 yevmiye', d, today });
assert.equal(v.works[0].ok, true);
// araç adındaki 14 miktar sayılmaz
v = validatePlan({ works: [{ customer_id: 'CMH', vehicle_id: 'T14', work_type: 'Makine Çalışması', quantity: 14, unit: 'Saat' }] }, { message: 'Mahir bey 14 tonluk çalıştı', d, today });
assert.equal(v.works[0].ok, false); assert.ok(v.works[0].guessed);
// tahmin (öğlene kadar = 0.5) işaretsiz gelir, değer korunur
v = validatePlan({ works: [{ customer_id: 'CMH', vehicle_id: 'T14', work_type: 'Makine Çalışması', quantity: 0.5, unit: 'Yevmiye', guessed: true }] }, { message: 'Mahir bey 14 tonluk öğlene kadar çalıştı', d, today });
assert.equal(v.works[0].quantity, 0.5); assert.equal(v.works[0].ok, false);
// yeni müşteri: mesajda geçmeli; benzer kart varsa yeni açılmaz
v = validatePlan({ works: [{ new_customer: 'Kaya İnşaat', vehicle_id: 'V1', work_type: 'Moloz Nakliye', quantity: 3, unit: 'Sefer' }] }, { message: 'Kaya İnşaat 34 ABC 123 3 sefer moloz', d, today });
assert.equal(v.works[0].new_customer, 'Kaya İnşaat'); assert.deepEqual(v.newCustomers, ['Kaya İnşaat']); assert.equal(v.works[0].ok, true);
v = validatePlan({ works: [{ new_customer: 'Uydurma AŞ', vehicle_id: 'V1', work_type: 'Moloz Nakliye', quantity: 3, unit: 'Sefer' }] }, { message: 'Kaya İnşaat 34 ABC 123 3 sefer moloz', d, today });
assert.equal(v.works[0].new_customer, 'Kaya İnşaat', 'uydurma ad yerine mesajdaki ad önerilir'); assert.equal(v.works[0].ok, false);
v = validatePlan({ works: [{ new_customer: 'Gumus Yapi', vehicle_id: 'V1', work_type: 'Moloz Nakliye', quantity: 3, unit: 'Sefer' }] }, { message: 'Gumus Yapi 34 ABC 123 3 sefer', d, today });
assert.equal(v.works[0].customer_id, 'CG'); assert.equal(v.newCustomers.length, 0);
assert.equal(similarCard('Öztürk Grup', d.customers).id, 'CO');
// listede olmayan kimlik atılır
v = validatePlan({ works: [{ customer_id: 'YOK', vehicle_id: 'YOK', work_type: 'Uçuş', quantity: 3, unit: 'km' }] }, { message: '3 sefer', d, today });
assert.equal(v.works[0].customer_id, null); assert.equal(v.works[0].vehicle_id, null); assert.equal(v.works[0].work_type, null); assert.equal(v.works[0].unit, null);
// gider: tutar fiş metninde olmalı; veresiye esnaf ister
v = validatePlan({ photo_texts: ['SİPARİŞ FİŞİ\nTOPLAM 500,00'], expenses: [{ amount: 500, category: 'Lastik', photo: 0, credit: true, supplier_id: 'S' }, { amount: 900, category: 'Lastik', photo: 0 }] }, { message: 'lastikçi fişi', d, today, photoCount: 1 });
assert.equal(v.expenses[0].ok, true); assert.equal(v.expenses[0].amount, 500); assert.equal(v.expenses[0].photo, 0);
assert.equal(v.expenses[1].ok, false);
v = validatePlan({ expenses: [{ amount: 500, credit: true }] }, { message: 'Mesut 500 veresiye', d, today });
assert.equal(v.expenses[0].ok, false);
// tarih: gelecek/uzak tarih bugüne çekilir ve söylenir
v = validatePlan({ works: [{ date: '2030-01-01', customer_id: 'CA', vehicle_id: 'V1', work_type: 'Moloz Nakliye', quantity: 3, unit: 'Sefer' }] }, { message: 'Ahmet Bey 34 ABC 123 3 sefer', d, today });
assert.equal(v.works[0].date, today); assert.ok(v.works[0].issues.some((x) => /Tarih/.test(x)));
// yakıt
v = validatePlan({ fuel: [{ vehicle_id: 'V1', liters: 70 }] }, { message: '34 ABC 123 70 lt mazot', d, today });
assert.equal(v.fuel[0].source, 'Depo Tankı'); assert.equal(v.fuel[0].ok, false, 'depoda stok yok');
v = validatePlan({ fuel: [{ vehicle_id: 'V1', liters: 70, source: 'Akaryakıt İstasyonu' }] }, { message: '34 ABC 123 70 lt mazot', d, today });
assert.equal(v.fuel[0].ok, true);
// bağlam: kartlar gönderilir
const ctx = assistantContext(d, today);
assert.ok(ctx.customers.some((c) => c[1] === 'Mahir Yapı')); assert.ok(ctx.aliases.some((a) => a[0] === 'Mahir Bey'));
console.log('assistant PASS');
// ---- tahsilat, arıza, personel, düzeltme, soru ----
const { validateExtras, moneyInText, businessFacts, checkAnswer } = await import('../js/assistant-core.js');
assert.ok(moneyInText('Ahmet Bey 20 bin havale yaptı').has(20000));
assert.ok(moneyInText('1,5 milyon').has(1500000));
const d2 = { ...d, bank_accounts: [{ id: 'B1', name: 'Ziraat' }], maintenance_records: [], personnel_events: [],
  work_records: [{ id: 'W1', date: '2026-10-13', customer_id: 'CA', vehicle_id: 'V1', work_type: 'Moloz Nakliye', quantity: 4, unit: 'Sefer' }],
  cari_movements: [{ id: 'm', customer_id: 'CA', date: '2026-10-01', type: 'Hakedis', amount: 50000 }] };
let x = validateExtras({ collections: [{ customer_id: 'CA', amount: 20000, method: 'Havale', bank_account_id: 'B1' }, { customer_id: 'CA', amount: 25000, method: 'Nakit' }] }, { message: 'Ahmet Bey 20 bin havale yaptı', d: d2, today });
assert.equal(x.collections[0].ok, true); assert.equal(x.collections[1].ok, false);
x = validateExtras({ collections: [{ customer_id: 'CA', amount: 20000, method: 'Havale' }] }, { message: 'Ahmet Bey 20 bin havale', d: d2, today });
assert.equal(x.collections[0].ok, false);
x = validateExtras({ maintenance: [{ vehicle_id: 'J', maint_type: 'Hidrolik', status: 'Serviste', description: 'hidrolik hortum patladı', cost: 3500, supplier_id: 'S', credit: true }] }, { message: 'jcb hidrolik hortum patladı Mesut usta 3500 veresiye', d: d2, today });
assert.equal(x.maintenance[0].ok, true); assert.equal(x.maintenance[0].cost, 3500);
x = validateExtras({ maintenance: [{ vehicle_id: 'J', description: 'arıza', cost: 9999 }] }, { message: 'jcb arıza', d: d2, today });
assert.equal(x.maintenance[0].ok, false);
x = validateExtras({ personnel: [{ personnel_id: 'P1', event_type: 'Avans', amount: 2000 }] }, { message: 'Soner abiye 2000 avans', d: d2, today });
assert.equal(x.personnel[0].ok, true);
// düzeltme: alan ve sayı doğrulanır, varsayılan işaretsiz
x = validateExtras({ edits: [{ store: 'work_records', id: 'W1', changes: { quantity: 5, price: 1 }, reason: 'yanlış' }] }, { message: 'dünkü 34 ABC 123 4 değil 5 sefer', d: d2, today });
assert.equal(x.edits[0].changes.quantity, 5); assert.equal(x.edits[0].ok, false); assert.ok(x.edits[0].issues.some((i) => /price/.test(i)));
x = validateExtras({ edits: [{ store: 'work_records', id: 'YOK', changes: { quantity: 5 } }, { store: 'customers', id: 'CA', delete: true }] }, { message: '5', d: d2, today });
assert.equal(x.edits[0].rec, null); assert.equal(x.edits[1].rec, null);
// soru: gerçekler yerelde hesaplanır, cevaptaki uydurma sayı yakalanır
const facts = await businessFacts(d2, today);
assert.equal(facts.musteriler.find((m) => m.musteri === 'Ahmet Yılmaz İnşaat').cari_bakiye_TL, 50000);
assert.deepEqual(checkAnswer('Ahmet Bey 50.000 TL borçlu', facts), []);
assert.deepEqual(checkAnswer('Ahmet Bey 65.000 TL borçlu', facts), [65000]);
console.log('assistant-extras PASS');
// iş açıklaması, malzeme, döküm, fiyat
{
  const dd = { ...d, dump_sites: [{ id: 'D1', name: 'Kemerburgaz Döküm' }] };
  const v3 = validatePlan({ works: [{ customer_id: 'CA', vehicle_id: 'V1', work_type: 'Moloz Nakliye', quantity: 3, unit: 'Sefer', description: 'Bahçeşehir şantiyesinden moloz', material: 'moloz', dump_site_id: 'D1', unit_price: 1800 }] }, { message: 'Ahmet Bey 34 ABC 123 3 sefer moloz Kemerburgaz döküme sefer 1800', d: dd, today });
  assert.equal(v3.works[0].description, 'Bahçeşehir şantiyesinden moloz'); assert.equal(v3.works[0].dump_site_id, 'D1'); assert.equal(v3.works[0].unit_price, 1800); assert.equal(v3.works[0].material, 'moloz');
  const v4 = validatePlan({ works: [{ customer_id: 'CA', vehicle_id: 'V1', work_type: 'Moloz Nakliye', quantity: 3, unit: 'Sefer', unit_price: 2500, dump_site_id: 'YOK' }] }, { message: 'Ahmet Bey 34 ABC 123 3 sefer moloz', d: dd, today });
  assert.equal(v4.works[0].unit_price, null); assert.equal(v4.works[0].dump_site_id, null);
}
console.log('assistant-detail PASS');
// liste ile kart ekleme + hafıza ifadeleri
{
  const { validateCards } = await import('../js/assistant-core.js');
  const msg = 'Müşteriler: Kaya İnşaat 0532 111 22 33, Gümüş Yapı. Şantiye: Kaya İnşaat Göktürk. Araç: 34 KYA 77 Kamyon. Esnaf: Rafet Usta makasçı';
  const cs = validateCards({ cards: { customers: [{ name: 'Kaya İnşaat', phone: '0532 111 22 33' }, { name: 'Gümüş Yapı' }, { name: 'Uydurma Ltd' }], sites: [{ name: 'Göktürk', customer_name: 'Kaya İnşaat' }], vehicles: [{ name: '34 KYA 77', plate: '34 KYA 77', type: 'Kamyon' }, { name: '34 ABC 123', plate: '34ABC123' }], suppliers: [{ name: 'Rafet Usta', type: 'Servis' }] } }, { message: msg, d });
  const by = (n) => cs.find((x) => x.name === n);
  assert.equal(by('Kaya İnşaat').ok, true); assert.equal(by('Gümüş Yapı').ok, false); assert.ok(by('Gümüş Yapı').issues[0].includes('Zaten kayıtlı'));
  assert.equal(by('Uydurma Ltd').ok, false); assert.equal(by('Göktürk').ok, true); assert.equal(by('Göktürk').data.customer_name, 'Kaya İnşaat');
  assert.equal(by('34 KYA 77').ok, true); assert.equal(by('34 ABC 123').ok, false); assert.equal(by('Rafet Usta').ok, true);
  const vm = validatePlan({ works: [{ customer_id: 'CMH', vehicle_id: 'T14', work_type: 'Makine Çalışması', quantity: 1, unit: 'Yevmiye', mentions: { customer: 'mahir bey', vehicle: '14 tonluk', site: 'uydurma yer' } }] }, { message: 'mahir bey 14 tonluk 1 yevmiye', d, today });
  assert.deepEqual(vm.works[0].mentions, { customer: 'mahir bey', vehicle: '14 tonluk' });
}
console.log('assistant-cards PASS');
// geçmiş iş ipuçları: "Mahir bey" → Hisar Polat (yeni müşteri açılmaz)
{
  const { customerHints, hintCustomer } = await import('../js/assistant-core.js');
  const dh = { ...d, customers: [...d.customers.filter((c) => c.id !== 'CMH'), { id: 'HP', name: 'Hisar Polat' }], aliases: d.aliases.filter((a) => a.target_id !== 'CMH'),
    work_records: [
      { id: 'h1', customer_id: 'HP', description: 'Jcb kepçe Mahir bey inşaatı yol sıyırma' },
      { id: 'h2', customer_id: 'HP', description: 'Mahir beye 2 saat tuğla verildi' },
      { id: 'h3', customer_id: 'HP', description: 'Mahir beyin şantiyesi kablo' },
      { id: 'h4', customer_id: 'CA', description: 'Sinan abiye 1 saat' },
    ] };
  const hs = customerHints(dh);
  assert.deepEqual(hs.find(([id]) => id === 'HP')[1], ['mahir bey']);
  assert.equal(hintCustomer('Mahir Bey', hs), 'HP'); assert.equal(hintCustomer('Sinan Abi', hs), null); // tek kayıt: yeterli değil
  const vh = validatePlan({ works: [{ new_customer: 'Mahir Bey', vehicle_id: 'T14', work_type: 'Makine Çalışması', quantity: 0.5, unit: 'Yevmiye' }] }, { message: '14 tonluk mahir bey şantiyesi yarım yevmiye', d: dh, today });
  assert.equal(vh.works[0].customer_id, 'HP'); assert.equal(vh.works[0].new_customer, null); assert.equal(vh.newCustomers.length, 0);
  assert.equal(vh.works[0].ok, false); assert.equal(vh.works[0].mentions.customer, 'Mahir Bey');
}
console.log('assistant-hints PASS');
// kullanıcı eşleştirme öğretir + yeni müşteri önerisi yerine mevcut seçilince öğrenme metni
{
  const { validateMemory } = await import('../js/assistant-core.js');
  const dm = { ...d, customers: [...d.customers, { id: 'HP', name: 'Hisar Polat' }] };
  const dm0 = { ...dm, aliases: [] };
  const mem = validateMemory({ memory: [{ alias: 'Mahir bey', target_type: 'customer', target_id: 'HP' }, { alias: 'yok böyle', target_type: 'customer', target_id: 'HP' }, { alias: 'Mahir bey', target_type: 'customer', target_id: 'YOK' }] }, { message: 'Mahir bey dediğimde Hisar Polat anla', d: dm0 });
  assert.equal(mem[0].ok, true); assert.equal(mem[0].target_name, 'Hisar Polat'); assert.equal(mem[1].ok, false); assert.equal(mem[2].ok, false);
  const conflict = validateMemory({ memory: [{ alias: 'Mahir Bey', target_type: 'customer', target_id: 'HP' }] }, { message: 'Mahir Bey Hisar Polat', d: dm });
  assert.equal(conflict[0].ok, false); // fixture'da Mahir Bey → CMH zaten bağlı
  const vp = validatePlan({ works: [{ new_customer: 'Mahir Bey', vehicle_id: 'T14', work_type: 'Makine Çalışması', quantity: 0.5, unit: 'Yevmiye' }] }, { message: '14 tonluk mahir bey şantiyesi yarım yevmiye', d: { ...dm, aliases: [] }, today });
  assert.equal(vp.works[0].new_customer_text, 'Mahir Bey');
}
console.log('assistant-memory PASS');
// büyük listede yalnız ilgili müşteriler gönderilir
{
  const { assistantContext } = await import('../js/assistant-core.js');
  const many = Array.from({ length: 200 }, (_, i) => ({ id: 'X' + i, name: 'Firma ' + i + ' Yapı' }));
  const db2 = { ...d, customers: [...d.customers, ...many], work_records: [] };
  const c1 = assistantContext(db2, today, 'Leda 34 ABC 123 3 sefer');
  assert.ok(c1.customers.some(([id]) => id === 'CL')); assert.ok(c1.customers.length < 20);
  assert.ok(assistantContext(db2, today, 'Mahir bey 1 yevmiye').customers.some(([id]) => id === 'CMH')); // takma ad ile
  assert.equal(assistantContext(d, today, 'x').customers.length, d.customers.length); // küçük listede hepsi
  assert.equal(assistantContext(d, today, 'x').recent_cash.length, 0);
}
console.log('assistant-context PASS');
// alıntı, reddedilen eşleşme, örnekler, ölçüm, şablon
{
  const m = await import('../js/assistant-core.js');
  assert.equal(m.quoteFound('34 abc 123 3 sefer', 'Ahmet Bey 34 ABC 123 3 sefer moloz'), true);
  assert.equal(m.quoteFound('5 sefer', 'Ahmet Bey 34 ABC 123 3 sefer'), false);
  let v = validatePlan({ works: [{ customer_id: 'CA', vehicle_id: 'V1', work_type: 'Moloz Nakliye', quantity: 3, unit: 'Sefer', quote: '34 ABC 123 4 sefer' }] }, { message: 'Ahmet Bey 34 ABC 123 3 sefer moloz', d, today });
  assert.equal(v.works[0].ok, false); assert.ok(v.works[0].issues.some((x) => /alıntı/.test(x)));
  v = validatePlan({ works: [{ customer_id: 'CA', vehicle_id: 'V1', work_type: 'Moloz Nakliye', quantity: 3, unit: 'Sefer', quote: 'Ahmet Bey 34 ABC 123 3 sefer', mentions: { customer: 'Ahmet Bey' } }] }, { message: 'Ahmet Bey 34 ABC 123 3 sefer moloz', d, today, negatives: [{ alias: 'ahmet bey', target_type: 'customer', target_id: 'CA' }] });
  assert.equal(v.works[0].customer_id, null); assert.equal(v.works[0].ok, false);
  const ex = m.addExample(m.addExample([], { msg: 'Mahir bey 14 tonluk yarım yevmiye', out: 'Hisar Polat | 14 Tonluk' }), { msg: 'Leda jcb 8 saat', out: 'Leda | JCB' });
  assert.equal(m.pickExamples(ex, 'mahir bey 14 tonluk 1 yevmiye', 1)[0].out, 'Hisar Polat | 14 Tonluk');
  assert.equal(m.pickExamples(ex, 'tamamen alakasız', 3).length, 0);
  const q = m.measureCorrection({ customer_id: 'A', vehicle_id: 'V', work_type: 'X', quantity: 3, unit: 'Sefer' }, { customer_id: 'B', vehicle_id: 'V', work_type: 'X', quantity: 3, unit: 'Sefer' }, false);
  assert.equal(q.changed, 1); assert.equal(q.silent, 1);
  assert.equal(m.addQuality(m.addQuality(null, q), q).cards, 2);
  const sch = m.assistantSchema(); assert.ok(sch.properties.works.items.properties.quote);
}
console.log('assistant-accuracy PASS');
