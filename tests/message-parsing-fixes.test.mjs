// v3.7.2 ayrıştırma düzeltmeleri — olumlu ve olumsuz regresyon testleri
import assert from 'node:assert/strict';
import { analyzeMessage } from '../js/message-engine.js';
import { parseWhatsApp, buildAliasIndex, foldTr, hasWord, detectWorkType, refineWorkType } from '../js/parser.js';
import { assistedRows, rowQuestions } from '../js/message-smart-core.js';
const data = () => ({
  customers: [{ id: 'CA', name: 'Ahmet Yılmaz İnşaat' }, { id: 'CF', name: 'Firma F İnşaat' }, { id: 'CG', name: 'Gümüş Yapı' }, { id: 'CH', name: 'Çağrı Hafriyat' }],
  sites: [{ id: 'S1', name: 'Kemerburgaz', customer_id: 'CF' }, { id: 'S2', name: 'Eyüp', customer_id: 'CF' }, { id: 'S3', name: 'Şişli Plaza', customer_id: 'CG' }, { id: 'S4', name: 'Bahçeşehir', customer_id: 'CA' }, { id: 'S5', name: 'Eski', customer_id: 'CG', active: false }],
  vehicles: [{ id: 'J', name: 'JCB' }, { id: 'V1', name: '34 ABC 123' }, { id: 'V2', name: 'Kamyon 1' }], personnel: [],
  aliases: [], work_records: [], fuel_records: [], dump_sites: [], quarries: [],
});
const parse = (text, d = data()) => analyzeMessage({ id: 'T', text, date: '2026-10-12' }, d);
let n = 0;
const test = (name, fn) => { fn(); n++; console.log('PASS ' + name); };

// --- İş türü ---
test('JCB + saat → JCB Çalışması (Kum Nakliye değil)', () => assert.equal(parse('JCB ile kum yüklemesi 3 saat').rows[0].work_type, 'JCB Çalışması'));
test('"kumanda" kum sayılmaz', () => assert.equal(detectWorkType('kumanda arızası'), null));
test('"kumda" (ek) kum sayılır', () => assert.equal(detectWorkType('kumda 3 sefer'), 'Kum Nakliye'));
test('Mıcır + sefer → Mıcır Nakliye korunur', () => assert.equal(parse('34 ABC 123 Firma F İnşaat 3 sefer mıcır').rows[0].work_type, 'Mıcır Nakliye'));
test('Mıcır + saat (makine yok) → tür uydurulmaz', () => { const r = parse('mıcır 3 saat Firma F İnşaat').rows[0]; assert.equal(r.work_type, null); assert.ok(r.notes.some(x => x.includes('taşıma'))); });
test('Hafriyat sefer korunur', () => assert.equal(parse('34 ABC 123 Gümüş Yapı 5 sefer hafriyat').rows[0].work_type, 'Hafriyat Nakliye'));
test('Müşteri adındaki "Hafriyat" + JCB saat → JCB', () => assert.equal(parse('Çağrı Hafriyat jcb 2 saat').rows[0].work_type, 'JCB Çalışması'));
test('JCB + sefer: tür makineye çevrilmez', () => assert.equal(refineWorkType('jcb 3 sefer kum', 'Kum Nakliye', 'Sefer').type, 'Kum Nakliye'));
test('Eski ayrıştırıcı da aynı sonucu verir', () => { const d = data(); const ctx = { date: '2026-10-12', raw: 'x', vehicles: d.vehicles, customers: d.customers, sites: d.sites, personnel: [], aliasIdx: buildAliasIndex([], d.vehicles, d.customers, d.sites, []) }; assert.equal(parseWhatsApp('JCB ile kum yüklemesi 3 saat', ctx)[0].work_type, 'JCB Çalışması'); });
test('hasWord kelime sınırı', () => { assert.equal(hasWord('kumanda', 'kum'), false); assert.equal(hasWord('Kum.', 'kum'), true); assert.equal(hasWord('mini kato ile', 'mini kato'), true); });

// --- Türkçe / ASCII ---
test('foldTr uzunluğu korur', () => { const s = 'İĞÜŞÖÇı Şişli'; assert.equal(foldTr(s).length, s.length); assert.equal(foldTr('Şişli Çağrı'), 'sisli cagri'); });
test('ASCII müşteri adı forma otomatik yazılmaz', () => { const r = parse('Gumus Yapi 5 sefer moloz').rows[0]; assert.equal(r.customer_id, null); assert.equal(r.candidates.customer_id[0].id, 'CG'); assert.equal(r.candidates.customer_id[0].via, 'ascii_fold'); });
test('ASCII eşleşme görünür not üretir', () => assert.ok(parse('Gumus Yapi 5 sefer moloz').rows[0].notes.some(x => x.includes('yazım farkıyla'))));
test('Tam yazım hâlâ otomatik doldurur', () => assert.equal(parse('Gümüş Yapı Şişli Plaza 5 sefer moloz').rows[0].customer_id, 'CG'));
test('ASCII şantiye adayı sunulur', () => assert.equal(parse('Gumus Yapi Sisli Plaza 5 sefer moloz').rows[0].candidates.site_id[0].id, 'S3'));
test('Yakın ama farklı ad ASCII eşleşmesi sayılmaz', () => assert.equal(parse('Gumus Yapi Sisli 5 sefer moloz').rows[0].candidates.site_id.some(c => c.via === 'ascii_fold'), false));
test('Kısa ad (3 harf) ASCII ile eşleşmez', () => { const d = data(); d.customers.push({ id: 'CK', name: 'Ünü' }); assert.equal(parse('unu 3 sefer moloz', d).rows[0].candidates.customer_id.some(c => c.id === 'CK'), false); });

// --- Çapraz satır sızıntısı ---
test('İkinci satırın ASCII müşterisi birinciden miras almaz', () => { const r = parse('Ahmet Yılmaz İnşaat 4 sefer hafriyat, Gumus Yapi 3 sefer moloz').rows; assert.equal(r.length, 2); assert.equal(r[0].customer_id, 'CA'); assert.equal(r[1].customer_id, null); });
test('Tek satırda iki iş: etiketler doğru satıra gider', () => { const r = parse('Ahmet Yılmaz İnşaat 4 sefer hafriyat, Gümüş Yapı 3 sefer moloz').rows; assert.deepEqual(r.map(x => x.customer_id), ['CA', 'CG']); assert.deepEqual(r.map(x => x.work_type), ['Hafriyat Nakliye', 'Moloz Nakliye']); assert.deepEqual(r.map(x => x.quantity), [4, 3]); });
test('"ve" ile ayrılan iki iş', () => { const r = parse('Ahmet Yılmaz İnşaat 4 sefer hafriyat ve Gümüş Yapı 3 sefer moloz').rows; assert.deepEqual(r.map(x => x.customer_id), ['CA', 'CG']); });
test('Başlıktaki müşteri tüm satırlara geçer', () => { const r = parse('Gümüş Yapı: 4 sefer hafriyat, 3 sefer moloz').rows; assert.equal(r.length, 2); assert.deepEqual(r.map(x => x.customer_id), ['CG', 'CG']); });
test('Başka satırdaki müşteri aday olur, doldurulmaz', () => { const r = parse('4 sefer moloz, Gümüş Yapı 3 sefer kum').rows; assert.equal(r[0].customer_id, null); assert.equal(r[1].customer_id, 'CG'); assert.equal(r[0].candidates.customer_id[0].via, 'context_candidate'); });
test('İki gerçek aynı gün iş birleştirilmez', () => assert.equal(parse('Gümüş Yapı 4 sefer hafriyat, Gümüş Yapı 4 sefer hafriyat').rows.length, 2));
test('Ondalık virgül satır ayırmaz', () => assert.equal(parse('JCB Gümüş Yapı 2,5 saat').rows.length, 1));

// --- Çok şantiyeli müşteri ---
test('2 aktif şantiyeli müşteri + şantiye yok → şantiye boş + not', () => { const r = parse('Firma F İnşaat 6 sefer hafriyat').rows[0]; assert.equal(r.site_id, null); assert.ok(r.notes.some(x => x.includes('birden fazla şantiye'))); assert.equal(r.candidates.site_id.length, 2); });
test('Şantiye yazılıysa soru çıkmaz', () => { const r = parse('Firma F İnşaat Eyüp 6 sefer hafriyat').rows[0]; assert.equal(r.site_id, 'S2'); assert.ok(!r.notes.some(x => x.includes('birden fazla şantiye'))); });
test('Pasif şantiye sayılmaz (tek aktif şantiye → soru yok)', () => assert.ok(!parse('Gümüş Yapı 4 sefer moloz').rows[0].notes.some(x => x.includes('birden fazla şantiye'))));
test('Doğrulama: çok şantiyeli müşteri için soru üretir', () => { const d = data(); const m = { id: 'T', text: 'Firma F İnşaat 6 sefer hafriyat 34 ABC 123', date: '2026-10-12' }; const q = rowQuestions(assistedRows(m, d)[0], d); assert.ok(q.some(x => x.text.includes('birden fazla aktif şantiye'))); });

// --- Değişmeyenler ---
test('Alias hâlâ otomatik doldurur', () => { const d = data(); d.aliases.push({ id: 'a', alias: 'Patron C', target_type: 'customer', target_id: 'CF', active: true }); assert.equal(parse('Patron C Eyüp 2 sefer hafriyat', d).rows[0].customer_id, 'CF'); });
test('Mesaj yazma yapmaz (veri değişmez)', () => { const d = data(), before = JSON.stringify(d); parse('JCB Gümüş Yapı 3 saat', d); assert.equal(JSON.stringify(d), before); });
console.log(n + '/' + n + ' PASS');
