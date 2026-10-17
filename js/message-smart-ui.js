import { analyzeMessage } from "./message-engine.js";
import * as core from "./core.js";
import * as rules from "./solo-core.js";
import * as smart from "./message-smart-core.js";
import * as actions from "./message-smart-db.js";
import { refreshMessage, rejectMessage, syncMessageStatus } from "./solo-db.js";
import * as ui from "./ui.js";
const {
  qs,
  qsa,
  esc,
  appbar,
  fDate,
  fNum,
  fArea,
  fSelect,
  fText,
  toast,
  go,
  confirmDialog,
  promptDialog,
  pagedRender,
} = ui;
const option = (d, store) =>
  rules.live(d, store).map((r) => ({ v: r.id, t: r.name || r.id }));
const b = (text, href) =>
  `<button class="btn" data-go="${esc(href)}">${esc(text)}</button>`;
const input = (title, field, value, type = "text") =>
  type === "number"
    ? fNum(title, field, value ?? "", { step: "any" })
    : type === "date"
      ? fDate(title, field, value || "", false)
      : fText(title, field, value ?? "");
const safe = async (fn) => {
  try {
    return await fn();
  } catch (e) {
    toast(e.message || String(e), "err");
  }
};
const memories = ["vehicle", "customer", "site", "personnel"];
const names = {
  vehicle: "Araç / makine",
  customer: "Müşteri",
  site: "Şantiye",
  personnel: "Personel",
};
export async function memoryScreen(ctx, d) {
  const { root } = ctx;
  root.innerHTML =
    appbar("Onaylı Mesaj Hafızası", "Takma adları sen yönetirsin") +
    `<section class="solo-intro">Eşleştirmeler yalnız açık onayla kaydedilir. Geçmişte kontrol ettiğin taslaklar ve işler sonradan değişmez. Bu hafıza ortak takma ad listesini kullanır.</section><form data-memory-form>${fText("Mesajda geçen takma ad", "alias", "", { ph: "Örnek: bizim kamyonet" })}${fSelect(
      "Kart türü",
      "target_type",
      memories.map((v) => ({ v, t: names[v] })),
      "vehicle",
      { empty: false },
    )}<div data-memory-target></div><label class="history-check"><input type="checkbox" name="confirmed"> Bu ifadeyi seçtiğim kartla sonraki mesajlarda eşleştirmeyi onaylıyorum.</label><button type="button" class="btn primary" data-memory-save>Eşleştirmeyi Kaydet</button></form><h2>Mevcut eşleştirmeler</h2><div data-memory-list></div>`;
  const update = () => {
    const type = qs("[name=target_type]", root).value;
    qs("[data-memory-target]", root).innerHTML = fSelect(
      "Eşleşecek kart",
      "target_id",
      option(d, smart.MEMORY_TYPES[type]),
      "",
    );
  };
  update();
  qs("[name=target_type]", root).onchange = update;
  qs("[data-memory-save]", root).onclick = () =>
    safe(async () => {
      const f = ui.collectForm(qs("[data-memory-form]", root));
      f.confirmed = qs("[name=confirmed]", root).checked;
      await actions.saveMessageMemory(f);
      toast("Eşleştirme kaydedildi", "ok");
      ctx.reload();
    });
  pagedRender(
    qs("[data-memory-list]", root),
    rules.live(d, "aliases").slice().reverse(),
    (a) =>
      `<article class="card"><h3>${esc(a.alias)}</h3><p>${esc(names[a.target_type] || a.target_type)} · ${esc(rules.label(d, smart.MEMORY_TYPES[a.target_type], a.target_id))}</p><p>${a.active === false ? "Pasif" : a.origin === "message_review" ? "Kullanıcı tarafından onaylandı" : "Mevcut takma ad"}</p>${a.active === false ? "" : `<button class="btn" data-memory-disable="${esc(a.id)}">Pasife Al</button>`}</article>`,
    20,
  );
  root.addEventListener("click", (e) => {
    const target = e.target.closest("[data-memory-disable]");
    if (target)
      safe(async () => {
        const reason = await promptDialog("Eşleştirmeyi pasife al", "Gerekçe");
        if (!reason) return;
        await actions.deactivateMessageMemory(
          target.dataset.memoryDisable,
          reason,
        );
        ctx.reload();
      });
  });
}
function rowEditor(r, index, d, locked) {
  const value = (k) => r[k] ?? "";
  return `<article class="message-review-card" data-review-row="${index}"><div class="row"><h3>${index + 1}. ${r.kind === "fuel" ? "Yakıt" : "İş"} satırı</h3><label class="history-check"><input type="checkbox" data-row-include ${r.include !== false ? "checked" : ""} ${locked ? "disabled" : ""}> Aktarıma dahil</label></div><div data-row-questions></div><fieldset ${locked ? "disabled" : ""}><div class="formgrid2">${input("Gerçek iş tarihi", "date", r.date, "date")}${fSelect("Araç / makine", "vehicle_id", option(d, "vehicles"), value("vehicle_id"))}</div>${
    r.kind === "work"
      ? `<div class="formgrid2"><div>${fSelect("Müşteri", "customer_id", option(d, "customers"), value("customer_id"))}${locked ? "" : '<button class="btn" type="button" data-new-message-customer>+ Yeni Müşteri Ekle</button>'}</div>${fSelect(
          "Şantiye",
          "site_id",
          option(d, "sites").filter(
            (o) =>
              rules.live(d, "sites").find((x) => x.id === o.v)?.customer_id ===
              r.customer_id,
          ),
          value("site_id"),
        )}</div>${fSelect("İş türü", "work_type", core.WORK_TYPES, value("work_type"))}<div class="formgrid2">${input("Miktar", "quantity", r.quantity, "number")}${fSelect("Birim", "unit", core.WORK_UNITS, value("unit"))}</div><details class="message-price" ${r.unit_price != null ? "open" : ""}><summary>Fiyat ve KDV bilgileri</summary><div class="formgrid2">${input("Geçmiş birim fiyat (TL)", "unit_price", r.unit_price, "number")}${input("KDV oranı (%)", "kdv_rate", r.kdv_rate, "number")}</div>${fSelect(
          "Fiyatın KDV durumu",
          "kdv_included",
          [
            { v: "false", t: "KDV hariç" },
            { v: "true", t: "KDV dahil" },
          ],
          typeof r.kdv_included === "boolean" ? String(r.kdv_included) : "",
        )}<div data-row-price></div></details>`
      : `<div class="formgrid2">${input("Litre", "fuel_liters", r.fuel_liters, "number")}${fSelect("Yakıt kaynağı", "fuel_source", ["Depo Tankı", "İstasyon"], value("fuel_source"))}</div>`
  }${r.dump_site_id || r.transport_group_key ? fSelect("Döküm sahası", "dump_site_id", option(d, "dump_sites"), value("dump_site_id")) : ""}${r.duration ? `<p class="notice">Saat aralığından öneri: brüt ${r.duration.gross_minutes / 60} saat · mola ${r.duration.break_minutes / 60} saat · net ${r.duration.net_minutes / 60} saat. Gerçek net süreyi doğrulayın.</p>` : ""}${r.inference_confirmed === false ? `<label class="history-check"><input type="checkbox" data-inference-confirm ${locked ? "disabled" : ""}> Sefer / net çalışma süresi önerisini doğruladım.</label>` : ""}${fSelect("Operatör / şoför (opsiyonel)", "personnel_id", option(d, "personnel"), value("personnel_id"))}${fArea("İş açıklaması", "description", r.description || "")}</fieldset>${!locked ? `<button type="button" class="btn" data-learn-row="${index}">Bu Eşleşmeyi Hatırla</button>` : ""}<div class="row">${Object.entries(
    r.candidates || {},
  )
    .flatMap(([field, cs]) =>
      cs
        .filter((c) => ["spelling_candidate", "role_candidate", "ascii_fold", "context_candidate"].includes(c.via))
        .map(
          (c) =>
            `<button type="button" class="btn" data-engine-candidate="${index}|${esc(field)}|${esc(c.id)}" ${locked ? "disabled" : ""}>${esc(c.name)} olabilir mi?</button>`,
        ),
    )
    .join(
      "",
    )}</div><details><summary>Alanların analiz edilen metindeki ifadeleri</summary>${Object.entries(
    r.evidence || {},
  )
    .filter(([, e]) => e?.text)
    .map(([field, e]) => `<p class="wrap">${esc(e.text)}</p>`)
    .join(
      "",
    )}</details><div data-row-similar></div><details><summary>Kaynak ve alan kanıtları</summary><p class="wrap">${esc(r.description)}</p><ul>${Object.entries(
    r.field_sources || {},
  )
    .map(
      ([k, v]) =>
        `<li>${esc({ unit_price: "Birim fiyat", kdv_rate: "KDV oranı", kdv_included: "KDV durumu", vehicle_id: "Araç", customer_id: "Müşteri", site_id: "Şantiye", personnel_id: "Personel", date: "Tarih", quantity: "Miktar", unit: "Birim", description: "Açıklama", fuel_source: "Yakıt kaynağı", fuel_liters: "Litre" }[k] || "Alan")}: ${esc(String(v))}</li>`,
    )
    .join(
      "",
    )}</ul><p>Gönderen otomatik şoför sayılmaz. Fiyat önerisi ödeme veya hakediş oluşturmaz.</p></details></article>`;
}
export async function messageWorkbench(ctx, d, m, tools) {
  const { root } = ctx,
    locked = actions.messageLocked(m, d),
    rows = smart.assistedRows(m, d),
    revision = JSON.stringify(m.review_rows || null);
  const analysis = analyzeMessage(m, d);
  let dirty = false;
  // Several matching cards must be chosen explicitly, not silently inherited.
  if (!m.reviewed_at && !locked)
    for (const row of rows)
      for (const question of smart.rowQuestions(row, d))
        if (question.text.startsWith("Birden fazla"))
          row[question.field] = null;
  const sources = m.source_messages?.length ? m.source_messages : [m],
    suggestions = smart.mergeSuggestions(m, d);
  if (m.merge_parent_id) {
    root.innerHTML =
      appbar("Birleştirilmiş Mesaj", "Kaynak korunuyor") +
      `<section class="card"><pre class="wrap">${esc(m.raw)}</pre><p>Bu mesaj başka taslağa bağlı. Ayrı aktarım yapılamaz.</p>${b("Birleşik taslağı aç", "#/mesajlar/" + m.merge_parent_id)}</section>`;
    return;
  }
  root.innerHTML =
    appbar("Akıllı Mesaj Kontrolü", m.status) +
    tools.toolbar() +
    `<section class="solo-intro">${m.status === "Aktarıldı" ? "Seçili kaynak satırları aktarıldı. Kaynağı ve bağlı iş/yakıt kayıtlarını inceleyebilirsin." : m.status === "Kısmen Aktarıldı" ? "Bazı satırlar aktarıldı. Son kontrol ekranına yalnız henüz aktarılmamış satırlar gönderilir." : "Mesajı incele → eksikleri tamamla → taslağı kaydet → son aktarım kontrolünü yap. Taslak kaydı iş, yakıt veya ödeme oluşturmaz."}</section><section class="card"><h2>Ayrıştırma kontrolü</h2>${analysis.notices.map((n) => `<p class="message-issues">${esc(n.text)}</p><details><summary>Kaynak ifade</summary><p class="wrap">${esc(analysis.raw.slice(n.span.start, n.span.end))}</p></details>`).join("")}${analysis.targetCandidates?.length ? `<h3>İlgili olabilecek işler</h3><p>Bu kayıtlar otomatik değiştirilmez. Doğru kaydı açıp normal düzeltme/revizyon akışını kullanın.</p>${analysis.targetCandidates.map((w) => `<p>${esc(w.date)} · ${esc(w.customer)} · ${esc(w.vehicle)} · ${esc(String(w.quantity))} ${esc(w.unit || "")}${w.locked ? " · Kilitli kayıt" : ""}</p>${b("İşi İncele", "#/isler/" + w.id)}`).join("")}` : ""}${!analysis.notices.length ? "<p>Ayrıştırma sırasında ek bir çelişki işaretlenmedi. Alanları ve son aktarım kontrolünü doğrulayın.</p>" : ""}${analysis.distribution ? `<p>Döküm toplamı: ${analysis.distribution.listed} / ${analysis.distribution.total} sefer</p>` : ""}</section><section class="card"><h2>Kaynak mesajlar (${sources.length})</h2>${sources.map((s) => `<details><summary>${esc(s.sender || "Gönderen belirtilmedi")} · ${esc(s.date || "Tarih yok")} ${esc(s.time || "")}</summary><pre class="wrap">${esc(s.raw || s.text)}</pre></details>`).join("")}${m.review_rows?.length && !locked ? '<button class="btn" data-engine-reanalyze>Yeni Motorla Yeniden İncele</button>' : ""}${m.source_messages?.length && !locked ? '<button class="btn" data-merge-undo>Mesajları Yeniden Ayır</button>' : ""}${!locked && !m.review_rows && !m.source_messages ? `<details><summary>Kaynak metnin çalışma kopyasını düzelt</summary><form data-raw-form>${fDate("Mesajın gerçek tarihi", "date", m.date || "", false)}${fArea("İşlenecek metin", "text", m.text)}<button type="button" class="btn" data-raw-save>Yeniden Ayrıştır</button></form></details>` : ""}</section>${suggestions.length ? `<section class="card"><h2>Bağlantılı olabilir</h2><p>Aynı gönderenin 30 dakika içindeki kısa devam mesajları. Yalnız seçip onayladıkların birleştirilir.</p>${suggestions.map((x) => `<label class="history-check"><input type="checkbox" data-merge-id="${esc(x.id)}"> ${esc(x.time || "")} · ${esc(x.text)}</label>`).join("")}<button class="btn" data-merge-review>Seçilenlerle Birleştir</button></section>` : ""}<section class="card"><h2>Eksik bilgi sırası</h2><div data-question-summary></div><div class="row">${b("Onaylı Eşleştirme Hafızası", "#/mesaj-hafizasi")}</div></section>${!locked && rows.length > 1 ? `<details class="card"><summary>Seçili satırlara ortak bilgi uygula</summary><form data-bulk-form>${fSelect("Ortak araç", "vehicle_id", option(d, "vehicles"), "")}${fSelect("Ortak müşteri", "customer_id", option(d, "customers"), "")}${fDate("Ortak tarih", "date", "", false)}<p class="notice">Yalnız aktarıma dahil satırlar değişir. Müşteri değişince şantiye temizlenir.</p><button type="button" class="btn" data-bulk-apply>Seçili Satırlara Uygula</button></form></details>` : ""}<div data-review-list></div>${locked ? '<p class="notice">Kaynak kilitli. İş düzeltmesi ilgili kayıt/revizyon ekranından yapılır.</p>' : `<div class="message-actionbar"><button class="btn primary" data-s-save ${!rows.length || analysis.blocking ? "disabled" : ""}>Kontrol Taslağını Kaydet</button><p data-dirty-note aria-live="polite"></p></div>`}<section class="card">${["Reddedildi", "Aktarıldı"].includes(m.status) ? (m.linked_records || []).map((x) => b("Bağlı Kaydı Aç", "#/" + (x.store === "fuel_records" ? "yakit" : "isler") + "/" + x.id)).join("") : `<label class="history-check"><input type="checkbox" data-unpaid> Seçtiğim işlerin ödenmediğini ve hakedişe alınmadığını doğruladım.</label><button class="btn primary" data-transfer disabled>Kontrollü İş Aktarımına Geç</button>`}<button class="btn" data-sync>Aktarım Durumunu Kontrol Et</button>${!locked ? fArea("Red gerekçesi", "reason") + '<button class="btn danger" data-reject>Mesajı Reddet</button>' : ""}</section>`;
  const markDirty = () => {
    dirty = true;
    qs("[data-dirty-note]", root).textContent =
      "Değişiklikler kaydedilmedi; aktarımdan önce taslağı kaydet.";
    qs("[data-transfer]", root)?.setAttribute("disabled", "");
  };
  const update = () => {
    const included = rows.filter((r) => r.include !== false),
      questions = included.flatMap((r) =>
        smart
          .rowQuestions(r, d)
          .map((q) => ({ ...q, rowIndex: rows.indexOf(r) })),
      );
    qs("[data-question-summary]", root).innerHTML = questions.length
      ? `<p>${included.length} seçili satır · ${questions.length} eksik / kontrol konusu</p><p>${locked ? "Kaynak kilitli; kalan satırları son aktarım ekranında kontrol edin." : "Önce şu bilgiyi tamamla:"}</p><button class="btn primary" ${locked ? "disabled" : ""} data-question-jump="${questions[0].rowIndex}:${questions[0].field}">${esc(questions[0].text)}</button><ol>${[
          ...new Set(questions.map((q) => q.text)),
        ]
          .slice(0, 8)
          .map((t) => `<li>${esc(t)}</li>`)
          .join("")}</ol>`
      : !included.length
        ? "<p>Bu mesajdan aktarılabilir iş/yakıt satırı çıkarılmadı. Kaynak ifadesini inceleyin; gerekirse çalışma metnini düzeltip yeniden ayrıştırın.</p>"
        : "<p>Seçili satırlardaki temel alanlar tamam. Son aktarım kontrolü ve hesap durumu onayı hâlâ gerekli.</p>";
    for (const el of qsa("[data-review-row]", root)) {
      const index = Number(el.dataset.reviewRow),
        r = rows[index],
        questions = smart.rowQuestions(r, d),
        similar = smart.similarRecords(r, d);
      qs("[data-row-questions]", el).innerHTML =
        r.include === false
          ? '<p class="notice">Bu satır bekletiliyor; aktarılmaz.</p>'
          : questions.length
            ? `<ul class="message-issues">${questions.map((q) => `<li>${esc(q.text)}</li>`).join("")}</ul>`
            : '<p class="message-status matched">Temel alanlar tamamlandı</p>';
      const price = smart.datedPriceSuggestion(r, d);
      if (qs("[data-row-price]", el))
        qs("[data-row-price]", el).innerHTML = price
          ? `<p>Tarih aralığı tanımlı fiyat kuralı: ${core.fmtTL(price.unit_price)} TL / ${esc(price.unit)} · ${esc(price.valid_from)}${price.valid_to ? " – " + esc(price.valid_to) : ""}</p><button class="btn" type="button" data-price-apply ${locked ? "disabled" : ""}>Bu Tarihli Fiyatı Seç</button>`
          : '<p class="notice">Bu tarih için doğrulanabilir basit birim fiyat kuralı bulunamadı. Güncel fiyat geçmiş işe otomatik uygulanmaz.</p>';
      qs("[data-row-similar]", el).innerHTML = similar.length
        ? `<section class="message-similar"><h4>Benzer kayıtlar — otomatik silinmez</h4>${similar.map((x) => `<p>${esc(x.record.date)} · ${esc(rules.label(d, "vehicles", x.record.vehicle_id))} · ${esc(String(x.record.quantity ?? x.record.liters))} ${esc(x.record.unit || "L")} · ${esc(x.record.work_type || "Yakıt")}<br>${esc(x.reasons.join(" · "))} ${x.exact ? " · Aynı alanlar; son aktarımda tekrar engeli olabilir." : ""}</p>${b("Kaydı Aç", "#/" + (x.store === "work_records" ? "isler" : "yakit") + "/" + x.id)}`).join("")}<label class="history-check"><input type="checkbox" data-duplicate-check ${r.duplicate_checked ? "checked" : ""} ${locked ? "disabled" : ""}> Benzer kayıtları karşılaştırdım.</label></section>`
        : "";
    }
  };
  pagedRender(
    qs("[data-review-list]", root),
    rows,
    (r) => rowEditor(r, rows.indexOf(r), d, locked),
    10,
  );
  update();
  root.addEventListener("click", (e) => {
    if (e.target.closest("[data-more]")) setTimeout(update, 0);
  });
  root.addEventListener("click", (event) => {
    const button = event.target.closest("[data-engine-candidate]");
    if (!button || locked) return;
    const [index, field, id] = button.dataset.engineCandidate.split("|");
    const row = rows[Number(index)];
    const option = row.candidates?.[field]?.find((x) => x.id === id);
    if (!option) return;
    row[field] = id;
    row.field_sources[field] = "Kullanıcı yazım adayı seçti: " + option.name;
    row.duplicate_checked = false;
    const box = qs('[data-review-row="' + index + '"]', root);
    qs('[name="' + field + '"]', box).value = id;
    markDirty();
    update();
  });
  root.addEventListener("click", (event) => {
    const button = event.target.closest("[data-question-jump]");
    if (!button) return;
    const [index, field] = button.dataset.questionJump.split(":");
    let box = qs('[data-review-row="' + index + '"]', root);
    while (!box && qs("[data-review-list] [data-more]", root)) {
      qs("[data-review-list] [data-more]", root).click();
      box = qs('[data-review-row="' + index + '"]', root);
    }
    const input = box && qs('[name="' + field + '"]', box);
    if (!input) return;
    for (let p = input.parentElement; p && p !== root; p = p.parentElement)
      if (p.tagName === "DETAILS") p.open = true;
    input.scrollIntoView({ block: "center", behavior: "smooth" });
    input.focus({ preventScroll: true });
  });
  const edit = (el, event) => {
    const box = el.closest("[data-review-row]");
    if (!box || locked) return;
    const r = rows[Number(box.dataset.reviewRow)];
    if (el.matches("[data-inference-confirm]"))
      r.inference_confirmed = el.checked;
    else if (el.matches("[data-row-include]")) r.include = el.checked;
    else if (el.matches("[data-duplicate-check]"))
      r.duplicate_checked = el.checked;
    else if (el.name) {
      const k = el.name;
      r[k] =
        k === "kdv_included"
          ? el.value === ""
            ? null
            : el.value === "true"
          : el.value || null;
      r.field_sources[k] = "Kullanıcı tarafından seçildi / düzeltildi";
      r.duplicate_checked = false;
      if (k === "customer_id") {
        r.site_id = null;
        qs("[name=site_id]", box).innerHTML =
          '<option value="">— seç —</option>' +
          option(d, "sites")
            .filter(
              (o) =>
                rules.live(d, "sites").find((s) => s.id === o.v)
                  ?.customer_id === r.customer_id,
            )
            .map((o) => `<option value="${esc(o.v)}">${esc(o.t)}</option>`)
            .join("");
      }
    } else return;
    markDirty();
    update();
  };
  root.addEventListener("change", (e) => edit(e.target, e));
  root.addEventListener("input", (e) => {
    if (e.target.matches("input:not([type=checkbox]),textarea"))
      edit(e.target, e);
  });
  root.addEventListener("click", (e) => {
    const price = e.target.closest("[data-price-apply]");
    if (price)
      safe(async () => {
        const r =
            rows[Number(price.closest("[data-review-row]").dataset.reviewRow)],
          p = smart.datedPriceSuggestion(r, d);
        if (!p || locked) return;
        if (
          !(await confirmDialog(
            "Tarihli fiyatı seç",
            "Bu fiyatı işin yapıldığı tarihe uygun olduğunu kontrol ederek seçiyor musun?",
            "Fiyatı Seç",
          ))
        )
          return;
        r.unit_price = p.unit_price;
        r.kdv_rate = p.kdv_rate ?? null;
        r.kdv_included =
          typeof p.kdv_included === "boolean" ? p.kdv_included : null;
        r.field_sources.unit_price =
          "Kullanıcı onaylı tarihli fiyat: " +
          p.valid_from +
          " · " +
          (p.price_source || "Fiyat listesi");
        const box = price.closest("[data-review-row]");
        qs("[name=unit_price]", box).value = r.unit_price;
        qs("[name=kdv_rate]", box).value = r.kdv_rate ?? "";
        qs("[name=kdv_included]", box).value =
          r.kdv_included == null ? "" : String(r.kdv_included);
        markDirty();
        update();
      });
  });
  qs("[data-bulk-apply]", root)?.addEventListener("click", () =>
    safe(async () => {
      const f = ui.collectForm(qs("[data-bulk-form]", root));
      if (!f.vehicle_id && !f.customer_id && !f.date)
        throw Error("Uygulanacak en az bir ortak alan seçin");
      if (
        !(await confirmDialog(
          "Ortak bilgileri uygula",
          rows.filter((r) => r.include !== false).length +
            " seçili satır değişecek.",
          "Uygula",
        ))
      )
        return;
      for (const r of rows.filter((r) => r.include !== false)) {
        for (const k of ["vehicle_id", "customer_id", "date"])
          if (f[k]) {
            r[k] = f[k];
            r.field_sources[k] = "Kullanıcı onaylı toplu seçim";
          }
        if (f.customer_id) r.site_id = null;
        r.duplicate_checked = false;
      }
      qs("[data-review-list]", root).innerHTML = "";
      pagedRender(
        qs("[data-review-list]", root),
        rows,
        (r) => rowEditor(r, rows.indexOf(r), d, locked),
        10,
      );
      markDirty();
      update();
    }),
  );
  root.addEventListener("click", (event) => {
    const button = event.target.closest("[data-new-message-customer]");
    if (!button || locked) return;
    const row =
      rows[Number(button.closest("[data-review-row]").dataset.reviewRow)];
    const dialog = ui.sheet(
      `<h2>Yeni Müşteri Ekle</h2><form data-new-customer-form>${fText("Müşteri / firma adı", "name", "", { ph: "Örnek: Muharrem Arnavutköy" })}${fText("Yetkili (opsiyonel)", "contact", "")}${fText("Telefon (opsiyonel)", "phone", "", { type: "tel" })}</form><p class="notice">Müşteri kartı ve ekrandaki kontrol taslağı birlikte kaydedilir. İş veya ödeme oluşmaz. Aynı adlı tek bir müşteri varsa mevcut kart seçilir.</p><p data-new-customer-error class="message-issues" role="alert" hidden></p><div class="row"><button class="btn" data-customer-cancel>Vazgeç</button><button class="btn primary" data-customer-save>Kaydet ve Seç</button></div>`,
      { modal: true },
    );
    const error = qs("[data-new-customer-error]", dialog),
      save = qs("[data-customer-save]", dialog),
      cancel = qs("[data-customer-cancel]", dialog);
    cancel.onclick = () => ui.sheetClose();
    qs("[data-new-customer-form]", dialog).onsubmit = (e) => {
      e.preventDefault();
      save.click();
    };
    save.onclick = async () => {
      if (save.disabled) return;
      save.disabled = true;
      cancel.disabled = true;
      error.hidden = true;
      try {
        const result = await actions.createMessageCustomer(
          m.id,
          row.source_row,
          rows,
          ui.collectForm(qs("form", dialog)),
          revision,
        );
        ui.sheetClose();
        toast(
          result.created
            ? "Müşteri ve kontrol taslağı kaydedildi"
            : "Mevcut müşteri seçildi; kontrol taslağı kaydedildi",
          "ok",
        );
        ctx.reload();
      } catch (e) {
        error.textContent = e.message || String(e);
        error.hidden = false;
        save.disabled = false;
        cancel.disabled = false;
      }
    };
    qs("[name=name]", dialog).focus();
  });
  root.addEventListener("click", (event) => {
    const button = event.target.closest("[data-learn-row]");
    if (!button || locked) return;
    const row = rows[Number(button.dataset.learnRow)];
    const names = {customer: "Müşteri", vehicle: "Araç", site: "Şantiye", personnel: "Personel"};
    const types = Object.keys(smart.MEMORY_TYPES).filter(type => row[type + "_id"]);
    if (!types.length) return toast("Önce hatırlanacak kartı seçin", "err");
    ui.sheet(`<h2>Bu Eşleşmeyi Hatırla</h2><p>Yalnız onayladığın ifade ve seçili kart saklanır. Tarih, miktar, fiyat ve diğer alanlar öğrenilmez. Açık taslağın değişmez.</p><p class="wrap">${esc(row.description || m.text)}</p><form data-learn-form>${fSelect("Hatırlanacak alan", "target_type", types.map(type => ({v:type,t:names[type]})), types[0], {empty:false})}${fText("Mesajda geçen ifade", "alias", "", {ph:"Örnek: Mahir Bey"})}<p data-learn-target></p><label class="history-check"><input type="checkbox" name="confirmed"> Bu ifadeyi gösterilen kartla sonraki mesajlarda eşleştirmeyi onaylıyorum.</label><p data-learn-error hidden role="alert"></p><button type="button" class="btn primary" data-learn-save>Onayla ve Hatırla</button></form>`);
    const dialog = qs("[data-learn-form]");
    dialog.onsubmit = e => { e.preventDefault(); qs("[data-learn-save]", dialog).click(); };
    const show = () => {
      const type = qs("[name=target_type]", dialog).value;
      qs("[data-learn-target]", dialog).textContent = "Hatırlanacak kart: " + rules.label(d, smart.MEMORY_TYPES[type], row[type + "_id"]);
    };
    qs("[name=target_type]", dialog).onchange = show;
    show();
    qs("[data-learn-save]", dialog).onclick = async () => {
      const save = qs("[data-learn-save]", dialog);
      save.disabled = true;
      try {
        const f = ui.collectForm(dialog);
        f.confirmed = qs("[name=confirmed]", dialog).checked;
        f.target_id = row[f.target_type + "_id"];
        const remembered = await actions.saveMessageMemory(f);
        if (!d.aliases.some(a => a.id === remembered.id)) d.aliases.push(remembered);
        ui.sheetClose();
        toast("Eşleşme telefonda hatırlandı. Taslak seçimlerini ayrıca kaydet.", "ok");
      } catch (error) {
        const box = qs("[data-learn-error]", dialog);
        box.textContent = error.message || String(error);
        box.hidden = false;
        save.disabled = false;
      }
    };
  });
  qs("[data-s-save]", root)?.addEventListener("click", () =>
    safe(async () => {
      await actions.saveMessageRows(m.id, rows, revision);
      toast("Kontrol taslağı kalıcı olarak kaydedildi", "ok");
      ctx.reload();
    }),
  );
  qs("[data-unpaid]", root)?.addEventListener("change", (e) => {
    qs("[data-transfer]", root).disabled =
      !e.target.checked || dirty || !rows.length || analysis.blocking;
  });
  qs("[data-transfer]", root)?.addEventListener("click", () =>
    safe(async () => {
      if (dirty || !qs("[data-unpaid]", root).checked)
        throw Error(
          "Önce değişiklikleri kaydedin ve hesap durumunu doğrulayın",
        );
      const selected = rows.filter((r) => r.include !== false);
      if (
        selected.some(
          (r) => smart.similarRecords(r, d).length && !r.duplicate_checked,
        )
      )
        throw Error(
          "Benzer kayıtları karşılaştırıp kontrol kutusunu işaretleyin",
        );
      // First transfer persists current suggestions. Future alias changes cannot alter these rows.
      if (!locked && !m.review_rows)
        await actions.saveMessageRows(m.id, rows, revision);
      const pkg = await actions.prepareMessageTransfer(m.id);
      sessionStorage.setItem("solo_history_package", JSON.stringify(pkg));
      sessionStorage.setItem("solo_history_message", m.id);
      go("#/gecmis");
    }),
  );
  qs("[data-engine-reanalyze]", root)?.addEventListener("click", () =>
    safe(async () => {
      if (
        !(await confirmDialog(
          "Yeni motorla yeniden incele",
          "Kaydedilmiş alan seçimleri yeniden önerilecek. İş kaydı oluşmaz; ham mesajlar ve mevcut müşteri kartları korunur. Önce kurtarma yedeği alınır.",
          "Yeniden İncele",
        ))
      )
        return;
      await actions.reanalyzeMessage(m.id, true);
      ctx.reload();
    }),
  );
  qs("[data-sync]", root).onclick = () =>
    safe(async () => {
      await syncMessageStatus(m.id);
      ctx.reload();
    });
  qs("[data-reject]", root)?.addEventListener("click", () =>
    safe(async () => {
      if (
        !(await confirmDialog(
          "Taslağı reddet",
          "Mesaj kaynak olarak korunur. İş ve ödeme oluşmaz.",
          "Reddet",
        ))
      )
        return;
      await rejectMessage(m.id, qs("[name=reason]", root).value);
      ctx.reload();
    }),
  );
  qs("[data-raw-save]", root)?.addEventListener("click", () =>
    safe(async () => {
      if (dirty)
        throw Error(
          "Önce satır değişikliklerini kaydedin veya ekranı yeniden açın",
        );
      await refreshMessage(m.id, ui.collectForm(qs("[data-raw-form]", root)));
      ctx.reload();
    }),
  );
  qs("[data-merge-review]", root)?.addEventListener("click", () =>
    safe(async () => {
      if (dirty)
        throw Error("Kaydedilmemiş değişiklik var; önce ekranı yeniden açın");
      const ids = [
        m.id,
        ...qsa("[data-merge-id]:checked", root).map((x) => x.dataset.mergeId),
      ];
      if (
        !(await confirmDialog(
          "Mesajları birleştir",
          ids.length +
            " kaynak birlikte yorumlanacak. Orijinal mesajlar korunur. Aynı iş olduğunu kontrol ettin mi?",
          "Birleştir",
        ))
      )
        return;
      const parent = await actions.mergeMessages(ids, true);
      go("#/mesajlar/" + parent.id);
    }),
  );
  qs("[data-merge-undo]", root)?.addEventListener("click", () =>
    safe(async () => {
      if (dirty)
        throw Error("Kaydedilmemiş değişiklik var; önce ekranı yeniden açın");
      const reason = await promptDialog(
        "Birleştirmeyi geri al",
        "Ayırma gerekçesi",
      );
      if (!reason) return;
      await actions.undoMessageMerge(m.id, reason);
      ctx.reload();
    }),
  );
  const report = () => ({
    title: "Akıllı Mesaj Kontrol Raporu",
    audience: "internal",
    orientation: "landscape",
    sections: [
      { text: "Kontrol taslağı. İş/ödeme kaydı oluştuğunu göstermez." },
      {
        headers: [
          "Tarih",
          "Tür",
          "Müşteri",
          "Araç",
          "Miktar",
          "Birim fiyat",
          "Kontrol",
        ],
        rows: rows.map((r) => [
          r.date || "",
          r.kind === "fuel" ? "Yakıt" : "İş",
          rules.label(d, "customers", r.customer_id),
          rules.label(d, "vehicles", r.vehicle_id),
          String(r.quantity ?? r.fuel_liters ?? "") + " " + (r.unit || "L"),
          r.unit_price == null ? "Bekliyor" : core.fmtTL(r.unit_price),
          r.include === false
            ? "Bekletiliyor"
            : smart
                .rowQuestions(r, d)
                .map((q) => q.text)
                .join("; "),
        ]),
      },
      ...sources.map((s) => ({
        text:
          (s.sender || "") + " " + (s.date || "") + "\n" + (s.raw || s.text),
      })),
    ],
  });
  tools.bindExport(root, report, () => report().sections[1]);
}
export function messageQueueTools(ctx, d, rows) {
  const { root } = ctx;
  const active = rows.filter(
      (m) => m.status === "Taslak" && !m.merge_parent_id,
    ),
    questions = active.reduce(
      (n, m) =>
        n +
        smart
          .assistedRows(m, d)
          .filter((r) => r.include !== false && smart.rowQuestions(r, d).length)
          .length,
      0,
    );
  const slot = document.createElement("section");
  slot.className = "card";
  slot.innerHTML = `<h2>Kontrol Masası</h2><p>${active.length} taslak · ${questions} eksik bilgili satır · ${rows.filter((m) => m.status === "Aktarıldı").length} aktarılmış · ${rows.filter((m) => m.status === "Birleştirildi").length} bağlı kaynak</p>${b("Onaylı Eşleştirmeler", "#/mesaj-hafizasi")}<p>Birleştirme için aynı tarih ve gönderenin 2–10 taslağını seçin. Kaynaklar korunur.</p><button class="btn" data-queue-merge>Seçilen Mesajları Birleştir</button>`;
  qs("[data-s-list]", root).before(slot);
  qs("[data-queue-merge]", root).onclick = () =>
    safe(async () => {
      const ids = qsa("[data-queue-select]:checked", root).map(
        (x) => x.dataset.queueSelect,
      );
      smart.mergeEligibility(
        ids.map((id) => rows.find((m) => m.id === id)),
        d,
      );
      if (
        !(await confirmDialog(
          "Mesajları birleştir",
          ids.length + " mesajın aynı işe ait olduğunu kontrol ettin mi?",
          "Birleştir",
        ))
      )
        return;
      const parent = await actions.mergeMessages(ids, true);
      go("#/mesajlar/" + parent.id);
    });
}
