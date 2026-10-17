// Bakım takvimi — SAF katman. Araç kartında kurallar (vehicle.service_rules): "Motor yağı 500 saatte bir", "20.000 km'de bir", "180 günde bir".
// Sayaç: araç kartı, sayaç okumaları ve yakıt kayıtlarındaki km/saat; makinede son okumadan sonraki saatlik işler eklenerek tahmin.
// Son bakım: kurala bağlı bakım kaydı > başlığına uyan bakım kaydı > kuralda elle girilen başlangıç. Kalan km/saat/gün ve tahmini gün hesaplanır.
import { isActive, todayStr, addDays } from "./core.js";

const live = (d, s) => (d[s] || []).filter(isActive);
const fold = (s) => String(s || "").toLocaleLowerCase("tr-TR").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/ı/g, "i");
const r0 = (n) => Math.round(n);
const days = (a, b) => Math.round((Date.parse(b + "T12:00:00Z") - Date.parse(a + "T12:00:00Z")) / 864e5);

// Öneri şablonları (üretici kitapçığına göre değiştirilebilir)
export const TEMPLATES = {
  road: [
    { title: "Motor yağı + filtre", every_km: 20000, keywords: "motor yag,yag bakim,yag degis,periyodik" },
    { title: "Hava filtresi", every_km: 40000, keywords: "hava filtre" },
    { title: "Şanzıman / diferansiyel yağı", every_km: 100000, keywords: "sanziman,diferansiyel" },
    { title: "Fren kontrolü", every_days: 90, keywords: "fren,balata" },
  ],
  trailer: [
    { title: "Fren / balata kontrolü", every_days: 90, keywords: "fren,balata" },
    { title: "Dingil rulman yağlama", every_km: 50000, keywords: "rulman,dingil,gres" },
  ],
  machine: [
    { title: "Motor yağı + filtre", every_hours: 500, keywords: "motor yag,yag bakim,yag degis,periyodik" },
    { title: "Hidrolik filtre", every_hours: 1000, keywords: "hidrolik filtre" },
    { title: "Hidrolik yağı", every_hours: 2000, keywords: "hidrolik yag" },
    { title: "Yakıt filtresi", every_hours: 500, keywords: "yakit filtre,mazot filtre" },
  ],
};
const ROAD = /kamyon|tir|cekici|kamyonet|pikap|dorse|damper|romork|binek|otomobil/;
const TRAILER = /romork|dorse/;
export const isRoadVehicle = (v) => ROAD.test(fold([v?.type, v?.name].join(" ")));
export const isTrailer = (v) => TRAILER.test(fold(v?.type));
export const templatesFor = (v) => (isTrailer(v) ? TEMPLATES.trailer : isRoadVehicle(v) ? TEMPLATES.road : TEMPLATES.machine);

// Tüm sayaç noktaları (tarih, değer) — km ya da saat
export function meterPoints(d, v, kind) {
  const f = kind === "km" ? "km" : "machine_hours";
  const pts = [];
  for (const r of live(d, "meter_readings")) if (r.vehicle_id === v.id && r.kind === (kind === "km" ? "km" : "hours") && Number(r.value) > 0) pts.push({ date: r.date, value: Number(r.value), src: "okuma" });
  for (const r of live(d, "fuel_records")) if (r.vehicle_id === v.id && Number(r[f]) > 0) pts.push({ date: r.date, value: Number(r[f]), src: "yakıt" });
  for (const r of live(d, "maintenance_records")) if (r.vehicle_id === v.id && Number(r[f]) > 0) pts.push({ date: r.date, value: Number(r[f]), src: "bakım" });
  if (Number(v[f]) > 0) pts.push({ date: String(v.meter_date || v.updated_at || v.created_at || "").slice(0, 10) || "0000-00-00", value: Number(v[f]), src: "kart" });
  return pts.sort((a, b) => a.date.localeCompare(b.date) || a.value - b.value);
}

// Güncel sayaç + günlük kullanım. Makinede (saat) son okumadan sonraki "Saat" birimli işler eklenir (tahmini).
export function meterNow(d, v, kind, { today = todayStr() } = {}) {
  const pts = meterPoints(d, v, kind);
  if (!pts.length) return null;
  const last = pts.reduce((a, b) => (b.value > a.value ? b : a));
  let value = last.value, est = 0;
  if (kind === "hours") {
    est = live(d, "work_records").filter((w) => w.vehicle_id === v.id && w.unit === "Saat" && w.date > last.date && w.date <= today).reduce((n, w) => n + (Number(w.quantity) || 0), 0);
    value += est;
  }
  // Kullanım hızı: son 120 gündeki ilk ve son nokta
  const recent = pts.filter((p) => p.date >= addDays(today, -120) && p.date !== "0000-00-00");
  let perDay = null;
  if (recent.length >= 2) {
    const a = recent[0], b = recent.reduce((x, y) => (y.value > x.value ? y : x));
    const span = days(a.date, b.date);
    if (span >= 7 && b.value > a.value) perDay = (b.value - a.value) / span;
  }
  if (perDay == null && kind === "hours") {
    const h = live(d, "work_records").filter((w) => w.vehicle_id === v.id && w.unit === "Saat" && w.date > addDays(today, -60) && w.date <= today).reduce((n, w) => n + (Number(w.quantity) || 0), 0);
    if (h > 0) perDay = h / 60;
  }
  return { value: r0(value), readDate: last.date, src: last.src, est: r0(est), perDay };
}

// Sayacın belirli bir tarihteki değeri (o tarihe kadarki en büyük nokta)
export function meterAt(d, v, kind, date) {
  const pts = meterPoints(d, v, kind).filter((p) => p.date <= date);
  return pts.length ? Math.max(...pts.map((p) => p.value)) : null;
}

const kwList = (rule) => (rule.keywords ? String(rule.keywords).split(",") : [fold(rule.title).split(/\s+/).filter((w) => w.length >= 3).slice(0, 2).join(" ")]).map((k) => fold(k).trim()).filter(Boolean);

export function lastDone(d, v, rule) {
  const ms = live(d, "maintenance_records").filter((m) => m.vehicle_id === v.id && m.status !== "Açık" && m.status !== "Parça Bekliyor").sort((a, b) => b.date.localeCompare(a.date));
  const kws = kwList(rule);
  const m = ms.find((x) => x.service_rule_id === rule.id) || ms.find((x) => { const t = fold([x.maint_type, x.description].join(" ")); return kws.some((k) => t.includes(k)); });
  const base = rule.last && (rule.last.date || rule.last.km || rule.last.hours) ? rule.last : null;
  if (m && (!base || m.date >= (base.date || ""))) return { date: m.date, km: Number(m.km) || meterAt(d, v, "km", m.date), hours: Number(m.machine_hours) || meterAt(d, v, "hours", m.date), src: "bakım kaydı", id: m.id };
  if (base) return { date: base.date || null, km: Number(base.km) || null, hours: Number(base.hours) || null, src: "elle" };
  return null;
}

export function ruleStatus(d, v, rule, { today = todayStr() } = {}) {
  const last = lastDone(d, v, rule);
  const km = rule.every_km ? meterNow(d, v, "km", { today }) : null;
  const hr = rule.every_hours ? meterNow(d, v, "hours", { today }) : null;
  const out = { rule, last, km, hr, leftKm: null, leftHours: null, leftDays: null, estDays: null, state: "?", text: "" };
  const parts = [], est = [];
  if (!last) { out.state = "?"; out.text = "Son ne zaman yapıldı? Girin"; return out; }
  if (rule.every_km) {
    if (last.km != null && km) { out.leftKm = r0(last.km + Number(rule.every_km) - km.value); parts.push(out.leftKm <= 0 ? `${Math.abs(out.leftKm).toLocaleString("tr-TR")} km geçti` : `${out.leftKm.toLocaleString("tr-TR")} km kaldı`); if (km.perDay) est.push(out.leftKm / km.perDay); }
    else parts.push("km bilinmiyor");
  }
  if (rule.every_hours) {
    if (last.hours != null && hr) { out.leftHours = r0(last.hours + Number(rule.every_hours) - hr.value); parts.push(out.leftHours <= 0 ? `${Math.abs(out.leftHours).toLocaleString("tr-TR")} saat geçti` : `${out.leftHours.toLocaleString("tr-TR")} saat kaldı`); if (hr.perDay) est.push(out.leftHours / hr.perDay); }
    else parts.push("saat bilinmiyor");
  }
  if (rule.every_days && last.date) { out.leftDays = Number(rule.every_days) - days(last.date, today); est.push(out.leftDays); parts.push(out.leftDays <= 0 ? `${Math.abs(out.leftDays)} gün geçti` : `${out.leftDays} gün kaldı`); }
  out.estDays = est.length ? Math.floor(Math.min(...est)) : null;
  const lefts = [out.leftKm, out.leftHours, out.leftDays].filter((x) => x != null);
  const soonKm = rule.every_km ? Math.max(1000, Number(rule.every_km) * 0.07) : 0, soonH = rule.every_hours ? Math.max(25, Number(rule.every_hours) * 0.07) : 0;
  if (!lefts.length) out.state = "?";
  else if (lefts.some((x) => x <= 0)) out.state = "late";
  else if ((out.leftKm != null && out.leftKm <= soonKm) || (out.leftHours != null && out.leftHours <= soonH) || (out.leftDays != null && out.leftDays <= 7) || (out.estDays != null && out.estDays <= 7)) out.state = "soon";
  else out.state = "ok";
  out.text = parts.join(" · ") + (out.estDays != null && out.estDays > 0 && out.state !== "late" && (out.leftKm != null || out.leftHours != null) ? ` (~${out.estDays} gün)` : "");
  return out;
}

const ORDER = { late: 0, soon: 1, "?": 2, ok: 3 };
export function maintenanceBoard(d, { today = todayStr() } = {}) {
  const rows = [];
  for (const v of live(d, "vehicles")) for (const rule of v.service_rules || []) rows.push({ v, ...ruleStatus(d, v, rule, { today }) });
  return rows.sort((a, b) => ORDER[a.state] - ORDER[b.state] || (a.estDays ?? 9999) - (b.estDays ?? 9999));
}

export function newRule(t) {
  return { id: "r" + Math.random().toString(36).slice(2, 9), title: t.title, every_km: Number(t.every_km) || null, every_hours: Number(t.every_hours) || null, every_days: Number(t.every_days) || null, keywords: t.keywords || "", last: t.last || null };
}

export function maintSummary(rows) {
  return rows.map((r) => ({ arac: r.v.name, bakim: r.rule.title, durum: { late: "GECİKTİ", soon: "yaklaşıyor", ok: "planlı", "?": "son bakım bilinmiyor" }[r.state], kalan_km: r.leftKm, kalan_saat: r.leftHours, kalan_gun: r.leftDays, tahmini_gun: r.estDays, son_bakim: r.last?.date || null, guncel_km: r.km?.value ?? null, guncel_saat: r.hr?.value ?? null }));
}
