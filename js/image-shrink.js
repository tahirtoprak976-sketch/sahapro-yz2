// Fotoğraf küçültme: kamera fotoğrafı (3–5 MB) en uzun kenarı 1600 px, JPEG %82 → ~250–450 KB.
// Fiş/kantar yazısı okunur kalır; depolama ve yedek ~%90 küçülür. Küçülmezse (ya da çözülemezse) dosya aynen kalır.
export const SHRINK_MIN = 350 * 1024;
export async function shrinkImage(file, { maxEdge = 1600, quality = 0.82, kind = "" } = {}) {
  try {
    if (!file || kind === "signature" || !/^image\/(jpeg|jpg|png|webp)$/i.test(file.type || "") || (file.size || 0) < SHRINK_MIN) return file;
    if (typeof createImageBitmap !== "function" || typeof document === "undefined") return file;
    const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
    const s = Math.min(1, maxEdge / Math.max(bmp.width, bmp.height));
    const cv = document.createElement("canvas");
    cv.width = Math.round(bmp.width * s); cv.height = Math.round(bmp.height * s);
    const g = cv.getContext("2d"); g.fillStyle = "#fff"; g.fillRect(0, 0, cv.width, cv.height); g.drawImage(bmp, 0, 0, cv.width, cv.height); bmp.close?.();
    const blob = await new Promise((r) => cv.toBlob(r, "image/jpeg", quality));
    if (!blob || blob.size >= file.size) return file;
    const name = String(file.name || "foto").replace(/\.[a-z0-9]+$/i, "") + ".jpg";
    return new File([blob], name, { type: "image/jpeg", lastModified: Date.now() });
  } catch (e) {
    return file;
  }
}
