// Yedek dosyası: sıkıştırılmış (gzip) ve isteğe bağlı ŞİFRELİ (AES-GCM, şifreden PBKDF2 ile anahtar).
// Biçim: "SPBK0" + gzip(JSON)  |  "SPBK1" + tuz(16) + iv(12) + AES-GCM(gzip(JSON)).  Eski düz .json yedekler de okunur.
// Yedek WhatsApp/Drive'a gider; içinde TC no, telefon, cari bilgiler var — şifre bu yüzden.
const MAGIC0 = "SPBK0", MAGIC1 = "SPBK1", ITER = 200000;
const enc = new TextEncoder(), dec = new TextDecoder();

async function streamBytes(bytes, stream) {
  const s = new Blob([bytes]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(s).arrayBuffer());
}
const gzip = (b) => streamBytes(b, new CompressionStream("gzip"));
const gunzip = (b) => streamBytes(b, new DecompressionStream("gzip"));
async function keyFrom(password, salt) {
  const base = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "PBKDF2", salt, iterations: ITER, hash: "SHA-256" }, base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}
const cat = (...parts) => { const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; } return out; };

export async function encodeBackup(obj, password = "") {
  const z = await gzip(enc.encode(JSON.stringify(obj)));
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
  const kind = backupKind(bytes);
  if (kind === "json") return JSON.parse(dec.decode(bytes));
  if (kind === "gzip") return JSON.parse(dec.decode(await gunzip(bytes)));
  if (kind === "compressed") return JSON.parse(dec.decode(await gunzip(bytes.subarray(5))));
  const password = await getPassword?.();
  if (!password) throw Error("Bu yedek şifreli — şifre girilmedi");
  const salt = bytes.subarray(5, 21), iv = bytes.subarray(21, 33), ct = bytes.subarray(33);
  let z;
  try { z = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv }, await keyFrom(password, salt), ct)); }
  catch (e) { throw Error("Yedek şifresi yanlış"); }
  return JSON.parse(dec.decode(await gunzip(z)));
}
