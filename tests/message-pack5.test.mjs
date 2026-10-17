import assert from 'node:assert/strict';
import { analyzeMessage } from '../js/message-engine.js';
import { fixture } from './gold/fixture.mjs';
const an = (t) => analyzeMessage({ id: 'T', text: t, date: '2026-10-14' }, fixture());
// x3 sefer olarak ÖNERİLİR, onay gerekir
let a = an('34ABC123 x3 moloz Eyüp');
assert.equal(a.rows[0].quantity, 3); assert.equal(a.rows[0].inference_confirmed, false);
assert.ok(a.rows[0].notes.some((n) => /x3/.test(n)));
// sabah/öğleden sonra toplamı önerilir ve onay ister
a = an('34 ABC 123 sabah 3 öğleden sonra 2 sefer moloz Ahmet Bey');
assert.equal(a.rows[0].quantity, 5); assert.equal(a.rows[0].inference_confirmed, false);
assert.ok(a.rows[0].notes.some((n) => /3 \+ 2/.test(n)));
// geçersiz tarih sessizce bugüne düşmez: uyarı notu
a = an('31/02 34 ABC 123 3 sefer Ahmet Bey');
assert.ok(a.rows[0].notes.some((n) => /tarih geçersiz/i.test(n)));
// saat dilimi "saat 8" miktar sayılmaz
a = an('saat 8 de 34 ABC 123 3 sefer moloz Ahmet Bey');
assert.equal(a.rows.length, 1); assert.equal(a.rows[0].quantity, 3);
// ondalık "2.5 saat" tarih sanılmaz
a = an('34 ABC 123 2.5 saat Ahmet Bey');
assert.equal(a.rows[0].quantity, 2.5); assert.equal(a.rows[0].date, '2026-10-14');
// gider/arıza bildirimi ayrı uyarı, iş satırı yok
a = an('kamyon 1 lastik patladı 4500 tl');
assert.equal(a.rows.length, 0); assert.ok(a.notices.some((n) => n.type === 'expense_or_breakdown'));
// kartsız çıplak miktar hâlâ devam mesajı
a = an('3 sefer');
assert.equal(a.rows.length, 0); assert.ok(a.notices.some((n) => n.type === 'continuation'));
// saat içeren mesajda dağılım yanlış tetiklenmez
a = an('34 ABC 123 4 sefer moloz Firma F akşam 18:00 gibi bitti');
assert.equal(a.rows.length, 1); assert.ok(!a.notices.some((n) => n.type === 'distribution_conflict'));
// mola süresi iş miktarı olmaz; iki yazım biçimi de aynı sonucu verir
for (const t of ['JCB 07:30-17:00 mola 1 saat Ahmet Bey Bahçeşehir', 'JCB 07:30-17:00 1 saat mola Ahmet Bey Bahçeşehir']) {
  a = an(t); assert.equal(a.rows.length, 1); assert.equal(a.rows[0].quantity, 8.5); assert.equal(a.rows[0].unit, 'Saat');
}
// "8-17 arası" saat aralığı: onay ister
a = an('Ahmet bey 34 ABC 123 8-17 arası çalıştı jcb');
assert.equal(a.rows[0].quantity, 9); assert.equal(a.rows[0].inference_confirmed, false);
// "ikisi de 5 er sefer": her araç için ayrı satır, onay ister
a = an("Firma F Eyüp'te 34 ABC 123 ile 34EC1353 ikisi de 5 er sefer moloz");
assert.equal(a.rows.length, 2); assert.deepEqual(a.rows.map((r) => r.vehicle_id).sort(), ['V1', 'V3']);
assert.ok(a.rows.every((r) => r.quantity === 5 && r.inference_confirmed === false));
// "2 kamyon 4 er sefer" = 8, onay ister (eskiden 2 çıkıyordu)
a = an("Ahmet Bey'in işine 2 kamyon gönderdim 4 er sefer");
assert.equal(a.rows[0].quantity, 8); assert.equal(a.rows[0].inference_confirmed, false);
// araç sayısı bilinmiyorsa miktar uydurulmaz
a = an('Ahmet Bey 4 er sefer moloz');
assert.equal(a.rows[0].quantity, null);
// tam gün / yarım gün: yevmiye önerisi, onay ister
a = an('jcb yarım gün Ahmet Bey Bahçeşehir');
assert.equal(a.rows[0].quantity, 0.5); assert.equal(a.rows[0].unit, 'Yevmiye'); assert.equal(a.rows[0].inference_confirmed, false);
// "3 tane sefer"
assert.equal(an('34 ABC 123 3 tane sefer çöp Ahmet Bey').rows[0].quantity, 3);
// son satır ortak bilgi: boş satır açılmaz, kartlar ADAY olarak önerilir (otomatik yazılmaz)
a = an('- 34 ABC 123 4 sefer\n- 34EC1353 3 sefer\nFirma F Eyüp moloz');
assert.equal(a.rows.length, 2); assert.ok(a.rows.every((r) => r.customer_id === null && r.candidates.customer_id.some((c) => c.id === 'CF' && c.via === 'context_candidate')));
assert.ok(a.rows.every((r) => r.work_type === 'Moloz Nakliye' && r.inference_confirmed === false));
// gün adı tek başına tarihi belirsiz bırakır (bugüne sessizce düşmez); "Pazar yeri" şantiye adı etkilemez
assert.equal(an('34 ABC 123 Ahmet Bey 3 sefer moloz pazartesi').rows[0].date, null);
assert.equal(an('34 ABC 123 Ahmet Bey 3 sefer moloz Pazar yeri').rows[0].date, '2026-10-14');
console.log('message-pack5 PASS');
