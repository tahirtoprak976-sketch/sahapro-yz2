// Güvenlik çekirdeği — SAF katman (WebCrypto). Sunucu yok: her şey cihazda.
// • Yönetici şifresi PBKDF2-SHA256 (yüksek tekrar + rastgele tuz) ile saklanır; şifrenin kendisi hiçbir yerde tutulmaz.
// • Şoför bağlantısı: her bağlantının kendi gizli anahtarı (HMAC) ve çıkış kodu vardır. Şoförün gönderdiği kod bu anahtarla imzalanır;
//   patron telefonu imzayı doğrular → değiştirilmiş / sahte / iptal edilmiş bağlantıdan gelen kayıt işlenmez.
// • Yanlış denemede bekleme süresi katlanarak artar.
const enc = new TextEncoder();
const C = () => globalThis.crypto;
export const b64u = (buf) => { let s = ""; for (const b of new Uint8Array(buf)) s += String.fromCharCode(b); return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); };
export const unb64u = (s) => { const t = atob(String(s).replace(/-/g, "+").replace(/_/g, "/") + "===".slice((String(s).length + 3) % 4)); return Uint8Array.from(t, (c) => c.charCodeAt(0)); };
export const randomB64 = (n = 16) => b64u(C().getRandomValues(new Uint8Array(n)));
export function randomDigits(n = 8) { const a = C().getRandomValues(new Uint32Array(n)); return [...a].map((x) => String(x % 10)).join(""); }

export const ITER = 210000;
export async function hashSecret(secret, salt = randomB64(16), iter = ITER) {
  const key = await C().subtle.importKey("raw", enc.encode(String(secret).normalize("NFKC")), "PBKDF2", false, ["deriveBits"]);
  const bits = await C().subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: unb64u(salt), iterations: iter }, key, 256);
  return { v: 1, salt, iter, hash: b64u(bits) };
}
// Sabit zamanlı karşılaştırma
const same = (a, b) => { if (a.length !== b.length) return false; let r = 0; for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i); return r === 0; };
export async function verifySecret(secret, rec) {
  if (!rec?.hash || !rec?.salt) return false;
  const h = await hashSecret(secret, rec.salt, rec.iter || ITER);
  return same(h.hash, rec.hash);
}

// Şifre kuralı: en az 6 hane; aynı rakam tekrarı ve ardışık diziler yasak
export function pinProblem(pin) {
  const p = String(pin || "");
  if (p.length < 6) return "En az 6 karakter olmalı";
  if (/^(\d)\1+$/.test(p)) return "Hep aynı rakam olamaz";
  if ("0123456789012345678909876543210".includes(p)) return "Ardışık rakam olamaz (123456 gibi)";
  if (["123123", "112233", "121212", "111222", "654321", "102030"].includes(p)) return "Çok kolay tahmin edilir";
  return null;
}

// Yanlış deneme: 5 hakkı var, sonra 30 sn · 1 dk · 2 dk · 4 dk … (en çok 1 saat)
export function lockoutMs(fails) { return fails < 5 ? 0 : Math.min(3600e3, 30e3 * 2 ** (fails - 5)); }

// HMAC-SHA256 (şoför mesajı imzası) — ilk 16 bayt yeterli
export async function hmac(secretB64, text) {
  const key = await C().subtle.importKey("raw", unb64u(secretB64), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64u((await C().subtle.sign("HMAC", key, enc.encode(text))).slice(0, 16));
}
export async function hmacOk(secretB64, text, sig) { if (!secretB64 || !sig) return false; return same(await hmac(secretB64, text), String(sig)); }

// Şoför bağlantısının kayda göre durumu
export function linkVerdict(link, { today, personnelActive = true } = {}) {
  if (!link) return { ok: false, level: "unknown", why: "Bu bağlantı bu telefonda kayıtlı değil" };
  if (link.revoked_at) return { ok: false, level: "revoked", why: `Bağlantı ${String(link.revoked_at).slice(0, 10)} tarihinde iptal edildi` };
  if (!personnelActive) return { ok: false, level: "revoked", why: "Personel pasif (işten ayrılmış)" };
  if (link.exp && today > link.exp) return { ok: false, level: "expired", why: `Bağlantının süresi ${link.exp} tarihinde doldu` };
  return { ok: true, level: "ok", why: "" };
}
