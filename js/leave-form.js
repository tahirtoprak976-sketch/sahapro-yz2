// İzin Talep ve Onay Formu (#/izinler/form/new?pid=…, #/izinler/form/{id}).
// Form "İzin Formu" belgesi olarak tutulur (Belge Merkezi'nde de görünür). İmzalar telefonda parmakla atılır
// (ek: record_type "leave_signature", kind "employee" / "approver") ya da form yazdırılıp ıslak imzalanır ve taranıp eklenir.
// Onaylanınca izin günleri personel hareketi olarak yazılır (leave_group = form id) → puantaj, maaş ve izin hakkı bunları okur.
import { qs, qsa, esc, appbar, toast, notice, todayStr, trDate, confirmDialog, promptDialog, sheet, sheetClose } from "./ui.js";
import { isActive } from "./core.js";
import { LEAVE_KINDS, eventTypeOf, leaveDays, leaveSummary, isSunday, isHoliday } from "./leave-core.js";

export const FORM_CAT = "İzin Formu";
const STATUS = { "Onay bekliyor": "#e0a030", Onaylandı: "#2e9e6b", Reddedildi: "#d9534f", İptal: "#9aa4b2" };
const addD = (t, n) => { const x = new Date(t + "T12:00:00Z"); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
// İşe başlama: bitişten sonraki ilk iş günü (pazar ve sabit resmi tatil atlanır)
export function returnDate(to) { let d = addD(to, 1); while (isSunday(d) || isHoliday(d)) d = addD(d, 1); return d; }
export const formsOf = (d, pid = null) => (d.documents || []).filter((x) => isActive(x) && x.category === FORM_CAT && (!pid || x.owner_id === pid)).sort((a, b) => String(b.date).localeCompare(String(a.date)) || String(b.doc_no).localeCompare(String(a.doc_no)));
function nextNo(d, today) {
  const y = today.slice(0, 4);
  const n = (d.documents || []).filter((x) => x.category === FORM_CAT && String(x.doc_no || "").startsWith(`İZN-${y}-`)).map((x) => Number(String(x.doc_no).slice(9)) || 0);
  return `İZN-${y}-${String((n.length ? Math.max(...n) : 0) + 1).padStart(4, "0")}`;
}
const at = (iso) => (iso ? new Date(iso).toLocaleString("tr-TR", { timeZone: "Europe/Istanbul", dateStyle: "short", timeStyle: "short" }) : "");

// Parmakla imza (ekranda). Blob (PNG) döner, vazgeçilirse null.
export function signaturePad(title, hint = "") {
  return new Promise((resolve) => {
    const sh = sheet(`<h3>${esc(title)}</h3>${hint ? `<div class="small muted" style="margin-bottom:6px">${esc(hint)}</div>` : ""}
      <div class="sigframe"><canvas class="sigpad" data-pad style="width:100%;height:200px;touch-action:none;background:#fff;border:1px solid var(--border);border-radius:10px"></canvas></div>
      <div class="row" style="gap:8px;margin-top:8px"><button class="btn ghost grow" data-x>Vazgeç</button><button class="btn ghost grow" data-clr>Temizle</button><button class="btn primary grow" data-ok>İmzayı kaydet</button></div>`, { modal: true });
    const pad = qs("[data-pad]", sh);
    pad.width = 700; pad.height = 260;
    const c = pad.getContext("2d");
    c.lineWidth = 5; c.lineCap = "round"; c.lineJoin = "round"; c.strokeStyle = "#0b1f3a";
    let down = false, drawn = false;
    const pt = (e) => { const r = pad.getBoundingClientRect(); return [((e.clientX - r.left) * pad.width) / r.width, ((e.clientY - r.top) * pad.height) / r.height]; };
    pad.addEventListener("pointerdown", (e) => { e.preventDefault(); down = true; pad.setPointerCapture(e.pointerId); c.beginPath(); c.moveTo(...pt(e)); });
    pad.addEventListener("pointermove", (e) => { if (!down) return; c.lineTo(...pt(e)); c.stroke(); drawn = true; });
    const up = () => (down = false);
    pad.addEventListener("pointerup", up); pad.addEventListener("pointercancel", up);
    qs("[data-clr]", sh).onclick = () => { c.clearRect(0, 0, pad.width, pad.height); drawn = false; };
    qs("[data-x]", sh).onclick = () => { sheetClose(); resolve(null); };
    qs("[data-ok]", sh).onclick = () => {
      if (!drawn) return toast("Önce imza atın", "err");
      pad.toBlob((b) => { sheetClose(); resolve(b); }, "image/png");
    };
  });
}

// PDF (Belge motoru) — imzalar varsa resim, yoksa ıslak imza için boş kutu
export function formSpec(f, p, s, sig = {}) {
  const L = f.leave || {};
  const annual = L.kind === "Yıllık izin";
  const sections = [
    { title: "Personel Bilgileri", layout: "identity", pairs: [
      ["Adı Soyadı", p?.name || "—"], ["T.C. Kimlik No", p?.identity_number || "—"],
      ["Görevi", p?.role || "—"], ["İşe giriş tarihi", p?.start_date ? trDate(p.start_date) + (s?.start ? ` (${s.years} yıl)` : "") : "—"],
    ] },
    { title: "İzin Bilgileri", layout: "identity", pairs: [
      ["İzin türü", L.kind || "—"], ["İzin süresi", `${L.days || 0} iş günü`],
      ["İzin başlangıç – bitiş", `${trDate(L.from)} – ${trDate(L.to)}`], ["İşe başlama tarihi", trDate(L.return_date || returnDate(L.to))],
      ["İzinde ulaşılacak telefon", L.phone || "—"], ["Yerine bakacak kişi", L.substitute || "—"],
    ] },
    ...(L.address || L.reason ? [{ title: "İzin Adresi ve Gerekçe", text: [L.address ? "Adres: " + L.address : "", L.reason ? "Gerekçe: " + L.reason : ""].filter(Boolean).join("   ·   ") }] : []),
    ...(annual && s?.ready ? [{ title: "Yıllık İzin Hakkı", text: `Hak edilen toplam ${f.snap?.earned ?? s.earned} gün   ·   Daha önce kullanılan ${f.snap?.used ?? s.used + s.planned} gün   ·   Bu izin ${L.days || 0} gün   ·   İzin sonrası kalan ${f.snap?.after ?? (s.remaining - (f.status === "Onaylandı" ? 0 : L.days || 0))} gün` }] : []),
    { title: "Beyan ve Onay", layout: "notice", text: (annual
      ? "Yukarıda belirtilen tarihler arasında yıllık ücretli iznimi kullanmak istiyorum; izin dönüşü belirtilen tarihte işbaşı yapacağımı beyan ederim (4857 sayılı İş Kanunu md. 53–60, Yıllık Ücretli İzin Yönetmeliği)."
      : "Yukarıda belirtilen tarihler arasında izinli sayılmayı talep ediyorum; izin dönüşü belirtilen tarihte işbaşı yapacağımı beyan ederim.")
      + `  Durum: ${f.status || "Onay bekliyor"} · Talep: ${trDate(f.date)}${f.approved_at ? ` · ${f.status === "Reddedildi" ? "Red" : "Onay"}: ${at(f.approved_at)}` : ""}${f.approver_name ? ` · Yetkili: ${f.approver_name}` : ""}${f.reject_reason ? ` · Red gerekçesi: ${f.reject_reason}` : ""}` },
    { title: "İmzalar", signs: [
      { label: "Talep Eden Personel", image: sig.employee || null, name: p?.name || "", at: f.employee_signed_at ? "İmza: " + at(f.employee_signed_at) : "" },
      { label: "İşveren / Yetkili", image: sig.approver || null, name: f.approver_name || "", at: f.approver_signed_at ? "İmza: " + at(f.approver_signed_at) : "" },
    ] },
  ];
  return { template: "leave", title: (annual ? "Yıllık İzin" : "İzin") + " Talep ve Onay Formu", number: f.doc_no, audience: "internal",
    filename: `SAHAPRO_Izin_${String(f.doc_no || "").replace(/[^\w-]/g, "")}_${String(p?.name || "").replace(/\s+/g, "_")}.pdf`, sections };
}

async function sigsOf(db, id) {
  const atts = await db.attachmentsFor("leave_signature", id);
  const pick = (k) => atts.filter((a) => a.kind === k).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))[0]?.blob || null;
  return { employee: pick("employee"), approver: pick("approver") };
}

export async function formScreen(ctx) {
  const { root, db } = ctx;
  const today = todayStr();
  const d = await db.dumpAll();
  const people = (d.personnel || []).filter((p) => isActive(p) && p.active !== false);
  const id = ctx.parts[2];

  if (id === "new") {
    const pid0 = ctx.query?.pid || people[0]?.id || "";
    root.innerHTML = appbar("İzin Talep Formu", "Yeni talep") + `
      <div style="height:10px"></div>
      <div class="card">
        <div class="field"><label>Personel</label><select data-p>${people.map((p) => `<option value="${esc(p.id)}" ${p.id === pid0 ? "selected" : ""}>${esc(p.name)}</option>`).join("")}</select></div>
        <div class="field"><label>İzin türü</label><select data-k>${LEAVE_KINDS.map((k) => `<option>${k}</option>`).join("")}</select></div>
        <div class="formgrid2"><div class="field"><label>Başlangıç</label><input type="date" data-a value="${today}"></div>
        <div class="field"><label>Bitiş (dahil)</label><input type="date" data-b value="${today}"></div></div>
        <div data-info class="small" style="margin:4px 0 8px"></div>
        <div class="formgrid2"><div class="field"><label>İzinde telefon</label><input data-ph inputmode="tel"></div>
        <div class="field"><label>Yerine bakacak kişi</label><input data-sub placeholder="isteğe bağlı"></div></div>
        <div class="field"><label>İzinde bulunacağı adres</label><input data-ad placeholder="isteğe bağlı"></div>
        <div class="field"><label>Açıklama / gerekçe</label><input data-r placeholder="ör. memlekete gidecek"></div>
      </div>
      <button class="btn primary block" data-save>Formu oluştur</button>
      <div class="tiny muted" style="margin:8px 4px 80px">Form oluşunca personele telefonda imzalatabilir ya da yazdırıp ıslak imza alabilirsiniz. İzin günleri, form <b>onaylanınca</b> puantaja ve izin hakkına işlenir.</div>`;
    const info = () => {
      const a = qs("[data-a]", root).value, b = qs("[data-b]", root).value, k = qs("[data-k]", root).value;
      const p = people.find((x) => x.id === qs("[data-p]", root).value);
      const days = leaveDays(a, b), s = p ? leaveSummary(d, p, { today }) : null;
      if (p && !qs("[data-ph]", root).value) qs("[data-ph]", root).value = p.phone || "";
      let t = b < a ? '<span style="color:#d9534f">Bitiş başlangıçtan önce</span>' : `<b>${days.length} iş günü</b> · işe başlama ${trDate(returnDate(b))}`;
      if (k === "Yıllık izin" && s?.remaining != null) t += `<br>Kalan yıllık izin ${s.remaining} gün → onaylanırsa ${s.remaining - days.length} gün${days.length > s.remaining ? ' <span style="color:#d9534f">(hak aşılıyor)</span>' : ""}`;
      if (k === "Yıllık izin" && s && !s.ready) t += '<br><span class="muted">İşe giriş tarihi yok; kalan hak hesaplanamıyor.</span>';
      qs("[data-info]", root).innerHTML = t;
    };
    for (const el of qsa("select,input[type=date]", root)) el.addEventListener("change", info);
    qs("[data-a]", root).addEventListener("change", () => { if (qs("[data-b]", root).value < qs("[data-a]", root).value) qs("[data-b]", root).value = qs("[data-a]", root).value; info(); });
    info();
    qs("[data-save]", root).addEventListener("click", async () => {
      const pid = qs("[data-p]", root).value, a = qs("[data-a]", root).value, b = qs("[data-b]", root).value;
      const days = leaveDays(a, b);
      if (!pid) return toast("Personel seçin", "err");
      if (!days.length) return toast("Bu aralıkta izin günü yok", "err");
      const fresh = await db.dumpAll();
      const rec = await db.saveNew("documents", {
        category: FORM_CAT, owner_type: "personnel", owner_id: pid, personnel_id: pid, date: today, doc_no: nextNo(fresh, today), title: "İzin talep formu",
        status: "Onay bekliyor",
        leave: { kind: qs("[data-k]", root).value, from: a, to: b, days: days.length, return_date: returnDate(b), phone: qs("[data-ph]", root).value.trim(), substitute: qs("[data-sub]", root).value.trim(), address: qs("[data-ad]", root).value.trim(), reason: qs("[data-r]", root).value.trim() },
        note: `${qs("[data-k]", root).value} · ${trDate(a)}–${trDate(b)} · ${days.length} gün`,
      }, "İzin talep formu");
      toast("Form oluşturuldu", "ok");
      ctx.go("#/izinler/form/" + rec.id);
    });
    return true;
  }

  const f = (d.documents || []).find((x) => x.id === id && isActive(x) && x.category === FORM_CAT);
  if (!f) { root.innerHTML = appbar("İzin Formu") + notice("warn", "Form bulunamadı"); return true; }
  const p = (d.personnel || []).find((x) => x.id === f.owner_id);
  const s = p ? leaveSummary(d, p, { today }) : null;
  const sig = await sigsOf(db, f.id);
  const scans = (await db.attachmentsFor("document", f.id)).length;
  const L = f.leave || {};
  const st = f.status || "Onay bekliyor";
  const approver = f.approver_name || (await db.metaGet("leave_approver")) || "";
  root.innerHTML = appbar("İzin Formu", f.doc_no) + `
    <div style="height:10px"></div>
    <div class="card" style="border-left:4px solid ${STATUS[st] || "#999"}">
      <div class="row between"><b>${esc(p?.name || "—")}</b><span class="badge" style="background:${STATUS[st]}22;color:${STATUS[st]}">${esc(st)}</span></div>
      <div class="small" style="margin-top:4px"><b>${esc(L.kind)}</b> · ${trDate(L.from)} – ${trDate(L.to)} · <b>${L.days} iş günü</b></div>
      <div class="tiny muted">İşe başlama ${trDate(L.return_date || returnDate(L.to))}${L.phone ? " · tel " + esc(L.phone) : ""}${L.substitute ? " · yerine " + esc(L.substitute) : ""}</div>
      ${L.reason ? `<div class="tiny muted">${esc(L.reason)}</div>` : ""}
      ${L.kind === "Yıllık izin" && s?.remaining != null && st === "Onay bekliyor" ? `<div class="small" style="margin-top:4px">Kalan yıllık izin ${s.remaining} gün → onaylanırsa <b>${s.remaining - L.days}</b> gün</div>` : ""}
      ${f.reject_reason ? `<div class="small" style="color:#d9534f;margin-top:4px">Red gerekçesi: ${esc(f.reject_reason)}</div>` : ""}
    </div>
    <div class="section-title">İmzalar</div>
    <div class="card">
      <div class="row between"><span>👷 Personel${sig.employee ? ` <span class="tiny muted">· ${at(f.employee_signed_at)}</span>` : ""}</span>${sig.employee ? '<span class="badge ok">✓ İmzalı</span>' : ""}</div>
      ${sig.employee ? `<img src="${URL.createObjectURL(sig.employee)}" alt="imza" style="height:60px;background:#fff;border-radius:6px;margin:4px 0">` : ""}
      ${st === "İptal" ? "" : `<button class="btn sm block" data-sign="employee" style="margin-top:4px">✍ ${sig.employee ? "Yeniden imzalat" : "Personele imzalat"}</button>`}
      <div class="divider"></div>
      <div class="field" style="margin:4px 0"><label>Onaylayan yetkili (ad soyad)</label><input data-apn value="${esc(approver)}" ${st === "Onay bekliyor" ? "" : "disabled"}></div>
      <div class="row between"><span>🏢 İşveren / yetkili${sig.approver ? ` <span class="tiny muted">· ${at(f.approver_signed_at)}</span>` : ""}</span>${sig.approver ? '<span class="badge ok">✓ İmzalı</span>' : ""}</div>
      ${sig.approver ? `<img src="${URL.createObjectURL(sig.approver)}" alt="imza" style="height:60px;background:#fff;border-radius:6px;margin:4px 0">` : ""}
      ${st === "İptal" ? "" : `<button class="btn sm block" data-sign="approver" style="margin-top:4px">✍ ${sig.approver ? "Yeniden imzala" : "Yetkili imzası"}</button>`}
    </div>
    ${st === "Onay bekliyor" ? `<div class="row" style="gap:8px;margin:8px 0"><button class="btn grow" data-rej>✗ Reddet</button><button class="btn primary grow" data-ok>✓ Onayla ve işle</button></div>` : ""}
    ${st === "Onaylandı" ? `<button class="btn block" data-cancel style="margin:8px 0">İzni iptal et (günleri geri al)</button>` : ""}
    <div class="section-title">Form çıktısı</div>
    <div class="row" style="gap:6px;flex-wrap:wrap"><button class="btn grow" data-pdf="print">🖨 Yazdır</button><button class="btn grow" data-pdf="share">📤 Paylaş</button><button class="btn grow" data-pdf="download">⬇ İndir</button></div>
    <div class="card" style="margin-top:8px">
      <div class="small"><b>Kâğıtla imza:</b> Formu yazdırın, personele ve yetkiliye ıslak imza attırın, sonra fotoğrafını çekip ekleyin. ${scans ? `<span class="badge ok">${scans} taranmış nüsha</span>` : ""}</div>
      <label class="btn sm block" style="margin-top:6px;cursor:pointer">📎 Islak imzalı formun fotoğrafını ekle<input type="file" accept="image/*,application/pdf" data-scan hidden></label>
      ${scans ? `<button class="btn sm block ghost" data-go="#/belgeler/${esc(f.id)}" style="margin-top:6px">Taranmış nüshayı aç</button>` : ""}
    </div>
    <div class="row" style="gap:6px;margin:10px 0 80px"><button class="btn grow" data-go="#/izinler/${esc(f.owner_id)}">← ${esc(p?.name || "Personel")}</button><button class="btn grow" data-go="#/izinler">Tüm izinler</button></div>`;

  for (const b of qsa("[data-sign]", root))
    b.addEventListener("click", async () => {
      const who = b.dataset.sign;
      if (who === "approver") { const n = qs("[data-apn]", root).value.trim(); if (!n) return toast("Önce onaylayan yetkilinin adını yazın", "err"); }
      const blob = await signaturePad(who === "employee" ? `${p?.name || "Personel"} — imza` : "Yetkili imzası", who === "employee" ? `${L.kind}: ${trDate(L.from)}–${trDate(L.to)} (${L.days} gün). Telefonu personele verin, parmağıyla imzalasın.` : "");
      if (!blob) return;
      await db.addAttachment("leave_signature", f.id, new File([blob], `imza-${who}.png`, { type: "image/png" }), { kind: who });
      const fields = who === "employee" ? { employee_signed_at: new Date().toISOString() } : { approver_signed_at: new Date().toISOString(), approver_name: qs("[data-apn]", root).value.trim() };
      if (who === "approver") await db.metaSet("leave_approver", fields.approver_name);
      await db.saveExisting("documents", f, fields, "İzin formu imzası");
      toast("İmza kaydedildi", "ok"); ctx.reload();
    });
  qs("[data-ok]", root)?.addEventListener("click", async () => {
    const name = qs("[data-apn]", root).value.trim();
    if (!name) return toast("Onaylayan yetkilinin adını yazın", "err");
    const days = leaveDays(L.from, L.to);
    const fresh = await db.dumpAll();
    const MARK = new Set(["Çalıştı", "Yarım Gün", "İzin", "Rapor", "Devamsızlık"]);
    const clash = (fresh.personnel_events || []).filter((e) => isActive(e) && e.personnel_id === f.owner_id && MARK.has(e.event_type) && days.includes(e.date) && e.leave_group !== f.id);
    const leaveClash = clash.filter((e) => e.event_type === "İzin" || e.event_type === "Rapor");
    if (leaveClash.length && !(await confirmDialog("Bu günlerde başka izin var", `${[...new Set(leaveClash.map((e) => trDate(e.date)))].join(", ")} zaten izinli/raporlu yazılmış. Bu formdakiyle değiştirilsin mi?`, "Değiştir"))) return;
    if (!sig.employee && !scans && !(await confirmDialog("Personel imzası yok", "Personel formu imzalamadı ve ıslak imzalı nüsha eklenmedi. Yine de onaylansın mı?", "Onayla"))) return;
    const s0 = p ? leaveSummary(fresh, p, { today }) : null;
    for (const e of clash) await db.softDelete("personnel_events", e.id, "İzin formu onaylandı");
    for (const x of days) await db.saveNew("personnel_events", { date: x, personnel_id: f.owner_id, event_type: eventTypeOf(L.kind), leave_kind: L.kind, leave_group: f.id, leave_form_id: f.id, amount: null, hours_days: 1, description: `${L.kind} · ${f.doc_no}`, source: "izin formu" }, "İzin formu onayı");
    await db.metaSet("leave_approver", name);
    await db.saveExisting("documents", f, { status: "Onaylandı", approver_name: name, approved_at: new Date().toISOString(),
      snap: s0?.ready && L.kind === "Yıllık izin" ? { earned: s0.earned, used: s0.used + s0.planned, after: s0.remaining - days.length } : null }, "İzin onaylandı");
    toast(`Onaylandı · ${days.length} gün puantaja işlendi`, "ok"); ctx.reload();
  });
  qs("[data-rej]", root)?.addEventListener("click", async () => {
    const why = await promptDialog("Red gerekçesi", "Gerekçe", "");
    if (why == null) return;
    const name = qs("[data-apn]", root).value.trim();
    await db.saveExisting("documents", f, { status: "Reddedildi", reject_reason: why.trim() || "Belirtilmedi", approver_name: name || null, approved_at: new Date().toISOString() }, "İzin reddedildi");
    toast("Reddedildi", "ok"); ctx.reload();
  });
  qs("[data-cancel]", root)?.addEventListener("click", async () => {
    if (!(await confirmDialog("İzin iptal edilsin mi?", "Bu forma bağlı izin günleri puantajdan ve izin hakkından geri alınır. Form 'İptal' olarak saklanır.", "İptal et"))) return;
    const fresh = await db.dumpAll();
    for (const e of (fresh.personnel_events || []).filter((e) => isActive(e) && e.leave_group === f.id)) await db.softDelete("personnel_events", e.id, "İzin formu iptal edildi");
    await db.saveExisting("documents", f, { status: "İptal" }, "İzin iptal edildi");
    toast("İptal edildi", "ok"); ctx.reload();
  });
  for (const b of qsa("[data-pdf]", root))
    b.addEventListener("click", async () => {
      try {
        const { exportDocument } = await import("./document-engine.js");
        const fresh = await db.get("documents", f.id);
        await exportDocument(formSpec(fresh, p, s, await sigsOf(db, f.id)), b.dataset.pdf);
      } catch (e) { toast(e.message || String(e), "err"); }
    });
  qs("[data-scan]", root).addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    await db.addAttachment("document", f.id, file, { kind: "scan_original" });
    toast("Taranmış nüsha eklendi", "ok"); ctx.reload();
  });
  return true;
}
