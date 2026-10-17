import {
  isActive,
  todayStr,
  addDays,
  resolvePrice,
  priceForQuantity,
  priceVehicleScope,
  newRecord,
  toKurus,
  fromKurus,
  DOC_FAMILY,
} from "./core.js";
export const VEHICLE_DOCS = [
  "Ruhsat",
  "TÜVTÜRK / Periyodik Muayene",
  "Muayene Belgesi",
  "Zorunlu Trafik Sigortası",
  "Sigorta / Poliçe",
  "Kasko",
  "Egzoz Muayenesi",
  "Takograf / Kalibrasyon",
  "Yetki / Taşıma Belgesi",
  "Makine Tescil Belgesi",
  "Periyodik Kontrol",
  "Ekspertiz",
];
export const PERSONNEL_DOCS = [
  "Ehliyet",
  "SRC",
  "Psikoteknik",
  "Operatör Belgesi",
  "Mesleki Yeterlilik",
  "İSG Eğitimi",
  "Sağlık Raporu",
  "SGK / İşe Giriş Evrakı",
  "Kimlik / Kimlik Bilgisi",
  "Sertifika",
  "Personel Evrakı",
];
// Şirkete ait evrak (sahibi: şirket bilgileri kaydı)
export const COMPANY_DOCS = [
  "Vergi Levhası",
  "Faaliyet Belgesi",
  "Ticaret Sicil Gazetesi",
  "İmza Sirküleri",
  "Oda Kayıt Belgesi",
  "SGK İşyeri Tescili",
  "K Belgesi",
  "İSG / Risk Değerlendirmesi",
  "Şirket Sigortası",
  "Şirket Evrakı",
];
export const COMPANY_OWNER_ID = "company_profile";
export const DOCUMENT_TYPES = [
  ...VEHICLE_DOCS,
  ...PERSONNEL_DOCS,
  ...COMPANY_DOCS,
  "Sözleşme",
  "Hakediş Eki",
  "Akaryakıt Fişi",
  "Gider Fişi",
  "Dijital İş Fişi",
  "Döküm Fişi",
  "Servis Belgesi",
  "İrsaliye",
  "Makbuz",
  "Fatura",
  "Döküm Faturası",
  "İzin Formu",
  "Diğer",
];
export const OWNER_STORES = {
  vehicle: "vehicles",
  personnel: "personnel",
  customer: "customers",
  fuel: "fuel_records",
  expense: "expense_records",
  hakedis: "hakedis",
  work: "work_records",
  contract: "contracts",
  company: "meta",
  dump_site: "dump_sites",
};
export function documentOwner(category) {
  if (COMPANY_DOCS.includes(category)) return "company";
  return VEHICLE_DOCS.includes(category)
    ? "vehicle"
    : PERSONNEL_DOCS.includes(category)
      ? "personnel"
      : category === "Sözleşme"
        ? "customer"
        : category === "Akaryakıt Fişi"
          ? "fuel"
          : category === "Gider Fişi"
            ? "expense"
            : category === "Hakediş Eki"
              ? "hakedis"
              : category === "Servis Belgesi"
                ? "vehicle"
                : category === "Dijital İş Fişi" || category === "Döküm Fişi"
                  ? "work"
                  : null;
}
export const FIELD_METADATA = {
  vehicle_id: {
    applies_to: ["vehicle", "fuel", "work"],
    required_when: ["vehicle"],
    hidden_when: ["personnel", "customer", "hakedis", "expense", "contract"],
    entity_owner: "vehicle",
  },
  personnel_id: {
    applies_to: ["personnel"],
    required_when: ["personnel"],
    hidden_when: [
      "vehicle",
      "customer",
      "fuel",
      "work",
      "hakedis",
      "expense",
      "contract",
    ],
    entity_owner: "personnel",
  },
  customer_id: {
    applies_to: ["customer"],
    required_when: ["customer"],
    hidden_when: [
      "vehicle",
      "personnel",
      "fuel",
      "work",
      "hakedis",
      "expense",
      "contract",
    ],
    entity_owner: "customer",
  },
  site_id: {
    applies_to: ["customer"],
    required_when: [],
    hidden_when: [
      "vehicle",
      "personnel",
      "fuel",
      "work",
      "hakedis",
      "expense",
      "contract",
    ],
    entity_owner: "customer",
  },
  owner_id: {
    applies_to: ["fuel", "expense", "hakedis", "work", "contract"],
    required_when: ["fuel", "expense", "hakedis", "work", "contract"],
    hidden_when: ["vehicle", "personnel", "customer"],
    entity_owner: "selected",
  },
  dump_area: {
    // malzeme nakliyesinde (mıcır/kum/gravak) teslim / dolgu yeri olarak kullanılır
    applies_to: ["Hafriyat Nakliye", "Moloz Nakliye", "Çöp Nakliye", "Mıcır Nakliye", "Kum Nakliye", "Gravak Nakliye"],
    required_when: [],
    hidden_when: ["Makine Çalışması"],
    entity_owner: "work",
  },
  quarry: {
    applies_to: ["Mıcır Nakliye", "Kum Nakliye", "Gravak Nakliye"],
    required_when: [],
    hidden_when: ["Makine Çalışması"],
    entity_owner: "work",
  },
};
export function normalizedDocument(fields) {
  const owner = documentOwner(fields.category) || fields.owner_type;
  if (!OWNER_STORES[owner]) throw Error("Belgenin gerçek sahibini seçin");
  const id =
    owner === "vehicle"
      ? fields.vehicle_id
      : owner === "personnel"
        ? fields.personnel_id
        : owner === "customer"
          ? fields.customer_id
          : owner === "company"
            ? COMPANY_OWNER_ID
            : fields.owner_id;
  if (!id) throw Error("Belge sahibi zorunlu");
  const out = {
    ...fields,
    owner_type: owner,
    owner_id: id,
    vehicle_id: null,
    personnel_id: null,
    customer_id: null,
    site_id: null,
  };
  if (["vehicle", "personnel", "customer"].includes(owner))
    out[owner + "_id"] = id;
  if (owner === "customer") out.site_id = fields.site_id || null;
  if (!fields.date) throw Error("Belge tarihi zorunlu");
  if (fields.expiry_date && fields.expiry_date < fields.date)
    throw Error("Bitiş tarihi başlangıçtan önce olamaz");
  if (
    fields.reminder_date &&
    fields.expiry_date &&
    fields.reminder_date > fields.expiry_date
  )
    throw Error("Hatırlatma geçerlilik bitişinden sonra olamaz");
  if (
    [...VEHICLE_DOCS, ...PERSONNEL_DOCS].includes(fields.category) &&
    !fields.doc_no
  )
    throw Error("Belge numarası zorunlu");
  if (
    [...VEHICLE_DOCS, ...PERSONNEL_DOCS].includes(fields.category) &&
    !fields.expiry_date &&
    ![
      "Ruhsat",
      "Kimlik / Kimlik Bilgisi",
      "SGK / İşe Giriş Evrakı",
      "Makine Tescil Belgesi",
    ].includes(fields.category)
  )
    throw Error("Geçerlilik bitişi zorunlu");
  return out;
}
export function expiryState(d, today = todayStr()) {
  if (!d.expiry_date) return "Geçerli";
  if (d.expiry_date < today) return "Süresi Geçmiş";
  if (d.expiry_date <= addDays(today, 7)) return "7 Gün İçinde";
  if (d.expiry_date <= addDays(today, 30)) return "30 Gün İçinde";
  return "Geçerli";
}
export const CONTRACT_TEMPLATES = {
  "Hafriyat Hizmet Sözleşmesi":
    "Kazı ve hafriyat nakliye kapsamı, döküm yeri ve izin sorumlulukları taraflarca aşağıda belirlenir.",
  "Nakliye Sözleşmesi":
    "Yükleme, taşıma, teslim ve teslim fişi şartları aşağıda belirlenir.",
  "İş Makinesi Kiralama Sözleşmesi":
    "Makine, operatör, çalışma saati/yevmiye ve bekleme koşulları aşağıda belirlenir.",
  "Yıkım / Moloz Hizmet Sözleşmesi":
    "Yıkım kapsamı, saha güvenliği, moloz ayrıştırma ve nakliye koşulları aşağıda belirlenir.",
  "Genel Hizmet Sözleşmesi":
    "Hizmet kapsamı, taraf sorumlulukları ve ödeme koşulları aşağıda belirlenir.",
  "Boş / Özel Şablon": "",
};
export function contractFromQuote(q, no) {
  if (q.status !== "Kabul") throw Error("Önce teklifi kabul edin");
  const copied = structuredClone(q);
  for (const k of [
    "id",
    "created_at",
    "updated_at",
    "deleted_at",
    "source",
    "schema_version",
    "signed_at",
    "signature_attachment_id",
    "signature_ids",
    "signed_snapshot",
  ])
    delete copied[k];
  return newRecord({
    ...copied,
    quote_id: q.id,
    quote_no: q.quote_no,
    contract_no: no,
    date: todayStr(),
    status: "Taslak",
    template: "Genel Hizmet Sözleşmesi",
    pricing_method: q.type,
    source_quote: structuredClone(q),
    signed_at: null,
  });
}
export function priceSnapshot(w, entries, crane) {
  const p = resolvePrice(entries, w);
  if (!p) return null;
  return {
    unit_price: p.price ?? 0,
    kdv_rate: p.kdv_rate ?? 20,
    kdv_included: !!p.kdv_included,
    formula: p.formula || null,
    first_hour_price: p.first_hour_price ?? crane?.first ?? 0,
    next_hour_price: p.next_hour_price ?? crane?.next ?? 0,
    amount: priceForQuantity(p, w.quantity, crane),
    price_source: p.price_source,
    price_scope: priceVehicleScope(p),
    price_rule_id: p.id,
    snapshot_at: new Date().toISOString(),
  };
}
export function filterRecords(records, f = {}) {
  return records.filter(
    (r) =>
      isActive(r) &&
      (!f.from ||
        (r.date ||
          r.created_date ||
          r.date_from ||
          r.created_at?.slice(0, 10) ||
          "") >= f.from) &&
      (!f.to ||
        (r.date ||
          r.created_date ||
          r.date_to ||
          r.created_at?.slice(0, 10) ||
          "") <= f.to) &&
      [
        "customer_id",
        "site_id",
        "vehicle_id",
        "personnel_id",
        "work_type",
        "material",
        "unit",
        "ownership",
        "dump_area",
        "dump_site_id",
        "quarry_id",
        "quarry",
        "vehicle_group",
        "owner_type",
        "move_type",
        "contractor_id",
      ].every((k) => !f[k] || r[k] === f[k]) &&
      (!f.document_status || expiryState(r) === f.document_status),
  );
}
export function groupRecords(records, key) {
  const m = new Map();
  for (const r of records) {
    const k =
      key === "date"
        ? r.date || r.created_date || "Tarihsiz"
        : r[key] || "Belirtilmedi";
    if (!m.has(k))
      m.set(k, { key: k, count: 0, units: {}, amount_kurus: 0, liters: 0 });
    const g = m.get(k);
    g.count++;
    if (r.unit)
      g.units[r.unit] = (g.units[r.unit] || 0) + (Number(r.quantity) || 0);
    g.amount_kurus += toKurus(
      r.gross_total ??
        r.grand_total ??
        r.amount ??
        r.total ??
        r.price_snapshot?.amount ??
        0,
    );
    g.liters += Number(r.liters) || 0;
  }
  return [...m.values()].map((g) => ({
    ...g,
    amount: fromKurus(g.amount_kurus),
  }));
}
export function vehicleDocumentStatus(vehicle, documents, today = todayStr()) {
  const docs = documents.filter(
    (d) =>
      isActive(d) &&
      (d.vehicle_id === vehicle.id ||
        (d.owner_type === "vehicle" && d.owner_id === vehicle.id)),
  );
  const aliases = DOC_FAMILY;
  const truck =
    vehicle.type === "Kamyon" ||
    /^\d{2}\s*[A-Z]/i.test(vehicle.plate || vehicle.name || "");
  const required =
    vehicle.required_document_types ||
    (truck
      ? ["Ruhsat", "Muayene Belgesi", "Zorunlu Trafik Sigortası"]
      : ["Makine Tescil Belgesi", "Periyodik Kontrol"]);
  const validTypes = new Set(
    docs
      .filter((d) => expiryState(d, today) !== "Süresi Geçmiş")
      .map((d) => aliases[d.category] || d.category),
  );
  const missing = required.filter((t) => !validTypes.has(t));
  const latest = new Map();
  for (const d of docs) {
    const category = aliases[d.category] || d.category;
    if (
      !latest.has(category) ||
      String(d.expiry_date || "9999") >
        String(latest.get(category).expiry_date || "9999")
    )
      latest.set(category, d);
  }
  const current = [...latest.values()];
  const overdue = current.some(
      (d) => expiryState(d, today) === "Süresi Geçmiş",
    ),
    soon = current.some((d) =>
      ["7 Gün İçinde", "30 Gün İçinde"].includes(expiryState(d, today)),
    );
  return {
    status: overdue
      ? "SÜRESİ GEÇMİŞ"
      : missing.length
        ? "EKSİK"
        : soon
          ? "BELGE YAKLAŞIYOR"
          : "BELGELER TAM",
    missing,
    required,
  };
}

// Customer summaries deliberately omit dump locations and internal notes.
// Source records and hakediş items always remain separate.
export function customerWorkLines(items) {
  const groups = new Map();
  for (const [index, item] of items.entries()) {
    const price = item.unit_price ?? item.price_snapshot?.unit_price ?? null;
    const rate = item.kdv_rate ?? item.price_snapshot?.kdv_rate ?? 20;
    const included =
      item.kdv_included ?? item.price_snapshot?.kdv_included ?? false;
    const formula = item.formula ?? item.price_snapshot?.formula;
    const key = JSON.stringify([
      item.customer_id || "",
      item.date || "",
      item.site_id || item.site_name || "",
      item.work_type || item.work_text || "",
      item.material || "",
      item.unit,
      price,
      rate,
      included,
      item.unit === "Sefer" && !formula ? null : index,
    ]);
    const existing = groups.get(key);
    if (existing) {
      existing.quantity += Number(item.quantity);
      existing.total = fromKurus(
        toKurus(existing.total) +
          toKurus(
            item.total ??
              item.price_snapshot?.amount ??
              Number(price || 0) * Number(item.quantity),
          ),
      );
      if (existing.vehicle_name !== (item.vehicle_name || ""))
        existing.vehicle_name = "Birden çok araç";
    } else
      groups.set(key, {
        date: item.date,
        site_id: item.site_id || null,
        site_name: item.site_name || "",
        work_type: item.work_type || item.work_text || "",
        material: item.material || "",
        vehicle_name: item.vehicle_name || "",
        quantity: Number(item.quantity),
        unit: item.unit,
        unit_price: price,
        kdv_rate: rate,
        kdv_included: included,
        formula,
        total:
          item.total ??
          item.price_snapshot?.amount ??
          Number(price || 0) * Number(item.quantity),
      });
  }
  return [...groups.values()];
}
