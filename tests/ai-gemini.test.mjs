import assert from 'node:assert/strict';
import { listModels, geminiChat, geminiReadReceipt } from '../js/ai-gemini.js';
const calls = [];
const mk = (payload, status = 200) => async (url, init) => { calls.push({ url, init }); return { ok: status < 400, status, json: async () => payload }; };
// model listesi: flash önce, gömme/tts modelleri hariç
const models = await listModels('K', mk({ models: [
  { name: 'models/gemini-2.5-pro', supportedGenerationMethods: ['generateContent'] },
  { name: 'models/gemini-2.5-flash', supportedGenerationMethods: ['generateContent'] },
  { name: 'models/text-embedding-004', supportedGenerationMethods: ['embedContent'] },
  { name: 'models/gemini-2.5-flash-preview-tts', supportedGenerationMethods: ['generateContent'] },
] }));
assert.deepEqual(models.map((m) => m.id), ['gemini-2.5-flash', 'gemini-2.5-pro']);
assert.equal(calls[0].init.headers['x-goog-api-key'], 'K');
assert.ok(!calls[0].url.includes('key='), 'anahtar adrese yazılmamalı');
// sohbet: system → systemInstruction, assistant → model
await geminiChat([{ role: 'system', content: 'S' }, { role: 'user', content: 'U' }, { role: 'assistant', content: 'A' }], { key: 'K', model: 'gemini-2.5-flash', fetchFn: mk({ candidates: [{ content: { parts: [{ text: '{}' }] } }] }) });
const body = JSON.parse(calls.at(-1).init.body);
assert.equal(body.systemInstruction.parts[0].text, 'S'); assert.deepEqual(body.contents.map((c) => c.role), ['user', 'model']);
assert.equal(body.generationConfig.temperature, 0);
// fiş: doğrulama uygulanır (metinde olmayan toplam atılır)
const r = await geminiReadReceipt(new Blob([new Uint8Array([1, 2, 3])], { type: 'image/jpeg' }), { key: 'K', model: 'gemini-2.5-flash', fetchFn: mk({ candidates: [{ content: { parts: [{ text: '```json\n{"text":"TOPLAM 4.500,00\\n14.10.2026","total":4500,"date":"2026-10-14","kdv":750}\n```' }] } }] }) });
assert.equal(r.fields.total, 4500); assert.equal(r.fields.date, '2026-10-14'); assert.equal(r.fields.kdv, undefined);
const b2 = JSON.parse(calls.at(-1).init.body);
assert.equal(b2.contents[0].parts[0].inlineData.data, 'AQID');
// hata mesajları anlaşılır
await assert.rejects(() => listModels('K', mk({ error: { message: 'API key not valid' } }, 400)), /anahtarı/);
await assert.rejects(() => listModels('K', mk({ error: { message: 'quota' } }, 429)), /kotası/);
console.log('ai-gemini PASS');
// kota 0 = model ücretsiz katmanda kapalı; çalışan modeli bul
const { findWorkingModel } = await import('../js/ai-gemini.js');
const seq = async (url) => /omni/.test(url)
  ? { ok: false, status: 429, json: async () => ({ error: { message: 'Quota exceeded for metric: x, limit: 0, model: gemini-omni-flash' } }) }
  : { ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: '{}' }] } }] }) };
const fw = await findWorkingModel('K', [{ id: 'gemini-omni-flash' }, { id: 'gemini-2.5-flash' }], seq);
assert.equal(fw.id, 'gemini-2.5-flash'); assert.equal(fw.tried[0].reason, 'ücretsiz kota yok');
await assert.rejects(() => geminiChat([{ role: 'user', content: 'x' }], { key: 'K', model: 'gemini-omni-flash', fetchFn: seq }), /ücretsiz kullanımda kapalı/);
// sıralama: önizleme/omni sona
const m2 = await listModels('K', async () => ({ ok: true, status: 200, json: async () => ({ models: ['gemini-omni-flash', 'gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-3-flash-preview'].map((n) => ({ name: 'models/' + n, supportedGenerationMethods: ['generateContent'] })) }) }));
assert.deepEqual(m2.map((m) => m.id), ['gemini-2.5-flash-lite', 'gemini-2.5-flash', 'gemini-omni-flash', 'gemini-3-flash-preview']);
console.log('ai-gemini-fallback PASS');
// otomatik model değiştirme + sayaç
{
  const { withModelFallback, usageToday } = await import('../js/ai-gemini.js');
  const meta = new Map([['gemini_key', 'K'], ['gemini_model', 'gemini-omni-flash'], ['gemini_consent', true], ['gemini_model_list', ['gemini-omni-flash', 'gemini-old-flash', 'gemini-3.8-flash']]]);
  const db = { metaGet: async (k) => meta.get(k), metaSet: async (k, v) => meta.set(k, v) };
  const fake = async (url) => /omni/.test(url)
    ? { ok: false, status: 429, json: async () => ({ error: { message: 'limit: 0' } }) }
    : /old/.test(url) ? { ok: false, status: 404, json: async () => ({ error: { message: 'models/gemini-old-flash is not found' } }) }
    : { ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: '{"ok":1}' }] } }] }) };
  const { geminiJson } = await import('../js/ai-gemini.js');
  let switched = null;
  const out = await withModelFallback(db, (o) => geminiJson([{ text: 'x' }], { ...o, fetchFn: fake }), { onSwitch: (a, b) => (switched = [a, b]) });
  assert.deepEqual(out, { ok: 1 }); assert.equal(meta.get('gemini_model'), 'gemini-3.8-flash'); assert.deepEqual(switched, ['gemini-omni-flash', 'gemini-3.8-flash']);
  assert.equal((await usageToday(db))['gemini-3.8-flash'], 1);
  // anahtar hatası model değiştirmez
  meta.set('gemini_model', 'gemini-3.8-flash');
  const badKey = async () => ({ ok: false, status: 400, json: async () => ({ error: { message: 'API key not valid' } }) });
  await assert.rejects(() => withModelFallback(db, (o) => geminiJson([{ text: 'x' }], { ...o, fetchFn: badKey })), /anahtar/);
  assert.equal(meta.get('gemini_model'), 'gemini-3.8-flash');
}
console.log('ai-gemini-autoswitch PASS');
// şablon reddedilirse şablonsuz tekrar
{
  const { geminiJson } = await import('../js/ai-gemini.js');
  const seen = [];
  const f = async (url, init) => { const b = JSON.parse(init.body); seen.push(!!b.generationConfig.responseJsonSchema);
    return b.generationConfig.responseJsonSchema ? { ok: false, status: 400, json: async () => ({ error: { message: 'Invalid JSON payload: unknown field responseJsonSchema' } }) }
      : { ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: '{"a":1}' }] } }] }) }; };
  assert.deepEqual(await geminiJson([{ text: 'x' }], { key: 'K', model: 'm', fetchFn: f, schema: { type: 'object' } }), { a: 1 });
  assert.deepEqual(seen, [true, false]);
}
console.log('ai-gemini-schema PASS');
