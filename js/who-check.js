// "Kime çalışıldı?" kontrol ekranı (#/kime-kontrol). Benzer adlı müşteri kartlarındaki (Kuyucu / Kuyucu Kamil /
// Kuyucular, Aydın Nalbur / Hurdacı Aydın / Aydın İnşaat) işleri tek listede gösterir; personelin yazdığı açıklama,
// araç ve geçmiş işlerdeki yer ipucuyla doğru müşteri seçilir. Yalnız değiştirilen işler kaydedilir.
import { qs, qsa, esc, appbar, toast, notice, trDate } from "./ui.js";
import { isActive } from "./core.js";
import { customerWordGroups, suggestFor } from "./assistant-core.js";

export async function screen(ctx) {
  if (ctx.parts[0] !== "kime-kontrol") return false;
  const { root, db } = ctx;
  const d = await db.dumpAll();
  const groups = customerWordGroups(d);
  const works = (d.work_records || []).filter(isActive);
  const vName = (id) => (d.vehicles || []).find((v) => v.id === id)?.name || "";
  const pName = (id) => (d.personnel || []).find((p) => p.id === id)?.name || "";
  const gi = Number(ctx.query?.g ?? -1);
  if (!(gi >= 0 && groups[gi])) {
    root.innerHTML =
      appbar("Kime Çalışıldı?", "benzer adlı müşterilerin işleri") +
      `<div style="height:10px"></div>
      ${notice("info", "Personel bazen yalnız \"kuyucuya\", \"Aydın'a\" gibi yazıyor. Burada adı benzeyen müşterilerin işlerini birlikte görüp her işi doğru müşteriye taşıyabilirsiniz. Aynı firma ise Kart Birleştir'i kullanın.")}
      ${groups.length ? groups.map((g, i) => `<div class="card tap" data-go="#/kime-kontrol?g=${i}"><div class="small">${g.customers.map((c) => `<b>${esc(c.name)}</b> <span class="muted">(${works.filter((w) => w.customer_id === c.id).length})</span>`).join(" · ")}</div></div>`).join("") : notice("ok", "Adı birbirine benzeyen müşteri kartı yok.")}
      <button class="btn block" data-go="#/kart-birlestir">🔗 Kart Birleştir</button>`;
    return true;
  }
  const g = groups[gi];
  const ids = new Set(g.customers.map((c) => c.id));
  const rows = works.filter((w) => ids.has(w.customer_id)).sort((a, b) => (a.date < b.date ? 1 : -1));
  root.innerHTML =
    appbar("Kime Çalışıldı?", g.customers.map((c) => c.name).join(" / "), { back: "#/kime-kontrol" }) +
    `<div style="height:10px"></div>
    ${notice("info", "★ işareti: açıklamadaki yer/araç bilgisi o müşterinin önceki işlerinde geçiyor. Değiştirdiklerinizi en alttan kaydedin.")}
    ${rows
      .map((w) => {
        const text = [w.description, w.internal_note].filter(Boolean).join(" ");
        const others = works.filter((x) => x.id !== w.id);
        const sug = suggestFor({ ...d, work_records: others }, text, g.customers, w.vehicle_id, w.date);
        const best = sug[0]?.score > (sug[1]?.score || 0) ? sug[0] : null;
        return `<div class="card" data-w="${esc(w.id)}">
          <div class="small"><b>${trDate(w.date)}</b> · ${esc(vName(w.vehicle_id))} ${pName(w.personnel_id) ? "· " + esc(pName(w.personnel_id)) : ""} · ${w.quantity ?? ""} ${esc(w.unit || "")}</div>
          <div class="small" style="margin:4px 0">${esc(text || "—")}</div>
          <select data-cust>${g.customers.map((c) => `<option value="${esc(c.id)}" ${c.id === w.customer_id ? "selected" : ""}>${esc(c.name)}${best && best.id === c.id ? " ★" : ""}</option>`).join("")}</select>
          ${best && best.id !== w.customer_id ? `<div class="muted tiny" style="margin-top:4px">★ ${esc(best.name)}: ${esc(best.why)}</div>` : ""}
        </div>`;
      })
      .join("")}
    <button class="btn primary block" data-save>✓ Değişenleri Kaydet</button>`;
  qs("[data-save]", root).addEventListener("click", async () => {
    let n = 0, fail = 0;
    for (const card of qsa("[data-w]", root)) {
      const w = rows.find((x) => x.id === card.dataset.w);
      const to = qs("[data-cust]", card).value;
      if (!w || to === w.customer_id) continue;
      try {
        const site = w.site_id && (d.sites || []).find((s) => s.id === w.site_id)?.customer_id === to ? w.site_id : null;
        await db.saveExisting("work_records", w, { customer_id: to, site_id: site }, "Kime çalışıldı kontrolü");
        n++;
      } catch (e) {
        fail++;
        card.insertAdjacentHTML("beforeend", `<div class="muted tiny" style="color:var(--danger)">Taşınamadı: ${esc(e.message || e)}</div>`);
      }
    }
    toast(`${n} iş doğru müşteriye taşındı${fail ? `, ${fail} iş taşınamadı (hakedişe bağlı olabilir)` : ""}`, n ? "ok" : "err");
    if (!fail) ctx.reload();
  });
  return true;
}
