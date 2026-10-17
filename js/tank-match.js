// Depo girişi ↔ fatura eşleştirme — SAF katman.
// Elle girilmiş (faturasız) bir depo girişi ile sonradan gelen yakıt faturası aynı teslimatsa birleştirilir; iki kez stok/borç yazılmaz.
const live = (m) => m && !m.deleted_at && m.move_type === "GİRİŞ" && !m.count_id;
const days = (a, b) => Math.abs((new Date(a + "T12:00:00Z") - new Date(b + "T12:00:00Z")) / 864e5);
export const MAX_DAYS = 20;
export const sameLiters = (a, b) => Math.abs(Number(a) - Number(b)) <= Math.max(Number(b) * 0.01, 5);

// Faturaya uyan, faturası olmayan depo girişi (en yakın tarihli). Müşteriden gelen mazot girişleri hariç.
export function tankInMatch(moves, { date, liters }) {
  if (!(Number(liters) > 0) || !date) return null;
  return (moves || [])
    .filter((m) => live(m) && !m.invoice_no && !m.customer_id && sameLiters(m.liters, liters) && m.date && days(m.date, date) <= MAX_DAYS)
    .sort((a, b) => days(a.date, date) - days(b.date, date) || String(a.created_at || "").localeCompare(String(b.created_at || "")))[0] || null;
}

// Aynı teslimat iki kez girilmiş olabilir: biri faturalı (asistandan), biri elle (faturasız).
export function tankDupPairs(moves) {
  const out = [], used = new Set();
  for (const inv of (moves || []).filter((m) => live(m) && m.invoice_no)) {
    const man = tankInMatch((moves || []).filter((m) => !used.has(m.id) && m.id !== inv.id), { date: inv.date, liters: inv.liters });
    if (man) { used.add(man.id); out.push({ keep: man, drop: inv }); }
  }
  return out;
}

// Faturadan gelen alanlar (elle girilen kayda aktarılır)
export const INVOICE_FIELDS = ["invoice_no", "ettn", "seller_tax_no", "net_amount", "kdv_amount", "items", "irsaliye_no", "company"];
export function invoiceFieldsOf(m) {
  const f = {};
  for (const k of INVOICE_FIELDS) if (m[k] != null && m[k] !== "") f[k] = m[k];
  if (Number(m.total) > 0) { f.total = Number(m.total); f.unit_price = Number(m.unit_price) || Math.round((m.total / m.liters) * 100) / 100; }
  if (m.supplier_id) f.supplier_id = m.supplier_id;
  return f;
}
