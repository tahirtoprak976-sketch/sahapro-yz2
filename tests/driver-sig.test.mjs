import assert from "node:assert/strict";
import { encodeStrokes, decodeStrokes, msgBytes, MSG_LIMIT, driverMessage, extractPayloads, payloadsToPlan } from "../js/driver-core.js";
// Gerçekçi imza: 4 çizgi, her biri ~250 nokta (60 Hz parmak hareketi)
const strokes = [];
for (let s = 0; s < 4; s++) { const st = []; for (let i = 0; i < 250; i++) { const t = i / 250; st.push(Math.round(60 + s * 120 + 100 * t + 20 * Math.sin(t * 12 + s)), Math.round(110 + 60 * Math.sin(t * 9 + s * 2))); } strokes.push(st); }
const sv = encodeStrokes(strokes);
const back = decodeStrokes(sv);
assert.equal(back.length, 4);
for (let s = 0; s < 4; s++) { assert.ok(Math.abs(back[s][0] - strokes[s][0]) <= 1); assert.ok(Math.abs(back[s].at(-1) - strokes[s].at(-1)) <= 2, "son nokta korunur"); }
const cfg = { p: ["P1", "Olcay"], c: [["C1", "Öztedarik Arkası İnşaat"]], v: [["V1", "JCB"]], S: [], E: [] };
const e = { id: "e1", date: "2026-10-16", vid: "V1", cid: "C1", t: "Makine Çalışması", q: 2, u: "Saat", mat: "Çöp yüklendi", dfs: "O9A-0001", rcv: "Ahmet mehmet", sgt: "2026-10-16T09:30:00Z", sv };
const text = await driverMessage([e], cfg);
console.log("imzalı mesaj:", msgBytes(text), "bayt");
assert.ok(msgBytes(text) < MSG_LIMIT, "imzalı tek kayıt sınırın altında");
const [p] = await extractPayloads(text);
const pl = payloadsToPlan([p], { customers: [{ id: "C1", name: "Ö", created_at: "x" }], vehicles: [{ id: "V1", name: "JCB", created_at: "x" }], personnel: [{ id: "P1", name: "Olcay", created_at: "x" }] });
assert.deepEqual(pl.meta[0].digital.sigStrokes, sv);
// Kesilmiş kod açılmaz
assert.equal((await extractPayloads(text.slice(0, text.length - 40))).length, 0);
console.log("driver-sig ok");
