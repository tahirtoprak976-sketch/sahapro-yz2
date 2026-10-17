import assert from "node:assert/strict";
import { validateSlips, slipFill } from "../js/slip-read.js";
const today = "2026-10-14";
const d = { vehicles: [{ id: "VT", name: "34FY2482", plate: "34FY2482" }], quarries: [{ id: "QD", name: "Danış Maden" }], dump_sites: [] };
const t1 = "DANIŞ MADEN KANTAR\nFiş No: 55812  Tarih: 13.10.2026\nPlaka: 34 FY 2482\nBrüt: 32.180 kg Dara: 14.020 kg Net: 18.160 kg\nMalzeme: Mıcır 0-5";
const t2 = "Kantar fişi No 55813 13.10.2026 34FY2482 Net 17,90 ton mıcır";
let res = validateSlips({ slips: [
  { photo: 0, text: t1, net_ton: 18.16, gross: 32180, tare: 14020, slip_no: "55812", date: "2026-10-13", plate: "34 FY 2482", material: "Mıcır", from_place: "Danış Maden" },
  { photo: 1, text: t2, net_ton: 17.9, slip_no: "55813", date: "2026-10-13", plate: "34FY2482" },
] }, { d, today, count: 2 });
assert.equal(res.read, 2); assert.equal(res.total_ton, 36.06);
assert.equal(res.rows[0].vehicle_id, "VT"); assert.equal(res.rows[0].date, "2026-10-13");
// birim Ton → miktar = toplam ton; Sefer → miktar boşsa fiş sayısı, tonaj ayrı
let f = slipFill(res, { unit: "Ton", date: today }, { d, today });
assert.equal(f.quantity, 36.06); assert.equal(f.tonnage, 36.06); assert.equal(f.slip_no, "55812, 55813"); assert.equal(f.date, "2026-10-13"); assert.equal(f.vehicle_id, "VT"); assert.equal(f.quarry_id, "QD"); assert.equal(f.slip_status, "Fiş Var");
f = slipFill(res, { unit: "Sefer", quantity: "", date: today }, { d, today });
assert.equal(f.quantity, 2); assert.equal(f.tonnage, 36.06);
// dolu alanlar ezilmez
f = slipFill(res, { unit: "Sefer", quantity: "3", slip_no: "X", vehicle_id: "VB", date: "2026-10-12" }, { d, today });
assert.equal(f.quantity, undefined); assert.equal(f.slip_no, undefined); assert.equal(f.vehicle_id, undefined); assert.equal(f.date, undefined);
// uydurma ton / fiş no / tarih alınmaz
res = validateSlips({ slips: [{ photo: 0, text: t2, net_ton: 25, slip_no: "99999", date: "2026-10-12", plate: "34ABC123" }] }, { d, today, count: 1 });
assert.equal(res.rows[0].net_ton, null); assert.equal(res.rows[0].slip_no, ""); assert.equal(res.rows[0].date, null); assert.equal(res.rows[0].plate, ""); assert.equal(res.read, 0);
// brüt − dara ile hesaplanan net (fişte net yazmıyor)
res = validateSlips({ slips: [{ photo: 0, text: "Brüt 31.500 Dara 13.200 kg", net_ton: 18.3, gross: 31500, tare: 13200 }] }, { d, today, count: 1 });
assert.equal(res.rows[0].net_ton, 18.3);
console.log("slip-read PASS");
