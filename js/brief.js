// Sabah brifingi: günün ilk açılışında işletmenin durumu tek kartta. SAF hesap (morningBrief) + ekran (briefCard).
// Rakamlar telefonda hesaplanır; Gemini istenirse yalnız yorum cümlesi yazar (rakamlar doğrulanır).
import { isActive, todayStr, addDays, latestDocuments, tankStatus, trDate } from "./core.js";
import { receivables, workAmount } from "./collect-core.js";
import { monthlySeries } from "./finance-chart.js";
import { maintenanceBoard } from "./maint-core.js";
import { staleQuotes } from "./quote-core.js";
import { payrollAll } from "./payroll-core.js";

const live = (d, s) => (d[s] || []).filter(isActive);
const fmt = (n) => Number(n || 0).toLocaleString("tr-TR", { maximumFractionDigits: 0 });
const nm = (d, s, id) => (id ? live(d, s).find((x) => x.id === id)?.name || "" : "");
const units = (ws) => {
  const u = {};
  for (const w of ws) u[w.unit || ""] = Math.round(((u[w.unit || ""] || 0) + (Number(w.quantity) || 0)) * 10) / 10;
  return Object.entries(u).map(([k, q]) => `${fmt(q)} ${String(k).toLocaleLowerCase("tr-TR")}`).join(", ");
};

export function morningBrief(d, { today = todayStr(), notes = {}, yard = null, fuelRefPrice = null } = {}) {
  const maintDue = maintenanceBoard(d, { today }).filter((r) => r.state === "late" || r.state === "soon");
  const lines = [];
  const add = (ic, text, href = "", kind = "") => lines.push({ ic, text, href, kind });
  // 1) Dün (pazartesi ise cumartesiden beri)
  const dow = new Date(today + "T12:00:00").getDay();
  const from = addDays(today, dow === 1 ? -2 : -1), to = addDays(today, -1);
  const yWorks = live(d, "work_records").filter((w) => w.date >= from && w.date <= to);
  const label = from === to ? "Dün" : "Hafta sonu";
  if (yWorks.length) {
    const byV = {};
    for (const w of yWorks) (byV[nm(d, "vehicles", w.vehicle_id) || "—"] ||= []).push(w);
    const top = Object.entries(byV).sort((a, b) => b[1].length - a[1].length).slice(0, 4).map(([v, ws]) => `${v} ${units(ws)}`).join(" · ");
    const amt = yWorks.reduce((n, w) => n + workAmount(w), 0);
    const np = yWorks.filter((w) => !workAmount(w) && !w.customer_fuel_allowance_l && !live(d, "customers").find((c) => c.id === w.customer_id)?.internal).length;
    add("🚚", `${label}: ${yWorks.length} iş (${units(yWorks)})${amt ? ` · ${fmt(amt)} ₺` : ""}${np ? ` · ${np} iş fiyatsız` : ""}`, "#/isler");
    add("", top);
  } else add("🚚", `${label} hiç iş kaydı yok — unutulan iş var mı?`, "#/akilli-asistan", "warn");
  // 2) Tahsilat ve alacak
  const yCash = live(d, "cash_records").filter((c) => c.cash_type === "Müşteriden Para Alındı" && c.date >= from && c.date <= to).reduce((n, c) => n + (Number(c.amount) || 0), 0);
  const rec = receivables(d, { today, notes });
  add("💰", `Toplam alacak ${fmt(rec.total)} ₺${rec.buckets.b90 ? ` (90 günü geçen ${fmt(rec.buckets.b90)} ₺)` : ""}${yCash ? ` · ${label.toLocaleLowerCase("tr-TR")} ${fmt(yCash)} ₺ tahsilat` : ""}`, "#/tahsilat", rec.buckets.b90 ? "warn" : "");
  const promises = rec.rows.filter((r) => r.promise && r.promise.date <= today);
  for (const r of promises.slice(0, 3)) add("🤝", `${r.name} ${r.promise.date === today ? "bugün ödeyecek" : "ödeme sözünü geçirdi (" + trDate(r.promise.date) + ")"}${r.promise.amount ? ` · ${fmt(r.promise.amount)} ₺` : ""}`, "#/tahsilat/" + r.id, r.promise.late ? "alert" : "");
  const risky = rec.rows.filter((r) => !r.promise && r.oldest_days > 60).slice(0, 2);
  for (const r of risky) add("⏳", `${r.name}: ${fmt(r.total)} ₺, en eskisi ${r.oldest_days} gün${r.reminded_days != null ? ` (hatırlatma ${r.reminded_days} gün önce)` : " — hiç hatırlatılmadı"}`, "#/tahsilat/" + r.id, "warn");
  // 3) Depo tankı
  const tank = tankStatus(live(d, "fuel_tank_movements"), today);
  if (tank.in || tank.out) add("🛢", `Depoda ${fmt(tank.remaining)} L mazot${tank.daysLeft != null ? ` · günde ~${fmt(tank.daily)} L → ${tank.daysLeft} gün yeter` : ""}`, "#/depo", tank.daysLeft != null && tank.daysLeft <= 3 ? "alert" : "");
  // 4) Belgeler (14 gün)
  const docs = latestDocuments(live(d, "documents")).filter((x) => x.expiry_date && x.expiry_date <= addDays(today, 14)).sort((a, b) => a.expiry_date.localeCompare(b.expiry_date));
  for (const x of docs.slice(0, 3)) add("📄", `${nm(d, "vehicles", x.vehicle_id || x.owner_id) || nm(d, "personnel", x.personnel_id || x.owner_id) || (x.owner_type === "company" ? "Şirket" : "Belge")} · ${x.category || "belge"} ${x.expiry_date < today ? "süresi doldu" : trDate(x.expiry_date) + "'de bitiyor"}`, "#/belgeler", x.expiry_date < today ? "alert" : "warn");
  // 4b) Bakım takvimi
  for (const r of maintDue.slice(0, 3)) add("🔧", `${r.v.name} · ${r.rule.title}: ${r.text}`, "#/bakim-takvimi/" + r.v.id, r.state === "late" ? "alert" : "warn");
  // 4c) Cevap bekleyen teklifler
  for (const { q, age } of staleQuotes(d, { today }).slice(0, 2)) add("📄", `Teklif #${String(q.quote_no || "").padStart(4, "0")} (${nm(d, "customers", q.customer_id) || "müşteri"}) ${age} gündür cevapsız — arayın`, "#/teklif/" + q.id, "warn");
  // 4d) Ay sonu maaş: 28'inden ayın 3'üne kadar, kapatılmamış maaşlar
  const day = Number(today.slice(8, 10));
  if (day >= 28 || day <= 3) {
    const [y, mo] = today.split("-").map(Number);
    const per = day >= 28 ? today.slice(0, 7) : `${mo === 1 ? y - 1 : y}-${String(mo === 1 ? 12 : mo - 1).padStart(2, "0")}`;
    const open = payrollAll(d, per, { today }).filter((x) => !x.r.closed && x.r.gross > 0);
    if (open.length) add("👷", `${per.slice(5)}.${per.slice(0, 4)} maaşı: ${open.length} kişi kapatılmadı · ödenecek ~${fmt(open.reduce((n, x) => n + Math.max(0, x.r.remaining), 0))} ₺`, "#/puantaj?ay=" + per, "warn");
  }
  // 5) Kendi depo stoku
  if (yard && yard.total >= (yard.alert || 15)) add("🏗", `Kendi depoda ~${fmt(yard.total)} kamyonet yükü birikti — döküm sahasına gönderme zamanı`, "#/kendi-depo", "warn");
  // 6) Bu ay
  const m = monthlySeries(d, { today, months: 1, fuelRefPrice })[0];
  if (m.works || m.cost) add("📊", `Bu ay: iş ${fmt(m.work)} ₺ · masraf ${fmt(m.cost)} ₺ · tahmini kâr ${fmt(m.profit)} ₺${m.fuelPayL ? ` · mazot karşılığı ${fmt(m.fuelPayL)} L` : ""}${m.unpriced ? ` · ${m.unpriced} iş fiyatsız` : ""}`, "#/finans", m.profit < 0 ? "warn" : "");
  const text = lines.map((l) => (l.ic ? l.ic + " " : "   ") + l.text).join("\n");
  return { date: today, lines, text, facts: { yesterday_works: yWorks.length, receivable: rec.total, overdue90: rec.buckets.b90, tank_days: tank.daysLeft, month_profit: m.profit } };
}

// Sesli okuma: tarayıcının kendi Türkçe sesi (ücretsiz, internetsiz)
export function speak(text) {
  if (!("speechSynthesis" in window)) return false;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(String(text).replace(/[🚚💰🤝⏳🛢📄🏗📊☀️]/gu, "").replace(/₺/g, " lira").replace(/ L /g, " litre ").replace(/~/g, "yaklaşık "));
  u.lang = "tr-TR";
  const v = speechSynthesis.getVoices().find((x) => /^tr/i.test(x.lang));
  if (v) u.voice = v;
  u.rate = 1.0;
  speechSynthesis.speak(u);
  return true;
}

// Ana sayfa kartı
export async function briefCard(ctx, host, data) {
  const { db } = ctx;
  const today = todayStr();
  const closed = (await db.metaGet("brief_closed")) === today;
  const yc = await import("./yard-core.js");
  const ys = (await db.metaGet("yard_settings")) || {};
  const yard = yc.yardSite(data) && yc.yardCustomer(data) ? { total: yc.yardStock(data, { settings: ys, today }).total, alert: Number(ys.alert) || 15 } : null;
  const B = morningBrief(data, { today, notes: (await db.metaGet("collect_notes")) || {}, yard, fuelRefPrice: await db.metaGet("fuel_ref_price") });
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  const draw = (open) => {
    host.innerHTML = open
      ? `<div class="card" style="border-left:4px solid #f5a623"><div class="row between"><b>☀️ Günaydın — sabah brifingi</b><button class="btn sm ghost" data-bclose aria-label="Kapat">✕</button></div>
        ${B.lines.map((l) => `<div class="small ${l.href ? "tap" : ""}" ${l.href ? `data-go="${esc(l.href)}"` : ""} style="margin:5px 0;${l.kind === "alert" ? "color:#d9534f;font-weight:600" : l.kind === "warn" ? "color:#b9770e" : ""}">${l.ic ? esc(l.ic) + " " : '<span style="display:inline-block;width:1.4em"></span>'}${esc(l.text)}</div>`).join("")}
        <div data-badvice></div>
        <div class="row" style="gap:6px;margin-top:8px;flex-wrap:wrap"><button class="btn sm grow" data-bspeak>🔊 Sesli oku</button><button class="btn sm grow" data-bshare>📤 Paylaş</button><button class="btn sm grow" data-badv>🤖 Ne yapmalıyım?</button></div></div>`
      : `<div class="card tap" data-bopen><div class="row between"><span class="small">☀️ Sabah brifingi</span><span class="muted small">aç ›</span></div></div>`;
    host.querySelector("[data-bopen]")?.addEventListener("click", () => draw(true));
    host.querySelector("[data-bclose]")?.addEventListener("click", async () => { await db.metaSet("brief_closed", today); draw(false); });
    host.querySelector("[data-bspeak]")?.addEventListener("click", () => { if (!speak("Günaydın. " + B.text)) (ctx.toast || alert)("Bu telefonda sesli okuma yok"); });
    host.querySelector("[data-bshare]")?.addEventListener("click", async () => (await import("./ui.js")).shareText("☀️ Sabah brifingi — " + trDate(today) + "\n\n" + B.text));
    host.querySelector("[data-badv]")?.addEventListener("click", async (ev) => {
      const b = ev.currentTarget, box = host.querySelector("[data-badvice]");
      b.disabled = true;
      box.innerHTML = '<div class="muted small">Gemini düşünüyor…</div>';
      try {
        const { withModelFallback, geminiText } = await import("./ai-gemini.js");
        const { keepVerified } = await import("./day-summary.js");
        const knowledge = (await import("./expert-core.js")).EXPERT_KNOWLEDGE;
        const out = await withModelFallback(db, (o) => geminiText("Bugünün brifingi:\n" + B.text + "\n\nRakamlar (JSON): " + JSON.stringify(B.facts), { ...o, maxTokens: 600,
          system: knowledge + "\nBir hafriyat/nakliye işletmesinin sahibine bugün yapması gerekenleri öner. En çok 3 kısa madde, Türkçe, sade. Yalnız brifingde geçen rakam ve adları kullan; rakam uydurma. Önce parayı (tahsilat, söz, gecikme), sonra yakıt/belge, sonra iş. Her madde bir eylem: 'X'i ara', 'Y'ye hatırlatma gönder', 'depoya mazot söyle'." }));
        const v = keepVerified(String(out || ""), [B.text, B.facts]);
        v.text = v.text.replace(/\s+\d+\.\s*(?=\d+\.|$)/g, " ").replace(/\s(\d+\.)\s/g, "\n$1 ").trim();
        box.innerHTML = v.text ? `<div class="notice info" style="margin-top:6px"><span>🤖</span><span style="white-space:pre-wrap">${esc(v.text)}</span></div>` : '<div class="muted small">Öneri çıkmadı.</div>';
      } catch (e) {
        box.innerHTML = `<div class="muted small">${esc(e.message || e)}</div>`;
      }
      b.disabled = false;
    });
  };
  draw(!closed);
}
