// Teklif asistanı — SAF hesap katmanı. Telefonda fiyat verirken: bu iş bana kaça mal olur, bu müşteriye daha önce kaça yaptım,
// başkalarına kaça yapıyorum, en az kaça vermeliyim? Rakamlar kayıtlardan hesaplanır; yapay zekâ yalnız formu doldurur ve yorum yazar.
// Tüm tutarlar KDV DAHİL düşünülür (döküm ücretleri ve mazot KDV dahil ödenir); teklif kaydına KDV hariç birim fiyat yazılır.
import { isActive, todayStr, addDays, WORK_TYPES } from "./core.js";
import { workAmount } from "./collect-core.js";
import { dumpFee, loadTon } from "./dump-fees.js";
import { fuelPrice } from "./finance-chart.js";

const live = (d, s) => (d[s] || []).filter(isActive);
const r0 = (n) => Math.round(n);
const r1 = (n) => Math.round(n * 10) / 10;
const r2 = (n) => Math.round(n * 100) / 100;
const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : null; };

export const QUOTE_UNITS = ["Sefer", "Ton", "Saat", "Yevmiye"];
export const QUOTE_DEFAULTS = { margin: 20, kdv: 20, extra: { Sefer: 0, Ton: 0, Saat: 0, Yevmiye: 0 } };

// Kayıttaki birim fiyat KDV dahil olarak (snapshot "KDV hariç" diyorsa oranı eklenir)
export function grossUnitPrice(w) {
  const a = workAmount(w), q = Number(w.quantity) || 0;
  if (!(a > 0) || !(q > 0)) return null;
  const p = w.price_snapshot || {};
  const rate = Number(p.kdv_rate) || 0;
  const unit = a / q;
  return p.kdv_included === false && rate > 0 && p.price_source !== "İç iş (kendi depo)" ? unit * (1 + rate / 100) : unit;
}

// Geçmiş fiyatlar: bu müşteriye ve herkese, aynı iş türü + birim (son 365 gün)
export function priceHistory(d, { customer_id = null, work_type = "", unit = "", today = todayStr(), days = 365 } = {}) {
  const from = addDays(today, -days);
  const internal = new Set(live(d, "customers").filter((c) => c.internal).map((c) => c.id));
  const rows = [];
  for (const w of live(d, "work_records")) {
    if (w.date < from || w.date > today || w.unit !== unit || internal.has(w.customer_id)) continue;
    if (work_type && w.work_type !== work_type) continue;
    const p = grossUnitPrice(w);
    if (p) rows.push({ date: w.date, customer_id: w.customer_id, price: p, qty: Number(w.quantity) || 0 });
  }
  rows.sort((a, b) => b.date.localeCompare(a.date));
  const mine = customer_id ? rows.filter((r) => r.customer_id === customer_id) : [];
  const nm = (id) => live(d, "customers").find((c) => c.id === id)?.name || "—";
  const byCust = {};
  for (const r of rows) (byCust[r.customer_id] ||= []).push(r.price);
  return {
    customer: mine.length ? { last: r0(mine[0].price), last_date: mine[0].date, avg: r0(mine.reduce((n, r) => n + r.price, 0) / mine.length), n: mine.length } : null,
    all: rows.length ? { median: r0(median(rows.map((r) => r.price))), min: r0(Math.min(...rows.map((r) => r.price))), max: r0(Math.max(...rows.map((r) => r.price))), n: rows.length, customers: Object.keys(byCust).length } : null,
    others: Object.entries(byCust).filter(([id]) => id !== customer_id).map(([id, ps]) => ({ name: nm(id), price: r0(median(ps)), n: ps.length })).sort((a, b) => b.n - a.n).slice(0, 5),
  };
}

// Aracın sefer/saat başı mazotu: son 90 gündeki yakıt ÷ sefer (saat). Aracın kendi verisi yoksa aynı türdeki araçların ortalaması.
export function fuelPerUnit(d, { vehicle_id = null, unit = "Sefer", today = todayStr(), days = 90 } = {}) {
  if (unit === "Ton") unit = "Sefer";
  const from = addDays(today, -days);
  const one = (v) => {
    const L = live(d, "fuel_records").filter((f) => f.vehicle_id === v.id && f.date >= from && f.date <= today).reduce((n, f) => n + (Number(f.liters) || 0), 0);
    const ws = live(d, "work_records").filter((w) => w.vehicle_id === v.id && w.date >= from && w.date <= today);
    const u = ws.filter((w) => w.unit === unit).reduce((n, w) => n + (Number(w.quantity) || 0), 0);
    const other = ws.filter((w) => w.unit !== unit).length;
    // Başka birimde de çalışıyorsa yakıt ayrıştırılamaz → güvenilmez
    return u >= 3 && L > 0 && other <= ws.length * 0.2 ? { L: L / u, units: u, liters: L } : null;
  };
  const v = live(d, "vehicles").find((x) => x.id === vehicle_id);
  if (v) { const s = one(v); if (s) return { per: r1(s.L), basis: `${v.name}: son ${days} günde ${r0(s.liters)} L ÷ ${r1(s.units)} ${unit.toLocaleLowerCase("tr-TR")}`, own: true }; }
  const kind = v ? String(v.type || "").toLocaleLowerCase("tr-TR") : "";
  if (kind) {
    const same = live(d, "vehicles").filter((x) => x.id !== v.id && String(x.type || "").toLocaleLowerCase("tr-TR") === kind).map(one).filter(Boolean);
    if (same.length) {
      const L = same.reduce((n, s) => n + s.liters, 0), u = same.reduce((n, s) => n + s.units, 0);
      return { per: r1(L / u), basis: `aynı türdeki ${same.length} aracın son ${days} gün ortalaması`, own: false };
    }
  }
  return null;
}

// Birim başına döküm maliyeti (döküm sahası kartındaki ücretten)
export function dumpPerUnit(d, { dump_site_id, vehicle_id, unit }) {
  if (!dump_site_id || !["Sefer", "Ton"].includes(unit)) return null;
  const v = live(d, "vehicles").find((x) => x.id === vehicle_id);
  const ton = loadTon(v);
  const f = dumpFee(d, { dump_site_id, vehicle_id, unit: "Sefer", quantity: 1, customer_id: null });
  const site = live(d, "dump_sites").find((s) => s.id === dump_site_id);
  if (unit === "Ton" && site && Number(site.fee) > 0 && site.fee_unit === "Ton") return { amount: Number(site.fee), site: site.name, basis: `ton başı ${site.fee} ₺` };
  if (!f || f.missing || !(f.amount > 0)) return { amount: null, site: site?.name || "", why: site?.own_yard ? "kendi depo (ücret yok)" : !(Number(site?.fee) > 0) ? "döküm sahası kartında ücret yok" : "aracın yükü bilinmiyor (araç seçin)" };
  if (unit === "Sefer") return { amount: f.amount, site: f.site, basis: f.unit === "Ton" ? `~${f.ton} ton × ${f.fee} ₺` : `sefer başı ${f.fee} ₺` };
  // Ton bazlı teklif
  if (f.unit === "Ton") return { amount: f.fee, site: f.site, basis: `ton başı ${f.fee} ₺` };
  return ton ? { amount: r2(f.fee / ton), site: f.site, basis: `sefer ${f.fee} ₺ ÷ ${ton} ton` } : { amount: null, site: f.site, why: "aracın yükü bilinmiyor" };
}

// Ana hesap. inp: { unit, quantity, dump (birim başı ₺ | null), dump_included, fuel_l (birim başı), fuel_price, extra (birim başı ₺), margin %, kdv %, history }
export function quoteCalc(inp) {
  const unit = inp.unit || "Sefer";
  const qty = Number(inp.quantity) || 0;
  const dump = inp.dump_included === false ? 0 : Number(inp.dump) || 0;
  const fuel = (Number(inp.fuel_l) || 0) * (Number(inp.fuel_price) || 0);
  const extra = Number(inp.extra) || 0;
  const cost = dump + fuel + extra;
  const margin = Number.isFinite(Number(inp.margin)) ? Number(inp.margin) : QUOTE_DEFAULTS.margin;
  const kdv = Number.isFinite(Number(inp.kdv)) ? Number(inp.kdv) : QUOTE_DEFAULTS.kdv;
  const roundUp = (x) => { const step = x >= 2000 ? 50 : x >= 200 ? 10 : 1; return Math.ceil(x / step) * step; };
  const byCost = cost > 0 ? roundUp(cost * (1 + margin / 100)) : null;
  const h = inp.history || {};
  // Öneri: maliyet + kâr; müşteri daha önce daha yükseğe aldıysa onun son fiyatı (fiyat düşürmeyin)
  let suggest = byCost, why = byCost ? `maliyet + %${margin} kâr` : "";
  if (h.customer?.last && (!suggest || h.customer.last > suggest)) { suggest = h.customer.last; why = "bu müşterinin son fiyatı (maliyet + kârın üstünde)"; }
  if (!suggest && h.all?.median) { suggest = h.all.median; why = "diğer müşterilerin orta fiyatı (maliyet bilinmiyor)"; }
  const warns = [];
  const missing = [];
  if (inp.dump_included !== false && inp.dump == null && ["Sefer", "Ton"].includes(unit) && inp.dump_expected) missing.push("döküm ücreti");
  if (!(Number(inp.fuel_l) > 0)) missing.push("mazot");
  else if (!(Number(inp.fuel_price) > 0)) missing.push("mazot litre fiyatı");
  if (!(extra > 0)) missing.push("şoför/operatör, lastik, yıpranma payı");
  if (missing.length) warns.push({ kind: "info", text: `Maliyete katılmayan: ${missing.join(", ")}. Gerçek maliyet daha yüksek olabilir.` });
  if (suggest && cost > 0 && suggest < cost) warns.push({ kind: "alert", text: `Önerilen fiyat maliyetin altında: zarar.` });
  if (suggest && h.customer?.last && suggest < h.customer.last) warns.push({ kind: "warn", text: `Bu müşteriye son fiyat ${h.customer.last.toLocaleString("tr-TR")} ₺ idi; daha düşük veriyorsunuz.` });
  if (suggest && h.all?.median && h.all.n >= 3) {
    if (suggest < h.all.median * 0.85) warns.push({ kind: "warn", text: `Diğer müşterilerin orta fiyatı ${h.all.median.toLocaleString("tr-TR")} ₺; bu teklif %${r0((1 - suggest / h.all.median) * 100)} altında.` });
    else if (suggest > h.all.median * 1.3) warns.push({ kind: "info", text: `Orta fiyatın (${h.all.median.toLocaleString("tr-TR")} ₺) %${r0((suggest / h.all.median - 1) * 100)} üstünde; mesafe/zorluk yoksa pahalı bulunabilir.` });
  }
  return {
    unit, qty, kdv, margin,
    cost: { dump: r2(dump), fuel: r2(fuel), extra: r2(extra), total: r2(cost) },
    floor: cost > 0 ? r0(cost) : null,
    byCost, suggest, why,
    suggestNet: suggest ? r2(suggest / (1 + kdv / 100)) : null,
    total: suggest && qty ? r0(suggest * qty) : null,
    profitPerUnit: suggest && cost > 0 ? r0(suggest - cost) : null,
    profitTotal: suggest && cost > 0 && qty ? r0((suggest - cost) * qty) : null,
    warns,
  };
}

// Tek çağrıda: formdaki seçimlerden tüm hesap (ekran ve sohbet aracı aynı yolu kullanır)
export function quoteFor(d, f, { today = todayStr(), settings = {}, fuelRefPrice = null } = {}) {
  const S = { ...QUOTE_DEFAULTS, ...settings, extra: { ...QUOTE_DEFAULTS.extra, ...(settings.extra || {}) } };
  const unit = f.unit || "Sefer";
  const history = priceHistory(d, { customer_id: f.customer_id, work_type: f.work_type, unit, today });
  const dumpInfo = f.dump_site_id ? dumpPerUnit(d, { dump_site_id: f.dump_site_id, vehicle_id: f.vehicle_id, unit }) : null;
  const fuelInfo = fuelPerUnit(d, { vehicle_id: f.vehicle_id, unit, today });
  const fp = fuelPrice(d, today, fuelRefPrice);
  const fuel_l = f.fuel_l != null && f.fuel_l !== "" ? Number(f.fuel_l) : fuelInfo?.per ?? null;
  const fuel_price = f.fuel_price != null && f.fuel_price !== "" ? Number(f.fuel_price) : fp;
  const extra = f.extra != null && f.extra !== "" ? Number(f.extra) : Number(S.extra[unit]) || 0;
  const dump = f.dump != null && f.dump !== "" ? Number(f.dump) : dumpInfo?.amount ?? null;
  const calc = quoteCalc({ unit, quantity: f.quantity, dump, dump_included: f.dump_included !== false, dump_expected: !!f.dump_site_id, fuel_l, fuel_price, extra, margin: f.margin ?? S.margin, kdv: f.kdv ?? S.kdv, history });
  return { input: { ...f, unit, fuel_l, fuel_price, extra, dump }, history, dumpInfo, fuelInfo, fuelPriceKnown: fp, calc };
}

// Teklif kaydı (mevcut Teklifler ekranı / PDF ile aynı yapı)
export function quoteRecord(d, q, { today = todayStr(), note = "" } = {}) {
  const f = q.input, c = q.calc;
  const site = live(d, "dump_sites").find((s) => s.id === f.dump_site_id);
  const label = [f.work_type || "Nakliye", site && !site.own_yard ? `(döküm: ${site.name})` : "", f.place ? `— ${f.place}` : ""].filter(Boolean).join(" ");
  return {
    date: today, customer_id: f.customer_id || null, site_id: f.site_id || null,
    type: Number(f.quantity) > 0 ? "QUANTITY_BASED" : "UNIT_PRICE",
    items: [{ label, unit: f.unit, quantity: Number(f.quantity) || 0, unit_price: c.suggestNet, work_type: f.work_type || null }],
    kdv_rate: c.kdv, lump_total: 0, valid_until: addDays(today, 15),
    dump_terms: f.dump_site_id ? (f.dump_included === false ? "Döküm ücreti hariç" : "Döküm ücreti dahil") : "",
    fuel_terms: "Mazot dahil", title: `${f.work_type || "Nakliye"} fiyat teklifi`,
    notes: note || "", source: "teklif-asistani",
    calc_snapshot: { cost: c.cost, floor: c.floor, suggest: c.suggest, why: c.why, margin: c.margin },
  };
}

// Sohbet aracı için kısa özet
export function quoteSummary(d, q) {
  const c = q.calc, h = q.history;
  const nm = (s, id) => live(d, s).find((x) => x.id === id)?.name || null;
  return {
    musteri: nm("customers", q.input.customer_id), is_turu: q.input.work_type || null, birim: c.unit, miktar: c.qty || null,
    arac: nm("vehicles", q.input.vehicle_id), dokum_yeri: q.dumpInfo?.site || null,
    birim_maliyet_TL: { dokum: c.cost.dump, mazot: c.cost.fuel, diger: c.cost.extra, toplam: c.cost.total },
    mazot_L_birim: q.input.fuel_l, mazot_litre_TL: q.input.fuel_price, mazot_dayanak: q.fuelInfo?.basis || null,
    zarar_siniri_TL: c.floor, onerilen_birim_KDV_dahil_TL: c.suggest, onerilen_birim_KDV_haric_TL: c.suggestNet, oneri_dayanagi: c.why,
    toplam_KDV_dahil_TL: c.total, birim_kar_TL: c.profitPerUnit, toplam_kar_TL: c.profitTotal,
    bu_musteriye_son_fiyat_TL: h.customer?.last ?? null, son_fiyat_tarihi: h.customer?.last_date ?? null,
    herkese_orta_fiyat_TL: h.all?.median ?? null, en_dusuk_TL: h.all?.min ?? null, en_yuksek_TL: h.all?.max ?? null, kayit_sayisi: h.all?.n ?? 0,
    uyarilar: c.warns.map((w) => w.text),
  };
}

// Serbest metinden (asistan / Gemini) gelen form alanlarını doğrula: ad ve sayı mesajda geçmeli
export function validateQuoteFill(raw, { d, message = "", numbers = new Set(), named = {} } = {}) {
  const out = {}, issues = [];
  const byId = (s, id) => (id ? live(d, s).find((x) => x.id === id) : null);
  const c = byId("customers", raw?.customer_id);
  if (c) { if (named.customer?.(c, message)) out.customer_id = c.id; else issues.push(`Müşteri "${c.name}" mesajda geçmiyor`); }
  else if (raw?.new_customer) out.new_customer = String(raw.new_customer).slice(0, 80);
  const v = byId("vehicles", raw?.vehicle_id);
  if (v) { if (named.vehicle?.(v, message)) out.vehicle_id = v.id; else issues.push(`Araç "${v.name}" mesajda geçmiyor`); }
  const s = byId("dump_sites", raw?.dump_site_id);
  if (s) { if (named.place?.(s, message)) out.dump_site_id = s.id; else issues.push(`Döküm yeri "${s.name}" mesajda geçmiyor`); }
  if (raw?.unit && QUOTE_UNITS.includes(raw.unit)) out.unit = raw.unit;
  if (raw?.work_type) out.work_type = String(raw.work_type);
  const q = Number(raw?.quantity);
  if (q > 0) { if (numbers.has(q)) out.quantity = q; else issues.push(`Miktar ${q} mesajda yazmıyor`); }
  if (raw?.place) out.place = String(raw.place).slice(0, 80);
  return { fill: out, issues };
}

// Kabul edilen teklif → fiyat listesi kuralları (müşteri + şantiye + iş türü + birim; KDV hariç birim fiyat)
const RULE_UNITS = ["Sefer", "Ton", "Saat", "Yevmiye", "m³", "Adet"];
export function quoteRules(q) {
  const out = [];
  for (const it of q?.items || []) {
    const price = Number(it.unit_price);
    if (!(price > 0) || !RULE_UNITS.includes(it.unit) || !q.customer_id) continue;
    const wt = it.work_type && WORK_TYPES.includes(it.work_type) ? it.work_type : WORK_TYPES.find((t) => String(it.label || "").toLocaleLowerCase("tr-TR").startsWith(t.toLocaleLowerCase("tr-TR"))) || null;
    out.push({ customer_id: q.customer_id, site_id: q.site_id || null, work_type: wt, vehicle_id: null, unit: it.unit, price, kdv_rate: Number(q.kdv_rate) || 0, kdv_included: false, valid_from: q.date || null, label: it.label || "" });
  }
  return out;
}

// Cevap bekleyen teklifler (gönderildi, N günden eski)
export function staleQuotes(d, { today = todayStr(), days = 3 } = {}) {
  return live(d, "quotes").filter((q) => q.status === "Gönderildi" && String(q.sent_at || q.updated_at || q.date || "").slice(0, 10) <= addDays(today, -days))
    .map((q) => ({ q, age: Math.round((Date.parse(today + "T12:00:00Z") - Date.parse(String(q.sent_at || q.updated_at || q.date).slice(0, 10) + "T12:00:00Z")) / 864e5) }))
    .sort((a, b) => b.age - a.age);
}
