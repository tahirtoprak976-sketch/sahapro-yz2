import assert from "node:assert/strict";
import { customerAmbiguity, occupationOnly, validatePlan } from "../js/assistant-core.js";
const today = "2026-10-14";
const d = {
  customers: [
    { id: "K", name: "Kuyucu" }, { id: "KK", name: "Kuyucu Kamil" }, { id: "KS", name: "Kuyucular" },
    { id: "AN", name: "Aydın Nalbur" }, { id: "HA", name: "Hurdacı Aydın" }, { id: "AI", name: "Aydın İnşaat" },
    { id: "HP", name: "Hisar Polat" }, { id: "AG", name: "Ağırtaş Mimarlık", parent_customer_id: "HP" },
  ],
  sites: [], personnel: [], suppliers: [], dump_sites: [], aliases: [{ id: "a", alias: "Mahir Bey", target_type: "customer", target_id: "HP" }],
  vehicles: [{ id: "J", name: "JCB Kepçe" }, { id: "S", name: "SANY Ekskavatör" }],
  work_records: [
    { id: "w1", date: "2026-10-01", customer_id: "K", vehicle_id: "J", description: "Kemerburgaz Sony market arkası kuyucu kuyu kazma" },
    { id: "w2", date: "2026-10-12", customer_id: "KS", vehicle_id: "S", description: "Sany kemerburgaz ali Bey şantiyesi kuyuculara 2 saat" },
    { id: "w3", date: "2026-09-01", customer_id: "KK", vehicle_id: "J", description: "kuyucu kamil kuyu kazma" },
  ],
};
// iki "kuyucu" kartı eşit: belirsiz, yer ipucuyla doğru aday öne
let a = customerAmbiguity(d, "Jcb kepçe Sony market arkası kuyucu kuyu kazma 1 saat", "KS", { vehicleId: "J", date: today });
assert.ok(a); assert.equal(a.cands[0].id, "K"); assert.ok(/sony/.test(a.cands[0].why));
// araç ipucu: SANY son günlerde Kuyucular'a çalıştı
a = customerAmbiguity(d, "Sany kuyuculara 2 saat", "K", { vehicleId: "S", date: today });
assert.equal(a.cands[0].id, "KS");
// "kuyucu kamil" tam ve en belirgin: belirsizlik yok
assert.equal(customerAmbiguity(d, "kuyucu kamil'e 5 saat", "KK", { date: today }), null);
// yanlış seçilmişse (Kuyucu) en belirgin aday (Kuyucu Kamil) önerilir
a = customerAmbiguity(d, "kuyucu kamil'e 5 saat", "K", { date: today });
assert.equal(a.cands[0].id, "KK");
// Aydın: tam adlar ayırt eder
assert.equal(customerAmbiguity(d, "aydın nalbur adına alındı", "AN", { date: today }), null);
assert.equal(customerAmbiguity(d, "hurdacı aydına 2 sefer", "HA", { date: today }), null);
// yalnız "aydına": Aydın İnşaat tam uyuyor ama Aydın Nalbur ve Hurdacı Aydın da aday
a = customerAmbiguity(d, "aydına 2 sefer kum", "AN", { date: today });
assert.deepEqual(a.cands.map((c) => c.id).sort(), ["AI", "AN", "HA"]);
// takma adla seçilmiş Hisar Polat: mesajda başka müşteri adı yoksa sorun yok
assert.equal(customerAmbiguity(d, "Mahir bey 14 tonluk 1 yevmiye", "HP", { date: today }), null);
// meslek adı
assert.ok(occupationOnly("kuyucu")); assert.ok(occupationOnly("kuyuculara")); assert.ok(!occupationOnly("kuyucu kamil")); assert.ok(!occupationOnly("mahir bey"));
// validatePlan: belirsiz satır işaretsiz, aday listesi ile
const v = validatePlan({ works: [{ customer_id: "KS", vehicle_id: "J", work_type: "Makine Çalışması", quantity: 1, unit: "Saat", quote: "Sony market arkası kuyucu kuyu kazma 1 saat" }] },
  { message: "Jcb kepçe Sony market arkası kuyucu kuyu kazma 1 saat", d, today });
assert.equal(v.works[0].ok, false); assert.equal(v.works[0].customer_id, "K"); assert.equal(v.works[0].ambiguous.length, 3, "Kuyucu, Kuyucular ve Kuyucu Kamil");
console.log("customer-ambiguity PASS");
{
  const { customerWordGroups } = await import("../js/assistant-core.js");
  const g = customerWordGroups(d).map((x) => x.customers.map((c) => c.id).sort().join(","));
  assert.ok(g.includes("K,KK,KS"), g.join(" | "));
  assert.ok(g.includes("AI,AN,HA"), g.join(" | "));
  assert.ok(!g.some((x) => x.includes("HP") && x.includes("K")));
  console.log("customer-groups PASS");
}
// taşeron: "X'in inşaatında Y'ye" → yeni müşteri Y, ana firması X; X'in şantiyesi açıklamaya yazılır
{
  const dd = { ...d, sites: [{ id: "SHP", name: "Coşar Polat", customer_id: "HP" }], vehicles: [{ id: "M", name: "Manitou" }] };
  const msg = "Mahir beyin inşaatında erdem yapıya 2 saat cam indirildi manitou";
  const v = validatePlan({ works: [{ new_customer: "Erdem Yapı", new_customer_parent_id: "HP", site_id: "SHP", vehicle_id: "M", work_type: "Makine Çalışması", quantity: 2, unit: "Saat", description: "cam indirildi" }] }, { message: msg, d: dd, today });
  const w = v.works[0];
  assert.equal(w.new_customer, "Erdem Yapı"); assert.equal(w.new_customer_parent_id, "HP"); assert.equal(w.site_id, null);
  assert.ok(/Coşar Polat/.test(w.description)); assert.equal(w.ok, true);
  // mevcut taşeron (Ağırtaş → HP) ana firmanın şantiyesinde
  const v2 = validatePlan({ works: [{ customer_id: "AG", site_id: "SHP", vehicle_id: "M", work_type: "Makine Çalışması", quantity: 2, unit: "Saat" }] }, { message: "Coşar Polat'ta ağırtaş mimarlığa 2 saat manitou", d: dd, today });
  assert.equal(v2.works[0].customer_id, "AG"); assert.equal(v2.works[0].site_id, null); assert.ok(!v2.works[0].issues.some((x) => /ait değil/.test(x)));
  // ad mesajda yoksa yeni müşteri açılmaz ve satır işaretsiz
  const v3 = validatePlan({ works: [{ new_customer: "Uydurma Yapı", site_id: "SHP", vehicle_id: "M", work_type: "Makine Çalışması", quantity: 2, unit: "Saat" }] }, { message: msg, d: dd, today });
  assert.equal(v3.works[0].ok, false);
  console.log("taseron PASS");
}
// taşeron adı geçmiyorsa ana firmaya yazılır; geçiyorsa taşerona
{
  const dd = { ...d, sites: [{ id: "SHP", name: "Coşar Polat", customer_id: "HP" }], vehicles: [{ id: "M", name: "Manitou" }] };
  let v = validatePlan({ works: [{ customer_id: "AG", site_id: "SHP", vehicle_id: "M", work_type: "Makine Çalışması", quantity: 2, unit: "Saat" }] }, { message: "Coşar Polat'ta 2 saat alçıpan verildi manitou", d: dd, today });
  assert.equal(v.works[0].customer_id, "HP"); assert.equal(v.works[0].site_id, "SHP"); assert.ok(v.works[0].issues.some((x) => /ana firma/.test(x)));
  assert.ok(!/Yer:/.test(v.works[0].description));
  v = validatePlan({ works: [{ customer_id: "AG", site_id: "SHP", vehicle_id: "M", work_type: "Makine Çalışması", quantity: 2, unit: "Saat" }] }, { message: "Coşar Polat'ta ağırtaş mimarlığa 2 saat alçıpan manitou", d: dd, today });
  assert.equal(v.works[0].customer_id, "AG");
  console.log("taseron-kurali PASS");
}
// müşteri adı yazılmamış / listede yok: öneri işaretsiz gelir
{
  const { nameInMessage, guessCustomer } = await import("../js/assistant-core.js");
  const dd = { ...d, customers: [...d.customers, { id: "KI", name: "Kaya İnşaat" }, { id: "MS", name: "Muharrem Şef" }], sites: [{ id: "SA", name: "Arnavutköy Villa", customer_id: "MS" }],
    vehicles: [{ id: "VT", name: "34FY2482", plate: "34FY2482" }], personnel: [{ id: "B", name: "Bayram" }], work_records: [{ id: "x", date: today, vehicle_id: "VT", customer_id: "HP" }] };
  assert.equal(nameInMessage(dd, "34FY2482 Tır Süleyman Kaya 1 sefer bolluca döküm"), "Süleyman Kaya");
  assert.equal(nameInMessage(dd, "Bayram Tırcı Ahmet Bey'e 2 sefer kum"), "Ahmet Bey");
  assert.equal(nameInMessage(dd, "Kaya İnşaat 3 sefer"), null);
  let v = validatePlan({ works: [{ date: today, vehicle_id: "VT", work_type: "Hafriyat Nakliye", quantity: 1, unit: "Sefer" }] }, { message: "34FY2482 Tır Süleyman Kaya 1 sefer bolluca döküm", d: dd, today });
  assert.equal(v.works[0].new_customer, "Süleyman Kaya"); assert.equal(v.works[0].ok, false);
  v = validatePlan({ works: [{ date: today, vehicle_id: "VT", work_type: "Mıcır Nakliye", quantity: 1, unit: "Sefer" }] }, { message: "Entodan 3no mocır 1sefer muarem sef arnavutkoy 34FY2482", d: dd, today });
  assert.equal(v.works[0].customer_id, "MS"); assert.equal(v.works[0].ok, false);
  // hiçbir ad yoksa aynı aracın son günlerdeki müşterisi önerilir
  const g = guessCustomer(dd, "Şantiyeden 1sefer harfiyat boluca döküm", { vehicleId: "VT", date: today });
  assert.equal(g.id, "HP");
  // Gemini tahmin ettiyse (customer_guess) işaretsiz
  v = validatePlan({ works: [{ date: today, customer_id: "MS", customer_guess: true, vehicle_id: "VT", work_type: "Mıcır Nakliye", quantity: 1, unit: "Sefer" }] }, { message: "34FY2482 1 sefer mıcır", d: dd, today });
  assert.equal(v.works[0].customer_id, "MS"); assert.equal(v.works[0].ok, false);
  console.log("musteri-oneri PASS");
}
