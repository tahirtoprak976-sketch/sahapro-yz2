// Akıllı Asistan ek ekranları: Gün Sonu Özeti (#/akilli-asistan/ozet) ve Soru Sor (#/akilli-asistan/soru).
// Rakamlar telefonda hesaplanır; Gemini yalnız cümle kurar / hangi hesabın yapılacağını seçer.
import { qs, esc, appbar, toast, notice, todayStr } from "./ui.js";

export async function screen(ctx) {
  if (ctx.parts[0] !== "akilli-asistan" || !["ozet", "soru", "danisman"].includes(ctx.parts[1])) return false;
  const { geminiSettings } = await import("./ai-gemini.js");
  const g = await geminiSettings(ctx.db);
  if (ctx.parts[1] === "danisman") return advisor(ctx, g);
  return ctx.parts[1] === "ozet" ? summary(ctx, g) : ask(ctx, g);
}

async function summary(ctx, g) {
  const { root, db } = ctx;
  const { dayFacts, localSummary, keepVerified, SUMMARY_SYSTEM } = await import("./day-summary.js");
  root.innerHTML =
    appbar("Gün Sonu Özeti", "rakamlar telefondan") +
    `<div style="height:10px"></div><div class="card">
      <div class="field"><label>Gün</label><input type="date" data-date value="${todayStr()}"></div>
      <div class="field"><label>Özet (düzenleyebilirsiniz)</label><textarea data-text rows="12"></textarea></div>
      <div data-note></div>
      <div class="row" style="gap:6px;flex-wrap:wrap">
        <button class="btn grow" data-ai ${g.ready ? "" : "disabled"}>🤖 Gemini ile yaz</button>
        <button class="btn primary grow" data-share>📤 WhatsApp'ta paylaş</button>
        <button class="btn grow" data-copy>Kopyala</button>
      </div>
      <div class="muted tiny" style="margin-top:6px">Düz özet internetsiz hazırlanır. Gemini metni güzelleştirir; kayıtlarda olmayan rakam içeren cümleler otomatik atılır.</div>
    </div>`;
  let facts = null;
  const text = qs("[data-text]", root), note = qs("[data-note]", root);
  const load = async () => {
    facts = dayFacts(await db.dumpAll(), qs("[data-date]", root).value || todayStr());
    text.value = localSummary(facts);
    note.innerHTML = "";
  };
  qs("[data-date]", root).addEventListener("change", load);
  await load();
  qs("[data-ai]", root).addEventListener("click", async (ev) => {
    const b = ev.currentTarget;
    if (!navigator.onLine) return toast("İnternet yok; düz özeti paylaşabilirsiniz", "err");
    b.disabled = true;
    note.innerHTML = '<div class="muted small">Gemini yazıyor…</div>';
    try {
      const { withModelFallback, geminiText } = await import("./ai-gemini.js");
      const out = await withModelFallback(db, (o) => geminiText("Günün rakamları (JSON):\n" + JSON.stringify(facts), { ...o, system: SUMMARY_SYSTEM }));
      const k = keepVerified(out, facts);
      if (!k.text) throw new Error("Gemini doğrulanabilir bir özet yazamadı; düz özeti kullanın");
      text.value = k.text + (facts.uyarilar.length ? "\n" + facts.uyarilar.slice(0, 4).map((u) => "⚠ " + u).join("\n") : "");
      note.innerHTML = k.dropped.length ? notice("warn", `${k.dropped.length} cümle kayıtlarda olmayan rakam içerdiği için çıkarıldı.`) : "";
    } catch (e) {
      note.innerHTML = notice("warn", e.message || String(e));
    }
    b.disabled = false;
  });
  qs("[data-copy]", root).addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(text.value); toast("Kopyalandı", "ok"); } catch { toast("Kopyalanamadı", "err"); }
  });
  qs("[data-share]", root).addEventListener("click", async () => {
    const t = text.value.trim();
    if (!t) return;
    if (navigator.share) {
      try { await navigator.share({ text: t }); return; } catch (e) { if (e.name === "AbortError") return; }
    }
    location.href = "https://wa.me/?text=" + encodeURIComponent(t);
  });
  return true;
}

const EXAMPLES = ["Bu ay hangi müşteriye kaç sefer yaptık?", "Depoda ne kadar yakıt kaldı?", "Geçen ay yakıta ne kadar verdik?", "Esnafa toplam borcum ne kadar?", "Bu ay tahsilat ne kadar?"];
async function ask(ctx, g) {
  const { root, db } = ctx;
  root.innerHTML =
    appbar("Soru Sor", "kayıtlarınızdan hesaplanır") +
    `<div style="height:10px"></div>
    ${g.ready ? "" : notice("warn", "Önce Ayarlar → Yapay Zeka'da Gemini anahtarını kaydedin.")}
    <div class="card">
      <div class="field"><label>Sorunuz</label><textarea data-q rows="3" placeholder="Örn: Hisar Polat'a bu ay kaç saat çalıştık?"></textarea></div>
      <div class="row" style="gap:6px;flex-wrap:wrap">${EXAMPLES.map((x) => `<button class="chip" data-ex>${esc(x)}</button>`).join("")}</div>
      <button class="btn primary block" style="margin-top:10px" data-send ${g.ready ? "" : "disabled"}>❓ Sor</button>
    </div><div data-out></div>`;
  for (const c of root.querySelectorAll("[data-ex]")) c.addEventListener("click", () => (qs("[data-q]", root).value = c.textContent));
  qs("[data-send]", root).addEventListener("click", async (ev) => {
    const q = qs("[data-q]", root).value.trim();
    if (!q) return toast("Soru yazın", "err");
    if (!navigator.onLine) return toast("İnternet yok", "err");
    const b = ev.currentTarget, out = qs("[data-out]", root);
    b.disabled = true;
    out.innerHTML = '<div class="muted small" style="padding:10px">Hesaplanıyor…</div>';
    try {
      const res = await askWithTools(db, q);
      out.innerHTML = answerHtml(res);
    } catch (e) {
      out.innerHTML = notice("warn", e.message || String(e));
    }
    b.disabled = false;
  });
  return true;
}

// Soruyu hesap araçlarıyla cevapla (Soru Sor ekranı ve Akıllı Asistan ortak kullanır)
export async function askWithTools(db, q) {
  const { ASK_TOOLS, ASK_SYSTEM, runAskTool } = await import("./day-summary.js");
  const { checkAnswer } = await import("./assistant-core.js");
  const { withModelFallback, geminiAsk } = await import("./ai-gemini.js");
  const d = await db.dumpAll(), today = todayStr();
  const yardSettings = (await db.metaGet("yard_settings")) || {};
  const collectNotes = (await db.metaGet("collect_notes")) || {};
  const fuelRefPrice = await db.metaGet("fuel_ref_price");
  const quoteSettings = (await db.metaGet("quote_settings")) || {};
  const res = await withModelFallback(db, (o) => geminiAsk(`Bugün: ${today}\n<soru>${String(q).replace(/<\/?soru>/gi, "")}</soru>`, { ...o, system: ASK_SYSTEM, tools: ASK_TOOLS, runTool: (n, a) => runAskTool(d, n, a, today, yardSettings, { collectNotes, fuelRefPrice, quoteSettings }) }));
  return { ...res, bad: checkAnswer(res.answer, res.trace.map((t) => t.result)) };
}
const TOOL_TR = { work_totals: "İş toplamı", customer_balance: "Müşteri bakiyesi", fuel_totals: "Yakıt toplamı", expense_totals: "Gider toplamı", collection_totals: "Tahsilat toplamı", esnaf_debt: "Esnaf borcu", tank_status: "Depo durumu", customer_fuel: "Mazot hesabı", yard_stock: "Depo stoku", receivables: "Alacaklar", vehicle_profit: "Araç kârlılığı", customer_profit: "Müşteri kârlılığı", price_check: "Fiyat kontrolü", business_review: "İşletme değerlendirmesi", quote_price: "Teklif hesabı", payroll_status: "Puantaj / maaş", maintenance_due: "Bakım takvimi" };
export function answerHtml(res) {
  const bad = res.bad || [];
  return `<div class="card"><div class="strong small">🤖 Cevap</div><div style="white-space:pre-wrap;margin-top:6px">${esc(res.answer || "Cevap alınamadı, soruyu farklı yazın.")}</div>
    ${bad.length ? notice("warn", "Bu sayılar hesaplanan sonuçlarda yok, güvenmeyin: " + bad.join(", ")) : res.trace.length ? '<div class="muted tiny" style="margin-top:6px">Rakamlar telefondaki kayıtlardan hesaplandı.</div>' : notice("warn", "Hiç hesap yapılmadı; cevaptaki rakamlara güvenmeyin.")}
    ${res.trace.length ? `<details style="margin-top:8px"><summary class="small">Yapılan hesaplar (${res.trace.length})</summary>${res.trace.map((t) => `<div class="tiny muted" style="margin-top:4px"><b>${esc(TOOL_TR[t.name] || t.name)}</b> ${esc(JSON.stringify(t.args))}<br>${esc(JSON.stringify(t.result).slice(0, 600))}</div>`).join("")}</details>` : ""}</div>`;
}

// Mesajda soru var mı? (Akıllı Asistan soruyu hesap araçlarına da gönderir)
export function isQuestion(text) {
  const t = String(text || "").toLocaleLowerCase("tr-TR");
  return /\?/.test(t) || /(?<!\p{L})(kaç|kac|ne kadar|nedir|ne zaman|kimde|kimin|hangi|hangisi|toplam(ı|i)? ne|var mı|var mi|kaldı mı|kaldi mi|söyle|soyle|göster bana|hesapla)(?!\p{L})/u.test(t);
}

// ---- Yönetim Danışmanı (#/akilli-asistan/danisman): işletme karnesi + uzman yorumu ----
async function advisor(ctx, g) {
  const { root, db } = ctx;
  const X = await import("./expert-core.js");
  const { addDays } = await import("./core.js");
  const d = await db.dumpAll(), today = todayStr();
  const notes = (await db.metaGet("collect_notes")) || {}, fuelRefPrice = await db.metaGet("fuel_ref_price");
  const PER = {
    month: ["Bu ay", today.slice(0, 8) + "01", today],
    last: ["Geçen ay", (() => { const x = new Date(today.slice(0, 8) + "01T12:00:00"); x.setMonth(x.getMonth() - 1); return x.toISOString().slice(0, 10); })(), addDays(today.slice(0, 8) + "01", -1)],
    m3: ["Son 3 ay", addDays(today, -90), today],
  };
  let per = ctx.query?.p && PER[ctx.query.p] ? ctx.query.p : "month";
  const tl = (n) => Math.round(Number(n) || 0).toLocaleString("tr-TR") + " ₺";
  const draw = () => {
    const [label, from, to] = PER[per];
    const R = X.businessReview(d, { from, to, today, notes, fuelRefPrice });
    const icon = { bos: "💤", doluluk: "📉", zarar: "🔻", fiyatsiz: "🏷", fiyat: "💲", tahsilat: "⏳" };
    root.innerHTML = appbar("Yönetim Danışmanı", "işletme karnesi · " + label, { back: "#/akilli-asistan" }) +
      `<div style="height:10px"></div>
      <div class="row" style="gap:6px;margin-bottom:8px">${Object.entries(PER).map(([k, [t]]) => `<button class="chip ${per === k ? "on" : ""}" data-per="${k}">${t}</button>`).join("")}</div>
      <div class="statgrid" style="grid-template-columns:repeat(2,1fr)">
        <div class="stat accent"><div class="v">${tl(R.ozet.gelir_TL)}</div><div class="l">Gelir (araçlardan)</div></div>
        <div class="stat warn"><div class="v">${tl(R.ozet.masraf_TL)}</div><div class="l">Masraf (yakıt, bakım, gider, döküm)</div></div>
        <div class="stat ${R.ozet.kar_TL < 0 ? "danger" : "ok"}"><div class="v">${tl(R.ozet.kar_TL)}</div><div class="l">Araçların kârı</div></div>
        <div class="stat ${R.ozet.alacak_90_TL ? "danger" : ""}"><div class="v">${tl(R.ozet.toplam_alacak_TL)}</div><div class="l">Alacak · 90+ gün ${tl(R.ozet.alacak_90_TL)}</div></div>
      </div>
      <div class="section-title">🤖 Uzman yorumu</div>
      <div class="card"><div data-adv class="small muted">İşletmenin bu dönemki rakamlarına göre yönetim önerisi ister misiniz? (rakamlar telefonda hesaplandı; yapay zekâ yalnız yorumlar)</div>
        <button class="btn primary block" style="margin-top:8px" data-advgo ${g.ready ? "" : "disabled"}>🤖 Değerlendir ve öner</button></div>
      <div class="section-title">Dikkat edilecekler (${R.bulgular.length})</div>
      ${R.bulgular.length ? R.bulgular.map((b) => `<div class="small" style="margin:4px 2px">${icon[b.kind] || "•"} ${esc(b.text)}</div>`).join("") : '<div class="muted small">Belirgin bir sorun yok.</div>'}
      <div class="section-title">Araç karnesi</div>
      ${R.araclar.map((v) => `<div class="card tap" data-go="#/filo/${esc(v.id)}"><div class="row between"><b>${esc(v.arac)}</b><span class="strong" style="color:${v.kar_TL < 0 ? "#d9534f" : "#2e9e6b"}">${tl(v.kar_TL)}</span></div>
        <div class="tiny muted">${v.calisilan_gun}/${v.is_gunu} gün (%${v.doluluk_yuzde}) · ${Object.entries(v.birimler).map(([u, q]) => q + " " + u.toLocaleLowerCase("tr-TR")).join(", ") || "iş yok"} · gelir ${tl(v.gelir_TL)} · yakıt ${tl(v.yakit_TL)}${v.dokum_TL ? " · döküm " + tl(v.dokum_TL) : ""}${v.bakim_TL ? " · bakım " + tl(v.bakim_TL) : ""}${v.L_sefer ? " · " + v.L_sefer + " L/sefer" : ""}${v.L_saat ? " · " + v.L_saat + " L/saat" : ""}${v.bos_gun >= 3 ? ` · <b>${v.bos_gun} gündür boşta</b>` : ""}</div></div>`).join("") || '<div class="muted small">Araç verisi yok.</div>'}
      <div class="section-title">Müşteri karnesi</div>
      ${R.musteriler.slice(0, 15).map((c) => `<div class="card tap" data-go="#/musteriler/${esc(c.id)}"><div class="row between"><b>${esc(c.musteri)}</b><span>${tl(c.gelir_TL)}</span></div>
        <div class="tiny muted">${c.is} iş${c.dokum_TL ? " · döküm sonrası " + tl(c.dokum_sonrasi_TL) : ""}${c.sefer_basi_net_TL ? " · sefer başı net " + tl(c.sefer_basi_net_TL) : ""} · tahsilat ${tl(c.tahsilat_TL)}${c.acik_alacak_TL ? ` · alacak ${tl(c.acik_alacak_TL)} (${c.en_eski_gun} gün)` : ""}${c.fiyatsiz_is ? ` · ${c.fiyatsiz_is} fiyatsız` : ""}${c.mazot_karsiligi_L ? ` · ⛽ ${c.mazot_karsiligi_L} L` : ""}</div></div>`).join("") || '<div class="muted small">Bu dönemde iş yok.</div>'}
      <div class="section-title">Fiyat kontrolü</div>
      ${R.fiyat.map((p) => `<div class="card"><div class="row between"><b class="small">${esc(p.is_turu)}</b><span class="small">orta ${tl(p.orta_fiyat_TL)}</span></div><div class="tiny muted">${p.kayit} kayıt · en düşük ${tl(p.en_dusuk_TL)} · en yüksek ${tl(p.en_yuksek_TL)}${p.dusuk_kalan_musteriler.length ? " · ⚠ düşük: " + p.dusuk_kalan_musteriler.map((l) => esc(l.musteri) + " " + tl(l.ortalama_TL)).join(", ") : ""}</div></div>`).join("") || '<div class="muted small">Karşılaştırılacak kadar fiyatlı iş yok.</div>'}`;
    for (const b of root.querySelectorAll("[data-per]")) b.onclick = () => { per = b.dataset.per; draw(); };
    qs("[data-advgo]", root).onclick = async (ev) => {
      const b = ev.currentTarget, box = qs("[data-adv]", root);
      b.disabled = true;
      box.innerHTML = "Değerlendiriliyor…";
      try {
        const { withModelFallback, geminiText } = await import("./ai-gemini.js");
        const { keepVerified } = await import("./day-summary.js");
        const facts = { donem: label, ozet: R.ozet, bulgular: R.bulgular.map((x) => x.text), araclar: R.araclar.slice(0, 10).map(({ id, ...x }) => x), musteriler: R.musteriler.slice(0, 10).map(({ id, ...x }) => x), fiyat: R.fiyat.slice(0, 8) };
        const out = await withModelFallback(db, (o) => geminiText("İşletme karnesi (JSON):\n" + JSON.stringify(facts), { ...o, maxTokens: 1500,
          system: X.EXPERT_KNOWLEDGE + "\nSen bu işletmenin yönetim danışmanısın. Sahibine Türkçe, sade bir değerlendirme yaz: 1) Durum (2 cümle), 2) En önemli 3–5 öneri — her biri somut eylem (kimi ara, hangi aracı nereye ver, hangi müşteriye fiyat güncelle, hangi masrafı kes), 3) Dikkat (1 cümle). Yalnız JSON'daki rakam ve adları kullan; hesap yapma, rakam uydurma." }));
        const v = keepVerified(String(out || ""), [facts]);
        box.innerHTML = `<div style="white-space:pre-wrap;color:inherit">${esc(v.text || "Yorum çıkmadı.")}</div>${v.dropped.length ? `<div class="tiny muted" style="margin-top:6px">${v.dropped.length} cümle kayıtlarda olmayan rakam içerdiği için gösterilmedi.</div>` : ""}`;
      } catch (e) {
        box.innerHTML = esc(e.message || String(e));
      }
      b.disabled = false;
    };
  };
  draw();
  return true;
}
