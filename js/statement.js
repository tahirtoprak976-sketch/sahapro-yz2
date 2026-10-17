// Müşteri cari ekstresi: saf hesaplar. Kayıt yazmaz; ekran ve paylaşım bunları kullanır.
// İşaret kuralı cari_movements ile aynı: Hakediş (+) müşteri borcu, Tahsilat (−), Düzeltme (±).
// Müşteriye giden metinde iç not / düzeltme nedeni yer almaz.
import { isActive, toKurus, fromKurus, toCSV } from "./core.js";

const LABEL = { Hakedis: "Hakediş", Tahsilat: "Tahsilat", Duzeltme: "Düzeltme", Is: "İş" };
const tl = (n) =>
  Number(n).toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const trDate = (d) => (d ? d.split("-").reverse().join(".") : "");

export function customerStatement(movements, customerId, { from = "", to = "" } = {}) {
  const mine = (movements || [])
    .filter((m) => isActive(m) && m.customer_id === customerId)
    .sort((a, b) => (a.date === b.date ? String(a.created_at || "").localeCompare(String(b.created_at || "")) : a.date.localeCompare(b.date)));
  let bal = mine
    .filter((m) => from && m.date < from)
    .reduce((s, m) => s + toKurus(m.amount), 0);
  const opening = bal;
  const rows = [];
  let debit = 0,
    credit = 0;
  for (const m of mine) {
    if ((from && m.date < from) || (to && m.date > to)) continue;
    const k = toKurus(m.amount);
    bal += k;
    if (k > 0) debit += k;
    else credit += -k;
    rows.push({
      date: m.date,
      type: LABEL[m.type] || m.type || "Hareket",
      text: m.type === "Duzeltme" ? "" : m.note || "",
      debit: k > 0 ? fromKurus(k) : 0,
      credit: k < 0 ? fromKurus(-k) : 0,
      balance: fromKurus(bal),
    });
  }
  return {
    rows,
    opening: fromKurus(opening),
    debit: fromKurus(debit),
    credit: fromKurus(credit),
    closing: fromKurus(bal),
  };
}

export function statementText(name, st, { from = "", to = "", today = "", max = 20 } = {}) {
  const per = from || to ? `${trDate(from) || "başlangıç"} – ${trDate(to) || trDate(today) || "bugün"}` : "tüm hareketler";
  const shown = st.rows.slice(-max);
  const lines = [
    `*${name}* — Cari Ekstre`,
    `Dönem: ${per}`,
    st.opening ? `Devir: ${tl(st.opening)} ₺` : "",
    "",
    ...(st.rows.length > shown.length ? [`(son ${shown.length} hareket gösteriliyor)`] : []),
    ...shown.map(
      (r) =>
        `${trDate(r.date)} ${r.type}${r.text ? " (" + r.text + ")" : ""}: ${r.debit ? "+" + tl(r.debit) : "-" + tl(r.credit)} ₺`,
    ),
    "",
    `Toplam borç: ${tl(st.debit)} ₺`,
    `Toplam tahsilat: ${tl(st.credit)} ₺`,
    st.closing > 0
      ? `*Kalan bakiye: ${tl(st.closing)} ₺*`
      : st.closing < 0
        ? `*Alacağınız (avans): ${tl(-st.closing)} ₺*`
        : "*Bakiye: 0,00 ₺ — hesap kapalı*",
  ];
  return lines.filter((l, i) => l !== "" || lines[i - 1] !== "").join("\n").trim();
}

export function statementCsv(st) {
  const rows = [["", "Devir", "", "", "", tl(st.opening)]];
  for (const r of st.rows)
    rows.push([trDate(r.date), r.type, r.text, r.debit ? tl(r.debit) : "", r.credit ? tl(r.credit) : "", tl(r.balance)]);
  rows.push(["", "TOPLAM", "", tl(st.debit), tl(st.credit), tl(st.closing)]);
  return "﻿" + toCSV(["Tarih", "İşlem", "Açıklama", "Borç", "Tahsilat", "Bakiye"], rows);
}
