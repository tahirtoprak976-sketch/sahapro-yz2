// İşletmeye özel asistan kuralları — SAF katman.
// 1) Kullanıcının yazdığı serbest kurallar (Ayarlar → Yapay Zeka) Gemini talimatına eklenir.
// 2) Yapısal kurallar telefonda denetlenir: gönderenin zimmetli aracı, müşterinin sefer başı mazotu,
//    aynı mesajda iki kez bildirilmiş iş, belirsiz tarih. Kurallar kayıt yazmaz; kart işaretini ve notları belirler.
import { isActive } from "./core.js";
import { foldTr } from "./parser.js";

const live = (d, s) => (d[s] || []).filter(isActive);
const norm = (s) => foldTr(s).replace(/[^\p{L}\p{N}]+/gu, " ").trim();
const plateKey = (s) => foldTr(s).toUpperCase().replace(/[^A-Z0-9]/g, "");

export const DEFAULT_RULES = `WHATSAPP ÇALIŞMA KAYDI KURALLARI (Muratoğlu Hafriyat)
- Mesajın gönderildiği tarih ile iş tarihi farklı olabilir: mesajda yazan iş tarihini esas al. Tarih hiç yoksa date_source="yok" yaz.
- Her iş ayrı satırdır. Aynı gün aynı araç farklı malzeme, müşteri, şantiye veya güzergâh yaptıysa birleştirme.
- "3 sefer" gibi toplam miktar yazılmışsa tek satırda 3 sefer olarak yaz; araç, tarih, malzeme ve güzergâhı kaybetme.
- Birden fazla kişi aynı işi bildirmiş olabilir: aynı araç + aynı tarih + aynı malzeme/güzergâh ise bir kez yaz. Araçlar farklıysa ayrı işlerdir.
- Belirtilmeyen plaka, miktar, malzeme, fiyat veya güzergâhı uydurma. Fiyat yazılmamışsa fiyat yazma.
- MÜŞTERİ: Personel çoğu zaman müşteri adını yazmaz. Adı yoksa şantiye/yer adından (sites listesi), aliases ve customer_hints'ten, aynı aracın/personelin son işlerinden (recent_works) EN OLASI müşteriyi customer_id'ye yaz ve customer_guess=true işaretle; uygulama kullanıcıya onaylatır. Yanlış yazılmış adları da eşleştir ("muarem" = "Muharrem"). Mesajda listede olmayan bir kişi/firma adı geçiyorsa (örn. "Süleyman Kaya") ve personel değilse onu new_customer olarak yaz. Hiçbir ipucu yoksa boş bırak.
- Mesajı gönderen personelin zimmetli aracı vardır (personel listesinde 3. değer): mesajda başka araç yazmıyorsa o aracı kullan, personnel_id = gönderen.
- Malzemenin alındığı yeri from_place, teslim edildiği şantiye/döküm/dolgu yerini to_place alanına yaz.

MALZEME OCAKLARI VE DÖKÜM / DOLGU YERLERİ
- Malzemenin alındığı yer quarries (malzeme ocakları) listesindeyse quarry_id ver; listede yoksa from_place'e yazıldığı gibi yaz (uygulama yeni ocak kartı önerir).
- Bilinen ocaklar: Kılıç Hafriyat Maslak sahası (gravak), Danış Maden / Danış Mıcır (ocak taşı, mıcır), Öztaş (mıcır), Çiftalan Uzunlar (kum).
- Teslim yeri döküm/dolgu sahasıysa (Göktürk Son Durak dolgu, Çatalca Binkılıç dolgu, İBB döküm sahaları) to_is_dump=true ve listede varsa dump_site_id ver; bir şantiyeye teslimse to_is_dump=false.
- Ocak (alındığı yer) ile döküm yerini (teslim yeri) karıştırma: "Danış'tan Binkılıç'a taş" → from_place=Danış, to_place=Binkılıç.
- Yakıtı iş ücreti veya gelir gibi gösterme.

KILIÇ HAFRİYAT – MASLAK GRAVAK
- Maslak'taki Kılıç Hafriyat sahasından çıkan gravak; teslim yerleri çoğunlukla Göktürk Son Durak dolgu sahası ve Çatalca Binkılıç dolgu sahası.
- Kılıç Hafriyat bu seferlerin ücretini (döküm dahil) YALNIZ MAZOTLA öder: sefer başı 75 L. Para yazma, fiyat yazma. Bu yalnız Kılıç'ın Maslak gravak seferleri içindir.
- Mazot her seferde ya da biriktirilip toplu alınabilir. Mesajda mazotun ALINDIĞI yazıyorsa: araca dolduysa fuel satırı (source="Müşteri Verdi", customer_id=Kılıç); depoya alındıysa tank_in satırı (customer_id=Kılıç). Yalnız sefer bilgisi varsa yakıt satırı YAZMA.
- Danış Maden / Danış Mıcır'dan alınan ocak taşı, mıcır vb. Kılıç'ın gravak işiyle birleştirilmez. "Binkılıç'a taş" gravak değildir.
- İşin kime ait olduğu hiç anlaşılmıyorsa müşteriyi boş bırak; bir ipucu varsa en olası müşteriyi customer_guess=true ile öner.`;

// Eski sürümlerin varsayılan kuralları (kullanıcı değiştirmeden kaydettiyse yeni varsayılan kullanılır)
const OLD_DEFAULT_HASHES = new Set(["ppft5k", "1b95he", "p4s1r8"]);
export function rulesHash(s) {
  let x = 5381;
  for (const ch of String(s).replace(/\s+/g, " ").trim()) x = ((x * 33) ^ ch.codePointAt(0)) >>> 0;
  return x.toString(36);
}
export function effectiveRules(saved) {
  if (saved == null || OLD_DEFAULT_HASHES.has(rulesHash(saved))) return DEFAULT_RULES;
  return saved;
}

// Mesajda araç adı/plakası/takma adı geçiyor mu?
export function vehicleNamed(d, vehicle, text) {
  if (!vehicle) return false;
  const t = ` ${norm(text)} `, tk = plateKey(text);
  const p = plateKey(vehicle.plate || "");
  if (p.length >= 5 && tk.includes(p)) return true;
  const nk = plateKey(vehicle.name || "");
  if (/^\d{2}[A-Z]{1,3}\d{2,4}$/.test(nk) && tk.includes(nk)) return true;
  const n = norm(vehicle.name);
  if (n.length >= 3 && t.includes(` ${n} `)) return true;
  // tek kelimelik kısa ad ("jcb", "manitou") ya da ilk anlamlı kelime ("sany 225" → "sany")
  const first = n.split(" ").find((w) => w.length >= 3 && !/^\d+$/.test(w));
  if (first && first.length >= 4 && t.includes(` ${first}`)) return true;
  return live(d, "aliases").some((a) => a.active !== false && a.target_type === "vehicle" && a.target_id === vehicle.id && t.includes(` ${norm(a.alias)} `));
}

// Mesajı gönderen (WhatsApp satırındaki ad) → personel kartı
export function senderPersonnel(d, reporter, text) {
  const n = norm(reporter);
  if (!n || n.length < 3) return null;
  if (!(` ${norm(text)} `).includes(` ${n.split(" ")[0]}`)) return null; // ad mesajda/başlıkta geçmeli
  const ps = live(d, "personnel");
  // Aynı adlı birden fazla kart olabilir (ilk kurulum kartı + sonradan açılan): zimmetli aracı olan öne
  const pick = (arr) => arr.find((p) => p.vehicle_id) || arr[0] || null;
  const exact = ps.filter((p) => norm(p.name) === n);
  if (exact.length) return pick(exact);
  // "Bayram Tırcı" ↔ "Bayram": kelime başı eşleşmesi
  return pick(ps.filter((p) => { const m = norm(p.name); return m.length >= 3 && (n.startsWith(m + " ") || m.startsWith(n + " ")); }));
}

// ---- Mazotla ödeme anlaşmaları (iskelet) ----
// Bir müşterinin birden fazla kuralı olabilir: { id, per (L), unit (Sefer/Saat/Yevmiye/Ton/m³), match (kelimeler),
// only_pay (ücret yalnız mazot), from, to (tarih aralığı, boş = süresiz), note }. Eski tek alanlı kayıt (fuel_per_trip) de okunur.
export const FUEL_RULE_UNITS = ["Sefer", "Saat", "Yevmiye", "Ton", "m³"];
export function fuelRulesOf(c) {
  if (!c) return [];
  if (Array.isArray(c.fuel_rules)) return c.fuel_rules.filter((r) => Number(r.per) > 0);
  if (Number(c.fuel_per_trip) > 0) return [{ id: "legacy", per: Number(c.fuel_per_trip), unit: "Sefer", match: c.fuel_rule_match || "", only_pay: c.fuel_only_pay !== false }];
  return [];
}
export const hasFuelRules = (c) => fuelRulesOf(c).length > 0;
const nameOf = (d, s, id) => (id ? live(d, s).find((x) => x.id === id)?.name || "" : "");
// İşin aranacak metni: mesaj + malzeme + açıklama + iş türü + şantiye / ocak / döküm yeri adları
export function workHay(d, row, text = "") {
  return ` ${norm([text, row.material, row.description, row.work_type, row.from_place, row.to_place, row.quarry, row.dump_area, row.internal_note,
    nameOf(d, "sites", row.site_id), nameOf(d, "quarries", row.quarry_id), nameOf(d, "dump_sites", row.dump_site_id)].filter(Boolean).join(" "))} `;
}
export function matchFuelRule(d, row, text = "") {
  const c = live(d, "customers").find((x) => x.id === row.customer_id);
  const rules = fuelRulesOf(c);
  if (!rules.length || !(Number(row.quantity) > 0)) return null;
  const hay = workHay(d, row, text);
  for (const r of rules) {
    if ((r.unit || "Sefer") !== row.unit) continue;
    if (r.from && row.date && row.date < r.from) continue;
    if (r.to && row.date && row.date > r.to) continue;
    const words = norm(r.match || "").split(" ").filter((w) => w.length >= 3);
    if (words.length && !words.every((w) => hay.includes(` ${w}`))) continue;
    return { c, rule: r };
  }
  return null;
}
// Müşterinin mazot kuralı: { customer, per, unit, liters, only_pay }
export function fuelAllowance(d, row, text) {
  const m = matchFuelRule(d, row, text);
  if (!m) return null;
  return { customer: m.c.name, per: Number(m.rule.per), unit: m.rule.unit || "Sefer", liters: Math.round(Number(m.rule.per) * Number(row.quantity) * 10) / 10, only_pay: m.rule.only_pay !== false, rule_id: m.rule.id };
}

// İş kaydına mazot karşılığını uygular. Kural "ücret yalnız mazot" ise iş parasal alacak oluşturmaz
// (hakedişte 0 ₺, "Mazot karşılığı"); hak edilen litre customer_fuel_allowance_l olarak işe yazılır.
export function applyFuelPay(d, fields, text = "") {
  const fa = fuelAllowance(d, fields, text);
  const out = { ...fields };
  delete out.customer_fuel_allowance_l;
  if (!fa) return out;
  out.customer_fuel_allowance_l = fa.liters;
  out.fuel_rule_id = fa.rule_id;
  if (fa.only_pay)
    out.price_snapshot = { unit_price: 0, kdv_rate: 0, kdv_included: false, amount: 0, price_source: "Mazot karşılığı", fuel_liters_per_unit: fa.per, snapshot_at: new Date().toISOString() };
  return out;
}

// Müşterinin mazot hesabı (litre): hak edilen (sefer × L) − alınan (araca verilen + depoya alınan)
export function customerFuelLedger(d, customerId) {
  const works = live(d, "work_records").filter((w) => w.customer_id === customerId && Number(w.customer_fuel_allowance_l) > 0);
  const fuel = live(d, "fuel_records").filter((f) => f.fuel_source === "Müşteri Verdi" && f.customer_id === customerId);
  const tank = live(d, "fuel_tank_movements").filter((m) => m.move_type === "GİRİŞ" && m.customer_id === customerId);
  const r1 = (n) => Math.round(n * 10) / 10;
  const earned = r1(works.reduce((n, w) => n + Number(w.customer_fuel_allowance_l), 0));
  const received = r1(fuel.reduce((n, f) => n + (Number(f.liters) || 0), 0) + tank.reduce((n, m) => n + (Number(m.liters) || 0), 0));
  const trips = works.reduce((n, w) => n + (w.unit === "Sefer" ? Number(w.quantity) || 0 : 0), 0);
  const units = {};
  for (const w of works) units[w.unit] = Math.round(((units[w.unit] || 0) + (Number(w.quantity) || 0)) * 100) / 100;
  return { earned, received, balance: r1(earned - received), trips, units, works: works.length, receipts: fuel.length + tank.length };
}
// Müşteriye gönderilecek mazot ekstresi (düz metin): tarih sırasıyla hak edilen seferler ve alınan mazot
export function fuelStatementText(d, customerId, { from = "", to = "9999-12-31" } = {}) {
  const c = live(d, "customers").find((x) => x.id === customerId);
  if (!c) return "";
  const inR = (x) => x.date >= from && x.date <= to;
  const vName = (id) => { const v = live(d, "vehicles").find((x) => x.id === id); return v?.plate || v?.name || ""; };
  const tr = (s) => String(s || "").split("-").reverse().join(".");
  const rows = [
    ...live(d, "work_records").filter((w) => w.customer_id === customerId && Number(w.customer_fuel_allowance_l) > 0 && inR(w))
      .map((w) => ({ date: w.date, plus: Number(w.customer_fuel_allowance_l), text: `${w.quantity} ${String(w.unit || "").toLocaleLowerCase("tr-TR")} ${w.material || w.work_type || ""} ${vName(w.vehicle_id)}${w.dump_area ? " → " + w.dump_area : ""}`.replace(/\s+/g, " ").trim() })),
    ...live(d, "fuel_records").filter((f) => f.fuel_source === "Müşteri Verdi" && f.customer_id === customerId && inR(f))
      .map((f) => ({ date: f.date, minus: Number(f.liters) || 0, text: `mazot alındı (${vName(f.vehicle_id)})` })),
    ...live(d, "fuel_tank_movements").filter((m) => m.move_type === "GİRİŞ" && m.customer_id === customerId && inR(m))
      .map((m) => ({ date: m.date, minus: Number(m.liters) || 0, text: "mazot alındı (depoya)" })),
  ].sort((a, b) => a.date.localeCompare(b.date));
  const L = customerFuelLedger(d, customerId);
  const lines = rows.map((r) => `${tr(r.date)}  ${r.plus ? "+" + r.plus : "−" + r.minus} L  ${r.text}`);
  return [`${c.name} — mazot hesabı${from ? " (" + tr(from) + " – " + tr(to === "9999-12-31" ? "" : to) + ")" : ""}`, ...lines, "", `Hak edilen: ${L.earned} L · Alınan: ${L.received} L · Kalan: ${L.balance} L`].join("\n");
}
export function fuelLedgers(d) {
  return live(d, "customers").filter((c) => hasFuelRules(c) || live(d, "work_records").some((w) => w.customer_id === c.id && Number(w.customer_fuel_allowance_l) > 0))
    .map((c) => ({ id: c.id, name: c.name, ...customerFuelLedger(d, c.id) }));
}

// Aynı yapıştırmada iki kez bildirilmiş iş: aynı tarih + araç + birim + miktar + malzeme/güzergâh
export function markPasteDuplicates(works) {
  const seen = new Map();
  for (const r of works) {
    if (!r.vehicle_id || !r.quantity) continue;
    const key = [r.date, r.vehicle_id, r.unit, r.quantity, norm(r.material), norm(r.from_place), norm(r.to_place)].join("|");
    if (seen.has(key)) {
      r.pasteDup = true;
      r.ok = false;
      r.issues.push("Aynı iş bu mesajda iki kez bildirilmiş olabilir (aynı araç, tarih, miktar) — biri yeterliyse işaretlemeyin");
    } else seen.set(key, r);
  }
}

// Sonuç özeti: araç ve müşteri bazında toplam; kesin (işaretli) ve teyit bekleyen ayrı
export function planTotals(works, d) {
  const name = (s, id) => live(d, s).find((x) => x.id === id)?.name || "";
  const add = (m, k, r) => {
    if (!k) return;
    const x = m.get(k) || { name: k, sure: {}, unsure: {} };
    const b = r.ok ? x.sure : x.unsure;
    b[r.unit] = Math.round(((b[r.unit] || 0) + (Number(r.quantity) || 0)) * 100) / 100;
    m.set(k, x);
  };
  const byV = new Map(), byC = new Map();
  for (const r of works) {
    if (!r.quantity || !r.unit) continue;
    const v = live(d, "vehicles").find((x) => x.id === r.vehicle_id);
    add(byV, v ? v.plate || v.name : "Araç belirsiz", r);
    add(byC, name("customers", r.customer_id) || (r.new_customer ? r.new_customer + " (yeni)" : "Müşteri belirsiz"), r);
  }
  const fmt = (o) => Object.entries(o).map(([u, q]) => `${q} ${u.toLocaleLowerCase("tr-TR")}`).join(", ");
  const rows = (m) => [...m.values()].map((x) => ({ name: x.name, sure: fmt(x.sure), unsure: fmt(x.unsure) }));
  return { vehicles: rows(byV), customers: rows(byC) };
}
