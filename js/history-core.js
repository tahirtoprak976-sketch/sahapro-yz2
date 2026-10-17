// Structured historical import only. No guessing of WhatsApp prose, prices or VAT.
import { FIELD_METADATA } from "./business.js";
import {
  newRecord,
  isActive,
  normKey,
  WORK_TYPES,
  WORK_UNITS,
  calcHakedisLine,
  todayStr,
} from "./core.js";
export const HISTORY_FORMAT = "SAHAPRO_HISTORY_V1";
export const HISTORY_STORES = [
  "customers",
  "sites",
  "vehicles",
  "personnel",
  "dump_sites",
  "quarries",
  "work_records",
  "fuel_records",
  "fuel_tank_movements",
];
const text = (v) => (typeof v === "string" ? v.trim() : "");
const key = (v) => normKey(text(v)).replace(/[^a-z0-9çğıöşü]/g, "");
export function validHistoryDate(v, today = todayStr()) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v || "")) return false;
  const d = new Date(v + "T12:00:00Z");
  return (
    Number.isFinite(d.getTime()) &&
    d.toISOString().slice(0, 10) === v &&
    v <= today
  );
}
export function readHistoryPackage(value) {
  const p =
    typeof value === "string"
      ? JSON.parse(value.replace(/^\uFEFF/, ""))
      : value;
  if (
    !p ||
    p.format !== HISTORY_FORMAT ||
    !Array.isArray(p.rows) ||
    !p.rows.length ||
    p.rows.length > 1000
  )
    throw Error("SAHAPRO geçmiş aktarım dosyası gerekli (1–1000 satır).");
  const ids = new Set();
  const rows = p.rows.map((r, i) => {
    if (
      !r ||
      !["work", "fuel"].includes(r.kind) ||
      !text(r.row_id) ||
      text(r.row_id).length > 120 ||
      ids.has(r.row_id)
    )
      throw Error(`Satır ${i + 1}: tür veya tekil satır numarası geçersiz.`);
    ids.add(r.row_id);
    for (const k of [
      "customer",
      "site",
      "vehicle",
      "personnel",
      "dump_site",
      "quarry",
    ])
      if (r[k] != null && (typeof r[k] !== "string" || r[k].length > 200))
        throw Error(`Satır ${i + 1}: kart adı geçersiz veya çok uzun.`);
    for (const k of ["description", "raw_message"])
      if (r[k] != null && (typeof r[k] !== "string" || r[k].length > 20000))
        throw Error(`Satır ${i + 1}: açıklama veya mesaj geçersiz/çok uzun.`);
    if (r.settlement_status !== "unbilled_unpaid")
      throw Error(
        `Satır ${i + 1}: yalnız hakedişe alınmamış ve ödenmemiş kayıtlar desteklenir.`,
      );
    // Allowlist, excluding executable content, IDs, financial locks and arbitrary backup fields.
    const fields = [
      "row_id",
      "kind",
      "date",
      "customer",
      "site",
      "vehicle",
      "vehicle_type",
      "personnel",
      "work_type",
      "quantity",
      "unit",
      "material",
      "dump_site",
      "quarry",
      "description",
      "unit_price",
      "kdv_rate",
      "kdv_included",
      "liters",
      "fuel_source",
      "raw_message",
      "settlement_status",
      "transport_group_key",
      "transport_total",
    ];
    return Object.fromEntries(
      fields.filter((k) => Object.hasOwn(r, k)).map((k) => [k, r[k]]),
    );
  });
  return { format: HISTORY_FORMAT, title: text(p.title).slice(0, 150), rows };
}
export function initialHistoryChoices(p) {
  return p.rows.map((r) => ({
    include: r.kind === "work",
    row: { ...r },
    refs: {},
    tank_confirmed: false,
    unpriced_confirmed: false,
  }));
}
export function historyWorkKey(r) {
  return JSON.stringify([
    r.date,
    r.customer_id || "",
    r.site_id || "",
    r.vehicle_id || "",
    r.personnel_id || "",
    r.work_type,
    r.material || "",
    Number(r.quantity),
    r.unit,
    r.dump_site_id || r.dump_area || "",
    r.quarry_id || r.quarry || "",
  ]);
}
export function historyFuelKey(r) {
  return JSON.stringify([
    r.date,
    r.vehicle_id,
    r.personnel_id || "",
    Number(r.liters),
    r.fuel_source,
  ]);
}
export function prepareHistory(
  p,
  choices,
  data,
  { today = todayStr(), allowNew = false } = {},
) {
  const writes = Object.fromEntries(HISTORY_STORES.map((s) => [s, []]));
  const groupIds = new Map();
  const findings = [],
    newCards = [],
    sourceSeen = new Set(),
    workSeen = new Set(),
    fuelSeen = new Set();
  for (const s of ["work_records", "fuel_records"])
    for (const r of data[s] || []) {
      // Deleted imported rows remain tombstones: importing again must not resurrect them.
      if (r.history_source?.row_id && r.history_source?.original_row)
        sourceSeen.add(r.history_source.row_id);
      if (isActive(r))
        (s === "work_records" ? workSeen : fuelSeen).add(
          s === "work_records" ? historyWorkKey(r) : historyFuelKey(r),
        );
    }
  const registry = Object.fromEntries(
    [
      "customers",
      "sites",
      "vehicles",
      "personnel",
      "dump_sites",
      "quarries",
    ].map((s) => [s, (data[s] || []).filter((r) => isActive(r)).slice()]),
  );
  function resolve(store, label, choice, field, extra = {}) {
    const value = text(label),
      selected = choice.refs?.[field];
    if (!value && !selected) return null;
    const scope = registry[store].filter(
      (r) => store !== "sites" || r.customer_id === extra.customer_id,
    );
    if (selected && selected !== "new") {
      const found = scope.find((r) => r.id === selected);
      if (!found)
        throw Error("Seçilen kart bulunamadı veya sahibi yanlış: " + field);
      return found.id;
    }
    const found = scope.filter((r) => key(r.name) === key(value));
    if (found.length > 1)
      throw Error("Aynı adlı birden fazla kart var; kartı seçin: " + value);
    if (found.length) return found[0].id;
    if (!value) throw Error("Yeni kart adı boş olamaz.");
    if (!allowNew)
      throw Error("Eksik kart için yeni kart onayı gerekli: " + value);
    const r = newRecord({ name: value, ...extra, active: true });
    registry[store].push(r);
    writes[store].push(r);
    newCards.push({ store, id: r.id, name: r.name });
    return r.id;
  }
  for (const [i, original] of p.rows.entries()) {
    const c = choices[i] || {},
      r = c.row || original;
    const f = {
      index: i,
      selected: !!c.include,
      errors: [],
      warnings: [],
      duplicate: false,
    };
    findings.push(f);
    if (!c.include) continue;
    const src = original.row_id;
    if (sourceSeen.has(src)) {
      f.duplicate = true;
      f.errors.push("Bu kaynak satırı daha önce aktarıldı.");
      continue;
    }
    try {
      if (r.kind !== original.kind || r.row_id !== original.row_id)
        throw Error("Kaynak satır türü veya numarası değiştirilemez.");
      if (
        original.transport_group_key &&
        (r.transport_group_key !== original.transport_group_key ||
          r.transport_total !== original.transport_total)
      )
        throw Error("Döküm grubu ve kaynak toplamı değiştirilemez.");
      if (!validHistoryDate(r.date, today))
        throw Error(
          "Gerçek geçmiş tarih gerekli; gelecekteki veya geçersiz tarih kabul edilmez.",
        );
      if (r.settlement_status !== "unbilled_unpaid")
        throw Error("Ödenmiş/hakedişe alınmış iş bu ekrandan aktarılmaz.");
      const vehicle_id = resolve("vehicles", r.vehicle, c, "vehicle_id", {
        type: r.vehicle_type || "Diğer",
      });
      if (!vehicle_id) throw Error("Araç/makine seçin.");
      const personnel_id = resolve("personnel", r.personnel, c, "personnel_id");
      const fields = {
        date: r.date,
        vehicle_id,
        personnel_id,
        description: text(r.description),
        raw_message: text(original.raw_message),
        history_source: {
          row_id: original.row_id,
          original_row: original,
          imported_at: new Date().toISOString(),
          settlement_status: "unbilled_unpaid",
        },
      };
      if (r.kind === "work") {
        const customer_id = resolve("customers", r.customer, c, "customer_id");
        if (!customer_id) throw Error("Müşteri gerekli.");
        const site_id = resolve("sites", r.site, c, "site_id", { customer_id });
        if (!WORK_TYPES.includes(r.work_type) || !WORK_UNITS.includes(r.unit))
          throw Error("Geçerli iş türü ve birim seçin.");
        const qty = Number(r.quantity);
        if (
          !Number.isFinite(qty) ||
          qty <= 0 ||
          (r.unit === "Sefer" && !Number.isInteger(qty))
        )
          throw Error("Pozitif miktar gerekli; sefer tam sayı olmalı.");
        if (
          (text(r.dump_site) || c.refs?.dump_site_id) &&
          !FIELD_METADATA.dump_area.applies_to.includes(r.work_type)
        )
          throw Error("Bu iş türünde döküm sahası kullanılmaz.");
        if (
          (text(r.quarry) || c.refs?.quarry_id) &&
          !FIELD_METADATA.quarry.applies_to.includes(r.work_type)
        )
          throw Error("Bu iş türünde malzeme ocağı kullanılmaz.");
        const dump_site_id = resolve(
            "dump_sites",
            r.dump_site,
            c,
            "dump_site_id",
          ),
          quarry_id = resolve("quarries", r.quarry, c, "quarry_id");
        if (
          r.transport_group_key &&
          (typeof r.transport_group_key !== "string" ||
            r.transport_group_key !== r.row_id.replace(/-\d+$/, "") ||
            !r.transport_group_key.startsWith("inbox-") ||
            r.unit !== "Sefer" ||
            !Number.isInteger(r.transport_total) ||
            r.transport_total <= 0)
        )
          throw Error("Döküm grubu kaynağı veya toplamı geçersiz.");
        const w = {
          ...fields,
          customer_id,
          site_id,
          work_type: r.work_type,
          quantity: qty,
          unit: r.unit,
          material: text(r.material),
          dump_site_id,
          quarry_id,
          dump_area:
            registry.dump_sites.find((d) => d.id === dump_site_id)?.name || "",
          quarry: registry.quarries.find((d) => d.id === quarry_id)?.name || "",
          slip_status: "Fiş Yok",
          price_snapshot: null,
        };
        if (r.transport_group_key) {
          if (!groupIds.has(r.transport_group_key))
            groupIds.set(r.transport_group_key, newRecord().id);
          w.transport_group_id = groupIds.get(r.transport_group_key);
        }
        if (r.unit_price != null && r.unit_price !== "") {
          if (
            !Number.isFinite(Number(r.unit_price)) ||
            Number(r.unit_price) < 0
          )
            throw Error("Fiyat geçersiz.");
          if (
            r.kdv_rate == null ||
            r.kdv_rate === "" ||
            !Number.isFinite(Number(r.kdv_rate)) ||
            Number(r.kdv_rate) < 0 ||
            Number(r.kdv_rate) > 100 ||
            typeof r.kdv_included !== "boolean"
          )
            throw Error(
              "Geçmiş fiyat için KDV oranı ve dahil/hariç bilgisi gerekli.",
            );
          const line = calcHakedisLine({
            quantity: qty,
            unit_price: Number(r.unit_price),
            kdv_rate: Number(r.kdv_rate),
            kdv_included: r.kdv_included,
          });
          w.price_snapshot = {
            unit_price: Number(r.unit_price),
            kdv_rate: Number(r.kdv_rate),
            kdv_included: r.kdv_included,
            amount: line.amount,
            kdv: line.kdv,
            total: line.total,
            price_source: "Manuel",
            price_scope: "Geçmiş iş aktarımı",
            snapshot_at: new Date().toISOString(),
            locked: false,
          };
        } else {
          if (!c.unpriced_confirmed)
            throw Error(
              "Fiyatı bilinmeyen iş için fiyat bekliyor onayını seçin.",
            );
          f.warnings.push("Fiyat bekliyor; bugünkü liste uygulanmadı.");
        }
        const signature = historyWorkKey(w);
        if (workSeen.has(signature)) {
          f.duplicate = true;
          throw Error("Aynı tarih, sahip ve miktarda iş var; olası mükerrer.");
        }
        workSeen.add(signature);
        writes.work_records.push(newRecord(w));
      } else {
        if (r.fuel_source !== "Depo Tankı")
          throw Error(
            "Bu sürümde geçmiş yakıt için yalnız Depo Tankı desteklenir.",
          );
        const liters = Number(r.liters);
        if (!Number.isFinite(liters) || liters <= 0)
          throw Error("Pozitif litre gerekli.");
        if (!c.tank_confirmed)
          throw Error(
            "Bu yakıtın mevcut stokta henüz düşülmediğini ve geçmiş tank başlangıcını doğrulayın.",
          );
        const fuel = newRecord({
          ...fields,
          liters,
          fuel_source: "Depo Tankı",
          receipt: "Hayır",
          customer_billable: false,
          event_id: newRecord().id,
        });
        const signature = historyFuelKey(fuel);
        if (fuelSeen.has(signature)) {
          f.duplicate = true;
          throw Error(
            "Aynı tarih, araç ve litreyle yakıt var; olası mükerrer.",
          );
        }
        fuelSeen.add(signature);
        const move = newRecord({
          ...fields,
          move_type: "ÇIKIŞ",
          liters,
          event_id: fuel.event_id,
          fuel_record_id: fuel.id,
        });
        fuel.tank_movement_id = move.id;
        writes.fuel_records.push(fuel);
        writes.fuel_tank_movements.push(move);
      }
      sourceSeen.add(src);
    } catch (e) {
      f.errors.push(e.message);
    }
  }
  if (writes.fuel_tank_movements.length) {
    const timeline = [
      ...(data.fuel_tank_movements || []).filter(isActive),
      ...writes.fuel_tank_movements,
    ].sort(
      (a, b) =>
        a.date.localeCompare(b.date) || (a.move_type === "GİRİŞ" ? -1 : 1),
    );
    let stock = 0,
      bad = false;
    for (const m of timeline) {
      if (
        !validHistoryDate(m.date, "9999-12-31") ||
        !Number.isFinite(Number(m.liters)) ||
        Number(m.liters) < 0
      ) {
        bad = true;
        break;
      }
      stock += (m.move_type === "GİRİŞ" ? 1 : -1) * Number(m.liters);
      if (stock < -0.000001) {
        bad = true;
        break;
      }
    }
    if (bad)
      for (const f of findings.filter(
        (f) => f.selected && p.rows[f.index].kind === "fuel",
      ))
        f.errors.push(
          "Tarih sıralı tank dengesi yetersiz. Eski yakıtı düşmeden önce gerçek geçmiş başlangıç/giriş kayıtlarını doğrulayın.",
        );
  }
  for (const group of new Set(
    p.rows.map((r) => r.transport_group_key).filter(Boolean),
  )) {
    const indexes = p.rows
        .map((r, i) => (r.transport_group_key === group ? i : -1))
        .filter((i) => i >= 0),
      selected = indexes.filter((i) => choices[i]?.include);
    if (!selected.length) continue;
    const sum = selected.reduce(
        (n, i) => n + Number(choices[i]?.row?.quantity || 0),
        0,
      ),
      total = p.rows[indexes[0]].transport_total;
    const owners = writes.work_records.filter(
      (w) => w.transport_group_id === groupIds.get(group),
    );
    if (
      selected.length !== indexes.length ||
      sum !== total ||
      new Set(
        owners.map((w) =>
          JSON.stringify([w.customer_id, w.site_id, w.date, w.work_type]),
        ),
      ).size > 1
    )
      for (const i of selected)
        findings[i].errors.push(
          "Döküm dağılımı tüm satırlarıyla, aynı müşteri/iş ve toplam seferle uyumlu aktarılmalı.",
        );
  }
  const selected = findings.filter((f) => f.selected),
    errors = selected.flatMap((f) =>
      f.errors.map((e) => `Satır ${f.index + 1}: ${e}`),
    );
  return {
    writes,
    findings,
    newCards,
    errors,
    selected: selected.length,
    ready: selected.length > 0 && !errors.length,
  };
}
