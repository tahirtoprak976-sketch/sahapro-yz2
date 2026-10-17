// Gün sonu özeti ve "Soru Sor" araçları — SAF katman. Rakamlar telefonda hesaplanır;
// Gemini yalnız bu rakamlarla cümle kurar. Doğrulanamayan rakam içeren cümle atılır.
import { isActive, cariBalance, todayStr, addDays, daySummary, tankStatus } from "./core.js";
import { ledgerOf } from "./esnaf.js";
import { foldTr } from "./parser.js";
import { fuelFlags } from "./fuel-rules.js";
import { ticketReconcile } from "./assistant-docs.js";
import { checkAnswer } from "./assistant-core.js";
import { fuelLedgers } from "./assistant-rules.js";
import { yardSite, yardStock } from "./yard-core.js";
import { receivables, customerLedgerMovements } from "./collect-core.js";
import { costRows, costTotals } from "./costs-core.js";
import { vehicleKpis, customerKpis, priceCheck, businessReview, EXPERT_KNOWLEDGE } from "./expert-core.js";
import { quoteFor, quoteSummary } from "./quote-core.js";
import { payrollFor, payrollSummary } from "./payroll-core.js";
import { maintenanceBoard, maintSummary } from "./maint-core.js";
import { WORK_TYPES } from "./core.js";

const live = (d, s) => (d[s] || []).filter(isActive);
const norm = (s) => foldTr(s).replace(/[^\p{L}\p{N}]+/gu, " ").trim();
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const nameOf = (d, s, id) => (d[s] || []).find((x) => x.id === id)?.name || "—";
const unitsText = (ws) => {
  const m = {};
  for (const w of ws) m[w.unit] = r2((m[w.unit] || 0) + (Number(w.quantity) || 0));
  return Object.entries(m).map(([u, q]) => `${q} ${u.toLocaleLowerCase("tr-TR")}`).join(", ");
};

export function dayFacts(d, date = todayStr()) {
  const on = (s) => live(d, s).filter((r) => r.date === date);
  const works = on("work_records");
  const byCust = new Map();
  for (const w of works) byCust.set(w.customer_id, [...(byCust.get(w.customer_id) || []), w]);
  const byVeh = new Map();
  for (const w of works) byVeh.set(w.vehicle_id, [...(byVeh.get(w.vehicle_id) || []), w]);
  const sum = daySummary(date, d);
  const expenses = on("expense_records");
  const cats = {};
  for (const e of expenses) cats[e.category || "Diğer"] = r2((cats[e.category || "Diğer"] || 0) + Number(e.amount));
  const fuel = on("fuel_records");
  const collections = on("cash_records").filter((c) => c.cash_type === "Müşteriden Para Alındı");
  // Boş araç: son 30 günde çalışmış ama bugün işi olmayan özmal araçlar (hiç kullanılmayan kartlar sayılmaz)
  const recent = new Set(live(d, "work_records").filter((w) => w.date < date && w.date >= addDays(date, -30)).map((w) => w.vehicle_id));
  const idle = live(d, "vehicles").filter((v) => v.active !== false && recent.has(v.id) && !byVeh.has(v.id) && v.ownership !== "Taşeron").map((v) => v.plate || v.name);
  return {
    tarih: date,
    is_sayisi: works.length,
    toplam: { sefer: sum.total_sefer, saat: sum.total_saat, yevmiye: sum.total_yevmiye },
    musteriler: [...byCust].map(([id, ws]) => ({ musteri: nameOf(d, "customers", id), is: ws.length, miktar: unitsText(ws) })),
    araclar: [...byVeh].map(([id, ws]) => ({ arac: nameOf(d, "vehicles", id), miktar: unitsText(ws) })),
    bos_araclar: idle.slice(0, 10),
    gider_TL: r2(sum.expense_total),
    gider_kategorileri: cats,
    yakit_litre: r2(sum.fuel_liters),
    yakit_TL: r2(fuel.reduce((n, f) => n + (Number(f.total) || 0), 0)),
    tahsilat_TL: r2(sum.tahsilat_total),
    tahsilatlar: collections.map((c) => ({ musteri: nameOf(d, "customers", c.customer_id), TL: r2(c.amount) })),
    acik_ariza: sum.open_breakdowns,
    uyarilar: [
      ...fuelFlags(d, { today: date, days: 0 }).map((f) => f.text),
      ...ticketReconcile(d, { today: date, days: 0 }).map((r) => `${nameOf(d, "vehicles", r.vehicle_id)}: ${r.tickets} döküm fişi, ${r.sefer} sefer`),
    ],
  };
}

const tl = (n) => Number(n).toLocaleString("tr-TR", { maximumFractionDigits: 2 });
// İnternet/Gemini yoksa da çalışan düz özet
export function localSummary(f) {
  const s = [];
  const [y, m, g] = f.tarih.split("-");
  s.push(`${g}.${m}.${y} gün sonu: ${f.is_sayisi} iş kaydı` + (f.is_sayisi ? ` (${[f.toplam.sefer && f.toplam.sefer + " sefer", f.toplam.saat && f.toplam.saat + " saat", f.toplam.yevmiye && f.toplam.yevmiye + " yevmiye"].filter(Boolean).join(", ")}).` : "."));
  for (const c of f.musteriler.slice(0, 6)) s.push(`• ${c.musteri}: ${c.miktar}`);
  if (f.bos_araclar.length) s.push(`Boş kalan: ${f.bos_araclar.join(", ")}.`);
  if (f.yakit_litre) s.push(`Yakıt: ${tl(f.yakit_litre)} L` + (f.yakit_TL ? ` / ${tl(f.yakit_TL)} ₺.` : "."));
  if (f.gider_TL) s.push(`Gider: ${tl(f.gider_TL)} ₺.`);
  if (f.tahsilat_TL) s.push(`Tahsilat: ${tl(f.tahsilat_TL)} ₺ (${f.tahsilatlar.map((t) => t.musteri).join(", ")}).`);
  if (f.acik_ariza) s.push(`Açık arıza/bakım: ${f.acik_ariza}.`);
  for (const u of f.uyarilar.slice(0, 4)) s.push(`⚠ ${u}`);
  return s.join("\n");
}

export const SUMMARY_SYSTEM = [
  "Sen bir hafriyat/nakliye şirketinin gün sonu raporunu yazan asistansın.",
  "Sana o günün rakamları JSON olarak verilir. 5–8 kısa Türkçe cümle yaz: ne iş yapıldı, hangi müşteriye, boş araç, yakıt, gider, tahsilat, dikkat edilmesi gerekenler.",
  "YALNIZ verilen rakamları kullan; hesap yapma, toplama, yüzde çıkarma, tahmin etme. Rakam yoksa o konuyu atla.",
  "Düz metin yaz; başlık, madde işareti veya JSON kullanma. WhatsApp'ta okunacak.",
].join("\n");

// Doğrulanamayan rakam içeren cümleyi at
export function keepVerified(text, facts) {
  const sentences = String(text || "").replace(/\r/g, "").split(/(?<=[.!?])\s+|\n+/).map((x) => x.trim()).filter(Boolean);
  const kept = [], dropped = [];
  for (const s of sentences) (checkAnswer(s, facts).length ? dropped : kept).push(s);
  return { text: kept.join(" "), dropped };
}

// ---- Soru Sor: Gemini fonksiyon çağrısı ile telefondaki kayıtlardan hesap ----
function findCard(d, store, q, aliasType) {
  if (!q) return null;
  const n = norm(q);
  const list = live(d, store);
  const exact = list.find((x) => norm(x.name) === n || norm(x.plate || "") === n);
  if (exact) return exact;
  const al = live(d, "aliases").find((a) => a.active !== false && a.target_type === aliasType && norm(a.alias) === n);
  if (al) return list.find((x) => x.id === al.target_id) || null;
  const part = list.filter((x) => (` ${norm(x.name)} ${norm(x.plate || "")} `).includes(` ${n} `) || (n.length >= 4 && norm(x.name).includes(n)));
  return part.length === 1 ? part[0] : part.length ? { many: part.map((x) => x.name) } : null;
}
function range(d, a = {}, today) {
  const from = /^\d{4}-\d{2}-\d{2}$/.test(a.from || "") ? a.from : today.slice(0, 8) + "01";
  const to = /^\d{4}-\d{2}-\d{2}$/.test(a.to || "") ? a.to : today;
  return { from, to, inR: (r) => r.date >= from && r.date <= to };
}
function resolve(d, a, key, store, type) {
  if (!a[key]) return { id: null };
  const c = findCard(d, store, a[key], type);
  if (!c) return { error: `"${a[key]}" bulunamadı` };
  if (c.many) return { error: `"${a[key]}" birden fazla karta uyuyor`, adaylar: c.many.slice(0, 8) };
  return { id: c.id, name: c.name };
}

export const ASK_TOOLS = [
  { name: "work_totals", description: "Tarih aralığında iş toplamları (sefer/saat/yevmiye/ton, iş değeri TL). Müşteri veya araç ile süzülebilir.",
    parameters: { type: "object", properties: { from: { type: "string", description: "YYYY-MM-DD; yoksa bu ayın başı" }, to: { type: "string" }, customer: { type: "string", description: "müşteri adı ya da takma adı" }, vehicle: { type: "string", description: "araç adı/plakası" } } } },
  { name: "customer_balance", description: "Bir müşterinin cari bakiyesi (alacak), son tahsilatı ve bu ayki işleri.",
    parameters: { type: "object", properties: { customer: { type: "string" } }, required: ["customer"] } },
  { name: "fuel_totals", description: "Tarih aralığında yakıt litre ve TL toplamı, araç bazında.",
    parameters: { type: "object", properties: { from: { type: "string" }, to: { type: "string" }, vehicle: { type: "string" } } } },
  { name: "expense_totals", description: "Tarih aralığında gider toplamı ve kategori dağılımı; ayrıca TÜM masraflar (gider + yakıt + bakım/arıza + esnaf alışı). 'Ne kadar masraf yaptık' sorusunda tum_masraflar_TL kullan.",
    parameters: { type: "object", properties: { from: { type: "string" }, to: { type: "string" }, category: { type: "string" }, vehicle: { type: "string" } } } },
  { name: "collection_totals", description: "Tarih aralığında müşterilerden alınan tahsilat toplamı.",
    parameters: { type: "object", properties: { from: { type: "string" }, to: { type: "string" }, customer: { type: "string" } } } },
  { name: "customer_fuel", description: "Ücretini mazotla ödeyen müşterilerin (ör. Kılıç Hafriyat, sefer başı 75 L) mazot hesabı: sefer, hak edilen, alınan ve kalan litre.",
    parameters: { type: "object", properties: { customer: { type: "string" } } } },
  { name: "yard_stock", description: "Kendi depo / stok sahasındaki moloz, çöp, hafriyat stoku (kamyonet yükü cinsinden tahmin), bu ay giren ve çıkan.",
    parameters: { type: "object", properties: {} } },
  { name: "tank_status", description: "Depo yakıt tankı: kalan litre, günlük ortalama çıkış, kaç gün yeter, ortalama litre fiyatı, son giriş.",
    parameters: { type: "object", properties: {} } },
  { name: "receivables", description: "Müşterilerden alacaklar (tahsilat takibi): toplam, 0-30/31-60/61-90/90+ gün dağılımı, en riskli müşteriler, en eski açık kalemin yaşı, son ödeme, ödeme sözü, vadesi yaklaşan çek/senet. Müşteri adıyla tek müşteri.",
    parameters: { type: "object", properties: { customer: { type: "string" } } } },
  { name: "vehicle_profit", description: "Araç/makine bazında kârlılık ve verim: gelir, yakıt, bakım, döküm ücreti, kâr, çalışılan gün, doluluk %, günlük getiri, L/sefer, L/saat, kaç gündür boşta. 'Hangi araç kazandırıyor', 'hangi makine boş', 'mazot yakıyor mu' soruları için.",
    parameters: { type: "object", properties: { from: { type: "string" }, to: { type: "string" }, vehicle: { type: "string" } } } },
  { name: "customer_profit", description: "Müşteri bazında: gelir, döküm ücreti sonrası net, tahsilat, açık alacak, en eski alacak günü, sefer başı net, fiyatsız iş. 'En iyi/kötü müşteri', 'kime çalışmak kârlı' soruları için.",
    parameters: { type: "object", properties: { from: { type: "string" }, to: { type: "string" }, customer: { type: "string" } } } },
  { name: "price_check", description: "Aynı iş türü ve birimde birim fiyatlar: orta fiyat, en düşük/yüksek, ortalamanın %15 altında kalan müşteriler. 'Ucuza mı çalışıyoruz', 'fiyatlarım tutarlı mı' için.",
    parameters: { type: "object", properties: { from: { type: "string" }, to: { type: "string" } } } },
  { name: "business_review", description: "İşletmenin dönem özeti ve uyarı bulguları (boş makine, düşük doluluk, zarar eden araç, düşük fiyat, geciken alacak). 'İşler nasıl gidiyor', 'ne yapmalıyım', 'durum değerlendirmesi' için.",
    parameters: { type: "object", properties: { from: { type: "string" }, to: { type: "string" } } } },
  { name: "quote_price", description: "Teklif / fiyat hesabı: bir iş için birim maliyet (döküm ücreti, mazot, şoför/yıpranma), zarar sınırı, önerilen fiyat (KDV dahil ve hariç), bu müşteriye son fiyat ve herkese orta fiyat. 'X'e 20 sefer Bolluca hafriyat kaça veririm', 'saatlik JCB kaça vermeliyim', 'bu fiyat zarar mı' için.",
    parameters: { type: "object", properties: { customer: { type: "string" }, work_type: { type: "string", description: "İş türü: " + WORK_TYPES.join(", ") }, unit: { type: "string", description: "Sefer | Ton | Saat | Yevmiye" }, quantity: { type: "number" }, vehicle: { type: "string", description: "araç adı/plakası" }, dump_site: { type: "string", description: "döküm yeri adı" }, dump_included: { type: "boolean", description: "döküm ücreti fiyata dahil mi (varsayılan evet)" } } } },
  { name: "payroll_status", description: "Personel puantajı ve maaşı: çalışılan gün, izin/rapor/devamsızlık, mesai, hak edilen, avans, ödenen, kalan. 'Ali'nin bu ay maaşı ne kadar kaldı', 'kime ne ödeyeceğim', 'kaç gün çalıştı' için. Personel adı yoksa herkes.",
    parameters: { type: "object", properties: { personnel: { type: "string" }, period: { type: "string", description: "YYYY-AA; yoksa bu ay" } } } },
  { name: "maintenance_due", description: "Bakım takvimi: araç/makine bakımlarının durumu (gecikti / yaklaşıyor / planlı), kalan km/saat/gün, tahmini gün, son bakım, güncel km/saat. 'Hangi aracın bakımı geldi', 'JCB yağ bakımına kaç saat kaldı' için.",
    parameters: { type: "object", properties: { vehicle: { type: "string" } } } },
  { name: "esnaf_debt", description: "Esnafa (lastikçi, tamirci, petrolcü…) kalan veresiye borçlar.",
    parameters: { type: "object", properties: { supplier: { type: "string" } } } },
];

export function runAskTool(d, name, args = {}, today = todayStr(), yardSettings = {}, extra = {}) {
  const a = args && typeof args === "object" ? args : {};
  const { from, to, inR } = range(d, a, today);
  if (name === "work_totals") {
    const c = resolve(d, a, "customer", "customers", "customer"), v = resolve(d, a, "vehicle", "vehicles", "vehicle");
    if (c.error || v.error) return c.error ? c : v;
    const ws = live(d, "work_records").filter((w) => inR(w) && (!c.id || w.customer_id === c.id) && (!v.id || w.vehicle_id === v.id));
    const u = (x) => r2(ws.filter((w) => w.unit === x).reduce((n, w) => n + (Number(w.quantity) || 0), 0));
    const per = {};
    for (const w of ws) { const k = nameOf(d, "customers", w.customer_id); per[k] = (per[k] || 0) + 1; }
    return { from, to, musteri: c.name || "hepsi", arac: v.name || "hepsi", is_sayisi: ws.length, sefer: u("Sefer"), saat: u("Saat"), yevmiye: u("Yevmiye"), ton: u("Ton"),
      is_degeri_TL: r2(ws.reduce((n, w) => n + (Number(w.price_snapshot?.amount) || 0), 0)), fiyatsiz_is: ws.filter((w) => !(Number(w.price_snapshot?.amount) > 0)).length,
      musteri_bazinda_is: Object.fromEntries(Object.entries(per).sort((x, y) => y[1] - x[1]).slice(0, 10)) };
  }
  if (name === "customer_balance") {
    const c = resolve(d, a, "customer", "customers", "customer");
    if (c.error || !c.id) return c.error ? c : { error: "Müşteri adı gerekli" };
    const cash = live(d, "cash_records").filter((x) => x.customer_id === c.id && x.cash_type === "Müşteriden Para Alındı").sort((x, y) => y.date.localeCompare(x.date));
    const month = today.slice(0, 7);
    const ws = live(d, "work_records").filter((w) => w.customer_id === c.id && String(w.date).startsWith(month));
    return { musteri: c.name, cari_bakiye_TL: Math.round(customerLedgerMovements(d, c.id).reduce((n, m) => n + (Number(m.amount) || 0), 0) * 100) / 100,
      son_tahsilat: cash[0] ? { tarih: cash[0].date, TL: r2(cash[0].amount) } : null, bu_ay_is: ws.length, bu_ay_miktar: unitsText(ws) };
  }
  if (name === "fuel_totals") {
    const v = resolve(d, a, "vehicle", "vehicles", "vehicle");
    if (v.error) return v;
    const fl = live(d, "fuel_records").filter((f) => inR(f) && (!v.id || f.vehicle_id === v.id));
    const per = {};
    for (const f of fl) { const k = nameOf(d, "vehicles", f.vehicle_id); per[k] = r2((per[k] || 0) + Number(f.liters)); }
    const depo = r2(fl.filter((f) => f.fuel_source === "Depo Tankı").reduce((n, f) => n + (Number(f.liters) || 0), 0));
    return { from, to, arac: v.name || "hepsi", depodan_litre: depo, litre: r2(fl.reduce((n, f) => n + (Number(f.liters) || 0), 0)), TL: r2(fl.reduce((n, f) => n + (Number(f.total) || 0), 0)), kayit: fl.length, arac_bazinda_litre: per };
  }
  if (name === "expense_totals") {
    const v = resolve(d, a, "vehicle", "vehicles", "vehicle");
    if (v.error) return v;
    const ex = live(d, "expense_records").filter((e) => inR(e) && (!v.id || e.vehicle_id === v.id) && (!a.category || norm(e.category).includes(norm(a.category))));
    const cats = {};
    for (const e of ex) cats[e.category || "Diğer"] = r2((cats[e.category || "Diğer"] || 0) + Number(e.amount));
    const all = costTotals(costRows(d, { from, to }).filter((r) => !v.id || r.vehicle_id === v.id));
    return { from, to, TL: r2(ex.reduce((n, e) => n + (Number(e.amount) || 0), 0)), kayit: ex.length, kategoriler: cats,
      tum_masraflar_TL: all.total, masraf_dagilimi: { gider: all.gider, yakit: all.yakit, bakim_ariza: all.bakim, esnaf_alisi: all.esnaf } };
  }
  if (name === "collection_totals") {
    const c = resolve(d, a, "customer", "customers", "customer");
    if (c.error) return c;
    const cs = live(d, "cash_records").filter((x) => inR(x) && x.cash_type === "Müşteriden Para Alındı" && (!c.id || x.customer_id === c.id));
    const per = {};
    for (const x of cs) { const k = nameOf(d, "customers", x.customer_id); per[k] = r2((per[k] || 0) + Number(x.amount)); }
    return { from, to, musteri: c.name || "hepsi", TL: r2(cs.reduce((n, x) => n + (Number(x.amount) || 0), 0)), kayit: cs.length, musteri_bazinda_TL: per };
  }
  if (name === "customer_fuel") {
    const c = resolve(d, a, "customer", "customers", "customer");
    if (c.error) return c;
    const rows = fuelLedgers(d).filter((x) => !c.id || x.id === c.id).map((x) => ({ musteri: x.name, sefer: x.trips, hak_edilen_litre: x.earned, alinan_litre: x.received, kalan_litre: x.balance }));
    return rows.length ? { musteriler: rows } : { error: "Mazotla ödeyen müşteri kartı yok (Müşteri kartı → Sefer başı mazot)" };
  }
  if (name === "yard_stock") {
    if (!yardSite(d)) return { error: "Kendi depo kurulmamış (Ayarlar → Kendi depo / stok sahası)" };
    const st = yardStock(d, { settings: yardSettings, today });
    const m = today.slice(0, 7);
    return { depoda_kamyonet_yuku: st.total, malzeme: st.rows.map((r) => ({ malzeme: r.mat, stok: r.stock, giren: r.in, cikan: r.out })),
      bu_ay_giren: Math.round(st.ins.filter((x) => x.w.date.startsWith(m)).reduce((n, x) => n + x.loads, 0) * 10) / 10,
      bu_ay_cikan: Math.round(st.outs.filter((x) => x.w.date.startsWith(m)).reduce((n, x) => n + x.loads, 0) * 10) / 10 };
  }
  if (name === "tank_status") {
    const t = tankStatus(live(d, "fuel_tank_movements"), today);
    return { kalan_litre: r2(t.remaining), toplam_giris_litre: r2(t.in), toplam_cikis_litre: r2(t.out), gunluk_ortalama_litre: t.daily, kac_gun_yeter: t.daysLeft,
      ortalama_litre_fiyati_TL: t.unitCost, son_giris: t.lastIn ? { tarih: t.lastIn.date, litre: r2(t.lastIn.liters), TL: t.lastIn.total ? r2(t.lastIn.total) : null } : null };
  }
  if (name === "receivables") {
    const c = resolve(d, a, "customer", "customers", "customer");
    if (c.error) return c;
    const res = receivables(d, { today, notes: extra.collectNotes || {} });
    const row = (x) => ({ musteri: x.name, alacak_TL: x.total, en_eski_gun: x.oldest_days, hakedise_girmemis_TL: x.unbilled,
      son_odeme: x.last_payment ? { tarih: x.last_payment.date, TL: x.last_payment.amount, gun_once: x.last_payment.days } : null,
      odeme_sozu: x.promise ? { tarih: x.promise.date, TL: x.promise.amount || null, gecti: x.promise.late } : null, cek_senet_TL: x.cheque_total || 0 });
    if (c.id) {
      const x = res.rows.find((r) => r.id === c.id);
      return x ? { ...row(x), acik_kalemler: x.open.slice(0, 10).map((o) => ({ tarih: o.date, aciklama: o.label, kalan_TL: o.left, gun: o.days })) } : { musteri: c.name, alacak_TL: 0, not: "açık alacak yok" };
    }
    return { toplam_alacak_TL: res.total, gun_0_30_TL: res.buckets.b0, gun_31_60_TL: res.buckets.b30, gun_61_90_TL: res.buckets.b60, gun_90_ustu_TL: res.buckets.b90,
      alacakli_musteri_sayisi: res.rows.length, en_riskli: res.rows.slice(0, 8).map(row),
      yaklasan_cek_senet: res.cheques.filter((q) => q.days_left <= 30).slice(0, 8).map((q) => ({ tur: q.kind, yon: q.direction, no: q.document_no, vade: q.due_date, TL: q.amount, durum: q.status })) };
  }
  if (name === "vehicle_profit") {
    const v = resolve(d, a, "vehicle", "vehicles", "vehicle");
    if (v.error) return v;
    const rows = vehicleKpis(d, { from, to, fuelRefPrice: extra.fuelRefPrice }).filter((x) => !v.id || x.id === v.id).map(({ id, ...x }) => x);
    return { from, to, araclar: rows.slice(0, 15) };
  }
  if (name === "customer_profit") {
    const c = resolve(d, a, "customer", "customers", "customer");
    if (c.error) return c;
    const rows = customerKpis(d, { from, to, today, notes: extra.collectNotes || {} }).filter((x) => !c.id || x.id === c.id).map(({ id, ...x }) => x);
    return { from, to, musteriler: rows.slice(0, 15) };
  }
  if (name === "price_check") return { from, to, gruplar: priceCheck(d, { from, to }).slice(0, 12) };
  if (name === "business_review") {
    const r = businessReview(d, { from, to, today, notes: extra.collectNotes || {}, fuelRefPrice: extra.fuelRefPrice });
    return { from, to, ozet: r.ozet, bulgular: r.bulgular.slice(0, 15).map((b) => b.text), en_karli_araclar: r.araclar.slice(0, 3).map((x) => [x.arac, x.kar_TL]), en_buyuk_musteriler: r.musteriler.slice(0, 3).map((x) => [x.musteri, x.gelir_TL]) };
  }
  if (name === "quote_price") {
    const c = resolve(d, a, "customer", "customers", "customer");
    const v = resolve(d, a, "vehicle", "vehicles", "vehicle");
    const s = resolve(d, a, "dump_site", "dump_sites", "dump_site");
    for (const x of [c, v, s]) if (x.error) return x;
    const wt = WORK_TYPES.find((t) => norm(t) === norm(a.work_type || "")) || WORK_TYPES.find((t) => a.work_type && norm(t).startsWith(norm(a.work_type).split(" ")[0])) || "";
    const unit = ["Sefer", "Ton", "Saat", "Yevmiye"].find((u) => norm(u) === norm(a.unit || "")) || "Sefer";
    const q = quoteFor(d, { customer_id: c.id, vehicle_id: v.id, dump_site_id: s.id, work_type: wt, unit, quantity: Number(a.quantity) || 0, dump_included: a.dump_included !== false }, { today, settings: extra.quoteSettings || {}, fuelRefPrice: extra.fuelRefPrice });
    return quoteSummary(d, q);
  }
  if (name === "maintenance_due") {
    const v = resolve(d, a, "vehicle", "vehicles", "vehicle");
    if (v.error) return v;
    const rows = maintenanceBoard(d, { today }).filter((r) => !v.id || r.v.id === v.id);
    return rows.length ? { bakimlar: maintSummary(rows).slice(0, 20) } : { not: "Bakım kuralı tanımlı değil. Bakım Takvimi ekranından araç başına kural eklenmeli (ör. motor yağı 500 saatte bir)." };
  }
  if (name === "payroll_status") {
    const p = resolve(d, a, "personnel", "personnel", "personnel");
    if (p.error) return p;
    const period = /^\d{4}-\d{2}$/.test(a.period || "") ? a.period : today.slice(0, 7);
    const rows = live(d, "personnel").filter((x) => x.active !== false && (!p.id || x.id === p.id)).map((x) => payrollSummary(x, payrollFor(d, x, period, { today })));
    return { donem: period, personeller: rows, toplam_kalan_TL: r2(rows.reduce((n, x) => n + Math.max(0, x.kalan_TL), 0)) };
  }
  if (name === "esnaf_debt") {
    const s = resolve(d, a, "supplier", "suppliers", "supplier");
    if (s.error) return s;
    const rows = live(d, "suppliers").filter((x) => !s.id || x.id === s.id).map((x) => ({ esnaf: x.name, kalan_TL: ledgerOf(d, x.id).remaining / 100 })).filter((x) => x.kalan_TL || s.id);
    return { toplam_TL: r2(rows.reduce((n, x) => n + x.kalan_TL, 0)), esnaflar: rows };
  }
  return { error: "Bilinmeyen araç: " + name };
}

export const ASK_SYSTEM = [
  "Sen bir hafriyat/nakliye şirketinin kayıtlarına bakan asistansın. Kullanıcının sorusunu cevaplamak için araçları (functions) çağır.",
  "Rakamları ASLA tahmin etme; yalnız araç sonuçlarındaki rakamları kullan. Toplama/bölme yapma; araç ne döndürdüyse onu söyle.",
  "Tarih belirtilmezse bu ay; 'geçen ay', 'bu hafta' gibi ifadeleri bugüne göre YYYY-MM-DD aralığına çevir.",
  "Araç hata döndürürse (bulunamadı / birden fazla) kullanıcıya adayları söyleyip netleştirmesini iste.",
  "Fiyat/teklif sorusunda ('kaça vereyim', 'bu fiyat zarar mı') quote_price çağır; önerilen fiyatı, zarar sınırını ve bu müşteriye son fiyatı söyle; eksik maliyet uyarısını atlama. Sonunda 'Teklif Asistanı ekranından PDF teklif hazırlayabilirsiniz' de.",
  "Kısa, net Türkçe cevap ver (en çok 5 cümle). Yönetim sorusunda (kârlılık, verim, ne yapmalı) bir yönetim danışmanı gibi somut öneri ekle.",
  EXPERT_KNOWLEDGE,
].join("\n");
