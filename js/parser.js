// SAHAPRO SOLO — WhatsApp ayrıştırıcı + alias motoru + sesli taslak
// Kurallar: sahapro-whatsapp-parser / sahapro-domain skill'leri.
// Parser asla fiyat üretmez, bilinmeyeni uydurmaz, belirsizde kontrol_gerekli=true.

import { normKey, todayStr, addDays, WORK_TYPES } from "./core.js";

// ---- Alias motoru ----
export function buildAliasIndex(
  aliases,
  vehicles,
  customers,
  sites,
  personnel,
) {
  const idx = [];
  for (const a of (aliases || []).filter(
    (x) => x.active !== false && !x.deleted_at,
  )) {
    let name = null;
    if (a.target_type === "vehicle") {
      const v = vehicles.find((x) => x.id === a.target_id);
      name = v && v.name;
    }
    if (a.target_type === "customer") {
      const v = customers.find((x) => x.id === a.target_id);
      name = v && v.name;
    }
    if (a.target_type === "site") {
      const v = sites.find((x) => x.id === a.target_id);
      name = v && v.name;
    }
    if (a.target_type === "personnel") {
      const v = personnel.find((x) => x.id === a.target_id);
      name = v && v.name;
    }
    if (name)
      idx.push({
        alias: normKey(a.alias),
        target_type: a.target_type,
        target_id: a.target_id,
        name,
      });
  }
  idx.sort((a, b) => b.alias.length - a.alias.length);
  return idx;
}
export function applyAlias(text, aliasIdx, type) {
  const t = normKey(text);
  for (const a of aliasIdx) {
    if (type && a.target_type !== type) continue;
    if (t.includes(a.alias)) return a;
  }
  return null;
}

// İsim fuzzy eşleşme (liste kayıtlarına; uydurma YOK)
export function matchByName(text, rows) {
  const t = normKey(text);
  let best = null;
  for (const r of rows || []) {
    const n = normKey(r.name);
    if (n.length >= 3 && t.includes(n)) {
      if (!best || n.length > normKey(best.name).length) best = r;
    }
  }
  return best;
}

// ---- Türkçe / ASCII yazım katlama (uzunluk korunur; ofsetler bozulmaz) ----
const FOLD_MAP = { ç: "c", ğ: "g", ı: "i", ö: "o", ş: "s", ü: "u", â: "a", î: "i", û: "u" };
export function foldTr(s) {
  return String(s ?? "")
    .toLocaleLowerCase("tr-TR")
    .replace(/[’‘]/g, "'")
    .replace(/[çğıöşüâîû]/g, (c) => FOLD_MAP[c]);
}
// Kelime sınırı + yalnızca bilinen Türkçe ek listesi ("kumanda" kum sayılmaz, "kumda" sayılır)
const SUFFIX =
  "(?:lar|ler|ları|leri|nın|nin|nun|nün|dan|den|tan|ten|da|de|ta|te|ya|ye|yı|yi|yu|yü|la|le|ın|in|un|ün|sı|si|su|sü|ı|i|u|ü|a|e)?";
export function hasWord(text, key) {
  const k = String(key).trim().split(/\s+/).map((x) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("\\s+");
  return new RegExp("(?<![\\p{L}\\p{N}])" + k + SUFFIX + "(?![\\p{L}\\p{N}])", "iu").test(
    String(text).toLocaleLowerCase("tr-TR"),
  );
}

const TYPE_PATTERNS = [
  ["Hafriyat Nakliye", ["hafriyat"]],
  ["Moloz Nakliye", ["moloz"]],
  ["Çöp Nakliye", ["çöp", "cop"]],
  ["Mıcır Nakliye", ["mıcır", "micir"]],
  ["Kum Nakliye", ["kum"]],
  ["Gravak Nakliye", ["gravak"]],
  ["Kazı", ["kazı", "kazi"]],
  ["Yıkım", ["yıkım", "yikim"]],
  ["Kırım", ["kırım", "kirim"]],
  ["Tesviye", ["tesviye"]],
  ["Yükleme", ["yükleme", "yukleme"]],
  ["Mini Kato Çalışması", ["mini kato"]],
  ["JCB Çalışması", ["jcb"]],
  ["Manitou Çalışması", ["manitou"]],
  ["Vinç Çalışması", ["vinç", "vinc"]],
  ["Lowbed Nakliye", ["lowbed", "lowbet"]],
  ["Makine Çalışması", ["makine", "makina"]],
];
const MACHINE_TYPES = [
  ["Mini Kato Çalışması", ["mini kato"]],
  ["JCB Çalışması", ["jcb"]],
  ["Manitou Çalışması", ["manitou"]],
  ["Vinç Çalışması", ["vinç", "vinc"]],
];
const MATERIAL_NAKLIYE = ["Mıcır Nakliye", "Kum Nakliye", "Gravak Nakliye"];
// İlk eşleşen anahtar kelime (kelime sınırlı)
export function detectWorkType(text) {
  for (const [t, keys] of TYPE_PATTERNS) if (keys.some((k) => hasWord(text, k))) return t;
  return null;
}
// Makine + saatlik iş = makine çalışması; malzeme adı tek başına nakliye değildir.
export function refineWorkType(text, type, unit) {
  if (!type) return { type, note: null };
  const machine = MACHINE_TYPES.find(([, keys]) => keys.some((k) => hasWord(text, k)));
  if (machine && unit && unit !== "Sefer" && !String(type).startsWith(machine[0].split(" ")[0])) {
    if (type.endsWith("Nakliye") || type === "Yükleme" || type === "Makine Çalışması")
      return { type: machine[0], note: "İş türü makine saatine göre " + machine[0] + " önerildi; doğrulayın" };
  }
  if (MATERIAL_NAKLIYE.includes(type) && unit && !["Sefer", "Ton", "m³"].includes(unit))
    return { type: null, note: "Malzeme adı geçti ama taşıma (sefer/ton) belirtilmedi; iş türünü seçin" };
  return { type, note: null };
}
const UNIT_PATTERNS = [
  ["Sefer", ["sefer"]],
  ["Saat", ["saat", "sa"]],
  ["Yevmiye", ["yevmiye", "yovmiye", "yevmıye"]],
  ["Ton", ["ton"]],
  ["m³", ["m3", "m³", "metrekup"]],
  ["Adet", ["adet"]],
];
const PLATE_RE = /\b\d{2}\s?[A-ZÇĞİÖŞÜ]{1,3}\s?\d{2,4}\b/i;
const DATE_RE = /(\d{1,2})[.\/](\d{1,2})[.\/](\d{2,4})/;
const TIME_RE = /(\d{1,2}):(\d{2})/;
const WA_LINE =
  /^\[?(\d{1,2}:\d{2})(?:[,\s]+(\d{1,2}[.\/]\d{1,2}[.\/]\d{2,4}))?\]?\s*([^:]{2,25}):\s*(.+)$/;

export function parseWhatsApp(raw, ctx) {
  // ctx: { vehicles, customers, sites, personnel, aliasIdx, defaultDate }
  const out = [];
  const lines = String(raw || "")
    .split(/\n+/)
    .map((l) => l.trim())
    .filter(Boolean);
  for (const line of lines) {
    let date = ctx.defaultDate || todayStr();
    let sender = null;
    let text = line;
    const m = line.match(WA_LINE);
    if (m) {
      if (m[2]) date = normDate(m[2]) || date;
      sender = m[3].trim();
      text = m[4].trim();
    } else {
      const dm = line.match(DATE_RE);
      if (dm) {
        const nd = normDate(dm[0]);
        if (nd) date = nd;
      }
    }
    const low = normKey(text);
    if (/\bdün\b|\bdun\b/.test(low))
      date = addDays(ctx.defaultDate || todayStr(), -1);
    // "bugün" zaten default

    // Birden çok iş: "<n> <birim> <tür>" gruplarını ayrı satırlara böl
    const jobs = splitJobs(text);
    for (const job of jobs)
      out.push(parseJob(job, { ...ctx, date, sender, raw: line }));
  }
  return out;
}

function splitJobs(text) {
  // "3 sefer hafriyat 2 sefer moloz" → iki iş; aksi halde tek parça
  const re =
    /(\d+(?:[.,]\d+)?)\s*(sefer|saat|yevmiye|yovmiye|ton|m3|m³|adet)(?![a-zçğıöşü])/gi;
  const hits = [];
  let m;
  while ((m = re.exec(text)) !== null) hits.push(m.index);
  if (hits.length <= 1) return [text];
  const parts = [];
  for (let i = 0; i < hits.length; i++)
    parts.push(text.slice(hits[i], hits[i + 1] || text.length).trim());
  return parts.filter(Boolean);
}

function normDate(dstr) {
  const m = String(dstr).match(DATE_RE);
  if (!m) return null;
  let [, d, mo, y] = m;
  if (y.length === 2) y = "20" + y;
  const p = (x) => String(x).padStart(2, "0");
  return `${y}-${p(mo)}-${p(d)}`;
}

function parseJob(text, ctx) {
  const low = normKey(text);
  let kontrol = false;
  const notes = [];

  // Araç: alias → plaka → isim eşleşme
  let vehicle = null;
  const al = applyAlias(low, ctx.aliasIdx, "vehicle");
  if (al) vehicle = ctx.vehicles.find((v) => v.id === al.target_id) || null;
  if (!vehicle) {
    const pm = text.match(PLATE_RE);
    if (pm) {
      const plate = pm[0].replace(/\s/g, "").toLocaleUpperCase("tr-TR");
      vehicle =
        ctx.vehicles.find(
          (v) => normKey(v.name).replace(/\s/g, "") === normKey(plate),
        ) || null;
      if (!vehicle) {
        kontrol = true;
        notes.push("Plaka listede yok: " + pm[0]);
      }
    }
  }
  if (!vehicle) vehicle = matchByName(low, ctx.vehicles);
  if (
    !vehicle &&
    /(kato|makine|makina|kamyon|vinç|vinc|jcb|manitou|silindir)/.test(low)
  ) {
    kontrol = true;
    notes.push("Araç belirsiz");
  }

  // Personel: gönderen + metin
  let person = null;
  if (ctx.sender) person = matchByName(ctx.sender, ctx.personnel);
  if (!person) person = matchByName(low, ctx.personnel);

  // Müşteri / şantiye
  let customer = matchByName(low, ctx.customers);
  let site = matchByName(low, ctx.sites);
  const cal = applyAlias(low, ctx.aliasIdx, "customer");
  if (!customer && cal)
    customer = ctx.customers.find((c) => c.id === cal.target_id) || null;
  const sal = applyAlias(low, ctx.aliasIdx, "site");
  if (!site && sal)
    site = ctx.sites.find((s) => s.id === sal.target_id) || null;
  if (site && !customer && site.customer_id)
    customer = ctx.customers.find((c) => c.id === site.customer_id) || null;
  if (!customer) {
    kontrol = true;
    notes.push("Müşteri eşleşmedi");
  }

  // İş türü / birim / miktar
  let work_type = detectWorkType(low);
  let unit = null;
  for (const [u, keys] of UNIT_PATTERNS) {
    if (
      keys.some((k) =>
        new RegExp(`(^|[^a-z0-9çğıöşü])${k}($|[^a-zçğıöşü0-9])`, "i").test(low),
      )
    ) {
      unit = u;
      break;
    }
  }
  {
    const rf = refineWorkType(low, work_type, unit);
    if (rf.note) { notes.push(rf.note); kontrol = true; }
    work_type = rf.type;
  }
  let quantity = null;
  const qm = low.match(
    /(\d+(?:[.,]\d+)?)\s*(sefer|saat|yevmiye|yovmiye|ton|m3|m³|adet)(?![a-zçğıöşü])/i,
  );
  if (qm) quantity = Number(qm[1].replace(",", "."));
  // Vehicle-count wording denotes trips only for transport jobs, never machine hours.
  if (!unit && work_type?.endsWith("Nakliye")) {
    const trips = low.match(/(\d+)\s*(?:kamyonet|kamyon|tır|tir)(?=\s|$)/i);
    if (trips) { unit = "Sefer"; quantity = Number(trips[1]); notes.push("Araç adedi sefer olarak yorumlandı; doğrulayın"); kontrol = true; }
  }
  if (!unit) {
    kontrol = true;
    notes.push("Birim yok");
  }
  if (quantity == null && unit) {
    quantity = unit === "Yevmiye" ? 1 : null;
    kontrol = true;
    notes.push("Miktar belirsiz");
  }

  // Yardımcı alanlar
  let fuelLiters = null;
  const fm = low.match(/(\d+(?:[.,]\d+)?)\s*(?:lt|litre)\b/);
  if (fm) fuelLiters = Number(fm[1].replace(",", "."));
  let slip_status = null;
  if (/fiş var|fis var|fişi aldım/.test(low)) slip_status = "Fiş Var";
  if (/fiş yok|fis yok/.test(low)) slip_status = "Fiş Yok";
  let dump_area = null;
  const dm = low.match(/([a-zçğıöşü\s]+?)\s*döküm/);
  if (dm) dump_area = dm[1].trim().split(" ").pop();
  let quarry = null;
  const qz = low.match(/([a-zçğıöşü\s]+?)\s*ocağı|([a-zçğıöşü\s]+?)\s*ocagi/);
  if (qz) quarry = (qz[1] || qz[2] || "").trim().split(" ").pop();

  const score =
    100 -
    (kontrol ? 40 : 0) -
    (!vehicle ? 15 : 0) -
    (!work_type ? 15 : 0) -
    (!customer ? 20 : 0);
  return {
    date: ctx.date,
    personnel_id: person ? person.id : null,
    vehicle_id: vehicle ? vehicle.id : null,
    customer_id: customer ? customer.id : null,
    site_id: site ? site.id : null,
    work_type: work_type || null,
    quantity,
    unit,
    dump_area,
    quarry,
    slip_status,
    fuel_liters: fuelLiters,
    description: text,
    raw_message: ctx.raw,
    confidence: Math.max(10, score),
    kontrol_gerekli: kontrol || !customer || !vehicle,
    notes,
  };
}

// ---- Sesli taslak (Web Speech API — destek varsa) ----
export function voiceSupported() {
  return !!(globalThis.SpeechRecognition || globalThis.webkitSpeechRecognition);
}
export function startVoice(onText, onEnd) {
  const SR = globalThis.SpeechRecognition || globalThis.webkitSpeechRecognition;
  if (!SR) return null;
  const rec = new SR();
  rec.lang = "tr-TR";
  rec.interimResults = false;
  rec.maxAlternatives = 1;
  rec.onresult = (ev) => {
    const t =
      ev.results &&
      ev.results[0] &&
      ev.results[0][0] &&
      ev.results[0][0].transcript;
    if (t) onText(t);
  };
  rec.onend = () => onEnd && onEnd();
  rec.onerror = () => onEnd && onEnd();
  try {
    rec.start();
  } catch (e) {
    return null;
  }
  return rec;
}
export { WORK_TYPES };
