// Asistan ekranı: mesaj yaz/yapıştır + fiş fotoğrafı ekle → Gemini işletmeni tanıyarak işleri,
// giderleri, yakıtı çıkarır → doğrulanmış kartlar → tek dokunuşla kaydet. Yeni müşteri/şantiye,
// fişin fotoğrafı ve kaynak mesaj kayda birlikte yazılır. Doğrulamadan geçmeyen satır işaretsiz gelir.
import { qs, qsa, esc, appbar, toast, notice, confirmDialog, fmtTL, todayStr, trDate } from "./ui.js";
import { WORK_TYPES, EXPENSE_CATEGORIES, MAINT_TYPES, MAINT_STATUS, PERSONNEL_EVENT_TYPES, isActive } from "./core.js";
import { documentOwner } from "./business.js";
import { validateTickets, validateDocuments, heardText, ASSIST_DOC_TYPES, NO_EXPIRY, mergeTicketsIntoWorks, plateKey, VEHICLE_KINDS, VEHICLE_INFO_LABELS, PERSON_INFO_LABELS, COMPANY_INFO_LABELS, vehicleUpdate } from "./assistant-docs.js";
import { occupationOnly } from "./assistant-core.js";
import { ACTIONS_PROMPT, actionsSchemaProps, actionsContext, validateActions, validateSettings, validateOpen } from "./assistant-actions.js";
import { planTotals, applyFuelPay } from "./assistant-rules.js";
import { assistantContext, assistantSystem, validatePlan, validateExtras, validateCards, validateMemory, businessFacts, checkAnswer, ASSIST_UNITS, assistantSchema, pickExamples, addExample, measureCorrection, addQuality } from "./assistant-core.js";

const opt = (list, val, empty = "— seçin —") =>
  `<option value="">${esc(empty)}</option>` +
  list.map(([v, t]) => `<option value="${esc(v)}" ${v === val ? "selected" : ""}>${esc(t)}</option>`).join("");

export async function screen(ctx) {
  if (ctx.parts[0] !== "akilli-asistan") return false;
  if (ctx.parts[1] && (await (await import("./assistant-tools.js")).screen(ctx))) return true;
  const { root, db } = ctx;
  const { geminiSettings } = await import("./ai-gemini.js");
  const g = await geminiSettings(db);
  root.innerHTML =
    appbar("Akıllı Asistan", "Gemini · işletmenizi tanır") +
    `<div style="height:10px"></div>
    ${ctx.query?.wa ? `<div class="card" style="border-left:4px solid #25d366"><div class="small"><b>💬 WhatsApp toplu işleme</b> — ${esc(ctx.query.wa)}: grubun mesajları ve fotoğrafları aşağıya yüklendi. <b>Asistana Gönder</b>'e basın, kartları kontrol edip kaydedin.</div><div class="row" style="gap:6px;margin-top:6px"><button class="btn sm grow" data-go="#/whatsapp-toplu">← Listeye dön</button></div></div>` : ""}
    ${g.ready ? notice("info", "Mesajı yazın veya WhatsApp'tan yapıştırın, fiş fotoğraflarını ekleyin. Gemini müşteri, şantiye ve araç listenizi bilerek okur. Kaydetmeden önce kartları kontrol edin; şüpheli satırlar işaretsiz gelir.") : notice("warn", "Önce Ayarlar → Yapay Zeka'da Gemini anahtarını kaydedin.") + '<button class="btn block" data-go="#/yapay-zeka">Yapay Zeka Ayarları</button>'}
    <div class="row" style="gap:6px;margin-bottom:8px"><button class="btn grow" data-go="#/akilli-asistan/ozet">📝 Gün Sonu Özeti</button><button class="btn grow" data-go="#/akilli-asistan/soru">❓ Soru Sor</button></div>
    <button class="btn block" style="margin-bottom:8px" data-go="#/akilli-asistan/danisman">🎓 Yönetim Danışmanı — araç / müşteri karnesi ve öneriler</button>
    <button class="btn block" style="margin-bottom:8px" data-go="#/teklif-hesap">🧮 Teklif Asistanı — kaça vermeliyim?</button>
    ${ctx.query?.wa ? "" : '<button class="btn block" style="margin-bottom:8px" data-go="#/whatsapp-toplu">💬 WhatsApp Grubu — günün tüm mesajlarını toplu işle</button>'}
    <div class="card">
      <div class="field"><label>Mesaj</label><textarea data-msg rows="5" placeholder="Örn: Mahir bey 14 tonluk yarım yevmiye, 34 ABC 123 Kaya İnşaat 4 sefer moloz, lastikçiye 500 veresiye"></textarea></div>
      <div class="field"><label>Fiş / döküm fişi / belge fotoğrafı veya ses kaydı (isteğe bağlı)</label><input type="file" accept="image/*,audio/*" multiple data-photos></div>
      <button class="btn block" data-rec ${g.ready ? "" : "disabled"}>🎤 Sesli not kaydet</button>
      <div class="row" style="gap:6px;flex-wrap:wrap" data-thumbs></div>
      <label class="history-check small" data-refine-wrap hidden style="margin-top:6px"><input type="checkbox" data-refine checked> ↻ <b>Önceki sonucu düzelt</b> — yazdığın düzeltme ("müşteri Kaya olacak", "2 sefer", "fiş ikinci işin") öncekine uygulanır<div class="muted tiny" data-refine-prev></div></label>
      <button class="btn primary block" style="margin-top:10px" data-ask ${g.ready ? "" : "disabled"}>🤖 Asistana Gönder</button>
    </div>
    <div data-lastundo></div>
    <div data-out></div>`;
  {
    const last = await db.metaGet("assistant_undo");
    if (last && Date.now() - new Date(last.at).getTime() < 86400000) {
      const box = qs("[data-lastundo]", root);
      box.innerHTML = `<div class="card"><div class="row between"><span class="small">Son asistan kaydı: ${esc(new Date(last.at).toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" }))} · ${esc(last.label || "")}</span><button class="btn sm" data-undo>↩️ Geri al</button></div></div>`;
      bindUndo(ctx, box);
    }
  }
  let prev = null; // son sonuç (kaydedilmediyse düzeltme için)
  const photosIn = qs("[data-photos]", root), msgEl = qs("[data-msg]", root);
  let files = [];
  const isAudio = (f) => /^audio\//.test(f.type) || /\.(m4a|mp3|ogg|opus|wav|aac|webm|amr)$/i.test(f.name || "");
  const showThumbs = () => {
    const box = qs("[data-thumbs]", root);
    box.innerHTML = files
      .map((f, i) => isAudio(f)
        ? `<div class="card" style="margin:0;padding:6px;width:100%"><div class="small">🎤 Ses kaydı ${esc(f.name || "")} <button class="btn small" data-rm="${i}">Sil</button></div><audio controls src="${URL.createObjectURL(f)}" style="width:100%"></audio></div>`
        : `<img src="${URL.createObjectURL(f)}" alt="Fiş ${i + 1}" style="width:64px;height:64px;object-fit:cover;border-radius:8px;border:1px solid var(--border)">`)
      .join("");
    for (const b of qsa("[data-rm]", box)) b.addEventListener("click", () => { files.splice(Number(b.dataset.rm), 1); showThumbs(); });
  };
  photosIn.addEventListener("change", () => {
    files = [...files.filter((f) => f._rec), ...photosIn.files].slice(0, 10);
    showThumbs();
  });
  // Sesli not: telefonun mikrofonu ile kayıt (en çok 3 dakika)
  let rec = null, recT = null, autoSend = false;
  qs("[data-rec]", root).addEventListener("click", async (ev) => {
    const b = ev.currentTarget;
    if (rec) return rec.stop();
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") return toast("Bu tarayıcı ses kaydını desteklemiyor; WhatsApp sesli mesajını dosya olarak ekleyin", "err");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const type = ["audio/webm;codecs=opus", "audio/ogg;codecs=opus", "audio/mp4", "audio/webm"].find((t) => MediaRecorder.isTypeSupported?.(t)) || "";
      rec = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
      const chunks = [];
      rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      rec.onstop = () => {
        clearTimeout(recT);
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunks, { type: (rec.mimeType || type || "audio/webm").split(";")[0] });
        rec = null;
        b.textContent = "🎤 Sesli not kaydet";
        if (blob.size < 500) return toast("Kayıt boş", "err");
        const f = new File([blob], "sesli-not-" + new Date().toTimeString().slice(0, 5).replace(":", "") + "." + (blob.type.split("/")[1] || "webm"), { type: blob.type });
        f._rec = true;
        files = [...files, f].slice(0, 10);
        showThumbs();
        if (autoSend) { autoSend = false; qs("[data-ask]", root).click(); }
      };
      rec.start();
      b.textContent = "⏹ Kaydı bitir";
      recT = setTimeout(() => rec?.stop(), 180000);
    } catch (e) {
      rec = null;
      toast("Mikrofon izni verilmedi", "err");
    }
  });
  // WhatsApp'tan "Paylaş" ile gelen metin / fotoğraflar
  if (ctx.query?.shared && "caches" in self) {
    try {
      const cache = await caches.open("yz2-share");
      const t = await cache.match("./__share/text");
      if (t) msgEl.value = await t.text();
      for (let i = 0; i < 10; i++) {
        const r = await cache.match(`./__share/file-${i}`);
        if (!r) break;
        const b = await r.blob();
        files.push(new File([b], decodeURIComponent(r.headers.get("x-name") || "foto.jpg"), { type: b.type || r.headers.get("content-type") || "image/jpeg" }));
      }
      await caches.delete("yz2-share");
      showThumbs();
      if (msgEl.value || files.length) toast("Paylaşılan içerik alındı", "ok");
    } catch (e) {}
  }
  // Yarım kalan mesaj saklanır (internet yoksa veya ekran kapanırsa kaybolmaz)
  if (!msgEl.value) msgEl.value = (await db.metaGet("assistant_draft")) || "";
  let draftT = null;
  msgEl.addEventListener("input", () => {
    clearTimeout(draftT);
    draftT = setTimeout(() => db.metaSet("assistant_draft", msgEl.value), 500);
  });
  qs("[data-ask]", root).addEventListener("click", async () => {
    const typed = qs("[data-msg]", root).value.trim();
    // Düzeltme: önceki sonuç kaydedilmediyse ve kullanıcı yeni bir şey yazdıysa, önceki mesaj + düzeltme birlikte gider
    const refine = prev && !prev.v._done && qs("[data-refine]", root).checked && typed && typed !== prev.message ? prev : null;
    if (prev && !prev.v._done && !refine && !typed) return toast("Düzeltme yazın ya da yeni mesaj girin", "err");
    const message = refine ? `${refine.message}\n[DÜZELTME] ${typed}` : typed;
    if (!message && !files.length) return toast("Mesaj yazın, fotoğraf veya ses ekleyin", "err");
    if (rec) return toast("Önce ses kaydını bitirin", "err");
    const images = files.filter((f) => !isAudio(f)), audios = files.filter(isAudio);
    await db.metaSet("assistant_draft", message);
    if (!navigator.onLine) return toast("İnternet yok. Mesaj saklandı; internet gelince tekrar Gönder'e basın.", "err");
    const out = qs("[data-out]", root), btn = qs("[data-ask]", root);
    btn.disabled = true;
    out.innerHTML = '<div class="muted small" style="padding:10px">Gemini okuyor…</div>';
    try {
      const { geminiJson, blobToBase64, shrink, audioToWav } = await import("./ai-gemini.js");
      // Mesaj kendi depodan söz ediyor ama depo henüz kurulmadıysa: kendiliğinden kurulur (iç müşteri + depo sahası)
      {
        const yc0 = await import("./yard-core.js");
        const d0 = await db.dumpAll();
        if (yc0.mentionsYard(message) && (!yc0.yardSite(d0) || !yc0.yardCustomer(d0))) {
          if (!yc0.yardSite(d0)) await db.saveNew("dump_sites", { name: yc0.YARD_SITE_NAME, own_yard: true, note: "Kendi depo / stok sahası (asistan kurdu)" }, "Kendi depo kuruldu");
          if (!yc0.yardCustomer(d0)) await db.saveNew("customers", { name: yc0.YARD_CUSTOMER_NAME, internal: true, note: "Depodan döküm sahalarına giden iç seferler. Hakedişe para yazılmaz." }, "Kendi depo kuruldu");
          toast("Kendi depo kuruldu (Ayarlar → Kendi depo)", "ok");
        }
      }
      const d = await db.dumpAll();
      const today = todayStr();
      // Şoför ekranından gelen kayıtlar (SP1 kodu): Gemini'siz, birebir; fotoğraflar sırayla o işlere. Kalan serbest metin Gemini'ye gider.
      const drv = await import("./driver-core.js");
      const drvAll = await drv.extractPayloads(message);
      // Güvenlik: imza / iptal / süre / kişi denetimi — reddedilen şoför kodu işlenmez (Gemini'ye de gitmez)
      const drvSec = drvAll.length ? await (await import("./security.js")).checkPayloads(drvAll, d) : [];
      const drvPayloads = drvSec.filter((x) => !x.reject).map((x) => x.p);
      const drvRejected = drvSec.filter((x) => x.reject), drvSecWarn = drvSec.filter((x) => x.warn);
      const drvRest = drvAll.length ? drv.stripDriverBlocks(message) : message;
      if (drvAll.length && !drvPayloads.length && drvRest.replace(/[^\p{L}\d]/gu, "").length <= 8 && !audios.length)
        throw new Error("Şoför mesajı işlenmedi: " + drvRejected.map((x) => `${x.p.n || "şoför"} — ${x.reject}`).join(" · ") + ". Güvenlik ekranından bağlantıyı kontrol edin; gerekiyorsa şoföre yeni bağlantı gönderin.");
      // Kod var ama açılmıyor: mesaj WhatsApp'ta / kopyalarken kesilmiş. Yazıdan okunursa dijital fiş ve imza kaybolur.
      if (!drvAll.length && /SP1:[A-Za-z0-9_-]{8,}/.test(message) && !(await confirmDialog("Şoför kodu eksik", "Bu şoför mesajının kodu kesilmiş (mesaj çok uzunmuş ya da eksik kopyalanmış). Şoförden SAHAPRO'da \"Gönderilenler → Son gönderileni tekrar gönder\" yapmasını isteyin; yeni sürümde mesaj kısa gider. Yine de yalnız yazıdan okunsun mu? (dijital fiş ve imza gelmez)", "Yazıdan oku"))) throw new Error("Şoför kodu eksik — şoförden kaydı tekrar göndermesini isteyin");
      const useGemini = !drvAll.length || drvRest.replace(/[^\p{L}\d]/gu, "").length > 8 || audios.length > 0;
      const facts = await businessFacts(d, today);
      const negatives = (await db.metaGet("ai_negative_aliases")) || [];
      const examples = pickExamples((await db.metaGet("ai_examples")) || [], message, 3);
      const parts = [
        { text: "İşletme kartları (JSON):\n" + JSON.stringify({ ...assistantContext(d, today, message), ...actionsContext(d, message) }) },
        { text: "facts (yerelde hesaplanmış güncel rakamlar; sorulara yalnız bunlarla cevap ver):\n" + JSON.stringify(facts) },
        ...(negatives.length ? [{ text: "not_aliases:\n" + JSON.stringify(negatives.slice(0, 50).map((x) => [x.alias, x.target_type, x.target_id])) }] : []),
        ...(examples.length ? [{ text: "examples (onaylı):\n" + examples.map((e) => `<mesaj>${e.msg}</mesaj> → ${e.out}`).join("\n") }] : []),
      ];
      const imgParts = [];
      for (const f of images) {
        const img = await shrink(f);
        const part = { inlineData: { mimeType: img.type || "image/jpeg", data: await blobToBase64(img) } };
        imgParts.push(part);
        if (!drvPayloads.length) parts.push(part);
      }
      for (const f of audios) {
        const a = await audioToWav(f);
        if (a.size > 15e6) throw new Error("Ses kaydı çok uzun; 3 dakikadan kısa kaydedin");
        parts.push({ inlineData: { mimeType: (a.type || "audio/ogg").split(";")[0], data: await blobToBase64(a) } });
      }
      if (refine) parts.push({ text: "ÖNCEKİ TASLAK (kullanıcı aşağıdaki mesajın sonunda [DÜZELTME] ile düzeltme yazdı). Düzeltmeyi uygula, düzeltilmeyen satırları AYNEN koru ve TAM planı yeniden döndür:\n" + JSON.stringify(refine.plan).slice(0, 20000) });
      parts.push({ text: `Fotoğraf sayısı: ${drvPayloads.length ? 0 : images.length} (sıra 0'dan başlar)${audios.length ? `\nSes kaydı: ${audios.length} (fotoğraflardan sonra gelir; heard_text'e yaz)` : ""}\n<mesaj>\n${(drvRest || (audios.length ? "(mesaj yok, sesli not)" : "(mesaj yok, yalnız fotoğraflar)")).replace(/<\/?mesaj>/gi, "")}\n</mesaj>` });
      const t0 = Date.now();
      const { withModelFallback } = await import("./ai-gemini.js");
      const { effectiveRules } = await import("./assistant-rules.js");
      const system = assistantSystem(effectiveRules(await db.metaGet("assistant_rules"))) + "\n" + ACTIONS_PROMPT;
      const baseSchema = assistantSchema();
      const schema = { ...baseSchema, properties: { ...baseSchema.properties, ...actionsSchemaProps() } };
      // Soru da varsa: hesap araçlarıyla cevap paralel istenir (rakamlar telefonda hesaplanır)
      const tools = await import("./assistant-tools.js");
      const askP = message && tools.isQuestion(message) ? tools.askWithTools(db, message).catch(() => null) : Promise.resolve(null);
      let plan = useGemini ? await withModelFallback(db, (o) => geminiJson(parts, { ...o, system, schema }), {
        onSwitch: (a, b) => toast(`Gemini modeli değişti: ${a} → ${b} (ücretsiz kota için)`, "ok"),
      }) : {};
      const drvPlan = drvPayloads.length ? drv.payloadsToPlan(drvPayloads, d, { photoCount: images.length }) : null;
      if (drvPlan) plan = { ...plan, works: [...drvPlan.plan.works, ...(plan.works || [])], fuel: [...drvPlan.plan.fuel, ...(plan.fuel || [])], expenses: [...drvPlan.plan.expenses, ...(plan.expenses || [])], maintenance: [...drvPlan.plan.maintenance, ...(plan.maintenance || [])] };
      const asked = await askP;
      // Sesli notta Gemini'nin duyduğu metin mesaj yerine geçer; kullanıcıya gösterilir, sayılar onunla doğrulanır
      const heard = audios.length ? heardText(plan) : "";
      const vmsg = [message, heard].filter(Boolean).join("\n");
      const v = validatePlan(plan, { message: vmsg, d, today, photoCount: images.length, negatives });
      if (drvRejected.length) v.driverReject = drvRejected.map((x) => `${x.p.n || "Şoför"}: ${x.reject}`);
      if (drvSecWarn.length) v.driverSecWarn = [...new Set(drvSecWarn.map((x) => `${x.p.n || "Şoför"}: ${x.warn}`))];
      Object.assign(v, validateExtras(plan, { message: vmsg, d, today, photoTexts: v.photoTexts }));
      if (drvPlan) {
        const seen = drv.seenDriverIds(d);
        const tag = (row, m) => {
          if (!row) return;
          row.driver_entry_id = m.driver_entry_id;
          if (m.photos) row.photos = m.photos;
          if (m.tonnage && !row.tonnage) row.tonnage = m.tonnage;
          if (m.digital) row.digital = m.digital;
          if (seen.has(m.driver_entry_id)) { row.issues.push("Bu şoför kaydı daha önce alındı — atlandı"); row.ok = false; row.driverDup = true; }
        };
        drvPlan.meta.forEach((m, i) => tag(v.works[i], m));
        drvPlan.fuelMeta.forEach((m, i) => tag(v.fuel[i], m));
        drvPlan.expMeta.forEach((m, i) => { tag(v.expenses[i], m); if (v.expenses[i]) Object.assign(v.expenses[i], { driver_pay: m.pay, driver_pid: m.personnel_id }); });
        drvPlan.mainMeta.forEach((m, i) => { tag((v.maintenance || [])[i], m); if (v.maintenance?.[i]) Object.assign(v.maintenance[i], { driver_pay: m.pay, driver_pid: m.personnel_id, km: m.km, machine_hours: m.hours }); });
        // Şoför fotoğraf gönderdi ama buraya eklenmedi (kopyala-yapıştırda yalnız yazı gelir)
        const expected = drvPayloads.reduce((n, p) => n + p.e.reduce((k, e) => k + (Number(e.ph) || 0) + (e.sg ? 1 : 0), 0), 0);
        if (expected > images.length) v.driverPhotoWarn = `Şoför ${expected} fotoğraf gönderdi (fiş / irsaliye / arıza), ${images.length ? `buraya yalnız ${images.length} tanesi eklendi.` : "buraya hiç eklenmedi."} Aşağıdan fotoğrafı galeriden seçin (WhatsApp'tan gelen fotoğraflar galeride "WhatsApp Images" klasöründedir); kartlar fotoğrafla yeniden hazırlanır. Fotoğrafsız da kaydedebilirsiniz.`;
        if (expected > images.length) v.driverPhotoNeed = expected;
        v.driverNote = `${drvPayloads.map((p) => p.n).join(", ")}: şoför ekranından ${[[drvPlan.meta.length, "iş"], [drvPlan.fuelMeta.length, "yakıt"], [drvPlan.expMeta.length, "gider"], [drvPlan.mainMeta.length, "arıza/bakım"]].filter(([n]) => n).map(([n, t]) => n + " " + t).join(", ")} (Gemini'siz, birebir)`;
      }
      v.cards = validateCards(plan, { message: vmsg, d, photoTexts: v.photoTexts });
      v.memory = validateMemory(plan, { message: vmsg, d });
      v.prices = (await import("./price-rule-core.js")).validatePriceRules(plan, { message: vmsg, d });
      v.actions = validateActions(plan, { message: vmsg, d });
      v.settings = validateSettings(plan, { message: vmsg, d, today });
      v.open = validateOpen(plan, { d });
      v.tickets = validateTickets(plan, { d, today, photoTexts: v.photoTexts, photoCount: images.length });
      v.docs = validateDocuments(plan, { d, today, photoTexts: v.photoTexts, photoCount: images.length, company: await db.metaGet("company_profile") });
      // İş ve fişi tek kartta: aynı işin fişi ayrı "döküm fişi" kartı olmaz, işin içine girer
      mergeTicketsIntoWorks(v, { photoCount: images.length, d, message: vmsg });
      // İşe eklenen fişin numarası / tonu okunamadıysa: fiş okuyucuyla (iş formundaki "Gemini ile fişi oku") ikinci kez okunur
      try { await rereadSlips(db, v, imgParts, d, today); } catch (e) { /* ikinci okuma başarısızsa ilk sonuç kalır */ }
      for (const w of [...v.works, ...v.fuel, ...v.expenses, ...(v.maintenance || [])]) if (w.driverDup) w.ok = false;
      v.heard = heard;
      v.audioMissing = audios.length > 0 && !heard;
      v.answer = typeof plan.answer === "string" && plan.answer.trim() ? plan.answer.trim().slice(0, 1500) : null;
      v.answerBad = checkAnswer(v.answer, facts);
      v.asked = asked && asked.answer ? asked : null;
      if (v.asked) v.askedHtml = tools.answerHtml(v.asked);
      prev = { message, plan, v };
      const rw = qs("[data-refine-wrap]", root);
      rw.hidden = false;
      qs("[data-refine]", root).checked = true;
      msgEl.value = "";
      msgEl.placeholder = "Düzeltme yazın (ör. müşteri Kaya olacak) — yeni bir mesaj için alttaki kutucuğu kaldırın";
      qs("[data-refine-prev]", root).textContent = typed ? `Önceki mesaj: "${typed.slice(0, 120)}${typed.length > 120 ? "…" : ""}"` : "";
      render(ctx, out, v, d, { message: vmsg, files: images, ms: Date.now() - t0 });
    } catch (e) {
      out.innerHTML = notice("warn", e.message || String(e));
    }
    btn.disabled = false;
  });
  // Her ekrandaki 🎤 düğmesi: kayıt hemen başlar, bitince kendiliğinden asistana gider
  if (ctx.query?.mic) {
    autoSend = true;
    qs("[data-rec]", root).scrollIntoView({ block: "center" });
    qs("[data-rec]", root).click();
  }
  return true;
}

// Araç / müşteri toplamları (kesin = işaretli satırlar) ve teyit gerekenler
function summaryHtml(v, d) {
  if (v.works.length < 2) return "";
  const t = planTotals(v.works, d);
  const line = (x) => `<div class="small">• <b>${esc(x.name)}</b>: ${esc(x.sure || "—")}${x.unsure ? ` <span class="muted">(+ teyit bekleyen ${esc(x.unsure)})</span>` : ""}</div>`;
  const todo = v.works.map((r, i) => (r.ok ? null : `${i + 1}. iş: ${r.issues.filter((x) => !/zimmetli aracı/.test(x)).join(" · ") || "eksik alan"}`)).filter(Boolean);
  return `<div class="card"><div class="strong small">Toplamlar (kesin olanlar)</div>${t.vehicles.map(line).join("")}<div class="divider"></div>${t.customers.map(line).join("")}
    ${todo.length ? `<div class="strong small" style="margin-top:8px">Teyit gerekenler (${todo.length})</div>${todo.map((x) => `<div class="tiny muted">${esc(x)}</div>`).join("")}` : ""}</div>`;
}

function render(ctx, out, v, d, { message, files, ms }) {
  // Şoförün fotoğrafı eksikse: burada seçilir, mesaj fotoğraflarla yeniden işlenir (WhatsApp'a dönmeye gerek yok)
  setTimeout(() => {
    const dp = qs("[data-drvph]", out);
    if (!dp) return;
    dp.addEventListener("change", () => {
      if (!dp.files.length) return;
      const root = ctx.root, inp = qs("[data-photos]", root);
      try {
        const dt = new DataTransfer();
        for (const f of dp.files) dt.items.add(f);
        inp.files = dt.files;
        inp.dispatchEvent(new Event("change"));
      } catch { return toast("Fotoğraf eklenemedi; yukarıdaki fotoğraf kutusundan seçip tekrar gönderin", "err"); }
      const m = qs("[data-msg]", root);
      if (!m.value.trim()) m.value = message;
      const rf = qs("[data-refine]", root);
      if (rf) rf.checked = false;
      root.scrollTo?.(0, 0);
      qs("[data-ask]", root).click();
    });
  }, 0);
  const live = (s) => (d[s] || []).filter(isActive);
  const customers = live("customers").map((c) => [c.id, c.name]);
  const vehicles = live("vehicles").map((x) => [x.id, x.name]);
  const sites = live("sites");
  const suppliers = live("suppliers").map((s) => [s.id, s.name]);
  const issues = (r) => (r.issues.length ? `<div class="muted tiny" style="margin-top:4px">⚠ ${esc(r.issues.join(" · "))}</div>` : "");
  const total = v.works.length + v.expenses.length + v.fuel.length + v.collections.length + v.maintenance.length + v.personnel.length + v.edits.length + v.cards.length + v.memory.length + v.tickets.length + v.docs.length + v.tankIn.length + (v.prices || []).length + (v.actions || []).length + (v.settings || []).length;
  const KIND_TR = { customers: "Müşteri", sites: "Şantiye", vehicles: "Araç / makine", personnel: "Personel", suppliers: "Esnaf / tedarikçi", quarries: "Malzeme ocağı", dump_sites: "Döküm / dolgu sahası" };
  const quarries = live("quarries").map((x) => [x.id, x.name]);
  const personnel = live("personnel").map((p) => [p.id, p.name]);
  const dumpSites = live("dump_sites").map((x) => [x.id, x.name]);
  const banks = live("bank_accounts").map((b) => [b.id, b.name || b.bank_name || "Banka"]);
  const nameOf = (s, id) => (d[s] || []).find((x) => x.id === id)?.name || id || "—";
  out.innerHTML =
    `<div class="section-title">Asistanın bulduğu (${total}) · ${(ms / 1000).toFixed(1)} sn</div>` +
    summaryHtml(v, d) +
    (v.asked ? v.askedHtml : v.answer ? `<div class="card"><div class="strong small">🤖 Cevap</div><div style="white-space:pre-wrap;margin-top:6px">${esc(v.answer)}</div>${v.answerBad.length ? notice("warn", "Bu sayılar kayıtlarınızda bulunamadı, güvenmeyin: " + v.answerBad.join(", ")) : '<div class="muted tiny" style="margin-top:6px">Rakamlar telefondaki kayıtlarınızdan hesaplandı.</div>'}</div>` : "") +
    (v.driverNote ? notice("ok", "📋 " + v.driverNote) : "") +
    (v.driverReject ? notice("danger", "🚫 İŞLENMEDİ — " + v.driverReject.map(esc).join(" · ") + ". Güvenlik ekranından bağlantıyı kontrol edin.") : "") +
    (v.driverSecWarn ? notice("warn", "🛡 " + v.driverSecWarn.map(esc).join(" · ")) : "") +
    (v.driverPhotoWarn ? notice("warn", "📷 " + v.driverPhotoWarn) + `<label class="btn primary block" style="margin:-4px 0 10px;cursor:pointer">📷 Şoförün fotoğrafını ekle${v.driverPhotoNeed > 1 ? ` (${v.driverPhotoNeed} tane, gönderdiği sırayla)` : ""}<input type="file" accept="image/*" ${v.driverPhotoNeed > 1 ? "multiple" : ""} data-drvph hidden></label>` : "") +
    (v.heard ? `<div class="card"><div class="strong small">🎤 Gemini'nin duyduğu</div><div style="white-space:pre-wrap;margin-top:6px">${esc(v.heard)}</div><div class="muted tiny" style="margin-top:6px">Rakamlar bu metinle kontrol edildi. Yanlış duyduysa mesaj kutusuna düzeltip tekrar gönderin.</div></div>` : "") +
    (v.audioMissing ? notice("warn", "Ses kaydı anlaşılamadı. Daha yakından ve sessiz bir yerde tekrar kaydedin.") : "") +
    v.questions.map((q) => notice("info", "Soru: " + q)).join("") +
    v.memory
      .map((r, i) => `<div class="card" data-kind="memory" data-i="${i}">
        <label class="history-check"><input type="checkbox" data-pick ${r.ok ? "checked" : ""}> <b>🧠 Hafızaya ekle</b></label>
        <div class="small">"${esc(r.alias)}" dendiğinde → <b>${esc(r.target_name || "?")}</b></div>${issues(r)}</div>`)
      .join("") +
    (v.cards.length ? `<div class="section-title">Yeni kartlar (${v.cards.filter((c) => c.ok).length}/${v.cards.length})</div>` : "") +
    v.cards
      .map((r, i) => `<div class="card" data-kind="card" data-i="${i}">
        <label class="history-check"><input type="checkbox" data-pick ${r.ok ? "checked" : ""}> <b>${esc(KIND_TR[r.kind])}</b></label>
        <div class="formgrid2">
          <div class="field"><label>Ad</label><input name="name" value="${esc(r.name)}"></div>
          ${r.kind === "vehicles" ? `<div class="field"><label>Plaka</label><input name="plate" value="${esc(r.data.plate || "")}"></div><div class="field"><label>Tür</label><input name="type" value="${esc(r.data.type || "")}"></div>` : ""}
          ${["customers", "personnel", "suppliers"].includes(r.kind) ? `<div class="field"><label>Telefon</label><input name="phone" value="${esc(r.data.phone || "")}"></div>` : ""}
          ${r.kind === "sites" ? `<div class="field"><label>Müşteri</label><select name="customer">${opt([...customers, ...(r.data.customer_name ? [["new:" + r.data.customer_name, "➕ " + r.data.customer_name + " (listede yeni)"]] : [])], r.data.customer_id || (r.data.customer_name ? "new:" + r.data.customer_name : ""))}</select></div>` : ""}
        </div>${issues(r)}</div>`)
      .join("") +
    (v.newCustomers.length ? notice("warn", "Yeni müşteri kartı açılacak: " + v.newCustomers.join(", ")) : "") +
    v.works
      .map((r, i) => {
        const parentName = r.new_customer_parent_id ? nameOf("customers", r.new_customer_parent_id) : "";
        const custOpts = [...customers, ...(r.new_customer ? [["new:" + r.new_customer, "➕ Yeni: " + r.new_customer + (parentName ? ` (${parentName} taşeronu)` : "")]] : [])];
        const siteOpts = sites.filter((s) => !r.customer_id || s.customer_id === r.customer_id).map((s) => [s.id, s.name]);
        return `<div class="card" data-kind="work" data-i="${i}">
        <label class="history-check"><input type="checkbox" data-pick ${r.ok ? "checked" : ""}> <b>İş</b> ${r.guessed ? "· tahmin içeriyor" : ""}</label>
        <div class="formgrid2">
          <div class="field"><label>Tarih</label><input type="date" name="date" value="${esc(r.date)}"></div>
          <div class="field"><label>Müşteri</label><select name="customer">${opt(custOpts, r.customer_id || (r.new_customer ? "new:" + r.new_customer : ""))}</select></div>
          <div class="field"><label>Şantiye</label><select name="site">${opt([...siteOpts, ...(r.new_site ? [["new:" + r.new_site, "➕ Yeni: " + r.new_site]] : [])], r.site_id || (r.new_site ? "new:" + r.new_site : ""), "— yok —")}</select></div>
          <div class="field"><label>Araç</label><select name="vehicle">${opt(vehicles, r.vehicle_id)}</select></div>
          <div class="field"><label>İş türü</label><select name="work_type">${opt(WORK_TYPES.map((x) => [x, x]), r.work_type)}</select></div>
          <div class="field"><label>Miktar</label><input type="number" step="any" name="quantity" value="${r.quantity ?? ""}"></div>
          <div class="field"><label>Birim</label><select name="unit">${opt(ASSIST_UNITS.map((x) => [x, x]), r.unit)}</select></div>
          <div class="field"><label>Operatör / şoför</label><select name="personnel">${opt(personnel, r.personnel_id, "— yok —")}</select></div>
          <div class="field"><label>Malzeme</label><input name="material" value="${esc(r.material || "")}" placeholder="moloz, kum, mıcır…"></div>
          <div class="field"><label>Malzeme ocağı</label><select name="quarry">${opt([...quarries, ...(r.new_quarry ? [["new:" + r.new_quarry, "➕ Yeni ocak: " + r.new_quarry]] : [])], r.quarry_id || (r.new_quarry ? "new:" + r.new_quarry : ""), "— yok —")}</select></div>
          <div class="field"><label>Döküm / dolgu yeri</label><select name="dump_site">${opt([...dumpSites, ...(r.new_dump_site ? [["new:" + r.new_dump_site, "➕ Yeni döküm yeri: " + r.new_dump_site]] : [])], r.dump_site_id || (r.new_dump_site ? "new:" + r.new_dump_site : ""), "— yok —")}</select></div>
          <div class="field"><label>Birim fiyat (₺, boşsa fiyat listesi)</label><input type="number" step="any" name="unit_price" value="${r.unit_price ?? ""}"></div>
          <div class="field"><label>Alındığı yer</label><input name="from_place" value="${esc(r.from_place || "")}" placeholder="ocak / saha"></div>
          <div class="field"><label>Teslim yeri</label><input name="to_place" value="${esc(r.to_place || "")}" placeholder="şantiye / dolgu"></div>
          <div class="field"><label>Fiş no</label><input name="slip_no" value="${esc(r.slip_no || "")}"></div>
          <div class="field"><label>Tonaj (fişteki net ton)</label><input type="number" step="any" name="tonnage" value="${r.tonnage ?? ""}"></div>
          <div class="field"><label>Döküm maliyeti (₺, elle)</label><input type="number" step="any" name="dump_cost" value="${r.dump_cost ?? ""}" placeholder="boş = yok / otomatik"></div>
        </div>
        ${(r.photos || []).length ? `<div class="row" style="gap:6px;flex-wrap:wrap;margin:6px 0">${r.photos.filter((p) => files[p]).map((p) => `<img src="${URL.createObjectURL(files[p])}" alt="Fiş" style="width:96px;height:96px;object-fit:cover;border-radius:8px;border:1px solid var(--border)">`).join("")}<span class="muted tiny" style="align-self:center">🧾 fiş bu işe eklenecek</span></div>` : ""}
        ${r.reporter ? `<div class="muted tiny">Bildiren: ${esc(r.reporter)}</div>` : ""}
        ${r.fuelAllowance ? `<div class="small" style="margin-top:4px">⛽ ${esc(r.fuelAllowance.customer)} sefer başı ${r.fuelAllowance.per} L mazot verir → bu iş için <b>${r.fuelAllowance.liters} L</b> mazot hak edildi → müşterinin mazot hesabına eklenir (ücret yalnız mazotsa hakedişe 0 ₺ yazılır)</div>` : ""}
        <div class="field"><label>İş açıklaması</label><textarea name="description" rows="2">${esc(r.description || "")}</textarea></div>
        ${r.ambiguous ? `<div class="small" style="margin-top:6px">❓ Kime çalışıldı?</div><div class="row" style="gap:6px;flex-wrap:wrap;margin-top:4px">${r.ambiguous.map((a) => `<button class="chip" data-pickcust="${esc(a.id)}" title="${esc(a.why || "")}">${esc(a.name)}${a.why ? " ★" : ""}</button>`).join("")}</div>` : ""}${issues(r)}</div>`;
      })
      .join("") +
    v.tickets
      .map((r, i) => {
        const batch = v.works.map((w, j) => ["batch:" + j, `Bu mesajdaki iş${v.works.length > 1 ? " " + (j + 1) : ""}: ${nameOf("customers", w.customer_id) || w.new_customer || "—"} · ${w.quantity ?? ""} ${String(w.unit || "").toLocaleLowerCase("tr-TR")} (aynı satıra eklenir)`]);
        if (!r.link && v.works.length === 1) r.link = "batch:0";
        const linkOpts = [...batch, ...r.works.map((id) => { const w = d.work_records.find((x) => x.id === id); return [id, `Mevcut: ${nameOf("customers", w.customer_id)} · ${w.quantity} sefer`]; }), ["new", "➕ Yeni 1 sefer iş aç"]];
        return `<div class="card" data-kind="ticket" data-i="${i}">
        <label class="history-check"><input type="checkbox" data-pick ${r.ok ? "checked" : ""}> <b>🧾 Döküm / kantar fişi</b></label>
        ${files[r.photo] ? `<img src="${URL.createObjectURL(files[r.photo])}" alt="Döküm fişi" style="width:100%;max-height:200px;object-fit:contain;border-radius:8px;margin:6px 0">` : ""}
        <div class="formgrid2">
          <div class="field"><label>Fiş no</label><input name="ticket_no" value="${esc(r.ticket_no)}"></div>
          <div class="field"><label>Tarih</label><input type="date" name="date" value="${esc(r.date)}"></div>
          <div class="field"><label>Araç</label><select name="vehicle">${opt(vehicles, r.vehicle_id)}</select></div>
          <div class="field"><label>Net ton</label><input type="number" step="any" name="tonnage" value="${r.tonnage ?? ""}"></div>
          <div class="field"><label>Döküm yeri</label><select name="dump_site">${opt(dumpSites, r.dump_site_id, r.dump_site_name ? "— " + r.dump_site_name + " (listede yok) —" : "— yok —")}</select></div>
          <div class="field"><label>Bağlanacak iş</label><select name="link">${opt(linkOpts, r.link, "— seçin —")}</select></div>
          <div class="field"><label>Müşteri (yeni iş için)</label><select name="customer">${opt(customers, r.customer_id)}</select></div>
          <div class="field"><label>İş türü (yeni iş için)</label><select name="work_type">${opt(WORK_TYPES.map((x) => [x, x]), WORK_TYPES.includes("Hafriyat Nakliye") ? "Hafriyat Nakliye" : WORK_TYPES[0])}</select></div>
        </div>${issues(r)}</div>`;
      })
      .join("") +
    v.docs
      .map((r, i) => {
        const nv = r.new_vehicle;
        const np = r.new_person;
        const owners = [...(nv ? [["newveh", `➕ Yeni araç: ${nv.plate} (${nv.type})`]] : []), ...(np ? [["newper", `➕ Yeni personel: ${np.name}`]] : []), ...vehicles.map(([id, n]) => ["vehicle:" + id, "🚚 " + n]), ...personnel.map(([id, n]) => ["personnel:" + id, "👤 " + n]), ["company:company_profile", "🏢 Şirket"]];
        const LBL = r.owner_type === "personnel" ? PERSON_INFO_LABELS : r.owner_type === "company" ? COMPANY_INFO_LABELS : VEHICLE_INFO_LABELS;
        const HEAD = r.owner_type === "personnel" ? "👤 Personel kartı" : r.owner_type === "company" ? "🏢 Şirket bilgileri" : "🚚 Araç kartı";
        return `<div class="card" data-kind="doc" data-i="${i}">
        <label class="history-check"><input type="checkbox" data-pick ${r.ok ? "checked" : ""}> <b>📄 Belge</b> · bitiş tarihi takibe alınır</label>
        ${files[r.photo] ? `<img src="${URL.createObjectURL(files[r.photo])}" alt="Belge" style="width:100%;max-height:200px;object-fit:contain;border-radius:8px;margin:6px 0">` : ""}
        <div class="formgrid2">
          <div class="field"><label>Belge türü</label><select name="category">${opt(ASSIST_DOC_TYPES.map((x) => [x, x]), r.category)}</select></div>
          <div class="field"><label>Sahibi</label><select name="owner">${opt(owners, r.owner_id ? r.owner_type + ":" + r.owner_id : nv ? "newveh" : np ? "newper" : "")}</select></div>
          ${np ? `<div class="field" data-np ${r.owner_id ? "hidden" : ""}><label>Yeni personel adı</label><input name="np_name" value="${esc(np.name)}"></div>
          <div class="field" data-np ${r.owner_id ? "hidden" : ""}><label>Görevi</label><input name="np_role" value="${esc(/ehliyet|src|psikoteknik/i.test(r.category || "") ? "Şoför" : /operat/i.test(r.category || "") ? "Operatör" : "")}"></div>` : ""}
          ${nv ? `<div class="tiny muted" style="grid-column:1/-1;margin:-4px 2px 2px">Araç listede başka adla kayıtlıysa (ör. "Mobil Vinç") sahibi olarak onu seçin: aşağıdaki plaka ve bilgiler o karta yazılır.</div><div class="field"><label>Plaka (belgeden)</label><input name="nv_plate" value="${esc(nv.plate)}"></div>
          <div class="field"><label>Araç türü (belgeden)</label><select name="nv_type">${opt([...new Set([...VEHICLE_KINDS, nv.type])].map((x) => [x, x]), nv.type)}</select></div>
          <div class="field"><label>Marka</label><input name="nv_brand" value="${esc(nv.brand || "")}"></div>
          <div class="field"><label>Model yılı</label><input type="number" name="nv_year" value="${nv.model_year ?? ""}"></div>` : ""}
          <div class="field"><label>Belge no</label><input name="doc_no" value="${esc(r.doc_no)}"></div>
          <div class="field"><label>Düzenleme tarihi</label><input type="date" name="date" value="${esc(r.date || "")}"></div>
          <div class="field"><label>Bitiş tarihi</label><input type="date" name="expiry_date" value="${esc(r.expiry_date || "")}"></div>
        </div>${r.card_update?.length ? `<div class="small" style="margin-top:8px"><b>${HEAD} belgeye göre güncellenecek</b> <span class="muted tiny">(sahibi değiştirilmezse)</span>
          ${r.card_update.map((u) => `<label class="history-check"><input type="checkbox" data-vu="${esc(u.k)}" ${u.on ? "checked" : ""}> ${esc(LBL[u.k] || u.k)}: <span class="muted">${esc(u.from ?? "—")}</span> → <b>${esc(u.to)}</b></label>`).join("")}</div>` : ""}${issues(r)}</div>`;
      })
      .join("") +
    v.expenses
      .map((r, i) => `<div class="card" data-kind="expense" data-i="${i}">
        <label class="history-check"><input type="checkbox" data-pick ${r.ok ? "checked" : ""}> <b>${r.dumpInv ? "🧾 Döküm faturası" : "Gider"}</b>${r.photo != null ? " · fiş fotoğrafı eklenecek" : ""}</label>
        ${r.photo != null && files[r.photo] ? `<img src="${URL.createObjectURL(files[r.photo])}" alt="📷 fiş fotoğrafı (önizleme açılamadı, yine de eklenecek)" data-imgfb style="width:100%;max-height:200px;object-fit:contain;border-radius:8px;margin:6px 0">` : ""}
        <div class="formgrid2">
          <div class="field"><label>Tarih</label><input type="date" name="date" value="${esc(r.date)}"></div>
          <div class="field"><label>Tutar (₺)</label><input type="number" step="any" name="amount" value="${r.amount ?? ""}"></div>
          <div class="field"><label>Kategori</label><select name="category">${opt(EXPENSE_CATEGORIES.map((x) => [x, x]), r.category, "Diğer")}</select></div>
          <div class="field"><label>Firma</label><input name="company" value="${esc(r.company)}"></div>
          <div class="field"><label>Araç</label><select name="vehicle">${opt(vehicles, r.vehicle_id, "— yok —")}</select></div>
          <div class="field"><label>Ödeme</label><select name="pay">${opt([["Şirket Ödedi", "🏢 Şirket (belirtilmedi)"], ["Nakit", "💵 Nakit"], ["Kart", "💳 Kart"], ["Havale", "🏦 Havale / EFT"], ...personnel.map(([id, n]) => ["p:" + id, "👷 " + n + " cebinden ödedi"])],
            r.driver_pay === "cep" && r.driver_pid ? "p:" + r.driver_pid : r.payment_method === "Personel Ödedi" && r.paid_by ? "p:" + r.paid_by : r.payment_method || "Şirket Ödedi")}</select></div>
          <div class="field"><label>Veresiye esnaf</label><select name="supplier">${opt(suppliers, r.credit ? r.supplier_id : "", "— peşin —")}</select></div>
        </div>
        ${r.dumpInv ? `<div class="notice info" style="margin-top:6px"><div>Bu bir <b>döküm sahası faturası</b>. Gider yazılmaz: para döküm hesabına yatırılırken ödendi, maliyet her dökümde ayrıca yazılıyor (yoksa iki kez sayılır). Fatura döküm hesabına bağlanır; faturadaki ton ve tutar kayıtlarımızla karşılaştırılır.${r.dumpInv.ton ? `<br><b>${r.dumpInv.ton.toLocaleString("tr-TR")} ton</b>${r.amount ? ` · ton başı ${(Math.round((r.amount / r.dumpInv.ton) * 100) / 100).toLocaleString("tr-TR")} ₺ (KDV dahil)` : ""}` : ""}${r.dumpInv.place ? ` · yer: ${esc(r.dumpInv.place)}` : ""}</div></div>
          <div class="formgrid2"><div class="field"><label>Döküm sahası</label><select name="dinv_site">${opt(v.dumpSites || [], r.dumpInv.site_id, "— seçin —")}</select></div>
          <div class="field"><label>Nasıl kaydedilsin</label><select name="dinv_mode">${opt([["paid", "Geçmiş dönem: fatura tutarını ödenmiş say (giderlerde görünür)"], ["inv", "Yalnız fatura (para yatırma kayıtları girili)"], ["exp", "Düz gider (dökümler ayrıca sayılır — iki kez!)"]], r.dumpInv.hasDeposits ? "inv" : "paid")}</select></div></div>` : ""}
        <div class="field"><label>Açıklama</label><input name="description" value="${esc(r.note || "")}" placeholder="ne alındı / yapıldı"></div>${r.issues_pay ? `<div class="muted tiny">⚠ ${esc(r.issues_pay)}</div>` : ""}${detailHtml(r)}${issues(r)}</div>`)
      .join("") +
    v.tankIn
      .map((r, i) => `<div class="card" data-kind="tank" data-i="${i}">
        <label class="history-check"><input type="checkbox" data-pick ${r.ok ? "checked" : ""}> <b>🛢 Depoya yakıt girişi</b>${r.detail ? " · fatura" : ""}</label>
        ${r.photo != null && files[r.photo] ? `<img src="${URL.createObjectURL(files[r.photo])}" alt="📄 fatura (önizleme açılamadı, yine de eklenecek)" data-imgfb style="width:100%;max-height:180px;object-fit:contain;border-radius:8px;margin:6px 0">` : ""}
        <div class="formgrid2">
          <div class="field"><label>Tarih</label><input type="date" name="date" value="${esc(r.date)}"></div>
          <div class="field"><label>Litre</label><input type="number" step="any" name="liters" value="${r.liters ?? ""}"></div>
          <div class="field"><label>Litre fiyatı (₺)</label><input type="number" step="any" name="unit_price" value="${r.unit_price ?? ""}"></div>
          <div class="field"><label>Toplam (₺, ops.)</label><input type="number" step="any" name="total" value="${r.total ?? ""}"></div>
          <div class="field"><label>Petrolcü</label><select name="supplier">${opt([...(r.newSupplier ? [["new", "➕ Yeni: " + r.newSupplier.name.slice(0, 40)]] : []), ...suppliers], r.supplier_id || (r.newSupplier ? "new" : ""), "— yok —")}</select></div>
          <div class="field"><label>Ödeme</label><select name="tank_pay">${opt([["credit", "Veresiye (petrolcüye borç)"], ["paid", "Peşin ödendi"]], r.credit ? "credit" : "paid")}</select></div>
          <div class="field"><label>Müşteriden (sefer karşılığı)</label><select name="tank_customer">${opt(customers, r.customer_id, "— yok —")}</select></div>
          ${r.irsaliye_no ? `<div class="field"><label>İrsaliye no</label><input name="irsaliye_no" value="${esc(r.irsaliye_no)}"></div>` : ""}
        </div>${r.match ? `<div class="notice info" style="margin-top:6px"><div>📌 ${trDate(r.match.date)} tarihinde elle girilmiş <b>${r.match.liters.toLocaleString("tr-TR")} L</b> depo girişi var${r.match.total ? ` (${r.match.total.toLocaleString("tr-TR")} ₺)` : " (fiyatsız)"}. Aynı teslimatsa faturayı ona bağlayın; depo iki kez artmaz.${r.match.bill != null ? `<br>Bu girişin petrolcü borcu zaten yazılmış (${r.match.bill.toLocaleString("tr-TR")} ₺); yeni borç yazılmaz.` : ""}</div></div>
          <div class="field"><label>Bu fatura</label><select name="tank_link">${opt([["link", "Elle girdiğim girişe bağla (önerilen)"], ["new", "Ayrı, yeni bir teslimat"]], "link")}</select></div>` : ""}${detailHtml(r)}${issues(r)}</div>`)
      .join("") +
    v.fuel
      .map((r, i) => `<div class="card" data-kind="fuel" data-i="${i}">
        <label class="history-check"><input type="checkbox" data-pick ${r.ok ? "checked" : ""}> <b>Yakıt</b> <span class="muted small">· depoda kayıtlı ${Math.round(v.tankStock)} L</span></label>
        <div class="formgrid2">
          <div class="field"><label>Tarih</label><input type="date" name="date" value="${esc(r.date)}"></div>
          <div class="field"><label>Araç</label><select name="vehicle">${opt(vehicles, r.vehicle_id)}</select></div>
          <div class="field"><label>Nereden</label><select name="source">${opt([["Depo Tankı", "Depo tankından"], ["Akaryakıt İstasyonu", "Akaryakıt istasyonu"], ["Müşteri Verdi", "Müşteri verdi (örn. Kılıç)"]], r.source, "Depo Tankı")}</select></div>
          <div class="field"><label>Veren müşteri (müşteri verdiyse)</label><select name="fuel_customer">${opt(customers, r.customer_id, "— yok —")}</select></div>
          <div class="field"><label>Litre</label><input type="number" step="any" name="liters" value="${r.liters ?? ""}"></div>
          <div class="field"><label>Tutar (₺)</label><input type="number" step="any" name="total" value="${r.total ?? ""}"></div>
        </div>${issues(r)}</div>`)
      .join("") +
    v.collections
      .map((r, i) => `<div class="card" data-kind="collection" data-i="${i}">
        <label class="history-check"><input type="checkbox" data-pick ${r.ok ? "checked" : ""}> <b>Tahsilat</b> (müşteriden para)</label>
        <div class="formgrid2">
          <div class="field"><label>Tarih</label><input type="date" name="date" value="${esc(r.date)}"></div>
          <div class="field"><label>Müşteri</label><select name="customer">${opt([...customers, ...(r.new_customer ? [["new:" + r.new_customer, "➕ Yeni: " + r.new_customer]] : [])], r.customer_id || (r.new_customer ? "new:" + r.new_customer : ""))}</select></div>
          <div class="field"><label>Tutar (₺)</label><input type="number" step="any" name="amount" value="${r.amount ?? ""}"></div>
          <div class="field"><label>Şekil</label><select name="method">${opt([["Nakit", "Nakit"], ["Havale", "Havale / EFT"]], r.method, "Nakit")}</select></div>
          <div class="field"><label>Banka hesabı (havale)</label><select name="bank">${opt(banks, r.bank_account_id, "— yok —")}</select></div>
          <div class="field"><label>Parayı alan personel</label><select name="personnel">${opt(personnel, r.personnel_id, "— kasaya —")}</select></div>
        </div>${issues(r)}</div>`)
      .join("") +
    v.maintenance
      .map((r, i) => `<div class="card" data-kind="maintenance" data-i="${i}">
        <label class="history-check"><input type="checkbox" data-pick ${r.ok ? "checked" : ""}> <b>Arıza / Bakım</b></label>
        <div class="formgrid2">
          <div class="field"><label>Tarih</label><input type="date" name="date" value="${esc(r.date)}"></div>
          <div class="field"><label>Araç</label><select name="vehicle">${opt(vehicles, r.vehicle_id)}</select></div>
          <div class="field"><label>Tür</label><select name="maint_type">${opt(MAINT_TYPES.map((x) => [x, x]), r.maint_type)}</select></div>
          <div class="field"><label>Durum</label><select name="status">${opt(MAINT_STATUS.map((x) => [x, x]), r.status)}</select></div>
          <div class="field"><label>Tutar (₺, ops.)</label><input type="number" step="any" name="cost" value="${r.cost ?? ""}"></div>
          <div class="field"><label>Servis / usta</label><input name="service_company" value="${esc(r.service_company)}"></div>
          <div class="field"><label>Veresiye esnaf</label><select name="supplier">${opt(suppliers, r.credit ? r.supplier_id : "", "— peşin / yok —")}</select></div>
        </div>
        <div class="field"><label>Açıklama</label><input name="description" value="${esc(r.description)}"></div>${issues(r)}</div>`)
      .join("") +
    v.personnel
      .map((r, i) => `<div class="card" data-kind="personnel" data-i="${i}">
        <label class="history-check"><input type="checkbox" data-pick ${r.ok ? "checked" : ""}> <b>Personel hareketi</b></label>
        <div class="formgrid2">
          <div class="field"><label>Tarih</label><input type="date" name="date" value="${esc(r.date)}"></div>
          <div class="field"><label>Personel</label><select name="personnel">${opt(personnel, r.personnel_id)}</select></div>
          <div class="field"><label>İşlem</label><select name="event_type">${opt(PERSONNEL_EVENT_TYPES.map((x) => [x, x]), r.event_type)}</select></div>
          <div class="field"><label>Tutar (₺)</label><input type="number" step="any" name="amount" value="${r.amount ?? ""}"></div>
          <div class="field"><label>Saat / Gün</label><input type="number" step="any" name="hours_days" value="${r.hours_days ?? ""}"></div>
        </div>${issues(r)}</div>`)
      .join("") +
    v.edits
      .map((r, i) => {
        const label = { work_records: "İş", expense_records: "Gider", fuel_records: "Yakıt", cash_records: "Kasa" }[r.store] || r.store;
        const show = (k, val) => (k.endsWith("_id") ? nameOf({ customer_id: "customers", site_id: "sites", vehicle_id: "vehicles" }[k], val) : String(val ?? "—"));
        const before = r.rec ? `${label} · ${r.rec.date} · ${r.store === "work_records" ? nameOf("customers", r.rec.customer_id) + " · " + (r.rec.quantity ?? "") + " " + (r.rec.unit || "") : (r.rec.amount ?? r.rec.liters ?? "")}` : "Kayıt bulunamadı";
        return `<div class="card" data-kind="edit" data-i="${i}" ${r.rec ? "" : 'data-disabled="1"'}>
        <label class="history-check"><input type="checkbox" data-pick ${r.rec ? "" : "disabled"}> <b>${r.remove ? "🗑 Kaydı sil" : "✏ Kaydı düzelt"}</b> — bilerek işaretleyin</label>
        <div class="small">${esc(before)}</div>
        ${Object.entries(r.changes).map(([k, val]) => `<div class="small">• ${esc(k)}: <s>${esc(show(k, r.rec?.[k]))}</s> → <b>${esc(show(k, val))}</b></div>`).join("")}
        ${r.remove ? `<div class="small">Neden: ${esc(r.reason)}</div>` : ""}${issues(r)}</div>`;
      })
      .join("") +
    (v.open ? `<div class="card"><div class="row between"><span>📂 <b>${esc(v.open.label)}</b></span><button class="btn sm primary" data-go="${esc(v.open.href)}">Aç ›</button></div></div>` : "") +
    (v.actions || [])
      .map((r, i) => `<div class="card" data-kind="action" data-i="${i}" ${r.op && r.issues.every((x) => !/bulunamadı|yapılamıyor|eklenemez/.test(x)) ? "" : 'data-disabled="1"'}>
        <label class="history-check"><input type="checkbox" data-pick ${r.ok ? "checked" : ""} ${r.op && !r.issues.some((x) => /bulunamadı|yapılamıyor|eklenemez/.test(x)) ? "" : "disabled"}> <b>${r.op === "create" ? "➕ Yeni" : r.op === "delete" ? "🗑 Sil" : "✏ Düzelt"}: ${esc(r.label)}</b>${r.rec ? " — " + esc(r.rec.name || r.rec.category || r.rec.unit || "") : ""}</label>
        ${r.shown.map(([k, a, b]) => `<div class="small">• ${esc(k)}: ${a != null ? `<s>${esc(String(a))}</s> → ` : ""}<b>${esc(String(b))}</b></div>`).join("")}
        ${r.op === "delete" ? `<div class="small">Neden: ${esc(r.reason)}</div>` : ""}${issues(r)}</div>`)
      .join("") +
    (v.settings || [])
      .map((r, i) => `<div class="card" data-kind="setting" data-i="${i}">
        <label class="history-check"><input type="checkbox" data-pick ${r.ok ? "checked" : ""} ${r.issues.some((x) => /değiştirilemez/.test(x)) ? "disabled" : ""}> <b>⚙ ${esc(r.title)}</b></label>
        <div class="small">${esc(r.key === "rule" ? r.value : r.key === "promise" ? `${r.customer?.name || "—"} · ${r.date ? r.date.split("-").reverse().join(".") : "tarih yok"}${r.amount ? " · " + fmtTL(r.amount) + " ₺" : ""}` : r.key === "fuel_rule" ? `${r.customer?.name || "—"} · ${r.per ?? "?"} L / ${r.unit}${r.match ? " (" + r.match + ")" : ""} · ${r.only_pay ? "ücret yalnız mazot" : "para + mazot"}` : String(r.value ?? "—"))}</div>${issues(r)}</div>`)
      .join("") +
    (v.prices || [])
      .map((r, i) => `<div class="card" data-kind="price" data-i="${i}">
        <label class="history-check"><input type="checkbox" data-pick ${r.ok ? "checked" : ""}> <b>💲 Fiyat kuralı</b> (fiyat listesine)</label>
        <div class="formgrid2">
          <div class="field"><label>Müşteri</label><select name="customer">${opt([...customers, ...(r.new_customer ? [["new:" + r.new_customer, "➕ Yeni: " + r.new_customer]] : [])], r.customer_id || (r.new_customer ? "new:" + r.new_customer : ""), "— tüm müşteriler —")}</select></div>
          <div class="field"><label>Kapsam</label><select name="scope">${r.scopes.map((s, j) => `<option value="${j}">${esc(s.label)}</option>`).join("")}</select></div>
          <div class="field"><label>Birim</label><select name="unit">${opt(ASSIST_UNITS.map((u) => [u, u]), r.unit || "")}</select></div>
          <div class="field"><label>Fiyat (₺, KDV hariç)</label><input type="number" step="any" name="price" value="${r.price ?? ""}"></div>
        </div>
        <div data-scopeinfo class="small" style="margin-top:4px"></div>
        <label class="history-check small"><input type="checkbox" name="apply_unpriced" checked> Fiyatı boş eski işlere uygula <span data-n-unpriced class="muted"></span></label>
        <label class="history-check small"><input type="checkbox" name="apply_differ"> Farklı fiyatlı eski işleri de bu fiyata çevir <span data-n-differ class="muted"></span></label>
        ${issues(r)}</div>`)
      .join("") +
    (total ? '<button class="btn primary block" data-save>✓ Seçilenleri Kaydet</button>' : v.answer || v.open || v.asked ? "" : notice("warn", "Kaydedilecek bir şey bulunamadı. Mesajı daha açık yazıp tekrar deneyin."));
  // Belirsiz müşteri: aday düğmesi seçer ve kartı işaretler
  for (const b of qsa("[data-pickcust]", out))
    b.addEventListener("click", () => {
      const card = b.closest(".card");
      qs("[name=customer]", card).value = b.dataset.pickcust;
      qs("[name=customer]", card).dispatchEvent(new Event("change"));
      qs("[data-pick]", card).checked = true;
      for (const x of qsa("[data-pickcust]", card)) x.classList.toggle("on", x === b);
    });
  // Müşteri değişince önerilen "yeni şantiye" o müşteriye ait olmayabilir: temizle
  for (const card of qsa('.card[data-kind="work"]', out)) {
    const cs = qs("[name=customer]", card), ss = qs("[name=site]", card);
    cs?.addEventListener("change", () => {
      if (ss && ss.value.startsWith("new:")) ss.value = "";
    });
  }
  // Fiyat kuralı: seçilen kapsama göre eski iş sayıları ve mevcut kural
  for (const card of qsa('.card[data-kind="price"]', out)) {
    const r = v.prices[Number(card.dataset.i)];
    const show = () => {
      const s = r.scopes[Number(qs("[name=scope]", card).value) || 0];
      const same = qs("[name=customer]", card).value === (r.customer_id || "") && qs("[name=unit]", card).value === r.unit;
      qs("[data-n-unpriced]", card).textContent = same ? `(${s.unpriced} iş)` : "";
      qs("[data-n-differ]", card).textContent = same ? `(${s.differ} iş)` : "";
      qs("[data-scopeinfo]", card).innerHTML = [
        s.existing ? `Mevcut kural: <b>${fmtTL(s.existing.price)} ₺</b> → yeni fiyatla güncellenecek` : "Yeni kural eklenecek",
        s.locked ? `<span class="muted">${s.locked} iş hakedişe girdiği için değişmez</span>` : "",
      ].filter(Boolean).join(" · ");
    };
    for (const n of ["scope", "customer", "unit"]) qs(`[name=${n}]`, card).addEventListener("change", show);
    show();
  }
  qs("[data-save]", out)?.addEventListener("click", () => save(ctx, out, v, d, { message, files }));
  // Önizlemesi açılamayan fotoğraf: yerine yazı (CSP satır içi onerror'a izin vermez)
  for (const img of qsa("img[data-imgfb]", out)) img.addEventListener("error", () => img.replaceWith(Object.assign(document.createElement("div"), { className: "small muted", textContent: img.alt })));
  // Belge kartı: "Yeni personel / araç" seçilince ilgili alanlar görünür
  for (const sel of qsa('[data-kind=doc] select[name="owner"]', out))
    sel.addEventListener("change", () => { for (const f of qsa("[data-np]", sel.closest(".card"))) f.hidden = sel.value !== "newper"; });
}

async function save(ctx, out, v, d, { message, files }) {
  const { db } = ctx;
  const cards = qsa(".card[data-kind]", out)
    .filter((c) => qs("[data-pick]", c).checked)
    .sort((a, b) => (["card", "memory", "tank", "price", "action", "setting"].includes(a.dataset.kind) ? 0 : 1) - (["card", "memory", "tank", "price", "action", "setting"].includes(b.dataset.kind) ? 0 : 1));
  if (!cards.length) return toast("Kaydedilecek kart seçin", "err");
  const val = (c, n) => qs(`[name=${n}]`, c)?.value ?? "";
  // Önce eksik kontrolü: hiçbir şey yazılmadan
  for (const c of cards) {
    const k = c.dataset.kind;
    const miss =
      k === "work" ? !val(c, "customer") || !val(c, "vehicle") || !val(c, "work_type") || !(Number(val(c, "quantity")) > 0) || !val(c, "unit")
      : k === "expense" ? !(Number(val(c, "amount")) > 0)
      : k === "fuel" ? !val(c, "vehicle") || !(Number(val(c, "liters")) > 0) || (val(c, "source") === "Müşteri Verdi" && !val(c, "fuel_customer"))
      : k === "tank" ? !(Number(val(c, "liters")) > 0) || (val(c, "supplier") && !(Number(val(c, "total")) > 0 || Number(val(c, "unit_price")) > 0))
      : k === "collection" ? !val(c, "customer") || !(Number(val(c, "amount")) > 0) || (val(c, "method") === "Havale" && !val(c, "bank"))
      : k === "maintenance" ? !val(c, "vehicle") || !val(c, "description") || (val(c, "supplier") && !(Number(val(c, "cost")) > 0))
      : k === "personnel" ? !val(c, "personnel")
      : k === "ticket" ? !val(c, "ticket_no").trim() || !val(c, "date") || !val(c, "vehicle") || !val(c, "link") || (val(c, "link") === "new" && (!val(c, "customer") || !val(c, "work_type")))
      : k === "doc" ? !val(c, "category") || !val(c, "owner") || !val(c, "doc_no").trim() || !val(c, "date") || documentOwner(val(c, "category")) !== ({ newveh: "vehicle", newper: "personnel" }[val(c, "owner")] || val(c, "owner").split(":")[0]) || (val(c, "owner") === "newveh" && !plateKey(val(c, "nv_plate"))) || (val(c, "owner") === "newper" && val(c, "np_name").trim().split(/\s+/).length < 2) || (val(c, "expiry_date") && val(c, "expiry_date") < val(c, "date")) || (!val(c, "expiry_date") && !NO_EXPIRY.includes(val(c, "category")))
      : k === "price" ? !(Number(val(c, "price")) > 0) || !val(c, "unit")
      : k === "card" ? !val(c, "name").trim() || (v.cards[Number(c.dataset.i)].kind === "sites" && !val(c, "customer"))
      : false;
    if (miss) {
      c.scrollIntoView({ behavior: "smooth", block: "center" });
      return toast(k === "doc" ? "Belge kartında eksik/uyumsuz alan var (araç belgesi araca, personel belgesi personele)" : "İşaretli kartta eksik alan var", "err");
    }
  }
  // Depo stoku: işaretli depo girişleri + mevcut stok, depodan verilen yakıta yetmeli
  {
    const sum = (kind, f) => cards.filter((c) => c.dataset.kind === kind && f(c)).reduce((n, c) => n + Number(val(c, "liters")), 0);
    const need = sum("fuel", (c) => (val(c, "source") || "Depo Tankı") === "Depo Tankı");
    const have = v.tankStock + sum("tank", () => true);
    if (need > have + 0.001)
      return toast(`Depoda kayıtlı ${Math.round(have)} L var, ${need} L verilmek isteniyor. Önce depoya yakıt girişi yapın (mesaja "depoya X litre geldi" yazabilirsiniz) ya da kaynağı İstasyon seçin.`, "err");
  }
  const btn = qs("[data-save]", out);
  btn.disabled = true;
  const batchWorks = {};
  const undo = await import("./undo.js");
  const snap0 = await undo.snapshot(db);
  const newVehByPlate = new Map(), savedDocs = [], dslipIds = [];
  const done = { action: 0, setting: 0, price: 0, priced: 0, tank: 0, tankLinked: 0, ticket: 0, doc: 0, work: 0, expense: 0, fuel: 0, customer: 0, site: 0, collection: 0, maintenance: 0, personnel: 0, edit: 0, cards: 0, learned: 0, vupd: 0, pcards: 0, docSame: 0, dumpdep: 0, dumpinv: 0, dumpinvPaid: 0 };
  const { saveMessageMemory } = await import("./message-smart-db.js");
  // Kaydedilen seçim hafızaya: mesajdaki ifade → seçilen kart (bir dahaki sefere otomatik)
  const learn = async (alias, target_type, target_id, cardName) => {
    if (!alias || !target_id) return;
    const n = (x) => String(x || "").toLocaleLowerCase("tr-TR").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
    if (n(alias) === n(cardName)) return;
    // "kuyucu", "camcılar" gibi yalnız meslek adı birden fazla kişiyi anlatır: hafızaya alınmaz
    if (occupationOnly(alias)) return;
    try {
      const before = (await db.getAll("aliases")).filter((a) => !a.deleted_at && a.active !== false).length;
      await saveMessageMemory({ alias, target_type, target_id, confirmed: true });
      const after = (await db.getAll("aliases")).filter((a) => !a.deleted_at && a.active !== false).length;
      if (after > before) done.learned++;
    } catch (e) {
      /* başka karta bağlı takma ad: dokunma */
    }
  };
  const ensureCustomer = async (customer, parent = null) => {
    if (!customer.startsWith("new:")) return customer;
    const name = customer.slice(4);
    if (!newIds.has("c:" + name)) {
      const rec = await db.saveNew("customers", { name, note: "Asistan ile açıldı", ...(parent ? { parent_customer_id: parent } : {}) }, "Asistan: yeni müşteri");
      newIds.set("c:" + name, rec.id);
      done.customer++;
    }
    return newIds.get("c:" + name);
  };
  const newIds = new Map();
  const source = "Asistan: " + message.slice(0, 300);
  try {
    const { priceSnapshot } = await import("./business.js");
    let prices = await db.listActive("price_book");
    const crane = { first: await db.metaGet("crane_first_hour"), next: await db.metaGet("crane_next_hour") };
    const vehicles = (d.vehicles || []).filter(isActive);
    const existingWorks = (d.work_records || []).filter(isActive);
    for (const c of cards) {
      const k = c.dataset.kind;
      if (k === "memory") {
        const r = v.memory[Number(c.dataset.i)];
        await learn(r.alias, r.target_type, r.target_id, r.target_name);
        continue;
      }
      if (k === "action") {
        const r = v.actions[Number(c.dataset.i)];
        const why = "Asistan: " + (r.reason || message.slice(0, 120));
        if (r.op === "create") {
          const rec = await db.saveNew(r.store, { ...r.changes, note: r.changes.note || "Asistan ile açıldı" }, why);
          if (r.store === "customers") newIds.set("c:" + rec.name, rec.id);
        } else {
          const cur = await db.get(r.store, r.id);
          if (!cur || cur.deleted_at) continue;
          if (r.op === "delete") await db.softDelete(r.store, r.id, why);
          else await db.saveExisting(r.store, cur, r.changes, why);
        }
        done.action++;
        continue;
      }
      if (k === "setting") {
        const r = v.settings[Number(c.dataset.i)];
        if (r.key === "rule") {
          const { effectiveRules } = await import("./assistant-rules.js");
          const cur = effectiveRules(await db.metaGet("assistant_rules"));
          await db.metaSet("assistant_rules", (cur.trimEnd() + "\n- " + r.value).slice(-6000));
        } else if (r.key === "promise") {
          const all = (await db.metaGet("collect_notes")) || {};
          all[r.customer.id] = { ...(all[r.customer.id] || {}), promise_date: r.date, ...(r.amount ? { promise_amount: r.amount } : {}), note: "Asistan: " + message.slice(0, 80) };
          await db.metaSet("collect_notes", all);
        } else if (r.key === "iban") await db.metaSet("collect_iban", r.value);
        else if (r.key === "fuel_ref_price") await db.metaSet("fuel_ref_price", r.value);
        else if (r.key === "fuel_rule") {
          const { fuelRulesOf } = await import("./assistant-rules.js");
          const cur = await db.get("customers", r.customer.id);
          const rules = [...fuelRulesOf(cur)];
          rules.push({ id: ctx.core.uuid(), per: r.per, unit: r.unit, match: r.match, only_pay: r.only_pay });
          await db.saveExisting("customers", cur, { fuel_rules: rules }, "Asistan: mazotla ödeme kuralı");
        }
        done.setting++;
        continue;
      }
      if (k === "price") {
        const r = v.prices[Number(c.dataset.i)];
        const pr = await import("./price-rule-core.js");
        const s = r.scopes[Number(val(c, "scope")) || 0];
        const cust = val(c, "customer") ? await ensureCustomer(val(c, "customer")) : null;
        const rule = { customer_id: cust, site_id: cust === r.customer_id ? r.site_id : null, work_type: s.work_type, vehicle_id: s.vehicle_id,
          unit: val(c, "unit"), price: Number(val(c, "price")), kdv_rate: 20, kdv_included: false, valid_from: null };
        let fresh = await db.dumpAll();
        const old = pr.sameRule(fresh, rule);
        const rec = old
          ? await db.saveExisting("price_book", old, { price: rule.price }, "Asistan: fiyat kuralı güncellendi")
          : await db.saveNew("price_book", { ...rule, active: true, note: "Asistan: " + message.slice(0, 120) }, "Asistan: fiyat kuralı");
        done.price++;
        const ruleId = rec?.id || old?.id || null;
        const pw = pr.pastWorksFor(fresh, rule);
        const todo = [...(qs("[name=apply_unpriced]", c).checked ? pw.unpriced : []), ...(qs("[name=apply_differ]", c).checked ? pw.differ : [])];
        for (const w of todo) {
          await db.saveExisting("work_records", w, { price_snapshot: pr.priceSnapshotFor(rule, w, ruleId) }, "Asistan: fiyat kuralı eski işe uygulandı");
          done.priced++;
        }
        prices = await db.listActive("price_book");
        continue;
      }
      if (k === "card") {
        const r = v.cards[Number(c.dataset.i)];
        const name = val(c, "name").trim();
        if (r.kind === "customers") {
          const rec = await db.saveNew("customers", { name, phone: val(c, "phone"), note: r.data.note || "Asistan listesinden" }, "Asistan: kart");
          newIds.set("c:" + name, rec.id);
          if (r.name !== name) newIds.set("c:" + r.name, rec.id);
          done.customer++;
        } else if (r.kind === "sites") {
          const customer = await ensureCustomer(val(c, "customer"));
          await db.saveNew("sites", { name, customer_id: customer }, "Asistan: kart");
          done.site++;
        } else if (r.kind === "vehicles") {
          await db.saveNew("vehicles", { name, plate: val(c, "plate"), type: val(c, "type") || "Araç/Makine", ownership: r.data.ownership, active: true }, "Asistan: kart");
          done.cards++;
        } else if (r.kind === "personnel") {
          await db.saveNew("personnel", { name, phone: val(c, "phone"), role: r.data.role || "", active: true }, "Asistan: kart");
          done.cards++;
        } else if (r.kind === "quarries" || r.kind === "dump_sites") {
          await db.saveNew(r.kind, { name, address: r.data.address || "" }, "Asistan: kart");
          done.cards++;
        } else if (r.kind === "suppliers") {
          const edb = await import("./enterprise-db.js");
          await edb.saveSupplier({ name, type: r.data.type, phone: val(c, "phone") });
          done.cards++;
        }
        continue;
      }
      if (k === "tank") {
        const liters = Number(val(c, "liters"));
        let total = Number(val(c, "total")) || null, unit_price = Number(val(c, "unit_price")) || null;
        if (unit_price && !total) total = Math.round(unit_price * liters * 100) / 100;
        if (total && liters) unit_price = Math.round((total / liters) * 100) / 100; // KDV dahil litre fiyatı
        const rT = v.tankIn[Number(c.dataset.i)];
        let supId = val(c, "supplier") || null;
        // Yeni petrolcü kartı (faturadaki satıcı)
        if (supId === "new" && rT.newSupplier) {
          const ex = (await db.listActive("suppliers")).find((s) => rT.newSupplier.tax_no && String(s.tax_no || "").replace(/\D/g, "") === rT.newSupplier.tax_no);
          const byName = (await db.listActive("suppliers")).find((s) => s.name.trim().toLocaleLowerCase("tr") === rT.newSupplier.name.trim().toLocaleLowerCase("tr"));
          supId = ex ? ex.id : byName ? byName.id : (await (await import("./enterprise-db.js")).saveSupplier({ name: rT.newSupplier.name, type: "Petrolcü", tax_no: rT.newSupplier.tax_no || "", note: "Faturadan otomatik açıldı" })).id;
          if (!ex && !byName) done.cards++;
        }
        const D = rT.detail;
        const invF = {
          ...(D ? { invoice_no: D.no || null, ettn: D.ettn || null, seller_tax_no: D.seller_tax_no || null, net_amount: D.net, kdv_amount: D.kdv, items: D.items.length ? D.items : null } : {}),
          ...(val(c, "irsaliye_no") ? { irsaliye_no: val(c, "irsaliye_no").trim() } : {}),
          ...(rT.company ? { company: rT.company } : {}),
        };
        // Elle girilmiş aynı teslimata bağla: yeni giriş açılmaz, mevcut kayıt faturayla tamamlanır
        if (rT.match && val(c, "tank_link") === "link") {
          const cur = await db.get("fuel_tank_movements", rT.match.id);
          if (cur && !cur.deleted_at) {
            const fresh0 = await db.dumpAll();
            const billOf = (dd) => (dd.payables || []).find((b) => !b.deleted_at && b.status !== "İptal" && b.source_store === "fuel_tank_movements" && b.source_id === cur.id);
            const bill = billOf(fresh0);
            await db.saveExisting("fuel_tank_movements", cur, { liters, unit_price, total, ...(supId && !bill ? { supplier_id: supId } : {}), ...invF }, "Faturayla birleştirildi (asistan)");
            if (rT.photo != null && files[rT.photo]) await db.addAttachment("tank", cur.id, files[rT.photo], { kind: "invoice" });
            if (bill) {
              if (total && Math.abs(Number(bill.gross_total) - total) > 1) toast(`Dikkat: petrolcü borcu ${Number(bill.gross_total).toLocaleString("tr-TR")} ₺, fatura ${total.toLocaleString("tr-TR")} ₺ — Esnaf ekranından düzeltin`, "err");
            } else if (supId && total && val(c, "tank_pay") !== "paid") {
              const { createCreditBill } = await import("./esnaf.js");
              await createCreditBill(ctx, fresh0, fresh0.suppliers.find((x) => x.id === supId),
                { date: cur.date, amount: total, description: `Depoya yakıt ${liters} L${D?.no ? " · fatura " + D.no : ""}`, category: "Yakıt", vehicle_id: null, kdv_rate: null },
                { source: { store: "fuel_tank_movements", id: cur.id } });
            }
            done.tankLinked++;
            continue;
          }
        }
        const mv = await db.saveNew("fuel_tank_movements", {
          date: val(c, "date") || todayStr(), move_type: "GİRİŞ", liters, vehicle_id: null, personnel_id: null,
          pump_no: "", signature_name: "", unit_price, total, supplier_id: supId, customer_id: val(c, "tank_customer") || null, description: source,
          ...invF,
        }, "Asistan: depo girişi");
        if (rT.photo != null && files[rT.photo]) await db.addAttachment("tank", mv.id, files[rT.photo], { kind: "invoice" });
        if (supId && total && val(c, "tank_pay") !== "paid") {
          const { createCreditBill } = await import("./esnaf.js");
          const fresh = await db.dumpAll();
          await createCreditBill(ctx, fresh, fresh.suppliers.find((x) => x.id === supId),
            { date: mv.date, amount: total, description: `Depoya yakıt ${liters} L${D?.no ? " · fatura " + D.no : ""}`, category: "Yakıt", vehicle_id: null, kdv_rate: null },
            { source: { store: "fuel_tank_movements", id: mv.id } });
        }
        done.tank++;
        continue;
      }
      if (k === "ticket") {
        const r = v.tickets[Number(c.dataset.i)];
        const file = files[r.photo];
        const date = val(c, "date"), vid = val(c, "vehicle"), no = val(c, "ticket_no").trim();
        const fresh = await db.dumpAll();
        if ((fresh.documents || []).some((x) => isActive(x) && x.category === "Döküm Fişi" && String(x.doc_no).trim() === no)) {
          toast(`Fiş ${no} zaten kayıtlı, atlandı`, "err");
          continue;
        }
        let workId = val(c, "link");
        const veh = vehicles.find((x) => x.id === vid);
        if (workId.startsWith("batch:")) {
          const w = batchWorks[workId.slice(6)];
          if (!w) { toast(`Fiş ${no}: bağlanacak iş kartı işaretli değil — fiş kaydedilmedi`, "err"); continue; }
          workId = w.id;
          const tn = Number(val(c, "tonnage")) || null;
          const patch = { ...(!w.slip_no ? { slip_no: no } : {}), ...(tn && !w.tonnage ? { tonnage: tn } : {}), slip_status: w.slip_status || "Fiş Var" };
          try { await db.saveExisting("work_records", await db.get("work_records", w.id), patch, "Asistan: fiş işe eklendi"); } catch (e) { /* iş kilitliyse yalnız belge bağlanır */ }
        }
        if (workId === "new") {
          const f = {
            date, customer_id: val(c, "customer"), site_id: null, vehicle_id: vid, personnel_id: null, vehicle_type: veh.type || null,
            contractor_id: veh.contractor_id || null, work_type: val(c, "work_type"), description: `Döküm fişi ${no}` + (val(c, "tonnage") ? ` · ${val(c, "tonnage")} ton` : ""),
            internal_note: source, material: r.material || "", quantity: 1, unit: "Sefer",
            dump_site_id: val(c, "dump_site") || null, quarry_id: null, dump_area: (d.dump_sites || []).find((x) => x.id === val(c, "dump_site"))?.name || r.dump_site_name || "",
            quarry: "", slip_status: null, slip_no: no, customer_note: "", distance_km: null, source: "asistan",
          };
          f.price_snapshot = priceSnapshot(f, prices, crane);
          workId = (await db.saveNew("work_records", f, "Asistan: döküm fişi")).id;
          done.work++;
        }
        const docFields = { category: "Döküm Fişi", owner_type: "work", owner_id: workId, date, doc_no: no, title: "Döküm fişi " + no,
          note: [val(c, "tonnage") ? val(c, "tonnage") + " ton" : "", r.dump_site_name].filter(Boolean).join(" · "),
          ticket_vehicle_id: vid, ticket_tonnage: Number(val(c, "tonnage")) || null, ticket_dump_site_id: val(c, "dump_site") || null };
        await (file ? db.saveDocument(docFields, file) : db.saveNew("documents", docFields, "Asistan: döküm fişi"));
        done.ticket++;
        continue;
      }
      if (k === "doc") {
        const r = v.docs[Number(c.dataset.i)];
        const file = files[r.photo];
        const category = val(c, "category");
        let [otype, oid] = val(c, "owner").split(":");
        if (otype === "newveh") {
          // Kayıtlı olmayan araç: aynı plaka bu kayıtta ya da veritabanında varsa ona bağla, yoksa yeni kart aç
          const pl = plateKey(val(c, "nv_plate"));
          if (!newVehByPlate.has(pl)) {
            const ex = (await db.listActive("vehicles")).find((x) => plateKey(x.plate) === pl || plateKey(x.name) === pl);
            if (ex) newVehByPlate.set(pl, ex.id);
            else {
              const nv = r.new_vehicle || {};
              const yr = Number(val(c, "nv_year")) || null;
              const rec = await db.saveNew("vehicles", { name: pl, plate: pl, type: val(c, "nv_type") || nv.type || "Araç/Makine", brand: val(c, "nv_brand").trim() || null, model: nv.model || null, model_year: yr, chassis_no: nv.chassis_no || null, engine_no: nv.engine_no || null, color: nv.color || null, fuel_type: nv.fuel_type || null, km: nv.km || null, meter_date: nv.km ? val(c, "date") || todayStr() : null, ownership: "Özmal", active: true, note: category + " belgesinden otomatik açıldı" }, "Asistan: belgeden yeni araç");
              newVehByPlate.set(pl, rec.id);
              done.cards++;
            }
          }
          otype = "vehicle"; oid = newVehByPlate.get(pl);
        } else if (otype === "newper") {
          // Kayıtlı olmayan personel: aynı TC / ad bu kayıtta ya da veritabanında varsa ona bağla, yoksa yeni kart aç
          const np = r.new_person || {};
          const name = val(c, "np_name").trim().replace(/\s+/g, " ");
          const key = np.identity_number || name.toLocaleLowerCase("tr-TR");
          if (!newVehByPlate.has("p:" + key)) {
            const ex = (await db.listActive("personnel")).find((p) => (np.identity_number && p.identity_number === np.identity_number) || String(p.name || "").toLocaleLowerCase("tr-TR").trim() === name.toLocaleLowerCase("tr-TR"));
            if (ex) newVehByPlate.set("p:" + key, ex.id);
            else {
              const rec = await db.saveNew("personnel", { name, role: val(c, "np_role").trim() || null, identity_number: np.identity_number || null, birth_date: np.birth_date || null, license_class: np.license_class || null, blood_type: np.blood_type || null, active: true, note: category + " belgesinden otomatik açıldı" }, "Asistan: belgeden yeni personel");
              newVehByPlate.set("p:" + key, rec.id);
              done.pcards++;
            }
          }
          otype = "personnel"; oid = newVehByPlate.get("p:" + key);
        } else if (otype === "vehicle" && r.new_vehicle && oid !== r.owner_id) {
          // Belgedeki araç "kayıtlı değil" sanıldı ama kullanıcı mevcut bir kartı seçti (ör. plakasız "Mobil Vinç"):
          // belgedeki plaka ve bilgiler seçilen karta yazılır
          const cur = await db.get("vehicles", oid);
          if (cur) {
            const nv = r.new_vehicle;
            const info = { ...nv, brand: val(c, "nv_brand").trim() || nv.brand, model_year: Number(val(c, "nv_year")) || nv.model_year, type: val(c, "nv_type") || nv.type };
            const upd = Object.fromEntries(vehicleUpdate(cur, info).filter((u) => u.on).map((u) => [u.k, u.to]));
            const pl = plateKey(val(c, "nv_plate"));
            if (pl && !plateKey(cur.plate)) upd.plate = pl;
            else if (pl && plateKey(cur.plate) !== pl) toast(`${cur.name} kartında başka plaka var (${cur.plate}); plaka değiştirilmedi`, "err");
            if (upd.km) upd.meter_date = val(c, "date") || todayStr();
            if (Object.keys(upd).length) { await db.saveExisting("vehicles", cur, upd, "Asistan: " + category + " belgesinden güncellendi"); done.vupd++; }
          }
        } else if (oid === r.owner_id && otype === r.owner_type && r.card_update?.length) {
          // Kayıtlı araç / personel / şirket: işaretli alanları belgedeki gerçek bilgiyle düzelt
          const on = new Set(qsa("[data-vu]", c).filter((x) => x.checked).map((x) => x.dataset.vu));
          const upd = Object.fromEntries(r.card_update.filter((u) => on.has(u.k)).map((u) => [u.k, u.to]));
          if (upd.km) upd.meter_date = val(c, "date") || todayStr();
          if (Object.keys(upd).length) {
            if (otype === "company") { await db.metaSet("company_profile", { ...((await db.metaGet("company_profile")) || {}), ...upd }); done.vupd++; }
            else {
              const cur = await db.get(otype === "vehicle" ? "vehicles" : "personnel", oid);
              if (cur) { await db.saveExisting(otype === "vehicle" ? "vehicles" : "personnel", cur, upd, "Asistan: " + category + " belgesinden güncellendi"); done.vupd++; }
            }
          }
        }
        const f = { category, owner_type: otype, owner_id: oid, ...(otype === "vehicle" || otype === "personnel" ? { [otype + "_id"]: oid } : {}), date: val(c, "date"), doc_no: val(c, "doc_no").trim(),
          expiry_date: val(c, "expiry_date") || null, title: category, note: "Asistan fotoğraftan okudu" };
        // Aynı belge zaten kayıtlıysa (ya da bu gönderide ikinci kez geldiyse) yeni belge açılmaz
        const { sameDocument } = await import("./core.js");
        if (savedDocs.some((x) => sameDocument(x, f))) { done.docSame++; continue; }
        const ex = (await db.listActive("documents")).find((x) => sameDocument(x, f));
        if (ex) {
          const fix = {};
          if (f.expiry_date && f.expiry_date > (ex.expiry_date || "")) { fix.expiry_date = f.expiry_date; fix.date = f.date; }
          if (Object.keys(fix).length) await db.saveExisting("documents", ex, fix, "Asistan: aynı belge yeniden okundu");
          if (file && !(await db.attachmentsFor("document", ex.id)).length) await db.addAttachment("document", ex.id, file, { kind: "scan_original" });
          savedDocs.push(ex); done.docSame++;
          continue;
        }
        await (file ? db.saveDocument(f, file) : db.saveNew("documents", f, "Asistan: belge"));
        savedDocs.push(f);
        done.doc++;
        continue;
      }
      if (k === "work") {
        const customer = await ensureCustomer(val(c, "customer"), v.works[Number(c.dataset.i)].new_customer_parent_id || null);
        let site = val(c, "site") || null;
        if (site && site.startsWith("new:")) {
          const name = site.slice(4), key = "s:" + customer + ":" + name;
          if (!newIds.has(key)) {
            const rec = await db.saveNew("sites", { name, customer_id: customer }, "Asistan: yeni şantiye");
            newIds.set(key, rec.id);
            done.site++;
          }
          site = newIds.get(key);
        }
        const veh = vehicles.find((x) => x.id === val(c, "vehicle"));
        // Yeni malzeme ocağı / döküm yeri kartı (aynı adla bir kez açılır)
        const ensurePlace = async (store, raw) => {
          if (!raw || !raw.startsWith("new:")) return raw || null;
          const name = raw.slice(4), key = store + ":" + name;
          if (!newIds.has(key)) {
            const rec = await db.saveNew(store, { name, note: "Asistan ile açıldı" }, "Asistan: yeni " + (store === "quarries" ? "malzeme ocağı" : "döküm yeri"));
            newIds.set(key, rec.id);
            done.cards++;
          }
          return newIds.get(key);
        };
        const quarryId = await ensurePlace("quarries", val(c, "quarry"));
        const dumpId = await ensurePlace("dump_sites", val(c, "dump_site"));
        const placeName = async (store, id) => (id ? (await db.get(store, id))?.name || "" : "");
        const fields = {
          date: val(c, "date") || todayStr(),
          customer_id: customer,
          site_id: site,
          vehicle_id: veh.id,
          personnel_id: val(c, "personnel") || null,
          vehicle_type: veh.type || null,
          contractor_id: veh.contractor_id || null,
          work_type: val(c, "work_type"),
          description: val(c, "description") || source,
          internal_note_src: source,
          material: val(c, "material") || "",
          quantity: Number(val(c, "quantity")),
          unit: val(c, "unit"),
          dump_site_id: dumpId, quarry_id: quarryId,
          dump_area: (await placeName("dump_sites", dumpId)) || val(c, "to_place") || "", quarry: (await placeName("quarries", quarryId)) || val(c, "from_place") || "",
          slip_status: val(c, "slip_no") || (v.works[Number(c.dataset.i)].photos || []).length ? "Fiş Var" : null, slip_no: val(c, "slip_no") || "", customer_note: "", distance_km: null,
          tonnage: Number(val(c, "tonnage")) > 0 ? Number(val(c, "tonnage")) : null,
          dump_cost: Number(val(c, "dump_cost")) > 0 ? Number(val(c, "dump_cost")) : null,
          source: "asistan",
        };
        delete fields.internal_note_src;
        const wr0 = v.works[Number(c.dataset.i)];
        fields.internal_note = (wr0.reporter ? "Bildiren: " + wr0.reporter + " · " : "") + source;
        if (wr0.driver_entry_id) {
          if (existingWorks.some((w) => w.driver_entry_id === wr0.driver_entry_id)) { toast("Şoför kaydı zaten alınmış, atlandı", "err"); continue; }
          fields.driver_entry_id = wr0.driver_entry_id; fields.source = "şoför";
          if (wr0.digital) dslipIds.push(wr0.driver_entry_id);
          if (wr0.digital) Object.assign(fields, { digital_slip_no: wr0.digital.no, slip_receiver: wr0.digital.receiver || "", slip_signed_at: wr0.digital.signed_at || null, slip_status: "Fiş Var", slip_no: fields.slip_no || wr0.digital.no });
        }
        const up = Number(val(c, "unit_price"));
        fields.price_snapshot = up > 0
          ? { unit_price: up, kdv_rate: Number(await db.metaGet("kdv_default")) || 20, kdv_included: false, amount: up * fields.quantity, price_source: "Manuel", snapshot_at: new Date().toISOString() }
          : priceSnapshot(fields, prices, crane);
        // Mazot karşılığı (Kılıç: sefer başı 75 L, ücret yalnız mazot) — kartta değişen müşteri/miktara göre yeniden hesaplanır
        { const dNow = await db.dumpAll(); Object.assign(fields, applyFuelPay(dNow, fields, message)); const { applyYard } = await import("./yard-core.js"); Object.assign(fields, applyYard(dNow, fields)); }
        const dup = existingWorks.some((w) => w.date === fields.date && w.vehicle_id === fields.vehicle_id && w.customer_id === fields.customer_id && w.work_type === fields.work_type && Number(w.quantity) === fields.quantity);
        if (dup && !(await confirmDialog("Olası mükerrer iş", `${fields.date} · ${veh.name} · ${fields.quantity} ${fields.unit} zaten kayıtlı görünüyor. Yine de kaydedilsin mi?`, "Kaydet"))) continue;
        const savedWork = await db.saveNew("work_records", fields, "Asistan");
        batchWorks[c.dataset.i] = savedWork;
        for (const p of v.works[Number(c.dataset.i)].photos || []) if (files[p]) await db.addAttachment("work", savedWork.id, files[p], { kind: "slip_photo" });
        {
          const dg = v.works[Number(c.dataset.i)].digital;
          // İmza: mesajın kodunun içinden (kopyala-yapıştırla da gelir) ya da ayrı resim olarak
          if (dg?.sigStrokes) { try { const blob = await strokesPng(dg.sigStrokes); if (blob) await db.addAttachment("work", savedWork.id, new File([blob], `imza-${dg.no}.png`, { type: "image/png" }), { kind: "signature" }); } catch (e) { /* bozuk imza: atla */ } }
          else if (dg?.sigData) { try { const bin = atob(dg.sigData); const u = new Uint8Array(bin.length); for (let k = 0; k < bin.length; k++) u[k] = bin.charCodeAt(k); await db.addAttachment("work", savedWork.id, new File([u], `imza-${dg.no}.png`, { type: "image/png" }), { kind: "signature" }); } catch (e) { /* bozuk imza: atla */ } }
          else if (dg?.sigPhoto != null && files[dg.sigPhoto]) await db.addAttachment("work", savedWork.id, files[dg.sigPhoto], { kind: "signature" });
        }
        done.work++;
        const wr = v.works[Number(c.dataset.i)];
        const nm = (st, id) => (d[st] || []).find((x) => x.id === id)?.name || "";
        // Ölçüm + onaylı örnek + reddedilen eşleşme
        try {
          const m = measureCorrection(wr.ai, fields, wr.issues.length > 0);
          await db.metaSet("ai_quality", addQuality(await db.metaGet("ai_quality"), m));
          const out = `${nm("customers", customer) || "?"} | ${veh.name} | ${fields.work_type} | ${fields.quantity} ${fields.unit}`;
          await db.metaSet("ai_examples", addExample(await db.metaGet("ai_examples"), { msg: message.slice(0, 300), out }));
          if (!wr.ambiguous && wr.ai?.customer_id && wr.ai.customer_id !== customer && wr.mentions?.customer) {
            const neg = (await db.metaGet("ai_negative_aliases")) || [];
            neg.unshift({ alias: wr.mentions.customer, target_type: "customer", target_id: wr.ai.customer_id });
            await db.metaSet("ai_negative_aliases", neg.slice(0, 200));
          }
        } catch (e) {}
        const custSel = val(c, "customer");
        if (!wr.ambiguous) await learn(wr.mentions?.customer, "customer", customer, nm("customers", customer) || (custSel.startsWith("new:") ? custSel.slice(4) : ""));
        // "Yeni: Mahir Bey" önerisi yerine mevcut Hisar Polat seçildiyse "Mahir Bey" → Hisar Polat öğrenilir
        if (!wr.ambiguous && !custSel.startsWith("new:") && wr.new_customer_text) await learn(wr.new_customer_text, "customer", customer, nm("customers", customer));
        if (site) await learn(wr.mentions?.site, "site", site, nm("sites", site));
        await learn(wr.mentions?.vehicle, "vehicle", veh.id, veh.name);
        if (fields.personnel_id) await learn(wr.mentions?.personnel, "personnel", fields.personnel_id, nm("personnel", fields.personnel_id));
      } else if (k === "expense") {
        const r = v.expenses[Number(c.dataset.i)];
        const file = r.photo != null ? files[r.photo] : null;
        // Döküm faturası → döküm hesabına bağlı belge (gider değil); saha VKN/yer adı öğrenilir
        if (r.dumpInv && ["inv", "paid"].includes(val(c, "dinv_mode"))) {
          const sid = val(c, "dinv_site");
          if (!sid) { toast("Döküm faturası için döküm sahasını seçin", "err"); continue; }
          const D = r.detail || {}, amount = Number(val(c, "amount")) || r.amount, date = val(c, "date") || todayStr();
          const doc = { category: "Döküm Faturası", owner_type: "dump_site", owner_id: sid, date, doc_no: D.no || "", title: val(c, "company") || "Döküm faturası", amount,
            ton: r.dumpInv.ton || null, net_amount: D.net ?? null, kdv_amount: D.kdv ?? null, ettn: D.ettn || null, seller_tax_no: D.seller_tax_no || null, items: D.items?.length ? D.items : null, place: r.dumpInv.place || null,
            note: [r.dumpInv.ton ? `${r.dumpInv.ton.toLocaleString("tr-TR")} ton` : "", r.dumpInv.place].filter(Boolean).join(" · ") };
          let drec;
          try {
            drec = file ? await db.saveDocument(doc, file) : await db.saveNew("documents", doc, "Asistan: döküm faturası");
          } catch (e) { toast(e.message || String(e), "err"); continue; }
          const site = await db.get("dump_sites", sid);
          // Geçmiş dönem: parça parça yatırılan paralar tek tek bilinmiyor → fatura tutarı döküm hesabına yatırılmış sayılır.
          // Giderlerde görünür ve nakit çıkışıdır; kâr-zararda dökümler zaten ton × ücretle sayıldığından ikinci kez maliyet olmaz.
          if (val(c, "dinv_mode") === "paid") {
            const pay = val(c, "pay");
            await db.saveNew("expense_records", { date, amount, category: "Döküm", company: site.name, dump_site_id: sid, dump_deposit: true, invoice_paid: true, invoice_no: D.no || null, dump_invoice_doc_id: drec?.id || null,
              payment_method: pay && !pay.startsWith("p:") && pay !== "Şirket Ödedi" ? pay : "Şirket Ödedi", receipt: "Evet",
              description: `${site.name} döküm faturası ${D.no || ""} — geçmiş dönem ödemesi (kart/havale parça parça; fatura belgede)`.replace(/\s+/g, " ") }, "Asistan: geçmiş dönem döküm ödemesi");
            done.dumpinvPaid++;
          } else done.dumpinv++;
          const learnF = {};
          if (D.seller_tax_no && !site.invoice_tax_no) learnF.invoice_tax_no = D.seller_tax_no;
          if (r.dumpInv.place && !String(site.invoice_place || "").toLocaleLowerCase("tr-TR").includes(r.dumpInv.place.toLocaleLowerCase("tr-TR"))) learnF.invoice_place = [site.invoice_place, r.dumpInv.place].filter(Boolean).join(" / ").slice(0, 160);
          if (Object.keys(learnF).length) await db.saveExisting("dump_sites", site, learnF, "Döküm faturasından öğrenildi");
          continue;
        }
        const f = { date: val(c, "date") || todayStr(), amount: Number(val(c, "amount")), category: val(c, "category") || "Diğer", vehicle_id: val(c, "vehicle") || null, description: val(c, "description") || (val(c, "company") ? val(c, "company") + " · " : "") + (r.note || val(c, "category")), kdv_rate: null, file };
        const supId = val(c, "supplier");
        const fresh = await db.dumpAll();
        if (supId) {
          const { createCreditBill } = await import("./esnaf.js");
          const s = fresh.suppliers.find((x) => x.id === supId);
          const res = await createCreditBill(ctx, fresh, s, f);
          if (res) done.expense++;
        } else {
          const { findDuplicates } = await import("./esnaf.js");
          const dup = findDuplicates(fresh, { date: f.date, amount: f.amount });
          if ((dup.bills.length || dup.expenses.length) && !(await confirmDialog("Aynı gün aynı tutarda kayıt var", `${f.date} · ${fmtTL(f.amount)} ₺ zaten kayıtlı (gider veya esnaf borcu). Farklı bir harcama mı?`, "Farklı, kaydet"))) continue;
          if (r.driver_entry_id && fresh.expense_records.some((x) => isActive(x) && x.driver_entry_id === r.driver_entry_id)) { toast("Şoför gideri zaten alınmış, atlandı", "err"); continue; }
          // Ödeme: kartta seçilen (personel cebinden ödediyse iade bekler, maaşla geri ödenir)
          const pay = val(c, "pay") || (r.driver_pay === "cep" && r.driver_pid ? "p:" + r.driver_pid : "Şirket Ödedi");
          const payer = pay.startsWith("p:") ? pay.slice(2) : null;
          // "Bolluca'ya 50.000 yatırdım" → döküm sahası ön ödemeli hesabına yükleme (gider sayılmaz, dökümde düşer)
          const dsite = (await import("./dump-account.js")).depositSiteOf(fresh, { category: f.category, company: val(c, "company"), description: val(c, "description") || source });
          if (dsite) done.dumpdep++;
          // Fatura ayrıntısı: aynı satıcının aynı fatura numarası daha önce girildiyse sor
          const D = r.detail;
          if (D?.no && fresh.expense_records.some((x) => isActive(x) && x.invoice_no === D.no && (!D.seller_tax_no || !x.seller_tax_no || x.seller_tax_no === D.seller_tax_no))
            && !(await confirmDialog("Bu fatura zaten girilmiş", `${D.no} numaralı fatura gider olarak kayıtlı. Yine de kaydedilsin mi?`, "Kaydet"))) continue;
          const rec = await db.saveNew("expense_records", {
            ...(D ? { invoice_no: D.no || null, ettn: D.ettn || null, seller_tax_no: D.seller_tax_no || null, net_amount: D.net, kdv_amount: D.kdv, kdv_rate: D.kdv_rate, items: D.items.length ? D.items : null } : {}),
            ...(dsite ? { dump_site_id: dsite.id, dump_deposit: true } : {}),
            date: f.date, category: f.category, kdv_rate: null, amount: f.amount, personnel_id: payer, vehicle_id: f.vehicle_id,
            payment_method: payer ? "Personel Ödedi" : pay, receipt: file ? "Evet" : "Hayır", reimbursement_status: payer ? "Bekliyor" : null,
            company: val(c, "company"), description: val(c, "description") || source, ...(r.driver_entry_id ? { driver_entry_id: r.driver_entry_id, source: "şoför" } : {}),
          }, "Asistan");
          if (file) await db.addAttachment("expense", rec.id, file);
          // Kalemlerde filtre/yağ/balata… varsa ve araç seçiliyse: bakım kaydı (maliyet giderde; bakım takvimi için)
          if (D?.items?.length && f.vehicle_id && qs("[data-mhint]", c)?.checked) {
            const { maintenanceHint } = await import("./receipt-detail.js");
            const h = maintenanceHint(D.items);
            await db.saveNew("maintenance_records", { date: f.date, vehicle_id: f.vehicle_id, maint_type: MAINT_TYPES.includes("Periyodik Bakım") ? "Periyodik Bakım" : MAINT_TYPES[0], status: MAINT_STATUS.includes("Tamamlandı") ? "Tamamlandı" : MAINT_STATUS.at(-1),
              description: h.title + ": " + D.items.map((i) => i.desc).join(", ").slice(0, 400), cost: 0, service_company: val(c, "company") || null, expense_id: rec.id, note: "Maliyet gider kaydında (" + (D.no || "fiş") + ")" }, "Asistan: faturadan bakım");
            done.maintenance++;
          }
          done.expense++;
        }
      } else if (k === "collection") {
        const customer = await ensureCustomer(val(c, "customer"));
        const amount = Number(val(c, "amount")), date = val(c, "date") || todayStr();
        const fresh = await db.dumpAll();
        const same = (fresh.cash_records || []).filter((x) => isActive(x) && x.cash_type === "Müşteriden Para Alındı" && x.customer_id === customer && x.date === date && Number(x.amount) === amount);
        if (same.length && !(await confirmDialog("Aynı tahsilat kayıtlı olabilir", `${date} · ${fmtTL(amount)} ₺ bu müşteriden zaten alınmış görünüyor. Yine de kaydedilsin mi?`, "Kaydet"))) continue;
        if (val(c, "method") === "Havale") {
          const { customerBankReceipt } = await import("./enterprise-db.js");
          await customerBankReceipt({ date, customer_id: customer, bank_account_id: val(c, "bank"), amount, note: source }, ctx.core.uuid());
        } else {
          const pid = val(c, "personnel") || null;
          await db.saveNew("cash_records", {
            request_id: ctx.core.uuid(), date, cash_type: "Müşteriden Para Alındı", amount, personnel_id: pid, customer_id: customer,
            payment_method: "Nakit", description: source, cash_status: pid ? "PERSONELDE" : "KASAYA_TESLIM_EDILDI",
          }, "Asistan tahsilat");
        }
        done.collection++;
      } else if (k === "maintenance") {
        const cost = Number(val(c, "cost")) || null;
        const mr = (v.maintenance || [])[Number(c.dataset.i)] || {};
        if (mr.driver_entry_id && (await db.dumpAll()).maintenance_records.some((x) => isActive(x) && x.driver_entry_id === mr.driver_entry_id)) { toast("Şoför arıza kaydı zaten alınmış, atlandı", "err"); continue; }
        const files0 = mr.driver_entry_id ? null : files[0] && v.expenses.every((e) => e.photo !== 0) ? files[0] : null;
        const cepM = mr.driver_pay === "cep" && cost;
        const rec = await db.saveNew("maintenance_records", {
          date: val(c, "date") || todayStr(), vehicle_id: val(c, "vehicle"), personnel_id: mr.driver_pid || null, severity: "Normal", part: "",
          maint_type: val(c, "maint_type") || "Arıza", status: val(c, "status") || "Açık", description: val(c, "description"),
          cost, kdv_rate: null, service_company: val(c, "service_company"), km_hours: [mr.km ? mr.km + " km" : "", mr.machine_hours ? mr.machine_hours + " saat" : ""].filter(Boolean).join(" · "),
          ...(mr.km ? { km: mr.km } : {}), ...(mr.machine_hours ? { machine_hours: mr.machine_hours } : {}),
          ...(cepM ? { paid_by_personnel_id: mr.driver_pid, reimbursement_status: "Bekliyor" } : {}),
          ...(mr.driver_entry_id ? { driver_entry_id: mr.driver_entry_id, source: "şoför" } : {}),
        }, "Asistan arıza/bakım");
        if (files0) await db.addAttachment("maintenance", rec.id, files0);
        for (const pi of mr.photos || []) if (files[pi]) await db.addAttachment("maintenance", rec.id, files[pi]);
        const supId = val(c, "supplier");
        if (supId && cost) {
          const { createCreditBill } = await import("./esnaf.js");
          const fresh = await db.dumpAll();
          const s = fresh.suppliers.find((x) => x.id === supId);
          await createCreditBill(ctx, fresh, s, { date: rec.date, amount: cost, description: val(c, "description"), category: "Bakım / Onarım", vehicle_id: rec.vehicle_id, kdv_rate: null }, { source: { store: "maintenance_records", id: rec.id } });
        }
        done.maintenance++;
      } else if (k === "personnel") {
        await db.saveNew("personnel_events", {
          date: val(c, "date") || todayStr(), personnel_id: val(c, "personnel"), event_type: val(c, "event_type") || "Diğer",
          amount: Number(val(c, "amount")) || null, hours_days: Number(val(c, "hours_days")) || null, description: source,
          // İzin türü mesajdan: "yıllık izin", "ücretsiz izin", "mazeret"; rapor ayrı tür
          ...(val(c, "event_type") === "Rapor" ? { leave_kind: "Rapor" } : val(c, "event_type") === "İzin" ? { leave_kind: /ücretsiz/i.test(source) ? "Ücretsiz izin" : /mazeret|cenaze|düğün|evlen|doğum/i.test(source) ? "Mazeret izni" : /yıllık|senelik/i.test(source) ? "Yıllık izin" : null } : {}),
        }, "Asistan personel hareketi");
        done.personnel++;
      } else if (k === "edit") {
        const r = v.edits[Number(c.dataset.i)];
        const cur = await db.get(r.store, r.id);
        if (!cur || cur.deleted_at) continue;
        if (r.remove) await db.softDelete(r.store, r.id, "Asistan: " + r.reason);
        else await db.saveExisting(r.store, cur, r.changes, "Asistan düzeltmesi: " + message.slice(0, 200));
        done.edit++;
      } else {
        const r = v.fuel[Number(c.dataset.i)];
        const liters = Number(val(c, "liters")), total = Number(val(c, "total")) || null;
        const src = val(c, "source") || "Depo Tankı";
        const byCustomer = src === "Müşteri Verdi";
        const rec = await db.saveNew("fuel_records", {
          date: val(c, "date") || todayStr(), vehicle_id: val(c, "vehicle"), personnel_id: null, liters,
          unit_price: !byCustomer && total ? Math.round((total / liters) * 100) / 100 : null, total: byCustomer ? null : total,
          ...(byCustomer ? { customer_id: val(c, "fuel_customer") || null } : {}),
          fuel_source: src, receipt: src === "Depo Tankı" ? "Depo" : byCustomer ? "Müşteri" : r.photo != null ? "Evet" : "Hayır", pump_no: "", km: r.km || null,
          machine_hours: r.machine_hours || null, description: source, ...(r.driver_entry_id ? { driver_entry_id: r.driver_entry_id } : {}), customer_billable: false,
        }, "Asistan");
        if (r.photo != null && files[r.photo]) await db.addAttachment("fuel", rec.id, files[r.photo]);
        done.fuel++;
      }
    }
    const parts = [[done.action, "kart değişikliği"], [done.setting, "ayar"], [done.price, "fiyat kuralı"], [done.priced, "eski işe fiyat uygulandı"], [done.tank, "depo girişi"], [done.tankLinked, "fatura elle girilmiş depo girişine bağlandı (yeni giriş açılmadı)"], [done.ticket, "döküm fişi"], [done.doc, "belge"], [done.docSame, "belge zaten kayıtlıydı (yeniden eklenmedi)"], [done.work, "iş"], [done.expense, "gider"], [done.dumpdep, "döküm hesabına yükleme (gider sayılmaz, dökümde düşer)"], [done.dumpinv, "döküm faturası döküm hesabına bağlandı (gider yazılmadı)"], [done.dumpinvPaid, "geçmiş dönem döküm faturası ödenmiş sayıldı (giderlerde görünür; kâr-zararda dökümler ayrıca sayıldığı için iki kez girmez)"], [done.fuel, "yakıt"], [done.collection, "tahsilat"], [done.maintenance, "arıza/bakım"], [done.personnel, "personel hareketi"], [done.edit, "düzeltme"], [done.customer, "yeni müşteri"], [done.site, "yeni şantiye"], [done.vupd, "kart belgeye göre güncellendi (araç/personel/şirket)"], [done.pcards, "yeni personel kartı"], [done.cards, "yeni kart (araç/personel/esnaf/ocak/döküm yeri)"], [done.learned, "yeni eşleştirme hafızaya alındı"]].filter(([n]) => n).map(([n, t]) => n + " " + t);
    const plan = await undo.saveUndo(db, snap0, parts.join(", "));
    v._done = true;
    // WhatsApp toplu işlemeden geldiyse: bu günün mesajları işlendi sayılır
    let waNext = "";
    if (ctx.query?.wa) {
      const wa = await db.metaGet("wa_bulk_pending");
      if (wa?.keys?.length) {
        const { markDone } = await import("./wa-bulk-core.js");
        await db.metaSet("wa_bulk_done", markDone((await db.metaGet("wa_bulk_done")) || {}, wa.keys.map((key) => ({ key })), todayStr()));
        await db.metaSet("wa_bulk_pending", null);
        waNext = '<button class="btn primary block" style="margin-top:8px" data-go="#/whatsapp-toplu?next=1">💬 Bu parça işlendi — sonraki güne geç ›</button><button class="btn block" style="margin-top:6px" data-go="#/whatsapp-toplu">Listeye dön</button>';
      }
    }
    // Şoförün dijital fişi: kaydedilen işe doğrudan git (imzalı fiş PDF orada)
    let dslipBtns = "";
    if (dslipIds.length) {
      const ws = (await db.listActive("work_records")).filter((w) => dslipIds.includes(w.driver_entry_id) && w.digital_slip_no);
      dslipBtns = ws.map((w) => `<button class="btn block" style="margin-top:8px;border-color:#2e9e6b" data-go="#/isler/${esc(w.id)}">🧾 Dijital fişi gör: ${esc(w.digital_slip_no)}${w.slip_receiver ? " · " + esc(w.slip_receiver) : ""}</button>`).join("");
    }
    out.innerHTML = notice("ok", "Kaydedildi: " + (parts.join(", ") || "hiçbir şey") + ".") + dslipBtns +
      '<div class="row" style="gap:8px"><button class="btn grow" data-go="#/isler">İşler</button><button class="btn grow" data-go="#/gider">Giderler</button></div>' +
      (plan ? '<button class="btn block" style="margin-top:8px" data-undo>↩️ Yanlış oldu — bu kaydı geri al</button>' : "") + waNext;
    bindUndo(ctx, out);
    qs("[data-msg]", ctx.root).value = "";
    await db.metaSet("assistant_draft", "");
  } catch (e) {
    btn.disabled = false;
    const plan = await undo.saveUndo(db, snap0, "yarım kalan kayıt").catch(() => null);
    toast((e.message || String(e)) + ` (kaydedilen: ${done.work} iş, ${done.expense} gider, ${done.fuel} yakıt)`, "err");
    if (plan) { out.insertAdjacentHTML("afterbegin", '<button class="btn block" data-undo>↩️ Yarım kalan kaydı geri al</button>'); bindUndo(ctx, out); }
  }
}

function bindUndo(ctx, box) {
  for (const b of qsa("[data-undo]", box))
    b.addEventListener("click", async () => {
      const plan = await ctx.db.metaGet("assistant_undo");
      if (!plan) return toast("Geri alınacak kayıt yok", "err");
      if (!(await confirmDialog("Geri alınsın mı?", `Asistanın ${new Date(plan.at).toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" })} kaydı (${plan.label || "değişiklikler"}) tamamen geri alınacak.`, "Geri al", true))) return;
      try {
        await (await import("./undo.js")).applyUndo(ctx.db);
        toast("Geri alındı", "ok");
        ctx.reload();
      } catch (e) {
        toast(e.message || String(e), "err");
      }
    });
}

// Fatura / fiş ayrıntısı (kalemler, no, ETTN, KDV) + bakım kaydı önerisi
function detailHtml(r) {
  const D = r.detail;
  if (!D) return "";
  const n = (x) => Number(x || 0).toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const hint = D.items.length ? maintHint(D.items) : null;
  return `<details class="card" style="margin:8px 0 0;padding:8px 10px;background:var(--bg2,transparent)" open><summary class="small"><b>🧾 Fatura ayrıntısı</b>${D.no ? " · " + esc(D.no) : ""}${D.items.length ? ` · ${D.items.length} kalem` : ""}</summary>
    <div class="tiny muted" style="margin:4px 0">${D.seller_tax_no ? "Satıcı VKN " + esc(D.seller_tax_no) : ""}${D.ettn ? " · ETTN " + esc(D.ettn.slice(0, 8)) + "…" : ""}</div>
    ${D.items.map((i) => `<div class="row between tiny" style="padding:3px 0;border-top:1px solid var(--border)"><span>${i.code ? `<span class="muted">${esc(i.code)}</span> ` : ""}${esc(i.desc)} <span class="muted">× ${n(i.qty).replace(/,00$/, "")}</span></span><b style="white-space:nowrap">${n(i.amount)} ₺</b></div>`).join("")}
    ${D.net != null ? `<div class="row between tiny" style="border-top:1px solid var(--border);padding-top:3px"><span>KDV hariç</span><b>${n(D.net)} ₺</b></div>` : ""}
    ${D.kdv != null ? `<div class="row between tiny"><span>KDV${D.kdv_rate != null ? " %" + D.kdv_rate : ""}</span><b>${n(D.kdv)} ₺</b></div>` : ""}
    ${D.issues.map((x) => `<div class="tiny" style="color:#b7791f">⚠ ${esc(x)}</div>`).join("")}
    ${hint ? `<label class="history-check small" style="margin-top:6px"><input type="checkbox" data-mhint ${/filtre/i.test(hint.title) ? "checked" : ""}> 🔧 Seçili araca bakım kaydı da aç: <b>${esc(hint.title)}</b> <span class="tiny muted">(bakım takvimine işlenir; maliyet bu giderde, iki kez sayılmaz)</span></label>` : ""}
  </details>`;
}
let maintHint = () => null;
import("./receipt-detail.js").then((m) => { maintHint = m.maintenanceHint; });

// Şoförün imza çizgilerinden (kodun içinde gelir) beyaz zeminli PNG
async function strokesPng(sv) {
  const { decodeStrokes } = await import("./driver-core.js");
  const strokes = decodeStrokes(sv);
  if (!strokes.length) return null;
  const cv = document.createElement("canvas"); cv.width = 600; cv.height = 220;
  const g = cv.getContext("2d"); g.fillStyle = "#fff"; g.fillRect(0, 0, 600, 220);
  g.lineWidth = 3.2; g.lineCap = "round"; g.lineJoin = "round"; g.strokeStyle = "#0b2340";
  for (const p of strokes) {
    g.beginPath(); g.moveTo(p[0], p[1]);
    if (p.length === 2) g.lineTo(p[0] + 0.5, p[1] + 0.5);
    for (let i = 2; i + 1 < p.length; i += 2) g.lineTo(p[i], p[i + 1]);
    g.stroke();
  }
  return new Promise((r) => cv.toBlob(r, "image/png"));
}

// İşe bağlanan fiş fotoğrafının bilgileri (fiş no, net ton, tarih, malzeme) eksikse ayrı ve daha dikkatli bir okuma
export async function rereadSlips(db, v, imgParts, d, today) {
  const need = (v.works || []).filter((w) => (w.photos || []).length && (!w.slip_no || !w.tonnage));
  if (!need.length) return;
  const idx = [...new Set(need.flatMap((w) => w.photos))].filter((i) => imgParts[i]).slice(0, 6);
  if (!idx.length) return;
  const { SLIP_PROMPT, slipSchema, validateSlips } = await import("./slip-read.js");
  const { geminiJson, withModelFallback } = await import("./ai-gemini.js");
  const raw = await withModelFallback(db, (o) => geminiJson([{ text: SLIP_PROMPT }, ...idx.map((i) => imgParts[i]), { text: `Fotoğraf sayısı: ${idx.length} (sıra 0'dan)` }], { ...o, schema: slipSchema() }));
  const res = validateSlips(raw, { d, today, count: idx.length });
  for (const w of need) {
    const rows = res.rows.filter((r) => w.photos.includes(idx[r.photo]));
    if (!rows.length) continue;
    const tons = rows.filter((r) => r.net_ton != null);
    const nos = rows.map((r) => r.slip_no).filter(Boolean);
    const got = [];
    if (!w.tonnage && tons.length) { w.tonnage = Math.round(tons.reduce((n, r) => n + r.net_ton, 0) * 100) / 100; got.push(w.tonnage + " ton"); }
    if (!w.slip_no && nos.length) { w.slip_no = nos.join(", ").slice(0, 120); got.push("fiş no " + w.slip_no); }
    const dates = [...new Set(rows.map((r) => r.date).filter(Boolean))];
    if (w.dateUnsure && dates.length === 1) {
      w.date = dates[0];
      w.dateUnsure = false;
      w.issues = w.issues.filter((x) => !/İş tarihi mesajda yazmıyor|Tarih fişten alındı/.test(x));
      got.push("tarih " + dates[0].split("-").reverse().join("."));
    }
    const mat = rows.map((r) => r.material).find(Boolean);
    if (mat && !w.material) w.material = mat;
    if (got.length) w.issues.push("Fişten okundu: " + got.join(", "));
    if ("ok" in w)
      w.ok = !!((w.customer_id || w.new_customer) && w.vehicle_id && w.work_type && w.unit && w.quantity && !w.guessed && !w.hinted && !w.badQuote && !w.ambiguous && !w.badNew && !w.vehicleGuess && !w.dateUnsure && !w.customerGuess);
  }
}
