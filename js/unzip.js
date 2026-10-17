// Küçük ZIP okuyucu (WhatsApp "Medya ile dışa aktar" dosyası için). Dış kütüphane yok:
// merkezi dizin okunur, sıkıştırılmış dosyalar tarayıcının DecompressionStream("deflate-raw") ile açılır.
// listZip(buf) → [{ name, method, csize, size, offset }]; readEntry(buf, e) → Uint8Array
const u16 = (v, o) => v.getUint16(o, true);
const u32 = (v, o) => v.getUint32(o, true);

export function listZip(buf) {
  const v = new DataView(buf instanceof ArrayBuffer ? buf : buf.buffer, buf.byteOffset || 0, buf.byteLength);
  // Merkezi dizin sonu (EOCD): sondan geriye "PK\5\6"
  let eocd = -1;
  for (let i = v.byteLength - 22; i >= Math.max(0, v.byteLength - 65557); i--) if (u32(v, i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error("ZIP dosyası okunamadı");
  const count = u16(v, eocd + 10);
  let p = u32(v, eocd + 16);
  const out = [];
  const dec = new TextDecoder("utf-8");
  for (let n = 0; n < count; n++) {
    if (u32(v, p) !== 0x02014b50) throw new Error("ZIP dizini bozuk");
    const method = u16(v, p + 10), csize = u32(v, p + 20), size = u32(v, p + 24);
    const nl = u16(v, p + 28), el = u16(v, p + 30), cl = u16(v, p + 32), offset = u32(v, p + 42);
    const name = dec.decode(new Uint8Array(v.buffer, v.byteOffset + p + 46, nl));
    if (!name.endsWith("/")) out.push({ name, method, csize, size, offset });
    p += 46 + nl + el + cl;
  }
  return out;
}

export async function readEntry(buf, e) {
  const v = new DataView(buf instanceof ArrayBuffer ? buf : buf.buffer, buf.byteOffset || 0, buf.byteLength);
  if (u32(v, e.offset) !== 0x04034b50) throw new Error("ZIP kaydı bozuk: " + e.name);
  const start = e.offset + 30 + u16(v, e.offset + 26) + u16(v, e.offset + 28);
  const data = new Uint8Array(v.buffer, v.byteOffset + start, e.csize);
  if (e.method === 0) return data.slice();
  if (e.method !== 8) throw new Error("Desteklenmeyen sıkıştırma: " + e.name);
  if (typeof DecompressionStream === "undefined") throw new Error("Bu tarayıcı ZIP açamıyor; sohbeti medyasız (.txt) dışa aktarın");
  const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

const MIME = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", heic: "image/heic", pdf: "application/pdf", opus: "audio/ogg", ogg: "audio/ogg", m4a: "audio/mp4", mp3: "audio/mpeg", aac: "audio/aac", txt: "text/plain" };
export const mimeOf = (name) => MIME[String(name).split(".").pop().toLowerCase()] || "application/octet-stream";
const base = (n) => String(n).split("/").pop();

// WhatsApp dışa aktarımı: sohbet metni + medya dosyaları (ad → okuyucu)
export async function openChatZip(buf) {
  const entries = listZip(buf);
  const txt = entries.filter((e) => /\.txt$/i.test(e.name)).sort((a, b) => b.size - a.size)[0];
  if (!txt) throw new Error("ZIP içinde sohbet metni (.txt) yok");
  const text = new TextDecoder("utf-8").decode(await readEntry(buf, txt));
  const media = new Map();
  for (const e of entries) if (e !== txt) media.set(base(e.name), e);
  return {
    text,
    names: [...media.keys()],
    file: async (name) => {
      const e = media.get(base(name));
      if (!e) return null;
      return new File([await readEntry(buf, e)], base(e.name), { type: mimeOf(e.name) });
    },
  };
}
