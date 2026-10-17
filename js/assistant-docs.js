// Asistan — fotoğraftan döküm/kantar fişi ve araç/personel belgesi (bitiş tarihi) okuma. SAF katman.
// Kural aynı: fiş numarası, tonaj, tarih ve plaka FOTOĞRAFIN YAZISINDA geçmeli; geçmeyen satır işaretsiz gelir.
import { isActive, todayStr, addDays, COMPANY_NAME, sameDocument } from "./core.js";
import { numbersInText } from "./ai-assist.js";
import { VEHICLE_DOCS, PERSONNEL_DOCS, COMPANY_DOCS, COMPANY_OWNER_ID, documentOwner } from "./business.js";
import { foldTr } from "./parser.js";

const live = (d, s) => (d[s] || []).filter(isActive);
const norm = (s) => foldTr(s).replace(/[^\p{L}\p{N}]+/gu, " ").trim();
const alnum = (s) => foldTr(s).toUpperCase().replace(/[^A-Z0-9]/g, "");
export const NO_EXPIRY = ["Ruhsat", "Kimlik / Kimlik Bilgisi", "SGK / İşe Giriş Evrakı", "Makine Tescil Belgesi", "Vergi Levhası", "Ticaret Sicil Gazetesi", "İmza Sirküleri", "SGK İşyeri Tescili", "Şirket Evrakı"];
const MONTHS = ["ocak", "subat", "mart", "nisan", "mayis", "haziran", "temmuz", "agustos", "eylul", "ekim", "kasim", "aralik"];
const pad = (n) => String(n).padStart(2, "0");

function iso(y, m, d) {
  y = Number(y); m = Number(m); d = Number(d);
  if (y < 100) y += 2000;
  if (!(m >= 1 && m <= 12 && d >= 1 && d <= 31 && y >= 1990 && y <= 2100)) return null;
  const dt = new Date(`${y}-${pad(m)}-${pad(d)}T12:00:00`);
  return dt.getDate() === d ? `${y}-${pad(m)}-${pad(d)}` : null;
}
// Metindeki tüm tarihler (15.03.2027, 15/3/27, 2027-03-15, 15 Mart 2027) → ISO kümesi
export function datesInText(text) {
  const out = new Set(), t = String(text || "");
  for (const m of t.matchAll(/(?<!\d)(\d{4})[.\/-](\d{1,2})[.\/-](\d{1,2})(?!\d)/g)) { const x = iso(m[1], m[2], m[3]); if (x) out.add(x); }
  for (const m of t.matchAll(/(?<!\d)(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{4}|\d{2})(?!\d)/g)) { const x = iso(m[3], m[2], m[1]); if (x) out.add(x); }
  const f = foldTr(t);
  for (const m of f.matchAll(/(?<!\d)(\d{1,2})\s+([a-z]+)\s+(\d{4})(?!\d)/g)) {
    const mi = MONTHS.indexOf(m[2]);
    if (mi >= 0) { const x = iso(m[3], mi + 1, m[1]); if (x) out.add(x); }
  }
  return out;
}
const isoOk = (s) => (/^\d{4}-\d{2}-\d{2}$/.test(String(s || "")) ? iso(...String(s).split("-")) : null);
const photoIdx = (p, count) => (Number.isInteger(Number(p)) && Number(p) >= 0 && Number(p) < count ? Number(p) : null);
const vehicleInText = (v, text) => {
  const t = alnum(text);
  const p = alnum(v.plate || "");
  return p.length >= 5 && t.includes(p);
};

// ---- Döküm / kantar fişi ----
// Her fiş bir "Döküm Fişi" belgesi olur; sahibi bir sefer işidir (varsa o gün o aracın sefer işi, yoksa yeni 1 sefer)
export function validateTickets(plan, { d, today = todayStr(), photoTexts = [], photoCount = 0 } = {}) {
  const out = [];
  const vehicles = live(d, "vehicles"), dumps = live(d, "dump_sites");
  const used = new Set();
  for (const t of (Array.isArray(plan?.tickets) ? plan.tickets : []).slice(0, 20)) {
    const issues = [];
    const photo = photoIdx(t.photo, photoCount);
    const text = photo != null ? String(photoTexts[photo] || "") : "";
    if (photo == null) issues.push("Hangi fotoğraf olduğu belli değil");
    else if (!text.trim()) issues.push("Fotoğrafın yazısı okunamadı");
    const r = { photo, date: null, vehicle_id: null, ticket_no: "", tonnage: null, dump_site_id: null, dump_site_name: "", material: "", customer_id: null, site_id: null, link: "" };
    // Malzeme: fişin yazısında geçmeli (kum, mıcır 0-5, gravak…)
    if (t.material && materialKind(t.material) && materialKind(text) === materialKind(t.material)) r.material = String(t.material).slice(0, 40);
    else if (materialKind(text)) r.material = MATERIAL_LABEL[materialKind(text)];
    // Fiş no: yazıda birebir geçmeli
    const no = String(t.ticket_no || "").trim();
    if (no && alnum(no).length >= 2 && alnum(text).includes(alnum(no))) r.ticket_no = no.slice(0, 40);
    else issues.push(no ? `Fiş no "${no}" fotoğrafta yok` : "Fiş numarası okunamadı");
    // Tarih: fişte yazan tarih
    const dates = datesInText(text);
    const dt = isoOk(t.date);
    if (dt && dates.has(dt) && dt <= addDays(today, 1)) { r.date = dt; r.dateRead = true; }
    else { r.date = today; r.dateRead = false; issues.push(dt ? `Tarih ${dt} fişte yok, kontrol edin` : "Fiş tarihi okunamadı, bugün yazıldı"); }
    // Tonaj (net)
    if (t.tonnage != null && t.tonnage !== "") {
      const n = Math.round(Number(String(t.tonnage).replace(",", ".")) * 100) / 100;
      const nums = numbersInText(text);
      // Kantar kg yazabilir: 18.420 kg ↔ 18,42 ton
      if (n > 0 && n < 200 && (nums.has(n) || nums.has(Math.round(n * 1000)))) r.tonnage = n;
      else issues.push(`Tonaj ${t.tonnage} fişte yok`);
    }
    // Araç: plaka fişte yazmalı
    const byId = vehicles.find((v) => v.id === t.vehicle_id);
    const byPlate = t.plate ? vehicles.find((v) => alnum(v.plate || v.name || "").length >= 5 && alnum(v.plate || v.name) === alnum(t.plate)) : null;
    const veh = byId || byPlate || vehicles.find((v) => vehicleInText(v, text)) || null;
    if (veh && (vehicleInText(veh, text) || !veh.plate)) r.vehicle_id = veh.id;
    else if (veh) { r.vehicle_id = veh.id; issues.push(`${veh.plate} plakası fişte görünmüyor`); }
    else issues.push(t.plate ? `Plaka ${t.plate} araç listesinde yok` : "Araç bulunamadı");
    // Döküm yeri
    const ds = dumps.find((x) => x.id === t.dump_site_id) || (t.dump_site_name ? dumps.find((x) => norm(x.name) && (` ${norm(t.dump_site_name)} `).includes(` ${norm(x.name)} `)) : null);
    if (ds) r.dump_site_id = ds.id;
    else if (t.dump_site_name && (` ${norm(text)} `).includes(` ${norm(t.dump_site_name)} `)) r.dump_site_name = String(t.dump_site_name).slice(0, 60);
    if (live(d, "customers").some((c) => c.id === t.customer_id)) r.customer_id = t.customer_id;
    const site = live(d, "sites").find((s) => s.id === t.site_id);
    if (site && site.customer_id === r.customer_id) r.site_id = site.id;
    // Aynı fiş iki kez okunmasın (aynı fotoğraf/aynı numara) ve daha önce kaydedilmiş mi
    const key = alnum(r.ticket_no);
    if (key && used.has(key)) { issues.push("Aynı fiş iki kez"); r.dup = true; }
    used.add(key);
    if (key && live(d, "documents").some((x) => x.category === "Döküm Fişi" && alnum(x.doc_no) === key)) { issues.push("Bu fiş numarası zaten kayıtlı"); r.dup = true; }
    // Bağlanacak iş: aynı gün aynı aracın sefer işi
    const works = r.vehicle_id ? live(d, "work_records").filter((w) => w.date === r.date && w.vehicle_id === r.vehicle_id && w.unit === "Sefer") : [];
    r.works = works.map((w) => w.id);
    r.link = works[0]?.id || "new";
    if (!r.customer_id && works[0]) r.customer_id = works[0].customer_id;
    r.issues = issues;
    r.ok = !!(photo != null && r.ticket_no && r.vehicle_id && !r.dup && !issues.some((x) => /fişte yok|görünmüyor|okunamadı/.test(x)));
    out.push(r);
  }
  return out;
}

// Gün/araç bazında fiş sayısı ↔ kayıtlı sefer (Bugün panosu için)
export function ticketReconcile(data, { today = todayStr(), days = 7 } = {}) {
  const since = addDays(today, -days);
  const works = live(data, "work_records");
  const workById = new Map(works.map((w) => [w.id, w]));
  const tickets = new Map();
  for (const doc of live(data, "documents")) {
    if (doc.category !== "Döküm Fişi" || !doc.date || doc.date < since || doc.date > today) continue;
    const vid = doc.ticket_vehicle_id || workById.get(doc.owner_id)?.vehicle_id;
    if (!vid) continue;
    const k = doc.date + "|" + vid;
    tickets.set(k, (tickets.get(k) || 0) + 1);
  }
  const out = [];
  for (const [k, n] of tickets) {
    const [date, vid] = k.split("|");
    const sefer = works.filter((w) => w.date === date && w.vehicle_id === vid && w.unit === "Sefer").reduce((s, w) => s + (Number(w.quantity) || 0), 0);
    if (n !== sefer) out.push({ date, vehicle_id: vid, tickets: n, sefer });
  }
  return out.sort((a, b) => b.date.localeCompare(a.date));
}

// ---- Araç / personel belgesi (muayene, sigorta, ehliyet, SRC…) → bitiş tarihi ----
export const ASSIST_DOC_TYPES = [...VEHICLE_DOCS, ...PERSONNEL_DOCS, ...COMPANY_DOCS];
// Plaka anahtarı: "34 ABC 123" → "34ABC123" (Türk plakası biçiminde değilse boş)
export const plateKey = (s) => { const k = alnum(s); return /^(0[1-9]|[1-7]\d|8[01])[A-Z]{1,3}\d{2,5}$/.test(k) ? k : ""; };
// Belgeden araç bilgisi: her değer belgenin yazısında gerçekten geçmeli (uydurma bilgi karta yazılmaz)
const FUELS = [["Dizel", /dizel|diesel|motorin/], ["Benzin", /benzin/], ["LPG", /lpg/], ["Elektrik", /elektrik/]];
export function vehicleInfo(x, text) {
  const nt = ` ${norm(text)} `, at = alnum(text), nums = numbersInText(text);
  const word = (v, max) => { const s = String(v || "").trim(); return s.length >= 2 && nt.includes(` ${norm(s)} `) ? s.slice(0, max) : ""; };
  const code = (v) => { const k = alnum(v); return k.length >= 6 && at.includes(k) ? k.slice(0, 30) : ""; };
  const yr = Number(x.model_year), km = Math.round(Number(x.km));
  const kind = String(x.vehicle_kind || "").trim();
  const fuel = FUELS.find(([, re]) => re.test(foldTr(x.fuel_type || "").toLowerCase()) && re.test(foldTr(text).toLowerCase()));
  return {
    type: kind && nt.includes(` ${norm(kind)}`) && vehicleKind(kind) !== "Araç/Makine" ? vehicleKind(kind) : "",
    brand: word(x.brand, 40), model: word(x.model, 60),
    model_year: yr >= 1950 && yr <= 2100 && String(text).includes(String(yr)) ? yr : null,
    chassis_no: code(x.chassis_no), engine_no: code(x.engine_no), color: word(x.color, 30),
    fuel_type: fuel ? fuel[0] : "",
    km: km > 0 && km < 5e6 && nums.has(km) ? km : null,
  };
}
export const VEHICLE_INFO_LABELS = { plate: "Plaka", type: "Tür", brand: "Marka", model: "Model", model_year: "Model yılı", chassis_no: "Şasi no", engine_no: "Motor no", color: "Renk", fuel_type: "Yakıt tipi", km: "Km" };
const sameType = (a, b) => { const g = (t) => (/^(tır|çekici)$/i.test(t) ? "TIR" : t); return g(a) === g(b); };
// Kayıtlı araç kartı ile belge arasındaki farklar. on: varsayılan işaretli mi
export function vehicleUpdate(v, info) {
  const out = [];
  for (const k of Object.keys(VEHICLE_INFO_LABELS)) {
    if (k === "plate") continue;
    const to = info[k], from = v[k];
    if (to == null || to === "") continue;
    if (k === "km") { if (to > Number(from || 0)) out.push({ k, from: from || null, to, on: true }); continue; }
    if (k === "type") { if (!sameType(from || "", to)) out.push({ k, from: from || null, to, on: !from || from === "Araç/Makine" }); continue; }
    if (k === "model_year" ? Number(from) === to : norm(from) === norm(to) || alnum(from) === alnum(to) && /_no$/.test(k)) continue;
    out.push({ k, from: from || null, to, on: true });
  }
  return out;
}
// Belgedeki cins → uygulamanın araç türü
export const VEHICLE_KINDS = ["Çekici", "Yarı Römork", "Römork", "Tır", "Kamyon", "Kamyonet", "Binek", "Vinç", "İş Makinesi", "Araç/Makine"];
export function vehicleKind(s) {
  const t = String(s || "").toLocaleLowerCase("tr-TR");
  if (/yar[ıi]\s*r[öo]mork|semi/.test(t)) return "Yarı Römork";
  if (/r[öo]mork|dorse/.test(t)) return "Römork";
  if (/[çc]ekici/.test(t)) return "Çekici";
  if (/kamyonet|pikap|panelvan|pick ?up/.test(t)) return "Kamyonet";
  if (/kamyon/.test(t)) return "Kamyon";
  if (/(^|[^a-zçğıöşü])t[ıi]r($|[^a-zçğıöşü])/.test(t)) return "Tır";
  if (/otomobil|binek|arazi ta[şs]|suv|hatchback|sedan|minib[üu]s/.test(t)) return "Binek";
  if (/ekskavat|kaz[ıi]c[ıi]|y[üu]kleyici|loder|greyder|silindir|forklift|i[şs] makine/.test(t)) return "İş Makinesi";
  return "Araç/Makine";
}
export function validateDocuments(plan, { d, today = todayStr(), photoTexts = [], photoCount = 0, company = null } = {}) {
  const out = [];
  const companyOwner = { id: COMPANY_OWNER_ID, name: COMPANY_NAME, ...(company || {}) };
  for (const x of (Array.isArray(plan?.documents) ? plan.documents : []).slice(0, 10)) {
    const issues = [];
    let upd = [];
    const photo = photoIdx(x.photo, photoCount);
    const text = photo != null ? String(photoTexts[photo] || "") : "";
    if (photo == null) issues.push("Hangi fotoğraf olduğu belli değil");
    const category = ASSIST_DOC_TYPES.includes(x.category) ? x.category : null;
    if (!category) issues.push("Belge türü seçilmeli");
    const owner_type = category ? documentOwner(category) : ["personnel", "company"].includes(x.owner_type) ? x.owner_type : "vehicle";
    const list = owner_type === "personnel" ? live(d, "personnel") : owner_type === "vehicle" ? live(d, "vehicles") : [];
    let owner = owner_type === "company" ? companyOwner : list.find((o) => o.id === x.owner_id) || null;
    let newVehicle = null, newPerson = null;
    if (owner_type === "vehicle") {
      if (!owner) owner = list.find((v) => vehicleInText(v, text)) || null;
      // Aynı belge daha önce bir araca kaydedildiyse (ör. plakasız "Mobil Vinç") o araç
      const dno = alnum(x.doc_no);
      if (!owner && dno.length >= 5 && alnum(text).includes(dno)) {
        const prev = live(d, "documents").find((y) => alnum(y.doc_no) === dno && (y.vehicle_id || (y.owner_type === "vehicle" && y.owner_id)));
        if (prev) owner = list.find((v) => v.id === (prev.vehicle_id || prev.owner_id)) || null;
      }
      // Kayıtlı olmayan araç: belgedeki plaka (belgede gerçekten yazıyorsa) ile yeni araç kartı önerilir
      const pl = plateKey(x.plate);
      if (!owner && pl && alnum(text).includes(pl)) {
        owner = list.find((v) => plateKey(v.plate) === pl || plateKey(v.name) === pl) || null;
        if (!owner) { const info = vehicleInfo(x, text); newVehicle = { plate: pl, ...info, type: info.type || vehicleKind(x.vehicle_kind || text) }; }
      }
      if (owner) {
        const pk = plateKey(owner.plate) || plateKey(owner.name) || (plateKey(x.plate) && alnum(text).includes(plateKey(x.plate)) && !list.some((v) => v.id !== owner.id && (plateKey(v.plate) === plateKey(x.plate) || plateKey(v.name) === plateKey(x.plate))) ? plateKey(x.plate) : "");
        if (pk && alnum(text).includes(pk)) {
          upd = vehicleUpdate(owner, vehicleInfo(x, text));
          if (!plateKey(owner.plate)) upd.unshift({ k: "plate", from: owner.plate || null, to: pk, on: true });
        }
      }
    } else if (owner_type === "personnel") {
      const info = personInfo(x, text, datesInText(text));
      if (!owner && info.identity_number) owner = list.find((p) => p.identity_number === info.identity_number) || null;
      if (!owner) owner = list.find((p) => norm(p.name).length >= 5 && (` ${norm(text)} `).includes(` ${norm(p.name)} `)) || null;
      if (!owner && info.name) owner = list.find((p) => norm(p.name) === norm(info.name)) || null;
      if (!owner && info.name) newPerson = info;
      if (owner && (!owner.identity_number || !info.identity_number || owner.identity_number === info.identity_number) && nameMatches(owner.name, text)) upd = personUpdate(owner, info);
      // Kartta yalnız ad varsa (ör. "Soner") ve belgede tam ad yazıyorsa: aynı kişi varsayılır ama "Yeni personel" seçeneği de sunulur
      if (owner && info.name && !owner.identity_number && norm(owner.name).split(" ").length === 1 && norm(info.name) !== norm(owner.name)) {
        newPerson = info;
        issues.push(`Kartta "${owner.name}" yazıyor; belgede "${info.name}". Aynı kişi değilse sahibini "➕ Yeni personel" yapın`);
      }
    } else if (owner_type === "company") {
      upd = infoUpdate(owner, companyInfo(x, text), Object.keys(COMPANY_INFO_LABELS));
    }
    if (newVehicle) issues.push(`${newVehicle.plate} kayıtlı değil — yeni araç kartı açılacak (${newVehicle.type}${newVehicle.brand ? " · " + newVehicle.brand : ""}${newVehicle.model_year ? " · " + newVehicle.model_year : ""})`);
    else if (newPerson && !owner) issues.push(`${newPerson.name} kayıtlı değil — yeni personel kartı açılacak`);
    else if (!owner) issues.push(owner_type === "personnel" ? "Personel seçilmeli" : "Araç seçilmeli");
    else if (owner_type === "vehicle" && owner.plate && !vehicleInText(owner, text)) issues.push(`${owner.plate} plakası belgede görünmüyor`);
    else if (owner_type === "personnel" && !nameMatches(owner.name, text)) issues.push(`${owner.name} adı belgede görünmüyor`);
    const dates = datesInText(text);
    const r = { photo, category, owner_type, owner_id: owner?.id || null, existing_doc_id: null, new_vehicle: newVehicle, new_person: newPerson, card_update: upd, doc_no: "", date: null, expiry_date: null };
    const no = String(x.doc_no || "").trim();
    if (no && alnum(no).length >= 3 && alnum(text).includes(alnum(no))) r.doc_no = no.slice(0, 40);
    else if (owner_type === "company" && upd.find((u) => u.k === "tax_no")) r.doc_no = upd.find((u) => u.k === "tax_no").to;
    else if (owner_type === "company" && owner.tax_no && alnum(text).includes(owner.tax_no)) r.doc_no = owner.tax_no;
    else issues.push(no ? `Belge no "${no}" belgede yok` : "Belge numarası okunamadı");
    const ex = isoOk(x.expiry_date);
    if (ex && dates.has(ex)) r.expiry_date = ex;
    else if (!NO_EXPIRY.includes(category)) issues.push(ex ? `Bitiş ${ex} belgede yok` : "Bitiş tarihi okunamadı");
    const st = isoOk(x.date);
    if (st && dates.has(st)) r.date = st;
    else { r.date = r.expiry_date && r.expiry_date < today ? r.expiry_date : today; if (st) issues.push(`Düzenleme tarihi ${st} belgede yok, bugün yazıldı`); }
    if (r.expiry_date && r.date > r.expiry_date) r.date = r.expiry_date;
    if (r.expiry_date && r.expiry_date < today) issues.push("Bu belgenin süresi dolmuş");
    // Aynı belge zaten kayıtlıysa ikinci kez eklenmez; yalnız kart bilgileri (ve daha geç bitiş tarihi) güncellenir
    if (r.owner_id && category) {
      const ex = live(d, "documents").find((y) => sameDocument(y, { ...r, doc_no: r.doc_no || no }));
      if (ex) { r.existing_doc_id = ex.id; issues.push(`Bu belge zaten kayıtlı (${ex.category}) — ikinci kez eklenmez${upd.length ? ", yalnız kart bilgileri güncellenir" : ""}`); }
    }
    r.issues = issues;
    r.ok = !(r.existing_doc_id && !upd.length) && !!(photo != null && category && (r.owner_id || r.new_vehicle || r.new_person) && r.doc_no && (r.expiry_date || NO_EXPIRY.includes(category)) && !issues.some((i) => /görünmüyor|belgede yok/.test(i)));
    out.push(r);
  }
  return out;
}

// ---- Personel belgesi (ehliyet, SRC, kimlik…) → personel kartı ----
const titleTr = (s) => String(s || "").toLocaleLowerCase("tr-TR").replace(/(^|\s)(\S)/g, (m, a, b) => a + b.toLocaleUpperCase("tr-TR")).trim();
const nameMatches = (name, text) => { const w = norm(name).split(" ").filter((x) => x.length >= 2); const t = ` ${norm(text)} `; return w.length > 0 && w.every((x) => t.includes(` ${x} `)); };
export function tcValid(s) {
  const t = String(s || "");
  if (!/^[1-9]\d{10}$/.test(t)) return false;
  const n = [...t].map(Number);
  const d10 = ((n[0] + n[2] + n[4] + n[6] + n[8]) * 7 - (n[1] + n[3] + n[5] + n[7])) % 10;
  return (d10 + 10) % 10 === n[9] && n.slice(0, 10).reduce((a, b) => a + b, 0) % 10 === n[10];
}
const LICENSE = ["A1", "A2", "A", "B1", "B", "BE", "C1", "C1E", "C", "CE", "D1", "D1E", "D", "DE", "F", "G", "M"];
export const PERSON_INFO_LABELS = { name: "Ad soyad", identity_number: "TC kimlik no", birth_date: "Doğum tarihi", license_class: "Ehliyet sınıfı", blood_type: "Kan grubu" };
export function personInfo(x, text, dates = datesInText(text)) {
  const nt = ` ${norm(text)} `, at = alnum(text);
  const nm = String(x.person_name || "").trim();
  const name = nm.split(/\s+/).length >= 2 && nameMatches(nm, text) ? titleTr(nm).slice(0, 60) : "";
  const tc = String(x.tc_no || "").replace(/\D/g, "");
  // Doğum tarihi 1990 öncesi olabilir: belgede GG.AA.YYYY (ya da / -) olarak geçmeli
  const bm = /^(19[2-9]\d|20[0-2]\d)-(\d{2})-(\d{2})$/.exec(String(x.birth_date || ""));
  const bd = bm && new RegExp(`(^|\\D)${bm[3]}[./-]${bm[2]}[./-]${bm[1]}(\\D|$)`).test(text) ? bm[0] : null;
  const words = new Set(String(text).toUpperCase().split(/[^A-Z0-9]+/));
  const lic = String(x.license_class || "").toUpperCase().split(/[^A-Z0-9]+/).filter((c) => LICENSE.includes(c) && words.has(c));
  const blood = String(x.blood_type || "").toUpperCase().replace(/\s+/g, " ").trim();
  const bk = alnum(blood.replace(/\+/g, "POZ").replace(/-/g, "NEG"));
  return {
    name, identity_number: tcValid(tc) && at.includes(tc) ? tc : "",
    birth_date: bd,
    license_class: [...new Set(lic)].join(", "),
    blood_type: /^(0|A|B|AB)\s?RH\s?[+-]$/.test(blood) && (at.includes(alnum(blood)) || alnum(text.replace(/\+/g, "POZ").replace(/-/g, "NEG")).includes(bk)) ? blood.replace(/\s?RH\s?/, " Rh") : "",
  };
}
export function personUpdate(p, info) {
  const out = infoUpdate(p, info, ["identity_number", "birth_date", "license_class", "blood_type"]);
  // İsim: karttaki kısa ad (ör. "Soner") belgedeki tam adın içindeyse tamamlanır
  if (info.name && norm(info.name) !== norm(p.name) && nameMatches(p.name, info.name)) out.unshift({ k: "name", from: p.name || null, to: info.name, on: true });
  return out;
}

// ---- Şirket evrakı (vergi levhası, faaliyet belgesi, sicil gazetesi…) → şirket bilgileri ----
export const COMPANY_INFO_LABELS = { title: "Ticari ünvan", tax_no: "Vergi no", tax_office: "Vergi dairesi", mersis_no: "MERSİS no", trade_reg_no: "Ticaret sicil no", nace: "Faaliyet kodu (NACE)", address: "Adres" };
export function companyInfo(x, text) {
  const nt = ` ${norm(text)} `, at = alnum(text);
  const words = (v, max) => { const s = String(v || "").replace(/\s+/g, " ").trim(); return s.length >= 3 && nt.includes(` ${norm(s)} `) ? s.slice(0, max) : ""; };
  const digits = (v, re) => { const k = String(v || "").replace(/\D/g, ""); return re.test(k) && at.includes(k) ? k : ""; };
  const nace = String(x.nace || "").trim();
  return {
    title: words(x.company_title, 120), tax_no: digits(x.tax_no, /^\d{10,11}$/), tax_office: words(x.tax_office, 60),
    mersis_no: digits(x.mersis_no, /^\d{16}$/), trade_reg_no: digits(x.trade_reg_no, /^\d{3,10}$/),
    nace: /^\d{2}\.\d{2}(\.\d{2})?$/.test(nace) && String(text).includes(nace) ? nace : "", address: words(x.address, 200),
  };
}
// Düz alanlar: belgedeki değer karttakinden farklıysa (boş değilse) güncellenir
export function infoUpdate(cur, info, keys) {
  const out = [];
  for (const k of keys) {
    const to = info[k], from = cur?.[k];
    if (to == null || to === "" || norm(from) === norm(to)) continue;
    out.push({ k, from: from || null, to, on: true });
  }
  return out;
}

// Sesli not: Gemini'nin duyduğu metin mesaj gibi doğrulanır; çok uzun/boşsa alınmaz
export function heardText(plan) {
  const t = typeof plan?.heard_text === "string" ? plan.heard_text.replace(/<\/?mesaj>/gi, "").trim() : "";
  return t.slice(0, 2000);
}

export const DOCS_PROMPT = [
  "Fotoğraf bir DÖKÜM / KANTAR fişiyse \"tickets\" dizisine yaz: {\"photo\":fotoğraf sırası,\"ticket_no\",\"date\":YYYY-MM-DD,\"plate\",\"vehicle_id\",\"tonnage\":net ton,\"dump_site_id\",\"dump_site_name\",\"material\",\"customer_id\",\"site_id\"}. Fiş no, tarih, plaka ve tonajı fişte yazdığı gibi oku; yoksa null.",
  "Fotoğraf bir ARAÇ, PERSONEL veya ŞİRKET BELGESİYSE (muayene, sigorta, kasko, ehliyet, SRC, psikoteknik, kimlik, vergi levhası, faaliyet belgesi, sicil gazetesi…) \"documents\" dizisine yaz: {\"photo\",\"category\" (" + [...VEHICLE_DOCS, ...PERSONNEL_DOCS, ...COMPANY_DOCS].join(", ") + "),\"owner_id\" (araç ya da personel ID),\"doc_no\",\"date\":düzenleme YYYY-MM-DD,\"expiry_date\":bitiş/geçerlilik YYYY-MM-DD,\"plate\" (araç belgesindeki plaka, yazdığı gibi),\"vehicle_kind\" (belgedeki CİNSİ/SINIFI: Çekici, Yarı Römork, Römork, Kamyon, Kamyonet, Otomobil/Binek, İş Makinesi…),\"brand\" (MARKASI),\"model\" (TİPİ / ticari adı),\"model_year\" (MODEL YILI),\"chassis_no\" (ŞASİ NO),\"engine_no\" (MOTOR NO),\"color\" (RENGİ),\"fuel_type\" (YAKIT CİNSİ),\"km\" (muayenedeki KİLOMETRE)}. Araç bilgilerini kayıtlı araçlarda da doldur (kart güncellenir). Personel belgesinde ayrıca \"person_name\" (AD SOYAD, belgede yazdığı gibi),\"tc_no\",\"birth_date\" YYYY-MM-DD,\"license_class\" (ehliyet sınıfları, ör. \"B, C, CE\"),\"blood_type\" (ör. \"A Rh+\"); kişi kayıtlı değilse owner_id null bırak (yeni personel kartı açılır). Şirket belgesinde \"company_title\" (ünvan),\"tax_no\" (VKN/TCKN),\"tax_office\",\"mersis_no\",\"trade_reg_no\",\"nace\" (faaliyet kodu ör. 43.12.01),\"address\". Plaka kayıtlı araçlarda yoksa owner_id null bırak ama plate ve vehicle_kind'ı MUTLAKA doldur (yeni araç kartı açılır). Belge fişi gider değildir; expenses'e yazma.",
  "Ses kaydı varsa söylenenleri \"heard_text\" alanına AYNEN yaz (rakamları rakamla), sonra ses kaydını mesaj gibi işle; quote değerlerini heard_text'ten kopyala.",
].join("\n");

export function docsSchemaProps() {
  const NS = { type: ["string", "null"] }, NN = { type: ["number", "null"] }, NI = { type: ["integer", "null"] };
  return {
    tickets: { type: "array", items: { type: "object", properties: { photo: NI, ticket_no: NS, date: NS, plate: NS, vehicle_id: NS, tonnage: NN, dump_site_id: NS, dump_site_name: NS, material: NS, customer_id: NS, site_id: NS } } },
    documents: { type: "array", items: { type: "object", properties: { photo: NI, category: NS, owner_id: NS, doc_no: NS, date: NS, expiry_date: NS, plate: NS, vehicle_kind: NS, brand: NS, model: NS, model_year: NN, chassis_no: NS, engine_no: NS, color: NS, fuel_type: NS, km: NN, person_name: NS, tc_no: NS, birth_date: NS, license_class: NS, blood_type: NS, company_title: NS, tax_no: NS, tax_office: NS, mersis_no: NS, trade_reg_no: NS, nace: NS, address: NS } } },
    heard_text: NS,
  };
}

// ---- Malzeme türü (fiş ya da mesaj metninden): kum / mıcır / gravak / hafriyat / moloz / çöp / taş ----
const MATERIAL_RE = [["mıcır", /\bmi[cç]ir|\bmicir|\bmıcır|\bkirmata/i], ["kum", /\bkum\b|\bkumu\b|\bdere kumu|\bmm kum/i], ["gravak", /\bgravak|\bgrobeton|\bstabilize/i],
  ["taş", /\bocak ta[sş]|\bta[sş]\b/i], ["moloz", /\bmoloz/i], ["çöp", /\bc[oö]p\b|\bhurda/i], ["hafriyat", /\bhafriyat|\bharfiyat|\btoprak/i]];
export const MATERIAL_LABEL = { "mıcır": "Mıcır", kum: "Kum", gravak: "Gravak", "taş": "Ocak taşı", moloz: "Moloz", "çöp": "Çöp", hafriyat: "Hafriyat" };
export const MATERIAL_WORK_TYPE = { "mıcır": "Mıcır Nakliye", kum: "Kum Nakliye", gravak: "Gravak Nakliye", moloz: "Moloz Nakliye", "çöp": "Çöp Nakliye", hafriyat: "Hafriyat Nakliye" };
export function materialKind(text) {
  const t = String(text || "");
  for (const [k, re] of MATERIAL_RE) if (re.test(t) || re.test(foldTr(t))) return k;
  return null;
}

// ---- İş + fişi tek satır: aynı işe ait fiş (irsaliye/kantar/döküm) ayrı kart değil, işin içine girer ----
// Eşleşme: tek iş + tek fiş ya da aynı tarih ve aynı araç. Fiş no, tonaj, fotoğraf işe yazılır; tutmayan bilgi uyarı olur.
export function mergeTicketsIntoWorks(v, { photoCount = 0, d = null, message = null } = {}) {
  // Mesajda hiç tarih / gün ifadesi yoksa işin tarihi tahmindir (Gemini bugünü yazmış olabilir)
  const noDateInMsg = message != null && !datesInText(message).size && !/(?<!\p{L})(dün|dun|bugün|bugun|evvelsi|önceki gün|pazartesi|salı|sali|çarşamba|carsamba|perşembe|persembe|cuma|cumartesi|pazar|sabah|akşam|aksam|\d{1,2}\s*(ocak|şubat|subat|mart|nisan|mayıs|mayis|haziran|temmuz|ağustos|agustos|eylül|eylul|ekim|kasım|kasim|aralık|aralik))(?!\p{L})/iu.test(message);
  if (noDateInMsg) for (const w of v.works || []) w.dateUnsure = true;
  const works = v.works || [];
  if (!works.length) return v;
  // Aynı plaka iki ayrı kartta olabilir (ör. "34GAM627" adlı kart + plakası 34 GAM 627 olan "Bayram Tır"): kart değil plaka karşılaştırılır
  const pk = (id) => {
    const x = d ? (d.vehicles || []).find((r) => r.id === id) : null;
    return x ? String(x.plate || x.name || "").toUpperCase().replace(/[^A-Z0-9]/g, "") : id;
  };
  const sameVeh = (a, b) => !a || !b || a === b || (pk(a).length >= 5 && pk(a) === pk(b));
  // Mesajda tarih yoksa iş tarihi tahmindir: fişin tarihi geçerli
  // Fişin tarihi okunamadıysa (bugün yazıldıysa) tarih karşılaştırması yapılmaz ve işe tarih aktarılmaz
  const tDate = (t) => (t.dateRead === false ? null : t.date);
  const sameDay = (w, t) => !tDate(t) || w.date === tDate(t) || w.dateUnsure;
  const keep = [];
  for (const t of v.tickets || []) {
    let cands = works.filter((w) => sameVeh(w.vehicle_id, t.vehicle_id) && sameDay(w, t));
    if (cands.length > 1) { const exact = cands.filter((w) => w.date === t.date); if (exact.length === 1) cands = exact; }
    if (!cands.length && !t.date && works.length === 1 && (v.tickets || []).length === 1) cands = works;
    if (cands.length !== 1 || t.dup) { keep.push(t); continue; }
    const w = cands[0];
    w.photos = [...new Set([...(w.photos || []), t.photo].filter((x) => x != null))];
    if (t.ticket_no && !w.slip_no) w.slip_no = t.ticket_no;
    if (t.tonnage) w.tonnage = Math.round(((w.tonnage || 0) + t.tonnage) * 100) / 100;
    if (t.dump_site_id && !w.dump_site_id && !w.new_dump_site) w.dump_site_id = t.dump_site_id;
    // Malzeme: fişte yazan malzeme işte yoksa yazılır; işle çelişiyorsa uyarı (mesaj "kum", fiş "mıcır")
    const mk = materialKind(t.material), wk = materialKind([w.material, w.work_type].join(" "));
    if (mk && !w.material) w.material = t.material;
    if (mk && wk && mk !== wk) w.issues.push(`Fişte malzeme "${t.material}", işte "${w.material || w.work_type}" — kontrol edin`);
    if (mk && !w.work_type && MATERIAL_WORK_TYPE[mk]) w.work_type = MATERIAL_WORK_TYPE[mk];
    if (t.vehicle_id && w.vehicle_id && t.vehicle_id !== w.vehicle_id)
      w.issues.push(sameVeh(t.vehicle_id, w.vehicle_id) ? "Aynı plaka iki ayrı araç kartında kayıtlı — Ayarlar → Kartları birleştir → Araç ile birleştirin" : "Fişteki plaka işteki araçla aynı değil — kontrol edin");
    if (tDate(t) && w.date !== tDate(t)) {
      if (w.dateUnsure) w.date = tDate(t);
      else w.issues.push(`Fiş tarihi ${tDate(t).split("-").reverse().join(".")}, iş tarihi farklı`);
    }
    // Fiş, mesajda yazmayan tarihi ve aracı teyit eder (fişteki plaka / tarih okunmuş ve doğrulanmış)
    if (w.dateUnsure && tDate(t) && w.date === tDate(t)) {
      w.dateUnsure = false;
      w.issues = w.issues.filter((x) => !/İş tarihi mesajda yazmıyor/.test(x));
      w.issues.push(`Tarih fişten alındı (${tDate(t).split("-").reverse().join(".")})`);
    }
    if (w.vehicleGuess && t.vehicle_id && sameVeh(w.vehicle_id, t.vehicle_id)) {
      w.vehicleGuess = false;
      w.issues = w.issues.filter((x) => !/^Araç ".*" mesajda yazmıyor/.test(x));
    }
    if ("ok" in w)
      w.ok = !!((w.customer_id || w.new_customer) && w.vehicle_id && w.work_type && w.unit && w.quantity && !w.guessed && !w.hinted && !w.badQuote && !w.ambiguous && !w.badNew && !w.vehicleGuess && !w.dateUnsure && !w.customerGuess);
    if (w.unit === "Ton" && t.tonnage && Math.abs((Number(w.quantity) || 0) - w.tonnage) > 0.05) w.issues.push(`Fişte ${w.tonnage} ton yazıyor, işte ${w.quantity} ton`);
    w.merged_ticket = true;
  }
  v.tickets = keep;
  // Başka bir yere bağlanmamış fotoğraf ve tek iş varsa: fotoğraf o işin fişidir
  const used = new Set([...(v.tickets || []).map((t) => t.photo), ...(v.docs || []).map((x) => x.photo), ...(v.expenses || []).map((e) => e.photo), ...(v.fuel || []).map((f) => f.photo), ...works.flatMap((w) => w.photos || []), ...works.map((w) => w.digital?.sigPhoto), ...(v.maintenance || []).flatMap((m) => m.photos || [])].filter((x) => x != null));
  if (works.length === 1)
    for (let i = 0; i < photoCount; i++) if (!used.has(i)) works[0].photos = [...(works[0].photos || []), i];
  return v;
}
