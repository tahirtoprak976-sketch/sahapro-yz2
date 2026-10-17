// İş kaydı ekranında fiş fotoğrafı (kantar / döküm / irsaliye / ocak fişi) → Gemini okur, telefon doğrular.
// SAF katman: istem, şablon ve doğrulama. Rakam, fiş no, tarih ve plaka fişin yazısında geçmeli; geçmeyen alan doldurulmaz.
import { isActive, todayStr, addDays } from "./core.js";
import { numbersInText } from "./ai-assist.js";
import { datesInText, materialKind, MATERIAL_WORK_TYPE, MATERIAL_LABEL } from "./assistant-docs.js";
import { foldTr } from "./parser.js";

const live = (d, s) => (d[s] || []).filter(isActive);
const norm = (s) => foldTr(s).replace(/[^\p{L}\p{N}]+/gu, " ").trim();
const alnum = (s) => foldTr(s).toUpperCase().replace(/[^A-Z0-9]/g, "");
const r2 = (n) => Math.round(n * 100) / 100;

export const SLIP_PROMPT = [
  "Fotoğraflar hafriyat/nakliye işine ait KANTAR, DÖKÜM, İRSALİYE veya OCAK fişleridir. Her fotoğraf için bir satır yaz.",
  "text: fişteki rakam, tarih, plaka, fiş no, firma, malzeme ve yer geçen satırları AYNEN yaz (sayı biçimini koru, en çok 800 karakter).",
  "net_ton: NET ağırlık ton cinsinden (fişte kg yazıyorsa 18.420 kg → 18.42). Net yoksa brüt − dara. Ağırlık yoksa null.",
  "gross, tare: brüt ve dara (fişte yazdığı birimde), yoksa null. unit_seen: fişte yazan ağırlık birimi ('kg' veya 'ton').",
  "slip_no, date (YYYY-MM-DD), plate, material (mıcır, kum, gravak, hafriyat…), from_place (yükleme/ocak yeri), to_place (boşaltma/döküm yeri), company (fişi kesen firma). Yazmıyorsa null. Uydurma.",
  'Yalnız JSON: {"slips":[{"photo":0,"text","net_ton","gross","tare","unit_seen","slip_no","date","plate","material","from_place","to_place","company"}]}',
].join("\n");

export function slipSchema() {
  const NS = { type: ["string", "null"] }, NN = { type: ["number", "null"] };
  return {
    type: "object",
    properties: {
      slips: { type: "array", items: { type: "object", properties: { photo: { type: ["integer", "null"] }, text: NS, net_ton: NN, gross: NN, tare: NN, unit_seen: NS, slip_no: NS, date: NS, plate: NS, material: NS, from_place: NS, to_place: NS, company: NS } } },
    },
  };
}

// Tek fişin değerleri: yalnız fiş yazısında doğrulananlar alınır
export function validateSlips(obj, { d, today = todayStr(), count = 0 } = {}) {
  const rows = [];
  const seenPhoto = new Set();
  for (const s of (Array.isArray(obj?.slips) ? obj.slips : []).slice(0, 20)) {
    const photo = Number.isInteger(s.photo) && s.photo >= 0 && s.photo < count ? s.photo : rows.length < count ? rows.length : null;
    if (photo == null || seenPhoto.has(photo)) continue;
    seenPhoto.add(photo);
    const text = String(s.text || "");
    const nums = numbersInText(text);
    const issues = [];
    const r = { photo, net_ton: null, slip_no: "", date: null, vehicle_id: null, plate: "", material: "", from_place: "", to_place: "", company: "", issues, text: text.slice(0, 800) };
    // Ton: fişte ton olarak ya da kg olarak (×1000) yazmalı; brüt − dara da kabul
    const n = Number(s.net_ton);
    if (Number.isFinite(n) && n > 0 && n < 100) {
      const t = r2(n), kg = Math.round(n * 1000);
      const g = Number(s.gross), ta = Number(s.tare);
      const fromGT = Number.isFinite(g) && Number.isFinite(ta) && nums.has(r2(g)) && nums.has(r2(ta)) && (Math.abs(r2(g - ta) - t) < 0.02 || Math.abs((g - ta) - kg) < 20);
      if (nums.has(t) || nums.has(kg) || fromGT) r.net_ton = t;
      else issues.push(`Ton ${t} fişte görünmüyor`);
    } else issues.push("Ağırlık okunamadı");
    const no = String(s.slip_no || "").trim();
    if (no && alnum(no).length >= 2 && alnum(text).includes(alnum(no))) r.slip_no = no.slice(0, 30);
    const dt = /^\d{4}-\d{2}-\d{2}$/.test(String(s.date || "")) ? s.date : null;
    if (dt && datesInText(text).has(dt) && dt <= addDays(today, 1)) r.date = dt;
    const plate = alnum(s.plate || "");
    if (plate.length >= 5 && alnum(text).includes(plate)) {
      r.plate = String(s.plate).toUpperCase();
      const v = live(d, "vehicles").find((x) => { const p = alnum(x.plate || x.name); return p.length >= 5 && p === plate; });
      if (v) r.vehicle_id = v.id;
    }
    const said = (x) => { const t = String(x || "").trim(); return t && (` ${norm(text)} `).includes(` ${norm(t).split(" ")[0]}`) ? t.slice(0, 60) : ""; };
    r.material = said(s.material);
    r.from_place = said(s.from_place);
    r.to_place = said(s.to_place);
    r.company = said(s.company);
    rows.push(r);
  }
  rows.sort((a, b) => a.photo - b.photo);
  const tons = rows.filter((r) => r.net_ton != null);
  return { rows, total_ton: r2(tons.reduce((a, r) => a + r.net_ton, 0)), read: tons.length, count };
}

// Okunan fişlerin forma uygulanacak değerleri (formda dolu alan ezilmez, yalnız boşlar doldurulur; ton/miktar hariç)
export function slipFill(res, form, { d, today = todayStr() } = {}) {
  const out = {};
  const first = (k) => res.rows.map((r) => r[k]).find(Boolean) || "";
  if (res.read) {
    out.tonnage = res.total_ton;
    if (form.unit === "Ton") out.quantity = res.total_ton;
    else if (form.unit === "Sefer" && !(Number(form.quantity) > 0)) out.quantity = res.count;
  }
  const nos = res.rows.map((r) => r.slip_no).filter(Boolean);
  if (nos.length && !form.slip_no) out.slip_no = nos.join(", ").slice(0, 120);
  if (res.rows.length) out.slip_status = "Fiş Var";
  const dates = [...new Set(res.rows.map((r) => r.date).filter(Boolean))];
  if (dates.length === 1 && (!form.date || form.date === today)) out.date = dates[0];
  const vids = [...new Set(res.rows.map((r) => r.vehicle_id).filter(Boolean))];
  if (vids.length === 1 && !form.vehicle_id) out.vehicle_id = vids[0];
  if (!form.material && first("material")) out.material = first("material");
  // İş türü boşsa ya da genel kaldıysa fişteki malzemeden: kum → Kum Nakliye, mıcır → Mıcır Nakliye
  const mk = materialKind(first("material") || res.rows.map((r) => r.text || "").join(" "));
  if (mk && MATERIAL_WORK_TYPE[mk] && (!form.work_type || form.work_type === "Hafriyat Nakliye" && mk !== "hafriyat")) {
    if (!form.work_type) out.work_type = MATERIAL_WORK_TYPE[mk];
    else out.material_hint = `Fişte "${MATERIAL_LABEL[mk]}" yazıyor; iş türü ${form.work_type} seçili — ${MATERIAL_WORK_TYPE[mk]} mi olmalı?`;
  }
  const match = (store, name) => {
    if (!name) return null;
    const n = norm(name);
    return live(d, store).find((x) => { const m = norm(x.name); return m && (n.includes(m) || m.includes(n.split(" ")[0])); }) || null;
  };
  if (!form.quarry_id) { const q = match("quarries", first("from_place")); if (q) out.quarry_id = q.id; else if (first("from_place") && !form.quarry) out.quarry = first("from_place"); }
  if (!form.dump_site_id) { const s = match("dump_sites", first("to_place")); if (s) out.dump_site_id = s.id; else if (first("to_place") && !form.dump_area) out.dump_area = first("to_place"); }
  return out;
}
