// İzinler (#/izinler, #/izinler/{personel}): kim izinde, yıllık izin hakkı / kullanılan / kalan, tarih aralığıyla izin girme.
// Kayıtlar personel hareketi ("İzin" / "Rapor", leave_kind) — puantaj ve maaş aynı kayıtları kullanır.
import { qs, qsa, esc, appbar, toast, notice, todayStr, trDate, confirmDialog, sheet, sheetClose } from "./ui.js";
import { isActive } from "./core.js";
import { LEAVE_KINDS, eventTypeOf, leaveDays, leaveSummary, offBetween } from "./leave-core.js";
import { formsOf } from "./leave-form.js";
const FSTAT = { "Onay bekliyor": "#e0a030", Onaylandı: "#2e9e6b", Reddedildi: "#d9534f", İptal: "#9aa4b2" };

const COLOR = { "Yıllık izin": "#3b82f6", "Ücretsiz izin": "#9aa4b2", "Mazeret izni": "#0ea5a4", Rapor: "#8b5cf6" };
const addD = (t, n) => { const x = new Date(t + "T12:00:00Z"); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const rng = (a, b) => (a === b ? trDate(a) : `${trDate(a)} – ${trDate(b)}`);

// İzin girme penceresi (personel seçili ya da seçilecek)
export function leaveSheet(ctx, d, { pid = "", onDone } = {}) {
  const { db } = ctx;
  const today = todayStr();
  const people = (d.personnel || []).filter((p) => isActive(p) && p.active !== false);
  const sh = sheet(`<h3>🏖 İzin gir</h3>
    <div class="field"><label>Personel</label><select data-p>${people.map((p) => `<option value="${esc(p.id)}" ${p.id === pid ? "selected" : ""}>${esc(p.name)}</option>`).join("")}</select></div>
    <div class="field"><label>Türü</label><select data-k>${LEAVE_KINDS.map((k) => `<option>${k}</option>`).join("")}</select></div>
    <div class="formgrid2"><div class="field"><label>Başlangıç</label><input type="date" data-a value="${today}"></div>
    <div class="field"><label>Bitiş (dahil)</label><input type="date" data-b value="${today}"></div></div>
    <div class="field"><label>Not (isteğe bağlı)</label><input data-n placeholder="ör. memlekete gidecek, doktor raporu"></div>
    <div data-info class="small" style="margin:6px 0"></div>
    <div class="row" style="gap:8px"><button class="btn ghost grow" data-x>Vazgeç</button><button class="btn primary grow" data-ok>Kaydet</button></div>`, { modal: true });
  const info = () => {
    const a = qs("[data-a]", sh).value, b = qs("[data-b]", sh).value, k = qs("[data-k]", sh).value;
    const days = leaveDays(a, b);
    const p = people.find((x) => x.id === qs("[data-p]", sh).value);
    const s = p ? leaveSummary(d, p, { today }) : null;
    let t = b < a ? '<span style="color:#d9534f">Bitiş başlangıçtan önce</span>' : `<b>${days.length} gün</b> izin sayılır (pazar ve resmi tatiller hariç; dini bayram varsa o günleri sonra silin).`;
    if (k === "Yıllık izin" && s?.remaining != null) t += `<br>Kalan yıllık izin: ${s.remaining} gün${days.length > s.remaining ? ` — <span style="color:#d9534f">${days.length - s.remaining} gün fazla</span>` : ` → sonra ${s.remaining - days.length} gün`}`;
    if (k === "Yıllık izin" && s && !s.ready) t += `<br><span class="muted">İşe giriş tarihi girilmemiş; hak hesaplanamıyor (İzinler → kişi → ayarlar).</span>`;
    if (k === "Ücretsiz izin") t += `<br><span class="muted">Aylık maaştan gün başı maaş/30 düşülür.</span>`;
    qs("[data-info]", sh).innerHTML = t;
  };
  for (const el of qsa("select,input", sh)) el.addEventListener("change", info);
  qs("[data-a]", sh).addEventListener("change", () => { if (qs("[data-b]", sh).value < qs("[data-a]", sh).value) qs("[data-b]", sh).value = qs("[data-a]", sh).value; info(); });
  info();
  qs("[data-x]", sh).onclick = () => sheetClose();
  qs("[data-ok]", sh).onclick = async () => {
    const p = qs("[data-p]", sh).value, k = qs("[data-k]", sh).value, a = qs("[data-a]", sh).value, b = qs("[data-b]", sh).value;
    const days = leaveDays(a, b);
    if (!p) return toast("Personel seçin", "err");
    if (!days.length) return toast("Tarih aralığında izin günü yok", "err");
    const fresh = await db.dumpAll();
    // O günlerde başka işaret (çalıştı/izin/rapor…) varsa yerine geçer; iş kaydı varsa uyarır
    const MARK = new Set(["Çalıştı", "Yarım Gün", "İzin", "Rapor", "Devamsızlık"]);
    const old = (fresh.personnel_events || []).filter((e) => isActive(e) && e.personnel_id === p && MARK.has(e.event_type) && days.includes(e.date));
    const pp = fresh.personnel.find((x) => x.id === p);
    const myV = new Set([pp?.vehicle_id, ...(fresh.vehicles || []).filter((v) => isActive(v) && v.assignee_id === p).map((v) => v.id)].filter(Boolean));
    const worked = [...new Set((fresh.work_records || []).filter((w) => isActive(w) && days.includes(w.date) && (w.personnel_id === p || (!w.personnel_id && myV.has(w.vehicle_id)))).map((w) => w.date))];
    if (worked.length && !(await confirmDialog("Bu günlerde iş kaydı var", `${worked.map(trDate).join(", ")} tarihlerinde bu kişinin (ya da aracının) işi kayıtlı. Yine de izinli yazılsın mı?`, "Evet, izinli"))) return;
    const group = `L${Date.now().toString(36)}`;
    for (const e of old) await db.softDelete("personnel_events", e.id, "İzin girildi");
    for (const x of days) await db.saveNew("personnel_events", { date: x, personnel_id: p, event_type: eventTypeOf(k), leave_kind: k, leave_group: group, amount: null, hours_days: 1, description: qs("[data-n]", sh).value.trim() || k, source: "izin" }, "İzin");
    sheetClose();
    toast(`${days.length} gün ${k.toLocaleLowerCase("tr-TR")} kaydedildi`, "ok");
    onDone ? onDone() : ctx.reload();
  };
}

export async function screen(ctx) {
  if (ctx.parts[0] !== "izinler") return false;
  if (ctx.parts[1] === "form") return (await import("./leave-form.js")).formScreen(ctx);
  const { root, db } = ctx;
  const today = todayStr();
  const d = await db.dumpAll();
  const pid = ctx.parts[1];
  const people = (d.personnel || []).filter((p) => isActive(p) && p.active !== false);
  const nameOf = (id) => (d.personnel || []).find((x) => x.id === id)?.name || "—";
  const formRow = (x) => `<div class="card tap" data-go="#/izinler/form/${esc(x.id)}" style="padding:10px 12px;border-left:4px solid ${FSTAT[x.status] || "#999"}"><div class="row between"><b>${esc(nameOf(x.owner_id))}</b><span class="small" style="color:${FSTAT[x.status] || "inherit"}">${esc(x.status || "")}</span></div><div class="tiny muted">${esc(x.doc_no)} · ${esc(x.leave?.kind || "")} · ${rng(x.leave?.from, x.leave?.to)} · ${x.leave?.days || 0} gün</div></div>`;

  if (!pid) {
    const now = offBetween(d, today, today), soon = offBetween(d, addD(today, 1), addD(today, 14));
    const rows = people.map((p) => ({ p, s: leaveSummary(d, p, { today }) }));
    const noStart = rows.filter((x) => !x.s.ready).length;
    const forms = formsOf(d);
    root.innerHTML = appbar("İzinler", "Yıllık izin · rapor · ücretsiz izin") + `
      <div style="height:10px"></div>
      <div class="row" style="gap:8px;margin-bottom:10px"><button class="btn primary grow" data-go="#/izinler/form/new">📝 İzin talep formu</button><button class="btn grow" data-add>+ Hızlı izin (formsuz)</button></div>
      ${(() => { const pend = forms.filter((x) => x.status === "Onay bekliyor"); return pend.length ? `<div class="section-title">Onay bekleyen talepler (${pend.length})</div>` + pend.map(formRow).join("") : ""; })()}
      <div class="section-title">Bugün izinde (${now.length})</div>
      ${now.map((o) => `<div class="card tap" data-go="#/izinler/${esc(o.p.id)}" style="padding:10px 12px;border-left:4px solid ${COLOR[o.kind] || "#3b82f6"}"><div class="row between"><b>${esc(o.p.name)}</b><span class="small">${esc(o.kind)}</span></div></div>`).join("") || '<div class="muted small" style="margin:4px">Bugün izinli kimse yok.</div>'}
      ${soon.length ? `<div class="section-title">Önümüzdeki 14 gün</div>` + soon.map((o) => `<div class="card tap" data-go="#/izinler/${esc(o.p.id)}" style="padding:10px 12px"><div class="row between"><b>${esc(o.p.name)}</b><span class="small">${rng(o.dates[0], o.dates.at(-1))}</span></div><div class="tiny muted">${esc(o.kind)} · ${o.dates.length} gün</div></div>`).join("") : ""}
      <div class="section-title">Yıllık izin durumu</div>
      ${noStart ? notice("info", `${noStart} kişinin işe giriş tarihi yok; yıllık izin hakkı hesaplanamıyor. Kişiye dokunup girin.`) : ""}
      ${rows.map(({ p, s }) => `<div class="card tap" data-go="#/izinler/${esc(p.id)}" style="padding:10px 12px">
        <div class="row between"><b>${esc(p.name)}</b>${s.remaining != null ? `<b style="color:${s.remaining < 0 ? "#d9534f" : "inherit"}">${s.remaining} gün kalan</b>` : '<span class="muted small">giriş tarihi yok</span>'}</div>
        <div class="tiny muted">${s.ready && !s.hasOpen && s.earnedList.length > 1 ? "⚠ devreden izin girilmemiş · " : ""}${s.start ? `${s.years} yıl kıdem · ` : ""}${s.ready ? `hak ${s.earned} · kullanılan ${s.used}${s.planned ? ` · planlı ${s.planned}` : ""}` : ""}${s.year.report ? ` · bu yıl rapor ${s.year.report}` : ""}${s.year.unpaid ? ` · ücretsiz ${s.year.unpaid}` : ""}</div></div>`).join("") || notice("info", "Personel yok.")}
      <div class="tiny muted" style="margin:8px 4px 80px">Yıllık ücretli izin (İş Kanunu md. 53): 1–5 yıl 14 gün, 5–15 yıl 20 gün, 15 yıl ve üstü 26 gün; 18 yaş ve altı ile 50 yaş ve üstüne en az 20 gün. Hak her yıldönümünde kazanılır, kullanılmayan devreder. Pazar ve resmi tatiller izinden sayılmaz. Kesin uygulama için mali müşavirinize danışın.</div>`;
    qs("[data-add]", root).addEventListener("click", () => leaveSheet(ctx, d));
    return true;
  }


  const p = people.find((x) => x.id === pid);
  if (!p) { root.innerHTML = appbar("İzin") + notice("warn", "Personel bulunamadı"); return true; }
  const s = leaveSummary(d, p, { today });
  root.innerHTML = appbar(p.name, "İzin") + `
    <div style="height:10px"></div>
    <div class="statgrid" style="grid-template-columns:repeat(3,1fr)">
      <div class="stat accent"><div class="v">${s.remaining ?? "—"}</div><div class="l">Kalan gün</div></div>
      <div class="stat"><div class="v">${s.ready ? s.earned : "—"}</div><div class="l">Hak edilen</div></div>
      <div class="stat warn"><div class="v">${s.used}${s.planned ? `+${s.planned}` : ""}</div><div class="l">Kullanılan${s.planned ? "+planlı" : ""}</div></div>
    </div>
    ${s.ready ? "" : notice("warn", "İşe giriş tarihi girilmemiş: yıllık izin hakkı hesaplanamıyor. Aşağıdaki ayarlardan girin.")}
    ${s.ready && !s.hasOpen && s.earnedList.length > 1 ? notice("info", `Hak, işe girişten bu yana ${s.earnedList.length} yılın toplamı (${s.earned} gün). Uygulamadan önce kullandığı izinler burada yok: "İzin ayarları"ndan bugünkü kalan izni (devreden) girin, doğru olsun.`) : ""}
    ${s.nextAt ? `<div class="small muted" style="margin:6px 2px">Sonraki hak: ${trDate(s.nextAt)} tarihinde +${s.nextDays} gün${s.start ? ` · işe giriş ${trDate(s.start)} (${s.years} yıl)` : ""}</div>` : ""}
    <div class="small" style="margin:6px 2px">Bu yıl: yıllık ${s.year.annual} · rapor ${s.year.report} · ücretsiz ${s.year.unpaid} · mazeret ${s.year.excuse}${s.year.other ? ` · türü yazılmamış ${s.year.other}` : ""} gün</div>
    <div class="row" style="gap:8px;margin:8px 0"><button class="btn primary grow" data-go="#/izinler/form/new?pid=${esc(pid)}">📝 İzin talep formu</button><button class="btn grow" data-add>+ Hızlı izin</button></div>
    ${formsOf(d, pid).length ? `<div class="section-title">İzin formları (${formsOf(d, pid).length})</div>` + formsOf(d, pid).slice(0, 10).map(formRow).join("") : ""}
    <div class="section-title">İzin geçmişi</div>
    ${s.ranges.map((r, i) => `<div class="card" style="padding:10px 12px;border-left:4px solid ${COLOR[r.kind] || "#e0a030"}">
      <div class="row between"><b>${rng(r.from, r.to)}</b><span class="small">${r.days} gün</span></div>
      <div class="row between"><span class="tiny muted">${esc(r.kind)}${r.note && r.note !== r.kind ? " · " + esc(r.note) : ""}${r.from > today ? " · planlı" : ""}</span>${r.group && formsOf(d, pid).some((x) => x.id === r.group) ? `<button class="btn sm ghost" data-go="#/izinler/form/${esc(r.group)}">📄 Form</button>` : `<button class="btn sm ghost" data-del="${i}">Sil</button>`}</div></div>`).join("") || '<div class="muted small" style="margin:4px">Kayıtlı izin yok.</div>'}
    <details class="card" ${s.ready ? "" : "open"}><summary class="small strong">⚙ İzin ayarları</summary>
      <div class="formgrid2" style="margin-top:6px">
        <div class="field"><label>İşe giriş tarihi</label><input type="date" data-f="start_date" value="${esc(p.start_date || "")}"></div>
        <div class="field"><label>Doğum tarihi</label><input type="date" data-f="birth_date" value="${esc(p.birth_date || "")}"></div>
        <div class="field"><label>Devreden izin (gün)</label><input type="number" step="1" data-f="leave_open_days" value="${esc(p.leave_open_days ?? "")}" placeholder="ör. 12"></div>
        <div class="field"><label>Hangi tarih itibarıyla</label><input type="date" data-f="leave_open_date" value="${esc(p.leave_open_date || "")}"></div>
      </div>
      <div class="tiny muted">Uygulamaya geçmeden önceki izinleri tek tek girmek yerine: "şu tarihte X gün izni kalmıştı" yazın. Boş bırakılırsa hak işe girişten itibaren hesaplanır.</div>
      <button class="btn sm primary" style="margin-top:6px" data-save>Kaydet</button>
    </details>
    <div class="row" style="gap:6px;margin:8px 0 80px"><button class="btn grow" data-go="#/puantaj/${esc(pid)}">📅 Puantaj</button><button class="btn grow" data-go="#/izinler">← Tüm izinler</button></div>`;
  qs("[data-add]", root).addEventListener("click", () => leaveSheet(ctx, d, { pid }));
  for (const b of qsa("[data-del]", root))
    b.addEventListener("click", async () => {
      const r = s.ranges[Number(b.dataset.del)];
      if (!(await confirmDialog("İzin silinsin mi?", `${rng(r.from, r.to)} · ${r.kind} (${r.days} gün)`, "Sil"))) return;
      for (const id of r.ids) await db.softDelete("personnel_events", id, "İzin silindi");
      toast("Silindi", "ok"); ctx.reload();
    });
  qs("[data-save]", root).addEventListener("click", async () => {
    const f = {};
    for (const el of qsa("[data-f]", root)) f[el.dataset.f] = el.value === "" ? null : el.type === "number" ? Number(el.value) : el.value;
    if (f.leave_open_days != null && !f.leave_open_date) return toast("Devreden izin için tarih girin", "err");
    await db.saveExisting("personnel", p, f, "İzin ayarları");
    toast("Kaydedildi", "ok"); ctx.reload();
  });
  return true;
}
