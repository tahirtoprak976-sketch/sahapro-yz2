// Detaylı kayıt raporları ekranı (#/detayli-rapor?k=dokum&id=…&p=month|last|m3|year|all|custom&from=&to=&a=internal|customer)
// Bir kalem seçilir (döküm sahası, ocak, müşteri, şantiye, araç, personel, esnaf, taşeron, iş türü, malzeme, yakıt, gider, bakım),
// o kaleme ait her kayıt en ince ayrıntısıyla listelenir; kurumsal PDF / paylaş / CSV.
import { qs, qsa, esc, appbar, toast, notice, downloadBlob, todayStr, trDate } from "./ui.js";
import { COMPANY_NAME } from "./core.js";
import { REPORT_KINDS, kindOf, reportOptions, buildReport, forAudience, reportSpec, reportCsv } from "./report-core.js";
import { periodRange, PERIODS } from "./customer-report.js";

const SHOW = 60; // ekranda tablo başına ilk satırlar; PDF/CSV hepsini içerir

export async function screen(ctx) {
  if (ctx.parts[0] !== "detayli-rapor") return false;
  const { root, db, query } = ctx;
  const today = todayStr();
  const d = await db.dumpAll();
  const k = kindOf(query.k).k, K = kindOf(k);
  const opts = reportOptions(d, k);
  const id = opts.some((o) => o.id === query.id) ? query.id : "";
  const p = query.p || "month";
  const range = p === "custom" ? { from: query.from || "", to: query.to || today } : periodRange(p, today);
  const audience = query.a === "customer" ? "customer" : "internal";
  const href = (o) => {
    const q = { k, id, p, from: range.from, to: range.to, a: audience, ...o };
    return "#/detayli-rapor?" + Object.entries(q).filter(([, v]) => v !== "" && v != null).map(([a, b]) => a + "=" + encodeURIComponent(b)).join("&");
  };
  let R, err = "";
  try { R = forAudience(buildReport(d, { k, id, from: range.from, to: range.to, today }), audience); } catch (e) { err = e.message || String(e); }
  const company = (await db.metaGet("company_profile"))?.title || COMPANY_NAME;

  const table = (t, ti, all = false) => `<div class="card" style="padding:10px 8px">
      <div class="row between" style="margin:0 4px 6px"><b>${esc(t.title)}</b><span class="badge">${t.count ?? t.rows.length}</span></div>
      <div style="overflow-x:auto"><table class="rtable" style="width:100%;border-collapse:collapse;font-size:12px">
        <tr>${t.headers.map((h) => `<th style="text-align:left;padding:6px;border-bottom:2px solid var(--border2);color:var(--muted);white-space:nowrap">${esc(h)}</th>`).join("")}</tr>
        ${t.rows.slice(0, all ? t.rows.length : SHOW).map((r, i) => `<tr${t.link?.[i] ? ` data-go="${esc(t.link[i])}" style="cursor:pointer"` : ""}>${r.map((c) => `<td style="padding:6px;border-bottom:1px solid var(--border);white-space:nowrap">${esc(c)}</td>`).join("")}</tr>`).join("")}
      </table></div>
      ${!all && t.rows.length > SHOW ? `<button class="btn sm block" style="margin-top:6px" data-more="${ti}">Tümünü göster (${t.rows.length})</button>` : ""}
    </div>`;

  root.innerHTML = appbar("Detaylı Raporlar", "Her kalemin tüm kayıtları · kurumsal PDF") + `
    <div style="height:10px"></div>
    <div class="card">
      <div class="small muted" style="margin-bottom:6px">Ne için rapor?</div>
      <div class="row" style="gap:6px;flex-wrap:wrap">${REPORT_KINDS.map((x) => `<button class="btn sm${x.k === k ? " primary" : ""}" data-go="${esc(href({ k: x.k, id: "" }))}">${x.ic} ${esc(x.t)}</button>`).join("")}</div>
      <div class="field" style="margin-top:10px"><label>${esc(K.t)}</label><select data-id><option value="">— ${esc(K.all)} —</option>${opts.map((o) => `<option value="${esc(o.id)}" ${o.id === id ? "selected" : ""}>${esc(o.name)}</option>`).join("")}</select></div>
      <div class="row" style="gap:6px;flex-wrap:wrap">${Object.entries(PERIODS).map(([key, [t]]) => `<button class="btn sm${key === p ? " primary" : ""}" data-go="${esc(href({ p: key, from: "", to: "" }))}">${esc(t)}</button>`).join("")}<button class="btn sm${p === "custom" ? " primary" : ""}" data-custom>Tarih seç</button></div>
      <div class="formgrid2" data-range ${p === "custom" ? "" : "hidden"} style="margin-top:8px">
        <div class="field"><label>Başlangıç</label><input type="date" data-from value="${esc(range.from)}"></div>
        <div class="field"><label>Bitiş</label><input type="date" data-to value="${esc(range.to)}"></div>
      </div>
      <div class="row" style="gap:6px;margin-top:8px">
        <button class="btn sm${audience === "internal" ? " primary" : ""}" data-go="${esc(href({ a: "internal" }))}">🔒 İç kullanım (maliyetler dahil)</button>
        <button class="btn sm${audience === "customer" ? " primary" : ""}" data-go="${esc(href({ a: "customer" }))}">📤 Karşı tarafa (maliyetsiz)</button>
      </div>
    </div>
    ${err ? notice("err", err) : `
    <div class="card" style="border-left:4px solid var(--accent)">
      <div class="row between"><b>${esc(R.name)}</b><span class="small muted">${esc(R.period)}</span></div>
      ${R.info.filter(([l]) => l !== K.t).map(([l, v]) => `<div class="row between small" style="margin-top:3px"><span class="muted">${esc(l)}</span><span>${esc(v)}</span></div>`).join("")}
    </div>
    ${R.kpis.length ? `<div class="formgrid2">${R.kpis.map(([l, v]) => `<div class="card" style="margin:0;padding:10px"><div class="tiny muted">${esc(l)}</div><div style="font-weight:700;margin-top:2px">${esc(v)}</div></div>`).join("")}</div>` : ""}
    ${R.notes.map((n) => notice("info", n)).join("")}
    ${R.tables.length ? R.tables.map((t, i) => table(t, i)).join("") : notice("info", "Bu kalem ve dönem için kayıt yok.")}
    <div style="height:70px"></div>
    <div class="actionbar">
      <button class="btn primary" data-pdf>📄 PDF</button>
      <button class="btn" data-share>Paylaş</button>
      <button class="btn" data-csv>CSV</button>
    </div>`}`;

  qs("[data-id]", root)?.addEventListener("change", (e) => ctx.go(href({ id: e.target.value })));
  qs("[data-custom]", root)?.addEventListener("click", () => { qs("[data-range]", root).hidden = false; });
  for (const el of qsa("[data-from], [data-to]", root))
    el.addEventListener("change", () => ctx.go(href({ p: "custom", from: qs("[data-from]", root).value, to: qs("[data-to]", root).value || today })));
  for (const b of qsa("[data-more]", root))
    b.addEventListener("click", () => { b.closest(".card").outerHTML = table(R.tables[Number(b.dataset.more)], -1, true); });
  const exportPdf = async (mode, btn) => {
    btn.disabled = true;
    try {
      const raw = buildReport(d, { k, id, from: range.from, to: range.to, today });
      const { exportDocument } = await import("./document-engine.js");
      await exportDocument(reportSpec(raw, { audience, company }), mode);
      toast(mode === "share" ? "PDF hazır" : "PDF indirildi", "ok");
    } catch (e) { toast("PDF oluşturulamadı: " + (e.message || e), "err"); }
    btn.disabled = false;
  };
  qs("[data-pdf]", root)?.addEventListener("click", (e) => exportPdf("download", e.currentTarget));
  qs("[data-share]", root)?.addEventListener("click", (e) => exportPdf("share", e.currentTarget));
  qs("[data-csv]", root)?.addEventListener("click", () => {
    const raw = buildReport(d, { k, id, from: range.from, to: range.to, today });
    downloadBlob(new Blob([reportCsv(raw, audience)], { type: "text/csv;charset=utf-8" }), `Rapor_${K.t}_${R.name}_${range.to}.csv`.replace(/[^\wÇĞİÖŞÜçğıöşü.]+/g, "_"));
    toast("CSV indirildi", "ok");
  });
  return true;
}
