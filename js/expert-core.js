// Yönetim uzmanı: hafriyat / nakliye / iş makinesi kiralama işletmesi için saf göstergeler (KPI) ve sektör bilgisi.
// Rakamlar burada hesaplanır; yapay zekâ yalnız yorumlar ve öneri yazar (rakamlar doğrulanır).
import { isActive, todayStr, addDays } from "./core.js";
import { workAmount, receivables } from "./collect-core.js";
import { dumpFee } from "./dump-fees.js";
import { fuelPrice } from "./finance-chart.js";

const live = (d, s) => (d[s] || []).filter(isActive);
const r0 = (n) => Math.round(n);
const r1 = (n) => Math.round(n * 10) / 10;
const nm = (d, s, id) => (id ? live(d, s).find((x) => x.id === id)?.name || "" : "");

// Sektör bilgisi — asistan, soru-cevap ve danışman bu çerçeveyle düşünür
export const EXPERT_KNOWLEDGE = [
  "SEKTÖR BİLGİSİ (hafriyat, kamyon/tır nakliye, iş makinesi kiralama — İstanbul):",
  "• Birimler: Sefer (kamyon/tır taşıma), Saat (ekskavatör, JCB, manitou, mini kato, vinç), Yevmiye (günlük makine/operatör), Ton (kantarlı malzeme), m³. Yarım yevmiye = 0,5. Saatlik kiralamada çoğu zaman en az 4–5 saat (yarım gün) yazılır; mola ve yolda geçen süre ayrıca konuşulur.",
  "• Kiralama şekilleri: operatörlü/operatörsüz, yakıt dahil/hariç. Makinenin şantiyeye götürülmesi (lowbed nakliye, mobilizasyon) ayrı bir kalemdir; unutulursa zarar edilir.",
  "• 'Döküm dahil' fiyat: döküm sahası ücretini nakliyeci öder; kâr = sefer fiyatı − döküm ücreti − mazot − şoför/araç gideri. Resmi sahalar ton başı ücret alır (Bolluca 160, Cebeci 210, İSTAÇ 235 ₺/ton KDV dahil); tır ~27 ton, kamyon ~22 ton taşır. Dolgu yerleri pazarlıkla.",
  "• Malzeme nakliyesi (mıcır, kum, gravak): ocaktan kantar fişiyle alınır; fiyat sefer ya da ton başıdır; fişteki net ton esas.",
  "• Mazot karşılığı iş: bazı müşteriler ücreti mazotla öder (ör. Kılıç, sefer başı 75 L); her araç birkaç seferde bir kendi hakkını doğrudan deposuna alır. Bu işler TL gelir, alınan mazot da TL masraf SAYILMAZ; alacak litre olarak izlenir. Araç kârında bu işler 0 ₺ görünür: aracı yalnız TL kârına bakıp zararda sanma, mazot karşılığı litreyi de söyle.",
  "• Taşeron: ana firmanın işini yapan alt yüklenici; işi kim istediyse o öder, taşeron adı geçmiyorsa ana firma.",
  "• Kendi depo: kamyonet müşteriden döküm dahil alıp depoya döker; birikince tır/kamyonla resmi sahaya gider — depo kârı = gelen işler − çıkış döküm ücretleri.",
  "• Yönetim ölçüleri: araç başı aylık kâr; doluluk (çalışılan gün / iş günü, %70 altı düşük); günlük getiri; sefer başı / saat başı fiyat ortalaması ve altında kalan müşteriler; mazot verimi (L/sefer, L/saat — ani artış kaçak/arıza/yanlış kayıt belirtisi); tahsilat süresi (60 gün üstü risk, 90 üstü acil); fiyatsız iş = kayıp gelir; bakım masrafı yüksek eski araç = değiştirme/satma adayı.",
  "• Öneri verirken: önce para (tahsilat, fiyatı düşük iş, fiyatsız iş), sonra boş duran makine, sonra yakıt/bakım. Somut kişi/araç adı ve rakamla konuş; rakam uydurma.",
].join("\n");

// İş günü (pazar hariç)
export function workDays(from, to) {
  let n = 0;
  for (let x = from; x <= to; x = addDays(x, 1)) if (new Date(x + "T12:00:00").getDay() !== 0) n++;
  return n;
}

export function vehicleKpis(d, { from, to = todayStr(), fuelRefPrice = null } = {}) {
  const inR = (x) => x && x >= from && x <= to;
  const days = workDays(from, to);
  const rows = [];
  for (const v of live(d, "vehicles")) {
    const ws = live(d, "work_records").filter((w) => w.vehicle_id === v.id && inR(w.date));
    const fuel = live(d, "fuel_records").filter((f) => f.vehicle_id === v.id && inR(f.date));
    const lastAll = live(d, "work_records").filter((w) => w.vehicle_id === v.id).map((w) => w.date).sort().at(-1) || null;
    if (!ws.length && !fuel.length && !lastAll) continue;
    // Mazotla ödenen işler TL gelir sayılmaz; müşterinin verdiği mazot da masraf sayılmaz (ikisi litre olarak ayrı)
    let revenue = 0, earnedL = 0;
    for (const w of ws) { revenue += workAmount(w); earnedL += Number(w.customer_fuel_allowance_l) || 0; }
    let fuelCost = 0, liters = 0, gotL = 0;
    for (const f of fuel) {
      liters += Number(f.liters) || 0;
      if (f.fuel_source === "Müşteri Verdi" && !(Number(f.total) > 0)) gotL += Number(f.liters) || 0;
      else fuelCost += Number(f.total) || 0;
    }
    const maint = live(d, "maintenance_records").filter((m) => m.vehicle_id === v.id && inR(m.date)).reduce((n, m) => n + (Number(m.cost) || 0), 0);
    const expense = live(d, "expense_records").filter((e) => e.vehicle_id === v.id && inR(e.date)).reduce((n, e) => n + (Number(e.amount) || 0), 0);
    const dump = ws.reduce((n, w) => n + (dumpFee(d, w)?.amount || 0), 0);
    const worked = new Set(ws.map((w) => w.date)).size;
    const u = {};
    for (const w of ws) u[w.unit || "?"] = r1((u[w.unit || "?"] || 0) + (Number(w.quantity) || 0));
    const trips = u.Sefer || 0, hours = u.Saat || 0;
    const income = revenue, cost = fuelCost + maint + expense + dump;
    rows.push({
      id: v.id, arac: v.name, tur: v.type || "", is: ws.length, calisilan_gun: worked, is_gunu: days, doluluk_yuzde: days ? r0((worked / days) * 100) : 0,
      birimler: u, gelir_TL: r0(income), yakit_TL: r0(fuelCost), bakim_TL: r0(maint), gider_TL: r0(expense), dokum_TL: r0(dump), kar_TL: r0(income - cost),
      gunluk_getiri_TL: worked ? r0((income - cost) / worked) : 0, mazot_karsiligi_hak_L: r1(earnedL), musteriden_alinan_mazot_L: r1(gotL), litre: r1(liters), L_sefer: trips ? r1(liters / trips) : null, L_saat: hours ? r1(liters / hours) : null,
      fiyatsiz_is: ws.filter((w) => !workAmount(w) && !w.customer_fuel_allowance_l).length, son_is: lastAll, bos_gun: lastAll ? Math.max(0, Math.round((new Date(to) - new Date(lastAll)) / 86400000)) : null,
    });
  }
  return rows.sort((a, b) => b.kar_TL - a.kar_TL);
}

export function customerKpis(d, { from, to = todayStr(), today = todayStr(), notes = {} } = {}) {
  const inR = (x) => x && x >= from && x <= to;
  const rec = receivables(d, { today, notes });
  const rows = [];
  for (const c of live(d, "customers").filter((c) => !c.internal)) {
    const ws = live(d, "work_records").filter((w) => w.customer_id === c.id && inR(w.date));
    if (!ws.length) continue;
    const revenue = ws.reduce((n, w) => n + workAmount(w), 0);
    const dump = ws.reduce((n, w) => n + (dumpFee(d, w)?.amount || 0), 0);
    const collected = live(d, "cari_movements").filter((m) => m.customer_id === c.id && m.type === "Tahsilat" && inR(m.date)).reduce((n, m) => n - Number(m.amount), 0);
    const r = rec.rows.find((x) => x.id === c.id);
    const trips = ws.filter((w) => w.unit === "Sefer").reduce((n, w) => n + (Number(w.quantity) || 0), 0);
    rows.push({ id: c.id, musteri: c.name, is: ws.length, gelir_TL: r0(revenue), dokum_TL: r0(dump), dokum_sonrasi_TL: r0(revenue - dump), tahsilat_TL: r0(collected),
      acik_alacak_TL: r0(r?.total || 0), en_eski_gun: r?.oldest_days || 0, sefer: trips, sefer_basi_net_TL: trips ? r0((ws.filter((w) => w.unit === "Sefer").reduce((n, w) => n + workAmount(w) - (dumpFee(d, w)?.amount || 0), 0)) / trips) : null,
      fiyatsiz_is: ws.filter((w) => !workAmount(w) && !w.customer_fuel_allowance_l).length, mazot_karsiligi_L: r1(ws.reduce((n, w) => n + (Number(w.customer_fuel_allowance_l) || 0), 0)) });
  }
  return rows.sort((a, b) => b.gelir_TL - a.gelir_TL);
}

// Aynı iş türü + birimde birim fiyatlar: ortalamanın %15 altında kalan müşteriler
export function priceCheck(d, { from, to = todayStr() } = {}) {
  const inR = (x) => x && x >= from && x <= to;
  const groups = {};
  for (const w of live(d, "work_records").filter((w) => inR(w.date))) {
    const a = workAmount(w), q = Number(w.quantity) || 0;
    if (!(a > 0) || !(q > 0)) continue;
    const k = `${w.work_type || "Diğer"} / ${w.unit}`;
    const g = (groups[k] ||= { is_turu: k, fiyatlar: [], musteri: {} });
    const unit = a / q;
    g.fiyatlar.push(unit);
    const c = nm(d, "customers", w.customer_id) || "—";
    (g.musteri[c] ||= []).push(unit);
  }
  return Object.values(groups).filter((g) => g.fiyatlar.length >= 2).map((g) => {
    const s = [...g.fiyatlar].sort((a, b) => a - b), med = s[Math.floor(s.length / 2)];
    const low = Object.entries(g.musteri).map(([m, xs]) => [m, xs.reduce((n, x) => n + x, 0) / xs.length]).filter(([, avg]) => avg < med * 0.85).map(([m, avg]) => ({ musteri: m, ortalama_TL: r0(avg) }));
    return { is_turu: g.is_turu, kayit: s.length, orta_fiyat_TL: r0(med), en_dusuk_TL: r0(s[0]), en_yuksek_TL: r0(s.at(-1)), dusuk_kalan_musteriler: low };
  }).sort((a, b) => b.kayit - a.kayit);
}

// Tek çağrıda işletme özeti (danışman ekranı ve yapay zekâ için)
export function businessReview(d, { from, to = todayStr(), today = todayStr(), notes = {}, fuelRefPrice = null } = {}) {
  const veh = vehicleKpis(d, { from, to, fuelRefPrice });
  const cus = customerKpis(d, { from, to, today, notes });
  const price = priceCheck(d, { from, to });
  const rec = receivables(d, { today, notes });
  const findings = [];
  for (const v of veh) {
    if (v.bos_gun != null && v.bos_gun >= 7) findings.push({ kind: "bos", text: `${v.arac} ${v.bos_gun} gündür iş kaydı yok` });
    else if (v.is_gunu >= 6 && v.doluluk_yuzde < 50 && v.is) findings.push({ kind: "doluluk", text: `${v.arac} doluluğu %${v.doluluk_yuzde} (${v.calisilan_gun}/${v.is_gunu} gün)` });
    if (v.kar_TL < 0 && v.is) findings.push({ kind: "zarar", text: `${v.arac} bu dönemde ${v.kar_TL.toLocaleString("tr-TR")} ₺ (gelir ${v.gelir_TL.toLocaleString("tr-TR")} − masraf)${v.mazot_karsiligi_hak_L ? ` · ayrıca ${v.mazot_karsiligi_hak_L.toLocaleString("tr-TR")} L mazot karşılığı iş yaptı (TL sayılmaz)` : ""}` });
    if (v.fiyatsiz_is) findings.push({ kind: "fiyatsiz", text: `${v.arac}: ${v.fiyatsiz_is} iş fiyatsız` });
  }
  for (const p of price) for (const l of p.dusuk_kalan_musteriler) findings.push({ kind: "fiyat", text: `${l.musteri} — ${p.is_turu} ortalama ${l.ortalama_TL.toLocaleString("tr-TR")} ₺ (genel orta ${p.orta_fiyat_TL.toLocaleString("tr-TR")} ₺)` });
  for (const r of rec.rows.filter((r) => r.oldest_days > 60).slice(0, 5)) findings.push({ kind: "tahsilat", text: `${r.name}: ${Math.round(r.total).toLocaleString("tr-TR")} ₺ alacak, en eskisi ${r.oldest_days} gün` });
  const sum = (a, k) => a.reduce((n, x) => n + (x[k] || 0), 0);
  return { from, to, ozet: { gelir_TL: sum(veh, "gelir_TL"), masraf_TL: sum(veh, "yakit_TL") + sum(veh, "bakim_TL") + sum(veh, "gider_TL") + sum(veh, "dokum_TL"), kar_TL: sum(veh, "kar_TL"), toplam_alacak_TL: r0(rec.total), alacak_90_TL: r0(rec.buckets.b90) }, araclar: veh, musteriler: cus, fiyat: price, bulgular: findings };
}
