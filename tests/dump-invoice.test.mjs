import assert from "node:assert/strict";
import { dumpInvoiceMatch, tonOfItems, dumpAccounts } from "../js/dump-account.js";
const T = "İSTAÇ İSTANBUL ÇEVRE YÖNETİMİ SANAYİ VE TİCARET A.Ş. VKN: 4810029159 Fatura No: ISC2026000018988 170504-170503DIŞTOPRAKVEKAYALAR 680.029 KG 0,1380 TRY Fatura Notları: ARNAVUTKÖY/BOĞAZKÖY 8,9,18,19,20 ve 33";
const items = [{ desc: "170504-170503DIŞTOPRAKVEKAYALAR", qty: 680029, unit: "KG", unit_price: 0.138, amount: 93844 }];
assert.equal(tonOfItems(items), 680.029);
assert.equal(tonOfItems([{ qty: 12.5, unit: "Ton" }]), 12.5);
const d = { dump_sites: [{ id: "b", name: "Bolluca", fee: 160, fee_unit: "Ton" }, { id: "c", name: "Cebeci", fee: 210, fee_unit: "Ton" }, { id: "i", name: "İSTAÇ Döküm", fee: 235, fee_unit: "Ton" }] };
// İlk fatura: VKN öğrenilmemiş, yer adından Bolluca bulunur
assert.equal(dumpInvoiceMatch(d, { company: "İSTAÇ", seller_tax_no: "4810029159", text: T, items }).site_id, "b");
// VKN üç sahada da aynı: yer adı ayırır
for (const s of d.dump_sites) s.invoice_tax_no = "4810029159";
assert.equal(dumpInvoiceMatch(d, { seller_tax_no: "4810029159", text: T.replace("İSTAÇ", "X"), items }).site_id, "b");
assert.equal(dumpInvoiceMatch(d, { seller_tax_no: "4810029159", text: "Fatura SULTANGAZİ CEBECİ 100.000 KG", items: [{ qty: 100000, unit: "KG" }] }).site_id, "c");
// Belirsiz: saha seçilmez ama döküm faturası olarak tanınır
const amb = dumpInvoiceMatch(d, { seller_tax_no: "4810029159", text: "Fatura 5.000 KG", items: [{ qty: 5000, unit: "KG" }] });
assert.ok(amb); assert.equal(amb.site_id, null);
// Döküm olmayan fatura
assert.equal(dumpInvoiceMatch(d, { company: "TEKMAC", seller_tax_no: "8360886883", text: "YAĞ FİLTRE", items: [{ qty: 1, unit: "Adet" }] }), null);
// Hesap: faturaya göre kalan
const D = { ...d, expense_records: [{ id: "e", date: "2026-09-01", amount: 200000, dump_deposit: true, dump_site_id: "b" }],
  work_records: [{ id: "w1", date: "2026-10-05", dump_site_id: "b", unit: "Sefer", quantity: 1, tonnage: 30 }, { id: "w2", date: "2026-10-10", dump_site_id: "b", unit: "Sefer", quantity: 1, tonnage: 25 }],
  documents: [{ id: "f", category: "Döküm Faturası", owner_type: "dump_site", owner_id: "b", date: "2026-10-07", amount: 112612.8, ton: 680.029 }] };
const [a] = dumpAccounts(D, { today: "2026-10-16", siteId: "b" });
assert.equal(a.invoices.length, 1);
assert.equal(a.invoices[0].ourTon, 30);
assert.equal(a.invoices[0].perTon, 165.6);
assert.equal(a.balanceInv, Math.round((200000 - 112612.8 - 25 * 160) * 100) / 100);
console.log("dump-invoice ok");
