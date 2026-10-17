import { vehicleDocumentStatus } from "./business.js";
// SAHAPRO SOLO — Operasyon: Yakıt · Depo Tankı · Filo · Bakım · Personel · Taşeron
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
} from "./ui.js";
import {
  isActive,
  matchSearch,
  calcTankBalance,
  tankStatus,
  FUEL_SOURCES,
  MAINT_TYPES,
  MAINT_STATUS,
  PERSONNEL_EVENT_TYPES,
  VEHICLE_OWNERSHIP,
} from "./core.js";

export async function screen(ctx) {
  const sub = ctx.parts[0];
  if (sub === "yakit") return fuel(ctx);
  if (sub === "depo") return tank(ctx);
  if (sub === "filo") return fleet(ctx);
  if (sub === "bakim") return maint(ctx);
  if (sub === "personel") return personnel(ctx);
  if (sub === "taseron") return contractors(ctx);
  return fleet(ctx);
}

// ============ YAKIT ============
async function fuel(ctx) {
  const sub = ctx.parts[1];
  if (sub === "new") return fuelForm(ctx);
  const { root, db, names, query } = ctx;
  const q = query.q || "";
  let rows = (await db.getAll("fuel_records"))
    .filter(isActive)
    .sort((a, b) => (b.date < a.date ? -1 : 1));
  rows = rows.filter((r) =>
    matchSearch(
      `${names.vehicles[r.vehicle_id] || ""} ${names.personnel[r.personnel_id] || ""} ${r.description || ""}`,
      q,
    ),
  );
  const totalLt = rows.reduce((s, r) => s + (Number(r.liters) || 0), 0);
  root.innerHTML =
    appbar("Yakıt Kayıtları", `${rows.length} kayıt · ${fmtNum(totalLt)} Lt`) +
    `
    <div class="notice info" style="margin-top:10px"><span>ℹ</span><span>Yakıt müşteri hakedişine otomatik girmez (iç maliyet).</span></div>
    ${searchBar("Araç, personel…", q)}
    <div data-list></div>
    <div class="actionbar"><button class="btn primary" data-go="#/yakit/new">+ Yakıt Kaydı</button></div>`;
  const listEl = qs("[data-list]", root);
  if (!rows.length) listEl.innerHTML = emptyState("⛽", "Yakıt kaydı yok");
  else
    pagedRender(listEl, rows, (f) =>
      li({
        ic: "⛽",
        href: "#/yakit/" + f.id,
        t1: `${esc(names.vehicles[f.vehicle_id] || "—")} · ${fmtNum(f.liters)} Lt`,
        t2: `${trDate(f.date)} · ${esc(names.personnel[f.personnel_id] || "—")} · ${esc(f.fuel_source || "")}${f.total ? " · " + fmtTL(f.total) + " ₺" : ""}${f.km ? " · " + fmtNum(f.km) + " km" : ""}${f.machine_hours ? " · " + fmtNum(f.machine_hours) + " sa" : ""}`,
        badgeHtml: f.receipt === "Hayır" ? badge("Fişsiz", "warn") : f.fuel_source === "Depo Tankı" ? badge("Depo", "") : "",
      }),
    );
  let st;
  qs("[data-search]", root).addEventListener("input", (ev) => {
    clearTimeout(st);
    st = setTimeout(
      () => go("#/yakit?q=" + encodeURIComponent(ev.target.value)),
      450,
    );
  });
}

// Yakıt kaydı ekranına eklenen kart: "depodan verildi" düzeltmesi + silme (depo hareketi de geri alınır)
export async function fuelActions(root, db, f) {
  if (!f || !isActive(f)) return;
  const stock = calcTankBalance((await db.getAll("fuel_tank_movements")).filter(isActive)).remaining;
  const depo = f.fuel_source === "Depo Tankı";
  const box = document.createElement("section");
  box.className = "card";
  box.innerHTML =
    (depo ? `<div class="small">Depo tankından verildi · depoda kalan ${fmtNum(stock)} Lt</div>`
      : `<div class="small">Bu yakıt aslında <b>depo tankından</b> verildiyse düzeltin: depo stoğundan ${fmtNum(f.liters)} Lt düşülür, "fişsiz" uyarısı kalkar.</div><div class="muted tiny" style="margin-top:4px">Depoda kayıtlı: ${fmtNum(stock)} Lt</div><button class="btn primary block" style="margin-top:8px" data-todepo>🛢 Depodan verildi olarak düzelt</button>`) +
    `<button class="btn block" style="margin-top:8px" data-fdel>🗑 Yakıt kaydını sil</button>`;
  root.appendChild(box);
  qs("[data-todepo]", box)?.addEventListener("click", async () => {
    if (Number(f.liters) > stock)
      return toast(`Depoda kayıtlı ${fmtNum(stock)} Lt var. Önce Depo ekranından depoya yakıt girişi yapın.`, "err");
    try {
      await db.fuelFix(f.id, "to_tank", "Depodan verildi olarak düzeltildi");
      toast("Düzeltildi: depodan verildi", "ok");
      go("#/yakit");
    } catch (e) {
      toast(e.message || String(e), "err");
    }
  });
  qs("[data-fdel]", box).addEventListener("click", async () => {
    if (!(await confirmDialog("Yakıt kaydı silinsin mi?", `${trDate(f.date)} · ${fmtNum(f.liters)} Lt${depo ? " (depo stoğuna geri eklenir)" : ""}`, "Sil"))) return;
    try {
      await db.fuelFix(f.id, "delete", "Kullanıcı sildi");
      toast("Silindi", "ok");
      go("#/yakit");
    } catch (e) {
      toast(e.message || String(e), "err");
    }
  });
}

async function fuelForm(ctx) {
  const { root, db } = ctx;
  const [vehicles, personnel, allCust] = await Promise.all([
    db.listActive("vehicles"),
    db.listActive("personnel"),
    db.listActive("customers"),
  ]);
  const { hasFuelRules } = await import("./assistant-rules.js");
  const fuelCustomers = allCust.filter(hasFuelRules);
  root.innerHTML =
    appbar("+ Yakıt", "Litre zorunlu; fiyat/tutar opsiyonel") +
    `
    <form data-form novalidate>
      ${fDate("Tarih", "date", todayStr())}
      <div class="formgrid2">
        ${fSelect(
          "Araç / Makine",
          "vehicle_id",
          vehicles.map((v) => ({ v: v.id, t: v.name })),
          "",
          { req: true },
        )}
        ${fSelect(
          "Personel",
          "personnel_id",
          personnel.map((p) => ({ v: p.id, t: p.name })),
          "",
        )}
      </div>
      <div class="formgrid2">
        ${fNum("Litre", "liters", "", { req: true, step: "any" })}
        ${fNum("Birim Fiyat (₺, ops.)", "unit_price", "", { step: "any" })}
      </div>
      <div class="formgrid2">
        ${fNum("Toplam (₺, ops.)", "total", "", { step: "any" })}${fNum("KDV % (biliniyorsa; toplam KDV dahil)", "kdv_rate", "", { step: "any" })}
        ${fSelect("Kaynak", "fuel_source", FUEL_SOURCES, "Depo Tankı", { empty: false })}
      </div>
      <div data-fcust hidden>${fSelect("Mazotu veren müşteri (sefer karşılığı)", "customer_id", fuelCustomers.map((c) => ({ v: c.id, t: c.name })), fuelCustomers[0]?.id || "")}</div>
      <div class="formgrid2">
        ${fSelect("Fiş", "receipt", ["Evet", "Hayır"], "Evet", { empty: false })}
        ${fText("Pompa Sayaç No (ops.)", "pump_no", "")}
      </div>
      <div class="formgrid2">
        ${fNum("KM (ops.)", "km", "")}
        ${fNum("Makine Saati (ops.)", "machine_hours", "", { step: "any" })}
      </div>
      <label class="history-check"><input type="checkbox" name="full_tank"> Bu dolumda depo tamamen doldu (ölçümlü tüketim karşılaştırması için)</label>
      ${fArea("Açıklama", "description", "")}
    </form>
    <div class="actionbar"><button class="btn primary" data-save>Kaydet</button></div>`;
  const srcSel = qs("[name=fuel_source]", root);
  const syncSrc = () => (qs("[data-fcust]", root).hidden = srcSel.value !== "Müşteri Verdi");
  srcSel.addEventListener("change", syncSrc);
  syncSrc();
  const lt = qs("input[name=liters]", root),
    up = qs("input[name=unit_price]", root),
    tt = qs("input[name=total]", root);
  const auto = () => {
    if (lt.value && up.value && !tt.dataset.manual)
      tt.value = (Number(lt.value) * Number(up.value)).toFixed(2);
  };
  lt.addEventListener("input", auto);
  up.addEventListener("input", auto);
  tt.addEventListener("input", () => {
    tt.dataset.manual = "1";
  });
  qs("[data-save]", root).addEventListener("click", async () => {
    const val = collectForm(qs("[data-form]", root));
    if (!val.vehicle_id) {
      toast("Araç seçin", "err");
      return;
    }
    if (!(Number(val.liters) > 0)) {
      toast("Litre girin", "err");
      return;
    }
    const byCust = val.fuel_source === "Müşteri Verdi";
    if (byCust && !val.customer_id) return toast("Mazotu veren müşteriyi seçin", "err");
    await db.saveNew(
      "fuel_records",
      {
        date: val.date,
        vehicle_id: val.vehicle_id,
        personnel_id: val.personnel_id || null,
        liters: Number(val.liters),
        full_tank: !!qs("[name=full_tank]",root)?.checked,
        unit_price: val.unit_price ? Number(val.unit_price) : null,
        total: val.total ? Number(val.total) : null,
        fuel_source: val.fuel_source,
        receipt: val.receipt,
        pump_no: val.pump_no || "",
        km: val.km ? Number(val.km) : null,
        machine_hours: val.machine_hours ? Number(val.machine_hours) : null,
        description: val.description || "",
        customer_billable: false,
        ...(byCust ? { customer_id: val.customer_id, total: null, unit_price: null, receipt: "Müşteri" } : {}),
        kdv_rate:
          val.kdv_rate !== "" && val.kdv_rate != null
            ? Number(val.kdv_rate)
            : null,
      },
      "Yakıt kaydı",
    );
    toast("Yakıt kaydedildi", "ok");
    go("#/yakit");
  });
}

// ============ DEPO TANKI ============
async function tank(ctx) {
  const { root, db, names } = ctx;
  // Litre fiyatı toplamla tutmayan girişleri (KDV hariç yazılmış) ve onunla maliyetlenen yakıtları düzelt
  try {
    const fx = await db.repairTankPrices();
    if (fx.moves || fx.fuels) toast(`Litre fiyatı düzeltildi (KDV dahil): ${fx.moves} giriş${fx.fuels ? `, ${fx.fuels} yakıt kaydının maliyeti` : ""}`, "ok");
  } catch {}
  const all = await db.getAll("fuel_tank_movements");
  const rows = all.filter(isActive).sort((a, b) => (b.date < a.date ? -1 : 1));
  const bal = calcTankBalance(rows);
  const st = tankStatus(rows, todayStr());
  const [vehicles, personnel, suppliers, fuels, custs] = await Promise.all([
    db.listActive("vehicles"),
    db.listActive("personnel"),
    db.listActive("suppliers"),
    db.getAll("fuel_records"),
    db.listActive("customers"),
  ]);
  const { hasFuelRules: hasFuelRulesT } = await import("./assistant-rules.js");
  const { tankDupPairs } = await import("./tank-match.js");
  const dupPairs = tankDupPairs(rows);
  const uncosted = fuels.filter((f) => isActive(f) && f.fuel_source === "Depo Tankı" && !(Number(f.total) > 0)).length;

  root.innerHTML =
    appbar("Depo Yakıt Tankı", "Giriş fiyatı girilirse depodan verilen yakıt maliyetlenir") +
    `
    <div class="statgrid" style="grid-template-columns:repeat(3,1fr);margin-top:10px">
      ${stat(fmtNum(bal.in), "Giriş L", "ok")}
      ${stat(fmtNum(bal.out), "Çıkış L", "warn")}
      ${stat(fmtNum(bal.remaining), "Kalan L", bal.remaining < 0 ? "danger" : "accent")}
      ${stat(st.unitCost ? fmtTL(st.unitCost) : "—", "Ort. ₺/L")}
      ${stat(st.daily ? fmtNum(st.daily) : "—", "Günlük L (14g)")}
      ${stat(st.daysLeft != null ? fmtNum(st.daysLeft) : "—", "Kaç gün yeter")}
    </div>
    ${dupPairs.map((p, i) => `<div class="card" style="border-left:4px solid #e0a030"><div class="small"><b>⚠ Aynı yakıt iki kez girilmiş olabilir</b><br>${trDate(p.keep.date)} elle girilen ${fmtNum(p.keep.liters)} L ve ${trDate(p.drop.date)} faturadan gelen ${fmtNum(p.drop.liters)} L (fatura ${esc(p.drop.invoice_no)}). Aynı teslimatsa birleştirin: fatura bilgisi ve fotoğrafı elle girdiğiniz kayda geçer, fazla giriş silinir, borç bir kez kalır.</div><button class="btn block" style="margin-top:8px" data-merge="${i}">🔗 Birleştir</button></div>`).join("")}
    ${bal.remaining < 0 ? notice("warn", "Depo eksiye düşmüş: depoya giriş kaydı eksik. Gelen yakıtı GİRİŞ olarak ekleyin.") : ""}
    ${uncosted && st.unitCost ? `<div class="card"><div class="small">${uncosted} depo yakıtı kaydının tutarı yok. Ortalama ${fmtTL(st.unitCost)} ₺/L ile maliyet yazılsın mı? (araç maliyeti ve kâr hesabı düzelir)</div><button class="btn block" style="margin-top:8px" data-fillcost>₺ Maliyetleri Yaz</button></div>` : ""}
    <div class="card">
      <div class="section-title" style="margin:0 0 8px">Yeni Hareket</div>
      <form data-form novalidate>
        <div class="formgrid2">
          ${fDate("Tarih", "date", todayStr())}
          ${fSelect("İşlem", "move_type", ["GİRİŞ", "ÇIKIŞ"], "GİRİŞ", { empty: false })}
        </div>
        <div class="formgrid2">
          ${fNum("Litre", "liters", "", { req: true, step: "any" })}
          ${fSelect(
            "Araç (çıkışta)",
            "vehicle_id",
            vehicles.map((v) => ({ v: v.id, t: v.name })),
            "",
          )}
        </div>
        <div class="formgrid2" data-in>
          ${fNum("Litre fiyatı ₺ (girişte)", "unit_price", "", { step: "any" })}
          ${fNum("Toplam ₺ (girişte)", "total", "", { step: "any" })}
        </div>
        <div data-in>${fSelect("Veresiye petrolcü (ops.)", "supplier_id", suppliers.map((x) => ({ v: x.id, t: x.name })), "")}</div>
        <div data-in>${fSelect("Müşteriden (sefer karşılığı mazot, ops.)", "customer_id", custs.filter(hasFuelRulesT).map((x) => ({ v: x.id, t: x.name })), "")}</div>
        <div class="formgrid2">
          ${fSelect(
            "Personel",
            "personnel_id",
            personnel.map((p) => ({ v: p.id, t: p.name })),
            "",
          )}
          ${fText("Pompa Sayaç No", "pump_no", "")}
        </div>
        ${fText("İmza / Teslim Alan Adı", "signature_name", "")}
      </form>
      <button class="btn primary block" data-add>Hareketi Kaydet</button>
    </div>
    <div class="row between"><div class="section-title" style="margin:0">Hareketler</div><button class="btn sm" data-pdf>🖨 A4 Rapor</button></div>
    <div data-list style="margin-top:8px"></div>`;

  const move = qs("[name=move_type]", root),
    vehicle = qs("[name=vehicle_id]", root);
  const updateMove = () => {
    vehicle.closest(".field").hidden = move.value === "GİRİŞ";
    vehicle.disabled = move.value === "GİRİŞ";
    if (vehicle.disabled) vehicle.value = "";
    for (const el of qsa("[data-in]", root)) el.hidden = move.value !== "GİRİŞ";
  };
  move.addEventListener("change", updateMove);
  updateMove();
  // fiyat ↔ toplam birbirinden hesaplanır
  const L = qs("[name=liters]", root), UP = qs("[name=unit_price]", root), TT = qs("[name=total]", root);
  UP.addEventListener("input", () => { if (Number(L.value) > 0 && Number(UP.value) > 0) TT.value = Math.round(L.value * UP.value * 100) / 100; });
  TT.addEventListener("input", () => { if (Number(L.value) > 0 && Number(TT.value) > 0) UP.value = Math.round((TT.value / L.value) * 100) / 100; });
  const listEl = qs("[data-list]", root);
  const attN = await db.attachmentsCountMap();
  listEl.innerHTML = rows.length
    ? rows
        .map((m) => (m.move_type === "GİRİŞ" ? `<div data-tk="${esc(m.id)}" style="cursor:pointer">` : "<div>") +
          li({
            ic: m.move_type === "GİRİŞ" ? "📥" : "📤",
            t1: `${m.move_type} · ${fmtNum(m.liters)} Lt${m.move_type === "GİRİŞ" && Number(m.total) > 0 ? " · " + fmtTL(m.total) + " ₺" : ""}${m.invoice_no || attN[m.id] ? " · 📄" : ""}`,
            t2: `${trDate(m.date)} · ${esc(m.company || names.personnel[m.personnel_id] || "—")}${m.vehicle_id ? " · " + esc(names.vehicles[m.vehicle_id]) : ""}${m.unit_price ? " · " + fmtTL(m.unit_price) + " ₺/L" : ""}${m.signature_name ? " · ✍ " + esc(m.signature_name) : ""}${m.pump_no ? " · #" + esc(m.pump_no) : ""}`,
          }) + "</div>",
        )
        .join("")
    : emptyState("🛢", "Hareket yok");

  for (const el of qsa("[data-tk]", listEl))
    el.addEventListener("click", (ev) => { ev.preventDefault(); tankInSheet(ctx, rows.find((m) => m.id === el.dataset.tk)); });
  for (const b of qsa("[data-merge]", root))
    b.addEventListener("click", async () => {
      const p = dupPairs[Number(b.dataset.merge)];
      if (!(await confirmDialog("Birleştirilsin mi?", `Elle girilen ${fmtNum(p.keep.liters)} L kayıt kalır, faturadan gelen ikinci giriş silinir. Depo stoku ${fmtNum(p.drop.liters)} L azalır (çift sayım düzelir).`, "Birleştir"))) return;
      try { await mergeTankDup(db, ctx, p); toast("Birleştirildi", "ok"); ctx.reload(); }
      catch (e) { toast(e.message || String(e), "err"); }
    });
  qs("[data-fillcost]", root)?.addEventListener("click", async () => {
    const n = await db.fillTankFuelCosts();
    toast(n + " yakıt kaydına maliyet yazıldı", "ok");
    ctx.reload();
  });
  qs("[data-add]", root).addEventListener("click", async () => {
    const val = collectForm(qs("[data-form]", root));
    if (!(Number(val.liters) > 0)) {
      toast("Litre girin", "err");
      return;
    }
    const isIn = val.move_type === "GİRİŞ";
    const liters = Number(val.liters);
    let unit_price = isIn ? Number(val.unit_price) || null : null;
    let total = isIn ? Number(val.total) || null : null;
    if (unit_price && !total) total = Math.round(unit_price * liters * 100) / 100;
    if (total && !unit_price) unit_price = Math.round((total / liters) * 100) / 100;
    if (isIn && val.supplier_id && !total) return toast("Veresiye için toplam tutar girin", "err");
    if (isIn && val.supplier_id && val.customer_id) return toast("Petrolcü veya müşteri: yalnız birini seçin", "err");
    try {
      const rec = await db.saveNew(
        "fuel_tank_movements",
        {
          date: val.date,
          move_type: val.move_type,
          liters,
          vehicle_id: val.vehicle_id || null,
          personnel_id: val.personnel_id || null,
          pump_no: val.pump_no || "",
          signature_name: val.signature_name || "",
          ...(isIn ? { unit_price, total, supplier_id: val.supplier_id || null, customer_id: val.customer_id || null } : {}),
        },
        "Tank " + val.move_type,
      );
      if (isIn && val.supplier_id) {
        const { createCreditBill } = await import("./esnaf.js");
        const d = await db.dumpAll();
        await createCreditBill(ctx, d, d.suppliers.find((x) => x.id === val.supplier_id),
          { date: val.date, amount: total, description: `Depoya yakıt ${fmtNum(liters)} L`, category: "Yakıt", vehicle_id: null, kdv_rate: null },
          { source: { store: "fuel_tank_movements", id: rec.id } });
      }
      toast("Kaydedildi", "ok");
      ctx.reload();
    } catch (e) {
      toast(e.message || String(e), "err");
    }
  });
  qs("[data-pdf]", root).addEventListener("click", async () => {
    const pdf = await import("./pdf.js");
    await pdf.tankPdf(rows, bal, names);
  });
}

// ============ FİLO ============
async function fleet(ctx) {
  const sub = ctx.parts[1];
  const { root, db, names } = ctx;
  if (sub) return vehicleDetail(ctx, sub);
  const rows = (await db.getAll("vehicles")).filter(isActive);
  root.innerHTML =
    appbar("Filo", `${rows.length} araç/makine`) +
    `
    <div style="height:10px"></div>
    <div data-list></div>
    <div class="actionbar"><button class="btn primary" data-vadd>+ Araç/Makine</button></div>`;
  const maint = await db.getAll("maintenance_records");
  const docs = await db.listActive("documents");
  qs("[data-list]", root).innerHTML = rows
    .map((v) => {
      const open = maint.filter(
        (m) =>
          isActive(m) && m.vehicle_id === v.id && m.status !== "Tamamlandı",
      ).length;
      const docState = vehicleDocumentStatus(v, docs);
      return li({
        ic: v.ownership === "Taşeron" ? "🤝" : "🚜",
        href: "#/filo/" + v.id,
        t1: esc(v.name),
        t2: `${esc(v.type || "")} · ${esc(v.ownership || "")}${v.assignee_id ? " · zimmet: " + esc(names.personnel[v.assignee_id] || "") : ""}`,
        badgeHtml:
          badge(
            docState.status,
            docState.status === "BELGELER TAM"
              ? "ok"
              : docState.status === "SÜRESİ GEÇMİŞ"
                ? "danger"
                : "warn",
          ) + (open ? badge(open + " açık", "danger") : ""),
      });
    })
    .join("");
  qs("[data-vadd]", root).addEventListener("click", async () => {
    const name = await promptDialog("Yeni Araç/Makine", "Ad / Plaka");
    if (!name) return;
    const created = await db.saveNew("vehicles", {
      name,
      type: "Araç/Makine",
      ownership: "Özmal",
      active: true,
    });
    toast("Eklendi", "ok");
    go("#/filo/" + created.id);
  });
}

async function vehicleDetail(ctx, id) {
  const { root, db, names } = ctx;
  const v = await db.get("vehicles", id);
  if (!v) {
    root.innerHTML = appbar("Araç") + emptyState("🚜", "Yok");
    return;
  }
  const [works, fuels, maints, docs, personnel] = await Promise.all([
    db.getAll("work_records"),
    db.getAll("fuel_records"),
    db.getAll("maintenance_records"),
    db.getAll("documents"),
    db.listActive("personnel"),
  ]);
  const w = works.filter((x) => isActive(x) && x.vehicle_id === id);
  const f = fuels.filter((x) => isActive(x) && x.vehicle_id === id);
  const m = maints.filter((x) => isActive(x) && x.vehicle_id === id);
  const d = docs.filter((x) => isActive(x) && x.vehicle_id === id);
  const saat = w
    .filter((x) => x.unit === "Saat")
    .reduce((s, x) => s + (Number(x.quantity) || 0), 0);
  const sefer = w
    .filter((x) => x.unit === "Sefer")
    .reduce((s, x) => s + (Number(x.quantity) || 0), 0);
  const yev = w
    .filter((x) => x.unit === "Yevmiye")
    .reduce((s, x) => s + (Number(x.quantity) || 0), 0);
  const lt = f.reduce((s, x) => s + (Number(x.liters) || 0), 0);
  const lastMaint = m
    .filter((x) => x.status === "Tamamlandı")
    .sort((a, b) => (a.date < b.date ? 1 : -1))[0];

  root.innerHTML =
    appbar(v.name, "Araç kartı", {
      right: badge(
        v.active === false ? "Pasif" : "Aktif",
        v.active === false ? "" : "ok",
      ),
    }) +
    `
    <div class="statgrid" style="margin-top:10px">
      ${stat(fmtNum(w.length), "İş")}${stat(fmtNum(sefer), "Sefer")}${stat(fmtNum(saat), "Saat")}${stat(fmtNum(yev), "Yevmiye")}
      ${stat(fmtNum(lt), "Yakıt L")}${stat(fmtNum(m.length), "Bakım")}${stat(fmtNum(m.filter((x) => x.status !== "Tamamlandı").length), "Açık", m.some((x) => x.status !== "Tamamlandı") ? "danger" : "")}${stat(fmtNum(d.length), "Belge")}
    </div>
    <div class="card">
      <div class="section-title" style="margin:0 0 8px">Kart Bilgileri</div>
      <div class="formgrid2">
        ${fSelect("Özmal/Taşeron", "ownership", VEHICLE_OWNERSHIP, v.ownership || "Özmal", { empty: false })}
        ${fSelect(
          "Zimmetli Personel",
          "assignee_id",
          personnel.map((p) => ({ v: p.id, t: p.name })),
          v.assignee_id,
        )}
      </div>
      <div class="formgrid2">
        ${fNum("KM", "km", v.km ?? "")}
        ${fNum("Makine Saati", "machine_hours", v.machine_hours ?? "", { step: "any" })}
      </div>
      <div class="formgrid2">
        ${fDate("Sonraki Bakım", "next_maintenance_date", v.next_maintenance_date || "", false)}
        ${fText("Not", "note", v.note || "")}
      </div>
      <div class="formgrid2">
        ${fNum("Depo kapasitesi (L)", "tank_capacity", v.tank_capacity ?? "", { step: "any" })}
      </div>
      <button class="btn sm" data-vsave>Kartı Kaydet</button>
    </div>
    ${lastMaint ? notice("ok", `Son tamamlanan bakım: ${trDate(lastMaint.date)} — ${lastMaint.maint_type || ""}`) : ""}
    <div class="card tap" data-go="#/bakim-takvimi/${esc(v.id)}"><div class="row between"><span>🗓 Bakım takvimi${(v.service_rules || []).length ? ` · ${(v.service_rules || []).length} kural` : " — kural ekle (yağ, filtre…)"}</span><span class="muted small">›</span></div></div>
    <div class="section-title">Son İşler</div>
    ${
      w.length
        ? w
            .slice(-5)
            .reverse()
            .map((x) =>
              li({
                ic: "⚒",
                href: "#/isler/" + x.id,
                t1: `${trDate(x.date)} · ${esc(x.work_type || "")}`,
                t2: esc(names.customers[x.customer_id] || ""),
                end: `<span class="amt nowrap">${fmtNum(x.quantity)} ${esc(x.unit || "")}</span>`,
              }),
            )
            .join("")
        : emptyState("⚒", "İş yok")
    }
    <div class="section-title">Bakım/Arıza</div>
    ${
      m.length
        ? m
            .slice(-5)
            .reverse()
            .map((x) =>
              li({
                ic: "🔧",
                href: "#/bakim/" + x.id,
                t1: `${trDate(x.date)} · ${esc(x.maint_type || "")}`,
                t2: esc(x.description || ""),
                badgeHtml: statusBadge(x.status || "Açık"),
              }),
            )
            .join("")
        : emptyState("🔧", "Kayıt yok")
    }
    <div class="section-title">Belgeler</div>
    ${
      d.length
        ? d
            .slice(-5)
            .reverse()
            .map((x) =>
              li({
                ic: "🗂",
                href: "#/belgeler/" + x.id,
                t1: esc(x.category || "Belge"),
                t2: `${trDate(x.date)}${x.expiry_date ? " · bitiş " + trDate(x.expiry_date) : ""}`,
              }),
            )
            .join("")
        : emptyState("🗂", "Belge yok")
    }`;
  qs("[data-vsave]", root).addEventListener("click", async () => {
    const val = collectForm(root);
    await db.saveExisting(
      "vehicles",
      v,
      {
        ownership: val.ownership,
        assignee_id: val.assignee_id || null,
        km: val.km ? Number(val.km) : null,
        machine_hours: val.machine_hours ? Number(val.machine_hours) : null,
        next_maintenance_date: val.next_maintenance_date || null,
        note: val.note || "",
        tank_capacity: Number(val.tank_capacity) > 0 ? Number(val.tank_capacity) : null,
      },
      "Araç kartı",
    );
    toast("Kaydedildi", "ok");
  });
}

// ============ BAKIM / ARIZA ============
async function maint(ctx) {
  const sub = ctx.parts[1];
  if (sub === "new") return maintForm(ctx);
  if (sub && ctx.parts[2] === "edit") return maintForm(ctx, sub);
  if (sub) return maintDetail(ctx, sub);
  const { root, db, names, query } = ctx;
  const f = query.f || "open";
  let rows = (await db.getAll("maintenance_records"))
    .filter(isActive)
    .sort((a, b) => (b.date < a.date ? -1 : 1));
  if (f === "open") rows = rows.filter((r) => r.status !== "Tamamlandı");
  if (f === "done") rows = rows.filter((r) => r.status === "Tamamlandı");
  root.innerHTML =
    appbar("Bakım / Arıza", `${rows.length} kayıt`) +
    `
    <div style="height:10px"></div>
    ${segBar(
      [
        { v: "open", t: "Açık" },
        { v: "all", t: "Tümü" },
        { v: "done", t: "Tamamlanan" },
      ],
      f,
      (v) => `#/bakim?f=${v}`,
    )}
    <div data-list></div>
    <div class="actionbar"><button class="btn" data-go="#/bakim-takvimi">🗓 Bakım Takvimi</button><button class="btn primary" data-go="#/bakim/new">+ Arıza / Bakım</button></div>`;
  const listEl = qs("[data-list]", root);
  if (!rows.length) listEl.innerHTML = emptyState("🔧", "Kayıt yok");
  else
    pagedRender(listEl, rows, (m) =>
      li({
        ic: "🔧",
        href: "#/bakim/" + m.id,
        t1: `${esc(names.vehicles[m.vehicle_id] || "—")} · ${esc(m.maint_type || "")}`,
        t2: `${trDate(m.date)} · ${esc(names.personnel[m.personnel_id] || "—")}${m.cost ? " · " + fmtTL(m.cost) + " ₺" : ""}${m.description ? " · " + esc(m.description) : ""}`,
        badgeHtml: statusBadge(m.status || "Açık"),
      }),
    );
}

async function maintForm(ctx, editId) {
  const { root, db } = ctx;
  const rec = editId ? await db.get("maintenance_records", editId) : null;
  const v = rec || {};
  const [vehicles, personnel] = await Promise.all([
    db.listActive("vehicles"),
    db.listActive("personnel"),
  ]);
  root.innerHTML =
    appbar(editId ? "Bakım Düzenle" : "+ Arıza / Bakım", "") +
    `
    <form data-form novalidate>
      ${fDate("Tarih", "date", v.date)}
      <div class="formgrid2">
        ${fSelect(
          "Araç / Makine",
          "vehicle_id",
          vehicles.map((x) => ({ v: x.id, t: x.name })),
          v.vehicle_id,
          { req: true },
        )}
        ${fSelect(
          "Personel",
          "personnel_id",
          personnel.map((p) => ({ v: p.id, t: p.name })),
          v.personnel_id,
        )}
      </div>
      <div class="formgrid2">
        ${fSelect("Kayıt Tipi", "maint_type", MAINT_TYPES, v.maint_type || "Arıza", { empty: false })}
        ${fSelect("Durum", "status", MAINT_STATUS, v.status || "Açık", { empty: false })}
      </div>
      ${fSelect("Önem", "severity", ["Düşük", "Normal", "Yüksek", "Kritik"], v.severity || "Normal", { empty: false })}${fText("Parça", "part", v.part || "")}
      ${fArea("Arıza / Açıklama", "description", v.description || "")}
      <div class="formgrid2">
        ${fNum("Maliyet (₺, ops.)", "cost", v.cost ?? "", { step: "any" })}${fNum("KDV % (biliniyorsa; maliyet KDV dahil)", "kdv_rate", v.kdv_rate ?? "", { step: "any" })}
        ${fText("Servis/Firma (ops.)", "service_company", v.service_company || "")}
      </div>
      ${fText("KM / Çalışma Saati (ops.)", "km_hours", v.km_hours || "")}
      <div class="field"><label>Fotoğraf</label><input type="file" name="photo" accept="image/*"></div>
    </form>
    <div class="actionbar"><button class="btn primary" data-save>Kaydet</button></div>`;
  qs("[data-save]", root).addEventListener("click", async () => {
    const val = collectForm(qs("[data-form]", root));
    if (!val.vehicle_id) {
      toast("Araç seçin", "err");
      return;
    }
    const fields = {
      date: val.date,
      vehicle_id: val.vehicle_id,
      personnel_id: val.personnel_id || null,
      severity: val.severity,
      part: val.part || "",
      maint_type: val.maint_type,
      status: val.status,
      description: val.description || "",
      cost: val.cost ? Number(val.cost) : null,
      kdv_rate:
        val.kdv_rate !== "" && val.kdv_rate != null
          ? Number(val.kdv_rate)
          : null,
      service_company: val.service_company || "",
      km_hours: val.km_hours || "",
    };
    let saved;
    if (editId) {
      saved = await db.saveExisting(
        "maintenance_records",
        rec,
        fields,
        "Bakım güncellendi",
      );
    } else {
      saved = await db.saveNew("maintenance_records", fields, "Bakım kaydı");
    }
    const file = qs("input[name=photo]", root).files[0];
    if (file) await db.addAttachment("maintenance", saved.id, file);
    toast("Kaydedildi", "ok");
    go("#/bakim/" + saved.id);
  });
}

async function maintDetail(ctx, id) {
  const { root, db, names } = ctx;
  const m = await db.get("maintenance_records", id);
  if (!m) {
    root.innerHTML = appbar("Bakım") + emptyState("🔧", "Yok");
    return;
  }
  const atts = await db.attachmentsFor("maintenance", id);
  root.innerHTML =
    appbar(`${names.vehicles[m.vehicle_id] || "Bakım"}`, trDate(m.date), {
      right: statusBadge(m.status || "Açık"),
    }) +
    `
    <div style="height:10px"></div>
    <div class="card">
      ${kv("Tür", m.maint_type || "—")}
      ${kv("Personel", names.personnel[m.personnel_id] || "—")}
      ${m.description ? kv("Açıklama", m.description) : ""}
      ${m.cost ? kv("Maliyet", fmtTL(m.cost) + " ₺") : ""}
      ${m.service_company ? kv("Servis", m.service_company) : ""}
      ${m.km_hours ? kv("KM/Saat", m.km_hours) : ""}
    </div>
    ${atts.length ? `<div class="section-title">Fotoğraflar</div><div class="row" style="flex-wrap:wrap">${atts.map((a, i) => `<img data-att="${a.id}" style="width:calc(50% - 5px);border-radius:10px;cursor:pointer" src="">`).join("")}</div>` : ""}
    <div class="actionbar">
      ${m.status !== "Tamamlandı" ? `<button class="btn" data-st="${m.status === "Açık" ? "Serviste" : m.status === "Serviste" ? "Parça Bekliyor" : "Tamamlandı"}">${m.status === "Açık" ? "→ Serviste" : m.status === "Serviste" ? "→ Parça Bekliyor" : "→ Tamamla"}</button><button class="btn ok" data-done>Tamamlandı ✓</button>` : ""}
      <button class="btn" data-go="#/bakim/${id}/edit">Düzenle</button>
      <button class="btn danger" data-del>Sil</button>
    </div>`;
  for (const img of qsa("[data-att]", root)) {
    const a = atts.find((x) => x.id === img.dataset.att);
    if (a) img.src = URL.createObjectURL(a.blob);
    img.addEventListener("click", () => {
      sheet(
        `<h3>Fotoğraf</h3><img src="${img.src}" style="width:100%;border-radius:10px">`,
      );
    });
  }
  const stBtn = qs("[data-st]", root);
  if (stBtn)
    stBtn.addEventListener("click", async () => {
      await db.saveExisting(
        "maintenance_records",
        m,
        { status: stBtn.dataset.st },
        "Durum geçişi",
      );
      toast("Güncellendi", "ok");
      ctx.reload();
    });
  const done = qs("[data-done]", root);
  if (done)
    done.addEventListener("click", async () => {
      await db.saveExisting(
        "maintenance_records",
        m,
        { status: "Tamamlandı" },
        "Tamamlandı",
      );
      toast("Tamamlandı", "ok");
      ctx.reload();
    });
  qs("[data-go]", root); // noop
  qs("[data-del]", root).addEventListener("click", async () => {
    const ok = await confirmDialog(
      "Kayıt silinsin mi?",
      "Çöp kutusuna taşınır.",
      "Sil",
      true,
    );
    if (!ok) return;
    await db.softDelete("maintenance_records", id, "Kullanıcı sildi");
    go("#/bakim");
  });
}

// ============ PERSONEL ============
async function personnel(ctx) {
  const sub = ctx.parts[1];
  const { root, db, names } = ctx;
  if (sub === "hareket") return personnelEventForm(ctx);
  if (sub) return personnelDetail(ctx, sub);
  const rows = (await db.getAll("personnel")).filter(isActive);
  const events = await db.getAll("personnel_events");
  root.innerHTML =
    appbar("Personel", `${rows.length} kişi`) +
    `
    <div style="height:10px"></div>
    <div data-list></div>
    <div class="row actionbar"><button class="btn" data-padd>+ Personel</button><button class="btn" data-go="#/izinler">🏖 İzinler</button><button class="btn" data-go="#/puantaj">📅 Puantaj / Maaş</button><button class="btn primary" data-go="#/personel/hareket">+ Hareket</button></div>`;
  qs("[data-list]", root).innerHTML = rows
    .map((p) => {
      const pending = events
        .filter(
          (e) =>
            isActive(e) && e.personnel_id === p.id && e.event_type === "Avans",
        )
        .reduce((s, e) => s + (Number(e.amount) || 0), 0);
      return li({
        ic: "👷",
        href: "#/personel/" + p.id,
        t1: esc(p.name),
        t2: esc(p.role || ""),
        badgeHtml: p.active === false ? badge("Pasif") : "",
        end: pending
          ? `<span class="badge warn">avans ${fmtTL(pending)} ₺</span>`
          : "",
      });
    })
    .join("");
  qs("[data-padd]", root).addEventListener("click", async () => {
    const name = await promptDialog("Yeni Personel", "Ad Soyad");
    if (!name) return;
    await db.saveNew("personnel", { name, active: true });
    ctx.reload();
  });
}

async function personnelDetail(ctx, id) {
  const { root, db, names } = ctx;
  const p = await db.get("personnel", id);
  if (!p) {
    root.innerHTML = appbar("Personel") + emptyState("👷", "Yok");
    return;
  }
  const [works, events, fuels, cashR, maints] = await Promise.all([
    db.getAll("work_records"),
    db.getAll("personnel_events"),
    db.getAll("fuel_records"),
    db.getAll("cash_records"),
    db.getAll("maintenance_records"),
  ]);
  const w = works.filter((x) => isActive(x) && x.personnel_id === id);
  const ev = events
    .filter((x) => isActive(x) && x.personnel_id === id)
    .sort((a, b) => (a.date < b.date ? -1 : 1));
  const fu = fuels.filter((x) => isActive(x) && x.personnel_id === id);
  const ca = cashR.filter((x) => isActive(x) && x.personnel_id === id);
  const ma = maints.filter((x) => isActive(x) && x.personnel_id === id);
  const pendingCash = ca
    .filter((c) => c.cash_status === "PERSONELDE")
    .reduce((s, c) => s + (Number(c.amount) || 0), 0);
  const saat = w
    .filter((x) => x.unit === "Saat")
    .reduce((s, x) => s + (Number(x.quantity) || 0), 0);
  const mesai = ev
    .filter((e) => e.event_type === "Mesai")
    .reduce((s, e) => s + (Number(e.hours_days) || 0), 0);
  const avans = ev
    .filter((e) => e.event_type === "Avans")
    .reduce((s, e) => s + (Number(e.amount) || 0), 0);

  root.innerHTML =
    appbar(p.name, p.role || "Personel") +
    `
    <div class="statgrid" style="margin-top:10px">
      ${stat(fmtNum(w.length), "İş")}${stat(fmtNum(saat), "Saat")}${stat(fmtNum(mesai), "Mesai")}${stat(fmtNum(fu.length), "Yakıt")}
      ${stat(fmtTL(avans), "Avans ₺", avans ? "warn" : "")}${stat(fmtTL(pendingCash), "Üzerinde ₺", pendingCash ? "danger" : "")}${stat(fmtNum(ma.length), "Arıza")}${stat(fmtNum(ev.length), "Hareket")}
    </div>
    <div class="section-title">Hareketler</div>
    ${
      ev.length
        ? `<div class="timeline">${ev
            .slice(-12)
            .reverse()
            .map(
              (e) =>
                `<div class="ti"><div class="small strong">${trDate(e.date)} · ${esc(e.event_type)}${e.amount ? " · " + fmtTL(e.amount) + " ₺" : ""}${e.hours_days ? " · " + fmtNum(e.hours_days) + " sa/gün" : ""}</div><div class="tiny muted">${esc(e.description || "")}</div></div>`,
            )
            .join("")}</div>`
        : emptyState("📋", "Hareket yok")
    }
    <div class="section-title">Son İşler</div>
    ${
      w.length
        ? w
            .slice(-5)
            .reverse()
            .map((x) =>
              li({
                ic: "⚒",
                href: "#/isler/" + x.id,
                t1: `${trDate(x.date)} · ${esc(x.work_type || "")}`,
                t2: esc(names.customers[x.customer_id] || ""),
              }),
            )
            .join("")
        : emptyState("⚒", "İş yok")
    }
    <div class="card tap" data-go="#/sofor-kur?pid=${id}"><div class="row between"><span>📲 Şoför bağlantısı — kendi telefonundan iş girsin</span><span class="muted small">›</span></div></div>
    <div class="actionbar"><button class="btn" data-go="#/izinler/${id}">🏖 İzin</button><button class="btn" data-go="#/puantaj/${id}">📅 Puantaj / Maaş</button><button class="btn primary" data-go="#/personel/hareket?pid=${id}">+ Hareket</button></div>`;
}

async function personnelEventForm(ctx) {
  const { root, db, query } = ctx;
  const personnelL = await db.listActive("personnel");
  root.innerHTML =
    appbar("+ Personel Hareketi", "Bordro değildir; saha takibidir") +
    `
    <form data-form novalidate>
      ${fDate("Tarih", "date", todayStr())}
      ${fSelect(
        "Personel",
        "personnel_id",
        personnelL.map((p) => ({ v: p.id, t: p.name })),
        query.pid || "",
        { req: true },
      )}
      ${fSelect("İşlem", "event_type", PERSONNEL_EVENT_TYPES, "Avans", { empty: false })}
      <div class="formgrid2">
        ${fNum("Tutar (₺, ops.)", "amount", "", { step: "any" })}
        ${fNum("Saat / Gün (ops.)", "hours_days", "", { step: "any" })}
      </div>
      ${fArea("Açıklama", "description", "")}
    </form>
    <div class="actionbar"><button class="btn primary" data-save>Kaydet</button></div>`;
  qs("[data-save]", root).addEventListener("click", async () => {
    const val = collectForm(qs("[data-form]", root));
    if (!val.personnel_id) {
      toast("Personel seçin", "err");
      return;
    }
    await db.saveNew(
      "personnel_events",
      {
        date: val.date,
        personnel_id: val.personnel_id,
        event_type: val.event_type,
        amount: val.amount ? Number(val.amount) : null,
        hours_days: val.hours_days ? Number(val.hours_days) : null,
        description: val.description || "",
      },
      "Personel hareketi",
    );
    toast("Kaydedildi", "ok");
    go("#/personel/" + val.personnel_id);
  });
}

// ============ TAŞERON ============
async function contractors(ctx) {
  const { root, db, names } = ctx;
  const sub = ctx.parts[1];
  const rows = (await db.getAll("contractors")).filter(isActive);
  if (sub) {
    const c = await db.get("contractors", sub);
    if (!c) {
      root.innerHTML = appbar("Taşeron") + emptyState("🤝", "Yok");
      return;
    }
    const works = (await db.getAll("work_records")).filter(
      (w) => isActive(w) && w.contractor_id === sub,
    );
    const sefer = works
      .filter((w) => w.unit === "Sefer")
      .reduce((s, w) => s + (Number(w.quantity) || 0), 0);
    const saat = works
      .filter((w) => w.unit === "Saat")
      .reduce((s, w) => s + (Number(w.quantity) || 0), 0);
    const yev = works
      .filter((w) => w.unit === "Yevmiye")
      .reduce((s, w) => s + (Number(w.quantity) || 0), 0);
    root.innerHTML =
      appbar(c.name, "Taşeron kartı") +
      `
      <div class="statgrid" style="margin-top:10px;grid-template-columns:repeat(3,1fr)">
        ${stat(fmtNum(sefer), "Sefer")}${stat(fmtNum(saat), "Saat")}${stat(fmtNum(yev), "Yevmiye")}
      </div>
      <div class="card">${kv("Araç/Plaka", (c.vehicle_text || "—") + (c.plate ? " / " + c.plate : ""))}${kv("Makine", c.machine || "—")}${kv("Telefon", c.phone || "—")}${c.note ? kv("Not", c.note) : ""}</div>
      <div class="section-title">Yaptığı İşler (mutabakat taslağı)</div>
      ${works.length ? works.map((w) => li({ ic: "⚒", href: "#/isler/" + w.id, t1: `${trDate(w.date)} · ${esc(w.work_type || "")}`, t2: esc(names.customers[w.customer_id] || ""), end: `<span class="amt nowrap">${fmtNum(w.quantity)} ${esc(w.unit || "")}</span>` })).join("") : emptyState("⚒", "İş bağlı değil — iş formunda taşeron seçilebilir")}
      <div class="tiny muted">Bu ekran local mutabakat taslağıdır; resmi hakediş değildir.</div>`;
    return;
  }
  root.innerHTML =
    appbar("Taşeronlar", `${rows.length} firma`) +
    `
    <div style="height:10px"></div>
    <div data-list></div>
    <div class="actionbar"><button class="btn primary" data-cadd>+ Taşeron</button></div>`;
  qs("[data-list]", root).innerHTML = rows.length
    ? rows
        .map((c) =>
          li({
            ic: "🤝",
            href: "#/taseron/" + c.id,
            t1: esc(c.name),
            t2: esc((c.vehicle_text || "") + (c.plate ? " · " + c.plate : "")),
          }),
        )
        .join("")
    : emptyState("🤝", "Taşeron yok");
  qs("[data-cadd]", root).addEventListener("click", async () => {
    const name = await promptDialog("Yeni Taşeron", "Firma adı");
    if (!name) return;
    const plate =
      (await promptDialog("Plaka (ops.)", "Plaka — boş geçilebilir")) || "";
    const created = await db.saveNew("contractors", {
      name,
      plate,
      active: true,
    });
    toast("Eklendi", "ok");
    go("#/taseron/" + created.id);
  });
}

// Mükerrer depo girişi: faturalı kaydın bilgisi/fotoğrafı elle girilen kayda geçer, faturalı kayıt silinir, borç tek kalır
async function mergeTankDup(db, ctx, { keep, drop }) {
  const { invoiceFieldsOf } = await import("./tank-match.js");
  const edb = await import("./enterprise-db.js");
  const d = await db.dumpAll();
  const billOf = (id) => (d.payables || []).find((b) => !b.deleted_at && b.status !== "İptal" && b.source_store === "fuel_tank_movements" && b.source_id === id);
  const bKeep = billOf(keep.id), bDrop = billOf(drop.id);
  if (bDrop) await edb.cancelPayable(bDrop.id, "Mükerrer depo girişi: elle girilen girişle birleştirildi");
  const f = invoiceFieldsOf(drop);
  if (bKeep) delete f.supplier_id;
  await db.saveExisting("fuel_tank_movements", await db.get("fuel_tank_movements", keep.id), f, "Faturalı girişle birleştirildi");
  for (const a of await db.attachmentsFor("tank", drop.id)) await db.addAttachment("tank", keep.id, a.blob, { kind: a.kind || "invoice" });
  await db.deleteTankIn(drop.id, "Mükerrer depo girişi (birleştirildi)");
  if (bDrop && !bKeep) {
    const { createCreditBill } = await import("./esnaf.js");
    const fresh = await db.dumpAll();
    await createCreditBill(ctx, fresh, fresh.suppliers.find((x) => x.id === bDrop.party_id),
      { date: keep.date, amount: Number(bDrop.gross_total), description: `Depoya yakıt ${keep.liters} L${drop.invoice_no ? " · fatura " + drop.invoice_no : ""}`, category: "Yakıt", vehicle_id: null, kdv_rate: null },
      { source: { store: "fuel_tank_movements", id: keep.id } });
  }
}

// Depo girişi ayrıntısı: fatura bilgisi + fatura fotoğrafı/PDF (aç, ekle)
async function tankInSheet(ctx, m) {
  const { db } = ctx;
  if (!m) return;
  const sup = m.supplier_id ? (await db.get("suppliers", m.supplier_id))?.name : "";
  const atts = await db.attachmentsFor("tank", m.id);
  const row = (k, v) => (v || v === 0 ? `<div class="row between small" style="padding:3px 0;border-bottom:1px solid var(--border)"><span class="muted">${k}</span><b style="text-align:right">${esc(String(v))}</b></div>` : "");
  const sh = sheet(`<h3>📥 Depo girişi · ${trDate(m.date)}</h3>
    ${row("Litre", fmtNum(m.liters) + " L")}${row("Litre fiyatı", m.unit_price ? fmtTL(m.unit_price) + " ₺" : "")}${row("Toplam (KDV dahil)", m.total ? fmtTL(m.total) + " ₺" : "")}
    ${row("KDV hariç", m.net_amount != null ? fmtTL(m.net_amount) + " ₺" : "")}${row("KDV", m.kdv_amount != null ? fmtTL(m.kdv_amount) + " ₺" : "")}
    ${row("Petrolcü", sup || m.company)}${row("Fatura no", m.invoice_no)}${row("İrsaliye no", m.irsaliye_no)}${row("ETTN", m.ettn)}${row("Satıcı VKN", m.seller_tax_no)}
    ${(m.items || []).length ? `<div class="tiny muted" style="margin-top:6px">Kalemler: ${m.items.map((i) => esc(`${i.desc || ""} ${i.qty ?? ""} ${i.unit || ""}`.trim())).join(" · ")}</div>` : ""}
    <div class="section-title">Fatura / fotoğraf (${atts.length})</div>
    <div data-att>${atts.map((a) => String(a.type).startsWith("image/")
      ? `<a href="${URL.createObjectURL(a.blob)}" target="_blank" rel="noopener"><img src="${URL.createObjectURL(a.blob)}" alt="fatura" style="width:100%;border-radius:8px;border:1px solid var(--border);margin-bottom:6px"></a>`
      : `<a class="btn block" href="${URL.createObjectURL(a.blob)}" target="_blank" rel="noopener">📄 ${esc(a.name || "Dosya")} — aç</a>`).join("") || '<div class="muted small">Fatura eklenmemiş.</div>'}</div>
    <div class="field" style="margin-top:8px"><label>Fatura fotoğrafı / PDF ekle</label><input type="file" accept="image/*,application/pdf" data-addf></div>
    <button class="btn block" data-x>Kapat</button>`, { modal: true });
  qs("[data-x]", sh).onclick = () => sheetClose();
  qs("[data-addf]", sh).addEventListener("change", async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    await db.addAttachment("tank", m.id, f, { kind: "invoice" });
    toast("Eklendi", "ok");
    tankInSheet(ctx, m);
  });
}
