// Fiyat sağlığı ekranı (#/fiyat-saglik): hangi müşteride zarar / düşük kâr var, hangi fiyat eskidi, zam önerisi.
import { qs, qsa, esc, appbar, toast, notice, todayStr, trDate, shareText } from "./ui.js";

const tl = (n) => (Number(n) < 0 ? "−" : "") + Math.abs(Math.round(Number(n) || 0)).toLocaleString("tr-TR") + " ₺";
const STATE = { zarar: ["🔴", "Zarar", "#d9534f"], düşük: ["🟠", "Kâr düşük", "#e0a030"], zam: ["🟡", "Zam zamanı", "#c9a227"], iyi: ["🟢", "İyi", "#2e9e6b"], "?": ["⚪", "Maliyet bilinmiyor", "#9aa4b2"] };

export async function screen(ctx) {
  if (ctx.parts[0] !== "fiyat-saglik") return false;
  const { root, db } = ctx;
  const today = todayStr();
  const d = await db.dumpAll();
  const { priceHealth } = await import("./price-health.js");
  const margin = Number((await db.metaGet("quote_settings"))?.margin) || 20;
  const rows = priceHealth(d, { today, targetMargin: margin, fuelRefPrice: await db.metaGet("fuel_ref_price") });
  const cnt = (s) => rows.filter((r) => r.state === s).length;
  const u = (x) => String(x || "").toLocaleLowerCase("tr-TR");
  root.innerHTML = appbar("Fiyat Sağlığı", "Hangi işte ne kazanıyorum · zam önerisi") + `
    <div style="height:10px"></div>
    ${rows.length ? `<div class="row" style="gap:6px;flex-wrap:wrap;margin-bottom:8px">${["zarar", "düşük", "zam", "iyi", "?"].filter(cnt).map((s) => `<span class="badge">${STATE[s][0]} ${STATE[s][1]}: ${cnt(s)}</span>`).join("")}</div>` : notice("info", "Son 120 günde fiyatlı iş yok.")}
    ${rows.map((r, i) => `<div class="card" style="border-left:4px solid ${STATE[r.state][2]}">
      <div class="row between"><b>${esc(r.customer)}</b><span class="small">${STATE[r.state][0]} ${STATE[r.state][1]}</span></div>
      <div class="tiny muted">${esc(r.work_type || "İş")} · ${r.n} iş, ${r.qty.toLocaleString("tr-TR")} ${esc(u(r.unit))} · ${tl(r.revenue)} (son 120 gün)</div>
      <div class="formgrid2" style="margin-top:6px">
        <div class="small">Fiyat: <b>${tl(r.price)}</b> / ${esc(u(r.unit))}<br><span class="tiny muted">${trDate(r.since)}'den beri (${r.age} gün)</span></div>
        <div class="small">Doğrudan maliyet: <b>${r.state === "?" ? "?" : tl(r.cost)}</b><br><span class="tiny muted">${r.fuelCost != null ? `mazot ${r.fuelL} L × ${r.fpNow} ₺ = ${tl(r.fuelCost)}` : "mazot bilinmiyor"}${r.dump ? ` · döküm ${tl(r.dump)}` : ""}</span></div>
      </div>
      ${r.margin != null ? `<div class="small" style="margin-top:4px">Birim başı katkı: <b style="color:${r.contrib < 0 ? "#d9534f" : "inherit"}">${tl(r.contrib)}</b> (${r.margin < 0 ? "−" : ""}%${Math.abs(r.margin)})</div>` : ""}
      ${r.suggest ? `<div class="notice warn" style="margin-top:6px"><b>Önerilen fiyat: ${tl(r.suggest)}</b> / ${esc(u(r.unit))}<br><span class="tiny">${esc(r.why)}</span></div>
        <div class="row" style="gap:6px;margin-top:6px"><button class="btn sm grow" data-msg="${i}">💬 Müşteriye zam mesajı</button><button class="btn sm grow" data-go="#/teklif-hesap">🧮 Teklif asistanı</button></div>` : ""}
    </div>`).join("")}
    <div class="tiny muted" style="margin:8px 4px 80px">Doğrudan maliyet = mazot (aracın son 90 gün sefer/saat başı yakıtı × güncel litre fiyatı) + döküm (kayıtlardaki gerçek döküm ücreti). Şoför maaşı, bakım, lastik, amortisman ve sigorta dahil değildir; gerçek kâr bundan düşüktür. Mazotla ödenen işler ve kendi depo işleri listede yok. Hedef katkı: %${margin} (Teklif Asistanı ayarı).</div>`;
  for (const b of qsa("[data-msg]", root))
    b.addEventListener("click", async () => {
      const r = rows[Number(b.dataset.msg)];
      const txt = `Merhaba, ${r.customer} için ${u(r.work_type || "iş")} fiyatımız ${trDate(r.since)} tarihinden beri ${tl(r.price)} / ${u(r.unit)}.` +
        (r.fpThen && r.fpNow && r.fpNow > r.fpThen ? ` Bu sürede mazotun litresi ${Math.round(r.fpThen)} ₺'den ${Math.round(r.fpNow)} ₺'ye çıktı.` : "") +
        ` ${trDate(addDays7(today))} itibarıyla fiyatımızı ${tl(r.suggest)} / ${u(r.unit)} olarak güncellemek istiyoruz. Uygun görürseniz bilginize sunarız. Saygılarımızla.`;
      await shareText(txt);
    });
  return true;
}
function addDays7(t) { const x = new Date(t + "T12:00:00Z"); x.setUTCDate(x.getUTCDate() + 7); return x.toISOString().slice(0, 10); }
