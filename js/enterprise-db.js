import * as db from "./db.js";
import {
  newRecord,
  uuid,
  nowISO,
  isActive,
  toKurus,
  fromKurus,
} from "./core.js";
import {
  PARTY_STORES,
  validDate,
  money,
  invoiceLines,
  invoiceTotals,
  billBalance,
  installmentSchedule,
  planRows,
  closingSummary,
} from "./enterprise-core.js";
const owners = [
  "customers",
  "sites",
  "vehicles",
  "personnel",
  "contractors",
  "suppliers",
  "dump_sites",
  "quarries",
];
function active(rows) {
  return (rows || []).filter(isActive);
}
function owner(data, store, id) {
  const r = data[store]?.find((r) => r.id === id && isActive(r));
  if (!r) throw Error("İlgili " + store + " kaydı bulunamadı");
  return r;
}
function party(data, type, id, allowCustomer = false) {
  if (
    !Object.hasOwn(PARTY_STORES, type) ||
    (!allowCustomer && type === "customer")
  )
    throw Error("Taraf türü geçersiz");
  return owner(data, PARTY_STORES[type], id);
}
function context(data, f) {
  for (const [k, s] of [
    ["customer_id", "customers"],
    ["vehicle_id", "vehicles"],
    ["personnel_id", "personnel"],
  ])
    if (f[k]) owner(data, s, f[k]);
  if (f.site_id) {
    const site = owner(data, "sites", f.site_id);
    if (site.customer_id !== f.customer_id)
      throw Error("Şantiye müşteriye ait değil");
  }
}
function audit(t, store, r, action) {
  t.objectStore("audit_log").add(
    newRecord({
      entity_type: store,
      entity_id: r.id,
      action,
      after: r,
      reason: "İşletme defteri",
    }),
  );
}
// Tüm doğrulamalar ve okuma/yazma aynı IndexedDB transaction içinde: eşzamanlı çift kayıt engellenir.
export async function transaction(stores, fn) {
  const connection = await db.openDB();
  stores = [...new Set([...stores, "audit_log"])];
  return new Promise((resolve, reject) => {
    const t = connection.transaction(stores, "readwrite"),
      data = {};
    let left = stores.filter((s) => s !== "audit_log").length,
      result,
      error;
    for (const s of stores.filter((s) => s !== "audit_log")) {
      const q = t.objectStore(s).getAll();
      q.onsuccess = () => {
        data[s] = q.result;
        if (--left === 0) {
          try {
            result = fn(data, {
              add: (s, r) => {
                t.objectStore(s).add(r);
                audit(t, s, r, "create");
              },
              put: (s, r) => {
                t.objectStore(s).put(r);
                audit(t, s, r, "update");
              },
            });
          } catch (e) {
            error = e;
            t.abort();
          }
        }
      };
    }
    t.oncomplete = () => resolve(result);
    t.onerror = t.onabort = () =>
      reject(error || t.error || Error("İşlem tamamlanamadı"));
  });
}
export async function saveSupplier(f, key = uuid()) {
  return transaction(["suppliers"], (d, t) => {
    const exists = d.suppliers.find((r) => r.request_id === key);
    if (exists) return exists;
    if (!f.name?.trim()) throw Error("Firma adı zorunlu");
    if (
      active(d.suppliers).some(
        (r) =>
          r.name.trim().toLocaleLowerCase("tr") ===
          f.name.trim().toLocaleLowerCase("tr"),
      )
    )
      throw Error("Aynı isimli tedarikçi var");
    const r = newRecord({
      name: f.name.trim(),
      type: f.type || "Tedarikçi",
      phone: f.phone || "",
      tax_no: f.tax_no || "",
      address: f.address || "",
      note: f.note || "",
      active: true,
      request_id: key,
    });
    t.add("suppliers", r);
    return r;
  });
}
export async function savePayable(f, key = uuid()) {
  return transaction(
    [
      ...owners,
      "payables",
      "purchase_orders",
      "cost_allocations",
      "work_records",
      "expense_records",
      "fuel_records",
      "fuel_tank_movements",
      "maintenance_records",
    ],
    (d, t) => {
      const old = d.payables.find((r) => r.request_id === key);
      if (old) return old;
      validDate(f.date);
      validDate(f.due_date, "Vade");
      if (f.due_date < f.date) throw Error("Vade belge tarihinden önce olamaz");
      party(d, f.party_type, f.party_id);
      context(d, f);
      if (!f.document_no?.trim()) throw Error("Belge/referans no zorunlu");
      if (
        active(d.payables).some(
          (r) =>
            r.status !== "İptal" &&
            r.party_type === f.party_type &&
            r.party_id === f.party_id &&
            r.document_no === f.document_no.trim(),
        )
      )
        throw Error("Bu taraf için aynı belge numarası kayıtlı");
      let items = invoiceLines(f.items);
      if (
        f.bill_kind === "Açılış / Devir" &&
        (items.some((i) => i.kdv_rate !== 0 || i.work_record_id) || f.source_id)
      )
        throw Error(
          "Devir bakiyesinde KDV/iş maliyeti/kaynak belge kullanılmaz",
        );
      for (const i of items)
        if (i.work_record_id) {
          const w = owner(d, "work_records", i.work_record_id);
          if (f.customer_id && w.customer_id !== f.customer_id)
            throw Error("Kalem işi seçilen müşteriye ait değil");
          if (f.site_id && w.site_id !== f.site_id)
            throw Error("Kalem işi seçilen şantiyeye ait değil");
        }
      let source_store = null,
        source_id = null;
      if (f.source_store || f.source_id) {
        if (
          ![
            "expense_records",
            "fuel_records",
            "fuel_tank_movements",
            "maintenance_records",
            "purchase_orders",
          ].includes(f.source_store)
        )
          throw Error("Maliyet kaynağı geçersiz");
        if(active(d.cost_allocations).some(r=>r.status==='Aktif'&&r.source_store===f.source_store&&r.source_id===f.source_id))throw Error("Borçlandırmadan önce kaynak maliyet dağıtımını iptal edin");
        const s = owner(d, f.source_store, f.source_id);
        if (
          active(d.payables).some(
            (b) =>
              b.status !== "İptal" &&
              b.source_store === f.source_store &&
              b.source_id === f.source_id,
          )
        )
          throw Error("Kaynak daha önce borçlandırılmış");
        if (f.source_store === "purchase_orders") {
          if (
            s.status !== "Teslim Alındı" ||
            s.party_type !== f.party_type ||
            s.party_id !== f.party_id
          )
            throw Error("Sipariş teslim alınmış ve aynı tarafa ait olmalı");
          items = invoiceLines(s.items);
        } else {
          const sourceTotal = Number(
            s.amount ?? s.total ?? s.total_amount ?? s.cost,
          );
          if (
            toKurus(invoiceTotals(items).gross_total) !== toKurus(sourceTotal)
          )
            throw Error("Kaynak ile belge genel toplamı aynı olmalı");
        }
        for (const k of [
          "customer_id",
          "site_id",
          "vehicle_id",
          "personnel_id",
        ]) {
          if (f[k] && s[k] && f[k] !== s[k])
            throw Error("Kaynak bağlamı farklı: " + k);
          if (!f[k] && s[k]) f[k] = s[k];
        }
        source_store = f.source_store;
        source_id = f.source_id;
      }
      const totals = invoiceTotals(items);
      money(totals.gross_total);
      const r = newRecord({
        date: f.date,
        due_date: f.due_date,
        document_no: f.document_no.trim(),
        party_type: f.party_type,
        party_id: f.party_id,
        items,
        ...totals,
        status: "Onaylandı",
        cost_category: f.cost_category || "Diğer",
        bill_kind: f.bill_kind || "Alış",
        kdv_unknown: f.kdv_unknown === true,
        description: f.description || "",
        customer_id: f.customer_id || null,
        site_id: f.site_id || null,
        vehicle_id: f.vehicle_id || null,
        personnel_id: f.personnel_id || null,
        source_store,
        source_id,
        request_id: key,
      });
      t.add("payables", r);
      return r;
    },
  );
}
export async function cancelPayable(id, reason) {
  return transaction(["payables", "supplier_payments", "cost_allocations"], (d, t) => {
    if(active(d.cost_allocations).some(r=>r.status==='Aktif'&&r.source_store==='payables'&&r.source_id===id))throw Error("Borç iptalinden önce dağıtımı iptal edin");
    const b = owner(d, "payables", id);
    if (!reason?.trim()) throw Error("İptal nedeni zorunlu");
    if (active(d.supplier_payments).some((p) => p.payable_id === id))
      throw Error("Ödemesi olan borç iptal edilemez");
    const r = {
      ...b,
      status: "İptal",
      cancel_reason: reason,
      updated_at: nowISO(),
    };
    t.put("payables", r);
    return r;
  });
}
function bankMove(
  data,
  t,
  accountId,
  amount,
  direction,
  date,
  source_store,
  source_id,
  note,
) {
  if (!accountId) return null;
  const a = owner(data, "bank_accounts", accountId);
  if (date < a.opening_date)
    throw Error("Banka hareketi hesap açılış tarihinden önce olamaz");
  if (a.currency !== "TRY") throw Error("Bu hesap TRY olmalı");
  const r = newRecord({
    bank_account_id: accountId,
    date,
    amount,
    direction,
    source_store,
    source_id,
    note: note || "",
  });
  t.add("bank_movements", r);
  return r;
}
export async function paySupplier(f, key = uuid()) {
  return transaction(
    [
      "payables",
      "supplier_payments",
      "bank_accounts",
      "bank_movements",
      "cash_records",
    ],
    (d, t) => {
      const old = d.supplier_payments.find((p) => p.request_id === key);
      if (old) return old;
      const b = owner(d, "payables", f.payable_id);
      if (b.status === "İptal") throw Error("Borç iptal edilmiş");
      validDate(f.date);
      if (f.date < b.date) throw Error("Ödeme borç tarihinden önce olamaz");
      const amount = money(f.amount);
      if (
        toKurus(amount) > toKurus(billBalance(b, d.supplier_payments).remaining)
      )
        throw Error("Ödeme kalan borcu aşamaz");
      if (!["Nakit", "Banka"].includes(f.method))
        throw Error("Ödeme yöntemi geçersiz");
      if (f.method === "Banka" && !f.bank_account_id)
        throw Error("Banka hesabı zorunlu");
      const r = newRecord({
        date: f.date,
        payable_id: b.id,
        party_type: b.party_type,
        party_id: b.party_id,
        amount,
        method: f.method,
        bank_account_id: f.method === "Banka" ? f.bank_account_id : null,
        note: f.note || "",
        request_id: key,
      });
      const bm = bankMove(
        d,
        t,
        r.bank_account_id,
        amount,
        "OUT",
        r.date,
        "supplier_payments",
        r.id,
        r.note,
      );
      r.bank_movement_id = bm?.id || null;
      if (f.method === "Nakit") {
        const cash = newRecord({
          date: r.date,
          cash_type: "Tedarikçiye Ödeme",
          cash_status: "KASADA",
          amount,
          payment_method: "Nakit",
          supplier_payment_id: r.id,
          description: r.note,
        });
        r.cash_record_id = cash.id;
        t.add("cash_records", cash);
      }
      t.add("supplier_payments", r);
      return r;
    },
  );
}
export async function customerBankReceipt(f, key = uuid()) {
  return transaction(
    [
      "customers",
      "bank_accounts",
      "bank_movements",
      "cash_records",
      "cari_movements",
    ],
    (d, t) => {
      const old = d.cash_records.find((r) => r.request_id === key);
      if (old) return old;
      owner(d, "customers", f.customer_id);
      validDate(f.date);
      const amount = money(f.amount);
      if (!f.bank_account_id) throw Error("Banka hesabı zorunlu");
      const r = newRecord({
        date: f.date,
        customer_id: f.customer_id,
        amount,
        cash_type: "Müşteriden Para Alındı",
        cash_status: "BANKADA",
        payment_method: "Havale",
        bank_account_id: f.bank_account_id,
        description: f.note || "",
        request_id: key,
      });
      const bm = bankMove(
        d,
        t,
        f.bank_account_id,
        amount,
        "IN",
        f.date,
        "cash_records",
        r.id,
        f.note,
      );
      r.bank_movement_id = bm.id;
      t.add("cash_records", r);
      t.add(
        "cari_movements",
        newRecord({
          date: r.date,
          customer_id: r.customer_id,
          amount: -amount,
          type: "Tahsilat",
          ref_id: r.id,
          note: r.description,
        }),
      );
      return r;
    },
  );
}
export async function saveBank(f, key = uuid()) {
  return transaction(["bank_accounts"], (d, t) => {
    const old = d.bank_accounts.find((r) => r.request_id === key);
    if (old) return old;
    if (!f.name?.trim()) throw Error("Hesap adı zorunlu");
    const balance = Number(f.opening_balance || 0);
    if (!Number.isFinite(balance)) throw Error("Açılış bakiyesi geçersiz");
    const r = newRecord({
      name: f.name.trim(),
      bank_name: f.bank_name || "",
      iban: f.iban || "",
      opening_date: validDate(f.opening_date),
      opening_balance: balance,
      currency: "TRY",
      request_id: key,
    });
    t.add("bank_accounts", r);
    return r;
  });
}
export async function transferBanks(f, key = uuid()) {
  return transaction(["bank_accounts", "bank_movements"], (d, t) => {
    const old = d.bank_movements.find((r) => r.transfer_key === key);
    if (old) return old;
    validDate(f.date);
    if (f.from_id === f.to_id) throw Error("Farklı iki banka hesabı seçin");
    const amount = money(f.amount),
      id = uuid();
    for (const [a, dir] of [
      [f.from_id, "OUT"],
      [f.to_id, "IN"],
    ]) {
      const r = bankMove(
        d,
        { add: (s, r) => t.add(s, { ...r, transfer_key: key }) },
        a,
        amount,
        dir,
        f.date,
        "bank_transfer",
        id,
        f.note,
      );
      if (!r) throw Error("İki banka hesabı zorunlu");
    }
    return { id };
  });
}
export async function saveReceivablePlan(f, key = uuid()) {
  return transaction(["hakedis", "receivable_plans"], (d, t) => {
    const old = d.receivable_plans.find((r) => r.request_id === key);
    if (old) return old;
    const h = owner(d, "hakedis", f.hakedis_id);
    if (h.status !== "Kesinleşti") throw Error("Kesinleşmiş hakediş seçin");
    if (active(d.receivable_plans).some((r) => r.hakedis_id === h.id))
      throw Error("Bu hakediş için vade planı var");
    const r = newRecord({
      hakedis_id: h.id,
      customer_id: h.customer_id,
      date: f.date || h.date_from,
      reference: "Hakediş " + h.hakedis_no,
      installments: installmentSchedule(
        h.grand_total,
        f.first_due,
        f.count,
        f.days,
      ),
      amount: h.grand_total,
      request_id: key,
    });
    t.add("receivable_plans", r);
    return r;
  });
}
export async function allocateReceipt(f, key = uuid()) {
  return transaction(
    ["receivable_plans", "settlement_allocations", "cash_records"],
    (d, t) => {
      const old = d.settlement_allocations.find((r) => r.request_id === key);
      if (old) return old;
      const plan = owner(d, "receivable_plans", f.plan_id),
        receipt = owner(d, "cash_records", f.receipt_id);
      if (
        receipt.cash_type !== "Müşteriden Para Alındı" ||
        receipt.customer_id !== plan.customer_id
      )
        throw Error("Tahsilat aynı müşteriye ait olmalı");
      const installment = plan.installments.find(
        (i) => i.id === f.installment_id,
      );
      if (!installment) throw Error("Taksit bulunamadı");
      const amount = money(f.amount),
        remaining = planRows(plan, d.settlement_allocations, "9999-12-31").find(
          (i) => i.id === installment.id,
        ).remaining;
      const used = active(d.settlement_allocations)
        .filter((a) => a.receipt_id === receipt.id)
        .reduce((s, a) => s + toKurus(a.amount), 0);
      if (
        toKurus(amount) > toKurus(remaining) ||
        toKurus(amount) + used > toKurus(receipt.amount)
      )
        throw Error("Eşleştirme taksit veya tahsilat kalanını aşamaz");
      const r = newRecord({
        plan_id: plan.id,
        installment_id: installment.id,
        receipt_id: receipt.id,
        customer_id: plan.customer_id,
        date: receipt.date,
        amount,
        request_id: key,
      });
      t.add("settlement_allocations", r);
      return r;
    },
  );
}
export async function savePurchase(f, key = uuid()) {
  return transaction([...owners, "purchase_orders", "work_records"], (d, t) => {
    const old = d.purchase_orders.find((r) => r.request_id === key);
    if (old) return old;
    party(d, f.party_type, f.party_id);
    context(d, f);
    validDate(f.date);
    validDate(f.expected_date, "Teslim tarihi");
    if (f.expected_date < f.date)
      throw Error("Teslim tarihi siparişten önce olamaz");
    const items = invoiceLines(f.items);
    for (const i of items)
      if (i.work_record_id) owner(d, "work_records", i.work_record_id);
    if (!f.order_no?.trim()) throw Error("Sipariş no zorunlu");
    if (active(d.purchase_orders).some((r) => r.order_no === f.order_no.trim()))
      throw Error("Sipariş no kayıtlı");
    const r = newRecord({
      date: f.date,
      expected_date: f.expected_date,
      order_no: f.order_no.trim(),
      party_type: f.party_type,
      party_id: f.party_id,
      items,
      ...invoiceTotals(items),
      status: "Taslak",
      note: f.note || "",
      customer_id: f.customer_id || null,
      site_id: f.site_id || null,
      vehicle_id: f.vehicle_id || null,
      request_id: key,
    });
    t.add("purchase_orders", r);
    return r;
  });
}
export async function transitionPurchase(id, next) {
  return transaction(["purchase_orders"], (d, t) => {
    const r = owner(d, "purchase_orders", id);
    const allowed = {
      Taslak: ["Sipariş Verildi", "İptal"],
      "Sipariş Verildi": ["Teslim Alındı", "İptal"],
    };
    if (!allowed[r.status]?.includes(next))
      throw Error("Sipariş durum geçişi geçersiz");
    const upd = {
      ...r,
      status: next,
      updated_at: nowISO(),
      ...(next === "Teslim Alındı" ? { received_at: nowISO() } : {}),
    };
    t.put("purchase_orders", upd);
    return upd;
  });
}
export async function savePayroll(f, key = uuid()) {
  return transaction(
    [
      "personnel",
      "payroll_entries",
      "bank_accounts",
      "bank_movements",
      "cash_records",
    ],
    (d, t) => {
      const old = d.payroll_entries.find((r) => r.request_id === key);
      if (old) return old;
      owner(d, "personnel", f.personnel_id);
      validDate(f.date);
      if (
        !["Ücret Tahakkuku", "Avans", "Ücret Ödemesi", "Kesinti"].includes(
          f.kind,
        )
      )
        throw Error("Ücret işlem türü geçersiz");
      if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(f.period || ""))
        throw Error("Dönem YYYY-AA olmalı");
      if (
        f.kind === "Ücret Tahakkuku" &&
        active(d.payroll_entries).some(
          (r) =>
            r.personnel_id === f.personnel_id &&
            r.period === f.period &&
            r.kind === f.kind,
        )
      )
        throw Error("Bu personel/dönem ücret tahakkuku var");
      if (f.kind === "Kesinti" && !f.note?.trim())
        throw Error("Kesinti gerekçesi zorunlu");
      const amount = money(f.amount),
        r = newRecord({
          date: f.date,
          period: f.period,
          personnel_id: f.personnel_id,
          kind: f.kind,
          amount,
          note: f.note || "",
          method: ["Avans", "Ücret Ödemesi"].includes(f.kind) ? f.method : null,
          request_id: key,
        });
      if (r.method) {
        if (!["Nakit", "Banka"].includes(r.method))
          throw Error("Ödeme yöntemi zorunlu");
        if (r.method === "Banka") {
          if (!f.bank_account_id) throw Error("Banka hesabı zorunlu");
          r.bank_account_id = f.bank_account_id;
          r.bank_movement_id = bankMove(
            d,
            t,
            f.bank_account_id,
            amount,
            "OUT",
            r.date,
            "payroll_entries",
            r.id,
            r.note,
          ).id;
        } else {
          const cash = newRecord({
            date: r.date,
            personnel_id: r.personnel_id,
            cash_type: "Personel Ücret/Avans Ödemesi",
            payroll_entry_id: r.id,
            cash_status: "KASADA",
            amount,
            description: r.note,
          });
          r.cash_record_id = cash.id;
          t.add("cash_records", cash);
        }
      }
      t.add("payroll_entries", r);
      return r;
    },
  );
}
export async function saveServicePlan(f, key = uuid()) {
  return transaction(["vehicles", "service_plans"], (d, t) => {
    const old = d.service_plans.find((r) => r.request_id === key);
    if (old) return old;
    owner(d, "vehicles", f.vehicle_id);
    if (!f.title?.trim()) throw Error("Bakım adı zorunlu");
    if (
      !f.next_date &&
      (f.next_km === "" || f.next_km == null) &&
      (f.next_hours === "" || f.next_hours == null)
    )
      throw Error("Tarih, km veya saat hedefi girin");
    if (f.next_date) validDate(f.next_date);
    const r = newRecord({
      vehicle_id: f.vehicle_id,
      title: f.title.trim(),
      next_date: f.next_date || null,
      next_km:
        f.next_km !== "" && f.next_km != null
          ? money(f.next_km, "Km", true)
          : null,
      next_hours:
        f.next_hours !== "" && f.next_hours != null
          ? money(f.next_hours, "Saat", true)
          : null,
      warn_days: 7,
      warn_km: 500,
      warn_hours: 25,
      status: "Aktif",
      note: f.note || "",
      request_id: key,
    });
    t.add("service_plans", r);
    return r;
  });
}
export async function completeServicePlan(id, maintenanceId) {
  return transaction(["service_plans", "maintenance_records"], (d, t) => {
    const p = owner(d, "service_plans", id),
      m = owner(d, "maintenance_records", maintenanceId);
    if (m.vehicle_id !== p.vehicle_id || m.status !== "Tamamlandı")
      throw Error("Aynı araç için tamamlanmış bakım seçin");
    if (p.status !== "Aktif") throw Error("Plan zaten tamamlanmış");
    const r = {
      ...p,
      status: "Tamamlandı",
      maintenance_record_id: m.id,
      completed_at: nowISO(),
    };
    t.put("service_plans", r);
    return r;
  });
}
export async function saveActivity(f, key = uuid()) {
  const types = {
    customer: "customers",
    site: "sites",
    vehicle: "vehicles",
    personnel: "personnel",
    contract: "contracts",
    quote: "quotes",
  };
  if (!Object.hasOwn(types, f.owner_type)) throw Error("Takip sahibi geçersiz");
  return transaction([types[f.owner_type], "activities"], (d, t) => {
    const old = d.activities.find((r) => r.request_id === key);
    if (old) return old;
    owner(d, types[f.owner_type], f.owner_id);
    validDate(f.due_date);
    if (!f.title?.trim()) throw Error("Görev başlığı zorunlu");
    const r = newRecord({
      owner_type: f.owner_type,
      owner_id: f.owner_id,
      title: f.title.trim(),
      due_date: f.due_date,
      kind: f.kind || "Takip",
      note: f.note || "",
      status: "Açık",
      request_id: key,
    });
    t.add("activities", r);
    return r;
  });
}
export async function finishActivity(id) {
  return transaction(["activities"], (d, t) => {
    const r = owner(d, "activities", id);
    const updated = { ...r, status: "Tamamlandı", completed_at: nowISO() };
    t.put("activities", updated);
    return updated;
  });
}
export async function saveCategory(f) {
  return transaction(["expense_categories"], (d, t) => {
    if (!f.name?.trim()) throw Error("Kategori adı zorunlu");
    if (
      active(d.expense_categories).some(
        (r) =>
          r.name.toLocaleLowerCase("tr") ===
          f.name.trim().toLocaleLowerCase("tr"),
      )
    )
      throw Error("Kategori zaten var");
    const r = newRecord({ name: f.name.trim(), group: f.group || "Genel" });
    t.add("expense_categories", r);
    return r;
  });
}
export async function closeDay(date, note, key = uuid()) {
  const stores = [
    "daily_closings",
    "work_records",
    "fuel_records",
    "supplier_payments",
    "cash_records",
  ];
  return transaction(stores, (d, t) => {
    const old = d.daily_closings.find((r) => r.request_id === key);
    if (old) return old;
    if (active(d.daily_closings).some((r) => r.date === date))
      throw Error("Bu tarih için gün sonu kaydı var");
    const summary = closingSummary(d, date);
    const r = newRecord({
      date,
      note: note || "",
      summary,
      status: "Kapandı",
      closed_at: nowISO(),
      request_id: key,
    });
    t.add("daily_closings", r);
    return r;
  });
}
export async function saveInstrument(f, key = uuid()) {
  return transaction([...owners, "instruments"], (d, t) => {
    const old = d.instruments.find((r) => r.request_id === key);
    if (old) return old;
    party(d, f.party_type, f.party_id, true);
    validDate(f.date);
    validDate(f.due_date);
    if (f.due_date < f.date) throw Error("Vade tarihten önce olamaz");
    if (
      !["Çek", "Senet"].includes(f.kind) ||
      !["Alınan", "Verilen"].includes(f.direction)
    )
      throw Error("Çek/senet türü veya yönü geçersiz");
    if (!f.document_no?.trim()) throw Error("Çek/senet no zorunlu");
    if (
      active(d.instruments).some(
        (r) =>
          r.document_no === f.document_no.trim() &&
          r.kind === f.kind &&
          r.bank_name === (f.bank_name || ""),
      )
    )
      throw Error("Çek/senet zaten kayıtlı");
    const r = newRecord({
      date: f.date,
      due_date: f.due_date,
      kind: f.kind,
      direction: f.direction,
      document_no: f.document_no.trim(),
      bank_name: f.bank_name || "",
      party_type: f.party_type,
      party_id: f.party_id,
      amount: money(f.amount),
      status: "Portföyde",
      note: f.note || "",
      request_id: key,
    });
    t.add("instruments", r);
    return r;
  });
}
export async function transitionInstrument(id, next, bankMovementId) {
  return transaction(
    ["instruments", "bank_movements", "supplier_payments", "cash_records"],
    (d, t) => {
      const r = owner(d, "instruments", id);
      const transitions = {
        Portföyde: ["Bankaya Verildi", "İade"],
        "Bankaya Verildi": ["Kapandı", "Karşılıksız", "İade"],
      };
      if (!transitions[r.status]?.includes(next))
        throw Error("Çek/senet durum geçişi geçersiz");
      let movement = null;
      if (next === "Kapandı") {
        movement = owner(d, "bank_movements", bankMovementId);
        if (
          movement.direction !== (r.direction === "Alınan" ? "IN" : "OUT") ||
          toKurus(movement.amount) !== toKurus(r.amount) ||
          movement.date < r.date
        )
          throw Error("Banka hareketi çek/senet tutarı ve yönüne uygun değil");
        if (
          active(d.instruments).some(
            (i) => i.id !== id && i.bank_movement_id === bankMovementId,
          )
        )
          throw Error("Banka hareketi başka çek/senede bağlı");
        const source = d[movement.source_store]?.find(
          (s) => s.id === movement.source_id,
        );
        if (!source) throw Error("Banka hareketinin kaynak ödemesi bulunamadı");
        if (
          r.party_type === "customer"
            ? source.customer_id !== r.party_id
            : source.party_type !== r.party_type ||
              source.party_id !== r.party_id
        )
          throw Error("Banka hareketi aynı tarafa ait değil");
      }
      const updated = {
        ...r,
        status: next,
        bank_movement_id: movement?.id || r.bank_movement_id || null,
        updated_at: nowISO(),
      };
      t.put("instruments", updated);
      return updated;
    },
  );
}

export async function updateMaster(store, id, f) {
  if (!["suppliers", "bank_accounts", "expense_categories"].includes(store))
    throw Error("Bu defter kaydı doğrudan düzenlenemez");
  return transaction(
    [store, ...(store === "bank_accounts" ? ["bank_movements"] : [])],
    (d, t) => {
      const r = owner(d, store, id);
      if (!f.name?.trim()) throw Error("Ad zorunlu");
      if (
        active(d[store]).some(
          (x) =>
            x.id !== id &&
            x.name.trim().toLocaleLowerCase("tr") ===
              f.name.trim().toLocaleLowerCase("tr"),
        )
      )
        throw Error("Aynı adla kayıt var");
      const allowed =
        store === "suppliers"
          ? ["name", "type", "phone", "tax_no", "address", "note"]
          : store === "bank_accounts"
            ? ["name", "bank_name", "iban", "opening_date", "opening_balance"]
            : ["name", "group"];
      const fields = Object.fromEntries(
        allowed.filter((k) => f[k] != null).map((k) => [k, f[k]]),
      );
      fields.name = f.name.trim();
      if (store === "bank_accounts") {
        if (fields.opening_date) validDate(fields.opening_date);
        if (
          fields.opening_balance != null &&
          !Number.isFinite(Number(fields.opening_balance))
        )
          throw Error("Açılış bakiyesi geçersiz");
        if (
          active(d.bank_movements).some((m) => m.bank_account_id === id) &&
          ((fields.opening_date && fields.opening_date !== r.opening_date) ||
            (fields.opening_balance != null &&
              Number(fields.opening_balance) !== Number(r.opening_balance)))
        )
          throw Error("Hareketi olan hesabın açılış bilgisi değiştirilemez");
      }
      const updated = { ...r, ...fields, updated_at: nowISO() };
      t.put(store, updated);
      return updated;
    },
  );
}

// Esnaf hesabı: tek ödeme, o ustanın açık borçlarına EN ESKİDEN başlayarak dağıtılır.
// Tek işlemdir: tutar toplam borcu aşarsa hiçbir şey yazılmaz.
export async function paySupplierAccount(f, key = uuid()) {
  return transaction(
    [
      "suppliers",
      "payables",
      "supplier_payments",
      "bank_accounts",
      "bank_movements",
      "cash_records",
    ],
    (d, t) => {
      const done = active(d.supplier_payments).filter((p) => p.batch_key === key);
      if (done.length) return done;
      party(d, "supplier", f.supplier_id);
      validDate(f.date);
      const amount = money(f.amount);
      if (!["Nakit", "Banka"].includes(f.method))
        throw Error("Ödeme yöntemi geçersiz");
      if (f.method === "Banka" && !f.bank_account_id)
        throw Error("Banka hesabı zorunlu");
      const bills = active(d.payables)
        .filter(
          (b) =>
            b.party_type === "supplier" &&
            b.party_id === f.supplier_id &&
            b.status !== "İptal" &&
            b.date <= f.date,
        )
        .sort((a, b) =>
          a.date === b.date
            ? String(a.created_at).localeCompare(String(b.created_at))
            : a.date.localeCompare(b.date),
        );
      let left = toKurus(amount);
      const created = [];
      for (const b of bills) {
        if (left <= 0) break;
        const rem = toKurus(
          billBalance(b, [...d.supplier_payments, ...created]).remaining,
        );
        if (rem <= 0) continue;
        const part = Math.min(rem, left),
          partAmount = fromKurus(part),
          r = newRecord({
            date: f.date,
            payable_id: b.id,
            party_type: "supplier",
            party_id: f.supplier_id,
            amount: partAmount,
            method: f.method,
            bank_account_id: f.method === "Banka" ? f.bank_account_id : null,
            note: f.note || "",
            request_id: key + ":" + b.id,
            batch_key: key,
          });
        const bm = bankMove(
          d,
          t,
          r.bank_account_id,
          partAmount,
          "OUT",
          r.date,
          "supplier_payments",
          r.id,
          r.note,
        );
        r.bank_movement_id = bm?.id || null;
        if (f.method === "Nakit") {
          const cash = newRecord({
            date: r.date,
            cash_type: "Tedarikçiye Ödeme",
            cash_status: "KASADA",
            amount: partAmount,
            payment_method: "Nakit",
            supplier_payment_id: r.id,
            description: r.note,
          });
          r.cash_record_id = cash.id;
          t.add("cash_records", cash);
        }
        t.add("supplier_payments", r);
        created.push(r);
        left -= part;
      }
      if (left > 0)
        throw Error(
          "Ödeme, bu ustanın ödenebilir borcunu aşıyor. Ödenebilir: " +
            fromKurus(toKurus(amount) - left).toLocaleString("tr-TR", {
              minimumFractionDigits: 2,
            }) +
            " ₺",
        );
      return created;
    },
  );
}

// Esnaf ödemesini geri al: kayıt SİLİNMEZ, nedenle iptal (soft-delete) edilir; denetim kaydı kalır.
// Aynı işlemde bağlı kasa kaydı ve banka hareketi de geri çekilir. Bankada mutabakata bağlanmış
// hareket varsa hiçbir şey yazılmaz. key = ödeme grubu (batch_key) veya tek ödeme id'si.
export async function reverseSupplierPayments(key, reason) {
  return transaction(
    ["supplier_payments", "cash_records", "bank_movements", "bank_import_rows"],
    (d, t) => {
      if (!reason?.trim()) throw Error("Geri alma nedeni zorunlu");
      const pays = active(d.supplier_payments).filter(
        (p) => p.batch_key === key || p.id === key,
      );
      if (!pays.length) throw Error("Ödeme bulunamadı veya zaten geri alınmış");
      const now = nowISO();
      for (const p of pays) {
        if (
          p.bank_movement_id &&
          (d.bank_import_rows || []).some(
            (r) => r.bank_movement_id === p.bank_movement_id,
          )
        )
          throw Error(
            "Bu ödeme banka mutabakatına bağlı; önce mutabakatı kaldırın",
          );
      }
      for (const p of pays) {
        t.put("supplier_payments", {
          ...p,
          deleted_at: now,
          reversal_reason: reason.trim(),
          updated_at: now,
        });
        const cash = d.cash_records.find(
          (c) => c.id === p.cash_record_id && isActive(c),
        );
        if (cash)
          t.put("cash_records", {
            ...cash,
            deleted_at: now,
            reversal_reason: reason.trim(),
            updated_at: now,
          });
        const bm = (d.bank_movements || []).find(
          (m) => m.id === p.bank_movement_id && isActive(m),
        );
        if (bm)
          t.put("bank_movements", {
            ...bm,
            deleted_at: now,
            reversal_reason: reason.trim(),
            updated_at: now,
          });
      }
      return pays.length;
    },
  );
}
