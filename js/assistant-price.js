// Saf finans kapısı: kullanıcı fiyat bazını ve oranı açıkça doğrulamadan snapshot yok.
export function confirmedManualPrice({ price, quantity, vatRate, basis, confirmed }) {
  const parse = value => typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value.trim().replace(',', '.')) : NaN;
  const p = parse(price), q = parse(quantity), rate = parse(vatRate);
  if (!Number.isFinite(p) || p <= 0 || !Number.isFinite(q) || q <= 0)
    throw new Error('Birim fiyat ve miktar pozitif sayı olmalı');
  if (!Number.isFinite(rate) || rate < 0 || rate > 100)
    throw new Error('KDV oranını açıkça seçin (0–100)');
  if (!['included', 'excluded'].includes(basis))
    throw new Error('Fiyatın KDV dahil / hariç durumunu seçin');
  if (confirmed !== true) throw new Error('Fiyat ve KDV bilgilerini onaylayın');
  const amount = p * q;
  if (!Number.isFinite(amount) || amount > 1e12) throw new Error('İş tutarı sınırı aşıldı');
  return { unit_price: p, kdv_rate: rate, kdv_included: basis === 'included',
    amount: Math.round(amount * 100) / 100, price_source: 'Manuel — KDV onaylı', snapshot_at: new Date().toISOString() };
}
export function confirmedRulePrice(input) {
  const snapshot = confirmedManualPrice({...input,quantity:1});
  const date = String(input.validFrom || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date+'T12:00:00Z')) || new Date(date+'T12:00:00Z').toISOString().slice(0,10) !== date)
    throw Error('Fiyat kuralının gerçek geçerlilik başlangıcını seçin');
  return {price:snapshot.unit_price,kdv_rate:snapshot.kdv_rate,kdv_included:snapshot.kdv_included,valid_from:date};
}
