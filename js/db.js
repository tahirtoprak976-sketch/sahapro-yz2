import { ENTERPRISE_STORES, workHours } from "./enterprise-core.js";
// SAHAPRO SOLO — IndexedDB katmanı (local-first, offline-first)
// Backend YOK · Supabase YOK · ana SAHAPRO API YOK.
// v1 (sahapro_yz2_db @ version 1) → v2 (version 2) VERSIONED MIGRATION — kayıtlar korunur.

import {
  ENTITY_STORES,
  newRecord,
  touchRecord,
  isActive,
  nowISO,
  uuid,
  SEED_VEHICLES,
  SEED_PERSONNEL,
  SEED_ALIASES,
  VEHICLE_OWNERSHIP,
  SCHEMA_VERSION,
  tankUnitCost,
} from "./core.js";

const DB_NAME = "sahapro_yz2_db"; // v1 ile AYNI isim — veri bu DB'de
const DB_VERSION = 5;
let _db = null;

// Test harness için: ?db=<isim> ile ayrı DB açılabilir (migration simülasyonu)
function dbName() {
  try {
    const p = new URLSearchParams(location.search).get("db");
    if (p && /^[a-z0-9_-]{1,32}$/i.test(p)) return "sahapro_yz2_db_" + p;
  } catch (e) {
    /* noop */
  }
  return DB_NAME;
}

export async function openDB() {
  if (_db) return Promise.resolve(_db);
  await backupBeforeUpgrade();
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(dbName(), DB_VERSION);
    req.onupgradeneeded = (ev) => {
      const db = ev.target.result;
      // v1 store'ları eksikse oluştur (v1→v2 upgrade'de zaten var; taze kurulumda hepsi kurulur)
      for (const s of ENTITY_STORES) {
        const st = db.objectStoreNames.contains(s)
          ? ev.target.transaction.objectStore(s)
          : db.createObjectStore(s, { keyPath: "id" });
        for (const key of [
          "date",
          "customer_id",
          "site_id",
          "vehicle_id",
          "personnel_id",
          "owner_id",
          "party_id",
          "due_date",
          "payable_id",
          "bank_account_id",
          "work_record_id",
        ])
          if (!st.indexNames.contains(key))
            st.createIndex(key, key, { unique: false });
      }
      if (!db.objectStoreNames.contains("attachments"))
        db.createObjectStore("attachments", { keyPath: "id" });
      if (!db.objectStoreNames.contains("meta"))
        db.createObjectStore("meta", { keyPath: "key" });
      if (!db.objectStoreNames.contains("drafts"))
        db.createObjectStore("drafts", { keyPath: "form" });
    };
    req.onsuccess = () => {
      _db = req.result;
      _db.onversionchange = () => {
        _db.close();
        _db = null;
      };
      resolve(_db);
    };
    req.onblocked = () =>
      reject(Error("Güncelleme için diğer SAHAPRO sekmelerini kapatın"));
    req.onerror = () => reject(req.error);
  });
}

function tx(db, store, mode) {
  return db.transaction(store, mode).objectStore(store);
}
function wrap(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function put(store, rec) {
  const db = await openDB();
  return wrap(tx(db, store, "readwrite").put(rec));
}
export async function get(store, id) {
  const db = await openDB();
  return wrap(tx(db, store, "readonly").get(id));
}
export async function getAll(store) {
  const db = await openDB();
  return (await wrap(tx(db, store, "readonly").getAll())) || [];
}
export async function listActive(store) {
  return (await getAll(store)).filter(isActive);
}
export async function softDelete(store, id, reason) {
  if (['customers','sites','vehicles','personnel','dump_sites'].includes(store)) {
    const key={customers:'customer_id',sites:'site_id',vehicles:'vehicle_id',personnel:'personnel_id',dump_sites:'dump_site_id'}[store];
    if ((await getAll('inbox_messages')).some(m=>isActive(m)&&(m.review_rows||[]).some(r=>r[key]===id))) throw Error('Kontrol edilmiş mesaj taslağına bağlı kart silinemez; pasife alın');
  }

  const rec = await get(store, id);
  if (!rec) return null;
  if (ENTERPRISE_STORES.includes(store) || ["inbox_messages","meter_readings","shift_assignments","custody_records","downtime_records","maintenance_parts","cost_allocations","bank_import_rows","stock_counts"].includes(store))
    throw Error(
      "İşletme defteri kaydı silinemez; ilgili işlem ekranını kullanın",
    );
  const extensionRefs = {vehicles:[['custody_records','owner_id'],['meter_readings','vehicle_id'],['shift_assignments','vehicle_id'],['downtime_records','vehicle_id'],['maintenance_parts','vehicle_id']],customers:[['shift_assignments','customer_id']],sites:[['shift_assignments','site_id']],personnel:[['shift_assignments','personnel_id'],['custody_records','personnel_id']],documents:[['custody_records','owner_id']],maintenance_records:[['maintenance_parts','maintenance_id'],['downtime_records','maintenance_id']],bank_accounts:[['bank_import_rows','bank_account_id']],bank_movements:[['bank_import_rows','bank_movement_id']]};
  for(const [target,key] of extensionRefs[store]||[])if((await getAll(target)).some(r=>isActive(r)&&r[key]===id))throw Error('İşletme geçmişine bağlı kayıt silinemez; pasife alın');
  if(['vehicles','sites','customers'].includes(store)&&(await getAll('cost_allocations')).some(r=>(r.targets||[]).some(t=>t[{vehicles:'vehicle_id',sites:'site_id',customers:'customer_id'}[store]]===id)))throw Error('Maliyet geçmişine bağlı kart silinemez; pasife alın');
  if((await getAll('cost_allocations')).some(r=>isActive(r)&&r.status==='Aktif'&&r.source_store===store&&r.source_id===id))throw Error('Dağıtılmış maliyet kaynağı silinemez');
  const linked = (await getAll("payables")).some(
    (b) =>
      isActive(b) &&
      b.status !== "İptal" &&
      ((b.source_store === store && b.source_id === id) ||
        (b.party_id === id &&
          {
            supplier: "suppliers",
            contractor: "contractors",
            dump_site: "dump_sites",
            quarry: "quarries",
          }[b.party_type] === store) ||
        (b.items || []).some(
          (i) => store === "work_records" && i.work_record_id === id,
        )),
  );
  if (linked) throw Error("Borç/maliyete bağlı kayıt silinemez");
  if (
    [
      "vehicles",
      "personnel",
      "customers",
      "sites",
      "quotes",
      "contracts",
    ].includes(store)
  ) {
    const type = {
      vehicles: "vehicle",
      personnel: "personnel",
      customers: "customer",
      sites: "site",
      quotes: "quote",
      contracts: "contract",
    }[store];
    if (
      (await listActive("activities")).some(
        (r) => r.owner_type === type && r.owner_id === id,
      ) ||
      (store === "vehicles" &&
        (await listActive("service_plans")).some((r) => r.vehicle_id === id)) ||
      (store === "personnel" &&
        (await listActive("payroll_entries")).some(
          (r) => r.personnel_id === id,
        ))
    )
      throw Error("İşletme defterine bağlı kart silinemez");
  }
  if (
    ["contracts", "hakedis", "slips"].includes(store) &&
    ["İmzalandı", "Kesinleşti"].includes(rec.status)
  )
    throw Error("İmzalı veya kesinleşmiş kayıt silinemez");
  if (
    store === "work_records" &&
    (await listActive("hakedis")).some(
      (h) =>
        h.status !== "İptal" &&
        (h.items || []).some((i) => i.work_record_id === id),
    )
  )
    throw Error("Hakedişe bağlı iş silinemez");
  if (
    [
      "fuel_records",
      "fuel_tank_movements",
      "cash_records",
      "cari_movements",
    ].includes(store)
  )
    throw Error("Bağlı finans/yakıt hareketi tek başına silinemez");
  if (store === "work_records" && rec.work_batch_id && rec.slip_id)
    throw Error("Toplu fişe bağlı iş tek başına silinemez");
  const upd = { ...rec, deleted_at: nowISO(), updated_at: nowISO() };
  await put(store, upd);
  await audit(
    store,
    id,
    "soft_delete",
    { deleted_at: rec.deleted_at },
    { deleted_at: upd.deleted_at },
    reason || "",
  );
  return upd;
}
// Mükerrer depo GİRİŞİ silme (birleştirme sonrası). Sayım/çıkış hareketi ve borca bağlı giriş silinmez.
export async function deleteTankIn(id, reason) {
  const rec = await get("fuel_tank_movements", id);
  if (!rec || rec.deleted_at) return null;
  if (rec.move_type !== "GİRİŞ" || rec.count_id || rec.fuel_record_id) throw Error("Yalnız depo girişi silinebilir");
  if ((await getAll("payables")).some((b) => isActive(b) && b.status !== "İptal" && b.source_store === "fuel_tank_movements" && b.source_id === id)) throw Error("Borca bağlı giriş silinemez");
  const upd = { ...rec, deleted_at: nowISO(), updated_at: nowISO() };
  await put("fuel_tank_movements", upd);
  await audit("fuel_tank_movements", id, "soft_delete", { deleted_at: null }, { deleted_at: upd.deleted_at }, reason || "");
  return upd;
}
export async function restore(store, id) {
  const rec = await get(store, id);
  if (!rec) return null;
  const upd = { ...rec, deleted_at: null, updated_at: nowISO() };
  await put(store, upd);
  await audit(
    store,
    id,
    "restore",
    { deleted_at: rec.deleted_at },
    { deleted_at: null },
    "",
  );
  return upd;
}

// ---- meta ----
export async function metaGet(key) {
  const db = await openDB();
  const row = await wrap(tx(db, "meta", "readonly").get(key));
  return row ? row.value : null;
}
export async function metaSet(key, value) {
  const db = await openDB();
  return wrap(tx(db, "meta", "readwrite").put({ key, value }));
}

// Sayaç (fiş/teklif/hakediş seri no) — tek transaction'da atomik artış
export async function nextSeq(name) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t = db.transaction("meta", "readwrite");
    const st = t.objectStore("meta");
    const g = st.get("seq_" + name);
    g.onsuccess = () => {
      const cur = (g.result && g.result.value) || 0;
      const nx = cur + 1;
      st.put({ key: "seq_" + name, value: nx });
      t.oncomplete = () => resolve(nx);
    };
    g.onerror = () => reject(g.error);
    t.onerror = () => reject(t.error);
  });
}

// ---- audit (§48): old/new/reason/timestamp ----
export async function audit(entity, entityId, action, oldV, newV, reason) {
  const db = await openDB();
  const rec = {
    id: uuid(),
    entity,
    entity_id: entityId,
    action,
    old: oldV ?? null,
    new: newV ?? null,
    reason: reason || "",
    at: nowISO(),
  };
  return wrap(tx(db, "audit_log", "readwrite").put(rec));
}

// ---- taslak autosave ----
export async function draftSave(form, values) {
  const db = await openDB();
  return wrap(
    tx(db, "drafts", "readwrite").put({ form, values, saved_at: nowISO() }),
  );
}
export async function draftGet(form) {
  const db = await openDB();
  const row = await wrap(tx(db, "drafts", "readonly").get(form));
  return row ? row.values : null;
}
export async function draftClear(form) {
  const db = await openDB();
  return wrap(tx(db, "drafts", "readwrite").delete(form));
}

// ---- attachments (Blob ayrı store; JSON'a GÖMÜLMEZ; orijinal immutable, türev derived_of) ----
export async function addAttachment(recordType, recordId, file, extra = {}) {
  file = await (await import("./image-shrink.js")).shrinkImage(file, { kind: extra.kind });
  const rec = {
    id: uuid(),
    record_type: recordType,
    record_id: recordId,
    name: file.name || "foto",
    type: file.type || "image/jpeg",
    size: file.size || 0,
    blob: file,
    derived_of: extra.derived_of || null,
    kind: extra.kind || "photo",
    created_at: nowISO(),
  };
  await put("attachments", rec);
  return rec;
}
export async function attachmentsFor(recordType, recordId) {
  return (await getAll("attachments")).filter(
    (a) => a.record_type === recordType && a.record_id === recordId,
  );
}
export async function attachmentsCountMap() {
  const m = {};
  for (const a of await getAll("attachments"))
    m[a.record_id] = (m[a.record_id] || 0) + 1;
  return m;
}

// ---- v1→v2 kayıt seviyesi migration + ilk kurulum seed ----
export async function ensureSeeded() {
  let installId = await metaGet("device_install_id");
  if (!installId) {
    installId = uuid();
    await metaSet("device_install_id", installId);
  }

  // v1 seed (taze kurulum)
  if (!(await metaGet("seeded_v1"))) {
    for (const name of SEED_VEHICLES)
      await put(
        "vehicles",
        newRecord({
          name,
          type: "Araç/Makine",
          ownership: VEHICLE_OWNERSHIP[0],
          active: true,
        }),
      );
    for (const name of SEED_PERSONNEL)
      await put("personnel", newRecord({ name, role: "", active: true }));
    await metaSet("seeded_v1", true);
  }

  // v2 migration: v1 kayıtlarına eksik alanlar (kayıp alan YOK; yalnız ek alanlar, ids Dokunulmaz)
  if (!(await metaGet("migrated_v2"))) {
    for (const store of ENTITY_STORES) {
      for (const r of await getAll(store)) {
        let ch = false;
        const upd = { ...r };
        if (upd.schema_version == null) {
          upd.schema_version = 1;
          ch = true;
        }
        if (upd.migration_status == null) {
          upd.migration_status = "NOT_IMPORTED";
          ch = true;
        }
        if (upd.deleted_at === undefined) {
          upd.deleted_at = null;
          ch = true;
        }
        if (store === "work_records" && upd.slip_id === undefined) {
          upd.slip_id = null;
          ch = true;
        }
        if (store === "documents" && upd.ocr === undefined) {
          upd.ocr = { status: "YOK" };
          ch = true;
        }
        if (ch) await put(store, upd);
      }
    }
    // v2 varsayılan ayarlar (fiyatlar/KDV ayarlardan okunur — koda gömülü değil)
    if ((await metaGet("kdv_default")) == null)
      await metaSet("kdv_default", 20);
    if ((await metaGet("crane_first_hour")) == null)
      await metaSet("crane_first_hour", 9000);
    if ((await metaGet("crane_next_hour")) == null)
      await metaSet("crane_next_hour", 3000);

    // Alias seed (sahapro-domain kuralları)
    if (!(await metaGet("seeded_aliases_v2"))) {
      const vehs = await listActive("vehicles");
      const byName = {};
      for (const v of vehs) byName[v.name] = v.id;
      for (const [alias, targetName] of SEED_ALIASES) {
        if (byName[targetName])
          await put(
            "aliases",
            newRecord({
              alias,
              target_type: "vehicle",
              target_id: byName[targetName],
              active: true,
            }),
          );
      }
      await metaSet("seeded_aliases_v2", true);
    }

    // Başlangıç fiyat listesi (hakedis-engine örnekleri; kullanıcı düzenleyebilir)
    if (!(await metaGet("seeded_pricebook_v2"))) {
      const vehs = await listActive("vehicles");
      const vid = (n) => {
        const v = vehs.find((x) => x.name === n);
        return v ? v.id : null;
      };
      const seeds = [
        { work_type: "Hafriyat Nakliye", unit: "Sefer", price: 10000 },
        { work_type: "Moloz Nakliye", unit: "Sefer", price: 12500 },
        { vehicle_id: vid("DX225 / Yeni Makine"), unit: "Saat", price: 4000 },
        {
          vehicle_id: vid("DX225 / Yeni Makine"),
          unit: "Yevmiye",
          price: 25000,
        },
        { vehicle_id: vid("14 Tonluk Kato"), unit: "Yevmiye", price: 20000 },
        {
          vehicle_id: vid("Mobil Vinç"),
          unit: "Saat",
          formula: "CRANE_FIRST_HOUR",
        },
      ];
      for (const s of seeds) {
        await put(
          "price_book",
          newRecord({
            ...s,
            kdv_rate: 20,
            kdv_included: false,
            valid_from: null,
            valid_to: null,
            customer_id: null,
            site_id: null,
            active: true,
          }),
        );
      }
      await metaSet("seeded_pricebook_v2", true);
    }
    await metaSet("migrated_v2", true);
    await metaSet("schema_version_current", SCHEMA_VERSION);
  }
  if (!(await metaGet("migrated_business_v3"))) {
    const { documentOwner, OWNER_STORES } = await import("./business.js");
    for (const doc of await getAll("documents"))
      if (!doc.owner_type) {
        const expected = documentOwner(doc.category),
          candidates = ["vehicle", "personnel", "customer"].filter(
            (k) => doc[k + "_id"],
          );
        const type =
          expected && doc[expected + "_id"]
            ? expected
            : candidates.length === 1
              ? candidates[0]
              : null;
        const ownerId = type ? doc[type + "_id"] : null,
          exists = ownerId ? await get(OWNER_STORES[type], ownerId) : null;
        await put("documents", {
          ...doc,
          owner_type: exists ? type : null,
          owner_id: exists ? ownerId : null,
          needs_owner_review: !exists || candidates.length > 1,
        });
      }
    await metaSet("migrated_business_v3", true);
  }
  if (!(await metaGet("doc_dedupe_v1"))) {
    try { await dedupeDocuments(); } catch (e) { console.warn("Mükerrer belge temizliği", e); }
    await metaSet("doc_dedupe_v1", true);
  }
  await metaSet("schema_version_current", SCHEMA_VERSION);
  return installId;
}

// ---- backup için tüm entity verisi ----
export async function dumpAll() {
  const out = {};
  for (const s of ENTITY_STORES) out[s] = await getAll(s);
  return out;
}

// ---- kayıt yardımcıları ----
export async function saveNew(store, fields, auditReason) {
  if (ENTERPRISE_STORES.includes(store) || ["inbox_messages","meter_readings","shift_assignments","custody_records","downtime_records","maintenance_parts","cost_allocations","bank_import_rows","stock_counts"].includes(store))
    throw Error("İşletme defteri ilgili işlem ekranından oluşturulmalı");
  fields = await validateFields(store, fields);
  if (store === "fuel_records") return saveFuelEvent(fields, auditReason);
  if (store === "fuel_tank_movements" && fields.move_type === "ÇIKIŞ") {
    const fuel = await saveFuelEvent(
      { ...fields, fuel_source: "Depo Tankı" },
      auditReason,
    );
    return get("fuel_tank_movements", fuel.tank_movement_id);
  }
  if (store === "hakedis") return createHakedis(fields);
  if (store === "cash_records") return saveCashEvent(fields);
  if (store === "documents") await assertNotDuplicateDoc(fields);
  const rec = newRecord(fields);
  await put(store, rec);
  await audit(store, rec.id, "create", null, fields, auditReason || "");
  return rec;
}

// All transport rows commit together; invalid rows cannot leave a partial job.
export async function saveWorkBatch(rows) {
  if (!Array.isArray(rows) || rows.length < 2)
    throw Error("En az iki satır gerekli");
  const first = rows[0];
  if (
    rows.some(
      (r) =>
        r.customer_id !== first.customer_id ||
        r.site_id !== first.site_id ||
        r.date !== first.date ||
        r.work_type !== first.work_type ||
        r.unit !== "Sefer",
    ) ||
    !["Hafriyat Nakliye", "Moloz Nakliye", "Çöp Nakliye", "Mıcır Nakliye", "Kum Nakliye", "Gravak Nakliye"].includes(
      first.work_type,
    )
  )
    throw Error(
      "Satırlar aynı müşteri, şantiye, tarih ve nakliye işine ait olmalı",
    );
  const batch = uuid(),
    validated = [];
  for (const [index, row] of rows.entries()) {
    if (!row.dump_site_id && !row.dump_area?.trim())
      throw Error("Her satır için döküm yeri seçin");
    if (!Number.isInteger(Number(row.quantity)))
      throw Error("Sefer miktarı tam sayı olmalı");
    if (
      row.distance_km != null &&
      (!Number.isFinite(Number(row.distance_km)) || Number(row.distance_km) < 0)
    )
      throw Error("Mesafe geçersiz");
    if (
      row.price_snapshot &&
      (!Number.isFinite(Number(row.price_snapshot.unit_price)) ||
        Number(row.price_snapshot.unit_price) < 0 ||
        !Number.isFinite(Number(row.price_snapshot.kdv_rate)) ||
        Number(row.price_snapshot.kdv_rate) < 0 ||
        Number(row.price_snapshot.kdv_rate) > 100)
    )
      throw Error("Satır fiyatı veya KDV geçersiz");
    const fields = await validateFields("work_records", row);
    validated.push(
      newRecord({ ...fields, work_batch_id: batch, batch_row: index + 1 }),
    );
  }
  const d = await openDB();
  return new Promise((resolve, reject) => {
    const t = d.transaction(["work_records", "audit_log"], "readwrite");
    for (const rec of validated) {
      t.objectStore("work_records").add(rec);
      t.objectStore("audit_log").add(
        newRecord({
          entity: "work_records",
          entity_id: rec.id,
          action: "create",
          old: null,
          new: rec,
          at: nowISO(),
          reason: "Çok satırlı nakliye girişi",
        }),
      );
    }
    t.oncomplete = () => resolve(validated);
    t.onabort = t.onerror = () =>
      reject(t.error || Error("Satırlar kaydedilemedi"));
  });
}

export async function saveWorkSlip(fields, workIds) {
  if (
    !Array.isArray(workIds) ||
    !workIds.length ||
    new Set(workIds).size !== workIds.length
  )
    throw Error("Fiş için geçerli işler gerekli");
  fields = await validateFields("slips", fields);
  const d = await openDB();
  return new Promise((resolve, reject) => {
    const t = d.transaction(["slips", "work_records"], "readwrite");
    const rows = [],
      rec = newRecord({
        ...fields,
        work_record_id: workIds[0],
        work_record_ids: workIds,
      });
    let error;
    for (const id of workIds) {
      const req = t.objectStore("work_records").get(id);
      req.onsuccess = () => {
        rows.push(req.result);
        if (rows.length !== workIds.length) return;
        if (
          rows.some(
            (w) =>
              !w ||
              !isActive(w) ||
              w.slip_id ||
              w.customer_id !== fields.customer_id ||
              (w.site_id || null) !== (fields.site_id || null) ||
              w.date !== fields.date ||
              w.unit !== fields.unit ||
              w.work_type !== fields.work_text,
          ) ||
          rows.some((w) => w.work_batch_id !== rows[0].work_batch_id) ||
          (rows.length > 1 && !rows[0].work_batch_id) ||
          rows.reduce((sum, w) => sum + Number(w.quantity), 0) !==
            Number(fields.quantity)
        ) {
          error = Error(
            "Fiş işleri değişmiş, başka fişe bağlı veya miktar/müşteri uyuşmuyor",
          );
          t.abort();
          return;
        }
        // Frozen, whitelisted customer lines; neither owner-private fields nor dump locations enter the slip.
        rec.customer_items = rows.map((w) => ({
          date: w.date,
          customer_id: w.customer_id,
          site_id: w.site_id,
          work_type: w.work_type,
          material: w.material || "",
          quantity: w.quantity,
          unit: w.unit,
          unit_price: w.price_snapshot?.unit_price ?? null,
          kdv_rate: w.price_snapshot?.kdv_rate ?? 20,
          kdv_included: !!w.price_snapshot?.kdv_included,
        }));
        t.objectStore("slips").add(rec);
        for (const w of rows)
          t.objectStore("work_records").put({
            ...w,
            slip_id: rec.id,
            updated_at: nowISO(),
          });
      };
    }
    t.oncomplete = () => resolve(rec);
    t.onabort = t.onerror = () => reject(error || t.error);
  });
}

export async function saveExisting(store, rec, fields, auditReason) {
  if (ENTERPRISE_STORES.includes(store) || ["inbox_messages","meter_readings","shift_assignments","custody_records","downtime_records","maintenance_parts","cost_allocations","bank_import_rows","stock_counts"].includes(store))
    throw Error("İşletme defteri ilgili işlem ekranından güncellenmeli");
  const current = await get(store, rec.id);
  if(store==='fuel_tank_movements'&&current?.count_id)throw Error("Sayım hareketi tek başına değiştirilemez; yeni fiziksel sayım yapın");
  if((await getAll('cost_allocations')).some(r=>isActive(r)&&r.status==='Aktif'&&r.source_store===store&&r.source_id===rec.id)&&Object.keys(fields).some(k=>['amount','total','cost','kdv_rate','date','vehicle_id','site_id','customer_id'].includes(k)))throw Error('Maliyeti değiştirmeden önce dağıtımı iptal edin');
  if (
    current?.bank_movement_id &&
    Object.keys(fields).some((k) =>
      [
        "amount",
        "date",
        "customer_id",
        "personnel_id",
        "bank_account_id",
        "bank_movement_id",
        "payment_method",
        "cash_type",
      ].includes(k),
    )
  )
    throw Error("Bankaya bağlı hareket tek başına değiştirilemez");
  if (
    (store === "contracts" && current?.status === "İmzalandı") ||
    (store === "hakedis" && current?.status === "Kesinleşti") ||
    (store === "work_records" &&
      current?.price_snapshot?.locked &&
      Object.keys(fields).some((k) =>
        [
          "date",
          "customer_id",
          "site_id",
          "vehicle_id",
          "personnel_id",
          "work_type",
          "material",
          "quantity",
          "unit",
          "price_snapshot",
          "time_start",
          "time_end",
          "break_minutes",
        ].includes(k),
      )) ||
    (store === "slips" &&
      (current?.signed_at || current?.status === "İmzalandı") &&
      !(fields.status === "Revize" && Object.keys(fields).length === 1))
  )
    throw Error("Kesinleşmiş kayıt değiştirilemez; revizyon oluşturun");
  if (
    store === "work_records" &&
    current?.work_batch_id &&
    current?.slip_id &&
    Object.keys(fields).some((k) =>
      [
        "date",
        "customer_id",
        "site_id",
        "work_type",
        "quantity",
        "unit",
        "material",
        "price_snapshot",
      ].includes(k),
    )
  )
    throw Error(
      "Toplu fişe bağlı iş değiştirilemez; düzeltme için yeni iş ve fiş oluşturun",
    );
  if (
    ["expense_records", "fuel_records", "maintenance_records"].includes(
      store,
    ) &&
    Object.keys(fields).some((k) =>
      [
        "date",
        "amount",
        "total",
        "total_amount",
        "cost",
        "liters",
        "unit_price",
        "kdv_rate",
        "vehicle_id",
        "personnel_id",
        "customer_id",
        "site_id",
      ].includes(k),
    ) &&
    (await listActive("payables")).some(
      (b) =>
        b.status !== "İptal" &&
        b.source_store === store &&
        b.source_id === rec.id,
    )
  )
    throw Error(
      "Alış belgesine bağlı maliyet değiştirilemez; borç kaydını inceleyin",
    );
  fields = await validateFields(store, { ...current, ...fields });
  const upd = {
    ...touchRecord(rec),
    ...fields,
    id: rec.id,
    created_at: rec.created_at,
    source: rec.source,
    schema_version: rec.schema_version,
    migration_status: rec.migration_status,
    deleted_at: rec.deleted_at,
  };
  await put(store, upd);
  await audit(store, rec.id, "update", rec, fields, auditReason || "");
  return upd;
}

let backupPromise;
function backupBeforeUpgrade() {
  if (backupPromise) return backupPromise;
  backupPromise = (async () => {
    const databases =
      typeof indexedDB.databases === "function"
        ? await indexedDB.databases()
        : null;
    const info = databases?.find((d) => d.name === dbName());
    if (databases && (!info || info.version >= DB_VERSION)) return;
    const old = await new Promise((res, rej) => {
      const r = indexedDB.open(dbName());
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    const stores = [...old.objectStoreNames],
      snapshot = {
        id: dbName() + "-v" + old.version + "-" + nowISO(),
        version: old.version,
        created_at: nowISO(),
        stores: {},
      };
    await new Promise((res, rej) => {
      const t = old.transaction(stores, "readonly");
      for (const name of stores) {
        const r = t.objectStore(name).getAll();
        r.onsuccess = () => (snapshot.stores[name] = r.result);
      }
      t.oncomplete = res;
      t.onerror = () => rej(t.error);
    });
    old.close();
    const recovery = await new Promise((res, rej) => {
      const r = indexedDB.open(dbName() + "_recovery", 1);
      r.onupgradeneeded = () =>
        r.result.createObjectStore("snapshots", { keyPath: "id" });
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    await new Promise((res, rej) => {
      const t = recovery.transaction("snapshots", "readwrite");
      t.objectStore("snapshots").put(snapshot);
      t.oncomplete = res;
      t.onerror = () => rej(t.error);
    });
    recovery.close();
  })();
  return backupPromise;
}
async function validateFields(store, fields) {
  const f = { ...fields };
  if (f.date) {
    const parsed = new Date(f.date + "T12:00:00Z");
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(f.date) ||
      !Number.isFinite(parsed.getTime()) ||
      parsed.toISOString().slice(0, 10) !== f.date
    )
      throw Error("Geçerli tarih girin");
  }
  if (
    [
      "work_records",
      "fuel_records",
      "fuel_tank_movements",
      "cash_records",
      "expense_records",
      "maintenance_records",
      "personnel_events",
    ].includes(store) &&
    !f.date
  )
    throw Error("Tarih zorunlu");
  for (const [key, target] of Object.entries({
    customer_id: "customers",
    vehicle_id: "vehicles",
    personnel_id: "personnel",
    contractor_id: "contractors",
    dump_site_id: "dump_sites",
    quarry_id: "quarries",
  })) {
    if (f[key]) {
      const owner = await get(target, f[key]);
      if (!owner || owner.deleted_at)
        throw Error("İlgili kayıt bulunamadı: " + key);
    }
  }
  if (
    store === "expense_records" &&
    (!(Number(f.amount) > 0) ||
      (f.payment_method === "Personel Ödedi" && !f.personnel_id))
  )
    throw Error("Pozitif gider tutarı ve personel ödemesinde personel zorunlu");
  if (f.site_id) {
    const site = await get("sites", f.site_id);
    if (
      !site ||
      site.deleted_at ||
      !f.customer_id ||
      site.customer_id !== f.customer_id
    )
      throw Error("Şantiye seçilen müşteriye ait değil");
  }
  if (store === "documents") {
    const { normalizedDocument, OWNER_STORES } = await import("./business.js");
    const d = normalizedDocument(f);
    if (d.owner_type === "company") await ensureCompany();
    const owner = await get(OWNER_STORES[d.owner_type], d.owner_id);
    if (!owner || owner.deleted_at) throw Error("Belge sahibi bulunamadı");
    return d;
  }
  if (store === "cash_records") {
    if (!(Number(f.amount) > 0))
      throw Error("Tahsilat/kasa tutarı pozitif olmalı");
    if (f.cash_type === "Müşteriden Para Alındı" && !f.customer_id)
      throw Error("Tahsilat için müşteri zorunlu");
    if (f.cash_status === "PERSONELDE" && !f.personnel_id)
      throw Error("Personeldeki para için personel seçin");
  }
  if (
    store === "cari_movements" &&
    (!Number.isFinite(Number(f.amount)) ||
      (f.type === "Duzeltme" && !f.reason?.trim()))
  )
    throw Error("Cari tutarı veya düzeltme nedeni geçersiz");
  if (store === "work_records") {
    if (f.time_start || f.time_end) {
      if (f.unit !== "Saat")
        throw Error("Saat puantajı yalnız Saat biriminde kullanılabilir");
      const hours = workHours(f.time_start, f.time_end, f.break_minutes || 0);
      if (Math.abs(hours - Number(f.quantity)) > 0.0001)
        throw Error(
          "Puantaj ile saat miktarı aynı olmalı; Saat Miktarını Hesapla kullanın",
        );
    }
    if (
      !f.customer_id ||
      !f.vehicle_id ||
      !f.work_type ||
      !(Number(f.quantity) > 0)
    )
      throw Error("Müşteri, araç, iş türü ve pozitif miktar zorunlu");
  }
  if (
    ["expense_records", "fuel_records", "maintenance_records"].includes(
      store,
    ) &&
    f.kdv_rate != null &&
    (!Number.isFinite(Number(f.kdv_rate)) ||
      Number(f.kdv_rate) < 0 ||
      Number(f.kdv_rate) > 100)
  )
    throw Error("KDV 0–100 aralığında olmalı");
  if (store === "maintenance_records" && !f.vehicle_id)
    throw Error("Bakım/arıza araca bağlanmalı");
  if (store === "price_book") {
    const { PRICE_VEHICLE_GROUPS } = await import("./core.js");
    if (
      f.vehicle_group &&
      (!PRICE_VEHICLE_GROUPS[f.vehicle_group] || f.vehicle_id || f.vehicle_type)
    )
      throw Error(
        "Araç grubu, belirli plaka ve tür aynı fiyat kuralında birlikte seçilemez",
      );
    if (f.site_id && !f.customer_id)
      throw Error("Şantiye fiyatında müşteri zorunlu");
    if (
      f.distance_min != null &&
      f.distance_max != null &&
      Number(f.distance_min) > Number(f.distance_max)
    )
      throw Error("Mesafe aralığı geçersiz");
  }
  if (
    ["fuel_records", "fuel_tank_movements"].includes(store) &&
    !(Number(f.liters) > 0)
  )
    throw Error("Litre sıfırdan büyük olmalı");
  if (
    store === "work_records" &&
    f.price_snapshot &&
    !f.price_snapshot.locked
  ) {
    const { priceForQuantity } = await import("./core.js");
    f.price_snapshot = {
      ...f.price_snapshot,
      amount: priceForQuantity(
        { ...f.price_snapshot, price: f.price_snapshot.unit_price },
        f.quantity,
        {
          first: f.price_snapshot.first_hour_price,
          next: f.price_snapshot.next_hour_price,
        },
      ),
    };
  }
  return f;
}
export async function saveFuelEvent(fields, reason = "Yakıt") {
  if (!fields.vehicle_id || !(Number(fields.liters) > 0))
    throw Error("Araç ve pozitif litre zorunlu");
  const d = await openDB();
  return new Promise((resolve, reject) => {
    const stores = ["fuel_records", "fuel_tank_movements", "audit_log"];
    const t = d.transaction(stores, "readwrite");
    let result, error;
    const request = t.objectStore("fuel_tank_movements").getAll();
    request.onsuccess = () => {
      const tank = fields.fuel_source === "Depo Tankı";
      const remaining = request.result
        .filter(isActive)
        .reduce(
          (s, r) => s + (r.move_type === "GİRİŞ" ? 1 : -1) * Number(r.liters),
          0,
        );
      if (tank && Number(fields.liters) > remaining) {
        error = Error("Tank stokundan fazla yakıt: kalan " + remaining + " Lt");
        t.abort();
        return;
      }
      const event = uuid();
      result = newRecord({
        ...fields,
        liters: Number(fields.liters),
        event_id: event,
      });
      // Depodan verilen yakıtın tutarı girilmediyse depo girişlerinin ortalama litre fiyatıyla maliyetlenir
      if (tank && !(Number(result.total) > 0)) {
        const up = tankUnitCost(request.result, result.date) ?? tankUnitCost(request.result);
        if (up) Object.assign(result, { unit_price: up, total: Math.round(up * result.liters * 100) / 100, cost_source: "Depo ortalaması" });
      }
      if (tank) {
        const move = newRecord({
          date: fields.date,
          move_type: "ÇIKIŞ",
          liters: result.liters,
          vehicle_id: fields.vehicle_id,
          personnel_id: fields.personnel_id || null,
          pump_no: fields.pump_no || "",
          signature_name: fields.signature_name || "",
          event_id: event,
          fuel_record_id: result.id,
        });
        result.tank_movement_id = move.id;
        t.objectStore("fuel_tank_movements").put(move);
      }
      t.objectStore("fuel_records").put(result);
      t.objectStore("audit_log").put({
        id: uuid(),
        entity: "fuel_records",
        entity_id: result.id,
        action: "create",
        new: fields,
        reason,
        at: nowISO(),
      });
    };
    t.oncomplete = () => resolve(result);
    t.onabort = t.onerror = () =>
      reject(error || t.error || Error("Yakıt işlemi iptal edildi"));
  });
}
// Yakıt kaydının kaynağını "Depo Tankı" yapar ya da kaydı (depo hareketiyle birlikte) siler — tek işlemde.
// mode: "to_tank" | "delete". Tedarikçi borcuna bağlı yakıt değiştirilmez.
export async function fuelFix(id, mode, reason = "") {
  const linked = (await getAll("payables")).some((b) => isActive(b) && b.status !== "İptal" && b.source_store === "fuel_records" && b.source_id === id);
  if (linked) throw Error("Tedarikçi borcuna bağlı yakıt değiştirilemez");
  const d = await openDB();
  return new Promise((resolve, reject) => {
    const t = d.transaction(["fuel_records", "fuel_tank_movements", "audit_log"], "readwrite");
    let error, result;
    const fr = t.objectStore("fuel_records").get(id);
    const mv = t.objectStore("fuel_tank_movements").getAll();
    let f, moves;
    const run = () => {
      if (f === undefined || !moves) return;
      if (!f || f.deleted_at) { error = Error("Yakıt kaydı bulunamadı"); return t.abort(); }
      const now = nowISO();
      const live = moves.filter(isActive);
      if (mode === "to_tank") {
        if (f.fuel_source === "Depo Tankı") { error = Error("Zaten depodan"); return t.abort(); }
        const remaining = live.reduce((s, r) => s + (r.move_type === "GİRİŞ" ? 1 : -1) * Number(r.liters), 0);
        if (Number(f.liters) > remaining) { error = Error("Depoda kayıtlı " + remaining + " Lt var; önce depoya yakıt girişi yapın"); return t.abort(); }
        const ev = f.event_id || uuid();
        const move = newRecord({ date: f.date, move_type: "ÇIKIŞ", liters: Number(f.liters), vehicle_id: f.vehicle_id, personnel_id: f.personnel_id || null,
          pump_no: f.pump_no || "", signature_name: "", event_id: ev, fuel_record_id: f.id });
        t.objectStore("fuel_tank_movements").put(move);
        result = { ...f, fuel_source: "Depo Tankı", receipt: "Depo", tank_movement_id: move.id, event_id: ev, updated_at: now };
        if (!(Number(f.total) > 0)) {
          const up = tankUnitCost(moves, f.date) ?? tankUnitCost(moves);
          if (up) Object.assign(result, { unit_price: up, total: Math.round(up * Number(f.liters) * 100) / 100, cost_source: "Depo ortalaması" });
        }
      } else if (mode === "delete") {
        const m = live.find((x) => x.id === f.tank_movement_id || x.fuel_record_id === f.id);
        if (m) t.objectStore("fuel_tank_movements").put({ ...m, deleted_at: now, updated_at: now });
        result = { ...f, deleted_at: now, updated_at: now };
      } else { error = Error("Geçersiz işlem"); return t.abort(); }
      t.objectStore("fuel_records").put(result);
      t.objectStore("audit_log").put({ id: uuid(), entity: "fuel_records", entity_id: f.id, action: mode === "delete" ? "soft_delete" : "update",
        old: { fuel_source: f.fuel_source, deleted_at: f.deleted_at || null }, new: { fuel_source: result.fuel_source, deleted_at: result.deleted_at || null }, reason, at: now });
    };
    fr.onsuccess = () => { f = fr.result || null; run(); };
    mv.onsuccess = () => { moves = mv.result; run(); };
    t.oncomplete = () => resolve(result);
    t.onabort = t.onerror = () => reject(error || t.error || Error("Yakıt işlemi iptal edildi"));
  });
}
// Tutarı olmayan depo yakıtlarına ortalama depo fiyatıyla maliyet yazar (tek işlem). Kaç kayıt güncellendiğini döner.
export async function fillTankFuelCosts() {
  const d = await openDB();
  return new Promise((resolve, reject) => {
    const t = d.transaction(["fuel_records", "fuel_tank_movements", "audit_log"], "readwrite");
    let n = 0, fuels, moves;
    const run = () => {
      if (!fuels || !moves) return;
      const now = nowISO();
      for (const f of fuels) {
        if (!isActive(f) || f.fuel_source !== "Depo Tankı" || Number(f.total) > 0) continue;
        const up = tankUnitCost(moves, f.date) ?? tankUnitCost(moves);
        if (!up) continue;
        const upd = { ...f, unit_price: up, total: Math.round(up * Number(f.liters) * 100) / 100, cost_source: "Depo ortalaması", updated_at: now };
        t.objectStore("fuel_records").put(upd);
        t.objectStore("audit_log").put({ id: uuid(), entity: "fuel_records", entity_id: f.id, action: "update", old: { total: f.total ?? null }, new: { total: upd.total }, reason: "Depo ortalama maliyeti", at: now });
        n++;
      }
    };
    const a = t.objectStore("fuel_records").getAll(), b = t.objectStore("fuel_tank_movements").getAll();
    a.onsuccess = () => { fuels = a.result; run(); };
    b.onsuccess = () => { moves = b.result; run(); };
    t.oncomplete = () => resolve(n);
    t.onabort = t.onerror = () => reject(t.error);
  });
}
// Depo girişlerinde litre fiyatı toplamla tutmuyorsa (ör. faturadaki KDV hariç birim fiyat yazılmış) toplam ÷ litre yapılır;
// ortalamayla otomatik maliyetlenmiş depo yakıtları yeni ortalamayla yeniden hesaplanır. Tek işlem; ne değiştiğini döner.
export async function repairTankPrices() {
  const d = await openDB();
  return new Promise((resolve, reject) => {
    const t = d.transaction(["fuel_records", "fuel_tank_movements", "audit_log"], "readwrite");
    const out = { moves: 0, fuels: 0 };
    let fuels, moves;
    const run = () => {
      if (!fuels || !moves) return;
      const now = nowISO();
      for (const m of moves) {
        if (!isActive(m) || m.move_type !== "GİRİŞ" || m.count_id || !(Number(m.total) > 0) || !(Number(m.liters) > 0)) continue;
        const up = Math.round((Number(m.total) / Number(m.liters)) * 100) / 100;
        if (Math.abs((Number(m.unit_price) || 0) - up) <= Math.max(0.05, up * 0.005)) continue;
        const old = m.unit_price ?? null;
        const upd = { ...m, unit_price: up, updated_at: now };
        Object.assign(m, upd);
        t.objectStore("fuel_tank_movements").put(upd);
        t.objectStore("audit_log").put({ id: uuid(), entity: "fuel_tank_movements", entity_id: m.id, action: "update", old: { unit_price: old }, new: { unit_price: up }, reason: "Litre fiyatı = toplam ÷ litre (KDV dahil)", at: now });
        out.moves++;
      }
      for (const f of fuels) {
        if (!isActive(f) || f.fuel_source !== "Depo Tankı" || f.cost_source !== "Depo ortalaması" || !(Number(f.liters) > 0)) continue;
        const up = tankUnitCost(moves, f.date) ?? tankUnitCost(moves);
        if (!up) continue;
        const total = Math.round(up * Number(f.liters) * 100) / 100;
        if (Math.abs((Number(f.total) || 0) - total) < 0.5) continue;
        t.objectStore("fuel_records").put({ ...f, unit_price: up, total, updated_at: now });
        t.objectStore("audit_log").put({ id: uuid(), entity: "fuel_records", entity_id: f.id, action: "update", old: { total: f.total ?? null }, new: { total }, reason: "Depo ortalama maliyeti düzeltildi", at: now });
        out.fuels++;
      }
    };
    const a = t.objectStore("fuel_records").getAll(), b = t.objectStore("fuel_tank_movements").getAll();
    a.onsuccess = () => { fuels = a.result; run(); };
    b.onsuccess = () => { moves = b.result; run(); };
    t.oncomplete = () => resolve(out);
    t.onabort = t.onerror = () => reject(t.error);
  });
}
export async function createHakedis(fields) {
  const d = await openDB();
  return new Promise((resolve, reject) => {
    const t = d.transaction(["hakedis", "work_records"], "readwrite");
    let rec, error;
    const h = t.objectStore("hakedis").getAll(),
      w = t.objectStore("work_records").getAll();
    let hs, ws;
    function run() {
      if (!hs || !ws) return;
      const ids = new Set();
      for (const item of fields.items || []) {
        const work = ws.find((x) => x.id === item.work_record_id);
        if (
          ids.has(item.work_record_id) ||
          !work ||
          !isActive(work) ||
          work.customer_id !== fields.customer_id ||
          (fields.site_id && work.site_id !== fields.site_id) ||
          work.date < fields.date_from ||
          work.date > fields.date_to ||
          hs.some(
            (x) =>
              isActive(x) &&
              x.status !== "İptal" &&
              (x.items || []).some((i) => i.work_record_id === work.id),
          )
        ) {
          error = Error(
            "Hakedişte mükerrer, yanlış müşteri veya uygun olmayan iş",
          );
          t.abort();
          return;
        }
        ids.add(item.work_record_id);
      }
      if (!ids.size) {
        error = Error("İş seçin");
        t.abort();
        return;
      }
      rec = newRecord(fields);
      t.objectStore("hakedis").put(rec);
    }
    h.onsuccess = () => {
      hs = h.result;
      run();
    };
    w.onsuccess = () => {
      ws = w.result;
      run();
    };
    t.oncomplete = () => resolve(rec);
    t.onabort = t.onerror = () =>
      reject(error || t.error || Error("Hakediş iptal edildi"));
  });
}
export async function finalizeHakedis(id) {
  const d = await openDB();
  return new Promise((resolve, reject) => {
    const t = d.transaction(
      ["hakedis", "cari_movements", "work_records"],
      "readwrite",
    );
    let result, error;
    const r = t.objectStore("hakedis").get(id);
    r.onsuccess = () => {
      const h = r.result;
      if (!h || h.status !== "Taslak") {
        error = Error("Hakediş zaten kesinleşti veya iptal");
        t.abort();
        return;
      }
      result = { ...h, status: "Kesinleşti", finalized_at: nowISO() };
      t.objectStore("hakedis").put(result);
      t.objectStore("cari_movements").put(
        newRecord({
          date: h.created_date,
          customer_id: h.customer_id,
          type: "Hakedis",
          amount: h.grand_total,
          ref_id: id,
          note: "Hakediş #" + h.hakedis_no,
        }),
      );
      for (const item of h.items) {
        const q = t.objectStore("work_records").get(item.work_record_id);
        q.onsuccess = () => {
          if (q.result)
            t.objectStore("work_records").put({
              ...q.result,
              price_snapshot: {
                ...item,
                price_source: item.price_source || "Snapshot",
                locked: true,
              },
              updated_at: nowISO(),
            });
        };
      }
    };
    t.oncomplete = () => resolve(result);
    t.onabort = t.onerror = () => reject(error || t.error);
  });
}
export async function byRelation(store, key, value) {
  const d = await openDB();
  return wrap(
    d
      .transaction(store, "readonly")
      .objectStore(store)
      .index(key)
      .getAll(value),
  );
}
// Eski fotoğrafları küçült (Ayarlar): imza ve PDF'ler hariç. Dönen: { count, before, after } bayt
export async function shrinkAllAttachments(onProgress) {
  const { shrinkImage, SHRINK_MIN } = await import("./image-shrink.js");
  const list = (await getAll("attachments")).filter((a) => a.blob && a.kind !== "signature" && /^image\//.test(a.type || "") && (a.size || a.blob.size || 0) >= SHRINK_MIN);
  let count = 0, before = 0, after = 0, i = 0;
  for (const a of list) {
    i++;
    const small = await shrinkImage(a.blob instanceof File ? a.blob : new File([a.blob], a.name || "foto", { type: a.type }), { maxEdge: a.record_type === "document" ? 2000 : 1600, quality: a.record_type === "document" ? 0.85 : 0.82 });
    if (small.size < (a.blob.size || 0)) {
      before += a.blob.size; after += small.size; count++;
      await put("attachments", { ...a, blob: small, size: small.size, type: small.type, name: small.name, shrunk_at: nowISO() });
    }
    onProgress?.(i, list.length);
  }
  return { count, before, after, total: list.length };
}
// Aynı belge iki kez kaydedildiyse (aynı sahip + tür ailesi + numara/tarih): ilki tutulur, en geç bitiş tarihi ona yazılır,
// fotoğrafı yoksa diğerinin fotoğrafı ona taşınır, fazlalar çöp kutusuna gider (geri alınabilir).
export async function dedupeDocuments() {
  const { duplicateDocuments } = await import("./core.js");
  const groups = duplicateDocuments(await listActive("documents"));
  const atts = await getAll("attachments");
  let removed = 0;
  for (const [keep, ...dups] of groups) {
    const exp = [keep, ...dups].map((d) => d.expiry_date).filter(Boolean).sort().pop() || keep.expiry_date || null;
    const pref = [keep, ...dups].find((d) => d.expiry_date === exp) || keep;
    const fields = {};
    if (exp !== keep.expiry_date) { fields.expiry_date = exp; if (pref.date) fields.date = pref.date; }
    if (DOC_PREF.includes(pref.category) && pref.category !== keep.category) { fields.category = pref.category; fields.title = pref.category; }
    if (Object.keys(fields).length) await saveExisting("documents", keep, fields, "Mükerrer belge birleştirildi");
    let keepHas = atts.some((a) => a.record_type === "document" && a.record_id === keep.id && !a.deleted_at);
    for (const d of dups) {
      if (!keepHas) for (const a of atts.filter((x) => x.record_type === "document" && x.record_id === d.id)) { await put("attachments", { ...a, record_id: keep.id }); keepHas = true; }
      await softDelete("documents", d.id, "Mükerrer belge (aynı belge iki kez kaydedilmiş)");
      removed++;
    }
  }
  return removed;
}
async function assertNotDuplicateDoc(f) {
  const { sameDocument, trDate } = await import("./core.js");
  const ex = (await listActive("documents")).find((d) => sameDocument(d, f));
  if (ex) throw Error(`Bu belge zaten kayıtlı (${ex.category} · ${ex.doc_no || "no yok"}${ex.expiry_date ? " · bitiş " + trDate(ex.expiry_date) : ""}). Aynı belgeyi ikinci kez eklemeyin; gerekiyorsa kayıtlı belgeyi düzenleyin.`);
}
const DOC_PREF = ["TÜVTÜRK / Periyodik Muayene", "Zorunlu Trafik Sigortası"];
// Şirket evrakının sahibi: meta "company_profile" (ünvan, vergi no…). Yoksa varsayılan adla açılır.
export async function ensureCompany() {
  const cur = await metaGet("company_profile");
  if (!cur) await metaSet("company_profile", { name: (await import("./core.js")).COMPANY_NAME });
}
export async function saveDocument(fields, file) {
  const f = await validateFields("documents", fields),
    owner = await get(
      (await import("./business.js")).OWNER_STORES[f.owner_type],
      f.owner_id,
    );
  if (!owner || owner.deleted_at) throw Error("Belge sahibi geçersiz");
  await assertNotDuplicateDoc(f);
  file = await (await import("./image-shrink.js")).shrinkImage(file, { maxEdge: 2000, quality: 0.85 });
  const rec = newRecord(f),
    attachment = {
      id: uuid(),
      record_type: "document",
      record_id: rec.id,
      name: file.name || "Belge",
      type: file.type,
      size: file.size,
      blob: file,
      kind: "scan_original",
      derived_of: null,
      created_at: nowISO(),
    };
  const d = await openDB();
  await new Promise((resolve, reject) => {
    const t = d.transaction(["documents", "attachments"], "readwrite");
    t.objectStore("documents").put(rec);
    t.objectStore("attachments").put(attachment);
    t.oncomplete = resolve;
    t.onerror = t.onabort = () => reject(t.error);
  });
  return rec;
}
export async function signContract(id, blobs) {
  const d = await openDB();
  return new Promise((resolve, reject) => {
    const t = d.transaction(["contracts", "attachments"], "readwrite");
    let error;
    const r = t.objectStore("contracts").get(id);
    r.onsuccess = () => {
      const c = r.result;
      if (
        !c ||
        c.status === "İmzalandı" ||
        blobs.length !== 2 ||
        blobs.some((b) => !b?.size)
      ) {
        error = Error("Sözleşme veya imzalar geçersiz");
        t.abort();
        return;
      }
      const ids = [];
      for (let i = 0; i < 2; i++) {
        const a = {
          id: uuid(),
          record_type: "contract_signature",
          record_id: id,
          name: i ? "Yuklenici.png" : "Isveren.png",
          type: "image/png",
          size: blobs[i].size,
          blob: blobs[i],
          kind: i ? "contractor" : "employer",
          created_at: nowISO(),
        };
        ids.push(a.id);
        t.objectStore("attachments").put(a);
      }
      t.objectStore("contracts").put({
        ...c,
        status: "İmzalandı",
        signed_at: nowISO(),
        signature_ids: ids,
        signed_snapshot: structuredClone(c),
      });
    };
    t.oncomplete = resolve;
    t.onerror = t.onabort = () => reject(error || t.error);
  });
}

export async function saveCashEvent(fields) {
  const d = await openDB(),
    rec = newRecord(fields);
  return new Promise((res, rej) => {
    const t = d.transaction(["cash_records", "cari_movements"], "readwrite");
    t.objectStore("cash_records").put(rec);
    if (fields.cash_type === "Müşteriden Para Alındı")
      t.objectStore("cari_movements").put(
        newRecord({
          date: fields.date,
          customer_id: fields.customer_id,
          type: "Tahsilat",
          amount: -Number(fields.amount),
          ref_id: rec.id,
          note: "Tahsilat",
        }),
      );
    t.oncomplete = () => res(rec);
    t.onerror = t.onabort = () => rej(t.error);
  });
}

export async function signSlip(id, file) {
  const d = await openDB();
  return new Promise((resolve, reject) => {
    const t = d.transaction(["slips", "attachments"], "readwrite");
    let result, error;
    const req = t.objectStore("slips").get(id);
    req.onsuccess = () => {
      const s = req.result;
      if (!s || s.status !== "Taslak" || !file?.size) {
        error = Error("Fiş taslak olmalı; imza zorunlu");
        t.abort();
        return;
      }
      const att = {
        id: uuid(),
        record_type: "slip_signature",
        record_id: id,
        name: "imza.png",
        type: "image/png",
        size: file.size,
        blob: file,
        kind: "signature",
        created_at: nowISO(),
      };
      result = {
        ...s,
        status: "İmzalandı",
        signed_at: nowISO(),
        signature_attachment_id: att.id,
      };
      t.objectStore("attachments").put(att);
      t.objectStore("slips").put(result);
      if (s.revision_of) {
        const r = t.objectStore("slips").get(s.revision_of);
        r.onsuccess = () => {
          if (r.result?.status === "İmzalandı")
            t.objectStore("slips").put({ ...r.result, status: "Revize" });
        };
      }
    };
    t.oncomplete = () => resolve(result);
    t.onerror = t.onabort = () => reject(error || t.error);
  });
}
