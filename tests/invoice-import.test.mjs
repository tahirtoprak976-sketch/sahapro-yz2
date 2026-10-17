import assert from "node:assert/strict";
import { parseUblInvoice, matchInvoice, checkReadInvoice } from "../js/invoice-import.js";
const XML = `<?xml version="1.0" encoding="UTF-8"?><Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2" xmlns:cac="x" xmlns:cbc="y">
<cbc:UBLVersionID>2.1</cbc:UBLVersionID><cbc:CustomizationID>TR1.2</cbc:CustomizationID><cbc:ProfileID>EARSIVFATURA</cbc:ProfileID>
<cbc:ID>GIB2026000000123</cbc:ID><cbc:UUID>6f1c2a3b-1111-2222-3333-444455556666</cbc:UUID><cbc:IssueDate>2026-10-16</cbc:IssueDate>
<cac:AccountingSupplierParty><cac:Party><cac:PartyIdentification><cbc:ID schemeID="VKN">9990001112</cbc:ID></cac:PartyIdentification></cac:Party></cac:AccountingSupplierParty>
<cac:AccountingCustomerParty><cac:Party><cac:PartyIdentification><cbc:ID schemeID="VKN">1234567890</cbc:ID></cac:PartyIdentification><cac:PartyName><cbc:Name>KAYA İNŞAAT LTD. ŞTİ.</cbc:Name></cac:PartyName></cac:Party></cac:AccountingCustomerParty>
<cac:WithholdingTaxTotal><cbc:TaxAmount currencyID="TRY">960.00</cbc:TaxAmount></cac:WithholdingTaxTotal>
<cac:TaxTotal><cbc:TaxAmount currencyID="TRY">4800.00</cbc:TaxAmount></cac:TaxTotal>
<cac:LegalMonetaryTotal><cbc:LineExtensionAmount currencyID="TRY">24000.00</cbc:LineExtensionAmount><cbc:TaxExclusiveAmount currencyID="TRY">24000.00</cbc:TaxExclusiveAmount><cbc:TaxInclusiveAmount currencyID="TRY">28800.00</cbc:TaxInclusiveAmount><cbc:PayableAmount currencyID="TRY">27840.00</cbc:PayableAmount></cac:LegalMonetaryTotal></Invoice>`;
const inv = parseUblInvoice(XML);
assert.deepEqual([inv.invoice_no, inv.date, inv.ettn, inv.buyer_tax_no, inv.buyer_name, inv.net, inv.kdv, inv.withheld, inv.payable],
  ["GIB2026000000123", "2026-10-16", "6f1c2a3b-1111-2222-3333-444455556666", "1234567890", "KAYA İNŞAAT LTD. ŞTİ.", 24000, 4800, 960, 27840]);
assert.equal(parseUblInvoice("<html></html>"), null);
const n = "x", P = (a) => ({ unit_price: a, amount: a, kdv_rate: 20, kdv_included: false });
const d = { customers: [{ id: "C", name: "Kaya İnşaat", tax_no: "1234567890", created_at: n }, { id: "E", name: "Eksi", created_at: n }],
  work_records: [
    { id: "1", date: "2026-10-01", customer_id: "C", quantity: 2, unit: "Sefer", price_snapshot: P(8000), created_at: n },
    { id: "2", date: "2026-10-02", customer_id: "C", quantity: 2, unit: "Sefer", price_snapshot: P(8000), created_at: n },
    { id: "3", date: "2026-10-03", customer_id: "C", quantity: 2, unit: "Sefer", price_snapshot: P(8000), created_at: n },
    { id: "4", date: "2026-10-04", customer_id: "C", quantity: 2, unit: "Sefer", price_snapshot: P(8000), created_at: n },
    { id: "5", date: "2026-10-20", customer_id: "C", quantity: 1, unit: "Sefer", price_snapshot: P(1000), created_at: n },
  ] };
const m = matchInvoice(d, inv);
assert.equal(m.customer.id, "C"); assert.deepEqual(m.works, ["1", "2", "3"], "24.000 = ilk 3 iş; 4. iş sonraki faturaya"); assert.ok(m.exact);
const m2 = matchInvoice(d, { ...inv, net: 25000 });
assert.ok(!m2.exact && m2.issues.some((x) => /tutmuyor/.test(x)));
assert.equal(matchInvoice(d, { ...inv, buyer_tax_no: "", buyer_name: "Kaya İnşaat Ltd" }).customer.id, "C", "ad ile");
assert.equal(matchInvoice(d, { ...inv, buyer_tax_no: "999", buyer_name: "Bilinmez" }).customer, null);
const r = checkReadInvoice({ invoice_no: "GIB2026000000123", payable: 27840, buyer_tax_no: "1234567890" }, "Fatura No: GIB2026000000123 VKN 1234567890 Ödenecek Tutar 27.840,00 TL");
assert.deepEqual(r.issues, []);
assert.ok(checkReadInvoice({ invoice_no: "GIB2026000000999", payable: 1 }, "Fatura No: GIB2026000000123").issues.length >= 1);
console.log("invoice-import ok");
