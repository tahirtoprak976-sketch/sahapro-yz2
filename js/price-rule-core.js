// Asistan ile fiyat kuralı: "Leda'ya manitou saatliği 3000 TL uygula" → fiyat listesine müşteriye özel kural
// ve (isteğe bağlı) fiyatı boş / farklı olan eski işlere uygulama. SAF katman: kayıt yazmaz.
// Doğrulama: tutar mesajda yazmalı; müşteri, iş türü ve araç mesajda anılmalı; birim mesajdaki kelimeden.
import { isActive, WORK_TYPES } from "./core.js";
import { foldTr } from "./parser.js";
import { moneyInText } from "./assistant-core.js";

const live = (d, s) => (d[s] || []).filter(isActive);
const norm = (s) => foldTr(s).replace(/[^\p{L}\p{N}]+/gu, " ").trim();
const words = (s) => norm(s).split(" ").filter(Boolean);
const GENERIC = new Set(["insaat", "yapi", "ltd", "sti", "as", "san", "tic", "hafriyat", "nakliyat", "nakliye", "taahhut", "muhendislik", "mimarlik", "grup", "bey", "hanim", "usta", "abi"]);
const TYPE_STOP = new Set(["nakliye", "calismasi"]);
// Mesajdaki kelime, adın kelimesiyle başlıyorsa (Türkçe ek: "ledaya", "manitouya") anılmış sayılır
const said = (w, msgWords) => w.length >= 3 && msgWords.some((m) => m === w || (m.startsWith(w) && m.length - w.length <= 5));

export const UNIT_WORDS = [
  ["Saat", /\bsaat/],
  ["Sefer", /\bsefer|\btur\b|\bgidis/],
  ["Yevmiye", /\byevmiye|\bgunluk|\bgun\b/],
  ["Ton", /\bton\b|\btonu\b|\btonluk\b/],
  ["m³", /\bm3\b|\bkup\b|\bmetrekup/],
  ["Adet", /\badet|\btane/],
];
export function unitInText(text) {
  const t = ` ${norm(text)} `;
  return UNIT_WORDS.filter(([, re]) => re.test(t)).map(([u]) => u);
}

export function customerNamed(c, text) {
  const mw = words(text);
  const tw = words(c.name).filter((w) => !GENERIC.has(w));
  return tw.length > 0 && tw.some((w) => said(w, mw));
}
export function workTypeNamed(type, text) {
  const mw = words(text);
  const tw = words(type).filter((w) => !TYPE_STOP.has(w));
  return tw.length > 0 && tw.every((w) => said(w, mw));
}
export function vehicleNamedIn(v, text) {
  const mw = words(text);
  const tw = words(v.name).filter((w) => !/^\d+$/.test(w) && w.length >= 3 && !GENERIC.has(w));
  return tw.length > 0 && said(tw[0], mw);
}

// Bir kuralın kapsadığı eski işler
export function pastWorksFor(d, rule) {
  const out = { unpriced: [], differ: [], locked: 0 };
  for (const w of live(d, "work_records")) {
    if (rule.customer_id && w.customer_id !== rule.customer_id) continue;
    if (rule.site_id && w.site_id !== rule.site_id) continue;
    if (w.unit !== rule.unit) continue;
    if (rule.work_type && w.work_type !== rule.work_type) continue;
    if (rule.vehicle_id && w.vehicle_id !== rule.vehicle_id) continue;
    if (rule.valid_from && w.date < rule.valid_from) continue;
    if (w.fuel_rule_id || w.customer_fuel_allowance_l) continue; // mazotla ödenen iş
    const p = w.price_snapshot;
    if (p?.locked) { out.locked++; continue; } // hakedişe girmiş: dokunulmaz
    if (!p || !(Number(p.amount) > 0)) out.unpriced.push(w);
    else if (Math.abs(Number(p.unit_price) - Number(rule.price)) > 0.001) out.differ.push(w);
  }
  return out;
}

export function sameRule(d, rule) {
  return live(d, "price_book").find((e) => e.active !== false && (!rule.valid_from || (e.valid_from || null) === rule.valid_from) && e.unit === rule.unit
    && (e.customer_id || null) === (rule.customer_id || null) && (e.site_id || null) === (rule.site_id || null)
    && (e.work_type || null) === (rule.work_type || null) && (e.vehicle_id || null) === (rule.vehicle_id || null)
    && !e.vehicle_type && !e.vehicle_group && !e.material && e.distance_min == null && e.distance_max == null && !e.formula) || null;
}

export function priceSnapshotFor(rule, w, ruleId) {
  const q = Number(w.quantity) || 0;
  return {
    unit_price: Number(rule.price),
    kdv_rate: rule.kdv_rate ?? 20,
    kdv_included: !!rule.kdv_included,
    formula: null,
    amount: Math.round(Number(rule.price) * q * 100) / 100,
    price_source: rule.customer_id ? "Müşteriye Özel Fiyat" : "Genel Liste",
    price_scope: rule.vehicle_id ? "Belirli araç / plaka" : "Tüm araç / makineler",
    price_rule_id: ruleId || null,
    snapshot_at: new Date().toISOString(),
  };
}

export function validatePriceRules(plan, { message = "", d } = {}) {
  const out = [];
  const money = moneyInText(message);
  const units = unitInText(message);
  const customers = live(d, "customers"), vehicles = live(d, "vehicles");
  for (const p of (Array.isArray(plan?.price_rules) ? plan.price_rules : []).slice(0, 5)) {
    const issues = [];
    const n = Math.round(Number(p.price) * 100) / 100;
    const price = Number.isFinite(n) && n > 0 && money.has(n) ? n : null;
    if (!price) issues.push(p.price ? `Fiyat ${p.price} mesajda yazmıyor` : "Fiyat yok");
    // Birim: mesajdaki kelimeden; model başka birim dediyse mesajdaki geçerli
    let unit = units.includes(p.unit) ? p.unit : units.length === 1 ? units[0] : null;
    if (!unit) issues.push(units.length > 1 ? "Birim belirsiz (saat mi sefer mi?)" : "Birim mesajda yok (saatlik / sefer başı …)");
    // Müşteri
    let customer = p.customer_id ? customers.find((c) => c.id === p.customer_id) || null : null;
    if (customer && !customerNamed(customer, message)) { issues.push(`"${customer.name}" mesajda geçmiyor`); customer = null; }
    if (!customer) {
      const named = customers.filter((c) => !c.internal && customerNamed(c, message));
      if (named.length === 1) customer = named[0];
      else if (named.length > 1) issues.push("Birden fazla müşteri adı benziyor: " + named.slice(0, 3).map((c) => c.name).join(", "));
    }
    const newCustomer = !customer && p.new_customer && words(p.new_customer).some((w) => said(w, words(message))) ? String(p.new_customer).trim().slice(0, 80) : null;
    if (!customer && !newCustomer) issues.push("Müşteri seçilmedi: kural TÜM müşterilere uygulanır");
    const site = customer && p.site_id ? live(d, "sites").find((s) => s.id === p.site_id && s.customer_id === customer.id && customerNamed(s, message)) || null : null;
    // Kapsam: iş türü ve/veya araç (mesajda anılan)
    const wt = WORK_TYPES.includes(p.work_type) && workTypeNamed(p.work_type, message) ? p.work_type : WORK_TYPES.find((t) => t !== "Diğer" && workTypeNamed(t, message)) || null;
    const veh = (p.vehicle_id ? vehicles.find((v) => v.id === p.vehicle_id && vehicleNamedIn(v, message)) : null) || (vehicles.filter((v) => vehicleNamedIn(v, message)).length === 1 ? vehicles.find((v) => vehicleNamedIn(v, message)) : null);
    const base = { customer_id: customer?.id || null, site_id: site?.id || null, unit, price, kdv_rate: 20, kdv_included: false, valid_from: null };
    const scopes = [];
    if (wt) scopes.push({ key: "wt", label: `İş türü: ${wt}`, work_type: wt, vehicle_id: null });
    if (veh) scopes.push({ key: "veh", label: `Araç: ${veh.name}`, work_type: null, vehicle_id: veh.id });
    if (!scopes.length) scopes.push({ key: "all", label: "Bu müşterinin tüm işleri", work_type: null, vehicle_id: null });
    for (const s of scopes) {
      const rule = { ...base, work_type: s.work_type, vehicle_id: s.vehicle_id };
      s.existing = unit && price ? sameRule(d, rule) : null;
      const pw = unit && price ? pastWorksFor(d, rule) : { unpriced: [], differ: [], locked: 0 };
      s.unpriced = pw.unpriced.length;
      s.differ = pw.differ.length;
      s.locked = pw.locked;
    }
    // Varsayılan kapsam: eski işlerde en çok karşılığı olan (eşitse iş türü)
    scopes.sort((a, b) => (b.unpriced + b.differ) - (a.unpriced + a.differ));
    out.push({ ...base, new_customer: newCustomer, scopes, issues, quote: String(p.quote || "").slice(0, 200),
      ok: !!(price && unit && (customer || newCustomer)) && !issues.some((x) => /mesajda yazmıyor|belirsiz|Birden fazla/.test(x)) });
  }
  return out;
}
// Yer adı (döküm sahası / ocak) mesajda anıldı mı: "Bolluca'ya", "göktürk dolguya"
const PLACE_STOP = new Set(["dokum", "sahasi", "saha", "dolgu", "dolgusu", "depo", "alani", "ocak", "ocagi", "son", "durak"]);
export function placeNamed(p, text) {
  const mw = words(text);
  const tw = words(p.name).filter((w) => !PLACE_STOP.has(w) && !/^\d+$/.test(w));
  return tw.length > 0 && said(tw[0], mw);
}
