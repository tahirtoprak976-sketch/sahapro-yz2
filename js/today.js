// "Bugün" panosu: bugün dikkat edilmesi gerekenleri tek listede toplayan saf fonksiyon.
// Ekrana dokunmaz; m-dash.js sonucu çizer. Testlenebilir olması için veri parametre olarak gelir.
import { dumpAccountAlerts } from "./dump-account.js";
import {
  isActive,
  addDays,
  fromKurus,
  latestDocuments,
  backupAgeDays,
  todayStr,
  tankStatus,
} from "./core.js";
import { ledgerOf } from "./esnaf.js";
import { ticketReconcile } from "./assistant-docs.js";
import { fuelFlags } from "./fuel-rules.js";
import { fuelLedgers } from "./assistant-rules.js";
import { yardSite, yardStock } from "./yard-core.js";
import { collectBoardItems } from "./collect-core.js";

const DAY = 86400000;
const daysBetween = (a, b) =>
  Math.round(
    (new Date(b + "T12:00:00").getTime() - new Date(a + "T12:00:00").getTime()) /
      DAY,
  );

export function todayBoard(data, opts = {}) {
  const today = opts.today || todayStr();
  const act = (a) => (a || []).filter(isActive);
  const items = [];

  // 1) Belgeler: aynı sahip+kategoride yalnızca en güncel belge
  const nameOf = (d) =>
    act(data.vehicles).find((v) => v.id === (d.vehicle_id || d.owner_id))
      ?.plate ||
    act(data.vehicles).find((v) => v.id === (d.vehicle_id || d.owner_id))
      ?.name ||
    act(data.personnel).find((p) => p.id === (d.personnel_id || d.owner_id))
      ?.name ||
    "Belge";
  const docs = latestDocuments(act(data.documents))
    .filter((d) => d.expiry_date && d.expiry_date <= addDays(today, 30))
    .sort((a, b) => a.expiry_date.localeCompare(b.expiry_date));
  for (const d of docs) {
    const left = daysBetween(today, d.expiry_date);
    items.push({
      kind: left < 0 ? "alert" : left <= 7 ? "alert" : "warn",
      group: "Belge",
      ic: "📄",
      text: `${nameOf(d)} · ${d.category || "Belge"}`,
      sub:
        left < 0
          ? `${-left} gün önce süresi doldu`
          : left === 0
            ? "Bugün sona eriyor"
            : `${left} gün kaldı`,
      href: "#/belgeler",
      sort: left,
    });
  }

  // 1b) Son 30 günde işte çalışan ama hiç ehliyet kaydı olmayan personel (yasal zorunluluk varsayılmaz; sadece kayıt eksikliği)
  const since = addDays(today, -30);
  const worked = new Set(
    act(data.work_records)
      .filter((w) => w.date >= since && w.date <= today && w.personnel_id)
      .map((w) => w.personnel_id),
  );
  const hasLicense = new Set(
    act(data.documents)
      .filter((d) => d.category === "Ehliyet")
      .map((d) => d.personnel_id || d.owner_id),
  );
  const noLicense = act(data.personnel).filter(
    (p) => worked.has(p.id) && !hasLicense.has(p.id),
  );
  if (noLicense.length)
    items.push({
      kind: "warn",
      group: "Personel",
      ic: "🪪",
      text: `${noLicense.length} çalışanın ehliyet kaydı yok`,
      sub:
        noLicense
          .slice(0, 3)
          .map((p) => p.name)
          .join(", ") + (noLicense.length > 3 ? " …" : ""),
      href: "#/belgeler/new",
      sort: 20,
    });

  // 2) Bakım tarihi gelen araçlar
  for (const v of act(data.vehicles)) {
    if (!v.next_maintenance_date || v.next_maintenance_date > addDays(today, 14))
      continue;
    const left = daysBetween(today, v.next_maintenance_date);
    items.push({
      kind: left <= 0 ? "alert" : "warn",
      group: "Bakım",
      ic: "🔧",
      text: `${v.plate || v.name} bakım`,
      sub: left < 0 ? `${-left} gün gecikti` : left === 0 ? "Bugün" : `${left} gün kaldı`,
      href: "#/bakim",
      sort: left,
    });
  }
  const openMaint = act(data.maintenance_records).filter(
    (m) => m.status !== "Tamamlandı",
  ).length;
  if (openMaint)
    items.push({
      kind: "warn",
      group: "Bakım",
      ic: "🛠",
      text: `${openMaint} açık arıza / bakım kaydı`,
      sub: "",
      href: "#/bakim",
      sort: 99,
    });

  // 3) Esnaf (açık hesap) borçları — alış belgesinin vadesi tarihle aynı olduğundan vade gecikmesi sayılmaz
  const debts = act(data.suppliers)
    .map((s) => ({ s, l: ledgerOf(data, s.id) }))
    .filter((r) => r.l.remaining > 0)
    .sort((a, b) => b.l.remaining - a.l.remaining);
  const debtTotal = debts.reduce((n, r) => n + r.l.remaining, 0);
  if (debts.length)
    items.push({
      kind: "info",
      group: "Esnaf",
      ic: "🔧",
      text: `Esnafa borç: ${debts.length} kişi`,
      sub:
        debts
          .slice(0, 3)
          .map((r) => r.s.name)
          .join(", ") + (debts.length > 3 ? " …" : ""),
      amount: fromKurus(debtTotal),
      href: "#/esnaf",
      sort: 50,
    });

  // 3b) Döküm fişi ↔ sefer mutabakatı (yalnız fiş taranan gün/araçlar)
  for (const r of ticketReconcile(data, { today })) {
    const v = act(data.vehicles).find((x) => x.id === r.vehicle_id);
    items.push({
      kind: r.tickets > r.sefer ? "warn" : "info",
      group: "Sefer",
      ic: "🧾",
      text: `${v?.plate || v?.name || "Araç"} · ${r.date.split("-").reverse().join(".")}: ${r.tickets} döküm fişi, ${r.sefer} sefer kayıtlı`,
      sub: r.tickets > r.sefer ? "Fişi olan ama işe yazılmamış sefer var" : "Bazı seferlerin döküm fişi taranmamış",
      href: "#/isler",
      sort: 60,
    });
  }

  // 3b2) Depo tankı: eksiye düştüyse ya da birkaç gün içinde bitecekse
  if (act(data.fuel_tank_movements).length) {
    const t = tankStatus(data.fuel_tank_movements, today);
    if (t.remaining < 0)
      items.push({ kind: "alert", group: "Depo", ic: "🛢", text: `Depo eksiye düştü: ${Math.round(t.remaining)} L`, sub: "Depoya gelen yakıt girilmemiş olabilir", href: "#/depo", sort: 5 });
    else if (t.daysLeft != null && t.daysLeft <= 3)
      items.push({ kind: t.daysLeft <= 1 ? "alert" : "warn", group: "Depo", ic: "🛢", text: `Depoda ${Math.round(t.remaining)} L kaldı`, sub: `Günde ortalama ${t.daily} L → yaklaşık ${t.daysLeft} gün yeter`, href: "#/depo", sort: 6 });
  }

  // 3b3) Sefer karşılığı mazot alacağı (Kılıç Hafriyat gibi ücreti mazotla ödeyen müşteriler)
  for (const l of fuelLedgers(data))
    if (l.balance >= 1)
      items.push({ kind: "info", group: "Mazot", ic: "⛽", text: `${l.name}: ${l.balance} L mazot alacağı`, sub: `${l.trips} sefer → ${l.earned} L hak edildi, ${l.received} L alındı`, href: "#/musteriler/" + l.id, sort: 55 });

  // 3b4) Kendi depo stoku birikti
  if (yardSite(data)) {
    const ys = opts.yardSettings || {};
    const st = yardStock(data, { settings: ys, today });
    if (st.total >= (Number(ys.alert) || 15))
      items.push({ kind: "warn", group: "Depo", ic: "🏗", text: `Kendi depoda ~${st.total} kamyonet yükü birikti`, sub: st.rows.filter((r) => r.stock > 0).map((r) => `${r.mat} ${r.stock}`).join(", ") + " — döküm sahasına gönderin", href: "#/kendi-depo", sort: 40 });
  }

  // 3b5) Tahsilat: geçen ödeme sözü, 60+ gündür bekleyen alacak, vadesi gelen çek/senet
  for (const i of collectBoardItems(data, { today, notes: opts.collectNotes || {} })) items.push(i);

  // 3c) Yakıt kuralları (tutar, depo, işsiz gün, tüketim)
  for (const f of fuelFlags(data, { today }))
    items.push({ kind: f.kind, group: "Yakıt", ic: "⛽", text: f.text, sub: { total: "Litre × fiyat toplamı tutmuyor", capacity: "Depodan fazla dolum", nowork: "Kontrol edin", consumption: "Tüketim arttı: kaçak, arıza veya yanlış kayıt olabilir" }[f.rule], href: "#/yakit", sort: 70 });

  // 4) Yedek
  const age = backupAgeDays(opts.lastBackupAt, today);
  if (age === null || age >= 3)
    items.push({
      kind: age === null || age >= 7 ? "alert" : "warn",
      group: "Yedek",
      ic: "💾",
      text: age === null ? "Hiç yedek alınmadı" : `Son yedek ${age} gün önce`,
      sub: "Telefon kaybolursa veriler gider — şimdi yedekleyin",
      href: "#/ayarlar?tab=yedek",
      sort: -1000,
    });

  // 4c) Döküm sahası ön ödemeli hesap: bakiye azaldı / eksiye düştü
  for (const a of dumpAccountAlerts(data, { today })) items.push({ ...a, group: "Döküm hesabı", ic: "💳", sort: 8 });

  // 5) Akşam: gün kapatılmadı
  if (opts.dayCloseOpen != null)
    items.push({ kind: opts.dayCloseOpen ? "warn" : "info", group: "Gün sonu", ic: "🌙", text: opts.dayCloseOpen ? `Günü kapat: ${opts.dayCloseOpen} eksik` : "Günü kapat", sub: "Fiyatsız iş, fişsiz sefer, kaydı olmayan şoför, alınmayan mazot…", href: "#/gunsonu", sort: -500 });

  const rank = { alert: 0, warn: 1, info: 2 };
  items.sort((a, b) => rank[a.kind] - rank[b.kind] || a.sort - b.sort);
  return {
    items,
    alerts: items.filter((i) => i.kind === "alert").length,
    warns: items.filter((i) => i.kind === "warn").length,
  };
}
