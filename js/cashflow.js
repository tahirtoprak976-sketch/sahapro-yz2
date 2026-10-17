// Nakit tahmini ekranı (#/nakit): önümüzdeki 5 hafta para girişi / çıkışı, iki senaryo, en sıkışık hafta.
import { qs, qsa, esc, appbar, toast, notice, todayStr, trDate, promptDialog } from "./ui.js";

const tl = (n) => (Number(n) < 0 ? "−" : "") + Math.abs(Math.round(Number(n) || 0)).toLocaleString("tr-TR") + " ₺";
const SYSTEM = "Sen küçük bir hafriyat/nakliye işletmesinin mali danışmanısın. Sana önümüzdeki haftaların hesaplanmış nakit tahmini (JSON) verilecek. Türkçe, sade, en fazla 6 kısa cümle yaz: en sıkışık hafta hangisi ve neden, hangi tahsilata öncelik verilmeli, hangi ödeme ertelenebilir/konuşulmalı. YALNIZ verilen rakamları kullan, yeni rakam üretme, toplama/çıkarma yapma. Kesin olmayan (tahmini) kalemleri kesin gibi anlatma.";

export async function screen(ctx) {
  if (ctx.parts[0] !== "nakit") return false;
  const { root, db } = ctx;
  const today = todayStr();
  const d = await db.dumpAll();
  const { cashForecast, forecastSummary } = await import("./cashflow-core.js");
  const coh = await db.metaGet("cash_on_hand"); // { amount, date }
  const F = cashForecast(d, { today, notes: (await db.metaGet("collect_notes")) || {}, cashOnHand: coh ? coh.amount : null });
  const color = (n) => (n < 0 ? "#d9534f" : "inherit");
  const week = (w, i) => `<details class="card" style="padding:10px 12px" ${i === 0 ? "open" : ""}>
      <summary class="row between" style="cursor:pointer;list-style:none"><b>${i === 0 ? "Bu hafta" : i + 1 + ". hafta"} <span class="tiny muted">${trDate(w.from)} – ${trDate(w.to)}</span></b>
        <span style="font-weight:700;color:${color(F.start == null ? w.inSure + w.inEst - w.outSure - w.outEst : w.good)}">${F.start == null ? (w.inSure + w.inEst - w.outSure - w.outEst >= 0 ? "+" : "") + tl(w.inSure + w.inEst - w.outSure - w.outEst) : tl(w.good)}</span></summary>
      <div class="formgrid2" style="margin-top:6px">
        <div class="small">⬇ Giriş: <b>${tl(w.inSure)}</b>${w.inEst ? ` <span class="muted">+ ${tl(w.inEst)} tahmini</span>` : ""}</div>
        <div class="small">⬆ Çıkış: <b>${tl(w.outSure)}</b>${w.outEst ? ` <span class="muted">+ ${tl(w.outEst)} tahmini</span>` : ""}</div>
      </div>
      ${F.start != null ? `<div class="tiny muted" style="margin-top:4px">Hafta sonu kasa: normal ${tl(w.good)} · kötü senaryo <span style="color:${color(w.bad)}">${tl(w.bad)}</span></div>` : ""}
      ${w.items.map((x) => `<div class="row between small${x.href ? " tap" : ""}" ${x.href ? `data-go="${esc(x.href)}"` : ""} style="padding:5px 0;border-top:1px solid var(--border)">
        <span>${x.dir === "in" ? "⬇" : "⬆"} ${esc(x.label)}${x.sure ? "" : ' <span class="tiny muted">(tahmini)</span>'}${x.late ? ' <span class="tiny" style="color:#d9534f">gecikmiş</span>' : ""}${x.sub ? `<br><span class="tiny muted">${esc(x.sub)}</span>` : ""}</span>
        <b style="white-space:nowrap;color:${x.dir === "in" ? "#2e9e6b" : "inherit"}">${x.dir === "in" ? "+" : "−"}${tl(x.amount)}</b></div>`).join("") || '<div class="tiny muted" style="margin-top:6px">Bu hafta bilinen hareket yok</div>'}
    </details>`;
  root.innerHTML = appbar("Nakit Tahmini", "Önümüzdeki 5 hafta · param yetecek mi?") + `
    <div style="height:10px"></div>
    <div class="card">
      <div class="row between"><span>Şu an elimdeki para (kasa + banka)</span><button class="btn sm" data-coh>${coh ? tl(coh.amount) : "Yaz"}</button></div>
      ${coh ? `<div class="tiny muted">${trDate(coh.date)} tarihinde yazıldı${coh.date !== today ? " — güncellemeniz iyi olur" : ""}</div>` : '<div class="tiny muted">Yazarsanız haftalık kasa bakiyesi ve en sıkışık gün hesaplanır.</div>'}
    </div>
    ${F.start != null && F.lowBad?.amount < 0 ? notice("err", `Kötü senaryoda (yalnız kesin tahsilatlar gelirse) ${trDate(F.lowBad.week.from)} haftasında kasa ${tl(F.lowBad.amount)} olur. Tahsilatları öne çekin ya da ödemeleri konuşun.`)
      : F.start != null && F.lowGood?.amount < 0 ? notice("warn", `Beklenen tahsilatlar gelse bile ${trDate(F.lowGood.week.from)} haftasında kasa ${tl(F.lowGood.amount)} olur.`)
      : F.start != null ? notice("ok", `5 hafta boyunca kasa artıda görünüyor (en düşük: ${tl(F.lowBad.amount)}, kötü senaryo).`) : ""}
    ${F.lateIn ? notice("info", `${tl(F.lateIn)} tahsilat gecikmiş durumda; bu haftaya yazıldı ama gelmeyebilir.`) : ""}
    <div class="formgrid2">
      <div class="card" style="margin:0;padding:10px"><div class="tiny muted">5 haftada giriş</div><b>${tl(F.totals.inSure)}</b><div class="tiny muted">+ ${tl(F.totals.inEst)} tahmini</div></div>
      <div class="card" style="margin:0;padding:10px"><div class="tiny muted">5 haftada çıkış</div><b>${tl(F.totals.outSure)}</b><div class="tiny muted">+ ${tl(F.totals.outEst)} tahmini</div></div>
    </div>
    ${F.weeks.map(week).join("")}
    <button class="btn block" data-ai style="margin-top:6px">🤖 Danışman yorumu (Gemini)</button>
    <div data-aiout></div>
    <div class="tiny muted" style="margin:8px 4px 80px">Kesin: ödeme sözleri, çek/senet vadeleri, esnaf borçları (vade yoksa belge + 30 gün), puantajdaki maaş kalanı, geçen seferki tutarıyla belge yenileme. Tahmini: sözü olmayan alacaklar (müşterinin ödeme aralığına göre), mazot / gider / bakım (son günlerin ortalaması). Vergi, SGK primi, kredi taksidi kayıtlı değilse hesapta yoktur.</div>`;

  qs("[data-coh]", root).addEventListener("click", async () => {
    const v = await promptDialog("Elimdeki para", "Kasa + banka toplamı (₺)", coh ? String(coh.amount) : "");
    if (v === null) return;
    const n = Number(String(v).replace(/\./g, "").replace(",", "."));
    if (!Number.isFinite(n)) return toast("Sayı yazın", "err");
    await db.metaSet("cash_on_hand", { amount: n, date: today });
    ctx.reload();
  });
  qs("[data-ai]", root).addEventListener("click", async (ev) => {
    const b = ev.currentTarget, out = qs("[data-aiout]", root);
    if (!navigator.onLine) return toast("İnternet yok", "err");
    b.disabled = true; out.innerHTML = '<div class="muted small" style="margin:6px">Gemini yazıyor…</div>';
    try {
      const facts = forecastSummary(F);
      const { requestEvidenceReport } = await import("./evidence-report.js");
      const text = await requestEvidenceReport(db, facts, "Nakit tahminindeki önemli kanıtlar; kesin tahsilat vaadi verme");
      out.innerHTML = `<div class="card" style="white-space:pre-wrap">${esc(text)}</div>`;
    } catch (e) { out.innerHTML = notice("warn", e.message || String(e)); }
    b.disabled = false;
  });
  return true;
}
