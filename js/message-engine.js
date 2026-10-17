// Evidence-led local parser. Raw UTF-16 offsets, explicit uncertainty, no writes.
import { normKey, todayStr } from "./core.js";
import {
  parseWhatsApp,
  buildAliasIndex,
  foldTr,
  detectWorkType,
  refineWorkType,
} from "./parser.js";
const live = (d, s) => (d[s] || []).filter((x) => !x.deleted_at);
export const ENGINE_VERSION = "sahapro-parse/4";
// Bu kaynaklarla gelen eşleşme forma otomatik yazılmaz; kullanıcı seçer.
const NO_FILL = new Set(["spelling_candidate", "ascii_fold", "context_candidate"]);
const fillable = (c) => !NO_FILL.has(c.via);
const numbers = {
  bir: 1,
  biri: 1,
  birisi: 1,
  iki: 2,
  ikisi: 2,
  üç: 3,
  üçü: 3,
  dört: 4,
  dördü: 4,
  beş: 5,
  beşi: 5,
  altı: 6,
  altısı: 6,
  yedi: 7,
  yedisi: 7,
  sekiz: 8,
  dokuz: 9,
  on: 10,
};
const units = {
  l: "L",
  sefer: "Sefer",
  saat: "Saat",
  yevmiye: "Yevmiye",
  yovmiye: "Yevmiye",
  yovmiye: "Yevmiye",
  ton: "Ton",
  m3: "m³",
  "m³": "m³",
  adet: "Adet",
  litre: "L",
  litreyi: "L",
  lt: "L",
};
const clean = (s) =>
  String(s || "")
    .toLocaleLowerCase("tr-TR")
    .replace(/[’‘]/g, "'");
const code = (s) => s.toLocaleUpperCase("tr-TR").replace(/\s+/g, "");
function quantityWord(s) {
  s = clean(s);
  if (s === "yarım" || s === "yarim") return 0.5;
  const half = s.match(/^(\d+|\p{L}+)\s+buçuk$/u);
  if (half) {
    const b = quantityWord(half[1]);
    return b === null ? null : b + 0.5;
  }
  if (Object.hasOwn(numbers, s)) return numbers[s];
  if (/^\d+(?:si|sı|su|sü|i|ı|u|ü)?$/.test(s))
    return Number(s.match(/^\d+/)[0]);
  if (/^\d+[.,]\d+$/.test(s)) return Number(s.replace(",", "."));
  return null;
}
function amount(s) {
  s = s.trim();
  if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
  else if (/^\d{1,3}(?:\.\d{3})+$/.test(s)) s = s.replace(/\./g, "");
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}
export function tokenize(raw) {
  raw = String(raw);
  const out = [];
  let at = 0;
  const patterns = [
    ["time_range", /^(\d{1,2}[.:]\d{2})\s*[–—-]\s*(\d{1,2}[.:]\d{2})/],
    ["time_range", /^(?:[01]?\d|2[0-3])\s*[–—-]\s*(?:[01]?\d|2[0-4])(?=\s*(?:arası|arasi|arasında|arasinda)(?![\p{L}]))/u],
    ["date", /^(?:\d{4}-\d{2}-\d{2}|\d{1,2}[./]\d{1,2}[./]\d{2,4}|(?:0?[1-9]|[12]\d|3[01])\/(?:0?[1-9]|1[0-2]))(?![\d/])/],
    ["plate", /^\d{2}\s*[a-zçğıöşü]{1,3}\s*\d{2,4}(?!\w)/i],
    ["building", /^b\s*\d{2,4}(?!\w)/i],
    ["machine_code", /^(?:[a-zA-Z]{2,6}\d{2,6}|[A-Z]{2,6}\s+\d{2,6})(?![\w:]|[.,]\d)/],
    ["time", /^\d{1,2}:\d{2}(?!\d)/],
    ["number", /^\d+(?:[.,]\d+)*(?:si|sı|su|sü)?/i],
    ["word", /^[\p{L}]+(?:['’][\p{L}]+)?/u],
    ["punct", /^[^\s\p{L}\p{N}]/u],
  ];
  while (at < raw.length) {
    if (/\s/.test(raw[at])) {
      at++;
      continue;
    }
    let found = false;
    for (const [type, re] of patterns) {
      const m = re.exec(raw.slice(at));
      if (!m) continue;
      const value = m[0];
      out.push({
        type,
        raw: value,
        norm:
          type === "plate" || type === "machine_code"
            ? code(value)
            : clean(value),
        span: { start: at, end: at + value.length },
      });
      at += value.length;
      found = true;
      break;
    }
    if (!found) {
      const cp = String.fromCodePoint(raw.codePointAt(at));
      out.push({
        type: "unknown",
        raw: cp,
        norm: cp,
        span: { start: at, end: at + cp.length },
      });
      at += cp.length;
    }
  }
  return out;
}
function evidence(raw, start, end, via) {
  return { span: { start, end }, text: raw.slice(start, end), via };
}
export function segmentMessage(raw, tokens = tokenize(raw)) {
  const protectedAt = (i) =>
    tokens.some(
      (t) =>
        ["date", "time", "time_range", "number", "plate"].includes(t.type) &&
        t.span.start <= i &&
        i < t.span.end,
    );
  const spans = [];
  let start = 0;
  for (let i = 0; i < raw.length; i++)
    if ((/[;!?\n]/.test(raw[i]) || raw[i] === ".") && !protectedAt(i)) {
      let end = i;
      while (start < end && /\s/.test(raw[start])) start++;
      while (end > start && /\s/.test(raw[end - 1])) end--;
      if (end > start) spans.push({ start, end, text: raw.slice(start, end) });
      start = i + 1;
    }
  let end = raw.length;
  while (start < end && /\s/.test(raw[start])) start++;
  while (end > start && /\s/.test(raw[end - 1])) end--;
  if (end > start) spans.push({ start, end, text: raw.slice(start, end) });
  return spans;
}
export function intentOf(text) {
  const t = clean(text);
  if (
    /çalışmadı|calismadi|yapılmadı|yapilmadi|alınmadı|alinmadi|taşınmadı|tasinmadi|iptal/.test(
      t,
    ) &&
    !/ödeme|odeme|tahsil/.test(t)
  )
    return "correction";
  if (/yanlış|yanlis|düzelt|duzelt|\bdeğil\b|\bdegil\b/.test(t))
    return "correction";
  if (
    /(?:sefer|tur|saat|ton|adet)\s+daha|üstüne\s+ekle|ustune\s+ekle|dünkü\s+iş|dunku\s+is/.test(
      t,
    )
  )
    return "add_to_existing";
  if (
    /ödeme|odeme|ödendi|odendi|tahsil|havale|hesaba\s+geç|hesaba\s+gec|nakit\s+ald|parasını\s+ald/.test(
      t,
    )
  )
    return "payment_notice";
  if (/mazot|dizel|akaryakıt|akaryakit|\d\s*(?:litre|lt)\b/.test(t))
    return "fuel";
  if (
    /çöp|cop|moloz|hafriyat|kazı|kazi|dolgu|taşı|tasi|çalış|calis|yükle|yukle|indir|kaldır|kaldir|manitou|kato|jcb|vinç|vinc/.test(
      t,
    )
  )
    return "new_work";
  // Malzeme / makine sözcükleri (kelime sınırlı: "kumanda" iş sayılmaz)
  if (
    /(?<![\p{L}\p{N}])(?:yevmiye|yovmiye|kum|mıcır|micir|gravak|tesviye|yıkım|yikim|kırım|kirim|lowbed|lowbet)(?:lar|ler|da|de|dan|den|ı|i|u|ü|a|e)?(?![\p{L}\p{N}])/u.test(
      t,
    )
  )
    return "new_work";
  return "unknown";
}
function dateValue(value, header) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const short = value.match(/^(\d{1,2})\/(\d{1,2})$/);
  if (short) {
    const y = /^\d{4}/.test(header || "") ? header.slice(0, 4) : null;
    if (!y) return null;
    const dd = Number(short[1]), mm = Number(short[2]);
    if (!(dd >= 1 && dd <= new Date(Number(y), mm, 0).getDate())) return null;
    return `${y}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
  }
  const m = value.match(/(\d{1,2})[./](\d{1,2})[./](\d{2,4})/);
  if (!m) return null;
  return `${m[3].length === 2 ? "20" + m[3] : m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
}
function shiftDate(date, n) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || "")) return null;
  const x = new Date(date + "T12:00:00Z");
  if (!Number.isFinite(x.getTime())) return null;
  x.setUTCDate(x.getUTCDate() + n);
  return x.toISOString().slice(0, 10);
}
function dates(text, header) {
  const explicit = [
    ...text.matchAll(
      /\b(?:\d{4}-\d{2}-\d{2}|\d{1,2}[./]\d{1,2}[./]\d{2,4})\b|(?<![\d/.])(?:0?[1-9]|[12]\d|3[01])\/(?:0?[1-9]|1[0-2])(?![\d/])/g,
    ),
  ]
    .map((m) => dateValue(m[0], header))
    .filter(Boolean);
  const t = clean(text);
  let relative = null;
  const months = {
    ocak: 1,
    şubat: 2,
    mart: 3,
    nisan: 4,
    mayıs: 5,
    haziran: 6,
    temmuz: 7,
    ağustos: 8,
    eylül: 9,
    ekim: 10,
    kasım: 11,
    aralık: 12,
  };
  const named = t.match(
    /\b(\d{1,2})\s+(ocak|şubat|mart|nisan|mayıs|haziran|temmuz|ağustos|eylül|ekim|kasım|aralık)(?:\s+(20\d{2}))?/,
  );
  if (named && (named[3] || header))
    explicit.push(
      `${named[3] || header.slice(0, 4)}-${String(months[named[2]]).padStart(2, "0")}-${named[1].padStart(2, "0")}`,
    );

  if (/\bdün\b|\bdun\b|dünkü|dunku/.test(t)) relative = shiftDate(header, -1);
  else if (/bugün|bugun/.test(t)) relative = header;
  else if (/yarın|yarin/.test(t)) relative = shiftDate(header, 1);
  else {
    const m = t.match(
      /geçen\s+(pazartesi|salı|çarşamba|perşembe|cuma|cumartesi|pazar)/,
    );
    if (m && header) {
      const day = {
          pazar: 0,
          pazartesi: 1,
          salı: 2,
          çarşamba: 3,
          perşembe: 4,
          cuma: 5,
          cumartesi: 6,
        }[m[1]],
        at = new Date(header + "T12:00:00Z").getUTCDay();
      relative = shiftDate(header, -((at - day + 7) % 7 || 7));
    }
  }
  const bad = [...text.matchAll(/(?<![\d/.])\d{1,2}\/\d{1,2}(?![\d/.])/g)].some(
    (m) => !dateValue(m[0], header),
  );
  const unresolved =
    !explicit.length &&
    !relative &&
    (/(?:geçen|gecen|bu)\s+(?:hafta|ay)|önceki\s+gün|onceki\s+gun|birkaç\s+gün/.test(
      t,
    ) ||
      /(?<![\p{L}\p{N}])(?:pazartesi|salı|çarşamba|perşembe|cumartesi|cuma|pazar(?!\s*yeri))(?:\s+günü)?(?![\p{L}\p{N}])/u.test(
        t,
      ));
  return {
    value: unresolved ? null : explicit[0] || relative || header || null,
    conflict:
      new Set(explicit).size > 1 ||
      !!(explicit[0] && relative && explicit[0] !== relative),
    explicit: explicit.length > 0,
    relative: !!relative,
    bad,
  };
}
// "seferrr", "sefeer" gibi uzatmaları "sefer"e indirger
function collapseUnit(u) {
  return /^s+e+f+e+r+$/.test(u) ? "sefer" : u;
}
function nearQuantities(text, offset = 0, mola = []) {
  const out = [],
    re =
      /(?<![\p{L}\p{N}])((?:\d+|bir|iki|üç|dört|beş|altı|yedi|sekiz|dokuz|on)\s+buçuk|yarım|\d+(?:[.,]\d+)?|bir|iki|üç|dört|beş|altı|yedi|sekiz|dokuz|on)\s*(?:tane\s*)?(s+e+f+e+r+|saat|yevmiye|yovmiye|ton|m3|m³|adet|litre|lt|l|kamyonet|kamyon|tır|tir)(?![\p{L}])/giu;
  let m;
  while ((m = re.exec(text))) {
    const before = clean(text.slice(Math.max(0, m.index - 25), m.index));
    if (/(?:fiyat|ücret|ucret|kdv)\s*[:=]?\s*$/.test(before)) continue;
    // "mola 1 saat": mola süresi iş miktarı değildir (aşağıda mola olarak ayrıca okunur)
    if (/mola\s*(?:süresi|suresi)?\s*[:=-]?\s*$/.test(before)) {
      mola.push({ value: quantityWord(m[1]), unit: units[collapseUnit(clean(m[2]))] || "Sefer", span: { start: offset + m.index, end: offset + m.index + m[0].length } });
      continue;
    }
    // Plakanın sayı kuyruğu ("34 ABC 123 sefer") miktar değildir.
    if (
      /^\d{2,4}$/.test(m[1]) &&
      /(?<![\p{L}\p{N}])\d{2}\s*(?!ton\b|tır\b|tir\b|sa\b|lt\b|adet\b)[a-zçğıöşü]{1,3}\s*$/iu.test(
        text.slice(0, m.index),
      )
    )
      continue;
    const v = quantityWord(m[1]);
    if (v !== null)
      out.push({
        value: v,
        unit: units[collapseUnit(clean(m[2]))] || "Sefer",
        vehicleCount:
          !/^(?:s+e+f+e+r+|saat|yevmiye|yovmiye|ton|m3|m³|adet|litre|lt|l)$/i.test(m[2]),
        span: { start: offset + m.index, end: offset + m.index + m[0].length },
      });
  }
  // Birim önde: "sefer 6", "yevmiye: 1" ("saat 8" saat dilimi olabileceğinden hariç)
  const rev =
    /(?<![\p{L}\p{N}])(s+e+f+e+r+|yevmiye|yovmiye|ton)\s*[:=-]?\s*(\d+(?:[.,]\d+)?)(?![\p{L}\p{N}.,:])/giu;
  let r;
  while ((r = rev.exec(text))) {
    const s0 = offset + r.index,
      e0 = offset + r.index + r[0].length;
    if (out.some((o) => o.span.start < e0 && s0 < o.span.end)) continue;
    const v = quantityWord(r[2]);
    if (v !== null)
      out.push({
        value: v,
        unit: units[collapseUnit(clean(r[1]))] || "Sefer",
        vehicleCount: false,
        span: { start: s0, end: e0 },
      });
  }
  // "x3", "3x": araç/sefer adedi; birim onaylanır
  const times = /(?<![\p{L}\p{N}])(?:x\s*(\d{1,2})|(\d{1,2})\s*x)(?![\p{L}\p{N}])/giu;
  let x;
  while ((x = times.exec(text))) {
    const s0 = offset + x.index,
      e0 = offset + x.index + x[0].length;
    if (out.some((o) => o.span.start < e0 && s0 < o.span.end)) continue;
    out.push({
      value: Number(x[1] || x[2]),
      unit: "Sefer",
      vehicleCount: true,
      note: "\"" + x[0].trim() + "\" sefer olarak önerildi; onay gerekli",
      span: { start: s0, end: e0 },
    });
  }
  // "5 er sefer", "4'er sefer": her biri için miktar
  const each =
    /(?<![\p{L}\p{N}])(\d+|bir|iki|üç|dört|beş|altı|yedi|sekiz|dokuz|on)\s*(?:['’]\s*)?(?:er|ar|şer|şar)\s+(s+e+f+e+r+|saat|ton)(?![\p{L}])/giu;
  let e;
  while ((e = each.exec(text))) {
    const s0 = offset + e.index,
      e0 = offset + e.index + e[0].length;
    for (let i = out.length - 1; i >= 0; i--)
      if (out[i].span.start < e0 && s0 < out[i].span.end) out.splice(i, 1);
    const v = quantityWord(e[1]);
    if (v !== null)
      out.push({
        value: v,
        unit: units[collapseUnit(clean(e[2]))] || "Sefer",
        vehicleCount: false,
        each: true,
        span: { start: s0, end: e0 },
      });
  }
  // "tam gün" / "yarım gün": yevmiye olarak önerilir, onay gerekir
  const day = /(?<![\p{L}\p{N}])(tam|yarım|yarim)\s+gün(?:lük|lük)?(?![\p{L}])/giu;
  let dm;
  while ((dm = day.exec(text))) {
    const s0 = offset + dm.index,
      e0 = offset + dm.index + dm[0].length;
    if (out.some((o) => o.span.start < e0 && s0 < o.span.end)) continue;
    out.push({
      value: /^tam/i.test(dm[1]) ? 1 : 0.5,
      unit: "Yevmiye",
      vehicleCount: true,
      note: `"${dm[0]}" yevmiye olarak önerildi; onay gerekli`,
      span: { start: s0, end: e0 },
    });
  }
  out.sort((a, b) => a.span.start - b.span.start);
  return out;
}
function priceInfo(text, offset, raw) {
  const m =
    /(saat\s*(?:ücreti|ucreti|fiyatı|fiyati)|sefer(?:i|\s*(?:ücreti|ucreti|fiyatı|fiyati))|birim\s*(?:fiyatı|fiyati))\s*[:=]?\s*(\d+(?:[.,]\d+)*)/i.exec(
      text,
    );
  if (!m) return null;
  const tax =
    /(?:kdv\s*(?:oranı|orani)?\s*[:=]?\s*%?\s*(\d+(?:[.,]\d+)?)\s*%?|%\s*(\d+(?:[.,]\d+)?)\s*kdv)/i.exec(
      text,
    );
  return {
    value: amount(m[2]),
    unit: /^saat/i.test(m[1]) ? "Saat" : /^sefer/i.test(m[1]) ? "Sefer" : null,
    kdv_rate: tax ? amount(tax[1] || tax[2]) : null,
    kdv_included: /kdv\s*dahil/i.test(text)
      ? true
      : /kdv\s*(?:hariç|haric)/i.test(text)
        ? false
        : null,
    evidence: evidence(
      raw,
      offset + m.index,
      offset + m.index + m[0].length,
      "explicit_unit_price",
    ),
  };
}
function normalForm(text) {
  return clean(text).replace(/[^\p{L}\p{N}]/gu, "");
}
function editDistance(a, b) {
  if (Math.abs(a.length - b.length) > 3) return 99;
  let prior = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const next = [i];
    for (let j = 1; j <= b.length; j++)
      next[j] = Math.min(
        next[j - 1] + 1,
        prior[j] + 1,
        prior[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    prior = next;
  }
  return prior[b.length];
}
function phraseMatch(text, phrase, fold = false) {
  if (!String(phrase).trim()) return null;
  const prep = fold ? foldTr : clean;
  if (fold && foldTr(text).length !== String(text).length) return null;
  const pattern = prep(phrase)
    .trim()
    .split(/\s+/)
    .map((x) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("\\s+");
  const re = new RegExp(
    "(?<![\\p{L}\\p{N}])" + pattern + "(?![\\p{L}\\p{N}])",
    "u",
  );
  return re.exec(prep(text));
}
export function cardCandidates(text, store, d, tokens = tokenize(text)) {
  const cards = live(d, store),
    type = {
      vehicles: "vehicle",
      customers: "customer",
      sites: "site",
      personnel: "personnel",
      dump_sites: "dump_site",
    }[store],
    out = [];
  const add = (r, via, ev) => {
    if (
      store === "vehicles" &&
      tokens.some(
        (t) =>
          t.type === "building" &&
          t.span.start <= ev.span.start &&
          t.span.end >= ev.span.end,
      )
    )
      return;
    if (!out.some((x) => x.id === r.id))
      out.push({ id: r.id, name: r.name, via, evidence: ev });
  };
  for (const alias of live(d, "aliases").filter(
    (a) => a.active !== false && a.target_type === type && a.alias,
  )) {
    const match = phraseMatch(text, alias.alias),
      i = match?.index ?? -1;
    if (i >= 0) {
      const r = cards.find((c) => c.id === alias.target_id);
      if (r) add(r, "alias", evidence(text, i, i + match[0].length, "alias"));
    }
  }
  for (const r of cards) {
    const match = phraseMatch(text, r.name || ""),
      i = match?.index ?? -1;
    if (i >= 0 && r.name?.length >= 3)
      add(
        r,
        "exact_name",
        evidence(text, i, i + match[0].length, "exact_name"),
      );
    if (store === "vehicles")
      for (const t of tokens.filter((t) =>
        ["plate", "machine_code"].includes(t.type),
      )) {
        if (t.type === "plate" && normalForm(r.name) === normalForm(t.raw))
          add(r, "plate", evidence(text, t.span.start, t.span.end, "plate"));
        if (
          t.type === "machine_code" &&
          normalForm(r.name).includes(normalForm(t.raw))
        )
          add(
            r,
            "machine_code",
            evidence(text, t.span.start, t.span.end, "machine_code"),
          );
      }
  }
  // Türkçe/ASCII yazım farkı (Gumus Yapi = Gümüş Yapı): görünür aday, otomatik doldurma yok.
  for (const alias of live(d, "aliases").filter(
    (a) => a.active !== false && a.target_type === type && a.alias,
  )) {
    const match = phraseMatch(text, alias.alias, true);
    if (match && String(alias.alias).length >= 4) {
      const r = cards.find((c) => c.id === alias.target_id);
      if (r)
        add(r, "ascii_fold", evidence(text, match.index, match.index + match[0].length, "ascii_fold"));
    }
  }
  for (const r of cards) {
    const match = phraseMatch(text, r.name || "", true);
    if (match && String(r.name || "").length >= 4)
      add(r, "ascii_fold", evidence(text, match.index, match.index + match[0].length, "ascii_fold"));
  }
  if (out.length) return out.slice(0, 5);
  // Araç adının ilk sözcüğü ("Manitou" → "Manitou MTX1840"): yalnızca tek kartta geçiyorsa.
  if (store === "vehicles")
    for (const t of tokens.filter((t) => t.type === "word")) {
      const w = clean(t.raw);
      if (w.length < 4) continue;
      const hit = cards.filter((r) => clean(r.name || "").split(/\s+/)[0] === w);
      if (hit.length === 1)
        add(hit[0], "first_word", evidence(text, t.span.start, t.span.end, "first_word"));
    }
  if (out.length) return out.slice(0, 5);
  if (out.length) return out.slice(0, 5);
  // Numeric identifiers are never fuzzy matched. Word suggestions require an explicit choice.
  for (const t of tokens.filter(
    (t) => t.type === "word" && normalForm(t.raw).length >= 5,
  )) {
    const q = normalForm(t.raw.split(/['’]/)[0]);
    for (const r of cards) {
      const name = clean(r.name || "")
        .split(/\s+/)
        .map(normalForm);
      if (
        name.some(
          (n) => n.length >= 5 && editDistance(q, n) <= (q.length >= 9 ? 2 : 1),
        )
      )
        add(
          r,
          "spelling_candidate",
          evidence(text, t.span.start, t.span.end, "spelling_candidate"),
        );
    }
  }
  return out.slice(0, 3);
}
function dumpDistribution(raw, headerQty, d) {
  if (!headerQty || headerQty.unit !== "Sefer") return null;
  const rest = raw.slice(headerQty.span.end);
  const hasPlace = live(d, "dump_sites").some((s) =>
      clean(rest).includes(clean(s.name || "")),
    ),
    looksLikeDistribution = /(?:(?<!\d):|\n)\s*(?:\d+|biri|ikisi)\s+[\p{L}]/u.test(rest);
  if (
    !hasPlace &&
    (!looksLikeDistribution || nearQuantities(rest).some((q) => q.unit !== "L"))
  )
    return null;
  const split = rest.search(/(?<!\d):|\n/);
  if (split < 0 && !/,/.test(rest)) return null;
  const begin = headerQty.span.end + (split >= 0 ? split + 1 : 0),
    tail = raw.slice(begin),
    parts = [];
  const re =
    /(\d+(?:si|sı)?|biri|birisi|bir|ikisi|iki|üç|dört|beş|sonuncu|sonuncusu)\s+([^,;\n.]+)/giu;
  let m;
  while ((m = re.exec(tail))) {
    const q = quantityWord(m[1]),
      candidates = cardCandidates(m[2], "dump_sites", d),
      implicit = /sonuncu/i.test(m[1]);
    parts.push({
      quantity: q,
      dump_site_id:
        candidates.length === 1 && fillable(candidates[0])
          ? candidates[0].id
          : null,
      candidates,
      implicit,
      evidence: evidence(
        raw,
        begin + m.index,
        begin + m.index + m[0].length,
        "dump_distribution",
      ),
    });
  }
  if (parts.length < 1) return null;
  const headerType = parseWhatsApp(raw, {
    vehicles: [],
    customers: [],
    sites: [],
    personnel: [],
    aliasIdx: [],
    defaultDate: null,
  })[0]?.work_type;
  for (const part of parts) {
    const place = part.candidates[0]?.name;
    const fragment = place
      ? part.evidence.text.replace(place, "")
      : part.evidence.text;
    const otherType = parseWhatsApp(fragment, {
      vehicles: [],
      customers: [],
      sites: [],
      personnel: [],
      aliasIdx: [],
    })[0]?.work_type;
    if (otherType && headerType && otherType !== headerType)
      return {
        total: headerQty.value,
        listed: parts.reduce((n, p) => n + (p.quantity || 0), 0),
        parts,
        valid: false,
        reason:
          "Döküm dağılımında farklı iş türleri var; satırları ayrı doğrulayın",
      };
  }
  const sum = parts.reduce((n, p) => n + (p.quantity || 0), 0),
    ambiguous = parts.some(
      (p) => p.quantity === null || !p.dump_site_id || p.implicit,
    );
  return {
    total: headerQty.value,
    listed: sum,
    parts,
    valid: sum === headerQty.value && !ambiguous,
    reason:
      sum !== headerQty.value
        ? "Döküm dağılımı toplam seferle uyuşmuyor"
        : ambiguous
          ? "Döküm miktarı veya saha seçimi doğrulanmalı"
          : null,
  };
}
function targetCandidates(message, d, notices, cards) {
  if (
    !notices.some((n) => ["correction", "add_to_existing"].includes(n.type)) ||
    !message.date
  )
    return [];
  const start = shiftDate(message.date, -7),
    reference = dates(message.text, message.date),
    old = message.text.match(/(\d+)\s*(?:değil|degil)\s*(\d+)/i),
    vehicles = cards.vehicles
      .filter(fillable)
      .map((c) => c.id),
    customers = cards.customers
      .filter(fillable)
      .map((c) => c.id);
  return live(d, "work_records")
    .filter(
      (w) =>
        w.date >= start &&
        w.date <= message.date &&
        (!reference.relative || w.date === reference.value) &&
        (!vehicles.length || vehicles.includes(w.vehicle_id)) &&
        (!customers.length || customers.includes(w.customer_id)) &&
        (!old || Number(w.quantity) === Number(old[1])),
    )
    .sort((a, b) => String(b.date).localeCompare(String(a.date)))
    .slice(0, 5)
    .map((w) => ({
      id: w.id,
      date: w.date,
      quantity: w.quantity,
      unit: w.unit,
      customer:
        live(d, "customers").find((c) => c.id === w.customer_id)?.name ||
        "Müşteri",
      vehicle:
        live(d, "vehicles").find((v) => v.id === w.vehicle_id)?.name || "Araç",
      work_type: w.work_type,
      locked: !!w.price_snapshot?.locked,
    }));
}
export function analyzeMessage(message, d) {
  if (String(message.text || "").length > 20000)
    return {
      schemaVersion: ENGINE_VERSION,
      raw: String(message.text),
      tokens: [],
      intents: [],
      rows: [],
      distribution: null,
      targetCandidates: [],
      notices: [
        {
          type: "message_limit",
          blocking: true,
          text: "Bu mesaj çok uzun; daha küçük iş gruplarıyla ayrıştırın.",
          span: { start: 0, end: 100 },
        },
      ],
      blocking: true,
    };
  const raw = String(message.text || ""),
    tokens = tokenize(raw),
    segments = segmentMessage(raw, tokens),
    notices = [],
    works = [],
    fuels = [],
    intents = [],
    ctx = {
      vehicles: live(d, "vehicles"),
      customers: live(d, "customers"),
      sites: live(d, "sites"),
      personnel: [],
      defaultDate: message.date || todayStr(),
    };
  ctx.aliasIdx = buildAliasIndex(
    live(d, "aliases"),
    ctx.vehicles,
    ctx.customers,
    ctx.sites,
    live(d, "personnel"),
  );
  const wholeDate = dates(raw, message.date),
    globalCards = Object.fromEntries(
      ["vehicles", "customers", "sites", "personnel"].map((s) => [
        s,
        cardCandidates(raw, s, d, tokens),
      ]),
    );
  for (const segment of segments) {
    const type = intentOf(segment.text);
    if (["correction", "add_to_existing", "payment_notice"].includes(type))
      notices.push({
        type,
        blocking: type !== "payment_notice",
        text:
          type === "correction"
            ? "Düzeltme mesajı: hedef kayıt doğrulanmadan iş oluşturulmaz."
            : type === "add_to_existing"
              ? "Mevcut işe ekleme: hedef kayıt seçilmeden iş oluşturulmaz."
              : "Ödeme bildirimi ayrı tutuldu; iş fiyatı veya tahsilat oluşturulmadı.",
        span: { start: segment.start, end: segment.end },
      });
  }
  const headerQuant = nearQuantities(raw)[0],
    distribution = dumpDistribution(raw, headerQuant, d);

  const makeRow = (text, start, qty) => {
    const legacy = parseWhatsApp(text, ctx)[0] || {};
    delete legacy.confidence;
    delete legacy.kontrol_gerekli;
    const date = dates(text, message.date),
      candidates = {};
    for (const [field, store] of [
      ["vehicle_id", "vehicles"],
      ["customer_id", "customers"],
      ["site_id", "sites"],
      ["personnel_id", "personnel"],
    ]) {
      candidates[field] = cardCandidates(text, store, d);
      if (!candidates[field].length) {
        // Başlıktaki ortak bilgi satırlara geçer; başka satırın içinde geçen kart geçmez.
        const qs = nearQuantities(raw).filter((q) => q.unit !== "L"),
          first = qs[0];
        candidates[field] = globalCards[store].map((c) =>
          qs.length > 1 && first && c.evidence && c.evidence.span.start >= first.span.start
            ? { ...c, via: "context_candidate" }
            : c,
        );
      }
      // More than one explicit entity in a message is not inherited blindly across rows.
      legacy[field] =
        candidates[field].length === 1 && fillable(candidates[field][0])
          ? candidates[field][0].id
          : null;
    }
    if (qty?.unit === "Sefer" && legacy.work_type?.endsWith("Nakliye")) {
      const local = cardCandidates(text, "dump_sites", d),
        one = local.length
          ? local
          : nearQuantities(raw).length === 1
            ? cardCandidates(raw, "dump_sites", d)
            : [];
      if (one.length === 1 && fillable(one[0]))
        legacy.dump_site_id = one[0].id;
    }
    if (legacy.personnel_id) {
      const person = candidates.personnel_id[0],
        all = cardCandidates(raw, "personnel", d).find(
          (c) => c.id === person.id,
        ),
        at = all?.evidence?.span?.start ?? -1;
      if (
        at < 0 ||
        !/(?:operatör|operator|şoför|sofor|sürücü|surucu|personel)\s*[:=-]?\s*$/.test(
          clean(raw.slice(Math.max(0, at - 30), at)),
        )
      ) {
        legacy.personnel_id = null;
        candidates.personnel_id = candidates.personnel_id.map((c) => ({
          ...c,
          via: "role_candidate",
        }));
      }
    }
    if (legacy.customer_id) {
      const candidate = candidates.customer_id[0],
        match = globalCards.customers.find((c) => c.id === candidate.id),
        at = match?.evidence?.span?.start ?? -1;
      if (
        at >= 0 &&
        /(?:operatör|operator|şoför|sofor|sürücü|surucu|personel)\s*[:=-]?\s*$/.test(
          clean(raw.slice(Math.max(0, at - 30), at)),
        )
      )
        legacy.customer_id = null;
    }
    if (legacy.site_id && !legacy.customer_id)
      legacy.customer_id =
        ctx.sites.find((s) => s.id === legacy.site_id)?.customer_id || null;
    let multiSite = false;
    if (legacy.customer_id && !legacy.site_id) {
      const own = ctx.sites.filter(
        (s) => s.customer_id === legacy.customer_id && s.active !== false,
      );
      if (own.length > 1) {
        multiSite = true;
        if (!candidates.site_id.length)
          candidates.site_id = own.slice(0, 5).map((s) => ({
            id: s.id,
            name: s.name,
            via: "context_candidate",
            evidence: null,
          }));
      }
    }
    const price = priceInfo(text, start, raw),
      p = price && (!price.unit || price.unit === qty?.unit) ? price : null;
    if (
      legacy.personnel_id &&
      legacy.customer_id &&
      normalForm(
        live(d, "personnel").find((p) => p.id === legacy.personnel_id)?.name,
      ) ===
        normalForm(ctx.customers.find((c) => c.id === legacy.customer_id)?.name)
    )
      legacy.personnel_id = null;
    const row = {
      ...legacy,
      kind: qty?.unit === "L" ? "fuel" : "work",
      date: date.explicit || date.relative ? date.value : wholeDate.value,
      quantity: qty?.unit === "L" ? null : (qty?.value ?? null),
      unit: qty?.unit === "L" ? null : (qty?.unit ?? null),
      fuel_liters: qty?.unit === "L" ? qty.value : null,
      fuel_source: /tanktan|depodan|depo\s*tank/i.test(text)
        ? "Depo Tankı"
        : /istasyon|petrolcü|petrolcu/i.test(text)
          ? "İstasyon"
          : null,
      description: text,
      unit_price: p?.value ?? null,
      kdv_rate: p?.kdv_rate ?? null,
      kdv_included: p?.kdv_included ?? null,
      candidates,
      evidence: {
        quantity: qty
          ? evidence(raw, qty.span.start, qty.span.end, "quantity_unit")
          : null,
        unit_price: p?.evidence || null,
      },
      field_sources: {},
      notes: [],
      inference_confirmed: !qty?.vehicleCount,
      engine_version: ENGINE_VERSION,
    };
    if (qty?.vehicleCount)
      row.notes.push(qty.note || "Araç adedi sefer olarak önerildi; onay gerekli");
    if (multiSite)
      row.notes.push("Müşterinin birden fazla şantiyesi var; mesajda şantiye yok, seçin");
    if (row.kind === "work") {
      const rf = refineWorkType(text, detectWorkType(text), row.unit);
      row.work_type = rf.type;
      if (rf.note) row.notes.push(rf.note);
    }
    for (const [field, label] of [
      ["customer_id", "Müşteri"],
      ["site_id", "Şantiye"],
      ["vehicle_id", "Araç"],
    ]) {
      const c = candidates[field].find((x) => x.via === "ascii_fold");
      if (c && !row[field])
        row.notes.push(label + " yazım farkıyla eşleşti (" + c.name + "); doğruysa adayı seçin");
    }
    if (date.bad || (wholeDate.bad && !date.explicit && !date.relative))
      row.notes.push("Mesajdaki tarih geçersiz görünüyor; gerçek tarihi seçin");
    if (
      date.conflict ||
      (wholeDate.conflict && !date.explicit && !date.relative)
    )
      row.notes.push("Metindeki tarihler çelişiyor; gerçek tarihi seçin");
    for (const [k, ev] of Object.entries(row.evidence))
      if (ev) row.field_sources[k] = "Kaynak: " + ev.text;
    if (price && !p)
      row.notes.push("Fiyat birimi iş birimiyle uyuşmuyor; fiyat uygulanmadı");
    return row;
  };
  if (distribution) {
    const type = parseWhatsApp(raw, ctx)[0]?.work_type;
    if (!distribution.valid)
      notices.push({
        type: "distribution_conflict",
        blocking: true,
        text:
          distribution.reason +
          ` (${distribution.listed}/${distribution.total}). Eksik sefer tamamlanmaz.`,
        span: { start: 0, end: raw.length },
      });
    else
      for (const part of distribution.parts) {
        const r = makeRow(raw, 0, {
          ...headerQuant,
          value: part.quantity,
          span: part.evidence.span,
        });
        r.dump_site_id = part.dump_site_id;
        r.work_type = type;
        r.evidence.dump_site = part.evidence;
        r.transport_group_key = "inbox-" + message.id;
        r.transport_total = distribution.total;
        works.push(r);
      }
  } else {
    for (const segment of segments) {
      let intent = intentOf(segment.text);
      intents.push({
        type: intent,
        span: { start: segment.start, end: segment.end },
      });
      if (["correction", "add_to_existing", "payment_notice"].includes(intent))
        continue;
      let quantities = nearQuantities(segment.text, segment.start).filter(
        (q) => !/^\s*mola/i.test(raw.slice(q.span.end)),
      );
      if (quantities.some((q) => q.each))
        quantities = quantities.filter((q) => q.each || !q.vehicleCount);
      if (!quantities.length) {
        const range = tokenize(segment.text).find(
          (t) => t.type === "time_range",
        );
        if (range) {
          const times = range.raw.match(/\d{1,2}(?:[.:]\d{2})?/g),
            minutes = (t) => {
              const [h, m = 0] = t.split(/[.:]/).map(Number);
              return h <= 24 && m < 60 ? h * 60 + m : null;
            },
            a = minutes(times[0]),
            b = minutes(times[1]);
          const molaBefore = [];
          nearQuantities(segment.text, segment.start, molaBefore);
          const br = [
            ...nearQuantities(segment.text, segment.start).filter((q) =>
              /^\s*mola/i.test(raw.slice(q.span.end)),
            ),
            ...molaBefore,
          ];
          const breakMinutes = br.reduce(
            (n, q) => n + (q.unit === "Saat" ? q.value * 60 : 0),
            0,
          );
          if (a !== null && b !== null) {
            const gross = (b - a + 1440) % 1440;
            if (gross > 0 && breakMinutes < gross) {
              const row = makeRow(segment.text, segment.start, {
                value: (gross - breakMinutes) / 60,
                unit: "Saat",
                span: {
                  start: segment.start + range.span.start,
                  end: segment.start + range.span.end,
                },
              });
              row.duration = {
                gross_minutes: gross,
                break_minutes: breakMinutes,
                net_minutes: gross - breakMinutes,
              };
              row.inference_confirmed = false;
              row.notes.push("Çalışma süresi ve mola hesabını onaylayın");
              works.push(row);
              continue;
            }
          }
          notices.push({
            type: "invalid_duration",
            blocking: true,
            text: "Saat aralığı veya mola tutarsız; çalışma süresi doğrulanmalı.",
            span: { start: segment.start, end: segment.end },
          });
          continue;
        }
        const last = [...works, ...fuels].at(-1),
          price = priceInfo(segment.text, segment.start, raw);
        if (
          price &&
          last &&
          last.kind === "work" &&
          (!price.unit || price.unit === last.unit)
        ) {
          last.unit_price = price.value;
          last.kdv_rate = price.kdv_rate;
          last.kdv_included = price.kdv_included;
          last.evidence.unit_price = price.evidence;
          last.field_sources.unit_price = "Kaynak: " + price.evidence.text;
          continue;
        }
        // Miktarsız, araçsız, müşteri/şantiye içeren son satır ("Firma F Eyüp moloz") liste için ortak bilgidir
        const sharedCtx =
          intent === "new_work" &&
          works.length > 0 &&
          !cardCandidates(segment.text, "vehicles", d).some(fillable) &&
          ["customers", "sites"].some((st) =>
            cardCandidates(segment.text, st, d).some(fillable),
          ) &&
          works.some((w) => !w.customer_id || !w.site_id || !w.work_type);
        if (sharedCtx) {
          const wt = detectWorkType(segment.text);
          for (const w of works) {
            for (const [field, store] of [
              ["customer_id", "customers"],
              ["site_id", "sites"],
            ]) {
              if (w[field]) continue;
              const cs = cardCandidates(segment.text, store, d).filter(fillable);
              if (cs.length)
                w.candidates[field] = cs.map((c) => ({ ...c, via: "context_candidate" }));
            }
            if (!w.work_type && wt) {
              w.work_type = refineWorkType(segment.text, wt, w.unit).type;
              w.inference_confirmed = false;
            }
            w.notes.push(
              `Son satır "${segment.text}" ortak bilgi sayıldı; müşteri/şantiye/iş türünü onaylayın`,
            );
          }
          continue;
        }
        if (intent === "new_work") {
          works.push(makeRow(segment.text, segment.start, null));
        } else if (intent === "fuel") {
          const r = makeRow(segment.text, segment.start, null);
          r.kind = "fuel";
          r.quantity = null;
          r.unit = null;
          fuels.push(r);
        } else if (
          /patla|bozul|arıza|ariza|tamir|lastik|yağ\s*değiş|yag\s*degis|filtre|servis|akü|aku|yedek\s*parça|yedek\s*parca/.test(
            clean(segment.text),
          )
        )
          notices.push({
            type: "expense_or_breakdown",
            blocking: false,
            text:
              "Gider/arıza bildirimi: iş satırına dönüştürülmedi. Gider veya Arıza ekranından girin: " +
              segment.text,
            span: { start: segment.start, end: segment.end },
          });
        else if (segment.text.trim())
          notices.push({
            type: "unknown",
            blocking: false,
            text: "Bu ifade iş satırına dönüştürülmedi: " + segment.text,
            span: { start: segment.start, end: segment.end },
          });
        continue;
      }
      // Araç/müşteri/şantiye kartı + miktar içeren satır, iş sözcüğü olmasa da yeni iştir
      // ("Öztürk Kağıthane 34 ABC 123 3 sefer"). Kartsız çıplak miktar devam mesajı olarak kalır.
      if (
        intent === "unknown" &&
        quantities.some((q) => q.unit !== "L") &&
        ["vehicles", "customers", "sites"].some((st) =>
          cardCandidates(segment.text, st, d).some(fillable),
        )
      )
        intent = "new_work";
      // Numeric/bare continuation with no preceding work is pending, never a complete new job.
      if (intent === "unknown" && !works.length && !fuels.length) {
        notices.push({
          type: "continuation",
          blocking: false,
          text: "Miktar devam mesajı: ilgili iş mesajıyla birleştirip doğrulayın.",
          span: { start: segment.start, end: segment.end },
        });
        continue;
      }
      // Satır sınırları: virgül / "ve" / "+" ile; yoksa, önceki satırda zaten bulunan türden
      // (plaka, şantiye, müşteri) yeni bir kart miktarın ardından geliyorsa o kart sonraki satıra aittir.
      const bounds = [];
      {
        let prevStart = segment.start;
        for (let i = 0; i < quantities.length; i++) {
          const q = quantities[i];
          if (i === 0) {
            bounds.push(segment.start);
            continue;
          }
          const a = quantities[i - 1],
            gap = raw.slice(a.span.end, q.span.start),
            m = [...gap.matchAll(/,|\sve\s|\s\+\s/gi)].at(-1);
          let at = m ? a.span.end + m.index + m[0].length : null;
          if (at === null) {
            const prefix = raw.slice(prevStart, a.span.start),
              hits = [];
            for (const st of ["vehicles", "sites", "customers"]) {
              if (!cardCandidates(prefix, st, d).some(fillable)) continue;
              for (const c of cardCandidates(gap, st, d))
                if (fillable(c) && c.evidence?.span)
                  hits.push(c.evidence.span.start);
            }
            at = hits.length ? a.span.end + Math.min(...hits) : q.span.start;
          }
          bounds.push(at);
          prevStart = at;
        }
      }
      for (let i = 0; i < quantities.length; i++) {
        const q = quantities[i];
        const start = bounds[i],
          end = quantities[i + 1] ? bounds[i + 1] : segment.end;
        const text = raw.slice(start, end),
          last = works.at(-1);
        if (
          intent === "unknown" &&
          last &&
          last.quantity == null &&
          q.unit !== "L"
        ) {
          last.quantity = q.value;
          last.unit = q.unit;
          last.evidence.quantity = evidence(
            raw,
            q.span.start,
            q.span.end,
            "continuation_quantity",
          );
          last.field_sources.quantity =
            "Kaynak: " + last.evidence.quantity.text;
          continue;
        }
        if (
          intent === "fuel" &&
          q.unit !== "L" &&
          !/çalış|calis|kazı|kazi|çöp|cop|moloz|indir|taşı|tasi/.test(
            clean(segment.text),
          )
        ) {
          notices.push({
            type: "non_fuel_quantity",
            blocking: false,
            text: "Yakıt mesajındaki ek miktar iş olarak oluşturulmadı; bağlamı doğrulayın.",
            span: q.span,
          });
          continue;
        }
        if (q.each) {
          const cars = [
            ...new Map(
              cardCandidates(segment.text, "vehicles", d)
                .filter(fillable)
                .map((c) => [c.id, c]),
            ).values(),
          ];
          if (cars.length >= 2) {
            for (const c of cars) {
              const rr = makeRow(segment.text, segment.start, { ...q, each: false });
              rr.vehicle_id = c.id;
              rr.candidates.vehicle_id = [c];
              rr.inference_confirmed = false;
              rr.notes.push(
                `"${raw.slice(q.span.start, q.span.end)}" her araç için ${q.value} ${q.unit.toLowerCase()} okundu; ${cars.length} araç için ayrı satır açıldı, onaylayın`,
              );
              works.push(rr);
            }
            continue;
          }
          const rr = makeRow(text, start, { ...q, each: false });
          const cnt = segment.text.match(
            /(\d+|iki|üç|dört|beş|altı)\s*(?:kamyonet|kamyon|tır|araç)(?![\p{L}])/iu,
          );
          const n = cnt ? quantityWord(cnt[1]) : null;
          rr.inference_confirmed = false;
          if (n) {
            rr.quantity = n * q.value;
            rr.notes.push(
              `${n} araç × ${q.value} = ${rr.quantity} ${q.unit.toLowerCase()} olarak hesaplandı; onaylayın`,
            );
          } else if (cars.length === 1) {
            rr.notes.push(
              `"${raw.slice(q.span.start, q.span.end)}" tek araç için ${q.value} ${q.unit.toLowerCase()} okundu; onaylayın`,
            );
          } else {
            rr.quantity = null;
            rr.unit = null;
            rr.notes.push(
              `"${raw.slice(q.span.start, q.span.end)}": kaç araç olduğu belli değil; toplam miktarı girin`,
            );
          }
          works.push(rr);
          continue;
        }
        const r = makeRow(text, start, q);
        const part = text.match(
          /(sabah|öğleden\s+sonra|öğle|akşam|gece)\s+(\d+(?:[.,]\d+)?)\s+(?:ve\s+)?(?:sabah|öğleden\s+sonra|öğle|akşam|gece)\s+(\d+(?:[.,]\d+)?)\s*(?:sefer|saat)/iu,
        );
        if (part && q.unit !== "L") {
          const a = quantityWord(part[2]),
            b = quantityWord(part[3]);
          if (a !== null && b !== null && b === q.value) {
            r.quantity = a + b;
            r.inference_confirmed = false;
            r.notes.push(
              `Parça parça yazılmış (${part[2]} + ${part[3]}); toplam ${a + b} olarak önerildi, onaylayın`,
            );
          }
        }
        if (q.unit === "L") fuels.push(r);
        else works.push(r);
      }
    }
  }
  if (/(?:^|\s)-\d+(?:[.,]\d+)?\s*(?:sefer|saat|ton|litre|lt)\b/i.test(raw))
    notices.push({
      type: "negative_quantity",
      blocking: true,
      text: "Negatif miktar doğrulanmalı; pozitif işe dönüştürülmedi.",
      span: { start: 0, end: raw.length },
    });
  if (notices.some((n) => n.blocking)) {
    works.length = 0;
    fuels.length = 0;
  }
  const rows = [...works, ...fuels].map((r, i) => ({
    ...r,
    source_row: i,
    source_message_id: message.id,
    include: true,
    duplicate_checked: false,
    notes: r.notes || [],
  }));
  return {
    schemaVersion: ENGINE_VERSION,
    raw,
    sourceBasis:
      message.raw && message.raw.includes(raw)
        ? "message_body"
        : "working_copy",
    tokens,
    intents,
    rows,
    notices,
    distribution,
    targetCandidates: targetCandidates(message, d, notices, globalCards),
    blocking: notices.some((n) => n.blocking),
  };
}
