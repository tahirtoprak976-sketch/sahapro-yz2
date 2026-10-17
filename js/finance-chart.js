// Panodaki grafikler için saf hesaplar. Kayıt yazmaz, kullanıcıya gösterilecek özetleri üretir.
// Gelir = fiyatı girilmiş işlerin değeri (KDV durumu kayıttan bilinmediği için "iş değeri" denir),
// tahsilat = "Müşteriden Para Alındı" kasa kayıtları. Fiyatsız işler ayrıca sayılır; gizlenmez.
import { isActive, toKurus, fromKurus, todayStr, tankUnitCost } from "./core.js";
import { dumpFeeRows } from "./dump-fees.js";

// Mazotla ödenen işlerin ve müşterinin verdiği mazotun TL değeri: o tarihe kadarki depo alış ortalaması
// (yoksa Ayarlar'daki referans litre fiyatı). Fiyat bilinmiyorsa 0 sayılır ve ayrıca işaretlenir.
export function fuelPrice(data, date, ref = null) {
  return tankUnitCost(data.fuel_tank_movements || [], date) ?? tankUnitCost(data.fuel_tank_movements || []) ?? (Number(ref) > 0 ? Number(ref) : null);
}

const monthKey = (d) => String(d || "").slice(0, 7);
export function lastMonths(today = todayStr(), n = 6) {
  const [y, m] = today.split("-").map(Number);
  const out = [];
  for (let i = n - 1; i >= 0; i--) {
    const t = new Date(y, m - 1 - i, 1);
    out.push(`${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}`);
  }
  return out;
}
const TR_MONTHS = ["Oca", "Şub", "Mar", "Nis", "May", "Haz", "Tem", "Ağu", "Eyl", "Eki", "Kas", "Ara"];
export const monthLabel = (k) => TR_MONTHS[Number(k.slice(5, 7)) - 1] + " " + k.slice(2, 4);

export function monthlySeries(data, opts = {}) {
  const today = opts.today || todayStr();
  const keys = lastMonths(today, opts.months || 6);
  const rows = new Map(
    keys.map((k) => [k, { key: k, label: monthLabel(k), work: 0, collected: 0, expense: 0, fuel: 0, maint: 0, esnaf: 0, dump: 0, pay: 0, unpriced: 0, works: 0, fuelPay: 0, fuelPayL: 0, fuelPayUnvalued: 0, fuelGotL: 0 }]),
  );
  for (const w of data.work_records || []) {
    if (!isActive(w)) continue;
    const r = rows.get(monthKey(w.date));
    if (!r) continue;
    r.works++;
    const amt = w.price_snapshot?.amount;
    if (amt == null || !Number.isFinite(Number(amt))) r.unpriced++;
    else r.work += toKurus(amt);
    // Ücreti mazotla ödenen iş (ör. Kılıç): TL gelir SAYILMAZ, yalnız hak edilen litre tutulur.
    // Müşterinin verdiği mazot da araca konunca masraf sayılmaz (kasadan para çıkmaz). İkisi litre hesabında izlenir.
    const L = Number(w.customer_fuel_allowance_l) || 0;
    if (L > 0) r.fuelPayL += L;
  }
  for (const c of data.cash_records || []) {
    if (!isActive(c) || c.cash_type !== "Müşteriden Para Alındı") continue;
    const r = rows.get(monthKey(c.date));
    if (r) r.collected += toKurus(c.amount);
  }
  for (const e of data.expense_records || []) {
    if (!isActive(e) || e.dump_deposit) continue; // döküm hesabına yükleme: ön ödeme, maliyet dökümde yazılır
    const r = rows.get(monthKey(e.date));
    if (r) r.expense += toKurus(e.amount);
  }
  for (const f of data.fuel_records || []) {
    if (!isActive(f)) continue;
    const r = rows.get(monthKey(f.date));
    if (!r) continue;
    // Müşterinin verdiği mazot (tutarsız): para çıkmadı → masraf değil, yalnız litre
    if (f.fuel_source === "Müşteri Verdi" && !(Number(f.total) > 0)) r.fuelGotL += Number(f.liters) || 0;
    else r.fuel += toKurus(f.total);
  }
  // Bakım/arıza tutarı ve gidere/bakıma bağlı olmayan esnaf alışları da masraftır (Giderler ekranıyla aynı tanım)
  for (const m of data.maintenance_records || []) {
    if (!isActive(m) || !(Number(m.cost) > 0)) continue;
    const r = rows.get(monthKey(m.date));
    if (r) r.maint += toKurus(m.cost);
  }
  for (const b of data.payables || []) {
    if (!isActive(b) || b.status === "İptal" || b.party_type !== "supplier") continue;
    if (["expense_records", "maintenance_records", "fuel_tank_movements", "fuel_records"].includes(b.source_store)) continue;
    const r = rows.get(monthKey(b.date));
    if (r) r.esnaf += toKurus(Number(b.gross_total) || 0);
  }
  for (const p of data.payroll_entries || []) {
    if (!isActive(p) || p.kind !== "Ücret Tahakkuku" || !(Number(p.amount) > 0)) continue;
    const r = rows.get(monthKey(p.date));
    if (r) r.pay += toKurus(p.amount);
  }
  for (const f of dumpFeeRows(data)) {
    const r = rows.get(monthKey(f.w.date));
    if (r && f.amount > 0) r.dump += toKurus(f.amount);
  }
  return [...rows.values()].map((r) => ({
    ...r,
    work: fromKurus(r.work),
    dump: fromKurus(r.dump),
    pay: fromKurus(r.pay),
    maint: fromKurus(r.maint),
    esnaf: fromKurus(r.esnaf),
    collected: fromKurus(r.collected),
    expense: fromKurus(r.expense),
    fuel: fromKurus(r.fuel),
    cost: fromKurus(r.expense + r.fuel + r.maint + r.esnaf + r.dump + r.pay),
    fuelPay: fromKurus(r.fuelPay),
    fuelPayL: Math.round(r.fuelPayL * 10) / 10,
    fuelGotL: Math.round(r.fuelGotL * 10) / 10,
    // tahmini kâr = fiyatlı (parayla) iş değeri − masraflar; mazotla ödenen işler litre olarak ayrı (fuelPayL / fuelGotL)
    profit: fromKurus(r.work - r.expense - r.fuel - r.maint - r.esnaf - r.dump - r.pay),
  }));
}

// Son N gün araç başına iş sayısı, yakıt (Lt) ve maliyet (gider + yakıt ₺)
export function vehicleSeries(data, opts = {}) {
  const today = opts.today || todayStr();
  const days = opts.days || 30;
  const from = new Date(today + "T12:00:00");
  from.setDate(from.getDate() - days + 1);
  const fromS = todayStr(from);
  const inRange = (r) => isActive(r) && r.date >= fromS && r.date <= today;
  const rows = new Map();
  const get = (id) => {
    if (!id) return null;
    if (!rows.has(id)) rows.set(id, { id, works: 0, liters: 0, cost: 0 });
    return rows.get(id);
  };
  for (const w of data.work_records || []) if (inRange(w)) { const r = get(w.vehicle_id); if (r) r.works++; }
  for (const f of data.fuel_records || [])
    if (inRange(f)) {
      const r = get(f.vehicle_id);
      if (r) {
        r.liters += Number(f.liters) || 0;
        if (!(f.fuel_source === "Müşteri Verdi" && !(Number(f.total) > 0))) r.cost += toKurus(f.total);
      }
    }
  for (const e of data.expense_records || []) if (inRange(e)) { const r = get(e.vehicle_id); if (r) r.cost += toKurus(e.amount); }
  const name = (id) => {
    const v = (data.vehicles || []).find((x) => x.id === id);
    return v ? v.plate || v.name : "—";
  };
  return [...rows.values()]
    .map((r) => ({ ...r, name: name(r.id), cost: fromKurus(r.cost) }))
    .sort((a, b) => b.cost - a.cost || b.works - a.works);
}
