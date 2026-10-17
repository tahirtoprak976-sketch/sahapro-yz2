// Telefonda çalışan ücretsiz model (WebLLM + WebGPU). Model bir kez indirilir, tarayıcıda saklanır;
// sonrasında internetsiz çalışır. Veri telefondan çıkmaz. Kütüphane yalnız bu ekran açılınca yüklenir.
const WEBLLM_URL = "https://cdn.jsdelivr.net/npm/@mlc-ai/web-llm@0.2.79/+esm";
// Tercih sırası: Türkçe metinde daha iyi olan küçük modeller önce. Listede olmayan atlanır.
export const PREFERRED = [
  "Qwen2.5-1.5B-Instruct-q4f16_1-MLC",
  "Qwen2.5-1.5B-Instruct-q4f32_1-MLC",
  "gemma-2-2b-it-q4f16_1-MLC",
  "Llama-3.2-1B-Instruct-q4f16_1-MLC",
  "Llama-3.2-1B-Instruct-q4f32_1-MLC",
  "Qwen2.5-0.5B-Instruct-q4f16_1-MLC",
];
let libP = null,
  engine = null,
  loadedId = null;

export async function gpuStatus() {
  if (!globalThis.navigator?.gpu)
    return { ok: false, reason: "Bu tarayıcıda WebGPU yok (Android'de güncel Chrome gerekir)" };
  try {
    const a = await navigator.gpu.requestAdapter();
    if (!a) return { ok: false, reason: "Ekran kartına erişilemedi" };
    return { ok: true, f16: a.features.has("shader-f16") };
  } catch (e) {
    return { ok: false, reason: e.message || String(e) };
  }
}
function lib() {
  libP ||= import(/* @vite-ignore */ WEBLLM_URL).catch((e) => {
    libP = null;
    throw new Error("Yapay zeka kütüphanesi indirilemedi (ilk seferde internet gerekir): " + (e.message || e));
  });
  return libP;
}
export async function availableModels(f16 = true) {
  const w = await lib();
  const list = (w.prebuiltAppConfig?.model_list || []).map((m) => ({
    id: m.model_id,
    vram: m.vram_required_MB || null,
  }));
  const pref = PREFERRED.filter((id) => list.some((m) => m.id === id)).filter(
    (id) => f16 || !/q4f16/.test(id),
  );
  return pref.map((id) => list.find((m) => m.id === id));
}
export async function isCached(id) {
  try {
    const w = await lib();
    return w.hasModelInCache ? !!(await w.hasModelInCache(id)) : false;
  } catch {
    return false;
  }
}
export async function load(id, onProgress) {
  if (engine && loadedId === id) return engine;
  const w = await lib();
  if (engine) {
    try {
      await engine.unload();
    } catch {}
  }
  engine = await w.CreateMLCEngine(id, {
    initProgressCallback: (r) => onProgress?.(r.progress ?? 0, r.text || ""),
  });
  loadedId = id;
  return engine;
}
export const loaded = () => loadedId;
export async function generate(messages) {
  if (!engine) throw new Error("Model yüklü değil");
  const r = await engine.chat.completions.create({
    messages,
    temperature: 0,
    max_tokens: 160,
  });
  return r.choices?.[0]?.message?.content || "";
}
export async function remove(id) {
  const w = await lib();
  if (engine && loadedId === id) {
    try {
      await engine.unload();
    } catch {}
    engine = null;
    loadedId = null;
  }
  if (w.deleteModelAllInfoInCache) await w.deleteModelAllInfoInCache(id);
}
