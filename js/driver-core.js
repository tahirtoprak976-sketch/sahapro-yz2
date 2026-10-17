// Şoför ekranı — SAF katman. Telefonlar arası ücretsiz aktarım WhatsApp ile:
// Patron şoföre bir bağlantı gönderir (içinde şoför, araç, müşteri/şantiye/döküm listesi; sıkıştırılmış). Şoför kayıtlarını girer,
// "Patrona gönder" okunur bir metin + "SP1:" kodu (kayıtların kendisi) olarak WhatsApp'tan gider. Patronun asistanı kodu çözer:
// kartlar Gemini'siz, birebir dolar; aynı kayıt (kimlik) ikinci kez gelirse atlanır.
import { isActive, WORK_TYPES, EXPENSE_CATEGORIES, MAINT_TYPES } from "./core.js";

const live = (d, s) => (d[s] || []).filter(isActive);
const b64u = (bytes) => { let s = ""; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); };
const unb64u = (s) => { const t = atob(String(s).replace(/-/g, "+").replace(/_/g, "/") + "===".slice((String(s).length + 3) % 4)); const out = new Uint8Array(t.length); for (let i = 0; i < t.length; i++) out[i] = t.charCodeAt(i); return out; };
async function pipe(bytes, stream) { return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(stream)).arrayBuffer()); }
export async function pack(obj) { return b64u(await pipe(new TextEncoder().encode(JSON.stringify(obj)), new CompressionStream("deflate-raw"))); }
export async function unpack(code) { return JSON.parse(new TextDecoder().decode(await pipe(unb64u(code), new DecompressionStream("deflate-raw")))); }

export const DRIVER_TYPES = ["Hafriyat Nakliye", "Moloz Nakliye", "Mıcır Nakliye", "Kum Nakliye", "Çöp Nakliye", "Makine Çalışması", "Kazı", "Yükleme"].filter((t) => WORK_TYPES.includes(t));
export const DRIVER_UNITS = ["Sefer", "Saat", "Ton", "Yevmiye"];
export const FUEL_SOURCES = ["Depo Tankı", "Akaryakıt İstasyonu", "Müşteri Verdi"];
// Şoförün gideri: ne için (uygulamanın gider kategorileri) ve nasıl ödendi
export const DRIVER_EXP = [["Yemek", "🍽 Yemek"], ["Otoyol / HGS", "🛣 Otoyol / köprü"], ["Otopark", "🅿 Otopark"], ["Lastik", "🛞 Lastik"], ["Tamir", "🔧 Tamir"], ["Yedek Parça", "⚙ Yedek parça"], ["Yağ / Filtre", "🛢 Yağ / filtre"], ["Servis", "🧽 Yıkama / servis"], ["Malzeme", "📦 Malzeme"], ["Diğer", "… Diğer"]].filter(([c]) => EXPENSE_CATEGORIES.includes(c));
export const DRIVER_MAINT = [["Arıza", "⚠ Arıza"], ["Lastik", "🛞 Lastik"], ["Bakım", "🔧 Bakım"], ["Yağ", "🛢 Yağ değişimi"], ["Elektrik", "⚡ Elektrik"], ["Hidrolik", "💧 Hidrolik"], ["Motor", "⚙ Motor"], ["Kaporta", "🚚 Kaporta / kasa"], ["Diğer", "… Diğer"]].filter(([c]) => MAINT_TYPES.includes(c));
export const PAY_WAYS = { cep: "cebimden ödedim", sirket: "şirket parası / kart", veresiye: "veresiye (esnafa borç)" };

// Patronun telefonunda: şoför bağlantısının içeriği
export function driverConfig(d, { personnel_id, vehicle_id = null, company = "", issued = "" }) {
  const p = live(d, "personnel").find((x) => x.id === personnel_id);
  if (!p) throw new Error("Personel seçin");
  const cust = live(d, "customers").filter((c) => !c.internal).sort((a, b) => a.name.localeCompare(b.name, "tr")).slice(0, 400);
  const cs = new Set(cust.map((c) => c.id));
  return {
    v: 1, co: company, iss: issued, p: [p.id, p.name], veh: vehicle_id || p.vehicle_id || live(d, "vehicles").find((v) => v.assignee_id === p.id)?.id || null,
    V: live(d, "vehicles").map((v) => [v.id, v.plate && v.plate !== v.name ? `${v.name} (${v.plate})` : v.name]),
    C: cust.map((c) => [c.id, c.name]),
    S: live(d, "sites").filter((s) => cs.has(s.customer_id)).map((s) => [s.id, s.name, s.customer_id, s.contact || "", s.phone || ""]),
    D: live(d, "dump_sites").map((s) => [s.id, s.name]),
    Q: live(d, "quarries").map((s) => [s.id, s.name]),
    E: live(d, "suppliers").map((s) => [s.id, s.name]).slice(0, 150),
    Y: live(d, "customers").find((c) => c.internal)?.id || null,
  };
}

const nm = (list, id) => (list || []).find((x) => x[0] === id)?.[1] || "";
const fmtDate = (s) => { const [y, m, d] = String(s).split("-"); return `${d}.${m}.${y}`; };
export const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

// Okunur satır (patron ve grup okusun) — ad ve sayılar burada geçtiği için asistanın doğrulaması da geçer
export function entryLine(e, cfg) {
  const who = (e.sup ? nm(cfg.E, e.sup) : "") || e.sn || "";
  const pay = e.pay ? ` · ${PAY_WAYS[e.pay] || e.pay}` : "";
  if (e.k === "g") return `💸 ${fmtDate(e.date)} · ${e.cat} · ${e.tl} TL${who ? " · " + who : ""}${e.vid ? " · " + nm(cfg.V, e.vid) : ""}${pay}${e.desc ? " · " + e.desc : ""}${e.ph ? ` · 📷${e.ph}` : ""}`;
  if (e.k === "m") return `🔧 ${fmtDate(e.date)} · ${nm(cfg.V, e.vid)} · ${e.mt}: ${e.desc}${e.st === "Tamamlandı" ? " (yapıldı)" : " (arızalı)"}${e.tl ? ` · ${e.tl} TL` : ""}${who ? " · " + who : ""}${e.tl ? pay : ""}${e.km ? ` · km ${e.km}` : ""}${e.hr ? ` · saat ${e.hr}` : ""}${e.ph ? ` · 📷${e.ph}` : ""}`;
  if (e.k === "f") return `⛽ ${fmtDate(e.date)} · ${nm(cfg.V, e.vid)} · ${e.L} litre · ${e.src === "Müşteri Verdi" ? (nm(cfg.C, e.cid) || "müşteri") + " verdi" : e.src === "Depo Tankı" ? "depodan" : "istasyondan"}${e.tl ? ` · ${e.tl} TL` : ""}${e.km ? ` · km ${e.km}` : ""}${e.hr ? ` · saat ${e.hr}` : ""}`;
  const cust = e.cid === cfg.Y ? "kendi depodan çıkış" : nm(cfg.C, e.cid) || e.cn || "müşteri ?";
  const dump = nm(cfg.D, e.ds) || e.dn || "";
  const dfs = e.dfs ? ` · 🧾 dijital fiş ${e.dfs}${e.rcv ? " (imzalayan: " + e.rcv + ")" : ""}` : "";
  return `🚚 ${fmtDate(e.date)} · ${nm(cfg.V, e.vid)} · ${cust}${e.sid ? " / " + nm(cfg.S, e.sid) : ""} · ${e.wt} ${e.q} ${String(e.u).toLocaleLowerCase("tr-TR")}${e.mat ? " " + e.mat : ""}${dump ? " → " + dump : ""}${e.ton ? ` · ${e.ton} ton` : ""}${e.slip ? ` · fiş ${e.slip}` : ""}${e.ph ? ` · 📷${e.ph}` : ""}${e.note ? ` · ${e.note}` : ""}${dfs}`;
}
export async function driverMessage(entries, cfg) {
  const code = await pack({ v: 1, p: cfg.p[0], n: cfg.p[1], ...(cfg.lid ? { lid: cfg.lid } : {}), e: entries.map(({ sent, ...e }) => e) });
  // İmzalı bağlantı: kod, bağlantının gizli anahtarıyla imzalanır (patron telefonu doğrular; değiştirilen kod işlenmez)
  const sig = cfg.ls ? "." + (await (await import("./security-core.js")).hmac(cfg.ls, code)) : "";
  return [`📋 SAHAPRO şoför kaydı — ${cfg.p[1]}`, ...entries.map((e) => entryLine(e, cfg)), `SP1:${code}${sig}`].join("\n");
}

// WhatsApp'a paylaşılan / kopyalanan metin yaklaşık 4 KB'ta kesilebiliyor (kesilen kod açılmaz).
// Mesaj bu sınırın altında tutulur; fazlası sonraki mesaja kalır.
export const MSG_LIMIT = 3600;
export const msgBytes = (s) => new TextEncoder().encode(String(s || "")).length;
// İmza çizgileri (600×220 tuvalde): yakın noktalar atılır, yarı çözünürlükte ilk nokta + farklar olarak saklanır.
// Tipik imza ~1 KB tutar; resim yerine bu gönderilir, patron tarafında yeniden çizilir.
export function encodeStrokes(strokes, minDist = 4) {
  const out = [];
  for (const st of strokes || []) {
    const pts = [];
    for (let i = 0; i < st.length; i += 2) {
      const x = st[i], y = st[i + 1], L = pts.length;
      if (L && Math.hypot(x - pts[L - 2], y - pts[L - 1]) < minDist && i < st.length - 2) continue;
      pts.push(x, y);
    }
    if (!pts.length) continue;
    const q = pts.map((v) => Math.round(v / 2));
    const enc = [q[0], q[1]];
    for (let i = 2; i < q.length; i += 2) enc.push(q[i] - q[i - 2], q[i + 1] - q[i - 1]);
    out.push(enc);
  }
  return out;
}
export function decodeStrokes(sv) {
  if (!Array.isArray(sv)) return [];
  return sv.filter((s) => Array.isArray(s) && s.length >= 2 && s.every(Number.isFinite)).slice(0, 200).map((s) => {
    const pts = [s[0] * 2, s[1] * 2];
    for (let i = 2; i + 1 < s.length; i += 2) pts.push(pts[i - 2] + s[i] * 2, pts[i - 1] + s[i + 1] * 2);
    return pts;
  });
}

// Patronun tarafı: metindeki kodlar
const CODE = /SP1:([A-Za-z0-9_-]{8,})(?:\.([A-Za-z0-9_-]{16,}))?/g;
export async function extractPayloads(text) {
  const out = [];
  for (const m of String(text || "").matchAll(CODE)) { try { const p = await unpack(m[1]); if (p?.v === 1 && Array.isArray(p.e)) out.push({ ...p, _code: m[1], _sig: m[2] || null }); } catch (e) { /* bozuk kod: atla */ } }
  return out;
}
// Şoför mesajlarının okunur kısmı ve kod satırı çıkarılınca kalan serbest metin (Gemini'ye yalnız bu gider)
export function stripDriverBlocks(text) {
  return String(text || "").split("\n").filter((l) => !/SAHAPRO şoför kaydı|SP1:[A-Za-z0-9_-]{8,}|^(?:\[[^\]]*\]\s*[^:]{1,60}:\s*)?[🚚⛽💸🔧] \d{2}\.\d{2}\.\d{4} · /u.test(l)).join("\n").trim();
}

// Kodlardan asistan planı (Gemini'nin döndürdüğü biçimle aynı) + her işin ek bilgisi (kimlik, fotoğraf, ton)
export function payloadsToPlan(payloads, d, { photoCount = 0 } = {}) {
  const works = [], fuel = [], meta = [], fuelMeta = [], expenses = [], expMeta = [], maintenance = [], mainMeta = [];
  let photo = 0;
  const has = (s, id) => !!id && live(d, s).some((x) => x.id === id);
  // Fotoğraflar şoförün gönderdiği sırayla (kayıt sırası) dağıtılır
  const takePhotos = (n) => { const out = []; for (let i = 0; i < (Number(n) || 0) && photo < photoCount; i++) out.push(photo++); return out; };
  for (const p of payloads) for (const e of p.e) {
    const supId = has("suppliers", e.sup) ? e.sup : null;
    const supName = supId ? live(d, "suppliers").find((x) => x.id === supId).name : e.sn || "";
    if (e.k === "g") {
      const ph = takePhotos(e.ph);
      expenses.push({ date: e.date, amount: Number(e.tl) || null, category: e.cat, company: supName, vehicle_id: has("vehicles", e.vid) ? e.vid : null, supplier_id: e.pay === "veresiye" ? supId : null, credit: e.pay === "veresiye", photo: ph[0] ?? null, note: [e.desc, e.pay === "cep" ? "şoför cebinden ödedi" : ""].filter(Boolean).join(" · ") });
      expMeta.push({ driver_entry_id: e.id, pay: e.pay || null, personnel_id: has("personnel", p.p) ? p.p : null });
      continue;
    }
    if (e.k === "m") {
      const ph = takePhotos(e.ph);
      maintenance.push({ date: e.date, vehicle_id: has("vehicles", e.vid) ? e.vid : null, maint_type: e.mt, status: e.st === "Tamamlandı" ? "Tamamlandı" : "Açık", description: e.desc || e.mt, cost: Number(e.tl) || null, service_company: supName, supplier_id: e.pay === "veresiye" ? supId : null, credit: e.pay === "veresiye" && !!Number(e.tl) });
      mainMeta.push({ driver_entry_id: e.id, pay: e.pay || null, personnel_id: has("personnel", p.p) ? p.p : null, photos: ph, km: Number(e.km) || null, hours: Number(e.hr) || null });
      continue;
    }
    if (e.k === "f") {
      fuel.push({ date: e.date, vehicle_id: has("vehicles", e.vid) ? e.vid : null, liters: Number(e.L) || null, total: Number(e.tl) || null, km: Number(e.km) || null, machine_hours: Number(e.hr) || null, source: FUEL_SOURCES.includes(e.src) ? e.src : "Depo Tankı", customer_id: has("customers", e.cid) ? e.cid : null, photo: null });
      fuelMeta.push({ driver_entry_id: e.id });
      continue;
    }
    const photos = takePhotos(e.ph);
    // İmzalı dijital fişin imza görüntüsü: işin fotoğraflarından hemen sonra gelir
    const sigPhoto = e.sg ? takePhotos(1)[0] ?? null : null;
    works.push({
      date: e.date, customer_id: has("customers", e.cid) ? e.cid : null, new_customer: !has("customers", e.cid) && e.cn ? e.cn : null,
      site_id: has("sites", e.sid) ? e.sid : null, vehicle_id: has("vehicles", e.vid) ? e.vid : null, personnel_id: has("personnel", p.p) ? p.p : null,
      work_type: e.wt, quantity: Number(e.q), unit: e.u, date_source: "mesaj", reporter: p.n || null, guessed: false,
      dump_site_id: has("dump_sites", e.ds) ? e.ds : null, to_place: !has("dump_sites", e.ds) && e.dn ? e.dn : null, to_is_dump: !!e.dn,
      quarry_id: has("quarries", e.qy) ? e.qy : null, slip_no: e.slip || e.dfs || "", material: e.mat || "",
      description: [e.mat, e.note, e.dfs ? `Dijital fiş ${e.dfs}${e.rcv ? " · imzalayan " + e.rcv : ""}${e.sgt ? " · " + new Date(e.sgt).toLocaleTimeString("tr-TR", { timeZone: "Europe/Istanbul", hour: "2-digit", minute: "2-digit" }) : ""}` : ""].filter(Boolean).join(" · "), note: e.note || "",
    });
    meta.push({ driver_entry_id: e.id, photos, tonnage: Number(e.ton) || null, reporter: p.n || null,
      ...(e.dfs ? { digital: { no: e.dfs, receiver: e.rcv || "", signed_at: e.sgt || null, sigPhoto, sigData: typeof e.sig === "string" && e.sig.length < 200000 ? e.sig : null, sigStrokes: Array.isArray(e.sv) && e.sv.length ? e.sv : null } } : {}) });
  }
  return { plan: { works, fuel, expenses, maintenance }, meta, fuelMeta, expMeta, mainMeta };
}

// Daha önce alınmış şoför kayıtları
export function seenDriverIds(d) {
  const s = new Set();
  for (const st of ["work_records", "fuel_records", "expense_records", "maintenance_records"]) for (const r of live(d, st)) if (r.driver_entry_id) s.add(r.driver_entry_id);
  return s;
}

// ---- Şoförün dijital iş fişi (müşterinin şantiye şefine imzalı PDF) ----
// Fiş no: şoförün baş harfleri + kimliğinden 2 karakter + sıra (ör. SO4C-0012) — şoförler arasında çakışmaz
export function slipPrefix(cfg) {
  const ini = String(cfg.p[1] || "S").toLocaleUpperCase("tr-TR").split(/\s+/).filter(Boolean).map((w) => w[0]).join("").slice(0, 2).normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/İ/g, "I").replace(/[^A-Z]/g, "") || "S";
  const tail = String(cfg.p[0] || "").replace(/[^a-zA-Z0-9]/g, "").slice(-2).toUpperCase();
  return ini + tail;
}
export const slipNo = (cfg, seq) => `${slipPrefix(cfg)}-${String(seq).padStart(4, "0")}`;
export function siteContact(cfg, sid) {
  const s = (cfg.S || []).find((x) => x[0] === sid);
  return s ? { name: s[3] || "", phone: s[4] || "" } : { name: "", phone: "" };
}
export function driverSlipSpec(e, cfg, { no, receiver = "", signedAt = "", sigBlob = null, photo = null } = {}) {
  const cust = e.cid === cfg.Y ? "Kendi depo" : nm(cfg.C, e.cid) || e.cn || "—";
  const dump = nm(cfg.D, e.ds) || e.dn || "";
  const when = signedAt ? new Date(signedAt).toLocaleString("tr-TR", { timeZone: "Europe/Istanbul" }) : "";
  return {
    template: "slip", title: "Dijital İş Fişi", number: no, audience: "customer", filename: `Is_Fisi_${no}.pdf`,
    signatures: sigBlob ? null : ["Hizmeti Veren", "Teslim Alan"],
    sections: [
      { title: "Belge ve Teslim Bilgileri", pairs: [
        ["Fiş no", no], ["Tarih", fmtDate(e.date) + (when ? " · imza " + when.slice(-8, -3) : "")], ["Müşteri", cust], ["Şantiye", nm(cfg.S, e.sid) || "—"],
        ["Araç / Makine", nm(cfg.V, e.vid) || "—"], ["Şoför / operatör", cfg.p[1]], ["Teslim alan", receiver || "Belirtilmedi"],
      ] },
      { title: "Gerçekleşen Hizmet", pairs: [
        ["Yapılan iş", [e.wt, e.mat].filter(Boolean).join(" · ")], ["Miktar", `${e.q} ${String(e.u || "").toLocaleLowerCase("tr-TR")}`],
        ...(dump ? [["Döküm / teslim yeri", dump]] : []), ...(e.ton ? [["Tonaj (döküm fişi)", e.ton + " ton"]] : []), ...(e.slip ? [["Döküm fişi no", e.slip]] : []),
      ] },
      ...(e.note ? [{ title: "Açıklama", text: e.note }] : []),
      ...(photo ? [{ title: "Döküm / kantar fişi", image: photo, max_h: 340 }] : []),
      ...(sigBlob ? [{ title: "Teslim Alan İmzası", image: sigBlob, text: (receiver || "Teslim alan") + (when ? " · " + when : "") }] : [{ title: "Belge Durumu", text: "TASLAK — Teslim alan imzası alınmamıştır." }]),
    ],
  };
}
export function slipShareText(e, cfg, no, receiver) {
  return `${cfg.co || "SAHAPRO"} — dijital iş fişi ${no}\n${entryLine({ ...e, dfs: null }, cfg).replace(/^🚚 /, "")}${receiver ? "\nTeslim alan: " + receiver : ""}`;
}

// Patron tarafı: iş kaydından aynı imzalı fiş PDF'i (şoförün şefe gönderdiğinin aynısı)
export function workSlipSpec(w, names, { company = "", sigBlob = null, photo = null } = {}) {
  const nmOf = (st, id) => (id ? [[id, names?.[st]?.[id] || ""]] : []);
  const cfg = { co: company, p: [w.personnel_id || "", names?.personnel?.[w.personnel_id] || ""], C: nmOf("customers", w.customer_id), S: nmOf("sites", w.site_id), V: nmOf("vehicles", w.vehicle_id), D: nmOf("dump_sites", w.dump_site_id), Y: null };
  const e = { date: w.date, vid: w.vehicle_id, cid: w.customer_id, sid: w.site_id, wt: w.work_type, q: w.quantity, u: w.unit, mat: w.material || "", ds: w.dump_site_id, dn: w.dump_area || "",
    ton: w.tonnage || null, slip: w.slip_no && w.slip_no !== w.digital_slip_no ? w.slip_no : "", note: w.customer_note || "" };
  return driverSlipSpec(e, cfg, { no: w.digital_slip_no, receiver: w.slip_receiver || "", signedAt: w.slip_signed_at || "", sigBlob, photo });
}
