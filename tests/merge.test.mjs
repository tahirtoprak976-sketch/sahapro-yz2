import assert from 'node:assert/strict';
import { planMerge, suggestGroups } from '../js/merge-core.js';
const d = {
  customers: [{ id: 'L', name: 'Leda' }, { id: 'LC', name: 'Leda / Coşar Polat' }, { id: 'PS', name: 'Peyzajcı Şenol' }, { id: 'PSB', name: 'Peyzajcı Şenol Bey' }, { id: 'K', name: 'Kuyucu' }, { id: 'KK', name: 'Kuyucu Kamil' }, { id: 'X', name: 'Hisar Polat' }, { id: 'U', name: 'Uygar İnşaat' }],
  sites: [{ id: 'S1', name: 'Yedi Salkım', customer_id: 'LC' }, { id: 'S2', name: 'Coşar Polat', customer_id: 'L' }],
  work_records: [{ id: 'W1', customer_id: 'LC', site_id: null, quantity: 1 }, { id: 'W2', customer_id: 'LC', site_id: 'S1', quantity: 2 }, { id: 'W3', customer_id: 'L', quantity: 3 }],
  cari_movements: [{ id: 'C1', customer_id: 'LC', amount: 100 }],
  payables: [{ id: 'P', party_type: 'customer', party_id: 'LC' }],
  aliases: [{ id: 'A', alias: 'coşar', target_type: 'customer', target_id: 'LC', active: true }],
  inbox_messages: [{ id: 'M', review_rows: [{ customer_id: 'LC' }, { customer_id: 'U' }] }],
};
// düz birleştirme
let p = planMerge(d, ['LC'], 'L');
assert.equal(p.counts.work_records, 2); assert.equal(p.counts.sites, 1); assert.equal(p.counts.cari_movements, 1); assert.equal(p.counts.payables, 1); assert.equal(p.counts.aliases, 1); assert.equal(p.counts.inbox_messages, 1);
assert.ok(p.updates.every((u) => JSON.stringify(u.after).includes('"L"') && !JSON.stringify(u.after).includes('"LC"')));
assert.deepEqual(p.aliases, [{ alias: 'Leda / Coşar Polat', target_type: 'customer', target_ref: 'L' }]);
assert.equal(p.updates.find((u) => u.store === 'inbox_messages').after.review_rows[1].customer_id, 'U');
// şantiye olarak: şantiyesiz kayıtlar yeni şantiyeye bağlanır, kendi şantiyesi olan korunur
p = planMerge(d, ['LC'], 'L', { asSite: true });
assert.equal(p.newSites.length, 0); // Leda'nın zaten 'Coşar Polat' şantiyesi var → ona bağlanır
const w1 = p.updates.find((u) => u.before.id === 'W1').after, w2 = p.updates.find((u) => u.before.id === 'W2').after;
assert.equal(w1.site_id, 'S2'); assert.equal(w2.site_id, 'S1');
const d2 = { ...d, sites: d.sites.filter((s) => s.id !== 'S2') };
const p2 = planMerge(d2, ['LC'], 'L', { asSite: true });
assert.equal(p2.newSites[0].name, 'Coşar Polat'); assert.equal(p2.updates.find((u) => u.before.id === 'W1').after.site_id, 'new-site:LC');
assert.equal(p.aliases[0].target_type, 'site');
// hedef olmadan / kendisiyle birleştirme reddedilir
assert.throws(() => planMerge(d, ['L'], 'L')); assert.throws(() => planMerge(d, ['LC'], 'YOK'));
// öneriler
const g = suggestGroups(d);
const names = g.map((x) => x.customers.map((c) => c.name).sort().join(' + '));
assert.ok(names.includes('Leda + Leda / Coşar Polat')); assert.ok(names.includes('Peyzajcı Şenol + Peyzajcı Şenol Bey')); assert.ok(names.includes('Kuyucu + Kuyucu Kamil'));
assert.ok(!names.some((n) => n.includes('Uygar')));
console.log('merge PASS');
