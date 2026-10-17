import { guardedAiFetch, aiBudgetStatus } from "./ai-guard.js";
// "Yapay Zeka (deneysel)" ekranı: telefonda çalışan ücretsiz modeli indirme ve örnek mesajlarla deneme.
// Bu ekran hiçbir kayıt oluşturmaz; yalnız önerileri ve doğrulama sonucunu gösterir.
import { qs, esc, appbar, toast, confirmDialog, notice, kv } from "./ui.js";
import { aiSuggest } from "./ai-assist.js";
import { geminiSettings, listModels, geminiChat, geminiReadReceipt, findWorkingModel, withModelFallback, usageToday } from "./ai-gemini.js";

const SAMPLES = [
  "Ahmet Bey 34 ABC 123 6 gidiş yaptı moloz",
  "kepçe bütün gün Leda Yeşilpınar'da çalıştı",
  "34 ABC 123 Firma F Eyüp altı kere gitti hafriyat",
  "jcb sabahtan akşama kadar Bahçeşehir Ahmet Bey",
  "34EC1353 Gümüş Yapı on iki tur moloz",
  "Öztürk Kağıthane 34 ABC 123 dört tur hafriyat",
  "34 ABC 123 Ahmet beyin işinde 3 kere döktü",
  "Mahir bey 14 tonluk öğlene kadar çalıştı",
];

const LABELS = {
  date: "Tarih", total: "Toplam", subtotal: "Ara toplam", kdv: "KDV tutarı", kdv_rate: "KDV %",
  liters: "Litre", unit_price: "Birim fiyat", plate: "Plaka", firma: "Firma", doc_no: "Belge no",
  fuel_type: "Yakıt türü", category_suggestion: "Kategori önerisi",
};
export async function screen(ctx) {
  if (ctx.parts[0] !== "yapay-zeka") return false;
  const { root, db } = ctx;
  const ai = await import("./ai-local.js");
  const gpu = await ai.gpuStatus();
  const savedId = (await db.metaGet("ai_model_id")) || "";
  const gem = await geminiSettings(db);
  const { DEFAULT_RULES, effectiveRules } = await import("./assistant-rules.js");
  const rulesText = effectiveRules(await db.metaGet("assistant_rules"));
  root.innerHTML =
    appbar("Yapay Zeka (deneysel)", "Yerel model veya izinli bulut desteği", { back: "#/ayarlar" }) +
    `<div style="height:10px"></div>
    ${notice("info", "Yerel model seçildiğinde model telefonunuzda çalışır. Gemini seçildiğinde gönderdiğiniz metin, görsel/ses ve ilgili işletme bağlamı Google hizmetine gider. İlk indirme yaklaşık 1 GB'tır — Wi-Fi'da yapın. Yapay zeka hiçbir kaydı kendisi oluşturmaz: yalnız kural motorunun anlayamadığı ifadelere miktar/birim/iş türü önerir; mesajda yazmayan sayı veya listede olmayan değer otomatik reddedilir.")}
    <div class="card">
      ${kv("WebGPU", gpu.ok ? "Var ✓" + (gpu.f16 ? " (f16)" : "") : "Yok — " + gpu.reason)}
      <div class="field" style="margin-top:8px"><label>Model</label><select data-model disabled><option>Liste yükleniyor…</option></select></div>
      <div class="muted small" data-cache></div>
      <div class="row" style="gap:8px;margin-top:10px">
        <button class="btn primary grow" data-load ${gpu.ok ? "" : "disabled"}>⬇ İndir ve Başlat</button>
        <button class="btn grow" data-del ${gpu.ok ? "" : "disabled"}>🗑 Modeli Sil</button>
      </div>
      <div data-prog style="margin-top:10px"></div>
    </div>
    <div class="section-title">Gemini (Google) — internetle</div>
    <div class="card">
      <div class="muted small">Fiş fotoğrafı okumada en güçlü seçenek. Anahtarı <b>aistudio.google.com</b> → "Get API key" ile alın. Anahtar yalnız bu telefonda saklanır. Google Cloud'da anahtarı bu siteyle (HTTP referrer) ve "Generative Language API" ile sınırlamanız önerilir.</div>
      <div class="field" style="margin-top:8px"><label>API anahtarı</label><input type="password" data-gkey autocomplete="off" value="${esc(gem.key)}" placeholder="AIza…"></div>
      <div class="field"><label>Model</label><select data-gmodel>${gem.model ? `<option value="${esc(gem.model)}">${esc(gem.model)}</option>` : "<option value=''>Önce anahtarı girip modelleri getirin</option>"}</select></div>
      <label class="history-check"><input type="checkbox" data-gconsent ${gem.consent ? "checked" : ""}> Gemini kullandığımda metin, görsel/ses ve ilgili müşteri, personel, iş ve finans bağlamının Google hizmetine gönderilebileceğini; kullanımın sağlayıcı hesabıma göre ücretli olabileceğini biliyorum.</label>
      <div class="row" style="gap:8px;margin-top:8px">
        <button class="btn grow" data-gmodels>Modelleri Getir</button>
        <button class="btn grow" data-gfind>Çalışan Modeli Bul</button>
        <button class="btn primary grow" data-gsave>Kaydet</button>
      </div>
      <button class="btn ghost block" style="margin-top:8px" data-gclear>Anahtarı Sil</button>
      <div class="muted small" style="margin-top:8px" data-gusage></div>
      <div class="muted tiny">Ücretsiz kalmak için bu projeye faturalandırma (kart) eklemeyin. Seçili model yanıt vermezse listedeki başka model denenebilir. Modelin çalışması ücretsiz olduğunu kanıtlamaz. Yerel günlük istek sınırı retry ve model denemelerini de sayar.</div>
      <div class="field" style="margin-top:10px"><label>Fiş fotoğrafı ile dene</label><input type="file" accept="image/*" data-gphoto></div>
      <div data-gout></div>
    </div>
    <div class="section-title">Asistan Kuralları (işletmenize özel)</div>
    <div class="card">
      <div class="muted small">Akıllı Asistan mesajları okurken bu kurallara uyar (Gemini'ye talimat olarak gider). Kendi cümlelerinizle değiştirebilirsiniz. Telefonun kontrolleri (mesajda yazmayan sayı/araç/tarih işaretsiz gelir) her zaman geçerlidir.</div>
      <div class="muted tiny" style="margin-top:4px">Zimmetli araç: Personel kartı → Zimmetli araç. Sefer başı mazot: Müşteri kartı → Sefer başı mazot.</div>
      <textarea data-rules rows="14" style="margin-top:8px;width:100%;font-size:13px">${esc(rulesText)}</textarea>
      <div class="row" style="gap:8px;margin-top:8px"><button class="btn grow" data-rules-reset>Varsayılana Dön</button><button class="btn primary grow" data-rules-save>Kuralları Kaydet</button></div>
    </div>
    <div class="section-title">Deneme</div>
    <div class="card">
      <div class="field"><label>Hangi yapay zeka?</label><select data-provider><option value="local">Telefondaki model</option><option value="gemini" ${gem.ready ? "selected" : ""}>Gemini</option></select></div>
      <div class="field"><label>Her satır bir mesaj</label><textarea data-samples rows="8">${esc(SAMPLES.join("\n"))}</textarea></div>
      <button class="btn primary block" data-run ${gem.ready ? "" : "disabled"}>🤖 Örnek Mesajları Dene</button>
      <div class="muted tiny" style="margin-top:6px">Önce kural motoru çalışır. Yapay zeka yalnız motorun miktarı bulamadığı yerlerde sorulur.</div>
    </div>
    <div data-results></div>`;

  const sel = qs("[data-model]", root),
    prog = qs("[data-prog]", root),
    runBtn = qs("[data-run]", root),
    cacheEl = qs("[data-cache]", root);
  const refreshCache = async () => {
    if (!sel.value) return;
    cacheEl.textContent = (await ai.isCached(sel.value))
      ? "Bu model telefonda kayıtlı (internetsiz açılır)."
      : "Bu model henüz indirilmedi.";
  };
  if (gpu.ok)
    ai.availableModels(gpu.f16)
      .then((list) => {
        if (!list.length) {
          sel.innerHTML = "<option value=''>Uygun model bulunamadı</option>";
          return;
        }
        sel.innerHTML = list
          .map(
            (m) =>
              `<option value="${esc(m.id)}" ${m.id === savedId ? "selected" : ""}>${esc(m.id)}${m.vram ? " · ~" + Math.round(m.vram) + " MB bellek" : ""}</option>`,
          )
          .join("");
        sel.disabled = false;
        refreshCache();
      })
      .catch((e) => {
        sel.innerHTML = "<option value=''>Liste alınamadı</option>";
        prog.innerHTML = notice("warn", e.message || String(e));
      });
  sel.addEventListener("change", refreshCache);
  if (ai.loaded()) runBtn.disabled = false;

  qs("[data-load]", root).addEventListener("click", async () => {
    const id = sel.value;
    if (!id) return;
    if (!(await ai.isCached(id))) {
      const ok = await confirmDialog(
        "Model indirilsin mi?",
        "Yaklaşık 1 GB indirilecek. Wi-Fi'da olduğunuzdan emin olun. İndirme sırasında bu ekranı kapatmayın.",
        "İndir",
      );
      if (!ok) return;
    }
    prog.innerHTML = `<div class="muted small" data-ptext>Başlıyor…</div><div style="height:8px;background:var(--border);border-radius:6px;overflow:hidden;margin-top:6px"><div data-pbar style="height:100%;width:0;background:var(--accent,#f5a623)"></div></div>`;
    const started = Date.now();
    try {
      await ai.load(id, (p, text) => {
        const b = qs("[data-pbar]", prog), t = qs("[data-ptext]", prog);
        if (b) b.style.width = Math.round(p * 100) + "%";
        if (t) t.textContent = Math.round(p * 100) + "% · " + text.slice(0, 90);
      });
      await db.metaSet("ai_model_id", id);
      prog.innerHTML = notice("ok", `Model hazır (${Math.round((Date.now() - started) / 1000)} sn).`);
      runBtn.disabled = false;
      refreshCache();
    } catch (e) {
      prog.innerHTML = notice(
        "warn",
        "Model başlatılamadı: " + (e.message || e) + " — Daha küçük bir model seçip tekrar deneyin.",
      );
    }
  });

  qs("[data-del]", root).addEventListener("click", async () => {
    const id = sel.value;
    if (!id || !(await confirmDialog("Model silinsin mi?", "Telefondaki model dosyaları silinir; kayıtlarınız etkilenmez.", "Sil", true))) return;
    try {
      await ai.remove(id);
      runBtn.disabled = true;
      toast("Model silindi", "ok");
      refreshCache();
    } catch (e) {
      toast(e.message || String(e), "err");
    }
  });

  runBtn.addEventListener("click", async () => {
    const lines = qs("[data-samples]", root).value.split("\n").map((x) => x.trim()).filter(Boolean).slice(0, 15);
    const box = qs("[data-results]", root);
    runBtn.disabled = true;
    box.innerHTML = `<div class="muted small" style="padding:8px">Çalışıyor… (0/${lines.length})</div>`;
    const d = await db.dumpAll();
    const out = [];
    const provider = qs("[data-provider]", root).value;
    const g = await geminiSettings(db);
    if (provider === "gemini" && !g.ready) {
      runBtn.disabled = false;
      box.innerHTML = notice("warn", "Gemini için anahtar, model ve onay kutusu gerekli; önce Kaydet.");
      return;
    }
    if (provider === "local" && !ai.loaded()) {
      runBtn.disabled = false;
      box.innerHTML = notice("warn", "Telefondaki model yüklü değil; önce İndir ve Başlat.");
      return;
    }
    const gen = provider === "gemini" ? (m) => withModelFallback(db, (o) => geminiChat(m, o), { onSwitch: (a, b) => toast(`Model değişti: ${a} → ${b}`, "ok") }) : ai.generate;
    for (let i = 0; i < lines.length; i++) {
      const t0 = Date.now();
      const r = await aiSuggest({ id: "ai-test-" + i, text: lines[i] }, d, gen);
      out.push({ text: lines[i], r, ms: Date.now() - t0 });
      box.innerHTML = `<div class="muted small" style="padding:8px">Çalışıyor… (${i + 1}/${lines.length})</div>`;
    }
    runBtn.disabled = false;
    const engineLine = (a) =>
      a.rows.length
        ? a.rows
            .map((x) => `${x.quantity ?? "?"} ${x.unit || ""} ${x.work_type || ""}`.trim())
            .join(" · ")
        : "satır yok";
    box.innerHTML =
      `<div class="section-title">Sonuçlar</div>` +
      out
        .map(
          ({ text, r, ms }) => `<div class="card">
        <div class="strong small">${esc(text)}</div>
        ${kv("Kural motoru", engineLine(r.analysis))}
        ${
          r.suggestions.length
            ? r.suggestions
                .map(
                  (s) =>
                    (s.error ? notice("warn", s.error) : "") +
                    s.rows
                      .map(
                        (x) =>
                          kv("Yapay zeka önerisi", `${x.quantity ?? "?"} ${x.unit || ""} ${x.work_type || ""}`.trim() || "—") +
                          (x.rejected.length ? `<div class="muted tiny">Reddedilen: ${esc(x.rejected.join("; "))}</div>` : ""),
                      )
                      .join("") +
                    (!s.error && !s.rows.length ? kv("Yapay zeka", "öneri yok") : ""),
                )
                .join("")
            : kv("Yapay zeka", "gerekmedi (motor anladı)")
        }
        <div class="muted tiny">${(ms / 1000).toFixed(1)} sn</div>
      </div>`,
        )
        .join("");
  });
  qs("[data-rules-save]", root).addEventListener("click", async () => {
    await db.metaSet("assistant_rules", qs("[data-rules]", root).value.slice(0, 6000));
    toast("Asistan kuralları kaydedildi", "ok");
  });
  qs("[data-rules-reset]", root).addEventListener("click", async () => {
    qs("[data-rules]", root).value = DEFAULT_RULES;
    await db.metaSet("assistant_rules", null);
    toast("Varsayılan kurallar", "ok");
  });
  // ---- Gemini ayarları ----
  db.metaGet("ai_quality").then((q) => {
    const el = qs("[data-gusage]", root);
    if (!q || !q.cards || !el) return;
    el.insertAdjacentHTML("afterend", `<div class="muted small">Asistan doğruluğu (${esc(q.since)}'den beri ${q.cards} iş kartı): alanların %${Math.round((100 * q.changed) / (q.fields || 1))}'i elle düzeltildi · uyarısız (sessiz) hata %${Math.round((100 * q.silent) / (q.fields || 1))}</div>`);
  });
  usageToday(db).then(async (u) => {
    const el = qs("[data-gusage]", root);
    const parts = Object.entries(u).map(([m, n]) => `${m}: ${n}`);
    const budget = await aiBudgetStatus(db);
    if (el) el.textContent = `Bugünkü HTTP denemesi: ${budget.attempts}/${budget.limit}. Başarılı işlemler: ` + (parts.length ? parts.join(" · ") : "0") + ". Bu parasal sınır değildir; sağlayıcı hesabınızdaki ücret ve kota ayarlarını kontrol edin.";
    if (el) el.insertAdjacentHTML("afterend", `<div class="field"><label>Günlük AI HTTP denemesi sınırı (1–500)</label><input type="number" min="1" max="500" step="1" data-ai-limit value="${budget.limit}"></div><button class="btn" data-ai-limit-save>İstek Sınırını Kaydet</button>`);
    qs("[data-ai-limit-save]", root)?.addEventListener("click", async () => {
      const n = Number(qs("[data-ai-limit]", root).value);
      if (!Number.isInteger(n) || n < 1 || n > 500) return toast("Sınır 1–500 tam sayı olmalı", "err");
      await db.metaSet("ai_daily_request_limit", n); toast("İstek sınırı kaydedildi", "ok");
    });
  });
  const gkey = qs("[data-gkey]", root), gmodel = qs("[data-gmodel]", root), gout = qs("[data-gout]", root);
  qs("[data-gconsent]", root).addEventListener("change", async e => {
    if (!e.target.checked) { await db.metaSet("gemini_consent", false); toast("Gemini izni kapatıldı; yeni istekler engellendi", "ok"); }
  });
  qs("[data-provider]", root).addEventListener("change", (e) => {
    runBtn.disabled = e.target.value === "local" ? !ai.loaded() : false;
  });
  qs("[data-gmodels]", root).addEventListener("click", async () => {
    const key = gkey.value.trim();
    if (!key) return toast("Önce anahtarı girin", "err");
    if (!qs("[data-gconsent]", root).checked) return toast("Model sorgulaması için veri gönderimi onayını işaretleyin", "err");
    await db.metaSet("gemini_consent", true);
    gout.innerHTML = '<div class="muted small">Modeller alınıyor…</div>';
    try {
      const list = await listModels(key, guardedAiFetch(db));
      await db.metaSet("gemini_model_list", list.map((m) => m.id));
      const cur = gmodel.value;
      gmodel.innerHTML = list.map((m) => `<option value="${esc(m.id)}" ${m.id === cur ? "selected" : ""}>${esc(m.label)} (${esc(m.id)})</option>`).join("");
      gout.innerHTML = notice("ok", list.length + " model bulundu. Hızlı ve uygun olduğu için 'flash' önerilir.");
    } catch (e) {
      gout.innerHTML = notice("warn", e.message || String(e));
    }
  });
  qs("[data-gfind]", root).addEventListener("click", async () => {
    const key = gkey.value.trim();
    if (!key) return toast("Önce anahtarı girin", "err");
    if (!qs("[data-gconsent]", root).checked) return toast("Model sorgulaması için veri gönderimi onayını işaretleyin", "err");
    await db.metaSet("gemini_consent", true);
    gout.innerHTML = '<div class="muted small">Modeller tek tek deneniyor…</div>';
    try {
      const list = await listModels(key, guardedAiFetch(db));
      await db.metaSet("gemini_model_list", list.map((m) => m.id));
      const r = await findWorkingModel(key, list, guardedAiFetch(db));
      gmodel.innerHTML = list.map((m) => `<option value="${esc(m.id)}" ${m.id === r.id ? "selected" : ""}>${esc(m.label)} (${esc(m.id)})</option>`).join("");
      gout.innerHTML =
        (r.id
          ? notice("ok", `Çalışan model: ${r.id}. Onay kutusunu işaretleyip Kaydet'e basın.`)
          : notice("warn", "Bu anahtarla çalışan model bulunamadı. Ücretsiz kota bitmiş olabilir veya anahtarın projesinde faturalandırma/ kredi gerekebilir.")) +
        `<div class="muted tiny" style="margin-top:6px">${r.tried.map((t) => esc(t.id + ": " + (t.ok ? "çalışıyor ✓" : t.reason))).join("<br>")}</div>`;
    } catch (e) {
      gout.innerHTML = notice("warn", e.message || String(e));
    }
  });
  qs("[data-gsave]", root).addEventListener("click", async () => {
    const key = gkey.value.trim(), model = gmodel.value, consent = qs("[data-gconsent]", root).checked;
    if (!key || !model) return toast("Anahtar ve model gerekli", "err");
    if (!consent) return toast("Onay kutusunu işaretlemeden Gemini kullanılmaz", "err");
    await db.metaSet("gemini_key", key);
    await db.metaSet("gemini_model", model);
    await db.metaSet("gemini_consent", true);
    toast("Gemini ayarları kaydedildi", "ok");
    runBtn.disabled = false;
  });
  qs("[data-gclear]", root).addEventListener("click", async () => {
    if (!(await confirmDialog("Anahtar silinsin mi?", "Gemini kullanımı kapanır.", "Sil", true))) return;
    await db.metaSet("gemini_key", "");
    await db.metaSet("gemini_consent", false);
    gkey.value = "";
    qs("[data-gconsent]", root).checked = false;
    toast("Anahtar silindi", "ok");
  });
  qs("[data-gphoto]", root).addEventListener("change", async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    const g = await geminiSettings(db);
    if (!g.ready) return (gout.innerHTML = notice("warn", "Önce anahtar, model ve onayı kaydedin."));
    gout.innerHTML = '<div class="muted small">Fiş okunuyor…</div>';
    const t0 = Date.now();
    try {
      const r = await withModelFallback(db, (o) => geminiReadReceipt(f, o), { onSwitch: (a, b) => toast(`Model değişti: ${a} → ${b}`, "ok") });
      gout.innerHTML =
        notice("ok", `Okundu (${((Date.now() - t0) / 1000).toFixed(1)} sn). Değerler aşağıda; hiçbir kayıt oluşturulmadı.`) +
        Object.entries(r.fields).map(([k, v]) => kv(LABELS[k] || k, String(v))).join("") +
        (r.rejected.length ? `<div class="muted tiny" style="margin-top:6px">Reddedilen: ${esc(r.rejected.join("; "))}</div>` : "") +
        (r.text ? `<details style="margin-top:6px"><summary class="muted small">Fiş metni</summary><div class="tiny muted" style="white-space:pre-wrap">${esc(r.text.slice(0, 2000))}</div></details>` : "");
    } catch (err) {
      gout.innerHTML = notice("warn", err.message || String(err));
    }
  });
  return true;
}
