// eLogo'da kesilen faturayı geri okuma — SAF katman.
// UBL-TR XML (e-Fatura / e-Arşiv) telefonda okunur; PDF/fotoğraf Gemini ile okunur (aynı alanlar).
// Sonra müşteri (VKN/TCKN ya da ad) ve faturasız işlerle eşleştirilir; tutar taslakla karşılaştırılır.
import { isActive } from "./core.js";
import { uninvoicedWorks, workNet } from "./invoice-core.js";

const live = (d, s) => (d[s] || []).filter(isActive);
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const fold = (s) => String(s || "").toLocaleLowerCase("tr-TR").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/ı/g, "i").replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
const digits = (s) => String(s || "").replace(/\D/g, "");

// Basit UBL okuyucu (önek bağımsız): <cbc:ID>…</cbc:ID>
function tag(xml, name, from = 0) {
  const re = new RegExp(`<(?:[\\w-]+:)?${name}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:[\\w-]+:)?${name}>`, "g");
  re.lastIndex = from;
  const m = re.exec(xml);
  return m ? { text: m[1].trim(), index: m.index, end: re.lastIndex, raw: m[0] } : null;
}
function block(xml, name) { const t = tag(xml, name); return t ? t.raw : ""; }
const unxml = (s) => String(s || "").replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").trim();

export function parseUblInvoice(xml) {
  xml = String(xml || "");
  if (!/<(?:[\w-]+:)?Invoice[\s>]/.test(xml)) return null;
  // Belge başındaki ilk cbc:ID fatura numarasıdır (UBLVersionID / CustomizationID / ProfileID'den sonra)
  const head = xml.split(/<(?:[\w-]+:)?AccountingSupplierParty/)[0];
  const ids = [...head.matchAll(/<(?:[\w-]+:)?ID(?:\s[^>]*)?>([^<]+)<\/(?:[\w-]+:)?ID>/g)].map((m) => unxml(m[1]));
  const no = ids.find((x) => /^[A-Z0-9]{3}\d{4}\d{9}$/i.test(x)) || ids[0] || "";
  const cust = block(xml, "AccountingCustomerParty");
  const custIds = [...cust.matchAll(/<(?:[\w-]+:)?ID\s[^>]*schemeID="(VKN|TCKN)"[^>]*>([^<]+)</g)].map((m) => digits(m[2]));
  const name = unxml(tag(block(cust, "PartyName"), "Name")?.text) || [unxml(tag(cust, "FirstName")?.text), unxml(tag(cust, "FamilyName")?.text)].filter(Boolean).join(" ");
  const money = block(xml, "LegalMonetaryTotal");
  const amt = (n) => { const t = tag(money, n); return t ? r2(Number(unxml(t.text))) : null; };
  const taxTotal = tag(xml, "TaxTotal"), wht = tag(xml, "WithholdingTaxTotal");
  return {
    source: "xml", invoice_no: no, date: unxml(tag(xml, "IssueDate")?.text) || "", ettn: unxml(tag(xml, "UUID")?.text) || "",
    buyer_tax_no: custIds[0] || "", buyer_name: name,
    net: amt("TaxExclusiveAmount") ?? amt("LineExtensionAmount"), kdv: taxTotal ? r2(Number(unxml(tag(taxTotal.raw, "TaxAmount")?.text))) : null,
    withheld: wht ? r2(Number(unxml(tag(wht.raw, "TaxAmount")?.text))) : 0,
    total: amt("TaxInclusiveAmount"), payable: amt("PayableAmount"),
  };
}

// Gemini (PDF / fotoğraf) sonucunu doğrula: numara ve tutarlar faturanın yazısında geçmeli
export function checkReadInvoice(x, text = "") {
  const t = String(text || "").replace(/\s+/g, " ");
  const plain = t.replace(/[.\s]/g, "");
  const has = (n) => n != null && n > 0 && [Number(n).toFixed(2).replace(".", ","), Number(n).toLocaleString("tr-TR", { minimumFractionDigits: 2 })].some((s) => plain.includes(s.replace(/\./g, "")));
  const out = { source: "pdf", invoice_no: String(x?.invoice_no || "").trim(), date: /^\d{4}-\d{2}-\d{2}$/.test(x?.date || "") ? x.date : "", ettn: /^[0-9a-f-]{36}$/i.test(x?.ettn || "") ? x.ettn : "",
    buyer_tax_no: digits(x?.buyer_tax_no), buyer_name: String(x?.buyer_name || "").trim(), net: Number(x?.net) || null, kdv: Number(x?.kdv) || null, withheld: Number(x?.withheld) || 0,
    total: Number(x?.total) || null, payable: Number(x?.payable) || null, issues: [] };
  if (!out.invoice_no || (t && !t.replace(/\s/g, "").includes(out.invoice_no.replace(/\s/g, "")))) out.issues.push("Fatura numarası belgede görünmüyor");
  if (t && out.payable && !has(out.payable)) out.issues.push("Ödenecek tutar belgede görünmüyor");
  if (t && out.buyer_tax_no && !t.includes(out.buyer_tax_no)) { out.issues.push("Alıcı vergi no belgede görünmüyor"); out.buyer_tax_no = ""; }
  return out;
}

// Müşteri ve işlerle eşleştir: KDV hariç tutarı tutan faturasız işler (fatura tarihine kadar, eskiden yeniye)
export function matchInvoice(d, inv) {
  const custs = live(d, "customers").filter((c) => !c.internal);
  let c = inv.buyer_tax_no ? custs.find((x) => digits(x.tax_no) === inv.buyer_tax_no) : null;
  if (!c && inv.buyer_name) {
    const n = fold(inv.buyer_name);
    c = custs.find((x) => fold(x.tax_title) === n) || custs.find((x) => { const a = fold(x.name); return a.length >= 4 && n.includes(a); }) || null;
  }
  if (!c) return { customer: null, works: [], sum: 0, diff: null, exact: false, issues: ["Müşteri bulunamadı — listeden seçin"] };
  const all = uninvoicedWorks(d, { customerId: c.id, to: inv.date || undefined });
  const net = inv.net ?? (inv.total && inv.kdv != null ? inv.total - inv.kdv : null);
  let pick = all, sum = r2(all.reduce((n, w) => n + workNet(w).net, 0)), exact = net != null && Math.abs(sum - net) < 1;
  if (!exact && net != null) {
    let acc = 0;
    for (let i = 0; i < all.length; i++) { acc = r2(acc + workNet(all[i]).net); if (Math.abs(acc - net) < 1) { pick = all.slice(0, i + 1); sum = acc; exact = true; break; } }
  }
  const issues = [];
  if (!all.length) issues.push("Bu müşterinin faturasız işi yok");
  else if (net != null && !exact) issues.push(`Faturadaki tutar (${net.toLocaleString("tr-TR")} ₺) faturasız işlerin toplamıyla (${sum.toLocaleString("tr-TR")} ₺) tutmuyor — işleri kontrol edin`);
  if (c && inv.buyer_tax_no && !digits(c.tax_no)) issues.push("Müşteri kartına vergi numarası yazılacak");
  return { customer: c, works: pick.map((w) => w.id), candidates: all.map((w) => w.id), sum, net, diff: net != null ? r2(net - sum) : null, exact, issues };
}
