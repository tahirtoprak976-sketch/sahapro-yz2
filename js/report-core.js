// Detaylı kayıt raporları — SAF katman (DOM yok). Her "kalem" (döküm sahası, ocak, müşteri, şantiye, araç, personel,
// esnaf, iş türü, malzeme, yakıt, gider, bakım, taşeron) için: kimlik bilgileri, özet rakamlar, ayrıntılı tablolar.
// Aynı sonuç ekranda tablo, PDF'te kurumsal rapor, CSV'de satır olarak kullanılır.
// Rakamlar diğer ekranlarla aynı kaynaklardan: iş tutarı = workAmount, döküm ücreti = dumpFee, mazot alacağı = customerFuelLedger.
import { isActive, todayStr, trDate } from "./core.js";
import { workAmount } from "./collect-core.js";
import { dumpFee } from "./dump-fees.js";

const live = (d, s) => (d[s] || []).filter(isActive);
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const num = (n) => Number(n || 0).toLocaleString("tr-TR", { maximumFractionDigits: 2 });
const tl = (n) => Number(n || 0).toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " ₺";
const fold = (s) => String(s || "").toLocaleLowerCase("tr-TR").replace(/\s+/g, " ").trim();
const byDate = (a, b) => String(a.date || "").localeCompare(String(b.date || "")) || String(a.created_at || "").localeCompare(String(b.created_at || ""));
const monthName = (k) => { const [y, m] = k.split("-"); return ["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"][Number(m) - 1] + " " + y; };
const unitsText = (u) => Object.entries(u).filter(([, q]) => q).map(([k, q]) => `${num(q)} ${String(k || "").toLocaleLowerCase("tr-TR")}`).join(", ") || "—";

export const REPORT_KINDS = [
  { k: "dokum", t: "Döküm sahası", ic: "🏔", store: "dump_sites", all: "Tüm döküm sahaları" },
  { k: "ocak", t: "Malzeme ocağı", ic: "⛰", store: "quarries", all: "Tüm ocaklar" },
  { k: "musteri", t: "Müşteri", ic: "🏢", store: "customers", all: "Tüm müşteriler" },
  { k: "santiye", t: "Şantiye", ic: "🏗", store: "sites", all: "Tüm şantiyeler" },
  { k: "arac", t: "Araç / makine", ic: "🚚", store: "vehicles", all: "Tüm filo" },
  { k: "personel", t: "Personel", ic: "👷", store: "personnel", all: "Tüm personel" },
  { k: "esnaf", t: "Esnaf / tedarikçi", ic: "🔧", store: "suppliers", all: "Tüm esnaf" },
  { k: "taseron", t: "Taşeron", ic: "🤝", store: "contractors", all: "Tüm taşeronlar" },
  { k: "istur", t: "İş türü", ic: "🧱", values: "work_type", all: "Tüm iş türleri" },
  { k: "malzeme", t: "Malzeme", ic: "🪨", values: "material", all: "Tüm malzemeler" },
  { k: "yakit", t: "Yakıt", ic: "⛽", store: "vehicles", all: "Tüm araçlar" },
  { k: "gider", t: "Gider", ic: "💸", values: "category", all: "Tüm kategoriler" },
  { k: "bakim", t: "Bakım / arıza", ic: "🛠", store: "vehicles", all: "Tüm araçlar" },
];
export const kindOf = (k) => REPORT_KINDS.find((x) => x.k === k) || REPORT_KINDS[0];

// Seçilebilir kalemler (kart listesi ya da kayıtlardaki değerler)
export function reportOptions(d, k) {
  const K = kindOf(k);
  if (K.store) return live(d, K.store).map((r) => ({ id: r.id, name: r.name || r.plate || "—" })).sort((a, b) => a.name.localeCompare(b.name, "tr"));
  const src = K.values === "category" ? live(d, "expense_records") : live(d, "work_records");
  const seen = new Map();
  for (const r of src) { const v = String(r[K.values] || "").trim(); if (v && !seen.has(fold(v))) seen.set(fold(v), v); }
  return [...seen.values()].sort((a, b) => a.localeCompare(b, "tr")).map((v) => ({ id: v, name: v }));
}

function ctx(d, from, to) {
  const maps = {};
  const nm = (s, id) => { if (!id) return ""; maps[s] ||= new Map(live(d, s).map((r) => [r.id, r.name || r.plate || ""])); return maps[s].get(id) || ""; };
  const inR = (x) => !!x && (!from || x >= from) && (!to || x <= to);
  return { nm, inR };
}

// Bir iş satırının tüm ayrıntısı
function workInfo(d, w, nm) {
  const fee = dumpFee(d, w);
  return {
    w, date: w.date, customer: nm("customers", w.customer_id), site: nm("sites", w.site_id), vehicle: nm("vehicles", w.vehicle_id), personnel: nm("personnel", w.personnel_id),
    type: w.work_type || "", qty: Number(w.quantity) || 0, unit: w.unit || "", material: w.material || "",
    from: nm("quarries", w.quarry_id) || w.quarry || "", to: nm("dump_sites", w.dump_site_id) || w.dump_area || "",
    ton: Number(w.tonnage) || 0, slip: [w.slip_no, w.digital_slip_no && w.digital_slip_no !== w.slip_no ? "dijital " + w.digital_slip_no : ""].filter(Boolean).join(" · "),
    unitPrice: Number(w.price_snapshot?.unit_price) || 0, amount: workAmount(w), fuelL: Number(w.customer_fuel_allowance_l) || 0,
    dump: fee?.amount || 0, dumpEst: !!fee?.estimated, dumpTon: fee?.ton || 0, note: [w.description, w.customer_note].filter(Boolean).join(" · "),
  };
}

// İş tablosu: hangi sütunlar (sabit kalem sütunu atılır). internal: maliyet sütunları yalnız iç nüshada
const WCOLS = {
  date: ["Tarih", 9, (x) => trDate(x.date)],
  customer: ["Müşteri", 11, (x) => x.customer],
  site: ["Şantiye", 10, (x) => x.site],
  vehicle: ["Araç", 8, (x) => x.vehicle],
  personnel: ["Şoför / Op.", 8, (x) => x.personnel],
  type: ["İş", 10, (x) => x.type],
  qty: ["Miktar", 7, (x) => `${num(x.qty)} ${x.unit}`],
  material: ["Malzeme", 7, (x) => x.material],
  route: ["Nereden → Nereye", 14, (x) => [x.from, x.to].filter(Boolean).join(" → ")],
  from: ["Alındığı yer", 9, (x) => x.from],
  to: ["Döküm yeri", 9, (x) => x.to],
  ton: ["Ton", 5, (x) => (x.ton ? num(x.ton) : "")],
  slip: ["Fiş No", 8, (x) => x.slip],
  price: ["Birim Fiyat", 8, (x) => (x.unitPrice ? tl(x.unitPrice) : "")],
  amount: ["Tutar", 9, (x) => (x.amount ? tl(x.amount) : x.fuelL ? `${num(x.fuelL)} L mazot` : "fiyatsız")],
  dump: ["Döküm Maliyeti", 9, (x) => (x.dump ? (x.dumpEst ? "~" : "") + tl(x.dump) : ""), true],
  note: ["Not", 12, (x) => x.note],
};
function workTable(title, infos, cols) {
  const C = cols.map((c) => WCOLS[c]);
  return {
    title, count: infos.length, headers: C.map((c) => c[0]), widths: C.map((c) => c[1]), internalCols: C.map((c) => !!c[3]),
    rows: [...infos.map((x) => C.map((c) => c[2](x) ?? "")), ...(infos.length > 1 ? [totalRow(cols, infos)] : [])],
    link: infos.map((x) => "#/isler/" + x.w.id),
  };
}
// Tablonun son satırı: TOPLAM (miktar, ton, tutar, döküm maliyeti)
function totalRow(cols, infos) {
  const units = {};
  for (const x of infos) units[x.unit] = r2((units[x.unit] || 0) + x.qty);
  const s = (f) => r2(infos.reduce((n, x) => n + f(x), 0));
  return cols.map((c, i) => (i === 0 ? "TOPLAM" : c === "qty" ? unitsText(units) : c === "ton" ? (s((x) => x.ton) ? num(s((x) => x.ton)) : "") : c === "amount" ? tl(s((x) => x.amount)) : c === "dump" ? tl(s((x) => x.dump)) : ""));
}
// Gruplama: ad → iş sayısı, miktar, ton, tutar, döküm maliyeti
function groupTable(title, infos, keyFn, label, { dump = false } = {}) {
  const g = new Map();
  for (const x of infos) {
    const k = keyFn(x) || "—";
    const o = g.get(k) || { n: 0, units: {}, ton: 0, amount: 0, dump: 0, fuelL: 0 };
    o.n++; o.units[x.unit] = r2((o.units[x.unit] || 0) + x.qty); o.ton = r2(o.ton + x.ton); o.amount = r2(o.amount + x.amount); o.dump = r2(o.dump + x.dump); o.fuelL = r2(o.fuelL + x.fuelL);
    g.set(k, o);
  }
  const rows = [...g.entries()].sort((a, b) => b[1].amount - a[1].amount || b[1].n - a[1].n);
  return {
    title, headers: [label, "İş", "Miktar", "Ton", "Tutar", ...(dump ? ["Döküm Maliyeti"] : [])], widths: [30, 8, 22, 10, 15, ...(dump ? [15] : [])], internalCols: [false, false, false, false, false, ...(dump ? [true] : [])],
    rows: rows.map(([k, o]) => [k, String(o.n), unitsText(o.units), o.ton ? num(o.ton) : "", (o.amount ? tl(o.amount) : "") + (o.fuelL ? `${o.amount ? " + " : ""}${num(o.fuelL)} L mazot` : ""), ...(dump ? [o.dump ? tl(o.dump) : ""] : [])]),
  };
}
const monthKey = (x) => monthName(String(x.date).slice(0, 7));
function workKpis(infos, { dump = true } = {}) {
  const units = {};
  for (const x of infos) units[x.unit] = r2((units[x.unit] || 0) + x.qty);
  const amount = r2(infos.reduce((n, x) => n + x.amount, 0)), ton = r2(infos.reduce((n, x) => n + x.ton, 0));
  const fuelL = r2(infos.reduce((n, x) => n + x.fuelL, 0)), dumpT = r2(infos.reduce((n, x) => n + x.dump, 0));
  const unpriced = infos.filter((x) => !x.amount && !x.fuelL).length, slips = infos.filter((x) => x.slip).length;
  return [
    ["İş sayısı", String(infos.length)], ["Miktar", unitsText(units)],
    ...(ton ? [["Toplam ton (fiş)", num(ton) + " ton"]] : []),
    ["İş tutarı", tl(amount)],
    ...(fuelL ? [["Mazot karşılığı", num(fuelL) + " L"]] : []),
    ...(dump && dumpT ? [["Döküm maliyeti", tl(dumpT), true]] : []),
    ["Fişli iş", `${slips} / ${infos.length}`],
    ...(unpriced ? [["Fiyatsız iş", String(unpriced)]] : []),
  ];
}
const infoPairs = (r, keys) => keys.map(([k, l, f]) => [l, f ? f(r) : r?.[k]]).filter(([, v]) => v !== undefined && v !== null && v !== "");

// ---- Ana fonksiyon ----
export function buildReport(d, { k = "dokum", id = "", from = "", to = todayStr(), today = todayStr() } = {}) {
  const K = kindOf(k);
  const { nm, inR } = ctx(d, from, to);
  const works = live(d, "work_records").filter((w) => inR(w.date)).sort(byDate);
  const winfo = (ws) => ws.map((w) => workInfo(d, w, nm));
  const card = K.store && id ? live(d, K.store).find((r) => r.id === id) : null;
  if (K.store && id && !card) throw Error("Kayıt bulunamadı");
  const name = card ? card.name || card.plate : id || K.all;
  const R = { k, kind: K.t, id, name, from, to, info: [], kpis: [], tables: [], notes: [] };
  const per = from ? `${trDate(from)} – ${trDate(to)}` : `Başlangıç – ${trDate(to)}`;
  R.period = per;

  if (k === "dokum") {
    const sites = live(d, "dump_sites");
    const siteOf = (w) => w.dump_site_id || sites.find((s) => w.dump_area && fold(s.name) === fold(w.dump_area))?.id || "";
    const ws = winfo(works.filter((w) => (id ? siteOf(w) === id : siteOf(w) || w.dump_area)));
    if (card) R.info = infoPairs(card, [["name", "Döküm sahası"], ["address", "Adres"], ["contact", "Yetkili"], ["phone", "Telefon"], ["fee", "Döküm ücreti", (r) => (Number(r.fee) > 0 ? `${tl(r.fee)} / ${String(r.fee_unit || "").toLocaleLowerCase("tr-TR")}` : "")], ["own_yard", "Tür", (r) => (r.own_yard ? "Kendi depo / stok sahası" : "")]]);
    R.kpis = workKpis(ws);
    const est = ws.filter((x) => x.dumpEst).length;
    if (est) R.notes.push(`${est} işte ton fişi yok; döküm maliyeti aracın ortalama yüküyle tahmin edildi (~ işaretli).`);
    R.tables.push(workTable("İş dökümü", ws, ["date", "customer", "site", "vehicle", "personnel", "type", "qty", "material", ...(id ? [] : ["to"]), "ton", "slip", "price", "amount", "dump"]));
    if (!id) R.tables.push(groupTable("Döküm sahasına göre", ws, (x) => x.to, "Döküm sahası", { dump: true }));
    R.tables.push(groupTable("Müşteriye göre", ws, (x) => x.customer, "Müşteri", { dump: true }));
    R.tables.push(groupTable("Araca göre", ws, (x) => x.vehicle, "Araç", { dump: true }));
    R.tables.push(groupTable("Malzemeye göre", ws, (x) => x.material, "Malzeme", { dump: true }));
    R.tables.push(groupTable("Aylara göre", ws, monthKey, "Ay", { dump: true }));
  } else if (k === "ocak") {
    const ws = winfo(works.filter((w) => (id ? w.quarry_id === id : w.quarry_id || w.quarry)));
    if (card) R.info = infoPairs(card, [["name", "Malzeme ocağı"], ["address", "Adres"], ["contact", "Yetkili"], ["phone", "Telefon"], ["materials", "Malzemeler"]]);
    R.kpis = workKpis(ws, { dump: false });
    R.tables.push(workTable("Sevkiyat / iş dökümü", ws, ["date", "customer", "site", "vehicle", "personnel", "type", "qty", "material", ...(id ? [] : ["from"]), "to", "ton", "slip", "price", "amount"]));
    if (!id) R.tables.push(groupTable("Ocağa göre", ws, (x) => x.from, "Ocak"));
    R.tables.push(groupTable("Malzemeye göre", ws, (x) => x.material, "Malzeme"));
    R.tables.push(groupTable("Müşteriye göre", ws, (x) => x.customer, "Müşteri"));
    R.tables.push(groupTable("Araca göre", ws, (x) => x.vehicle, "Araç"));
    R.tables.push(groupTable("Aylara göre", ws, monthKey, "Ay"));
  } else if (k === "musteri" || k === "santiye" || k === "taseron" || k === "istur" || k === "malzeme") {
    let pick;
    if (k === "musteri") {
      const ids = new Set(id ? [id, ...live(d, "customers").filter((c) => c.parent_customer_id === id).map((c) => c.id)] : []);
      pick = (w) => (id ? ids.has(w.customer_id) : true);
      if (card) R.info = infoPairs(card, [["name", "Müşteri"], ["phone", "Telefon"], ["contact", "Yetkili"], ["tax_no", "Vergi no"], ["address", "Adres"]]);
    } else if (k === "santiye") {
      pick = (w) => (id ? w.site_id === id : !!w.site_id);
      if (card) R.info = infoPairs(card, [["name", "Şantiye"], ["customer_id", "Müşteri", (r) => nm("customers", r.customer_id)], ["address", "Adres"], ["contact", "Şantiye şefi"], ["phone", "Telefon"]]);
    } else if (k === "taseron") {
      const vs = new Set(live(d, "vehicles").filter((v) => (id ? v.contractor_id === id : v.contractor_id || v.ownership === "Taşeron")).map((v) => v.id));
      pick = (w) => vs.has(w.vehicle_id);
      if (card) R.info = infoPairs(card, [["name", "Taşeron"], ["contact", "Yetkili"], ["phone", "Telefon"], ["address", "Adres"], ["vehicles", "Araçları", () => live(d, "vehicles").filter((v) => v.contractor_id === id).map((v) => v.name).join(", ")]]);
    } else {
      const f = k === "istur" ? "work_type" : "material";
      pick = (w) => (id ? fold(w[f]) === fold(id) : !!w[f]);
      R.info = [[K.t, id || K.all]];
    }
    const ws = winfo(works.filter(pick));
    R.kpis = workKpis(ws);
    const cols = { musteri: ["date", ...(id ? [] : ["customer"]), "site", "vehicle", "personnel", "type", "qty", "material", "route", "ton", "slip", "price", "amount", "dump"],
      santiye: ["date", ...(id ? [] : ["customer", "site"]), "vehicle", "personnel", "type", "qty", "material", "route", "ton", "slip", "price", "amount", "dump"],
      taseron: ["date", "vehicle", "personnel", "customer", "site", "type", "qty", "route", "ton", "slip", "price", "amount"],
      istur: ["date", "customer", "site", "vehicle", "personnel", ...(id ? [] : ["type"]), "qty", "material", "route", "ton", "slip", "price", "amount", "dump"],
      malzeme: ["date", "customer", "site", "vehicle", "type", "qty", ...(id ? [] : ["material"]), "route", "ton", "slip", "price", "amount", "dump"] }[k];
    R.tables.push(workTable("İş dökümü", ws, cols));
    if (k !== "musteri" || !id) R.tables.push(groupTable("Müşteriye göre", ws, (x) => x.customer, "Müşteri", { dump: true }));
    if (k === "musteri") R.tables.push(groupTable("Şantiyeye göre", ws, (x) => x.site, "Şantiye", { dump: true }));
    if (k !== "istur" || !id) R.tables.push(groupTable("İş türüne göre", ws, (x) => x.type, "İş türü", { dump: true }));
    R.tables.push(groupTable("Araca göre", ws, (x) => x.vehicle, "Araç", { dump: true }));
    if (k !== "malzeme") R.tables.push(groupTable("Döküm yerine göre", ws, (x) => x.to, "Döküm yeri", { dump: true }));
    R.tables.push(groupTable("Aylara göre", ws, monthKey, "Ay", { dump: true }));
    if (k === "musteri" && id) {
      // Tahsilat ve cari (müşteri raporundaki ile aynı kaynak: cari hareketler)
      const ids = new Set([id, ...live(d, "customers").filter((c) => c.parent_customer_id === id).map((c) => c.id)]);
      const movs = live(d, "cari_movements").filter((m) => ids.has(m.customer_id)).sort(byDate);
      const before = r2(movs.filter((m) => from && m.date < from).reduce((n, m) => n + Number(m.amount || 0), 0));
      let bal = before;
      const inP = movs.filter((m) => inR(m.date));
      const coll = r2(-inP.filter((m) => m.type === "Tahsilat").reduce((n, m) => n + Number(m.amount || 0), 0));
      R.kpis.push(["Tahsilat (dönem)", tl(coll)]);
      R.tables.push({ title: "Cari hareketler", headers: ["Tarih", "İşlem", "Açıklama", "Borç", "Tahsilat", "Bakiye"], widths: [10, 12, 42, 12, 12, 12],
        rows: [["", "Devir", "", "", "", tl(before)], ...inP.map((m) => { bal = r2(bal + Number(m.amount || 0)); const a = Number(m.amount) || 0; return [trDate(m.date), m.type || "", m.reason || m.note || "", a > 0 ? tl(a) : "", a < 0 ? tl(-a) : "", tl(bal)]; })] });
      R.kpis.push(["Dönem sonu bakiye", tl(bal)]);
    }
  } else if (k === "arac") {
    const vsel = (r) => (id ? r.vehicle_id === id : !!r.vehicle_id);
    const ws = winfo(works.filter(vsel));
    const fuel = live(d, "fuel_records").filter((f) => vsel(f) && inR(f.date)).sort(byDate);
    const maint = live(d, "maintenance_records").filter((m) => vsel(m) && inR(m.date)).sort(byDate);
    const exps = live(d, "expense_records").filter((e) => vsel(e) && inR(e.date)).sort(byDate);
    if (card) R.info = infoPairs(card, [["name", "Araç / makine"], ["plate", "Plaka"], ["type", "Tür"], ["brand", "Marka"], ["model", "Model"], ["model_year", "Model yılı"], ["ownership", "Mülkiyet"], ["assignee_id", "Zimmetli", (r) => nm("personnel", r.assignee_id)], ["chassis_no", "Şasi no"], ["km", "Km (kart)", (r) => (r.km ? num(r.km) : "")], ["machine_hours", "Makine saati (kart)", (r) => (r.machine_hours ? num(r.machine_hours) : "")]]);
    const income = r2(ws.reduce((n, x) => n + x.amount, 0));
    const paidFuel = fuel.filter((f) => f.fuel_source !== "Müşteri Verdi");
    const fuelTL = r2(paidFuel.reduce((n, f) => n + (Number(f.total) || 0), 0)), fuelL = r2(fuel.reduce((n, f) => n + (Number(f.liters) || 0), 0));
    const custL = r2(fuel.filter((f) => f.fuel_source === "Müşteri Verdi").reduce((n, f) => n + (Number(f.liters) || 0), 0));
    const maintTL = r2(maint.reduce((n, m) => n + (Number(m.cost) || 0), 0)), expTL = r2(exps.reduce((n, e) => n + (Number(e.amount) || 0), 0));
    const dumpTL = r2(ws.reduce((n, x) => n + x.dump, 0));
    const trips = r2(ws.filter((x) => x.unit === "Sefer").reduce((n, x) => n + x.qty, 0)), hours = r2(ws.filter((x) => x.unit === "Saat").reduce((n, x) => n + x.qty, 0));
    R.kpis = [...workKpis(ws, { dump: false }),
      ["Yakıt", `${num(fuelL)} L${custL ? ` (${num(custL)} L müşteriden)` : ""} · ${tl(fuelTL)}`, true],
      ...(trips && fuelL ? [["Sefer başı yakıt", num(r2(fuelL / trips)) + " L", true]] : []),
      ...(hours && fuelL && !trips ? [["Saat başı yakıt", num(r2(fuelL / hours)) + " L", true]] : []),
      ["Bakım / onarım", tl(maintTL), true], ["Diğer giderler", tl(expTL), true], ...(dumpTL ? [["Döküm maliyeti", tl(dumpTL), true]] : []),
      ["Kalan (gelir − giderler)", tl(r2(income - fuelTL - maintTL - expTL - dumpTL)), true]];
    R.notes.push("Kalan; personel maaşı, amortisman, sigorta ve vergi hariçtir. Müşterinin verdiği mazot gider sayılmaz.");
    R.tables.push(workTable("İş dökümü", ws, ["date", ...(id ? [] : ["vehicle"]), "personnel", "customer", "site", "type", "qty", "material", "route", "ton", "slip", "price", "amount", "dump"]));
    R.tables.push({ title: "Yakıt kayıtları", internal: true, headers: ["Tarih", ...(id ? [] : ["Araç"]), "Personel", "Litre", "Birim fiyat", "Tutar", "Kaynak", "Km", "Saat", "Not"], widths: [9, ...(id ? [] : [10]), 10, 7, 8, 10, 12, 8, 7, 18],
      rows: fuel.map((f) => [trDate(f.date), ...(id ? [] : [nm("vehicles", f.vehicle_id)]), nm("personnel", f.personnel_id), num(f.liters), f.unit_price ? tl(f.unit_price) : "", f.total ? tl(f.total) : "", f.fuel_source || "", f.km ? num(f.km) : "", f.machine_hours ? num(f.machine_hours) : "", f.description || f.note || ""]),
      link: fuel.map((f) => "#/yakit/" + f.id) });
    R.tables.push({ title: "Bakım / arıza", internal: true, headers: ["Tarih", ...(id ? [] : ["Araç"]), "Tür", "Durum", "Açıklama", "Servis", "Km", "Maliyet"], widths: [9, ...(id ? [] : [10]), 11, 9, 30, 13, 8, 10],
      rows: maint.map((m) => [trDate(m.date), ...(id ? [] : [nm("vehicles", m.vehicle_id)]), m.maint_type || "", m.status || "", m.description || "", m.service_company || nm("suppliers", m.supplier_id), m.km ? num(m.km) : "", m.cost ? tl(m.cost) : ""]),
      link: maint.map((m) => "#/bakim/" + m.id) });
    if (exps.length) R.tables.push({ title: "Araca yazılan giderler", internal: true, headers: ["Tarih", ...(id ? [] : ["Araç"]), "Kategori", "Firma", "Açıklama", "Ödeme", "Tutar"], widths: [9, ...(id ? [] : [10]), 12, 14, 30, 12, 10],
      rows: exps.map((e) => [trDate(e.date), ...(id ? [] : [nm("vehicles", e.vehicle_id)]), e.category || "", e.company || "", e.description || "", e.payment_method || "", tl(e.amount)]) });
    if (!id) {
      const vs = live(d, "vehicles");
      R.tables.push({ title: "Araç bazında özet", internal: true, headers: ["Araç", "İş", "Gelir", "Yakıt L", "Yakıt ₺", "Bakım", "Gider", "Döküm", "Kalan"], widths: [16, 6, 12, 9, 11, 11, 11, 11, 13],
        rows: vs.map((v) => {
          const w2 = ws.filter((x) => x.w.vehicle_id === v.id), f2 = fuel.filter((f) => f.vehicle_id === v.id), m2 = maint.filter((m) => m.vehicle_id === v.id), e2 = exps.filter((e) => e.vehicle_id === v.id);
          const inc = r2(w2.reduce((n, x) => n + x.amount, 0)), fT = r2(f2.filter((f) => f.fuel_source !== "Müşteri Verdi").reduce((n, f) => n + (Number(f.total) || 0), 0));
          const mT = r2(m2.reduce((n, m) => n + (Number(m.cost) || 0), 0)), eT = r2(e2.reduce((n, e) => n + (Number(e.amount) || 0), 0)), dT = r2(w2.reduce((n, x) => n + x.dump, 0));
          if (!w2.length && !f2.length && !m2.length && !e2.length) return null;
          return [v.name, String(w2.length), tl(inc), num(f2.reduce((n, f) => n + (Number(f.liters) || 0), 0)), tl(fT), tl(mT), tl(eT), tl(dT), tl(r2(inc - fT - mT - eT - dT))];
        }).filter(Boolean) });
    }
    R.tables.push(groupTable("Müşteriye göre", ws, (x) => x.customer, "Müşteri", { dump: true }));
    R.tables.push(groupTable("Aylara göre", ws, monthKey, "Ay", { dump: true }));
    if (id) {
      const docs = live(d, "documents").filter((x) => (x.vehicle_id || (x.owner_type === "vehicle" && x.owner_id)) === id).sort((a, b) => String(b.expiry_date || "").localeCompare(String(a.expiry_date || "")));
      if (docs.length) R.tables.push({ title: "Belgeler", headers: ["Belge", "No", "Tarih", "Bitiş", "Durum"], widths: [30, 20, 15, 15, 20],
        rows: docs.map((x) => [x.category || "", x.doc_no || "", trDate(x.date), trDate(x.expiry_date), !x.expiry_date ? "Süresiz" : x.expiry_date < today ? "Süresi geçmiş" : "Geçerli"]) });
    }
  } else if (k === "personel") {
    const psel = (r) => (id ? r.personnel_id === id : !!r.personnel_id);
    const ws = winfo(works.filter(psel));
    const ev = live(d, "personnel_events").filter((e) => psel(e) && inR(e.date)).sort(byDate);
    const pay = live(d, "payroll_entries").filter((e) => psel(e) && inR(e.date)).sort(byDate);
    const exps = live(d, "expense_records").filter((e) => psel(e) && inR(e.date)).sort(byDate);
    const fuel = live(d, "fuel_records").filter((f) => psel(f) && inR(f.date)).sort(byDate);
    if (card) R.info = infoPairs(card, [["name", "Personel"], ["role", "Görev"], ["phone", "Telefon"], ["employment_date", "İşe giriş", (r) => trDate(r.employment_date)], ["vehicle_id", "Aracı", (r) => nm("vehicles", r.vehicle_id)], ["license_class", "Ehliyet sınıfı"], ["pay_type", "Ücret tipi"]]);
    const sum = (xs, f) => r2(xs.reduce((n, x) => n + (Number(f(x)) || 0), 0));
    const adv = sum(ev.filter((e) => e.event_type === "Avans"), (e) => e.amount) + sum(pay.filter((p) => p.kind === "Avans"), (p) => p.amount);
    R.kpis = [...workKpis(ws, { dump: false }).filter(([l]) => !/tutar|fiyatsız|mazot/i.test(l)),
      ["Çalıştı / izin / devamsızlık", `${ev.filter((e) => e.event_type === "Çalıştı").length} / ${ev.filter((e) => e.event_type === "İzin").length} / ${ev.filter((e) => e.event_type === "Devamsızlık").length}`],
      ["Mesai", num(sum(ev.filter((e) => e.event_type === "Mesai"), (e) => e.hours_days)) + " saat"],
      ["Avans", tl(adv), true], ["Ücret tahakkuku", tl(sum(pay.filter((p) => p.kind === "Ücret Tahakkuku"), (p) => p.amount)), true],
      ["Ücret ödemesi", tl(sum(pay.filter((p) => p.kind === "Ücret Ödemesi"), (p) => p.amount)), true],
      ["Cebinden ödediği (bekleyen)", tl(sum(exps.filter((e) => e.reimbursement_status === "Bekliyor"), (e) => e.amount)), true]];
    R.tables.push(workTable("Yaptığı işler", ws, ["date", ...(id ? [] : ["personnel"]), "vehicle", "customer", "site", "type", "qty", "material", "route", "ton", "slip", "note"]));
    R.tables.push({ title: "Puantaj ve hareketler", headers: ["Tarih", ...(id ? [] : ["Personel"]), "Hareket", "Saat / gün", "Tutar", "Açıklama"], widths: [10, ...(id ? [] : [14]), 14, 10, 12, 40],
      rows: ev.map((e) => [trDate(e.date), ...(id ? [] : [nm("personnel", e.personnel_id)]), e.event_type || "", e.hours_days ? num(e.hours_days) : "", e.amount ? tl(e.amount) : "", e.description || ""]) });
    R.tables.push({ title: "Ücret / avans defteri", internal: true, headers: ["Tarih", ...(id ? [] : ["Personel"]), "Dönem", "Tür", "Şekil", "Tutar", "Not"], widths: [10, ...(id ? [] : [14]), 9, 16, 10, 12, 29],
      rows: pay.map((p) => [trDate(p.date), ...(id ? [] : [nm("personnel", p.personnel_id)]), p.period || "", p.kind || "", p.method || "", tl(p.amount), p.note || ""]) });
    if (exps.length) R.tables.push({ title: "Giderler (personel adına)", internal: true, headers: ["Tarih", "Kategori", "Açıklama", "Ödeme", "İade", "Tutar"], widths: [10, 14, 38, 14, 12, 12],
      rows: exps.map((e) => [trDate(e.date), e.category || "", e.description || e.company || "", e.payment_method || "", e.reimbursement_status || "", tl(e.amount)]) });
    if (fuel.length) R.tables.push({ title: "Aldığı yakıt", internal: true, headers: ["Tarih", "Araç", "Litre", "Tutar", "Kaynak"], widths: [12, 20, 12, 16, 40],
      rows: fuel.map((f) => [trDate(f.date), nm("vehicles", f.vehicle_id), num(f.liters), f.total ? tl(f.total) : "", f.fuel_source || ""]) });
    if (!id) R.tables.push(groupTable("Personele göre işler", ws, (x) => x.personnel, "Personel"));
  } else if (k === "esnaf") {
    const ssel = (pid) => (id ? pid === id : !!pid);
    const bills = live(d, "payables").filter((b) => b.party_type === "supplier" && ssel(b.party_id) && b.status !== "İptal" && inR(b.date)).sort(byDate);
    const pays = live(d, "supplier_payments").filter((p) => ssel(p.party_id) && inR(p.date)).sort(byDate);
    const maint = live(d, "maintenance_records").filter((m) => ssel(m.supplier_id) && inR(m.date)).sort(byDate);
    if (card) R.info = infoPairs(card, [["name", "Esnaf / tedarikçi"], ["type", "Tür"], ["category", "Kategori"], ["contact", "Yetkili"], ["phone", "Telefon"], ["address", "Adres"], ["iban", "IBAN"]]);
    const total = r2(bills.reduce((n, b) => n + (Number(b.gross_total) || 0), 0)), paid = r2(pays.reduce((n, p) => n + (Number(p.amount) || 0), 0));
    const allBills = live(d, "payables").filter((b) => b.party_type === "supplier" && ssel(b.party_id) && b.status !== "İptal");
    const allPaid = live(d, "supplier_payments").filter((p) => ssel(p.party_id));
    R.kpis = [["Alış / borç (dönem)", tl(total)], ["Ödeme (dönem)", tl(paid)], ["Kalan borç (bugün)", tl(r2(allBills.reduce((n, b) => n + (Number(b.gross_total) || 0), 0) - allPaid.reduce((n, p) => n + (Number(p.amount) || 0), 0)))], ["Alış belgesi", String(bills.length)]];
    const ent = [...bills.map((b) => ({ date: b.date, created_at: b.created_at, t: "Alış", party: b.party_id, text: [b.cost_category, b.items?.[0]?.description || b.description, nm("vehicles", b.vehicle_id)].filter(Boolean).join(" · "), debt: Number(b.gross_total) || 0, pay: 0 })),
      ...pays.map((p) => ({ date: p.date, created_at: p.created_at, t: "Ödeme", party: p.party_id, text: [p.method, p.note].filter(Boolean).join(" · "), debt: 0, pay: Number(p.amount) || 0 }))].sort(byDate);
    let bal = 0;
    R.tables.push({ title: "Hesap hareketleri", headers: ["Tarih", ...(id ? [] : ["Esnaf"]), "İşlem", "Açıklama", "Borç", "Ödeme", "Bakiye"], widths: [10, ...(id ? [] : [14]), 9, 35, 12, 12, 12],
      rows: ent.map((e) => { bal = r2(bal + e.debt - e.pay); return [trDate(e.date), ...(id ? [] : [nm("suppliers", e.party)]), e.t, e.text, e.debt ? tl(e.debt) : "", e.pay ? tl(e.pay) : "", tl(bal)]; }) });
    if (maint.length) R.tables.push({ title: "Yaptığı bakım / onarımlar", headers: ["Tarih", "Araç", "Tür", "Açıklama", "Maliyet"], widths: [10, 14, 14, 48, 14],
      rows: maint.map((m) => [trDate(m.date), nm("vehicles", m.vehicle_id), m.maint_type || "", m.description || "", m.cost ? tl(m.cost) : ""]) });
    if (!id) {
      const g = new Map();
      for (const e of ent) { const o = g.get(e.party) || { debt: 0, pay: 0 }; o.debt += e.debt; o.pay += e.pay; g.set(e.party, o); }
      R.tables.push({ title: "Esnafa göre", headers: ["Esnaf", "Alış", "Ödeme", "Fark"], widths: [40, 20, 20, 20], rows: [...g.entries()].map(([p, o]) => [nm("suppliers", p), tl(o.debt), tl(o.pay), tl(r2(o.debt - o.pay))]) });
    }
  } else if (k === "yakit") {
    const fuel = live(d, "fuel_records").filter((f) => (id ? f.vehicle_id === id : true) && inR(f.date)).sort(byDate);
    const tank = id ? [] : live(d, "fuel_tank_movements").filter((t) => inR(t.date)).sort(byDate);
    if (card) R.info = infoPairs(card, [["name", "Araç / makine"], ["type", "Tür"], ["tank_capacity", "Depo kapasitesi", (r) => (r.tank_capacity ? num(r.tank_capacity) + " L" : "")]]);
    const L = r2(fuel.reduce((n, f) => n + (Number(f.liters) || 0), 0));
    const paid = fuel.filter((f) => f.fuel_source !== "Müşteri Verdi");
    const TL = r2(paid.reduce((n, f) => n + (Number(f.total) || 0), 0)), pL = r2(paid.reduce((n, f) => n + (Number(f.liters) || 0), 0));
    R.kpis = [["Yakıt kaydı", String(fuel.length)], ["Toplam litre", num(L) + " L"], ["Ödenen tutar", tl(TL)], ...(pL ? [["Ortalama litre fiyatı", tl(r2(TL / pL))]] : []),
      ["Müşteriden alınan", num(r2(L - pL)) + " L"]];
    R.tables.push({ title: "Yakıt kayıtları", headers: ["Tarih", ...(id ? [] : ["Araç"]), "Personel", "Litre", "Birim fiyat", "Tutar", "Kaynak", "Müşteri / istasyon", "Km", "Saat"], widths: [9, ...(id ? [] : [11]), 10, 7, 8, 10, 12, 14, 8, 7],
      rows: fuel.map((f) => [trDate(f.date), ...(id ? [] : [nm("vehicles", f.vehicle_id)]), nm("personnel", f.personnel_id), num(f.liters), f.unit_price ? tl(f.unit_price) : "", f.total ? tl(f.total) : "", f.fuel_source || "", nm("customers", f.customer_id) || f.station || nm("suppliers", f.supplier_id), f.km ? num(f.km) : "", f.machine_hours ? num(f.machine_hours) : ""]),
      link: fuel.map((f) => "#/yakit/" + f.id) });
    const grp = (keyFn, label) => {
      const g = new Map();
      for (const f of fuel) { const kk = keyFn(f) || "—"; const o = g.get(kk) || { n: 0, L: 0, TL: 0 }; o.n++; o.L += Number(f.liters) || 0; o.TL += f.fuel_source !== "Müşteri Verdi" ? Number(f.total) || 0 : 0; g.set(kk, o); }
      return { title: label + "e göre", headers: [label, "Kayıt", "Litre", "Tutar"], widths: [40, 15, 20, 25], rows: [...g.entries()].sort((a, b) => b[1].L - a[1].L).map(([kk, o]) => [kk, String(o.n), num(r2(o.L)), tl(r2(o.TL))]) };
    };
    if (!id) R.tables.push(grp((f) => nm("vehicles", f.vehicle_id), "Araç"));
    R.tables.push(grp((f) => f.fuel_source, "Kaynak"));
    R.tables.push(grp((f) => monthName(String(f.date).slice(0, 7)), "Ay"));
    if (tank.length) R.tables.push({ title: "Depo tankı hareketleri", headers: ["Tarih", "Hareket", "Litre", "Tutar", "Araç / tedarikçi", "Not"], widths: [10, 10, 10, 14, 24, 32],
      rows: tank.map((t) => [trDate(t.date), t.move_type || "", num(t.liters), t.total ? tl(t.total) : "", nm("vehicles", t.vehicle_id) || nm("suppliers", t.supplier_id), t.description || t.note || ""]) });
  } else if (k === "gider") {
    const exps = live(d, "expense_records").filter((e) => (id ? fold(e.category) === fold(id) : true) && inR(e.date)).sort(byDate);
    R.info = [["Gider", id || K.all]];
    const T = r2(exps.reduce((n, e) => n + (Number(e.amount) || 0), 0));
    R.kpis = [["Gider kaydı", String(exps.length)], ["Toplam", tl(T)]];
    R.tables.push({ title: "Gider kayıtları", headers: ["Tarih", ...(id ? [] : ["Kategori"]), "Firma", "Fatura No", "Açıklama / kalemler", "Araç", "Personel", "Ödeme", "Tutar"], widths: [9, ...(id ? [] : [10]), 12, 10, 24, 9, 9, 9, 10],
      rows: exps.map((e) => [trDate(e.date), ...(id ? [] : [e.category || ""]), e.company || nm("suppliers", e.supplier_id), e.invoice_no || "", [e.description, Array.isArray(e.items) && e.items.length ? e.items.map((i) => i.desc).join(", ") : ""].filter(Boolean).join(" — ").slice(0, 300), nm("vehicles", e.vehicle_id), nm("personnel", e.personnel_id), e.payment_method || "", tl(e.amount)]),
      link: exps.map((e) => "#/gider/" + e.id) });
    const grp = (keyFn, label) => { const g = new Map(); for (const e of exps) { const kk = keyFn(e) || "—"; const o = g.get(kk) || { n: 0, T: 0 }; o.n++; o.T += Number(e.amount) || 0; g.set(kk, o); } return { title: label + "e göre", headers: [label, "Kayıt", "Tutar", "Pay"], widths: [45, 15, 25, 15], rows: [...g.entries()].sort((a, b) => b[1].T - a[1].T).map(([kk, o]) => [kk, String(o.n), tl(r2(o.T)), T ? "%" + num(r2((o.T / T) * 100)) : ""]) }; };
    if (!id) R.tables.push(grp((e) => e.category, "Kategori"));
    R.tables.push(grp((e) => nm("vehicles", e.vehicle_id), "Araç"));
    R.tables.push(grp((e) => e.payment_method, "Ödeme şekl"));
    R.tables.push(grp((e) => monthName(String(e.date).slice(0, 7)), "Ay"));
  } else if (k === "bakim") {
    const maint = live(d, "maintenance_records").filter((m) => (id ? m.vehicle_id === id : true) && inR(m.date)).sort(byDate);
    if (card) R.info = infoPairs(card, [["name", "Araç / makine"], ["type", "Tür"], ["brand", "Marka"], ["model_year", "Model yılı"], ["km", "Km (kart)", (r) => (r.km ? num(r.km) : "")]]);
    const T = r2(maint.reduce((n, m) => n + (Number(m.cost) || 0), 0));
    R.kpis = [["Bakım / arıza kaydı", String(maint.length)], ["Toplam maliyet", tl(T)], ["Açık (tamamlanmamış)", String(maint.filter((m) => m.status && !/tamam|kapandı|bitti/i.test(m.status)).length)]];
    R.tables.push({ title: "Bakım / arıza kayıtları", headers: ["Tarih", ...(id ? [] : ["Araç"]), "Tür", "Durum", "Açıklama", "Servis / esnaf", "Km / saat", "Maliyet"], widths: [9, ...(id ? [] : [10]), 11, 9, 30, 13, 8, 10],
      rows: maint.map((m) => [trDate(m.date), ...(id ? [] : [nm("vehicles", m.vehicle_id)]), m.maint_type || "", m.status || "", m.description || "", m.service_company || nm("suppliers", m.supplier_id), m.km ? num(m.km) + " km" : m.machine_hours ? num(m.machine_hours) + " sa" : "", m.cost ? tl(m.cost) : ""]),
      link: maint.map((m) => "#/bakim/" + m.id) });
    const grp = (keyFn, label) => { const g = new Map(); for (const m of maint) { const kk = keyFn(m) || "—"; const o = g.get(kk) || { n: 0, T: 0 }; o.n++; o.T += Number(m.cost) || 0; g.set(kk, o); } return { title: label + "e göre", headers: [label, "Kayıt", "Maliyet"], widths: [50, 20, 30], rows: [...g.entries()].sort((a, b) => b[1].T - a[1].T).map(([kk, o]) => [kk, String(o.n), tl(r2(o.T))]) }; };
    if (!id) R.tables.push(grp((m) => nm("vehicles", m.vehicle_id), "Araç"));
    R.tables.push(grp((m) => m.maint_type, "Tür"));
    R.tables.push(grp((m) => m.service_company || nm("suppliers", m.supplier_id), "Servis / esnaf"));
  }
  R.tables = R.tables.filter((t) => t.rows.length);
  return R;
}

// Karşı tarafa verilecek nüshada maliyet sütunları / tabloları / rakamları çıkarılır
export function forAudience(R, audience = "internal") {
  if (audience === "internal") return R;
  const tables = R.tables.filter((t) => !t.internal).map((t) => {
    if (!t.internalCols?.some(Boolean)) return t;
    const keep = t.internalCols.map((x) => !x);
    const pick = (a) => a.filter((_, i) => keep[i]);
    return { ...t, headers: pick(t.headers), widths: pick(t.widths), internalCols: pick(t.internalCols), rows: t.rows.map(pick) };
  });
  return { ...R, kpis: R.kpis.filter((x) => !x[2]), tables, notes: R.notes.filter((n) => !/maliyet|gider|maaş/i.test(n)) };
}

// PDF tanımı (document-engine)
export function reportSpec(R, { audience = "internal", company = "" } = {}) {
  const A = forAudience(R, audience);
  const S = [];
  S.push({ title: "Rapor Bilgileri", pairs: [["Rapor", `${A.kind} raporu`], [A.kind, A.name], ["Dönem", A.period], ...A.info.filter(([l]) => l !== A.kind)] });
  if (A.kpis.length) S.push({ title: "Özet", pairs: A.kpis.map(([l, v]) => [l, v]) });
  // Tutar / ton / litre sütunları sağa yaslı
  const RIGHT = /tutar|fiyat|maliyet|ton$|litre|borç|ödeme|bakiye|alış|fark|gelir|yakıt|bakım|gider|döküm$|kalan|^iş$|kayıt|^km|saat$/i;
  for (const t of A.tables) S.push({ title: `${t.title} (${t.count ?? t.rows.length})`, headers: t.headers, widths: t.widths, rows: t.rows, align: t.headers.map((h) => (RIGHT.test(h) ? "right" : "left")) });
  for (const n of A.notes) S.push({ layout: "notice", text: n });
  S.push({ layout: "notice", text: `Bu rapor ${company || "işletme"} kayıtlarından ${new Date().toLocaleDateString("tr-TR")} tarihinde hazırlanmıştır. Fiyatı girilmemiş işler tutara katılmamıştır.` });
  const slug = String(A.name || "").replace(/[^\wÇĞİÖŞÜçğıöşü]+/g, "_").slice(0, 40);
  return { template: "report", title: `${A.name} — ${A.kind} Raporu`, audience: audience === "internal" ? "internal" : "customer", orientation: "landscape",
    filename: `Rapor_${A.kind.replace(/[^\wÇĞİÖŞÜçğıöşü]+/g, "_")}_${slug}_${A.to || ""}.pdf`, sections: S };
}

// CSV: tüm tablolar alt alta
export function reportCsv(R, audience = "internal") {
  const A = forAudience(R, audience);
  const q = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const out = [[`${A.kind} raporu`, A.name, A.period].map(q).join(";"), ""];
  for (const t of A.tables) out.push(q(t.title), t.headers.map(q).join(";"), ...t.rows.map((r) => r.map(q).join(";")), "");
  return "﻿" + out.join("\n");
}
