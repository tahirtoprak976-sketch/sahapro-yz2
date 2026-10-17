// SAHAPRO SOLO — çekirdek saf mantık (DOM/IndexedDB bağımsız)
// v1 (SAHAPRO CEP) ile geriye dönük uyumlu; hesap kuralları sahapro-hakedis-engine skill'ine göre.

export const APP_ID = "SAHAPRO_SOLO";
export const LEGACY_APP_IDS = ["SAHAPRO_CEP"];
export const APP_VERSION = "SAHAPRO YZ2 v1.0"; // bağımsız kopya: orijinalinden ayrı sürüm adı (karışma testi: Daha Fazla ekranından görülür)
export const SCHEMA_VERSION = 5;
export const SOURCE = "SAHAPRO_SOLO";
export const LEGACY_SOURCES = ["temporary_mobile_logger"];
export const SW_CACHE = "yz2-solo-v2";
export const COMPANY_NAME = "Muratoğlu Hafriyat";

// ---- Kayıt depoları (IndexedDB store adları = backup JSON anahtarları) ----
export const ENTITY_STORES = [
  // v1'den gelenler
  "customers",
  "sites",
  "vehicles",
  "personnel",
  "work_records",
  "fuel_records",
  "fuel_tank_movements",
  "expense_records",
  "maintenance_records",
  "cash_records",
  "personnel_events",
  "documents",
  // v2 yeniler
  "slips",
  "quotes",
  "price_book",
  "hakedis",
  "cari_movements",
  "contractors",
  "aliases",
  "audit_log",
  "contracts",
  "dump_sites",
  "quarries",
  "suppliers",
  "payables",
  "supplier_payments",
  "bank_accounts",
  "bank_movements",
  "receivable_plans",
  "settlement_allocations",
  "purchase_orders",
  "payroll_entries",
  "service_plans",
  "activities",
  "expense_categories",
  "daily_closings",
  "instruments",
  "inbox_messages", "meter_readings", "shift_assignments", "custody_records",
  "downtime_records", "maintenance_parts", "cost_allocations", "bank_import_rows", "stock_counts",
];
export const SYSTEM_STORES = ["attachments", "meta", "drafts"];

// ---- UUID ----
export function uuid() {
  if (globalThis.crypto && typeof globalThis.crypto.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  const b = new Uint8Array(16);
  globalThis.crypto.getRandomValues(b);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export function nowISO() {
  return new Date().toISOString();
}

export function newRecord(fields = {}) {
  const t = nowISO();
  return {
    id: uuid(),
    source: SOURCE,
    created_at: t,
    updated_at: t,
    deleted_at: null,
    schema_version: SCHEMA_VERSION,
    migration_status: "NOT_IMPORTED",
    ...fields,
    id: fields.id || uuid(),
  };
}
export function touchRecord(rec) {
  return { ...rec, updated_at: nowISO() };
}
export function isActive(rec) {
  return !rec.deleted_at;
}

// ---- Sabit listeler ----
export const WORK_UNITS = ["Sefer", "Saat", "Yevmiye", "Ton", "m³", "Adet"];
export const WORK_TYPES = [
  "Hafriyat Nakliye",
  "Moloz Nakliye",
  "Çöp Nakliye",
  "Mıcır Nakliye",
  "Kum Nakliye",
  "Gravak Nakliye",
  "Kazı",
  "Yıkım",
  "Kırım",
  "Tesviye",
  "Yükleme",
  "Makine Çalışması",
  "Mini Kato Çalışması",
  "JCB Çalışması",
  "Manitou Çalışması",
  "Vinç Çalışması",
  "Lowbed Nakliye",
  "Diğer",
];
export const TRUCK_TYPES = [
  "Hafriyat Nakliye",
  "Moloz Nakliye",
  "Çöp Nakliye",
  "Mıcır Nakliye",
  "Kum Nakliye",
  "Gravak Nakliye",
];
export const MACHINE_TYPES = [
  "Makine Çalışması",
  "Mini Kato Çalışması",
  "JCB Çalışması",
  "Manitou Çalışması",
  "Vinç Çalışması",
  "Kazı",
  "Yıkım",
  "Kırım",
  "Tesviye",
  "Yükleme",
];
export const FUEL_SOURCES = [
  "Depo Tankı",
  "Akaryakıt İstasyonu",
  "Müşteri Verdi",
  "Şantiye",
  "Diğer",
];
export const EXPENSE_CATEGORIES = [
  "Yakıt",
  "Otoyol / HGS",
  "Otopark",
  "Yemek",
  "Döküm",
  "Malzeme",
  "Yedek Parça",
  "Tamir",
  "Servis",
  "Lastik",
  "Yağ / Filtre",
  "Nakliye",
  "Personel",
  "Şantiye Gideri",
  "Ofis Gideri",
  "Diğer",
];
export const PAYMENT_METHODS = [
  "Nakit",
  "Kart",
  "Havale",
  "Personel Ödedi",
  "Şirket Ödedi",
  "Diğer",
];
export const REIMBURSEMENT_STATUS = ["Bekliyor", "Ödendi"];
export const MAINT_TYPES = [
  "Arıza",
  "Bakım",
  "Periyodik Bakım",
  "Lastik",
  "Yağ",
  "Filtre",
  "Elektrik",
  "Hidrolik",
  "Motor",
  "Şanzıman",
  "Kaporta",
  "Diğer",
];
export const MAINT_STATUS = [
  "Açık",
  "Serviste",
  "Parça Bekliyor",
  "Tamamlandı",
];
export const CASH_TYPES = [
  "Müşteriden Para Alındı",
  "Personelde Para",
  "Kasaya Teslim Bildirildi",
  "Kasaya Teslim Edildi",
  "Şirket Gideri İçin Para Verildi",
  "Diğer",
];
export const CASH_STATUS = [
  "PERSONELDE",
  "TESLIM_BILDIRILDI",
  "KASAYA_TESLIM_EDILDI",
];
export function nextCashStatus(s) {
  if (s === "PERSONELDE") return "TESLIM_BILDIRILDI";
  if (s === "TESLIM_BILDIRILDI") return "KASAYA_TESLIM_EDILDI";
  return null;
}
export const PERSONNEL_EVENT_TYPES = [
  "Avans",
  "Mesai",
  "Çalıştı",
  "Yarım Gün",
  "İzin",
  "Rapor",
  "Devamsızlık",
  "Zimmet Notu",
  "Personel Gideri",
  "Tahsilat",
  "Kasa Teslimi",
  "Diğer",
];
export const DOC_TYPES = [
  "Dijital İş Fişi",
  "Döküm Fişi",
  "Akaryakıt Fişi",
  "Gider Fişi",
  "Servis Belgesi",
  "İrsaliye",
  "Makbuz",
  "Fatura",
  "Döküm Faturası",
  "Sözleşme",
  "Ruhsat",
  "Sigorta / Poliçe",
  "Muayene Belgesi",
  "Personel Evrakı",
  "İzin Formu",
  "Diğer",
];
export const VEHICLE_OWNERSHIP = ["Özmal", "Taşeron"];
export const SLIP_STATUS = ["Taslak", "İmzalandı", "Revize", "İptal"];
export const QUOTE_TYPES = [
  "UNIT_PRICE",
  "QUANTITY_BASED",
  "LUMP_SUM",
  "ALTERNATIVE",
];
export const QUOTE_STATUS = ["Taslak", "Gönderildi", "Kabul", "Red", "İptal"];
export const HAKEDIS_STATUS = ["Taslak", "Kesinleşti", "İptal"];
export const CARI_TYPES = ["Hakedis", "Tahsilat", "Duzeltme"];
export const OCR_STATUS = ["YOK", "BEKLIYOR", "TAMAM", "HATA"];

// ---- Seed listeler ----
export const SEED_VEHICLES = [
  "DX225 / Yeni Makine",
  "Sany 225",
  "Doosan 225 / Eski Kato",
  "DX140",
  "14 Tonluk Kato",
  "Uzun Bomlu",
  "U55",
  "U17",
  "U36",
  "JCB",
  "Manitou MTX 1840",
  "Mobil Vinç",
  "Silindir",
  "34UL9492",
  "34GA2261",
  "34FY2482",
  "34GAM627",
];
export const SEED_PERSONNEL = [
  "Tahir Toprak",
  "Serdar",
  "Bayram",
  "Niyazi",
  "Olcay",
  "Cihan",
  "Soner",
  "Metin",
  "Hüseyin",
  "Ahmet",
];
// sahapro-domain alias kuralları (kullanıcı Ayarlar'dan genişletebilir)
export const SEED_ALIASES = [
  ["yeni makine", "DX225 / Yeni Makine"],
  ["dx225", "DX225 / Yeni Makine"],
  ["eski kato", "Doosan 225 / Eski Kato"],
  ["doosan", "Doosan 225 / Eski Kato"],
  ["4 tonluk kato", "U36"],
  ["4 tonluk", "U36"],
  ["u35", "U36"],
  ["mini kato", "U55"],
  ["6 tonluk mini kato", "U55"],
  ["6 tonluk", "U55"],
  ["sany", "Sany 225"],
  ["manitou", "Manitou MTX 1840"],
  ["mobil vinç", "Mobil Vinç"],
  ["hiab", "Mobil Vinç"],
  ["kırmalı hiab", "Mobil Vinç"],
  ["jcb", "JCB"],
  ["14 tonluk", "14 Tonluk Kato"],
  ["uzun bomlu", "Uzun Bomlu"],
  ["silindir", "Silindir"],
];

// ---- Sayı/para: kuruş tam sayı hassasiyeti ----
export function toKurus(n) {
  return Math.round((Number(n) || 0) * 100);
}
export function fromKurus(k) {
  return (Number(k) || 0) / 100;
}
export function fmtTL(n) {
  const v = Number(n) || 0;
  return v.toLocaleString("tr-TR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}
export function fmtNum(n) {
  return (Number(n) || 0).toLocaleString("tr-TR", { maximumFractionDigits: 2 });
}
export function todayStr(d = new Date()) {
  const p = (x) => String(x).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
export function trDate(dateStr) {
  const [y, m, d] = String(dateStr || "").split("-");
  return y && m && d ? `${d}.${m}.${y}` : String(dateStr || "");
}
export function matchSearch(haystack, q) {
  if (!q) return true;
  return String(haystack)
    .toLocaleLowerCase("tr-TR")
    .includes(String(q).toLocaleLowerCase("tr-TR"));
}
export function normKey(s) {
  return String(s || "")
    .toLocaleLowerCase("tr-TR")
    .replace(/\s+/g, " ")
    .trim();
}

// ---- Vinç özel formülü (tarife ayarlardan gelir, gömülü değil) ----
export function calcCranePrice(hours, firstHour, nextHour) {
  const h = Number(hours) || 0;
  if (h <= 0) return 0;
  if (h <= 1) return Number(firstHour) || 0;
  return (Number(firstHour) || 0) + (h - 1) * (Number(nextHour) || 0);
}

// ---- Fiyat önceliği: müşteri+şantiye > müşteri > genel; aynı kapsamda plaka > tür > grup > tüm araçlar ----
// price_book kaydı: {vehicle_id, work_type, unit, price, kdv_rate, kdv_included, valid_from, valid_to, customer_id, site_id, formula, first_hour_price, next_hour_price, active}
export const PRICE_VEHICLE_GROUPS = Object.assign(Object.create(null), {
  TRUCK_TIR: { label: "Kamyon ve Tır", types: ["TRUCK", "TIR"] },
  TRUCK: { label: "Yalnız Kamyon", types: ["TRUCK"] },
  TIR: { label: "Yalnız Tır / Çekici", types: ["TIR"] },
  VAN: { label: "Yalnız Kamyonet", types: ["VAN"] },
});
export function transportVehicleType(type) {
  const key = String(type || "")
    .toLocaleLowerCase("tr-TR")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ı/g, "i")
    .replace(/[\/()_-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (
    [
      "kamyon",
      "damperli kamyon",
      "hafriyat kamyonu",
      "kamyon damperli",
    ].includes(key)
  )
    return "TRUCK";
  if (["tir", "cekici", "tir cekici", "damperli tir"].includes(key))
    return "TIR";
  if (["kamyonet"].includes(key)) return "VAN";
  return null;
}
export function priceVehicleScope(entry, vehicleNames = {}) {
  if (entry.vehicle_id)
    return vehicleNames[entry.vehicle_id] || "Belirli araç / plaka";
  if (entry.vehicle_group)
    return (
      PRICE_VEHICLE_GROUPS[entry.vehicle_group]?.label || "Geçersiz araç grubu"
    );
  if (entry.vehicle_type) return entry.vehicle_type;
  return "Tüm araç / makineler";
}
export function resolvePrice(entries, ctx) {
  const cands = (entries || []).filter(
    (e) => isActive(e) && e.active !== false && e.unit === ctx.unit,
  );
  const result = [];
  for (const e of cands) {
    if (
      e.vehicle_group &&
      !PRICE_VEHICLE_GROUPS[e.vehicle_group]?.types.includes(
        transportVehicleType(ctx.vehicle_type),
      )
    )
      continue;
    if (
      [
        "vehicle_id",
        "vehicle_type",
        "work_type",
        "customer_id",
        "site_id",
        "material",
      ].some((k) => e[k] && e[k] !== ctx[k])
    )
      continue;
    if (
      (e.valid_from && (!ctx.date || e.valid_from > ctx.date)) ||
      (e.valid_to && (!ctx.date || e.valid_to < ctx.date))
    )
      continue;
    if (
      (e.distance_min != null || e.distance_max != null) &&
      (ctx.distance_km == null ||
        (e.distance_min != null &&
          Number(ctx.distance_km) < Number(e.distance_min)) ||
        (e.distance_max != null &&
          Number(ctx.distance_km) > Number(e.distance_max)))
    )
      continue;
    const tier = e.site_id ? 3 : e.customer_id ? 2 : 1;
    const specificity =
      ["vehicle_id", "vehicle_type", "work_type", "material"].filter(
        (k) => e[k],
      ).length + (e.distance_min != null || e.distance_max != null ? 1 : 0);
    const vehicleSpecificity = e.vehicle_id
      ? 4
      : e.vehicle_type
        ? 3
        : e.vehicle_group
          ? PRICE_VEHICLE_GROUPS[e.vehicle_group].types.length === 1
            ? 2
            : 1
          : 0;
    result.push({ e, tier, specificity, vehicleSpecificity });
  }
  result.sort(
    (a, b) =>
      b.tier - a.tier ||
      b.vehicleSpecificity - a.vehicleSpecificity ||
      b.specificity - a.specificity ||
      String(b.e.valid_from || "").localeCompare(
        String(a.e.valid_from || ""),
      ) ||
      String(a.e.id || "").localeCompare(String(b.e.id || "")),
  );
  if (!result.length) return null;
  const x = result[0];
  return {
    ...x.e,
    price_source:
      x.tier === 3
        ? "Şantiyeye Özel Fiyat"
        : x.tier === 2
          ? "Müşteriye Özel Fiyat"
          : "Genel Liste",
  };
}
export function priceForQuantity(entry, quantity, craneDefaults) {
  if (!entry) return null;
  const q = Number(quantity) || 0;
  if (entry.formula === "CRANE_FIRST_HOUR") {
    const fh = Number(entry.first_hour_price ?? craneDefaults?.first ?? 0);
    const nh = Number(entry.next_hour_price ?? craneDefaults?.next ?? 0);
    return calcCranePrice(q, fh, nh);
  }
  return fromKurus(toKurus(entry.price) * q);
}

// ---- Teklif toplamları (§11) ----
// UNIT_PRICE: satır fiyatları TOPLANMAZ (toplam gösterilmez). QUANTITY_BASED: miktar×birim.
// LUMP_SUM: anlaşılan toplam authoritative. ALTERNATIVE: alternatifler toplanmaz.
export function calcQuoteTotals(quote) {
  const items = quote.items || [];
  const lines = items.map((it) => {
    const qty = Number(it.quantity) || 0;
    const up = Number(it.unit_price) || 0;
    const line =
      quote.type === "QUANTITY_BASED" ? fromKurus(toKurus(up) * qty) : null;
    return { ...it, line_total: line };
  });
  let subtotal = null;
  if (quote.type === "QUANTITY_BASED") {
    subtotal = fromKurus(lines.reduce((s, l) => s + toKurus(l.line_total), 0));
  } else if (quote.type === "LUMP_SUM") {
    subtotal = Number(quote.lump_total) || 0;
  }
  const kdvRate = quote.kdv_rate == null ? 20 : Number(quote.kdv_rate);
  const kdv =
    subtotal == null
      ? null
      : fromKurus(Math.round((toKurus(subtotal) * kdvRate) / 100));
  const grand =
    subtotal == null ? null : fromKurus(toKurus(subtotal) + toKurus(kdv));
  return {
    lines,
    subtotal,
    kdv_rate: kdvRate,
    kdv,
    grand,
    show_total: subtotal != null,
  };
}

// ---- Hakediş kalemi tutarı (snapshot'lı) ----
export function calcHakedisLine(item, craneDefaults) {
  const q = Number(item.quantity) || 0;
  let amount;
  if (item.formula === "CRANE_FIRST_HOUR") {
    amount = calcCranePrice(
      q,
      item.first_hour_price ?? (craneDefaults && craneDefaults.first),
      item.next_hour_price ?? (craneDefaults && craneDefaults.next),
    );
  } else {
    amount = fromKurus(toKurus(item.unit_price) * q);
  }
  const kdvRate = item.kdv_rate == null ? 20 : Number(item.kdv_rate);
  if (item.kdv_included)
    amount = fromKurus(Math.round(toKurus(amount) / (1 + kdvRate / 100)));
  const kdv = fromKurus(Math.round((toKurus(amount) * kdvRate) / 100));
  return {
    amount,
    kdv_rate: kdvRate,
    kdv,
    total: fromKurus(toKurus(amount) + toKurus(kdv)),
  };
}
export function calcHakedisTotals(items, craneDefaults) {
  const lines = (items || []).map((it) => ({
    ...it,
    ...calcHakedisLine(it, craneDefaults),
  }));
  const subtotal = fromKurus(lines.reduce((s, l) => s + toKurus(l.amount), 0));
  const kdv = fromKurus(lines.reduce((s, l) => s + toKurus(l.kdv), 0));
  return {
    lines,
    subtotal,
    kdv,
    grand: fromKurus(toKurus(subtotal) + toKurus(kdv)),
  };
}

// ---- Cari: hareket toplamı (Hakedis +borç, Tahsilat -alacak azaltır, Duzeltme işaretli) ----
export function cariBalance(movements) {
  let bal = 0;
  for (const m of (movements || []).filter(isActive))
    bal += Number(m.amount) || 0;
  return fromKurus(Math.round(bal * 100));
}

// ---- Depo yakıt dengesi ----
export function calcTankBalance(movements) {
  let inn = 0,
    out = 0;
  for (const m of (movements || []).filter(isActive)) {
    const l = Number(m.liters) || 0;
    if (m.move_type === "GİRİŞ") inn += l;
    else if (m.move_type === "ÇIKIŞ") out += l;
  }
  return { in: inn, out, remaining: inn - out };
}

// Depo yakıtının litre maliyeti: verilen tarihe kadar fiyatı girilmiş depo girişlerinin litre ağırlıklı ortalaması
export function tankUnitCost(movements, date = "9999-12-31") {
  let L = 0, tl = 0;
  for (const m of (movements || []).filter(isActive)) {
    if (m.move_type !== "GİRİŞ" || (date && m.date > date)) continue;
    // Toplam (KDV dahil, ödenen) esastır; litre fiyatı yanlış (ör. KDV hariç) yazılmış olsa da maliyet toplamdan hesaplanır
    const up = Number(m.total) > 0 && Number(m.liters) > 0 ? Number(m.total) / Number(m.liters) : Number(m.unit_price) || 0;
    if (!(up > 0)) continue;
    L += Number(m.liters) || 0;
    tl += up * (Number(m.liters) || 0);
  }
  return L > 0 ? Math.round((tl / L) * 100) / 100 : null;
}

// Depo durumu: kalan, son 14 gün günlük ortalama çıkış, kaç gün yeter
export function tankStatus(movements, today = todayStr()) {
  const bal = calcTankBalance(movements);
  const from = addDays(today, -13);
  const out14 = (movements || []).filter((m) => isActive(m) && m.move_type === "ÇIKIŞ" && m.date >= from && m.date <= today).reduce((n, m) => n + (Number(m.liters) || 0), 0);
  const daily = Math.round((out14 / 14) * 10) / 10;
  const lastIn = (movements || []).filter((m) => isActive(m) && m.move_type === "GİRİŞ" && !m.count_id).sort((a, b) => (b.date > a.date ? 1 : -1))[0] || null;
  return { ...bal, daily, daysLeft: daily > 0 ? Math.floor(bal.remaining / daily) : null, lastIn, unitCost: tankUnitCost(movements, today) };
}

// ---- Gün özeti (genişletilmiş) ----
export function daySummary(dateStr, data) {
  const on = (r) => isActive(r) && r.date === dateStr;
  const works = (data.work_records || []).filter(on);
  const fuels = (data.fuel_records || []).filter(on);
  const expenses = (data.expense_records || []).filter(on);
  const cash = (data.cash_records || []).filter(on);
  const maint = (data.maintenance_records || []).filter(on);
  const pevents = (data.personnel_events || []).filter(on);
  const slips = (data.slips || []).filter(on);
  const sumUnit = (u) =>
    works
      .filter((w) => w.unit === u)
      .reduce((s, w) => s + (Number(w.quantity) || 0), 0);
  return {
    work_count: works.length,
    slip_count: slips.length,
    total_sefer: sumUnit("Sefer"),
    total_saat: sumUnit("Saat"),
    total_yevmiye: sumUnit("Yevmiye"),
    fuel_liters: fuels.reduce((s, f) => s + (Number(f.liters) || 0), 0),
    expense_total: expenses.reduce((s, e) => s + (Number(e.amount) || 0), 0),
    tahsilat_total: cash
      .filter((c) => c.cash_type === "Müşteriden Para Alındı")
      .reduce((s, c) => s + (Number(c.amount) || 0), 0),
    open_breakdowns: (data.maintenance_records || []).filter(
      (r) => isActive(r) && r.status !== "Tamamlandı",
    ).length,
    personnel_events: pevents.length,
    personnel_active: new Set(works.map((w) => w.personnel_id).filter(Boolean))
      .size,
  };
}

// ---- Akıllı uyarılar (§40, rule-based) ----
export function smartAlerts(data, opts = {}) {
  const today = opts.today || todayStr();
  const alerts = [];
  const act = (arr) => (arr || []).filter(isActive);
  for (const e of act(data.expense_records))
    if (e.receipt === "Hayır")
      alerts.push({
        kind: "warn",
        key: "expense_noreceipt",
        text: `Fişsiz gider: ${trDate(e.date)} ${e.category || ""} ${fmtTL(e.amount)} TL`,
        ref: { type: "expense", id: e.id },
      });
  for (const f of act(data.fuel_records))
    if (f.receipt === "Hayır")
      alerts.push({
        kind: "warn",
        key: "fuel_noreceipt",
        text: `Fişsiz yakıt: ${trDate(f.date)} ${f.liters} Lt`,
        ref: { type: "fuel", id: f.id },
      });
  for (const m of act(data.maintenance_records))
    if (m.status !== "Tamamlandı")
      alerts.push({
        kind: "alert",
        key: "maint_open",
        text: `Açık arıza/bakım: ${m.description || m.maint_type || ""} (${m.status || "Açık"})`,
        ref: { type: "maintenance", id: m.id },
      });
  for (const c of act(data.cash_records)) {
    if (c.cash_status === "PERSONELDE")
      alerts.push({
        kind: "alert",
        key: "cash_personel",
        text: `Personelde para bekliyor: ${fmtTL(c.amount)} TL`,
        ref: { type: "cash", id: c.id },
      });
    if (c.cash_status === "TESLIM_BILDIRILDI")
      alerts.push({
        kind: "warn",
        key: "cash_teslim",
        text: `Teslim bildirildi, kasaya alınmadı: ${fmtTL(c.amount)} TL`,
        ref: { type: "cash", id: c.id },
      });
  }
  for (const v of act(data.vehicles)) {
    if (v.next_maintenance_date && v.next_maintenance_date <= today)
      alerts.push({
        kind: "alert",
        key: "maint_due",
        text: `Bakım zamanı geldi: ${v.name}`,
        ref: { type: "vehicle", id: v.id },
      });
    else if (
      v.next_maintenance_date &&
      v.next_maintenance_date <= addDays(today, 7)
    )
      alerts.push({
        kind: "warn",
        key: "maint_soon",
        text: `Bakım yaklaşıyor: ${v.name} (${trDate(v.next_maintenance_date)})`,
        ref: { type: "vehicle", id: v.id },
      });
  }
  for (const d of latestDocuments(act(data.documents))) {
    if (d.expiry_date && d.expiry_date <= addDays(today, 30))
      alerts.push({
        kind: d.expiry_date < today ? "alert" : "warn",
        key: "doc_expiry",
        text: `${(data.vehicles || []).find((v) => v.id === (d.vehicle_id || d.owner_id))?.name || (data.personnel || []).find((p) => p.id === (d.personnel_id || d.owner_id))?.name || (d.owner_type === "company" ? "Şirket" : "Belge")} · ${d.category || "Belge"}: ${d.expiry_date < today ? "Süresi geçti" : Math.ceil((new Date(d.expiry_date + "T12:00:00") - new Date(today + "T12:00:00")) / 86400000) + " gün kaldı"} (${trDate(d.expiry_date)})`,
        ref: { type: "document", id: d.id },
      });
  }
  const bAge = backupAgeDays(opts.lastBackupAt, today);
  if (bAge === null || bAge >= 3)
    alerts.push({
      kind: bAge === null || bAge >= 7 ? "alert" : "warn",
      key: "backup_old",
      text:
        bAge === null
          ? "Hiç yedek alınmadı — Ayarlar → Tüm Verileri Yedekle"
          : `Son yedek ${bAge} gün önce — Ayarlar → Tüm Verileri Yedekle`,
      ref: { type: "settings" },
    });
  const todayWorks = act(data.work_records).filter((w) => w.date === today);
  for (const w of todayWorks)
    if (!w.slip_id)
      alerts.push({
        kind: "info",
        key: "work_noslip",
        text: `Bugünkü işte dijital fiş yok: ${w.work_type || "İş"} ${w.quantity ?? ""} ${w.unit || ""}`,
        ref: { type: "work", id: w.id },
      });
  for (const w of act(data.work_records))
    if (!w.price_snapshot)
      alerts.push({
        kind: "warn",
        key: "work_unpriced",
        text: "Fiyatı olmayan iş: " + (w.work_type || "İş"),
        ref: { type: "work", id: w.id },
      });
  const tank = calcTankBalance(data.fuel_tank_movements);
  if (tank.remaining < Number(opts.tankLowLiters ?? 100))
    alerts.push({
      kind: "warn",
      key: "tank_low",
      text: "Düşük tank seviyesi: " + fmtNum(tank.remaining) + " Lt",
      ref: { type: "tank" },
    });
  return alerts;
}
// Aynı belgenin farklı adları (ör. "TÜVTÜRK / Periyodik Muayene" = "Muayene Belgesi")
export const DOC_FAMILY = { "TÜVTÜRK / Periyodik Muayene": "Muayene Belgesi", "Sigorta / Poliçe": "Zorunlu Trafik Sigortası" };
export const docFamily = (c) => DOC_FAMILY[c] || c || "";
const docOwnerKey = (d) => `${d.owner_type || ""}|${d.vehicle_id || d.personnel_id || d.owner_id || ""}`;
const docNoKey = (s) => String(s || "").toLocaleUpperCase("tr-TR").replace(/[^A-Z0-9ÇĞİÖŞÜ]/g, "");
// Aynı belge mi? Aynı sahip + aynı belge ailesi + (aynı belge no ya da aynı düzenleme ve bitiş tarihi)
export function sameDocument(a, b) {
  if (docOwnerKey(a) !== docOwnerKey(b) || docFamily(a.category) !== docFamily(b.category)) return false;
  const na = docNoKey(a.doc_no), nb = docNoKey(b.doc_no);
  if (na.length >= 3 && na === nb) return true;
  return !!(a.expiry_date && a.expiry_date === b.expiry_date && a.date && a.date === b.date);
}
// Mükerrer belge grupları (her grupta ilk kayıt tutulur)
export function duplicateDocuments(docs) {
  const list = [...(docs || [])].sort((a, b) => String(a.created_at || "").localeCompare(String(b.created_at || "")));
  const groups = [];
  for (const d of list) {
    const g = groups.find((x) => sameDocument(x[0], d));
    if (g) g.push(d); else groups.push([d]);
  }
  return groups.filter((g) => g.length > 1);
}
// Aynı sahip + belge ailesi için yalnızca en güncel belge (yenilenen eski belge uyarı vermesin)
export function latestDocuments(docs) {
  const best = new Map();
  for (const d of docs || []) {
    const k = `${docOwnerKey(d)}|${docFamily(d.category)}`;
    const cur = best.get(k);
    if (
      !cur ||
      String(d.expiry_date || "9999") > String(cur.expiry_date || "9999")
    )
      best.set(k, d);
  }
  return [...best.values()];
}
// Son yedekten bu yana gün (yedek yoksa null)
export function backupAgeDays(lastBackupAt, today = todayStr()) {
  if (!lastBackupAt) return null;
  const t = new Date(lastBackupAt).getTime();
  if (!Number.isFinite(t)) return null;
  const days = Math.round(
    (new Date(today + "T12:00:00").getTime() -
      new Date(todayStr(new Date(t)) + "T12:00:00").getTime()) /
      86400000,
  );
  return Math.max(0, days);
}
export function addDays(dateStr, n) {
  const d = new Date(dateStr + "T12:00:00");
  d.setDate(d.getDate() + n);
  return todayStr(d);
}

// ---- Tahmini operasyon sonucu (§39 — "muhasebe net kârı" DEĞİL) ----
export function profitability(data, filter = {}) {
  const inRange = (d) =>
    (!filter.from || d >= filter.from) && (!filter.to || d <= filter.to);
  const matchCtx = (r) =>
    (!filter.customer_id || r.customer_id === filter.customer_id) &&
    (!filter.site_id || r.site_id === filter.site_id) &&
    (!filter.vehicle_id || r.vehicle_id === filter.vehicle_id);
  let gelir = 0;
  for (const h of (data.hakedis || []).filter(
    (h) => isActive(h) && h.status === "Kesinleşti",
  )) {
    if (filter.customer_id && h.customer_id !== filter.customer_id) continue;
    if (!inRange(h.created_date || h.date_from || "")) continue;
    gelir += Number(h.grand_total) || 0;
  }
  let yakit = 0,
    yakitLt = 0;
  for (const f of (data.fuel_records || []).filter(
    (r) => isActive(r) && matchCtx(r) && inRange(r.date),
  )) {
    yakit += Number(f.total ?? f.total_amount) || 0;
    yakitLt += Number(f.liters) || 0;
  }
  let gider = 0;
  for (const e of (data.expense_records || []).filter(
    (r) => isActive(r) && !r.dump_deposit && matchCtx(r) && inRange(r.date),
  ))
    gider += Number(e.amount) || 0;
  let bakim = 0;
  for (const m of (data.maintenance_records || []).filter(
    (r) => isActive(r) && matchCtx(r) && inRange(r.date),
  ))
    bakim += Number(m.cost) || 0;
  const sonuc = gelir - yakit - gider - bakim;
  return { gelir, yakit, yakitLt, gider, bakim, sonuc };
}

// ---- WhatsApp gün sonu metni ----
export function buildWhatsAppText(dateStr, data, names = {}) {
  const nm = (store, id) => (names[store] && names[store][id]) || "";
  const on = (arr) =>
    (arr || []).filter((r) => isActive(r) && r.date === dateStr);
  const L = [`${trDate(dateStr)} — SAHAPRO Gün Sonu`, ""];
  const works = on(data.work_records);
  if (works.length) {
    L.push("İŞLER");
    for (const w of works) {
      L.push(
        `${nm("customers", w.customer_id) || "—"} / ${nm("sites", w.site_id) || "—"}`,
      );
      L.push(
        `${nm("vehicles", w.vehicle_id) || "—"} — ${nm("personnel", w.personnel_id) || "—"}`,
      );
      L.push(
        `${w.quantity ?? ""} ${w.unit || ""} · ${w.work_type || ""}`.trim(),
      );
      if (w.description) L.push(String(w.description));
    }
    L.push("");
  }
  const fuels = on(data.fuel_records);
  if (fuels.length) {
    L.push("YAKIT");
    for (const f of fuels)
      L.push(`${nm("vehicles", f.vehicle_id) || "—"} — ${f.liters} Lt`);
    L.push("");
  }
  const expenses = on(data.expense_records);
  if (expenses.length) {
    L.push("GİDER");
    for (const e of expenses)
      L.push(`${e.category || "Gider"} — ${fmtTL(e.amount)} TL`);
    L.push("");
  }
  const cash = on(data.cash_records);
  if (cash.length) {
    L.push("KASA");
    for (const c of cash) {
      L.push(`${c.cash_type || ""} — ${fmtTL(c.amount)} TL`);
      if (c.cash_status === "PERSONELDE" && c.personnel_id)
        L.push(`Personelde: ${nm("personnel", c.personnel_id)}`);
    }
    L.push("");
  }
  const maint = on(data.maintenance_records);
  if (maint.length) {
    L.push("ARIZA/BAKIM");
    for (const m of maint) {
      L.push(
        `${nm("vehicles", m.vehicle_id) || "—"} — ${m.description || m.maint_type || ""}`,
      );
      L.push(`Durum: ${m.status || "Açık"}`);
    }
  }
  return L.join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// ---- CSV ----
export function csvEscape(v) {
  const s = v == null ? "" : String(v);
  return /[";\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
export function toCSV(headers, rows) {
  const lines = [headers.map(csvEscape).join(";")];
  for (const r of rows) lines.push(r.map(csvEscape).join(";"));
  return lines.join("\r\n");
}

// ---- Backup paketi (v2) + v1 backup doğrulama ----
export function buildBackup(
  dataByStore,
  deviceInstallId,
  exportedAt = nowISO(),
) {
  const data = {};
  for (const s of ENTITY_STORES)
    data[s] = (dataByStore[s] || []).map((r) => ({ ...r }));
  return {
    app: APP_ID,
    schema_version: SCHEMA_VERSION,
    app_version: APP_VERSION,
    exported_at: exportedAt,
    device_install_id: deviceInstallId,
    data,
  };
}
export function isValidBackup(obj) {
  const appOk = obj && (obj.app === APP_ID || LEGACY_APP_IDS.includes(obj.app));
  return (
    !!appOk &&
    typeof obj.schema_version === "number" &&
    !!obj.data &&
    typeof obj.data === "object"
  );
}

// ---- Import preview: UUID aynıysa duplicate YOK, kör overwrite YOK ----
export function stableStringify(v) {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return "[" + v.map(stableStringify).join(",") + "]";
  return (
    "{" +
    Object.keys(v)
      .sort()
      .map((k) => JSON.stringify(k) + ":" + stableStringify(v[k]))
      .join(",") +
    "}"
  );
}
export function mergePreview(localRecords, importedRecords) {
  const localById = new Map((localRecords || []).map((r) => [r.id, r]));
  const res = { new: [], existing: [], conflict: [] };
  const seen = new Set();
  for (const r of importedRecords || []) {
    if (!r || !r.id) continue;
    if (seen.has(r.id)) {
      res.conflict.push(r);
      continue;
    }
    seen.add(r.id);
    const l = localById.get(r.id);
    if (!l) res.new.push(r);
    else if (stableStringify(l) === stableStringify(r)) res.existing.push(r);
    else res.conflict.push(r);
  }
  return res;
}

// ---- ZIP (store-only, UTF-8 bayraklı) ----
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
export function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++)
    c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function u16(v) {
  return new Uint8Array([v & 255, (v >>> 8) & 255]);
}
function u32(v) {
  return new Uint8Array([
    v & 255,
    (v >>> 8) & 255,
    (v >>> 16) & 255,
    (v >>> 24) & 255,
  ]);
}
function dosDateTime(d = new Date()) {
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
    date:
      (((d.getFullYear() - 1980) & 127) << 9) |
      ((d.getMonth() + 1) << 5) |
      d.getDate(),
  };
}
export function buildZip(files, date = new Date()) {
  const enc = new TextEncoder();
  const { time, date: dt } = dosDateTime(date);
  const chunks = [],
    central = [];
  let offset = 0;
  for (const f of files) {
    const name = enc.encode(f.name);
    const crc = crc32(f.data);
    const head = [
      u32(0x04034b50),
      u16(20),
      u16(0x0800),
      u16(0),
      u16(time),
      u16(dt),
      u32(crc),
      u32(f.data.length),
      u32(f.data.length),
      u16(name.length),
      u16(0),
    ];
    let headLen = 0;
    for (const h of head) headLen += h.length;
    central.push({ name, crc, size: f.data.length, offset, time });
    for (const h of head) chunks.push(h);
    chunks.push(name, f.data);
    offset += headLen + name.length + f.data.length;
  }
  const cdStart = offset;
  let cdSize = 0;
  for (const c of central) {
    const e = [
      u32(0x02014b50),
      u16(20),
      u16(20),
      u16(0x0800),
      u16(0),
      u16(c.time),
      u16(dt),
      u32(c.crc),
      u32(c.size),
      u32(c.size),
      u16(c.name.length),
      u16(0),
      u16(0),
      u16(0),
      u16(0),
      u32(0),
      u32(c.offset),
    ];
    for (const x of e) {
      chunks.push(x);
      cdSize += x.length;
    }
    chunks.push(c.name);
    cdSize += c.name.length;
  }
  const end = [
    u32(0x06054b50),
    u16(0),
    u16(0),
    u16(central.length),
    u16(central.length),
    u32(cdSize),
    u32(cdStart),
    u16(0),
  ];
  for (const x of end) chunks.push(x);
  let total = 0;
  for (const c of chunks) total += c.length;
  const out = new Uint8Array(total);
  let p = 0;
  for (const c of chunks) {
    out.set(c, p);
    p += c.length;
  }
  return out;
}
