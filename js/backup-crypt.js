// Yedek dosyası: sıkıştırılmış (gzip) ve isteğe bağlı ŞİFRELİ (AES-GCM, şifreden PBKDF2 ile anahtar).
// Biçim: "SPBK0" + gzip(JSON)  |  "SPBK1" + tuz(16) + iv(12) + AES-GCM(gzip(JSON)).  Eski düz .json yedekler de okunur.
// Yedek WhatsApp/Drive'a gider; içinde TC no, telefon, cari bilgiler var — şifre bu yüzden.
const MAGIC0 = "SPBK0", MAGIC1 = "SPBK1", ITER = 200000;
const enc = new TextEncoder(), dec = new TextDecoder();
export const MAX_BACKUP_INPUT = 64 * 1024 * 1024, MAX_BACKUP_DECODED = 128 * 1024 * 1024;

async function streamBytes(bytes, stream) {
  const reader = new Blob([bytes]).stream().pipeThrough(stream).getReader();
  const chunks = []; let size = 0;
  while (true) {
    const part = await reader.read();
    if (part.done) break;
    size += part.value.byteLength;
    if (size > MAX_BACKUP_DECODED) { await reader.cancel(); throw Error("Yedek açılmış boyut sınırını aşıyor (128 MB)"); }
    chunks.push(part.value);
  }
  const out = new Uint8Array(size); let offset=0;
  for(const part of chunks) {out.set(part,offset);offset+=part.byteLength;}
  return out;
}
const gzip = (b) => streamBytes(b, new CompressionStream("gzip"));
const gunzip = (b) => streamBytes(b, new DecompressionStream("gzip"));
async function keyFrom(password, salt) {
  const base = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "PBKDF2", salt, iterations: ITER, hash: "SHA-256" }, base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}
const cat = (...parts) => { const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; } return out; };

export async function encodeBackup(obj, password = "") {
  const credentials = (obj?.meta || []).some(m => m.key === "driver_links" && Array.isArray(m.value) && m.value.length);
  if (credentials && (!password || String(password).length < 10))
    throw Error("Şoför anahtarları içeren tam yedek için en az 10 karakterli şifre gerekli");
  const raw = enc.encode(JSON.stringify(obj));
  if (raw.byteLength > MAX_BACKUP_DECODED) throw Error("Yedek 128 MB açılmış boyut sınırını aşıyor; veri ve ekleri parçalara ayırın");
  const z = await gzip(raw);
  if (z.byteLength + (password ? 49 : 5) > MAX_BACKUP_INPUT) throw Error("Yedek 64 MB dosya sınırını aşıyor; veri ve ekleri parçalara ayırın");
  if (!password) return cat(enc.encode(MAGIC0), z);
  const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await keyFrom(password, salt), z));
  return cat(enc.encode(MAGIC1), salt, iv, ct);
}
export function backupKind(bytes) {
  const head = dec.decode(bytes.subarray(0, 5));
  if (head === MAGIC1) return "encrypted";
  if (head === MAGIC0) return "compressed";
  if (bytes[0] === 0x1f && bytes[1] === 0x8b) return "gzip";
  return "json";
}
// getPassword: şifreli dosyada çağrılır (iptal → null)
export async function decodeBackup(bytes, getPassword) {
  bytes = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (bytes.byteLength > MAX_BACKUP_INPUT) throw Error("Yedek dosyası 64 MB sınırını aşıyor; parça dışa aktarımını kullanın");
  const kind = backupKind(bytes);
  if (kind === "json") return JSON.parse(dec.decode(bytes));
  if (kind === "gzip") return JSON.parse(dec.decode(await gunzip(bytes)));
  if (kind === "compressed") return JSON.parse(dec.decode(await gunzip(bytes.subarray(5))));
  if (bytes.byteLength < 49) throw Error("Şifreli yedek eksik veya bozuk");
  const password = await getPassword?.();
  if (!password) throw Error("Bu yedek şifreli — şifre girilmedi");
  const salt = bytes.subarray(5, 21), iv = bytes.subarray(21, 33), ct = bytes.subarray(33);
  let z;
  try { z = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv }, await keyFrom(password, salt), ct)); }
  catch (e) { throw Error("Yedek şifresi yanlış"); }
  return JSON.parse(dec.decode(await gunzip(z)));
}
