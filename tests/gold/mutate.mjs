// Mutasyon testi: bozulmuş yazımda alan ya doğru ya BOŞ olmalı; yanlış kart asla.
import fs from 'node:fs';
import { analyzeMessage } from '../../js/message-engine.js';
import { foldTr } from '../../js/parser.js';
import { fixture } from './fixture.mjs';
const gold = JSON.parse(fs.readFileSync(new URL('./gold.json', import.meta.url)));
const F = { customer:'customer_id', site:'site_id', vehicle:'vehicle_id' };
const muts = {
  ascii: t => foldTr(t),
  upper: t => t.toLocaleUpperCase('tr-TR'),
  spaces: t => t.replace(/ /g, '  '),
  typo: t => t.replace(/\p{L}{6,}/u, w => w.slice(0, 3) + (w[3] === 'x' ? 'y' : 'x') + w.slice(4)),
  drop: t => t.replace(/\p{L}{6,}/u, w => w.slice(0, 2) + w.slice(3)),
};
let n = 0, wrong = 0; const bad = [];
for (const g of gold) for (const [mn, f] of Object.entries(muts)) {
  const text = f(g.t); if (text === g.t) continue;
  const rows = analyzeMessage({ id: 'M', text, date: '2026-10-12' }, fixture()).rows.filter(r => r.kind === 'work');
  if (rows.length !== g.rows.length) continue;           // satır sayısı değişimi güvenli (soruya düşer)
  g.rows.forEach((e, i) => { for (const k of Object.keys(F)) if (k in e) {
    n++; const got = rows[i][F[k]] ?? null;
    if (got !== null && got !== e[k]) { wrong++; bad.push(`${mn} ${k}: beklenen ${e[k]} gelen ${got} | ${text}`); }
  }});
}
console.log('MUTASYON kontrol:', n, 'sessiz yanlış:', wrong); bad.slice(0, 30).forEach(b => console.log(' ', b));
if (wrong) process.exit(1);
