import { validateSmartData } from "./message-smart-core.js";
import { validateSoloData, SOLO_STORES } from "./solo-core.js";
import {
  ENTERPRISE_STORES,
  validateEnterpriseData,
} from "./enterprise-core.js";
import {
  ENTITY_STORES,
  SCHEMA_VERSION,
  APP_ID,
  APP_VERSION,
  mergePreview,
  isValidBackup,
} from "./core.js";
const SECRET_META = ["gemini_key", "gemini_consent", "backup_pw", "sec_lock", "sec_fail"];
// Yedek dosyasını oku: eski .json, sıkıştırılmış ya da şifreli .sahapro (şifre sorulur)
export async function readBackupFile(file) {
  const { decodeBackup } = await import("./backup-crypt.js");
  const { promptDialog } = await import("./ui.js");
  if (file.size > 64 * 1024 * 1024) throw Error("Yedek dosyası 64 MB sınırını aşıyor");
  return decodeBackup(new Uint8Array(await file.arrayBuffer()), () => promptDialog("Şifreli yedek", "Yedek şifresi", "", { type: "password" }));
}
export async function fullBackup(db, { includeDriverSecrets = false } = {}) {
  const data = await db.dumpAll(),
    attachments = [];
  for (const a of await db.getAll("attachments")) {
    const buffer = new Uint8Array(await a.blob.arrayBuffer());
    let binary = "";
    for (let i = 0; i < buffer.length; i += 8192)
      binary += String.fromCharCode(...buffer.subarray(i, i + 8192));
    attachments.push({ ...a, blob: undefined, base64: btoa(binary) });
  }
  return {
    app: APP_ID,
    app_version: APP_VERSION,
    schema_version: SCHEMA_VERSION,
    exported_at: new Date().toISOString(),
    device_install_id: await db.metaGet("device_install_id"),
    data,
    attachments,
    // API anahtarı gibi gizli ayarlar yedek dosyasına yazılmaz (yedek WhatsApp/Drive ile paylaşılabilir)
    security: { driver_credentials: includeDriverSecrets ? "included-encryption-required" : "excluded" },
    meta: (await db.getAll("meta")).filter((m) => !SECRET_META.includes(m.key) && (includeDriverSecrets || m.key !== "driver_links")),
  };
}
export async function previewBackup(db, obj) {
  if (!isValidBackup(obj) || obj.schema_version > SCHEMA_VERSION)
    throw Error("Desteklenmeyen yedek / şema");
  const local = await db.dumpAll(),
    stores = {};
  let added = 0,
    same = 0,
    conflicts = 0;
  for (const s of ENTITY_STORES) {
    if (obj.data[s] && !Array.isArray(obj.data[s]))
      throw Error("Yedek kayıtları geçersiz");
    const rows = obj.data[s] || [];
    const ids = new Set();
    for (const r of rows) {
      if (!r || typeof r.id !== "string" || ids.has(r.id))
        throw Error("Yedekte geçersiz veya mükerrer ID");
      ids.add(r.id);
    }
    const p = mergePreview(local[s], rows);
    stores[s] = p;
    added += p.new.length;
    same += p.existing.length;
    conflicts += p.conflict.length;
  }
  return {
    stores,
    added,
    same,
    conflicts,
    attachments: (obj.attachments || []).length,
  };
}
export async function restoreBackup(db, obj, replace = false) {
  const preview = await previewBackup(db, obj),
    old = await fullBackup(db, { includeDriverSecrets: true });
  await saveRecovery(db, old);
  validateRestoreLinks(await db.dumpAll(), obj, preview, replace);
  const decoded = [];
  for (const a of obj.attachments || []) {
    if (!a.id || !a.record_id || typeof a.base64 !== "string")
      throw Error("Ek geçersiz");
    const bytes = Uint8Array.from(atob(a.base64), (c) => c.charCodeAt(0));
    const { base64, ...fields } = a;
    decoded.push({ ...fields, blob: new Blob([bytes], { type: a.type }) });
  }
  const connection = await db.openDB(),
    stores = [...ENTITY_STORES, "attachments", "meta"];
  return new Promise((resolve, reject) => {
    const t = connection.transaction(stores, "readwrite");
    let error;
    for (const s of ENTITY_STORES) {
      const rows = [
        ...preview.stores[s].new,
        ...(replace ? preview.stores[s].conflict : []),
      ];
      for (const r of rows) {
        const get = t.objectStore(s).get(r.id);
        get.onsuccess = () => {
          const existing = get.result;
          if (
            existing &&
            (ENTERPRISE_STORES.includes(s) ||
              SOLO_STORES.includes(s) ||
              (s === "contracts" && existing.status === "İmzalandı") ||
              (s === "hakedis" && existing.status === "Kesinleşti") ||
              (s === "slips" && existing.status === "İmzalandı"))
          ) {
            error = Error("İmzalı/kesinleşmiş kayıt yedekle değiştirilemez");
            t.abort();
            return;
          }
          t.objectStore(s).put(r);
        };
      }
    }
    for (const a of decoded) {
      const q = t.objectStore("attachments").get(a.id);
      q.onsuccess = () => {
        if (!q.result) t.objectStore("attachments").put(a);
      };
    }
    for (const m of obj.meta || []) {
      if (m.key.startsWith("seq_")) {
        const q = t.objectStore("meta").get(m.key);
        q.onsuccess = () =>
          t.objectStore("meta").put({
            ...m,
            value: Math.max(Number(q.result?.value) || 0, Number(m.value) || 0),
          });
      } else if (
        !["device_install_id", "pin_hash", "last_backup_at", ...SECRET_META].includes(m.key)
      ) {
        const q = t.objectStore("meta").get(m.key);
        q.onsuccess = () => {
          if (!q.result) t.objectStore("meta").put(m);
        };
      }
    }
    // Legacy backups lack counters; derive counters from actual documents.
    for (const [s, key, seq] of [
      ["slips", "slip_no", "slip"],
      ["quotes", "quote_no", "quote"],
      ["hakedis", "hakedis_no", "hakedis"],
      ["contracts", "contract_no", "contract"],
    ]) {
      const max = Math.max(
        0,
        ...(obj.data[s] || []).map((r) => Number(r[key]) || 0),
      );
      const q = t.objectStore("meta").get("seq_" + seq);
      q.onsuccess = () =>
        t.objectStore("meta").put({
          key: "seq_" + seq,
          value: Math.max(max, Number(q.result?.value) || 0),
        });
    }
    t.oncomplete = () => resolve(preview);
    t.onabort = t.onerror = () =>
      reject(error || t.error || Error("Geri yükleme iptal edildi"));
  });
}
export async function backupBeforeSoloOperation(
  db,
  prefix = "before-solo-operation",
) {
  await saveRecovery(db, await fullBackup(db, { includeDriverSecrets: true }), prefix);
}
export async function backupBeforeHistoryImport(db) {
  const snapshot = await fullBackup(db, { includeDriverSecrets: true });
  await saveRecovery(db, snapshot, "before-history-import");
}
async function saveRecovery(db, obj, prefix = "before-restore") {
  const name = (await db.openDB()).name + "_recovery";
  const connection = await new Promise((res, rej) => {
    const r = indexedDB.open(name, 1);
    r.onupgradeneeded = () =>
      r.result.createObjectStore("snapshots", { keyPath: "id" });
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  try {
    await new Promise((res, rej) => {
      const t = connection.transaction("snapshots", "readwrite");
      t.objectStore("snapshots").put({
        id: prefix + "-" + Date.now(),
        full: obj,
      });
      t.oncomplete = res;
      t.onabort = t.onerror = () =>
        rej(t.error || Error("Kurtarma yedeği kaydedilemedi"));
    });
  } finally {
    connection.close();
  }
}

export function validateRestoreLinks(local, obj, preview, replace = false) {
  const merged = {};
  for (const store of ENTITY_STORES) {
    const rows = [
      ...(local[store] || []),
      ...preview.stores[store].new,
      ...(replace ? preview.stores[store].conflict : []),
    ];
    merged[store] = new Map(rows.map((r) => [r.id, r]));
  }
  const ownStores = {
    vehicle: "vehicles",
    personnel: "personnel",
    customer: "customers",
    fuel: "fuel_records",
    expense: "expense_records",
    hakedis: "hakedis",
    work: "work_records",
    contract: "contracts",
  };
  for (const doc of preview.stores.documents.new) {
    if (
      doc.owner_type &&
      (!ownStores[doc.owner_type] ||
        !merged[ownStores[doc.owner_type]].has(doc.owner_id))
    )
      throw Error("Yedekte sahipsiz belge: " + (doc.doc_no || "Belge"));
  }
  for (const fuel of preview.stores.fuel_records.new)
    if (fuel.tank_movement_id) {
      const move = merged.fuel_tank_movements.get(fuel.tank_movement_id);
      if (
        !move ||
        move.fuel_record_id !== fuel.id ||
        move.event_id !== fuel.event_id
      )
        throw Error("Yedekte kopuk yakıt / tank olayı");
    }
  for (const move of preview.stores.fuel_tank_movements.new)
    if (move.fuel_record_id) {
      const fuel = merged.fuel_records.get(move.fuel_record_id);
      if (
        !fuel ||
        fuel.tank_movement_id !== move.id ||
        fuel.event_id !== move.event_id
      )
        throw Error("Yedekte kopuk tank / yakıt olayı");
    }
  validateEnterpriseData(
    Object.fromEntries(
      Object.entries(merged).map(([s, m]) => [s, [...m.values()]]),
    ),
  );
  validateSoloData(
    Object.fromEntries(
      Object.entries(merged).map(([s, m]) => [s, [...m.values()]]),
    ),
  );
  validateSmartData(
    Object.fromEntries(
      Object.entries(merged).map(([s, m]) => [s, [...m.values()]]),
    ),
  );
  const attachments = new Set();
  for (const a of obj.attachments || []) {
    if (attachments.has(a.id)) throw Error("Yedekte mükerrer ek");
    attachments.add(a.id);
    const type =
      {
        document: "documents",
        maintenance: "maintenance_records",
        expense: "expense_records",
        slip_signature: "slips",
        contract_signature: "contracts",
        leave_signature: "documents",
        tank: "fuel_tank_movements",
        payable: "payables",
        work: "work_records",
        fuel: "fuel_records",
      }[a.record_type] || a.record_type;
    if (!merged[type]?.has(a.record_id))
      throw Error("Yedekte kaydına bağlı olmayan dosya eki");
  }
}
