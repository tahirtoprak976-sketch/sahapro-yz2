import {
  workFinancials,
  operatingResult,
  commercialReportRows,
} from "./enterprise-core.js";
import * as ui from "./ui.js";
import * as core from "./core.js";
import {
  DOCUMENT_TYPES,
  documentOwner,
  OWNER_STORES,
  normalizedDocument,
  expiryState,
  CONTRACT_TEMPLATES,
  priceSnapshot,
  filterRecords,
  groupRecords,
} from "./business.js";
import { exportDocument, buildDocument } from "./document-engine.js";
import {
  commercialSpec,
  COMMERCIAL_LABELS,
  slipSpec,
  hakedisSpec,
} from "./pdf.js";
const {
  qs,
  qsa,
  esc,
  appbar,
  li,
  kv,
  fText,
  fDate,
  fArea,
  fNum,
  fSelect,
  collectForm,
  pagedRender,
  toast,
  go,
  downloadBlob,
  confirmDialog,
} = ui;
export const STORES = {
  isler: "work_records",
  fisler: "slips",
  teklif: "quotes",
  sozlesmeler: "contracts",
  hakedis: "hakedis",
  cari: "cari_movements",
  kasa: "cash_records",
  tahsilat: "cash_records",
  gider: "expense_records",
  yakit: "fuel_records",
  depo: "fuel_tank_movements",
  filo: "vehicles",
  personel: "personnel",
  bakim: "maintenance_records",
  musteriler: "customers",
  santiyeler: "sites",
  taseron: "contractors",
  belgeler: "documents",
  fiyat: "price_book",
  dokum: "dump_sites",
  ocak: "quarries",
  izin: "personnel_events",
};
export const LABELS = {
  work_records: "İşler",
  slips: "Dijital Fişler",
  quotes: "Teklifler",
  contracts: "Sözleşmeler",
  hakedis: "Hakedişler",
  cari_movements: "Cari Ekstre",
  cash_records: "Tahsilat / Kasa",
  expense_records: "Giderler",
  fuel_records: "Yakıt",
  fuel_tank_movements: "Tank",
  vehicles: "Araçlar",
  personnel: "Personel",
  maintenance_records: "Bakım / Arıza",
  customers: "Müşteriler",
  sites: "Şantiyeler",
  contractors: "Taşeronlar",
  documents: "Belgeler",
  price_book: "Fiyat Listesi",
  dump_sites: "Döküm Sahaları",
  quarries: "Malzeme Ocakları",
  personnel_events: "Personel İzin / Çalışma",
};
const OWNER_LABELS = {
  vehicle: "Araç",
  personnel: "Personel",
  customer: "Müşteri",
  fuel: "Yakıt kaydı",
  expense: "Gider kaydı",
  hakedis: "Hakediş",
  work: "İş kaydı",
  contract: "Sözleşme",
  company: "Şirket",
  dump_site: "Döküm sahası",
};
const ROUTE = Object.fromEntries(
  Object.entries(STORES).map(([route, store]) => [store, route]),
);
export const FIELD_LABELS = {
  date: "Tarih",
  name: "Ad / Ünvan",
  type: "Tür",
  vehicle_type: "Araç / makine türü",
  vehicle_group: "Araç grubu",
  plate: "Plaka / Kod",
  tank_capacity: "Depo kapasitesi (litre)",
  brand: "Marka",
  model: "Model",
  model_year: "Model yılı",
  chassis_no: "Şasi no",
  identity_number: "TC kimlik no",
  tax_title: "Faturadaki ticari ünvan",
  tax_no: "VKN / TCKN",
  tax_office: "Vergi dairesi",
  kdv_withholding: "KDV tevkifatı (Yok, 2/10…)",
  birth_date: "Doğum tarihi",
  license_class: "Ehliyet sınıfı",
  blood_type: "Kan grubu",
  engine_no: "Motor no",
  color: "Renk",
  ownership: "Mülkiyet",
  fuel_type: "Yakıt tipi",
  role: "Görev",
  phone: "Telefon",
  contact: "Yetkili",
  email: "E-posta",
  employment_date: "İşe giriş",
  address: "Adres",
  location: "Konum",
  work_type: "İş türü",
  material: "Malzeme",
  quantity: "Miktar",
  unit: "Birim",
  dump_area: "Döküm sahası",
  quarry: "Malzeme ocağı",
  distance_km: "Mesafe (km)",
  customer_note: "Müşteri notu",
  internal_note: "İç not",
  description: "Açıklama",
  unit_price: "Birim fiyat",
  price: "Fiyat",
  price_source: "Fiyat kaynağı",
  price_scope: "Araç kapsamı",
  kdv_rate: "KDV %",
  liters: "Litre",
  total: "Tutar",
  amount: "Tutar",
  fuel_source: "Yakıt kaynağı",
  receipt: "Fiş",
  maint_type: "Bakım türü",
  status: "Durum",
  cost: "Maliyet",
  service_company: "Servis",
  part: "Parça",
  severity: "Önem",
  doc_no: "Belge no",
  category: "Belge / gider türü",
  expiry_date: "Geçerlilik bitişi",
  reminder_date: "Hatırlatma",
  institution: "Düzenleyen kurum",
  active: "Aktif",
  note: "Not",
  cash_type: "İşlem türü",
  cash_status: "Teslim durumu",
  payment_method: "Ödeme şekli",
  reimbursement_status: "Personele ödeme",
  quote_no: "Teklif no",
  contract_no: "Sözleşme no",
  hakedis_no: "Hakediş no",
  slip_no: "Fiş no",
  move_type: "Tank hareketi",
  event_type: "Personel işlemi",
  start_date: "Başlangıç",
  end_date: "Bitiş",
  grand_total: "Genel toplam",
  subtotal: "Ara toplam",
  kdv_total: "KDV",
  net_total: "KDV Hariç Tutar",
  tax_total: "KDV Tutarı",
  gross_total: "KDV Dahil Tutar",
  price_source: "Fiyat Kaynağı",
  time_start: "Başlangıç Saati",
  time_end: "Bitiş Saati",
  break_minutes: "Mola (dk)",
  ...COMMERCIAL_LABELS,
};
const PRIVATE = new Set([
  "internal_note",
  "cost",
  "margin",
  "profit",
  "employment_date",
  "phone",
  "email",
  "salary",
  "identity_number",
  "note",
  "dump_area",
  "quarry",
  "price_source",
]);
const REL = {
  customer_id: "customers",
  site_id: "sites",
  vehicle_id: "vehicles",
  personnel_id: "personnel",
  assignee_id: "personnel",
  contractor_id: "contractors",
  dump_site_id: "dump_sites",
  quarry_id: "quarries",
};
async function maps(db) {
  const names = {};
  await Promise.all(
    Object.keys(LABELS).map(
      async (s) =>
        (names[s] = Object.fromEntries(
          (await db.listActive(s)).map((r) => [
            r.id,
            r.name ||
              r.doc_no ||
              r.work_type ||
              r.contract_no ||
              r.quote_no ||
              r.hakedis_no ||
              r.date ||
              "Kayıt",
          ]),
        )),
    ),
  );
  names.meta = { company_profile: (await db.metaGet("company_profile"))?.title || core.COMPANY_NAME };
  return names;
}
function value(key, v, names) {
  if (REL[key]) return names[REL[key]]?.[v] || "—";
  if (v == null) return "—";
  if (typeof v === "boolean") return v ? "Evet" : "Hayır";
  if (
    [
      "price",
      "unit_price",
      "amount",
      "total",
      "cost",
      "grand_total",
      "subtotal",
      "kdv_total",
      "net_total",
      "tax_total",
      "gross_total",
    ].includes(key)
  )
    return core.fmtTL(v) + " TL";
  if (key === "vehicle_group") return core.PRICE_VEHICLE_GROUPS[v]?.label || v;
  return v ?? "";
}
export function recordSpec(store, r, names, audience = "internal") {
  const pairs = [];
  for (const [k, label] of Object.entries(FIELD_LABELS)) {
    if (!(k in r) || r[k] == null || r[k] === "") continue;
    if (audience === "customer" && PRIVATE.has(k)) continue;
    pairs.push([label, value(k, r[k], names)]);
  }
  for (const [k, s] of Object.entries(REL))
    if (r[k])
      pairs.push([
        {
          customer_id: "Müşteri",
          site_id: "Şantiye",
          vehicle_id: "Araç",
          personnel_id: "Personel",
          assignee_id: "Zimmetli personel",
          contractor_id: "Taşeron",
          dump_site_id: "Döküm",
          quarry_id: "Ocak",
        }[k],
        names[s]?.[r[k]] || "—",
      ]);
  if (r.price_snapshot)
    pairs.push(
      ["Fiyat kaynağı", r.price_snapshot.price_source],
      ["Birim fiyat", core.fmtTL(r.price_snapshot.unit_price) + " TL"],
      ["KDV", "%" + r.price_snapshot.kdv_rate],
      ["İş tutarı", core.fmtTL(r.price_snapshot.amount) + " TL"],
    );
  if (r.price_snapshot?.price_scope)
    pairs.push(["Fiyat araç kapsamı", r.price_snapshot.price_scope]);
  if (store === "documents")
    pairs.push(
      ["Belge sahibi", OWNER_LABELS[r.owner_type] || "Eski kayıt"],
      [
        "Sahip",
        names[OWNER_STORES[r.owner_type]]?.[r.owner_id] ||
          names.vehicles?.[r.vehicle_id] ||
          names.personnel?.[r.personnel_id] ||
          "—",
      ],
      ["Geçerlilik", expiryState(r)],
    );
  return {
    store,
    ...(store === "cash_records" && audience === "customer" ? { template: "receipt", signatures: ["Tahsil Eden", "Ödeme Yapan"] } : {}),
    ...(store === "maintenance_records" && /arıza/i.test(r.maint_type || "") ? { template: "fault" } : {}),
    ...(store === "documents" ? { template: r.owner_type === "vehicle" ? "vehicle_document" : r.owner_type === "personnel" ? "personnel_document" : "document" } : {}),
    title: LABELS[store] || "Belge",
    number:
      r.doc_no ||
      r.quote_no ||
      r.contract_no ||
      r.slip_no ||
      r.hakedis_no ||
      "",
    audience,
    filename:
      "SAHAPRO_" +
      store +
      "_" +
      String(r.doc_no || r.date || r.name || "Kayit").replace(
        /[^\p{L}\d_-]/gu,
        "_",
      ) +
      ".pdf",
    sections: [{ pairs }],
  };
}
function exportBar() {
  return '<div class="exportbar"><button class="btn sm" data-pro-pdf>PDF</button><button class="btn sm" data-pro-share>Paylaş</button><button class="btn sm" data-pro-print>Yazdır</button><button class="btn sm" data-pro-csv>CSV</button></div>';
}
function bindExports(root, getSpec, getCsv) {
  for (const [action, mode] of [
    ["pdf", "download"],
    ["share", "share"],
    ["print", "print"],
  ])
    qs("[data-pro-" + action + "]", root)?.addEventListener(
      "click",
      async () => {
        try {
          await exportDocument(await getSpec(), mode);
        } catch (e) {
          toast(e.message, "err");
        }
      },
    );
  qs("[data-pro-csv]", root)?.addEventListener("click", async () => {
    const s = await getCsv();
    downloadBlob(
      new Blob([core.toCSV(s.headers, s.rows)], {
        type: "text/csv;charset=utf-8",
      }),
      "SAHAPRO_Rapor.csv",
    );
  });
}
function recordCsv(r, names, audience) {
  const s = recordSpec("", r, names, audience);
  return { headers: ["Alan", "Değer"], rows: s.sections[0].pairs };
}
export async function screen(ctx) {
  const [route, id, action] = ctx.parts;
  if (route === "belgeler" || route === "tara") return documentScreen(ctx);
  if (route === "sozlesmeler") return contractScreen(ctx);
  if (route === "teklif-karsilastir") return compareQuotes(ctx);
  if (route === "raporlar") return reports(ctx);
  if (
    ["yakit", "gider", "kasa", "tahsilat", "fiyat"].includes(route) &&
    id &&
    id !== "new" &&
    action !== "edit"
  )
    return simpleDetail(ctx);
  if (
    ["filo", "personel", "taseron", "santiyeler"].includes(route) &&
    action === "edit"
  )
    return master(ctx);
  if (["dokum", "ocak"].includes(route)) return master(ctx);
  if (
    ["filo", "personel", "taseron", "santiyeler"].includes(route) &&
    id === "new"
  )
    return master(ctx);
  if (
    ["filo", "personel", "taseron", "santiyeler", "musteriler"].includes(
      route,
    ) &&
    id &&
    id !== "new" &&
    id !== "hareket" &&
    action !== "edit"
  )
    return card(ctx);
  return false;
}
async function documentScreen(ctx) {
  const { root, db, parts, query } = ctx;
  const names = await maps(db),
    id = parts[1];
  if (id === "new" || parts[0] === "tara") {
    root.innerHTML =
      appbar(
        parts[0] === "tara" ? "Belge Tara / OCR" : "Yeni Belge",
        "Belge gerçek sahibine bağlanır",
      ) +
      `<form data-form>${fSelect("Belge türü", "category", DOCUMENT_TYPES, query.category || "Muayene Belgesi", { empty: false })}${fSelect(
        "Belge sahibi türü",
        "owner_type",
        Object.entries(OWNER_LABELS).map(([v, t]) => ({ v, t })),
        query.owner_type || "vehicle",
        { empty: false },
      )}<div data-owner></div><div class="formgrid2">${fText("Belge No", "doc_no", "", { req: true })}${fText("Kurum", "institution", "")}</div><div class="formgrid2">${fDate("Belge tarihi", "date")}${fDate("Geçerlilik bitişi", "expiry_date", "", false)}</div>${fDate("Hatırlatma tarihi", "reminder_date", "", false)}${fNum("Tutar (opsiyonel)", "amount", "", { step: "any" })}${fArea("Açıklama", "description")}<div class="field"><label>Dosya / fotoğraf / PDF *</label><input name="attachment" type="file" accept="image/*,application/pdf" required></div><button type="button" class="btn" data-ocr>OCR Çalıştır</button><div data-ocr-status class="notice"></div></form><div class="actionbar"><button class="btn primary" data-save>Kaydet</button></div>`;
    let ocr = { status: "YOK" };
    const form = qs("[data-form]", root);
    async function owner() {
      const category = qs("[name=category]", form).value,
        type = documentOwner(category) || qs("[name=owner_type]", form).value;
      qs("[name=owner_type]", form).value = type;
      qs("[name=owner_type]", form).closest(".field").hidden =
        !!documentOwner(category);
      const store = OWNER_STORES[type],
        records = type === "company" ? [{ id: "company_profile", name: core.COMPANY_NAME }] : await db.listActive(store),
        key =
          type === "vehicle"
            ? "vehicle_id"
            : type === "personnel"
              ? "personnel_id"
              : type === "customer"
                ? "customer_id"
                : "owner_id";
      qs("[data-owner]", form).innerHTML =
        fSelect(
          OWNER_LABELS[type],
          key,
          records.map((r) => ({
            v: r.id,
            t:
              r.name ||
              r.doc_no ||
              `${r.date || ""} ${r.work_type || r.category || ""} ${r.liters ? core.fmtNum(r.liters) + " Lt" : ""} ${r.hakedis_no ? "#" + r.hakedis_no : ""}`,
          })),
          type === "company" ? "company_profile" : query.owner_id || "",
          { req: true },
        ) +
        (type === "customer"
          ? fSelect(
              "Şantiye (opsiyonel)",
              "site_id",
              (await db.listActive("sites"))
                .filter(
                  (s) => s.customer_id === (query.owner_id || records[0]?.id),
                )
                .map((r) => ({ v: r.id, t: r.name })),
              "",
            )
          : "");
      if (type === "customer")
        qs("[name=customer_id]", form).addEventListener("change", async (e) => {
          const sites = (await db.listActive("sites")).filter(
            (s) => s.customer_id === e.target.value,
          );
          qs("[name=site_id]", form).innerHTML =
            '<option value="">— seç —</option>' +
            sites
              .map((r) => `<option value="${r.id}">${esc(r.name)}</option>`)
              .join("");
        });
    }
    qs("[name=category]", form).addEventListener("change", owner);
    qs("[name=owner_type]", form).addEventListener("change", owner);
    await owner();
    qs("[data-ocr]", root).addEventListener("click", async () => {
      const file = qs("[name=attachment]", form).files[0];
      if (!file?.type.startsWith("image/")) {
        toast("OCR için fotoğraf seçin", "err");
        return;
      }
      const status = qs("[data-ocr-status]", root);
      try {
        const { runOcr, extractFields } = await import("./ocr.js");
        const result = await runOcr(
          file,
          (message, progress) =>
            (status.textContent =
              "OCR: " + Math.round(progress * 100) + "% " + message),
        );
        const fields = extractFields(
          qs("[name=category]", form).value,
          result.text,
          result.confidence,
        );
        ocr = {
          status: "TAMAM",
          searchable_text: result.text,
          confidence: result.confidence,
          suggested_fields: fields,
        };
        status.textContent =
          "OCR önerileri — kontrol edip düzeltin. Orijinal dosya korunur.";
        for (const key of ["date", "doc_no", "expiry_date"])
          if (fields[key] && qs("[name=" + key + "]", form))
            qs("[name=" + key + "]", form).value =
              fields[key].value ?? fields[key];
      } catch (e) {
        ocr = { status: "HATA", error: e.message };
        status.textContent =
          "OCR çalışmadı; belgeyi dosyasıyla kaydedebilirsiniz.";
      }
    });
    qs("[data-save]", root).addEventListener("click", async () => {
      const button = qs("[data-save]", root);
      button.disabled = true;
      try {
        const fields = normalizedDocument({ ...collectForm(form), ocr }),
          file = qs("[name=attachment]", form).files[0];
        if (!file) throw Error("Belge dosyası zorunlu");
        fields.amount = fields.amount ? Number(fields.amount) : null;
        const d = await db.saveDocument(fields, file);
        toast("Belge sahibine kaydedildi", "ok");
        go("#/belgeler/" + d.id);
      } catch (e) {
        toast(e.message, "err");
      } finally {
        button.disabled = false;
      }
    });
    return true;
  }
  if (id) {
    const d = await db.get("documents", id);
    if (!d) throw Error("Belge bulunamadı");
    const atts = await db.attachmentsFor("document", id),
      spec = recordSpec("documents", d, names);
    root.innerHTML =
      appbar(d.category, d.doc_no || "Belge") +
      exportBar() +
      '<div class="card">' +
      spec.sections[0].pairs.map((p) => kv(...p)).join("") +
      '</div><div class="section-title">Orijinal Dosyalar</div><div data-files></div>' +
      (d.ocr?.searchable_text
        ? '<details class="card"><summary>OCR metni</summary><pre class="wrap">' +
          esc(d.ocr.searchable_text) +
          "</pre></details>"
        : "");
    for (const a of atts) {
      const url = URL.createObjectURL(a.blob);
      qs("[data-files]", root).insertAdjacentHTML(
        "beforeend",
        (String(a.type).startsWith("image/") ? `<a href="${url}" target="_blank" rel="noopener"><img src="${url}" alt="" style="width:100%;border-radius:8px;border:1px solid var(--border);margin-bottom:6px"></a>` : "") +
          `<a class="btn block" href="${url}" target="_blank" rel="noopener">${String(a.type).startsWith("image/") ? "🔍 Büyük aç" : "📄 " + esc(a.name) + " — aç"}</a>`,
      );
    }
    if (!atts.length) qs("[data-files]", root).innerHTML = '<div class="muted small" style="margin:4px">Dosya yok</div>';
    bindExports(
      root,
      () => spec,
      () => recordCsv(d, names),
    );
    return true;
  }
  const rows = filterRecords(await db.listActive("documents"), query);
  root.innerHTML =
    appbar("Belge Merkezi", "Dosyalar kendi sahiplerine bağlıdır") +
    `<div class="row"><button class="btn primary" data-go="#/belgeler/new">Yeni Belge</button><button class="btn" data-go="#/tara">Tara / OCR</button></div>` +
    exportBar() +
    "<div data-list></div>";
  pagedRender(qs("[data-list]", root), rows, (d) =>
    li({
      href: "#/belgeler/" + d.id,
      t1: esc(d.category) + " · " + esc(d.doc_no || ""),
      t2: esc(
        names[OWNER_STORES[d.owner_type]]?.[d.owner_id] ||
          names.vehicles?.[d.vehicle_id] ||
          names.personnel?.[d.personnel_id] ||
          "Eski kayıt — sahibini kontrol edin",
      ),
      badgeHtml: ui.badge(
        expiryState(d),
        expiryState(d) === "Süresi Geçmiş"
          ? "danger"
          : expiryState(d) === "Geçerli"
            ? "ok"
            : "warn",
      ),
    }),
  );
  const table = {
    headers: ["Tür", "No", "Sahip", "Tarih", "Bitiş", "Durum"],
    rows: rows.map((d) => [
      d.category,
      d.doc_no,
      names[OWNER_STORES[d.owner_type]]?.[d.owner_id] || "",
      core.trDate(d.date),
      core.trDate(d.expiry_date),
      expiryState(d),
    ]),
  };
  bindExports(
    root,
    () => ({
      title: "Belge Merkezi Raporu",
      audience: "internal",
      sections: [table],
    }),
    () => table,
  );
  return true;
}
async function contractScreen(ctx) {
  const { root, db, parts } = ctx,
    names = await maps(db),
    id = parts[1];
  if (id === "new" || parts[2] === "edit") {
    const r =
      id === "new"
        ? { type: "UNIT_PRICE", items: [], kdv_rate: 20 }
        : await db.get("contracts", id);
    if (r.status === "İmzalandı") throw Error("İmzalı sözleşme düzenlenemez");
    root.innerHTML =
      appbar("Sözleşme", "Tekliften bağımsız kayıt") +
      `<form data-form>${fSelect("Şablon", "template", Object.keys(CONTRACT_TEMPLATES), r.template || "Genel Hizmet Sözleşmesi", { empty: false })}${fDate("Sözleşme tarihi", "date", r.date)}${fSelect(
        "Müşteri",
        "customer_id",
        Object.entries(names.customers).map(([v, t]) => ({ v, t })),
        r.customer_id || "",
        { req: true },
      )}${fSelect(
        "Şantiye",
        "site_id",
        Object.entries(names.sites).map(([v, t]) => ({ v, t })),
        r.site_id || "",
      )}${fSelect("Fiyatlandırma yöntemi", "type", core.QUOTE_TYPES, r.type, { empty: false })}${fNum("KDV %", "kdv_rate", r.kdv_rate, { step: "any" })}${fNum("Götürü toplam", "lump_total", r.lump_total || "", { step: "any" })}${Object.entries(
        COMMERCIAL_LABELS,
      )
        .filter(([k]) => !["valid_until", "notes"].includes(k))
        .map(([k, l]) =>
          ["start_date", "end_date"].includes(k)
            ? fDate(l, k, r[k] || "", false)
            : fArea(l, k, r[k] || ""),
        )
        .join(
          "",
        )}<div class="section-title">Fiyat kalemleri</div><div data-lines></div><button type="button" class="btn" data-addline>Kalem Ekle</button></form><div class="actionbar"><button class="btn primary" data-save>Kaydet</button></div>`;
    let items = structuredClone(r.items || []);
    const lines = () => {
      qs("[data-lines]", root).innerHTML = items
        .map(
          (l, i) =>
            `<div class="card" data-line="${i}">${fText("Kalem", "label", l.label)}${fSelect("Birim", "unit", core.WORK_UNITS, l.unit || "Sefer", { empty: false })}${fNum("Miktar", "quantity", l.quantity || 1, { step: "any" })}${fNum("Birim fiyat", "unit_price", l.unit_price || "", { step: "any" })}</div>`,
        )
        .join("");
    };
    const capture = () =>
      (items = qsa("[data-line]", root).map((el) => {
        const v = collectForm(el);
        return {
          ...v,
          quantity: Number(v.quantity),
          unit_price: Number(v.unit_price),
        };
      }));
    lines();
    qs("[data-addline]", root).onclick = () => {
      capture();
      items.push({});
      lines();
    };
    qs("[name=template]", root).onchange = (e) => {
      qs("[name=general_terms]", root).value =
        CONTRACT_TEMPLATES[e.target.value];
    };
    qs("[data-save]", root).onclick = async () => {
      try {
        capture();
        const val = collectForm(qs("[data-form]", root));
        if (!val.customer_id) throw Error("Müşteri zorunlu");
        if (val.start_date && val.end_date && val.start_date > val.end_date)
          throw Error("Tarih aralığı geçersiz");
        const fields = {
          ...val,
          items,
          type: val.type,
          kdv_rate: Number(val.kdv_rate),
          lump_total: Number(val.lump_total),
          status: "Taslak",
        };
        const created =
          id === "new"
            ? await db.saveNew("contracts", {
                ...fields,
                contract_no: await db.nextSeq("contract"),
              })
            : await db.saveExisting(
                "contracts",
                r,
                fields,
                "Sözleşme taslak düzenleme",
              );
        go("#/sozlesmeler/" + created.id);
      } catch (e) {
        toast(e.message, "err");
      }
    };
    return true;
  }
  if (id) {
    const r = await db.get("contracts", id);
    if (!r) throw Error("Sözleşme bulunamadı");
    const spec = commercialSpec(r, names, core.calcQuoteTotals(r), true);
    root.innerHTML =
      appbar("Sözleşme #" + r.contract_no, r.status) +
      exportBar() +
      '<div class="card">' +
      spec.sections[0].pairs
        .filter((p) => p[1])
        .map((p) => kv(...p))
        .join("") +
      '</div><div class="card">' +
      (r.items || [])
        .map((l) => kv(l.label, core.fmtTL(l.unit_price) + " TL / " + l.unit))
        .join("") +
      "</div>" +
      (r.status !== "İmzalandı"
        ? `<div class="actionbar"><button class="btn" data-go="#/sozlesmeler/${id}/edit">Düzenle</button><button class="btn primary" data-sign>İmzaları Kaydet</button></div>`
        : '<div class="notice ok">İmzalı sözleşme ve fiyatları kilitli.</div>');
    bindExports(
      root,
      () => spec,
      () => recordCsv(r, names, "customer"),
    );
    qs("[data-sign]", root)?.addEventListener("click", async () => {
      root.insertAdjacentHTML(
        "beforeend",
        '<div class="card" data-signatures><h3>Taraf İmzaları</h3><label>İşveren</label><canvas data-sign-employer width="600" height="180" class="signature"></canvas><label>Yüklenici</label><canvas data-sign-contractor width="600" height="180" class="signature"></canvas><button class="btn primary" data-finish-sign>İmzala ve Kilitle</button><button class="btn" data-clear-sign>Temizle</button></div>',
      );
      const canvases = qsa("canvas", qs("[data-signatures]", root));
      canvases.forEach(bindSignature);
      qs("[data-clear-sign]", root).onclick = () =>
        canvases.forEach((c) => {
          c.getContext("2d").clearRect(0, 0, c.width, c.height);
          c.dataset.drawn = "";
        });
      qs("[data-finish-sign]", root).onclick = async () => {
        try {
          if (canvases.some((c) => !c.dataset.drawn))
            throw Error("İki tarafın imzası zorunlu");
          const blobs = await Promise.all(
            canvases.map(
              (c) => new Promise((res) => c.toBlob(res, "image/png")),
            ),
          );
          await db.signContract(id, blobs);
          ctx.reload();
        } catch (e) {
          toast(e.message, "err");
        }
      };
    });
    const sigs = await db.attachmentsFor("contract_signature", id);
    if (r.status === "İmzalandı" && sigs.length !== 2)
      throw Error(
        "İmzalı sözleşmenin imzaları eksik; belge üretimi engellendi",
      );
    for (const sig of sigs)
      spec.sections.push({
        title: sig.kind === "employer" ? "İşveren İmzası" : "Yüklenici İmzası",
        image: sig.blob,
      });
    return true;
  }
  const rows = await db.listActive("contracts");
  root.innerHTML =
    appbar("Sözleşmeler", "Teklif, kapsam ve koşulların bağımsız kaydı") +
    '<button class="btn primary" data-go="#/sozlesmeler/new">Yeni Sözleşme</button><div data-list></div>';
  pagedRender(qs("[data-list]", root), rows, (r) =>
    li({
      href: "#/sozlesmeler/" + r.id,
      t1: "Sözleşme #" + r.contract_no,
      t2:
        esc(names.customers[r.customer_id] || "") +
        " · " +
        esc(r.template || ""),
      badgeHtml: ui.badge(r.status),
    }),
  );
  return true;
}
function bindSignature(canvas) {
  const c = canvas.getContext("2d");
  c.lineWidth = 3;
  c.lineCap = "round";
  let down = false;
  const point = (e) => {
    const r = canvas.getBoundingClientRect();
    return [
      ((e.clientX - r.left) * canvas.width) / r.width,
      ((e.clientY - r.top) * canvas.height) / r.height,
    ];
  };
  canvas.onpointerdown = (e) => {
    e.preventDefault();
    down = true;
    canvas.setPointerCapture(e.pointerId);
    c.beginPath();
    c.moveTo(...point(e));
  };
  canvas.onpointermove = (e) => {
    if (down) {
      c.lineTo(...point(e));
      c.stroke();
      canvas.dataset.drawn = "1";
    }
  };
  canvas.onpointerup = canvas.onpointercancel = () => (down = false);
}
async function master(ctx) {
  const { root, db, parts } = ctx,
    store = STORES[parts[0]],
    names = await maps(db),
    id = parts[1];
  if (id === "new" || parts[2] === "edit") {
    const r = id === "new" ? {} : await db.get(store, id);
    const keys =
      store === "vehicles"
        ? [
            "name",
            "plate",
            "type",
            "brand",
            "model",
            "model_year",
            "chassis_no",
            "engine_no",
            "color",
            "ownership",
            "fuel_type",
            "assignee_id",
            "contractor_id",
            "km",
            "machine_hours",
            "tank_capacity",
            "load_ton",
          ]
        : store === "personnel"
          ? ["name", "role", "phone", "employment_date", "vehicle_id", "identity_number", "birth_date", "license_class", "blood_type"]
          : store === "sites"
            ? ["name", "customer_id", "address", "location", "contact", "phone"]
            : store === "contractors"
              ? ["name", "contact", "phone", "address"]
              : store === "dump_sites"
                ? ["name", "address", "location", "contact", "phone", "fee_unit", "fee"]
                : store === "customers"
                  ? ["name", "tax_title", "tax_no", "tax_office", "address", "email", "contact", "phone", "kdv_withholding", "location", "unit_price"]
                  : [
                  "name",
                  "address",
                  "location",
                  "contact",
                  "phone",
                  "unit_price",
                ];
    root.innerHTML =
      appbar(LABELS[store] + " / Kart") +
      `<form data-form>${keys
        .map((k) =>
          REL[k]
            ? fSelect(
                FIELD_LABELS[k] ||
                  {
                    customer_id: "Müşteri",
                    vehicle_id: "Zimmetli araç",
                    assignee_id: "Zimmetli personel",
                    contractor_id: "Taşeron",
                  }[k],
                k,
                Object.entries(names[REL[k]]).map(([v, t]) => ({ v, t })),
                r[k] || "",
                { req: k === "customer_id" },
              )
            : store === "vehicles" && k === "type"
              ? fSelect(
                  "Araç / makine türü",
                  k,
                  [
                    ...new Set(
                      [
                        "Araç/Makine",
                        "Kamyon",
                        "Tır",
                        "Çekici",
                        "Yarı Römork",
                        "Römork",
                        "Kamyonet",
                        "Binek",
                        "Ekskavatör",
                        "JCB",
                        "İş Makinesi",
                        "Vinç",
                        r[k],
                      ].filter(Boolean),
                    ),
                  ],
                  r[k] || "Araç/Makine",
                  { empty: false },
                )
              : k === "fee_unit"
                ? fSelect("Döküm ücreti nasıl alınıyor?", k, [{ v: "", t: "Ücret yok / anlaşmalı (işte ayrıca)" }, { v: "Ton", t: "Ton başına" }, { v: "Sefer", t: "Sefer başına" }], r[k] || "", { empty: false })
              : k === "fee" || k === "load_ton"
                ? fNum(k === "fee" ? "Döküm ücreti (₺, KDV dahil)" : "Ortalama yük (ton) — fiş yoksa döküm ücreti buna göre (boşsa tır 27, kamyon 22)", k, r[k] ?? "", { step: "any" })
              : k === "ownership"
                ? fSelect(
                    "Mülkiyet",
                    k,
                    core.VEHICLE_OWNERSHIP,
                    r[k] || "Özmal",
                    { empty: false },
                  )
                : k.endsWith("_date")
                  ? fDate(FIELD_LABELS[k], k, r[k] || "", false)
                  : fText(FIELD_LABELS[k] || k, k, r[k] || "", {
                      req: k === "name",
                    }),
        )
        .join("")}${fSelect(
        "Durum",
        "active",
        [
          { v: "1", t: "Aktif" },
          { v: "0", t: "Pasif" },
        ],
        r.active === false ? "0" : "1",
        { empty: false },
      )}${fArea("Not", "note", r.note || "")}</form><div class="actionbar"><button class="btn primary" data-save>Kaydet</button></div>`;
    qs("[data-save]", root).onclick = async () => {
      try {
        const val = collectForm(qs("[data-form]", root));
        if (!val.name?.trim()) throw Error("Ad zorunlu");
        const fields = { ...val, active: val.active === "1" };
        for (const k of ["fee", "load_ton"]) if (k in fields) fields[k] = fields[k] === "" ? null : Number(fields[k]);
        const created =
          id === "new"
            ? await db.saveNew(store, fields)
            : await db.saveExisting(store, r, fields);
        go("#/" + parts[0] + "/" + created.id);
      } catch (e) {
        toast(e.message, "err");
      }
    };
    return true;
  }
  if (id) return card(ctx);
  const records = await db.listActive(store);
  root.innerHTML =
    appbar(LABELS[store]) +
    '<button class="btn primary" data-go="#/' +
    parts[0] +
    '/new">Yeni Kart</button><div data-list></div>';
  pagedRender(qs("[data-list]", root), records, (r) =>
    li({
      href: "#/" + parts[0] + "/" + r.id,
      t1: esc(r.name),
      t2: esc([r.fee > 0 && r.fee_unit ? `${r.fee} ₺ / ${String(r.fee_unit).toLocaleLowerCase("tr-TR")} (KDV dahil)` : "", r.own_yard ? "kendi depo" : "", r.address || ""].filter(Boolean).join(" · ")),
    }),
  );
  return true;
}
// Kart sayfasından "Detaylı rapor" (report-ui.js): bu kalemin tüm kayıtları
const DETAIL_KIND = { dump_sites: "dokum", quarries: "ocak", customers: "musteri", sites: "santiye", vehicles: "arac", personnel: "personel", contractors: "taseron" };
async function card(ctx) {
  const { root, db, parts } = ctx,
    store = STORES[parts[0]],
    id = parts[1],
    r = await db.get(store, id);
  if (!r) throw Error("Kart bulunamadı");
  const names = await maps(db),
    spec = recordSpec(store, r, names),
    key =
      store === "vehicles"
        ? "vehicle_id"
        : store === "personnel"
          ? "personnel_id"
          : store === "customers"
            ? "customer_id"
            : store === "sites"
              ? "site_id"
              : store === "contractors"
                ? "contractor_id"
                : store === "dump_sites"
                  ? "dump_site_id"
                  : "quarry_id";
  const relations =
    store === "vehicles"
      ? ["work_records", "fuel_records", "maintenance_records", "documents"]
      : store === "personnel"
        ? [
            "documents",
            "personnel_events",
            "work_records",
            "fuel_records",
            "expense_records",
          ]
        : store === "customers"
          ? [
              "sites",
              "price_book",
              "quotes",
              "contracts",
              "work_records",
              "hakedis",
              "cari_movements",
              "cash_records",
              "documents",
            ]
          : store === "sites"
            ? [
                "work_records",
                "price_book",
                "quotes",
                "contracts",
                "hakedis",
                "documents",
              ]
            : ["work_records", "vehicles", "expense_records"];
  root.innerHTML =
    appbar(r.name, LABELS[store] + " / ilişkisel kart") +
    exportBar() +
    (DETAIL_KIND[store] ? `<button class="btn primary block" style="margin:8px 0" data-go="#/detayli-rapor?k=${DETAIL_KIND[store]}&id=${encodeURIComponent(id)}&p=all">📑 Detaylı rapor — tüm kayıtlar (PDF)</button>` : "") +
    (store === "dump_sites" && !r.own_yard ? `<button class="btn block" style="margin:0 0 8px" data-go="#/dokum-hesap/${encodeURIComponent(id)}">💳 Döküm hesabı — yatırılan para / kalan</button>` : "") +
    `<div class="row"><button class="btn" data-go="#/${parts[0]}/${id}/edit">Kartı Düzenle</button>${["vehicles", "personnel", "customers"].includes(store) ? `<button class="btn" data-go="#/belgeler/new?owner_type=${store === "vehicles" ? "vehicle" : store === "personnel" ? "personnel" : "customer"}&owner_id=${id}&category=${encodeURIComponent(store === "vehicles" ? "Muayene Belgesi" : store === "personnel" ? "SRC" : "Sözleşme")}">Belge Ekle</button>` : ""}</div><div class="tabs" data-tabs><button class="chip on" data-tab="general">GENEL</button>${relations.map((s) => `<button class="chip" data-tab="${s}">${LABELS[s]}</button>`).join("")}${store === "vehicles" ? '<button class="chip" data-tab="cost">MALİYET</button>' : ""}<button class="chip" data-tab="report">RAPOR</button></div><div data-card-content></div>`;
  async function tab(s) {
    const el = qs("[data-card-content]", root);
    if (s === "cost") {
      const data = await db.dumpAll(),
        p = core.profitability(data, { vehicle_id: id });
      el.innerHTML =
        '<div class="card">' +
        kv("Yakıt", core.fmtTL(p.yakit) + " TL") +
        kv("Gider", core.fmtTL(p.gider) + " TL") +
        kv("Bakım", core.fmtTL(p.bakim) + " TL") +
        kv(
          "Kayıtlı toplam maliyet",
          core.fmtTL(p.yakit + p.gider + p.bakim) + " TL",
        ) +
        "</div>";
      return;
    }
    if (s === "general") {
      el.innerHTML =
        '<div class="card">' +
        spec.sections[0].pairs.map((p) => kv(...p)).join("") +
        "</div>";
      return;
    }
    if (s === "report") {
      el.innerHTML = `<button class="btn primary" data-go="#/raporlar?store=work_records&${key}=${id}">İş Geçmişi Raporu</button><button class="btn" data-go="#/raporlar?store=documents&${key}=${id}">Evrak Raporu</button>`;
      return;
    }
    let rows = (await db.listActive(s)).filter(
      (x) => x[key] === id || (s === "documents" && x.owner_id === id),
    );
    el.innerHTML = `<div class="section-title">${LABELS[s]} (${rows.length})</div><button class="btn sm" data-go="#/raporlar?store=${s}&${key}=${id}">Filtreli Rapor / PDF</button><div data-related></div>`;
    if (s === "price_book" && ["customers", "sites"].includes(store))
      el.insertAdjacentHTML(
        "afterbegin",
        `<button class="btn primary" data-go="#/fiyat/new?customer_id=${store === "customers" ? id : r.customer_id}${store === "sites" ? "&site_id=" + id : ""}">+ Fiyat Tanımla</button>`,
      );
    pagedRender(qs("[data-related]", el), rows, (x) =>
      li({
        href: "#/" + ROUTE[s] + "/" + x.id,
        t1: esc(
          x.name ||
            x.work_type ||
            x.category ||
            x.doc_no ||
            x.contract_no ||
            x.quote_no ||
            x.hakedis_no ||
            LABELS[s],
        ),
        t2:
          esc(x.date || x.valid_from || "") +
          (s === "price_book"
            ? " · " +
              esc(core.priceVehicleScope(x, names.vehicles)) +
              " · " +
              core.fmtTL(x.price) +
              " TL / " +
              esc(x.unit || "")
            : s === "documents"
              ? " · " + expiryState(x)
              : ""),
        badgeHtml: x.status ? ui.badge(x.status) : "",
      }),
    );
  }
  qs("[data-tabs]", root).onclick = (e) => {
    const b = e.target.closest("[data-tab]");
    if (!b) return;
    qsa("[data-tab]", root).forEach((c) => c.classList.toggle("on", c === b));
    tab(b.dataset.tab);
  };
  await tab("general");
  bindExports(
    root,
    () => spec,
    () => recordCsv(r, names),
  );
  return true;
}
export async function reports(ctx) {
  const { root, db, query } = ctx,
    names = await maps(db);
  if (query.store === "management") return managementReport(ctx, names);
  const reportLabels = {
    ...LABELS,
    dump_work: "Döküm İşleri",
    quarry_work: "Ocak İşleri",
  };
  const requested =
    query.store === "dump_sites"
      ? "dump_work"
      : query.store === "quarries"
        ? "quarry_work"
        : query.store;
  const store =
    requested && reportLabels[requested] ? requested : "work_records";
  const reportGroups = {
    OPERASYON: [
      "work_records",
      "slips",
      "dump_work",
      "quarry_work",
      "dump_sites",
      "quarries",
    ],
    FİLO: ["vehicles", "maintenance_records"],
    PERSONEL: ["personnel", "personnel_events"],
    MÜŞTERİ: ["customers", "sites"],
    FİNANS: [
      "quotes",
      "contracts",
      "hakedis",
      "cari_movements",
      "cash_records",
      "expense_records",
      "price_book",
    ],
    YAKIT: ["fuel_records", "fuel_tank_movements"],
    BELGE: ["documents"],
    YÖNETİM: ["management"],
  };
  root.innerHTML =
    appbar("Rapor Merkezi", "Filtrele · grupla · dışa aktar") +
    `<div class="reportcategories">${Object.entries(reportGroups)
      .map(
        ([label, stores]) =>
          `<details><summary>${label}</summary>${stores.map((s) => `<button class="chip" data-go="#/raporlar?store=${s}">${reportLabels[s] || "Yönetici Raporu"}</button>`).join("")}</details>`,
      )
      .join("")}</div><form data-filters>${fSelect(
      "Rapor",
      "store",
      Object.entries(reportLabels).map(([v, t]) => ({ v, t })),
      store,
      { empty: false },
    )}<div class="formgrid2">${fDate("Başlangıç", "from", query.from || "", false)}${fDate("Bitiş", "to", query.to || "", false)}</div>${[
      "customer_id",
      "site_id",
      "vehicle_id",
      "personnel_id",
    ]
      .map((k) =>
        fSelect(
          {
            customer_id: "Müşteri",
            site_id: "Şantiye",
            vehicle_id: "Araç",
            personnel_id: "Personel",
          }[k],
          k,
          Object.entries(names[REL[k]]).map(([v, t]) => ({ v, t })),
          query[k] || "",
        ),
      )
      .join(
        "",
      )}${fText("İş türü", "work_type", query.work_type || "")}${fSelect(
      "Taşeron",
      "contractor_id",
      Object.entries(names.contractors).map(([v, t]) => ({ v, t })),
      query.contractor_id || "",
    )}
${fSelect("Tank hareketi", "move_type", ["GİRİŞ", "ÇIKIŞ"], query.move_type || "")}
${fSelect(
  "Araç grubu",
  "vehicle_group",
  Object.entries(core.PRICE_VEHICLE_GROUPS).map(([v, g]) => ({
    v,
    t: g.label,
  })),
  query.vehicle_group || "",
)}${fText("Malzeme", "material", query.material || "")}${fSelect("Birim", "unit", core.WORK_UNITS, query.unit || "")}${fSelect("Mülkiyet", "ownership", core.VEHICLE_OWNERSHIP, query.ownership || "")}${fSelect(
      "Döküm sahası",
      "dump_site_id",
      Object.entries(names.dump_sites).map(([v, t]) => ({ v, t })),
      query.dump_site_id || "",
    )}${fText("Döküm adı (eski kayıt)", "dump_area", query.dump_area || "")}${fSelect(
      "Malzeme ocağı",
      "quarry_id",
      Object.entries(names.quarries).map(([v, t]) => ({ v, t })),
      query.quarry_id || "",
    )}${fText("Ocak adı (eski kayıt)", "quarry", query.quarry || "")}${fSelect("Belge durumu", "document_status", ["Geçerli", "30 Gün İçinde", "7 Gün İçinde", "Süresi Geçmiş"], query.document_status || "")}${fSelect(
      "Gruplama",
      "group",
      [
        { v: "", t: "Gruplama yok" },
        { v: "date", t: "Gün" },
        { v: "customer_id", t: "Müşteri" },
        { v: "site_id", t: "Şantiye" },
        { v: "vehicle_id", t: "Araç" },
        { v: "personnel_id", t: "Personel" },
        { v: "work_type", t: "İş türü" },
        { v: "dump_area", t: "Döküm sahası" },
        { v: "quarry", t: "Malzeme ocağı" },
      ],
      query.group || "",
      { empty: false },
    )}${fSelect("Detay seviyesi", "detail", ["DETAYLI", "ÖZET"], query.detail || "DETAYLI", { empty: false })}${fSelect(
      "Görünüm",
      "audience",
      [
        { v: "internal", t: "İç Yönetim" },
        { v: "customer", t: "Müşteri" },
      ],
      query.audience || "internal",
      { empty: false },
    )}<button type="button" class="btn primary block" data-run>Raporu Getir</button></form>` +
    exportBar() +
    "<div data-results></div>";
  let table = { headers: [], rows: [] },
    spec;
  async function run() {
    const f = collectForm(qs("[data-filters]", root));
    if (f.from && f.to && f.from > f.to) {
      toast("Tarih aralığı geçersiz", "err");
      return;
    }
    const sourceStore = ["dump_work", "quarry_work"].includes(f.store)
      ? "work_records"
      : f.store;
    const records = (await db.listActive(sourceStore)).filter((r) =>
      f.store === "dump_work"
        ? r.dump_site_id || r.dump_area
        : f.store === "quarry_work"
          ? r.quarry_id || r.quarry
          : true,
    );
    const withOwnership = records.map((r) => ({
      ...r,
      ...(sourceStore === "work_records" ? workFinancials(r) : {}),
      dump_area: names.dump_sites[r.dump_site_id] || r.dump_area,
      quarry: names.quarries[r.quarry_id] || r.quarry,
      ...(f.store === "price_book"
        ? { price_scope: core.priceVehicleScope(r, names.vehicles) }
        : {}),
      personnel_id:
        r.personnel_id || (f.store === "vehicles" ? r.assignee_id : null),
      ownership: r.ownership || (r.vehicle_id ? null : undefined),
    }));
    const vehicles = await db.listActive("vehicles"),
      byId = Object.fromEntries(vehicles.map((v) => [v.id, v]));
    for (const r of withOwnership)
      if (r.vehicle_id) r.ownership = byId[r.vehicle_id]?.ownership;
    let rows = filterRecords(withOwnership, f);
    const lineReport =
      f.detail === "DETAYLI" &&
      ["quotes", "contracts", "hakedis"].includes(sourceStore);
    if (lineReport) rows = commercialReportRows(rows, sourceStore);
    const units = {};
    let amount = 0,
      liters = 0;
    for (const r of rows) {
      if (r.unit)
        units[r.unit] = (units[r.unit] || 0) + Number(r.quantity || 0);
      amount += core.toKurus(
        r.gross_total ??
          r.grand_total ??
          r.amount ??
          r.total ??
          r.price_snapshot?.amount ??
          0,
      );
      liters += Number(r.liters) || 0;
    }
    const summary = `${rows.length} kayıt · ${Object.entries(units)
      .map(([u, n]) => core.fmtNum(n) + " " + u)
      .join(
        " · ",
      )}${liters ? " · " + core.fmtNum(liters) + " Lt" : ""}${amount ? " · " + core.fmtTL(core.fromKurus(amount)) + " TL" : ""}`;
    if (f.detail === "ÖZET") {
      const groups = groupRecords(rows, f.group || "date");
      table = {
        headers: ["Grup", "Kayıt", "Miktarlar", "Litre", "Tutar"],
        rows: groups.map((g) => [
          REL[f.group] ? names[REL[f.group]]?.[g.key] || "Belirtilmedi" : g.key,
          g.count,
          Object.entries(g.units)
            .map(([u, n]) => core.fmtNum(n) + " " + u)
            .join(" / "),
          core.fmtNum(g.liters),
          core.fmtTL(g.amount) + " TL",
        ]),
      };
    } else {
      const keys = lineReport
        ? [
            sourceStore === "quotes"
              ? "quote_no"
              : sourceStore === "contracts"
                ? "contract_no"
                : "hakedis_no",
            "date",
            "customer_id",
            "site_id",
            "work_type",
            "quantity",
            "unit",
            "unit_price",
            "kdv_rate",
            "net_total",
            "tax_total",
            "gross_total",
            "status",
          ]
        : reportKeys(sourceStore, f.audience);
      table = {
        headers: keys.map(
          (k) =>
            FIELD_LABELS[k] ||
            {
              customer_id: "Müşteri",
              site_id: "Şantiye",
              vehicle_id: "Araç",
              personnel_id: "Personel",
              owner_name: "Sahip",
              document_status: "Durum",
            }[k] ||
            k,
        ),
        rows: [...rows]
          .sort((a, b) =>
            f.group
              ? String(a[f.group] || "").localeCompare(
                  String(b[f.group] || ""),
                  "tr",
                )
              : 0,
          )
          .map((r) =>
            keys.map((k) =>
              k === "owner_name"
                ? names[OWNER_STORES[r.owner_type]]?.[r.owner_id] ||
                  names.vehicles?.[r.vehicle_id] ||
                  names.personnel?.[r.personnel_id] ||
                  "Eski kayıt"
                : k === "document_status"
                  ? expiryState(r)
                  : value(k, r[k], names),
            ),
          ),
      };
    }
    spec = {
      store: f.store,
      title: reportLabels[f.store] + " Raporu",
      audience: f.audience,
      orientation: table.headers.length > 6 ? "landscape" : "portrait",
      filename: "SAHAPRO_" + f.store + "_Rapor.pdf",
      sections: [
        { title: "Rapor Kapsamı", layout: "identity", pairs: [
          ["Başlangıç", f.from ? core.trDate(f.from) : "Tüm tarihler"],
          ["Bitiş", f.to ? core.trDate(f.to) : "Tüm tarihler"],
          ["Görünüm", f.detail === "ÖZET" ? "Özet" : "Ayrıntılı"],
          ...Object.entries({customer_id:"Müşteri",site_id:"Şantiye",vehicle_id:"Araç",personnel_id:"Personel",dump_site_id:"Döküm Sahası",quarry_id:"Ocak"}).filter(([key])=>f[key]).map(([key,label])=>[label,value(key,f[key],names)]),
          ...Object.entries({work_type:"İş Türü",material:"Malzeme",unit:"Birim",ownership:"Mülkiyet",document_status:"Belge Durumu"}).filter(([key])=>f[key]).map(([key,label])=>[label,f[key]]),
        ]},
        { title: "Rapor Özeti", text: summary }, { ...table },
      ],
    };
    const el = qs("[data-results]", root);
    el.innerHTML =
      '<div class="notice info">' +
      esc(summary) +
      "</div><div data-result-list></div>";
    pagedRender(
      qs("[data-result-list]", el),
      table.rows,
      (r) =>
        '<div class="card">' +
        r.map((v, i) => kv(table.headers[i], v)).join("") +
        "</div>",
      25,
    );
  }
  const filterForm = qs("[data-filters]", root);
  const syncFilters = () => {
    const selected = qs("[name=store]", filterForm).value,
      keys = reportFilterKeys(selected);
    for (const field of qsa("[name]", filterForm)) {
      if (["store", "group", "detail", "audience"].includes(field.name))
        continue;
      const allowed = keys.includes(field.name);
      field.closest(".field").hidden = !allowed;
      field.disabled = !allowed;
      if (!allowed) field.value = "";
    }
    for (const option of qs("[name=group]", filterForm).options)
      option.hidden =
        option.value &&
        !keys.includes(option.value === "date" ? "from" : option.value);
  };
  qs("[name=store]", filterForm).addEventListener("change", syncFilters);
  syncFilters();
  qs("[data-run]", root).onclick = run;
  bindExports(
    root,
    async () => {
      if (!spec) await run();
      return spec;
    },
    () => table,
  );
  await run();
  return true;
}
function reportKeys(store, audience = "internal") {
  const keys = {
    work_records: [
      "date",
      "customer_id",
      "site_id",
      "vehicle_id",
      "personnel_id",
      "work_type",
      "material",
      "quantity",
      "unit",
      "dump_area",
      "quarry",
      "customer_note",
      "unit_price",
      "kdv_rate",
      "net_total",
      "tax_total",
      "gross_total",
      "price_source",
      "time_start",
      "time_end",
      "break_minutes",
    ],
    fuel_records: [
      "date",
      "vehicle_id",
      "personnel_id",
      "liters",
      "fuel_source",
      "total",
    ],
    fuel_tank_movements: [
      "date",
      "move_type",
      "vehicle_id",
      "personnel_id",
      "liters",
    ],
    documents: [
      "category",
      "doc_no",
      "owner_name",
      "date",
      "expiry_date",
      "document_status",
    ],
    price_book: [
      "customer_id",
      "site_id",
      "price_scope",
      "work_type",
      "material",
      "unit",
      "price",
      "kdv_rate",
    ],
    hakedis: [
      "hakedis_no",
      "customer_id",
      "site_id",
      "status",
      "subtotal",
      "kdv_total",
      "net_total",
      "tax_total",
      "gross_total",
      "grand_total",
    ],
    quotes: ["quote_no", "date", "customer_id", "type", "title", "status"],
    contracts: [
      "contract_no",
      "date",
      "customer_id",
      "type",
      "title",
      "status",
    ],
    cash_records: [
      "date",
      "customer_id",
      "personnel_id",
      "cash_type",
      "amount",
      "cash_status",
    ],
    cari_movements: ["date", "customer_id", "type", "amount"],
    maintenance_records: [
      "date",
      "vehicle_id",
      "maint_type",
      "description",
      "status",
      "cost",
    ],
    expense_records: [
      "date",
      "category",
      "vehicle_id",
      "personnel_id",
      "amount",
      "description",
    ],
    personnel_events: [
      "date",
      "personnel_id",
      "event_type",
      "amount",
      "description",
    ],
  }[store] || [
    "name",
    "type",
    "role",
    "ownership",
    "phone",
    "address",
    "active",
  ];
  return keys.filter((k) => audience !== "customer" || !PRIVATE.has(k));
}
export async function augment(ctx) {
  const { root, db, parts, query } = ctx,
    route = parts[0],
    store = STORES[route];
  if (route === "yonetici") {
    root.insertAdjacentHTML(
      "beforeend",
      '<button class="btn primary block" data-go="#/raporlar?store=management">Yönetici Raporu / PDF</button>',
    );
  }
  await formSemantics(ctx);
  if (route === "ayarlar") {
    await backupPanel(ctx);
    return;
  }
  if (
    !store ||
    qs("[data-pro-pdf]", root) ||
    qs("[data-slip-share]", root) ||
    parts.includes("new") ||
    parts.includes("edit") ||
    parts.includes("imza") ||
    parts.includes("hareket")
  )
    return;
  const names = await maps(db),
    id = parts[1];
  if (id && route !== "cari") {
    const r = await db.get(store, id);
    if (!r) return;
    root.insertAdjacentHTML("beforeend", exportBar());
    let spec = recordSpec(
      store,
      r,
      names,
      ["work_records", "cash_records"].includes(store)
        ? "customer"
        : "internal",
    );
    if (store === "quotes")
      spec = commercialSpec(r, names, core.calcQuoteTotals(r));
    if (store === "hakedis") spec = hakedisSpec(r, names);
    if (store === "slips") {
      const sig = (await db.attachmentsFor("slip_signature", r.id)).find(
        (a) => a.kind === "signature",
      );
      spec = slipSpec(r, names, sig?.blob);
    }
    bindExports(
      root,
      () => spec,
      () => recordCsv(r, names, spec.audience),
    );
    if (store === "work_records") {
      root.insertAdjacentHTML(
        "beforeend",
        `<div class="card">${kv("Fiyat kaynağı", r.price_snapshot?.price_source || "Fiyat yok")}${r.price_snapshot?.price_scope ? kv("Araç kapsamı", r.price_snapshot.price_scope) : ""}${r.price_snapshot ? kv("Birim fiyat", core.fmtTL(r.price_snapshot.unit_price) + " TL") : ""}${r.price_snapshot?.locked ? '<div class="notice">Finansal snapshot kilitli</div>' : '<button class="btn" data-apply-price>Fiyat Uygula</button>'}</div>`,
      );
      qs("[data-apply-price]", root)?.addEventListener("click", async () => {
        try {
          const vehicle = await db.get("vehicles", r.vehicle_id);
          const snap = priceSnapshot(
            { ...r, vehicle_type: vehicle?.type },
            await db.listActive("price_book"),
            {
              first: await db.metaGet("crane_first_hour"),
              next: await db.metaGet("crane_next_hour"),
            },
          );
          if (!snap) throw Error("Uygun fiyat bulunamadı");
          await db.saveExisting("work_records", r, { price_snapshot: snap });
          ctx.reload();
        } catch (e) {
          toast(e.message, "err");
        }
      });
    }
    return;
  }
  root.insertAdjacentHTML(
    "afterbegin",
    `<div class="exportbar"><button class="btn sm" data-go="#/raporlar?store=${store}${route === "cari" && id ? "&customer_id=" + id : ""}">Filtreli PDF / CSV / Paylaş</button>${["vehicles", "personnel", "contractors", "sites"].includes(store) ? `<button class="btn sm" data-go="#/${route}/new">Yeni Kart</button>` : ""}${store === "work_records" ? '<button class="btn sm" data-bulk-price>Toplu Fiyatlandır</button>' : ""}</div>`,
  );
  qs("[data-bulk-price]", root)?.addEventListener("click", async () => {
    if (
      !(await confirmDialog(
        "Fiyatları uygula",
        "Yalnızca fiyatı olmayan, kesinleşmemiş işlere mevcut kurallar uygulanır.",
        "Uygula",
      ))
    )
      return;
    const entries = await db.listActive("price_book"),
      vehicles = await db.listActive("vehicles"),
      crane = {
        first: await db.metaGet("crane_first_hour"),
        next: await db.metaGet("crane_next_hour"),
      };
    let n = 0;
    for (const w of await db.listActive("work_records"))
      if (!w.price_snapshot) {
        const snap = priceSnapshot(
          {
            ...w,
            vehicle_type: vehicles.find((v) => v.id === w.vehicle_id)?.type,
          },
          entries,
          crane,
        );
        if (snap) {
          await db.saveExisting("work_records", w, { price_snapshot: snap });
          n++;
        }
      }
    toast(n + " iş fiyatlandırıldı", "ok");
  });
}

async function backupPanel(ctx) {
  const { root, db } = ctx;
  // Ayarlar'daki Yedekleme kartının altına (yoksa başlığın altına) — başlığın üstüne düşmesin
  const anchor = qs("[data-bak]", root)?.closest(".card") || qs(".appbar", root);
  (anchor || root).insertAdjacentHTML(
    anchor ? "afterend" : "afterbegin",
    '<div class="card"><h3>Tam Yedek ve Geri Yükleme</h3><p>Veriler, orijinal dosyalar, imzalar ve ayarlar tek dosyada (.sahapro; eski .json yedekler de geri yüklenir).</p><button class="btn primary" data-full-backup>Tam Yedeği İndir</button><div class="field"><label>Tam yedeği geri yükle</label><input type="file" data-full-restore></div><div data-full-preview></div></div>',
  );
  qs("[data-full-backup]", root).onclick = async () => {
    try {
      const crm = await import("./m-crm.js");
      await crm.doBackup(ctx);
    } catch (e) {
      toast(e.message, "err");
    }
  };
  qs("[data-full-restore]", root).onchange = async (e) => {
    try {
      const file = e.target.files[0];
      if (!file) return;
      { const sec = await import("./security.js"); if (!(await sec.reauth("Yedekten geri yükleme"))) return; await sec.secLog("backup", "Yedek geri yükleme açıldı: " + file.name); }
      const { previewBackup, restoreBackup, readBackupFile } = await import("./backup.js"),
        obj = await readBackupFile(file),
        p = await previewBackup(db, obj),
        el = qs("[data-full-preview]", root);
      el.innerHTML =
        ui.notice(
          "info",
          p.added +
            " yeni / " +
            p.same +
            " aynı / " +
            p.conflicts +
            " çakışma / " +
            p.attachments +
            " ek",
        ) +
        '<button class="btn primary" data-restore-apply>Yeni Kayıtları Ekle; Çakışanları Koru</button>';
      qs("[data-restore-apply]", el).onclick = async () => {
        try {
          if (
            !(await confirmDialog(
              "Yedeği geri yükle",
              "İşlemden önce cihazda otomatik kurtarma yedeği alınır. Mevcut çakışan kayıtlar korunur.",
              "Uygula",
            ))
          )
            return;
          await restoreBackup(db, obj, false);
          toast("Veriler ve dosyalar geri yüklendi", "ok");
          ctx.reload();
        } catch (error) {
          toast(error.message, "err");
        }
      };
    } catch (error) {
      toast(error.message, "err");
    }
  };
}

async function simpleDetail(ctx) {
  const { root, db, parts } = ctx,
    store = STORES[parts[0]],
    r = await db.get(store, parts[1]);
  if (!r) throw Error("Kayıt bulunamadı");
  const names = await maps(db),
    spec = recordSpec(
      store,
      r,
      names,
      store === "cash_records" ? "customer" : "internal",
    );
  root.innerHTML =
    appbar(LABELS[store], r.date || "") +
    exportBar() +
    '<div class="card">' +
    spec.sections[0].pairs.map((p) => kv(...p)).join("") +
    "</div>";
  bindExports(
    root,
    () => spec,
    () => recordCsv(r, names, spec.audience),
  );
  return true;
}
async function managementReport(ctx, names) {
  const { root, db } = ctx,
    data = await db.dumpAll(),
    p = operatingResult(data);
  const table = {
    headers: ["Gösterge", "Değer"],
    rows: [
      ["Kesinleşmiş Gelir (KDV Hariç)", core.fmtTL(p.revenue) + " TL"],
      ["KDV Ayrımı Bilinen Maliyet", core.fmtTL(p.known_cost) + " TL"],
      ["KDV Ayrımı Olmayan Brüt Maliyet", core.fmtTL(p.unknown_cost) + " TL"],
      ["Geçici Operasyon Sonucu", core.fmtTL(p.provisional_result) + " TL"],
    ],
  };
  const spec = {
    title: "Yönetici Raporu",
    audience: "internal",
    sections: [
      {
        text: "Muhasebe net kârı değildir. KDV ayrımı bilinmeyen maliyetler brüt düşülür. Eksik veya dağıtılmamış maliyetler sonucu etkiler. Dönem/müşteri/şantiye/araç bazında incelemek için Maliyet Analizi ekranını kullanın.",
      },
      table,
    ],
  };
  root.innerHTML =
    appbar("Yönetici Raporu", "Kaynaklı operasyon sonucu") +
    exportBar() +
    '<div class="card">' +
    table.rows.map((p) => kv(...p)).join("") +
    '</div><button class="btn primary block" data-go="#/maliyet">Dönem / Müşteri / Şantiye Maliyet Analizi</button>';
  bindExports(
    root,
    () => spec,
    () => table,
  );
  return true;
}

async function formSemantics(ctx) {
  const { root, db } = ctx;
  const customer = qs("[name=customer_id]", root),
    site = qs("[name=site_id]", root);
  if (customer && site) {
    const sites = await db.listActive("sites"),
      current = site.value;
    const update = () => {
      const old = site.value;
      const options = sites.filter((s) => s.customer_id === customer.value);
      site.innerHTML =
        '<option value="">— seç —</option>' +
        options
          .map((s) => `<option value="${s.id}">${esc(s.name)}</option>`)
          .join("");
      if (options.some((s) => s.id === old)) site.value = old;
    };
    customer.addEventListener("change", update);
    update();
    if (sites.some((s) => s.id === current && s.customer_id === customer.value))
      site.value = current;
  }
  const cashType = qs("[name=cash_type]", root);
  if (cashType && customer) {
    const update = () => {
      const relevant = cashType.value === "Müşteriden Para Alındı";
      customer.closest(".field").hidden = !relevant;
      customer.disabled = !relevant;
      customer.required = relevant;
      if (!relevant) customer.value = "";
    };
    cashType.addEventListener("change", update);
    update();
  }
}

export function reportFilterKeys(store) {
  if (["dump_work", "quarry_work"].includes(store)) store = "work_records";
  const date = ["from", "to"];
  return (
    {
      work_records: [
        ...date,
        "customer_id",
        "site_id",
        "vehicle_id",
        "personnel_id",
        "contractor_id",
        "work_type",
        "material",
        "unit",
        "ownership",
        "dump_area",
        "dump_site_id",
        "quarry_id",
        "quarry",
      ],
      slips: [
        ...date,
        "customer_id",
        "site_id",
        "vehicle_id",
        "personnel_id",
        "unit",
      ],
      quotes: [...date, "customer_id", "site_id"],
      contracts: [...date, "customer_id", "site_id"],
      hakedis: [...date, "customer_id", "site_id"],
      cari_movements: [...date, "customer_id"],
      cash_records: [...date, "customer_id", "personnel_id"],
      expense_records: [...date, "vehicle_id", "personnel_id", "ownership"],
      fuel_records: [...date, "vehicle_id", "personnel_id", "ownership"],
      fuel_tank_movements: [...date, "vehicle_id", "personnel_id", "move_type"],
      maintenance_records: [...date, "vehicle_id", "personnel_id", "ownership"],
      documents: [
        ...date,
        "vehicle_id",
        "personnel_id",
        "customer_id",
        "site_id",
        "document_status",
      ],
      price_book: [
        "vehicle_group",
        "customer_id",
        "site_id",
        "vehicle_id",
        "work_type",
        "material",
        "unit",
      ],
      vehicles: ["ownership", "personnel_id", "contractor_id"],
      personnel: [],
      sites: ["customer_id"],
      customers: [],
      contractors: [],
      dump_sites: [],
      quarries: [],
      personnel_events: [...date, "personnel_id"],
    }[store] || []
  );
}

async function compareQuotes(ctx) {
  const { root, db, query } = ctx,
    names = await maps(db),
    quotes = (await db.listActive("quotes")).filter(
      (q) => !query.customer_id || q.customer_id === query.customer_id,
    );
  root.innerHTML =
    appbar("Teklif Karşılaştırma", "Birimler ve teklif türleri korunur") +
    quotes
      .map(
        (q) =>
          `<label class="card row"><input type="checkbox" data-compare="${q.id}"><span>Teklif #${q.quote_no} · ${esc(names.customers[q.customer_id] || "")} · ${esc(q.type)}</span></label>`,
      )
      .join("") +
    '<button class="btn primary" data-compare-run>Seçilenleri Karşılaştır</button>' +
    exportBar() +
    "<div data-compare-results></div>";
  let table = {
    headers: [
      "Teklif",
      "Tür",
      "Kalem",
      "Birim",
      "Miktar",
      "Birim fiyat",
      "KDV",
    ],
    rows: [],
  };
  const run = () => {
    const ids = qsa("[data-compare]:checked", root).map(
      (e) => e.dataset.compare,
    );
    table.rows = quotes
      .filter((q) => ids.includes(q.id))
      .flatMap((q) =>
        (q.items || []).map((i) => [
          q.quote_no,
          q.type,
          i.label,
          i.unit,
          q.type === "QUANTITY_BASED" ? core.fmtNum(i.quantity) : "—",
          core.fmtTL(i.unit_price) + " TL",
          "%" + q.kdv_rate,
        ]),
      );
    qs("[data-compare-results]", root).innerHTML = table.rows
      .map(
        (row) =>
          '<div class="card">' +
          row.map((v, i) => kv(table.headers[i], v)).join("") +
          "</div>",
      )
      .join("");
  };
  qs("[data-compare-run]", root).onclick = run;
  bindExports(
    root,
    () => ({
      title: "Teklif Karşılaştırma",
      audience: "customer",
      orientation: "landscape",
      sections: [
        {
          text: "Farklı birimlerdeki fiyatlar ve alternatif kalemler toplanmaz.",
        },
        table,
      ],
    }),
    () => table,
  );
  return true;
}
