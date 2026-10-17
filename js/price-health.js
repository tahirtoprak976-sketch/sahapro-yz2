// Fiyat sağlığı — SAF katman. Her müşteri × iş türü × birim için: şu anki fiyat, ne zamandır aynı, birim başı doğrudan maliyet
// (mazot + döküm), katkı ve kâr oranı; mazot fiyatı arttıysa ya da kâr düşükse zam önerisi.
// Şoför maaşı, amortisman, bakım dahil DEĞİL (doğrudan maliyet) — ekranda yazar.
import { isActive, todayStr, addDays } from "./core.js";
import { dumpFee } from "./dump-fees.js";
import { grossUnitPrice, fuelPerUnit } from "./quote-core.js";
import { fuelPrice } from "./finance-chart.js";

const live = (d, s) => (d[s] || []).filter(isActive);
const r0 = (n) => Math.round(Number(n) || 0);
const r1 = (n) => Math.round((Number(n) || 0) * 10) / 10;
const near = (a, b) => Math.abs(a - b) <= Math.max(1, b * 0.01);
const round50 = (n) => Math.ceil(n / 50) * 50;

// Tarihteki mazot litre fiyatı: o tarihten önceki 45 gündeki ödenen alımların ortalaması (yoksa tank maliyeti / ayar)
export function fuelPriceAt(d, date, ref = null) {
  const from = addDays(date, -45);
  let L = 0, T = 0;
  for (const f of live(d, "fuel_records")) if (f.date >= from && f.date <= date && Number(f.total) > 0 && Number(f.liters) > 0 && f.fuel_source !== "Müşteri Verdi") { L += Number(f.liters); T += Number(f.total); }
  for (const m of live(d, "fuel_tank_movements")) if (m.move_type === "GİRİŞ" && !m.customer_id && m.date >= from && m.date <= date && Number(m.total) > 0 && Number(m.liters) > 0) { L += Number(m.liters); T += Number(m.total); }
  return L > 0 ? T / L : fuelPrice(d, date, ref);
}

export function priceHealth(d, { today = todayStr(), days = 120, targetMargin = 20, fuelRefPrice = null } = {}) {
  const from = addDays(today, -days);
  const internal = new Set(live(d, "customers").filter((c) => c.internal).map((c) => c.id));
  const nm = (s, id) => live(d, s).find((x) => x.id === id)?.name || "—";
  const groups = new Map();
  for (const w of live(d, "work_records")) {
    if (internal.has(w.customer_id) || !w.customer_id || Number(w.customer_fuel_allowance_l) > 0) continue;
    const p = grossUnitPrice(w);
    if (!p) continue;
    const k = [w.customer_id, w.work_type || "", w.unit || ""].join("|");
    (groups.get(k) || groups.set(k, []).get(k)).push({ w, p });
  }
  const fpNow = fuelPriceAt(d, today, fuelRefPrice);
  const out = [];
  for (const [k, all] of groups) {
    all.sort((a, b) => String(a.w.date).localeCompare(String(b.w.date)));
    const recent = all.filter((x) => x.w.date >= from && x.w.date <= today);
    if (!recent.length) continue;
    const last = all[all.length - 1];
    const price = last.p;
    // Bu fiyat ne zamandan beri: sondan geriye aynı fiyatın ilk görüldüğü tarih
    let since = last.w.date;
    for (let i = all.length - 1; i >= 0 && near(all[i].p, price); i--) since = all[i].w.date;
    const [cid, work_type, unit] = k.split("|");
    const qty = recent.reduce((n, x) => n + (Number(x.w.quantity) || 0), 0);
    const revenue = recent.reduce((n, x) => n + x.p * (Number(x.w.quantity) || 0), 0);
    // Birim başı mazot (L): işi yapan araçların sefer/saat başı mazotu, miktarla ağırlıklı
    let fuelL = 0, fuelQ = 0;
    for (const x of recent) {
      const f = ["Sefer", "Ton", "Saat"].includes(unit) ? fuelPerUnit(d, { vehicle_id: x.w.vehicle_id, unit: unit === "Ton" ? "Sefer" : unit, today }) : null;
      if (f) { const q = Number(x.w.quantity) || 0; const per = unit === "Ton" ? f.per / Math.max(1, Number(x.w.tonnage) / Math.max(1, q) || 25) : f.per; fuelL += per * q; fuelQ += q; }
    }
    const perFuelL = fuelQ ? fuelL / fuelQ : null;
    // Birim başı döküm (kayıtlardaki gerçek döküm maliyeti)
    const dumpT = recent.reduce((n, x) => n + (dumpFee(d, x.w)?.amount || 0), 0);
    const perDump = qty ? dumpT / qty : 0;
    const fpThen = fuelPriceAt(d, since, fuelRefPrice);
    const fuelCost = perFuelL != null && fpNow ? perFuelL * fpNow : null;
    const cost = (fuelCost || 0) + perDump;
    const margin = price > 0 && (fuelCost != null || perDump) ? ((price - cost) / price) * 100 : null;
    const age = Math.round((Date.parse(today + "T12:00:00Z") - Date.parse(since + "T12:00:00Z")) / 864e5);
    const fuelRise = perFuelL != null && fpNow && fpThen ? perFuelL * (fpNow - fpThen) : 0;
    let suggest = null, why = "";
    const minPrice = cost > 0 ? round50(cost / (1 - targetMargin / 100)) : null;
    if (fuelRise > price * 0.02 && age >= 60) { suggest = round50(price + fuelRise); why = `Fiyat ${age} gündür aynı; bu sürede mazot litresi ${r0(fpThen)} → ${r0(fpNow)} ₺ oldu (birim başı +${r0(fuelRise)} ₺ maliyet).`; }
    if (minPrice && minPrice > price && (!suggest || minPrice > suggest)) { suggest = minPrice; why = (why ? why + " " : "") + `Doğrudan maliyet ${r0(cost)} ₺; %${targetMargin} katkı için en az ${minPrice} ₺.`; }
    out.push({
      key: k, customer_id: cid, customer: nm("customers", cid), work_type, unit, price: r0(price), since, age, n: recent.length, qty: r1(qty), revenue: r0(revenue),
      fuelL: perFuelL != null ? r1(perFuelL) : null, fuelCost: fuelCost != null ? r0(fuelCost) : null, dump: r0(perDump), cost: r0(cost), contrib: r0(price - cost),
      margin: margin != null ? Math.round(margin) : null, fpNow: fpNow ? r1(fpNow) : null, fpThen: fpThen ? r1(fpThen) : null, suggest, why,
      state: margin == null ? "?" : margin < 0 ? "zarar" : margin < targetMargin / 2 ? "düşük" : suggest ? "zam" : "iyi",
    });
  }
  const rank = { zarar: 0, düşük: 1, zam: 2, "?": 3, iyi: 4 };
  return out.sort((a, b) => rank[a.state] - rank[b.state] || b.revenue - a.revenue);
}
