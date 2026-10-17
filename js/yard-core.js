// Kendi depo / stok sahası — SAF katman.
// Kamyonetimiz müşteriden döküm dahil malzeme (moloz, çöp, hafriyat) alıp kendi depoya döker (stok girer);
// birikince tır/kamyonla döküm sahalarına götürülür (stok çıkar). Çıkış seferleri iç iştir: hakedişe girmez.
// Stok "kamyonet yükü" cinsinden tahmindir: her aracın bir seferi kaç kamyonet yükü ettiği ayarlanır.
import { isActive, todayStr, addDays } from "./core.js";
import { foldTr } from "./parser.js";

const live = (d, s) => (d[s] || []).filter(isActive);
const norm = (s) => foldTr(s).replace(/[^\p{L}\p{N}]+/gu, " ").trim();
const r1 = (n) => Math.round(n * 10) / 10;

export const YARD_SITE_NAME = "Muratoğlu Depo (kendi saha)";
export const YARD_CUSTOMER_NAME = "Kendi Depo (iç iş)";
export const yardSite = (d) => live(d, "dump_sites").find((x) => x.own_yard) || null;
export const yardCustomer = (d) => live(d, "customers").find((x) => x.internal) || null;

// Aracın bir seferi kaç kamyonet yükü? Önce ayar, sonra tür/ad: kamyonet 1, kamyon 3, tır 6 (değiştirilebilir)
export const DEFAULT_FACTORS = { kamyonet: 1, kamyon: 3, tir: 6 };
export function vehicleFactor(v, settings = {}) {
  if (!v) return { f: 1, known: false };
  const own = Number(settings.byVehicle?.[v.id]);
  if (own > 0) return { f: own, known: true };
  const t = norm([v.type, v.name, v.model].filter(Boolean).join(" "));
  const k = { ...DEFAULT_FACTORS, ...(settings.defaults || {}) };
  if (/kamyonet|pikap|panelvan|transit/.test(t)) return { f: k.kamyonet, known: true };
  if (/\btir\b|cekici|dorse/.test(t)) return { f: k.tir, known: true };
  if (/kamyon|damper/.test(t)) return { f: k.kamyon, known: true };
  return { f: 1, known: false };
}

// Malzeme grubu: personel aynı yığına bazen moloz bazen hafriyat der → tek grup "Moloz / Hafriyat"; çöp ayrı
export const YARD_MATS = ["Moloz / Hafriyat", "Çöp", "Diğer"];
export function yardMaterial(w) {
  const t = norm([w.material, w.work_type, w.description].filter(Boolean).join(" "));
  if (/cop|copu|atik|hurda/.test(t)) return "Çöp";
  if (/moloz|beton|tugla|kirinti|hafriyat|harfiyat|toprak/.test(t)) return "Moloz / Hafriyat";
  return "Diğer";
}

const loads = (w, d, settings) => {
  const v = live(d, "vehicles").find((x) => x.id === w.vehicle_id);
  const { f, known } = vehicleFactor(v, settings);
  const q = w.unit === "Sefer" ? Number(w.quantity) || 0 : 0;
  return { n: r1(q * f), known, vehicle: v };
};

// Depoya giren: döküm yeri kendi depo olan (iç iş olmayan) işler. Çıkan: iç iş müşterisinin depodan götürdüğü seferler.
export function yardMoves(d, { from = "", to = "9999-12-31", settings = {} } = {}) {
  const site = yardSite(d), cust = yardCustomer(d);
  const ins = [], outs = [];
  for (const w of live(d, "work_records")) {
    if (w.date < from || w.date > to) continue;
    if (cust && w.customer_id === cust.id) {
      if (site && w.dump_site_id === site.id) continue; // depodan depoya: sayma
      const l = loads(w, d, settings);
      outs.push({ w, mat: yardMaterial(w), loads: l.n, known: l.known, vehicle: l.vehicle });
    } else if (site && w.dump_site_id === site.id) {
      const l = loads(w, d, settings);
      ins.push({ w, mat: yardMaterial(w), loads: l.n, known: l.known, vehicle: l.vehicle });
    }
  }
  return { ins, outs };
}

export function yardStock(d, { settings = {}, today = todayStr() } = {}) {
  const base = settings.opening || {}; // sayım/başlangıç stoku (malzeme → kamyonet yükü)
  const since = settings.opening_date || "";
  const { ins, outs } = yardMoves(d, { from: since, to: today, settings });
  const mats = YARD_MATS;
  const rows = mats.map((m) => {
    const i = ins.filter((x) => x.mat === m).reduce((n, x) => n + x.loads, 0);
    const o = outs.filter((x) => x.mat === m).reduce((n, x) => n + x.loads, 0);
    return { mat: m, opening: Number(base[m]) || 0, in: r1(i), out: r1(o), stock: r1((Number(base[m]) || 0) + i - o) };
  }).filter((r) => r.opening || r.in || r.out);
  const unknown = [...new Map([...ins, ...outs].filter((x) => !x.known && x.vehicle).map((x) => [x.vehicle.id, x.vehicle])).values()];
  return { rows, total: r1(rows.reduce((n, r) => n + r.stock, 0)), unknownVehicles: unknown, ins, outs };
}

// Depodan çıkan iç iş: hakedişe para yazılmaz
export function applyYard(d, fields) {
  const cust = yardCustomer(d);
  if (!cust || fields.customer_id !== cust.id) return fields;
  return { ...fields, site_id: null, price_snapshot: { unit_price: 0, kdv_rate: 0, kdv_included: false, amount: 0, price_source: "İç iş (kendi depo)", snapshot_at: new Date().toISOString() } };
}

// Mesaj kendi depodan çıkışı mı anlatıyor? ("şantiyeden 2 sefer çöp İBB", "depodan boluca")
export const FROM_YARD = /(?:^|\s)(?:santiyeden|depodan|sahadan|depomuzdan|depodaki|stoktan|stoktaki|depodakini|bizim (?:depo|saha)dan|bizim (?:depo|saha)daki)(?:\s|$)/;
// Kesin çıkış ifadeleri: "depodaki stoktan", "depodan" — müşteri adı yazılmış olsa bile iç iştir ("şantiyeden" ise müşterinin şantiyesi olabilir)
export const FROM_YARD_STRONG = /(?:^|\s)(?:depodan|depomuzdan|depodaki|stoktan|stoktaki|bizim depo(?:dan|daki))(?:\s|$)/;
export const TO_YARD = /(?:^|\s)(?:depoya|santiyeye|depomuza|bizim (?:depo|saha)ya|sahaya|stoga)(?:\s\S+){0,4}\s(?:dokul|dok|bosalt|getir|indir|birak)/;
export function yardHint(text) {
  const t = ` ${norm(text)} `;
  // "depoya 5000 litre mazot boşaltıldı" yakıt tankıdır, malzeme deposu değil
  const fuel = /(?:^|\s)(?:mazot|motorin|yakit|litre|lt|tanker|benzin)(?:\s|$)/.test(t);
  return { out: !fuel && FROM_YARD.test(t), strong: !fuel && FROM_YARD_STRONG.test(t), in: !fuel && (TO_YARD.test(t) || /depoya dokuldu|depoya dokduk|depoya bosaltildi|depoya birakildi/.test(t)) };
}
// Mesaj kendi depodan söz ediyor mu (depo henüz kurulmadıysa asistan kendiliğinden kurar)
export function mentionsYard(text) {
  const h = yardHint(text);
  return h.in || h.out;
}

// Depo kâr–zarar: depoya döküm yapılan müşteri işlerinin tutarı − depodan çıkan seferlerin döküm ücreti (− sefer başı ek maliyet)
export function yardPL(d, st, { settings = {}, pred = () => true, dumpFee, workAmount } = {}) {
  const tripCost = Number(settings.trip_cost) || 0;
  const ins = st.ins.filter((x) => pred(x.w.date)), outs = st.outs.filter((x) => pred(x.w.date));
  // Giren işin değeri: parayla ödenen tutar. Mazotla ödenen iş (Kılıç) TL sayılmaz, hak edilen litre ayrıca gösterilir.
  const inRows = ins.map((x) => {
    const L = Number(x.w.customer_fuel_allowance_l) || 0;
    const money = workAmount(x.w);
    return { w: x.w, amount: money, fuelL: L, unpriced: !(money > 0) && !(L > 0) };
  });
  const income = inRows.reduce((n, r) => n + r.amount, 0);
  const fuelL = Math.round(inRows.reduce((n, r) => n + r.fuelL, 0) * 10) / 10;
  const sites = (d.dump_sites || []);
  const outRows = outs.map((x) => {
    const f = dumpFee(d, x.w);
    const site = sites.find((s) => s.id === x.w.dump_site_id);
    // Depodan çıkışın döküm maliyetini işletme sahibi elle yazar; boşsa maliyet yok (stabilize gibi)
    return { w: x.w, fee: f, amount: f?.amount || 0, site: site?.name || x.w.dump_area || "", why: "", empty: !(f?.amount > 0) };
  });
  const dump = outRows.reduce((n, r) => n + r.amount, 0);
  const trips = outs.reduce((n, x) => n + (x.w.unit === "Sefer" ? Number(x.w.quantity) || 0 : 1), 0);
  const cost = dump + trips * tripCost;
  return { income, dump, trips, extra: trips * tripCost, cost, result: income - cost, noFee: 0, noCost: outRows.filter((r) => r.empty).length, est: outRows.filter((r) => r.fee?.estimated).length, unpriced: inRows.filter((r) => r.unpriced).length, fuelL, ins: ins.length, outs: outs.length, tripCost, inRows, outRows };
}

// Bilinen araç türleri (işletme sahibinden): tır / kamyon — boş ya da genel türü olan karta bir kez yazılır
export const KNOWN_VEHICLE_TYPES = { "34GAM627": "Tır", "34FY2482": "Tır", "34GA2261": "Kamyon", "34UL9492": "Kamyon" };
export async function seedVehicleTypes(db) {
  if (await db.metaGet("vehicle_types_v1")) return 0;
  const key = (s) => String(s || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  let n = 0;
  for (const v of (await db.getAll("vehicles")).filter(isActive)) {
    const t = KNOWN_VEHICLE_TYPES[key(v.plate)] || KNOWN_VEHICLE_TYPES[key(v.name)];
    if (t && (!v.type || /^ara[cç]\/makine$/i.test(v.type))) { await db.saveExisting("vehicles", v, { type: t }, "Araç türü (işletme sahibi)"); n++; }
  }
  await db.metaSet("vehicle_types_v1", true);
  return n;
}
