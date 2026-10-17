import {
  messageWorkbench,
  memoryScreen,
  messageQueueTools,
} from "./message-smart-ui.js";
import * as core from "./core.js";
import * as rules from "./solo-core.js";
import * as actions from "./solo-db.js";
import * as ui from "./ui.js";
import {
  costLedger,
  bankBalance,
  serviceState,
  planRows,
  payrollBalance,
} from "./enterprise-core.js";
import { exportDocument, buildDocument } from "./document-engine.js";
import qrcode from "../vendor/qrcode.js";
import { voiceSupported, startVoice } from "./parser.js";
import { recordSpec } from "./pro.js";
import { slipSpec, hakedisSpec, commercialSpec } from "./pdf.js";
const {
  qs,
  qsa,
  esc,
  appbar,
  fText,
  fNum,
  fDate,
  fSelect,
  fArea,
  collectForm,
  kv,
  pagedRender,
  toast,
  go,
  downloadBlob,
  confirmDialog,
} = ui;
const MODULES = {
  sayac: ["meter_readings", "Sayaç Okumaları"],
  vardiya: ["shift_assignments", "Görev / Çalışma Planı"],
  zimmet: ["custody_records", "Zimmet Teslim / İade"],
  duruslar: ["downtime_records", "Arıza ve Duruş Süreleri"],
  parcalar: ["maintenance_parts", "Bakım Parça / İşçilik"],
  dagitim: ["cost_allocations", "Ortak Maliyet Dağıtımı"],
  "banka-aktarim": ["bank_import_rows", "Banka Dosyası / Mutabakat"],
  mesajlar: ["inbox_messages", "Mesaj Gelen Kutusu"],
  sayim: ["stock_counts", "Tank Fiziksel Sayımı"],
};
const extra = [
  "arsiv",
  "qr",
  "sonuc",
  "asistan",
  "musteri-paketi",
  "bakim-yenile",
  "teklif-sonuc",
  "mesaj-hafizasi",
];
const money = (v) => (v == null ? "Belirtilmedi" : core.fmtTL(v) + " TL");
const button = (label, href) =>
  `<button class="btn" data-go="${esc(href)}">${esc(label)}</button>`;
const options = (d, s) =>
  rules.live(d, s).map((r) => ({
    v: r.id,
    t: r.name || r.doc_no || r.title || r.description || r.maint_type || r.date,
  }));
const table = (headers, rows) => ({ headers, rows });
const spec = (title, sections) => ({
  title,
  audience: "internal",
  orientation: sections.some((s) => s.headers?.length > 6)
    ? "landscape"
    : "portrait",
  sections,
  filename: "SAHAPRO_" + title.replace(/[^\p{L}\d]/gu, "_") + ".pdf",
});
const toolbar = () =>
  '<div class="exportbar"><button class="btn" data-s-pdf>PDF</button><button class="btn" data-s-share>Paylaş</button><button class="btn" data-s-print>Yazdır</button><button class="btn" data-s-csv>CSV</button></div>';
function bindExport(root, getSpec, getTable) {
  for (const [mode, key] of [
    ["download", "pdf"],
    ["share", "share"],
    ["print", "print"],
  ])
    qs("[data-s-" + key + "]", root)?.addEventListener("click", () =>
      safe(() => exportDocument(getSpec(), mode)),
    );
  qs("[data-s-csv]", root)?.addEventListener("click", () =>
    safe(() => {
      const t = getTable();
      downloadBlob(
        new Blob(["\ufeff" + core.toCSV(t.headers, t.rows)], {
          type: "text/csv;charset=utf-8",
        }),
        "SAHAPRO_Rapor.csv",
      );
    }),
  );
}
async function safe(fn) {
  try {
    return await fn();
  } catch (e) {
    toast(e.message || String(e), "err");
  }
}
function saveBind(root, fn) {
  const key = core.uuid();
  qs("[data-s-save]", root).onclick = async () => {
    const b = qs("[data-s-save]", root);
    b.disabled = true;
    try {
      const r = await fn(collectForm(qs("form", root)), key);
      if (r === false) return;
      toast("Kayıt kalıcı olarak kaydedildi", "ok");
      return r;
    } catch (e) {
      toast(e.message, "err");
    } finally {
      b.disabled = false;
    }
  };
}
function contextFields(d, q = {}) {
  return (
    fSelect(
      "Müşteri (opsiyonel)",
      "customer_id",
      options(d, "customers"),
      q.customer_id || "",
    ) +
    fSelect(
      "Şantiye (opsiyonel)",
      "site_id",
      options(d, "sites"),
      q.site_id || "",
    )
  );
}
function contextBind(root, d) {
  const c = qs("[name=customer_id]", root),
    s = qs("[name=site_id]", root);
  if (!c || !s) return;
  const sync = () => {
    const prior = s.value;
    s.innerHTML =
      '<option value="">— seç —</option>' +
      rules
        .live(d, "sites")
        .filter((r) => r.customer_id === c.value)
        .map((r) => `<option value="${esc(r.id)}">${esc(r.name)}</option>`)
        .join("");
    s.value = prior;
  };
  c.onchange = sync;
  sync();
}
export async function screen(ctx) {
  const route = ctx.parts[0];
  if (!MODULES[route] && !extra.includes(route)) return false;
  const d = await ctx.db.dumpAll();
  if (route === "mesaj-hafizasi") {
    await memoryScreen(ctx, d);
    return true;
  }
  if (route === "arsiv") {
    await archive(ctx, d);
    return true;
  }
  if (route === "qr") {
    await qrScreen(ctx, d);
    return true;
  }
  if (route === "teklif-sonuc") {
    await quoteResult(ctx, d);
    return true;
  }
  if (route === "sonuc") {
    await resultScreen(ctx, d);
    return true;
  }
  if (route === "asistan") {
    await assistant(ctx, d);
    return true;
  }
  if (route === "musteri-paketi") {
    await customerPack(ctx, d);
    return true;
  }
  if (route === "bakim-yenile") {
    await renewal(ctx, d);
    return true;
  }
  const [store, title] = MODULES[route];
  if (ctx.parts[1] === "new") await form(ctx, d, store, title);
  else if (ctx.parts[1]) await detail(ctx, d, store, title, ctx.parts[1]);
  else await list(ctx, d, store, title);
  return true;
}
function rowsTable(store, rows, d) {
  const defs = {
    meter_readings: [
      ["Tarih", "Araç", "Sayaç", "Okuma", "Not"],
      (r) => [
        r.date,
        rules.label(d, "vehicles", r.vehicle_id),
        r.kind === "km" ? "Km" : "Makine Saati",
        r.value,
        r.note,
      ],
    ],
    shift_assignments: [
      [
        "Tarih",
        "Personel",
        "Araç",
        "Görev",
        "Başlangıç",
        "Bitiş",
        "Saat",
        "Durum",
      ],
      (r) => [
        r.date,
        rules.label(d, "personnel", r.personnel_id),
        rules.label(d, "vehicles", r.vehicle_id),
        r.task,
        r.start,
        r.end,
        r.hours,
        r.status,
      ],
    ],
    custody_records: [
      ["Teslim", "Personel", "Varlık", "Durum", "İade"],
      (r) => [
        r.date,
        rules.label(d, "personnel", r.personnel_id),
        r.asset_name ||
          rules.label(d, rules.CUSTODY_OWNERS[r.owner_type], r.owner_id),
        r.status,
        r.returned_date,
      ],
    ],
    downtime_records: [
      ["Araç", "Başlangıç", "Bitiş", "Neden", "Duruş Saat", "Durum"],
      (r) => [
        rules.label(d, "vehicles", r.vehicle_id),
        r.started_at,
        r.ended_at,
        r.reason,
        rules.downtimeHours(r),
        r.status,
      ],
    ],
    maintenance_parts: [
      ["Araç", "Tür", "Açıklama", "Miktar", "Birim fiyat", "Tutar"],
      (r) => [
        rules.label(d, "vehicles", r.vehicle_id),
        r.kind,
        r.description,
        r.quantity,
        money(r.unit_price),
        money(r.total),
      ],
    ],
    cost_allocations: [
      ["Tarih", "Kategori", "Kaynak tutar", "Hedef sayısı", "Durum"],
      (r) => [
        r.date,
        r.source_snapshot.category,
        money(r.source_snapshot.gross),
        r.targets.length,
        r.status,
      ],
    ],
    bank_import_rows: [
      ["Tarih", "Hesap", "Yön", "Tutar", "Açıklama", "Referans", "Durum"],
      (r) => [
        r.date,
        rules.label(d, "bank_accounts", r.bank_account_id),
        r.direction === "IN" ? "Giriş" : "Çıkış",
        money(r.amount),
        r.description,
        r.reference,
        r.status,
      ],
    ],
    inbox_messages: [
      ["Tarih", "Gönderen", "Mesaj", "Durum"],
      (r) => [
        r.date || "Tarih bekliyor",
        r.sender || "Belirtilmedi",
        r.text,
        r.status,
      ],
    ],
    stock_counts: [
      ["Tarih", "Teorik L", "Fiziksel L", "Fark L", "Gerekçe"],
      (r) => [
        r.date,
        r.theoretical_liters,
        r.physical_liters,
        r.difference,
        r.reason,
      ],
    ],
  };
  const [h, fn] = defs[store];
  return table(h, rows.map(fn));
}
async function list(ctx, d, store, title) {
  const { root, query, parts } = ctx;
  let rows = rules
    .live(d, store)
    .filter(
      (r) =>
        (!query.from || r.date >= query.from) &&
        (!query.to || r.date <= query.to) &&
        [
          "vehicle_id",
          "personnel_id",
          "customer_id",
          "site_id",
          "bank_account_id",
        ].every((k) => !query[k] || r[k] === query[k]) &&
        (!query.q ||
          core.normKey(JSON.stringify(r)).includes(core.normKey(query.q))),
    )
    .reverse();
  root.innerHTML =
    appbar(title, rows.length + " kayıt") +
    `<div class="solo-intro">${store === "bank_import_rows" ? "Dosyadan gelen satırlar onaylanmadan hesap/cari bakiyesini değiştirmez." : store === "inbox_messages" ? "Mesajlar taslaktır. İş ve yakıt kayıtları ayrı kontrol ekranından onaylanır." : store === "maintenance_parts" ? "Bu kalemler bakım maliyetinin dökümüdür; toplam maliyete ikinci kez eklenmez." : "Kayıtlar bu cihazda saklanır; değişiklikler izlenir."}</div><form data-filter><div class="formgrid2">${fDate("Başlangıç", "from", query.from || "", false)}${fDate("Bitiş", "to", query.to || "", false)}</div>${fText("Ara", "q", query.q || "")}<button class="btn" type="submit">Filtrele</button></form>${button(store === "inbox_messages" ? "Mesaj / Dosya Ekle" : store === "bank_import_rows" ? "CSV Dosyası Seç" : "Yeni Kayıt", "#/" + parts[0] + "/new")}${toolbar()}<div data-s-list></div>`;
  qs("[data-filter]", root).onsubmit = (e) => {
    e.preventDefault();
    go(
      "#/" +
        parts[0] +
        "?" +
        new URLSearchParams({ ...query, ...collectForm(e.target) }),
    );
  };
  const t = rowsTable(store, rows, d);
  pagedRender(
    qs("[data-s-list]", root),
    rows,
    (r, i) =>
      `<section class="card">${t.headers.map((h, j) => kv(h, esc(t.rows[rows.indexOf(r)][j] ?? ""))).join("")}${store === "inbox_messages" && r.status === "Taslak" && !r.merge_parent_id && !r.review_rows?.length && !r.source_messages?.length ? `<label class="history-check"><input type="checkbox" data-queue-select="${esc(r.id)}"> Birleştirme için seç</label>` : ""}${button("Detay", "#/" + parts[0] + "/" + r.id)}</section>`,
  );
  if (store === "inbox_messages") messageQueueTools(ctx, d, rows);
  bindExport(
    root,
    () => spec(title, [t]),
    () => t,
  );
}
async function form(ctx, d, store, title) {
  const { root, query: q, parts } = ctx;
  const date = core.todayStr();
  if (store === "inbox_messages") return messageForm(ctx, d);
  if (store === "bank_import_rows") return bankForm(ctx, d);
  let fields = "",
    save;
  switch (store) {
    case "meter_readings":
      fields =
        fDate("Okuma tarihi", "date", date) +
        fSelect(
          "Araç / Makine",
          "vehicle_id",
          options(d, "vehicles"),
          q.vehicle_id || "",
        ) +
        fSelect(
          "Sayaç",
          "kind",
          [
            { v: "km", t: "Kilometre" },
            { v: "hours", t: "Makine saati" },
          ],
          "km",
          { empty: false },
        ) +
        fNum("Sayaç değeri", "value", "", { req: true, step: "any" }) +
        fArea("Not", "note");
      save = actions.saveMeter;
      break;
    case "shift_assignments":
      fields =
        fDate("Görev tarihi", "date", date) +
        fSelect(
          "Personel",
          "personnel_id",
          options(d, "personnel"),
          q.personnel_id || "",
        ) +
        fSelect(
          "Araç (opsiyonel)",
          "vehicle_id",
          options(d, "vehicles"),
          q.vehicle_id || "",
        ) +
        contextFields(d, q) +
        fText("Görev", "task", "", { req: true }) +
        `<div class="formgrid2">${fText("Başlangıç", "start", "08:00", { type: "time" })}${fText("Bitiş", "end", "17:00", { type: "time" })}</div>` +
        fNum("Mola dakika", "break_minutes", 60) +
        fArea("Not", "note");
      save = actions.saveShift;
      break;
    case "custody_records":
      fields =
        fDate("Teslim tarihi", "date", date) +
        fSelect(
          "Personel",
          "personnel_id",
          options(d, "personnel"),
          q.personnel_id || "",
        ) +
        fSelect(
          "Varlık türü",
          "owner_type",
          [
            { v: "vehicle", t: "Araç / Makine" },
            { v: "document", t: "Fiziksel Belge" },
            { v: "equipment", t: "Ekipman" },
          ],
          q.owner_type || "vehicle",
          { empty: false },
        ) +
        "<div data-custody-owner></div>" +
        fArea("Teslim notu", "note");
      save = actions.saveCustody;
      break;
    case "downtime_records":
      fields =
        fSelect(
          "Araç / Makine",
          "vehicle_id",
          options(d, "vehicles"),
          q.vehicle_id || "",
        ) +
        fSelect(
          "İlgili arıza/bakım (opsiyonel)",
          "maintenance_id",
          options(d, "maintenance_records"),
          q.maintenance_id || "",
        ) +
        fText(
          "Duruş başlangıcı",
          "started_at",
          new Date(Date.now() - new Date().getTimezoneOffset() * 60000)
            .toISOString()
            .slice(0, 16),
          { type: "datetime-local" },
        ) +
        fArea("Duruş nedeni", "reason");
      save = (f, k) =>
        actions.saveDowntime(
          { ...f, started_at: new Date(f.started_at).toISOString() },
          k,
        );
      break;
    case "maintenance_parts":
      fields =
        fSelect(
          "Bakım / Arıza",
          "maintenance_id",
          options(d, "maintenance_records"),
          q.maintenance_id || "",
        ) +
        fSelect("Kalem türü", "kind", ["Parça", "İşçilik"], "Parça", {
          empty: false,
        }) +
        fText("Parça/işçilik açıklaması", "description", "", { req: true }) +
        fNum("Miktar", "quantity", 1, { step: "any" }) +
        fNum("Birim fiyat TL", "unit_price", "", { step: "any" }) +
        fArea("Not", "note");
      save = actions.savePart;
      break;
    case "stock_counts":
      fields =
        '<p class="notice warn">Gerçek ölçüm yapın. Fark, tek bir gerekçeli tank hareketi oluşturur; eski yakıt yeniden düşülmez.</p>' +
        fDate("Sayım tarihi", "date", date) +
        fNum("Ölçülen fiziksel litre", "physical_liters", "", { step: "any" }) +
        fArea("Stok farkı gerekçesi", "reason");
      save = actions.countStock;
      break;
    case "cost_allocations":
      return allocationForm(ctx, d);
  }
  root.innerHTML =
    appbar(title, "Yeni kayıt") +
    `<form data-s-form>${fields}<button class="btn primary block" type="button" data-s-save>Kontrol Et ve Kaydet</button></form>`;
  contextBind(root, d);
  if (store === "custody_records") {
    const sync = () => {
      const type = qs("[name=owner_type]", root).value;
      qs("[data-custody-owner]", root).innerHTML =
        type === "equipment"
          ? fText("Ekipman adı / kodu", "asset_name", "", { req: true })
          : fSelect(
              "Varlık",
              "owner_id",
              options(d, rules.CUSTODY_OWNERS[type]),
              q.owner_id || "",
            );
    };
    qs("[name=owner_type]", root).onchange = sync;
    sync();
  }
  saveBind(root, async (f, k) => {
    const r = await save(f, k);
    go("#/" + parts[0] + "/" + r.id);
    return r;
  });
}
async function detail(ctx, d, store, title, id) {
  const { root, parts } = ctx;
  const r = rules.reference(d, store, id);
  if (store === "inbox_messages") return messageDetail(ctx, d, r);
  if (store === "bank_import_rows") return bankDetail(ctx, d, r);
  const t = rowsTable(store, [r], d);
  root.innerHTML =
    appbar(title, "Kayıt detayı") +
    toolbar() +
    '<section class="card">' +
    t.headers.map((h, i) => kv(h, esc(t.rows[0][i] ?? ""))).join("") +
    "</section><div data-s-actions></div>";
  let sections = [t];
  const a = qs("[data-s-actions]", root);
  if (store === "shift_assignments" && r.status === "Planlı") {
    a.innerHTML =
      fArea("İptal gerekçesi", "reason") +
      '<button class="btn" data-complete>Tamamlandı</button><button class="btn danger" data-cancel>İptal</button>';
    qs("[data-complete]", root).onclick = () =>
      safe(async () => {
        await actions.shiftStatus(id, "Tamamlandı", "");
        ctx.reload();
      });
    qs("[data-cancel]", root).onclick = () =>
      safe(async () => {
        await actions.shiftStatus(id, "İptal", qs("[name=reason]", root).value);
        ctx.reload();
      });
  }
  if (store === "custody_records" && r.status === "Teslim Edildi") {
    a.innerHTML =
      fDate("İade tarihi", "date", core.todayStr()) +
      fArea("İade kontrol notu", "note") +
      '<button class="btn primary" data-return>İade Al</button>';
    qs("[data-return]", root).onclick = () =>
      safe(async () => {
        await actions.returnCustody(
          id,
          qs("[name=date]", root).value,
          qs("[name=note]", root).value,
        );
        ctx.reload();
      });
  }
  if (store === "downtime_records" && !r.ended_at) {
    a.innerHTML =
      fText("Duruş bitişi", "ended_at", "", { type: "datetime-local" }) +
      fArea("Kapanış notu", "note") +
      '<button class="btn primary" data-close>Duruşu Kapat</button>';
    qs("[data-close]", root).onclick = () =>
      safe(async () => {
        await actions.closeDowntime(
          id,
          new Date(qs("[name=ended_at]", root).value).toISOString(),
          qs("[name=note]", root).value,
        );
        ctx.reload();
      });
  }
  if (store === "cost_allocations") {
    const rows = r.targets.map((t) => [
      rules.label(d, "customers", t.customer_id),
      rules.label(d, "sites", t.site_id),
      rules.label(d, "vehicles", t.vehicle_id),
      t.weight,
      money(t.net),
      money(t.gross),
    ]);
    const target = table(
      ["Müşteri", "Şantiye", "Araç", "Ağırlık", "Net", "KDV dahil"],
      rows,
    );
    sections.push(target);
    a.innerHTML =
      '<section class="card">' +
      rows.map((row) => row.map(esc).join(" · ")).join("<hr>") +
      "</section>";
    if (r.status === "Aktif") {
      a.insertAdjacentHTML(
        "beforeend",
        fArea("İptal gerekçesi", "reason") +
          '<button class="btn danger" data-cancel>Dağıtımı İptal Et</button>',
      );
      qs("[data-cancel]", root).onclick = () =>
        safe(async () => {
          await actions.cancelAllocation(id, qs("[name=reason]", root).value);
          ctx.reload();
        });
    }
  }
  bindExport(
    root,
    () => spec(title, sections),
    () => t,
  );
}
function messageCards(m, d) {
  const rows = rules.messageReview(m, d);
  return (
    rows
      .map(
        (r, i) =>
          `<article class="message-review-card"><div class="row"><h3>${i + 1}. ${r.kind === "fuel" ? "Yakıt satırı" : "İş satırı"}</h3><span class="message-status ${r.issues.length ? "pending" : "matched"}">${esc(r.review_status)}</span></div><dl class="message-fields">${[
            ["Tarih", r.date || "Belirtilmedi"],
            ["Araç", rules.label(d, "vehicles", r.vehicle_id)],
            [
              "Müşteri",
              r.kind === "fuel"
                ? "Yakıt için zorunlu değil"
                : rules.label(d, "customers", r.customer_id),
            ],
            ["Şantiye", rules.label(d, "sites", r.site_id)],
            ["Personel", rules.label(d, "personnel", r.personnel_id)],
            [
              "Yapılan iş",
              r.kind === "fuel" ? "Yakıt alımı" : r.work_type || "Belirtilmedi",
            ],
            [
              "Miktar",
              r.kind === "fuel"
                ? r.fuel_liters + " L"
                : (r.quantity ?? "?") + " " + (r.unit || "?"),
            ],
          ]
            .map(
              ([k, v]) =>
                `<div><dt>${esc(k)}</dt><dd>${esc(String(v))}</dd></div>`,
            )
            .join(
              "",
            )}</dl><details><summary>Kaynak metin ve eşleşmeler</summary><p class="wrap">${esc(r.description)}</p>${Object.values(
            r.candidates,
          )
            .filter((x) => x.length > 1)
            .map(
              (x) => `<p>Adaylar: ${x.map((a) => esc(a.name)).join(" · ")}</p>`,
            )
            .join(
              "",
            )}<p>Gönderen operatör olarak atanmaz. Eşleşmeler bu cihazdaki kartlar ve tanımlı takma adlardan gelir.</p></details>${r.issues.length ? `<ul class="message-issues">${r.issues.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : ""}<p class="notice">${r.kind === "fuel" ? "Yakıt kaynağını son kontrol ekranında doğrulayın." : "Fiyat, KDV ve hesap durumu son kontrol ekranında doğrulanır."}</p></article>`,
      )
      .join("") || '<p class="notice">Ayrıştırılacak satır bulunamadı.</p>'
  );
}
async function messageForm(ctx, d) {
  const { root } = ctx;
  root.innerHTML =
    appbar("Mesaj Gelen Kutusu", "WhatsApp dışa aktarımı veya metin") +
    `<section class="solo-intro">Gönderen otomatik şoför kabul edilmez. Mesajlar taslak olarak saklanır; kayıt için tarih ve alanlar ayrıca onaylanır.</section><form>${fNum("Mesajlarda yıl yoksa gerçek yıl", "year", new Date().getFullYear())}<label class="field">WhatsApp .txt dosyası<input type="file" accept=".txt,text/plain" data-message-file></label>${fArea("Mesajlar", "raw")}<p class="notice">1 · Mesajı ekle &nbsp; 2 · Ayrıştırmayı incele &nbsp; 3 · Taslağı kaydet. İş kaydı sonraki kontrol ekranında oluşur.</p><button type="button" class="btn" data-message-preview>Ayrıştır ve Önizle</button><div data-message-preview-result aria-live="polite"></div><div class="row">${voiceSupported() ? '<button type="button" class="btn" data-voice>Sesle Yazdır</button>' : ""}<button type="button" class="btn primary" data-s-save disabled>Mesajları Taslak Olarak Al</button></div></form>`;
  let reviewed = null;
  const fingerprint = () =>
    JSON.stringify([
      qs("[name=raw]", root).value,
      qs("[name=year]", root).value,
    ]);
  const invalidate = () => {
    reviewed = null;
    qs("[data-s-save]", root).disabled = true;
    qs("[data-message-preview-result]", root).innerHTML = "";
  };
  qs("form", root).addEventListener("input", invalidate);
  qs("[data-message-preview]", root).onclick = () =>
    safe(async () => {
      const blocks = rules.messages(
        qs("[name=raw]", root).value,
        qs("[name=year]", root).value,
      );
      const existing = new Set(
          rules.live(d, "inbox_messages").map((x) => x.source_key),
        ),
        seen = new Set(existing);
      const preview = blocks.map((m) => {
        const duplicate = seen.has(m.source_key);
        seen.add(m.source_key);
        return { ...m, duplicate };
      });
      const counts = preview.reduce(
        (a, m) => {
          if (m.duplicate) a.repeat++;
          else
            for (const r of rules.messageReview(m, d)) {
              a[r.kind]++;
              if (r.issues.length) a.check++;
            }
          return a;
        },
        { work: 0, fuel: 0, check: 0, repeat: 0 },
      );
      qs("[data-message-preview-result]", root).innerHTML =
        `<section class="card"><h2>Ayrıştırma özeti</h2><p>${blocks.length} mesaj · ${counts.work} iş · ${counts.fuel} yakıt · ${counts.check} kontrol bekleyen satır · ${counts.repeat} tekrar</p><p class="notice">Henüz hiçbir kayıt oluşturulmadı. Eksikler taslakta tutulur; son kontrol ekranında tamamlanır.</p><div data-message-pages></div></section>`;
      pagedRender(
        qs("[data-message-pages]", root),
        preview,
        (m) =>
          `<section class="message-block"><h3>${esc(m.sender || "Gönderen belirtilmedi")} · ${esc(m.date || "Tarih belirtilmedi")}</h3>${m.duplicate ? '<p class="notice">Bu mesaj tekrar; aktarımda atlanır.</p>' : messageCards(m, d)}</section>`,
        10,
      );
      reviewed = fingerprint();
      qs("[data-s-save]", root).disabled = false;
    });
  qs("[data-message-file]", root).onchange = () =>
    safe(async () => {
      const f = qs("[data-message-file]", root).files[0];
      if (!f) return;
      if (f.size > 2e6) throw Error("Dosya en fazla 2 MB");
      qs("[name=raw]", root).value = await f.text();
      invalidate();
    });
  qs("[data-voice]", root)?.addEventListener("click", () =>
    startVoice(
      (t) => {
        qs("[name=raw]", root).value += "\n" + t;
        invalidate();
      },
      () => {},
    ),
  );
  saveBind(root, async (f) => {
    if (reviewed !== fingerprint())
      throw Error("Mesaj değişti; yeniden ayrıştırıp önizleyin");
    const blocks = rules.messages(f.raw, f.year);
    if (
      !(await confirmDialog(
        "Mesajlar taslak olarak alınsın mı?",
        blocks.length + " mesaj; iş ve finans kayıtları henüz oluşmaz.",
        "Taslakları Al",
      ))
    )
      return false;
    const r = await actions.importMessages(blocks);
    toast(r.added + " yeni mesaj; " + r.duplicates + " tekrar atlandı", "ok");
    go("#/mesajlar");
  });
}
async function messageDetail(ctx, d, r) {
  return messageWorkbench(ctx, d, r, { toolbar, bindExport });
}
async function bankForm(ctx, d) {
  const { root } = ctx;
  let csv = null,
    preview = [];
  root.innerHTML =
    appbar("Banka CSV Aktarımı", "Dosya → kolonlar → kontrol → taslak") +
    `<section class="solo-intro">İmzalı tutar: giriş pozitif, çıkış negatif. Örnek: 6.000,00 / -1.200,00. Aktarım yalnız gelen kutusuna kaydeder; cari ve banka bakiyesi eşleştirmeden sonra değişir.</section><button class="btn" data-bank-sample>CSV Örneği İndir</button><form>${fSelect("Banka hesabı", "bank_account_id", options(d, "bank_accounts"), "")}<label class="field">Banka CSV dosyası<input type="file" accept=".csv,text/csv" data-bank-file></label><div data-columns></div><button type="button" class="btn" data-preview>Önizle</button><div data-preview-result></div><label class="history-check"><input type="checkbox" data-confirm> Hesabı, tarihleri, yönleri ve tutarları kontrol ettim.</label><button type="button" class="btn primary" data-s-save disabled>Satırları Gelen Kutusuna Al</button></form>`;
  qs("[data-bank-sample]", root).onclick = () =>
    downloadBlob(
      new Blob(["\ufeffTarih;Tutar;Açıklama;Referans\n"], { type: "text/csv" }),
      "SAHAPRO_Banka_Sablonu.csv",
    );
  const mapping = () =>
    Object.fromEntries(
      ["date", "amount", "description", "reference"].map((k) => [
        k,
        qs("[name=" + k + "]", root)?.value ?? "",
      ]),
    );
  const invalidate = () => {
    qs("[data-confirm]", root).checked = false;
    qs("[data-s-save]", root).disabled = true;
    preview = [];
    qs("[data-preview-result]", root).innerHTML = "";
  };
  qs("[data-bank-file]", root).onchange = () =>
    safe(async () => {
      invalidate();
      csv = null;
      const f = qs("[data-bank-file]", root).files[0];
      if (!f) return;
      if (f.size > 2e6) throw Error("CSV en fazla 2 MB");
      csv = rules.parseCSV(await f.text());
      qs("[data-columns]", root).innerHTML = [
        "date",
        "amount",
        "description",
        "reference",
      ]
        .map((k, i) =>
          fSelect(
            [
              "Tarih kolonu",
              "İmzalı tutar kolonu",
              "Açıklama kolonu",
              "Referans (opsiyonel)",
            ][i],
            k,
            csv.headers.map((t, v) => ({ v, t })),
            i < csv.headers.length ? i : "",
          ),
        )
        .join("");
      for (const el of qsa("[data-columns] select", root))
        el.onchange = invalidate;
    });
  qs("[name=bank_account_id]", root).onchange = invalidate;
  qs("[data-preview]", root).onclick = () =>
    safe(() => {
      if (!csv) throw Error("CSV seçin");
      preview = rules.bankPreview(
        csv,
        mapping(),
        qs("[name=bank_account_id]", root).value,
        d.bank_import_rows,
      );
      qs("[data-preview-result]", root).innerHTML =
        '<div class="notice">' +
        preview.length +
        " satır; " +
        preview.filter((r) => r.duplicate).length +
        " tekrar; " +
        preview.filter((r) => r.errors.length).length +
        " hata.</div><div data-bank-preview-list></div>";
      pagedRender(
        qs("[data-bank-preview-list]", root),
        preview,
        (r) =>
          '<div class="card">' +
          esc(
            [
              r.date,
              r.direction,
              money(r.amount),
              r.description,
              ...r.errors,
              r.duplicate ? "TEKRAR" : "",
            ].join(" · "),
          ) +
          "</div>",
        20,
      );
    });
  qs("[data-confirm]", root).onchange = (e) => {
    qs("[data-s-save]", root).disabled =
      !e.target.checked ||
      !preview.length ||
      preview.some((r) => r.errors.length);
  };
  saveBind(root, async () => {
    if (!qs("[data-confirm]", root).checked || !preview.length)
      throw Error("Önizleme ve onay gerekli");
    const r = await actions.importBank(
      csv,
      mapping(),
      qs("[name=bank_account_id]", root).value,
    );
    toast(r.added + " satır alındı; " + r.duplicates + " tekrar atlandı", "ok");
    go("#/banka-aktarim");
  });
}
async function bankDetail(ctx, d, r) {
  const { root } = ctx;
  const t = rowsTable("bank_import_rows", [r], d);
  const existing = rules
    .live(d, "bank_movements")
    .filter(
      (m) =>
        m.bank_account_id === r.bank_account_id &&
        m.date === r.date &&
        m.direction === r.direction &&
        core.toKurus(m.amount) === core.toKurus(r.amount),
    );
  root.innerHTML =
    appbar("Banka Mutabakatı", r.status) +
    toolbar() +
    '<section class="card">' +
    t.headers.map((h, i) => kv(h, esc(t.rows[0][i] ?? ""))).join("") +
    "</section>" +
    (r.status === "Eşleşmedi"
      ? `<section class="card"><h2>Eşleştirme önerileri</h2>${
          rules
            .bankSuggestions(r, d)
            .map((s) => "<p>" + esc(s.name) + "</p>")
            .join("") || "<p>Kesin öneri yok; kullanıcı seçimi gerekli.</p>"
        }</section><form>${fSelect(
          "Var olan eşit hareket (yenisini oluşturmaz)",
          "existing_id",
          existing.map((m) => ({
            v: m.id,
            t: m.note || m.reference || m.date,
          })),
          "",
        )}${fSelect("Yeni işlem türü", "mode", [...(r.direction === "IN" ? [{ v: "customer", t: "Müşteri tahsilatı" }] : [{ v: "payable", t: "Alış borcu ödemesi" }]), { v: "bank_only", t: "Yalnız banka hareketi" }], r.direction === "IN" ? "customer" : "payable", { empty: false })}<div data-bank-owner></div>${fArea("Gerekçe / açıklama", "reason")}<label class="history-check"><input type="checkbox" data-reconcile-confirm> Bu satır için ikinci tahsilat/ödeme oluşmadığını kontrol ettim.</label><button type="button" class="btn primary" data-s-save>Onayla ve Eşleştir</button></form>`
      : "");
  if (r.status === "Eşleşmedi") {
    const sync = () => {
      const type = qs("[name=mode]", root).value;
      qs("[data-bank-owner]", root).innerHTML =
        type === "customer"
          ? fSelect("Müşteri", "customer_id", options(d, "customers"), "")
          : type === "payable"
            ? fSelect(
                "Ödenecek alış belgesi",
                "payable_id",
                rules
                  .live(d, "payables")
                  .filter((b) => b.status !== "İptal")
                  .map((b) => ({
                    v: b.id,
                    t:
                      (b.document_no || "Alış") +
                      " · " +
                      money(billBalanceSafe(b, d)),
                  })),
                "",
              )
            : "";
    };
    qs("[name=mode]", root).onchange = sync;
    sync();
    saveBind(root, async (f) => {
      if (!qs("[data-reconcile-confirm]", root).checked)
        throw Error("Mutabakat onayı gerekli");
      if (
        !(await confirmDialog(
          "Banka satırı işlensin mi?",
          money(r.amount) + " · " + r.description,
          "Eşleştir",
        ))
      )
        return false;
      await actions.reconcileBank(r.id, f);
      ctx.reload();
    });
  }
  bindExport(
    root,
    () => spec("Banka Mutabakatı", [t]),
    () => t,
  );
}
function billBalanceSafe(b, d) {
  return (
    Number(b.gross_total) -
    rules
      .live(d, "supplier_payments")
      .filter((p) => p.payable_id === b.id)
      .reduce((n, p) => n + Number(p.amount), 0)
  );
}
async function allocationForm(ctx, d) {
  const { root, query: q } = ctx;
  const sources = costLedger(d).filter((r) => !r.work_record_id),
    targets = [];
  root.innerHTML =
    appbar("Maliyet Dağıtımı", "Kaynak tutarı korunur") +
    `<form>${fSelect(
      "Kaynak maliyet",
      "source",
      sources.map((r) => ({
        v: r.source_store + "|" + r.source_id,
        t: r.date + " · " + r.category + " · " + money(r.gross),
      })),
      q.source_store && q.source_id ? q.source_store + "|" + q.source_id : "",
    )}<div data-targets></div><button type="button" class="btn" data-add-target>Hedef Satır Ekle</button><p class="notice">Ağırlıklar oran oluşturur. Eşit dağıtım için her satıra 1 girin. Son kuruşlar deterministik dağıtılır; maliyet iki kez sayılmaz.</p><button type="button" class="btn primary" data-s-save>Dağıtımı Kaydet</button></form>`;
  let n = 0;
  const add = () => {
    const el = document.createElement("section");
    el.className = "card";
    el.dataset.target = n++;
    el.innerHTML =
      contextFields(d) +
      fSelect("Araç (opsiyonel)", "vehicle_id", options(d, "vehicles"), "") +
      fNum("Ağırlık", "weight", 1, { step: "any" }) +
      '<button type="button" class="btn danger" data-remove>Satırı Kaldır</button>';
    qs("[data-targets]", root).append(el);
    contextBind(el, d);
    qs("[data-remove]", el).onclick = () => el.remove();
  };
  qs("[data-add-target]", root).onclick = add;
  add();
  saveBind(root, async (f, k) => {
    const [source_store, source_id] = f.source.split("|");
    const source = sources.find(
      (r) => r.source_store === source_store && r.source_id === source_id,
    );
    const r = await actions.saveAllocation(
      {
        source_store,
        source_id,
        date: source?.date,
        targets: qsa("[data-target]", root).map((el) => collectForm(el)),
      },
      k,
    );
    go("#/dagitim/" + r.id);
  });
}
async function archive(ctx, d) {
  const { root, query: q } = ctx;
  const id = q.document_id;
  if (id) {
    const r = rules.reference(d, "documents", id);
    root.innerHTML =
      appbar("Fiziksel Arşiv", r.category + " · " + (r.doc_no || "")) +
      `<form>${fText("Klasör", "archive_folder", r.archive_folder || "")}${fText("Raf", "archive_shelf", r.archive_shelf || "")}${fText("Dosya No", "archive_file_no", r.archive_file_no || "")}${fText("Koçan", "archive_kocan", r.archive_kocan || "")}${fArea("Kayıt/taşıma gerekçesi", "note")}<button type="button" class="btn primary" data-s-save>Arşiv Konumunu Kaydet</button></form>${button("QR Etiketi", "#/qr?document_id=" + id)}${button("Belge Detayı", "#/belgeler/" + id)}<section class="card"><h2>Konum Geçmişi</h2>${(r.archive_events || []).map((e) => "<p>" + esc([e.at, e.archive_shelf, e.archive_folder, e.note].join(" · ")) + "</p>").join("")}</section>`;
    saveBind(root, async (f) => {
      await actions.saveArchive(id, f);
      ctx.reload();
    });
    return;
  }
  const rows = rules
    .live(d, "documents")
    .filter(
      (r) =>
        !q.q ||
        core
          .normKey(
            [
              r.doc_no,
              r.category,
              r.archive_folder,
              r.archive_shelf,
              r.archive_file_no,
            ].join(" "),
          )
          .includes(core.normKey(q.q)),
    );
  root.innerHTML =
    appbar("Fiziksel Arşiv", "Belge kendi sahibinde kalır") +
    `<form>${fText("Belge / raf / klasör ara", "q", q.q || "")}<button class="btn">Ara</button></form>${button("QR Tara / Aç", "#/qr")}${toolbar()}<div data-s-list></div>`;
  qs("form", root).onsubmit = (e) => {
    e.preventDefault();
    go("#/arsiv?q=" + encodeURIComponent(qs("[name=q]", root).value));
  };
  const t = table(
    ["Tür", "Belge No", "Raf", "Klasör", "Dosya No"],
    rows.map((r) => [
      r.category,
      r.doc_no,
      r.archive_shelf,
      r.archive_folder,
      r.archive_file_no,
    ]),
  );
  pagedRender(
    qs("[data-s-list]", root),
    rows,
    (r) =>
      '<section class="card"><strong>' +
      esc(r.category + " · " + (r.doc_no || "")) +
      "</strong><p>" +
      esc(
        [r.archive_shelf, r.archive_folder, r.archive_file_no]
          .filter(Boolean)
          .join(" / ") || "Konum girilmemiş",
      ) +
      "</p>" +
      button("Arşiv / QR", "#/arsiv?document_id=" + r.id) +
      "</section>",
  );
  bindExport(
    root,
    () => spec("Fiziksel Arşiv Raporu", [t]),
    () => t,
  );
}
export function qrPayload(id) {
  if (!/^[\w-]{1,100}$/.test(id)) throw Error("Belge kimliği geçersiz");
  return "SAHAPRO:document:" + id;
}
export function readQr(text) {
  const m = String(text)
    .trim()
    .match(/^SAHAPRO:document:([\w-]{1,100})$/);
  if (!m) throw Error("SAHAPRO belge QR etiketi gerekli");
  return m[1];
}
async function qrScreen(ctx, d) {
  const { root, query: q } = ctx;
  if (q.document_id) {
    const r = rules.reference(d, "documents", q.document_id),
      qr = qrcode(0, "M");
    qr.addData(qrPayload(r.id));
    qr.make();
    const url = qr.createDataURL(5, 4);
    root.innerHTML =
      appbar("Belge QR Etiketi", r.doc_no || r.category) +
      `<section class="card solo-qr"><img src="${url}" alt="Belge QR etiketi"><h2>${esc(r.category)}</h2><p>${esc(r.doc_no || "")}</p><p>${esc([r.archive_shelf, r.archive_folder, r.archive_file_no].filter(Boolean).join(" / "))}</p><p class="muted small">Bu etiket belgeyi kayıtların bulunduğu cihazda açar. Kişisel belge içeriği QR içinde değildir.</p></section>${toolbar()}${button("Belgeyi Aç", "#/belgeler/" + r.id)}`;
    const blob = await (await fetch(url)).blob();
    const t = table(
      ["Tür", "No", "Raf", "Klasör"],
      [[r.category, r.doc_no, r.archive_shelf, r.archive_folder]],
    );
    bindExport(
      root,
      () => spec("Belge Arşiv Etiketi", [{ image: blob }, t]),
      () => t,
    );
    return;
  }
  root.innerHTML =
    appbar("QR ile Belge Aç", "Bu cihazdaki kaydı bulur") +
    `<form>${fText("QR kodundan okunan metin", "payload", "")}<button class="btn primary" type="button" data-open-qr>Belgeyi Aç</button><label class="field">QR fotoğrafı<input type="file" accept="image/*" capture="environment" data-qr-file></label><p class="notice">Kamera/fotoğraf okuma tarayıcı desteğine bağlıdır. Destek yoksa telefonun QR okuyucusundan metni buraya yapıştırın.</p></form>`;
  const open = (text) => {
    const id = readQr(text);
    if (!rules.live(d, "documents").some((r) => r.id === id))
      throw Error(
        "Bu cihazda belge bulunamadı. Belge yedeğinin bulunduğu cihazdan açın.",
      );
    go("#/belgeler/" + id);
  };
  qs("[data-open-qr]", root).onclick = () =>
    safe(() => open(qs("[name=payload]", root).value));
  qs("[data-qr-file]", root).onchange = () =>
    safe(async () => {
      if (!globalThis.BarcodeDetector)
        throw Error("Tarayıcı QR okumayı desteklemiyor; QR metnini yapıştırın");
      const f = qs("[data-qr-file]", root).files[0];
      if (!f) return;
      const img = await createImageBitmap(f);
      try {
        const codes = await new BarcodeDetector({
          formats: ["qr_code"],
        }).detect(img);
        if (!codes.length) throw Error("QR okunamadı");
        open(codes[0].rawValue);
      } finally {
        img.close();
      }
    });
}
async function resultScreen(ctx, d) {
  const { root, query: q } = ctx;
  const filters = {
    from: q.from || "",
    to: q.to || "",
    customer_id: q.customer_id || "",
    site_id: q.site_id || "",
    vehicle_id: q.vehicle_id || "",
  };
  const result = rules.resultReport(d, filters);
  const t = table(
    [
      "Tarih",
      "Kategori",
      "Müşteri",
      "Şantiye",
      "Araç",
      "Net",
      "KDV bilinmiyor",
      "KDV dahil",
    ],
    result.costs.map((r) => [
      r.date,
      r.category,
      rules.label(d, "customers", r.customer_id),
      rules.label(d, "sites", r.site_id),
      rules.label(d, "vehicles", r.vehicle_id),
      money(r.net),
      r.known_tax ? "Hayır" : "Evet",
      money(r.gross),
    ]),
  );
  const summary = {
    pairs: [
      ["Kesinleşmiş hakediş geliri (KDV hariç)", money(result.revenue)],
      [
        "Hakedişe alınmamış fiyatlı işler (gelire eklenmedi)",
        money(result.unbilled_value),
      ],
      ["Bilinen net maliyet", money(result.known_cost)],
      ["KDV ayrımı bilinmeyen maliyet (brüt)", money(result.unknown_cost)],
      ["Geçici faaliyet sonucu", money(result.provisional_result)],
      ["Fiyatı olmayan iş", result.unpriced.length],
      ["Doğrudan maliyet bulunmayan iş", result.costless.length],
      ["Dağıtılmamış gider", result.unallocated.length],
    ],
  };
  root.innerHTML =
    appbar("Sonuç / Maliyet Analizi", "Kaynaklarla açıklanabilir hesap") +
    `<form><div class="formgrid2">${fDate("Başlangıç", "from", filters.from, false)}${fDate("Bitiş", "to", filters.to, false)}</div>${contextFields(d, filters)}${fSelect("Araç", "vehicle_id", options(d, "vehicles"), filters.vehicle_id)}<button class="btn">Hesapla</button></form><section class="card">${summary.pairs.map((p) => kv(...p)).join("")}</section><p class="notice warn">Bu sonuç kesin muhasebe kârı değildir. Eksik maliyetler, amortisman ve vergi ayrıca değerlendirilmelidir. Fiyatlı açık işler ve tahsilat gelirle karıştırılmaz.</p>${button("Ortak Gider Dağıt", "#/dagitim/new")}${toolbar()}<div data-s-list></div><details class="card"><summary>Fiyatı olmayan işler (${result.unpriced.length})</summary>${result.unpriced
      .slice(0, 100)
      .map((w) =>
        button(
          w.date + " · " + rules.label(d, "customers", w.customer_id),
          "#/isler/" + w.id,
        ),
      )
      .join("")}</details>`;
  contextBind(root, d);
  qs("form", root).onsubmit = (e) => {
    e.preventDefault();
    go("#/sonuc?" + new URLSearchParams(collectForm(e.target)));
  };
  pagedRender(
    qs("[data-s-list]", root),
    result.costs,
    (r, i) =>
      '<section class="card">' +
      t.headers
        .map((h, j) => kv(h, esc(t.rows[result.costs.indexOf(r)][j] ?? "")))
        .join("") +
      button("Kaynak Kaydı", sourceRoute(r.source_store, r.source_id)) +
      "</section>",
  );
  bindExport(
    root,
    () =>
      spec("Faaliyet Sonuç Raporu", [
        summary,
        {
          text: "Geçici sonuç. Eksik maliyet ve KDV ayrımı kontrol edilmelidir.",
        },
        t,
      ]),
    () => t,
  );
}
export function sourceRoute(store, id) {
  const routes = {
    work_records: "isler",
    fuel_records: "yakit",
    maintenance_records: "bakim",
    expense_records: "gider",
    payroll_entries: "ucretler",
    payables: "alislar",
    cari_movements: "cari",
    bank_movements: "bankalar",
    documents: "belgeler",
    slips: "fisler",
    hakedis: "hakedis",
  };
  return "#/" + (routes[store] || "daha") + (id ? "/" + id : "");
}
async function assistant(ctx, d) {
  const { root } = ctx;
  root.innerHTML =
    appbar(
      "Yerel Sorgu Asistanı",
      "İşletme kayıtlarına dayalı · AI bağlantısı yok",
    ) +
    `<form>${fArea("Sorunuz", "question")}<div class="formgrid2">${fDate("Başlangıç (opsiyonel)", "from", "", false)}${fDate("Bitiş (opsiyonel)", "to", "", false)}</div><button class="btn primary" type="submit">Kayıtlarda Ara</button></form><p class="muted">Örnek: “Tuna İnşaat cari bakiyesi”, “34UL9492 yakıt”, “Tuna İnşaat sefer toplamı”. Tarih aralığı seçmezseniz tüm kayıtlar kullanılır.</p><div data-answer></div>`;
  qs("form", root).onsubmit = (e) => {
    e.preventDefault();
    safe(() => {
      const f = collectForm(e.target),
        data = Object.fromEntries(
          Object.entries(d).map(([s, rows]) => [
            s,
            rows.filter(
              (r) =>
                (!f.from || !r.date || r.date >= f.from) &&
                (!f.to || !r.date || r.date <= f.to),
            ),
          ]),
        );
      const result = rules.localAnswer(f.question, data);
      if (
        (f.from || f.to) &&
        /cari|borç|borc|alacak/.test(core.normKey(f.question))
      )
        result.answer =
          "Seçili dönem hareketlerinin neti (açılış bakiyesi dahil değildir): " +
          result.answer;
      qs("[data-answer]", root).innerHTML =
        '<section class="card"><p>' +
        esc(result.answer) +
        "</p></section>" +
        toolbar() +
        "<div data-sources></div>";
      pagedRender(
        qs("[data-sources]", root),
        result.sources,
        (r) =>
          '<div class="card">' +
          esc(r.date || "") +
          " " +
          button(
            "Kaynak Kaydı",
            r.store === "cari_movements"
              ? "#/cari/" + r.customer_id
              : sourceRoute(r.store, r.id),
          ) +
          "</div>",
      );
      const t = table(
        ["Kayıt türü", "Tarih"],
        result.sources.map((r) => [
          r.store === "cari_movements"
            ? "Cari"
            : r.store === "fuel_records"
              ? "Yakıt"
              : "İş",
          r.date,
        ]),
      );
      bindExport(
        root,
        () => spec("Sorgu Sonucu", [{ text: result.answer }, t]),
        () => t,
      );
    });
  };
}
async function renewal(ctx, d) {
  const { root, query: q } = ctx;
  const p = rules.reference(d, "service_plans", q.plan_id);
  root.innerHTML =
    appbar("Sonraki Bakım Planı", p.title) +
    `<form>${fDate("Bakım tamamlanma tarihi", "completed_date", core.todayStr())}${fNum("Gün aralığı (opsiyonel)", "interval_days", "")}${fNum("Km aralığı (opsiyonel)", "interval_km", "")}${fNum("Makine saati aralığı (opsiyonel)", "interval_hours", "", { step: "any" })}<button type="button" class="btn primary" data-s-save>Sonraki Planı Oluştur</button></form>`;
  saveBind(root, async (f, k) => {
    const r = await actions.renewService(p.id, f, k);
    go("#/bakimplani/" + r.id);
  });
}
async function customerPack(ctx, d) {
  const { root, query: q } = ctx;
  root.innerHTML =
    appbar("Müşteri Belge Paketi", "Müşteriye açık bilgiler") +
    `<form>${fSelect("Müşteri", "customer_id", options(d, "customers"), q.customer_id || "")}<div class="formgrid2">${fDate("Başlangıç", "from", "", false)}${fDate("Bitiş", "to", "", false)}</div><label class="history-check"><input type="checkbox" name="works" checked> İş özeti</label><label class="history-check"><input type="checkbox" name="slips" checked> İmzalı fişler</label><label class="history-check"><input type="checkbox" name="hakedis" checked> Kesinleşmiş hakedişler</label><label class="history-check"><input type="checkbox" name="cari" checked> Cari hareketleri</label><button class="btn primary" type="submit">Müşteri PDF Paketini Hazırla</button></form><p class="notice">İç not, maliyet, kâr, teknik kimlik ve personel özel bilgileri müşteri paketine alınmaz. Orijinal ekler ayrıca kullanıcı tarafından paylaşılır.</p>`;
  qs("form", root).onsubmit = (e) => {
    e.preventDefault();
    safe(async () => {
      const f = collectForm(e.target),
        customer = rules.reference(d, "customers", f.customer_id);
      const match = (r) =>
        r.customer_id === customer.id &&
        (!f.from || (r.date || r.created_date || r.date_from) >= f.from) &&
        (!f.to || (r.date || r.created_date || r.date_from) <= f.to);
      const sections = [
        {
          pairs: [
            ["Müşteri", customer.name],
            [
              "Dönem",
              (f.from || "Tüm tarihler") + " / " + (f.to || "Tüm tarihler"),
            ],
          ],
        },
      ];
      const names = Object.fromEntries(
        Object.entries(d).map(([s, rows]) => [
          s,
          Object.fromEntries(rows.map((r) => [r.id, r.name || ""])),
        ]),
      );
      if (qs("[name=works]", root).checked)
        sections.push(
          table(
            ["Tarih", "Şantiye", "İş", "Miktar", "Birim"],
            rules
              .live(d, "work_records")
              .filter(match)
              .map((w) => [
                w.date,
                rules.label(d, "sites", w.site_id),
                w.work_type,
                w.quantity,
                w.unit,
              ]),
          ),
        );
      if (qs("[name=slips]", root).checked)
        for (const s of rules
          .live(d, "slips")
          .filter((s) => match(s) && s.status === "İmzalandı")) {
          const a = (await ctx.db.attachmentsFor("slip_signature", s.id))[0];
          sections.push(
            { text: "Dijital Fiş " + s.slip_no },
            ...slipSpec(s, names, a?.blob).sections,
          );
        }
      if (qs("[name=hakedis]", root).checked)
        for (const h of rules
          .live(d, "hakedis")
          .filter((h) => match(h) && h.status === "Kesinleşti"))
          sections.push(
            { text: "Hakediş " + h.hakedis_no },
            ...hakedisSpec(h, names).sections,
          );
      if (qs("[name=cari]", root).checked)
        sections.push(
          table(
            ["Tarih", "İşlem", "Tutar"],
            rules
              .live(d, "cari_movements")
              .filter(match)
              .map((r) => [r.date, r.type, money(r.amount)]),
          ),
        );
      await exportDocument(
        { ...spec("Müşteri Belge Paketi", sections), audience: "customer" },
        "download",
      );
    });
  };
}
export async function augment(ctx) {
  const { root, parts, db } = ctx,
    route = parts[0],
    id = parts[1];
  if (["new", "edit"].some((p) => parts.includes(p))) return;
  // Müşteri kartı: yapılan işler listesi (dönem, toplamlar, bakiye, paylaş)
  if (route === "musteriler" && id) {
    try { await customerDashboard(ctx, id); } catch (e) { console.error(e); }
    try { await customerWorks(ctx, id); } catch (e) {}
  }
  // Müşteri kartı: mazotla ödeme kuralları ve mazot hesabı (ör. Kılıç Hafriyat: 75 L/sefer, ücret yalnız mazot)
  if (route === "musteriler" && id) {
    try {
      const me = await db.get("customers", id);
      const R = await import("./assistant-rules.js");
      const d0 = await db.dumpAll();
      const rules = R.fuelRulesOf(me);
      const L = R.customerFuelLedger(d0, id);
      if (me && (rules.length || L.works)) {
        const unitTxt = Object.entries(L.units || {}).map(([u, q]) => `${q} ${String(u).toLocaleLowerCase("tr-TR")}`).join(", ") || "0 iş";
        const html = `<section class="card"><h2>⛽ Mazot hesabı</h2>
          ${rules.map((r) => `<p class="small">• ${esc(String(r.per))} L / ${esc(String(r.unit || "Sefer").toLocaleLowerCase("tr-TR"))}${r.match ? " · " + esc(r.match) : " · tüm işleri"} · ${r.only_pay !== false ? "ücret yalnız mazot" : "para + mazot"}${r.from || r.to ? " · " + esc(r.from || "…") + " → " + esc(r.to || "…") : ""}</p>`).join("") || '<p class="small muted">Kural yok (Kartı Düzenle → Mazotla ödeme kuralları)</p>'}
          <p><b>${esc(unitTxt)}</b> → <b>${L.earned} L</b> hak edildi · <b>${L.received} L</b> alındı</p>
          <p style="font-size:17px">${L.balance > 0 ? `Kalan mazot alacağı: <b>${L.balance} L</b>` : L.balance < 0 ? `Fazla alınan: <b>${-L.balance} L</b>` : "Hesap kapalı ✓"}</p>
          <p class="muted small">Mazot alınca: Yakıt → kaynak "Müşteri Verdi" (araca) ya da Depo Tankı → GİRİŞ "Müşteriden" (depoya). Asistana "${esc(me.name)}'tan 300 litre mazot aldık" yazabilirsiniz.</p>
          <button class="btn block" data-fuelshare>📤 Mazot ekstresini paylaş (WhatsApp)</button>
          ${rules.length ? '<button class="btn block" style="margin-top:6px" data-fuelapply>Eski işlere uygula (kurala uyanları hesapla)</button><div data-fuelapply-out class="small" style="margin-top:6px"></div>' : ""}</section>`;
        const tabs = root.querySelector("[data-tabs]");
        if (tabs) tabs.insertAdjacentHTML("beforebegin", html);
        else root.insertAdjacentHTML("beforeend", html);
        root.querySelector("[data-fuelshare]")?.addEventListener("click", async () => {
          const t = R.fuelStatementText(await db.dumpAll(), id);
          if (navigator.share) { try { await navigator.share({ text: t }); return; } catch (e) { if (e.name === "AbortError") return; } }
          location.href = "https://wa.me/?text=" + encodeURIComponent(t);
        });
        root.querySelector("[data-fuelapply]")?.addEventListener("click", async () => {
          const d = await db.dumpAll();
          const mine = (d.work_records || []).filter((x) => !x.deleted_at && x.customer_id === id);
          let n = 0, fail = 0, matched = 0;
          const miss = [];
          for (const w of mine) {
            const f = R.applyFuelPay(d, w, "");
            if (f.customer_fuel_allowance_l) matched++;
            else if (miss.length < 5) miss.push(`${w.date} · ${w.quantity} ${w.unit || ""} · ${w.material || w.work_type || ""}`);
            const same = Number(f.customer_fuel_allowance_l || 0) === Number(w.customer_fuel_allowance_l || 0) && f.price_snapshot?.amount === w.price_snapshot?.amount;
            if (same) continue;
            try {
              await db.saveExisting("work_records", w, { customer_fuel_allowance_l: f.customer_fuel_allowance_l || null, fuel_rule_id: f.fuel_rule_id || null, price_snapshot: f.price_snapshot }, "Mazot karşılığı uygulandı");
              n++;
            } catch (e) { fail++; }
          }
          const out = root.querySelector("[data-fuelapply-out]");
          out.innerHTML = `${mine.length} işten ${matched} tanesi kurala uydu; ${n} iş güncellendi${fail ? `, ${fail} iş hakedişe bağlı olduğu için değişmedi` : ""}.` +
            (miss.length ? `<div class="muted tiny" style="margin-top:4px">Kurala uymayan örnekler (birim veya kelimeler tutmuyor): ${miss.map(esc).join(" | ")}</div>` : "");
          if (n) setTimeout(() => location.reload(), 1800);
        });
      }
    } catch (e) {}
  }
  // Müşteri kartı: ana firma / taşeronları (Ağırtaş Mimarlık → Hisar Polat)
  if (route === "musteriler" && id) {
    try {
      const cs = (await db.getAll("customers")).filter((c) => !c.deleted_at);
      const me = cs.find((c) => c.id === id);
      const parent = me?.parent_customer_id ? cs.find((c) => c.id === me.parent_customer_id) : null;
      const subs = cs.filter((c) => c.parent_customer_id === id);
      if (me && (parent || subs.length)) {
        const works = (await db.getAll("work_records")).filter((w) => !w.deleted_at);
        const month = new Date().toISOString().slice(0, 7);
        const cnt = (cid) => { const ws = works.filter((w) => w.customer_id === cid); return `${ws.filter((w) => String(w.date).startsWith(month)).length} iş bu ay · ${ws.length} toplam`; };
        const html = '<section class="card"><h2>' + (parent ? "Ana firma" : "Taşeronları") + "</h2>" +
          (parent ? `<p><a href="#/musteriler/${esc(parent.id)}">${esc(parent.name)}</a> — ${esc(me.name)} bu firmanın taşeronu</p>` : "") +
          subs.map((c) => `<p>🏗 <a href="#/musteriler/${esc(c.id)}">${esc(c.name)}</a> <span class="muted small">${cnt(c.id)}</span></p>`).join("") +
          "</section>";
        const tabs = root.querySelector("[data-tabs]");
        if (tabs) tabs.insertAdjacentHTML("beforebegin", html);
        else root.insertAdjacentHTML("beforeend", html);
      }
    } catch (e) {}
  }
  let links = "";
  if (!route || route === "daha" || route === "yonetici") {
    links =
      Object.entries(MODULES)
        .map(([r, [, t]]) => button(t, "#/" + r))
        .join("") +
      button("Fiziksel Arşiv / QR", "#/arsiv") +
      button("Sonuç / Maliyet", "#/sonuc") +
      button("Yerel Asistan", "#/asistan") +
      button("Müşteri PDF Paketi", "#/musteri-paketi");
  }
  if (route === "filo" && id)
    links =
      button("Sayaç Oku", "#/sayac/new?vehicle_id=" + id) +
      button("Sayaç Geçmişi", "#/sayac?vehicle_id=" + id) +
      button("Duruş Başlat", "#/duruslar/new?vehicle_id=" + id) +
      button("Duruş Geçmişi", "#/duruslar?vehicle_id=" + id);
  if (route === "personel" && id)
    links =
      button("Görev Planı", "#/vardiya?personnel_id=" + id) +
      button("Zimmetler", "#/zimmet?personnel_id=" + id) +
      button("Zimmet Ekle", "#/zimmet/new?personnel_id=" + id);
  if (route === "belgeler" && id)
    links =
      button("Arşiv Konumu", "#/arsiv?document_id=" + id) +
      button("QR Etiketi", "#/qr?document_id=" + id) +
      button(
        "Fiziksel Belge Teslimi",
        "#/zimmet/new?owner_type=document&owner_id=" + id,
      );
  if (route === "teklif" && id)
    links = button(
      "Gerçekleşen İş Karşılaştırması",
      "#/teklif-sonuc?quote_id=" + id,
    );
  if (route === "musteriler" && id)
    links =
      button("Müşteri PDF Paketi", "#/musteri-paketi?customer_id=" + id) +
      button("Sonuç Analizi", "#/sonuc?customer_id=" + id);
  if (route === "depo")
    links =
      button("Fiziksel Sayım", "#/sayim/new") +
      button("Sayım Geçmişi", "#/sayim");
  if (route === "bakim" && id)
    links =
      button("Parça/İşçilik Ekle", "#/parcalar/new?maintenance_id=" + id) +
      button("Duruş Başlat", "#/duruslar/new?maintenance_id=" + id);
  if (route === "whatsapp")
    links = button("Kontrollü Mesaj Gelen Kutusu", "#/mesajlar");
  if (route === "bankalar")
    links = button("CSV / Mutabakat", "#/banka-aktarim");
  if (route === "bakimplani" && id) {
    const p = await db.get("service_plans", id);
    if (p?.status === "Tamamlandı" && !p.next_plan_id)
      links = button("Sonraki Bakım Planı", "#/bakim-yenile?plan_id=" + id);
  }
  if (route === "bakim" && id) {
    const data = await db.dumpAll(),
      m = data.maintenance_records.find((r) => r.id === id),
      parts = rules
        .live(data, "maintenance_parts")
        .filter((r) => r.maintenance_id === id),
      total = parts.reduce((n, r) => n + r.total, 0);
    if (parts.length)
      root.insertAdjacentHTML(
        "beforeend",
        '<section class="card"><h2>Parça / İşçilik Dökümü</h2>' +
          parts
            .map(
              (p) =>
                "<p>" +
                esc(p.kind + " · " + p.description + " · " + money(p.total)) +
                "</p>",
            )
            .join("") +
          kv("Kalem toplamı", money(total)) +
          kv("Bakım ana maliyeti", money(m?.cost)) +
          '<p class="notice">Kalemler ayrıca maliyet yazılmaz. Ana maliyetle fark varsa ana bakım kaydını kontrol edin.</p></section>',
      );
  }
  if (route === "yakit") {
    const data = await db.dumpAll();
    if (id) {
      const fuel = data.fuel_records.find((r) => r.id === id);
      if (fuel) (await import("./m-ops.js")).fuelActions(root, db, fuel).catch(() => {});
      if (fuel) {
        const rows = rules.fuelEfficiency(data, fuel.vehicle_id);
        root.insertAdjacentHTML(
          "beforeend",
          '<section class="card"><h2>Ölçümlü Yakıt Karşılaştırması</h2><p class="muted">Yalnız peş peşe tam dolum ve artan sayaç ölçümleri hesaplanır. Verilen litre tek başına motor tüketimi değildir.</p>' +
            rows
              .slice(-5)
              .map(
                (r) =>
                  "<p>" + esc(r.date + " · " + r.rate + " " + r.unit) + "</p>",
              )
              .join("") +
            "</section>",
        );
      }
    }
  }
  if (!route || route === "yonetici" || route === "gunsonu") {
    const data = await db.dumpAll(),
      alerts = rules.operationalAlerts(data);
    if (alerts.length)
      root.insertAdjacentHTML(
        "beforeend",
        '<section class="card"><h2>İşletme Kontrol Kuyruğu</h2><div data-s-alerts></div></section>',
      );
    const el = qs("[data-s-alerts]", root);
    if (el)
      pagedRender(
        el,
        alerts,
        (r) =>
          '<div class="notice ' +
          r.level +
          '"><div>' +
          esc(r.title) +
          "<p>" +
          esc(r.detail) +
          "</p>" +
          button("Kaydı Aç", r.route) +
          "</div></div>",
        10,
      );
  }
  if (links)
    root.insertAdjacentHTML(
      "beforeend",
      '<section class="card solo-module-links"><h2>İşletme İşlemleri</h2><div class="enterprise-links">' +
        links +
        "</div></section>",
    );
}

async function quoteResult(ctx, d) {
  const { root, query: q } = ctx,
    quote = rules.reference(d, "quotes", q.quote_id);
  const works = rules
    .live(d, "work_records")
    .filter(
      (w) =>
        w.customer_id === quote.customer_id &&
        (!quote.site_id || w.site_id === quote.site_id) &&
        (!q.from || w.date >= q.from) &&
        (!q.to || w.date <= q.to),
    );
  const rows = rules.quoteActualRows(quote, works),
    t = table(
      [
        "Teklif kalemi",
        "Birim",
        "Gerçek miktar",
        "Teklif birim fiyat",
        "Referans bedel",
        "İş snapshot net",
        "Fiyatsız iş",
      ],
      rows.map((r) => [
        r.label,
        r.unit,
        r.quantity,
        money(r.quoted_price),
        money(r.reference_amount),
        money(r.actual_net),
        r.unpriced,
      ]),
    );
  root.innerHTML =
    appbar("Teklif / Gerçekleşen İş", "Teklif #" + quote.quote_no) +
    `<form><div class="formgrid2">${fDate("Başlangıç", "from", q.from || "", false)}${fDate("Bitiş", "to", q.to || "", false)}</div><button class="btn">Karşılaştır</button></form><p class="notice">Yalnız iş türü adı ve birimi tam eşleşen satırlar karşılaştırılır. Eşleşmeyen işler kapsam kontrolü gerektirir. Birim fiyatlar birbirine eklenmez; götürü/alternatif satırlar için varsayımsal toplam yapılmaz. İş bedeli tahsilat değildir.</p>${toolbar()}<div data-quote-lines></div>${button("Müşteri Maliyet Analizi", "#/sonuc?customer_id=" + quote.customer_id)}`;
  qs("form", root).onsubmit = (e) => {
    e.preventDefault();
    go(
      "#/teklif-sonuc?" +
        new URLSearchParams({ quote_id: quote.id, ...collectForm(e.target) }),
    );
  };
  pagedRender(
    qs("[data-quote-lines]", root),
    rows,
    (r) =>
      '<section class="card">' +
      t.headers
        .map((h, i) => kv(h, esc(t.rows[rows.indexOf(r)][i] ?? "")))
        .join("") +
      "</section>",
  );
  bindExport(
    root,
    () =>
      spec("Teklif Gerçekleşen İş Karşılaştırması", [
        {
          pairs: [
            ["Müşteri", rules.label(d, "customers", quote.customer_id)],
            ["Teklif No", quote.quote_no],
          ],
        },
        t,
      ]),
    () => t,
  );
}

// ---- Müşteri kartında yapılan işler ----
export function customerWorkRows(d, id, { from = "", subs = false } = {}) {
  const live = (s) => (d[s] || []).filter((x) => !x.deleted_at);
  const ids = new Set([id, ...(subs ? live("customers").filter((c) => c.parent_customer_id === id).map((c) => c.id) : [])]);
  const nm = (s, x) => (x ? live(s).find((r) => r.id === x)?.name || "" : "");
  const rows = live("work_records")
    .filter((w) => ids.has(w.customer_id) && (!from || String(w.date) >= from))
    .sort((a, b) => String(b.date).localeCompare(String(a.date)) || String(b.created_at || "").localeCompare(String(a.created_at || "")))
    .map((w) => {
      const amt = Number(w.price_snapshot?.amount);
      const where = [nm("sites", w.site_id), nm("quarries", w.quarry_id) || w.quarry, nm("dump_sites", w.dump_site_id) || w.dump_area].filter(Boolean).join(" → ");
      return { id: w.id, date: w.date, vehicle: nm("vehicles", w.vehicle_id), qty: Number(w.quantity) || 0, unit: w.unit || "", type: w.work_type || "", where,
        sub: w.customer_id !== id ? nm("customers", w.customer_id) : "", amount: Number.isFinite(amt) && amt > 0 ? amt : 0,
        fuelL: Number(w.customer_fuel_allowance_l) || 0, unpriced: !(Number.isFinite(amt) && amt > 0) && !w.customer_fuel_allowance_l,
        tonnage: Number(w.tonnage) || 0, slip: w.slip_no || "", material: w.material || "" };
    });
  const units = {};
  for (const r of rows) units[r.unit] = Math.round(((units[r.unit] || 0) + r.qty) * 100) / 100;
  return { rows, units, amount: Math.round(rows.reduce((n, r) => n + r.amount, 0) * 100) / 100, unpriced: rows.filter((r) => r.unpriced).length, fuelL: rows.reduce((n, r) => n + r.fuelL, 0) };
}
export function customerWorksText(name, res, label) {
  const tr = (s) => (s ? String(s).slice(0, 10).split("-").reverse().join(".") : "");
  const tl = (n) => Number(n).toLocaleString("tr-TR", { maximumFractionDigits: 2 });
  const lines = [`*${name}* — Yapılan işler (${label})`, ""];
  for (const r of [...res.rows].reverse()) lines.push(`${tr(r.date)} · ${r.vehicle || "-"} · ${tl(r.qty)} ${r.unit.toLocaleLowerCase("tr-TR")} ${r.type}${r.sub ? " [" + r.sub + "]" : ""}${r.where ? " (" + r.where + ")" : ""}${r.tonnage ? " · " + tl(r.tonnage) + " ton" : ""}${r.amount ? " · " + tl(r.amount) + " ₺" : ""}`);
  lines.push("", "Toplam: " + Object.entries(res.units).map(([u, q]) => `${tl(q)} ${u.toLocaleLowerCase("tr-TR")}`).join(", ") + (res.amount ? ` · ${tl(res.amount)} ₺` : ""));
  return lines.join("\n");
}
async function customerWorks(ctx, id) {
  const { root, db } = ctx;
  const d = await db.dumpAll();
  const me = (d.customers || []).find((c) => c.id === id);
  if (!me) return;
  const hasSubs = (d.customers || []).some((c) => !c.deleted_at && c.parent_customer_id === id);
  const { customerLedgerMovements } = await import("./collect-core.js");
  const bal = Math.round(customerLedgerMovements(d, id).reduce((n, m) => n + (Number(m.amount) || 0), 0) * 100) / 100;
  const today = new Date().toISOString().slice(0, 10);
  const PER = { month: ["Bu ay", today.slice(0, 8) + "01"], m3: ["Son 3 ay", core.addDays(today, -90)], all: ["Tümü", ""] };
  const fmt = (n) => Number(n).toLocaleString("tr-TR", { maximumFractionDigits: 2 });
  const sec = document.createElement("section");
  sec.className = "card";
  sec.dataset.custworks = "1";
  const tabs = root.querySelector("[data-tabs]");
  if (tabs) tabs.before(sec); else root.append(sec);
  let per = "all", subs = false, limit = 40;
  const draw = () => {
    const res = customerWorkRows(d, id, { from: PER[per][1], subs });
    sec.innerHTML = `<div class="row between"><h2 style="margin:0">⚒ Yapılan işler</h2><span class="${bal > 0 ? "badge warn" : "badge ok"}">Bakiye ${fmt(bal)} ₺</span></div>
      <div class="row" style="gap:6px;flex-wrap:wrap;margin:8px 0">${Object.entries(PER).map(([k, [t]]) => `<button class="chip ${per === k ? "on" : ""}" data-per="${k}">${t}</button>`).join("")}${hasSubs ? `<button class="chip ${subs ? "on" : ""}" data-subs>Taşeronlar dahil</button>` : ""}</div>
      <p class="small"><b>${res.rows.length} iş</b> · ${Object.entries(res.units).map(([u, q]) => `${fmt(q)} ${esc(u.toLocaleLowerCase("tr-TR"))}`).join(" · ") || "—"}${res.amount ? ` · <b>${fmt(res.amount)} ₺</b>` : ""}${res.fuelL ? ` · ⛽ ${fmt(res.fuelL)} L mazot karşılığı` : ""}${res.unpriced ? ` · <span class="badge warn">${res.unpriced} fiyatsız</span>` : ""}</p>
      ${res.rows.length ? res.rows.slice(0, limit).map((r) => `<div class="li" data-go="#/isler/${esc(r.id)}"><div class="ic">${r.unit === "Sefer" ? "🚚" : "⚙"}</div><div class="grow"><div class="t1 ellipsis">${esc(core.trDate(r.date))} · ${fmt(r.qty)} ${esc(r.unit.toLocaleLowerCase("tr-TR"))} ${esc(r.type)}${r.sub ? ` <span class="muted tiny">(${esc(r.sub)})</span>` : ""}</div><div class="t2 ellipsis">${esc([r.vehicle, r.where, r.material, r.tonnage ? fmt(r.tonnage) + " ton" : "", r.slip ? "fiş " + r.slip : ""].filter(Boolean).join(" · "))}</div></div><div class="end"><span class="amt">${r.amount ? fmt(r.amount) + " ₺" : r.fuelL ? "⛽ " + fmt(r.fuelL) + " L" : '<span class="muted tiny">fiyatsız</span>'}</span></div></div>`).join("") : '<p class="muted small">Bu dönemde iş yok.</p>'}
      ${res.rows.length > limit ? `<button class="btn block sm" data-more>+${res.rows.length - limit} iş daha</button>` : ""}
      <div class="row" style="gap:6px;margin-top:8px"><button class="btn grow" data-go="#/isler/new?customer_id=${esc(id)}">+ Bu müşteriye iş</button><button class="btn grow" data-wshare>📤 Listeyi paylaş</button><button class="btn grow" data-go="#/tahsilat/${esc(id)}">💰 Tahsilat</button></div>`;
    for (const b of sec.querySelectorAll("[data-per]")) b.onclick = () => { per = b.dataset.per; limit = 40; draw(); };
    sec.querySelector("[data-subs]")?.addEventListener("click", () => { subs = !subs; draw(); });
    sec.querySelector("[data-more]")?.addEventListener("click", () => { limit += 60; draw(); });
    sec.querySelector("[data-wshare]").onclick = async () => ui.shareText(customerWorksText(me.name, res, PER[per][0]));
  };
  draw();
}

// ---- Müşteri panosu + ayrıntılı PDF ----
async function customerDashboard(ctx, id) {
  const { root, db } = ctx;
  const CR = await import("./customer-report.js");
  const d = await db.dumpAll();
  const me = (d.customers || []).find((c) => c.id === id);
  if (!me) return;
  const hasSubs = (d.customers || []).some((c) => !c.deleted_at && c.parent_customer_id === id);
  const sec = document.createElement("section");
  sec.className = "card";
  sec.dataset.custdash = "1";
  const tabs = root.querySelector("[data-tabs]");
  if (tabs) tabs.before(sec); else root.append(sec);
  let per = "year", subs = false;
  const fmt = (n) => Number(n || 0).toLocaleString("tr-TR", { maximumFractionDigits: 0 });
  const tile = (v, l, cls = "") => ui.stat(v, l, cls);
  const draw = () => {
    const rg = CR.periodRange(per);
    const R = CR.customerReportData(d, id, { from: rg.from, to: rg.to, subs });
    const a = R.aging, aSum = a.b0 + a.b30 + a.b60 + a.b90 || 1;
    sec.innerHTML = `<h2 style="margin:0 0 6px">📊 Müşteri panosu</h2>
      <div class="row" style="gap:6px;flex-wrap:wrap;margin-bottom:8px">${Object.entries(CR.PERIODS).map(([k, [t]]) => `<button class="chip ${per === k ? "on" : ""}" data-dper="${k}">${t}</button>`).join("")}${hasSubs ? `<button class="chip ${subs ? "on" : ""}" data-dsubs>Taşeronlar dahil</button>` : ""}</div>
      <div class="statgrid" style="grid-template-columns:repeat(2,1fr)">
        ${tile(fmt(R.totals.workTotal) + " ₺", "İş tutarı · " + rg.label, "accent")}${tile(fmt(R.totals.collected) + " ₺", "Tahsilat · " + rg.label, "ok")}
        ${tile(fmt(R.balanceNow) + " ₺", "Güncel bakiye", R.balanceNow > 0 ? "warn" : "")}${tile(R.totals.oldestDays ? R.totals.oldestDays + " gün" : "—", "En eski açık alacak", R.totals.oldestDays > 60 ? "danger" : "")}
        ${tile(String(R.totals.works), "İş · " + (Object.entries(R.units).map(([u, q]) => fmt(q) + " " + u.toLocaleLowerCase("tr-TR")).join(", ") || "—"))}${tile(R.totals.tonnage ? fmt(R.totals.tonnage) + " ton" : R.totals.fuelL ? fmt(R.totals.fuelL) + " L" : "—", R.totals.tonnage ? "Fişlerdeki ton" : "Mazot karşılığı")}
      </div>
      ${R.totals.unpriced ? `<div class="small" style="margin:6px 0"><span class="badge warn">${R.totals.unpriced} işin fiyatı yok</span> tutarlara katılmadı</div>` : ""}
      <div class="small strong" style="margin-top:10px">Son 12 ay</div>${CR.monthsSvg(R.months)}
      <div class="small strong" style="margin-top:10px">İş türüne göre</div>${CR.barsHtml(R.byType)}
      <div class="small strong" style="margin-top:10px">Araca göre</div>${CR.barsHtml(R.byVehicle)}
      ${R.open.length ? `<div class="small strong" style="margin-top:10px">Açık alacak yaşı</div><div style="display:flex;height:12px;border-radius:6px;overflow:hidden;margin:4px 0">${[["b0", "#2e9e6b"], ["b30", "#f5a623"], ["b60", "#e67e22"], ["b90", "#d9534f"]].map(([k, c]) => a[k] ? `<div title="${k}" style="width:${(a[k] / aSum) * 100}%;background:${c}"></div>` : "").join("")}</div><div class="tiny muted">0–30: ${fmt(a.b0)} · 31–60: ${fmt(a.b30)} · 61–90: ${fmt(a.b60)} · 90+: ${fmt(a.b90)} ₺</div>` : ""}
      <div class="section-title" style="margin-top:12px">📄 Ayrıntılı PDF rapor (${esc(rg.label)})</div>
      <label class="history-check small"><input type="checkbox" data-dphotos> Fiş fotoğraflarını ekle</label>
      <div class="row" style="gap:6px;margin-top:6px"><button class="btn primary grow" data-dpdf="customer">📤 Müşteriye PDF</button><button class="btn grow" data-dpdf="internal">📄 İç rapor (yaşlandırmalı)</button></div>
      <div class="muted tiny" style="margin-top:4px">PDF: müşteri ve dönem, özet, 12 aylık grafik, iş dökümü (tarih, araç, operatör, iş, miktar, nereden→nereye, malzeme, ton, fiş no, birim fiyat, tutar), iş türü ve araç toplamları, tahsilatlar, cari ekstre, açık kalemler${R.fuel ? ", mazot hesabı" : ""}${R.cheques.length ? ", çek/senet" : ""}.</div>`;
    for (const b of sec.querySelectorAll("[data-dper]")) b.onclick = () => { per = b.dataset.dper; draw(); };
    sec.querySelector("[data-dsubs]")?.addEventListener("click", () => { subs = !subs; draw(); });
    for (const b of sec.querySelectorAll("[data-dpdf]"))
      b.onclick = async () => {
        b.disabled = true;
        try {
          const photos = [];
          if (sec.querySelector("[data-dphotos]").checked) {
            for (const w of R.works) {
              const atts = [...(await db.attachmentsFor("work", w.id))];
              for (const doc of (d.documents || []).filter((x) => !x.deleted_at && x.owner_type === "work" && x.owner_id === w.id)) atts.push(...(await db.attachmentsFor("document", doc.id)));
              for (const a of atts.filter((x) => (x.type || x.blob?.type || "").startsWith("image/")).slice(0, 2))
                if (photos.length < 30) photos.push({ title: `Fiş · ${core.trDate(w.date)} · ${w.vehicle || ""} · ${w.qty} ${w.unit} ${w.type}${w.slip ? " · No " + w.slip : ""}`, blob: a.blob });
            }
          }
          const chart = await CR.monthsChartBlob(R.months);
          const spec = CR.customerReportSpec(R, { audience: b.dataset.dpdf, chart, photos, company: core.COMPANY_NAME });
          const { exportDocument } = await import("./document-engine.js");
          await exportDocument(spec, "share");
        } catch (e) {
          ui.toast(e.message || String(e), "err");
        }
        b.disabled = false;
      };
  };
  draw();
}
