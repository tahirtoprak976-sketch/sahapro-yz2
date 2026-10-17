// Tüm masraflar tek listede: gider + araca verilen yakıt + bakım/arıza + esnafa veresiye alış (gidere/bakıma bağlı değilse).
// Ana sayfa grafiği, Finans özeti, Giderler ekranı ve Yönetici paneli aynı tanımı kullanır.
// Müşterinin iş karşılığı verdiği mazot masraf sayılmaz (litre olarak müşterinin mazot hesabında izlenir).
// Depoya alınan mazot (tank girişi) masraf sayılmaz: araca verildikçe "Yakıt" olarak sayılır (çift sayım olmasın).
import { isActive, toKurus, fromKurus } from "./core.js";
import { fuelPrice } from "./finance-chart.js";
import { dumpFeeRows } from "./dump-fees.js";

const live = (d, s) => (d[s] || []).filter(isActive);
export const COST_KINDS = { gider: "Gider", yakit: "Yakıt", bakim: "Bakım / Arıza", esnaf: "Esnaf alışı", dokum: "Döküm ücreti", personel: "Personel maaşı" };

export function billTotal(b) {
  if (Number(b.gross_total) > 0) return Number(b.gross_total);
  if (Number(b.total) > 0) return Number(b.total);
  if (Number(b.grand_total) > 0) return Number(b.grand_total);
  return (b.items || []).reduce((n, i) => n + (Number(i.total ?? i.gross ?? i.amount) || 0), 0);
}

export function costRows(d, { from = "", to = "", fuelRefPrice = null } = {}) {
  const inR = (x) => x && (!from || x >= from) && (!to || x <= to);
  const rows = [];
  const name = (s, id) => (id ? live(d, s).find((x) => x.id === id)?.name || "" : "");
  for (const e of live(d, "expense_records"))
    if (inR(e.date) && Number(e.amount) > 0 && !e.dump_deposit) // döküm hesabına yükleme gider değil (döküm ücreti ayrıca yazılır)
      rows.push({ kind: "gider", id: e.id, date: e.date, amount: Number(e.amount), label: e.category || "Gider", sub: [e.company, e.description].filter(Boolean).join(" · "), vehicle_id: e.vehicle_id || null, href: null });
  for (const f of live(d, "fuel_records")) {
    if (!inR(f.date)) continue;
    // Müşterinin verdiği mazot (ör. Kılıç'ın iş karşılığı) masraf değildir: kasadan para çıkmaz
    const a = Number(f.total) || 0;
    if (a > 0) rows.push({ kind: "yakit", id: f.id, date: f.date, amount: Math.round(a * 100) / 100, label: `${name("vehicles", f.vehicle_id) || "Araç"} · ${Number(f.liters) || 0} L`, sub: f.fuel_source || "", vehicle_id: f.vehicle_id || null, href: "#/yakit/" + f.id });
  }
  for (const m of live(d, "maintenance_records"))
    if (inR(m.date) && Number(m.cost) > 0)
      rows.push({ kind: "bakim", id: m.id, date: m.date, amount: Number(m.cost), label: `${name("vehicles", m.vehicle_id) || "Araç"} · ${m.maint_type || "Bakım"}`, sub: [m.service_company, m.description].filter(Boolean).join(" · "), vehicle_id: m.vehicle_id || null, href: "#/bakim/" + m.id });
  for (const b of live(d, "payables")) {
    if (b.status === "İptal" || b.party_type !== "supplier" || !inR(b.date)) continue;
    if (["expense_records", "maintenance_records", "fuel_tank_movements", "fuel_records"].includes(b.source_store)) continue; // zaten sayıldı / depo alışı
    const a = billTotal(b);
    if (a > 0) rows.push({ kind: "esnaf", id: b.id, date: b.date, amount: Math.round(a * 100) / 100, label: `${name("suppliers", b.party_id) || "Esnaf"} · ${b.cost_category || "Alış"}`, sub: b.description || "", vehicle_id: b.vehicle_id || null, href: "#/esnaf/" + b.party_id });
  }
  // Döküm ücreti: döküm sahası kartındaki ücret × fişteki ton (ya da aracın ortalama yükü) / sefer
  for (const f of dumpFeeRows(d, { from, to }))
    if (f.amount > 0)
      rows.push({ kind: "dokum", id: "dokum:" + f.w.id, date: f.w.date, amount: f.amount, label: `${f.site} · ${f.manual ? "elle yazılan" : f.unit === "Ton" ? (f.estimated ? "~" : "") + f.ton + " ton × " + f.fee + " ₺" : f.trips + " sefer × " + f.fee + " ₺"}`, sub: [name("vehicles", f.w.vehicle_id), name("customers", f.w.customer_id)].filter(Boolean).join(" · ") + (f.estimated ? " · ton tahmini (fiş yok)" : ""), vehicle_id: f.w.vehicle_id || null, href: "#/isler/" + f.w.id });
  // Personel maaşı: puantajda ay kapatılınca yazılan "Ücret Tahakkuku" (avans ve ödemeler ayrıca sayılmaz → çift sayım yok)
  for (const p of live(d, "payroll_entries"))
    if (p.kind === "Ücret Tahakkuku" && inR(p.date) && Number(p.amount) > 0)
      rows.push({ kind: "personel", id: p.id, date: p.date, amount: Number(p.amount), label: `${name("personnel", p.personnel_id) || "Personel"} · ${p.period} maaşı`, sub: p.note || "", vehicle_id: null, href: "#/puantaj/" + p.personnel_id + "?ay=" + p.period });
  rows.sort((a, b) => b.date.localeCompare(a.date));
  return rows;
}

export function costTotals(rows) {
  const t = { gider: 0, yakit: 0, bakim: 0, esnaf: 0, dokum: 0, personel: 0 };
  for (const r of rows) t[r.kind] += toKurus(r.amount);
  const total = t.gider + t.yakit + t.bakim + t.esnaf + t.dokum + t.personel;
  return { gider: fromKurus(t.gider), yakit: fromKurus(t.yakit), bakim: fromKurus(t.bakim), esnaf: fromKurus(t.esnaf), dokum: fromKurus(t.dokum), personel: fromKurus(t.personel), total: fromKurus(total) };
}
