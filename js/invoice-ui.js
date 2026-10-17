// Faturalanacaklar (#/fatura, #/fatura/{müşteri}): faturası kesilmemiş işler, eLogo'ya girilecek kalemler, "faturayı kestim".
import { qs, qsa, esc, appbar, toast, notice, todayStr, trDate, sheet, sheetClose } from "./ui.js";
import { invoiceQueue, invoiceDraft, draftText, uninvoicedWorks, WITHHOLDING } from "./invoice-core.js";

const tl = (n) => Number(n || 0).toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " ₺";

export async function screen(ctx) {
  if (ctx.parts[0] !== "fatura") return false;
  const { root, db } = ctx;
  const today = todayStr();
  const d = await db.dumpAll();
  const cid = ctx.parts[1];

  if (!cid) {
    const Q = invoiceQueue(d, { today });
    const done = (d.documents || []).filter((x) => !x.deleted_at && x.category === "Fatura").sort((a, b) => String(b.date).localeCompare(String(a.date))).slice(0, 10);
    const cn = (id) => (d.customers || []).find((c) => c.id === id)?.name || "";
    root.innerHTML = appbar("Faturalanacaklar", "Faturası kesilmemiş işler · eLogo'ya hazır") + `
      <div style="height:10px"></div>
      <button class="btn primary block" data-import style="margin-bottom:8px">📥 eLogo'da kestiğim faturayı yükle (XML / PDF)</button>
      ${Q.length ? Q.map((q) => `<div class="card tap" data-go="#/fatura/${esc(q.customer.id)}" style="border-left:4px solid ${q.oldestDays > 7 ? "#e0a030" : "#2e9e6b"}">
        <div class="row between"><b>${esc(q.customer.name)}</b><b>${tl(q.net)}</b></div>
        <div class="tiny muted">${q.n} iş · en eski ${trDate(q.oldest)} (${q.oldestDays} gün) · KDV hariç${q.missing.length ? ` · <span style="color:#d9534f">eksik: ${esc(q.missing.join(", "))}</span>` : ""}</div></div>`).join("") : notice("ok", "Faturası kesilmemiş fiyatlı iş yok.")}
      ${done.length ? `<div class="section-title">Son kesilen faturalar</div>` + done.map((x) => `<div class="card" style="padding:8px 12px"><div class="row between small"><span>${trDate(x.date)} · ${esc(cn(x.customer_id || x.owner_id))}</span><b>${tl(x.amount)}</b></div><div class="tiny muted">${esc(x.doc_no || "")}</div></div>`).join("") : ""}
      <div class="tiny muted" style="margin:8px 4px 0">eLogo'da faturayı kestikten sonra XML ya da PDF'ini buraya yükleyin: numara, tarih, tutar okunur, müşteri ve işler bulunur, "faturalandı" işaretlenir.</div>
      <div class="tiny muted" style="margin:8px 4px 80px">Mal satışında (malzeme) fatura teslimden itibaren en geç 7 gün içinde kesilmelidir. Hizmet faturalarının zamanlamasını ve tevkifat oranlarını mali müşavirinize teyit ettirin. Uygulama faturayı kesmez; bilgileri eLogo'ya girmeniz için hazırlar.</div>`;
    qs("[data-import]", root).addEventListener("click", async () => (await import("./invoice-import-ui.js")).openImport(ctx));
    return true;
  }

  const c = (d.customers || []).find((x) => x.id === cid);
  if (!c) { root.innerHTML = appbar("Fatura") + notice("err", "Müşteri bulunamadı"); return true; }
  const all = uninvoicedWorks(d, { customerId: cid });
  const pick = new Set((ctx.query.w ? String(ctx.query.w).split(",") : all.map((w) => w.id)).filter((id) => all.some((w) => w.id === id)));
  const F = invoiceDraft(d, cid, { workIds: [...pick] });
  const nm = (s, id) => (id ? (d[s] || []).find((x) => x.id === id)?.name || "" : "");
  const u = (x) => String(x || "").toLocaleLowerCase("tr-TR");
  root.innerHTML = appbar(c.name, "Fatura hazırlık") + `
    <div style="height:10px"></div>
    <div class="card">
      <div class="row between"><b>Alıcı bilgileri</b><button class="btn sm" data-info>Düzenle</button></div>
      <div class="small" style="margin-top:4px">${esc(c.tax_title || c.name)}<br><span class="muted">VKN/TCKN:</span> ${esc(c.tax_no || "—")} ${c.tax_office ? "· V.D. " + esc(c.tax_office) : ""}<br><span class="muted">Adres:</span> ${esc(c.address || "—")}<br><span class="muted">KDV tevkifatı:</span> ${esc(c.kdv_withholding || "Yok")}</div>
      ${F.missing.length ? notice("warn", "Eksik: " + F.missing.join(", ") + " — faturadan önce tamamlayın.") : ""}
    </div>
    <div class="section-title">Fatura kalemleri (${F.lines.length})</div>
    ${F.lines.map((l, i) => `<div class="card" style="padding:10px 12px"><div class="small"><b>${i + 1}) ${esc(l.desc)}</b></div>
      <div class="row between small" style="margin-top:3px"><span>${l.qty.toLocaleString("tr-TR")} ${esc(u(l.unit))} × ${tl(l.unitPrice)}</span><b>${tl(l.net)}</b></div><div class="tiny muted">KDV %${l.rate} · ${l.works.length} iş</div></div>`).join("") || notice("info", "Seçili iş yok.")}
    <div class="card">
      <div class="row between small"><span>Mal / hizmet toplamı (KDV hariç)</span><b>${tl(F.net)}</b></div>
      <div class="row between small"><span>KDV</span><b>${tl(F.kdv)}</b></div>
      ${F.withheld ? `<div class="row between small"><span>KDV tevkifatı (${esc(F.withholding)})</span><b>−${tl(F.withheld)}</b></div>` : ""}
      <div class="row between" style="margin-top:4px;border-top:1px solid var(--border);padding-top:4px"><span>Ödenecek</span><b>${tl(F.payable)}</b></div>
    </div>
    <details class="card"><summary class="small"><b>Faturaya girecek işler (${pick.size}/${all.length})</b> — çıkarmak istediğinizin işaretini kaldırın</summary>
      ${all.map((w) => `<label class="history-check small" style="padding:4px 0"><input type="checkbox" data-w="${esc(w.id)}" ${pick.has(w.id) ? "checked" : ""}> ${trDate(w.date)} · ${esc(nm("vehicles", w.vehicle_id))} · ${esc(w.work_type || "")} ${Number(w.quantity).toLocaleString("tr-TR")} ${esc(u(w.unit))}${w.slip_no ? " · fiş " + esc(w.slip_no) : ""}</label>`).join("")}
    </details>
    <div style="height:70px"></div>
    <div class="actionbar">
      <button class="btn" data-copy>📋 Kopyala</button>
      <button class="btn primary" data-done ${F.lines.length ? "" : "disabled"}>✓ Faturayı kestim</button>
    </div>`;

  for (const cb of qsa("[data-w]", root))
    cb.addEventListener("change", () => ctx.go(`#/fatura/${cid}?w=${qsa("[data-w]", root).filter((x) => x.checked).map((x) => x.dataset.w).join(",") || "-"}`));
  qs("[data-copy]", root).addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(draftText(F)); toast("Kopyalandı — eLogo'da yapıştırarak bakabilirsiniz", "ok"); }
    catch { const { shareText } = await import("./ui.js"); await shareText(draftText(F)); }
  });
  qs("[data-info]", root).addEventListener("click", () => {
    const sh = sheet(`<h3>Alıcı bilgileri</h3>
      <div class="field"><label>Ticari ünvan (faturadaki)</label><input data-f="tax_title" value="${esc(c.tax_title || c.name)}"></div>
      <div class="formgrid2"><div class="field"><label>VKN / TCKN</label><input data-f="tax_no" inputmode="numeric" value="${esc(c.tax_no || "")}"></div>
      <div class="field"><label>Vergi dairesi</label><input data-f="tax_office" value="${esc(c.tax_office || "")}"></div></div>
      <div class="field"><label>Adres</label><input data-f="address" value="${esc(c.address || "")}"></div>
      <div class="formgrid2"><div class="field"><label>E-posta</label><input data-f="email" value="${esc(c.email || "")}"></div>
      <div class="field"><label>KDV tevkifatı</label><select data-f="kdv_withholding">${WITHHOLDING.map((x) => `<option ${x === (c.kdv_withholding || "Yok") ? "selected" : ""}>${x}</option>`).join("")}</select></div></div>
      <div class="tiny muted" style="margin-bottom:8px">Tevkifat oranını mali müşavirinize sorun (ör. bazı alıcılara nakliyede 2/10).</div>
      <div class="row" style="gap:8px"><button class="btn ghost grow" data-x>Vazgeç</button><button class="btn primary grow" data-ok>Kaydet</button></div>`, { modal: true });
    qs("[data-x]", sh).onclick = () => sheetClose();
    qs("[data-ok]", sh).onclick = async () => {
      const f = {}; for (const el of qsa("[data-f]", sh)) f[el.dataset.f] = el.value.trim() || null;
      await db.saveExisting("customers", c, f, "Fatura bilgileri"); sheetClose(); ctx.reload();
    };
  });
  qs("[data-done]", root).addEventListener("click", () => {
    const sh = sheet(`<h3>Faturayı kestim</h3>
      <div class="formgrid2"><div class="field"><label>Fatura no</label><input data-no placeholder="ör. GIB2026000000123"></div>
      <div class="field"><label>Fatura tarihi</label><input type="date" data-dt value="${today}"></div></div>
      <div class="field"><label>Fatura PDF / görüntü (isteğe bağlı)</label><input type="file" accept="application/pdf,image/*" data-file></div>
      <div class="small" style="margin:6px 0">${F.works.length} iş "faturalandı" işaretlenir · ${tl(F.payable)}</div>
      <div class="row" style="gap:8px"><button class="btn ghost grow" data-x>Vazgeç</button><button class="btn primary grow" data-ok>Kaydet</button></div>`, { modal: true });
    qs("[data-x]", sh).onclick = () => sheetClose();
    qs("[data-ok]", sh).onclick = async () => {
      const no = qs("[data-no]", sh).value.trim(), date = qs("[data-dt]", sh).value || today;
      if (no.length < 3) return toast("Fatura numarasını yazın", "err");
      const file = qs("[data-file]", sh).files?.[0] || null;
      const doc = { category: "Fatura", owner_type: "customer", owner_id: cid, customer_id: cid, date, doc_no: no, title: "Fatura", amount: F.payable,
        note: `KDV hariç ${tl(F.net)} · KDV ${tl(F.kdv)}${F.withheld ? ` · tevkifat ${tl(F.withheld)}` : ""} · ${F.works.length} iş` };
      try {
        const rec = file ? await db.saveDocument(doc, file) : await db.saveNew("documents", doc, "Fatura kesildi");
        for (const id of F.works) { const w = await db.get("work_records", id); if (w) await db.saveExisting("work_records", w, { invoice_no: no, invoice_date: date, invoice_doc_id: rec?.id || null }, "Faturalandı"); }
        sheetClose(); toast(`${F.works.length} iş faturalandı`, "ok"); ctx.go("#/fatura");
      } catch (e) { toast(e.message || String(e), "err"); }
    };
  });
  return true;
}
