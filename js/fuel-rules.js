// Yakıt kuralları — SAF katman. Yapay zeka gerekmez; telefondaki kayıtlarla hesaplanır.
// 1) litre × birim fiyat ≠ toplam  2) depodan fazla dolum  3) iş olmayan gün yakıt  4) tüketim kendi ortalamasının %30 üstünde
import { isActive, addDays, todayStr } from "./core.js";

const live = (d, s) => (d[s] || []).filter(isActive);
const r1 = (n) => Math.round(n * 10) / 10;

export function fuelFlags(data, { today = todayStr(), days = 7 } = {}) {
  const since = addDays(today, -days);
  const fuel = live(data, "fuel_records").filter((f) => f.vehicle_id && Number(f.liters) > 0);
  const works = live(data, "work_records");
  const out = [];
  const vName = (id) => { const v = live(data, "vehicles").find((x) => x.id === id); return v?.plate || v?.name || "Araç"; };
  for (const f of fuel) {
    if (f.date < since || f.date > today) continue;
    const L = Number(f.liters), up = Number(f.unit_price), tot = Number(f.total);
    // 1) Tutar tutarsızlığı
    if (up > 0 && tot > 0) {
      const calc = L * up;
      if (Math.abs(calc - tot) > Math.max(5, tot * 0.02))
        out.push({ rule: "total", kind: "warn", id: f.id, date: f.date, vehicle_id: f.vehicle_id, text: `${vName(f.vehicle_id)} ${f.date}: ${L} L × ${up} = ${Math.round(calc)} ₺, fişte ${tot} ₺` });
    }
    // 2) Depo kapasitesi (kartta yoksa aracın önceki en büyük dolumunun 1,3 katı)
    const v = live(data, "vehicles").find((x) => x.id === f.vehicle_id);
    const prev = fuel.filter((x) => x.vehicle_id === f.vehicle_id && x.id !== f.id && x.date < f.date).map((x) => Number(x.liters));
    const cap = Number(v?.tank_capacity) || (prev.length >= 3 ? Math.max(...prev) * 1.3 : 0);
    if (cap && L > cap)
      out.push({ rule: "capacity", kind: "warn", id: f.id, date: f.date, vehicle_id: f.vehicle_id, text: `${vName(f.vehicle_id)} ${f.date}: ${L} L dolum, ${v?.tank_capacity ? "depo " + cap + " L" : "şimdiye kadarki en büyük dolumdan çok fazla"}` });
    // 3) O gün ve bir gün öncesi/sonrası bu araca iş yok
    const near = [addDays(f.date, -1), f.date, addDays(f.date, 1)];
    if (!works.some((w) => w.vehicle_id === f.vehicle_id && near.includes(w.date)))
      out.push({ rule: "nowork", kind: "info", id: f.id, date: f.date, vehicle_id: f.vehicle_id, text: `${vName(f.vehicle_id)} ${f.date}: ${L} L yakıt alınmış ama o günlerde iş kaydı yok` });
  }
  // 4) Tüketim: son 14 gün L/iş birimi, aracın 15–90 gün önceki ortalamasıyla
  for (const v of live(data, "vehicles")) {
    const vw = works.filter((w) => w.vehicle_id === v.id && w.date <= today && w.date >= addDays(today, -90));
    const units = {};
    for (const w of vw) units[w.unit] = (units[w.unit] || 0) + 1;
    const unit = Object.entries(units).sort((a, b) => b[1] - a[1])[0]?.[0];
    if (!unit) continue;
    const win = (from, to) => {
      const q = vw.filter((w) => w.unit === unit && w.date >= from && w.date <= to).reduce((n, w) => n + (Number(w.quantity) || 0), 0);
      const fl = fuel.filter((f) => f.vehicle_id === v.id && f.date >= from && f.date <= to);
      return { q, L: fl.reduce((n, f) => n + Number(f.liters), 0), n: fl.length };
    };
    const recent = win(addDays(today, -13), today), base = win(addDays(today, -90), addDays(today, -14));
    if (recent.q < 3 || base.q < 5 || base.n < 3 || recent.n < 1) continue;
    const a = recent.L / recent.q, b = base.L / base.q;
    if (a > b * 1.3)
      out.push({ rule: "consumption", kind: "warn", vehicle_id: v.id, date: today, text: `${v.plate || v.name}: son 14 günde ${r1(a)} L/${unit.toLocaleLowerCase("tr-TR")}, kendi ortalaması ${r1(b)} (%${Math.round((a / b - 1) * 100)} fazla)` });
  }
  return out;
}
