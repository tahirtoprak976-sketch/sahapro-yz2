// Puantaj ve Maaş (#/puantaj, #/puantaj/{personel}?ay=YYYY-AA): gün gün puantaj, maaş hesabı, ödeme ve ay kapatma.
// Hesap payroll-core.js'te. Ay kapatılınca ücret defterine "Ücret Tahakkuku" yazılır (masrafa bir kez girer); ödeme "Ücret Ödemesi" (kasadan).
import { qs, qsa, esc, appbar, toast, notice, fmtTL, fmtNum, todayStr, trDate, confirmDialog, promptDialog, shareText } from "./ui.js";
import { isActive, COMPANY_NAME } from "./core.js";

const TR_M = ["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"];
const label = (per) => `${TR_M[Number(per.slice(5, 7)) - 1]} ${per.slice(0, 4)}`;
const shift = (per, n) => { const [y, m] = per.split("-").map(Number); const t = new Date(y, m - 1 + n, 1); return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}`; };
const lastDay0 = (per) => { const [y, m] = per.split("-").map(Number); return `${per}-${String(new Date(y, m, 0).getDate()).padStart(2, "0")}`; };
// Kapanış tarihi: geçmiş ay → ayın son günü; bu ay → bugün (masraf listesinde hemen görünsün)
const lastDay = (per) => { const t = todayStr(); return lastDay0(per) > t ? t : lastDay0(per); };
const COLORS = { C: "#2e9e6b", Y: "#7fb800", I: "#3b82f6", R: "#8b5cf6", D: "#d9534f", P: "#9aa4b2", "?": "#e0a030", "": "transparent" };
const SHORT = { C: "Ç", Y: "½", I: "İ", R: "R", D: "D", P: "P", "?": "?", "": "" };

export async function screen(ctx) {
  if (ctx.parts[0] !== "puantaj") return false;
  const { root, db } = ctx;
  const core = await import("./payroll-core.js");
  const today = todayStr();
  const per = /^\d{4}-\d{2}$/.test(ctx.query?.ay || "") ? ctx.query.ay : today.slice(0, 7);
  const d = await db.dumpAll();
  const pid = ctx.parts[1];
  const nav = (base) => `<div class="row between" style="margin:10px 0"><button class="btn sm" data-go="${base}?ay=${shift(per, -1)}">‹ ${label(shift(per, -1))}</button><b>${label(per)}</b>${per < today.slice(0, 7) ? `<button class="btn sm" data-go="${base}?ay=${shift(per, 1)}">${label(shift(per, 1))} ›</button>` : "<span></span>"}</div>`;

  if (!pid) {
    const rows = core.payrollAll(d, per, { today });
    const sum = rows.reduce((a, { r }) => ({ hak: a.hak + (r.accrual ? Number(r.accrual.amount) : r.gross), avans: a.avans + r.advances, kalan: a.kalan + Math.max(0, r.remaining) }), { hak: 0, avans: 0, kalan: 0 });
    root.innerHTML = appbar("Puantaj ve Maaş", label(per)) + nav("#/puantaj") +
      (rows.length ? `<div class="statgrid" style="grid-template-columns:repeat(3,1fr)">
        <div class="stat"><div class="v">${fmtTL(sum.hak)}</div><div class="l">Hak edilen ₺</div></div>
        <div class="stat warn"><div class="v">${fmtTL(sum.avans)}</div><div class="l">Avans ₺</div></div>
        <div class="stat accent"><div class="v">${fmtTL(sum.kalan)}</div><div class="l">Ödenecek ₺</div></div></div>` : "") +
      (rows.map(({ p, r }) => `<div class="card tap" data-go="#/puantaj/${esc(p.id)}?ay=${per}">
        <div class="row between"><b>${esc(p.name)}</b>${r.closed ? `<span class="badge ok">${r.remaining > 0.5 ? "kapandı · ödeme kaldı" : "kapandı"}</span>` : `<span class="badge">${r.type}</span>`}</div>
        <div class="small muted">${esc(p.role || "")} · ${r.cnt.C} gün${r.cnt.Y ? ` + ${r.cnt.Y} yarım` : ""}${r.cnt.I ? ` · izin ${r.cnt.I}` : ""}${r.cnt.R ? ` · rapor ${r.cnt.R}` : ""}${r.cnt.D ? ` · devamsız ${r.cnt.D}` : ""}${r.otHours ? ` · mesai ${fmtNum(r.otHours)} sa` : ""}</div>
        <div class="row between small" style="margin-top:4px"><span>Hak edilen ${fmtTL(r.accrual ? r.accrual.amount : r.gross)} ₺${r.advances ? ` · avans ${fmtTL(r.advances)} ₺` : ""}</span><b>Kalan ${fmtTL(r.remaining)} ₺</b></div>
        ${r.warns.length ? `<div class="tiny" style="color:#b9770e;margin-top:3px">⚠ ${esc(r.warns[0])}${r.warns.length > 1 ? ` (+${r.warns.length - 1})` : ""}</div>` : ""}
      </div>`).join("") || notice("info", "Personel kartı yok. Personel ekranından ekleyin.")) +
      `<div class="muted tiny" style="margin:6px 2px">İş kaydı olan günler (şoförün adıyla ya da zimmetli aracıyla) kendiliğinden "çalıştı" sayılır. İzin, rapor, devamsızlığı kişinin puantajında güne dokunarak işaretleyin. Maaş masrafa, ay kapatılınca bir kez yazılır; avanslar ayrıca masraf sayılmaz.</div>`;
    return true;
  }

  const p = (d.personnel || []).find((x) => x.id === pid && isActive(x));
  if (!p) { root.innerHTML = appbar("Puantaj") + notice("warn", "Personel bulunamadı"); return true; }
  const r = core.payrollFor(d, p, per, { today });
  const leave = await import("./leave-core.js");
  const first = new Date(per + "-01T12:00:00").getDay(); // 0 pazar
  const lead = (first + 6) % 7; // pazartesi başlangıç
  const cell = (g) => `<button class="pcell" data-day="${g.date}" ${g.future ? "disabled" : ""} style="border:1px solid var(--border);border-radius:8px;min-height:46px;padding:2px;background:${g.st && g.st !== "P" ? COLORS[g.st] + "22" : "var(--bg2)"};color:var(--text);position:relative">
      <div class="tiny muted">${Number(g.date.slice(8))}</div><div style="font-weight:800;color:${COLORS[g.st]}">${SHORT[g.st]}</div>${g.auto ? '<span style="position:absolute;top:3px;right:4px;width:6px;height:6px;border-radius:3px;background:#2e9e6b"></span>' : ""}</button>`;
  const row = (l, v, sub = "", bold = false) => `<div class="row between small" style="margin:4px 0"><span>${bold ? "<b>" + l + "</b>" : l}${sub ? `<br><span class="muted tiny">${sub}</span>` : ""}</span><b style="white-space:nowrap;margin-left:8px">${v}</b></div>`;
  root.innerHTML = appbar(p.name, "Puantaj · " + label(per)) + nav("#/puantaj/" + pid) +
    `${r.warns.map((w) => notice("warn", w)).join("")}
    <div class="card">
      <div style="display:grid;grid-template-columns:repeat(7,1fr);gap:4px;text-align:center">
        ${["Pzt", "Sal", "Çar", "Per", "Cum", "Cmt", "Paz"].map((x) => `<div class="tiny muted">${x}</div>`).join("")}
        ${"<div></div>".repeat(lead)}${r.grid.map(cell).join("")}
      </div>
      ${r.cnt["?"] ? `<button class="btn sm block" style="margin-top:8px" data-fillc>✓ Boş ${r.cnt["?"]} günün hepsi "çalıştı"</button>` : ""}
      <div class="tiny muted" style="margin-top:8px;line-height:1.6">Ç çalıştı (yeşil nokta: iş kaydından) · ½ yarım gün · İ izin · R rapor · D devamsızlık · P pazar · ? boş<br>Güne dokunun: işaret sırayla değişir (boş → Ç → ½ → İ → R → D).</div>
    </div>
    <div class="card"><div class="strong small">Hesap</div>
      ${row("Ücret", fmtTL(r.base) + " ₺", esc(r.basis || "ücret girilmemiş"))}
      ${r.otHours ? row("Mesai", fmtTL(r.overtime) + " ₺", `${fmtNum(r.otHours)} saat × ${fmtTL(r.otRate)} ₺`) : ""}
      ${row("Hak edilen", fmtTL(r.accrual ? r.accrual.amount : r.gross) + " ₺", r.closed ? "ay kapatıldı" : "", true)}
      ${r.advItems.map((a) => row(`− Avans ${trDate(a.date)}`, fmtTL(a.amount) + " ₺", esc(a.note.slice(0, 60)))).join("")}
      ${r.deductions ? row("− Kesinti", fmtTL(r.deductions) + " ₺") : ""}
      ${r.paid ? row("− Ödenen", fmtTL(r.paid) + " ₺") : ""}
      ${r.reimbItems.map((x) => row(`+ Masraf iadesi ${trDate(x.date)}`, fmtTL(x.amount) + " ₺", esc(x.note) + " · cebinden ödedi")).join("")}
      <div class="divider"></div>
      <div class="row between"><span class="strong">Kalan</span><span class="strong" style="font-size:22px;color:${r.remaining < 0 ? "#d9534f" : "var(--text)"}">${fmtTL(r.remaining)} ₺</span></div>
      ${r.remaining < 0 ? '<div class="tiny" style="color:#d9534f">Fazla ödenmiş / avans maaşı aşmış: gelecek aya devreder.</div>' : ""}
    </div>
    <div class="row" style="gap:6px;flex-wrap:wrap;margin-bottom:8px">
      <button class="btn grow" data-go="#/personel/hareket?pid=${esc(pid)}">➕ Avans / mesai</button>
      <button class="btn grow" data-go="#/izinler/${esc(pid)}">🏖 İzin${(() => { const ls = leave.leaveSummary(d, p, { today }); return ls.remaining != null ? ` (${ls.remaining} gün kalan)` : ""; })()}</button>
      <button class="btn grow" data-share>📤 Personele gönder</button>
    </div>
    <button class="btn primary block" data-pay ${r.remaining > 0.5 || !r.closed ? "" : "disabled"}>${r.closed ? "💵 Kalanı öde" : "💵 Ayı kapat ve öde"}</button>
    ${r.closed && r.warns.some((w) => /sonradan değişti/.test(w)) ? '<button class="btn block" style="margin-top:6px" data-reclose>↻ Kapanışı yeni puantaja göre düzelt</button>' : ""}
    <details class="card" style="margin-top:10px" ${(r.type === "Aylık" ? r.salary : r.daily) ? "" : "open"}><summary class="small strong">⚙ Ücret ayarı</summary>
      <div class="formgrid2" style="margin-top:6px">
        <div class="field"><label>Ücret türü</label><select data-k="pay_type">${core.PAY_TYPES.map((t) => `<option ${t === r.type ? "selected" : ""}>${t}</option>`).join("")}</select></div>
        <div class="field"><label>Aylık maaş (₺)</label><input type="number" step="any" data-k="salary" value="${esc(p.salary ?? "")}"></div>
        <div class="field"><label>Yevmiye (₺/gün)</label><input type="number" step="any" data-k="daily_wage" value="${esc(p.daily_wage ?? "")}"></div>
        <div class="field"><label>Mesai ücreti (₺/saat)</label><input type="number" step="any" data-k="overtime_rate" value="${esc(p.overtime_rate ?? "")}"></div>
      </div>
      <div class="muted tiny">Aylık maaşta her devamsızlık günü maaş/30 düşer; izin, rapor ve pazar düşmez. Yevmiyede çalışılan gün × yevmiye (yarım gün yarım).</div>
      <button class="btn sm primary" style="margin-top:6px" data-savepay>Kaydet</button>
    </details>`;

  for (const b of qsa("[data-day]", root)) b.addEventListener("click", async () => {
    const g = r.grid.find((x) => x.date === b.dataset.day);
    const cur = g.manual ? g.st : g.auto ? "C" : "";
    const target = core.MARK_CYCLE[(core.MARK_CYCLE.indexOf(cur) + 1) % core.MARK_CYCLE.length];
    if (g.eventId) await db.softDelete("personnel_events", g.eventId, "Puantaj değişti");
    if (target && !(g.auto && target === "C")) await db.saveNew("personnel_events", { date: g.date, personnel_id: pid, event_type: core.MARKS[target], amount: null, hours_days: null, description: "Puantaj", source: "puantaj" }, "Puantaj");
    ctx.reload();
  });
  qs("[data-fillc]", root)?.addEventListener("click", async () => {
    for (const g of r.grid.filter((x) => x.st === "?")) await db.saveNew("personnel_events", { date: g.date, personnel_id: pid, event_type: "Çalıştı", amount: null, hours_days: null, description: "Puantaj (toplu)", source: "puantaj" }, "Puantaj");
    ctx.reload();
  });
  qs("[data-savepay]", root).addEventListener("click", async () => {
    const f = {};
    for (const el of qsa("[data-k]", root)) f[el.dataset.k] = el.tagName === "SELECT" ? el.value : el.value === "" ? null : Number(el.value);
    await db.saveExisting("personnel", p, f, "Ücret ayarı");
    toast("Kaydedildi", "ok");
    ctx.reload();
  });
  qs("[data-share]", root).addEventListener("click", async () => {
    shareText(core.payslipText(p, r, { company: COMPANY_NAME }));
  });
  const ent = () => import("./enterprise-db.js");
  qs("[data-pay]", root).addEventListener("click", async () => {
    const hak = r.accrual ? Number(r.accrual.amount) : r.gross;
    if (!(hak > 0)) return toast("Önce ücret ayarını girin", "err");
    if (!r.closed && r.cnt["?"] && !(await confirmDialog("Boş günler var", `${r.cnt["?"]} gün işaretsiz. Aylık maaşta düşülmez, yevmiyede ödenmez. Yine de ay kapatılsın mı?`, "Devam"))) return;
    const amtS = await promptDialog(r.closed ? "Ödenecek tutar (₺)" : `Ay kapatılıyor: hak edilen ${fmtTL(hak)} ₺. Şimdi ödenen tutar (₺, 0 = sonra)`, "Tutar", String(Math.max(0, r.remaining)));
    if (amtS == null) return;
    const amt = Number(String(amtS).replace(",", "."));
    if (!Number.isFinite(amt) || amt < 0) return toast("Tutar geçersiz", "err");
    try {
      const { savePayroll } = await ent();
      if (!r.closed) await savePayroll({ date: lastDay(per), period: per, personnel_id: pid, kind: "Ücret Tahakkuku", amount: r.gross, note: `Puantaj: ${r.basis}${r.overtime ? ` + mesai ${r.otHours} sa` : ""}` });
      // Ödeme kalanı karşılıyorsa cebinden ödediği masraflar da iade edilmiş olur: o kısım maaş ödemesi sayılmaz
      const reimbPay = r.reimb && amt >= r.remaining - 0.5 ? r.reimb : 0;
      const salaryPay = Math.round((amt - reimbPay) * 100) / 100;
      if (salaryPay > 0) await savePayroll({ date: today, period: per, personnel_id: pid, kind: "Ücret Ödemesi", amount: salaryPay, method: "Nakit", note: `${label(per)} maaş ödemesi` });
      if (reimbPay) for (const x of r.reimbItems) { const rec = await db.get(x.store, x.id); if (rec) await db.saveExisting(x.store, rec, { reimbursement_status: "Ödendi" }, "Maaşla iade edildi"); }
      toast(r.closed ? "Ödeme kaydedildi" : "Ay kapatıldı" + (amt > 0 ? " ve ödeme kaydedildi" : ""), "ok");
      ctx.reload();
    } catch (e) { toast(e.message || String(e), "err"); }
  });
  qs("[data-reclose]", root)?.addEventListener("click", async () => {
    if (!(await confirmDialog("Kapanış düzeltilsin mi?", `Hak edilen ${fmtTL(r.accrual.amount)} ₺ → ${fmtTL(r.gross)} ₺ olacak (masraf da güncellenir).`, "Düzelt"))) return;
    await db.softDelete("payroll_entries", r.accrual.id, "Puantaj değişti, yeniden kapatıldı");
    const { savePayroll } = await ent();
    await savePayroll({ date: lastDay(per), period: per, personnel_id: pid, kind: "Ücret Tahakkuku", amount: r.gross, note: `Puantaj (düzeltme): ${r.basis}` });
    toast("Düzeltildi", "ok");
    ctx.reload();
  });
  return true;
}
