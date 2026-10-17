import assert from "node:assert/strict";
import { validateDocuments, tcValid, personInfo, companyInfo } from "../js/assistant-docs.js";
import { documentOwner, normalizedDocument } from "../js/business.js";
const n = "x", today = "2026-10-16";
assert.ok(tcValid("10000000146")); assert.ok(!tcValid("10000000147")); assert.ok(!tcValid("01234567890"));
const d = { vehicles: [], personnel: [{ id: "P1", name: "Soner", created_at: n }] };
const EH = "SÜRÜCÜ BELGESİ 1. KAYA 2. SONER 3. 15.04.1985 4a. 01.02.2020 4b. 01.02.2030 4d. 10000000146 5. 123456 9. B C CE KAN GRUBU: A Rh+";
const YENI = "SÜRÜCÜ BELGESİ 1. YILMAZ 2. AHMET CAN 3. 03.07.1990 4b. 05.05.2031 5. 778899 9. B";
const plan = { documents: [
  { photo: 0, category: "Ehliyet", doc_no: "123456", expiry_date: "2030-02-01", date: "2020-02-01", person_name: "SONER KAYA", tc_no: "10000000146", birth_date: "1985-04-15", license_class: "B, C, CE, D", blood_type: "A Rh+" },
  { photo: 1, category: "Ehliyet", doc_no: "778899", expiry_date: "2031-05-05", person_name: "AHMET CAN YILMAZ", birth_date: "1990-07-03", license_class: "B" },
] };
const [a, b] = validateDocuments(plan, { d, today, photoTexts: [EH, YENI], photoCount: 2 });
assert.equal(a.owner_id, "P1"); assert.equal(a.ok, true);
assert.deepEqual(a.card_update.map((u) => [u.k, u.to]), [["name", "Soner Kaya"], ["identity_number", "10000000146"], ["birth_date", "1985-04-15"], ["license_class", "B, C, CE"], ["blood_type", "A Rh+"]], "D sınıfı belgede yok");
assert.equal(b.owner_id, null); assert.equal(b.new_person.name, "Ahmet Can Yılmaz"); assert.equal(b.ok, true);
assert.ok(b.issues.some((x) => /yeni personel/.test(x)));
assert.equal(personInfo({ person_name: "MEHMET DEMİR" }, YENI).name, "", "belgede olmayan ad");
// Şirket evrakı
assert.equal(documentOwner("Vergi Levhası"), "company");
assert.equal(normalizedDocument({ category: "Vergi Levhası", date: today, doc_no: "1" }).owner_id, "company_profile");
const VL = "VERGİ LEVHASI ADI SOYADI / TİCARET ÜNVANI: MURATOĞLU HAFRİYAT NAKLİYAT İNŞAAT SANAYİ VE TİCARET LTD. ŞTİ. VERGİ DAİRESİ: KOZYATAĞI VERGİ KİMLİK NO: 6230123456 ANA FAALİYET KODU 43.12.01 İŞ YERİ ADRESİ: ATATÜRK MAH. ÇAM SK. NO:5 ATAŞEHİR / İSTANBUL";
const [c] = validateDocuments({ documents: [{ photo: 0, category: "Vergi Levhası", company_title: "MURATOĞLU HAFRİYAT NAKLİYAT İNŞAAT SANAYİ VE TİCARET LTD. ŞTİ.", tax_no: "623 012 3456", tax_office: "KOZYATAĞI", nace: "43.12.01", address: "ATATÜRK MAH. ÇAM SK. NO:5 ATAŞEHİR / İSTANBUL", mersis_no: "0623012345600017" }] },
  { d, today, photoTexts: [VL], photoCount: 1, company: { name: "Muratoğlu Hafriyat", tax_office: "Kozyatağı" } });
assert.equal(c.owner_type, "company"); assert.equal(c.owner_id, "company_profile");
assert.deepEqual(c.card_update.map((u) => u.k), ["title", "tax_no", "nace", "address"], "vergi dairesi aynı, mersis belgede yok");
assert.equal(c.doc_no, "6230123456", "belge no yoksa vergi no"); assert.equal(c.ok, true, "vergi levhasının bitişi yok");
assert.equal(companyInfo({ tax_no: "9999999999" }, VL).tax_no, "");
console.log("doc-owner-info ok");
