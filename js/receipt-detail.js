// Fatura / fiş ayrıntısı — SAF katman. Gemini'nin okuduğu kalemler (stok kodu, açıklama, miktar, birim fiyat, KDV, tutar),
// fatura no, ETTN, satıcı VKN, KDV hariç tutar ve KDV; hepsi fotoğrafın yazısıyla doğrulanır (yazıda geçmeyen kalem alınmaz).
import { numbersInText } from "./ai-assist.js";

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const fold = (s) => String(s || "").toLocaleLowerCase("tr-TR").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/ı/g, "i").replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
const digits = (s) => String(s || "").replace(/\D/g, "");

export function validateInvoiceDetail(inv, text) {
  if (!inv || typeof inv !== "object") return null;
  const t = String(text || "");
  const nums = numbersInText(t), ft = ` ${fold(t)} `, compact = t.replace(/\s+/g, "");
  const seen = (n) => n != null && Number(n) > 0 && nums.has(r2(n));
  const out = { no: "", ettn: "", seller_tax_no: "", net: null, kdv: null, kdv_rate: null, items: [], dropped: 0, issues: [] };
  const no = String(inv.no || "").trim();
  if (no.length >= 3 && compact.includes(no.replace(/\s+/g, ""))) out.no = no.slice(0, 40);
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(inv.ettn || "").trim()) && t.toLowerCase().includes(String(inv.ettn).trim().toLowerCase())) out.ettn = String(inv.ettn).trim().toLowerCase();
  const vkn = digits(inv.seller_tax_no);
  if (/^\d{10,11}$/.test(vkn) && t.includes(vkn)) out.seller_tax_no = vkn;
  if (seen(inv.net)) out.net = r2(inv.net);
  if (seen(inv.kdv)) out.kdv = r2(inv.kdv);
  if ([0, 1, 8, 10, 18, 20].includes(Number(inv.kdv_rate))) out.kdv_rate = Number(inv.kdv_rate);
  for (const it of (Array.isArray(inv.items) ? inv.items : []).slice(0, 60)) {
    const desc = String(it?.desc || "").trim().slice(0, 120);
    const words = fold(desc).split(" ").filter((w) => w.length >= 3);
    const descOk = words.length && words.filter((w) => ft.includes(` ${w}`) || ft.includes(w)).length >= Math.ceil(words.length / 2);
    const qty = Number(it?.qty) || null, up = Number(it?.unit_price) || null;
    let amount = Number(it?.amount) || (qty && up ? r2(qty * up) : null);
    const amtOk = seen(amount) || (qty && up && seen(up));
    if (!descOk || !amtOk) { out.dropped++; continue; }
    out.items.push({ code: String(it.code || "").trim().slice(0, 30), desc, qty: qty ?? 1, unit: String(it.unit || "Adet").slice(0, 12), unit_price: up ?? amount, kdv_rate: [0, 1, 8, 10, 18, 20].includes(Number(it.kdv_rate)) ? Number(it.kdv_rate) : out.kdv_rate, amount: r2(amount) });
  }
  const sum = r2(out.items.reduce((n, i) => n + i.amount, 0));
  if (out.items.length && out.net != null && Math.abs(sum - out.net) > 1) out.issues.push(`Kalemlerin toplamı (${sum.toLocaleString("tr-TR")}) KDV hariç tutarla (${out.net.toLocaleString("tr-TR")}) tutmuyor — eksik satır olabilir`);
  if (out.dropped) out.issues.push(`${out.dropped} kalem fişte doğrulanamadığı için alınmadı`);
  out.itemsSum = sum;
  return out.items.length || out.no || out.net != null ? out : null;
}

// Kalemlerden bakım ipucu: filtre/yağ/balata… → bakım kaydı önerisi (bakım takvimine işlenir)
const MAINT_RE = [["Yağ / Filtre", /filtre|filitre|motor yag|yag degis|hidrolik yag|sanziman yag|adblue/],["Lastik", /lastik/],["Fren", /balata|disk|fren/],["Akü", /\baku\b/],["Kayış", /kayis|v kayis/],["Conta / sızdırmazlık", /conta|keçe|kece|oring|o ring/]];
export function maintenanceHint(items) {
  const txt = fold(items.map((i) => i.desc).join(" "));
  const hits = MAINT_RE.filter(([, re]) => re.test(txt)).map(([k]) => k);
  if (!hits.length) return null;
  return { title: hits.includes("Yağ / Filtre") ? "Periyodik bakım (yağ / filtre)" : hits.join(", "), kinds: hits };
}
