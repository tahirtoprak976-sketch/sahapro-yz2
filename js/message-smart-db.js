import { analyzeMessage } from "./message-engine.js";
import * as db from "./db.js";
import { ENTITY_STORES, newRecord, nowISO, normKey } from "./core.js";
import { transaction } from "./enterprise-db.js";
import { reference, historyFromMessage, live } from "./solo-core.js";
import {
  assistedRows,
  validateReviewRows,
  mergeEligibility,
  memoryFields,
  validateSmartData,
  similarRecords,
  rowQuestions,
} from "./message-smart-core.js";
import { backupBeforeSoloOperation } from "./backup.js";
const run = (fn) =>
  transaction(
    ENTITY_STORES.filter((s) => s !== "audit_log"),
    fn,
  );
export function messageLocked(m, d) {
  return (
    m.status !== "Taslak" ||
    !!m.merge_parent_id ||
    [...(d.work_records || []), ...(d.fuel_records || [])].some((w) =>
      w.history_source?.row_id?.startsWith("inbox-" + m.id + "-"),
    )
  );
}
function editable(m, d) {
  if (messageLocked(m, d))
    throw Error(
      "Aktarılmış, birleştirilmiş veya reddedilmiş kaynak değiştirilemez",
    );
}
function revision(m, expected) {
  if (
    expected !== undefined &&
    JSON.stringify(m.review_rows || null) !== expected
  )
    throw Error("Taslak başka ekranda değişti; yeniden açın");
}
function saveReviewInTransaction(d, t, id, rows, expected) {
  const m = reference(d, "inbox_messages", id);
  editable(m, d);
  revision(m, expected);
  const old = assistedRows(m, d);
  if (
    rows.length !== old.length ||
    rows.some(
      (r, i) => r.source_row !== old[i].source_row || r.kind !== old[i].kind,
    )
  )
    throw Error("Kaynak satır numarası, sırası veya türü değiştirilemez");
  const cleaned = validateReviewRows(rows, d);
  const at = nowISO();
  for (const row of cleaned)
    for (const key of ["vehicle_id", "customer_id", "site_id", "personnel_id"])
      if (
        row[key] &&
        !String(row.field_sources[key] || "").startsWith("Kullanıcı")
      )
        row.field_sources[key] = "Kullanıcı kontrol taslağında onayladı";
  const updated = {
    ...m,
    review_rows: cleaned,
    review_version: 1,
    reviewed_at: at,
    updated_at: at,
  };
  // Bound provenance history: immutable audit_log holds prior record versions.
  updated.review_events = [
    ...(m.review_events || []).slice(-19),
    { at, action: "Alanlar kullanıcı tarafından doğrulandı" },
  ];
  t.put("inbox_messages", updated);
  return updated;
}
export async function saveMessageRows(id, rows, expected) {
  return run((d, t) => saveReviewInTransaction(d, t, id, rows, expected));
}
// Customer and current unsaved draft are committed together; no financial write.
export async function createMessageCustomer(
  id,
  sourceRow,
  rows,
  fields,
  expected,
) {
  return run((d, t) => {
    const m = reference(d, "inbox_messages", id);
    editable(m, d);
    revision(m, expected);
    if (typeof fields.name !== "string") throw Error("Müşteri adı gerekli");
    const name = fields.name.trim().replace(/\s+/g, " ");
    if (!name || name.length > 200)
      throw Error("Müşteri adı 1–200 karakter olmalı");
    const contact = String(fields.contact || "").trim(),
      phone = String(fields.phone || "").trim();
    if (contact.length > 100 || phone.length > 40)
      throw Error("Yetkili veya telefon bilgisi çok uzun");
    const key = normKey(name).replace(/\s+/g, " ").trim();
    const found = live(d, "customers").filter(
      (c) => normKey(c.name).replace(/\s+/g, " ").trim() === key,
    );
    if (found.length > 1)
      throw Error(
        "Bu isimde birden fazla müşteri var; listeden doğru kartı seçin",
      );
    if (found[0]?.active === false)
      throw Error(
        "Bu müşteri pasif; Müşteriler bölümünden durumunu kontrol edin",
      );
    const selected = rows.find((r) => r.source_row === sourceRow);
    if (!selected || selected.kind !== "work")
      throw Error("Müşteri yalnız iş satırına eklenebilir");
    const customer =
      found[0] || newRecord({ name, contact, phone, active: true });
    if (!found.length) {
      t.add("customers", customer);
      d.customers.push(customer);
    }
    const changed = rows.map((row) =>
      row.source_row === sourceRow
        ? {
            ...row,
            customer_id: customer.id,
            site_id: null,
            duplicate_checked: false,
            field_sources: {
              ...row.field_sources,
              customer_id: "Kullanıcı yeni/mevcut müşteri kartını seçti",
              site_id: "Müşteri değişince şantiye temizlendi",
            },
          }
        : { ...row },
    );
    const message = saveReviewInTransaction(d, t, id, changed, expected);
    return { customer, message, created: !found.length };
  });
}
export async function mergeMessages(ids, confirmed = false) {
  if (!confirmed) throw Error("Mesaj birleştirmesi için açık onay gerekli");
  await backupBeforeSoloOperation(db, "before-message-merge");
  return run((d, t) => {
    const rows = mergeEligibility(
        ids.map((id) => reference(d, "inbox_messages", id)),
        d,
      ),
      parent = rows[0],
      at = nowISO();
    const sources = rows.map((m) => ({
      id: m.id,
      raw: m.raw,
      text: m.text,
      date: m.date,
      time: m.time,
      sender: m.sender,
      source_key: m.source_key,
    }));
    const updated = {
      ...parent,
      text: sources.map((x) => x.text).join("\n"),
      source_messages: sources,
      merge_confirmed_at: at,
      updated_at: at,
    };
    updated.review_rows = assistedRows(updated, d);
    t.put("inbox_messages", updated);
    for (const m of rows.slice(1))
      t.put("inbox_messages", {
        ...m,
        merge_parent_id: parent.id,
        status: "Birleştirildi",
        updated_at: at,
      });
    return updated;
  });
}
export async function undoMessageMerge(id, reason) {
  return run((d, t) => {
    const m = reference(d, "inbox_messages", id);
    editable(m, d);
    if (!m.source_messages?.length) throw Error("Birleştirilmiş kaynak yok");
    if (!String(reason || "").trim()) throw Error("Ayırma gerekçesi gerekli");
    const originals = m.source_messages,
      own = originals.find((x) => x.id === id),
      at = nowISO();
    for (const src of originals) {
      const r = reference(d, "inbox_messages", src.id);
      if (
        src.id !== id &&
        (r.status !== "Birleştirildi" || r.merge_parent_id !== id)
      )
        throw Error("Birleştirme bağı tutarsız");
    }
    const parent = {
      ...m,
      text: own.text,
      source_messages: null,
      review_rows: null,
      reviewed_at: null,
      updated_at: at,
      merge_events: [
        ...(m.merge_events || []).slice(-19),
        { at, action: "Ayrıldı", reason },
      ],
    };
    t.put("inbox_messages", parent);
    for (const src of originals.filter((x) => x.id !== id)) {
      const r = reference(d, "inbox_messages", src.id);
      t.put("inbox_messages", {
        ...r,
        merge_parent_id: null,
        status: "Taslak",
        updated_at: at,
      });
    }
    return parent;
  });
}
export async function saveMessageMemory(f) {
  return run((d, t) => {
    const fields = memoryFields(f, d),
      same = live(d, "aliases").filter(
        (a) =>
          a.active !== false &&
          normKey(a.alias) === normKey(fields.alias) &&
          a.target_type === fields.target_type,
      );
    if (same.some((a) => a.target_id !== fields.target_id))
      throw Error(
        "Bu takma ad başka karta bağlı; önce eski eşleştirmeyi pasife alın",
      );
    if (same.length) return same[0];
    const r = newRecord(fields);
    t.add("aliases", r);
    return r;
  });
}
export async function deactivateMessageMemory(id, reason) {
  return run((d, t) => {
    const r = reference(d, "aliases", id);
    if (!String(reason || "").trim())
      throw Error("Pasife alma gerekçesi gerekli");
    t.put("aliases", {
      ...r,
      active: false,
      deactivated_reason: reason,
      updated_at: nowISO(),
    });
  });
}
export async function prepareMessageTransfer(id) {
  // Always read latest committed rows; session/UI state is not authoritative.
  return run((d) => {
    const m = reference(d, "inbox_messages", id);
    const analysis = analyzeMessage(m, d);
    if (analysis.blocking)
      throw Error(analysis.notices.find((n) => n.blocking).text);
    if (m.status === "Reddedildi" || m.merge_parent_id)
      throw Error("Bu kaynak aktarılamaz");
    validateSmartData(d);
    const already = new Set(
      [...(d.work_records || []), ...(d.fuel_records || [])].map(
        (w) => w.history_source?.row_id,
      ),
    );
    const rows = assistedRows(m, d).filter(
      (r) =>
        r.include !== false &&
        !already.has("inbox-" + m.id + "-" + r.source_row),
    );
    if (!rows.length) throw Error("Aktarılacak en az bir satır seçin");
    if (rows.some((r) => r.inference_confirmed === false))
      throw Error("Sefer / çalışma süresi önerisini açıkça doğrulayın");
    if (
      rows.some(
        (r) =>
          (r.notes || []).some((n) => n.includes("tarihler çelişiyor")) &&
          !String(r.field_sources?.date || "").startsWith("Kullanıcı"),
      )
    )
      throw Error("Gerçek iş tarihini doğrulayın");
    if (analysis.distribution) {
      const all = assistedRows(m, d);
      if (
        all.some((r) => r.include === false) ||
        all.reduce((n, r) => n + Number(r.quantity || 0), 0) !==
          analysis.distribution.total
      )
        throw Error(
          "Döküm satırları birlikte ve toplam seferle uyumlu aktarılmalı",
        );
    }
    if (
      rows.some((r) =>
        rowQuestions(r, d).some((q) => q.text.startsWith("Birden fazla")),
      )
    )
      throw Error("Birden fazla eşleşen kartın seçimini doğrulayın");
    if (rows.some((r) => r.kind === "fuel" && r.fuel_source !== "Depo Tankı"))
      throw Error(
        "Yakıt kaynağını doğrulayın; istasyon satırını bekletin ve Yakıt modülünden girin",
      );
    if (rows.some((r) => similarRecords(r, d).length && !r.duplicate_checked))
      throw Error("Benzer kayıt kontrolü gerekli");
    return historyFromMessage({ ...m, review_rows: rows }, d);
  });
}
export async function reanalyzeMessage(id, confirmed) {
  if (confirmed !== true) throw Error("Yeniden ayrıştırma için onay gerekli");
  await backupBeforeSoloOperation(db, "before-message-reanalysis");
  return run((d, t) => {
    const m = reference(d, "inbox_messages", id);
    editable(m, d);
    const updated = {
      ...m,
      review_rows: null,
      reviewed_at: null,
      engine_version: "sahapro-parse/4",
      updated_at: nowISO(),
    };
    t.put("inbox_messages", updated);
    return updated;
  });
}
