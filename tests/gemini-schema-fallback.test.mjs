import assert from "node:assert/strict";
import { geminiJson } from "../js/ai-gemini.js";
let calls = [];
const fetchFn = async (url, opts) => {
  const b = JSON.parse(opts.body); calls.push(!!b.generationConfig.responseJsonSchema);
  if (b.generationConfig.responseJsonSchema) return { ok: false, status: 400, json: async () => ({ error: { message: "Request contains an invalid argument." } }) };
  return { ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: '{"works":[]}' }] }, finishReason: "STOP" }] }) };
};
const out = await geminiJson([{ text: "x" }], { key: "K", model: "m", fetchFn, schema: { type: "object", properties: { works: { type: "array" } } } });
assert.deepEqual(out, { works: [] });
assert.deepEqual(calls, [true, false]);
// Anahtar hatası şablonsuz denemeye düşmez, doğrudan söylenir
calls = [];
const bad = async (url, opts) => ({ ok: false, status: 400, json: async () => ({ error: { message: "API key not valid. Please pass a valid API key." } }) });
await assert.rejects(geminiJson([{ text: "x" }], { key: "K", model: "m", fetchFn: bad, schema: { type: "object" } }), /API key not valid/);
console.log("gemini schema fallback ok");
