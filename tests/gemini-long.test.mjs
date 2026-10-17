import assert from "node:assert/strict";
import { geminiJson, SHORTER_HINT } from "../js/ai-gemini.js";
const ok = (obj, finish = "STOP") => ({ ok: true, status: 200, json: async () => ({ candidates: [{ finishReason: finish, content: { parts: [{ text: typeof obj === "string" ? obj : JSON.stringify(obj) }] } }] }) });
// 1) yarıda kesilen yanıt → kısa yaz uyarısı + daha geniş sınırla ikinci deneme
let sent = [];
let r = await geminiJson([{ text: "x" }], { key: "k", model: "m", fetchFn: async (u, o) => { const b = JSON.parse(o.body); sent.push(b); return sent.length === 1 ? ok('{"works":[{"date":"2026-10-13","quantity":', "MAX_TOKENS") : ok({ works: [] }); } });
assert.deepEqual(r, { works: [] });
assert.equal(sent.length, 2);
assert.equal(sent[0].generationConfig.maxOutputTokens, 16384);
assert.equal(sent[1].generationConfig.maxOutputTokens, 32768);
assert.equal(sent[1].contents[0].parts.at(-1).text, SHORTER_HINT);
// 2) eski model 8192'den büyük sınırı reddederse 8192 ile tekrar
sent = [];
r = await geminiJson([{ text: "x" }], { key: "k", model: "m", fetchFn: async (u, o) => { const b = JSON.parse(o.body); sent.push(b);
  if (b.generationConfig.maxOutputTokens > 8192) return { ok: false, status: 400, json: async () => ({ error: { message: "max_output_tokens must be <= 8192" } }) };
  return ok({ a: 1 }); } });
assert.deepEqual(r, { a: 1 }); assert.equal(sent.at(-1).generationConfig.maxOutputTokens, 8192);
// 3) iki kez de kesilirse anlaşılır hata
await assert.rejects(geminiJson([{ text: "x" }], { key: "k", model: "m", fetchFn: async () => ok('{"works":[', "MAX_TOKENS") }), /ikiye bölüp/);
// 4) güvenlik filtresi
await assert.rejects(geminiJson([{ text: "x" }], { key: "k", model: "m", fetchFn: async () => ok("", "SAFETY") }), /güvenlik/);
// 5) şablon desteklenmezse şablonsuz
sent = [];
r = await geminiJson([{ text: "x" }], { key: "k", model: "m", schema: { type: "object" }, fetchFn: async (u, o) => { const b = JSON.parse(o.body); sent.push(b);
  if (b.generationConfig.responseJsonSchema) return { ok: false, status: 400, json: async () => ({ error: { message: "Invalid JSON payload: responseJsonSchema" } }) };
  return ok({ b: 2 }); } });
assert.deepEqual(r, { b: 2 });
console.log("gemini-long PASS");
