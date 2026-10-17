// eLogo faturasını yükle: XML / ZIP (telefonda okunur) ya da PDF / fotoğraf (Gemini okur) → müşteri ve işlerle eşleştir → faturalandı.
import { qs, qsa, esc, toast, notice, todayStr, trDate, sheet, sheetClose } from "./ui.js";
import { parseUblInvoice, checkReadInvoice, matchInvoice } from "./invoice-import.js";
import { uninvoicedWorks, workNet } from "./invoice-core.js";

const tl = (n) => (n == null ? "—" : Number(n).toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " ₺");
const SYSTEM = "Bu bir Türk e-Arşiv / e-Fatura belgesi. Yalnız JSON döndür: {\"text\":faturadaki tüm yazı (satır satır, rakamlar aynen),\"invoice_no\",\"date\":YYYY-MM-DD,\"ettn\",\"buyer_tax_no\":ALICININ VKN/TCKN (satıcınınki değil),\"buyer_name\":alıcı ünvanı,\"net\":mal/hizmet toplamı (KDV hariç),\"kdv\":hesaplanan KDV,\"withheld\":KDV tevkifatı (yoksa 0),\"total\":vergiler dahil toplam,\"payable\":ödenecek tutar}. Rakamları belgede yazdığı gibi oku; yoksa null.";

// file → okunmuş fatura (+ ek olarak saklanacak dosya)
export async function readInvoiceFile(db, file) {
  const name = String(file.name || "").toLowerCase();
  const buf = new Uint8Array(await file.arrayBuffer());
  const asText = () => new TextDecoder("utf-8").decode(buf);
  if (name.endsWith(".zip") || (buf[0] === 0x50 && buf[1] === 0x4b)) {
    const { listZip, readEntry } = await import("./unzip.js");
    const es = listZip(buf);
    const x = es.find((e) => /\.xml$/i.test(e.name));
    const pdf = es.find((e) => /\.pdf$/i.test(e.name));
    const keep = pdf ? new File([await readEntry(buf, pdf)], pdf.name.split("/").pop(), { type: "application/pdf" }) : file;
    if (x) { const inv = parseUblInvoice(new TextDecoder("utf-8").decode(await readEntry(buf, x))); if (inv) return { inv, file: keep }; }
    if (pdf) return readInvoiceFile(db, keep);
    throw new Error("ZIP içinde fatura (XML/PDF) bulunamadı");
  }
  if (name.endsWith(".xml") || /^\s*(<\?xml|<)/.test(asText().slice(0, 200))) {
    const inv = parseUblInvoice(asText());
    if (!inv) throw new Error("XML bir e-fatura değil");
    return { inv, file };
  }
  // PDF / fotoğraf: Gemini
  const { withModelFallback, geminiJson, blobToBase64 } = await import("./ai-gemini.js");
  const mime = file.type || (name.endsWith(".pdf") ? "application/pdf" : "image/jpeg");
  const part = { inlineData: { mimeType: mime, data: await blobToBase64(file) } };
  const x = await withModelFallback(db, (o) => geminiJson([part, { text: "Faturayı oku." }], { ...o, system: SYSTEM, maxTokens: 8192 }));
  return { inv: checkReadInvoice(x, x?.text || ""), file };
}

export function openImport(ctx) {
  const { db } = ctx;
  const sh = sheet(`<h3>📥 eLogo faturasını yükle</h3>
    <div class="small muted" style="margin-bottom:8px">eLogo'da faturayı açıp <b>Paylaş / İndir</b> deyin; XML ya da PDF dosyasını burada seçin. XML telefonda okunur; PDF ve fotoğrafı Gemini okur.</div>
    <div class="field"><input type="file" accept=".xml,.zip,application/pdf,image/*,text/xml,application/xml,application/zip" data-ifile></div>
    <div data-iout></div>
    <div class="row" style="gap:8px;margin-top:8px"><button class="btn ghost grow" data-x>Kapat</button></div>`, { modal: true });
  qs("[data-x]", sh).onclick = () => sheetClose();
  qs("[data-ifile]", sh).addEventListener("change", async (ev) => {
    const f = ev.target.files?.[0];
    if (!f) return;
    const out = qs("[data-iout]", sh);
    out.innerHTML = '<div class="muted small">Okunuyor…</div>';
    try {
      const { inv, file } = await readInvoiceFile(db, f);
      const d = await db.dumpAll();
      render(out, d, inv, file);
    } catch (e) { out.innerHTML = notice("err", e.message || String(e)); }
  });
  const render = (out, d, inv, file, cid = null) => {
    const m = cid ? matchInvoice(d, { ...inv, buyer_tax_no: (d.customers || []).find((c) => c.id === cid)?.tax_no || "", buyer_name: (d.customers || []).find((c) => c.id === cid)?.name || "" }) : matchInvoice(d, inv);
    const custs = (d.customers || []).filter((c) => !c.deleted_at && !c.internal).sort((a, b) => a.name.localeCompare(b.name, "tr"));
    const cand = m.customer ? uninvoicedWorks(d, { customerId: m.customer.id }) : [];
    const vn = (id) => (d.vehicles || []).find((v) => v.id === id)?.name || "";
    const dup = (d.documents || []).some((x) => !x.deleted_at && x.category === "Fatura" && x.doc_no === inv.invoice_no);
    out.innerHTML = `
      <div class="card" style="margin:6px 0">
        <div class="row between"><b>${esc(inv.invoice_no || "no okunamadı")}</b><span class="small">${inv.date ? trDate(inv.date) : ""}</span></div>
        <div class="small">${esc(inv.buyer_name || "")}${inv.buyer_tax_no ? " · " + esc(inv.buyer_tax_no) : ""}</div>
        <div class="small" style="margin-top:4px">KDV hariç ${tl(inv.net)} · KDV ${tl(inv.kdv)}${inv.withheld ? ` · tevkifat ${tl(inv.withheld)}` : ""} · <b>ödenecek ${tl(inv.payable)}</b></div>
        ${inv.ettn ? `<div class="tiny muted">ETTN ${esc(inv.ettn)}</div>` : ""}
      </div>
      ${dup ? notice("warn", "Bu fatura numarası zaten kayıtlı.") : ""}
      ${(inv.issues || []).map((x) => notice("warn", x)).join("")}
      ${m.issues.map((x) => notice(m.exact ? "info" : "warn", x)).join("")}
      ${m.exact ? notice("ok", `Faturasız ${m.works.length} işin toplamı faturayla tutuyor.`) : ""}
      <div class="field"><label>Müşteri</label><select data-cust><option value="">— seçin —</option>${custs.map((c) => `<option value="${esc(c.id)}" ${c.id === m.customer?.id ? "selected" : ""}>${esc(c.name)}</option>`).join("")}</select></div>
      ${cand.length ? `<div class="small" style="margin:4px 0"><b>Faturalanacak işler</b></div>${cand.map((w) => `<label class="history-check small" style="padding:3px 0"><input type="checkbox" data-iw="${esc(w.id)}" ${m.works.includes(w.id) ? "checked" : ""}> ${trDate(w.date)} · ${esc(vn(w.vehicle_id))} · ${esc(w.work_type || "")} ${Number(w.quantity).toLocaleString("tr-TR")} ${esc(String(w.unit || "").toLocaleLowerCase("tr-TR"))} · ${tl(workNet(w).net)}</label>`).join("")}
        <div class="tiny muted" data-isum></div>` : ""}
      <button class="btn primary block" data-isave style="margin-top:8px" ${inv.invoice_no && m.customer && !dup ? "" : "disabled"}>✓ Faturalandı olarak kaydet</button>`;
    const sumEl = qs("[data-isum]", out);
    const upd = () => { if (!sumEl) return; const s = qsa("[data-iw]", out).filter((x) => x.checked).reduce((n, x) => n + workNet(cand.find((w) => w.id === x.dataset.iw)).net, 0); sumEl.textContent = `Seçilen: ${tl(s)}${inv.net != null ? ` · fatura: ${tl(inv.net)}${Math.abs(s - inv.net) < 1 ? " ✓" : " — fark " + tl(inv.net - s)}` : ""}`; };
    for (const x of qsa("[data-iw]", out)) x.addEventListener("change", upd);
    upd();
    qs("[data-cust]", out).addEventListener("change", (e) => render(out, d, inv, file, e.target.value || null));
    qs("[data-isave]", out)?.addEventListener("click", async (e) => {
      const b = e.currentTarget; b.disabled = true;
      const c = m.customer;
      const ids = qsa("[data-iw]", out).filter((x) => x.checked).map((x) => x.dataset.iw);
      try {
        const doc = { category: "Fatura", owner_type: "customer", owner_id: c.id, customer_id: c.id, date: inv.date || todayStr(), doc_no: inv.invoice_no, title: "Fatura", amount: inv.payable ?? inv.total ?? null, ettn: inv.ettn || null,
          note: `eLogo · KDV hariç ${tl(inv.net)} · KDV ${tl(inv.kdv)}${inv.withheld ? " · tevkifat " + tl(inv.withheld) : ""} · ${ids.length} iş` };
        const rec = file ? await db.saveDocument(doc, file) : await db.saveNew("documents", doc, "eLogo faturası");
        for (const id of ids) { const w = await db.get("work_records", id); if (w) await db.saveExisting("work_records", w, { invoice_no: inv.invoice_no, invoice_date: doc.date, invoice_doc_id: rec?.id || null, invoice_ettn: inv.ettn || null }, "Faturalandı (eLogo)"); }
        if (inv.buyer_tax_no && !String(c.tax_no || "").replace(/\D/g, "")) await db.saveExisting("customers", c, { tax_no: inv.buyer_tax_no, ...(inv.buyer_name && !c.tax_title ? { tax_title: inv.buyer_name } : {}) }, "Faturadan vergi no");
        sheetClose(); toast(`Fatura ${inv.invoice_no} kaydedildi · ${ids.length} iş faturalandı`, "ok"); ctx.reload();
      } catch (err) { toast(err.message || String(err), "err"); b.disabled = false; }
    });
  };
}
