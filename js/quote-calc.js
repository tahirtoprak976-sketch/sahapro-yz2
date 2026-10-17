// Teklif Asistanı (#/teklif-hesap): telefonda fiyat sorulunca — maliyet, geçmiş fiyatlar, önerilen fiyat, zarar sınırı.
// "Teklif oluştur" mevcut Teklifler kaydını (PDF'li) hazırlar. Hesap quote-core.js'te (saf); Gemini yalnız formu doldurur / yorum yazar.
import { qs, qsa, esc, appbar, toast, notice, fmtNum, todayStr, trDate, shareText } from "./ui.js";
import { isActive, WORK_TYPES } from "./core.js";

const SETTINGS = "quote_settings";
const tl = (n) => (n == null ? "—" : Math.round(n).toLocaleString("tr-TR") + " ₺");
const UNITS = ["Sefer", "Ton", "Saat", "Yevmiye"];

export async function screen(ctx) {
  if (ctx.parts[0] !== "teklif-hesap") return false;
  const { root, db } = ctx;
  const core = await import("./quote-core.js");
  const [d, settings0, fuelRef] = await Promise.all([db.dumpAll(), db.metaGet(SETTINGS), db.metaGet("fuel_ref_price")]);
  const settings = settings0 || {};
  const today = todayStr();
  const live = (s) => (d[s] || []).filter(isActive);
  const customers = live("customers").filter((c) => !c.internal).sort((a, b) => a.name.localeCompare(b.name, "tr"));
  const vehicles = live("vehicles");
  const dumps = live("dump_sites");
  const qp = new URLSearchParams(location.hash.split("?")[1] || "");
  const st = { customer_id: qp.get("customer_id") || "", new_customer: "", work_type: "Hafriyat Nakliye", unit: "Sefer", quantity: "", vehicle_id: "", dump_site_id: "", dump_included: true, place: "", fuel_l: "", fuel_price: "", extra: "", margin: settings.margin ?? core.QUOTE_DEFAULTS.margin };
  const opt = (rows, val, empty) => `<option value="">${esc(empty)}</option>` + rows.map(([v, t]) => `<option value="${esc(v)}" ${String(v) === String(val) ? "selected" : ""}>${esc(t)}</option>`).join("");
  const feeTxt = (s) => (s.own_yard ? " (kendi depo)" : Number(s.fee) > 0 ? ` · ${fmtNum(s.fee)} ₺/${(s.fee_unit || "Ton").toLocaleLowerCase("tr-TR")}` : " · ücret yok");

  root.innerHTML =
    appbar("Teklif Asistanı", "fiyat verirken maliyet + geçmiş fiyat") +
    `<div style="height:10px"></div>
    <div class="card">
      <div class="field"><label>🎤 Anlatın (isteğe bağlı) — Gemini formu doldurur</label><textarea data-msg rows="2" placeholder="Ör: Ahmet Yapı Kağıthane'den Bolluca'ya 20 sefer hafriyat soruyor, 34GAM627 ile"></textarea></div>
      <button class="btn block" data-fill>🤖 Formu doldur</button><div data-fillout></div>
    </div>
    <div class="card" data-form>
      <div class="field"><label>Müşteri</label><select name="customer_id">${opt(customers.map((c) => [c.id, c.name]), st.customer_id, "— yeni / seçilmedi —")}</select></div>
      <div class="field" data-newc><label>Yeni müşteri adı (kayıtta yoksa)</label><input name="new_customer" placeholder="Teklif oluştururken kart açılır"></div>
      <div class="formgrid2">
        <div class="field"><label>İş türü</label><select name="work_type">${opt(WORK_TYPES.map((x) => [x, x]), st.work_type, "—")}</select></div>
        <div class="field"><label>Birim</label><select name="unit">${UNITS.map((u) => `<option ${u === st.unit ? "selected" : ""}>${u}</option>`).join("")}</select></div>
        <div class="field"><label>Miktar (tahmini)</label><input type="number" step="any" name="quantity" inputmode="decimal" placeholder="ör. 20"></div>
        <div class="field"><label>Araç / makine</label><select name="vehicle_id">${opt(vehicles.map((v) => [v.id, v.name + (v.type ? " · " + v.type : "")]), "", "— seç —")}</select></div>
        <div class="field"><label>Döküm yeri</label><select name="dump_site_id">${opt(dumps.map((s) => [s.id, s.name + feeTxt(s)]), "", "— yok —")}</select></div>
        <div class="field"><label>Yer / şantiye (teklifte görünür)</label><input name="place" placeholder="ör. Kağıthane"></div>
      </div>
      <label class="row small" style="gap:8px;margin:4px 0"><input type="checkbox" name="dump_included" checked> Döküm ücreti fiyata dahil</label>
      <details style="margin-top:6px" ${Object.values(settings.extra || {}).some((x) => Number(x) > 0) ? "" : "open"}><summary class="small strong">⚙ Maliyet ayarları (mazot, şoför, kâr payı)</summary>
        <div class="formgrid2" style="margin-top:6px">
          <div class="field"><label data-fuel-l-label>Mazot (L / birim)</label><input type="number" step="any" name="fuel_l" inputmode="decimal"></div>
          <div class="field"><label>Mazot litre fiyatı (₺)</label><input type="number" step="any" name="fuel_price" inputmode="decimal"></div>
          <div class="field"><label>Diğer maliyet (₺ / birim): şoför, lastik, yıpranma</label><input type="number" step="any" name="extra" inputmode="decimal"></div>
          <div class="field"><label>Kâr payı (%)</label><input type="number" step="any" name="margin" value="${esc(st.margin)}" inputmode="decimal"></div>
        </div>
        <button class="btn sm ghost" data-savedef>Diğer maliyet ve kâr payını varsayılan yap</button>
      </details>
    </div>
    <div data-result></div>
    <div data-advice></div>
    <div class="actionbar" style="flex-wrap:wrap;gap:6px">
      <button class="btn primary grow" data-create>📄 Teklif oluştur</button>
      <button class="btn grow" data-share>📤 WhatsApp</button>
      <button class="btn grow" data-adv>🤖 Yorumla</button>
    </div>`;

  const form = qs("[data-form]", root);
  const el = (n) => qs(`[name=${n}]`, form);
  let last = null;
  const read = () => {
    const f = {};
    for (const k of ["customer_id", "new_customer", "work_type", "unit", "quantity", "vehicle_id", "dump_site_id", "place", "fuel_l", "fuel_price", "extra", "margin"]) f[k] = el(k).value;
    f.dump_included = el("dump_included").checked;
    f.quantity = Number(f.quantity) || 0;
    f.margin = f.margin === "" ? undefined : Number(f.margin);
    return f;
  };
  const render = () => {
    const f = read();
    qs("[data-newc]", root).style.display = f.customer_id ? "none" : "";
    const q = core.quoteFor(d, f, { today, settings, fuelRefPrice: fuelRef });
    last = q;
    const c = q.calc, h = q.history, u = c.unit.toLocaleLowerCase("tr-TR");
    // Boş alanlarda kayıtlardan gelen değeri göster
    el("fuel_l").placeholder = q.fuelInfo ? `${fmtNum(q.fuelInfo.per)} (kayıtlardan)` : "kayıt yok — yazın";
    el("fuel_price").placeholder = q.fuelPriceKnown ? `${fmtNum(q.fuelPriceKnown)} (depo alışı)` : "yazın";
    el("extra").placeholder = settings.extra?.[c.unit] ? `${fmtNum(settings.extra[c.unit])} (varsayılan)` : "0";
    qs("[data-fuel-l-label]", root).textContent = `Mazot (L / ${u})`;
    const row = (l, v, sub = "", style = "") => `<div class="row between small" style="margin:3px 0;${style}"><span>${l}${sub ? `<br><span class="muted tiny">${sub}</span>` : ""}</span><b style="white-space:nowrap;margin-left:8px">${v}</b></div>`;
    const warnHtml = c.warns.map((w) => `<div class="tiny" style="margin-top:4px;color:${w.kind === "alert" ? "#d9534f" : w.kind === "warn" ? "#b9770e" : "var(--muted)"}">${w.kind === "info" ? "ℹ" : "⚠"} ${esc(w.text)}</div>`).join("");
    qs("[data-result]", root).innerHTML = `
      <div class="card" style="border-left:4px solid #f5a623">
        <div class="muted tiny">ÖNERİLEN FİYAT (KDV dahil)</div>
        <div style="font-size:28px;font-weight:800;line-height:1.2">${c.suggest ? tl(c.suggest) + ` <span class="small muted">/ ${u}</span>` : "—"}</div>
        ${c.suggest ? `<div class="small muted">KDV hariç ${tl(c.suggestNet)} · ${esc(c.why)}</div>` : '<div class="small muted">Maliyet ya da geçmiş fiyat bulunamadı; aşağıdan mazot / diğer maliyeti girin.</div>'}
        ${c.total ? `<div class="small" style="margin-top:4px">${fmtNum(c.qty)} ${u} → toplam <b>${tl(c.total)}</b>${c.profitTotal != null ? ` · tahmini kâr <b style="color:${c.profitTotal < 0 ? "#d9534f" : "#2e9e6b"}">${tl(c.profitTotal)}</b>` : ""}</div>` : ""}
        ${warnHtml}
      </div>
      <div class="card"><div class="strong small">Maliyet (1 ${u})</div>
        ${row("Döküm", c.cost.dump ? tl(c.cost.dump) : f.dump_included === false ? "hariç" : "—", q.dumpInfo ? esc(q.dumpInfo.site + " · " + (q.dumpInfo.basis || q.dumpInfo.why || "")) : "")}
        ${row("Mazot", c.cost.fuel ? tl(c.cost.fuel) : "—", q.input.fuel_l ? `${fmtNum(q.input.fuel_l)} L × ${q.input.fuel_price ? fmtNum(q.input.fuel_price) + " ₺" : "?"}${!f.fuel_l && q.fuelInfo ? " · " + esc(q.fuelInfo.basis) : ""}` : "")}
        ${row("Şoför / lastik / yıpranma", c.cost.extra ? tl(c.cost.extra) : "—")}
        <div class="divider"></div>
        ${row("<b>Zarar sınırı (en az)</b>", c.floor ? tl(c.floor) : "—", "bunun altı zarar")}
      </div>
      <div class="card"><div class="strong small">Geçmiş fiyatlar (${esc(f.work_type || "tüm işler")} / ${u}, son 1 yıl)</div>
        ${h.customer ? row("Bu müşteriye son", tl(h.customer.last), `${trDate(h.customer.last_date)} · ${h.customer.n} kayıt, ortalama ${tl(h.customer.avg)}`) : f.customer_id ? '<div class="muted tiny">Bu müşteriye bu işte fiyatlı kayıt yok.</div>' : ""}
        ${h.all ? row("Herkese orta fiyat", tl(h.all.median), `${h.all.n} kayıt, ${h.all.customers} müşteri · en düşük ${tl(h.all.min)}, en yüksek ${tl(h.all.max)}`) : '<div class="muted tiny">Bu iş türü ve birimde fiyatlı kayıt yok.</div>'}
        ${h.others.map((o) => row(esc(o.name), tl(o.price), o.n + " kayıt", "opacity:.85")).join("")}
      </div>`;
  };
  form.addEventListener("input", render);
  form.addEventListener("change", render);
  render();

  qs("[data-savedef]", root).addEventListener("click", async () => {
    const f = read(), s = { ...settings, extra: { ...(settings.extra || {}) } };
    if (f.extra !== "") s.extra[f.unit] = Number(f.extra) || 0;
    if (f.margin != null && Number.isFinite(f.margin)) s.margin = f.margin;
    await db.metaSet(SETTINGS, s);
    Object.assign(settings, s);
    toast(`Varsayılan kaydedildi (${f.unit})`, "ok");
    render();
  });

  // Gemini: serbest anlatımdan form (ad ve sayılar mesajda geçmeli)
  qs("[data-fill]", root).addEventListener("click", async (ev) => {
    const msg = qs("[data-msg]", root).value.trim();
    const out = qs("[data-fillout]", root);
    if (!msg) return toast("Önce anlatın", "err");
    const b = ev.currentTarget; b.disabled = true; out.innerHTML = '<div class="muted small">Gemini okuyor…</div>';
    try {
      const { withModelFallback, geminiJson } = await import("./ai-gemini.js");
      const { numbersInText } = await import("./ai-assist.js");
      const pr = await import("./price-rule-core.js");
      const NS = { type: ["string", "null"] }, NN = { type: ["number", "null"] };
      const list = (rows) => rows.map((r) => `${r.id}=${r.name}`).join("; ");
      const raw = await withModelFallback(db, (o) => geminiJson([{ text: msg }], { ...o, maxTokens: 1024,
        schema: { type: "object", properties: { customer_id: NS, new_customer: NS, work_type: NS, unit: NS, quantity: NN, vehicle_id: NS, dump_site_id: NS, place: NS } },
        system: [
          "Hafriyat/nakliye işletmesinde müşteri fiyat soruyor. Mesajdan teklif formunu doldur. Yalnız JSON.",
          "customer_id: müşteri listesinde varsa ID; yoksa new_customer = mesajdaki ad. vehicle_id / dump_site_id: listede varsa ID.",
          `work_type şunlardan biri: ${WORK_TYPES.join(", ")}. unit: Sefer | Ton | Saat | Yevmiye. quantity: mesajda yazan miktar. place: işin yeri (semt/şantiye).`,
          "Mesajda olmayan bilgiyi uydurma, null bırak.",
          "Müşteriler: " + list(customers), "Araçlar: " + list(vehicles), "Döküm yerleri: " + list(dumps),
        ].join("\n") }));
      const v = core.validateQuoteFill(raw, { d, message: msg, numbers: numbersInText(msg), named: { customer: pr.customerNamed, vehicle: pr.vehicleNamedIn, place: pr.placeNamed } });
      const F = v.fill;
      if (F.customer_id) el("customer_id").value = F.customer_id;
      else if (F.new_customer) { el("customer_id").value = ""; el("new_customer").value = F.new_customer; }
      if (F.work_type && WORK_TYPES.includes(F.work_type)) el("work_type").value = F.work_type;
      if (F.unit) el("unit").value = F.unit;
      if (F.quantity) el("quantity").value = F.quantity;
      if (F.vehicle_id) el("vehicle_id").value = F.vehicle_id;
      if (F.dump_site_id) el("dump_site_id").value = F.dump_site_id;
      if (F.place) el("place").value = F.place;
      render();
      out.innerHTML = notice(v.issues.length ? "warn" : "ok", v.issues.length ? "Dolduruldu; kontrol edin: " + v.issues.join(" · ") : "Dolduruldu — aşağıdan kontrol edin.");
    } catch (e) {
      out.innerHTML = notice("danger", String(e.message || e));
    }
    b.disabled = false;
  });

  qs("[data-create]", root).addEventListener("click", async () => {
    const f = read();
    if (!last?.calc.suggest) return toast("Önce fiyat çıksın (maliyet ya da geçmiş fiyat gerekli)", "err");
    let cid = f.customer_id;
    if (!cid) {
      if (!f.new_customer.trim()) return toast("Müşteri seçin ya da yeni müşteri adını yazın", "err");
      cid = (await db.saveNew("customers", { name: f.new_customer.trim(), note: "Teklif asistanından" }, "Teklif için müşteri")).id;
    }
    const rec = core.quoteRecord(d, { ...last, input: { ...last.input, customer_id: cid } }, { today });
    const no = await db.nextSeq("quote");
    const created = await db.saveNew("quotes", { ...rec, quote_no: no, status: "Taslak" }, "Teklif asistanı");
    toast("Teklif #" + String(no).padStart(4, "0") + " hazır — PDF için açın", "ok");
    location.hash = "#/teklif/" + created.id;
  });

  qs("[data-share]", root).addEventListener("click", () => {
    const f = read(), c = last?.calc;
    if (!c?.suggest) return toast("Önce fiyat çıksın", "err");
    const site = dumps.find((s) => s.id === f.dump_site_id);
    const u = c.unit.toLocaleLowerCase("tr-TR");
    const lines = [
      "Merhaba,",
      `${f.work_type || "Nakliye"}${f.place ? " (" + f.place + ")" : ""} için ${u} başı fiyatımız ${tl(c.suggest)} (KDV dahil).`,
      site && !site.own_yard ? `Döküm (${site.name}) ${f.dump_included ? "fiyata dahildir" : "fiyata dahil değildir"}.` : "",
      c.total ? `${fmtNum(c.qty)} ${u} için toplam ${tl(c.total)}.` : "",
      "Teklif 15 gün geçerlidir.",
    ].filter(Boolean);
    shareText(lines.join("\n"));
  });

  qs("[data-adv]", root).addEventListener("click", async (ev) => {
    const box = qs("[data-advice]", root), b = ev.currentTarget;
    if (!last) return;
    b.disabled = true; box.innerHTML = '<div class="muted small">Gemini düşünüyor…</div>';
    try {
      const { requestEvidenceReport } = await import("./evidence-report.js");
      const facts = core.quoteSummary(d, last);
      const text = await requestEvidenceReport(db, facts, "Teklif hesabında fiyat öncesi kontrol edilecek kanıtlar");
      box.innerHTML = `<div class="notice info" style="white-space:pre-wrap">${esc(text)}</div>`;
    } catch (e) {
      box.innerHTML = notice("danger", String(e.message || e));
    }
    b.disabled = false;
  });
  return true;
}
