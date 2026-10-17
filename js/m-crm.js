// ============================================================
// SAHAPRO SOLO — CRM & Sistem: Müşteriler · Şantiyeler · Belge Merkezi
// · Belge Tara (OCR) · Global Arama · Ayarlar (yedek/restore/alias/PIN) · Çöp Kutusu
// ============================================================
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
  searchBar,
  toast,
  confirmDialog,
  promptDialog,
  fText,
  fNum,
  fDate,
  fArea,
  fSelect,
  collectForm,
  pagedRender,
  downloadBlob,
  shareOrDownload,
  go,
  fmtTL,
  fmtNum,
  trDate,
  todayStr,
} from "./ui.js";
import {
  isActive,
  backupAgeDays,
  matchSearch,
  DOC_TYPES,
  ENTITY_STORES,
  toCSV,
  buildBackup,
  isValidBackup,
  mergePreview,
  buildZip,
  cariBalance,
  APP_VERSION,
  SCHEMA_VERSION,
  addDays,
} from "./core.js";

export async function screen(ctx) {
  const sub = ctx.parts[0];
  if (sub === "musteriler") return customers(ctx);
  if (sub === "santiyeler") return sites(ctx);
  if (sub === "belgeler") return documents(ctx);
  if (sub === "tara") return scan(ctx);
  if (sub === "ara") return globalSearch(ctx);
  if (sub === "ayarlar") return settings(ctx);
  if (sub === "cop") return trash(ctx);
  return settings(ctx);
}

const ACTIVE_SEL = [
  { v: "1", t: "Aktif" },
  { v: "0", t: "Pasif" },
];

// ============ MÜŞTERİLER (§28) ============
async function customers(ctx) {
  const sub = ctx.parts[1];
  if (sub === "new") return customerForm(ctx, null);
  if (sub && ctx.parts[2] === "edit") return customerForm(ctx, sub);
  if (sub) return customerDetail(ctx, sub);
  const { root, db, query } = ctx;
  const q = query.q || "";
  // "Kendi Depo (iç iş)" müşteri değildir: depodan çıkış seferleri Kendi Depo ekranında izlenir
  let rows = (await db.listActive("customers")).filter((c) => !c.internal).sort((a, b) =>
    String(a.name).localeCompare(String(b.name), "tr"),
  );
  rows = rows.filter((r) =>
    matchSearch(`${r.name} ${r.contact || ""} ${r.phone || ""}`, q),
  );
  root.innerHTML =
    appbar("Müşteriler", `${rows.length} kayıt`) +
    `
    <div style="height:10px"></div>${searchBar("Müşteri ara…", q)}<div data-list></div>
    <div class="actionbar"><button class="btn primary" data-go="#/musteriler/new">+ Müşteri</button></div>`;
  const listEl = qs("[data-list]", root);
  if (!rows.length)
    listEl.innerHTML = emptyState(
      "🏢",
      "Müşteri yok",
      '<button class="btn primary" data-go="#/musteriler/new">+ Müşteri Ekle</button>',
    );
  else
    pagedRender(listEl, rows, (c) =>
      li({
        ic: "🏢",
        href: "#/musteriler/" + c.id,
        t1: esc(c.name),
        t2: [c.contact, c.phone].filter(Boolean).map(esc).join(" · "),
        badgeHtml: c.active === false ? badge("Pasif", "") : "",
      }),
    );
  let st;
  qs("[data-search]", root).addEventListener("input", (e) => {
    clearTimeout(st);
    st = setTimeout(
      () => go("#/musteriler?q=" + encodeURIComponent(e.target.value)),
      450,
    );
  });
}

async function customerDetail(ctx, id) {
  const { root, db, names } = ctx;
  const c = await db.get("customers", id);
  if (!c) {
    root.innerHTML = appbar("Müşteri") + emptyState("🏢", "Kayıt yok");
    return;
  }
  const [sitesA, works, slips, quotes, haks, cash, cari, docs] =
    await Promise.all([
      db.getAll("sites"),
      db.getAll("work_records"),
      db.getAll("slips"),
      db.getAll("quotes"),
      db.getAll("hakedis"),
      db.getAll("cash_records"),
      db.getAll("cari_movements"),
      db.getAll("documents"),
    ]);
  const mine = (arr) => arr.filter((r) => isActive(r) && r.customer_id === id);
  const mCash = mine(cash),
    mSites = mine(sitesA),
    mWorks = mine(works),
    mSlips = mine(slips),
    mQuotes = mine(quotes),
    mHaks = mine(haks),
    mDocs = mine(docs);
  const { customerLedgerMovements } = await import("./collect-core.js");
  const ledger = customerLedgerMovements(await db.dumpAll(), id);
  const hakSum = ledger
    .filter((m) => m.type === "Hakedis" || m.type === "Is")
    .reduce((s, m) => s + (Number(m.amount) || 0), 0);
  const tahSum = mCash
    .filter((x) => x.cash_type === "Müşteriden Para Alındı")
    .reduce((s, x) => s + (Number(x.amount) || 0), 0);
  const bakiye = Math.round(ledger.reduce((s, m) => s + (Number(m.amount) || 0), 0) * 100) / 100;
  const allCust = await db.listActive("customers");
  const parent = c.parent_customer_id ? allCust.find((x) => x.id === c.parent_customer_id) : null;
  const month = new Date().toISOString().slice(0, 7);
  const subs = allCust.filter((x) => x.parent_customer_id === id).map((x) => {
    const ws = works.filter((w) => isActive(w) && w.customer_id === x.id);
    return { c: x, all: ws.length, month: ws.filter((w) => String(w.date).startsWith(month)).length };
  });
  root.innerHTML =
    appbar(c.name, c.contact || "", { back: "#/musteriler" }) +
    `
    <div style="height:10px"></div>
    <div class="statgrid" style="grid-template-columns:repeat(3,1fr)">
      ${stat(fmtTL(hakSum), "İş + Hakediş ₺")}${stat(fmtTL(tahSum), "Tahsilat ₺")}${stat(fmtTL(bakiye), "Bakiye ₺", bakiye > 0 ? "warn" : "ok")}
    </div>
    <div class="card tap" data-go="#/tahsilat/${esc(id)}"><div class="row between"><span>💰 Tahsilat takibi · WhatsApp hatırlatma · ödeme sözü</span><span class="muted small">›</span></div></div>
    <div class="card tap" data-go="#/teklif-hesap?customer_id=${esc(id)}"><div class="row between"><span>🧮 Bu müşteriye teklif / fiyat hesapla</span><span class="muted small">›</span></div></div>
    ${c.phone || c.note || parent ? `<div class="card">${parent ? `<div class="kv"><span class="k">Ana firma</span><span class="v"><a href="#/musteriler/${parent.id}">${esc(parent.name)}</a> (taşeronu)</span></div>` : ""}${c.phone ? kv("Telefon", c.phone) : ""}${c.note ? kv("Not", c.note) : ""}</div>` : ""}
    ${subs.length ? `<div class="section-title">Taşeronları (${subs.length})</div>` + subs.map((x) => li({ ic: "🏗", href: "#/musteriler/" + x.c.id, t1: esc(x.c.name), t2: `Bu ay ${x.month} iş · toplam ${x.all} iş` })).join("") : ""}
    <div class="section-title">Şantiyeler (${mSites.length})</div>
    ${
      mSites.length
        ? mSites
            .slice(0, 5)
            .map((s) =>
              li({
                ic: "📍",
                href: "#/santiyeler/" + s.id,
                t1: esc(s.name),
                t2: esc(s.address || ""),
              }),
            )
            .join("")
        : emptyState("📍", "Şantiye yok")
    }
    <div class="section-title">Son İşler (${mWorks.length})</div>
    ${
      mWorks.length
        ? mWorks
            .sort((a, b) => (b.date < a.date ? -1 : 1))
            .slice(0, 5)
            .map((w) =>
              li({
                ic: "⚒",
                href: "#/isler/" + w.id,
                t1: `${esc(w.work_type || "")} · ${fmtNum(w.quantity)} ${esc(w.unit || "")}`,
                t2: `${trDate(w.date)} · ${esc(names.vehicles[w.vehicle_id] || "—")}`,
              }),
            )
            .join("")
        : emptyState("⚒", "İş yok")
    }
    <div class="section-title">Fişler (${mSlips.length})</div>
    ${
      mSlips.length
        ? mSlips
            .sort((a, b) => (b.slip_no || 0) - (a.slip_no || 0))
            .slice(0, 5)
            .map((s) =>
              li({
                ic: "🧾",
                href: "#/fisler/" + s.id,
                t1: "#" + String(s.slip_no).padStart(6, "0"),
                t2: trDate(s.date),
                badgeHtml: statusBadge(s.status || "Taslak"),
              }),
            )
            .join("")
        : emptyState("🧾", "Fiş yok")
    }
    <div class="section-title">Teklifler (${mQuotes.length}) · Hakedişler (${mHaks.length})</div>
    ${mQuotes
      .sort((a, b) => (b.quote_no || 0) - (a.quote_no || 0))
      .slice(0, 3)
      .map((t) =>
        li({
          ic: "📄",
          href: "#/teklif/" + t.id,
          t1: "Teklif #" + String(t.quote_no).padStart(4, "0"),
          t2: trDate(t.date),
          badgeHtml: statusBadge(t.status || "Taslak"),
        }),
      )
      .join("")}
    ${mHaks
      .sort((a, b) => (b.hakedis_no || 0) - (a.hakedis_no || 0))
      .slice(0, 3)
      .map((h) =>
        li({
          ic: "📑",
          href: "#/hakedis/" + h.id,
          t1: "Hakediş #" + String(h.hakedis_no).padStart(6, "0"),
          t2: fmtTL(h.grand_total) + " ₺",
          badgeHtml: statusBadge(h.status),
        }),
      )
      .join("")}
    ${
      mDocs.length
        ? `<div class="section-title">Belgeler (${mDocs.length})</div>` +
          mDocs
            .slice(0, 3)
            .map((d) =>
              li({
                ic: "🗂",
                href: "#/belgeler/" + d.id,
                t1: esc(d.category || "Belge"),
                t2: trDate(d.date),
              }),
            )
            .join("")
        : ""
    }
    <div class="actionbar">
      <button class="btn" data-edit>✏ Düzenle</button>
      <button class="btn danger" data-del>🗑 Sil</button>
    </div>`;
  qs("[data-edit]", root).addEventListener("click", () =>
    go("#/musteriler/" + id + "/edit"),
  );
  qs("[data-del]", root).addEventListener("click", async () => {
    const reason = await promptDialog(
      "Müşteri silinsin mi?",
      "Silme nedeni (çöp kutusuna taşınır)",
    );
    if (reason == null) return;
    await db.softDelete("customers", id, reason || "Kullanıcı sildi");
    toast("Çöp kutusuna taşındı", "ok");
    go("#/musteriler");
  });
}

async function customerForm(ctx, editId) {
  const { root, db } = ctx;
  const rec = editId ? await db.get("customers", editId) : null;
  const v = rec || {};
  const allC = (await db.listActive("customers")).sort((a, b) => String(a.name).localeCompare(String(b.name), "tr"));
  // kendisi ve kendi taşeronları ana firma olamaz (döngü olmasın)
  const parentOpts = allC.filter((c) => c.id !== editId && c.parent_customer_id !== editId).map((c) => ({ v: c.id, t: c.name }));
  const { fuelRulesOf, FUEL_RULE_UNITS } = await import("./assistant-rules.js");
  const ruleRow = (r = {}) => `<div class="card" data-frule style="margin:6px 0;padding:8px">
      <div class="formgrid2">
        <div class="field"><label>Birim başı mazot (L)</label><input type="number" step="any" data-f="per" value="${esc(r.per ?? "")}"></div>
        <div class="field"><label>Birim</label><select data-f="unit">${FUEL_RULE_UNITS.map((u) => `<option ${u === (r.unit || "Sefer") ? "selected" : ""}>${u}</option>`).join("")}</select></div>
        <div class="field"><label>Hangi işlerde (kelimeler; boşsa tüm işleri)</label><input data-f="match" value="${esc(r.match || "")}" placeholder="gravak maslak"></div>
        <div class="field"><label>Ücret</label><select data-f="only_pay"><option value="1" ${r.only_pay !== false ? "selected" : ""}>Yalnız mazot (para alınmaz)</option><option value="0" ${r.only_pay === false ? "selected" : ""}>Para + mazot ayrıca</option></select></div>
        <div class="field"><label>Başlangıç (ops.)</label><input type="date" data-f="from" value="${esc(r.from || "")}"></div>
        <div class="field"><label>Bitiş (ops.)</label><input type="date" data-f="to" value="${esc(r.to || "")}"></div>
      </div>
      <input type="hidden" data-f="id" value="${esc(r.id || "")}"><button type="button" class="btn sm ghost" data-frule-del>Kuralı kaldır</button></div>`;
  root.innerHTML =
    appbar(editId ? "Müşteri Düzenle" : "+ Müşteri", "", {
      back: editId ? "#/musteriler/" + editId : "#/musteriler",
    }) +
    `
    <form data-form novalidate style="margin-top:10px">
      ${fText("Firma / Müşteri Adı", "name", v.name || "", { req: true })}
      <div class="formgrid2">${fText("Yetkili", "contact", v.contact || "")}${fText("Telefon", "phone", v.phone || "", { type: "tel" })}</div>
      ${fSelect("Ana firma (taşeronsa — örn. Ağırtaş → Hisar Polat)", "parent_customer_id", parentOpts, v.parent_customer_id || "")}
      <details ${fuelRulesOf(v).length ? "open" : ""} style="margin:8px 0"><summary class="strong">⛽ Mazotla ödeme kuralları (${fuelRulesOf(v).length})</summary>
        <div class="muted tiny" style="margin:4px 0">Müşteri işin karşılığını mazotla ödüyorsa: ör. "75 L / Sefer, gravak maslak, yalnız mazot". Kelimeler işin malzemesinde, açıklamasında, şantiye/ocak/döküm yeri adında aranır.</div>
        <div data-frules>${fuelRulesOf(v).map(ruleRow).join("")}</div>
        <button type="button" class="btn sm" data-frule-add>+ Kural ekle</button>
      </details>
      ${fArea("Not", "note", v.note || "")}
      ${fSelect("Durum", "active", ACTIVE_SEL, v.active === false ? "0" : "1", { empty: false })}
    </form>
    <div class="actionbar"><button class="btn primary" data-save>Kaydet</button></div>`;
  const bindDel = () => qsa("[data-frule-del]", root).forEach((b) => (b.onclick = () => b.closest("[data-frule]").remove()));
  qs("[data-frule-add]", root).addEventListener("click", () => {
    qs("[data-frules]", root).insertAdjacentHTML("beforeend", ruleRow({ unit: "Sefer", only_pay: true }));
    bindDel();
  });
  bindDel();
  qs("[data-save]", root).addEventListener("click", async () => {
    const val = collectForm(qs("[data-form]", root));
    if (!val.name || !val.name.trim()) {
      toast("Müşteri adı girin", "err");
      return;
    }
    const fields = {
      name: val.name.trim(),
      contact: val.contact || "",
      phone: val.phone || "",
      note: val.note || "",
      active: val.active !== "0",
      parent_customer_id: val.parent_customer_id || null,
      fuel_rules: qsa("[data-frule]", root).map((el) => {
        const g = (k) => el.querySelector(`[data-f=${k}]`).value;
        return { id: g("id") && g("id") !== "legacy" ? g("id") : "fr-" + Math.random().toString(36).slice(2, 9), per: Number(g("per")), unit: g("unit"), match: g("match").trim(), only_pay: g("only_pay") === "1", from: g("from") || "", to: g("to") || "" };
      }).filter((r) => r.per > 0),
      fuel_per_trip: null, fuel_rule_match: "", fuel_only_pay: null,
    };
    if (editId) {
      await db.saveExisting("customers", rec, fields, "Müşteri düzenlendi");
      toast("Güncellendi", "ok");
      go("#/musteriler/" + editId);
    } else {
      const c = await db.saveNew("customers", fields, "Müşteri eklendi");
      toast("Müşteri eklendi", "ok");
      go("#/musteriler/" + c.id);
    }
  });
}

// ============ ŞANTİYELER (§29) ============
async function sites(ctx) {
  const sub = ctx.parts[1];
  if (sub === "new") return siteForm(ctx, null);
  if (sub && ctx.parts[2] === "edit") return siteForm(ctx, sub);
  const { root, db, names, query } = ctx;
  const q = query.q || "";
  let rows = (await db.listActive("sites")).sort((a, b) =>
    String(a.name).localeCompare(String(b.name), "tr"),
  );
  rows = rows.filter((r) =>
    matchSearch(
      `${r.name} ${names.customers[r.customer_id] || ""} ${r.address || ""}`,
      q,
    ),
  );
  root.innerHTML =
    appbar("Şantiyeler", `${rows.length} kayıt`) +
    `
    <div style="height:10px"></div>${searchBar("Şantiye / müşteri ara…", q)}<div data-list></div>
    <div class="actionbar"><button class="btn primary" data-go="#/santiyeler/new">+ Şantiye</button></div>`;
  const listEl = qs("[data-list]", root);
  if (!rows.length)
    listEl.innerHTML = emptyState(
      "📍",
      "Şantiye yok",
      '<button class="btn primary" data-go="#/santiyeler/new">+ Şantiye Ekle</button>',
    );
  else
    pagedRender(listEl, rows, (s) =>
      li({
        ic: "📍",
        href: "#/santiyeler/" + s.id,
        t1: esc(s.name),
        t2:
          esc(names.customers[s.customer_id] || "—") +
          (s.address ? " · " + esc(s.address) : ""),
        badgeHtml: s.active === false ? badge("Pasif", "") : "",
      }),
    );
  let st;
  qs("[data-search]", root).addEventListener("input", (e) => {
    clearTimeout(st);
    st = setTimeout(
      () => go("#/santiyeler?q=" + encodeURIComponent(e.target.value)),
      450,
    );
  });
}

async function siteForm(ctx, editId) {
  const { root, db } = ctx;
  const rec = editId ? await db.get("sites", editId) : null;
  const v = rec || {};
  const customersL = await db.listActive("customers");
  root.innerHTML =
    appbar(editId ? "Şantiye Düzenle" : "+ Şantiye", "", {
      back: "#/santiyeler",
    }) +
    `
    <form data-form novalidate style="margin-top:10px">
      ${fSelect(
        "Müşteri",
        "customer_id",
        customersL.map((c) => ({ v: c.id, t: c.name })),
        v.customer_id || "",
        { req: true },
      )}
      ${fText("Şantiye Adı", "name", v.name || "", { req: true })}
      ${fText("Adres", "address", v.address || "")}
      <div class="formgrid2">${fText("Konum (metin)", "location", v.location || "")}${fText("Yetkili", "contact", v.contact || "")}</div>
      <div class="formgrid2">${fText("Telefon", "phone", v.phone || "", { type: "tel" })}${fSelect("Durum", "active", ACTIVE_SEL, v.active === false ? "0" : "1", { empty: false })}</div>
      ${fArea("Not", "note", v.note || "")}
    </form>
    <div class="actionbar"><button class="btn primary" data-save>Kaydet</button></div>`;
  qs("[data-save]", root).addEventListener("click", async () => {
    const val = collectForm(qs("[data-form]", root));
    if (!val.customer_id) {
      toast("Müşteri seçin", "err");
      return;
    }
    if (!val.name || !val.name.trim()) {
      toast("Şantiye adı girin", "err");
      return;
    }
    const fields = {
      customer_id: val.customer_id,
      name: val.name.trim(),
      address: val.address || "",
      location: val.location || "",
      contact: val.contact || "",
      phone: val.phone || "",
      note: val.note || "",
      active: val.active !== "0",
    };
    if (editId) {
      await db.saveExisting("sites", rec, fields, "Şantiye düzenlendi");
      toast("Güncellendi", "ok");
    } else {
      await db.saveNew("sites", fields, "Şantiye eklendi");
      toast("Şantiye eklendi", "ok");
    }
    go("#/santiyeler");
  });
}

// ============ BELGE MERKEZİ (§30–§32) ============
function docIcon(cat) {
  return cat === "Akaryakıt Fişi"
    ? "⛽"
    : cat === "Döküm Fişi"
      ? "🪨"
      : cat === "Fatura" || cat === "Gider Fişi"
        ? "💸"
        : cat === "Dijital İş Fişi"
          ? "🧾"
          : cat === "Ruhsat" ||
              cat === "Sigorta / Poliçe" ||
              cat === "Muayene Belgesi"
            ? "📇"
            : "🗂";
}
async function documents(ctx) {
  const sub = ctx.parts[1];
  if (sub === "new") return docForm(ctx);
  if (sub) return docDetail(ctx, sub);
  const { root, db, names, query } = ctx;
  const q = query.q || "";
  let rows = (await db.getAll("documents"))
    .filter(isActive)
    .sort((a, b) => (String(b.date) < String(a.date) ? -1 : 1));
  rows = rows.filter((r) =>
    matchSearch(
      `${r.category || ""} ${r.doc_no || ""} ${r.description || ""} ${names.customers[r.customer_id] || ""} ${names.vehicles[r.vehicle_id] || ""} ${(r.ocr && r.ocr.searchable_text) || ""}`,
      q,
    ),
  );
  root.innerHTML =
    appbar("Belge Merkezi", `${rows.length} belge`, {
      right: '<button class="iconbtn" data-go="#/tara">📷</button>',
    }) +
    `
    <div style="height:10px"></div>
    <div class="row" style="gap:8px;margin-bottom:10px">
      <button class="btn primary grow" data-go="#/tara">📷 Belge Tara (OCR)</button>
      <button class="btn grow" data-go="#/belgeler/new">+ Manuel Belge</button>
    </div>
    ${searchBar("Kategori, fiş no, firma, OCR metni…", q)}<div data-list></div>`;
  const listEl = qs("[data-list]", root);
  if (!rows.length)
    listEl.innerHTML = emptyState(
      "🗂",
      "Belge yok",
      '<button class="btn primary" data-go="#/tara">📷 İlk Belgeyi Tara</button>',
    );
  else
    pagedRender(listEl, rows, (d) =>
      li({
        ic: docIcon(d.category),
        href: "#/belgeler/" + d.id,
        t1: `${esc(d.category || "Belge")}${d.doc_no ? " · #" + esc(d.doc_no) : ""}`,
        t2: `${trDate(d.date)}${d.customer_id ? " · " + esc(names.customers[d.customer_id]) : ""}${d.vehicle_id ? " · " + esc(names.vehicles[d.vehicle_id]) : ""}`,
        badgeHtml:
          d.ocr && d.ocr.status === "TAMAM"
            ? badge("OCR", "ok")
            : d.ocr && (d.ocr.status === "BEKLIYOR" || d.ocr.status === "HATA")
              ? badge("OCR bekliyor", "warn")
              : d.expiry_date
                ? badge(
                    trDate(d.expiry_date),
                    d.expiry_date <= todayStr() ? "danger" : "",
                  )
                : "",
      }),
    );
  let st;
  qs("[data-search]", root).addEventListener("input", (e) => {
    clearTimeout(st);
    st = setTimeout(
      () => go("#/belgeler?q=" + encodeURIComponent(e.target.value)),
      450,
    );
  });
}

async function docForm(ctx) {
  const { root, db } = ctx;
  const [customersL, sitesL, vehiclesL, personnelL] = await Promise.all([
    db.listActive("customers"),
    db.listActive("sites"),
    db.listActive("vehicles"),
    db.listActive("personnel"),
  ]);
  root.innerHTML =
    appbar("+ Manuel Belge", "Fotoğraf ekleyebilirsiniz", {
      back: "#/belgeler",
    }) +
    `
    <form data-form novalidate style="margin-top:10px">
      <div class="formgrid2">${fDate("Tarih", "date", todayStr())}${fSelect("Kategori", "category", DOC_TYPES, "Diğer", { empty: false })}</div>
      ${fSelect(
        "Müşteri",
        "customer_id",
        customersL.map((c) => ({ v: c.id, t: c.name })),
        "",
      )}
      <div class="formgrid2">${fSelect(
        "Şantiye",
        "site_id",
        sitesL.map((c) => ({ v: c.id, t: c.name })),
        "",
      )}${fSelect(
        "Araç",
        "vehicle_id",
        vehiclesL.map((c) => ({ v: c.id, t: c.name })),
        "",
      )}</div>
      ${fSelect(
        "Personel",
        "personnel_id",
        personnelL.map((c) => ({ v: c.id, t: c.name })),
        "",
      )}
      <div class="formgrid2">${fText("Belge / Fiş No", "doc_no", "")}${fDate("Bitiş Tarihi (varsa)", "expiry_date", "", false)}</div>
      ${fArea("Açıklama", "description", "")}
      <div class="section-title">Fiziksel Arşiv (ops.)</div>
      <div class="formgrid2">${fText("Klasör", "archive_folder", "")}${fText("Raf", "archive_shelf", "")}</div>
      <div class="formgrid2">${fText("Koçan", "archive_kocan", "")}${fText("Dosya No", "archive_file_no", "")}</div>
      <div class="field"><label>Fotoğraf (ops.)</label><input type="file" name="photo" accept="image/*"></div>
    </form>
    <div class="actionbar"><button class="btn primary" data-save>Kaydet</button></div>`;
  qs("[data-save]", root).addEventListener("click", async () => {
    const val = collectForm(qs("[data-form]", root));
    const fields = {
      date: val.date,
      category: val.category,
      customer_id: val.customer_id || null,
      site_id: val.site_id || null,
      vehicle_id: val.vehicle_id || null,
      personnel_id: val.personnel_id || null,
      doc_no: val.doc_no || "",
      expiry_date: val.expiry_date || null,
      description: val.description || "",
      archive_folder: val.archive_folder || "",
      archive_shelf: val.archive_shelf || "",
      archive_kocan: val.archive_kocan || "",
      archive_file_no: val.archive_file_no || "",
      ocr: { status: "YOK" },
    };
    const created = await db.saveNew("documents", fields, "Belge eklendi");
    const file = qs("input[name=photo]", root).files[0];
    if (file)
      await db.addAttachment("document", created.id, file, { kind: "photo" });
    toast("Belge kaydedildi", "ok");
    go("#/belgeler/" + created.id);
  });
}

async function docDetail(ctx, id) {
  const { root, db, names } = ctx;
  const d = await db.get("documents", id);
  if (!d) {
    root.innerHTML = appbar("Belge") + emptyState("🗂", "Belge yok");
    return;
  }
  const atts = await db.attachmentsFor("document", id);
  const ocr = d.ocr || { status: "YOK" };
  const confBadge =
    ocr.confidence == null
      ? ""
      : badge(
          "Güven: " +
            (ocr.confidence >= 85
              ? "Yüksek"
              : ocr.confidence >= 60
                ? "Orta"
                : "Düşük") +
            " %" +
            Math.round(ocr.confidence),
          ocr.confidence >= 85
            ? "ok"
            : ocr.confidence >= 60
              ? "warn"
              : "danger",
        );
  root.innerHTML =
    appbar(d.category || "Belge", trDate(d.date), {
      back: "#/belgeler",
      right: d.expiry_date
        ? badge(
            "Bitiş " + trDate(d.expiry_date),
            d.expiry_date <= todayStr()
              ? "danger"
              : d.expiry_date <= addDays(todayStr(), 30)
                ? "warn"
                : "",
          )
        : "",
    }) +
    `
    <div style="height:10px"></div>
    <div class="card">
      ${d.doc_no ? kv("Belge No", d.doc_no) : ""}
      ${d.customer_id ? kv("Müşteri", names.customers[d.customer_id] || "—") : ""}
      ${d.site_id ? kv("Şantiye", names.sites[d.site_id] || "—") : ""}
      ${d.vehicle_id ? kv("Araç", names.vehicles[d.vehicle_id] || "—") : ""}
      ${d.personnel_id ? kv("Personel", names.personnel[d.personnel_id] || "—") : ""}
      ${d.description ? kv("Açıklama", d.description) : ""}
      ${d.archive_folder || d.archive_shelf || d.archive_kocan || d.archive_file_no ? kv("Arşiv", ["Klasör " + (d.archive_folder || "—"), "Raf " + (d.archive_shelf || "—"), "Koçan " + (d.archive_kocan || "—"), "Dosya " + (d.archive_file_no || "—")].join(" · ")) : ""}
      ${d.linked_record ? kv("Bağlı Kayıt", d.linked_record.type === "fuel_records" ? "⛽ Yakıt kaydı" : "💸 Gider kaydı") : ""}
    </div>
    <div class="section-title">Ekler (${atts.length})</div>
    <div class="row" style="gap:8px;flex-wrap:wrap" data-atts>${atts.length ? "" : '<span class="muted small">Ek yok</span>'}</div>
    <div class="section-title">OCR</div>
    <div class="card">
      <div class="row between"><span class="muted small">Durum</span><span>${ocr.status === "TAMAM" ? badge("TAMAM", "ok") : ocr.status === "BEKLIYOR" ? badge("BEKLİYOR", "warn") : ocr.status === "HATA" ? badge("HATA", "danger") : badge("YOK", "")} ${confBadge}</span></div>
      ${
        ocr.confirmed_fields && Object.keys(ocr.confirmed_fields).length
          ? `<div class="divider"></div>` +
            Object.entries(ocr.confirmed_fields)
              .filter(([, v]) => v != null && v !== "")
              .map(([k, v]) => kv(k, String(v)))
              .join("")
          : ""
      }
      ${(ocr.checks || []).map((c) => `<div class="notice ${c.level === "error" ? "danger" : "warn"}" style="margin-top:8px"><span>${c.level === "error" ? "⛔" : "⚠"}</span><span>${esc(c.text)}</span></div>`).join("")}
      ${ocr.searchable_text ? `<details style="margin-top:8px"><summary class="muted small">OCR metni (${ocr.searchable_text.length} kr)</summary><div class="tiny muted" style="white-space:pre-wrap;margin-top:6px">${esc(ocr.searchable_text.slice(0, 1500))}</div></details>` : ""}
      ${(ocr.status === "BEKLIYOR" || ocr.status === "HATA" || ocr.status === "YOK") && atts.length ? `<button class="btn block" style="margin-top:10px" data-ocr>🔍 OCR ${ocr.status === "YOK" ? "Çalıştır" : "Tekrar Dene"}</button><div data-prog></div>` : ""}
    </div>
    <div data-suggest></div>
    <div class="actionbar">
      <button class="btn" data-addphoto>📷 Foto Ekle</button>
      <button class="btn danger" data-del>🗑 Sil</button>
    </div>
    <input type="file" accept="image/*" data-photoinput hidden>`;
  const attRoot = qs("[data-atts]", root);
  for (const a of atts) {
    if ((a.type || "").startsWith("image/")) {
      const img = document.createElement("img");
      img.src = URL.createObjectURL(a.blob);
      img.style.cssText =
        "width:84px;height:84px;object-fit:cover;border-radius:10px;border:1px solid var(--border);cursor:pointer";
      img.title = a.name || "foto";
      img.addEventListener("click", () => window.open(img.src, "_blank"));
      attRoot.appendChild(img);
    } else {
      const b = document.createElement("button");
      b.className = "btn sm";
      b.textContent = "📎 " + (a.name || "dosya");
      b.addEventListener("click", () => downloadBlob(a.blob, a.name || "ek"));
      attRoot.appendChild(b);
    }
  }
  const sug = qs("[data-suggest]", root);
  const cf = ocr.confirmed_fields || {};
  const mkSuggest = () => {
    const m = window.__ocr;
    if (!m || !m.suggestionFor) return;
    const s = m.suggestionFor(d.category, cf);
    if (!s || d.linked_record) return;
    sug.innerHTML = `<div class="notice info" style="margin-top:10px"><span>💡</span><span>Bu belgeden kayıt üretebilirsiniz. Alanlar OCR önerisidir; kaydetmeden önce değerleri kontrol edin.</span></div>
      <button class="btn primary block" style="margin-top:8px" data-suggo>${s.label}</button>`;
    qs("[data-suggo]", sug).addEventListener("click", () =>
      createFromOcr(ctx, d, s.kind, cf),
    );
  };
  if (ocr.status === "TAMAM") {
    import("./ocr.js")
      .then((m) => {
        window.__ocr = m;
        mkSuggest();
      })
      .catch(() => {});
  }
  const ocrBtn = qs("[data-ocr]", root);
  if (ocrBtn)
    ocrBtn.addEventListener("click", async () => {
      const prog = qs("[data-prog]", root);
      prog.innerHTML =
        '<div class="muted small" style="margin-top:8px">OCR çalışıyor… <span data-pct>0</span>%</div>';
      try {
        const m = await import("./ocr.js");
        window.__ocr = m;
        const att = atts.find((a) => (a.type || "").startsWith("image/"));
        if (!att) throw new Error("Görsel ek yok");
        const pp = await m.preprocessImage(att.blob, {});
        const r = await m.runOcr(pp.blob, (st, p) => {
          const e = qs("[data-pct]", prog);
          if (e) e.textContent = String(Math.round((p || 0) * 100));
        });
        const ext = m.extractFields(d.category, r.text, r.confidence);
        await db.saveExisting(
          "documents",
          d,
          {
            ocr: {
              status: "TAMAM",
              confidence: r.confidence,
              fields: ext.fields,
              checks: ext.checks || [],
              confirmed_fields: ext.fields,
              searchable_text: r.text.slice(0, 6000),
              ran_at: new Date().toISOString(),
            },
          },
          "OCR tamam",
        );
        toast("OCR tamamlandı — alanları kontrol edin", "ok");
        ctx.reload();
      } catch (e) {
        await db.saveExisting(
          "documents",
          d,
          { ocr: { ...(d.ocr || {}), status: "HATA" } },
          "OCR hata",
        );
        toast(
          "OCR başarısız: " + (e.message || e) + " — belge yine de kayıtlı",
          "err",
        );
        ctx.reload();
      }
    });
  qs("[data-addphoto]", root).addEventListener("click", () =>
    qs("[data-photoinput]", root).click(),
  );
  qs("[data-photoinput]", root).addEventListener("change", async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    await db.addAttachment("document", id, f, { kind: "photo" });
    toast("Fotoğraf eklendi", "ok");
    ctx.reload();
  });
  qs("[data-del]", root).addEventListener("click", async () => {
    const reason = await promptDialog(
      "Belge silinsin mi?",
      "Silme nedeni (çöp kutusuna taşınır)",
    );
    if (reason == null) return;
    await db.softDelete("documents", id, reason || "Kullanıcı sildi");
    toast("Çöp kutusuna taşındı", "ok");
    go("#/belgeler");
  });
}

// OCR onaylı alanlardan kayıt — asla sessiz yazmaz; confirmDialog özeti gösterir
async function createFromOcr(ctx, d, kind, f) {
  const { db, names } = ctx;
  if (kind === "expense" || kind === "fuel") {
    const { findDuplicates } = await import("./esnaf.js");
    const all = await db.dumpAll();
    const amt = f.total != null ? Number(f.total) : null;
    const dup = amt != null ? findDuplicates(all, { date: f.date || d.date, amount: amt }) : { bills: [], expenses: [] };
    const same = kind === "fuel"
      ? (all.fuel_records || []).filter((x) => isActive(x) && x.date === (f.date || d.date) && Number(x.total) === amt)
      : dup.expenses;
    if (dup.bills.length || same.length) {
      const ok = await confirmDialog(
        "Benzer kayıt zaten var",
        dup.bills.length
          ? "Aynı gün ve tutarda Esnaf Hesabı'nda bir borç kaydı var. Aynı iş ise tekrar girmeyin."
          : "Aynı gün ve tutarda bir " + (kind === "fuel" ? "yakıt" : "gider") + " kaydı var. Aynı fişse tekrar girmeyin.",
        "Farklı bir kayıt, devam et",
      );
      if (!ok) return;
    }
  }
  const errs = ((d.ocr && d.ocr.checks) || []).filter((c) => c.level === "error");
  if ((kind === "expense" || kind === "fuel") && errs.length) {
    const ok = await confirmDialog(
      "Okunan tutarlar tutarsız",
      errs.map((c) => c.text).join(" ") + " Alanları kontrol ettiniz mi?",
      "Kontrol ettim, devam et",
    );
    if (!ok) return;
  }
  const vehicles = await db.listActive("vehicles");
  let vehicle_id = d.vehicle_id || null;
  if (!vehicle_id && f.plate) {
    const p = String(f.plate).toUpperCase().replace(/\s+/g, "");
    const hit = vehicles.find((v) => {
      const n = String(v.name).toUpperCase().replace(/\s+/g, "");
      return n.includes(p) || p.includes(n);
    });
    if (hit) vehicle_id = hit.id;
  }
  if (kind === "fuel") {
    const ok = await confirmDialog(
      "Yakıt kaydı oluşturulsun mu?",
      `${trDate(f.date || d.date)} · ${f.liters != null ? f.liters + " Lt" : "litre yok"} · ${f.total != null ? fmtTL(f.total) + " ₺" : "tutar yok"}${vehicle_id ? " · " + (names.vehicles[vehicle_id] || "") : " · ARAÇ EŞLEŞMEDİ"}`,
      "Oluştur",
    );
    if (!ok) return;
    if (f.liters == null) {
      toast(
        "Litre alanı eksik — belge alanlarını düzenleyip tekrar deneyin",
        "err",
      );
      return;
    }
    const rec = await db.saveNew(
      "fuel_records",
      {
        date: f.date || d.date,
        vehicle_id,
        personnel_id: d.personnel_id || null,
        liters: Number(f.liters),
        unit_price: f.unit_price != null ? Number(f.unit_price) : null,
        total: f.total != null ? Number(f.total) : null,
        fuel_source: "Akaryakıt İstasyonu",
        receipt: "Evet",
        pump_no: "",
        km: null,
        machine_hours: null,
        description: "OCR: " + (f.firma || d.doc_no || d.category),
        customer_billable: false,
      },
      "OCR onaylı yakıt",
    );
    await db.saveExisting(
      "documents",
      d,
      { linked_record: { type: "fuel_records", id: rec.id } },
      "Belge yakıt kaydına bağlandı",
    );
    toast("Yakıt kaydı oluşturuldu", "ok");
    ctx.reload();
  } else if (kind === "expense") {
    const ok = await confirmDialog(
      "Gider kaydı oluşturulsun mu?",
      `${trDate(f.date || d.date)} · ${f.category_suggestion || d.category} · ${f.total != null ? fmtTL(f.total) + " ₺" : "tutar yok"} · ${f.firma || ""}`,
      "Oluştur",
    );
    if (!ok) return;
    if (f.total == null) {
      toast("Tutar alanı eksik — belge alanlarını kontrol edin", "err");
      return;
    }
    const rec = await db.saveNew(
      "expense_records",
      {
        date: f.date || d.date,
        category: f.category_suggestion || "Diğer",
        amount: Number(f.total),
        personnel_id: d.personnel_id || null,
        vehicle_id,
        payment_method: "Şirket Ödedi",
        receipt: "Evet",
        reimbursement_status: null,
        company: f.firma || "",
        description: "OCR: " + (f.doc_no || d.doc_no || d.category),
      },
      "OCR onaylı gider",
    );
    await db.saveExisting(
      "documents",
      d,
      { linked_record: { type: "expense_records", id: rec.id } },
      "Belge gider kaydına bağlandı",
    );
    toast("Gider kaydı oluşturuldu", "ok");
    ctx.reload();
  } else if (kind === "vehicle_doc") {
    if (!vehicle_id) {
      toast("Önce belgeye araç bağlayın (veya plaka okutun)", "err");
      return;
    }
    const ok = await confirmDialog(
      "Araç belge takibine bağlansın mı?",
      `${names.vehicles[vehicle_id] || ""} · bitiş: ${f.date_end ? trDate(f.date_end) : "—"}`,
      "Bağla",
    );
    if (!ok) return;
    const fields = { vehicle_id };
    if (f.date_end) fields.expiry_date = f.date_end;
    await db.saveExisting("documents", d, fields, "Araç belge takibi");
    toast(
      "Araç belge takibine bağlandı — bitiş tarihi yaklaşınca uyarı verilir",
      "ok",
    );
    ctx.reload();
  } else if (kind === "work_match") {
    toast("İş eşleştirme: belgeyi iş detayından ilişkilendirin", "err");
  }
}

// ============ BELGE TARA — kamera/galeri + ön-işleme + OCR + onay (ADDENDUM §1–§11) ============
async function scan(ctx) {
  const { root, db } = ctx;
  const ocrMod = await import("./ocr.js").catch(() => null);
  if (ocrMod) window.__ocr = ocrMod;
  const [customersL, sitesL, vehiclesL, personnelL] = await Promise.all([
    db.listActive("customers"),
    db.listActive("sites"),
    db.listActive("vehicles"),
    db.listActive("personnel"),
  ]);
  const pages = [];
  let ocrText = "",
    ocrConf = 0,
    ocrDone = false;

  root.innerHTML =
    appbar("Belge Tara", "Kamera veya galeri — görüntü cihazdan çıkmaz", {
      back: "#/belgeler",
    }) +
    `
    <div style="height:10px"></div>
    <div class="row" style="gap:8px">
      <button class="btn primary grow" data-cam>📷 Kamera</button>
      <button class="btn grow" data-gal>🖼 Galeri</button>
    </div>
    <input type="file" accept="image/*" capture="environment" data-camin hidden>
    <input type="file" accept="image/*" data-galin hidden multiple>
    <div class="row" style="gap:8px;flex-wrap:wrap;margin-top:12px" data-pages></div>
    <div class="card" style="margin-top:12px" data-ocrcard hidden>
      <div class="row between"><span class="section-title" style="margin:0">OCR</span><span data-confbadge></span></div>
      <div class="muted tiny" style="margin:6px 0">Ön-işleme: gri + kontrast uygulanır; ◐ siyah-beyaz belge modu, ↻ döndürme.</div>
      <button class="btn primary block" data-runocr>🔍 OCR Çalıştır</button>
      <div data-prog></div>
    </div>
    <div data-fields></div>
    <div class="card" style="margin-top:12px">
      <div class="section-title" style="margin:0 0 8px">Belge Bilgisi &amp; İlişkiler</div>
      <form data-form novalidate>
        <div class="formgrid2">${fSelect("Belge Türü", "category", DOC_TYPES, "Akaryakıt Fişi", { empty: false })}${fDate("Tarih", "date", todayStr())}</div>
        <div class="formgrid2">${fText("Belge / Fiş No", "doc_no", "")}${fDate("Bitiş Tarihi (varsa)", "expiry_date", "", false)}</div>
        ${fSelect(
          "Müşteri",
          "customer_id",
          customersL.map((c) => ({ v: c.id, t: c.name })),
          "",
        )}
        <div class="formgrid2">${fSelect(
          "Şantiye",
          "site_id",
          sitesL.map((c) => ({ v: c.id, t: c.name })),
          "",
        )}${fSelect(
          "Araç",
          "vehicle_id",
          vehiclesL.map((c) => ({ v: c.id, t: c.name })),
          "",
        )}</div>
        ${fSelect(
          "Personel",
          "personnel_id",
          personnelL.map((c) => ({ v: c.id, t: c.name })),
          "",
        )}
        ${fArea("Açıklama", "description", "")}
      </form>
    </div>
    <div class="actionbar"><button class="btn primary" data-save>💾 Belgeyi Kaydet</button></div>`;

  const pagesEl = qs("[data-pages]", root);
  const renderPages = () => {
    pagesEl.innerHTML = "";
    pages.forEach((p, i) => {
      const w = document.createElement("div");
      w.style.cssText = "position:relative;width:92px";
      w.innerHTML = `<img src="${p.url}" style="width:92px;height:92px;object-fit:cover;border-radius:10px;border:1px solid var(--border)">
        <div class="row" style="gap:3px;margin-top:4px">
          <button class="btn sm ghost" data-rot="${i}" title="Döndür">↻</button>
          <button class="btn sm ghost ${p.bw ? "primary" : ""}" data-bw="${i}" title="S/B">◐</button>
          <button class="btn sm ghost" data-rm="${i}" title="Sil">✕</button>
        </div>`;
      pagesEl.appendChild(w);
    });
    qs("[data-ocrcard]", root).hidden = pages.length === 0;
  };
  const addFiles = async (files) => {
    for (const f of files) {
      if (!(f.type || "").startsWith("image/")) {
        toast("Yalnız görsel dosyası (PDF OCR desteklenmez)", "err");
        continue;
      }
      let blob = f;
      try {
        if (ocrMod) {
          const pp = await ocrMod.preprocessImage(f, {});
          blob = pp.blob;
        }
      } catch (e) {
        /* ham dosyayla devam */
      }
      pages.push({
        orig: f,
        blob,
        rotate: 0,
        bw: false,
        url: URL.createObjectURL(blob),
      });
    }
    ocrDone = false;
    ocrText = "";
    renderPages();
  };
  pagesEl.addEventListener("click", async (e) => {
    const r = e.target.closest("[data-rot]"),
      b = e.target.closest("[data-bw]"),
      x = e.target.closest("[data-rm]");
    if (x) {
      URL.revokeObjectURL(pages[+x.dataset.rm].url);
      pages.splice(+x.dataset.rm, 1);
      renderPages();
      return;
    }
    if (r || b) {
      const i = +(r ? r.dataset.rot : b.dataset.bw);
      const p = pages[i];
      if (r) p.rotate = (p.rotate + 90) % 360;
      if (b) p.bw = !p.bw;
      try {
        if (ocrMod) {
          const pp = await ocrMod.preprocessImage(p.orig, {
            rotate: p.rotate,
            bw: p.bw,
          });
          URL.revokeObjectURL(p.url);
          p.blob = pp.blob;
          p.url = URL.createObjectURL(pp.blob);
        }
      } catch (err) {
        toast("İşlenemedi: " + (err.message || err), "err");
      }
      ocrDone = false;
      renderPages();
    }
  });
  qs("[data-cam]", root).addEventListener("click", () =>
    qs("[data-camin]", root).click(),
  );
  qs("[data-gal]", root).addEventListener("click", () =>
    qs("[data-galin]", root).click(),
  );
  qs("[data-camin]", root).addEventListener("change", (e) =>
    addFiles([...e.target.files]),
  );
  qs("[data-galin]", root).addEventListener("change", (e) =>
    addFiles([...e.target.files]),
  );

  qs("[data-runocr]", root).addEventListener("click", async () => {
    if (!pages.length) return;
    if (!ocrMod) {
      toast("OCR modülü yüklenemedi", "err");
      return;
    }
    const prog = qs("[data-prog]", root);
    prog.innerHTML =
      '<div class="muted small" style="margin-top:8px">OCR çalışıyor (ilk seferde model indirilir)… <span data-pct>0</span>%</div>';
    try {
      let text = "",
        confSum = 0,
        n = 0;
      for (const p of pages) {
        const r = await ocrMod.runOcr(p.blob, (st, pr) => {
          const e = qs("[data-pct]", prog);
          if (e) e.textContent = String(Math.round((pr || 0) * 100));
        });
        text += (text ? "\n\n" : "") + r.text;
        confSum += r.confidence;
        n++;
      }
      ocrText = text;
      ocrConf = n ? confSum / n : 0;
      ocrDone = true;
      prog.innerHTML =
        '<div class="notice ok" style="margin-top:8px"><span>✓</span><span>OCR tamam — alan önerileri aşağıda. KAYDETMEDEN ÖNCE KONTROL EDİN.</span></div>';
      renderFieldSuggestions();
    } catch (e) {
      prog.innerHTML = "";
      toast(
        "OCR çalışamadı: " +
          (e.message || e) +
          " — belge OCR olmadan kaydedilebilir (BEKLİYOR)",
        "err",
      );
    }
  });

  const FIELD_LABELS = {
    date: "Tarih",
    total: "Toplam ₺",
    liters: "Litre",
    unit_price: "Birim Fiyat ₺",
    plate: "Plaka",
    doc_no: "Fiş/Belge No",
    firma: "Firma",
    tax_no: "Vergi No",
    subtotal: "Ara Toplam ₺",
    kdv: "KDV ₺",
    gross: "Brüt",
    tare: "Dara",
    net: "Net",
    material: "Malzeme",
    fuel_type: "Yakıt Türü",
    date_start: "Başlangıç",
    date_end: "Bitiş",
    category_suggestion: "Kategori Önerisi",
  };
  function renderFieldSuggestions() {
    const cat = qs("select[name=category]", root).value;
    const ext = ocrMod.extractFields(cat, ocrText, ocrConf);
    const keys = Object.keys(ext.fields);
    qs("[data-confbadge]", root).innerHTML = badge(
      "Güven: " + ext.conf + (ocrConf ? " %" + Math.round(ocrConf) : ""),
      ext.conf === "Yüksek" ? "ok" : ext.conf === "Orta" ? "warn" : "danger",
    );
    const missingHtml = ext.missing.length
      ? `<div class="notice warn" style="margin-top:8px"><span>⚠</span><span>KONTROL GEREKLİ — okunamayan alanlar: ${ext.missing.map((k) => FIELD_LABELS[k] || k).join(", ")}</span></div>`
      : "";
    qs("[data-fields]", root).innerHTML =
      `<div class="card" style="margin-top:12px">
      <div class="section-title" style="margin:0 0 8px">Alan Önerileri (düzenleyip onaylayın)</div>
      ${missingHtml}
      ${(ext.checks || []).map((c) => `<div class="notice ${c.level === "error" ? "danger" : "warn"}" style="margin-top:8px"><span>${c.level === "error" ? "⛔" : "⚠"}</span><span>${esc(c.text)}</span></div>`).join("")}
      <div class="formgrid2">${keys.map((k) => `<div class="field"><label>${esc(FIELD_LABELS[k] || k)}</label><input data-ofield="${esc(k)}" value="${esc(String(ext.fields[k]))}"></div>`).join("")}</div>
      ${ocrText ? `<details style="margin-top:6px"><summary class="muted small">Ham OCR metni</summary><div class="tiny muted" style="white-space:pre-wrap;margin-top:6px">${esc(ocrText.slice(0, 1200))}</div></details>` : ""}
    </div>`;
    if (ext.fields.date) qs("input[name=date]", root).value = ext.fields.date;
    if (ext.fields.doc_no)
      qs("input[name=doc_no]", root).value = String(ext.fields.doc_no);
    if (ext.fields.date_end || ext.fields.date_start)
      qs("input[name=expiry_date]", root).value =
        ext.fields.date_end || ext.fields.date_start || "";
    if (ext.fields.plate && !qs("select[name=vehicle_id]", root).value) {
      const p = String(ext.fields.plate).toUpperCase().replace(/\s+/g, "");
      const hit = vehiclesL.find((v) => {
        const n2 = String(v.name).toUpperCase().replace(/\s+/g, "");
        return n2.includes(p) || p.includes(n2);
      });
      if (hit) qs("select[name=vehicle_id]", root).value = hit.id;
    }
  }
  qs("select[name=category]", root).addEventListener("change", () => {
    if (ocrDone) renderFieldSuggestions();
  });

  qs("[data-save]", root).addEventListener("click", async () => {
    if (!pages.length) {
      toast("Önce belge görüntüsü ekleyin", "err");
      return;
    }
    const val = collectForm(qs("[data-form]", root));
    const confirmed = {};
    for (const e of qsa("[data-ofield]", root)) {
      let v = e.value.trim();
      if (
        [
          "total",
          "liters",
          "unit_price",
          "subtotal",
          "kdv",
          "gross",
          "tare",
          "net",
        ].includes(e.dataset.ofield)
      )
        v = ocrMod.parseTrNum(v);
      if (v !== "" && v != null) confirmed[e.dataset.ofield] = v;
    }
    const ocr = ocrDone
      ? {
          status: "TAMAM",
          confidence: Math.round(ocrConf),
          fields: confirmed,
          confirmed_fields: confirmed,
          searchable_text: ocrText.slice(0, 6000),
          ran_at: new Date().toISOString(),
        }
      : { status: "BEKLIYOR" };
    const created = await db.saveNew(
      "documents",
      {
        date: val.date,
        category: val.category,
        customer_id: val.customer_id || null,
        site_id: val.site_id || null,
        vehicle_id: val.vehicle_id || null,
        personnel_id: val.personnel_id || null,
        doc_no: val.doc_no || "",
        expiry_date: val.expiry_date || null,
        description: val.description || "",
        ocr,
      },
      ocrDone ? "Taranmış belge + OCR" : "Taranmış belge (OCR bekliyor)",
    );
    for (const p of pages) {
      const orig = await db.addAttachment("document", created.id, p.orig, {
        kind: "scan_original",
      });
      if (p.blob && p.blob !== p.orig)
        await db.addAttachment(
          "document",
          created.id,
          new File([p.blob], "tarama.jpg", { type: "image/jpeg" }),
          { kind: "scan_derived", derived_of: orig.id },
        );
    }
    toast(
      ocrDone
        ? "Belge + OCR kaydedildi"
        : "Belge kaydedildi — OCR BEKLİYOR (sonra tekrar deneyin)",
      "ok",
    );
    go("#/belgeler/" + created.id);
  });
}

// ============ GLOBAL ARAMA (§42) ============
async function globalSearch(ctx) {
  const { root, db, names, query } = ctx;
  const q = query.q || "";
  root.innerHTML =
    appbar("Global Arama", "Müşteri, araç, fiş no, belge, OCR metni…") +
    `
    <div style="height:10px"></div>${searchBar("Her yerde ara…", q)}<div data-res style="margin-top:10px"></div>`;
  const resEl = qs("[data-res]", root);
  const run = async () => {
    const qq = (qs("[data-search]", root).value || "").trim();
    if (qq.length < 2) {
      resEl.innerHTML = emptyState("🔎", "En az 2 harf yazın");
      return;
    }
    const data = {};
    for (const s of [
      "customers",
      "sites",
      "vehicles",
      "personnel",
      "work_records",
      "slips",
      "quotes",
      "hakedis",
      "documents",
      "expense_records",
      "cash_records",
    ])
      data[s] = await db.getAll(s);
    const hit = (arr, fn) => arr.filter(isActive).filter(fn).slice(0, 8);
    const groups = [
      [
        "🏢 Müşteriler",
        hit(data.customers, (r) =>
          matchSearch(`${r.name} ${r.contact || ""} ${r.phone || ""}`, qq),
        ).map((r) => ({
          href: "#/musteriler/" + r.id,
          t1: r.name,
          t2: r.phone || "",
        })),
      ],
      [
        "📍 Şantiyeler",
        hit(data.sites, (r) =>
          matchSearch(`${r.name} ${r.address || ""}`, qq),
        ).map((r) => ({
          href: "#/santiyeler/" + r.id + "/edit",
          t1: r.name,
          t2: names.customers[r.customer_id] || "",
        })),
      ],
      [
        "🚜 Araç / Makine",
        hit(data.vehicles, (r) => matchSearch(r.name, qq)).map((r) => ({
          href: "#/filo/" + r.id,
          t1: r.name,
          t2: r.ownership || "",
        })),
      ],
      [
        "👷 Personel",
        hit(data.personnel, (r) => matchSearch(r.name, qq)).map((r) => ({
          href: "#/personel/" + r.id,
          t1: r.name,
          t2: r.role || "",
        })),
      ],
      [
        "⚒ İşler",
        hit(data.work_records, (r) =>
          matchSearch(
            `${r.work_type || ""} ${r.description || ""} ${r.material || ""}`,
            qq,
          ),
        ).map((r) => ({
          href: "#/isler/" + r.id,
          t1: `${r.work_type || "İş"} · ${fmtNum(r.quantity)} ${r.unit || ""}`,
          t2: `${trDate(r.date)} · ${names.customers[r.customer_id] || ""}`,
        })),
      ],
      [
        "🧾 Fişler",
        hit(data.slips, (r) =>
          matchSearch(
            String(r.slip_no || "").padStart(6, "0") +
              " " +
              (r.work_text || "") +
              " " +
              (r.plate || ""),
            qq.replace(/^#/, ""),
          ),
        ).map((r) => ({
          href: "#/fisler/" + r.id,
          t1: "#" + String(r.slip_no).padStart(6, "0"),
          t2: `${trDate(r.date)} · ${r.work_text || ""}`,
        })),
      ],
      [
        "📄 Teklifler",
        hit(data.quotes, (r) =>
          matchSearch(
            String(r.quote_no || "").padStart(4, "0"),
            qq.replace(/^#/, ""),
          ),
        ).map((r) => ({
          href: "#/teklif/" + r.id,
          t1: "Teklif #" + String(r.quote_no).padStart(4, "0"),
          t2: trDate(r.date),
        })),
      ],
      [
        "📑 Hakedişler",
        hit(data.hakedis, (r) =>
          matchSearch(
            String(r.hakedis_no || "").padStart(6, "0"),
            qq.replace(/^#/, ""),
          ),
        ).map((r) => ({
          href: "#/hakedis/" + r.id,
          t1: "Hakediş #" + String(r.hakedis_no).padStart(6, "0"),
          t2: fmtTL(r.grand_total) + " ₺",
        })),
      ],
      [
        "🗂 Belgeler (OCR dahil)",
        hit(data.documents, (r) =>
          matchSearch(
            `${r.category || ""} ${r.doc_no || ""} ${r.description || ""} ${(r.ocr && r.ocr.searchable_text) || ""}`,
            qq,
          ),
        ).map((r) => ({
          href: "#/belgeler/" + r.id,
          t1: r.category || "Belge",
          t2: `${trDate(r.date)}${r.doc_no ? " · #" + r.doc_no : ""}`,
        })),
      ],
      [
        "💸 Giderler",
        hit(data.expense_records, (r) =>
          matchSearch(
            `${r.category || ""} ${r.company || ""} ${r.description || ""}`,
            qq,
          ),
        ).map((r) => ({
          href: "#/gider",
          t1: `${r.category || ""} · ${fmtTL(r.amount)} ₺`,
          t2: trDate(r.date),
        })),
      ],
      [
        "💰 Kasa",
        hit(data.cash_records, (r) =>
          matchSearch(`${r.cash_type || ""} ${r.description || ""}`, qq),
        ).map((r) => ({
          href: "#/kasa",
          t1: `${r.cash_type || ""} · ${fmtTL(r.amount)} ₺`,
          t2: trDate(r.date),
        })),
      ],
    ];
    const html = groups
      .filter(([, rows]) => rows.length)
      .map(
        ([title, rows]) =>
          `<div class="section-title">${title}</div>` +
          rows
            .map((r) =>
              li({ ic: "›", href: r.href, t1: esc(r.t1), t2: esc(r.t2) }),
            )
            .join(""),
      )
      .join("");
    resEl.innerHTML = html || emptyState("🔎", "Sonuç yok");
  };
  let st;
  const inp = qs("[data-search]", root);
  inp.addEventListener("input", () => {
    clearTimeout(st);
    st = setTimeout(run, 350);
  });
  if (q) {
    inp.value = q;
    run();
  }
  setTimeout(() => inp.focus(), 250);
}

// ============ AYARLAR: YEDEK / RESTORE / ALIAS / TARİFE / PIN / SİSTEM (§45–§50) ============
const STORE_LABELS = {
  customers: "Müşteriler",
  sites: "Şantiyeler",
  vehicles: "Araç/Makine",
  personnel: "Personel",
  work_records: "İş Kayıtları",
  fuel_records: "Yakıt",
  fuel_tank_movements: "Depo Tank",
  expense_records: "Giderler",
  maintenance_records: "Bakım/Arıza",
  cash_records: "Kasa",
  personnel_events: "Personel Hareketleri",
  documents: "Belgeler",
  slips: "Dijital Fişler",
  quotes: "Teklifler",
  price_book: "Fiyat Listesi",
  hakedis: "Hakedişler",
  cari_movements: "Cari",
  contractors: "Taşeronlar",
  aliases: "Aliaslar",
  audit_log: "İşlem Geçmişi",
};
const STORE_CSV = {
  work_records: "is_kayitlari",
  fuel_records: "yakit",
  fuel_tank_movements: "depo_tank",
  expense_records: "giderler",
  maintenance_records: "bakim_ariza",
  cash_records: "kasa",
  personnel_events: "personel_hareketleri",
  customers: "musteriler",
  sites: "santiyeler",
  vehicles: "arac_makine",
  personnel: "personel",
  slips: "dijital_fisler",
  quotes: "teklifler",
  hakedis: "hakedisler",
  cari_movements: "cari",
  documents: "belgeler",
  price_book: "fiyat_listesi",
  contractors: "taseronlar",
};
function tsName() {
  const d = new Date();
  const p = (x) => String(x).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

export async function doBackup(ctx) {
  const sec = await import("./security.js");
  if (!(await sec.reauth("Yedek alma (tüm kayıtlar dışarı çıkar)"))) return;
  await sec.secLog("backup", "Yedek alındı");
  const { fullBackup } = await import("./backup.js");
  const pw = (await ctx.db.metaGet("backup_pw")) || "";
  const hasDriverLinks = ((await ctx.db.metaGet("driver_links")) || []).length > 0;
  if (hasDriverLinks && pw.length < 10) {
    toast("Şoför bağlantılarını tam yedeklemek için Yedek Şifresi bölümünden en az 10 karakterli şifre belirleyin.", "err");
    return;
  }
  const backup = await fullBackup(ctx.db, { includeDriverSecrets: hasDriverLinks });
  const { encodeBackup } = await import("./backup-crypt.js");
  const bytes = await encodeBackup(backup, pw);
  const name = `SAHAPRO_YEDEK_${tsName()}${pw ? "_SIFRELI" : ""}.sahapro`;
  const how = await shareOrDownload(
    new Blob([bytes], { type: "application/octet-stream" }),
    name,
    "SAHAPRO yedek",
  );
  if (how === "aborted") {
    toast("Yedek paylaşımı iptal edildi — yedek kaydedilmedi", "warn");
    return name;
  }
  await ctx.db.metaSet("last_backup_at", new Date().toISOString());
  toast(
    how === "shared"
      ? "Yedek paylaşıldı — WhatsApp/Drive'a gönderdiğinizden emin olun"
      : "Yedek indirildi — dosyayı telefonun dışına (Drive/e-posta) da kopyalayın",
    "ok",
  );
  return name;
}
async function doCsvZip(ctx) {
  const db = ctx.db;
  const data = await db.dumpAll();
  const enc = new TextEncoder();
  const bom = "﻿";
  const files = [];
  for (const [store, base] of Object.entries(STORE_CSV)) {
    const rows = data[store] || [];
    if (!rows.length) continue;
    const keys = [...new Set(rows.flatMap((r) => Object.keys(r)))].filter(
      (k) => k !== "raw_message",
    );
    const csvRows = rows.map((r) =>
      keys.map((k) => {
        const v = r[k];
        return v == null ? "" : typeof v === "object" ? JSON.stringify(v) : v;
      }),
    );
    files.push({
      name: base + ".csv",
      data: enc.encode(bom + toCSV(keys, csvRows)),
    });
  }
  const zip = buildZip(files);
  const name = `SAHAPRO-SOLO-CSV-${tsName()}.zip`;
  downloadBlob(new Blob([zip], { type: "application/zip" }), name);
  toast("CSV paketi indirildi", "ok");
  return name;
}
async function doFullZip(ctx) {
  const db = ctx.db;
  const data = await db.dumpAll();
  const installId = await db.metaGet("device_install_id");
  const enc = new TextEncoder();
  const files = [
    {
      name: `SAHAPRO-SOLO-BACKUP-${tsName()}.json`,
      data: enc.encode(JSON.stringify(buildBackup(data, installId || ""))),
    },
  ];
  const atts = await db.getAll("attachments");
  let total = 0;
  for (const a of atts) total += a.size || 0;
  let attCount = 0;
  if (total < 60 * 1024 * 1024) {
    for (const a of atts) {
      try {
        files.push({
          name: `ekler/${a.record_type}_${a.record_id}_${(a.name || "ek").replace(/[^\w.-]+/g, "_")}`,
          data: new Uint8Array(await a.blob.arrayBuffer()),
        });
        attCount++;
      } catch (e) {
        /* atla */
      }
    }
  }
  const zip = buildZip(files);
  const name = `SAHAPRO-SOLO-PAKET-${tsName()}.zip`;
  downloadBlob(new Blob([zip], { type: "application/zip" }), name);
  await db.metaSet("last_backup_at", new Date().toISOString());
  toast(
    attCount
      ? `ZIP indirildi (${attCount} ek dahil)`
      : "ZIP indirildi (ekler boyut sınırı nedeniyle hariç)",
    "ok",
  );
  return name;
}

async function settings(ctx) {
  const { root, db } = ctx;
  const lastBackup = await db.metaGet("last_backup_at");
  const kdv = await db.metaGet("kdv_default");
  const craneFirst = await db.metaGet("crane_first_hour");
  const craneNext = await db.metaGet("crane_next_hour");
  const pinSet = !!(await db.metaGet("pin_hash"));
  const vehiclesL = await db.listActive("vehicles");
  const vehName = {};
  for (const v of vehiclesL) vehName[v.id] = v.name;
  const aliases = (await db.getAll("aliases"))
    .filter(isActive)
    .sort((a, b) =>
      String(a.alias || "").localeCompare(String(b.alias || ""), "tr"),
    );
  let recCount = 0;
  const data = await db.dumpAll();
  for (const s of ENTITY_STORES)
    recCount += (data[s] || []).filter(isActive).length;
  const atts = await db.getAll("attachments");
  const attBytes = atts.reduce((s, a) => s + (a.size || 0), 0);
  const bigAtts = atts.filter((a) => a.kind !== "signature" && /^image\//.test(a.type || "") && (a.size || 0) >= 350 * 1024).length;
  let est = null;
  try {
    est = await (navigator.storage && navigator.storage.estimate
      ? navigator.storage.estimate()
      : null);
  } catch (e) {
    est = null;
  }
  const mb = (b) => (b / 1048576).toFixed(1) + " MB";
  let persisted = false;
  try {
    persisted = !!(await navigator.storage?.persisted?.());
  } catch (e) {
    persisted = false;
  }

  const company = (await db.metaGet("company_profile")) || {};
  const backupPw = !!(await db.metaGet("backup_pw"));
  const CO = { title: "Ticari ünvan", tax_no: "Vergi no", tax_office: "Vergi dairesi", mersis_no: "MERSİS no", trade_reg_no: "Ticaret sicil no", nace: "Faaliyet kodu (NACE)", address: "Adres" };
  root.innerHTML =
    appbar("Ayarlar", APP_VERSION + " · şema v" + SCHEMA_VERSION) +
    `
    <div style="height:10px"></div>
    <div class="card"><div class="row between"><span class="small">Sürüm: <b>${esc(APP_VERSION)}</b></span><button class="btn sm" data-swcheck>🔄 Güncellemeyi denetle</button></div><div class="tiny muted" data-swinfo></div></div>
    <div class="section-title">🏢 Şirket bilgileri</div>
    <div class="card"><div class="tiny muted" style="margin-bottom:6px">Vergi levhası, faaliyet belgesi, sicil gazetesi gibi şirket evrakını Akıllı Asistan'a fotoğrafla gönderin; buradaki bilgiler belgeden doldurulur. Elle de düzeltebilirsiniz.</div>
      <form data-coform>${Object.entries(CO).map(([k, t]) => `<div class="field"><label>${esc(t)}</label><input name="${k}" value="${esc(company[k] || "")}"></div>`).join("")}<button type="submit" class="btn block">Şirket bilgilerini kaydet</button></form></div>
    <div class="section-title">Yedekleme</div>
    <div class="card">
      ${kv("Son yedek", lastBackup ? new Date(lastBackup).toLocaleString("tr-TR") + " (" + (backupAgeDays(lastBackup) === 0 ? "bugün" : backupAgeDays(lastBackup) + " gün önce") + ")" : "Hiç yedek yok")}
      ${kv("Yedek şifresi", backupPw ? "🔒 Açık — yedek dosyası şifreli" : "Kapalı — dosyayı bulan açabilir")}
      <button class="btn sm block" data-bakpw style="margin:6px 0">${backupPw ? "🔒 Yedek şifresini değiştir / kaldır" : "🔒 Yedeğe şifre koy"}</button>
      ${kv("Kalıcı depolama", persisted ? "Korumalı ✓" : "Korumasız — tarayıcı yer açarken silebilir; düzenli yedek alın")}
      <div class="row" style="gap:8px;margin-top:10px">
        <button class="btn primary grow" data-bak>💾 Yedek al</button>
        <button class="btn grow" data-csv>📑 CSV Paket</button>
        <button class="btn grow" data-zip>📦 Tam ZIP</button>
      </div>
      <div class="muted tiny" style="margin-top:8px">Tam ZIP: JSON + ekler (fotoğraflar). JSON'a fotoğraf GÖMÜLMEZ.</div>
    </div>
    <div class="section-title">Kart Düzeni</div>
    <div class="card tap" data-go="#/tahsilat"><div class="row between"><span>💰 Tahsilat takibi (kim kaç gündür borçlu, WhatsApp hatırlatma, çek/senet vadeleri)</span><span class="muted small">›</span></div></div>
    <div class="card tap" data-go="#/mazot-hesaplari"><div class="row between"><span>⛽ Mazotla ödeme hesapları (ör. Kılıç: sefer başı 75 L)</span><span class="muted small">›</span></div></div>
    <div class="card tap" data-go="#/kendi-depo"><div class="row between"><span>🏗 Kendi depo / stok sahası (moloz, çöp, hafriyat stoku)</span><span class="muted small">›</span></div></div>
    <div class="card tap" data-go="#/kime-kontrol"><div class="row between"><span>🔎 Kime çalışıldı? (Kuyucu / Aydın gibi benzer adlı müşterilerin işleri)</span><span class="muted small">›</span></div></div>
    <div class="card tap" data-go="#/kart-birlestir"><div class="row between"><span>🔗 Kartları birleştir (aynı müşteri, aynı plaka, aynı personel iki kart olmuşsa)</span><span class="muted small">›</span></div></div>
    <div class="section-title">Yapay Zeka (deneysel)</div>
    <div class="card tap" data-go="#/yapay-zeka"><div class="row between"><span>🤖 Telefonda çalışan ücretsiz model — indir ve dene</span><span class="muted small">›</span></div></div>
    <div class="section-title">Geri Yükleme</div>
    <div class="card">
      <div class="field"><label>Yedek dosyası (.sahapro ya da eski .json)</label><input type="file" data-restore></div>
      <div data-restoreview></div>
    </div>
    <div class="section-title">Alias Listesi (WhatsApp/sesli komut)</div>
    <div class="card">
      ${aliases.length ? aliases.map((a) => `<div class="row between" style="padding:6px 0;border-bottom:1px solid var(--border)"><span class="small"><b>${esc(a.alias || "")}</b> → ${esc(vehName[a.target_id] || a.target_id || "")}</span><button class="btn sm ghost" data-aldel="${a.id}">✕</button></div>`).join("") : '<div class="muted small">Alias yok</div>'}
      <div class="formgrid2" style="margin-top:10px"><div class="field"><label>Yazım</label><input data-alkey placeholder="ör. mini kato"></div><div class="field"><label>Hedef</label><input data-altarget placeholder="ör. U55"></div></div>
      <button class="btn block" data-aladd>+ Alias Ekle</button>
    </div>
    <div class="section-title">Finans Ayarları</div>
    <div class="card">
      <div class="formgrid2">
        ${fNum("Varsayılan KDV %", "kdv", kdv ?? 20)}
        ${fNum("Vinç İlk Saat ₺", "crane_first", craneFirst ?? 9000)}
      </div>
      ${fNum("Vinç Sonraki Saat ₺", "crane_next", craneNext ?? 3000)}
      <button class="btn block" data-finset>Tarifeyi Kaydet</button>
      <div class="muted tiny" style="margin-top:8px">Kesinleşmiş belgeler (hakediş snapshot) bu değişiklikten ETKİLENMEZ.</div>
    </div>
    <div class="section-title">Kilit ve Güvenlik</div>
    <div class="card tap" data-go="#/guvenlik"><div class="row between"><span>🛡 Yönetici kilidi, parmak izi / Face ID, şoför bağlantıları, güvenlik günlüğü</span><span class="muted">›</span></div></div>
    <div class="section-title">Sistem Durumu</div>
    <div class="card">
      ${kv("Kayıt (aktif)", fmtNum(recCount))}
      ${kv("Ek / Fotoğraf", `${atts.length} adet · ${mb(attBytes)}`)}
      ${bigAtts ? `<button class="btn block" style="margin:6px 0" data-shrink>🗜 ${bigAtts} büyük fotoğrafı küçült (yer açar, yedek küçülür)</button><div class="tiny muted" data-shrinkinfo>Yeni fotoğraflar zaten küçültülerek kaydediliyor. Fiş yazısı okunur kalır; imza ve PDF'lere dokunulmaz.</div>` : ""}
      ${kv("Cihaz Depolama", est ? `${mb(est.usage || 0)} / ${est.quota ? mb(est.quota) : "—"}` : "—")}
      ${kv("Sürüm", APP_VERSION + " · şema v" + SCHEMA_VERSION)}
      <button class="btn ghost block" style="margin-top:8px" data-go="#/cop">🗑 Çöp Kutusu</button>
    </div>`;

  qs("[data-bak]", root).addEventListener("click", () => doBackup(ctx));
  qs("[data-shrink]", root)?.addEventListener("click", async (ev) => {
    const b = ev.currentTarget;
    if (!(await confirmDialog("Fotoğraflar küçültülsün mü?", "Büyük fotoğraflar 1600 piksele (belgeler 2000) küçültülür. Fiş yazısı okunur kalır ama orijinal büyük hali geri gelmez. İsterseniz önce yedek alın.", "Küçült"))) return;
    const info = qs("[data-shrinkinfo]", root);
    b.disabled = true;
    try {
      const r = await db.shrinkAllAttachments((i, n) => { info.textContent = `${i} / ${n} fotoğraf…`; });
      toast(`${r.count} fotoğraf küçültüldü · ${mb(r.before - r.after)} yer açıldı`, "ok");
      ctx.reload();
    } catch (e) { toast("Küçültülemedi: " + (e.message || e), "err"); b.disabled = false; }
  });
  qs("[data-bakpw]", root)?.addEventListener("click", async () => {
    const pw = await promptDialog(backupPw ? "Yedek şifresi" : "Yedeğe şifre koy", backupPw ? "Yeni şifre (boş bırakıp Tamam = şifreyi kaldır)" : "Şifre (en az 10 karakter)", "", { type: "password", hint: "ÖNEMLİ: Bu şifreyi bir yere yazın. Telefon kaybolursa yedeği ancak bu şifreyle açabilirsiniz; şifre unutulursa yedek AÇILAMAZ." });
    if (pw === null && backupPw) {
      if (await confirmDialog("Şifre kaldırılsın mı?", "Bundan sonraki yedekler şifresiz (yalnız sıkıştırılmış) olur.", "Kaldır", true)) { await db.metaSet("backup_pw", null); toast("Yedek şifresi kaldırıldı", "ok"); ctx.reload(); }
      return;
    }
    if (!pw) return;
    if (pw.length < 10) return toast("Şifre en az 10 karakter olmalı", "err");
    const again = await promptDialog("Şifreyi tekrar yazın", "Şifre (tekrar)", "", { type: "password" });
    if (again !== pw) return toast("Şifreler aynı değil", "err");
    await db.metaSet("backup_pw", pw);
    toast("Yedek şifresi kondu — sonraki yedekler şifreli", "ok"); ctx.reload();
  });
  qs("[data-coform]", root)?.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const fd = new FormData(ev.currentTarget), upd = {};
    for (const k of Object.keys(CO)) upd[k] = String(fd.get(k) || "").trim() || null;
    await db.metaSet("company_profile", { ...((await db.metaGet("company_profile")) || {}), ...upd });
    toast("Şirket bilgileri kaydedildi", "ok");
  });
  qs("[data-swcheck]", root)?.addEventListener("click", async (ev) => {
    const b = ev.currentTarget, info = qs("[data-swinfo]", root);
    b.disabled = true; info.textContent = "Denetleniyor…";
    try {
      const found = window.__swCheck ? await window.__swCheck() : false;
      info.textContent = found ? "Yeni sürüm bulundu — alttaki/üstteki \"Güncelle\" düğmesine basın (birkaç saniye sürebilir)." : "Bu telefondaki sürüm en yenisi. Yeni güncelleme birleştirildiyse GitHub'ın yayına alması 10 dakikayı bulabilir; sonra tekrar deneyin.";
    } catch (e) { info.textContent = "Denetlenemedi: " + (e.message || e) + " (internet?)"; }
    b.disabled = false;
  });
  qs("[data-csv]", root).addEventListener("click", () => doCsvZip(ctx));
  qs("[data-zip]", root).addEventListener("click", () => doFullZip(ctx));
  qs("[data-restore]", root).addEventListener("change", (e) => {
    const f = e.target.files[0];
    if (f) restorePreview(ctx, f);
  });
  qs("[data-aladd]", root).addEventListener("click", async () => {
    const k = qs("[data-alkey]", root).value.trim().toLocaleLowerCase("tr-TR");
    const t = qs("[data-altarget]", root).value.trim();
    if (!k || !t) {
      toast("Yazım ve hedef girin", "err");
      return;
    }
    const tv =
      vehiclesL.find(
        (v) =>
          String(v.name).toLocaleLowerCase("tr-TR") ===
          t.toLocaleLowerCase("tr-TR"),
      ) ||
      vehiclesL.find((v) =>
        String(v.name)
          .toLocaleLowerCase("tr-TR")
          .includes(t.toLocaleLowerCase("tr-TR")),
      );
    if (!tv) {
      toast("Hedef araç listede bulunamadı: " + t, "err");
      return;
    }
    await db.saveNew(
      "aliases",
      { alias: k, target_type: "vehicle", target_id: tv.id, active: true },
      "Alias eklendi",
    );
    toast("Alias eklendi: " + k + " → " + tv.name, "ok");
    ctx.reload();
  });
  for (const b of qsa("[data-aldel]", root))
    b.addEventListener("click", async () => {
      await db.softDelete("aliases", b.dataset.aldel, "Kullanıcı sildi");
      toast("Alias silindi", "ok");
      ctx.reload();
    });
  qs("[data-finset]", root).addEventListener("click", async () => {
    const val = collectForm(root);
    await db.metaSet("kdv_default", Number(val.kdv) || 20);
    await db.metaSet("crane_first_hour", Number(val.crane_first) || 9000);
    await db.metaSet("crane_next_hour", Number(val.crane_next) || 3000);
    toast("Tarife kaydedildi", "ok");
  });
  const pinBtn = qs("[data-pinset]", root);
  if (pinBtn)
    pinBtn.addEventListener("click", async () => {
      const p1 = await promptDialog("PIN Kur", "4-8 haneli PIN");
      if (p1 == null) return;
      if (!/^\d{4,8}$/.test(p1.trim())) {
        toast("4-8 haneli sayı girin", "err");
        return;
      }
      const p2 = await promptDialog("PIN Doğrula", "PIN tekrar");
      if (p2 == null) return;
      if (p1.trim() !== p2.trim()) {
        toast("PIN’ler uyuşmuyor", "err");
        return;
      }
      const app = await import("./app.js");
      await db.metaSet("pin_hash", app.pinHash(p1.trim()));
      toast("PIN kuruldu — sonraki açılışta sorulur", "ok");
      ctx.reload();
    });
  const pinClr = qs("[data-pinclr]", root);
  if (pinClr)
    pinClr.addEventListener("click", async () => {
      if (
        !(await confirmDialog(
          "PIN kaldırılsın mı?",
          "Uygulama kilidi açılmadan kullanılır.",
          "Kaldır",
          true,
        ))
      )
        return;
      await db.metaSet("pin_hash", null);
      toast("PIN kaldırıldı", "ok");
      ctx.reload();
    });
}

// ---- Restore: önizleme + çakışma politikası (§34/§47) ----
async function restorePreview(ctx, file) {
  const view = qs("[data-restoreview]", ctx.root);
  { const sec = await import("./security.js"); if (!(await sec.reauth("Yedekten geri yükleme"))) return; await sec.secLog("backup", "Yedek geri yükleme açıldı: " + (file?.name || "")); }
  try {
    const { previewBackup, restoreBackup, readBackupFile } = await import("./backup.js"),
      obj = await readBackupFile(file),
      p = await previewBackup(ctx.db, obj);
    view.innerHTML =
      notice(
        "info",
        `${p.added} yeni / ${p.same} aynı / ${p.conflicts} çakışma / ${p.attachments} ek`,
      ) +
      (!Array.isArray(obj.attachments)
        ? notice(
            "warn",
            "Eski JSON yedeği dosyaları ve imzaları içermez. Tam yedek dosyasını tercih edin.",
          )
        : "") +
      '<button class="btn primary block" data-doimport>Yeni Kayıtları Ekle; Çakışanları Koru</button>';
    qs("[data-doimport]", view).onclick = async () => {
      try {
        if (
          !(await confirmDialog(
            "Geri yükle",
            "İşlem öncesinde otomatik kurtarma yedeği alınır; çakışan kayıtlar korunur.",
            "Uygula",
          ))
        )
          return;
        await restoreBackup(ctx.db, obj, false);
        toast("Yedek geri yüklendi", "ok");
        ctx.reload();
      } catch (error) {
        toast(error.message, "err");
      }
    };
  } catch (error) {
    view.innerHTML = notice("danger", error.message);
  }
}

// ============ ÇÖP KUTUSU (§49) ============
async function trash(ctx) {
  const { root, db } = ctx;
  const groups = [];
  for (const s of ENTITY_STORES) {
    if (s === "audit_log") continue;
    const dels = (await db.getAll(s)).filter((r) => r.deleted_at);
    if (dels.length) groups.push({ store: s, rows: dels });
  }
  root.innerHTML =
    appbar("Çöp Kutusu", "Kalıcı silme YOK — geri yükleyin", {
      back: "#/ayarlar",
    }) +
    `
    <div style="height:10px"></div>
    ${
      groups.length
        ? groups
            .map(
              (g) =>
                `<div class="section-title">${STORE_LABELS[g.store] || g.store} (${g.rows.length})</div>` +
                g.rows
                  .map((r) =>
                    li({
                      ic: "🗑",
                      t1: esc(
                        r.name ||
                          r.work_type ||
                          r.category ||
                          r.cash_type ||
                          r.description ||
                          "#" +
                            (r.slip_no || r.quote_no || r.hakedis_no || "") ||
                          r.id.slice(0, 8),
                      ),
                      t2: `${trDate(r.date || r.created_at)} · silindi: ${new Date(r.deleted_at).toLocaleString("tr-TR")}${r.delete_reason ? " · " + esc(r.delete_reason) : ""}`,
                      end: `<button class="btn sm" data-res="${g.store}|${r.id}">Geri Yükle</button>`,
                    }),
                  )
                  .join(""),
            )
            .join("")
        : emptyState("🗑", "Çöp kutusu boş")
    }`;
  root.addEventListener("click", async (e) => {
    const b = e.target.closest("[data-res]");
    if (!b) return;
    const [store, id] = b.dataset.res.split("|");
    await db.restore(store, id);
    toast("Geri yüklendi", "ok");
    ctx.reload();
  });
}
