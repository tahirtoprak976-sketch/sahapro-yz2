// WhatsApp grubu toplu işleme — SAF katman. Grubun dışa aktarımı (.txt ya da medyalı .zip) mesajlara ayrılır,
// daha önce işlenenler atlanır, kalanlar gün gün (ve en çok 8 fotoğraflık parçalar halinde) asistana hazırlanır.
// Her gece aynı grubu yeniden dışa aktarmak yeter: yalnız yeni mesajlar gelir.

// Başlık: "15.10.2026 21:09 - Ali: ..." (Android) · "[15.10.2026 21:09:33] Ali: ..." (iPhone) · "15/10/2026, 21:09 - ..."
const HEAD = /^‎?\[?(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{2,4})[,\s]+(\d{1,2}[:.]\d{2})(?:[:.]\d{2})?\]?\s*(?:-\s*)?(.*)$/;
const ATTACH = [
  /(?:^|\s)‎?([\w.-]+\.(?:jpe?g|png|webp|heic|pdf|opus|ogg|m4a|mp3|aac|mp4))\s*\((?:dosya ekli|file attached)\)/gi,
  /‎?<(?:ekli|attached|eklendi):\s*([^>]+)>/gi,
];
const OMITTED = /<(?:medya dahil edilmedi|media omitted)>|(?:görüntü|resim|fotoğraf|video|ses|belge|çıkartma|sticker|image|video|audio|document) (?:dahil edilmedi|omitted)/i;
const DELETED = /^(?:bu mesaj silindi|this message was deleted|bu mesajı sildiniz|you deleted this message)\.?$/i;
const IMG = /\.(?:jpe?g|png|webp|heic)$/i, AUDIO = /\.(?:opus|ogg|m4a|mp3|aac)$/i, DOC = /\.pdf$/i;

const pad = (n) => String(n).padStart(2, "0");

export function parseChat(raw) {
  const text = String(raw || "").replace(/^﻿/, "");
  const out = [];
  let cur = null;
  const push = () => { if (cur) out.push(cur); cur = null; };
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(HEAD);
    if (m) {
      push();
      let d = Number(m[1]), mo = Number(m[2]);
      if (mo > 12 && d <= 12) [d, mo] = [mo, d]; // ay/gün sırası (İngilizce telefon)
      const y = m[3].length === 2 ? "20" + m[3] : m[3];
      const rest = m[5];
      const c = rest.indexOf(": ");
      // İki nokta yoksa sistem mesajı (gruba katıldı, şifreleme bildirimi…)
      if (c < 0 || c > 60) { cur = null; continue; }
      cur = { date: `${y}-${pad(mo)}-${pad(d)}`, time: m[4].replace(".", ":").padStart(5, "0"), sender: rest.slice(0, c).replace(/^‎|‎/g, "").trim(), text: rest.slice(c + 2) };
    } else if (cur) cur.text += "\n" + line;
  }
  push();
  return out.map((x) => {
    const files = [];
    let t = x.text;
    for (const re of ATTACH) t = t.replace(re, (_, f) => { files.push(f.trim()); return " "; });
    const omitted = OMITTED.test(t);
    t = t.replace(OMITTED, " ").replace(/‎/g, "").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
    if (DELETED.test(t)) t = "";
    return { ...x, text: t, files, omitted, key: [x.date, x.time, x.sender, t.slice(0, 200), files.join(",")].join("|") };
  }).filter((x) => x.text || x.files.length || x.omitted);
}

// İş bilgisi taşımayan kısa sohbet ("tamam", "👍", "ok abi") — dosyasız ve harf/rakam az
export function isChatter(m) {
  if (m.files.length || m.omitted) return false;
  const t = m.text.toLocaleLowerCase("tr-TR");
  if (/\d/.test(t)) return false;
  const letters = t.replace(/[^\p{L}]/gu, "");
  return letters.length <= 3 || /^(tamam|tamamdır|ok|okey|eyvallah|sağol|sağolun|teşekkürler|günaydın|iyi akşamlar|hayırlı işler|kolay gelsin|selam|selamünaleyküm|aleykümselam|evet|hayır|olur|peki|anladım)[\s.!👍🙏]*$/u.test(t);
}

// Günlere ayır, işlenmişleri ve boş sohbeti at; her gün en çok maxPhotos fotoğraf / maxChars karakterlik parçalar
export function planDays(msgs, { done = {}, from = "", maxPhotos = 8, maxChars = 7000 } = {}) {
  const days = new Map();
  let skippedDone = 0, skippedChatter = 0;
  for (const m of msgs) {
    if (from && m.date < from) continue;
    if (done[m.key]) { skippedDone++; continue; }
    if (isChatter(m)) { skippedChatter++; continue; }
    if (!days.has(m.date)) days.set(m.date, []);
    days.get(m.date).push(m);
  }
  const plan = [];
  for (const [date, list] of [...days.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const parts = [];
    let part = null;
    for (const m of list) {
      const media = m.files.filter((f) => IMG.test(f) || AUDIO.test(f) || DOC.test(f)).length;
      const line = formatLine(m);
      if (!part || part.media + media > maxPhotos || part.chars + line.length > maxChars) { part = { msgs: [], media: 0, chars: 0 }; parts.push(part); }
      part.msgs.push(m); part.media += media; part.chars += line.length + 1;
    }
    parts.forEach((p, i) => plan.push({ id: `${date}#${i + 1}`, date, part: i + 1, parts: parts.length, msgs: p.msgs, photos: p.media, senders: [...new Set(p.msgs.map((m) => m.sender))], text: p.msgs.map(formatLine).join("\n") }));
  }
  return { plan, skippedDone, skippedChatter };
}

export function formatLine(m) {
  const [y, mo, d] = m.date.split("-");
  const files = m.files.map((f) => `(${IMG.test(f) ? "foto" : AUDIO.test(f) ? "ses" : "dosya"}: ${f})`).join(" ");
  return `[${d}.${mo}.${y} ${m.time}] ${m.sender}: ${[m.text, files, m.omitted ? "(medya dışa aktarılmamış)" : ""].filter(Boolean).join(" ")}`;
}

// İşlenmiş mesaj anahtarları: 150 günden eskiler silinir (meta küçük kalsın)
export function markDone(done, msgs, today) {
  const out = { ...done };
  for (const m of msgs) out[m.key] = today;
  const cut = new Date(new Date(today + "T12:00:00").getTime() - 150 * 864e5).toISOString().slice(0, 10);
  for (const [k, v] of Object.entries(out)) if (v < cut) delete out[k];
  return out;
}
