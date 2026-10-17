// Müşteri kartı birleştirme — SAF katman. Aynı firmanın farklı yazılmış kartlarını tek karta toplar;
// istenirse eski kartın adı hedef müşterinin ŞANTİYESİ olur (şantiyesi müşteri gibi açılmış kayıtlar için).
// Kayıt silinmez: kaynak kart "birleştirildi" notuyla çöp kutusuna gider, eski ad hafızaya (takma ad) yazılır.
import { isActive, ENTITY_STORES } from "./core.js";
import { foldTr } from "./parser.js";

const live = (d, s) => (d[s] || []).filter(isActive);
const norm = (s) => foldTr(s).replace(/[^\p{L}\p{N}]+/gu, " ").trim();
const SITE_STORES = new Set(["work_records", "slips", "quotes", "contracts", "hakedis", "documents"]);
const SKIP = new Set(["customers", "audit_log"]);

function swapCustomer(obj, from, to) {
  let changed = false;
  const out = { ...obj };
  if (out.customer_id && from.has(out.customer_id)) { out.customer_id = to; changed = true; }
  if (out.party_type === "customer" && from.has(out.party_id)) { out.party_id = to; changed = true; }
  if (out.owner_type === "customer" && from.has(out.owner_id)) { out.owner_id = to; changed = true; }
  if (out.target_type === "customer" && from.has(out.target_id)) { out.target_id = to; changed = true; }
  return { out, changed };
}

// srcIds: birleşecek kartlar, targetId: kalacak kart. asSite: kaynak adları hedefin şantiyesi olsun
export function planMerge(d, srcIds, targetId, { asSite = false } = {}) {
  const customers = live(d, "customers");
  const target = customers.find((c) => c.id === targetId);
  if (!target) throw Error("Hedef müşteri bulunamadı");
  const sources = customers.filter((c) => srcIds.includes(c.id) && c.id !== targetId);
  if (!sources.length) throw Error("Birleştirilecek müşteri seçin");
  const from = new Set(sources.map((s) => s.id));
  const updates = [], counts = {}, newSites = [], siteFor = new Map(), aliases = [];
  const targetSites = live(d, "sites").filter((s) => s.customer_id === targetId);
  if (asSite)
    for (const s of sources) {
      // "Leda / Coşar Polat" → hedef "Leda" ise şantiye adı "Coşar Polat"
      const parts = String(s.name).split(/\s*[\/–—-]\s*/);
      const siteName = parts.length > 1 && norm(parts[0]) === norm(target.name) && parts.slice(1).join(" - ").trim().length >= 3 ? parts.slice(1).join(" - ").trim() : s.name;
      const same = targetSites.find((x) => norm(x.name) === norm(siteName));
      if (same) siteFor.set(s.id, same.id);
      else {
        const id = "new-site:" + s.id;
        newSites.push({ tmp: id, name: siteName, customer_id: targetId, note: "Birleştirme: eski müşteri kartı " + s.name });
        siteFor.set(s.id, id);
      }
    }
  for (const store of ENTITY_STORES) {
    if (SKIP.has(store)) continue;
    for (const r of live(d, store)) {
      const origin = r.customer_id;
      let { out, changed } = swapCustomer(r, from, targetId);
      // İç içe satırlar (mesaj taslakları, dağıtım hedefleri, kalemler)
      for (const [k, v] of Object.entries(out))
        if (Array.isArray(v) && v.some((x) => x && typeof x === "object")) {
          let any = false;
          const arr = v.map((x) => {
            if (!x || typeof x !== "object") return x;
            const s = swapCustomer(x, from, targetId);
            if (s.changed) any = true;
            return s.out;
          });
          if (any) { out[k] = arr; changed = true; }
        }
      if (!changed) continue;
      if (asSite && SITE_STORES.has(store) && from.has(origin) && !out.site_id) out.site_id = siteFor.get(origin);
      updates.push({ store, before: r, after: out });
      counts[store] = (counts[store] || 0) + 1;
    }
  }
  // Taşeron kartlarının ana firması birleşen karttaysa hedefe taşınır
  for (const c of customers)
    if (c.parent_customer_id && from.has(c.parent_customer_id) && !from.has(c.id) && c.id !== targetId) {
      updates.push({ store: "customers", before: c, after: { ...c, parent_customer_id: targetId } });
      counts.customers = (counts.customers || 0) + 1;
    }
  for (const s of sources)
    if (norm(s.name) !== norm(target.name))
      aliases.push(asSite
        ? { alias: s.name, target_type: "site", target_ref: siteFor.get(s.id) }
        : { alias: s.name, target_type: "customer", target_ref: targetId });
  return { target, sources, updates, counts, newSites, aliases };
}

// Benzer görünen müşteri adları: biri ötekinin başında/içinde kelime olarak geçiyor ya da 1–2 harf farkı
function editDistance(a, b) {
  if (Math.abs(a.length - b.length) > 3) return 99;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(cur[j - 1] + 1, prev[j] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
}
const STOP = new Set(["insaat", "yapi", "bey", "abi", "usta", "kalfa", "ltd", "sti", "as", "grup", "ve", "a", "s"]);
export function suggestGroups(d) {
  const cs = live(d, "customers").map((c) => ({ c, n: norm(c.name), words: norm(c.name).split(" ").filter((w) => w.length >= 3 && !STOP.has(w)) }));
  const pairs = [];
  for (let i = 0; i < cs.length; i++)
    for (let j = i + 1; j < cs.length; j++) {
      const a = cs[i], b = cs[j];
      if (!a.n || !b.n) continue;
      const [s, l] = a.n.length <= b.n.length ? [a, b] : [b, a];
      const contains = s.n.length >= 4 && (` ${l.n} `).includes(` ${s.n} `);
      const close = Math.min(a.n.length, b.n.length) >= 5 && editDistance(a.n, b.n) <= 2;
      const firstWord = a.words[0] && a.words[0] === b.words[0] && a.words[0].length >= 4;
      if (contains || close || firstWord) pairs.push([a.c, b.c, contains || close ? "güçlü" : "zayıf"]);
    }
  // Çiftleri gruplara topla
  const groups = [];
  for (const [a, b, level] of pairs) {
    const g = groups.find((x) => x.ids.has(a.id) || x.ids.has(b.id));
    if (g) { g.ids.add(a.id); g.ids.add(b.id); if (level === "güçlü") g.level = "güçlü"; }
    else groups.push({ ids: new Set([a.id, b.id]), level });
  }
  const byId = new Map(cs.map((x) => [x.c.id, x.c]));
  const usage = (id) => live(d, "work_records").filter((w) => w.customer_id === id).length;
  return groups
    .map((g) => ({ level: g.level, customers: [...g.ids].map((id) => ({ ...byId.get(id), works: usage(id) })).sort((x, y) => y.works - x.works) }))
    .sort((a, b) => (a.level === b.level ? b.customers.length - a.customers.length : a.level === "güçlü" ? -1 : 1));
}

// ---- Araç / personel kartı birleştirme (aynı plaka iki kartta, aynı kişi iki kartta) ----
export const CARD_KINDS = {
  customers: { label: "Müşteri", key: "customer_id", alias: "customer" },
  vehicles: { label: "Araç / makine", key: "vehicle_id", alias: "vehicle", fill: ["plate", "type", "tank_capacity", "ownership", "contractor_id", "next_maintenance_date"] },
  personnel: { label: "Personel", key: "personnel_id", alias: "personnel", fill: ["phone", "role", "vehicle_id"] },
};
const plateKey = (s) => String(s || "").toUpperCase().replace(/[^A-Z0-9]/g, "");

export function planMergeCards(d, store, srcIds, targetId) {
  if (store === "customers") return { store, ...planMerge(d, srcIds, targetId) };
  const K = CARD_KINDS[store];
  if (!K) throw Error("Bu kart türü birleştirilemez");
  const cards = live(d, store);
  const target = cards.find((c) => c.id === targetId);
  if (!target) throw Error("Kalacak kart bulunamadı");
  const sources = cards.filter((c) => srcIds.includes(c.id) && c.id !== targetId);
  if (!sources.length) throw Error("Birleştirilecek kart seçin");
  const from = new Set(sources.map((s) => s.id));
  const updates = [], counts = {}, aliases = [];
  // ID'ler benzersiz (uuid): bu kartlara işaret eden her alan hedefe çevrilir
  const KEYS = [K.key, "owner_id", "party_id", "target_id"];
  const swap = (o) => {
    let changed = false;
    const out = { ...o };
    for (const k of KEYS) if (typeof out[k] === "string" && from.has(out[k])) { out[k] = targetId; changed = true; }
    return { out, changed };
  };
  for (const s of ENTITY_STORES) {
    if (s === "audit_log") continue;
    for (const r of live(d, s)) {
      if (s === store && (from.has(r.id) || r.id === targetId)) continue;
      let { out, changed } = swap(r);
      for (const [k, v] of Object.entries(out))
        if (Array.isArray(v) && v.some((x) => x && typeof x === "object")) {
          let any = false;
          const arr = v.map((x) => { if (!x || typeof x !== "object") return x; const w = swap(x); if (w.changed) any = true; return w.out; });
          if (any) { out[k] = arr; changed = true; }
        }
      if (!changed) continue;
      updates.push({ store: s, before: r, after: out });
      counts[s] = (counts[s] || 0) + 1;
    }
  }
  // Kalacak kartta boş olan bilgiler (plaka, tür, telefon…) birleşen karttan tamamlanır
  const patch = {};
  for (const f of K.fill || []) if (target[f] == null || target[f] === "") { const v = sources.map((x) => x[f]).find((x) => x != null && x !== ""); if (v != null) patch[f] = v; }
  if (Object.keys(patch).length) updates.push({ store, before: target, after: { ...target, ...patch } });
  for (const s of sources) if (norm(s.name) !== norm(target.name)) aliases.push({ alias: s.name, target_type: K.alias, target_ref: targetId });
  return { store, target, sources, updates, counts, newSites: [], aliases, patch };
}

export function suggestCardGroups(d, store) {
  if (store === "customers") return suggestGroups(d);
  const K = CARD_KINDS[store];
  const cards = live(d, store);
  const keyOf = (c) => {
    if (store === "vehicles") { const p = plateKey(c.plate) || plateKey(c.name); return /^\d{2}[A-Z]{1,3}\d{2,4}$/.test(p) ? p : "n:" + norm(c.name); }
    return "n:" + norm(c.name).split(" ")[0];
  };
  const by = new Map();
  for (const c of cards) { const k = keyOf(c); if (k.length > 3) by.set(k, [...(by.get(k) || []), c]); }
  const usage = (id) => live(d, "work_records").filter((w) => w[K.key] === id).length;
  return [...by.values()].filter((g) => g.length > 1)
    .map((g) => ({ level: "güçlü", customers: g.map((c) => ({ ...c, works: usage(c.id) })).sort((x, y) => y.works - x.works || String(y.plate || "").length - String(x.plate || "").length) }));
}
