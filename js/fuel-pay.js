// "Mazotla ödeme hesapları" (#/mazot-hesaplari): ücretini (tamamen ya da kısmen) mazotla ödeyen tüm müşteriler.
import { qs, esc, appbar, notice, toast } from "./ui.js";

export async function screen(ctx) {
  if (ctx.parts[0] !== "mazot-hesaplari") return false;
  const { root, db } = ctx;
  const { fuelLedgers, fuelRulesOf } = await import("./assistant-rules.js");
  const d = await db.dumpAll();
  const rows = fuelLedgers(d);
  const total = Math.round(rows.reduce((n, r) => n + Math.max(0, r.balance), 0) * 10) / 10;
  const { fuelPrice } = await import("./finance-chart.js");
  const ref = await db.metaGet("fuel_ref_price");
  const price = fuelPrice(d, new Date().toISOString().slice(0, 10), ref);
  root.innerHTML =
    appbar("Mazotla Ödeme Hesapları", rows.length ? `toplam alacak ${total} L` : "") +
    `<div style="height:10px"></div>
    ${notice("info", "Bir müşteri işin karşılığını mazotla ödüyorsa müşteri kartında Kartı Düzenle → \"Mazotla ödeme kuralları\"na kural ekleyin (ör. 75 L / Sefer, gravak maslak, yalnız mazot). Kurala uyan işler hakedişe para yazmaz; hak edilen litre buradan takip edilir.")}
    <div class="card"><div class="small">Litre değeri: <b>${price ? price.toLocaleString("tr-TR") + " ₺/L" : "bilinmiyor"}</b> ${price && !ref ? "(depo alış ortalaması)" : ref ? "(referans)" : ""}${price ? ` · toplam alacak ≈ <b>${Math.round(total * price).toLocaleString("tr-TR")} ₺</b>` : ""}</div>
      <div class="formgrid2" style="margin-top:6px"><div class="field"><label>Referans litre fiyatı (depoya fiyatlı giriş yoksa)</label><input type="number" step="any" data-ref value="${esc(ref ?? "")}"></div></div>
      <button class="btn sm" data-ref-save>Kaydet</button>
      <div class="muted tiny" style="margin-top:4px">Mazotla ödenen işler kâr hesabında TL gelir sayılmaz; müşterinin araca verdiği mazot da masraf sayılmaz. Takip litre iledir; bu fiyat yalnız kalan alacağın yaklaşık değerini gösterir.</div></div>
    ${rows.map((r) => {
      const c = (d.customers || []).find((x) => x.id === r.id);
      const rules = fuelRulesOf(c);
      return `<div class="card tap" data-go="#/musteriler/${esc(r.id)}"><div class="row between"><b>${esc(r.name)}</b><span class="${r.balance > 0 ? "badge warn" : "badge ok"}">${r.balance > 0 ? r.balance + " L alacak" : r.balance < 0 ? -r.balance + " L fazla" : "kapalı"}</span></div>
        <div class="small">${r.earned} L hak edildi · ${r.received} L alındı · ${r.works} iş</div>
        <div class="muted tiny">${rules.map((x) => `${x.per} L/${String(x.unit || "Sefer").toLocaleLowerCase("tr-TR")}${x.match ? " (" + esc(x.match) + ")" : ""}`).join(" · ") || "kural yok"}</div></div>`;
    }).join("") || '<div class="muted small" style="padding:8px">Henüz mazotla ödeme kuralı olan müşteri yok.</div>'}`;
  qs("[data-ref-save]", root).addEventListener("click", async () => {
    const v = Number(qs("[data-ref]", root).value);
    await db.metaSet("fuel_ref_price", v > 0 ? v : null);
    toast("Kaydedildi", "ok");
    ctx.reload();
  });
  return true;
}
