import assert from "node:assert/strict";
import zlib from "node:zlib";
import { parseChat, planDays, isChatter, markDone, formatLine } from "../js/wa-bulk-core.js";
import { listZip, openChatZip } from "../js/unzip.js";

const android = [
  "12.10.2026 07:58 - Mesajlar ve aramalar uçtan uca şifrelidir.",
  "12.10.2026 08:01 - Ali Şoför: 34gam627 kılıç hafriyat 3 sefer",
  "göktürk dolguya",
  "12.10.2026 08:02 - Ali Şoför: IMG-20261012-WA0003.jpg (dosya ekli)",
  "12.10.2026 08:03 - Veli: tamam",
  "12.10.2026 08:04 - Veli: 👍",
  "12.10.2026 08:05 - Mehmet: <Medya dahil edilmedi>",
  "12.10.2026 09:10 - Hasan gruba katıldı",
  "13.10.2026 18:30 - Mehmet: JCB leda 8 saat",
  "13.10.2026 18:31 - Mehmet: Bu mesaj silindi",
].join("\n");
const m = parseChat(android);
assert.equal(m.length, 6, "sistem ve silinen mesaj yok; medyasız mesaj kalır");
assert.equal(m[0].sender, "Ali Şoför"); assert.equal(m[0].text, "34gam627 kılıç hafriyat 3 sefer\ngöktürk dolguya");
assert.deepEqual(m[1].files, ["IMG-20261012-WA0003.jpg"]); assert.equal(m[1].text, "");
assert.equal(m[4].omitted, true);
assert.ok(isChatter(m[2]) && isChatter(m[3])); assert.ok(!isChatter(m[0])); assert.ok(!isChatter(m[1]));
assert.match(formatLine(m[1]), /^\[12\.10\.2026 08:02\] Ali Şoför: \(foto: IMG-20261012-WA0003\.jpg\)$/);

const ios = "‎[14.10.2026 21:09:33] Kemal: 34UL9492 bolluca 2 sefer\n[14.10.2026 21:10:01] Kemal: ‎<ekli: 00000012-PHOTO-2026-10-14-21-10-01.jpg>";
const mi = parseChat(ios);
assert.equal(mi.length, 2); assert.equal(mi[0].time, "21:09"); assert.deepEqual(mi[1].files, ["00000012-PHOTO-2026-10-14-21-10-01.jpg"]);

// Plan: günlere böl, sohbeti at, işlenmişi atla
let p = planDays(m);
assert.equal(p.skippedChatter, 2);
assert.deepEqual(p.plan.map((x) => [x.id, x.msgs.length, x.photos]), [["2026-10-12#1", 3, 1], ["2026-10-13#1", 1, 0]]);
assert.match(p.plan[0].text, /\[12\.10\.2026 08:01\] Ali Şoför: 34gam627/);
const done = markDone({}, p.plan[0].msgs, "2026-10-15");
p = planDays(parseChat(android + "\n14.10.2026 10:00 - Ali Şoför: 34fy2482 2 sefer cebeci"), { done });
assert.equal(p.skippedDone, 3);
assert.deepEqual(p.plan.map((x) => x.date), ["2026-10-13", "2026-10-14"], "aynı dışa aktarım yeniden: yalnız yeniler");
// Fotoğraf sınırı: 10 fotoğraf → 8 + 2
const many = Array.from({ length: 10 }, (_, i) => `15.10.2026 08:${String(10 + i)} - Ali: IMG-${i}.jpg (dosya ekli)`).join("\n");
const pm = planDays(parseChat(many));
assert.deepEqual(pm.plan.map((x) => [x.id, x.photos, x.parts]), [["2026-10-15#1", 8, 2], ["2026-10-15#2", 2, 2]]);
// Eski anahtarlar silinir
const old = markDone({ a: "2026-01-01" }, [], "2026-10-15");
assert.equal(old.a, undefined);
// Başlangıç tarihi
assert.equal(planDays(m, { from: "2026-10-13" }).plan.length, 1);
console.log("wa parse ok");

// ZIP (stored + deflate)
function zip(files) {
  const locals = [], centrals = [];
  let off = 0;
  for (const [name, data, deflate] of files) {
    const raw = Buffer.from(data), comp = deflate ? zlib.deflateRawSync(raw) : raw, nb = Buffer.from(name);
    const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(deflate ? 8 : 0, 8); lh.writeUInt32LE(comp.length, 18); lh.writeUInt32LE(raw.length, 22); lh.writeUInt16LE(nb.length, 26);
    const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(deflate ? 8 : 0, 10); ch.writeUInt32LE(comp.length, 20); ch.writeUInt32LE(raw.length, 24); ch.writeUInt16LE(nb.length, 28); ch.writeUInt32LE(off, 42);
    locals.push(lh, nb, comp); centrals.push(ch, nb); off += 30 + nb.length + comp.length;
  }
  const cd = Buffer.concat(centrals), e = Buffer.alloc(22);
  e.writeUInt32LE(0x06054b50, 0); e.writeUInt16LE(files.length, 8); e.writeUInt16LE(files.length, 10); e.writeUInt32LE(cd.length, 12); e.writeUInt32LE(off, 16);
  const b = Buffer.concat([...locals, cd, e]);
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.length);
}
const z = zip([["WhatsApp Sohbeti - Saha.txt", android, true], ["IMG-20261012-WA0003.jpg", "\xff\xd8\xffJPEG", false]]);
assert.deepEqual(listZip(z).map((e) => e.name), ["WhatsApp Sohbeti - Saha.txt", "IMG-20261012-WA0003.jpg"]);
const chat = await openChatZip(z);
assert.equal(parseChat(chat.text).length, 6);
const f = await chat.file("IMG-20261012-WA0003.jpg");
assert.equal(f.type, "image/jpeg"); assert.equal(f.size, Buffer.from("\xff\xd8\xffJPEG").length);
assert.equal(await chat.file("yok.jpg"), null);
console.log("wa zip ok");
