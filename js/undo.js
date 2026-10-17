// Asistanın son kaydını geri alma. Kayıttan önce ve sonra veritabanının görüntüsü alınır; fark saklanır.
// Geri alırken: sonradan eklenenler silinir, değişenler eski haline döner. Arada başka bir değişiklik
// yapıldıysa (aynı kayıt sonradan düzenlendiyse) geri alma reddedilir — hiçbir şey yarım kalmaz.
import { ENTITY_STORES, nowISO, uuid } from "./core.js";

export const UNDO_META = ["collect_notes", "collect_iban", "fuel_ref_price", "assistant_rules", "company_profile"];
const SKIP = new Set(["audit_log"]);

export async function snapshot(db) {
  const snap = { stores: {}, att: new Set(), meta: {} };
  for (const s of ENTITY_STORES) if (!SKIP.has(s)) snap.stores[s] = new Map((await db.getAll(s)).map((r) => [r.id, r]));
  snap.att = new Set((await db.getAll("attachments")).map((a) => a.id));
  for (const k of UNDO_META) snap.meta[k] = await db.metaGet(k);
  return snap;
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// Saf: iki görüntü arasındaki fark
export function diffSnapshots(a, b) {
  const stores = {};
  let n = 0;
  for (const s of Object.keys(b.stores)) {
    const A = a.stores[s] || new Map(), B = b.stores[s];
    const added = [], changed = [];
    for (const [id, r] of B) {
      if (!A.has(id)) added.push(r);
      else if (!same(A.get(id), r)) changed.push({ before: A.get(id), after: r });
    }
    if (added.length || changed.length) { stores[s] = { added, changed }; n += added.length + changed.length; }
  }
  const attAdded = [...b.att].filter((id) => !a.att.has(id));
  const meta = {};
  for (const k of Object.keys(b.meta)) if (!same(a.meta[k], b.meta[k])) meta[k] = { before: a.meta[k] ?? null, after: b.meta[k] ?? null };
  return { stores, attAdded, meta, count: n + Object.keys(meta).length };
}

// Saf: geri alma güvenli mi? (dokunulan kayıtlar kayıttan sonraki halinde mi duruyor)
export function undoConflicts(plan, current) {
  const out = [];
  for (const [s, x] of Object.entries(plan.stores)) {
    const cur = current.stores[s] || new Map();
    for (const r of x.added) if (cur.has(r.id) && !same(cur.get(r.id), r)) out.push(s);
    for (const c of x.changed) if (!same(cur.get(c.after.id), c.after)) out.push(s);
  }
  for (const [k, m] of Object.entries(plan.meta)) if (!same(current.meta[k] ?? null, m.after)) out.push("ayar:" + k);
  return [...new Set(out)];
}

export async function saveUndo(db, before, label) {
  const after = await snapshot(db);
  const diff = diffSnapshots(before, after);
  if (!diff.count && !diff.attAdded.length) return null;
  const plan = { ...diff, at: nowISO(), label };
  await db.metaSet("assistant_undo", plan);
  return plan;
}

export async function applyUndo(db) {
  const plan = await db.metaGet("assistant_undo");
  if (!plan) throw Error("Geri alınacak kayıt yok");
  const conflicts = undoConflicts(plan, await snapshot(db));
  if (conflicts.length) throw Error("Bu kayıtlar sonradan değişmiş, geri alınamaz (" + conflicts.slice(0, 3).join(", ") + "). Tek tek düzeltin.");
  const idb = await db.openDB();
  const stores = [...Object.keys(plan.stores), "attachments", "meta", "audit_log"];
  await new Promise((resolve, reject) => {
    const t = idb.transaction(stores, "readwrite");
    for (const [s, x] of Object.entries(plan.stores)) {
      const os = t.objectStore(s);
      for (const r of x.added) os.delete(r.id);
      for (const c of x.changed) os.put(c.before);
    }
    for (const id of plan.attAdded) t.objectStore("attachments").delete(id);
    for (const [k, m] of Object.entries(plan.meta)) t.objectStore("meta").put({ key: k, value: m.before });
    t.objectStore("meta").delete("assistant_undo");
    t.objectStore("audit_log").put({ id: uuid(), entity: "assistant", entity_id: plan.at, action: "undo", old: null, new: null, reason: "Asistan kaydı geri alındı: " + (plan.label || ""), at: nowISO() });
    t.oncomplete = resolve;
    t.onerror = t.onabort = () => reject(t.error || Error("Geri alınamadı"));
  });
  return plan;
}
