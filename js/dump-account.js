// Döküm sahası ön ödemeli hesap — SAF katman.
// Döküm sahasına önce para yatırılır (barkod alınır), her dökümde hesaptan düşer.
// Yatırılan para: gider kaydı (kategori "Döküm", dump_deposit: true, dump_site_id) — kâr/zararda GİDER SAYILMAZ (ön ödeme),
// maliyet döküm yapıldıkça (fişteki ton × ücret) yazılır. Nakit tahmininde ise gerçek para çıkışıdır.
import { isActive, todayStr, addDays } from "./core.js";
import { dumpFee } from "./dump-fees.js";

const live = (d, s) => (d[s] || []).filter(isActive);
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const fold = (s) => String(s || "").toLocaleLowerCase("tr-TR").replace(/\s+/g, " ").trim();
export const isDumpDeposit = (e) => !!e?.dump_deposit;

// Gider kaydı döküm hesabına yükleme mi? (kategori Döküm + firma/açıklamada döküm sahası adı)
export function depositSiteOf(d, e) {
  if (e.dump_site_id) return live(d, "dump_sites").find((s) => s.id === e.dump_site_id) || null;
  if (!/döküm|dokum/i.test(e.category || "")) return null;
  const t = fold([e.company, e.description, e.note].join(" "));
  return live(d, "dump_sites").filter((s) => !s.own_yard && fold(s.name).length >= 3).find((s) => t.includes(fold(s.name).split(" ")[0])) || null;
}

// ---- Döküm faturası (İSTAÇ vb.) ----
// Fatura gider DEĞİLDİR: para hesaba yatırılırken ödendi, maliyet dökümde yazılıyor. Fatura, sahanın gerçek düştüğü tutarı/tonu gösterir → mutabakat.
// Aynı firma (İSTAÇ) birden çok sahayı faturalar; saha, faturadaki yer adından (ör. ARNAVUTKÖY/BOĞAZKÖY → Bolluca) ayrılır.
const PLACE_HINTS = { bolluca: ["bolluca", "boğazköy", "arnavutköy"], cebeci: ["cebeci", "sultangazi"] };
const DUMP_WORDS = /döküm|dokum|hafriyat|toprak|kazı|pasa|istaç|istac|moloz/;
export const DUMP_INVOICE = "Döküm Faturası";
export function tonOfItems(items) {
  let t = 0;
  for (const i of items || []) {
    const q = Number(i.qty) || 0, u = fold(i.unit);
    if (/^(kg|kgm|kilo)/.test(u)) t += q / 1000; else if (/^(ton|tn|t$)/.test(u)) t += q;
  }
  return Math.round(t * 1000) / 1000;
}
export function siteHints(s) {
  const n = fold(s.name);
  const own = [n.split(" ")[0], ...String(s.invoice_place || "").split(/[\/,;]+/).map(fold)];
  const extra = Object.entries(PLACE_HINTS).filter(([k]) => n.includes(k)).flatMap(([, v]) => v);
  return [...new Set([...own, ...extra].filter((h) => h.length >= 4))];
}
export function dumpInvoiceMatch(d, { company = "", seller_tax_no = "", text = "", items = [] }) {
  const sites = live(d, "dump_sites").filter((s) => !s.own_yard);
  const t = fold(company + " " + text);
  const vkn = String(seller_tax_no || "").replace(/\D/g, "");
  const byVkn = vkn ? sites.filter((s) => String(s.invoice_tax_no || "").replace(/\D/g, "") === vkn) : [];
  // Satıcı ünvanında geçen ad (ör. "İSTAÇ") yer sayılmaz; yer adı (Boğazköy, Cebeci…) aranır
  const co = fold(company), body = fold(text);
  const byPlace = sites.filter((s) => siteHints(s).some((h) => !co.includes(h) && (body.includes(h) || co.includes(h))));
  const specific = byPlace.filter((s) => siteHints(s).slice(1).some((h) => !co.includes(h) && body.includes(h)));
  if (byPlace.length > 1 && specific.length === 1) byPlace.splice(0, byPlace.length, specific[0]);
  const ton = tonOfItems(items);
  if (!byVkn.length && !(DUMP_WORDS.test(t) && (ton > 0 || byPlace.length))) return null;
  let site = null;
  const both = byVkn.filter((s) => byPlace.includes(s));
  if (both.length === 1) site = both[0];
  else if (byVkn.length === 1 && !byPlace.length) site = byVkn[0];
  else if (byPlace.length === 1) site = byPlace[0];
  return { site_id: site?.id || null, ton };
}
export function dumpInvoices(d, siteId) {
  return live(d, "documents").filter((x) => x.category === DUMP_INVOICE && x.owner_id === siteId).sort((a, b) => String(a.date).localeCompare(String(b.date)));
}

export function dumpAccounts(d, { today = todayStr(), siteId = null } = {}) {
  const sites = live(d, "dump_sites").filter((s) => !s.own_yard && (!siteId || s.id === siteId));
  const deps = live(d, "expense_records").filter(isDumpDeposit);
  const works = live(d, "work_records");
  const out = [];
  for (const s of sites) {
    const deposits = deps.filter((e) => e.dump_site_id === s.id).sort((a, b) => String(a.date).localeCompare(String(b.date)));
    if (!deposits.length && !dumpInvoices(d, s.id).length && siteId == null) continue;
    const first = deposits[0]?.date || "";
    // Hesaptan düşen: ilk yüklemeden sonraki bu sahaya yapılan dökümler (elle yazılan döküm maliyeti dahil)
    const allUses = works.filter((w) => w.dump_site_id === s.id || (!w.dump_site_id && w.dump_area && fold(w.dump_area) === fold(s.name)))
      .map((w) => ({ w, f: dumpFee(d, w) })).filter((x) => x.f && x.f.amount > 0)
      .sort((a, b) => String(a.w.date).localeCompare(String(b.w.date)));
    const invDocs = dumpInvoices(d, s.id);
    // Fatura varsa hesap ilk faturanın döneminden başlar (geçmiş dönem faturası "ödenmiş" sayılabilir)
    const start = invDocs.length ? [first, addDays(invDocs[0].date, -31)].filter(Boolean).sort()[0] : first;
    const uses = allUses.filter((x) => x.w.date >= start);
    const dep = r2(deposits.reduce((n, e) => n + (Number(e.amount) || 0), 0));
    const used = r2(uses.reduce((n, x) => n + x.f.amount, 0));
    const usedEst = r2(uses.filter((x) => x.f.estimated).reduce((n, x) => n + x.f.amount, 0));
    const recent = uses.filter((x) => x.w.date > addDays(today, -14));
    const perDay = r2(recent.reduce((n, x) => n + x.f.amount, 0) / 14);
    const balanceCalc = r2(dep - used);
    // Faturaya göre: faturalanan tutar sahanın gerçekten düştüğüdür; son faturadan sonraki dökümler tahminle eklenir
    const invoices = invDocs.map((x, i, arr) => {
      const prev = arr[i - 1]?.date || addDays(x.date, -31);
      const ours = allUses.filter((u) => u.w.date > prev && u.w.date <= x.date);
      return { doc: x, from: prev, ton: Number(x.ton) || 0, amount: Number(x.amount) || 0, ourTon: r2(ours.reduce((n, u) => n + (Number(u.f.ton) || 0), 0)), ourAmount: r2(ours.reduce((n, u) => n + u.f.amount, 0)), ourTrips: ours.length, ourEst: ours.filter((u) => u.f.estimated).length,
        perTon: Number(x.ton) > 0 ? r2(Number(x.amount) / Number(x.ton)) : null };
    });
    const lastInv = invoices.at(-1)?.doc.date || null;
    const invTotal = r2(invoices.reduce((n, x) => n + x.amount, 0));
    const after = r2(allUses.filter((u) => lastInv && u.w.date > lastInv).reduce((n, u) => n + u.f.amount, 0));
    const balanceInv = invoices.length ? r2(dep - invTotal - after) : null;
    const balance = balanceInv ?? balanceCalc; // fatura varsa saha faturası esas alınır
    out.push({ site: s, deposits, uses, dep, used, usedEst, balance, perDay, daysLeft: perDay > 0 ? Math.floor(Math.max(0, balance) / perDay) : null,
      invoices, invTotal, lastInv, balanceInv, balanceCalc, afterInv: after, trips: uses.length, missingTon: uses.filter((x) => x.f.estimated).length, reported: s.account_reported || null });
  }
  return out.sort((a, b) => a.balance - b.balance);
}

// Ana sayfa / brifing uyarıları
export function dumpAccountAlerts(d, { today = todayStr() } = {}) {
  const items = [];
  for (const a of dumpAccounts(d, { today })) {
    if (a.balance < 0) items.push({ kind: "alert", text: `${a.site.name} döküm hesabı eksiye düştü`, sub: `Hesaplanan bakiye ${a.balance.toLocaleString("tr-TR")} ₺ — para yatırın ya da fişleri kontrol edin`, href: "#/dokum-hesap/" + a.site.id });
    else if (a.daysLeft != null && a.daysLeft <= 3) items.push({ kind: "warn", text: `${a.site.name} döküm hesabında ~${Math.round(a.balance).toLocaleString("tr-TR")} ₺ kaldı`, sub: `Günde ~${Math.round(a.perDay).toLocaleString("tr-TR")} ₺ harcanıyor → ~${a.daysLeft} gün yeter`, href: "#/dokum-hesap/" + a.site.id });
  }
  return items;
}
