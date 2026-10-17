// Tahsilat takibi: müşteriden alacakların yaşlandırması, ödeme sözleri, çek/senet vadeleri ve hatırlatma metni.
// SAF katman — kayıt yazmaz. Borç = kesinleşen hakediş (+ düzeltme) + hakedişe girmemiş fiyatlı işler;
// tahsilat ve eksi düzeltmeler en eski borçtan başlayarak düşülür (FIFO). Kalan her kalemin yaşı tarihinden hesaplanır.
import { isActive, toKurus, fromKurus, todayStr, COMPANY_NAME } from "./core.js";

const live = (d, s) => (d[s] || []).filter(isActive);
const DAY = 86400000;
export const daysBetween = (a, b) =>
  Math.round((new Date(b + "T12:00:00").getTime() - new Date(a + "T12:00:00").getTime()) / DAY);
const trDate = (s) => (s ? String(s).slice(0, 10).split("-").reverse().join(".") : "");
const tl = (n) => Number(n).toLocaleString("tr-TR", { minimumFractionDigits: 0, maximumFractionDigits: 2 });

export const BUCKETS = [
  { key: "b0", label: "0–30 gün", max: 30 },
  { key: "b30", label: "31–60 gün", max: 60 },
  { key: "b60", label: "61–90 gün", max: 90 },
  { key: "b90", label: "90+ gün", max: Infinity },
];
export const bucketOf = (days) => BUCKETS.find((b) => days <= b.max).key;

export function workAmount(w) {
  const p = w.price_snapshot;
  if (!p) return 0;
  const a = Number(p.amount ?? Number(p.unit_price) * Number(w.quantity));
  return Number.isFinite(a) && a > 0 ? a : 0;
}

function workLabel(d, w) {
  const site = live(d, "sites").find((s) => s.id === w.site_id)?.name;
  const q = Number(w.quantity) ? `${Number(w.quantity).toLocaleString("tr-TR")} ${String(w.unit || "").toLocaleLowerCase("tr-TR")} ` : "";
  return `${q}${w.work_type || "iş"}${site ? " · " + site : ""}`.trim();
}

// Tek müşterinin açık kalemleri
export function customerOpenItems(d, customerId, today = todayStr()) {
  const billed = new Set(
    live(d, "hakedis").filter((h) => h.status === "Kesinleşti").flatMap((h) => (h.items || []).map((i) => i.work_record_id)),
  );
  const debits = [];
  let credit = 0;
  for (const m of live(d, "cari_movements").filter((m) => m.customer_id === customerId)) {
    const k = toKurus(m.amount);
    if (k > 0) debits.push({ date: m.date, k, kind: m.type === "Hakedis" ? "hakedis" : "duzeltme", label: m.note || (m.type === "Hakedis" ? "Hakediş" : "Düzeltme"), ref: m.ref_id || m.id });
    else credit += -k;
  }
  for (const w of live(d, "work_records").filter((w) => w.customer_id === customerId && !billed.has(w.id))) {
    const a = workAmount(w);
    if (a > 0 && w.date) debits.push({ date: w.date, k: toKurus(a), kind: "is", label: workLabel(d, w), ref: w.id });
  }
  debits.sort((a, b) => a.date.localeCompare(b.date) || a.k - b.k);
  const paid = credit;
  const open = [];
  for (const x of debits) {
    const use = Math.min(credit, x.k);
    credit -= use;
    const left = x.k - use;
    if (left > 0) open.push({ date: x.date, kind: x.kind, label: x.label, ref: x.ref, amount: fromKurus(x.k), left: fromKurus(left), days: Math.max(0, daysBetween(x.date, today)) });
  }
  return { open, advance: fromKurus(credit), paid: fromKurus(paid), debit: fromKurus(debits.reduce((n, x) => n + x.k, 0)) };
}

// Çek/senet: müşteriden alınan (portföyde / bankada) ve bizim verdiğimiz
export function chequeRows(d, today = todayStr()) {
  return live(d, "instruments")
    .filter((r) => ["Portföyde", "Bankaya Verildi", "Karşılıksız"].includes(r.status))
    .map((r) => ({ ...r, days_left: daysBetween(today, r.due_date) }))
    .sort((a, b) => String(a.due_date).localeCompare(String(b.due_date)));
}

// Tüm müşteriler — notes: { [customerId]: { promise_date, promise_amount, note, reminded_at } }
export function receivables(d, { today = todayStr(), notes = {} } = {}) {
  const cheques = chequeRows(d, today);
  const rows = [];
  for (const c of live(d, "customers")) {
    if (c.internal) continue;
    const r = customerOpenItems(d, c.id, today);
    const total = fromKurus(r.open.reduce((n, x) => n + toKurus(x.left), 0));
    if (!(total > 0)) continue;
    const buckets = { b0: 0, b30: 0, b60: 0, b90: 0 };
    for (const x of r.open) buckets[bucketOf(x.days)] = fromKurus(toKurus(buckets[bucketOf(x.days)]) + toKurus(x.left));
    const pays = live(d, "cash_records").filter((x) => x.customer_id === c.id && x.cash_type === "Müşteriden Para Alındı").sort((a, b) => String(b.date).localeCompare(String(a.date)));
    const myCheques = cheques.filter((q) => q.party_type === "customer" && q.party_id === c.id && q.direction === "Alınan" && q.status !== "Karşılıksız");
    const n = notes[c.id] || {};
    const parent = c.parent_customer_id ? live(d, "customers").find((x) => x.id === c.parent_customer_id) : null;
    rows.push({
      id: c.id,
      name: c.name,
      phone: c.phone || "",
      parent: parent ? parent.name : "",
      total,
      unbilled: fromKurus(r.open.filter((x) => x.kind === "is").reduce((n, x) => n + toKurus(x.left), 0)),
      buckets,
      oldest_date: r.open[0].date,
      oldest_days: r.open[0].days,
      open: r.open,
      last_payment: pays[0] ? { date: pays[0].date, amount: Number(pays[0].amount) || 0, days: daysBetween(pays[0].date, today) } : null,
      cheque_total: fromKurus(myCheques.reduce((n, q) => n + toKurus(q.amount), 0)),
      cheque_count: myCheques.length,
      promise: n.promise_date ? { date: n.promise_date, amount: Number(n.promise_amount) || 0, note: n.note || "", late: n.promise_date < today } : null,
      reminded_at: n.reminded_at || "",
      reminded_days: n.reminded_at ? daysBetween(String(n.reminded_at).slice(0, 10), today) : null,
      risk: riskOf(r.open[0].days, total, pays[0] ? daysBetween(pays[0].date, today) : null),
    });
  }
  rows.sort((a, b) => b.risk - a.risk || b.total - a.total);
  const sum = (k) => fromKurus(rows.reduce((n, r) => n + toKurus(k(r)), 0));
  return {
    rows,
    total: sum((r) => r.total),
    buckets: Object.fromEntries(BUCKETS.map((b) => [b.key, sum((r) => r.buckets[b.key])])),
    unbilled: sum((r) => r.unbilled),
    cheques,
    cheques_in: fromKurus(cheques.filter((q) => q.direction === "Alınan" && q.status !== "Karşılıksız").reduce((n, q) => n + toKurus(q.amount), 0)),
    cheques_out: fromKurus(cheques.filter((q) => q.direction === "Verilen" && q.status !== "Karşılıksız").reduce((n, q) => n + toKurus(q.amount), 0)),
  };
}

// Sıralama puanı: en eski açık kalemin yaşı + tutar + uzun süredir ödeme gelmemesi
export function riskOf(oldestDays, total, lastPayDays) {
  let s = Math.min(oldestDays, 180);
  if (total >= 100000) s += 40;
  else if (total >= 25000) s += 20;
  if (lastPayDays == null) s += 15;
  else if (lastPayDays > 60) s += 25;
  return s;
}

// Telefonu wa.me biçimine çevir: 0532… / 532… / +90 532… → 90532…
export function waPhone(phone) {
  let p = String(phone || "").replace(/\D/g, "");
  if (p.startsWith("00")) p = p.slice(2);
  if (p.length === 11 && p.startsWith("0")) p = "90" + p.slice(1);
  if (p.length === 10 && p.startsWith("5")) p = "90" + p;
  return /^90\d{10}$/.test(p) ? p : "";
}
export function waLink(phone, text) {
  const p = waPhone(phone);
  return p ? `https://wa.me/${p}?text=${encodeURIComponent(text)}` : "";
}

export const TONES = { nazik: "Nazik", net: "Net (gecikmiş)", son: "Son hatırlatma" };

export function reminderText(row, { tone = "nazik", company = COMPANY_NAME, max = 8, iban = "" } = {}) {
  const items = row.open.slice(0, max);
  const more = row.open.length - items.length;
  const from = trDate(row.open[0]?.date), to = trDate(row.open.at(-1)?.date);
  const per = from === to ? from : `${from} – ${to}`;
  const lines = [`Merhaba, iyi günler.`, ""];
  if (tone === "son")
    lines.push(`${company} olarak ${per} tarihli işlerden *${tl(row.total)} ₺* ödemeniz ${row.oldest_days} gündür bekliyor. Birkaç kez hatırlattık; en geç bu hafta ödeme yapılmasını ya da bir ödeme tarihi verilmesini rica ediyoruz.`);
  else if (tone === "net")
    lines.push(`${company} olarak ${per} tarihli işlerden *${tl(row.total)} ₺* ödemeniz ${row.oldest_days} gündür bekliyor. Ödemenin önümüzdeki günlerde yapılmasını rica ederiz.`);
  else lines.push(`${company} olarak ${per} tarihli işlerden *${tl(row.total)} ₺* bakiyeniz görünüyor. Müsait olduğunuzda ödemeyi planlayabilirseniz seviniriz.`);
  lines.push("", "Açık kalemler:");
  for (const x of items) lines.push(`• ${trDate(x.date)} — ${x.label}: ${tl(x.left)} ₺${x.left < x.amount ? " (kalan)" : ""}`);
  if (more > 0) lines.push(`• … ve ${more} kalem daha`);
  if (iban) lines.push("", `IBAN: ${iban}`);
  lines.push("", "Bir yanlışlık görürseniz haber verin, birlikte kontrol edelim.", `Teşekkürler — ${company}`);
  return lines.join("\n");
}

// Ana sayfa "Bugün Dikkat" maddeleri
export function collectBoardItems(d, { today = todayStr(), notes = {} } = {}) {
  const res = receivables(d, { today, notes });
  const items = [];
  for (const r of res.rows) {
    if (r.promise?.late)
      items.push({ kind: "alert", group: "Tahsilat", ic: "🤝", text: `${r.name} ödeme sözü geçti`, sub: `${trDate(r.promise.date)} demişti${r.promise.amount ? " · " + tl(r.promise.amount) + " ₺" : ""} — arayın / hatırlatın`, href: "#/tahsilat/" + r.id, amount: r.total, sort: 5 });
    else if (r.promise && r.promise.date === today)
      items.push({ kind: "warn", group: "Tahsilat", ic: "🤝", text: `${r.name} bugün ödeyecek`, sub: r.promise.amount ? tl(r.promise.amount) + " ₺ söz" : "ödeme sözü bugün", href: "#/tahsilat/" + r.id, amount: r.total, sort: 6 });
  }
  const old = res.rows.filter((r) => !r.promise && r.oldest_days > 60 && (r.reminded_days == null || r.reminded_days >= 7)).slice(0, 3);
  for (const r of old)
    items.push({ kind: r.oldest_days > 90 ? "alert" : "warn", group: "Tahsilat", ic: "💰", text: `${r.name}: ${tl(r.total)} ₺ alacak`, sub: `en eskisi ${r.oldest_days} gün${r.reminded_days != null ? " · son hatırlatma " + r.reminded_days + " gün önce" : " · hiç hatırlatılmadı"}`, href: "#/tahsilat/" + r.id, amount: r.total, sort: 20 });
  for (const q of res.cheques) {
    if (q.status === "Karşılıksız")
      items.push({ kind: "alert", group: "Çek/Senet", ic: "🧾", text: `Karşılıksız ${q.kind.toLocaleLowerCase("tr-TR")} #${q.document_no}`, sub: `${tl(q.amount)} ₺ — takibe alın`, href: "#/ceksenet/" + q.id, sort: 4 });
    else if (q.days_left <= 3)
      items.push({ kind: q.days_left < 0 ? "alert" : "warn", group: "Çek/Senet", ic: "🧾", text: `${q.direction === "Alınan" ? "Tahsil edilecek" : "Ödenecek"} ${q.kind.toLocaleLowerCase("tr-TR")} #${q.document_no}`, sub: `${tl(q.amount)} ₺ · ${q.days_left < 0 ? -q.days_left + " gün geçti" : q.days_left === 0 ? "vadesi bugün" : q.days_left + " gün kaldı"}${q.direction === "Verilen" ? " — hesapta para olsun" : ""}`, href: "#/ceksenet/" + q.id, sort: 8 + q.days_left });
  }
  return items;
}

// Müşterinin tüm cari hareketleri: kayıtlı cari hareketler + hakedişe girmemiş fiyatlı işler ("İş" satırı).
// Cari ekranı, müşteri kartı, ekstre ve asistan aynı bakiyeyi gösterir.
export function customerLedgerMovements(d, customerId) {
  const billed = new Set(
    live(d, "hakedis").filter((h) => h.status === "Kesinleşti").flatMap((h) => (h.items || []).map((i) => i.work_record_id)),
  );
  const out = live(d, "cari_movements").filter((m) => m.customer_id === customerId);
  for (const w of live(d, "work_records").filter((w) => w.customer_id === customerId && !billed.has(w.id))) {
    const a = workAmount(w);
    if (a > 0 && w.date) out.push({ id: "is:" + w.id, ref_id: w.id, date: w.date, customer_id: customerId, type: "Is", amount: a, note: workLabel(d, w), created_at: w.created_at });
  }
  return out;
}
export function customerBalances(d) {
  const bal = {}, unbilled = {};
  for (const c of live(d, "customers")) {
    const mv = customerLedgerMovements(d, c.id);
    bal[c.id] = fromKurus(mv.reduce((n, m) => n + toKurus(m.amount), 0));
    unbilled[c.id] = fromKurus(mv.filter((m) => m.type === "Is").reduce((n, m) => n + toKurus(m.amount), 0));
  }
  return { bal, unbilled };
}

// Cari'de 0 görünmesinin nedenleri: fiyatı girilmemiş işler (alacağa sayılamaz) — iş türü + birime göre gruplu
export function unpricedGroups(d, customerId) {
  const billed = new Set(live(d, "hakedis").filter((h) => h.status === "Kesinleşti").flatMap((h) => (h.items || []).map((i) => i.work_record_id)));
  const groups = new Map();
  for (const w of live(d, "work_records")) {
    if (w.customer_id !== customerId || billed.has(w.id) || w.price_snapshot?.locked) continue;
    if (workAmount(w) > 0 || Number(w.customer_fuel_allowance_l) > 0 || w.price_snapshot?.price_source === "Mazot karşılığı" || w.price_snapshot?.price_source === "İç iş (kendi depo)") continue;
    const key = (w.work_type || "Diğer") + "|" + (w.unit || "");
    const g = groups.get(key) || { key, work_type: w.work_type || "Diğer", unit: w.unit || "", works: [], qty: 0, vehicles: new Set() };
    g.works.push(w);
    g.qty = Math.round((g.qty + (Number(w.quantity) || 0)) * 100) / 100;
    if (w.vehicle_id) g.vehicles.add(w.vehicle_id);
    groups.set(key, g);
  }
  return [...groups.values()].map((g) => ({ ...g, vehicles: [...g.vehicles] })).sort((a, b) => b.works.length - a.works.length);
}
