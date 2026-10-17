// Altın set değerlendirici: her alan için doğru / sessiz-yanlış / soruldu sayar.
import fs from 'node:fs';
import { analyzeMessage } from '../../js/message-engine.js';
import { fixture } from './fixture.mjs';
const gold = JSON.parse(fs.readFileSync(new URL('./gold.json', import.meta.url)));
const F = { customer:'customer_id', site:'site_id', vehicle:'vehicle_id', personnel:'personnel_id', type:'work_type', qty:'quantity', unit:'unit', date:'date' };
const stat = {}; const bad = []; let rowFail = 0;
for (const g of gold) {
  const a = analyzeMessage({ id: 'G', text: g.t, date: '2026-10-12' }, fixture());
  const rows = a.rows.filter(r => r.kind === 'work');
  if (rows.length !== g.rows.length) {
     rowFail++; bad.push(`SATIR SAYISI ${rows.length}≠${g.rows.length}: ${g.t}`); continue; }
  if (g.notice && !a.notices.some(n => n.type === g.notice)) { rowFail++; bad.push(`BEKLENEN UYARI YOK ${g.notice}: ${g.t}`); }
  g.rows.forEach((exp, i) => {
    for (const [k, v] of Object.entries(exp)) {
      const s = (stat[k] ||= { ok: 0, asked: 0, wrong: 0 });
      const got = rows[i][F[k]] ?? null;
      if (got === v) s.ok++;                       // doğru (null beklenip boş = doğru soru)
      else if (got === null) { s.asked++; bad.push(`SORULDU ${k}: beklenen ${v} | ${g.t}`); }        // dolduramadı → kullanıcıya soru
      else { s.wrong++; bad.push(`SESSİZ YANLIŞ ${k}: beklenen ${v}, gelen ${got} | ${g.t}`); }
    }
  });
}
let tot = { ok: 0, asked: 0, wrong: 0 };
for (const [k, s] of Object.entries(stat)) { console.log(k.padEnd(10), JSON.stringify(s)); for (const x in tot) tot[x] += s[x]; }
console.log('TOPLAM', JSON.stringify(tot), 'satır-sayısı hatası:', rowFail, 'mesaj:', gold.length);
bad.forEach(b => console.log(' ', b));
if (process.argv.includes('--strict') && (tot.wrong || rowFail || tot.asked)) process.exit(1);
