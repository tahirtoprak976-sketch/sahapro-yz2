// Altın set: sessiz yanlış ve satır sayısı hatası 0 olmalı; "soruldu" oranı sınırlı.
import { execFileSync } from 'node:child_process';
const out = execFileSync('node', [new URL('./gold/run.mjs', import.meta.url).pathname], { encoding: 'utf8' });
console.log(out);
const m = out.match(/TOPLAM (\{.*\}) satır-sayısı hatası: (\d+)/);
const t = JSON.parse(m[1]);
if (t.wrong !== 0 || Number(m[2]) !== 0) { console.error('FAIL: sessiz yanlış veya satır sayısı hatası var'); process.exit(1); }
if (t.asked / (t.ok + t.asked) > 0.05) { console.error('FAIL: soru oranı %5 üstü'); process.exit(1); }
console.log('GOLD PASS');
const mut = execFileSync('node', [new URL('./gold/mutate.mjs', import.meta.url).pathname], { encoding: 'utf8' });
console.log(mut);
