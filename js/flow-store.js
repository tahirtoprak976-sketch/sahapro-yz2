// SAHAPRO YZ2 — onay akışı depolama ADAPTÖRÜ (IndexedDB).
// Sözleşme: çekirdek (flow-core) hiçbir zaman doğrudan IndexedDB görmez; bu adaptör arayüzünü
// ileride bir HTTP/sunucu adaptörü de uygulayabilir (aynı metotlar, aynı anlambilim).
//
// ATOMİKLİK KURALI (F maddesi):
//  - Hash/şifreleme/dosya okuma gibi async hazırlıklar transaction DIŞINDA yapılır.
//  - tx() içinde yalnız bu adaptörün txApi çağrıları await'lenir; dış async iş (fetch, digest, dosya) YASAK.
//    (IndexedDB, bekleyen isteği kalan transaction'ı canlı tutar; dış async'e düşmek tx'i erken kapatır.)
//  - tx içinde herhangi bir adım hata verirse tüm transaction abort olur: yarım kayıt kalmaz.

export const FLOW_SCHEMA_VERSION = 1;
export const FLOW_DB_NAME = "sahapro_yz2_flowlab";
export const FLOW_STORES = Object.freeze(["reports", "revisions", "approvals", "works", "attachments", "audit"]);

function wrap(req) {
  return new Promise((res, rej) => {
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
}

export function openFlowDB(name = FLOW_DB_NAME, factory = globalThis.indexedDB) {
  if (!factory) throw Error("IndexedDB yok (testlerde fake-indexeddb enjekte edin)");
  return new Promise((res, rej) => {
    const r = factory.open(name, FLOW_SCHEMA_VERSION);
    r.onupgradeneeded = () => {
      const db = r.result;
      const reports = db.createObjectStore("reports", { keyPath: "id" });
      reports.createIndex("op_key", "op_key", { unique: true });
      reports.createIndex("state", "state", { unique: false });
      const revisions = db.createObjectStore("revisions", { keyPath: "id" });
      revisions.createIndex("report_id", "report_id", { unique: false });
      const approvals = db.createObjectStore("approvals", { keyPath: "id" });
      approvals.createIndex("report_id", "report_id", { unique: false });
      approvals.createIndex("op_key", "op_key", { unique: true }); // bir anahtar = bir onay
      const works = db.createObjectStore("works", { keyPath: "id" });
      works.createIndex("op_key", "op_key", { unique: true });     // bir anahtar = bir iş
      works.createIndex("report_id", "report_id", { unique: false });
      const attachments = db.createObjectStore("attachments", { keyPath: "id" });
      attachments.createIndex("report_id", "report_id", { unique: false });
      attachments.createIndex("work_id", "work_id", { unique: false });
      const audit = db.createObjectStore("audit", { keyPath: "id" });
      audit.createIndex("report_id", "report_id", { unique: false });
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}

export function deleteFlowDB(name = FLOW_DB_NAME, factory = globalThis.indexedDB) {
  return new Promise((res, rej) => {
    const r = factory.deleteDatabase(name);
    r.onsuccess = () => res(true);
    r.onerror = () => rej(r.error);
    r.onblocked = () => rej(Error("Silme engellendi: açık bağlantı var"));
  });
}

export class FlowStore {
  constructor(db) { this.db = db; }

  static async open(name = FLOW_DB_NAME, factory) {
    return new FlowStore(await openFlowDB(name, factory));
  }

  close() { this.db.close(); }

  // Tek transaction: stores kapsamında fn(txApi) çalışır; fn hata atarsa abort.
  tx(stores, fn) {
    return new Promise((resolve, reject) => {
      const t = this.db.transaction(stores, "readwrite");
      const txApi = {
        get: (s, id) => wrap(t.objectStore(s).get(id)),
        getAll: (s) => wrap(t.objectStore(s).getAll()),
        put: (s, v) => wrap(t.objectStore(s).put(v)),
        add: (s, v) => wrap(t.objectStore(s).add(v)),
        byIndex: (s, idx, key) => wrap(t.objectStore(s).index(idx).get(key)),
        allByIndex: (s, idx, key) => wrap(t.objectStore(s).index(idx).getAll(key)),
      };
      let out;
      Promise.resolve()
        .then(() => fn(txApi))
        .then((v) => { out = v; })
        .catch((e) => { try { t.abort(); } catch (_) {} reject(e); });
      t.oncomplete = () => resolve(out);
      t.onabort = () => reject(t.error || Error("Transaction iptal edildi"));
      t.onerror = () => { /* abort kolu halleder */ };
    });
  }

  // Tx dışı tekil okuyucular (salt-okunur kısayollar)
  async get(store, id) { return this.tx([store], (x) => x.get(store, id)); }
  async byIndex(store, idx, key) { return this.tx([store], (x) => x.byIndex(store, idx, key)); }
  async allByIndex(store, idx, key) { return this.tx([store], (x) => x.allByIndex(store, idx, key)); }
  async all(store) { return this.tx([store], (x) => x.getAll(store)); }
}
