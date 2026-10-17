import { messageLocked } from "./message-smart-db.js";
import * as db from "./db.js";
import {
  ENTITY_STORES,
  newRecord,
  uuid,
  nowISO,
  isActive,
  toKurus,
  fromKurus,
} from "./core.js";
import { transaction } from "./enterprise-db.js";
import { billBalance, validDate } from "./enterprise-core.js";
import * as rules from "./solo-core.js";
import { backupBeforeSoloOperation } from "./backup.js";
const run = (fn) =>
  transaction(
    ENTITY_STORES.filter((s) => s !== "audit_log"),
    fn,
  );
function once(d, store, key) {
  return d[store]?.find((r) => r.request_id === key);
}
export async function saveMeter(f, key = uuid()) {
  return run((d, t) => {
    const old = once(d, "meter_readings", key);
    if (old) return old;
    const fields = rules.meterFields(d, f),
      r = newRecord({ ...fields, request_id: key });
    t.add("meter_readings", r);
    const v = rules.reference(d, "vehicles", f.vehicle_id);
    const recent = rules
      .live(d, "meter_readings")
      .filter((x) => x.vehicle_id === f.vehicle_id && x.kind === f.kind)
      .every((x) => x.date < f.date);
    if (recent)
      t.put("vehicles", {
        ...v,
        [f.kind === "km" ? "km" : "machine_hours"]: Math.max(
          Number(v[f.kind === "km" ? "km" : "machine_hours"]) || 0,
          fields.value,
        ),
        updated_at: nowISO(),
      });
    return r;
  });
}
export async function saveShift(f, key = uuid()) {
  return run((d, t) => {
    const old = once(d, "shift_assignments", key);
    if (old) return old;
    const r = newRecord({ ...rules.shiftFields(d, f), request_id: key });
    t.add("shift_assignments", r);
    return r;
  });
}
export async function shiftStatus(id, status, reason) {
  return run((d, t) => {
    const r = rules.reference(d, "shift_assignments", id);
    if (!["Tamamlandı", "İptal"].includes(status) || r.status !== "Planlı")
      throw Error("Vardiya geçişi geçersiz");
    if (status === "İptal") rules.required(reason, "İptal gerekçesi");
    const updated = { ...r, status, reason, updated_at: nowISO() };
    t.put("shift_assignments", updated);
    return updated;
  });
}
export async function saveCustody(f, key = uuid()) {
  return run((d, t) => {
    const old = once(d, "custody_records", key);
    if (old) return old;
    const r = newRecord({ ...rules.custodyFields(d, f), request_id: key });
    t.add("custody_records", r);
    if (f.owner_type === "vehicle") {
      const v = rules.reference(d, "vehicles", f.owner_id);
      if (v.assignee_id && v.assignee_id !== f.personnel_id)
        throw Error("Araç kartında başka zimmetli personel var");
      t.put("vehicles", {
        ...v,
        assignee_id: f.personnel_id,
        updated_at: nowISO(),
      });
    }
    return r;
  });
}
export async function returnCustody(id, date, note) {
  return run((d, t) => {
    const r = rules.reference(d, "custody_records", id);
    rules.validPast(date);
    rules.required(note, "Teslim/iade notu");
    if (r.status !== "Teslim Edildi" || date < r.date)
      throw Error("İade tarihi/durumu geçersiz");
    const updated = {
      ...r,
      status: "İade Alındı",
      returned_date: date,
      return_note: note,
      updated_at: nowISO(),
    };
    t.put("custody_records", updated);
    if (r.owner_type === "vehicle") {
      const v = rules.reference(d, "vehicles", r.owner_id);
      if (v.assignee_id === r.personnel_id)
        t.put("vehicles", { ...v, assignee_id: null, updated_at: nowISO() });
    }
    return updated;
  });
}
export async function saveDowntime(f, key = uuid()) {
  return run((d, t) => {
    const old = once(d, "downtime_records", key);
    if (old) return old;
    const r = newRecord({ ...rules.downtimeFields(d, f), request_id: key });
    t.add("downtime_records", r);
    return r;
  });
}
export async function closeDowntime(id, ended_at, note) {
  return run((d, t) => {
    const r = rules.reference(d, "downtime_records", id);
    if (r.ended_at) throw Error("Duruş zaten kapandı");
    const updated = {
      ...r,
      ended_at,
      note,
      status: "Kapalı",
      updated_at: nowISO(),
    };
    rules.downtimeHours(updated);
    if (Date.parse(ended_at) > Date.now())
      throw Error("Bitiş gelecekte olamaz");
    t.put("downtime_records", updated);
    return updated;
  });
}
export async function savePart(f, key = uuid()) {
  return run((d, t) => {
    const old = once(d, "maintenance_parts", key);
    if (old) return old;
    const r = newRecord({ ...rules.partFields(d, f), request_id: key });
    t.add("maintenance_parts", r);
    return r;
  });
}
export async function saveAllocation(f, key = uuid()) {
  return run((d, t) => {
    const old = once(d, "cost_allocations", key);
    if (old) return old;
    const r = newRecord({ ...rules.allocationFields(d, f), request_id: key });
    t.add("cost_allocations", r);
    return r;
  });
}
export async function cancelAllocation(id, reason) {
  return run((d, t) => {
    const r = rules.reference(d, "cost_allocations", id);
    rules.required(reason, "İptal gerekçesi");
    if (r.status !== "Aktif") throw Error("Dağıtım zaten iptal");
    t.put("cost_allocations", {
      ...r,
      status: "İptal",
      reason,
      updated_at: nowISO(),
    });
  });
}
export async function saveArchive(id, f) {
  return run((d, t) => {
    const r = rules.reference(d, "documents", id);
    const fields = {
      archive_folder: String(f.archive_folder || ""),
      archive_shelf: String(f.archive_shelf || ""),
      archive_file_no: String(f.archive_file_no || ""),
      archive_kocan: String(f.archive_kocan || ""),
    };
    rules.required(fields.archive_folder, "Klasör");
    rules.required(fields.archive_shelf, "Raf");
    const updated = {
      ...r,
      ...fields,
      archive_events: [
        ...(r.archive_events || []),
        {
          at: nowISO(),
          ...fields,
          note: rules.required(f.note, "Taşıma/kayıt gerekçesi"),
        },
      ],
      updated_at: nowISO(),
    };
    t.put("documents", updated);
    return updated;
  });
}
export async function importMessages(blocks) {
  await backupBeforeSoloOperation(db, "before-inbox-import");
  return run((d, t) => {
    let added = 0,
      duplicates = 0;
    const seen = new Set(d.inbox_messages.map((r) => r.source_key));
    for (const b of blocks) {
      if (seen.has(b.source_key)) {
        duplicates++;
        continue;
      }
      seen.add(b.source_key);
      if (b.date) rules.validPast(b.date);
      const r = newRecord({
        ...b,
        status: "Taslak",
        drafts: rules.draftMessage(b, d),
      });
      t.add("inbox_messages", r);
      added++;
    }
    return { added, duplicates };
  });
}
export async function refreshMessage(id, f) {
  return run((d, t) => {
    const r = rules.reference(d, "inbox_messages", id);
    if (
      messageLocked(r, d) ||
      r.review_rows?.length ||
      r.source_messages?.length
    )
      throw Error(
        "Kontrol edilmiş veya aktarılmış mesajın kaynak metni değiştirilemez; satır düzeltmesini kullanın",
      );
    if (f.date) rules.validPast(f.date);
    const updated = {
      ...r,
      date: f.date || null,
      text: rules.required(f.text, "Mesaj"),
      updated_at: nowISO(),
    };
    updated.drafts = rules.draftMessage(updated, d);
    t.put("inbox_messages", updated);
    return updated;
  });
}
export async function rejectMessage(id, reason) {
  return run((d, t) => {
    const r = rules.reference(d, "inbox_messages", id);
    rules.required(reason, "Red gerekçesi");
    if (messageLocked(r, d))
      throw Error("Aktarılmış veya birleştirilmiş kaynak reddedilemez");
    t.put("inbox_messages", {
      ...r,
      status: "Reddedildi",
      reason,
      updated_at: nowISO(),
    });
  });
}
export async function syncMessageStatus(id) {
  return run((d, t) => {
    const r = rules.reference(d, "inbox_messages", id);
    const ids = rules.historyFromMessage(r, d).rows.map((x) => x.row_id);
    const linked = [...d.work_records, ...d.fuel_records].filter((w) =>
      ids.includes(w.history_source?.row_id),
    );
    if (linked.length) {
      const status =
        linked.length >= ids.length ? "Aktarıldı" : "Kısmen Aktarıldı";
      t.put("inbox_messages", {
        ...r,
        status,
        linked_records: linked.map((w) => ({
          store: w.liters != null ? "fuel_records" : "work_records",
          id: w.id,
        })),
        updated_at: nowISO(),
      });
    }
    return linked.length;
  });
}
export async function importBank(csv, mapping, account_id) {
  await backupBeforeSoloOperation(db, "before-bank-import");
  return run((d, t) => {
    rules.reference(d, "bank_accounts", account_id);
    const preview = rules.bankPreview(
      csv,
      mapping,
      account_id,
      d.bank_import_rows,
    );
    if (preview.some((r) => r.errors.length))
      throw Error("Hatalı banka satırları var; dosyayı düzeltin");
    let added = 0,
      duplicates = 0;
    const seen = new Set(d.bank_import_rows.map((r) => r.source_key));
    for (const p of preview) {
      if (seen.has(p.source_key) || p.duplicate) {
        duplicates++;
        continue;
      }
      seen.add(p.source_key);
      t.add(
        "bank_import_rows",
        newRecord({ ...p, bank_account_id: account_id, status: "Eşleşmedi" }),
      );
      added++;
    }
    return { added, duplicates };
  });
}
export async function reconcileBank(id, f) {
  return run((d, t) => {
    const r = rules.reference(d, "bank_import_rows", id);
    if (r.status !== "Eşleşmedi") throw Error("Banka satırı zaten işlendi");
    const account = rules.reference(d, "bank_accounts", r.bank_account_id);
    if (account.opening_date && r.date < account.opening_date)
      throw Error("Banka hareketi hesap açılışından önce olamaz");
    let movement;
    if (f.existing_id) {
      movement = rules.reference(d, "bank_movements", f.existing_id);
      if (
        movement.bank_account_id !== r.bank_account_id ||
        movement.direction !== r.direction ||
        toKurus(movement.amount) !== toKurus(r.amount) ||
        movement.date !== r.date
      )
        throw Error("Banka hareketi tarih/yön/tutar/hesap eşleşmiyor");
      if (
        rules
          .live(d, "bank_import_rows")
          .some((x) => x.bank_movement_id === movement.id)
      )
        throw Error("Banka hareketi başka satırla eşleşmiş");
    } else {
      if (!["customer", "payable", "bank_only"].includes(f.mode))
        throw Error("Eşleştirme türü seçin");
      if (
        r.reference &&
        rules
          .live(d, "bank_movements")
          .some(
            (x) =>
              x.bank_account_id === r.bank_account_id &&
              x.reference === r.reference,
          )
      )
        throw Error("Aynı banka referansı zaten var; mevcut harekete bağlayın");
      movement = newRecord({
        bank_account_id: r.bank_account_id,
        date: r.date,
        amount: r.amount,
        direction: r.direction,
        source_store: "bank_import_rows",
        source_id: r.id,
        note: r.description,
        reference: r.reference,
      });
      if (f.mode === "customer") {
        if (r.direction !== "IN") throw Error("Müşteri tahsilatı giriş olmalı");
        rules.reference(d, "customers", f.customer_id);
        const cash = newRecord({
          date: r.date,
          customer_id: f.customer_id,
          amount: r.amount,
          cash_type: "Müşteriden Para Alındı",
          cash_status: "BANKADA",
          payment_method: "Havale",
          bank_account_id: r.bank_account_id,
          bank_movement_id: movement.id,
          description: r.description,
        });
        movement.source_store = "cash_records";
        movement.source_id = cash.id;
        t.add("cash_records", cash);
        t.add(
          "cari_movements",
          newRecord({
            date: r.date,
            customer_id: f.customer_id,
            amount: -r.amount,
            type: "Tahsilat",
            ref_id: cash.id,
            note: r.description,
          }),
        );
      }
      if (f.mode === "payable") {
        if (r.direction !== "OUT") throw Error("Borç ödemesi çıkış olmalı");
        const bill = rules.reference(d, "payables", f.payable_id);
        if (r.date < bill.date)
          throw Error("Ödeme belge tarihinden önce olamaz");
        if (
          bill.status === "İptal" ||
          toKurus(billBalance(bill, d.supplier_payments).remaining) <
            toKurus(r.amount)
        )
          throw Error("Ödeme kalan borcu aşıyor");
        const payment = newRecord({
          date: r.date,
          amount: r.amount,
          payable_id: bill.id,
          party_type: bill.party_type,
          party_id: bill.party_id,
          method: "Havale",
          bank_account_id: r.bank_account_id,
          bank_movement_id: movement.id,
          note: r.description,
        });
        movement.source_store = "supplier_payments";
        movement.source_id = payment.id;
        t.add("supplier_payments", payment);
      }
      if (f.mode === "bank_only")
        rules.required(f.reason, "Sadece banka hareketi gerekçesi");
      t.add("bank_movements", movement);
    }
    const updated = {
      ...r,
      status: "Eşleşti",
      bank_movement_id: movement.id,
      reconciliation_mode: f.existing_id ? "existing" : f.mode,
      reconciled_at: nowISO(),
      reason: f.reason || "",
    };
    t.put("bank_import_rows", updated);
    return updated;
  });
}
export async function countStock(f, key = uuid()) {
  return run((d, t) => {
    const old = once(d, "stock_counts", key);
    if (old) return old;
    rules.validPast(f.date);
    if (d.fuel_tank_movements.some((m) => isActive(m) && m.date > f.date))
      throw Error("Sayımı son tank hareketi tarihinde veya sonrasında yapın");
    const physical = rules.number(f.physical_liters, "Fiziksel litre", true);
    rules.required(f.reason, "Stok farkı gerekçesi");
    const theoretical = rules
      .live(d, "fuel_tank_movements")
      .reduce(
        (n, m) => n + (m.move_type === "GİRİŞ" ? 1 : -1) * Number(m.liters),
        0,
      );
    const delta = Math.round((physical - theoretical) * 1000) / 1000;
    const rec = newRecord({
      ...f,
      physical_liters: physical,
      theoretical_liters: theoretical,
      difference: delta,
      request_id: key,
    });
    if (delta) {
      const move = newRecord({
        date: f.date,
        move_type: delta > 0 ? "GİRİŞ" : "ÇIKIŞ",
        liters: Math.abs(delta),
        count_id: rec.id,
        description: "Fiziksel sayım düzeltmesi: " + f.reason,
        event_id: uuid(),
      });
      rec.movement_id = move.id;
      t.add("fuel_tank_movements", move);
    }
    t.add("stock_counts", rec);
    return rec;
  });
}
export async function renewService(id, f, key = uuid()) {
  return run((d, t) => {
    const old = once(d, "service_plans", key);
    if (old) return old;
    const p = rules.reference(d, "service_plans", id);
    if (p.status !== "Tamamlandı" || p.next_plan_id)
      throw Error("Tamamlanmış ve yenilenmemiş bakım gerekli");
    const m = rules.reference(
      d,
      "maintenance_records",
      p.maintenance_record_id,
    );
    if (m.status !== "Tamamlandı" || m.vehicle_id !== p.vehicle_id)
      throw Error("Tamamlanmış bakım bağı geçersiz");
    const days = f.interval_days
        ? rules.number(f.interval_days, "Gün aralığı")
        : null,
      km = f.interval_km ? rules.number(f.interval_km, "Km aralığı") : null,
      hours = f.interval_hours
        ? rules.number(f.interval_hours, "Saat aralığı")
        : null;
    if (!days && !km && !hours) throw Error("En az bir bakım aralığı gerekli");
    const baseDate = f.completed_date;
    rules.validPast(baseDate);
    if (baseDate < m.date)
      throw Error("Tamamlanma bakım tarihinden önce olamaz");
    const v = rules.reference(d, "vehicles", p.vehicle_id);
    const readings = rules
      .live(d, "meter_readings")
      .filter((r) => r.vehicle_id === p.vehicle_id && r.date <= baseDate)
      .sort((a, b) => a.date.localeCompare(b.date));
    const k = readings.filter((r) => r.kind === "km").at(-1)?.value;
    const h = readings.filter((r) => r.kind === "hours").at(-1)?.value;
    if ((km && (k == null || k === "")) || (hours && (h == null || h === "")))
      throw Error("Bakım tamamlanma sayaç okuması gerekli");
    const date = new Date(baseDate + "T12:00:00Z");
    if (days) date.setUTCDate(date.getUTCDate() + days);
    const r = newRecord({
      vehicle_id: p.vehicle_id,
      title: p.title,
      next_date: days ? date.toISOString().slice(0, 10) : null,
      next_km: km ? Number(k) + km : null,
      next_hours: hours ? Number(h) + hours : null,
      status: "Aktif",
      warn_days: p.warn_days,
      warn_km: p.warn_km,
      warn_hours: p.warn_hours,
      previous_plan_id: p.id,
      request_id: key,
    });
    t.add("service_plans", r);
    t.put("service_plans", { ...p, next_plan_id: r.id, updated_at: nowISO() });
    return r;
  });
}
