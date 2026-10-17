import assert from "node:assert/strict";
import { validateInvoiceDetail, maintenanceHint } from "../js/receipt-detail.js";
const T = `TEKMAC İŞ MAKİNALARI VE TRAKTÖR YED.PRÇ.SAN.TİC.LT.ŞTİ VKN: 8360886883 e-FATURA Fatura No: TMC2026000003204 Fatura Tarihi: 15-10-2026 ETTN: 99de29b7-f76e-4bce-b013-48bfb6150afd
1 TMC 012 HMK HAVA İÇ DIŞ TK 1,0 2.000 TL %20,00 400,00 TL 2.000,00 TL
2 TMC 037 YAĞ FİLTRE YM. PJ K4 HMK 5053867-5698036-5053864 1,0 3.000 TL %20,00 600,00 TL 3.000,00 TL
3 TMC 344 MAZOT FİLİTRE YM K4 HMK 540-5119 CAT 1,0 3.000 TL %20,00 600,00 TL 3.000,00 TL
4 TMC 001 HMK HİD GERİ DÖNÜŞ FİLİTRE 1,0 2.500 TL %20,00 500,00 TL 2.500,00 TL
5 TMC 660 FX DEF POMPA FİLİTRE ADBLUE 3783187 T400377 1,0 1.750 TL %20,00 350,00 TL 1.750,00 TL
6 TMC 002 SIVI CONTA 1,0 350 TL %20,00 70,00 TL 350,00 TL
Mal Hizmet Toplam Tutarı 12.600,00 TL Hesaplanan KDV(%20) 2.520,00 TL Vergiler Dahil Toplam Tutar 15.120,00 TL Ödenecek Tutar 15.120,00 TL`;
const items = [
  ["TMC 012", "HMK HAVA İÇ DIŞ TK", 2000], ["TMC 037", "YAĞ FİLTRE YM. PJ K4 HMK 5053867-5698036-5053864", 3000], ["TMC 344", "MAZOT FİLİTRE YM K4 HMK 540-5119 CAT", 3000],
  ["TMC 001", "HMK HİD GERİ DÖNÜŞ FİLİTRE", 2500], ["TMC 660", "FX DEF POMPA FİLİTRE ADBLUE 3783187 T400377", 1750], ["TMC 002", "SIVI CONTA", 350],
].map(([code, desc, a]) => ({ code, desc, qty: 1, unit: "Adet", unit_price: a, kdv_rate: 20, amount: a }));
const r = validateInvoiceDetail({ no: "TMC2026000003204", ettn: "99de29b7-f76e-4bce-b013-48bfb6150afd", seller_tax_no: "8360886883", net: 12600, kdv: 2520, kdv_rate: 20, items: [...items, { desc: "UYDURMA PARÇA", amount: 9999 }] }, T);
assert.equal(r.no, "TMC2026000003204"); assert.equal(r.seller_tax_no, "8360886883"); assert.equal(r.ettn, "99de29b7-f76e-4bce-b013-48bfb6150afd");
assert.equal(r.net, 12600); assert.equal(r.kdv, 2520); assert.equal(r.items.length, 6); assert.equal(r.itemsSum, 12600); assert.equal(r.dropped, 1);
assert.deepEqual(r.issues, ["1 kalem fişte doğrulanamadığı için alınmadı"]);
assert.equal(maintenanceHint(r.items).title, "Periyodik bakım (yağ / filtre)");
assert.equal(maintenanceHint([{ desc: "Yemek" }]), null);
assert.equal(validateInvoiceDetail({ no: "X" }, ""), null);
console.log("receipt-detail ok");
