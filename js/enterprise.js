import * as core from "./core.js";
import * as rules from "./enterprise-core.js";
import * as actions from "./enterprise-db.js";
import * as ui from "./ui.js";
import { exportDocument } from "./document-engine.js";
const {
  qs,
  qsa,
  esc,
  appbar,
  kv,
  fText,
  fNum,
  fDate,
  fSelect,
  fArea,
  collectForm,
  pagedRender,
  toast,
  go,
  downloadBlob,
  promptDialog,
} = ui;
export const MODULES = {
  tedarikciler: ["suppliers", "Tedarikçiler / Petrolcüler"],
  alislar: ["payables", "Alış Belgeleri / Borçlar"],
  odemeler: ["supplier_payments", "Tedarikçi Ödemeleri"],
  bankalar: ["bank_accounts", "Banka Hesapları"],
  vadeler: ["receivable_plans", "Alacak Vade Planları"],
  satinalma: ["purchase_orders", "Satın Alma"],
  ucretler: ["payroll_entries", "Ücret / Avans Defteri"],
  bakimplani: ["service_plans", "Bakım Planları"],
  takipler: ["activities", "Takip Görevleri"],
  "gider-kategorileri": ["expense_categories", "Gider Kategorileri"],
  "gun-kapanis": ["daily_closings", "Gün Sonu Kapanışı"],
  ceksenet: ["instruments", "Çek / Senet Defteri"],
};
const routes = Object.fromEntries(
  Object.entries(MODULES).map(([k, [s]]) => [s, k]),
);
const amount = (v) => (v == null ? "Belirtilmedi" : core.fmtTL(v) + " TL");
const active = (d, s) => (d[s] || []).filter(core.isActive);
const name = (d, s, id) =>
  d[s]?.find((r) => r.id === id)?.name ||
  d[s]?.find((r) => r.id === id)?.document_no ||
  "—";
const partyName = (d, r) =>
  name(d, rules.PARTY_STORES[r.party_type], r.party_id);
const opts = (d, s) =>
  active(d, s).map((r) => ({
    v: r.id,
    t: r.name || r.title || r.document_no || r.order_no || r.date,
  }));
const button = (text, href) =>
  `<button class="btn sm" data-go="${esc(href)}">${esc(text)}</button>`;
function exportsHTML() {
  return '<div class="exportbar"><button class="btn sm" data-e-pdf>PDF</button><button class="btn sm" data-e-share>Paylaş</button><button class="btn sm" data-e-print>Yazdır</button><button class="btn sm" data-e-csv>CSV</button></div>';
}
function exportsBind(root, getSpec, getTable) {
  for (const [mode, key] of [
    ["download", "pdf"],
    ["share", "share"],
    ["print", "print"],
  ])
    qs("[data-e-" + key + "]", root)?.addEventListener("click", async () => {
      try {
        await exportDocument(await getSpec(), mode);
      } catch (e) {
        toast(e.message, "err");
      }
    });
  qs("[data-e-csv]", root)?.addEventListener("click", async () => {
    const t = await getTable();
    downloadBlob(
      new Blob(["\ufeff" + core.toCSV(t.headers, t.rows)], {
        type: "text/csv;charset=utf-8",
      }),
      "SAHAPRO_Defter.csv",
    );
  });
}
function spec(title, table, sections = []) {
  return {
    title,
    audience: "internal",
    orientation: table.headers.length > 6 ? "landscape" : "portrait",
    filename: "SAHAPRO_" + title.replace(/[^\p{L}\d]/gu, "_") + ".pdf",
    sections: [...sections, table],
  };
}
function listTable(store, rows, d) {
  const defs = {
    suppliers: [["Firma", "Tür", "Telefon"], (r) => [r.name, r.type, r.phone]],
    payables: [
      [
        "Tarih",
        "Taraf",
        "Belge",
        "Vade",
        "Net",
        "KDV",
        "Toplam",
        "Ödenen",
        "Kalan",
        "Durum",
      ],
      (r) => {
        const b = rules.billBalance(r, active(d, "supplier_payments"));
        return [
          r.date,
          partyName(d, r),
          r.document_no,
          r.due_date,
          amount(r.net_total),
          amount(r.tax_total),
          amount(r.gross_total),
          amount(b.paid),
          amount(b.remaining),
          r.status,
        ];
      },
    ],
    supplier_payments: [
      ["Tarih", "Taraf", "Belge", "Yöntem", "Tutar"],
      (r) => [
        r.date,
        partyName(d, r),
        d.payables.find((b) => b.id === r.payable_id)?.document_no,
        r.method,
        amount(r.amount),
      ],
    ],
    bank_accounts: [
      ["Hesap", "Banka", "Para Birimi", "Bakiye"],
      (r) => [
        r.name,
        r.bank_name,
        "TRY",
        amount(rules.bankBalance(r, active(d, "bank_movements"))),
      ],
    ],
    receivable_plans: [
      ["Müşteri", "Hakediş", "Taksit", "Toplam", "Eşleşen", "Kalan"],
      (r) => {
        const all = rules.planRows(
          r,
          active(d, "settlement_allocations"),
          "9999-12-31",
        );
        return [
          name(d, "customers", r.customer_id),
          r.reference,
          all.length,
          amount(r.amount),
          amount(
            core.fromKurus(all.reduce((s, i) => s + core.toKurus(i.paid), 0)),
          ),
          amount(
            core.fromKurus(
              all.reduce((s, i) => s + core.toKurus(i.remaining), 0),
            ),
          ),
        ];
      },
    ],
    purchase_orders: [
      ["Tarih", "Taraf", "Sipariş", "Teslim", "Durum", "Net", "KDV", "Toplam"],
      (r) => [
        r.date,
        partyName(d, r),
        r.order_no,
        r.expected_date,
        r.status,
        amount(r.net_total),
        amount(r.tax_total),
        amount(r.gross_total),
      ],
    ],
    payroll_entries: [
      ["Tarih", "Personel", "Dönem", "İşlem", "Tutar"],
      (r) => [
        r.date,
        name(d, "personnel", r.personnel_id),
        r.period,
        r.kind,
        amount(r.amount),
      ],
    ],
    service_plans: [
      ["Araç", "Bakım", "Tarih", "Km", "Saat", "Durum"],
      (r) => [
        name(d, "vehicles", r.vehicle_id),
        r.title,
        r.next_date || "—",
        r.next_km ?? "—",
        r.next_hours ?? "—",
        r.status === "Aktif"
          ? rules.serviceState(
              r,
              d.vehicles.find((v) => v.id === r.vehicle_id),
              active(d, "fuel_records"),
            ).status
          : r.status,
      ],
    ],
    activities: [
      ["Takip", "Tür", "Son Tarih", "Durum"],
      (r) => [r.title, r.kind, r.due_date, r.status],
    ],
    expense_categories: [["Kategori", "Grup"], (r) => [r.name, r.group]],
    daily_closings: [
      [
        "Tarih",
        "İş",
        "Yakıt Litre",
        "Tahsilat",
        "Tedarikçi Ödeme",
        "Fiyatsız İş",
        "Eksik Fiş",
      ],
      (r) => [
        r.date,
        r.summary.work_count,
        core.fmtNum(r.summary.fuel_liters),
        amount(r.summary.customer_receipts),
        amount(r.summary.supplier_payments),
        r.summary.missing_price,
        r.summary.missing_slip,
      ],
    ],
    instruments: [
      ["Tür", "Yön", "Taraf", "Belge No", "Vade", "Tutar", "Durum"],
      (r) => [
        r.kind,
        r.direction,
        partyName(d, r),
        r.document_no,
        r.due_date,
        amount(r.amount),
        r.status,
      ],
    ],
  };
  const [headers, row] = defs[store];
  return { headers, rows: rows.map(row) };
}
export async function screen(ctx) {
  const route = ctx.parts[0];
  if (
    !MODULES[route] &&
    ![
      "maliyet",
      "saticicari",
      "banka-tahsilat",
      "banka-transfer",
      "yaslandirma",
    ].includes(route)
  )
    return false;
  const d = await ctx.db.dumpAll();
  if (route === "maliyet") {
    await costReport(ctx, d);
    return true;
  }
  if (route === "saticicari") {
    await supplierLedger(ctx, d);
    return true;
  }
  if (route === "yaslandirma") {
    await agingReport(ctx, d);
    return true;
  }
  if (["banka-tahsilat", "banka-transfer"].includes(route)) {
    await form(ctx, d);
    return true;
  }
  const [store, label] = MODULES[route];
  if (ctx.parts[1] === "new" || ctx.parts[2] === "edit") {
    await form(ctx, d);
    return true;
  }
  if (ctx.parts[1]) {
    const r = d[store].find((r) => r.id === ctx.parts[1] && core.isActive(r));
    if (!r) {
      ctx.root.innerHTML =
        appbar(label) + '<div class="notice danger">Kayıt bulunamadı</div>';
      return true;
    }
    await detail(ctx, d, store, r, label);
    return true;
  }
  await list(ctx, d, store, label);
  return true;
}
async function list(ctx, d, store, label) {
  const { root, query } = ctx;
  const master = [
    "suppliers",
    "bank_accounts",
    "expense_categories",
    "receivable_plans",
    "service_plans",
  ].includes(store);
  root.innerHTML =
    appbar(label, "Kayıtlar · kaynak bağlantıları · PDF") +
    `<form data-e-filter><div class="formgrid2">${master ? "" : fDate("Başlangıç", "from", query.from || "", false) + fDate("Bitiş", "to", query.to || "", false)}</div>${fText("Ara", "q", query.q || "")}${store === "payroll_entries" ? fSelect("Personel", "personnel_id", opts(d, "personnel"), query.personnel_id || "") : ""}${store === "service_plans" ? fSelect("Araç", "vehicle_id", opts(d, "vehicles"), query.vehicle_id || "") : ""}<button class="btn" type="button" data-filter-run>Filtrele</button></form><div class="exportbar">${button("+ Yeni Kayıt", "#/" + ctx.parts[0] + "/new")}${store === "payables" ? button("Tedarikçi Carisi", "#/saticicari") + button("Vade / Yaşlandırma", "#/yaslandirma") : store === "bank_accounts" ? button("Banka Tahsilatı", "#/banka-tahsilat") + button("Hesaplar Arası Transfer", "#/banka-transfer") : store === "receivable_plans" ? button("Vade / Yaşlandırma", "#/yaslandirma") : ""}</div>${exportsHTML()}<div data-e-summary></div><div data-e-list></div>`;
  let table, filtered;
  function run() {
    const f = collectForm(qs("[data-e-filter]", root));
    if (f.from && f.to && f.from > f.to) {
      toast("Tarih aralığı geçersiz", "err");
      return;
    }
    filtered = active(d, store)
      .filter(
        (r) =>
          (!f.from || r.date >= f.from) &&
          (!f.to || r.date <= f.to) &&
          (!f.personnel_id || r.personnel_id === f.personnel_id) &&
          (!f.vehicle_id || r.vehicle_id === f.vehicle_id) &&
          (!query.owner_id || r.owner_id === query.owner_id) &&
          (!query.owner_type || r.owner_type === query.owner_type),
      )
      .sort((a, b) =>
        String(b.date || b.created_at).localeCompare(
          String(a.date || a.created_at),
        ),
      );
    table = listTable(store, filtered, d);
    if (f.q) {
      const selected = filtered.filter((r, i) =>
        table.rows[i]
          .join(" ")
          .toLocaleLowerCase("tr")
          .includes(f.q.toLocaleLowerCase("tr")),
      );
      filtered = selected;
      table = listTable(store, filtered, d);
    }
    qs("[data-e-summary]", root).innerHTML =
      '<div class="notice">' +
      filtered.length +
      " kayıt" +
      (store === "payroll_entries" && f.personnel_id
        ? " · Personel Kalanı: " +
          amount(rules.payrollBalance(active(d, store), f.personnel_id))
        : "") +
      "</div>";
    pagedRender(
      qs("[data-e-list]", root),
      filtered,
      (r) => {
        const i = filtered.indexOf(r);
        return `<div class="card">${table.headers.map((h, n) => kv(h, table.rows[i][n])).join("")}${button("Detay", "#/" + ctx.parts[0] + "/" + r.id)}</div>`;
      },
      25,
    );
  }
  qs("[data-filter-run]", root).onclick = run;
  run();
  exportsBind(
    root,
    () => spec(label, table),
    () => table,
  );
}
function partyFields(d, query, customer = false) {
  const types = Object.entries(rules.PARTY_LABELS)
    .filter(([v]) => customer || v !== "customer")
    .map(([v, t]) => ({ v, t }));
  const type = query.party_type || "supplier";
  return (
    fSelect("Gerçek İşlem Tarafı", "party_type", types, type, {
      empty: false,
    }) +
    fSelect(
      "Firma / Saha",
      "party_id",
      opts(d, rules.PARTY_STORES[type] || "suppliers"),
      query.party_id || "",
      { req: true },
    )
  );
}
function itemForm(d, prefill = []) {
  return `<section><h3>İş / Alış Kalemleri</h3><div data-items></div><button type="button" class="btn" data-add-item>+ Kalem Ekle</button><div class="notice" data-item-total></div></section>`;
}
function initItems(root, d, items = []) {
  const wrap = qs("[data-items]", root);
  if (!wrap) return;
  const workOpts = active(d, "work_records").map((w) => ({
    v: w.id,
    t:
      w.date +
      " · " +
      name(d, "customers", w.customer_id) +
      " · " +
      (w.work_type || "") +
      " · " +
      core.fmtNum(w.quantity) +
      " " +
      w.unit +
      " · " +
      name(d, "vehicles", w.vehicle_id),
  }));
  const add = (i = {}) => {
    const e = document.createElement("div");
    e.className = "card";
    e.dataset.item = "";
    e.innerHTML =
      fText("Kalem Açıklaması", "description", i.description || "", {
        req: true,
      }) +
      `<div class="formgrid2">${fNum("Miktar", "quantity", i.quantity ?? 1, { req: true, step: "any" })}${fSelect("Birim", "unit", [...core.WORK_UNITS, "Adet"], i.unit || "Adet", { empty: false })}${fNum("KDV Hariç Birim Fiyat", "unit_price", i.unit_price ?? "", { req: true, step: "any" })}${fNum("KDV %", "kdv_rate", i.kdv_rate ?? 20, { step: "any" })}</div>` +
      fSelect(
        "İşe Maliyet Bağla (opsiyonel)",
        "work_record_id",
        workOpts,
        i.work_record_id || "",
      ) +
      '<button type="button" class="btn sm danger" data-remove-item>Kalemi Kaldır</button>';
    wrap.append(e);
    qs("[data-remove-item]", e).onclick = () => {
      e.remove();
      update();
    };
    e.oninput = update;
    e.onchange = update;
    update();
  };
  const update = () => {
    try {
      const total = rules.invoiceTotals(
        rules.invoiceLines(qsa("[data-item]", root).map(collectForm)),
      );
      qs("[data-item-total]", root).textContent =
        "Net " +
        amount(total.net_total) +
        " · KDV " +
        amount(total.tax_total) +
        " · Toplam " +
        amount(total.gross_total);
    } catch {
      qs("[data-item-total]", root).textContent =
        "Kalem açıklaması, miktar ve birim fiyatı tamamlayın.";
    }
  };
  qs("[data-add-item]", root).onclick = () => add();
  (items.length ? items : [{}]).forEach(add);
}
async function form(ctx, d) {
  const { root, parts, query } = ctx,
    route = parts[0],
    date = core.todayStr(),
    banks = opts(d, "bank_accounts");
  let title = MODULES[route]?.[1] || "Banka İşlemi",
    html = "",
    save;
  switch (route) {
    case "tedarikciler":
      html =
        fText("Firma Adı", "name", "", { req: true }) +
        fSelect(
          "Tür",
          "type",
          ["Tedarikçi", "Petrolcü", "Servis", "Diğer"],
          "Tedarikçi",
          { empty: false },
        ) +
        fText("Telefon", "phone") +
        fText("Vergi No", "tax_no") +
        fArea("Adres", "address") +
        fArea("Not", "note");
      save = actions.saveSupplier;
      break;
    case "alislar":
    case "satinalma": {
      let source = null;
      if (query.source_store && query.source_id)
        source = d[query.source_store]?.find((r) => r.id === query.source_id);
      const type = query.party_type || source?.party_type || "supplier",
        partyid = query.party_id || source?.party_id || "";
      const initial = source?.items || [];
      html =
        partyFields(d, { party_type: type, party_id: partyid }) +
        fDate("Tarih", "date", date) +
        fText(
          route === "alislar" ? "Belge / Referans No" : "Sipariş No",
          route === "alislar" ? "document_no" : "order_no",
          "",
          { req: true },
        ) +
        fDate(
          route === "alislar" ? "Vade" : "Beklenen Teslim",
          route === "alislar" ? "due_date" : "expected_date",
          date,
        ) +
        (route === "alislar"
          ? fSelect(
              "Borç Türü",
              "bill_kind",
              ["Alış", "Açılış / Devir"],
              "Alış",
              { empty: false },
            )
          : "") +
        fSelect(
          "Maliyet Türü",
          "cost_category",
          [...core.EXPENSE_CATEGORIES, "Taşeron"],
          "Diğer",
          { empty: false },
        ) +
        "<details><summary>Maliyeti müşteri / şantiye / araca bağla (opsiyonel)</summary>" +
        fSelect(
          "Müşteri",
          "customer_id",
          opts(d, "customers"),
          query.customer_id || "",
        ) +
        fSelect("Şantiye", "site_id", opts(d, "sites"), query.site_id || "") +
        fSelect(
          "Araç / Makine",
          "vehicle_id",
          opts(d, "vehicles"),
          query.vehicle_id || "",
        ) +
        "</details>" +
        itemForm(d, initial) +
        fArea("Açıklama", "description") +
        '<div class="field"><label>Orijinal Belge / Fiş Eki (opsiyonel)</label><input type="file" name="attachment" accept="image/*,application/pdf"></div>';
      if (source)
        html =
          '<div class="notice info">Kaynak belgeyle bağlantılı kayıt. Aynı kaynak tekrar borçlandırılamaz.</div>' +
          html;
      save = route === "alislar" ? actions.savePayable : actions.savePurchase;
      break;
    }
    case "odemeler":
      html =
        fSelect(
          "Ödenecek Borç",
          "payable_id",
          active(d, "payables")
            .filter(
              (b) =>
                b.status !== "İptal" &&
                rules.billBalance(b, active(d, "supplier_payments")).remaining >
                  0,
            )
            .map((b) => ({
              v: b.id,
              t:
                partyName(d, b) +
                " · " +
                b.document_no +
                " · Kalan " +
                amount(
                  rules.billBalance(b, active(d, "supplier_payments"))
                    .remaining,
                ),
            })),
          query.payable_id || "",
        ) +
        fDate("Ödeme Tarihi", "date", date) +
        fNum("Ödeme Tutarı", "amount", "", { req: true, step: "any" }) +
        fSelect("Ödeme Yöntemi", "method", ["Nakit", "Banka"], "Nakit", {
          empty: false,
        }) +
        fSelect("Banka Hesabı", "bank_account_id", banks) +
        fArea("Açıklama", "note");
      save = actions.paySupplier;
      break;
    case "bankalar":
      html =
        fText("Hesap Adı", "name", "", { req: true }) +
        fText("Banka", "bank_name") +
        fText("IBAN", "iban") +
        fDate("Açılış Tarihi", "opening_date", date) +
        fNum("Açılış Bakiyesi (TL)", "opening_balance", 0, { step: "any" });
      save = actions.saveBank;
      break;
    case "banka-tahsilat":
      title = "Banka Tahsilatı";
      html =
        fSelect(
          "Müşteri",
          "customer_id",
          opts(d, "customers"),
          query.customer_id || "",
        ) +
        fSelect(
          "Banka Hesabı",
          "bank_account_id",
          banks,
          query.bank_account_id || "",
        ) +
        fDate("Tahsilat Tarihi", "date", date) +
        fNum("Tutar (TL)", "amount", "", { req: true, step: "any" }) +
        fArea("Açıklama", "note");
      save = actions.customerBankReceipt;
      break;
    case "banka-transfer":
      title = "Bankalar Arası Transfer";
      html =
        fSelect("Çıkış Hesabı", "from_id", banks) +
        fSelect("Giriş Hesabı", "to_id", banks) +
        fDate("Tarih", "date", date) +
        fNum("Tutar (TL)", "amount", "", { req: true, step: "any" }) +
        fArea("Açıklama", "note");
      save = actions.transferBanks;
      break;
    case "vadeler":
      html =
        '<div class="notice">Hakedişin mevcut alacağını taksitlere böler. İkinci bir cari borç oluşturmaz.</div>' +
        fSelect(
          "Kesinleşmiş Hakediş",
          "hakedis_id",
          active(d, "hakedis")
            .filter((h) => h.status === "Kesinleşti")
            .map((h) => ({
              v: h.id,
              t:
                "Hakediş " +
                h.hakedis_no +
                " · " +
                name(d, "customers", h.customer_id) +
                " · " +
                amount(h.grand_total),
            })),
          query.hakedis_id || "",
        ) +
        fDate("İlk Vade", "first_due", date) +
        fNum("Taksit Sayısı", "count", 1, { req: true }) +
        fNum("Vade Aralığı (gün)", "days", 30, { req: true });
      save = actions.saveReceivablePlan;
      break;
    case "ucretler":
      html =
        '<div class="notice">Mutabık kalınan ücret ve avans defteridir. SGK/vergi bordrosu hesaplamaz.</div>' +
        fSelect(
          "Personel",
          "personnel_id",
          opts(d, "personnel"),
          query.personnel_id || "",
        ) +
        fDate("İşlem Tarihi", "date", date) +
        fText("Ücret Dönemi (YYYY-AA)", "period", date.slice(0, 7)) +
        fSelect(
          "İşlem",
          "kind",
          ["Ücret Tahakkuku", "Avans", "Ücret Ödemesi", "Kesinti"],
          "Ücret Tahakkuku",
          { empty: false },
        ) +
        fNum("Tutar (TL)", "amount", "", { req: true, step: "any" }) +
        fSelect("Ödeme Yöntemi", "method", ["Nakit", "Banka"], "Nakit", {
          empty: false,
        }) +
        fSelect("Banka Hesabı", "bank_account_id", banks) +
        fArea("Açıklama / Kesinti Gerekçesi", "note");
      save = actions.savePayroll;
      break;
    case "bakimplani":
      html =
        fSelect(
          "Araç / Makine",
          "vehicle_id",
          opts(d, "vehicles"),
          query.vehicle_id || "",
        ) +
        fText("Bakım Adı", "title", "", { req: true }) +
        fDate("Hedef Tarih (opsiyonel)", "next_date", "", false) +
        fNum("Hedef Km (opsiyonel)", "next_km", "", { step: "any" }) +
        fNum("Hedef Makine Saati (opsiyonel)", "next_hours", "", {
          step: "any",
        }) +
        fArea("Not", "note");
      save = actions.saveServicePlan;
      break;
    case "takipler": {
      const types = {
          customer: "Müşteri",
          site: "Şantiye",
          vehicle: "Araç",
          personnel: "Personel",
          quote: "Teklif",
          contract: "Sözleşme",
        },
        stores = {
          customer: "customers",
          site: "sites",
          vehicle: "vehicles",
          personnel: "personnel",
          quote: "quotes",
          contract: "contracts",
        },
        type = query.owner_type || "customer";
      html =
        fSelect(
          "Görev Sahibi Türü",
          "owner_type",
          Object.entries(types).map(([v, t]) => ({ v, t })),
          type,
          { empty: false },
        ) +
        fSelect(
          "İlgili Kayıt",
          "owner_id",
          opts(d, stores[type]),
          query.owner_id || "",
        ) +
        fText("Başlık", "title", "", { req: true }) +
        fSelect(
          "Tür",
          "kind",
          [
            "Telefon",
            "Toplantı",
            "Teklif Takibi",
            "Belge Takibi",
            "Saha Kontrolü",
            "Diğer",
          ],
          "Telefon",
          { empty: false },
        ) +
        fDate("Son Tarih", "due_date", date) +
        fArea("Not", "note");
      save = actions.saveActivity;
      break;
    }
    case "gider-kategorileri":
      html =
        fText("Kategori", "name", "", { req: true }) +
        fText("Grup", "group", "Genel");
      save = actions.saveCategory;
      break;
    case "gun-kapanis":
      html =
        fDate("Kapanış Tarihi", "date", date) +
        fArea("Gün Sonu Notu", "note") +
        '<div class="notice">Kaynak kayıtlar silinmez/kilitlenmez. Kapanış, o anın toplamlarını saklar; sonradan değişiklik varsa detayda fark uyarısı görünür.</div>';
      save = (f, key) => actions.closeDay(f.date, f.note, key);
      break;
    case "ceksenet":
      html =
        partyFields(d, query, true) +
        fSelect("Belge Türü", "kind", ["Çek", "Senet"], "Çek", {
          empty: false,
        }) +
        fSelect("Yön", "direction", ["Alınan", "Verilen"], "Alınan", {
          empty: false,
        }) +
        fText("Belge No", "document_no", "", { req: true }) +
        fText("Banka / Şube", "bank_name") +
        fDate("Tarih", "date", date) +
        fDate("Vade", "due_date", date) +
        fNum("Tutar (TL)", "amount", "", { req: true, step: "any" }) +
        fArea("Not", "note") +
        '<div class="notice">Portföy kaydı para hareketi oluşturmaz. Kapanış aynı tarafa ait gerçek banka tahsilatı/ödemesiyle eşleştirilir.</div>';
      save = actions.saveInstrument;
      break;
  }
  root.innerHTML =
    appbar((parts[2] === "edit" ? "Düzenle · " : "+ ") + title) +
    `<form data-e-form>${html}</form><div class="actionbar"><button class="btn primary" data-e-save>Kaydet</button></div>`;
  const formEl = qs("[data-e-form]", root);
  if (parts[2] === "edit") {
    const store = MODULES[route]?.[0];
    if (!["suppliers", "bank_accounts", "expense_categories"].includes(store))
      throw Error("Bu defter doğrudan düzenlenemez");
    const r = d[store].find((r) => r.id === parts[1]);
    if (!r) throw Error("Kart bulunamadı");
    for (const input of qsa("[name]", formEl))
      if (r[input.name] != null) input.value = r[input.name];
    save = (f) => actions.updateMaster(store, r.id, f);
  }
  initItems(
    root,
    d,
    query.source_store
      ? d[query.source_store]?.find((r) => r.id === query.source_id)?.items
      : query.work_record_id
        ? [
            {
              description: "İş Maliyeti",
              quantity: 1,
              unit: "Adet",
              work_record_id: query.work_record_id,
            },
          ]
        : [],
  );
  const billKind = qs("[name=bill_kind]", root);
  if (billKind) {
    const sync = () => {
      const opening = billKind.value === "Açılış / Devir";
      for (const item of qsa("[data-item]", root)) {
        const tax = qs("[name=kdv_rate]", item),
          work = qs("[name=work_record_id]", item);
        tax.readOnly = opening;
        if (opening) {
          tax.value = "0";
          work.value = "";
        }
        work.disabled = opening;
        work.closest(".field").hidden = opening;
      }
      const cost = qs("[name=cost_category]", root);
      cost.disabled = opening;
      cost.closest(".field").hidden = opening;
    };
    billKind.addEventListener("change", sync);
    qs("[data-add-item]", root).addEventListener("click", sync);
    sync();
  }
  const pt = qs("[name=party_type]", root);
  pt?.addEventListener("change", () => {
    qs("[name=party_id]", root).innerHTML =
      '<option value="">— seç —</option>' +
      opts(d, rules.PARTY_STORES[pt.value])
        .map((o) => `<option value="${esc(o.v)}">${esc(o.t)}</option>`)
        .join("");
  });
  const ot = qs("[name=owner_type]", root);
  ot?.addEventListener("change", () => {
    const store = {
      customer: "customers",
      site: "sites",
      vehicle: "vehicles",
      personnel: "personnel",
      quote: "quotes",
      contract: "contracts",
    }[ot.value];
    qs("[name=owner_id]", root).innerHTML =
      '<option value="">— seç —</option>' +
      opts(d, store)
        .map((o) => `<option value="${esc(o.v)}">${esc(o.t)}</option>`)
        .join("");
  });
  const customer = qs("[name=customer_id]", root),
    site = qs("[name=site_id]", root);
  if (customer && site) {
    const sync = () => {
      site.innerHTML =
        '<option value="">— seç —</option>' +
        active(d, "sites")
          .filter((s) => s.customer_id === customer.value)
          .map((s) => `<option value="${esc(s.id)}">${esc(s.name)}</option>`)
          .join("");
    };
    customer.addEventListener("change", sync);
    sync();
    site.value = query.site_id || "";
  }
  const method = qs("[name=method]", root),
    kind = qs("[name=kind]", root),
    bank = qs("[name=bank_account_id]", root);
  if (method) {
    const sync = () => {
      const pay =
        route !== "ucretler" || ["Avans", "Ücret Ödemesi"].includes(kind.value);
      method.disabled = !pay;
      method.closest(".field").hidden = !pay;
      if (bank) {
        const on = pay && method.value === "Banka";
        bank.disabled = !on;
        bank.closest(".field").hidden = !on;
      }
    };
    method.addEventListener("change", sync);
    kind?.addEventListener("change", sync);
    sync();
  }
  const key = core.uuid();
  let saving = false;
  qs("[data-e-save]", root).onclick = async () => {
    if (saving) return;
    saving = true;
    qs("[data-e-save]", root).disabled = true;
    try {
      const f = collectForm(formEl);
      if (qs("[data-items]", root)) {
        f.items = qsa("[data-item]", root).map(collectForm);
        if (query.source_store && query.source_id) {
          f.source_store = query.source_store;
          f.source_id = query.source_id;
        }
      }
      const r = await save(f, key);
      const file = qs("[name=attachment]", root)?.files[0];
      if (file) {
        try {
          await ctx.db.addAttachment(MODULES[route][0], r.id, file);
        } catch (e) {
          toast("Kayıt kaydedildi; dosya eki yüklenemedi: " + e.message, "err");
        }
      }
      toast("Kayıt ve ilişkileri kaydedildi", "ok");
      go(
        "#/" +
          (MODULES[route] ? route : "bankalar") +
          (MODULES[route] ? "/" + r.id : ""),
      );
    } catch (e) {
      toast(e.message, "err");
    } finally {
      saving = false;
      qs("[data-e-save]", root) && (qs("[data-e-save]", root).disabled = false);
    }
  };
}
async function detail(ctx, d, store, r, label) {
  const { root } = ctx,
    route = routes[store];
  let table = listTable(store, [r], d),
    sections = [{ pairs: table.headers.map((h, i) => [h, table.rows[0][i]]) }],
    extra = "",
    actionsHTML = "";
  if (r.items) {
    table = {
      headers: [
        "Kalem",
        "Miktar",
        "Birim",
        "Birim Fiyat",
        "KDV %",
        "Net",
        "KDV",
        "Toplam",
      ],
      rows: r.items.map((i) => [
        i.description,
        core.fmtNum(i.quantity),
        i.unit,
        amount(i.unit_price),
        i.kdv_rate,
        amount(i.net),
        amount(i.tax),
        amount(i.gross),
      ]),
    };
    sections.push(table);
    extra = r.items
      .map(
        (i) =>
          `<div class="card">${table.headers.map((h, n) => kv(h, table.rows[r.items.indexOf(i)][n])).join("")}${i.work_record_id ? button("Kaynak İş", "#/isler/" + i.work_record_id) : ""}</div>`,
      )
      .join("");
  }
  if (store === "suppliers")
    actionsHTML =
      button(
        "Borç Ekle",
        "#/alislar/new?party_type=supplier&party_id=" + r.id,
      ) +
      button(
        "Cari Ekstre",
        "#/saticicari?party_type=supplier&party_id=" + r.id,
      ) +
      button(
        "Satın Alma",
        "#/satinalma/new?party_type=supplier&party_id=" + r.id,
      );
  if (store === "payables" && r.status !== "İptal") {
    actionsHTML =
      button("Ödeme Yap", "#/odemeler/new?payable_id=" + r.id) +
      '<button class="btn sm danger" data-cancel-bill>Borcu İptal Et</button>';
  }
  if (store === "bank_accounts") {
    const moves = active(d, "bank_movements")
      .filter((m) => m.bank_account_id === r.id)
      .sort((a, b) => a.date.localeCompare(b.date));
    table = {
      headers: ["Tarih", "Yön", "Tutar", "Kaynak", "Not"],
      rows: moves.map((m) => [
        m.date,
        m.direction === "IN" ? "Giriş" : "Çıkış",
        amount(m.amount),
        {
          supplier_payments: "Tedarikçi Ödemesi",
          cash_records: "Müşteri Tahsilatı",
          payroll_entries: "Ücret/Avans",
          bank_transfer: "Transfer",
        }[m.source_store] || "Hareket",
        m.note,
      ]),
    };
    sections.push(table);
    extra = table.rows
      .map(
        (row) =>
          '<div class="card">' +
          table.headers.map((h, i) => kv(h, row[i])).join("") +
          "</div>",
      )
      .join("");
    actionsHTML =
      button("Müşteri Tahsilatı", "#/banka-tahsilat?bank_account_id=" + r.id) +
      button("Transfer", "#/banka-transfer");
  }
  if (store === "receivable_plans") {
    const rows = rules.planRows(r, active(d, "settlement_allocations"));
    table = {
      headers: ["Taksit", "Vade", "Tutar", "Eşleşen", "Kalan", "Durum"],
      rows: rows.map((i) => [
        i.sequence,
        i.due_date,
        amount(i.amount),
        amount(i.paid),
        amount(i.remaining),
        i.bucket,
      ]),
    };
    sections.push(table);
    extra =
      table.rows
        .map(
          (row) =>
            '<div class="card">' +
            table.headers.map((h, i) => kv(h, row[i])).join("") +
            "</div>",
        )
        .join("") +
      `<section class="card"><h3>Mevcut Tahsilatı Eşleştir</h3><form data-allocation>${fSelect(
        "Taksit",
        "installment_id",
        rows
          .filter((i) => i.remaining > 0)
          .map((i) => ({
            v: i.id,
            t:
              i.sequence +
              ". taksit · " +
              i.due_date +
              " · " +
              amount(i.remaining),
          })),
      )}${fSelect(
        "Tahsilat",
        "receipt_id",
        active(d, "cash_records")
          .filter(
            (c) =>
              c.customer_id === r.customer_id &&
              c.cash_type === "Müşteriden Para Alındı",
          )
          .map((c) => ({
            v: c.id,
            t:
              c.date +
              " · " +
              amount(c.amount) +
              " · " +
              (c.description || c.payment_method || "Tahsilat"),
          })),
      )}${fNum("Eşleştirilecek Tutar", "amount", "", { req: true, step: "any" })}<button class="btn primary" type="button" data-allocate>Eşleştir</button></form><p class="tiny">Cari/tahsilat tekrar oluşmaz; mevcut paranın hangi taksiti kapattığı kaydedilir.</p></section>`;
    actionsHTML =
      button("Hakediş", "#/hakedis/" + r.hakedis_id) +
      button(
        "Banka Tahsilatı",
        "#/banka-tahsilat?customer_id=" + r.customer_id,
      );
  }
  if (store === "purchase_orders") {
    if (r.status === "Taslak")
      actionsHTML =
        '<button class="btn primary" data-po-next="Sipariş Verildi">Siparişi Onayla</button>';
    if (r.status === "Sipariş Verildi")
      actionsHTML =
        '<button class="btn primary" data-po-next="Teslim Alındı">Tamamı Teslim Alındı</button>';
    if (r.status === "Teslim Alındı")
      actionsHTML = button(
        "Alış Belgesi / Borç Oluştur",
        "#/alislar/new?source_store=purchase_orders&source_id=" + r.id,
      );
  }
  if (store === "activities" && r.status === "Açık")
    actionsHTML =
      '<button class="btn primary" data-finish-activity>Tamamla</button>';
  if (store === "service_plans" && r.status === "Aktif") {
    const available = active(d, "maintenance_records").filter(
      (m) => m.vehicle_id === r.vehicle_id && m.status === "Tamamlandı",
    );
    extra +=
      fSelect(
        "Tamamlanan Bakım",
        "maintenance_id",
        available.map((m) => ({
          v: m.id,
          t: m.date + " · " + (m.description || m.maint_type),
        })),
      ) +
      '<button class="btn primary" data-service-done>Bakımla Eşleştir ve Kapat</button>';
    actionsHTML =
      button("Bakım Kaydı", "#/bakim/new") +
      button("Araç Kartı", "#/filo/" + r.vehicle_id);
  }
  if (store === "daily_closings") {
    const current = rules.closingSummary(d, r.date);
    extra += `<div class="notice ${JSON.stringify(current) !== JSON.stringify(r.summary) ? "danger" : "info"}">${JSON.stringify(current) !== JSON.stringify(r.summary) ? "Kapanıştan sonra kaynaklar değişti. Saklanan kapanış ile güncel iş raporunu karşılaştırın." : "Kapanış ve güncel kaynak toplamları aynı."}</div>`;
    sections.push({
      pairs: Object.entries(r.summary.units).map(([u, n]) => [
        u,
        core.fmtNum(n),
      ]),
    });
    actionsHTML = button(
      "Güncel İşler",
      "#/raporlar?store=work_records&from=" + r.date + "&to=" + r.date,
    );
  }
  if (store === "instruments") {
    const next =
      {
        Portföyde: ["Bankaya Verildi", "İade"],
        "Bankaya Verildi": ["Kapandı", "Karşılıksız", "İade"],
      }[r.status] || [];
    extra +=
      fSelect("Sonraki Durum", "next_status", next) +
      fSelect(
        "Gerçek Banka Hareketi (kapanış için)",
        "bank_movement_id",
        active(d, "bank_movements").map((m) => ({
          v: m.id,
          t:
            m.date +
            " · " +
            name(d, "bank_accounts", m.bank_account_id) +
            " · " +
            m.direction +
            " · " +
            amount(m.amount),
        })),
      ) +
      '<button class="btn" data-instrument-next>Durumu Güncelle</button>';
  }
  if (["suppliers", "bank_accounts", "expense_categories"].includes(store))
    actionsHTML += button("Kartı Düzenle", "#/" + route + "/" + r.id + "/edit");
  if (r.note || r.description) sections.push({ text: r.note || r.description });
  const attachments = (await ctx.db.getAll("attachments")).filter(
    (a) => a.record_type === store && a.record_id === r.id,
  );
  extra += attachments.map((a) => '<div class="card">' + kv("Orijinal Dosya", a.name) + '<button class="btn" data-original="' + esc(a.id) + '">Orijinal Dosyayı İndir</button></div>').join("");
  root.innerHTML =
    appbar(label) +
    exportsHTML() +
    `<div class="card">${sections[0].pairs.map((p) => kv(...p)).join("")}${r.note || r.description ? kv("Not", r.note || r.description) : ""}</div><div class="exportbar">${actionsHTML}</div>${extra}`;
  exportsBind(
    root,
    () => ({
      store,
      title: label,
      number: r.document_no || r.order_no || "",
      audience: "internal",
      filename: "SAHAPRO_" + route + ".pdf",
      orientation: table.headers.length > 6 ? "landscape" : "portrait",
      sections,
    }),
    () => table,
  );
  for (const b of qsa("[data-original]", root))
    b.onclick = () => {
      const a = attachments.find((a) => a.id === b.dataset.original);
      if (a) downloadBlob(a.blob, a.name);
    };
  const guarded = (selector, fn) => {
    qs(selector, root)?.addEventListener("click", async (e) => {
      const b = e.currentTarget;
      if (b.disabled) return;
      b.disabled = true;
      try {
        await fn();
        toast("İşlem tamamlandı", "ok");
        await ctx.reload();
      } catch (err) {
        toast(err.message, "err");
        b.disabled = false;
      }
    });
  };
  guarded("[data-cancel-bill]", async () => {
    const reason = await promptDialog("Borç İptali", "Gerekçe");
    if (!reason) throw Error("İptal gerekçesi girin");
    await actions.cancelPayable(r.id, reason);
  });
  guarded("[data-allocate]", () =>
    actions.allocateReceipt({
      ...collectForm(qs("[data-allocation]", root)),
      plan_id: r.id,
    }),
  );
  guarded("[data-po-next]", () =>
    actions.transitionPurchase(r.id, qs("[data-po-next]", root).dataset.poNext),
  );
  guarded("[data-finish-activity]", () => actions.finishActivity(r.id));
  guarded("[data-service-done]", () =>
    actions.completeServicePlan(r.id, qs("[name=maintenance_id]", root).value),
  );
  guarded("[data-instrument-next]", () =>
    actions.transitionInstrument(
      r.id,
      qs("[name=next_status]", root).value,
      qs("[name=bank_movement_id]", root).value,
    ),
  );
}
async function supplierLedger(ctx, d) {
  const { root, query } = ctx;
  root.innerHTML =
    appbar("Tedarikçi Cari Ekstre", "Borç · ödeme · kalan") +
    `<form data-ledger>${partyFields(d, query)}<div class="formgrid2">${fDate("Başlangıç", "from", query.from || "", false)}${fDate("Bitiş", "to", query.to || "", false)}</div><button class="btn" type="button" data-ledger-run>Ekstreyi Getir</button></form>` +
    exportsHTML() +
    "<div data-ledger-result></div>";
  qs("[name=party_type]", root).onchange = (e) => {
    qs("[name=party_id]", root).innerHTML =
      '<option value="">— seç —</option>' +
      opts(d, rules.PARTY_STORES[e.target.value])
        .map((o) => `<option value="${esc(o.v)}">${esc(o.t)}</option>`)
        .join("");
  };
  let table = { headers: [], rows: [] },
    title = "Tedarikçi Cari Ekstre";
  const run = () => {
    const f = collectForm(qs("[data-ledger]", root));
    if (!f.party_id) {
      qs("[data-ledger-result]", root).innerHTML =
        '<div class="notice">Ekstre için tarafı seçin.</div>';
      return;
    }
    if (f.from && f.to && f.from > f.to) {
      toast("Tarih aralığı geçersiz", "err");
      return;
    }
    const bills = active(d, "payables").filter(
        (b) =>
          b.status !== "İptal" &&
          b.party_type === f.party_type &&
          b.party_id === f.party_id,
      ),
      payments = active(d, "supplier_payments").filter(
        (p) => p.party_type === f.party_type && p.party_id === f.party_id,
      );
    const all = [
      ...bills.map((b) => ({
        date: b.date,
        type: "Borç",
        ref: b.document_no,
        inc: core.toKurus(b.gross_total),
        id: b.id,
        route: "alislar",
      })),
      ...payments.map((p) => ({
        date: p.date,
        type: "Ödeme",
        ref: d.payables.find((b) => b.id === p.payable_id)?.document_no,
        inc: -core.toKurus(p.amount),
        id: p.id,
        route: "odemeler",
      })),
    ].sort(
      (a, b) => a.date.localeCompare(b.date) || a.type.localeCompare(b.type),
    );
    let balance = all
      .filter((r) => f.from && r.date < f.from)
      .reduce((s, r) => s + r.inc, 0);
    table = {
      headers: ["Tarih", "İşlem", "Belge", "Borç", "Ödeme", "Bakiye"],
      rows: [["", "Açılış/Devir", "", "", "", amount(core.fromKurus(balance))]],
    };
    const shown = all.filter(
      (r) => (!f.from || r.date >= f.from) && (!f.to || r.date <= f.to),
    );
    for (const row of shown) {
      balance += row.inc;
      table.rows.push([
        row.date,
        row.type,
        row.ref,
        row.inc > 0 ? amount(core.fromKurus(row.inc)) : "",
        row.inc < 0 ? amount(core.fromKurus(-row.inc)) : "",
        amount(core.fromKurus(balance)),
      ]);
    }
    title = partyName(d, f) + " — Cari Ekstre";
    qs("[data-ledger-result]", root).innerHTML =
      '<div class="notice">Kalan borç: ' +
      amount(core.fromKurus(balance)) +
      "</div>" +
      table.rows
        .map(
          (row, i) =>
            '<div class="card">' +
            table.headers.map((h, j) => kv(h, row[j])).join("") +
            (i
              ? button(
                  "Kaynak",
                  "#/" + shown[i - 1].route + "/" + shown[i - 1].id,
                )
              : "") +
            "</div>",
        )
        .join("");
  };
  qs("[data-ledger-run]", root).onclick = run;
  run();
  exportsBind(
    root,
    () => spec(title, table),
    () => table,
  );
}
async function agingReport(ctx, d) {
  const { root } = ctx;
  root.innerHTML =
    appbar("Vade / Yaşlandırma") +
    `<form data-aging>${fDate("Rapor Tarihi", "as_of", core.todayStr())}${fSelect(
      "Defter",
      "type",
      [
        { v: "payable", t: "Tedarikçi Borçları" },
        { v: "receivable", t: "Müşteri Alacak Planları" },
      ],
      "payable",
      { empty: false },
    )}<button class="btn" type="button" data-aging-run>Getir</button></form>` +
    exportsHTML() +
    "<div data-aging-result></div>";
  let table;
  const run = () => {
    const f = collectForm(qs("[data-aging]", root));
    try {
      rules.validDate(f.as_of);
    } catch (e) {
      toast(e.message, "err");
      return;
    }
    table = {
      headers: [
        "Taraf",
        "Belge / Taksit",
        "Vade",
        "Kalan",
        "Gecikme Gün",
        "Yaşlandırma",
      ],
      rows:
        f.type === "payable"
          ? rules
              .payableAging(
                active(d, "payables"),
                active(d, "supplier_payments"),
                f.as_of,
              )
              .filter((r) => r.remaining > 0)
              .map((r) => [
                partyName(d, r),
                r.document_no,
                r.due_date,
                amount(r.remaining),
                r.age_days,
                r.bucket,
              ])
          : active(d, "receivable_plans").flatMap((p) =>
              rules
                .planRows(p, active(d, "settlement_allocations"), f.as_of)
                .filter((r) => r.remaining > 0)
                .map((r) => [
                  name(d, "customers", p.customer_id),
                  p.reference + " / " + r.sequence,
                  r.due_date,
                  amount(r.remaining),
                  r.age_days,
                  r.bucket,
                ]),
            ),
    };
    qs("[data-aging-result]", root).innerHTML =
      '<div class="notice">' +
      table.rows.length +
      " açık vade</div><div data-aging-list></div>";
    pagedRender(
      qs("[data-aging-list]", root),
      table.rows,
      (row) =>
        '<div class="card">' +
        table.headers.map((h, i) => kv(h, row[i])).join("") +
        "</div>",
      25,
    );
  };
  qs("[data-aging-run]", root).onclick = run;
  run();
  exportsBind(
    root,
    () => spec("Vade Yaşlandırma", table),
    () => table,
  );
}
async function costReport(ctx, d) {
  const { root, query } = ctx;
  root.innerHTML =
    appbar(
      "İş / Şantiye Maliyet Analizi",
      "KDV ayrımı · kaynağı izlenebilir maliyet",
    ) +
    `<form data-cost-filter><div class="formgrid2">${fDate("Başlangıç", "from", query.from || "", false)}${fDate("Bitiş", "to", query.to || "", false)}</div>${fSelect("Müşteri", "customer_id", opts(d, "customers"), query.customer_id || "")}${fSelect("Şantiye", "site_id", opts(d, "sites"), query.site_id || "")}${fSelect("Araç", "vehicle_id", opts(d, "vehicles"), query.vehicle_id || "")}${fSelect("Personel", "personnel_id", opts(d, "personnel"), query.personnel_id || "")}<button class="btn primary" type="button" data-cost-run>Analizi Getir</button></form>` +
    exportsHTML() +
    "<div data-cost-result></div>";
  let table, summary;
  const run = () => {
    const f = collectForm(qs("[data-cost-filter]", root));
    if (f.from && f.to && f.from > f.to) {
      toast("Tarih aralığı geçersiz", "err");
      return;
    }
    const p = rules.operatingResult(d, f);
    table = {
      headers: [
        "Tarih",
        "Maliyet Türü",
        "Kalem",
        "Müşteri",
        "Şantiye",
        "Araç",
        "Net",
        "KDV",
        "Brüt",
      ],
      rows: p.costs.map((r) => [
        r.date,
        r.category,
        r.description,
        name(d, "customers", r.customer_id),
        name(d, "sites", r.site_id),
        name(d, "vehicles", r.vehicle_id),
        r.known_tax ? amount(r.net) : "KDV Ayrımı Yok",
        r.known_tax ? amount(r.tax) : "Belirtilmedi",
        amount(r.gross),
      ]),
    };
    summary = [
      {
        pairs: [
          ["Kesinleşmiş Gelir (KDV Hariç)", amount(p.revenue)],
          ["KDV Ayrımı Bilinen Maliyet", amount(p.known_cost)],
          ["KDV Ayrımı Olmayan Brüt Maliyet", amount(p.unknown_cost)],
          ["Geçici Operasyon Sonucu", amount(p.provisional_result)],
        ],
      },
      {
        text: "Muhasebe net kârı değildir. Eksik/dağıtılmamış maliyetler sonucu etkiler. KDV ayrımı olmayan maliyetler ihtiyatlı olarak brüt düşülür. Genel giderler müşteri/şantiye filtresinde dağıtılmadıkça görünmez.",
      },
    ];
    qs("[data-cost-result]", root).innerHTML =
      '<div class="card">' +
      summary[0].pairs.map((pair) => kv(...pair)).join("") +
      '</div><div class="notice">' +
      summary[1].text +
      "</div><div data-cost-list></div>";
    pagedRender(
      qs("[data-cost-list]", root),
      p.costs,
      (r) =>
        '<div class="card">' +
        table.headers
          .map((h, i) => kv(h, table.rows[p.costs.indexOf(r)][i]))
          .join("") +
        button(
          "Maliyet Kaynağı",
          "#/" +
            {
              payables: "alislar",
              expense_records: "gider",
              fuel_records: "yakit",
              maintenance_records: "bakim",
              payroll_entries: "ucretler",
            }[r.source_store] +
            "/" +
            r.source_id,
        ) +
        (r.work_record_id
          ? button("Kaynak İş", "#/isler/" + r.work_record_id)
          : "") +
        "</div>",
      25,
    );
  };
  qs("[data-cost-run]", root).onclick = run;
  run();
  exportsBind(
    root,
    () => spec("Maliyet Analizi", table, summary),
    () => table,
  );
}
export async function augment(ctx) {
  const { root, parts } = ctx,
    route = parts[0],
    id = parts[1];
  if (["new", "edit", "imza"].some((p) => parts.includes(p))) return;
  let links = "";
  if (route === "daha" || route === "finans")
    links =
      Object.entries(MODULES)
        .map(([r, [, label]]) => button(label, "#/" + r))
        .join("") +
      button("Maliyet Analizi", "#/maliyet") +
      button("Tedarikçi Cari", "#/saticicari") +
      button("Vade Yaşlandırma", "#/yaslandirma");
  if (id) {
    const contexts = {
      musteriler: ["customer", "customer_id"],
      santiyeler: ["site", "site_id"],
      filo: ["vehicle", "vehicle_id"],
      personel: ["personnel", "personnel_id"],
      teklif: ["quote", null],
      sozlesmeler: ["contract", null],
    };
    if (contexts[route]) {
      const [type, key] = contexts[route];
      links +=
        button(
          "Takip Görevi",
          "#/takipler/new?owner_type=" + type + "&owner_id=" + id,
        ) +
        button("Takipler", "#/takipler?owner_type=" + type + "&owner_id=" + id);
      if (key)
        links += button("Maliyet Analizi", "#/maliyet?" + key + "=" + id);
    }
    if (route === "filo")
      links +=
        button("Bakım Planı Ekle", "#/bakimplani/new?vehicle_id=" + id) +
        button("Bakım Planları", "#/bakimplani?vehicle_id=" + id);
    if (route === "personel")
      links += button("Ücret/Avans", "#/ucretler?personnel_id=" + id);
    if (route === "hakedis")
      links += button("Vade Planı", "#/vadeler/new?hakedis_id=" + id);
    if (["taseron", "dokum", "ocak"].includes(route)) {
      const type = {
        taseron: "contractor",
        dokum: "dump_site",
        ocak: "quarry",
      }[route];
      links +=
        button(
          "Borç Ekle",
          "#/alislar/new?party_type=" + type + "&party_id=" + id,
        ) +
        button("Cari", "#/saticicari?party_type=" + type + "&party_id=" + id);
    }
    if (route === "isler") {
      const w = await ctx.db.get("work_records", id);
      links += button(
        "İşe Maliyet Ekle",
        "#/alislar/new?customer_id=" +
          w.customer_id +
          (w.site_id ? "&site_id=" + w.site_id : "") +
          "&vehicle_id=" +
          w.vehicle_id +
          "&work_record_id=" +
          id,
      );
    }
    if (["gider", "yakit", "bakim"].includes(route))
      links += button(
        "Tedarikçi Borcuna Bağla",
        "#/alislar/new?source_store=" +
          {
            gider: "expense_records",
            yakit: "fuel_records",
            bakim: "maintenance_records",
          }[route] +
          "&source_id=" +
          id,
      );
  }
  if (route === "personel" && id) {
    const rows = await ctx.db.listActive("payroll_entries");
    root.insertAdjacentHTML(
      "beforeend",
      '<div class="card">' +
        kv("Ücret / Avans Kalanı", amount(rules.payrollBalance(rows, id))) +
        "</div>",
    );
  }
  if (route === "gunsonu")
    links += button("Gün Sonunu Sakla", "#/gun-kapanis/new");
  if (route === "yonetici")
    links += button("Kaynaklı Maliyet Analizi", "#/maliyet");
  if (route === "raporlar")
    links +=
      button("Maliyet", "#/maliyet") +
      button("Tedarikçi Cari", "#/saticicari") +
      button("Vade", "#/yaslandirma") +
      button("Ücret/Avans", "#/ucretler");
  if (links)
    root.insertAdjacentHTML(
      "beforeend",
      '<section class="card"><h3>İşletme Defterleri</h3><div class="enterprise-links">' +
        links +
        "</div></section>",
    );
  if (route === "belgeler" && !id) {
    const files = (await ctx.db.getAll("attachments")).filter((a) =>
      ["payables", "purchase_orders"].includes(a.record_type),
    );
    if (files.length) {
      root.insertAdjacentHTML(
        "beforeend",
        '<section class="card"><h3>Bağlı İşletme Belgeleri</h3><div data-enterprise-files></div></section>',
      );
      pagedRender(
        qs("[data-enterprise-files]", root),
        files,
        (a) =>
          '<div class="card">' +
          kv("Orijinal Dosya", a.name) +
          button(
            "Asıl Kaydı Aç",
            "#/" + routes[a.record_type] + "/" + a.record_id,
          ) +
          "</div>",
        25,
      );
    }
  }
  if (route === "") {
    const d = await ctx.db.dumpAll();
    const late = rules
      .payableAging(active(d, "payables"), active(d, "supplier_payments"))
      .filter((r) => r.remaining > 0 && r.age_days > 0);
    const tasks = active(d, "activities").filter(
      (r) => r.status === "Açık" && r.due_date <= core.todayStr(),
    );
    const plans = active(d, "service_plans").filter(
      (r) =>
        r.status === "Aktif" &&
        rules.serviceState(
          r,
          d.vehicles.find((v) => v.id === r.vehicle_id),
          active(d, "fuel_records"),
        ).status !== "Planlı",
    );
    if (late.length || tasks.length || plans.length)
      root.insertAdjacentHTML(
        "beforeend",
        '<section class="card"><h3>İşletme Uyarıları</h3>' +
          button(late.length + " Vadeli Borç", "#/yaslandirma") +
          button(tasks.length + " Takip Görevi", "#/takipler") +
          button(plans.length + " Bakım Uyarısı", "#/bakimplani") +
          "</section>",
      );
  }
}
