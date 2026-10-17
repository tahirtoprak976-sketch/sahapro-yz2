import { customerBankReceipt } from "./enterprise-db.js";
import { customerWorkLines } from "./business.js";
// SAHAPRO SOLO — Finans: Teklif · Fiyat Listesi · Hakediş · Cari · Kasa · Gider
import { createCreditBill, findDuplicates } from "./esnaf.js";
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
  fmtTL,
  fmtNum,
  trDate,
  todayStr,
  pagedRender,
  go,
  downloadBlob,
  shareText,
} from "./ui.js";
import { customerStatement, statementText, statementCsv } from "./statement.js";
import {
  isActive,
  matchSearch,
  calcQuoteTotals,
  calcHakedisTotals,
  resolvePrice,
  PRICE_VEHICLE_GROUPS,
  priceVehicleScope,
  cariBalance,
  QUOTE_TYPES,
  PAYMENT_METHODS,
  CASH_TYPES,
  EXPENSE_CATEGORIES,
  REIMBURSEMENT_STATUS,
  WORK_UNITS,
  WORK_TYPES,
  nextCashStatus,
  addDays,
} from "./core.js";

export async function screen(ctx) {
  const sub = ctx.parts[0];
  if (sub === "teklif") return quotes(ctx);
  if (sub === "fiyat") return priceBook(ctx);
  if (sub === "hakedis") return hakedis(ctx);
  if (sub === "cari") return cari(ctx);
  if (sub === "kasa" || sub === "tahsilat") return cash(ctx);
  if (sub === "gider") return expenses(ctx);
  return hub(ctx);
}

function financeCard(value,label,color,route) {
  return `<a class="stat finance-stat ${esc(color)}" href="${esc(route)}" data-go="${esc(route)}" aria-label="${esc(label)} listesini aç"><span class="v">${esc(value)}</span><span class="l">${esc(label)}</span></a>`;
}

// ============ FİNANS HUB ============
async function hub(ctx) {
  const { root, db } = ctx;
  const today = todayStr();
  const from = today.slice(0, 8) + "01";
  const d = await db.dumpAll();
  const { monthlySeries } = await import("./finance-chart.js");
  const cur = monthlySeries(d, { today, months: 1, fuelRefPrice: await db.metaGet("fuel_ref_price") })[0];
  const monthH = cur.work;
  const monthT = cur.collected;
  const monthG = cur.cost;
  const items = [
    ["#/sozlesmeler", "▤", "Sözleşmeler", "şablonlar + imzalar"],
    ["#/teklif-hesap", "🧮", "Teklif Asistanı", "Kaça vermeliyim? Maliyet + geçmiş fiyat"],
    ["#/teklif", "📄", "Teklif", "4 teklif türü + PDF"],
    ["#/hakedis", "📑", "Hakediş", "snapshot + kesinleştirme"],
    ["#/cari", "🏦", "Cari", "müşteri bakiyeleri"],
    ["#/kasa", "💰", "Kasa", "tahsilat akışı"],
    ["#/gider", "💸", "Gider", "fişli takip"],
    ["#/esnaf", "🔧", "Esnaf Hesabı", "usta borçları"],
    ["#/fiyat", "🏷", "Fiyat Listesi", "fiyatlar + vinç tarifesi"],
  ];
  root.innerHTML =
    appbar("Finans", "Bu ay") +
    `
    <div class="statgrid" style="grid-template-columns:repeat(3,1fr);margin-top:10px">
      ${financeCard(fmtTL(monthH), "İş değeri ₺", "accent", "#/cari")}
      ${financeCard(fmtTL(monthT), "Tahsilat ₺", "ok", "#/kasa")}
      ${financeCard(fmtTL(monthG), "Masraf ₺", "warn", "#/gider")}
    </div>
    <div class="card tap" data-go="#/nakit" style="border-left:4px solid var(--accent)"><div class="row between"><span><b>📈 Nakit tahmini</b><br><span class="tiny muted">Önümüzdeki 5 hafta giriş / çıkış — param yetecek mi?</span></span><span class="muted">›</span></div></div>
    <div class="card tap" data-go="#/fatura"><div class="row between"><span><b>🧾 Faturalanacaklar</b><br><span class="tiny muted">Faturası kesilmemiş işler · eLogo'ya girilecek kalemler</span></span><span class="muted">›</span></div></div>
    <div class="card tap" data-go="#/fiyat-saglik"><div class="row between"><span><b>🩺 Fiyat sağlığı</b><br><span class="tiny muted">Hangi müşteride zarar / düşük kâr · zam önerisi</span></span><span class="muted">›</span></div></div>
    <div class="card" style="margin-top:8px"><div class="row between"><span class="muted small">Bu ay tahmini kâr (iş − masraf)</span><span class="strong ${cur.profit < 0 ? "danger" : ""}">${fmtTL(cur.profit)} ₺</span></div>
      <div class="muted tiny">Masraf: gider ${fmtTL(cur.expense)} · yakıt ${fmtTL(cur.fuel)} · bakım ${fmtTL(cur.maint)} · esnaf ${fmtTL(cur.esnaf)}${cur.dump ? ` · döküm ${fmtTL(cur.dump)}` : ""} ₺${cur.unpriced ? ` · ⚠ ${cur.unpriced} işin fiyatı yok` : ""}. Ana sayfa grafiğiyle aynı hesap.</div></div>
    <div class="quickgrid" style="grid-template-columns:repeat(3,1fr);margin-top:10px">
      ${items.map(([h, ic, t, d]) => `<button data-go="${h}" style="aspect-ratio:1.35"><span class="ic">${ic}</span>${t}<span class="tiny muted">${d}</span></button>`).join("")}
    </div>`;
}

// ============ TEKLİF ============
async function quotes(ctx) {
  const sub = ctx.parts[1];
  if (sub === "new") return quoteForm(ctx, null);
  if (sub && ctx.parts[2] === "edit") return quoteForm(ctx, sub);
  if (sub) return quoteDetail(ctx, sub);
  const { root, db, names } = ctx;
  const rows = (await db.getAll("quotes"))
    .filter(isActive)
    .sort((a, b) => (b.quote_no || 0) - (a.quote_no || 0));
  root.innerHTML =
    appbar("Teklifler", `${rows.length} teklif`) +
    `
    <div style="height:10px"></div><div data-list></div>
    <div class="actionbar"><button class="btn primary" data-go="#/teklif-hesap">🧮 Teklif Asistanı</button><button class="btn" data-go="#/teklif/new">+ Boş Teklif</button></div>`;
  const listEl = qs("[data-list]", root);
  if (!rows.length)
    listEl.innerHTML = emptyState(
      "📄",
      "Henüz teklif yok",
      '<button class="btn primary" data-go="#/teklif/new">+ Teklif</button>',
    );
  else
    pagedRender(listEl, rows, (t) => {
      const tot = calcQuoteTotals(t);
      return li({
        ic: "📄",
        href: "#/teklif/" + t.id,
        t1: `#${String(t.quote_no || 0).padStart(4, "0")} · ${esc(names.customers[t.customer_id] || "—")}`,
        t2: `${trDate(t.date)} · ${t.type}`,
        badgeHtml: statusBadge(t.status || "Taslak"),
        end: tot.show_total
          ? `<div class="amt nowrap">${fmtTL(tot.grand)} ₺</div>`
          : `<div class="tiny muted">toplam yok</div>`,
      });
    });
}

function quoteTypeNote(type) {
  if (type === "UNIT_PRICE")
    return "Birim fiyat teklifidir — satır fiyatları toplanmaz, toplam gösterilmez.";
  if (type === "ALTERNATIVE")
    return "Alternatifli teklif — alternatifler birbirine EKLENMEZ.";
  if (type === "LUMP_SUM") return "Götürü bedel — anlaşılan toplam esastır.";
  return "Miktar × birim fiyat üzerinden hesaplanır.";
}

async function quoteForm(ctx, editId) {
  const { root, db } = ctx;
  const [customers, sites] = await Promise.all([
    db.listActive("customers"),
    db.listActive("sites"),
  ]);
  const rec = editId ? await db.get("quotes", editId) : null;
  const v = rec || {
    type: "QUANTITY_BASED",
    items: [{ label: "", unit: "Sefer", quantity: 1, unit_price: "" }],
    kdv_rate: 20,
  };
  let items = JSON.parse(JSON.stringify(v.items || []));

  root.innerHTML =
    appbar(
      editId ? "Teklif Düzenle" : "+ Teklif",
      editId ? "#" + String(rec.quote_no).padStart(4, "0") : "No otomatik",
    ) +
    `
    <form data-form novalidate>
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
      <div class="field"><label>Teklif Türü</label><div class="chiprow" data-types>
        ${QUOTE_TYPES.map((t) => `<button type="button" class="chip ${v.type === t ? "on" : ""}" data-type="${t}">${t}</button>`).join("")}
      </div><div class="hint" data-typenote>${quoteTypeNote(v.type)}</div></div>
      <div class="section-title">Kalemler</div>
      <div data-items></div>
      <button type="button" class="btn ghost sm" data-additem>+ Kalem Ekle</button>
      <div class="formgrid2" style="margin-top:12px">
        ${fNum("KDV %", "kdv_rate", v.kdv_rate ?? 20)}
        <div class="field" data-lump style="display:${v.type === "LUMP_SUM" ? "block" : "none"}"><label>Anlaşılan Toplam (₺)</label><input type="number" name="lump_total" value="${v.lump_total ?? ""}" step="any"></div>
      </div>
      ${fDate("Geçerlilik tarihi", "valid_until", v.valid_until || "", false)}
      ${["contact", "phone", "email", "title", "payment_terms", "maturity", "schedule", "delivery_time", "fuel_terms", "dump_terms"].map((k) => fText({ contact: "Yetkili", phone: "Telefon", email: "E-posta", title: "Teklif başlığı", payment_terms: "Ödeme şartı", maturity: "Vade", schedule: "İş programı", delivery_time: "Teslim süresi", fuel_terms: "Mazot dahil/hariç", dump_terms: "Döküm dahil/hariç" }[k], k, v[k] || "")).join("")}
      ${["scope", "special_terms", "general_terms"].map((k) => fArea({ scope: "İş kapsamı", special_terms: "Özel şartlar", general_terms: "Genel şartlar" }[k], k, v[k] || "")).join("")}
      ${fArea("Notlar (PDF'te görünür)", "notes", v.notes || "")}
      <div data-preview></div>
    </form>
    <div class="actionbar"><button class="btn primary" data-save>Kaydet</button></div>`;

  let type = v.type || "QUANTITY_BASED";
  const itemsEl = qs("[data-items]", root);
  function renderItems() {
    itemsEl.innerHTML = items
      .map(
        (it, i) => `
      <div class="card" style="padding:10px">
        <div class="row" style="gap:6px;margin-bottom:6px">
          <input type="text" class="grow" data-i="${i}" data-k="label" value="${esc(it.label)}" placeholder="Kalem (ör. Hafriyat nakliye)" style="min-height:42px;background:var(--bg2);border:1.5px solid var(--border);border-radius:10px;color:var(--text);padding:8px 10px">
          <button type="button" class="btn sm danger" data-del="${i}">✕</button>
        </div>
        <div class="row" style="gap:6px">
          <select data-i="${i}" data-k="unit" style="flex:1;min-height:42px;background:var(--bg2);border:1.5px solid var(--border);border-radius:10px;color:var(--text)">${WORK_UNITS.map((u) => `<option ${u === it.unit ? "selected" : ""}>${u}</option>`).join("")}</select>
          ${type === "QUANTITY_BASED" ? `<input type="number" data-i="${i}" data-k="quantity" value="${it.quantity}" step="any" placeholder="Miktar" style="width:80px;min-height:42px;background:var(--bg2);border:1.5px solid var(--border);border-radius:10px;color:var(--text);padding:8px">` : ""}
          <input type="number" data-i="${i}" data-k="unit_price" value="${it.unit_price}" step="any" placeholder="Birim ₺" style="width:110px;min-height:42px;background:var(--bg2);border:1.5px solid var(--border);border-radius:10px;color:var(--text);padding:8px">
        </div>
      </div>`,
      )
      .join("");
    preview();
  }
  function preview() {
    const q = {
      type,
      items,
      kdv_rate: Number(qs("input[name=kdv_rate]", root).value) || 0,
      lump_total: Number(qs("input[name=lump_total]", root)?.value) || 0,
    };
    const tot = calcQuoteTotals(q);
    qs("[data-preview]", root).innerHTML = tot.show_total
      ? `<div class="card" style="margin-top:12px">${kv("Ara Toplam", fmtTL(tot.subtotal) + " ₺")}${kv("KDV %" + tot.kdv_rate, fmtTL(tot.kdv) + " ₺")}${kv("<b>GENEL TOPLAM</b>", fmtTL(tot.grand) + " ₺")}</div>`
      : `<div class="notice info" style="margin-top:12px"><span>ℹ</span><span>${quoteTypeNote(type)}</span></div>`;
  }
  qs("[data-types]", root).addEventListener("click", (e) => {
    const b = e.target.closest("[data-type]");
    if (!b) return;
    type = b.dataset.type;
    qsa("[data-type]", root).forEach((x) => x.classList.toggle("on", x === b));
    qs("[data-typenote]", root).textContent = quoteTypeNote(type);
    qs("[data-lump]", root).style.display =
      type === "LUMP_SUM" ? "block" : "none";
    renderItems();
  });
  itemsEl.addEventListener("input", (e) => {
    const t = e.target.closest("[data-i]");
    if (!t) return;
    const i = Number(t.dataset.i),
      k = t.dataset.k;
    items[i][k] = k === "quantity" || k === "unit_price" ? t.value : t.value;
    if (k !== "label") preview();
  });
  itemsEl.addEventListener("click", (e) => {
    const d = e.target.closest("[data-del]");
    if (!d) return;
    items.splice(Number(d.dataset.del), 1);
    renderItems();
  });
  qs("[data-additem]", root).addEventListener("click", () => {
    items.push({ label: "", unit: "Sefer", quantity: 1, unit_price: "" });
    renderItems();
  });
  qs("input[name=kdv_rate]", root).addEventListener("input", preview);
  const lumpEl = qs("input[name=lump_total]", root);
  if (lumpEl) lumpEl.addEventListener("input", preview);
  renderItems();

  qs("[data-save]", root).addEventListener("click", async () => {
    const val = collectForm(qs("[data-form]", root));
    if (!val.customer_id) {
      toast("Müşteri seçin", "err");
      return;
    }
    const clean = items.filter((it) => it.label && it.unit_price !== "");
    if (!clean.length && type !== "LUMP_SUM") {
      toast("En az bir kalem girin", "err");
      return;
    }
    if (type === "LUMP_SUM" && !Number(val.lump_total)) {
      toast("Anlaşılan toplamı girin", "err");
      return;
    }
    const fields = {
      ...Object.fromEntries(
        [
          "valid_until",
          "contact",
          "phone",
          "email",
          "title",
          "payment_terms",
          "maturity",
          "schedule",
          "delivery_time",
          "fuel_terms",
          "dump_terms",
          "scope",
          "special_terms",
          "general_terms",
        ].map((k) => [k, val[k] || ""]),
      ),
      date: val.date,
      customer_id: val.customer_id,
      site_id: val.site_id || null,
      type,
      items: clean.map((it) => ({
        ...it,
        quantity: Number(it.quantity) || 0,
        unit_price: Number(it.unit_price) || 0,
      })),
      kdv_rate: Number(val.kdv_rate) || 0,
      lump_total: Number(val.lump_total) || 0,
      notes: val.notes || "",
    };
    if (editId) {
      await db.saveExisting("quotes", rec, fields, "Teklif düzenlendi");
      toast("Teklif güncellendi", "ok");
      go("#/teklif/" + editId);
    } else {
      const no = await db.nextSeq("quote");
      const created = await db.saveNew("quotes", {
        ...fields,
        quote_no: no,
        status: "Taslak",
      });
      toast("Teklif #" + String(no).padStart(4, "0") + " kaydedildi", "ok");
      go("#/teklif/" + created.id);
    }
  });
}

async function quoteDetail(ctx, id) {
  const { root, db, names } = ctx;
  const t = await db.get("quotes", id);
  if (!t) {
    root.innerHTML = appbar("Teklif") + emptyState("📄", "Teklif yok");
    return;
  }
  const tot = calcQuoteTotals(t);
  root.innerHTML =
    appbar("Teklif #" + String(t.quote_no).padStart(4, "0"), trDate(t.date), {
      right: statusBadge(t.status || "Taslak"),
    }) +
    `
    <div style="height:10px"></div>
    <div class="card">
      ${kv("Müşteri", names.customers[t.customer_id] || "—")}
      ${kv("Şantiye", names.sites[t.site_id] || "—")}
      ${kv("Tür", t.type)}
      <div class="divider"></div>
      ${tot.lines.map((l) => kv(esc(l.label) + (t.type === "QUANTITY_BASED" ? ` (${fmtNum(l.quantity)} ${l.unit})` : ` (${l.unit})`), fmtTL(l.unit_price) + " ₺" + (l.line_total != null ? " = " + fmtTL(l.line_total) + " ₺" : ""))).join("")}
      <div class="divider"></div>
      ${tot.show_total ? kv("Ara Toplam", fmtTL(tot.subtotal) + " ₺") + kv("KDV %" + tot.kdv_rate, fmtTL(tot.kdv) + " ₺") + kv("GENEL TOPLAM", fmtTL(tot.grand) + " ₺") : `<div class="notice info"><span>ℹ</span><span>${quoteTypeNote(t.type)}</span></div>`}
      ${t.notes ? kv("Notlar", t.notes) : ""}
    </div>
    <div class="actionbar">
      <button class="btn primary" data-pdf>PDF</button>
      ${t.status === "Taslak" ? `<button class="btn" data-go="#/teklif/${id}/edit">Düzenle</button>` : ""}
      <button class="btn" data-status>Durum</button><button class="btn" data-revision>Teklif Revizyonu</button><button class="btn" data-go="#/teklif-karsilastir?customer_id=${t.customer_id}">Karşılaştır</button>
      ${t.status === "Kabul" ? '<button class="btn primary" data-contract>Sözleşme Oluştur</button>' : ""}
      ${t.status === "Kabul" || t.status === "Gönderildi" ? '<button class="btn" data-qrules>🏷 Fiyat listesine yaz</button>' : ""}
    </div>`;
  // Kabul edilen teklifin fiyatları fiyat listesine: o müşterinin yeni işleri kendiliğinden fiyatlanır
  const writeRules = async () => {
    const { quoteRules } = await import("./quote-core.js");
    const pr = await import("./price-rule-core.js");
    const rules = quoteRules(t);
    if (!rules.length) return toast("Yazılacak birim fiyat yok (müşteri, birim ve fiyat gerekli)", "err");
    const d0 = await db.dumpAll();
    let n = 0;
    for (const r of rules) {
      const { label, ...rule } = r;
      const old = pr.sameRule(d0, rule);
      if (old) await db.saveExisting("price_book", old, { price: rule.price, kdv_rate: rule.kdv_rate, kdv_included: false }, "Teklif #" + t.quote_no + " kabul");
      else await db.saveNew("price_book", { ...rule, active: true, note: "Teklif #" + t.quote_no + ": " + label }, "Teklif #" + t.quote_no + " kabul");
      n++;
    }
    await db.saveExisting("quotes", await db.get("quotes", t.id), { rules_written_at: new Date().toISOString() }, "Fiyat listesine yazıldı");
    toast(n + " fiyat kuralı yazıldı — yeni işler bu fiyatla gelir", "ok");
  };
  qs("[data-qrules]", root)?.addEventListener("click", async () => {
    if (await confirmDialog("Fiyat listesine yazılsın mı?", `${names.customers[t.customer_id] || "Müşteri"} için teklifteki birim fiyatlar (KDV hariç) fiyat listesine yazılır; aynı kural varsa güncellenir.`, "Yaz")) await writeRules();
  });
  qs("[data-pdf]", root).addEventListener("click", async () => {
    const pdf = await import("./pdf.js");
    await pdf.quotePdf(t, names, tot);
  });
  qs("[data-revision]", root)?.addEventListener("click", async () => {
    const fields = structuredClone(t);
    for (const k of [
      "id",
      "created_at",
      "updated_at",
      "source",
      "deleted_at",
      "schema_version",
    ])
      delete fields[k];
    const revision = await db.saveNew("quotes", {
      ...fields,
      quote_no: await db.nextSeq("quote"),
      status: "Taslak",
      revision_of: t.revision_of || t.id,
      revision_no: (t.revision_no || 1) + 1,
    });
    go("#/teklif/" + revision.id + "/edit");
  });
  qs("[data-contract]", root)?.addEventListener("click", async () => {
    const { contractFromQuote } = await import("./business.js");
    const c = contractFromQuote(t, await db.nextSeq("contract"));
    await db.put("contracts", c);
    go("#/sozlesmeler/" + c.id);
  });
  qs("[data-status]", root).addEventListener("click", () => {
    const sh = sheet(
      `<h3>Teklif Durumu</h3>` +
        ["Taslak", "Gönderildi", "Kabul", "Red", "İptal"]
          .map(
            (s) =>
              `<button class="btn block ${s === t.status ? "primary" : ""}" style="margin-bottom:8px" data-s="${s}">${s}</button>`,
          )
          .join(""),
    );
    sh.addEventListener("click", async (e) => {
      const b = e.target.closest("[data-s]");
      if (!b) return;
      await db.saveExisting(
        "quotes",
        t,
        { status: b.dataset.s, ...(b.dataset.s === "Gönderildi" && !t.sent_at ? { sent_at: new Date().toISOString() } : {}) },
        "Durum: " + b.dataset.s,
      );
      (await import("./ui.js")).sheetClose();
      if (b.dataset.s === "Kabul" && !t.rules_written_at && (await confirmDialog("Teklif kabul edildi 👍", "Teklifteki fiyatlar fiyat listesine yazılsın mı? Bu müşterinin yeni işleri kendiliğinden bu fiyatla gelir.", "Evet, yaz"))) await writeRules();
      ctx.reload();
    });
  });
}

// ============ FİYAT LİSTESİ ============
async function priceBook(ctx) {
  const { root, db, names } = ctx;
  if (ctx.parts[1] === "new" || ctx.parts[2] === "edit")
    return priceForm(ctx, ctx.parts[2] === "edit" ? ctx.parts[1] : null);
  const rows = (await db.getAll("price_book")).filter(isActive);
  const crane = {
    first: await db.metaGet("crane_first_hour"),
    next: await db.metaGet("crane_next_hour"),
  };
  root.innerHTML =
    appbar(
      "Fiyat Listesi",
      "Öncelik: müşteri+şantiye › müşteri › genel › manuel",
    ) +
    `
    <div class="card" style="margin-top:10px">
      <div class="row between"><span class="strong">Vinç tarifesi</span><span class="badge accent">ilk ${fmtTL(crane.first)} ₺ + sonraki ${fmtTL(crane.next)} ₺/saat</span></div>
      <div class="tiny muted" style="margin-top:4px">Ayarlar → Finans bölümünden değiştirilebilir.</div>
    </div>
    <div data-list></div>
    <div class="actionbar"><button class="btn primary" data-go="#/fiyat/new">+ Fiyat Ekle</button></div>`;
  const listEl = qs("[data-list]", root);
  if (!rows.length) listEl.innerHTML = emptyState("🏷", "Fiyat yok");
  else
    listEl.innerHTML = rows
      .map((p) =>
        li({
          ic: "🏷",
          href: `#/fiyat/${p.id}/edit`,
          t1: esc(p.work_type || names.vehicles[p.vehicle_id] || "Genel"),
          t2: `${esc(priceVehicleScope(p, names.vehicles))} · ${p.customer_id ? esc(names.customers[p.customer_id] || "") + " · " : ""}${p.site_id ? esc(names.sites[p.site_id] || "") + " · " : ""}${p.valid_from ? trDate(p.valid_from) + "→" + (p.valid_to ? trDate(p.valid_to) : "∞") : "sürekli"} · KDV %${p.kdv_rate ?? 20}${p.kdv_included ? " dahil" : " +KDV"}`,
          end:
            p.formula === "CRANE_FIRST_HOUR"
              ? '<span class="badge accent">vinç formülü</span>'
              : `<span class="amt nowrap">${fmtTL(p.price)} ₺/${esc(p.unit)}</span>`,
        }),
      )
      .join("");
}

async function priceForm(ctx, editId) {
  const { root, db, query = {} } = ctx;
  const [customers, sites, vehicles] = await Promise.all([
    db.listActive("customers"),
    db.listActive("sites"),
    db.listActive("vehicles"),
  ]);
  const rec = editId ? await db.get("price_book", editId) : null;
  const v = rec || {
    unit: "Sefer",
    kdv_rate: 20,
    kdv_included: false,
    active: true,
    customer_id: query.customer_id || null,
    site_id: query.site_id || null,
  };
  const scope = v.vehicle_id
    ? "VEHICLE"
    : v.vehicle_type
      ? "TYPE"
      : v.vehicle_group || "ALL";
  root.innerHTML =
    appbar(
      editId ? "Fiyat Düzenle" : "+ Fiyat",
      'Boş bırakılan alan "hepsi" demektir',
    ) +
    `
    <form data-form novalidate>
      ${fSelect(
        "Fiyat uygulanacak araçlar",
        "vehicle_scope",
        [
          { v: "ALL", t: "Tüm araç / makineler" },
          ...Object.entries(PRICE_VEHICLE_GROUPS).map(([v, g]) => ({
            v,
            t: g.label,
          })),
          { v: "VEHICLE", t: "Belirli araç / plaka" },
          { v: "TYPE", t: "Belirli araç / makine türü" },
        ],
        scope,
        { empty: false },
      )}
      <div class="notice" data-group-help hidden>Bu fiyat, kartında Tür alanı Kamyon veya Tır/Çekici olarak tanımlı araçlara uygulanır. Plaka seçmeniz gerekmez; gruba sonradan eklenen araçlar da aynı fiyatı kullanır. Türü belirtilmemiş araçlar otomatik gruba alınmaz.</div>
      ${fSelect(
        "Belirli Araç / Plaka",
        "vehicle_id",
        vehicles.map((x) => ({ v: x.id, t: x.name })),
        v.vehicle_id,
      )}
      ${fSelect("İş Türü", "work_type", WORK_TYPES, v.work_type)}
      ${fText("Araç / makine türü (opsiyonel)", "vehicle_type", v.vehicle_type || "")}
      ${fText("Malzeme (opsiyonel)", "material", v.material || "")}
      <div class="formgrid2">${fNum("Mesafe alt sınır (km)", "distance_min", v.distance_min ?? "", { step: "any" })}${fNum("Mesafe üst sınır (km)", "distance_max", v.distance_max ?? "", { step: "any" })}</div>
      <div class="formgrid2">
        ${fSelect("Birim", "unit", WORK_UNITS, v.unit, { empty: false })}
        ${fNum("Fiyat (₺)", "price", v.price ?? "")}
      </div>
      <div class="formgrid2">
        ${fNum("KDV %", "kdv_rate", v.kdv_rate ?? 20)}
        ${fSelect(
          "KDV Durumu",
          "kdv_included",
          [
            { v: "0", t: "+KDV (hariç)" },
            { v: "1", t: "KDV dahil" },
          ],
          v.kdv_included ? "1" : "0",
          { empty: false },
        )}
      </div>
      <div class="formgrid2">
        ${fSelect(
          "Müşteri (özel)",
          "customer_id",
          customers.map((c) => ({ v: c.id, t: c.name })),
          v.customer_id,
        )}
        ${fSelect(
          "Şantiye (özel)",
          "site_id",
          sites.map((s) => ({ v: s.id, t: s.name })),
          v.site_id,
        )}
      </div>
      <div class="formgrid2">
        ${fDate("Geçerlilik Başlangıç", "valid_from", v.valid_from || "", false)}
        ${fDate("Geçerlilik Bitiş", "valid_to", v.valid_to || "", false)}
      </div>
      ${fSelect(
        "Hesap",
        "formula",
        [
          { v: "", t: "Normal (miktar × fiyat)" },
          { v: "CRANE_FIRST_HOUR", t: "Vinç: ilk saat + sonraki saat" },
        ],
        v.formula || "",
        { empty: false },
      )}
      <div data-crane style="display:${v.formula === "CRANE_FIRST_HOUR" ? "block" : "none"}">
        <div class="formgrid2">
          ${fNum("İlk Saat (₺)", "first_hour_price", v.first_hour_price ?? "")}
          ${fNum("Sonraki Saat (₺)", "next_hour_price", v.next_hour_price ?? "")}
        </div>
        <div class="hint" style="margin-bottom:10px">Boş bırakılırsa Ayarlar\'daki genel vinç tarifesi kullanılır.</div>
      </div>
    </form>
    <div class="actionbar">
      <button class="btn primary" data-save>Kaydet</button>
      ${editId ? '<button class="btn danger" data-del>Sil</button>' : ""}
    </div>`;
  const updateScope = () => {
    const selected = qs("[name=vehicle_scope]", root).value;
    for (const [field, applicable] of [
      ["vehicle_id", selected === "VEHICLE"],
      ["vehicle_type", selected === "TYPE"],
    ]) {
      const input = qs("[name=" + field + "]", root);
      input.closest(".field").hidden = !applicable;
      input.disabled = !applicable;
    }
    const help = qs("[data-group-help]", root);
    help.hidden = !PRICE_VEHICLE_GROUPS[selected];
    if (!help.hidden)
      help.textContent = `${PRICE_VEHICLE_GROUPS[selected].label}: araç kartındaki Tür bilgisiyle eşleşir. Plaka seçmeniz gerekmez; yeni uygun araçlar da aynı fiyatı kullanır. Türü belirtilmemiş araçlar otomatik gruba alınmaz.`;
  };
  qs("[name=vehicle_scope]", root).addEventListener("change", updateScope);
  updateScope();
  qs("select[name=formula]", root).addEventListener("change", (e) => {
    qs("[data-crane]", root).style.display =
      e.target.value === "CRANE_FIRST_HOUR" ? "block" : "none";
  });
  qs("[data-save]", root).addEventListener("click", async () => {
    const val = collectForm(qs("[data-form]", root));
    if (
      val.formula !== "CRANE_FIRST_HOUR" &&
      (val.price === "" ||
        !Number.isFinite(Number(val.price)) ||
        Number(val.price) < 0)
    ) {
      toast("Fiyat girin", "err");
      return;
    }
    if (
      (val.vehicle_scope === "VEHICLE" && !val.vehicle_id) ||
      (val.vehicle_scope === "TYPE" && !val.vehicle_type?.trim())
    ) {
      toast("Seçilen kapsam için araç veya tür seçin", "err");
      return;
    }
    const fields = {
      vehicle_id: val.vehicle_scope === "VEHICLE" ? val.vehicle_id : null,
      vehicle_group: PRICE_VEHICLE_GROUPS[val.vehicle_scope]
        ? val.vehicle_scope
        : null,
      work_type: val.work_type || null,
      unit: val.unit,
      vehicle_type:
        val.vehicle_scope === "TYPE" ? val.vehicle_type.trim() : null,
      material: val.material || null,
      distance_min: val.distance_min !== "" ? Number(val.distance_min) : null,
      distance_max: val.distance_max !== "" ? Number(val.distance_max) : null,
      price: Number(val.price) || 0,
      kdv_rate: Number(val.kdv_rate) || 0,
      kdv_included: val.kdv_included === "1",
      customer_id: val.customer_id || null,
      site_id: val.site_id || null,
      valid_from: val.valid_from || null,
      valid_to: val.valid_to || null,
      formula: val.formula || null,
      first_hour_price: val.first_hour_price
        ? Number(val.first_hour_price)
        : null,
      next_hour_price: val.next_hour_price ? Number(val.next_hour_price) : null,
      active: true,
    };
    try {
      if (editId)
        await db.saveExisting("price_book", rec, fields, "Fiyat güncellendi");
      else await db.saveNew("price_book", fields, "Fiyat eklendi");
      toast("Fiyat kaydedildi", "ok");
      go("#/fiyat");
    } catch (e) {
      toast(e.message, "err");
    }
  });
  const del = qs("[data-del]", root);
  if (del)
    del.addEventListener("click", async () => {
      const ok = await confirmDialog(
        "Fiyat silinsin mi?",
        "Eski kesinleşmiş belgeler etkilenmez (snapshot).",
        "Sil",
        true,
      );
      if (!ok) return;
      await db.softDelete("price_book", editId, "Kullanıcı sildi");
      toast("Silindi", "ok");
      go("#/fiyat");
    });
}

// ============ HAKEDİŞ ============
async function hakedis(ctx) {
  const sub = ctx.parts[1];
  if (sub === "new") return hakedisNew(ctx);
  if (sub) return hakedisDetail(ctx, sub);
  const { root, db, names } = ctx;
  const rows = (await db.getAll("hakedis"))
    .filter(isActive)
    .sort((a, b) => (b.hakedis_no || 0) - (a.hakedis_no || 0));
  root.innerHTML =
    appbar("Hakediş", `${rows.length} kayıt`) +
    `
    <div style="height:10px"></div><div data-list></div>
    <div class="actionbar"><button class="btn primary" data-go="#/hakedis/new">+ Hakediş Oluştur</button></div>`;
  const listEl = qs("[data-list]", root);
  if (!rows.length)
    listEl.innerHTML = emptyState(
      "📑",
      "Hakediş yok",
      '<button class="btn primary" data-go="#/hakedis/new">+ Hakediş</button>',
    );
  else
    pagedRender(listEl, rows, (h) =>
      li({
        ic: "📑",
        href: "#/hakedis/" + h.id,
        t1: `#${String(h.hakedis_no || 0).padStart(6, "0")} · ${esc(names.customers[h.customer_id] || "—")}`,
        t2: `${trDate(h.date_from)} – ${trDate(h.date_to)} · ${(h.items || []).length} kalem`,
        badgeHtml: statusBadge(h.status || "Taslak"),
        end: `<div class="amt nowrap">${fmtTL(h.grand_total)} ₺</div>`,
      }),
    );
}

async function hakedisNew(ctx) {
  const { root, db, names } = ctx;
  const [customers, sites, works, pricebook, allHak, vehicles] =
    await Promise.all([
      db.listActive("customers"),
      db.listActive("sites"),
      db.getAll("work_records"),
      db.listActive("price_book"),
      db.getAll("hakedis"),
      db.listActive("vehicles"),
    ]);
  const today = todayStr();
  const inActiveHak = new Set();
  for (const h of allHak.filter((h) => isActive(h) && h.status !== "İptal"))
    for (const it of h.items || []) inActiveHak.add(it.work_record_id);
  const crane = {
    first: await db.metaGet("crane_first_hour"),
    next: await db.metaGet("crane_next_hour"),
  };
  let selected = new Map(); // work_id → {unit_price, kdv_rate}

  root.innerHTML =
    appbar("+ Hakediş", "İşleri seç · fiyatlar snapshot olarak kopyalanır") +
    `
    <div class="card" style="margin-top:10px">
      ${fSelect(
        "Müşteri *",
        "customer_id",
        customers.map((c) => ({ v: c.id, t: c.name })),
        "",
        { req: true },
      )}
      ${fSelect(
        "Şantiye",
        "site_id",
        sites.map((s) => ({ v: s.id, t: s.name })),
        "",
      )}
      <div class="formgrid2">
        ${fDate("Başlangıç", "date_from", today.slice(0, 8) + "01")}
        ${fDate("Bitiş", "date_to", today)}
      </div>
      <button class="btn block" data-fetch>İşleri Getir</button>
    </div>
    <div data-rows></div>
    <div data-total></div>
    <div class="actionbar"><button class="btn primary" data-create disabled>Hakediş Oluştur</button></div>`;

  const rowsEl = qs("[data-rows]", root);
  for (const key of ["customer_id", "site_id", "date_from", "date_to"]) {
    qs("[name=" + key + "]", root).addEventListener("change", () => {
      selected.clear();
      rowsEl.innerHTML = "";
      qs("[data-total]", root).innerHTML = "";
      qs("[data-create]", root).disabled = true;
    });
  }
  qs("[data-fetch]", root).addEventListener("click", () => {
    selected.clear();
    qs("[data-create]", root).disabled = true;
    qs("[data-total]", root).innerHTML = "";
    const val = collectForm(root);
    if (!val.customer_id) {
      toast("Müşteri seçin", "err");
      return;
    }
    const list = works
      .filter(
        (w) =>
          isActive(w) &&
          w.customer_id === val.customer_id &&
          (!val.site_id || w.site_id === val.site_id) &&
          w.date >= val.date_from &&
          w.date <= val.date_to &&
          !inActiveHak.has(w.id),
      )
      .sort((a, b) => (a.date < b.date ? -1 : 1));
    if (!list.length) {
      rowsEl.innerHTML = emptyState(
        "⚒",
        "Bu filtrede hakedişe girmemiş iş yok",
      );
      return;
    }
    rowsEl.innerHTML =
      `<div class="section-title">${list.length} iş — seç ve fiyatı kontrol et</div>` +
      list
        .map((w) => {
          const price = w.price_snapshot
            ? {
                ...w.price_snapshot,
                price: w.price_snapshot.unit_price,
                price_source: "Snapshot",
              }
            : resolvePrice(pricebook, {
                customer_id: w.customer_id,
                site_id: w.site_id,
                vehicle_id: w.vehicle_id,
                work_type: w.work_type,
                unit: w.unit,
                date: w.date,
                material: w.material,
                vehicle_type:
                  vehicles.find((v) => v.id === w.vehicle_id)?.type ||
                  w.vehicle_type,
                distance_km: w.distance_km,
              });
          const isCrane = price && price.formula === "CRANE_FIRST_HOUR";
          return `<div class="card" style="padding:10px">
        <div class="row">
          <input type="checkbox" data-chk="${w.id}" style="width:24px;height:24px;flex:none" ${price ? "" : ""}>
          <div class="grow">
            <div class="strong small">${trDate(w.date)} · ${esc(w.work_type || "İş")} · ${fmtNum(w.quantity)} ${esc(w.unit || "")}</div>
            <div class="tiny muted">${esc(names.vehicles[w.vehicle_id] || "—")} · ${esc(names.sites[w.site_id] || names.customers[w.customer_id] || "")}</div>
          </div>
          <div style="width:96px">
            ${isCrane ? '<span class="badge accent">vinç</span>' : `<input type="number" data-price="${w.id}" value="${price ? price.price : ""}" placeholder="₺" step="any" style="width:100%;min-height:40px;background:var(--bg2);border:1.5px solid var(--border);border-radius:10px;color:var(--text);padding:6px 8px;text-align:right">`}
          </div>
        </div>
        ${price ? "" : '<div class="tiny" style="color:var(--warn);margin-top:5px">⚠ Fiyat bulunamadı — el ile girin</div>'}
      </div>`;
        })
        .join("");
    const upd = () => {
      selected = new Map();
      for (const chk of qsa("[data-chk]", rowsEl)) {
        if (!chk.checked) continue;
        const w = list.find((x) => x.id === chk.dataset.chk);
        const price = w.price_snapshot
          ? {
              ...w.price_snapshot,
              price: w.price_snapshot.unit_price,
              price_source: "Snapshot",
            }
          : resolvePrice(pricebook, {
              customer_id: w.customer_id,
              site_id: w.site_id,
              vehicle_id: w.vehicle_id,
              work_type: w.work_type,
              unit: w.unit,
              date: w.date,
              material: w.material,
              vehicle_type:
                vehicles.find((v) => v.id === w.vehicle_id)?.type ||
                w.vehicle_type,
              distance_km: w.distance_km,
            });
        const manual = qs(`[data-price="${w.id}"]`, rowsEl);
        selected.set(w.id, {
          work_record_id: w.id,
          date: w.date,
          customer_id: w.customer_id,
          site_id: w.site_id,
          material: w.material || "",
          site_name: names.sites[w.site_id] || "",
          vehicle_name: names.vehicles[w.vehicle_id] || "",
          work_type: w.work_type,
          quantity: Number(w.quantity) || 0,
          unit: w.unit,
          unit_price: manual ? Number(manual.value) || 0 : 0,
          kdv_rate: price ? (price.kdv_rate ?? 20) : 20,
          formula:
            price && price.formula === "CRANE_FIRST_HOUR"
              ? "CRANE_FIRST_HOUR"
              : null,
          first_hour_price: price?.first_hour_price ?? crane.first,
          next_hour_price: price?.next_hour_price ?? crane.next,
          kdv_included: price?.kdv_included || false,
          price_source:
            manual && Number(manual.value) !== Number(price?.price)
              ? "Manuel"
              : price?.price_source || "Manuel",
        });
      }
      const tot = calcHakedisTotals([...selected.values()], crane);
      qs("[data-total]", root).innerHTML = selected.size
        ? `<div class="card">${kv("Kalem", String(selected.size))}${kv("Ara Toplam", fmtTL(tot.subtotal) + " ₺")}${kv("KDV", fmtTL(tot.kdv) + " ₺")}${kv("GENEL TOPLAM", fmtTL(tot.grand) + " ₺")}</div>`
        : "";
      qs("[data-create]", root).disabled = !selected.size;
    };
    rowsEl.onchange = upd;
    rowsEl.oninput = upd;
  });

  qs("[data-create]", root).addEventListener("click", async () => {
    const val = collectForm(root);
    const ok = await confirmDialog(
      "Hakediş oluşturulsun mu?",
      `${selected.size} kalem · toplam snapshot alınır. Kesinleştirme sonraki adımdır.`,
      "Oluştur",
    );
    if (!ok) return;
    const items = [...selected.values()];
    const tot = calcHakedisTotals(items, crane);
    const no = await db.nextSeq("hakedis");
    const created = await db.saveNew(
      "hakedis",
      {
        hakedis_no: no,
        customer_id: val.customer_id,
        site_id: val.site_id || null,
        date_from: val.date_from,
        date_to: val.date_to,
        created_date: today,
        status: "Taslak",
        items: tot.lines,
        subtotal: tot.subtotal,
        kdv_total: tot.kdv,
        grand_total: tot.grand,
      },
      "Hakediş taslak",
    );
    toast("Hakediş #" + String(no).padStart(6, "0"), "ok");
    go("#/hakedis/" + created.id);
  });
}

async function hakedisDetail(ctx, id) {
  const { root, db, names } = ctx;
  const h = await db.get("hakedis", id);
  if (!h) {
    root.innerHTML = appbar("Hakediş") + emptyState("📑", "Yok");
    return;
  }
  const finalized = h.status === "Kesinleşti";
  root.innerHTML =
    appbar(
      "Hakediş #" + String(h.hakedis_no).padStart(6, "0"),
      `${trDate(h.date_from)} – ${trDate(h.date_to)}`,
      { right: statusBadge(h.status) },
    ) +
    `
    <div style="height:10px"></div>
    <div class="card">
      ${kv("Müşteri", names.customers[h.customer_id] || "—")}
      ${h.site_id ? kv("Şantiye", names.sites[h.site_id]) : ""}
      ${kv("Kalem", String((h.items || []).length))}
      ${kv("Oluşturma", trDate(h.created_date))}
    </div>
    <div class="section-title">Müşteri özeti</div>
    ${customerWorkLines(h.items || [])
      .map((it) =>
        li({
          t1: esc(
            [it.site_name, it.work_type, it.material]
              .filter(Boolean)
              .join(" · "),
          ),
          t2: `${fmtNum(it.quantity)} ${esc(it.unit)} × ${fmtTL(it.unit_price)} TL`,
          end: `<span class="amt">${fmtTL(it.total)} TL</span>`,
        }),
      )
      .join("")}
    <details><summary>İç detay · kaynak işler (snapshot)</summary>
    ${(h.items || []).map((it) => li({ ic: it.unit === "Sefer" ? "🚛" : "🚜", t1: `${trDate(it.date)} · ${esc(it.work_type || "")}`, t2: `${esc(it.vehicle_name || "")} · ${fmtNum(it.quantity)} ${esc(it.unit || "")} × ${it.formula === "CRANE_FIRST_HOUR" ? "vinç tarifesi" : fmtTL(it.unit_price) + " ₺"}`, end: `<span class="amt nowrap">${fmtTL(it.total)} ₺</span>` })).join("")}
    </details><div class="card">
      ${kv("Ara Toplam", fmtTL(h.subtotal) + " ₺")}
      ${kv("KDV", fmtTL(h.kdv_total) + " ₺")}
      ${kv("GENEL TOPLAM", fmtTL(h.grand_total) + " ₺")}
    </div>
    <div class="actionbar">
      <button class="btn" data-pdf>PDF</button>
      ${!finalized && h.status !== "İptal" ? '<button class="btn ok" data-final>Kesinleştir</button><button class="btn danger" data-iptal>İptal</button>' : ""}
    </div>`;
  qs("[data-pdf]", root).addEventListener("click", async () => {
    const pdf = await import("./pdf.js");
    await pdf.hakedisPdf(h, names);
  });
  const fin = qs("[data-final]", root);
  if (fin)
    fin.addEventListener("click", async () => {
      const ok = await confirmDialog(
        "Hakediş kesinleşsin mi?",
        "Kesinleşen hakediş değiştirilemez; müşteri carisine borç yazılır.",
        "Kesinleştir",
      );
      if (!ok) return;
      // Aynı iş iki aktif hakedişte olmasın (son kontrol)
      const allHak = await db.getAll("hakedis");
      for (const o of allHak) {
        if (o.id === id || !isActive(o) || o.status === "İptal") continue;
        const clash = (o.items || []).filter((it) =>
          (h.items || []).some((x) => x.work_record_id === it.work_record_id),
        );
        if (clash.length) {
          toast(
            "Çakışma: " +
              clash.length +
              " iş başka hakedişte (#" +
              o.hakedis_no +
              ")",
            "err",
          );
          return;
        }
      }
      await db.finalizeHakedis(id);
      toast("Kesinleşti — cariye işlendi", "ok");
      ctx.reload();
    });
  const ipt = qs("[data-iptal]", root);
  if (ipt)
    ipt.addEventListener("click", async () => {
      const reason = await promptDialog("Hakediş iptali", "İptal nedeni");
      if (!reason) return;
      await db.saveExisting("hakedis", h, { status: "İptal" }, reason);
      toast("İptal edildi", "ok");
      ctx.reload();
    });
}

// ============ CARİ ============
async function cari(ctx) {
  const sub = ctx.parts[1];
  const { root, db, names } = ctx;
  if (sub) return cariDetail(ctx, sub);
  const d = await db.dumpAll();
  const customers = (d.customers || []).filter((c) => isActive(c) && !c.internal);
  const { customerBalances, unpricedGroups } = await import("./collect-core.js");
  const { customerFuelLedger, fuelRulesOf } = await import("./assistant-rules.js");
  const { bal, unbilled } = customerBalances(d);
  const rows = customers.map((c) => {
    const fuel = fuelRulesOf(c).length ? customerFuelLedger(d, c.id) : null;
    const np = unpricedGroups(d, c.id).reduce((n, g) => n + g.works.length, 0);
    return { c, b: bal[c.id] || 0, u: unbilled[c.id] || 0, fuel, np };
  }).sort((a, b) => b.b - a.b || (b.fuel?.balance || 0) - (a.fuel?.balance || 0) || b.np - a.np || a.c.name.localeCompare(b.c.name, "tr"));
  const total = rows.reduce((n, r) => n + Math.max(0, r.b), 0);
  root.innerHTML =
    appbar("Cari", "Müşteri bakiyeleri") +
    `
    <div style="height:10px"></div>
    <div class="card tap" data-go="#/nakit" style="border-left:4px solid var(--accent)"><div class="row between"><span><b>📈 Nakit tahmini</b><br><span class="tiny muted">Önümüzdeki 5 hafta giriş / çıkış — param yetecek mi?</span></span><span class="muted">›</span></div></div>
    <div class="card tap" data-go="#/tahsilat"><div class="row between"><span class="muted small">Toplam alacak</span><span class="strong">${fmtTL(total)} ₺ ›</span></div>
      <div class="muted tiny">Bakiye = hakedişler + hakedişe girmemiş fiyatlı işler − tahsilatlar. Gün gün takip ve hatırlatma için dokunun.</div></div>
    <div data-list></div>`;
  qs("[data-list]", root).innerHTML = rows.length
    ? rows
        .map(({ c, b, u, fuel, np }) =>
          li({
            ic: "🏢",
            href: "#/cari/" + c.id,
            t1: esc(c.name),
            t2: esc([u > 0 ? `${fmtTL(u)} ₺ hakedişe girmemiş iş` : "", fuel && fuel.balance ? `⛽ ${fuel.balance > 0 ? fuel.balance + " L mazot alacağı" : -fuel.balance + " L fazla mazot alındı"}` : "", np ? `⚠ ${np} iş fiyatsız (bakiyeye girmedi)` : ""].filter(Boolean).join(" · ")),
            end: `<span class="amt ${b > 0 ? "" : "muted"}">${b > 0 ? "+" : ""}${fmtTL(b)} ₺</span>`,
          }),
        )
        .join("")
    : emptyState("🏢", "Müşteri yok");
}

async function cariDetail(ctx, cid) {
  const { root, db, names } = ctx;
  const c = await db.get("customers", cid);
  const { customerLedgerMovements, unpricedGroups } = await import("./collect-core.js");
  const dAll = await db.dumpAll();
  const groups = unpricedGroups(dAll, cid);
  const { customerFuelLedger, fuelRulesOf } = await import("./assistant-rules.js");
  const fuel = c && fuelRulesOf(c).length ? customerFuelLedger(dAll, cid) : null;
  const { fuelPrice } = await import("./finance-chart.js");
  const lp = fuel ? fuelPrice(dAll, todayStr(), await db.metaGet("fuel_ref_price")) : null;
  const movements = customerLedgerMovements(dAll, cid)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const hak = movements
    .filter((m) => m.type === "Hakedis" || m.type === "Is")
    .reduce((s, m) => s + (Number(m.amount) || 0), 0);
  const tah = -movements
    .filter((m) => m.type === "Tahsilat")
    .reduce((s, m) => s + (Number(m.amount) || 0), 0);
  const balance = Math.round(movements.reduce((s, m) => s + (Number(m.amount) || 0), 0) * 100) / 100;
  root.innerHTML =
    appbar(c ? c.name : "Cari", "Müşteri cari kartı") +
    `
    <div class="statgrid" style="grid-template-columns:repeat(3,1fr);margin-top:10px">
      ${stat(fmtTL(hak), "İş + Hakediş ₺", "accent")}
      ${stat(fmtTL(tah), "Tahsilat ₺", "ok")}
      ${stat((balance > 0 ? "+" : "") + fmtTL(balance), "Bakiye ₺", balance > 0 ? "warn" : "")}
    </div>
    ${fuel ? `<div class="card tap" data-go="#/musteriler/${esc(cid)}"><div class="row between"><span>⛽ <b>Mazot hesabı</b> (ücreti mazotla ödüyor)</span><span class="strong">${fuel.balance > 0 ? fuel.balance + " L alacak" : fuel.balance < 0 ? -fuel.balance + " L fazla" : "kapalı"}</span></div><div class="tiny muted">${fuel.earned} L hak edildi · ${fuel.received} L alındı${lp && fuel.balance > 0 ? ` · ≈ ${fmtTL(fuel.balance * lp)} ₺ değerinde` : ""}. Mazotla ödenen işler TL bakiyeye 0 yazar; alacak litre olarak izlenir.</div></div>` : ""}
    ${groups.length ? `<div class="section-title">⚠ Fiyatı girilmemiş işler (${groups.reduce((n, g) => n + g.works.length, 0)}) — bakiyeye girmedi</div>
    <div class="card"><div class="tiny muted" style="margin-bottom:6px">Birim fiyatı yazıp "Uygula"ya basın: bu gruptaki tüm işlere fiyat yazılır, bakiye güncellenir. "Fiyat listesine de kaydet" işaretliyse bu müşterinin sonraki işleri de bu fiyatla gelir.</div>
      ${groups.map((g, i) => `<div class="row between" style="gap:6px;margin:6px 0;flex-wrap:wrap"><span class="small grow"><b>${esc(g.work_type)}</b> · ${g.works.length} iş · ${g.qty} ${esc(String(g.unit).toLocaleLowerCase("tr-TR"))}</span>
        <input type="number" step="any" data-gp="${i}" placeholder="₺ / ${esc(String(g.unit).toLocaleLowerCase("tr-TR") || "birim")}" style="width:110px">
        <button class="btn sm primary" data-gapply="${i}">Uygula</button></div>`).join("")}
      <label class="history-check small"><input type="checkbox" data-gsave checked> Fiyat listesine de kaydet (bu müşteri + iş türü)</label></div>` : ""}
    <div class="section-title">Hareketler</div>
    ${movements.length ? `<div class="timeline">${movements.map((m) => `<div class="ti ${m.type === "Is" ? "tap" : ""}" ${m.type === "Is" ? `data-go="#/isler/${esc(m.ref_id)}"` : ""}><div class="small strong">${trDate(m.date)} · ${esc({ Is: "İş", Hakedis: "Hakediş", Duzeltme: "Düzeltme" }[m.type] || m.type)} · ${m.amount > 0 ? "+" : ""}${fmtTL(m.amount)} ₺</div><div class="tiny muted">${esc(m.note || m.reason || "")}${m.type === "Is" ? " · hakedişe girmedi" : m.ref_id ? " · kaynak: " + esc(String(m.ref_id).slice(0, 8)) : ""}</div></div>`).join("")}</div>` : emptyState("🏦", "Hareket yok")}
    <div class="section-title">Ekstre Gönder</div>
    <div class="card">
      <div class="field"><label>Dönem</label><select data-stper><option value="all">Tüm hareketler</option><option value="month">Bu ay</option><option value="q">Son 3 ay</option></select></div>
      <div class="row" style="gap:8px"><button class="btn primary grow" data-stwa>📤 WhatsApp / Paylaş</button><button class="btn grow" data-stcsv>📊 Excel (CSV)</button></div>
      <div class="muted tiny" style="margin-top:6px">Müşteriye giden metinde iç notlar ve düzeltme nedenleri yer almaz.</div>
    </div>
    <div class="actionbar"><button class="btn" data-go="#/tahsilat/${esc(cid)}">💰 Tahsilat / hatırlat</button><button class="btn primary" data-duzelt>± Manuel Düzeltme</button></div>`;
  for (const b of root.querySelectorAll("[data-gapply]"))
    b.addEventListener("click", async () => {
      const g = groups[Number(b.dataset.gapply)];
      const price = Number(qs(`[data-gp="${b.dataset.gapply}"]`, root).value);
      if (!(price > 0)) return toast("Birim fiyat yazın", "err");
      const pr = await import("./price-rule-core.js");
      const rule = { customer_id: cid, site_id: null, work_type: g.work_type === "Diğer" ? null : g.work_type, vehicle_id: null, unit: g.unit, price, kdv_rate: 20, kdv_included: false, valid_from: null };
      let ruleId = null;
      if (qs("[data-gsave]", root)?.checked && rule.unit) {
        const old = pr.sameRule(await db.dumpAll(), rule);
        const rec = old ? await db.saveExisting("price_book", old, { price }, "Cari: fiyat güncellendi") : await db.saveNew("price_book", { ...rule, active: true, note: "Cari ekranından" }, "Cari: fiyat kuralı");
        ruleId = rec?.id || old?.id || null;
      }
      let n = 0;
      for (const w of g.works) {
        try { await db.saveExisting("work_records", await db.get("work_records", w.id), { price_snapshot: pr.priceSnapshotFor(rule, w, ruleId) }, "Cari: fiyatsız işe fiyat yazıldı"); n++; } catch (e) { /* kilitli */ }
      }
      toast(`${n} işe fiyat yazıldı`, "ok");
      ctx.reload();
    });
  const stPeriod = () => {
    const t = todayStr(), v = qs("[data-stper]", root).value;
    if (v === "month") return { from: t.slice(0, 7) + "-01", to: t };
    if (v === "q") return { from: addDays(t, -90), to: t };
    return { from: "", to: "" };
  };
  qs("[data-stwa]", root).addEventListener("click", async () => {
    const per = stPeriod();
    const st = customerStatement(movements, cid, per);
    await shareText(statementText(c ? c.name : "Müşteri", st, { ...per, today: todayStr() }));
  });
  qs("[data-stcsv]", root).addEventListener("click", () => {
    const st = customerStatement(movements, cid, stPeriod());
    downloadBlob(new Blob([statementCsv(st)], { type: "text/csv;charset=utf-8" }), `Ekstre_${(c ? c.name : "musteri").replace(/[^\wÇĞİÖŞÜçğıöşü]+/g, "_")}_${todayStr()}.csv`);
  });
  qs("[data-duzelt]", root).addEventListener("click", async () => {
    const amt = await promptDialog(
      "Manuel Düzeltme",
      "Tutar (alacak için −, borç için +)",
    );
    if (amt === null) return;
    const reason = await promptDialog("Zorunlu: Düzeltme nedeni", "Neden");
    if (!reason) {
      toast("Neden girilmeden düzeltme yapılmaz", "err");
      return;
    }
    await db.saveNew(
      "cari_movements",
      {
        date: todayStr(),
        customer_id: cid,
        type: "Duzeltme",
        amount: Number(String(amt).replace(",", ".")),
        reason,
      },
      "Manuel düzeltme: " + reason,
    );
    toast("Düzeltme işlendi", "ok");
    ctx.reload();
  });
}

// ============ KASA ============
async function cash(ctx) {
  const sub = ctx.parts[1];
  if (sub === "new") return cashForm(ctx);
  const { root, db, names } = ctx;
  const rows = (await db.getAll("cash_records"))
    .filter(isActive)
    .sort((a, b) =>
      b.date + (b.created_at || "") < a.date + (a.created_at || "") ? -1 : 1,
    );
  root.innerHTML =
    appbar(
      "Kasa / Tahsilat",
      "Personelde → Teslim Bildirildi → Kasaya Teslim",
    ) +
    `
    <div style="height:10px"></div>
    <div data-list></div>
    <div class="actionbar"><button class="btn primary" data-go="#/finans/kasa/new">+ Tahsilat / Kasa İşlemi</button></div>`;
  const listEl = qs("[data-list]", root);
  if (!rows.length) listEl.innerHTML = emptyState("💰", "Kayıt yok");
  else
    pagedRender(listEl, rows, (c) =>
      li({
        ic: "💰",
        href: "#/kasa/" + c.id,
        t1: `${esc(c.cash_type || "")} · ${esc(names.personnel[c.personnel_id] || "")}`,
        t2: `${trDate(c.date)}${names.customers[c.customer_id] ? " · " + esc(names.customers[c.customer_id]) : ""}${c.description ? " · " + esc(c.description) : ""}`,
        badgeHtml: statusBadge(c.cash_status || ""),
        end: `<div class="amt nowrap">${fmtTL(c.amount)} ₺</div>${nextCashStatus(c.cash_status) ? `<button class="btn sm" data-next="${c.id}" style="margin-top:5px">${nextCashStatus(c.cash_status) === "TESLIM_BILDIRILDI" ? "Teslim Bildir" : "Kasaya Teslim"}</button>` : ""}`,
      }),
    );
  listEl.addEventListener("click", async (e) => {
    const b = e.target.closest("[data-next]");
    if (!b) return;
    const rec = await db.get("cash_records", b.dataset.next);
    const nx = nextCashStatus(rec.cash_status);
    await db.saveExisting(
      "cash_records",
      rec,
      { cash_status: nx },
      "Durum: " + nx,
    );
    toast("Durum: " + nx, "ok");
    ctx.reload();
  });
}

async function cashForm(ctx) {
  const { root, db, query = {} } = ctx;
  const [customers, personnel, banks] = await Promise.all([
    db.listActive("customers"),
    db.listActive("personnel"),
    db.listActive("bank_accounts"),
  ]);
  root.innerHTML =
    appbar(
      "+ Kasa / Tahsilat",
      "Muhasebe kesinleştirmesi değildir; saha akışıdır",
    ) +
    `
    <form data-form novalidate>
      ${fDate("Tarih", "date", todayStr())}
      ${fSelect("İşlem Türü", "cash_type", CASH_TYPES, "Müşteriden Para Alındı", { empty: false })}
      ${fNum("Tutar (₺)", "amount", query.amount || "", { req: true, step: "any" })}
      <div class="formgrid2">
        ${fSelect(
          "Personel",
          "personnel_id",
          personnel.map((p) => ({ v: p.id, t: p.name })),
          "",
        )}
        ${fSelect(
          "Müşteri",
          "customer_id",
          customers.map((c) => ({ v: c.id, t: c.name })),
          query.customer_id || "",
        )}
      </div>
      ${fSelect("Ödeme Şekli", "payment_method", PAYMENT_METHODS, "Nakit", { empty: false })}
      ${fSelect(
        "Banka Hesabı",
        "bank_account_id",
        banks.map((b) => ({ v: b.id, t: b.name })),
      )}
      ${fArea("Açıklama", "description", "")}
    </form>
    <div class="actionbar"><button class="btn primary" data-save>Kaydet</button></div>`;
  const syncBank = () => {
    const on =
      qs("[name=cash_type]", root).value === "Müşteriden Para Alındı" &&
      qs("[name=payment_method]", root).value === "Havale";
    const bank = qs("[name=bank_account_id]", root),
      person = qs("[name=personnel_id]", root);
    bank.closest(".field").hidden = !on;
    bank.disabled = !on;
    person.closest(".field").hidden = on;
    person.disabled = on;
    if (on) person.value = "";
  };
  qs("[name=payment_method]", root).addEventListener("change", syncBank);
  qs("[name=cash_type]", root).addEventListener("change", syncBank);
  syncBank();
  const requestId = ctx.core.uuid();
  let cashSaving = false;
  qs("[data-save]", root).addEventListener("click", async () => {
    if (cashSaving) return;
    cashSaving = true;
    qs("[data-save]", root).disabled = true;
    try {
      const val = collectForm(qs("[data-form]", root));
      if (!(Number(val.amount) > 0)) {
        throw Error("Pozitif tutar girin");
      }
      const fields = {
        request_id: requestId,
        date: val.date,
        cash_type: val.cash_type,
        amount: Number(val.amount),
        personnel_id: val.personnel_id || null,
        customer_id: val.customer_id || null,
        payment_method: val.payment_method,
        description: val.description || "",
        cash_status:
          val.personnel_id &&
          ["Müşteriden Para Alındı", "Personelde Para"].includes(val.cash_type)
            ? "PERSONELDE"
            : val.cash_type === "Kasaya Teslim Bildirildi"
              ? "TESLIM_BILDIRILDI"
              : "KASAYA_TESLIM_EDILDI",
      };
      const created =
        val.cash_type === "Müşteriden Para Alındı" &&
        val.payment_method === "Havale"
          ? await customerBankReceipt(
              {
                date: val.date,
                customer_id: val.customer_id,
                bank_account_id: val.bank_account_id,
                amount: val.amount,
                note: val.description,
              },
              requestId,
            )
          : await db.saveNew("cash_records", fields, "Kasa kaydı");
      toast("Kaydedildi", "ok");
      go("#/finans/kasa");
    } catch (e) {
      toast(e.message, "err");
    } finally {
      cashSaving = false;
      qs("[data-save]", root) && (qs("[data-save]", root).disabled = false);
    }
  });
}

// ============ GİDER ============
async function expenses(ctx) {
  const sub = ctx.parts[1];
  if (sub === "new") return expenseForm(ctx);
  const { root, db, names, query } = ctx;
  const q = query.q || "";
  const kind = query.k || "";
  const per = query.p || "month";
  const today = todayStr();
  const from = per === "month" ? today.slice(0, 8) + "01" : per === "3m" ? addDays(today, -90) : "";
  const d = await db.dumpAll();
  const { costRows, costTotals, COST_KINDS } = await import("./costs-core.js");
  const all = costRows(d, { from, to: today, fuelRefPrice: await db.metaGet("fuel_ref_price") });
  const tot = costTotals(all);
  const expenseRecs = (d.expense_records || []).filter(isActive);
  let rows = all.filter((r) => (!kind || r.kind === kind) && matchSearch(`${r.label} ${r.sub || ""} ${COST_KINDS[r.kind]}`, q));
  const attMap = await db.attachmentsCountMap();
  const link = (k, p) => "#/gider?" + new URLSearchParams({ ...(k ? { k } : {}), p, ...(q ? { q } : {}) }).toString();
  const chip = (k, label, amt) => `<button class="chip ${kind === k ? "on" : ""}" data-go="${link(k, per)}">${label}${amt != null ? ` <b>${fmtTL(amt)}</b>` : ""}</button>`;
  root.innerHTML =
    appbar("Masraflar", `${rows.length} kayıt · ${fmtTL(rows.reduce((n, r) => n + r.amount, 0))} ₺`) +
    `
    <div style="height:10px"></div>
    <div class="row" style="gap:6px;flex-wrap:wrap;margin-bottom:6px">
      ${[["month", "Bu ay"], ["3m", "Son 3 ay"], ["all", "Tümü"]].map(([p, t]) => `<button class="chip ${per === p ? "on" : ""}" data-go="${link(kind, p)}">${t}</button>`).join("")}
    </div>
    <div class="row" style="gap:6px;flex-wrap:wrap;margin-bottom:8px">
      ${chip("", "Hepsi", tot.total)}${chip("gider", "Gider", tot.gider)}${chip("yakit", "Yakıt", tot.yakit)}${chip("bakim", "Bakım", tot.bakim)}${chip("esnaf", "Esnaf", tot.esnaf)}${tot.dokum ? chip("dokum", "Döküm", tot.dokum) : ""}${tot.personel ? chip("personel", "Maaş", tot.personel) : ""}
    </div>
    <div class="muted tiny" style="margin:0 2px 8px">Masraf = gider + araca verilen yakıt + bakım/arıza + esnafa veresiye alış + döküm ücreti + personel maaşı (puantajda ay kapatılınca; avans ayrıca sayılmaz). Depoya alınan mazot araca verildikçe "Yakıt" olarak sayılır.</div>
    ${tot.dokum && all.some((r) => r.kind === "gider" && /döküm/i.test(r.label)) ? notice("warn", "Döküm ücreti hem iş kayıtlarından hesaplanıyor hem de \"Döküm\" gideri olarak girilmiş. Aynı parayı iki kez saymamak için birini kullanın (döküm sahası kartındaki ücreti silin ya da gider kaydını silin).") : ""}
    ${tot.personel && all.some((r) => r.kind === "gider" && /personel|maaş|maas|avans/i.test(r.label)) ? notice("warn", "Maaş puantajdan masrafa yazılıyor; giderlerde de \"Personel\" kaydı var. Aynı maaşı ya da avansı gider olarak da girdiyseniz iki kez sayılır — gider kaydını silin.") : ""}
    ${searchBar("Kategori, araç, esnaf, açıklama…", q)}
    <div data-list></div>
    <div class="actionbar"><button class="btn primary" data-go="#/gider/new">+ Gider</button></div>`;
  const listEl = qs("[data-list]", root);
  const IC = { gider: "💸", yakit: "⛽", bakim: "🔧", esnaf: "🧾", dokum: "🚛", personel: "👷" };
  if (!rows.length) listEl.innerHTML = emptyState("💸", per === "month" ? "Bu ay masraf yok" : "Masraf yok");
  else
    pagedRender(listEl, rows, (r) => {
      const e = r.kind === "gider" ? expenseRecs.find((x) => x.id === r.id) : null;
      return li({
        id: r.kind === "gider" ? r.id : "",
        href: r.kind === "gider" ? "" : r.href,
        ic: IC[r.kind],
        t1: `${esc(r.label)} · ${fmtTL(r.amount)} ₺`,
        t2: `${trDate(r.date)} · ${esc(COST_KINDS[r.kind])}${r.sub ? " · " + esc(r.sub) : ""}${e && attMap[e.id] ? " · 📷" + attMap[e.id] : ""}`,
        badgeHtml: e
          ? e.payment_method === "Personel Ödedi"
            ? statusBadge(e.reimbursement_status || "Bekliyor")
            : e.receipt === "Hayır"
              ? badge("Fişsiz", "warn")
              : ""
          : "",
      });
    });
  let st;
  qs("[data-search]", root).addEventListener("input", (ev) => {
    clearTimeout(st);
    st = setTimeout(
      () => go("#/gider?" + new URLSearchParams({ ...(kind ? { k: kind } : {}), p: per, q: ev.target.value }).toString()),
      450,
    );
  });
  listEl.addEventListener("click", async (e) => {
    const card = e.target.closest(".li");
    if (!card) return;
    const rec = expenseRecs.find((r) => r.id === card.dataset.rid);
    if (rec) await expenseDetail(db, rec, names);
  });
}

// Gider detayı + fiş fotoğrafları (dosyalar yalnızca bu cihazdaki veritabanında durur)
async function expenseDetail(db, e, names) {
  const atts = await db.attachmentsFor("expense", e.id);
  const sh = sheet(`
    <h3>${esc(e.category || "Gider")} · ${fmtTL(e.amount)} ₺</h3>
    ${kv("Tarih", trDate(e.date))}
    ${kv("Ödeme", e.payment_method || "—")}
    ${kv("Personel", names.personnel[e.personnel_id] || "—")}
    ${e.description ? kv("Açıklama", e.description) : ""}
    ${e.company ? kv("Firma", e.company + (e.seller_tax_no ? " · VKN " + e.seller_tax_no : "")) : ""}
    ${e.invoice_no ? kv("Fatura / fiş no", e.invoice_no) : ""}
    ${e.ettn ? kv("ETTN", e.ettn) : ""}
    ${e.net_amount != null ? kv("KDV hariç / KDV", `${fmtTL(e.net_amount)} ₺ / ${e.kdv_amount != null ? fmtTL(e.kdv_amount) + " ₺" : "—"}`) : ""}
    ${Array.isArray(e.items) && e.items.length ? `<div class="section-title" style="margin-top:8px">Kalemler (${e.items.length})</div>` + e.items.map((i) => `<div class="row between small" style="padding:4px 0;border-bottom:1px solid var(--border)"><span>${i.code ? `<span class="muted tiny">${esc(i.code)}</span> ` : ""}${esc(i.desc)} <span class="muted">× ${Number(i.qty || 1).toLocaleString("tr-TR")}</span></span><b style="white-space:nowrap">${fmtTL(i.amount)} ₺</b></div>`).join("") : ""}
    <div data-photos style="margin-top:10px">${atts.length ? "" : '<span class="muted small">Bu giderde fiş fotoğrafı yok</span>'}</div>
    <button class="btn block" style="margin-top:12px" data-close>Kapat</button>`);
  const box = qs("[data-photos]", sh);
  for (const a of atts) {
    if ((a.type || "").startsWith("image/")) {
      const img = document.createElement("img");
      img.src = URL.createObjectURL(a.blob);
      img.alt = a.name || "Fiş";
      img.style.cssText =
        "width:100%;max-height:60vh;object-fit:contain;border-radius:10px;border:1px solid var(--border);margin-bottom:8px";
      box.appendChild(img);
    }
    const b = document.createElement("button");
    b.className = "btn sm";
    b.style.marginRight = "6px";
    b.textContent = "⬇ " + (a.name || "dosya");
    b.addEventListener("click", () => downloadBlob(a.blob, a.name || "fis"));
    box.appendChild(b);
  }
  qs("[data-close]", sh).addEventListener("click", () => sheetClose());
}

async function expenseForm(ctx) {
  const { root, db } = ctx;
  const [personnel, vehicles, categories, suppliers] = await Promise.all([
    db.listActive("personnel"),
    db.listActive("vehicles"),
    db.listActive("expense_categories"),
    db.listActive("suppliers"),
  ]);
  root.innerHTML =
    appbar("+ Gider", "Fiş fotoğrafı eklenebilir") +
    `
    <div class="notice info" style="margin-top:10px"><span>ℹ</span><span>Veresiye (açık hesap) çalıştığınız ustaysa aşağıdan ustayı seçin; borç <a href="#/esnaf">Esnaf Hesabı</a>'na yazılır. Aynı iş iki yerden girilirse sistem engeller.</span></div>
    <form data-form novalidate>
      ${fDate("Tarih", "date", todayStr())}
      <div class="formgrid2">
        ${fSelect("Kategori", "category", [...new Set([...EXPENSE_CATEGORIES, ...categories.map((c) => c.name)])], "Yakıt", { empty: false })}
        ${fNum("Tutar (₺)", "amount", "", { req: true, step: "any" })}
      </div>
      ${fNum("KDV % (biliniyorsa; tutar KDV dahil)", "kdv_rate", "", { step: "any" })}
      <div class="formgrid2">
        ${fSelect(
          "Personel",
          "personnel_id",
          personnel.map((p) => ({ v: p.id, t: p.name })),
          "",
        )}
        ${fSelect(
          "İlgili Araç",
          "vehicle_id",
          vehicles.map((v) => ({ v: v.id, t: v.name })),
          "",
        )}
      </div>
      <div class="formgrid2">
        ${fSelect("Ödeme Şekli", "payment_method", PAYMENT_METHODS, "Şirket Ödedi", { empty: false })}
        ${fSelect("Fiş Var mı?", "receipt", ["Evet", "Hayır"], "Evet", { empty: false })}
      </div>
      <div class="field" data-reimb style="display:none">${fSelect("Personele Ödeme", "reimbursement_status", REIMBURSEMENT_STATUS, "Bekliyor", { empty: false })}</div>
      ${fSelect("Veresiye usta / esnaf (ops.)", "supplier_id", suppliers.map((s) => ({ v: s.id, t: s.name })), "", { emptyText: "— peşin / veresiye değil —" })}
      ${fText("Firma", "company", "")}
      ${fArea("Açıklama", "description", "")}
      <div class="field"><label>Fiş Fotoğrafı</label><input type="file" name="photo" accept="image/*"></div>
      <button type="button" class="btn block" data-gread hidden>🤖 Fişi Gemini ile oku ve formu doldur</button>
      <div data-gres></div>
    </form>
    <div class="actionbar"><button class="btn primary" data-save>Kaydet</button></div>`;
  // Gemini ile fiş okuma: yalnız formu doldurur; kaydetmek kullanıcının işidir
  {
    const { geminiSettings, geminiReadReceipt } = await import("./ai-gemini.js");
    const g = await geminiSettings(db);
    const photo = qs("input[name=photo]", root), btn = qs("[data-gread]", root), out = qs("[data-gres]", root);
    if (g.ready) photo.addEventListener("change", () => (btn.hidden = !photo.files[0]));
    btn.addEventListener("click", async () => {
      const f = photo.files[0];
      if (!f) return;
      btn.disabled = true;
      out.innerHTML = '<div class="muted small" style="margin:6px 0">Fiş okunuyor…</div>';
      try {
        const { checkFields } = await import("./ocr.js");
        const { withModelFallback } = await import("./ai-gemini.js");
        const r = await withModelFallback(db, (o) => geminiReadReceipt(f, o), { onSwitch: (a, b) => toast(`Gemini modeli değişti: ${a} → ${b}`, "ok") });
        const F = r.fields, set = (name, v) => { const el = qs(`[name=${name}]`, root); if (el && v != null && v !== "") { el.value = v; el.style.outline = "2px solid var(--accent,#f5a623)"; } };
        set("date", F.date);
        set("amount", F.total);
        set("kdv_rate", F.kdv_rate);
        set("company", F.firma);
        const cat = F.fuel_type ? "Yakıt" : F.category_suggestion;
        if (cat && [...qs("select[name=category]", root).options].some((o) => o.value === cat)) set("category", cat);
        if (F.plate) {
          const hit = vehicles.find((v) => String(v.plate || v.name || "").toUpperCase().replace(/\s+/g, "") === F.plate);
          if (hit) set("vehicle_id", hit.id);
        }
        const desc = qs("[name=description]", root);
        if (desc && !desc.value && F.firma) set("description", "Fiş: " + F.firma + (F.doc_no ? " · " + F.doc_no : ""));
        const firmKey = String(F.firma || "").toLocaleLowerCase("tr-TR").split(/\s+/)[0] || "";
        const sup = firmKey.length >= 3 ? suppliers.find((x) => String(x.name || "").toLocaleLowerCase("tr-TR").includes(firmKey)) : null;
        const checks = checkFields(F.fuel_type || F.liters ? "Akaryakıt Fişi" : "Gider Fişi", F);
        out.innerHTML =
          notice("info", "Turuncu çerçeveli alanlar fişten dolduruldu. Kontrol edin, sonra Kaydet'e basın.") +
          (F.total == null ? notice("warn", "Toplam tutar fişte net okunamadı; elle girin.") : "") +
          checks.map((c) => notice(c.level === "error" ? "danger" : "warn", c.text)).join("") +
          (sup ? notice("warn", `"${sup.name}" Esnaf Hesabı'nda kayıtlı. Veresiye ise yukarıdan ustayı seçin.`) : "") +
          (r.rejected.length ? `<div class="muted tiny">Doğrulanamayıp atlanan: ${esc(r.rejected.join("; "))}</div>` : "");
      } catch (e) {
        out.innerHTML = notice("warn", e.message || String(e));
      }
      btn.disabled = false;
    });
  }
  const pmSel = qs("select[name=payment_method]", root);
  pmSel.addEventListener("change", () => {
    qs("[data-reimb]", root).style.display =
      pmSel.value === "Personel Ödedi" ? "block" : "none";
  });
  qs("[data-save]", root).addEventListener("click", async () => {
    const val = collectForm(qs("[data-form]", root));
    if (!(Number(val.amount) > 0)) {
      toast("Pozitif tutar girin", "err");
      return;
    }
    if (val.supplier_id) {
      // Veresiye: gider yeniden yazılmaz, usta hesabına borç olarak (tek kayıt) girilir.
      const d = await db.dumpAll();
      const s = d.suppliers.find((x) => x.id === val.supplier_id);
      try {
        const res = await createCreditBill(ctx, d, s, {
          date: val.date,
          amount: val.amount,
          description: val.description || val.category,
          category: val.category,
          vehicle_id: val.vehicle_id || null,
          kdv_rate: val.kdv_rate,
          file: qs("input[name=photo]", root).files[0],
        });
        if (!res) return;
        toast("Veresiye olarak " + s.name + " hesabına yazıldı", "ok");
        go("#/esnaf/" + s.id);
      } catch (e) {
        toast(e.message || String(e), "err");
      }
      return;
    }
    {
      const d = await db.dumpAll();
      const dup = findDuplicates(d, { date: val.date, amount: val.amount }).bills;
      if (dup.length) {
        const who = d.suppliers.find((x) => x.id === dup[0].party_id)?.name || "usta";
        const ok = await confirmDialog(
          "Bu iş Esnaf Hesabı'nda kayıtlı",
          `${who} · ${trDate(dup[0].date)} · ${fmtTL(dup[0].gross_total)} ₺ · ${dup[0].items?.[0]?.description || dup[0].description || ""}. Aynı iş ise gider olarak tekrar girmeyin.`,
          "Farklı bir iş, kaydet",
        );
        if (!ok) return;
      }
    }
    const fields = {
      date: val.date,
      category: val.category,
      kdv_rate:
        val.kdv_rate !== "" && val.kdv_rate != null
          ? Number(val.kdv_rate)
          : null,
      amount: Number(val.amount),
      personnel_id: val.personnel_id || null,
      vehicle_id: val.vehicle_id || null,
      payment_method: val.payment_method,
      receipt: val.receipt,
      reimbursement_status:
        val.payment_method === "Personel Ödedi"
          ? val.reimbursement_status || "Bekliyor"
          : null,
      company: val.company || "",
      description: val.description || "",
    };
    const created = await db.saveNew("expense_records", fields, "Gider");
    const file = qs("input[name=photo]", root).files[0];
    if (file) await db.addAttachment("expense", created.id, file);
    toast("Gider kaydedildi", "ok");
    go("#/gider");
  });
}
