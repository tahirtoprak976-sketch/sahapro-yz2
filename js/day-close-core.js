// "Günü kapat" kontrolü — SAF katman. Akşam tek listede: bugün eksik kalanlar + biriken açıklar.
// Her madde ilgili kayda gider (href). Yalnız işlem gerektiren maddeler; bilgi amaçlı olanlar "info".
import { isActive, addDays } from "./core.js";
import { workAmount } from "./collect-core.js";
import { isRoadVehicle } from "./maint-core.js";
import { loadTon } from "./dump-fees.js";
import { invoiceQueue } from "./invoice-core.js";

const live = (d, s) => (d[s] || []).filter(isActive);
const num = (n) => Number(n || 0).toLocaleString("tr-TR", { maximumFractionDigits: 1 });
const tl = (n) => Number(n || 0).toLocaleString("tr-TR", { maximumFractionDigits: 0 }) + " ₺";
const OFF_EVENTS = ["İzin", "Rapor", "Devamsızlık", "Çalıştı", "Yarım Gün"];

// attCount: { "work:<id>": n, "expense:<id>": n } — eklerin sayısı (DB'den hazırlanır)
export function dayCloseChecks(d, { date, attCount = {} } = {}) {
  const items = [];
  const push = (kind, group, text, sub, href) => items.push({ kind, group, text, sub: sub || "", href: href || "" });
  const nm = (s, id) => (id ? live(d, s).find((r) => r.id === id)?.name || "" : "");
  const internal = new Set(live(d, "customers").filter((c) => c.internal).map((c) => c.id));
  const works = live(d, "work_records");
  const today = works.filter((w) => w.date === date);
  const dow = new Date(date + "T12:00:00").getDay();

  // ---- Bugün ----
  if (!today.length) push("info", "Bugün", "Bugün hiç iş kaydı yok", dow === 0 ? "Pazar" : "Çalışma olduysa şoför mesajlarını işleyin", "#/akilli-asistan");
  for (const w of today) {
    const label = `${nm("vehicles", w.vehicle_id) || "Araç ?"} · ${nm("customers", w.customer_id) || "müşteri ?"} · ${num(w.quantity)} ${String(w.unit || "").toLocaleLowerCase("tr-TR")}`;
    const miss = [];
    if (!w.customer_id) miss.push("müşteri");
    if (!w.vehicle_id) miss.push("araç");
    if (!internal.has(w.customer_id) && !workAmount(w) && !(Number(w.customer_fuel_allowance_l) > 0)) miss.push("fiyat");
    if (w.unit === "Sefer" && (w.dump_site_id || w.dump_area) && !w.slip_no && !w.digital_slip_no && !attCount["work:" + w.id]) miss.push("döküm fişi");
    if (miss.length) push("warn", "Bugün", `Eksik: ${miss.join(", ")}`, label, "#/isler/" + w.id);
  }
  // Tonaj: aracın taşıyabileceğinden fazla (yanlış fiş ya da aşırı yük) ve aynı fiş no iki kez
  for (const w of today.filter((w) => Number(w.tonnage) > 0)) {
    const v = live(d, "vehicles").find((x) => x.id === w.vehicle_id);
    const cap = loadTon(v), trips = w.unit === "Sefer" ? Number(w.quantity) || 1 : 1;
    if (cap > 0 && Number(w.tonnage) / trips > cap * 1.15) push("warn", "Bugün", `Tonaj yüksek: ${num(Number(w.tonnage) / trips)} ton/sefer`, `${v?.name || "Araç"} ~${cap} ton taşır — fiş yanlış okunmuş ya da aşırı yük olabilir`, "#/isler/" + w.id);
  }
  const slipKey = (w) => String(w.slip_no || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  for (const w of today.filter((w) => slipKey(w).length >= 3)) {
    const other = works.find((x) => x.id !== w.id && slipKey(x) === slipKey(w) && (x.dump_site_id || "") === (w.dump_site_id || "") && x.date >= addDays(date, -60));
    if (other && (other.date !== date || w.id < other.id)) push("warn", "Bugün", `Aynı fiş no iki işte: ${w.slip_no}`, `${other.date === date ? "bugün" : other.date} tarihli başka bir işte de var — iki kez işlenmiş olabilir`, "#/isler/" + w.id);
  }
  for (const f of live(d, "fuel_records").filter((f) => f.date === date)) {
    const v = live(d, "vehicles").find((x) => x.id === f.vehicle_id);
    if (!v) continue;
    const road = isRoadVehicle(v);
    if (road ? !(Number(f.km) > 0) : !(Number(f.machine_hours) > 0))
      push("info", "Bugün", `Yakıtta ${road ? "km" : "makine saati"} yok`, `${v.name} · ${num(f.liters)} L — bakım takvimi için yazın`, "#/yakit/" + f.id);
  }
  for (const e of live(d, "expense_records").filter((e) => e.date === date && Number(e.amount) > 0 && !attCount["expense:" + e.id]))
    push("info", "Bugün", "Fişsiz gider", `${e.category || "Gider"} · ${tl(e.amount)}${e.company ? " · " + e.company : ""}`, "#/gider/" + e.id);
  // Şoför / operatör: bugün kaydı ya da puantaj işareti olmayanlar (pazar hariç)
  if (dow !== 0) {
    const ev = live(d, "personnel_events").filter((e) => e.date === date && OFF_EVENTS.includes(e.event_type));
    for (const p of live(d, "personnel").filter((p) => p.active !== false && (p.vehicle_id || live(d, "vehicles").some((v) => v.assignee_id === p.id)))) {
      const vids = new Set([p.vehicle_id, ...live(d, "vehicles").filter((v) => v.assignee_id === p.id).map((v) => v.id)].filter(Boolean));
      const has = today.some((w) => w.personnel_id === p.id || (!w.personnel_id && vids.has(w.vehicle_id))) || ev.some((e) => e.personnel_id === p.id);
      if (!has) push("warn", "Bugün", `${p.name}: bugün kayıt yok`, "Çalıştıysa şoför mesajını işleyin; çalışmadıysa puantajda izin/rapor işaretleyin", "#/puantaj/" + p.id + "?ay=" + date.slice(0, 7));
    }
  }
  for (const c of live(d, "cash_records").filter((c) => c.cash_status === "PERSONELDE"))
    push("warn", "Bugün", `Personelde para: ${tl(c.amount)}`, `${nm("personnel", c.personnel_id) || "Personel"} henüz teslim etmedi`, "#/kasa/" + c.id);

  // ---- Biriken (son 60 gün) ----
  const from = addDays(date, -60);
  const recent = works.filter((w) => w.date >= from && w.date <= date);
  const unpriced = recent.filter((w) => w.date < date && !internal.has(w.customer_id) && !workAmount(w) && !(Number(w.customer_fuel_allowance_l) > 0));
  if (unpriced.length) {
    const byC = new Map();
    for (const w of unpriced) byC.set(w.customer_id, (byC.get(w.customer_id) || 0) + 1);
    const top = [...byC.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([c, n]) => `${nm("customers", c) || "müşterisiz"} ${n}`).join(", ");
    push("warn", "Biriken", `${unpriced.length} işin fiyatı yok (son 60 gün)`, `${top} — fiyatsız iş hakedişe ve kâra girmez`, "#/isler?f=fiyatsiz");
  }
  // Hakediş kullanılan müşterilerde: 30 günden eski, fiyatlı, hakedişe girmemiş işler
  const hk = live(d, "hakedis").filter((h) => h.status !== "İptal");
  const inHk = new Set(hk.flatMap((h) => (h.items || []).map((it) => it.work_record_id)));
  const hkCust = new Set(hk.map((h) => h.customer_id));
  const old = works.filter((w) => hkCust.has(w.customer_id) && w.date < addDays(date, -30) && w.date >= addDays(date, -180) && workAmount(w) > 0 && !inHk.has(w.id));
  if (old.length) {
    const byC = new Map();
    for (const w of old) { const o = byC.get(w.customer_id) || { n: 0, a: 0 }; o.n++; o.a += workAmount(w); byC.set(w.customer_id, o); }
    for (const [c, o] of byC) push("warn", "Biriken", `${nm("customers", c)}: ${o.n} iş hakedişe girmemiş`, `${tl(o.a)} · 30 günden eski`, "#/hakedis/new");
  }
  // Mazot hakkı: araç bazında, son alımdan sonra 3+ mazotlu sefer
  for (const c of live(d, "customers")) {
    const ws = works.filter((w) => w.customer_id === c.id && Number(w.customer_fuel_allowance_l) > 0);
    if (!ws.length) continue;
    const byV = new Map();
    for (const w of ws) { const a = byV.get(w.vehicle_id) || []; a.push(w); byV.set(w.vehicle_id, a); }
    for (const [vid, vw] of byV) {
      const got = live(d, "fuel_records").filter((f) => f.fuel_source === "Müşteri Verdi" && f.customer_id === c.id && f.vehicle_id === vid);
      const earned = vw.reduce((n, w) => n + Number(w.customer_fuel_allowance_l), 0), recv = got.reduce((n, f) => n + (Number(f.liters) || 0), 0);
      const last = got.map((f) => f.date).sort().at(-1) || "";
      const trips = vw.filter((w) => w.date > last).reduce((n, w) => n + (w.unit === "Sefer" ? Number(w.quantity) || 0 : 1), 0);
      const bal = Math.round((earned - recv) * 10) / 10;
      if (bal > 0 && trips >= 3) push("warn", "Biriken", `${nm("vehicles", vid) || "Araç"}: ${c.name}'dan ${num(bal)} L mazot alınmadı`, `Son alımdan bu yana ${num(trips)} sefer${last ? "" : " (hiç alınmadı)"}`, "#/mazot-hesaplari");
    }
  }
  // Faturası kesilmemiş işler (7 günden eski)
  const inv = invoiceQueue(d, { today: date }).filter((q) => q.oldestDays > 7);
  for (const q of inv.slice(0, 5)) push("warn", "Biriken", `${q.customer.name}: ${q.n} işin faturası kesilmedi`, `${Math.round(q.net).toLocaleString("tr-TR")} ₺ (KDV hariç) · en eski ${q.oldestDays} gün`, "#/fatura/" + q.customer.id);
  const open = live(d, "maintenance_records").filter((m) => m.status && /arıza|bekl|açık|serviste|devam/i.test(m.status) && !/tamam|kapandı|bitti/i.test(m.status));
  if (open.length) push("info", "Biriken", `${open.length} açık arıza / bakım`, open.slice(0, 3).map((m) => `${nm("vehicles", m.vehicle_id)} ${m.maint_type || ""}`).join(", "), "#/bakim");

  const rank = { alert: 0, warn: 1, info: 2 };
  items.sort((a, b) => (a.group === b.group ? 0 : a.group === "Bugün" ? -1 : 1) || rank[a.kind] - rank[b.kind]);
  return { items, warns: items.filter((i) => i.kind !== "info").length };
}
