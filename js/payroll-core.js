// Puantaj ve maaş — SAF katman. Gün durumu: elle işaret (personel hareketi) > iş kaydı (şoför/operatör ya da zimmetli aracı) > pazar.
// Maaş: aylık (devamsızlık günü maaş/30 düşer) ya da yevmiye (çalışılan gün × yevmiye; yarım gün yarım) + mesai saat × mesai ücreti.
// Düşülenler: avans (saha hareketi + ücret defteri), kesinti, yapılmış ödemeler. Masraf, ay kapatılınca "Ücret Tahakkuku" ile BİR KEZ sayılır.
import { isActive, todayStr } from "./core.js";

const live = (d, s) => (d[s] || []).filter(isActive);
const r2 = (n) => Math.round(n * 100) / 100;

export const MARKS = { C: "Çalıştı", Y: "Yarım Gün", I: "İzin", R: "Rapor", D: "Devamsızlık" };
export const MARK_OF = Object.fromEntries(Object.entries(MARKS).map(([k, v]) => [v, k]));
export const MARK_CYCLE = ["", "C", "Y", "I", "R", "D"];
export const PAY_TYPES = ["Aylık", "Yevmiye"];

export function monthDays(period) {
  const [y, m] = period.split("-").map(Number);
  const n = new Date(y, m, 0).getDate();
  return Array.from({ length: n }, (_, i) => `${period}-${String(i + 1).padStart(2, "0")}`);
}
export const isSunday = (date) => new Date(date + "T12:00:00").getDay() === 0;

// Personelin iş kaydı olan günleri: kendi adına yazılan işler + adı yazılmamış ama zimmetli aracının işleri
export function workDaysOf(d, p, period) {
  const myVehicles = new Set(live(d, "vehicles").filter((v) => v.assignee_id === p.id).map((v) => v.id));
  if (p.vehicle_id) myVehicles.add(p.vehicle_id);
  const out = new Map();
  for (const w of live(d, "work_records")) {
    if (!String(w.date).startsWith(period)) continue;
    if (w.personnel_id === p.id || (!w.personnel_id && myVehicles.has(w.vehicle_id))) out.set(w.date, (out.get(w.date) || 0) + 1);
  }
  return out;
}

// Elle işaretler (personel hareketi: Çalıştı / Yarım Gün / İzin / Rapor / Devamsızlık) — aynı gün birden çoksa en sonuncusu
export function marksOf(d, p, period) {
  const out = new Map();
  const evs = live(d, "personnel_events").filter((e) => e.personnel_id === p.id && String(e.date).startsWith(period) && MARK_OF[e.event_type]);
  evs.sort((a, b) => String(a.updated_at || a.created_at || "").localeCompare(String(b.updated_at || b.created_at || "")));
  for (const e of evs) out.set(e.date, { mark: MARK_OF[e.event_type], id: e.id, kind: e.leave_kind || null });
  return out;
}

export function dayGrid(d, p, period, { today = todayStr() } = {}) {
  const works = workDaysOf(d, p, period), marks = marksOf(d, p, period);
  return monthDays(period).map((date) => {
    const m = marks.get(date);
    const w = works.get(date) || 0;
    let st = m?.mark || (w ? "C" : isSunday(date) ? "P" : date > today ? "" : "?");
    return { date, st, auto: !m && !!w, works: w, manual: !!m, eventId: m?.id || null, leaveKind: m?.kind || null, sunday: isSunday(date), future: date > today };
  });
}

export function payrollFor(d, p, period, { today = todayStr() } = {}) {
  const grid = dayGrid(d, p, period, { today });
  const cnt = { C: 0, Y: 0, I: 0, R: 0, D: 0, P: 0, "?": 0 };
  for (const g of grid) if (g.st in cnt) cnt[g.st]++;
  // İzin türü: ücretsiz izin aylık maaştan düşer; yıllık izin yevmiyeliye de ödenir (İş Kanunu md. 57)
  cnt.U = grid.filter((g) => g.st === "I" && g.leaveKind === "Ücretsiz izin").length;
  cnt.A = grid.filter((g) => g.st === "I" && g.leaveKind === "Yıllık izin").length;
  const type = PAY_TYPES.includes(p.pay_type) ? p.pay_type : Number(p.daily_wage) > 0 && !(Number(p.salary) > 0) ? "Yevmiye" : "Aylık";
  const salary = Number(p.salary) || 0, daily = Number(p.daily_wage) || 0, otRate = Number(p.overtime_rate) || 0;
  const evs = live(d, "personnel_events").filter((e) => e.personnel_id === p.id && String(e.date).startsWith(period));
  const pays = live(d, "payroll_entries").filter((e) => e.personnel_id === p.id && e.period === period);
  const otHours = evs.filter((e) => e.event_type === "Mesai").reduce((n, e) => n + (Number(e.hours_days) || 0), 0);
  let base = 0, basis = "";
  if (type === "Aylık") {
    const cut = salary ? r2((salary / 30) * (cnt.D + cnt.U)) : 0;
    base = r2(salary - cut);
    const why = [cnt.D ? `${cnt.D} gün devamsızlık` : "", cnt.U ? `${cnt.U} gün ücretsiz izin` : ""].filter(Boolean).join(" + ");
    basis = salary ? `aylık ${salary.toLocaleString("tr-TR")} ₺${why ? ` − ${why} (${cut.toLocaleString("tr-TR")} ₺)` : ""}` : "";
  } else {
    const days = cnt.C + cnt.Y * 0.5 + cnt.A;
    base = r2(days * daily);
    basis = daily ? `${days.toLocaleString("tr-TR")} gün${cnt.A ? ` (${cnt.A} gün yıllık izin dahil)` : ""} × ${daily.toLocaleString("tr-TR")} ₺` : "";
  }
  const overtime = r2(otHours * otRate);
  const gross = r2(base + overtime);
  const advFieldItems = evs.filter((e) => e.event_type === "Avans" && Number(e.amount) > 0).map((e) => ({ date: e.date, amount: Number(e.amount), src: "saha", note: e.description || "" }));
  const advBookItems = pays.filter((e) => e.kind === "Avans").map((e) => ({ date: e.date, amount: Number(e.amount), src: "defter", note: e.note || "" }));
  const advances = r2([...advFieldItems, ...advBookItems].reduce((n, x) => n + x.amount, 0));
  const deductions = r2(pays.filter((e) => e.kind === "Kesinti").reduce((n, e) => n + Number(e.amount), 0));
  const paid = r2(pays.filter((e) => e.kind === "Ücret Ödemesi").reduce((n, e) => n + Number(e.amount), 0));
  const accrual = pays.find((e) => e.kind === "Ücret Tahakkuku") || null;
  // Personelin cebinden ödediği masraflar (gider / arıza): iade bekleyenler, dönem sonuna kadar olanlar
  const end = monthDays(period).at(-1);
  const reimbItems = [
    ...live(d, "expense_records").filter((e) => e.personnel_id === p.id && e.payment_method === "Personel Ödedi" && e.reimbursement_status === "Bekliyor" && e.date <= end && Number(e.amount) > 0)
      .map((e) => ({ store: "expense_records", id: e.id, date: e.date, amount: Number(e.amount), note: [e.category, e.company].filter(Boolean).join(" · ") })),
    ...live(d, "maintenance_records").filter((m) => m.paid_by_personnel_id === p.id && m.reimbursement_status === "Bekliyor" && m.date <= end && Number(m.cost) > 0)
      .map((m) => ({ store: "maintenance_records", id: m.id, date: m.date, amount: Number(m.cost), note: [m.maint_type, m.service_company].filter(Boolean).join(" · ") })),
  ].sort((a, b) => a.date.localeCompare(b.date));
  const reimb = r2(reimbItems.reduce((n, x) => n + x.amount, 0));
  const remaining = r2((accrual ? Number(accrual.amount) : gross) - advances - deductions - paid + reimb);
  const warns = [];
  if (type === "Aylık" ? !salary : !daily) warns.push(`Ücret girilmemiş (${type === "Aylık" ? "aylık maaş" : "yevmiye"}) — aşağıdan girin`);
  if (cnt["?"]) warns.push(`${cnt["?"]} gün boş (iş kaydı da işaret de yok): çalıştı mı, izinli mi? Güne dokunup işaretleyin`);
  if (otHours && !otRate) warns.push(`${otHours} saat mesai var ama mesai ücreti girilmemiş`);
  if (accrual && Math.abs(Number(accrual.amount) - gross) >= 1) warns.push(`Ay kapatılmış (${Number(accrual.amount).toLocaleString("tr-TR")} ₺); puantaj sonradan değişti, şimdi ${gross.toLocaleString("tr-TR")} ₺ tutuyor`);
  return {
    period, type, grid, cnt, salary, daily, otRate, otHours, base, basis, overtime, gross,
    advances, advItems: [...advFieldItems, ...advBookItems].sort((a, b) => a.date.localeCompare(b.date)),
    deductions, paid, accrual, remaining, closed: !!accrual, warns, reimb, reimbItems,
  };
}

// Bütün personel (pasif olmayanlar) — liste ve sohbet aracı
export function payrollAll(d, period, opts = {}) {
  return live(d, "personnel").filter((p) => p.active !== false).map((p) => ({ p, r: payrollFor(d, p, period, opts) }));
}

// Personele gönderilecek bordro özeti (WhatsApp)
export function payslipText(p, r, { company = "" } = {}) {
  const tl = (n) => Number(n || 0).toLocaleString("tr-TR", { maximumFractionDigits: 2 }) + " ₺";
  const [y, m] = r.period.split("-");
  const lines = [
    `${company ? company + " — " : ""}${m}.${y} ücret özeti`,
    `${p.name}`,
    `Çalışılan: ${r.cnt.C} gün${r.cnt.Y ? ` + ${r.cnt.Y} yarım gün` : ""}${r.cnt.I ? ` · izin ${r.cnt.I}` : ""}${r.cnt.R ? ` · rapor ${r.cnt.R}` : ""}${r.cnt.D ? ` · devamsızlık ${r.cnt.D}` : ""}`,
    r.basis ? `Ücret: ${r.basis} = ${tl(r.base)}` : "",
    r.overtime ? `Mesai: ${r.otHours} saat × ${tl(r.otRate)} = ${tl(r.overtime)}` : "",
    `Hak edilen: ${tl(r.accrual ? r.accrual.amount : r.gross)}`,
    r.advances ? `Avans: − ${tl(r.advances)}` : "",
    r.deductions ? `Kesinti: − ${tl(r.deductions)}` : "",
    r.paid ? `Ödenen: − ${tl(r.paid)}` : "",
    r.reimb ? `Masraf iadesi (cebinden ödediği): + ${tl(r.reimb)}` : "",
    `Kalan: ${tl(r.remaining)}`,
  ];
  return lines.filter(Boolean).join("\n");
}

// Sohbet aracı için kısa özet
export function payrollSummary(p, r) {
  return { personel: p.name, donem: r.period, ucret_turu: r.type, calisilan_gun: r.cnt.C, yarim_gun: r.cnt.Y, izin: r.cnt.I, rapor: r.cnt.R, devamsizlik: r.cnt.D, bos_gun: r.cnt["?"],
    mesai_saat: r.otHours, ucret_TL: r.base, mesai_TL: r.overtime, hak_edilen_TL: r.accrual ? Number(r.accrual.amount) : r.gross, avans_TL: r.advances, masraf_iadesi_TL: r.reimb, kesinti_TL: r.deductions, odenen_TL: r.paid, kalan_TL: r.remaining, ay_kapandi: r.closed, uyarilar: r.warns };
}
