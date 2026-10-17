import { workHours } from "./enterprise-core.js";
// SAHAPRO SOLO — İş Kayıtları · Dijital Fiş (imza, immutable, revizyon) · WhatsApp Ayrıştırıcı
import {
  qs,
  qsa,
  esc,
  appbar,
  stat,
  li,
  emptyState,
  notice,
  kv,
  badge,
  statusBadge,
  segBar,
  searchBar,
  sheet,
  sheetClose,
  toast,
  confirmDialog,
  promptDialog,
  fText,
  fNum,
  fDate,
  fArea,
  fSelect,
  collectForm,
  setForm,
  fmtTL,
  fmtNum,
  trDate,
  todayStr,
  pagedRender,
  shareOrDownload,
  back,
  go,
} from "./ui.js";
import {
  WORK_UNITS,
  WORK_TYPES,
  isActive,
  todayStr as td,
  matchSearch,
  newRecord,
} from "./core.js";
import { customerWorkLines } from "./business.js";
import {
  parseWhatsApp,
  buildAliasIndex,
  voiceSupported,
  startVoice,
} from "./parser.js";

export async function screen(ctx) {
  const root0 = ctx.parts[0];
  if (root0 === "isler") return work(ctx);
  if (root0 === "fisler") return slips(ctx);
  if (root0 === "whatsapp") return whatsapp(ctx);
  return work(ctx);
}

// ============ İŞ KAYITLARI ============
async function work(ctx) {
  const sub = ctx.parts[1];
  if (sub === "new") return workForm(ctx, null);
  if (sub && ctx.parts[2] === "edit") return workForm(ctx, sub);
  if (sub) return workDetail(ctx, sub);
  return workList(ctx);
}

async function workList(ctx) {
  const { root, db, names, query } = ctx;
  const filter = query.f || "all";
  const q = query.q || "";
  let rows = (await db.getAll("work_records")).filter(isActive);
  const today = todayStr();
  if (filter === "today") rows = rows.filter((r) => r.date === today);
  if (filter === "week") {
    const from = new Date();
    from.setDate(from.getDate() - 7);
    const fs = from.toISOString().slice(0, 10);
    rows = rows.filter((r) => r.date >= fs);
  }
  if (filter === "noslip") rows = rows.filter((r) => !r.slip_id);
  if (filter === "fiyatsiz") {
    const { workAmount } = await import("./collect-core.js");
    const internal = new Set((await db.listActive("customers")).filter((c) => c.internal).map((c) => c.id));
    rows = rows.filter((r) => !internal.has(r.customer_id) && !workAmount(r) && !(Number(r.customer_fuel_allowance_l) > 0));
  }
  rows = rows.filter((r) =>
    matchSearch(
      `${names.customers[r.customer_id] || ""} ${names.sites[r.site_id] || ""} ${names.vehicles[r.vehicle_id] || ""} ${names.personnel[r.personnel_id] || ""} ${r.work_type} ${r.description || ""} ${r.material || ""}`,
      q,
    ),
  );
  rows.sort((a, b) =>
    b.date + (b.created_at || "") < a.date + (a.created_at || "") ? -1 : 1,
  );

  root.innerHTML =
    appbar("İş Kayıtları", `${rows.length} kayıt`, {
      right: '<button class="iconbtn" data-go="#/whatsapp">💬</button>',
    }) +
    `
    <div class="history-tools"><button class="btn" data-go="#/gecmis">Geçmiş İş Aktarımı</button></div><div style="height:10px"></div>
    ${segBar(
      [
        { v: "all", t: "Tümü" },
        { v: "today", t: "Bugün" },
        { v: "week", t: "7 Gün" },
        { v: "noslip", t: "Fişsiz" },
        { v: "fiyatsiz", t: "Fiyatsız" },
      ],
      filter,
      (v) => `#/isler?f=${v}${q ? "&q=" + encodeURIComponent(q) : ""}`,
    )}
    ${searchBar("Müşteri, araç, personel, iş…", q)}
    <div data-list></div>
    <div class="actionbar"><button class="btn primary" data-go="#/isler/new">+ Yeni İş Kaydı</button></div>`;

  const listEl = qs("[data-list]", root);
  if (!rows.length)
    listEl.innerHTML = emptyState(
      "⚒",
      "Kayıt yok",
      '<button class="btn primary" data-go="#/isler/new">+ İş Kaydı</button>',
    );
  else
    pagedRender(listEl, rows, (w) =>
      li({
        ic: "⚒",
        href: "#/isler/" + w.id,
        t1: `${esc(names.customers[w.customer_id] || "—")} · ${esc(w.work_type || "İş")}`,
        t2: `${trDate(w.date)} · ${esc(names.vehicles[w.vehicle_id] || "—")} — ${esc(names.personnel[w.personnel_id] || "—")}${w.site_id ? " · " + esc(names.sites[w.site_id]) : ""}`,
        badgeHtml: w.slip_id
          ? badge("Fişli", "ok")
          : w.slip_status === "Fiş Var"
            ? badge("Fiş Var", "info")
            : "",
        end: `<div class="amt nowrap">${fmtNum(w.quantity)} ${esc(w.unit || "")}</div>`,
      }),
    );

  let st;
  qs("[data-search]", root).addEventListener("input", (e) => {
    clearTimeout(st);
    st = setTimeout(
      () => go(`#/isler?f=${filter}&q=${encodeURIComponent(e.target.value)}`),
      450,
    );
  });
}

async function workForm(ctx, editId) {
  const { root, db, names, query } = ctx;
  const [customers, sites, vehicles, personnel, dumpSites, quarries] =
    await Promise.all([
      db.listActive("customers"),
      db.listActive("sites"),
      db.listActive("vehicles"),
      db.listActive("personnel"),
      db.listActive("dump_sites"),
      db.listActive("quarries"),
    ]);
  let rec = editId ? await db.get("work_records", editId) : null;

  // Ön-doldurma: WhatsApp taslağı / son kayıt kopyası
  let prefill = null;
  if (!editId && window.__prefill) {
    prefill = window.__prefill;
    window.__prefill = null;
  }
  if (!editId && !prefill && query.copylast === "1") {
    const all = (await db.getAll("work_records")).filter(isActive);
    if (all.length) {
      const last = all[all.length - 1];
      prefill = {
        customer_id: last.customer_id,
        site_id: last.site_id,
        vehicle_id: last.vehicle_id,
        personnel_id: last.personnel_id,
        work_type: last.work_type,
        unit: last.unit,
      };
    }
  }
  // Müşteri kartından "+ Bu müşteriye iş"
  if (!editId && !prefill && query.customer_id) prefill = { customer_id: query.customer_id };
  // Taslak autosave
  if (!editId && !prefill) {
    const draft = await db.draftGet("work");
    if (draft && Object.values(draft).some((v) => v)) prefill = draft;
  }
  const v = rec || prefill || {};

  // Kendi depo iç müşterisi listede müşteri gibi görünmez; ayrı ve açık bir seçenek olarak en altta durur
  const custOpts = [...customers.filter((c) => !c.internal).map((c) => ({ v: c.id, t: c.name })),
    ...customers.filter((c) => c.internal).map((c) => ({ v: c.id, t: "📦 Kendi depodan çıkış (iç iş — para istenmez)" }))];
  const siteOpts = sites.map((s) => ({ v: s.id, t: s.name }));
  const vehOpts = vehicles.map((x) => ({ v: x.id, t: x.name }));
  const perOpts = personnel.map((x) => ({ v: x.id, t: x.name }));

  root.innerHTML =
    appbar(
      editId ? "İş Düzenle" : "+ İş Kaydı",
      "Döküm satırlarını tek seferde kaydedin",
    ) +
    `
    ${editId ? "" : notice("info", "Nakliyede döküm yerlerini + Satır ekle ile girin. Aynı fiyatlı seferler müşteriye tek satır görünür; döküm ayrıntıları içeride korunur.")}
    ${!editId && prefill && !rec ? '<div class="notice info"><span>ℹ</span><span>Taslak/son kayıt bilgileri yüklendi.</span></div>' : ""}
    <form data-form novalidate>
      ${fDate("Tarih", "date", v.date)}
      <div class="formgrid2">
        ${fSelect("Müşteri", "customer_id", [...custOpts, { v: "__new__", t: "➕ Yeni müşteri…" }], v.customer_id)}
        ${fSelect("Şantiye", "site_id", [...siteOpts, { v: "__new__", t: "➕ Yeni şantiye…" }], v.site_id)}
      </div>
      <div class="formgrid2">
        ${fSelect("Araç / Makine", "vehicle_id", [...vehOpts, { v: "__new__", t: "➕ Yeni…" }], v.vehicle_id)}
        ${fSelect("Şoför / Operatör", "personnel_id", [...perOpts, { v: "__new__", t: "➕ Yeni…" }], v.personnel_id)}
      </div>
      ${fSelect("İş Türü", "work_type", WORK_TYPES, v.work_type || "")}
      <div class="formgrid2">
        ${fNum("Miktar", "quantity", v.quantity ?? "", { req: true, step: "any" })}
        ${fSelect("Birim", "unit", WORK_UNITS, v.unit || "Sefer", { empty: false })}
      </div>
      <section data-work-time hidden><h3>Saat Puantajı (opsiyonel)</h3><div class="formgrid2">${fText("Başlangıç", "time_start", v.time_start || "", { type: "time" })}${fText("Bitiş", "time_end", v.time_end || "", { type: "time" })}</div>${fNum("Mola (dk)", "break_minutes", v.break_minutes ?? 0)}<button type="button" class="btn" data-time-calculate>Saat Miktarını Hesapla</button></section>
      ${fText("Malzeme", "material", v.material || "", { ph: "mıcır, kum…" })}
      <div class="formgrid2">
        ${fSelect("Döküm Sahası", "dump_site_id", [...dumpSites.map((r) => ({ v: r.id, t: r.name })), { v: "__new__", t: "+ Yeni Döküm Sahası" }], v.dump_site_id || "")}
        ${fSelect("Malzeme Ocağı", "quarry_id", [...quarries.map((r) => ({ v: r.id, t: r.name })), { v: "__new__", t: "+ Yeni Malzeme Ocağı" }], v.quarry_id || "")}
        ${fText("Diğer Döküm (opsiyonel)", "dump_area", v.dump_area || "")}
        ${fText("Diğer Ocak (opsiyonel)", "quarry", v.quarry || "")}
      </div>
      <div class="formgrid2">
        ${fSelect("Fiş Durumu", "slip_status", ["Fiş Var", "Fiş Yok"], v.slip_status || "")}
        ${fText("Fiş No", "slip_no", v.slip_no || "")}
      </div>
      <div class="formgrid2">${fNum("Tonaj (fişteki net ton, opsiyonel)", "tonnage", v.tonnage ?? "", { step: "any" })}${fNum("Döküm maliyeti (₺, elle — opsiyonel)", "dump_cost", v.dump_cost ?? "", { step: "any" })}</div>
      <div class="muted tiny" style="margin:-4px 2px 8px">Döküm maliyeti: depodan çıkışta siz yazarsınız (boş = maliyet yok). Müşteri işinde boşsa döküm sahası ücretinden hesaplanır.</div>
      <section class="card" style="margin:8px 0" data-slip-ai>
        <div class="field"><label>Fiş / belge fotoğrafları (işe eklenir)</label><input type="file" accept="image/*,application/pdf" multiple data-wfiles></div>
        <div class="row" style="gap:6px;flex-wrap:wrap" data-wthumbs></div>
        <button type="button" class="btn block" style="margin-top:6px" data-wai>🤖 Gemini ile fişi oku (ton, fiş no, tarih, plaka)</button>
        <div data-wai-out></div>
      </section>
      <div class="formgrid2">${fNum("Manuel birim fiyat (opsiyonel)", "manual_price", v.price_snapshot?.price_source === "Manuel" ? v.price_snapshot.unit_price : "", { step: "any" })}${fNum("KDV %", "manual_kdv", v.price_snapshot?.kdv_rate ?? 20, { step: "any" })}</div>
      ${fNum("Mesafe (km, opsiyonel)", "distance_km", v.distance_km ?? "", { step: "any" })}
      ${editId ? "" : '<section data-transport-batch hidden><div data-transport-rows></div><button type="button" class="btn" data-add-transport>+ Satır ekle</button><div class="notice" data-transport-total aria-live="polite"></div><p class="tiny">Ek satırda boş bırakılan araç, personel ve fiyat üstteki seçimden alınır. Her satır ayrı iş kaydı olarak saklanır.</p></section>'}
      ${fArea("İş Açıklaması", "description", v.description || "")}
      ${fArea("Müşteri Notu (PDF'te görünür)", "customer_note", v.customer_note || "")}
      ${fArea("İç Not (müşteriye GÖSTERİLMEZ)", "internal_note", v.internal_note || "")}
    </form>
    <div class="actionbar">
      ${editId ? "" : '<button class="btn" data-copylast>Son Kaydı Kopyala</button>'}
      <button class="btn primary" data-save>Kaydet</button>
    </div>`;

  const form = qs("[data-form]", root);
  let draftTimer,
    saving = false;
  // ---- Fiş fotoğrafı: işe eklenir; Gemini tonu ve fiş bilgisini okuyup boş alanları doldurur ----
  let wfiles = [];
  const wIn = qs("[data-wfiles]", form), wOut = qs("[data-wai-out]", form);
  wIn.addEventListener("change", () => {
    wfiles = [...wIn.files].slice(0, 10);
    qs("[data-wthumbs]", form).innerHTML = wfiles.map((f) => (f.type.startsWith("image/") ? `<img src="${URL.createObjectURL(f)}" alt="" style="width:56px;height:56px;object-fit:cover;border-radius:8px;border:1px solid var(--border)">` : `<span class="chip">📄 ${esc(f.name)}</span>`)).join("");
  });
  qs("[data-wai]", form).addEventListener("click", async (ev) => {
    const b = ev.currentTarget;
    const imgs = wfiles.filter((f) => f.type.startsWith("image/"));
    if (!imgs.length) return toast("Önce fiş fotoğrafı seçin", "err");
    const { geminiSettings, withModelFallback, geminiJson, blobToBase64, shrink } = await import("./ai-gemini.js");
    if (!(await geminiSettings(db)).ready) return toast("Ayarlar → Yapay Zeka'da Gemini anahtarını kaydedin", "err");
    if (!navigator.onLine) return toast("İnternet yok", "err");
    b.disabled = true;
    wOut.innerHTML = '<div class="muted small" style="padding:6px">Gemini fişi okuyor…</div>';
    try {
      const { SLIP_PROMPT, slipSchema, validateSlips, slipFill } = await import("./slip-read.js");
      const parts = [];
      for (const f of imgs) { const img = await shrink(f); parts.push({ inlineData: { mimeType: img.type || "image/jpeg", data: await blobToBase64(img) } }); }
      parts.push({ text: `Fotoğraf sayısı: ${imgs.length} (sıra 0'dan başlar)` });
      const obj = await withModelFallback(db, (o) => geminiJson(parts, { ...o, system: SLIP_PROMPT, schema: slipSchema() }));
      const d = await db.dumpAll();
      const res = validateSlips(obj, { d, count: imgs.length });
      const cur = collectForm(form);
      const fill = slipFill(res, cur, { d });
      for (const [k, val] of Object.entries(fill)) { const el = qs(`[name=${k}]`, form); if (el) el.value = val; }
      if (fill.work_type) qs("[name=work_type]", form).dispatchEvent(new Event("change"));
      form.dispatchEvent(new Event("change"));
      form.dispatchEvent(new Event("input"));
      const vName = (id) => vehicles.find((x) => x.id === id)?.name || "";
      wOut.innerHTML = `<div class="small" style="margin-top:6px">${res.rows.map((r) => `• Fiş ${r.photo + 1}: <b>${r.net_ton != null ? fmtNum(r.net_ton) + " ton" : "ton yok"}</b>${r.slip_no ? " · No " + esc(r.slip_no) : ""}${r.date ? " · " + trDate(r.date) : ""}${r.plate ? " · " + esc(r.plate) + (r.vehicle_id ? " (" + esc(vName(r.vehicle_id)) + ")" : "") : ""}${r.issues.length ? ` <span class="muted">⚠ ${esc(r.issues.join(", "))}</span>` : ""}`).join("<br>")}</div>
        ${res.read ? `<div class="small" style="margin-top:4px">Toplam <b>${fmtNum(res.total_ton)} ton</b> (${res.read}/${imgs.length} fiş) — Tonaj alanına yazıldı${fill.quantity != null ? ", miktar dolduruldu" : ""}.</div>` : ""}
        ${res.read && cur.unit !== "Ton" ? `<button type="button" class="btn block" style="margin-top:6px" data-wton>Ton hesabı: birimi Ton, miktarı ${fmtNum(res.total_ton)} yap</button>` : ""}
        ${fill.material_hint ? `<div class="small" style="margin-top:4px">⚠ ${esc(fill.material_hint)}</div>` : ""}
        <div class="muted tiny" style="margin-top:4px">Fişte yazmayan değer doldurulmadı. Kaydetmeden önce kontrol edin.</div>`;
      qs("[data-wton]", wOut)?.addEventListener("click", () => {
        qs("[name=unit]", form).value = "Ton";
        qs("[name=quantity]", form).value = res.total_ton;
        form.dispatchEvent(new Event("change"));
        form.dispatchEvent(new Event("input"));
        toast("Birim Ton yapıldı", "ok");
      });
    } catch (e) {
      wOut.innerHTML = notice("warn", e.message || String(e));
    }
    b.disabled = false;
  });
  const attachFiles = async (id) => {
    for (const f of wfiles) await db.addAttachment("work", id, f, { kind: "slip_photo" });
  };
  const timeSection = qs("[data-work-time]", form);
  const syncTime = () => {
    const active = qs("[name=unit]", form).value === "Saat";
    timeSection.hidden = !active;
    for (const input of qsa("input,button", timeSection))
      input.disabled = !active;
  };
  form.addEventListener("change", syncTime);
  syncTime();
  qs("[data-time-calculate]", form).onclick = () => {
    try {
      qs("[name=quantity]", form).value = workHours(
        qs("[name=time_start]", form).value,
        qs("[name=time_end]", form).value,
        qs("[name=break_minutes]", form).value,
      );
      form.dispatchEvent(new Event("input"));
    } catch (e) {
      toast(e.message, "err");
    }
  };
  const batchSection = qs("[data-transport-batch]", form);
  const batchActive = () =>
    !!batchSection &&
    ["Hafriyat Nakliye", "Moloz Nakliye", "Çöp Nakliye", "Mıcır Nakliye", "Kum Nakliye", "Gravak Nakliye"].includes(
      qs("[name=work_type]", form).value,
    ) &&
    qs("[name=unit]", form).value === "Sefer";
  const extraRows = () =>
    qsa("[data-transport-row]", form).map((el) => collectForm(el));
  const updateBatch = () => {
    if (!batchSection) return;
    const active = batchActive();
    batchSection.hidden = !active;
    for (const input of qsa("input,select,textarea", batchSection))
      input.disabled = !active;
    const extras = active ? extraRows() : [];
    const total =
      Number(qs("[name=quantity]", form).value || 0) +
      extras.reduce((sum, r) => sum + Number(r.x_quantity || 0), 0);
    qs("[data-transport-total]", form).textContent =
      `${extras.length + 1} satır · Toplam ${fmtNum(total)} sefer`;
    qs("[data-save]", root).textContent = extras.length
      ? "Tümünü kaydet"
      : "Kaydet";
  };
  const addTransportRow = (row = {}) => {
    const el = document.createElement("div");
    el.className = "card";
    el.dataset.transportRow = "";
    el.innerHTML = `<div class="row between"><strong>Döküm satırı</strong><button type="button" class="btn sm danger" data-remove-transport>Satırı kaldır</button></div>${fSelect(
      "Döküm Sahası",
      "x_dump_site_id",
      dumpSites.map((r) => ({ v: r.id, t: r.name })),
      row.x_dump_site_id || "",
    )}${fText("Diğer Döküm (opsiyonel)", "x_dump_area", row.x_dump_area || "")}${fNum("Sefer", "x_quantity", row.x_quantity ?? 1, { req: true, step: 1 })}<details><summary>Araç / personel / fiyat değiştir</summary>${fSelect(
      "Araç (boşsa üstteki)",
      "x_vehicle_id",
      vehicles.map((r) => ({ v: r.id, t: r.name })),
      row.x_vehicle_id || "",
    )}${fSelect(
      "Personel (boşsa üstteki)",
      "x_personnel_id",
      personnel.map((r) => ({ v: r.id, t: r.name })),
      row.x_personnel_id || "",
    )}${fNum("Birim fiyat (boşsa üstteki / fiyat listesi)", "x_manual_price", row.x_manual_price ?? "", { step: "any" })}${fNum("KDV % (boşsa üstteki)", "x_manual_kdv", row.x_manual_kdv ?? "", { step: "any" })}${fNum("Mesafe km (boşsa üstteki)", "x_distance_km", row.x_distance_km ?? "", { step: "any" })}</details>`;
    qs("[data-transport-rows]", form).append(el);
    qs("[data-remove-transport]", el).onclick = () => {
      el.remove();
      updateBatch();
      form.dispatchEvent(new Event("input"));
    };
    updateBatch();
  };
  if (batchSection) {
    qs("[data-add-transport]", form).onclick = () => {
      addTransportRow();
      form.dispatchEvent(new Event("input"));
    };
    for (const row of v._transport_rows || []) addTransportRow(row);
    form.addEventListener("input", updateBatch);
    form.addEventListener("change", updateBatch);
  }
  const dynamicWork = () => {
    const type = qs("[name=work_type]", form).value;
    const dump = ["Hafriyat Nakliye", "Moloz Nakliye", "Çöp Nakliye"].includes(
        type,
      ),
      quarry = ["Mıcır Nakliye", "Kum Nakliye", "Gravak Nakliye"].includes(
        type,
      );
    // Malzeme nakliyesinde döküm alanları "teslim yeri" olur (ör. Maslak gravak → Binkılıç dolgu)
    const setLabel = (key, txt) => { const l = qs("[name=" + key + "]", form)?.closest(".field")?.querySelector("label"); if (l) l.textContent = txt; };
    setLabel("dump_site_id", quarry ? "Teslim / Dolgu Yeri" : "Döküm Sahası");
    setLabel("dump_area", quarry ? "Diğer Teslim Yeri (şantiye / adres)" : "Diğer Döküm (opsiyonel)");
    for (const [key, visible] of [
      ["dump_area", dump || quarry],
      ["dump_site_id", dump || quarry],
      ["quarry", quarry],
      ["quarry_id", quarry],
      ["material", dump || quarry],
    ]) {
      const input = qs("[name=" + key + "]", form);
      input.closest(".field").hidden = !visible;
      input.disabled = !visible;
      if (!visible) input.value = "";
    }
    const unit = qs("[name=unit]", form),
      allowed =
        type === "Vinç Çalışması"
          ? ["Saat"]
          : type.includes("Nakliye")
            ? ["Sefer", "Ton", "m³"]
            : ["Saat", "Yevmiye"];
    for (const option of unit.options)
      option.hidden = !allowed.includes(option.value);
    if (!allowed.includes(unit.value)) unit.value = allowed[0];
    updateBatch();
  };
  qs("[name=work_type]", form).addEventListener("change", dynamicWork);
  dynamicWork();
  // Yeni ekleme akışları
  const bindNew = (name, store, label, extra = {}) => {
    const sel = qs(`select[name=${name}]`, form);
    sel.addEventListener("change", async () => {
      if (sel.value !== "__new__") return;
      sel.value = rec ? rec[name] || "" : "";
      const name2 = await promptDialog("Yeni " + label, "Ad");
      if (!name2) return;
      if (store === "sites") {
        const cid = qs("select[name=customer_id]", form).value || null;
        const created = await db.saveNew("sites", {
          name: name2,
          customer_id: cid,
          active: true,
        });
        sel.insertAdjacentHTML(
          "beforeend",
          `<option value="${created.id}">${esc(name2)}</option>`,
        );
        sel.value = created.id;
      } else {
        const fields =
          store === "vehicles"
            ? {
                name: name2,
                type: "Araç/Makine",
                ownership: "Özmal",
                active: true,
              }
            : store === "personnel"
              ? { name: name2, active: true }
              : { name: name2, active: true };
        const created = await db.saveNew(store, fields);
        const localList = {
          vehicles,
          personnel,
          customers,
          dump_sites: dumpSites,
          quarries,
        }[store];
        if (localList) localList.push(created);
        sel.insertAdjacentHTML(
          "beforeend",
          `<option value="${created.id}">${esc(name2)}</option>`,
        );
        sel.value = created.id;
      }
      toast("Eklendi: " + name2, "ok");
    });
  };
  bindNew("customer_id", "customers", "Müşteri");
  bindNew("site_id", "sites", "Şantiye");
  bindNew("vehicle_id", "vehicles", "Araç/Makine");
  bindNew("personnel_id", "personnel", "Personel");
  bindNew("dump_site_id", "dump_sites", "Döküm Sahası");
  bindNew("quarry_id", "quarries", "Malzeme Ocağı");

  // Müşteri seçilince şantiyeleri filtrele
  qs("select[name=customer_id]", form).addEventListener("change", (e) => {
    const cid = e.target.value;
    const sel = qs("select[name=site_id]", form);
    const opts = sites.filter(
      (s) => !cid || s.customer_id === cid || !s.customer_id,
    );
    sel.innerHTML =
      '<option value="">— seç —</option>' +
      opts
        .map((s) => `<option value="${s.id}">${esc(s.name)}</option>`)
        .join("") +
      '<option value="__new__">➕ Yeni şantiye…</option>';
  });

  // Autosave (yeni kayıtta)
  if (!editId) {
    form.addEventListener("input", () => {
      clearTimeout(draftTimer);
      draftTimer = setTimeout(() => {
        if (!saving && form.isConnected)
          db.draftSave("work", {
            ...collectForm(form),
            _transport_rows: extraRows(),
          });
      }, 600);
    });
  }
  const copyBtn = qs("[data-copylast]", root);
  if (copyBtn)
    copyBtn.addEventListener("click", () => go("#/isler/new?copylast=1"));

  qs("[data-save]", root).addEventListener("click", async () => {
    if (saving) return;
    saving = true;
    qs("[data-save]", root).disabled = true;
    clearTimeout(draftTimer);
    try {
      const val = collectForm(form);
      if (!val.quantity || Number(val.quantity) <= 0) {
        toast("Miktar girin (0'dan büyük)", "err");
        return;
      }
      if (!val.customer_id || !val.vehicle_id || !val.work_type) {
        toast("Müşteri, araç ve iş türü seçin", "err");
        return;
      }
      if (!val.vehicle_id && !val.personnel_id) {
        toast("Araç veya personel seçin", "err");
        return;
      }
      const fields = {
        date: val.date || todayStr(),
        time: val.time || null,
        time_start: val.unit === "Saat" ? val.time_start || null : null,
        time_end: val.unit === "Saat" ? val.time_end || null : null,
        break_minutes:
          val.unit === "Saat" && val.time_start
            ? Number(val.break_minutes || 0)
            : null,
        customer_id: val.customer_id || null,
        site_id: val.site_id || null,
        vehicle_id: val.vehicle_id || null,
        personnel_id: val.personnel_id || null,
        vehicle_type:
          vehicles.find((v) => v.id === val.vehicle_id)?.type || null,
        contractor_id:
          vehicles.find((v) => v.id === val.vehicle_id)?.contractor_id || null,
        work_type: val.work_type || "Diğer",
        description: val.description || "",
        material: val.material || "",
        quantity: Number(val.quantity),
        unit: val.unit || "Sefer",
        dump_site_id: val.dump_site_id || null,
        quarry_id: val.quarry_id || null,
        dump_area:
          dumpSites.find((d) => d.id === val.dump_site_id)?.name ||
          val.dump_area ||
          "",
        quarry:
          quarries.find((q) => q.id === val.quarry_id)?.name ||
          val.quarry ||
          "",
        slip_status: val.slip_status || null,
        slip_no: val.slip_no || "",
        customer_note: val.customer_note || "",
        internal_note: val.internal_note || "",
        distance_km: val.distance_km ? Number(val.distance_km) : null,
        tonnage: Number(val.tonnage) > 0 ? Number(val.tonnage) : null,
        dump_cost: Number(val.dump_cost) > 0 ? Number(val.dump_cost) : null,
      };
      if (!editId) {
        const { priceSnapshot } = await import("./business.js");
        fields.price_snapshot = priceSnapshot(
          {
            ...fields,
            vehicle_type: vehicles.find((v) => v.id === fields.vehicle_id)
              ?.type,
          },
          await db.listActive("price_book"),
          {
            first: await db.metaGet("crane_first_hour"),
            next: await db.metaGet("crane_next_hour"),
          },
        );
      }
      if (val.manual_price !== "" && val.manual_price != null) {
        if (
          !Number.isFinite(Number(val.manual_price)) ||
          Number(val.manual_price) < 0
        ) {
          toast("Manuel fiyat geçersiz", "err");
          return;
        }
        fields.price_snapshot = {
          unit_price: Number(val.manual_price),
          kdv_rate: Number(val.manual_kdv) || 0,
          kdv_included: false,
          amount: Number(val.manual_price) * fields.quantity,
          price_source: "Manuel",
          snapshot_at: new Date().toISOString(),
        };
      }
      // Mazot karşılığı (müşteri kartındaki sefer başı mazot kuralı)
      const { applyFuelPay } = await import("./assistant-rules.js");
      const dAll = await db.dumpAll();
      const fuelText = (r) => [r.description, r.material, r.quarry, r.dump_area, r.internal_note].filter(Boolean).join(" ");
      Object.assign(fields, applyFuelPay(dAll, fields, fuelText(fields)));
      const { applyYard } = await import("./yard-core.js");
      Object.assign(fields, applyYard(dAll, fields));
      if (!fields.customer_fuel_allowance_l) fields.customer_fuel_allowance_l = null;
      const extras = batchActive() ? extraRows() : [];
      if (!editId && extras.length) {
        const { priceSnapshot } = await import("./business.js");
        const prices = await db.listActive("price_book");
        const crane = {
          first: await db.metaGet("crane_first_hour"),
          next: await db.metaGet("crane_next_hour"),
        };
        const rows = [fields];
        for (const row of extras) {
          const vehicleId = row.x_vehicle_id || fields.vehicle_id;
          const distance =
            row.x_distance_km !== ""
              ? Number(row.x_distance_km)
              : fields.distance_km;
          const r = {
            ...fields,
            vehicle_id: vehicleId,
            vehicle_type:
              vehicles.find((v) => v.id === vehicleId)?.type || null,
            contractor_id:
              vehicles.find((v) => v.id === vehicleId)?.contractor_id || null,
            personnel_id: row.x_personnel_id || fields.personnel_id,
            quantity: Number(row.x_quantity),
            dump_site_id: row.x_dump_site_id || null,
            dump_area:
              dumpSites.find((d) => d.id === row.x_dump_site_id)?.name ||
              row.x_dump_area ||
              "",
            distance_km: distance,
          };
          const manual =
            row.x_manual_price !== "" ? row.x_manual_price : val.manual_price;
          const rate =
            row.x_manual_kdv !== ""
              ? Number(row.x_manual_kdv)
              : Number(val.manual_kdv);
          r.price_snapshot = priceSnapshot(r, prices, crane);
          if (manual !== "" && manual != null) {
            if (
              !Number.isFinite(Number(manual)) ||
              Number(manual) < 0 ||
              !Number.isFinite(rate) ||
              rate < 0 ||
              rate > 100
            )
              throw Error("Satır fiyatı veya KDV geçersiz");
            r.price_snapshot = {
              unit_price: Number(manual),
              kdv_rate: rate,
              kdv_included: false,
              amount: Number(manual) * r.quantity,
              price_source: "Manuel",
              snapshot_at: new Date().toISOString(),
            };
          }
          rows.push(applyYard(dAll, applyFuelPay(dAll, r, fuelText(r))));
        }
        const sameDay = await db.listActive("work_records");
        if (
          rows.some((r) =>
            sameDay.some(
              (w) =>
                w.date === r.date &&
                w.vehicle_id === r.vehicle_id &&
                w.customer_id === r.customer_id &&
                w.site_id === r.site_id &&
                w.work_type === r.work_type &&
                w.dump_area === r.dump_area &&
                Number(w.quantity) === r.quantity,
            ),
          )
        ) {
          if (
            !(await confirmDialog(
              "Olası mükerrer kayıt",
              "Aynı döküm, gün, araç ve miktarla kayıt var. Tüm satırlar yine de kaydedilsin mi?",
              "Kaydet",
              false,
            ))
          )
            return;
        }
        const created = await db.saveWorkBatch(rows);
        await attachFiles(created[0].id);
        await db.draftClear("work");
        toast(
          `${created.length} satır · ${fmtNum(created.reduce((s, r) => s + r.quantity, 0))} sefer kaydedildi`,
          "ok",
        );
        go("#/isler/" + created[0].id);
        return;
      }
      // Duplicate adayı uyarısı (otomatik engelleme YOK)
      if (!editId) {
        const sameDay = (await db.getAll("work_records")).filter(
          (r) =>
            isActive(r) &&
            r.date === fields.date &&
            r.vehicle_id === fields.vehicle_id &&
            r.customer_id === fields.customer_id &&
            r.work_type === fields.work_type &&
            Number(r.quantity) === fields.quantity,
        );
        if (sameDay.length) {
          const ok = await confirmDialog(
            "Olası mükerrer kayıt",
            "Aynı gün/araç/müşteri/iş/miktar ile kayıt var. Yine de kaydedilsin mi?",
            "Kaydet",
            false,
          );
          if (!ok) return;
        }
      }
      if (editId) {
        await db.saveExisting("work_records", rec, fields);
        await attachFiles(editId);
        toast("İş güncellendi", "ok");
        go("#/isler/" + editId);
      } else {
        const created = await db.saveNew("work_records", fields);
        await attachFiles(created.id);
        await db.draftClear("work");
        toast("İş kaydedildi", "ok");
        go("#/isler/" + created.id);
      }
    } catch (e) {
      toast(e.message || "Kayıt kaydedilemedi", "err");
    } finally {
      saving = false;
      const button = qs("[data-save]", root);
      if (button) button.disabled = false;
    }
  });
}

async function workDetail(ctx, id) {
  const { root, db, names } = ctx;
  const w = await db.get("work_records", id);
  if (!w) {
    root.innerHTML = appbar("İş") + emptyState("⚒", "Kayıt bulunamadı");
    return;
  }
  const siblings = w.work_batch_id
    ? (await db.listActive("work_records"))
        .filter((r) => r.work_batch_id === w.work_batch_id)
        .sort((a, b) => a.batch_row - b.batch_row)
    : [];
  const slip = w.slip_id ? await db.get("slips", w.slip_id) : null;
  const atts = await db.attachmentsFor("work", id);
  const inHakedis = (await db.getAll("hakedis")).some(
    (h) =>
      isActive(h) &&
      h.status !== "İptal" &&
      (h.items || []).some((it) => it.work_record_id === id),
  );
  root.innerHTML =
    appbar("İş Detayı", trDate(w.date)) +
    `
    <div class="card">
      <div class="row between"><span class="strong" style="font-size:16px">${esc(w.work_type || "İş")}</span><span class="amt">${fmtNum(w.quantity)} ${esc(w.unit || "")}</span></div>
      <div class="divider"></div>
      ${kv("Tarih", trDate(w.date) + (w.time ? " " + w.time : ""))}
      ${kv("Müşteri", names.customers[w.customer_id] || "—")}
      ${kv("Şantiye", names.sites[w.site_id] || "—")}
      ${kv("Araç/Makine", names.vehicles[w.vehicle_id] || "—")}
      ${kv("Personel", names.personnel[w.personnel_id] || "—")}
      ${w.material ? kv("Malzeme", w.material) : ""}
      ${w.dump_area ? kv("Döküm", w.dump_area) : ""}
      ${w.quarry ? kv("Ocak", w.quarry) : ""}
      ${w.slip_status ? kv("Fiş", w.slip_status + (w.slip_no ? " #" + w.slip_no : "")) : ""}
      ${w.tonnage ? kv("Tonaj", fmtNum(w.tonnage) + " ton") : ""}
      ${w.dump_cost ? kv("Döküm maliyeti", fmtNum(w.dump_cost) + " ₺ (elle)") : ""}
      ${w.customer_fuel_allowance_l ? kv("Mazot karşılığı", fmtNum(w.customer_fuel_allowance_l) + " L" + (w.price_snapshot?.price_source === "Mazot karşılığı" ? " (ücret yalnız mazot)" : "")) : ""}
      ${w.description ? kv("Açıklama", w.description) : ""}
      ${w.customer_note ? kv("Müşteri Notu", w.customer_note) : ""}
      ${w.internal_note ? kv("İç Not", w.internal_note) : ""}
      ${w.invoice_no ? kv("Fatura", w.invoice_no + (w.invoice_date ? " · " + trDate(w.invoice_date) : "")) : ""}
      ${slip ? kv("Dijital Fiş", "#" + String(slip.slip_no).padStart(6, "0") + " (" + slip.status + ")") : ""}
      ${inHakedis ? kv("Hakediş", "Bu iş hakedişe dahil") : ""}
    </div>
    ${w.digital_slip_no ? `<div class="card" style="border-left:4px solid #2e9e6b"><div class="row between"><b>🧾 Dijital iş fişi ${esc(w.digital_slip_no)}</b><span class="badge ${atts.some((a) => a.kind === "signature") ? "ok" : "warn"}">${atts.some((a) => a.kind === "signature") ? "imzalı" : "imza yok"}</span></div>
      <div class="small muted">${esc(w.slip_receiver ? "Teslim alan: " + w.slip_receiver : "")}${w.slip_signed_at ? " · " + esc(new Date(w.slip_signed_at).toLocaleString("tr-TR", { timeZone: "Europe/Istanbul" })) : ""} · şoför sahada imzalattı</div>
      <button class="btn block" style="margin-top:8px" data-dslip>📄 İmzalı fiş PDF (indir / gönder)</button></div>` : ""}
    <div class="card"><div class="row between"><strong>Fiş / belge fotoğrafları (${atts.length})</strong><label class="btn sm">+ Ekle<input type="file" accept="image/*,application/pdf" multiple data-watt hidden></label></div>
      <div class="row" style="gap:6px;flex-wrap:wrap;margin-top:6px">${atts.map((a) => (String(a.type).startsWith("image/") ? `<a href="${URL.createObjectURL(a.blob)}" target="_blank" rel="noopener"><img src="${URL.createObjectURL(a.blob)}" alt="" style="width:72px;height:72px;object-fit:cover;border-radius:8px;border:1px solid var(--border)"></a>` : `<a class="chip" href="${URL.createObjectURL(a.blob)}" target="_blank" rel="noopener">📄 ${esc(a.name)}</a>`)).join("") || '<span class="muted small">Fotoğraf yok</span>'}</div></div>
    ${siblings.length ? `<div class="card"><strong>Nakliye grubu · ${fmtNum(siblings.reduce((sum, r) => sum + Number(r.quantity), 0))} sefer</strong><p class="tiny">Müşteride aynı fiyatlı seferler birleşir. İç döküm ayrıntıları:</p>${siblings.map((r) => `<div class="row between"><a data-go="#/isler/${r.id}">${esc(r.dump_area || "Döküm")}</a><span>${fmtNum(r.quantity)} sefer · ${esc(names.vehicles[r.vehicle_id] || "")}</span></div>`).join("")}</div>` : ""}
    <div class="actionbar">
      ${slip ? `<button class="btn" data-go="#/fisler/${slip.id}">🧾 Fiş</button>` : `<button class="btn" data-mkslip>🧾 ${siblings.length ? "Toplam Sefer Fişi" : "Fiş Oluştur"}</button>`}
      ${inHakedis ? "" : `<button class="btn" data-go="#/isler/${id}/edit">Düzenle</button>`}
      <button class="btn danger" data-del>Sil</button>
    </div>`;
  qs("[data-dslip]", root)?.addEventListener("click", async (ev) => {
    const b = ev.currentTarget; b.disabled = true;
    try {
      const { workSlipSpec } = await import("./driver-core.js");
      const { exportDocument } = await import("./document-engine.js");
      const { COMPANY_NAME } = await import("./core.js");
      const sig = atts.find((a) => a.kind === "signature")?.blob || null;
      const photo = atts.find((a) => a.kind === "slip_photo" && String(a.type).startsWith("image/"))?.blob || null;
      await exportDocument(workSlipSpec(w, names, { company: COMPANY_NAME, sigBlob: sig, photo }), "share");
    } catch (e) { toast("PDF oluşturulamadı: " + (e.message || e), "err"); }
    b.disabled = false;
  });
  qs("[data-watt]", root)?.addEventListener("change", async (e) => {
    for (const f of [...e.target.files].slice(0, 10)) await db.addAttachment("work", id, f, { kind: "slip_photo" });
    toast("Eklendi", "ok");
    ctx.reload();
  });
  const mk = qs("[data-mkslip]", root);
  if (mk)
    mk.addEventListener("click", () =>
      go("#/fisler/new?work=" + id + (siblings.length ? "&batch=1" : "")),
    );
  qs("[data-del]", root).addEventListener("click", async () => {
    const reason = await promptDialog(
      "Kayıt siliniyor",
      "Silme nedeni (çöp kutusuna taşınır)",
    );
    if (reason === null) return;
    await db.softDelete("work_records", id, reason);
    toast("Çöp kutusuna taşındı", "ok");
    go("#/isler");
  });
}

// ============ DİJİTAL FİŞLER ============
async function slips(ctx) {
  const sub = ctx.parts[1];
  if (sub === "new") return slipForm(ctx, null);
  if (sub && ctx.parts[2] === "imza") return slipSign(ctx, sub);
  if (sub && ctx.parts[2] === "edit") return slipForm(ctx, sub);
  if (sub) return slipDetail(ctx, sub);
  return slipList(ctx);
}

const slipIcon = '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M7 3h8l4 4v14H5V3h2Z M14 3v5h5 M8 12h8 M8 16h6"/></svg>';
const slipSerial = (n) => `FS-${String(n || 0).padStart(6, "0")}`;
async function slipList(ctx) {
  const { root, db, names, query } = ctx;
  const f = query.f || "all";
  // Şoförün sahada imzalattığı dijital fişler iş kaydında durur; listede onlar da görünür (dokununca iş detayı ve PDF)
  const sigIds = new Set((await db.getAll("attachments")).filter((a) => a.kind === "signature" && a.record_type === "work").map((a) => a.record_id));
  const drv = (await db.listActive("work_records")).filter((w) => w.digital_slip_no).map((w) => ({ drv: true, id: w.id, w, date: w.date, status: sigIds.has(w.id) || w.slip_signed_at ? "İmzalandı" : "Taslak" }));
  const own = (await db.getAll("slips")).filter(isActive);
  const all = [...own, ...drv].sort((a,b)=>String(b.date||"").localeCompare(String(a.date||"")) || (b.slip_no||0)-(a.slip_no||0));
  const rows = f === "all" ? all : f === "sofor" ? drv : all.filter(r=>r.status===f);
  root.innerHTML = appbar("Dijital İş Fişleri", "Hizmet, teslim ve imza takibi") + `
    <div class="slip-overview"><div><span>Toplam fiş</span><strong>${all.length}</strong></div><div><span>İmza bekleyen</span><strong>${all.filter(r=>r.status==='Taslak').length}</strong></div><div><span>İmzalı</span><strong>${all.filter(r=>r.status==='İmzalandı').length}</strong></div></div>
    ${segBar([{v:"all",t:"Tümü"},{v:"Taslak",t:"Taslak"},{v:"İmzalandı",t:"İmzalı"},{v:"Revize",t:"Revize"},{v:"İptal",t:"İptal"},...(drv.length?[{v:"sofor",t:"Şoför"}]:[])],f,v=>`#/fisler?f=${v}`)}
    <div class="slip-list" data-list></div>
    <div class="actionbar"><button class="btn primary" data-go="#/fisler/new">Yeni Fiş Oluştur</button></div>`;
  const el = qs("[data-list]",root);
  if (!rows.length) el.innerHTML = '<div class="slip-empty">'+slipIcon+'<h2>Bu görünümde fiş bulunmuyor</h2><p>İş kaydından veya Yeni Fiş Oluştur ile başlayabilirsiniz.</p></div>';
  else pagedRender(el,rows,s=>s.drv?`<a class="slip-list-card" href="#/isler/${esc(s.id)}"><div class="slip-card-top"><span class="slip-number">${slipIcon}${esc(s.w.digital_slip_no)}</span>${statusBadge(s.status)}</div><h2>${esc(names.customers[s.w.customer_id]||"—")}</h2><p>${esc(names.sites[s.w.site_id]||"Şantiye belirtilmedi")} · 🚚 şoför${names.personnel?.[s.w.personnel_id]?" "+esc(names.personnel[s.w.personnel_id]):""}${s.w.slip_receiver?" · imzalayan: "+esc(s.w.slip_receiver):""}</p><div class="slip-card-bottom"><span>${trDate(s.w.date)}<small>${esc(s.w.work_type||"İş")}</small></span><strong>${fmtNum(s.w.quantity)} <small>${esc(s.w.unit||"")}</small></strong></div></a>`:`<a class="slip-list-card" href="#/fisler/${esc(s.id)}"><div class="slip-card-top"><span class="slip-number">${slipIcon}${slipSerial(s.slip_no)}</span>${statusBadge(s.status||"Taslak")}</div><h2>${esc(names.customers[s.customer_id]||"—")}</h2><p>${esc(names.sites[s.site_id]||"Şantiye belirtilmedi")}</p><div class="slip-card-bottom"><span>${trDate(s.date)}<small>${esc(s.work_text||"İş fişi")}</small></span><strong>${fmtNum(s.quantity)} <small>${esc(s.unit||"")}</small></strong></div></a>`);
}

async function slipForm(ctx, editId) {
  const { root, db, names, query } = ctx;
  const [customers, sites, vehicles, personnel] = await Promise.all([
    db.listActive("customers"),
    db.listActive("sites"),
    db.listActive("vehicles"),
    db.listActive("personnel"),
  ]);
  let rec = editId ? await db.get("slips", editId) : null;
  if (rec && (rec.status === "İmzalandı" || rec.signed_at)) {
    toast("İmzalı fiş düzenlenemez — revizyon oluşturun", "err");
    go("#/fisler/" + editId);
    return;
  }
  let v = rec || {};
  if (!editId && query.work) {
    const w = await db.get("work_records", query.work);
    if (w)
      v = {
        date: w.date,
        customer_id: w.customer_id,
        site_id: w.site_id,
        vehicle_id: w.vehicle_id,
        personnel_id: w.personnel_id,
        work_text: w.work_type,
        quantity: w.quantity,
        unit: w.unit,
        description: w.description,
        work_record_id: w.id,
      };
    if (w && query.batch === "1" && w.work_batch_id) {
      const rows = (await db.listActive("work_records")).filter(
        (r) => r.work_batch_id === w.work_batch_id,
      );
      if (rows.some((r) => r.slip_id)) {
        toast("Bu grubun işleri zaten fişe bağlı", "err");
        go("#/isler/" + w.id);
        return;
      }
      v = {
        ...v,
        quantity: rows.reduce((sum, r) => sum + Number(r.quantity), 0),
        work_record_ids: rows.map((r) => r.id),
        customer_items: rows.map((r) => ({
          date: r.date,
          site_id: r.site_id,
          work_type: r.work_type,
          material: r.material || "",
          quantity: r.quantity,
          unit: r.unit,
          unit_price: r.price_snapshot?.unit_price ?? null,
          kdv_rate: r.price_snapshot?.kdv_rate ?? 20,
          kdv_included: !!r.price_snapshot?.kdv_included,
        })),
        vehicle_id: rows.every((r) => r.vehicle_id === w.vehicle_id)
          ? w.vehicle_id
          : null,
        personnel_id: rows.every((r) => r.personnel_id === w.personnel_id)
          ? w.personnel_id
          : null,
        description: w.customer_note || "",
      };
    }
  }
  const vehName = (id) => (vehicles.find((x) => x.id === id) || {}).name || "";

  root.innerHTML =
    appbar(
      editId ? "Fiş Düzenle" : "Yeni Dijital İş Fişi",
      editId
        ? "Seri #" + String(rec.slip_no).padStart(6, "0")
        : "Seri no otomatik verilir",
    ) +
    `
    <form class="slip-form" data-form novalidate>
      <section class="slip-panel"><h2><span>01</span> Müşteri ve İş Yeri</h2><p class="slip-hint">Fişin teslim edileceği müşteri ve şantiye.</p>
      ${fDate("Tarih", "date", v.date)}
      <div class="formgrid2">
        ${fSelect(
          "Müşteri",
          "customer_id",
          customers.map((c) => ({ v: c.id, t: c.name })),
          v.customer_id,
          { req: true },
        )}
        ${fSelect(
          "Şantiye",
          "site_id",
          sites.map((s) => ({ v: s.id, t: s.name })),
          v.site_id,
        )}
      </div>
      </section><section class="slip-panel"><h2><span>02</span> Araç ve Gerçekleşen Hizmet</h2>
      <div class="formgrid2">
        ${fSelect(
          "Araç / Makine",
          "vehicle_id",
          vehicles.map((x) => ({ v: x.id, t: x.name })),
          v.vehicle_id,
        )}
        ${fText("Plaka", "plate", v.plate || vehName(v.vehicle_id), {})}
      </div>
      ${fSelect(
        "Personel",
        "personnel_id",
        personnel.map((x) => ({ v: x.id, t: x.name })),
        v.personnel_id,
      )}
      ${fText("Yapılan İş", "work_text", v.work_text || "", { req: true, ph: "Hafriyat nakliye…" })}
      <div class="formgrid2">
        ${fNum("Miktar", "quantity", v.quantity ?? "", { req: true, step: "any" })}
        ${fSelect("Birim", "unit", WORK_UNITS, v.unit || "Sefer", { empty: false })}
      </div>
      </section><section class="slip-panel"><h2><span>03</span> Teslim Bilgileri</h2><p class="slip-hint">Bu açıklama müşteri PDF’sinde görünür. İç not yazmayın.</p>
      ${fArea("Müşteriye Açıklama", "description", v.description || "")}
      ${fText("Teslim Alan (ad soyad)", "receiver_name", v.receiver_name || "")}
      </section></form>
    <div class="actionbar"><button class="btn primary" data-save>${editId ? "Kaydet" : "Kaydet ve İmzaya Geç"}</button></div>`;

  const sourceBatch = (v.work_record_ids || []).length > 1;
  if (sourceBatch) {
    for (const key of [
      "date",
      "customer_id",
      "site_id",
      "vehicle_id",
      "personnel_id",
      "plate",
      "work_text",
      "quantity",
      "unit",
    ])
      qs("[name=" + key + "]", root).disabled = true;
    qs("[data-form]", root).insertAdjacentHTML(
      "afterbegin",
      `<div class="notice"><strong>Toplam ${fmtNum(v.quantity)} sefer</strong><p>Bağlı işlerden alınır; döküm yerleri müşteriye gösterilmez.</p>${customerWorkLines(
        v.customer_items,
      )
        .map(
          (r) =>
            `<div>${esc(r.work_type)} · ${fmtNum(r.quantity)} ${esc(r.unit)}${r.unit_price == null ? "" : " · " + fmtTL(r.unit_price) + " TL/birim"}</div>`,
        )
        .join("")}</div>`,
    );
  }
  qs("select[name=vehicle_id]", root).addEventListener("change", (e) => {
    qs("input[name=plate]", root).value = vehName(e.target.value);
  });

  qs("[data-save]", root).addEventListener("click", async () => {
    const val = {
      ...(sourceBatch
        ? {
            date: v.date,
            customer_id: v.customer_id,
            site_id: v.site_id,
            vehicle_id: v.vehicle_id,
            personnel_id: v.personnel_id,
            plate: vehName(v.vehicle_id),
            work_text: v.work_text,
            quantity: v.quantity,
            unit: v.unit,
          }
        : {}),
      ...collectForm(qs("[data-form]", root)),
    };
    if (!val.customer_id) {
      toast("Müşteri seçin", "err");
      return;
    }
    if (!val.work_text) {
      toast("Yapılan iş yazın", "err");
      return;
    }
    if (!val.quantity || Number(val.quantity) <= 0) {
      toast("Miktar girin", "err");
      return;
    }
    const fields = {
      date: val.date || todayStr(),
      customer_id: val.customer_id,
      site_id: val.site_id || null,
      vehicle_id: val.vehicle_id || null,
      plate: val.plate || "",
      personnel_id: val.personnel_id || null,
      work_text: val.work_text,
      quantity: Number(val.quantity),
      unit: val.unit,
      description: val.description || "",
      receiver_name: val.receiver_name || "",
      work_record_id: v.work_record_id || null,
      ...(sourceBatch
        ? {
            work_record_ids: v.work_record_ids,
            customer_items: v.customer_items,
          }
        : {}),
    };
    if (editId) {
      await db.saveExisting("slips", rec, fields, "Fiş düzenlendi");
      toast("Fiş güncellendi", "ok");
      go("#/fisler/" + editId);
    } else {
      const no = await db.nextSeq("slip");
      const payload = {
        ...fields,
        slip_no: no,
        status: "Taslak",
        revision_no: 1,
      };
      let created;
      try {
        created = sourceBatch
          ? await db.saveWorkSlip(payload, v.work_record_ids)
          : await db.saveNew("slips", payload);
      } catch (e) {
        toast(e.message, "err");
        return;
      }
      if (created.work_record_id && !sourceBatch) {
        const w = await db.get("work_records", created.work_record_id);
        if (w)
          await db.saveExisting(
            "work_records",
            w,
            { slip_id: created.id },
            "Fiş bağlandı",
          );
      }
      toast("Fiş #" + String(no).padStart(6, "0") + " oluşturuldu", "ok");
      go("#/fisler/" + created.id + "/imza");
    }
  });
}

async function slipSign(ctx, id) {
  const { root, db } = ctx;
  const s = await db.get("slips", id);
  if (!s) {
    root.innerHTML = appbar("İmza") + emptyState("🧾", "Fiş yok");
    return;
  }
  if (s.status === "İmzalandı") {
    go("#/fisler/" + id);
    return;
  }
  root.innerHTML =
    appbar("Teslim ve İmza", slipSerial(s.slip_no)) +
    `
    <section class="slip-panel"><h2>Teslim Özeti</h2>${kv("Yapılan İş", s.work_text || "—")}${kv("Miktar", fmtNum(s.quantity)+" "+(s.unit||""))}${kv("Teslim Alan", s.receiver_name || "Belirtilmedi")}</section>
    <section class="slip-panel"><h2>Teslim Alan İmzası</h2><p class="slip-hint">Aşağıdaki alana parmağınızla imza atın. İmzalı fiş korunur; düzeltme için ayrı revizyon açılır.</p>
    <div class="sigframe"><canvas class="sigpad" data-pad></canvas></div>
    <div class="row" style="margin-top:10px;gap:8px">
      <button class="btn ghost grow" data-clear>Temizle</button>
      <button class="btn ghost grow" data-skip>Taslak Olarak Bırak</button>
      <button class="btn primary grow" data-sign>İmzayı Onayla</button>
    </div></section>`;
  const pad = qs("[data-pad]", root);
  const rect = () => pad.getBoundingClientRect();
  pad.width = 640;
  pad.height = 320;
  const c2 = pad.getContext("2d");
  c2.lineWidth = 5;
  c2.lineCap = "round";
  c2.strokeStyle = "#12233a";
  let drawing = false,
    hasInk = false;
  const pos = (e) => {
    const r = rect();
    const t = e.touches ? e.touches[0] : e;
    return [
      (t.clientX - r.left) * (pad.width / r.width),
      (t.clientY - r.top) * (pad.height / r.height),
    ];
  };
  const start = (e) => {
    drawing = true;
    const [x, y] = pos(e);
    c2.beginPath();
    c2.moveTo(x, y);
    e.preventDefault();
  };
  const move = (e) => {
    if (!drawing) return;
    const [x, y] = pos(e);
    c2.lineTo(x, y);
    c2.stroke();
    hasInk = true;
    e.preventDefault();
  };
  const end = () => {
    drawing = false;
  };
  pad.addEventListener("pointerdown", start);
  pad.addEventListener("pointermove", move);
  pad.addEventListener("pointerup", end);
  pad.addEventListener("pointerleave", end);
  pad.addEventListener("touchstart", start, { passive: false });
  pad.addEventListener("touchmove", move, { passive: false });
  pad.addEventListener("touchend", end);

  qs("[data-clear]", root).addEventListener("click", () => {
    c2.clearRect(0, 0, pad.width, pad.height);
    hasInk = false;
  });
  qs("[data-skip]", root).addEventListener("click", () => go("#/fisler/" + id));
  qs("[data-sign]", root).addEventListener("click", async () => {
    if (!hasInk) {
      toast("Önce imza atın", "err");
      return;
    }
    const button = qs("[data-sign]", root);
    if (button.disabled) return;
    button.disabled = true;
    try {
    const blob = await new Promise((r) => pad.toBlob(r, "image/png"));
    await db.signSlip(id, new File([blob], "imza.png", { type: "image/png" }));
    // Revizyon zinciri: bu fiş bir revizyon ise orijinali "Revize" işaretle
    if (s.revision_of) {
      const orig = await db.get("slips", s.revision_of);
      if (orig && orig.status === "İmzalandı")
        await db.saveExisting(
          "slips",
          orig,
          { status: "Revize" },
          "Revizyon imzalandı: #" + s.slip_no,
        );
    }
    toast("Fiş imzalandı ve kilitlendi", "ok");
    go("#/fisler/" + id);
    } catch(e) { toast(e.message || "İmza kaydedilemedi", "err"); }
    finally { button.disabled = false; }
  });
}

async function slipDetail(ctx, id) {
  const { root, db, names } = ctx;
  const s = await db.get("slips", id);
  if (!s) {
    root.innerHTML = appbar("Fiş") + emptyState("🧾", "Fiş yok");
    return;
  }
  const atts = await db.attachmentsFor("slip_signature", id);
  const sig = atts.find((a) => a.kind === "signature");
  const revisions = (await db.getAll("slips")).filter(
    (x) => isActive(x) && x.revision_of === id,
  );

  root.innerHTML =
    appbar("Dijital İş Fişi", slipSerial(s.slip_no) + " · " + trDate(s.date), {
      right: statusBadge(s.status || "Taslak"),
    }) +
    `
    <div class="slip-document-banner"><span>GERÇEKLEŞEN HİZMET</span><strong>${fmtNum(s.quantity)} <small>${esc(s.unit || "")}</small></strong><p>${esc(s.work_text || "—")}</p></div>
    <section class="slip-panel"><h2>Müşteri ve İş Yeri</h2>
      ${kv("Müşteri", names.customers[s.customer_id] || "—")}
      ${kv("Şantiye", names.sites[s.site_id] || "—")}
      </section><section class="slip-panel"><h2>Hizmet Bilgileri</h2>
      ${kv("Araç / Plaka", (names.vehicles[s.vehicle_id] || s.plate || "—") + (s.plate && s.plate !== names.vehicles[s.vehicle_id] ? " / " + s.plate : ""))}
      ${kv("Personel", names.personnel[s.personnel_id] || "—")}
      ${kv("Yapılan İş", s.work_text || "—")}
      ${kv("Miktar", fmtNum(s.quantity) + " " + (s.unit || ""))}
      ${s.description ? kv("Açıklama", s.description) : ""}
      </section><section class="slip-panel"><h2>Teslim ve Belge Durumu</h2>
      ${kv("Teslim Alan", s.receiver_name || "—")}
      ${s.signed_at ? kv("İmza Zamanı", new Date(s.signed_at).toLocaleString("tr-TR")) : ""}
      ${s.revision_no > 1 ? kv("Revizyon", "v" + s.revision_no) : ""}
    <p class="slip-hint">${s.status === "İmzalandı" ? "İmzalı kayıt kilitlidir. Düzeltmeler yeni revizyon olarak saklanır." : s.status === "Revize" ? "Bu kayıt korunmuştur; güncel revizyonu kontrol edin." : s.status === "İptal" ? "Bu fiş iptal edilmiştir." : "Taslak fiş: teslim alan imzası henüz alınmadı."}</p></section>
    ${sig ? `<div class="section-title">İmza</div><div class="sigframe"><img data-sig alt="İmza"></div>` : ""}
    ${revisions.length ? `<div class="section-title">Revizyonlar</div>` + revisions.map((r) => li({ ic: "🧾", href: "#/fisler/" + r.id, t1: `#${String(r.slip_no).padStart(6, "0")} (v${r.revision_no})`, badgeHtml: statusBadge(r.status) })).join("") : ""}
    <div class="actionbar slip-actions">
      ${s.status === "Taslak" ? `<button class="btn ok" data-go="#/fisler/${id}/imza">İmzala</button><button class="btn" data-go="#/fisler/${id}/edit">Düzenle</button>` : ""}
      ${s.status === "İmzalandı" ? `<button class="btn" data-revize>Revizyon</button>` : ""}
      <button class="btn primary" data-pdf>PDF</button><button class="btn" data-slip-share>Paylaş</button><button class="btn" data-slip-print>Yazdır</button>
      ${s.status !== "İmzalandı" ? '<button class="btn danger" data-del>İptal</button>' : ""}
    </div>`;

  if (sig) {
    const url = URL.createObjectURL(sig.blob);
    const img = qs("[data-sig]", root);
    img.onload = () => URL.revokeObjectURL(url);
    img.src = url;
  }
  const rv = qs("[data-revize]", root);
  if (rv)
    rv.addEventListener("click", async () => {
      const ok = await confirmDialog(
        "Revizyon oluşturulsun mu?",
        "Orijinal imzalı fiş korunur; yeni taslak kopya açılır.",
        "Oluştur",
      );
      if (!ok) return;
      const no = await db.nextSeq("slip");
      const copy = {
        ...s,
        id: undefined,
        slip_no: no,
        status: "Taslak",
        signed_at: null,
        signature_attachment_id: null,
        revision_of: s.revision_of || s.id,
        revision_no: (s.revision_no || 1) + 1,
        work_record_id: s.work_record_id,
      };
      delete copy.id;
      delete copy.created_at;
      delete copy.updated_at;
      delete copy.deleted_at;
      delete copy.schema_version;
      delete copy.migration_status;
      delete copy.source;
      const created = await db.saveNew("slips", copy, "Revizyon #" + no);
      toast("Revizyon taslağı #" + String(no).padStart(6, "0"), "ok");
      go("#/fisler/" + created.id);
    });
  for (const [selector, mode] of [["[data-pdf]","download"],["[data-slip-share]","share"],["[data-slip-print]","print"]]) {
    qs(selector,root).addEventListener("click",async()=>{
      try {
        const {slipSpec} = await import("./pdf.js");
        const {exportDocument} = await import("./document-engine.js");
        await exportDocument(slipSpec(s,names,sig?.blob || null),mode);
      } catch(e) { toast(e.message || "Belge oluşturulamadı", "err"); }
    });
  }
  const del = qs("[data-del]", root);
  if (del)
    del.addEventListener("click", async () => {
      const reason = await promptDialog("Fiş iptali", "İptal nedeni");
      if (!reason) return;
      await db.saveExisting("slips", s, { status: "İptal" }, reason);
      toast("Fiş iptal edildi", "ok");
      ctx.reload();
    });
}

// ============ WHATSAPP AYRIŞTIRICI ============
async function whatsapp(ctx) {
  const { root, db } = ctx;
  const [vehicles, customers, sites, personnel, aliases] = await Promise.all([
    db.listActive("vehicles"),
    db.listActive("customers"),
    db.listActive("sites"),
    db.listActive("personnel"),
    db.listActive("aliases"),
  ]);
  const aliasIdx = buildAliasIndex(
    aliases,
    vehicles,
    customers,
    sites,
    personnel,
  );

  root.innerHTML =
    appbar("WhatsApp Ayrıştırıcı", "Mesajı yapıştır → taslak → sen onayla") +
    `
    <div class="card tap" data-go="#/whatsapp-toplu" style="border-left:4px solid #25d366;margin-top:10px"><div class="row between"><span><b>💬 WhatsApp grubunu toplu işle</b><br><span class="muted small">Grubu dışa aktarın; yalnız yeni mesajlar, fişleriyle birlikte asistana gider</span></span><span class="muted">›</span></div></div>
    <div class="notice info"><span>ℹ</span><span>Taslaklar otomatik kaydedilmez; her birini tek tek onaylarsın. Belirsizler "KONTROL GEREKLİ" işaretlenir. Ham mesaj saklanır.</span></div>
    <div class="slip-panel"><p>Eski mesajları tarih ve fiyat kontrolüyle aktarmak için:</p><button class="btn" data-go="#/gecmis">Geçmiş İş Aktarımı</button></div><div class="field"><label>Mesaj metni</label><textarea data-raw style="min-height:130px" placeholder="U55 sevgi sokak ahmet bey 1 yevmiye&#10;34UL9492 leda 3 sefer hafriyat"></textarea></div>
    <div class="row" style="gap:8px;margin-bottom:12px">
      <button class="btn primary grow" data-parse>Ayrıştır</button>
      ${voiceSupported() ? '<button class="btn" data-voice>🎙 Sesli</button>' : ""}
    </div>
    <div data-out></div>`;

  const rawEl = qs("[data-raw]", root);
  const vBtn = qs("[data-voice]", root);
  if (vBtn)
    vBtn.addEventListener("click", () => {
      toast("Konuşun…", "ok");
      startVoice(
        (t) => {
          rawEl.value = (rawEl.value + "\n" + t).trim();
        },
        () => {},
      );
    });
  qs("[data-parse]", root).addEventListener("click", () => {
    const drafts = parseWhatsApp(rawEl.value, {
      vehicles,
      customers,
      sites,
      personnel,
      aliasIdx,
      defaultDate: todayStr(),
    });
    const out = qs("[data-out]", root);
    if (!drafts.length) {
      out.innerHTML = emptyState("💬", "Satır bulunamadı");
      return;
    }
    out.innerHTML =
      `<div class="section-title">${drafts.length} taslak</div>` +
      drafts
        .map(
          (d, i) => `
      <div class="card">
        <div class="row between">
          <span class="badge ${d.confidence >= 80 ? "ok" : d.confidence >= 50 ? "warn" : "danger"}">%${d.confidence} güven</span>
          ${d.kontrol_gerekli ? '<span class="badge warn">KONTROL GEREKLİ</span>' : ""}
        </div>
        <div style="margin:8px 0" class="small">
          ${kv("Tarih", trDate(d.date))}
          ${kv("Müşteri/Şantiye", (d.customer_id ? esc((customers.find((c) => c.id === d.customer_id) || {}).name) : "—") + " / " + (d.site_id ? esc((sites.find((s) => s.id === d.site_id) || {}).name) : "—"))}
          ${kv("Araç/Personel", (d.vehicle_id ? esc((vehicles.find((v) => v.id === d.vehicle_id) || {}).name) : "—") + " / " + (d.personnel_id ? esc((personnel.find((p) => p.id === d.personnel_id) || {}).name) : "—"))}
          ${kv("İş", (d.work_type || "—") + " · " + (d.quantity ?? "?") + " " + (d.unit || ""))}
          ${d.fuel_liters ? kv("Yakıt", d.fuel_liters + " Lt") : ""}
          ${d.notes.length ? kv("Notlar", d.notes.join("; ")) : ""}
        </div>
        <div class="tiny muted ellipsis" style="margin-bottom:8px">Ham: ${esc(d.raw_message)}</div>
        <div class="row" style="gap:8px">
          <button class="btn sm grow" data-edit="${i}">Düzenle</button>
          <button class="btn sm primary grow" data-save="${i}">Onayla & Kaydet</button>
        </div>
      </div>`,
        )
        .join("");
    out.onclick = async (ev) => {
      const eb = ev.target.closest("[data-edit]");
      const sb = ev.target.closest("[data-save]");
      if (eb) {
        const d = drafts[Number(eb.dataset.edit)];
        window.__prefill = {
          date: d.date,
          customer_id: d.customer_id,
          site_id: d.site_id,
          vehicle_id: d.vehicle_id,
          personnel_id: d.personnel_id,
          work_type: d.work_type,
          quantity: d.quantity,
          unit: d.unit,
          description: d.description,
          dump_area: d.dump_area,
          quarry: d.quarry,
        };
        go("#/isler/new");
      }
      if (sb) {
        const d = drafts[Number(sb.dataset.save)];
        await db.saveNew(
          "work_records",
          {
            date: d.date,
            customer_id: d.customer_id,
            site_id: d.site_id,
            vehicle_id: d.vehicle_id,
            personnel_id: d.personnel_id,
            work_type: d.work_type || "Diğer",
            quantity: d.quantity || 1,
            unit: d.unit || "Adet",
            description: d.description || "",
            dump_area: d.dump_area || "",
            quarry: d.quarry || "",
            slip_status: d.slip_status,
            raw_message: d.raw_message,
            parse_confidence: d.confidence,
            kontrol_gerekli: d.kontrol_gerekli,
          },
          "WhatsApp onay",
        );
        if (d.fuel_liters && d.vehicle_id) {
          await db.saveNew(
            "fuel_records",
            {
              date: d.date,
              vehicle_id: d.vehicle_id,
              personnel_id: d.personnel_id,
              liters: d.fuel_liters,
              fuel_source: "Depo Tankı",
              receipt: "Hayır",
              customer_billable: false,
              description: "WhatsApp: " + d.raw_message,
            },
            "WhatsApp onay",
          );
        }
        sb.closest(".card").style.opacity = ".4";
        sb.disabled = true;
        sb.textContent = "Kaydedildi ✓";
        toast("Kaydedildi", "ok");
      }
    };
  });
}
