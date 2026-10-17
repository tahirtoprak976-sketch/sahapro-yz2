// Döküm ücreti: döküm sahasının kartındaki ücret (ton başı ya da sefer başı, KDV dahil) × işin tonu / seferi.
// Ton: fişteki ton (iş kaydında "tonaj"); fiş yoksa aracın "ortalama yük"ü (kartta yoksa tır 27, kamyon 22 ton) × sefer — tahmin olarak işaretlenir.
// Belediyenin resmi sahaları: Bolluca 160 ₺/ton, Cebeci 210 ₺/ton, İSTAÇ 235 ₺/ton (KDV dahil, Ekim 2026, işletme sahibinden).
import { isActive, transportVehicleType } from "./core.js";

const live = (d, s) => (d[s] || []).filter(isActive);
const fold = (s) => String(s || "").toLocaleLowerCase("tr-TR").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/ı/g, "i");
const r2 = (n) => Math.round(n * 100) / 100;

export const OFFICIAL_DUMPS = [
  { key: "bolluca", name: "Bolluca", fee: 160 },
  { key: "cebeci", name: "Cebeci", fee: 210 },
  { key: "istac", name: "İSTAÇ Döküm", fee: 235 },
];
export const FEE_UNITS = ["Ton", "Sefer"];
// Araç kartında "ortalama yük" yoksa türüne göre (işletme sahibinden, Ekim 2026): tır 27 ton, kamyon 22 ton
export const DEFAULT_LOAD_TON = { TIR: 27, TRUCK: 22 };
export function loadTon(v) {
  if (Number(v?.load_ton) > 0) return Number(v.load_ton);
  return DEFAULT_LOAD_TON[transportVehicleType(v?.type)] || 0;
}

// Bir işin döküm ücreti. null: maliyet yok (döküm yeri/ücret tanımlı değil ya da depodan çıkışta elle yazılmamış)
export function dumpFee(d, w) {
  if (!w) return null;
  const s0 = live(d, "dump_sites").find((x) => x.id === w.dump_site_id);
  // Elle yazılan döküm maliyeti her zaman geçerli (iş kaydında "Döküm maliyeti ₺")
  if (Number(w.dump_cost) > 0) return { site: s0?.name || w.dump_area || "Döküm", unit: "Elle", fee: null, amount: r2(Number(w.dump_cost)), trips: w.unit === "Sefer" ? Number(w.quantity) || 0 : 1, ton: null, estimated: false, manual: true };
  // Kendi depodan çıkış (iç iş): maliyeti işletme sahibi elle yazar; boşsa maliyet yok (ör. stabilize çıkışı)
  if (live(d, "customers").find((c) => c.id === w.customer_id)?.internal) return null;
  if (!w.dump_site_id) return null;
  const s = s0;
  const fee = Number(s?.fee) || 0;
  if (!s || !(fee > 0) || !FEE_UNITS.includes(s.fee_unit)) return null;
  const qty = Number(w.quantity) || 0;
  const trips = w.unit === "Sefer" ? qty : 1;
  if (s.fee_unit === "Sefer") return { site: s.name, unit: "Sefer", fee, amount: r2(fee * trips), trips, ton: null, estimated: false };
  let ton = Number(w.tonnage) || (w.unit === "Ton" ? qty : 0), estimated = false;
  if (!(ton > 0)) {
    const v = live(d, "vehicles").find((x) => x.id === w.vehicle_id);
    const load = loadTon(v);
    if (load > 0 && w.unit === "Sefer") { ton = r2(load * trips); estimated = true; }
  }
  if (!(ton > 0)) return { site: s.name, unit: "Ton", fee, amount: null, trips, ton: null, estimated: false, missing: true };
  return { site: s.name, unit: "Ton", fee, amount: r2(fee * ton), trips, ton: r2(ton), estimated };
}

export function dumpFeeRows(d, { from = "", to = "" } = {}) {
  const inR = (x) => x && (!from || x >= from) && (!to || x <= to);
  const out = [];
  for (const w of live(d, "work_records")) {
    if (!inR(w.date)) continue;
    const f = dumpFee(d, w);
    if (f) out.push({ w, ...f });
  }
  return out;
}

// İlk açılışta resmi sahaların ücretleri karta yazılır (kart yoksa açılır; ücret elle girilmişse dokunulmaz)
export async function seedOfficialDumps(db) {
  if (await db.metaGet("dump_fees_seed_v1")) return 0;
  const sites = (await db.getAll("dump_sites")).filter(isActive);
  let n = 0;
  for (const o of OFFICIAL_DUMPS) {
    const s = sites.find((x) => fold(x.name).replace(/[^a-z]/g, "").includes(o.key));
    if (s) {
      if (!(Number(s.fee) > 0)) { await db.saveExisting("dump_sites", s, { fee: o.fee, fee_unit: "Ton", official: true }, "Resmi döküm ücreti"); n++; }
    } else { await db.saveNew("dump_sites", { name: o.name, fee: o.fee, fee_unit: "Ton", official: true, note: "Belediye resmi döküm sahası · ton başı KDV dahil" }, "Resmi döküm sahası"); n++; }
  }
  await db.metaSet("dump_fees_seed_v1", true);
  return n;
}
