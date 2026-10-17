import { analyzeMessage, ENGINE_VERSION } from "./message-engine.js";
// Local message assistance. Suggestions never create financial records.
import { normKey, WORK_TYPES, WORK_UNITS, resolvePrice } from "./core.js";
import { draftMessage, live, label, validPast } from "./solo-core.js";
export const MEMORY_TYPES = {
  vehicle: "vehicles",
  customer: "customers",
  site: "sites",
  personnel: "personnel",
};
export const ROW_FIELDS = [
  "kind",
  "date",
  "vehicle_id",
  "customer_id",
  "site_id",
  "personnel_id",
  "work_type",
  "quantity",
  "unit",
  "fuel_liters",
  "fuel_source",
  "unit_price",
  "kdv_rate",
  "kdv_included",
  "description",
  "include",
  "duplicate_checked",
  "dump_site_id",
  "inference_confirmed",
  "transport_group_key",
  "transport_total",
];
const hasNumber = (v) => v !== null && v !== undefined && v !== "";
const compact = (v) => normKey(v || "").replace(/[^a-z0-9çğıöşü]/g, "");
export function composeFragments(text) {
  const lines = String(text || "")
      .split(/\n+/)
      .map((x) => x.trim())
      .filter(Boolean),
    out = [];
  for (const line of lines) {
    // Only short quantity/price/VAT continuations. Never infer sender's machine.
    const fragment =
      /^(?:\d+(?:[.,]\d+)?\s*(?:saat|sefer|yevmiye|ton|m3|m³|adet)\s*[.!]?|(?:saat|sefer|birim)\s*(?:ücreti|ucreti|fiyatı|fiyati|i)?\s*[:=]?\s*[\d.,]+(?:\s*(?:tl|₺))?(?:\s*[,;]?\s*kdv\s*(?:hariç|haric|dahil))?\s*[.!]?|kdv\s*(?:hariç|haric|dahil)\s*[.!]?)$/i.test(
        line,
      );
    if (fragment && out.length) out[out.length - 1] += " " + line;
    else out.push(line);
  }
  return out.join("\n");
}
export function explicitPrice(text) {
  const match = String(text || "").match(
    /(?:saat\s*(?:ücreti|ucreti|fiyatı|fiyati)|sefer(?:i|\s*(?:ücreti|ucreti|fiyatı|fiyati))|birim\s*(?:fiyatı|fiyati))\s*[:=]?\s*(\d+(?:[.,]\d+)*)/i,
  );
  if (!match) return null;
  let v = match[1];
  if (v.includes(",")) v = v.replace(/\./g, "").replace(",", ".");
  else if (/^\d{1,3}(?:\.\d{3})+$/.test(v)) v = v.replace(/\./g, "");
  const price = Number(v);
  if (!Number.isFinite(price) || price < 0 || price > 1e9) return null;
  const included = /kdv\s*dahil/i.test(text)
    ? true
    : /kdv\s*(?:hariç|haric)/i.test(text)
      ? false
      : null;
  const tax = String(text).match(
    /(?:kdv\s*(?:oranı|orani)?\s*[:=]?\s*%\s*(\d+(?:[.,]\d+)?)|%\s*(\d+(?:[.,]\d+)?)\s*kdv)/i,
  );
  const rate = tax ? Number((tax[1] || tax[2]).replace(",", ".")) : null;
  return {
    unit_price: price,
    kdv_included: included,
    kdv_rate: rate >= 0 && rate <= 100 ? rate : null,
    evidence: match[0],
    price_unit: /^saat/i.test(match[0])
      ? "Saat"
      : /^sefer/i.test(match[0])
        ? "Sefer"
        : null,
  };
}
export function assistedRows(m, d) {
  if (Array.isArray(m.review_rows))
    return m.review_rows.map((r) => ({
      ...r,
      source_message_id: m.id,
      notes: [...(r.notes || [])],
      field_sources: { ...(r.field_sources || {}) },
    }));
  const posted =
    m.id &&
    [...(d.work_records || []), ...(d.fuel_records || [])].some((w) =>
      w.history_source?.row_id?.startsWith("inbox-" + m.id + "-"),
    );
  if (!posted) return analyzeMessage(m, d).rows;
  return draftMessage({ ...m, text: composeFragments(m.text) }, d).map(
    (r, i) => {
      let price = r.kind === "work" ? explicitPrice(r.description) : null;
      if (price?.price_unit && price.price_unit !== r.unit) {
        r.notes.push(
          "Mesajdaki fiyat birimi işin birimiyle uyuşmuyor; fiyatı doğrulayın",
        );
        price = null;
      }
      const text = normKey(r.description),
        explicitPeople = live(d, "aliases").filter(
          (a) =>
            a.active !== false &&
            a.target_type === "personnel" &&
            normKey(a.alias).length >= 3 &&
            text.includes(normKey(a.alias)),
        );
      if (
        !r.personnel_id &&
        explicitPeople.length === 1 &&
        live(d, "personnel").some((p) => p.id === explicitPeople[0].target_id)
      )
        r.personnel_id = explicitPeople[0].target_id;
      return {
        ...r,
        source_message_id: m.id,
        source_row: i,
        include: true,
        duplicate_checked: false,
        fuel_source: null,
        unit_price: price?.unit_price ?? null,
        kdv_rate: price?.kdv_rate ?? null,
        kdv_included: price?.kdv_included ?? null,
        field_sources: price
          ? {
              unit_price: price.evidence,
              kdv_rate:
                price.kdv_rate === null
                  ? "Oran belirtilmedi"
                  : "Mesajda belirtilen oran",
              kdv_included:
                price.kdv_included === null
                  ? "Dahil/hariç belirtilmedi"
                  : "Mesajda belirtilen KDV durumu",
            }
          : {},
      };
    },
  );
}
export function rowQuestions(r, d) {
  const q = [];
  const add = (field, text) => q.push({ field, text });
  if (r.inference_confirmed === false)
    add("quantity", "Sefer veya çalışma süresi önerisini doğrulayın.");
  if (
    (r.notes || []).some((n) => n.includes("tarihler çelişiyor")) &&
    !String(r.field_sources?.date || "").startsWith("Kullanıcı")
  )
    add("date", "Metindeki tarihler çelişiyor; gerçek tarihi seçin.");
  for (const [field, store, type] of [
    ["vehicle_id", "vehicles", "vehicle"],
    ["customer_id", "customers", "customer"],
    ["site_id", "sites", "site"],
    ["personnel_id", "personnel", "personnel"],
  ]) {
    if (String(r.field_sources?.[field] || "").startsWith("Kullanıcı"))
      continue;
    const text = normKey(r.description),
      ids = new Set(
        live(d, store)
          .filter(
            (x) =>
              normKey(x.name).length >= 3 && text.includes(normKey(x.name)),
          )
          .map((x) => x.id),
      );
    for (const a of live(d, "aliases"))
      if (
        a.active !== false &&
        a.target_type === type &&
        normKey(a.alias).length >= 3 &&
        text.includes(normKey(a.alias)) &&
        live(d, store).some((x) => x.id === a.target_id)
      )
        ids.add(a.target_id);
    if (ids.size > 1)
      add(
        field,
        "Birden fazla kart eşleşiyor; " +
          {
            vehicle_id: "araç",
            customer_id: "müşteri",
            site_id: "şantiye",
            personnel_id: "personel",
          }[field] +
          " seçimini doğrulayın.",
      );
  }

  try {
    validPast(r.date);
  } catch {
    add("date", "Bu işin gerçek tarihi nedir?");
  }
  if (!live(d, "vehicles").some((x) => x.id === r.vehicle_id))
    add("vehicle_id", "Hangi araç veya makine çalıştı?");
  if (r.kind === "work") {
    if (!live(d, "customers").some((x) => x.id === r.customer_id))
      add("customer_id", "İş hangi müşteri için yapıldı?");
    if (!WORK_TYPES.includes(r.work_type))
      add("work_type", "Yapılan işin türü nedir?");
    if (!WORK_UNITS.includes(r.unit)) add("unit", "Miktarın birimi nedir?");
    if (
      !hasNumber(r.quantity) ||
      !(Number(r.quantity) > 0) ||
      (r.unit === "Sefer" && !Number.isInteger(Number(r.quantity)))
    )
      add(
        "quantity",
        "Kaç " + (r.unit || "birim") + " iş yapıldı? Sefer tam sayı olmalı.",
      );
    if (!hasNumber(r.unit_price))
      add(
        "unit_price",
        "O tarihteki birim fiyat biliniyor mu? Bilinmiyorsa bekletilebilir.",
      );
    else {
      if (!hasNumber(r.kdv_rate))
        add("kdv_rate", "Bu fiyatın KDV oranı nedir?");
      if (typeof r.kdv_included !== "boolean")
        add("kdv_included", "Fiyat KDV dahil mi, hariç mi?");
    }
    if (r.customer_id && !r.site_id) {
      const own = live(d, "sites").filter(
        (x) => x.customer_id === r.customer_id && x.active !== false,
      );
      if (own.length > 1)
        add("site_id", "Bu müşterinin birden fazla aktif şantiyesi var; hangisi?");
    }
    const site = live(d, "sites").find((x) => x.id === r.site_id);
    if (r.site_id && (!site || site.customer_id !== r.customer_id))
      add("site_id", "Şantiye seçilen müşteriye ait mi?");
  } else {
    if (!hasNumber(r.fuel_liters) || !(Number(r.fuel_liters) > 0))
      add("fuel_liters", "Kaç litre yakıt alındı?");
    if (!r.fuel_source)
      add("fuel_source", "Yakıt depodaki tanktan mı, istasyondan mı alındı?");
    if (r.fuel_source && r.fuel_source !== "Depo Tankı")
      add(
        "fuel_source",
        "İstasyon yakıtı bu geçmiş tank aktarımına dahil edilmez; Yakıt modülünden kaydedin.",
      );
  }
  return q;
}
export function similarRecords(row, d, limit = 5) {
  if (!row.date || !row.vehicle_id) return [];
  const store = row.kind === "fuel" ? "fuel_records" : "work_records";
  const out = [];
  for (const w of live(d, store)) {
    if (
      row.source_message_id &&
      w.history_source?.row_id ===
        "inbox-" + row.source_message_id + "-" + row.source_row
    )
      continue;
    const days =
      Math.abs(
        Date.parse(row.date + "T12:00:00Z") - Date.parse(w.date + "T12:00:00Z"),
      ) / 864e5;
    if (!Number.isFinite(days) || days > 1 || w.vehicle_id !== row.vehicle_id)
      continue;
    if (
      row.kind === "work" &&
      (!row.customer_id ||
        w.customer_id !== row.customer_id ||
        w.unit !== row.unit ||
        w.work_type !== row.work_type)
    )
      continue;
    const exactDate = w.date === row.date,
      exactQuantity =
        Number(row.kind === "fuel" ? row.fuel_liters : row.quantity) ===
        Number(row.kind === "fuel" ? w.liters : w.quantity);
    out.push({
      id: w.id,
      store,
      record: w,
      exact:
        exactDate &&
        exactQuantity &&
        (row.kind === "fuel"
          ? w.fuel_source === row.fuel_source
          : (w.site_id || "") === (row.site_id || "")),
      reasons: [
        exactDate ? "Aynı tarih" : "Bir gün yakın tarih",
        "Aynı araç",
        ...(row.kind === "work" ? ["Aynı müşteri, iş ve birim"] : []),
        ...(exactQuantity ? ["Aynı miktar"] : []),
      ],
    });
  }
  return out
    .sort(
      (a, b) => Number(b.exact) - Number(a.exact) || a.id.localeCompare(b.id),
    )
    .slice(0, limit);
}
export function datedPriceSuggestion(row, d) {
  if (
    row.kind !== "work" ||
    !row.date ||
    !row.customer_id ||
    !row.vehicle_id ||
    !row.unit ||
    !row.work_type
  )
    return null;
  const vehicle = live(d, "vehicles").find((v) => v.id === row.vehicle_id);
  // An undated current price is not evidence of the price on a historical date.
  const entries = live(d, "price_book").filter(
    (e) =>
      e.valid_from &&
      e.valid_from <= row.date &&
      /^\d{4}-\d{2}-\d{2}$/.test(e.valid_from),
  );
  const p = resolvePrice(entries, { ...row, vehicle_type: vehicle?.type });
  return p && !p.formula && p.price != null && Number.isFinite(Number(p.price))
    ? { ...p, unit_price: Number(p.price) }
    : null;
}
export function mergeEligibility(rows, d) {
  if (!Array.isArray(rows) || rows.length < 2 || rows.length > 10)
    throw Error("Birleştirmek için 2–10 mesaj seçin");
  if (rows.reduce((n, m) => n + String(m.raw || "").length, 0) > 19000)
    throw Error("Birleşik kaynak metni çok uzun; daha küçük gruplar seçin");
  if (new Set(rows.map((x) => x.id)).size !== rows.length)
    throw Error("Aynı mesaj iki kez seçilemez");
  const first = rows[0];
  if (!first.date || !first.sender)
    throw Error("Birleştirmede gerçek tarih ve gönderen gerekli");
  for (const r of rows) {
    if (r.date !== first.date || compact(r.sender) !== compact(first.sender))
      throw Error(
        "Yalnız aynı tarih ve gönderenin mesajları birleştirilebilir",
      );
    if (
      r.status !== "Taslak" ||
      r.merge_parent_id ||
      r.source_messages?.length ||
      r.review_rows?.length
    )
      throw Error(
        "Yalnız aktarılmamış ve düzenlenmemiş tekil taslaklar birleştirilebilir",
      );
    if (
      [...(d.work_records || []), ...(d.fuel_records || [])].some((w) =>
        w.history_source?.row_id?.startsWith("inbox-" + r.id + "-"),
      )
    )
      throw Error("Aktarılmış kaynak birleştirilemez");
  }
  return rows
    .slice()
    .sort(
      (a, b) =>
        String(a.time || "").localeCompare(String(b.time || "")) ||
        String(a.created_at || "").localeCompare(String(b.created_at || "")) ||
        a.id.localeCompare(b.id),
    );
}
export function mergeSuggestions(message, d) {
  if (
    message.status !== "Taslak" ||
    message.review_rows?.length ||
    message.source_messages?.length ||
    !message.sender ||
    !message.date
  )
    return [];
  const minutes = (t) =>
    /^\d{1,2}:\d{2}$/.test(t || "")
      ? Number(t.split(":")[0]) * 60 + Number(t.split(":")[1])
      : null;
  const at = minutes(message.time);
  if (at === null) return [];
  return live(d, "inbox_messages")
    .filter((x) => {
      const tm = minutes(x.time);
      if (x.id === message.id || tm === null || Math.abs(at - tm) > 30)
        return false;
      try {
        mergeEligibility([message, x], d);
      } catch {
        return false;
      }
      return (
        composeFragments("Başlık\n" + x.text).startsWith("Başlık ") ||
        composeFragments("Başlık\n" + message.text).startsWith("Başlık ")
      );
    })
    .slice(0, 8);
}
export function validateReviewRows(rows, d) {
  if (!Array.isArray(rows) || !rows.length || rows.length > 1000)
    throw Error("1–1000 taslak satırı gerekli");
  const indexes = new Set();
  return rows.map((r) => {
    if (
      !Number.isInteger(r.source_row) ||
      r.source_row < 0 ||
      indexes.has(r.source_row) ||
      !["work", "fuel"].includes(r.kind)
    )
      throw Error("Tekil kaynak satırı veya tür geçersiz");
    indexes.add(r.source_row);
    if (r.date) validPast(r.date);
    if (
      r.transport_group_key &&
      (r.unit !== "Sefer" ||
        typeof r.transport_group_key !== "string" ||
        !r.transport_group_key.startsWith("inbox-") ||
        !Number.isInteger(r.transport_total) ||
        r.transport_total <= 0)
    )
      throw Error("Döküm grubu/total geçersiz");
    const cleaned = Object.fromEntries(
      ROW_FIELDS.filter((k) => Object.hasOwn(r, k)).map((k) => [k, r[k]]),
    );
    for (const [k, store] of [
      ["vehicle_id", "vehicles"],
      ["customer_id", "customers"],
      ["site_id", "sites"],
      ["personnel_id", "personnel"],
      ["dump_site_id", "dump_sites"],
    ])
      if (cleaned[k] && !live(d, store).some((x) => x.id === cleaned[k]))
        throw Error("Seçilen kart bulunamadı: " + k);
    if (
      r.site_id &&
      live(d, "sites").find((x) => x.id === r.site_id)?.customer_id !==
        r.customer_id
    )
      throw Error("Şantiye müşterisi uyuşmuyor");
    for (const k of ["quantity", "fuel_liters", "unit_price", "kdv_rate"]) {
      if (!hasNumber(cleaned[k])) cleaned[k] = null;
      else {
        const n = Number(cleaned[k]);
        if (
          !Number.isFinite(n) ||
          n < 0 ||
          n > 1e9 ||
          (["quantity", "fuel_liters"].includes(k) && n === 0) ||
          (k === "kdv_rate" && n > 100)
        )
          throw Error("Geçersiz değer: " + k);
        cleaned[k] = n;
      }
    }
    if (
      r.unit === "Sefer" &&
      hasNumber(r.quantity) &&
      !Number.isInteger(Number(r.quantity))
    )
      throw Error("Sefer tam sayı olmalı");
    if (r.work_type && !WORK_TYPES.includes(r.work_type))
      throw Error("İş türü geçersiz");
    if (r.unit && !WORK_UNITS.includes(r.unit)) throw Error("Birim geçersiz");
    if (r.fuel_source && !["Depo Tankı", "İstasyon"].includes(r.fuel_source))
      throw Error("Yakıt kaynağı geçersiz");
    if (r.kdv_included != null && typeof r.kdv_included !== "boolean")
      throw Error("KDV dahil/hariç geçersiz");
    if (typeof r.description !== "string" || r.description.length > 20000)
      throw Error("Açıklama geçersiz");
    return {
      ...cleaned,
      source_row: r.source_row,
      evidence: r.evidence && typeof r.evidence === "object" ? r.evidence : {},
      candidates:
        r.candidates && typeof r.candidates === "object" ? r.candidates : {},
      engine_version: r.engine_version || null,
      duration: r.duration || null,
      inference_confirmed: r.inference_confirmed !== false,
      include: r.include !== false,
      duplicate_checked: r.duplicate_checked === true,
      field_sources: Object.fromEntries(
        Object.entries(
          r.field_sources && typeof r.field_sources === "object"
            ? r.field_sources
            : {},
        ).filter(
          ([k, v]) =>
            ROW_FIELDS.includes(k) && typeof v === "string" && v.length <= 400,
        ),
      ),
      notes: Array.isArray(r.notes)
        ? r.notes.filter((x) => typeof x === "string").slice(0, 30)
        : [],
    };
  });
}
export function memoryFields(f, d) {
  const store = MEMORY_TYPES[f.target_type];
  if (!store) throw Error("Eşleştirme türü geçersiz");
  if (!live(d, store).some((x) => x.id === f.target_id))
    throw Error("Eşleştirme kartı bulunamadı");
  const alias = String(f.alias || "").trim();
  if (
    alias.length < 3 ||
    alias.length > 100 ||
    /^\d+$/.test(alias) ||
    !compact(alias)
  )
    throw Error("Takma ad 3–100 karakter olmalı ve yalnız sayı olmamalı");
  if (f.confirmed !== true) throw Error("Hafıza için açık onay gerekli");
  return {
    alias,
    target_type: f.target_type,
    target_id: f.target_id,
    active: true,
    confirmed_at: new Date().toISOString(),
    origin: "message_review",
  };
}
export function validateSmartData(d) {
  for (const m of live(d, "inbox_messages")) {
    if (m.review_rows) validateReviewRows(m.review_rows, d);
    if (m.merge_parent_id) {
      const p = live(d, "inbox_messages").find(
        (x) => x.id === m.merge_parent_id,
      );
      if (
        !p?.source_messages?.some((x) => x.id === m.id) ||
        m.status !== "Birleştirildi"
      )
        throw Error("Mesaj birleştirme bağı kopuk");
    }
    if (m.source_messages) {
      const seen = new Set();
      for (const src of m.source_messages) {
        const original = live(d, "inbox_messages").find((x) => x.id === src.id);
        if (
          !original ||
          seen.has(src.id) ||
          src.raw !== original.raw ||
          src.source_key !== original.source_key ||
          src.date !== original.date ||
          src.sender !== original.sender ||
          src.time !== original.time ||
          (src.id !== m.id &&
            (original.merge_parent_id !== m.id || src.text !== original.text))
        )
          throw Error("Birleştirme kaynak kanıtı tutarsız");
        seen.add(src.id);
      }
      if (
        !seen.has(m.id) ||
        seen.size < 2 ||
        seen.size > 10 ||
        m.text !== m.source_messages.map((x) => x.text).join("\n")
      )
        throw Error("Birleştirme ana kaynağı eksik veya metin tutarsız");
    }
  }
}
