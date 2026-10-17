// Fatura hazırlık — SAF katman. Faturası kesilmemiş fiyatlı işler müşteri bazında toplanır; eLogo'ya (ya da GİB portalına)
// girilecek kalemler (açıklama, miktar, birim, KDV hariç birim fiyat, KDV) ve toplamlar hazırlanır.
// Faturayı uygulama KESMEZ; kesilen faturanın no/tarihi işlere yazılır (faturalandı işareti).
import { isActive, todayStr, trDate } from "./core.js";
import { workAmount } from "./collect-core.js";

const live = (d, s) => (d[s] || []).filter(isActive);
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const days = (a, b) => Math.round((Date.parse(b + "T12:00:00Z") - Date.parse(a + "T12:00:00Z")) / 864e5);
export const WITHHOLDING = ["Yok", "2/10", "4/10", "5/10", "7/10", "9/10"];
const wh = (s) => { const m = /^(\d+)\/10$/.exec(String(s || "")); return m ? Number(m[1]) / 10 : 0; };

// Bir işin KDV hariç tutarı ve KDV oranı
export function workNet(w) {
  const a = workAmount(w);
  const p = w.price_snapshot || {};
  const rate = Number.isFinite(Number(p.kdv_rate)) && p.kdv_rate !== null && p.kdv_rate !== "" ? Number(p.kdv_rate) : 20;
  const net = p.kdv_included ? a / (1 + rate / 100) : a;
  return { net: r2(net), rate };
}

export function uninvoicedWorks(d, { customerId = null, from = "", to = todayStr() } = {}) {
  const internal = new Set(live(d, "customers").filter((c) => c.internal).map((c) => c.id));
  return live(d, "work_records").filter((w) => !w.invoice_no && w.customer_id && !internal.has(w.customer_id) && (!customerId || w.customer_id === customerId)
    && workAmount(w) > 0 && !(Number(w.customer_fuel_allowance_l) > 0) && (!from || w.date >= from) && (!to || w.date <= to))
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));
}

// Müşteri bazında özet (liste ekranı)
export function invoiceQueue(d, { today = todayStr(), from = "", to = today } = {}) {
  const by = new Map();
  for (const w of uninvoicedWorks(d, { from, to })) {
    const o = by.get(w.customer_id) || { works: [], net: 0 };
    o.works.push(w); o.net = r2(o.net + workNet(w).net); by.set(w.customer_id, o);
  }
  return [...by.entries()].map(([cid, o]) => {
    const c = live(d, "customers").find((x) => x.id === cid) || {};
    return { customer: c, n: o.works.length, net: o.net, oldest: o.works[0].date, oldestDays: days(o.works[0].date, today), missing: missingInfo(c) };
  }).sort((a, b) => b.oldestDays - a.oldestDays);
}
export function missingInfo(c) {
  const m = [];
  if (!(c.tax_title || c.name)) m.push("ünvan");
  if (!/^\d{10,11}$/.test(String(c.tax_no || "").replace(/\s/g, ""))) m.push("vergi / TC no");
  if (!c.tax_office && String(c.tax_no || "").replace(/\s/g, "").length !== 11) m.push("vergi dairesi");
  if (!c.address) m.push("adres");
  return m;
}

// Fatura kalemleri: iş türü + şantiye + birim + birim fiyat + KDV oranı aynı olan işler tek satır
export function invoiceDraft(d, customerId, { from = "", to = todayStr(), workIds = null } = {}) {
  const c = live(d, "customers").find((x) => x.id === customerId);
  if (!c) throw Error("Müşteri bulunamadı");
  let works = uninvoicedWorks(d, { customerId, from, to });
  if (workIds) works = works.filter((w) => workIds.includes(w.id));
  const nm = (s, id) => (id ? live(d, s).find((x) => x.id === id)?.name || "" : "");
  const lines = new Map();
  for (const w of works) {
    const { net, rate } = workNet(w);
    const q = Number(w.quantity) || 0;
    const up = q ? r2(net / q) : net;
    const desc = [w.work_type || "Hizmet", w.material && !/nakliye|hafriyat/i.test(w.work_type || "") ? w.material : "", nm("sites", w.site_id) ? "— " + nm("sites", w.site_id) : ""].filter(Boolean).join(" ");
    const k = [desc, w.unit, up, rate].join("|");
    const l = lines.get(k) || { desc, unit: w.unit || "Adet", unitPrice: up, rate, qty: 0, net: 0, from: w.date, to: w.date, works: [] };
    l.qty = r2(l.qty + q); l.net = r2(l.net + net); l.to = w.date; l.works.push(w.id);
    lines.set(k, l);
  }
  const L = [...lines.values()].map((l) => ({ ...l, desc: l.desc + (l.from !== l.to ? ` (${trDate(l.from)}–${trDate(l.to)})` : ` (${trDate(l.from)})`) }));
  const net = r2(L.reduce((n, l) => n + l.net, 0));
  const kdv = r2(L.reduce((n, l) => n + l.net * (l.rate / 100), 0));
  const withheld = r2(kdv * wh(c.kdv_withholding));
  return { customer: c, works: works.map((w) => w.id), lines: L, net, kdv, withholding: c.kdv_withholding || "Yok", withheld, total: r2(net + kdv), payable: r2(net + kdv - withheld), missing: missingInfo(c) };
}

// eLogo'ya elle girmek için kopyalanacak metin
export function draftText(F) {
  const tl = (n) => Number(n || 0).toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const c = F.customer;
  return [
    `ALICI: ${c.tax_title || c.name}`,
    `VKN/TCKN: ${c.tax_no || "—"}${c.tax_office ? " · V.D.: " + c.tax_office : ""}`,
    `ADRES: ${c.address || "—"}`,
    "",
    ...F.lines.map((l, i) => `${i + 1}) ${l.desc}\n   ${tl(l.qty)} ${l.unit} × ${tl(l.unitPrice)} ₺ = ${tl(l.net)} ₺ (KDV %${l.rate})`),
    "",
    `Mal/hizmet toplamı: ${tl(F.net)} ₺`,
    `KDV: ${tl(F.kdv)} ₺`,
    ...(F.withheld ? [`KDV tevkifatı (${F.withholding}): −${tl(F.withheld)} ₺`] : []),
    `Ödenecek: ${tl(F.payable)} ₺`,
  ].join("\n");
}
