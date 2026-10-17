// Müşteri panosu ve ayrıntılı müşteri raporu (PDF). Hesaplar saf (customerReportData), çizim ve PDF ayrı.
// Rakamlar diğer ekranlarla aynı kaynaklardan: bakiye = collect-core, mazot = assistant-rules, ekstre = statement.
import { isActive, toKurus, fromKurus, todayStr, addDays, trDate } from "./core.js";
import { customerLedgerMovements, customerOpenItems, chequeRows, workAmount } from "./collect-core.js";
import { customerStatement } from "./statement.js";
import { customerFuelLedger, fuelRulesOf } from "./assistant-rules.js";

const live = (d, s) => (d[s] || []).filter(isActive);
const r2 = (n) => Math.round(n * 100) / 100;
const fmt = (n) => Number(n || 0).toLocaleString("tr-TR", { maximumFractionDigits: 2 });
const tl = (n) => Number(n || 0).toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " ₺";
const monthKey = (s) => String(s || "").slice(0, 7);

export const PERIODS = {
  month: ["Bu ay", (t) => t.slice(0, 8) + "01"],
  last: ["Geçen ay", (t) => { const d = new Date(t.slice(0, 8) + "01T12:00:00"); d.setMonth(d.getMonth() - 1); return d.toISOString().slice(0, 8) + "01"; }],
  m3: ["Son 3 ay", (t) => addDays(t, -90)],
  year: ["Bu yıl", (t) => t.slice(0, 4) + "-01-01"],
  all: ["Tümü", () => ""],
};
export function periodRange(key, today = todayStr()) {
  const from = PERIODS[key] ? PERIODS[key][1](today) : "";
  let to = today;
  if (key === "last") { const d = new Date(from + "T12:00:00"); d.setMonth(d.getMonth() + 1); d.setDate(0); to = d.toISOString().slice(0, 10); }
  return { from, to, label: PERIODS[key]?.[0] || "Tümü" };
}

export function customerReportData(d, id, { from = "", to = todayStr(), subs = false, today = todayStr() } = {}) {
  const me = live(d, "customers").find((c) => c.id === id);
  if (!me) throw Error("Müşteri bulunamadı");
  const children = live(d, "customers").filter((c) => c.parent_customer_id === id);
  const parent = me.parent_customer_id ? live(d, "customers").find((c) => c.id === me.parent_customer_id) : null;
  const ids = new Set([id, ...(subs ? children.map((c) => c.id) : [])]);
  const nm = (s, x) => (x ? live(d, s).find((r) => r.id === x)?.name || "" : "");
  const inR = (x) => x && (!from || x >= from) && (!to || x <= to);
  const works = live(d, "work_records").filter((w) => ids.has(w.customer_id) && inR(w.date))
    .sort((a, b) => String(a.date).localeCompare(String(b.date)) || String(a.created_at || "").localeCompare(String(b.created_at || "")))
    .map((w) => ({
      id: w.id, date: w.date, customer: w.customer_id !== id ? nm("customers", w.customer_id) : "", vehicle: nm("vehicles", w.vehicle_id), personnel: nm("personnel", w.personnel_id),
      type: w.work_type || "", qty: Number(w.quantity) || 0, unit: w.unit || "", material: w.material || "",
      from: nm("quarries", w.quarry_id) || w.quarry || "", site: nm("sites", w.site_id), to: nm("dump_sites", w.dump_site_id) || w.dump_area || "",
      tonnage: Number(w.tonnage) || 0, slip: w.slip_no || "", unit_price: Number(w.price_snapshot?.unit_price) || 0, amount: workAmount(w),
      fuelL: Number(w.customer_fuel_allowance_l) || 0, locked: !!w.price_snapshot?.locked, note: w.description || "",
    }));
  const units = {};
  for (const w of works) units[w.unit] = r2((units[w.unit] || 0) + w.qty);
  const byType = {}, byVehicle = {};
  for (const w of works) {
    const t = byType[w.type || "Diğer"] ||= { count: 0, amount: 0, units: {} };
    t.count++; t.amount = r2(t.amount + w.amount); t.units[w.unit] = r2((t.units[w.unit] || 0) + w.qty);
    const v = byVehicle[w.vehicle || "—"] ||= { count: 0, amount: 0, units: {} };
    v.count++; v.amount = r2(v.amount + w.amount); v.units[w.unit] = r2((v.units[w.unit] || 0) + w.qty);
  }
  // Tahsilatlar: cari hareketlerden (nakit ve havale ikisi de buraya yazılır)
  const collections = live(d, "cari_movements").filter((m) => ids.has(m.customer_id) && m.type === "Tahsilat" && inR(m.date))
    .sort((a, b) => String(a.date).localeCompare(String(b.date)))
    .map((m) => {
      const cash = live(d, "cash_records").find((c) => c.id === m.ref_id);
      return { date: m.date, amount: -Number(m.amount) || 0, method: cash?.payment_method || (cash ? "Nakit" : "Banka / diğer"), note: cash?.description && !/^Asistan/.test(cash.description) ? cash.description : m.note === "Tahsilat" ? "" : m.note || "" };
    });
  // Cari ekstre (devir + dönem + kalan)
  const movs = [...ids].flatMap((x) => customerLedgerMovements(d, x));
  const statement = customerStatement(movs.map((m) => ({ ...m, customer_id: id })), id, { from, to });
  const balanceNow = r2(movs.reduce((n, m) => n + (Number(m.amount) || 0), 0));
  // Açık kalemler / yaşlandırma (bugün itibarıyla)
  const open = [...ids].flatMap((x) => customerOpenItems(d, x, today).open).sort((a, b) => a.date.localeCompare(b.date));
  const aging = { b0: 0, b30: 0, b60: 0, b90: 0 };
  for (const o of open) aging[o.days <= 30 ? "b0" : o.days <= 60 ? "b30" : o.days <= 90 ? "b60" : "b90"] = r2(aging[o.days <= 30 ? "b0" : o.days <= 60 ? "b30" : o.days <= 90 ? "b60" : "b90"] + o.left);
  // Son 12 ay: iş değeri ve tahsilat
  const months = [];
  { const d0 = new Date(today.slice(0, 8) + "01T12:00:00"); for (let i = 11; i >= 0; i--) { const x = new Date(d0); x.setMonth(x.getMonth() - i); months.push({ key: x.toISOString().slice(0, 7), work: 0, collected: 0 }); } }
  for (const w of live(d, "work_records").filter((w) => ids.has(w.customer_id))) { const m = months.find((x) => x.key === monthKey(w.date)); if (m) m.work = r2(m.work + workAmount(w)); }
  for (const c of live(d, "cari_movements").filter((m) => ids.has(m.customer_id) && m.type === "Tahsilat")) { const m = months.find((x) => x.key === monthKey(c.date)); if (m) m.collected = r2(m.collected - Number(c.amount)); }
  const fuel = fuelRulesOf(me).length || works.some((w) => w.fuelL) ? customerFuelLedger(d, id) : null;
  const cheques = chequeRows(d, today).filter((q) => q.party_type === "customer" && ids.has(q.party_id));
  const workTotal = r2(works.reduce((n, w) => n + w.amount, 0));
  const collected = r2(collections.reduce((n, c) => n + c.amount, 0));
  return {
    customer: me, parent, children, from, to, subs, works, units, byType, byVehicle, collections, statement, balanceNow, open, aging, months, fuel, cheques,
    totals: { works: works.length, workTotal, collected, tonnage: r2(works.reduce((n, w) => n + w.tonnage, 0)), fuelL: r2(works.reduce((n, w) => n + w.fuelL, 0)), unpriced: works.filter((w) => !w.amount && !w.fuelL).length, oldestDays: open[0]?.days || 0 },
  };
}

const unitsText = (u) => Object.entries(u).map(([k, q]) => `${fmt(q)} ${String(k).toLocaleLowerCase("tr-TR")}`).join(", ") || "—";

// PDF tanımı (document-engine bölümleri)
export function customerReportSpec(R, { audience = "customer", chart = null, photos = [], company = "" } = {}) {
  const per = R.from ? `${trDate(R.from)} – ${trDate(R.to)}` : `Başlangıç – ${trDate(R.to)}`;
  const internal = audience === "internal";
  const S = [];
  S.push({ title: "Müşteri ve Dönem", pairs: [
    ["Müşteri", R.customer.name], ["Dönem", per], ["Telefon", R.customer.phone || ""], ["Ana firma", R.parent?.name || ""],
    ["Taşeronlar", R.children.length ? R.children.map((c) => c.name).join(", ") + (R.subs ? " (rapora dahil)" : " (dahil değil)") : ""],
  ] });
  S.push({ title: "Özet", layout: "totals", pairs: [
    ["İş sayısı", String(R.totals.works)], ["Miktar", unitsText(R.units)],
    ...(R.totals.tonnage ? [["Toplam ton (fiş)", fmt(R.totals.tonnage) + " ton"]] : []),
    ...(R.totals.fuelL ? [["Mazot karşılığı", fmt(R.totals.fuelL) + " L"]] : []),
    ["İş tutarı (dönem)", tl(R.totals.workTotal)], ["Tahsilat (dönem)", tl(R.totals.collected)],
    ["Dönem başı devir", tl(R.statement.opening)], ["Dönem sonu bakiye", tl(R.statement.closing)],
  ] });
  if (chart) S.push({ title: "Son 12 ay: iş tutarı ve tahsilat", image: chart, image_width: 760, max_h: 200 });
  S.push({ title: "İş Dökümü", headers: ["Tarih", "Araç", "Operatör", "İş", "Miktar", "Nereden → Nereye", "Malzeme", "Ton", "Fiş No", "Birim Fiyat", "Tutar"],
    widths: [7, 9, 8, 11, 7, 17, 8, 5, 7, 8, 9],
    rows: R.works.map((w) => [trDate(w.date), w.vehicle, w.personnel, w.type + (w.customer ? ` [${w.customer}]` : ""), `${fmt(w.qty)} ${w.unit}`,
      [w.from, w.site, w.to].filter(Boolean).join(" → "), w.material, w.tonnage ? fmt(w.tonnage) : "", w.slip,
      w.unit_price ? tl(w.unit_price) : "", w.amount ? tl(w.amount) : w.fuelL ? `${fmt(w.fuelL)} L mazot` : "fiyatsız"]) });
  S.push({ title: "İş türüne göre", headers: ["İş türü", "İş sayısı", "Miktar", "Tutar"], widths: [40, 15, 25, 20],
    rows: Object.entries(R.byType).map(([k, v]) => [k, String(v.count), unitsText(v.units), tl(v.amount)]) });
  S.push({ title: "Araca göre", headers: ["Araç / makine", "İş sayısı", "Miktar", "Tutar"], widths: [40, 15, 25, 20],
    rows: Object.entries(R.byVehicle).map(([k, v]) => [k, String(v.count), unitsText(v.units), tl(v.amount)]) });
  S.push({ title: "Tahsilatlar", headers: ["Tarih", "Şekil", "Açıklama", "Tutar"], widths: [15, 20, 45, 20],
    rows: R.collections.length ? R.collections.map((c) => [trDate(c.date), c.method, c.note, tl(c.amount)]) : [["", "", "Bu dönemde tahsilat yok", ""]] });
  S.push({ title: "Cari Ekstre", headers: ["Tarih", "İşlem", "Açıklama", "Borç", "Tahsilat", "Bakiye"], widths: [11, 12, 41, 12, 12, 12],
    rows: [["", "Devir", "", "", "", tl(R.statement.opening)], ...R.statement.rows.map((r) => [trDate(r.date), r.type, r.text, r.debit ? tl(r.debit) : "", r.credit ? tl(r.credit) : "", tl(r.balance)])] });
  if (R.open.length)
    S.push({ title: `Açık kalemler (bugün itibarıyla · toplam ${tl(R.open.reduce((n, o) => n + o.left, 0))})`, headers: ["Tarih", "Kalem", "Gün", "Tutar", "Kalan"], widths: [13, 47, 10, 15, 15],
      rows: R.open.map((o) => [trDate(o.date), o.label, String(o.days), tl(o.amount), tl(o.left)]) });
  if (internal && (R.aging.b30 || R.aging.b60 || R.aging.b90 || R.aging.b0))
    S.push({ title: "Yaşlandırma", pairs: [["0–30 gün", tl(R.aging.b0)], ["31–60 gün", tl(R.aging.b30)], ["61–90 gün", tl(R.aging.b60)], ["90+ gün", tl(R.aging.b90)]] });
  if (R.fuel)
    S.push({ title: "Mazot hesabı (ücreti mazotla ödenen işler)", pairs: [["Hak edilen", fmt(R.fuel.earned) + " L"], ["Alınan", fmt(R.fuel.received) + " L"], [R.fuel.balance >= 0 ? "Kalan alacak" : "Fazla alınan", fmt(Math.abs(R.fuel.balance)) + " L"]] });
  if (R.cheques.length)
    S.push({ title: "Çek / senet", headers: ["Tür", "No", "Vade", "Durum", "Tutar"], widths: [15, 20, 20, 25, 20], rows: R.cheques.map((q) => [q.kind, q.document_no, trDate(q.due_date), q.status, tl(q.amount)]) });
  for (const p of photos) S.push({ title: p.title, image: p.blob, image_width: 520, max_h: 340 });
  S.push({ layout: "notice", text: `Bu rapor ${company || "işletme"} kayıtlarından hazırlanmıştır. Fiyatı girilmemiş işler tutara katılmamıştır${R.totals.unpriced ? ` (${R.totals.unpriced} iş)` : ""}. Hata görürseniz lütfen bildirin.` });
  return {
    template: "account", title: `${R.customer.name} — Müşteri Raporu`, audience, orientation: "landscape",
    filename: `Musteri_Raporu_${R.customer.name.replace(/[^\wÇĞİÖŞÜçğıöşü]+/g, "_")}_${R.to}.pdf`, sections: S,
  };
}

// Pano: tarayıcıda SVG; PDF için aynı veriyi tuvale çizer
export function monthsSvg(months) {
  const max = Math.max(1, ...months.flatMap((m) => [m.work, m.collected]));
  const W = 340, H = 130, bw = 10, gap = 28 - bw * 2;
  const bars = months.map((m, i) => {
    const x = 12 + i * 27, h1 = (m.work / max) * 90, h2 = (m.collected / max) * 90;
    return `<rect x="${x}" y="${100 - h1}" width="${bw}" height="${Math.max(m.work ? 1.5 : 0, h1)}" rx="2" fill="#f5a623"><title>${m.key} iş ${fmt(m.work)} ₺</title></rect>` +
      `<rect x="${x + bw + 1}" y="${100 - h2}" width="${bw}" height="${Math.max(m.collected ? 1.5 : 0, h2)}" rx="2" fill="#2e9e6b"><title>${m.key} tahsilat ${fmt(m.collected)} ₺</title></rect>` +
      `<text x="${x + bw}" y="116" text-anchor="middle" style="font-size:8px;fill:#93a4b5">${m.key.slice(5)}</text>`;
  }).join("");
  return `<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto" role="img" aria-label="Son 12 ay iş tutarı ve tahsilat">${bars}<line x1="8" y1="100" x2="${W - 4}" y2="100" stroke="#cfd8e0"/></svg><div class="row small" style="gap:12px"><span><b style="color:#f5a623">■</b> İş tutarı</span><span><b style="color:#2e9e6b">■</b> Tahsilat</span></div>`;
}
export async function monthsChartBlob(months) {
  const c = document.createElement("canvas");
  c.width = 1600; c.height = 420;
  const x = c.getContext("2d");
  x.fillStyle = "#fff"; x.fillRect(0, 0, c.width, c.height);
  const max = Math.max(1, ...months.flatMap((m) => [m.work, m.collected]));
  const step = (c.width - 120) / months.length, bw = step * 0.32, base = 340;
  x.font = "22px sans-serif"; x.textAlign = "center";
  months.forEach((m, i) => {
    const x0 = 90 + i * step;
    const h1 = (m.work / max) * 290, h2 = (m.collected / max) * 290;
    x.fillStyle = "#f5a623"; x.fillRect(x0, base - h1, bw, h1);
    x.fillStyle = "#2e9e6b"; x.fillRect(x0 + bw + 4, base - h2, bw, h2);
    x.fillStyle = "#53687b"; x.fillText(m.key.slice(5) + "/" + m.key.slice(2, 4), x0 + bw, base + 30);
    if (m.work) { x.fillStyle = "#142c42"; x.font = "17px sans-serif"; x.fillText(Math.round(m.work / 1000) + "k", x0 + bw / 2, base - h1 - 8); x.font = "22px sans-serif"; }
  });
  x.strokeStyle = "#cfd8e0"; x.beginPath(); x.moveTo(60, base); x.lineTo(c.width - 20, base); x.stroke();
  x.textAlign = "left"; x.font = "22px sans-serif";
  x.fillStyle = "#f5a623"; x.fillRect(60, 385, 22, 22); x.fillStyle = "#142c42"; x.fillText("İş tutarı (₺)", 90, 404);
  x.fillStyle = "#2e9e6b"; x.fillRect(300, 385, 22, 22); x.fillStyle = "#142c42"; x.fillText("Tahsilat (₺)", 330, 404);
  return new Promise((res) => c.toBlob(res, "image/png"));
}
export function barsHtml(obj, label = (v) => fmt(v.amount) + " ₺", val = (v) => v.amount || v.count) {
  const rows = Object.entries(obj).sort((a, b) => val(b[1]) - val(a[1])).slice(0, 8);
  const max = Math.max(1, ...rows.map(([, v]) => val(v)));
  return rows.map(([k, v]) => `<div class="small" style="margin:4px 0"><div class="row between"><span class="ellipsis">${k.replace(/[<>&]/g, "")}</span><span class="muted">${v.count} iş · ${unitsText(v.units)} · ${label(v)}</span></div><div style="height:7px;background:var(--surface2,#edf2f6);border-radius:4px"><div style="height:7px;width:${Math.round((val(v) / max) * 100)}%;background:#f5a623;border-radius:4px"></div></div></div>`).join("") || '<div class="muted small">—</div>';
}
