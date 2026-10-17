// İzin takibi — SAF katman. İzinler personel hareketi olarak tutulur (event_type "İzin" / "Rapor", leave_kind ile türü);
// puantaj ve maaş aynı kayıtları okur. Yıllık ücretli izin hakkı İş Kanunu md. 53'e göre kıdemden hesaplanır:
// 1–5 yıl (5 dahil) 14 gün, 5–15 yıl 20 gün, 15 yıl ve üstü 26 gün; 18 yaş ve altı ile 50 yaş ve üstüne en az 20 gün.
// Hak, her çalışma yılı dolduğunda kazanılır; kullanılmayan izin devreder. İzne denk gelen pazar ve resmi bayramlar izinden sayılmaz.
import { isActive, todayStr } from "./core.js";

const live = (d, s) => (d[s] || []).filter(isActive);
export const LEAVE_KINDS = ["Yıllık izin", "Ücretsiz izin", "Mazeret izni", "Rapor"];
export const eventTypeOf = (kind) => (kind === "Rapor" ? "Rapor" : "İzin");
// Sabit tarihli resmi tatiller (dini bayramlar her yıl değişir; onlar elle düşülür)
const FIXED_HOLIDAYS = ["01-01", "04-23", "05-01", "05-19", "07-15", "08-30", "10-29"];
export const isHoliday = (date) => FIXED_HOLIDAYS.includes(String(date).slice(5));
export const isSunday = (date) => new Date(date + "T12:00:00").getDay() === 0;
const addDays = (date, n) => { const x = new Date(date + "T12:00:00Z"); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const validD = (s) => (/^\d{4}-\d{2}-\d{2}$/.test(String(s || "")) ? String(s) : null);

// Başlangıç–bitiş arasında izinden sayılan günler (pazar ve sabit resmi tatiller hariç)
export function leaveDays(from, to) {
  const out = [];
  if (!validD(from) || !validD(to) || to < from) return out;
  for (let d = from; d <= to && out.length < 400; d = addDays(d, 1)) if (!isSunday(d) && !isHoliday(d)) out.push(d);
  return out;
}

// Tam yıl farkı (yıldönümü geçtiyse sayılır)
export function fullYears(from, to) {
  if (!validD(from) || !validD(to) || to < from) return 0;
  let y = Number(to.slice(0, 4)) - Number(from.slice(0, 4));
  if (to.slice(5) < from.slice(5)) y--;
  return Math.max(0, y);
}
// k. çalışma yılı dolduğunda kazanılan gün (k ≥ 1). Yaş, o yıldönümündeki yaştır.
export function daysForYear(k, ageAtAnniv = null) {
  if (k < 1) return 0;
  let n = k <= 5 ? 14 : k < 15 ? 20 : 26;
  if (ageAtAnniv != null && (ageAtAnniv <= 18 || ageAtAnniv >= 50)) n = Math.max(n, 20);
  return n;
}
const anniv = (start, k) => `${Number(start.slice(0, 4)) + k}${start.slice(4)}`;

// Kişinin izin kayıtları (gün gün) — türüyle
export function leaveEvents(d, pid) {
  return live(d, "personnel_events")
    .filter((e) => e.personnel_id === pid && (e.event_type === "İzin" || e.event_type === "Rapor"))
    .map((e) => ({ id: e.id, date: e.date, kind: e.leave_kind || (e.event_type === "Rapor" ? "Rapor" : "İzin (türü yazılmamış)"), note: e.description || "", group: e.leave_group || null }))
    .sort((a, b) => a.date.localeCompare(b.date));
}
// Ardışık günleri (aradaki pazar/tatil boşluğu dahil) aynı türde tek satırda topla
export function leaveRanges(events) {
  const out = [];
  for (const e of events) {
    const last = out.at(-1);
    let contiguous = false;
    if (last && last.kind === e.kind && (!e.group || e.group === last.group)) {
      let d = addDays(last.to, 1);
      while (d < e.date && (isSunday(d) || isHoliday(d))) d = addDays(d, 1);
      contiguous = d === e.date;
    }
    if (contiguous) { last.to = e.date; last.days++; last.ids.push(e.id); }
    else out.push({ from: e.date, to: e.date, days: 1, kind: e.kind, note: e.note, group: e.group, ids: [e.id] });
  }
  return out;
}

// Yıllık izin özeti. p.start_date: işe giriş; p.leave_open_days + p.leave_open_date: o tarihteki kalan (geçmiş için elle)
export function leaveSummary(d, p, { today = todayStr() } = {}) {
  const start = validD(p.start_date);
  const birth = validD(p.birth_date);
  const ev = leaveEvents(d, p.id);
  const annual = ev.filter((e) => e.kind === "Yıllık izin");
  const openDate = validD(p.leave_open_date);
  const hasOpen = openDate && Number.isFinite(Number(p.leave_open_days)) && p.leave_open_days !== null && p.leave_open_days !== "";
  const years = start ? fullYears(start, today) : null;
  // Kazanılan: işe girişten (ya da açılış tarihinden sonraki yıldönümlerinden) bugüne kadar dolan her yıl
  const earnedList = [];
  if (start) for (let k = 1; k <= years; k++) {
    const at = anniv(start, k);
    if (hasOpen && at <= openDate) continue;
    earnedList.push({ k, date: at, days: daysForYear(k, birth ? fullYears(birth, at) : null) });
  }
  const earned = earnedList.reduce((n, x) => n + x.days, 0) + (hasOpen ? Number(p.leave_open_days) : 0);
  const usedAll = annual.filter((e) => !hasOpen || e.date > openDate);
  const used = usedAll.filter((e) => e.date <= today).length;
  const planned = usedAll.filter((e) => e.date > today).length;
  const nextAt = start ? anniv(start, (years || 0) + 1) : null;
  const nextDays = start ? daysForYear((years || 0) + 1, birth ? fullYears(birth, nextAt) : null) : null;
  const yearStart = today.slice(0, 4) + "-01-01";
  const thisYear = (kind) => ev.filter((e) => e.kind === kind && e.date >= yearStart && e.date <= today).length;
  const ready = !!start || hasOpen;
  return {
    ready, start, years, earned, earnedList, used, planned, remaining: ready ? earned - used - planned : null,
    nextAt, nextDays, hasOpen: !!hasOpen,
    year: { annual: thisYear("Yıllık izin"), unpaid: thisYear("Ücretsiz izin"), excuse: thisYear("Mazeret izni"), report: thisYear("Rapor"), other: thisYear("İzin (türü yazılmamış)") },
    ranges: leaveRanges(ev).reverse(),
  };
}

// Bugün / önümüzdeki günlerde izinde olanlar
export function offBetween(d, from, to) {
  const ps = new Map(live(d, "personnel").map((p) => [p.id, p]));
  const out = new Map();
  for (const e of live(d, "personnel_events")) {
    if ((e.event_type !== "İzin" && e.event_type !== "Rapor") || e.date < from || e.date > to || !ps.has(e.personnel_id)) continue;
    const o = out.get(e.personnel_id) || { p: ps.get(e.personnel_id), dates: [], kind: e.leave_kind || e.event_type };
    o.dates.push(e.date);
    out.set(e.personnel_id, o);
  }
  return [...out.values()].map((o) => ({ ...o, dates: o.dates.sort() }));
}
