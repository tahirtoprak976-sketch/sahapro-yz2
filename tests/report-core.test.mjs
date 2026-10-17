import assert from "node:assert/strict";
import { buildReport, forAudience, reportSpec, reportCsv, reportOptions, REPORT_KINDS } from "../js/report-core.js";
const n = "x";
const d = {
  customers: [{ id: "C1", name: "Kaya İnşaat", created_at: n }, { id: "C2", name: "Leda", created_at: n }],
  sites: [{ id: "S1", name: "Kütükevler", customer_id: "C1", contact: "Ahmet Şef", created_at: n }],
  vehicles: [{ id: "V1", name: "34GAM627", type: "Tır", created_at: n }, { id: "V2", name: "JCB", type: "İş Makinesi", contractor_id: "T1", created_at: n }],
  personnel: [{ id: "P1", name: "Soner Kaya", created_at: n }],
  dump_sites: [{ id: "D1", name: "Bolluca", fee: 160, fee_unit: "Ton", created_at: n }, { id: "D2", name: "Cebeci", fee: 210, fee_unit: "Ton", created_at: n }],
  quarries: [{ id: "Q1", name: "Öztaş", created_at: n }],
  suppliers: [{ id: "E1", name: "Lastikçi Mesut", created_at: n }],
  contractors: [{ id: "T1", name: "Yılmaz Taşeron", created_at: n }],
  work_records: [
    { id: "W1", date: "2026-10-02", customer_id: "C1", site_id: "S1", vehicle_id: "V1", personnel_id: "P1", work_type: "Hafriyat Nakliye", quantity: 2, unit: "Sefer", dump_site_id: "D1", tonnage: 50, slip_no: "A-1", material: "Hafriyat", price_snapshot: { unit_price: 4000, amount: 8000 }, created_at: n },
    { id: "W2", date: "2026-10-05", customer_id: "C2", vehicle_id: "V1", work_type: "Hafriyat Nakliye", quantity: 1, unit: "Sefer", dump_area: "Cebeci", created_at: n },
    { id: "W3", date: "2026-10-06", customer_id: "C1", site_id: "S1", vehicle_id: "V2", work_type: "Makine Çalışması", quantity: 8, unit: "Saat", price_snapshot: { unit_price: 1500, amount: 12000 }, created_at: n },
    { id: "W4", date: "2026-10-07", customer_id: "C2", vehicle_id: "V1", work_type: "Malzeme", quantity: 1, unit: "Sefer", quarry_id: "Q1", material: "Mıcır", price_snapshot: { amount: 9000 }, created_at: n },
    { id: "W5", date: "2026-09-01", customer_id: "C1", vehicle_id: "V1", dump_site_id: "D1", quantity: 1, unit: "Sefer", created_at: n },
    { id: "W6", date: "2026-10-08", customer_id: "C1", vehicle_id: "V1", dump_site_id: "D1", quantity: 1, unit: "Sefer", deleted_at: "y", created_at: n },
  ],
  fuel_records: [{ id: "F1", date: "2026-10-03", vehicle_id: "V1", personnel_id: "P1", liters: 200, total: 9000, fuel_source: "İstasyon", created_at: n }, { id: "F2", date: "2026-10-04", vehicle_id: "V1", liters: 100, fuel_source: "Müşteri Verdi", customer_id: "C2", created_at: n }],
  maintenance_records: [{ id: "M1", date: "2026-10-09", vehicle_id: "V1", maint_type: "Lastik", cost: 3000, supplier_id: "E1", description: "2 lastik", created_at: n }],
  expense_records: [{ id: "X1", date: "2026-10-10", category: "Yemek", amount: 450, personnel_id: "P1", payment_method: "Personel Ödedi", reimbursement_status: "Bekliyor", created_at: n }, { id: "X2", date: "2026-10-11", category: "Otoyol", amount: 300, vehicle_id: "V1", created_at: n }],
  payables: [{ id: "B1", date: "2026-10-09", party_type: "supplier", party_id: "E1", gross_total: 3000, status: "Açık", created_at: n }],
  supplier_payments: [{ id: "SP1", date: "2026-10-12", party_id: "E1", amount: 1000, method: "Nakit", created_at: n }],
  personnel_events: [{ id: "PE1", date: "2026-10-10", personnel_id: "P1", event_type: "Avans", amount: 2000, created_at: n }],
  payroll_entries: [], cari_movements: [{ id: "CM1", date: "2026-10-15", customer_id: "C1", type: "Tahsilat", amount: -5000, created_at: n }], documents: [], fuel_tank_movements: [],
};
const P = { from: "2026-10-01", to: "2026-10-31", today: "2026-10-16" };
// Döküm sahası: Bolluca — W1 (dump_site_id), W5 dönem dışı, W6 silinmiş
const R = buildReport(d, { k: "dokum", id: "D1", ...P });
assert.equal(R.name, "Bolluca"); assert.equal(R.tables[0].count, 1);
assert.ok(R.kpis.find(([l]) => l === "Döküm maliyeti")[1].startsWith("8.000"), "50 ton × 160");
assert.ok(R.info.some(([l, v]) => l === "Döküm ücreti" && /160/.test(v)));
// Cebeci: dump_area adıyla eşleşir
assert.equal(buildReport(d, { k: "dokum", id: "D2", ...P }).tables[0].count, 1);
const all = buildReport(d, { k: "dokum", ...P });
assert.equal(all.tables[0].count, 2); assert.ok(all.tables.some((t) => t.title === "Döküm sahasına göre"));
// Müşteri karşı nüshası: döküm maliyeti sütunu yok
const M = buildReport(d, { k: "musteri", id: "C1", ...P });
assert.equal(M.tables[0].count, 2);
const Mc = forAudience(M, "customer");
assert.ok(M.tables[0].headers.includes("Döküm Maliyeti")); assert.ok(!Mc.tables[0].headers.includes("Döküm Maliyeti"));
assert.equal(Mc.tables[0].headers.length, Mc.tables[0].rows[0].length);
assert.ok(M.kpis.some(([l, v]) => l === "Tahsilat (dönem)" && /5\.000/.test(v)));
// Araç: gelir 8000+9000, yakıt 9000 (müşteri verdiği hariç), bakım 3000, gider 300, döküm 8000
const A = buildReport(d, { k: "arac", id: "V1", ...P });
const kpi = (R, l) => R.kpis.find(([x]) => x === l)?.[1];
assert.match(kpi(A, "Yakıt"), /300 L \(100 L müşteriden\)/);
assert.match(kpi(A, "Kalan (gelir − giderler)"), /^-?3\.300,00/, "17000 - 9000 - 3000 - 300 - 8000 = -3300");
assert.ok(A.tables.some((t) => t.title === "Yakıt kayıtları" && t.rows.length === 2));
assert.equal(forAudience(A, "customer").tables.some((t) => t.title === "Yakıt kayıtları"), false);
// Personel, esnaf, taşeron, ocak, yakıt, gider, bakım, iş türü, malzeme, şantiye
assert.match(kpi(buildReport(d, { k: "personel", id: "P1", ...P }), "Cebinden ödediği (bekleyen)"), /450/);
const E = buildReport(d, { k: "esnaf", id: "E1", ...P });
assert.match(kpi(E, "Kalan borç (bugün)"), /2\.000/); assert.equal(E.tables.find((t) => t.title === "Hesap hareketleri").rows.length, 2);
assert.equal(buildReport(d, { k: "taseron", id: "T1", ...P }).tables[0].count, 1);
assert.equal(buildReport(d, { k: "ocak", id: "Q1", ...P }).tables[0].count, 1);
assert.match(kpi(buildReport(d, { k: "yakit", ...P }), "Ödenen tutar"), /9\.000/);
assert.match(kpi(buildReport(d, { k: "gider", id: "Yemek", ...P }), "Toplam"), /450/);
assert.match(kpi(buildReport(d, { k: "bakim", id: "V1", ...P }), "Toplam maliyet"), /3\.000/);
assert.equal(buildReport(d, { k: "istur", id: "Hafriyat Nakliye", ...P }).tables[0].count, 2);
assert.equal(buildReport(d, { k: "malzeme", id: "mıcır", ...P }).tables[0].count, 1);
assert.equal(buildReport(d, { k: "santiye", id: "S1", ...P }).tables[0].count, 2);
assert.deepEqual(reportOptions(d, "istur").map((o) => o.id), ["Hafriyat Nakliye", "Makine Çalışması", "Malzeme"]);
// Her tür, her kalem "tümü" ile hatasız çalışır
for (const K of REPORT_KINDS) { const r = buildReport(d, { k: K.k, ...P }); for (const t of r.tables) for (const row of t.rows) assert.equal(row.length, t.headers.length, K.k + " " + t.title); }
const spec = reportSpec(M, { audience: "customer", company: "Muratoğlu" });
assert.equal(spec.orientation, "landscape"); assert.ok(spec.sections.length > 3); assert.match(spec.filename, /Kaya/);
assert.match(reportCsv(R), /Bolluca/);
assert.equal(M.tables[0].rows.at(-1)[0], "TOPLAM"); assert.match(M.tables[0].rows.at(-1).join("|"), /20\.000,00/);
console.log("report-core ok");
