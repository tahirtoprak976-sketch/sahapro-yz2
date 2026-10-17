import {
  appbar,
  esc,
  qs,
  toast,
  go,
  pagedRender,
  downloadBlob,
  confirmDialog,
  fmtNum,
  fmtTL,
  trDate,
} from "./ui.js";
import { FIELD_METADATA } from "./business.js";
import { WORK_TYPES, WORK_UNITS, isActive, normKey } from "./core.js";
import {
  readHistoryPackage,
  initialHistoryChoices,
  prepareHistory,
} from "./history-core.js";
import { loadHistoryData, commitHistory } from "./history-db.js";
import { fullBackup } from "./backup.js";
const canonical = (s) => normKey(s || "").replace(/[^a-z0-9çğıöşü]/g, "");
export async function screen(ctx) {
  const { root, db } = ctx;
  let data = await loadHistoryData(),
    pkg = null,
    choices = [],
    plan = null,
    busy = false;
  root.innerHTML =
    appbar("Geçmiş İş Aktarımı", "Dosya → kontrol → onay → kayıt") +
    `
    <section class="slip-panel"><h2>01 · Aktarım Dosyası</h2><p class="slip-hint">Sohbetten hazırlanmış SAHAPRO JSON dosyasını seçin. WhatsApp metni bu ekrana doğrudan yüklenmez; önce kontrol edilmiş aktarım dosyasına dönüştürülür.</p>
    <label class="field">Dosya seç<input type="file" accept=".json,application/json" data-history-file></label>
    <button class="btn" data-history-sample>Boş Aktarım Şablonu İndir</button><div data-history-file-name class="slip-hint"></div></section>
    <div data-history-preview hidden>
      <section class="slip-panel"><h2>02 · Kart ve Stok Kontrolü</h2>
      <label class="history-check"><input type="checkbox" data-history-new> Bulunmayan müşteri, şantiye ve araç kartlarının belirtilen adlarla oluşturulmasını onaylıyorum.</label>
      <p class="slip-hint">Var olan kartı satırdaki seçimden eşleştirin. Şantiye doğru müşteriye bağlı olmalıdır. Personel veya döküm yeri belirtilmemişse uydurulmaz.</p>
      <p class="notice">Yakıt başlangıçta seçili değildir. Bugünkü tank bakiyesi bu eski tüketim düşüldükten sonra girildiyse yakıtı tekrar aktarmayın. Geçmiş yakıtın aktarımı, tarih sıralı gerçek tank girişleri ve açık onay gerektirir.</p>
      <div class="row history-tools"><button class="btn" data-history-refresh>Kontrolleri Yenile</button><button class="btn" data-history-report>Kontrol PDF’si</button></div>
      <div data-history-summary aria-live="polite"></div></section>
      <div data-history-rows></div>
      <section class="slip-panel"><h2>03 · Son Onay</h2><p class="slip-hint">Yalnız hakedişe alınmamış ve ödenmemiş işler aktarılır. Tahsilat, cari borç, hakediş veya imza otomatik oluşturulmaz. Geçmiş fiyat korunur; güncel fiyat listesi uygulanmaz.</p>
      <button class="btn" data-history-backup>Önce Tam Yedek İndir</button>
      <label class="history-check"><input type="checkbox" data-history-confirm> Seçili kayıtların tarihini, miktarını, fiyatını ve hesap durumunu kontrol ettim.</label>
      <button class="btn primary block" data-history-commit disabled>Seçili Kayıtları Aktar</button><div data-history-result aria-live="polite"></div></section>
    </div>`;
  const select = (values, value, attrs = "") =>
    `<select ${attrs}>${values.map((v) => `<option value="${esc(v.v ?? v)}" ${String(v.v ?? v) === String(value ?? "") ? "selected" : ""}>${esc(v.t ?? v)}</option>`).join("")}</select>`;
  const field = (label, value, name, type = "text") =>
    `<label class="field">${esc(label)}<input data-h-field="${name}" type="${type}" value="${esc(value ?? "")}" ${type === "number" ? 'step="any" min="0"' : ""}></label>`;
  function ref(store, label, fieldName, c) {
    const matches = (data.customers || []).filter(
      (x) => isActive(x) && canonical(x.name) === canonical(c.row.customer),
    );
    const customerId =
      c.refs.customer_id || (matches.length === 1 ? matches[0].id : null);
    const all = (data[store] || []).filter(
      (r) =>
        isActive(r) &&
        (store !== "sites" || (customerId && r.customer_id === customerId)),
    );
    return `<label class="field">${esc(label)}${select([{ v: "", t: "Dosyadaki adı eşleştir" }, ...all.map((r) => ({ v: r.id, t: r.name + (r.active === false ? " (Pasif)" : "") }))], c.refs[fieldName], `data-h-ref="${fieldName}"`)}</label>`;
  }
  function previewRow(index) {
    const c = choices[index],
      r = c.row,
      f = plan.findings[index];
    const error = f.errors.length
      ? f.errors.join(" · ")
      : c.include
        ? "Kontrol uygun"
        : "Beklemede — kaydedilmeyecek";
    return `<section class="slip-panel history-row" data-h-row="${index}">
      <div class="row between"><h2>${index + 1} · ${r.kind === "work" ? "İş Kaydı" : "Yakıt Kaydı"}</h2><label class="history-check"><input type="checkbox" data-h-include ${c.include ? "checked" : ""}> Aktar</label></div>
      <p class="history-state ${f.errors.length ? "bad" : ""}" data-h-state="${index}">${esc(error)}</p>
      <div class="formgrid2">${field("İşin gerçek tarihi", r.date, "date", "date")}${field("Araç / Makine adı", r.vehicle, "vehicle")}</div>
      ${ref("vehicles", "Mevcut araç kartı", "vehicle_id", c)}
      ${
        r.kind === "work"
          ? `
        <div class="formgrid2">${field("Müşteri adı", r.customer, "customer")}${field("Şantiye adı (varsa)", r.site, "site")}</div>
        <div class="formgrid2">${ref("customers", "Mevcut müşteri kartı", "customer_id", c)}${ref("sites", "Mevcut şantiye kartı", "site_id", c)}</div>
        <label class="field">İş türü${select(WORK_TYPES, r.work_type, 'data-h-field="work_type"')}</label>
        <div class="formgrid2">${field("Miktar", r.quantity, "quantity", "number")}<label class="field">Birim${select(WORK_UNITS, r.unit, 'data-h-field="unit"')}</label></div>
        <div class="formgrid2">${field("Geçmiş birim fiyatı (TL)", r.unit_price, "unit_price", "number")}<label class="field">KDV oranı${select([{ v: "", t: "Oranı seçin" }, ...["0", "1", "10", "20"].map((v) => ({ v, t: "%" + v }))], r.kdv_rate, 'data-h-field="kdv_rate"')}</label></div>
        <label class="field">Fiyatın KDV durumu${select(
          [
            { v: "", t: "Seçin" },
            { v: "false", t: "KDV hariç" },
            { v: "true", t: "KDV dahil" },
          ],
          typeof r.kdv_included === "boolean" ? String(r.kdv_included) : "",
          'data-h-field="kdv_included"',
        )}</label>
        <label class="history-check"><input type="checkbox" data-h-unpriced ${c.unpriced_confirmed ? "checked" : ""}> Fiyatı bilinmiyor; fiyat bekleyen iş olarak aktar.</label>
        <div data-h-dump ${FIELD_METADATA.dump_area.applies_to.includes(r.work_type) ? "" : "hidden"}>${field("Döküm sahası (varsa)", r.dump_site, "dump_site")}${ref("dump_sites", "Mevcut döküm kartı", "dump_site_id", c)}</div>
        <div data-h-quarry ${FIELD_METADATA.quarry.applies_to.includes(r.work_type) ? "" : "hidden"}>${field("Malzeme ocağı (varsa)", r.quarry, "quarry")}${ref("quarries", "Mevcut ocak kartı", "quarry_id", c)}</div>
        ${field("Malzeme (varsa)", r.material, "material")}
      `
          : `${field("Litre", r.liters, "liters", "number")}<p>Kaynak: ${esc(r.fuel_source)}</p><label class="history-check"><input type="checkbox" data-h-tank ${c.tank_confirmed ? "checked" : ""}> Bu çıkış stokta henüz düşülmedi; geçmiş tank başlangıcını kontrol ettim.</label>`
      }
      ${field("Personel adı (biliniyorsa)", r.personnel, "personnel")}${ref("personnel", "Mevcut personel kartı", "personnel_id", c)}
      <label class="field">Müşteriye açıklama<textarea data-h-field="description">${esc(r.description || "")}</textarea></label>
      <details><summary>Kaynak mesajı göster</summary><p class="history-source">${esc(r.raw_message || "Kaynak mesaj belirtilmedi.")}</p></details>
    </section>`;
  }
  function validate(render = false) {
    if (!pkg) return;
    plan = prepareHistory(pkg, choices, data, {
      allowNew: qs("[data-history-new]", root).checked,
    });
    const ready = plan.ready,
      held = choices.length - plan.selected;
    qs("[data-history-summary]", root).innerHTML =
      `<div class="slip-overview"><div><span>Seçili</span><strong>${plan.selected}</strong></div><div><span>Beklemede</span><strong>${held}</strong></div><div><span>Kontrol hatası</span><strong>${plan.errors.length}</strong></div></div>${plan.newCards.length ? `<p class="slip-hint">Yeni kartlar: ${plan.newCards.map((c) => esc(c.name)).join(" · ")}</p>` : ""}<p class="history-state ${ready ? "" : "bad"}">${ready ? "Seçili kayıtlar aktarılabilir." : esc(plan.errors[0] || "Aktarılacak satır seçin.")}</p>`;
    qs("[data-history-commit]", root).disabled =
      busy || !ready || !qs("[data-history-confirm]", root).checked;
    for (const e of root.querySelectorAll("[data-h-state]")) {
      const f = plan.findings[Number(e.dataset.hState)];
      e.textContent = f.errors.length
        ? f.errors.join(" · ")
        : f.selected
          ? "Kontrol uygun"
          : "Beklemede — kaydedilmeyecek";
      e.classList.toggle("bad", !!f.errors.length);
    }
    if (render)
      pagedRender(
        qs("[data-history-rows]", root),
        pkg.rows.map((_, i) => i),
        previewRow,
        10,
      );
  }
  async function openFile(raw, title) {
    try {
      if (busy) return;
      const next = readHistoryPackage(raw);
      data = await loadHistoryData();
      pkg = next;
      choices = initialHistoryChoices(pkg);
      qs("[data-history-confirm]", root).checked = false;
      qs("[data-history-new]", root).checked = false;
      qs("[data-history-result]", root).textContent = "";
      qs("[data-history-preview]", root).hidden = false;
      qs("[data-history-file-name]", root).textContent =
        title + " · " + pkg.rows.length + " satır";
      validate(true);
    } catch (e) {
      pkg = null;
      choices = [];
      plan = null;
      qs("[data-history-preview]", root).hidden = true;
      qs("[data-history-file-name]", root).textContent =
        "Geçersiz dosya: " + e.message;
      toast("Dosya açılamadı: " + e.message, "err");
    }
  }
  qs("[data-history-file]", root).addEventListener("change", async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    if (f.size > 2 * 1024 * 1024) {
      toast("Dosya en fazla 2 MB olabilir.", "err");
      return;
    }
    await openFile(await f.text(), f.name);
  });
  qs("[data-history-sample]", root).addEventListener("click", async () => {
    try {
      const r = await fetch("./data/history-template.json");
      if (!r.ok) throw Error("Şablon bulunamadı");
      downloadBlob(
        new Blob([await r.text()], { type: "application/json" }),
        "SAHAPRO_gecmis_is_sablonu.json",
      );
    } catch (e) {
      toast(e.message, "err");
    }
  });
  root.addEventListener("change", (e) => {
    const card = e.target.closest("[data-h-row]");
    if (card) {
      const c = choices[Number(card.dataset.hRow)],
        el = e.target;
      if (el.hasAttribute("data-h-include")) c.include = el.checked;
      if (el.hasAttribute("data-h-tank")) c.tank_confirmed = el.checked;
      if (el.hasAttribute("data-h-unpriced")) c.unpriced_confirmed = el.checked;
      if (el.dataset.hRef) c.refs[el.dataset.hRef] = el.value;
      if (el.dataset.hRef === "customer_id") {
        const customer = (data.customers || []).find((x) => x.id === el.value);
        if (customer) {
          c.row.customer = customer.name;
          card.querySelector('[data-h-field="customer"]').value = customer.name;
        }
      }
      if (el.dataset.hRef === "site_id" && el.value) {
        const site = (data.sites || []).find((x) => x.id === el.value);
        if (site) {
          c.row.site = site.name;
          card.querySelector('[data-h-field="site"]').value = site.name;
        }
      }
      if (el.dataset.hField) {
        const k = el.dataset.hField;
        if (k === "work_type") {
          const dump = FIELD_METADATA.dump_area.applies_to.includes(el.value),
            quarry = FIELD_METADATA.quarry.applies_to.includes(el.value);
          card.querySelector("[data-h-dump]").hidden = !dump;
          card.querySelector("[data-h-quarry]").hidden = !quarry;
          if (!dump) {
            c.row.dump_site = "";
            c.refs.dump_site_id = "";
            card.querySelector('[data-h-field="dump_site"]').value = "";
            card.querySelector('[data-h-ref="dump_site_id"]').value = "";
          }
          if (!quarry) {
            c.row.quarry = "";
            c.refs.quarry_id = "";
            card.querySelector('[data-h-field="quarry"]').value = "";
            card.querySelector('[data-h-ref="quarry_id"]').value = "";
          }
        }
        c.row[k] =
          k === "kdv_included"
            ? el.value === ""
              ? null
              : el.value === "true"
            : el.value;
        const refKeys = {
          vehicle: "vehicle_id",
          customer: "customer_id",
          site: "site_id",
          personnel: "personnel_id",
          dump_site: "dump_site_id",
          quarry: "quarry_id",
        };
        if (refKeys[k]) {
          c.refs[refKeys[k]] = "";
          card.querySelector(`[data-h-ref="${refKeys[k]}"]`).value = "";
        }
      }
      if (
        el.dataset.hRef === "customer_id" ||
        el.dataset.hField === "customer"
      ) {
        c.row.site = "";
        c.refs.site_id = "";
        card.querySelector('[data-h-field="site"]').value = "";
        card
          .querySelector('[data-h-ref="site_id"]')
          .closest("label").outerHTML = ref(
          "sites",
          "Mevcut şantiye kartı",
          "site_id",
          c,
        );
      }
    }
    if (card || e.target.hasAttribute("data-history-new"))
      qs("[data-history-confirm]", root).checked = false;
    validate();
  });
  qs("[data-history-refresh]", root).addEventListener("click", async () => {
    data = await loadHistoryData();
    validate(true);
  });
  qs("[data-history-backup]", root).addEventListener("click", async () => {
    try {
      const b = await fullBackup(db);
      downloadBlob(
        new Blob([JSON.stringify(b)], { type: "application/json" }),
        "SAHAPRO_aktarim_oncesi_tam_yedek.json",
      );
      toast(
        "Tam yedek indirme başlatıldı. Dosyanın kaydedildiğini kontrol edin.",
        "ok",
      );
    } catch (e) {
      toast(e.message, "err");
    }
  });
  qs("[data-history-report]", root).addEventListener("click", async () => {
    try {
      validate();
      const { exportDocument } = await import("./document-engine.js");
      const resolvedName = (store, id, fallback) =>
        (data[store] || [])
          .concat(plan.writes[store] || [])
          .find((r) => r.id === id)?.name ||
        fallback ||
        "—";
      await exportDocument({
        title: "Geçmiş İş Aktarım Kontrolü",
        template: "report",
        audience: "internal",
        orientation: "landscape",
        sections: [
          {
            text:
              "Önizleme — kayıt yapılmış olduğunu göstermez. " +
              (pkg.title || ""),
          },
          {
            headers: [
              "Tarih",
              "Tür",
              "Müşteri",
              "Araç",
              "İş / Litre",
              "Miktar",
              "Fiyat",
              "Kontrol",
            ],
            rows: choices.map((c, i) => {
              const record = plan.writes.work_records
                .concat(plan.writes.fuel_records)
                .find((r) => r.history_source?.row_id === pkg.rows[i].row_id);
              return [
                trDate(c.row.date),
                c.row.kind === "work" ? "İş" : "Yakıt",
                resolvedName(
                  "customers",
                  record?.customer_id || c.refs.customer_id,
                  c.row.customer,
                ),
                resolvedName(
                  "vehicles",
                  record?.vehicle_id || c.refs.vehicle_id,
                  c.row.vehicle,
                ),
                c.row.work_type || "Yakıt",
                fmtNum(c.row.quantity ?? c.row.liters) +
                  " " +
                  (c.row.unit || "Lt"),
                c.row.unit_price == null || c.row.unit_price === ""
                  ? "Bekliyor"
                  : fmtTL(c.row.unit_price) + " TL",
                !c.include
                  ? "Beklemede"
                  : plan.findings[i].errors.join("; ") || "Uygun",
              ];
            }),
          },
        ],
      });
    } catch (e) {
      toast(e.message, "err");
    }
  });
  qs("[data-history-commit]", root).addEventListener("click", async () => {
    if (busy) return;
    busy = true;
    validate();
    try {
      if (!plan.ready || !qs("[data-history-confirm]", root).checked)
        throw Error("Kontrolleri ve son onayı tamamlayın.");
      const selectedChoices = structuredClone(choices),
        selectedOptions = { allowNew: qs("[data-history-new]", root).checked };
      if (
        !(await confirmDialog(
          "Geçmiş kayıtlar aktarılsın mı?",
          `${plan.selected} seçili kaynak satırı kaydedilecek. ${choices.length - plan.selected} satır beklemede kalacak. Önce otomatik tam kurtarma yedeği oluşturulur.`,
          "Aktar",
        ))
      )
        return;
      const result = await commitHistory(pkg, selectedChoices, selectedOptions);
      data = await loadHistoryData();
      validate(true);
      qs("[data-history-result]", root).innerHTML =
        `<div class="notice">Aktarım tamamlandı: ${result.works} iş, ${result.fuels} yakıt ve ${result.cards} yeni kart. ${choices.length - plan.selected} seçilmemiş satır kaydedilmedi.</div><button class="btn" data-go="#/isler">İş Kayıtlarını Aç</button><button class="btn" data-go="#/yakit">Yakıt Kayıtlarını Aç</button>`;
      const messageId = sessionStorage.getItem("solo_history_message");
      if (messageId) {
        await (await import("./solo-db.js")).syncMessageStatus(messageId);
        sessionStorage.removeItem("solo_history_message");
      }
      toast("Seçili kayıtlar kalıcı olarak kaydedildi.", "ok");
    } catch (e) {
      toast(e.message, "err");
      qs("[data-history-result]", root).textContent =
        "Aktarım yapılmadı: " + e.message;
    } finally {
      busy = false;
      validate();
    }
  });
  const staged = sessionStorage.getItem("solo_history_package");
  if (staged) {
    sessionStorage.removeItem("solo_history_package");
    await openFile(staged, "Mesaj gelen kutusundan taslak");
    const messageId = sessionStorage.getItem("solo_history_message");
    if (pkg && messageId) {
      const message = await db.get("inbox_messages", messageId);
      // Carry the explicitly selected card IDs, not an ambiguous same-name guess.
      for (const [i, row] of pkg.rows.entries()) {
        const source = message?.review_rows?.find(
          (r) => row.row_id === "inbox-" + messageId + "-" + r.source_row,
        );
        if (!source) continue;
        for (const [key, store] of [
          ["vehicle_id", "vehicles"],
          ["customer_id", "customers"],
          ["site_id", "sites"],
          ["personnel_id", "personnel"],
          ["dump_site_id", "dump_sites"],
        ])
          if (
            source[key] &&
            (data[store] || []).some((r) => isActive(r) && r.id === source[key])
          )
            choices[i].refs[key] = source[key];
      }
      validate(true);
    }
  }
}
