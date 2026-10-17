// Döküm hesabı ekranı (#/dokum-hesap, #/dokum-hesap/{saha}): yatırılan para, dökümde düşen, kalan, kaç gün yeter,
// döküm sahasının söylediği bakiyeyle karşılaştırma (mutabakat).
import { qs, qsa, esc, appbar, toast, notice, todayStr, trDate, sheet, sheetClose, confirmDialog } from "./ui.js";
import { isActive, PAYMENT_METHODS } from "./core.js";
import { dumpAccounts, depositSiteOf } from "./dump-account.js";

const tl = (n) => (Number(n) < 0 ? "−" : "") + Math.abs(Math.round(Number(n) || 0)).toLocaleString("tr-TR") + " ₺";
const num = (n) => Number(n || 0).toLocaleString("tr-TR", { maximumFractionDigits: 2 });

export async function screen(ctx) {
  if (ctx.parts[0] !== "dokum-hesap") return false;
  const { root, db } = ctx;
  const today = todayStr();
  const d = await db.dumpAll();
  const sid = ctx.parts[1];
  const sites = (d.dump_sites || []).filter((s) => isActive(s) && !s.own_yard);
  // Eski "Döküm" giderleri: döküm ücreti ayrıca hesaplandığı için iki kez maliyet sayılıyordu → hesaba aktarılabilir
  const legacy = (d.expense_records || []).filter((e) => isActive(e) && !e.dump_deposit && /döküm|dokum/i.test(e.category || ""));

  const depositSheet = (site) => {
    const sh = sheet(`<h3>${esc(site.name)} — para yatırdım</h3>
      <div class="formgrid2"><div class="field"><label>Tarih</label><input type="date" data-dd value="${today}"></div>
      <div class="field"><label>Tutar (₺)</label><input type="number" inputmode="decimal" data-da></div></div>
      <div class="formgrid2"><div class="field"><label>Ödeme</label><select data-dm>${["Havale", "Nakit", "Kart"].concat(PAYMENT_METHODS.filter((m) => !["Havale", "Nakit", "Kart", "Personel Ödedi"].includes(m))).map((m) => `<option>${esc(m)}</option>`).join("")}</select></div>
      <div class="field"><label>Barkod sayısı (isteğe bağlı)</label><input type="number" inputmode="numeric" data-db></div></div>
      <div class="field"><label>Not</label><input data-dn placeholder="dekont no, kim yatırdı…"></div>
      <div class="row" style="gap:8px"><button class="btn ghost grow" data-x>Vazgeç</button><button class="btn primary grow" data-ok>Kaydet</button></div>`, { modal: true });
    qs("[data-x]", sh).onclick = () => sheetClose();
    qs("[data-ok]", sh).onclick = async () => {
      const amount = Number(String(qs("[data-da]", sh).value).replace(",", "."));
      if (!(amount > 0)) return toast("Tutar yazın", "err");
      const bc = Number(qs("[data-db]", sh).value) || null;
      await db.saveNew("expense_records", { date: qs("[data-dd]", sh).value || today, amount, category: "Döküm", company: site.name, dump_site_id: site.id, dump_deposit: true, barcodes: bc,
        payment_method: qs("[data-dm]", sh).value, receipt: "Hayır", description: [`${site.name} döküm hesabına yükleme`, bc ? bc + " barkod" : "", qs("[data-dn]", sh).value.trim()].filter(Boolean).join(" · ") }, "Döküm hesabına yükleme");
      sheetClose(); toast("Kaydedildi", "ok"); ctx.reload();
    };
  };

  if (!sid) {
    const acc = dumpAccounts(d, { today });
    const withAcc = new Set(acc.map((a) => a.site.id));
    root.innerHTML = appbar("Döküm Hesapları", "Yatırılan para · dökümde düşen · kalan") + `
      <div style="height:10px"></div>
      ${legacy.length ? notice("warn", `${legacy.length} eski "Döküm" gideri var (${tl(legacy.reduce((n, e) => n + (Number(e.amount) || 0), 0))}). Döküm ücreti fişten ayrıca hesaplandığı için bunlar maliyete iki kez giriyordu.`) + '<button class="btn block" data-legacy style="margin-bottom:8px">Eski döküm giderlerini döküm hesabına aktar</button>' : ""}
      ${acc.map((a) => `<div class="card tap" data-go="#/dokum-hesap/${esc(a.site.id)}" style="border-left:4px solid ${a.balance < 0 ? "#d9534f" : a.daysLeft != null && a.daysLeft <= 3 ? "#e0a030" : "#2e9e6b"}">
        <div class="row between"><b>${esc(a.site.name)}</b><b style="color:${a.balance < 0 ? "#d9534f" : "inherit"}">${tl(a.balance)}</b></div>
        <div class="tiny muted">Yatırılan ${tl(a.dep)} · dökümde düşen ${tl(a.used)} (${a.trips} döküm)${a.daysLeft != null ? ` · ~${a.daysLeft} gün yeter` : ""}${a.balanceInv != null ? " · faturaya göre" : ""}</div></div>`).join("") || notice("info", "Henüz döküm hesabına para yatırma kaydı yok. Aşağıdan sahayı seçip \"Para yatırdım\" deyin; ya da asistana \"Bolluca'ya 50.000 yatırdım\" yazın.")}
      <div class="section-title">Para yatır</div>
      ${sites.map((s) => `<div class="card"><div class="row between"><span>${esc(s.name)} <span class="tiny muted">${Number(s.fee) > 0 ? `${num(s.fee)} ₺ / ${String(s.fee_unit || "").toLocaleLowerCase("tr-TR")}` : "ücret yazılmamış"}</span></span><button class="btn sm${withAcc.has(s.id) ? "" : " primary"}" data-dep="${esc(s.id)}">+ Para yatırdım</button></div></div>`).join("")}
      <div class="tiny muted" style="margin:8px 4px 80px">Döküm hesabına yatırılan para kâr-zararda gider sayılmaz; maliyet her dökümde (fişteki ton × sahanın ücreti) yazılır. Ton fişi yoksa aracın ortalama yükü kullanılır (tahmini). Nakit tahmininde yatırılan para gerçek çıkıştır.</div>`;
    for (const b of qsa("[data-dep]", root)) b.addEventListener("click", () => depositSheet(sites.find((s) => s.id === b.dataset.dep)));
    qs("[data-legacy]", root)?.addEventListener("click", async () => {
      let moved = 0, skipped = 0;
      if (!(await confirmDialog("Aktarılsın mı?", "Sahası anlaşılan eski döküm giderleri döküm hesabına yükleme olarak işaretlenir (gider olmaktan çıkar). Sahası anlaşılmayanlara dokunulmaz.", "Aktar"))) return;
      for (const e of legacy) {
        const s = depositSiteOf(d, e);
        if (s) { await db.saveExisting("expense_records", e, { dump_site_id: s.id, dump_deposit: true }, "Döküm hesabına aktarıldı"); moved++; } else skipped++;
      }
      toast(`${moved} kayıt aktarıldı${skipped ? ` · ${skipped} kaydın sahası anlaşılamadı (açıklamaya saha adını yazın)` : ""}`, moved ? "ok" : "err");
      ctx.reload();
    });
    return true;
  }

  const site = sites.find((s) => s.id === sid);
  if (!site) { root.innerHTML = appbar("Döküm Hesabı") + notice("err", "Döküm sahası bulunamadı"); return true; }
  const [a] = dumpAccounts(d, { today, siteId: sid });
  const vname = (id) => (d.vehicles || []).find((v) => v.id === id)?.name || "";
  const cname = (id) => (d.customers || []).find((v) => v.id === id)?.name || "";
  const rep = site.account_reported;
  const diff = rep ? Math.round(rep.amount - a.balance) : null;
  root.innerHTML = appbar(site.name, "Döküm hesabı") + `
    <div style="height:10px"></div>
    <div class="formgrid2">
      <div class="card" style="margin:0;padding:10px"><div class="tiny muted">Kalan (${a.invoices.length ? "faturaya göre" : "hesaplanan"})</div><b style="font-size:20px;color:${a.balance < 0 ? "#d9534f" : "inherit"}">${tl(a.balance)}</b>${a.daysLeft != null ? `<div class="tiny muted">günde ~${tl(a.perDay)} → ~${a.daysLeft} gün</div>` : ""}</div>
      <div class="card" style="margin:0;padding:10px"><div class="tiny muted">Yatırılan / düşen</div><b>${tl(a.dep)}</b><div class="tiny muted">− ${tl(a.used)} · ${a.trips} döküm</div></div>
    </div>
    ${a.missingTon ? notice("info", `${a.missingTon} dökümde ton fişi yok; aracın ortalama yüküyle tahmin edildi (${tl(a.usedEst)}). Fiş girildikçe kesinleşir.`) : ""}
    <div class="card">
      <div class="row between"><span>Döküm sahasının söylediği bakiye</span><button class="btn sm" data-rep>${rep ? tl(rep.amount) : "Yaz"}</button></div>
      ${rep ? `<div class="tiny muted">${trDate(rep.date)} tarihli</div>` + (Math.abs(diff) < 1 ? notice("ok", "Kayıtlarla tutuyor.") : notice(diff < 0 ? "warn" : "info", diff < 0 ? `Saha ${tl(-diff)} daha fazla düşmüş. Eksik girilen döküm, fazla ton ya da yanlış tarife olabilir — dökümleri fişlerle karşılaştırın.` : `Sahada ${tl(diff)} daha fazla para görünüyor. Kaydedilmiş ama yapılmamış döküm ya da fazla tahmin edilmiş ton olabilir.`)) : '<div class="tiny muted">Sahanın ekstresindeki / barkod sisteminde görünen kalanı yazın; fark varsa gösterir.</div>'}
    </div>
    ${a.invoices.length ? `<div class="card"><div class="small"><b>Kalan nasıl hesaplandı</b></div><div class="tiny muted">Yatırılan ${tl(a.dep)} − faturalanan ${tl(a.invTotal)} − son faturadan (${trDate(a.lastInv)}) sonraki dökümler ${tl(a.afterInv)} (tahmini) = <b>${tl(a.balanceInv)}</b>. Saha faturası gerçek düşen tutardır. Sahanın sisteminde görünen bakiyeyi yukarıya yazarsanız fark gösterilir.</div></div>` : ""}
    <button class="btn primary block" data-dep style="margin:8px 0">+ Para yatırdım</button>
    <div class="section-title">Faturalar (${a.invoices.length})</div>
    ${a.invoices.slice().reverse().map((x) => {
      const dt = x.ourTon ? Math.round((x.ton - x.ourTon) * 10) / 10 : null;
      const feeOff = x.perTon && site.fee_unit === "Ton" && Number(site.fee) > 0 && Math.abs(x.perTon - Number(site.fee)) / Number(site.fee) > 0.01;
      return `<div class="card" style="padding:10px 12px">
        <div class="row between small"><span>${trDate(x.doc.date)} · ${esc(x.doc.doc_no || "no yok")}</span><b>${tl(x.amount)}</b></div>
        <button class="btn sm" data-go="#/belgeler/${esc(x.doc.id)}" style="margin:4px 0">📄 Faturayı aç</button>
        <div class="tiny muted">${x.ton ? `${num(x.ton)} ton` : "ton yok"}${x.perTon ? ` · ton başı ${num(x.perTon)} ₺ (KDV dahil)` : ""}${x.doc.place ? ` · ${esc(x.doc.place)}` : ""}</div>
        <div class="small" style="margin-top:4px">Kayıtlarımız (${trDate(addDay(x.from))} – ${trDate(x.doc.date)}): ${x.ourTrips} döküm${x.ourTon ? `, ${x.ourEst ? "~" : ""}${num(x.ourTon)} ton` : ""}, ${tl(x.ourAmount)}</div>
        ${x.ourTrips && dt != null && x.ton && Math.abs(dt) > Math.max(1, x.ton * 0.03) ? notice(dt > 0 ? "warn" : "info", dt > 0 ? `Saha ${num(dt)} ton fazla faturalamış ya da bizim kayıtlarda eksik döküm/ton var. Fişleri kontrol edin (fatura dönemi farklıysa fark normaldir).` : `Kayıtlarımızda ${num(-dt)} ton fazla var; ton tahmini yüksek ya da fatura dönemi farklı olabilir.`) : ""}
        ${(d.expense_records || []).some((e) => isActive(e) && e.dump_invoice_doc_id === x.doc.id) ? '<div class="tiny muted" style="margin-top:4px">✓ Geçmiş dönem: fatura tutarı ödenmiş sayıldı (giderlerde)</div>' : `<button class="btn sm block" data-paid="${esc(x.doc.id)}" style="margin-top:6px">Geçmiş dönem: bu faturayı ödenmiş say</button>`}
        ${!x.ourTrips ? '<div class="tiny muted">Bu dönemde bu sahaya kayıtlı döküm yok; fatura dönemi farklı olabilir.</div>' : ""}
        ${feeOff ? `<div class="notice warn" style="margin-top:6px"><div>Kartta ${num(site.fee)} ₺/ton yazılı, faturada ${num(x.perTon)} ₺/ton (KDV dahil). Döküm maliyetleri yanlış hesaplanıyor.</div></div><button class="btn sm block" data-fee="${x.perTon}" style="margin-top:6px">Sahanın ücretini ${num(x.perTon)} ₺/ton yap</button>` : ""}
      </div>`;
    }).join("") || '<div class="muted small" style="margin:4px">Henüz fatura yok. Sahanın faturasını (İSTAÇ vb.) Akıllı Asistan\'a yükleyin; gider yazılmaz, buraya bağlanır.</div>'}
    <div class="section-title">Yatırılan para (${a.deposits.length})</div>
    ${a.deposits.map((e) => `<div class="card" style="padding:8px 12px"><div class="row between small"><span>${trDate(e.date)} · ${esc(e.payment_method || "")}${e.barcodes ? ` · ${e.barcodes} barkod` : ""}</span><b>${tl(e.amount)}</b></div>${e.description ? `<div class="tiny muted">${esc(e.description)}</div>` : ""}</div>`).reverse().join("") || '<div class="muted small" style="margin:4px">Kayıt yok</div>'}
    <div class="section-title">Dökümler (${a.uses.length})</div>
    <div class="card" style="overflow-x:auto;padding:8px"><table style="width:100%;border-collapse:collapse;font-size:12px">
      <tr>${["Tarih", "Araç", "Müşteri", "Ton", "Fiş", "Tutar"].map((h) => `<th style="text-align:left;padding:5px;border-bottom:2px solid var(--border2);color:var(--muted)">${h}</th>`).join("")}</tr>
      ${a.uses.slice().reverse().map((x) => `<tr data-go="#/isler/${esc(x.w.id)}" style="cursor:pointer">${[trDate(x.w.date), vname(x.w.vehicle_id), cname(x.w.customer_id), x.f.ton ? (x.f.estimated ? "~" : "") + num(x.f.ton) : x.f.manual ? "elle" : "", x.w.slip_no || "", (x.f.estimated ? "~" : "") + tl(x.f.amount)].map((c) => `<td style="padding:5px;border-bottom:1px solid var(--border);white-space:nowrap">${esc(c)}</td>`).join("")}</tr>`).join("")}
    </table></div>
    <div style="height:80px"></div>`;
  qs("[data-dep]", root).addEventListener("click", () => depositSheet(site));
  for (const b of qsa("[data-paid]", root))
    b.addEventListener("click", async () => {
      const x = a.invoices.find((i) => i.doc.id === b.dataset.paid);
      if (!(await confirmDialog("Ödenmiş sayılsın mı?", `Bu dönemin parça parça yatırılan paraları tek tek girilmeyecekse fatura tutarı (${tl(x.amount)}) döküm hesabına yatırılmış sayılır. Giderlerde "Döküm" olarak görünür; kâr-zararda dökümler zaten sayıldığından iki kez girmez.`, "Ödenmiş say"))) return;
      await db.saveNew("expense_records", { date: x.doc.date, amount: x.amount, category: "Döküm", company: site.name, dump_site_id: site.id, dump_deposit: true, invoice_paid: true, invoice_no: x.doc.doc_no || null, dump_invoice_doc_id: x.doc.id,
        payment_method: "Şirket Ödedi", receipt: "Evet", description: `${site.name} döküm faturası ${x.doc.doc_no || ""} — geçmiş dönem ödemesi (kart/havale parça parça; fatura belgede)` }, "Geçmiş dönem döküm ödemesi");
      toast("Kaydedildi", "ok"); ctx.reload();
    });
  for (const b of qsa("[data-fee]", root))
    b.addEventListener("click", async () => {
      if (!(await confirmDialog("Ücret güncellensin mi?", `${site.name}: ${num(site.fee)} → ${num(b.dataset.fee)} ₺/ton (KDV dahil). Bundan sonraki ve önceki dökümlerin maliyeti bu ücretle hesaplanır.`, "Güncelle"))) return;
      await db.saveExisting("dump_sites", site, { fee: Number(b.dataset.fee) }, "Döküm faturasındaki ton fiyatı");
      toast("Ücret güncellendi", "ok"); ctx.reload();
    });
  qs("[data-rep]", root).addEventListener("click", async () => {
    const { promptDialog } = await import("./ui.js");
    const v = await promptDialog("Sahanın söylediği bakiye", "Kalan (₺)", rep ? String(rep.amount) : "");
    if (v === null) return;
    const n = Number(String(v).replace(/\./g, "").replace(",", "."));
    if (!Number.isFinite(n)) return toast("Sayı yazın", "err");
    await db.saveExisting("dump_sites", site, { account_reported: { amount: n, date: today } }, "Döküm sahası bakiyesi");
    ctx.reload();
  });
  return true;
}
function addDay(t) { const x = new Date(t + "T12:00:00Z"); x.setUTCDate(x.getUTCDate() + 1); return x.toISOString().slice(0, 10); }
