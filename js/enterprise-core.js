// İşletme defterleri: TRY/kuruş hesapları, kaynak bağlantısı ve deterministik raporlar.
import {
  isActive,
  toKurus,
  fromKurus,
  todayStr,
  uuid,
  calcHakedisLine,
} from "./core.js";
export const ENTERPRISE_STORES = [
  "suppliers",
  "payables",
  "supplier_payments",
  "bank_accounts",
  "bank_movements",
  "receivable_plans",
  "settlement_allocations",
  "purchase_orders",
  "payroll_entries",
  "service_plans",
  "activities",
  "expense_categories",
  "daily_closings",
  "instruments",
];
export const PARTY_STORES = {
  supplier: "suppliers",
  contractor: "contractors",
  dump_site: "dump_sites",
  quarry: "quarries",
  customer: "customers",
};
export const PARTY_LABELS = {
  supplier: "Tedarikçi / Petrolcü",
  contractor: "Taşeron",
  dump_site: "Döküm Sahası",
  quarry: "Malzeme Ocağı",
  customer: "Müşteri",
};
export function validDate(v, label = "Tarih") {
  const d = new Date(v + "T12:00:00Z");
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(v || "") ||
    !Number.isFinite(d.getTime()) ||
    d.toISOString().slice(0, 10) !== v
  )
    throw Error(label + " geçersiz");
  return v;
}
export function money(v, label = "Tutar", zero = false) {
  if (
    v === "" ||
    v == null ||
    !Number.isFinite(Number(v)) ||
    (zero ? Number(v) < 0 : Number(v) <= 0)
  )
    throw Error(label + " " + (zero ? "negatif olamaz" : "pozitif olmalı"));
  const n = toKurus(v);
  if (!Number.isSafeInteger(n)) throw Error(label + " çok büyük");
  return fromKurus(n);
}
export function taxValues(amount, rate, included = false) {
  const a = toKurus(amount);
  if (!Number.isFinite(Number(rate)) || Number(rate) < 0 || Number(rate) > 100)
    throw Error("KDV oranı 0–100 olmalı");
  const net = included ? Math.round(a / (1 + Number(rate) / 100)) : a;
  const tax = included ? a - net : Math.round((net * Number(rate)) / 100);
  return {
    net: fromKurus(net),
    tax: fromKurus(tax),
    gross: fromKurus(net + tax),
  };
}
export function invoiceLines(items) {
  if (!Array.isArray(items) || !items.length)
    throw Error("En az bir kalem girin");
  return items.map((i) => {
    if (!i.description?.trim()) throw Error("Kalem açıklaması zorunlu");
    const quantity = Number(i.quantity);
    if (!Number.isFinite(quantity) || quantity <= 0)
      throw Error("Kalem miktarı pozitif olmalı");
    const price = money(i.unit_price, "Birim fiyat", true);
    const amount = fromKurus(Math.round(quantity * toKurus(price)));
    return {
      id: i.id || uuid(),
      description: i.description.trim(),
      quantity,
      unit: i.unit || "Adet",
      unit_price: price,
      kdv_rate: Number(i.kdv_rate ?? 20),
      ...taxValues(amount, i.kdv_rate ?? 20, false),
      work_record_id: i.work_record_id || null,
    };
  });
}
export function invoiceTotals(items) {
  const sum = (k) => fromKurus(items.reduce((n, i) => n + toKurus(i[k]), 0));
  return {
    net_total: sum("net"),
    tax_total: sum("tax"),
    gross_total: sum("gross"),
  };
}
export function billBalance(bill, payments = []) {
  const paid = payments
    .filter((p) => isActive(p) && p.payable_id === bill.id)
    .reduce((s, p) => s + toKurus(p.amount), 0);
  return {
    paid: fromKurus(paid),
    remaining:
      bill.status === "İptal" ? 0 : fromKurus(toKurus(bill.gross_total) - paid),
  };
}
export function bankBalance(account, moves = []) {
  return fromKurus(
    toKurus(account.opening_balance || 0) +
      moves
        .filter((m) => isActive(m) && m.bank_account_id === account.id)
        .reduce(
          (s, m) => s + (m.direction === "IN" ? 1 : -1) * toKurus(m.amount),
          0,
        ),
  );
}
export function installmentSchedule(amount, start, count, days) {
  money(amount);
  validDate(start, "İlk vade");
  count = Number(count);
  days = Number(days);
  if (
    !Number.isInteger(count) ||
    count < 1 ||
    count > 60 ||
    !Number.isInteger(days) ||
    days < 1 ||
    days > 365
  )
    throw Error("Taksit 1–60, aralık 1–365 gün olmalı");
  const total = toKurus(amount),
    base = Math.floor(total / count);
  return Array.from({ length: count }, (_, i) => {
    const d = new Date(start + "T12:00:00Z");
    d.setUTCDate(d.getUTCDate() + i * days);
    return {
      id: uuid(),
      due_date: d.toISOString().slice(0, 10),
      amount: fromKurus(i === count - 1 ? total - base * (count - 1) : base),
      sequence: i + 1,
    };
  });
}
export function planRows(plan, allocations = [], asOf = todayStr()) {
  return plan.installments.map((i) => {
    const paid = allocations
      .filter(
        (a) =>
          isActive(a) &&
          a.plan_id === plan.id &&
          a.installment_id === i.id &&
          a.date <= asOf,
      )
      .reduce((n, a) => n + toKurus(a.amount), 0);
    const remaining = fromKurus(toKurus(i.amount) - paid);
    const age = Math.floor(
      (Date.parse(asOf + "T12:00:00Z") -
        Date.parse(i.due_date + "T12:00:00Z")) /
        86400000,
    );
    return {
      ...i,
      plan_id: plan.id,
      customer_id: plan.customer_id,
      paid: fromKurus(paid),
      remaining,
      age_days: Math.max(age, 0),
      bucket:
        remaining <= 0
          ? "Kapalı"
          : age <= 0
            ? "Vadesi Gelmedi"
            : age <= 30
              ? "1–30 Gün"
              : age <= 60
                ? "31–60 Gün"
                : age <= 90
                  ? "61–90 Gün"
                  : "90+ Gün",
    };
  });
}
export function payableAging(bills, payments, asOf = todayStr()) {
  return bills
    .filter((b) => isActive(b) && b.status !== "İptal" && b.date <= asOf)
    .map((b) => {
      const v = billBalance(
        b,
        payments.filter((p) => p.date <= asOf),
      );
      const age = Math.floor(
        (Date.parse(asOf + "T12:00:00Z") -
          Date.parse(b.due_date + "T12:00:00Z")) /
          86400000,
      );
      return {
        ...b,
        ...v,
        age_days: Math.max(0, age),
        bucket:
          v.remaining <= 0
            ? "Kapalı"
            : age <= 0
              ? "Vadesi Gelmedi"
              : age <= 30
                ? "1–30 Gün"
                : age <= 60
                  ? "31–60 Gün"
                  : age <= 90
                    ? "61–90 Gün"
                    : "90+ Gün",
      };
    });
}
export function workHours(start, end, breakMinutes = 0) {
  if (!/^\d\d:\d\d$/.test(start || "") || !/^\d\d:\d\d$/.test(end || ""))
    throw Error("Başlangıç/bitiş saatini girin");
  const minutes = (v) => {
    const [h, m] = v.split(":").map(Number);
    if (h > 23 || m > 59) throw Error("Saat geçersiz");
    return h * 60 + m;
  };
  let duration = minutes(end) - minutes(start);
  if (duration < 0) duration += 1440;
  const rest = Number(breakMinutes);
  if (!Number.isFinite(rest) || rest < 0 || rest >= duration)
    throw Error("Mola çalışma süresinden küçük olmalı");
  return Math.round(((duration - rest) / 60) * 10000) / 10000;
}
export function serviceState(plan, vehicle = {}, fuel = [], asOf = todayStr()) {
  const readings = fuel.filter(
    (f) => isActive(f) && f.vehicle_id === plan.vehicle_id,
  );
  const km = Math.max(
    Number(vehicle.km) || 0,
    ...readings.map((f) => Number(f.km) || 0),
  );
  const hours = Math.max(
    Number(vehicle.machine_hours) || 0,
    ...readings.map((f) => Number(f.machine_hours) || 0),
  );
  const leftDays = plan.next_date
    ? Math.floor(
        (Date.parse(plan.next_date + "T12:00:00Z") -
          Date.parse(asOf + "T12:00:00Z")) /
          86400000,
      )
    : null;
  const leftKm = plan.next_km != null ? Number(plan.next_km) - km : null;
  const leftHours =
    plan.next_hours != null ? Number(plan.next_hours) - hours : null;
  const overdue = [leftDays, leftKm, leftHours].some(
    (n) => n != null && n <= 0,
  );
  const soon =
    (leftDays != null && leftDays <= Number(plan.warn_days ?? 7)) ||
    (leftKm != null && leftKm <= Number(plan.warn_km ?? 500)) ||
    (leftHours != null && leftHours <= Number(plan.warn_hours ?? 25));
  return {
    status: overdue ? "Bakım Geldi" : soon ? "Bakım Yaklaşıyor" : "Planlı",
    leftDays,
    leftKm,
    leftHours,
    km,
    hours,
  };
}
export function payrollBalance(rows, personnelId) {
  return fromKurus(
    rows
      .filter((r) => isActive(r) && r.personnel_id === personnelId)
      .reduce(
        (s, r) =>
          s + (r.kind === "Ücret Tahakkuku" ? 1 : -1) * toKurus(r.amount),
        0,
      ),
  );
}
// Aynı maliyet hem alış belgesinde hem kaynağında sayılmaz. Bilinmeyen KDV net gibi sunulmaz.
export function costLedger(data, f = {}) {
  const rows = [];
  const workMap = new Map((data.work_records || []).map((w) => [w.id, w]));
  const linked = new Set(
    (data.payables || [])
      .filter(
        (b) =>
          isActive(b) && b.status !== "İptal" && b.source_store && b.source_id,
      )
      .map((b) => b.source_store + ":" + b.source_id),
  );
  const match = (r) =>
    (!f.from || r.date >= f.from) &&
    (!f.to || r.date <= f.to) &&
    ["customer_id", "site_id", "vehicle_id", "personnel_id"].every(
      (k) => !f[k] || r[k] === f[k],
    );
  const add = (r) => {
    if (match(r)) rows.push(r);
  };
  for (const b of data.payables || []) {
    if (
      !isActive(b) ||
      b.status === "İptal" ||
      b.bill_kind === "Açılış / Devir"
    )
      continue;
    for (const item of b.items || []) {
      const w = workMap.get(item.work_record_id) || {};
      add({
        date: b.date,
        source_store: "payables",
        source_id: b.id,
        work_record_id: item.work_record_id,
        category: b.cost_category || "Alış",
        description: item.description,
        customer_id: w.customer_id || b.customer_id,
        site_id: w.site_id || b.site_id,
        vehicle_id: w.vehicle_id || b.vehicle_id,
        personnel_id: w.personnel_id || b.personnel_id,
        net: b.kdv_unknown ? null : item.net,
        tax: b.kdv_unknown ? null : item.tax,
        gross: item.gross,
        known_tax: !b.kdv_unknown,
        party_type: b.party_type,
        party_id: b.party_id,
      });
    }
  }
  for (const [store, category, key] of [
    ["expense_records", "Gider", "amount"],
    ["fuel_records", "Yakıt", "total"],
    ["maintenance_records", "Bakım", "cost"],
  ])
    for (const r of data[store] || []) {
      if (!isActive(r) || linked.has(store + ":" + r.id)) continue;
      const gross = Number(r[key] ?? r.total_amount) || 0;
      if (!gross) continue;
      const known = r.kdv_rate !== "" && r.kdv_rate != null;
      const tax = known
        ? taxValues(gross, r.kdv_rate, true)
        : { net: null, tax: null, gross };
      add({
        ...r,
        source_store: store,
        source_id: r.id,
        category: r.category || category,
        description: r.description || category,
        ...tax,
        known_tax: known,
      });
    }
  for (const r of data.payroll_entries || []) {
    if (isActive(r) && r.kind === "Ücret Tahakkuku")
      add({
        ...r,
        source_store: "payroll_entries",
        source_id: r.id,
        category: "Personel Ücreti",
        net: r.amount,
        tax: 0,
        gross: r.amount,
        known_tax: true,
      });
  }
  return rows;
}
export function operatingResult(data, f = {}) {
  const costs = costLedger(data, f);
  const workMap = new Map((data.work_records || []).map((w) => [w.id, w]));
  let revenueKurus = 0;
  const source = [];
  for (const h of data.hakedis || []) {
    if (!isActive(h) || h.status !== "Kesinleşti") continue;
    for (const i of h.items || []) {
      const w = workMap.get(i.work_record_id) || {};
      const date = w.date || h.date_from || h.created_date;
      const context = {
        ...i,
        customer_id: h.customer_id,
        site_id: i.site_id || h.site_id,
        vehicle_id: i.vehicle_id || w.vehicle_id,
        personnel_id: w.personnel_id,
        date,
      };
      if (
        (f.from && date < f.from) ||
        (f.to && date > f.to) ||
        ["customer_id", "site_id", "vehicle_id", "personnel_id"].some(
          (k) => f[k] && context[k] !== f[k],
        )
      )
        continue;
      const line = calcHakedisLine(i);
      const v = { net: line.amount, tax: line.kdv, gross: line.total };
      revenueKurus += toKurus(v.net);
      source.push({ ...context, net: v.net, tax: v.tax, gross: v.gross });
    }
  }
  const knownCost = costs
      .filter((r) => r.known_tax)
      .reduce((s, r) => s + toKurus(r.net), 0),
    unknown = costs
      .filter((r) => !r.known_tax)
      .reduce((s, r) => s + toKurus(r.gross), 0);
  return {
    revenue: fromKurus(revenueKurus),
    known_cost: fromKurus(knownCost),
    unknown_cost: fromKurus(unknown),
    provisional_result: fromKurus(revenueKurus - knownCost - unknown),
    complete: unknown === 0,
    costs,
    revenue_rows: source,
  };
}
export function workFinancials(w) {
  const p = w.price_snapshot;
  if (!p)
    return {
      unit_price: null,
      kdv_rate: null,
      net_total: null,
      tax_total: null,
      gross_total: null,
      price_source: "Fiyat Yok",
    };
  const v = taxValues(
    p.amount ?? Number(p.unit_price) * Number(w.quantity),
    p.kdv_rate ?? 20,
    !!p.kdv_included,
  );
  return {
    unit_price: p.unit_price,
    kdv_rate: p.kdv_rate ?? 20,
    net_total: v.net,
    tax_total: v.tax,
    gross_total: v.gross,
    price_source: p.price_source || "Snapshot",
  };
}
export function closingSummary(data, date) {
  validDate(date);
  const works = (data.work_records || []).filter(
      (w) => isActive(w) && w.date === date,
    ),
    units = {};
  for (const w of works)
    units[w.unit] = (units[w.unit] || 0) + Number(w.quantity);
  const sum = (rows, key) =>
    fromKurus(
      (rows || [])
        .filter((r) => isActive(r) && r.date === date)
        .reduce((s, r) => s + toKurus(r[key] || 0), 0),
    );
  return {
    work_count: works.length,
    units,
    fuel_liters: (data.fuel_records || [])
      .filter((r) => isActive(r) && r.date === date)
      .reduce((s, r) => s + Number(r.liters || 0), 0),
    supplier_payments: sum(data.supplier_payments, "amount"),
    customer_receipts: fromKurus(
      (data.cash_records || [])
        .filter(
          (r) =>
            isActive(r) &&
            r.date === date &&
            r.cash_type === "Müşteriden Para Alındı",
        )
        .reduce((s, r) => s + toKurus(r.amount), 0),
    ),
    missing_price: works.filter((w) => !w.price_snapshot).length,
    missing_slip: works.filter((w) => !w.slip_id && w.slip_status !== "Fiş Var")
      .length,
    source_work_ids: works.map((w) => w.id),
    source_signature: sourceSignature(data, date),
  };
}

// Tam yedek/restore için yeni defterlerin para ve ilişki bütünlüğü.
export function validateEnterpriseData(data) {
  const has = (s, id) => (data[s] || []).some((r) => r.id === id),
    require = (s, id) => {
      if (!has(s, id)) throw Error("Yedekte kopuk " + s + " ilişkisi");
    };
  const parties = (r) => {
    if (!Object.hasOwn(PARTY_STORES, r.party_type))
      throw Error("Yedekte geçersiz taraf");
    require(PARTY_STORES[r.party_type], r.party_id);
  };
  for (const store of ["payables", "purchase_orders"])
    for (const b of data[store] || []) {
      parties(b);
      validDate(b.date);
      validDate(b.due_date || b.expected_date);
      const totals = invoiceTotals(invoiceLines(b.items));
      for (const k of ["net_total", "tax_total", "gross_total"])
        if (toKurus(totals[k]) !== toKurus(b[k]))
          throw Error("Yedekte belge toplamı farklı");
      for (const i of b.items)
        if (i.work_record_id) require("work_records", i.work_record_id);
      if (b.source_store) {
        if (
          ![
            "expense_records",
            "fuel_records",
            "fuel_tank_movements",
            "maintenance_records",
            "purchase_orders",
          ].includes(b.source_store)
        )
          throw Error("Yedekte maliyet kaynağı geçersiz");
        require(b.source_store, b.source_id);
      }
    }
  for (const b of data.payables || []) {
    if (billBalance(b, data.supplier_payments).remaining < 0)
      throw Error("Yedekte borçtan fazla ödeme");
  }
  for (const p of data.supplier_payments || []) {
    require("payables", p.payable_id);
    money(p.amount);
    const b = data.payables.find((b) => b.id === p.payable_id);
    if (p.party_type !== b.party_type || p.party_id !== b.party_id)
      throw Error("Yedekte ödeme tarafı farklı");
    if (p.bank_movement_id) require("bank_movements", p.bank_movement_id);
    if (p.cash_record_id) require("cash_records", p.cash_record_id);
  }
  for (const m of data.bank_movements || []) {
    require("bank_accounts", m.bank_account_id);
    money(m.amount);
    if (!["IN", "OUT"].includes(m.direction))
      throw Error("Yedekte banka yönü geçersiz");
    if (m.source_store === "bank_transfer") {
      const peers = (data.bank_movements || []).filter(
        (p) =>
          p.source_store === "bank_transfer" && p.source_id === m.source_id,
      );
      if (
        peers.length !== 2 ||
        peers[0].direction === peers[1].direction ||
        peers[0].bank_account_id === peers[1].bank_account_id ||
        toKurus(peers[0].amount) !== toKurus(peers[1].amount)
      )
        throw Error("Yedekte kopuk banka transferi");
    } else if (m.source_store === "bank_import_rows") {
      require("bank_import_rows",m.source_id);
      const row=data.bank_import_rows.find(r=>r.id===m.source_id);
      if(row.bank_movement_id!==m.id||row.bank_account_id!==m.bank_account_id||row.direction!==m.direction||row.date!==m.date||toKurus(row.amount)!==toKurus(m.amount))throw Error("Yedekte kopuk banka dosyası olayı");
    } else {
      if (
        !["supplier_payments", "cash_records", "payroll_entries"].includes(
          m.source_store,
        )
      )
        throw Error("Yedekte banka kaynağı geçersiz");
      require(m.source_store, m.source_id);
      const source = data[m.source_store].find((r) => r.id === m.source_id);
      if (
        m.direction !== (m.source_store === "cash_records" ? "IN" : "OUT") ||
        m.date !== source.date ||
        source.bank_movement_id !== m.id ||
        source.bank_account_id !== m.bank_account_id ||
        toKurus(source.amount) !== toKurus(m.amount)
      )
        throw Error("Yedekte kopuk banka/ödeme olayı");
    }
  }
  for (const p of data.receivable_plans || []) {
    require("hakedis", p.hakedis_id);
    const h = data.hakedis.find((h) => h.id === p.hakedis_id);
    if (
      h.customer_id !== p.customer_id ||
      h.status !== "Kesinleşti" ||
      toKurus(h.grand_total) !==
        p.installments.reduce((s, i) => s + toKurus(i.amount), 0)
    )
      throw Error("Yedekte vade/hakediş toplamı farklı");
    const ids = new Set();
    for (const i of p.installments) {
      validDate(i.due_date);
      if (ids.has(i.id)) throw Error("Yedekte mükerrer taksit");
      ids.add(i.id);
    }
    if (
      planRows(p, data.settlement_allocations, "9999-12-31").some(
        (i) => i.remaining < 0,
      )
    )
      throw Error("Yedekte taksitten fazla eşleştirme");
  }
  for (const a of data.settlement_allocations || []) {
    require("receivable_plans", a.plan_id);
    require("cash_records", a.receipt_id);
    const p = data.receivable_plans.find((p) => p.id === a.plan_id),
      c = data.cash_records.find((c) => c.id === a.receipt_id);
    if (
      !p.installments.some((i) => i.id === a.installment_id) ||
      p.customer_id !== c.customer_id ||
      c.cash_type !== "Müşteriden Para Alındı"
    )
      throw Error("Yedekte yanlış tahsilat eşleştirmesi");
    money(a.amount);
    const used = (data.settlement_allocations || [])
      .filter((x) => isActive(x) && x.receipt_id === c.id)
      .reduce((s, x) => s + toKurus(x.amount), 0);
    if (used > toKurus(c.amount))
      throw Error("Yedekte tahsilattan fazla eşleştirme");
  }
  for (const r of data.payroll_entries || []) {
    require("personnel", r.personnel_id);
    money(r.amount);
    if (r.bank_movement_id) require("bank_movements", r.bank_movement_id);
    if (r.cash_record_id) require("cash_records", r.cash_record_id);
  }
  for (const p of data.service_plans || []) {
    require("vehicles", p.vehicle_id);
    if (p.maintenance_record_id) {
      require("maintenance_records", p.maintenance_record_id);
      const m = data.maintenance_records.find(
        (m) => m.id === p.maintenance_record_id,
      );
      if (m.vehicle_id !== p.vehicle_id)
        throw Error("Yedekte bakım aracı farklı");
    }
  }
  for (const r of data.activities || []) {
    const s = {
      customer: "customers",
      site: "sites",
      vehicle: "vehicles",
      personnel: "personnel",
      quote: "quotes",
      contract: "contracts",
    }[r.owner_type];
    if (!s) throw Error("Yedekte takip sahibi geçersiz");
    require(s, r.owner_id);
  }
  for (const r of data.instruments || []) {
    parties(r);
    money(r.amount);
    if (r.bank_movement_id) {
      require("bank_movements", r.bank_movement_id);
      const m = data.bank_movements.find((m) => m.id === r.bank_movement_id);
      if (
        m.direction !== (r.direction === "Alınan" ? "IN" : "OUT") ||
        toKurus(m.amount) !== toKurus(r.amount)
      )
        throw Error("Yedekte çek/senet eşleşmesi farklı");
    }
  }
  const seenSources = new Set(),
    seenPlans = new Set();
  for (const b of (data.payables || []).filter(
    (r) => isActive(r) && r.status !== "İptal",
  )) {
    if (b.source_id) {
      const key = b.source_store + ":" + b.source_id;
      if (seenSources.has(key)) throw Error("Yedekte mükerrer maliyet kaynağı");
      seenSources.add(key);
    }
  }
  for (const p of activeRows(data.receivable_plans)) {
    if (seenPlans.has(p.hakedis_id))
      throw Error("Yedekte mükerrer hakediş planı");
    seenPlans.add(p.hakedis_id);
  }
}
function activeRows(rows) {
  return (rows || []).filter(isActive);
}

export function commercialReportRows(records, store) {
  return records.flatMap((r) => {
    const type = store === "contracts" ? r.pricing_method || r.type : r.type;
    const items = [...(r.items || r.lines || [])];
    if (type === "LUMP_SUM" && store !== "hakedis")
      items.push({
        label: "Götürü Bedel",
        quantity: 1,
        unit: "İş",
        unit_price: r.lump_total,
        authoritative_lump: true,
      });
    return items.map((i) => {
      const meaningful =
        store === "hakedis" ||
        type === "QUANTITY_BASED" ||
        (type === "LUMP_SUM" && i.authoritative_lump);
      const line = meaningful
        ? calcHakedisLine({
            ...i,
            unit_price: i.unit_price ?? i.price,
            kdv_rate: store === "hakedis" ? i.kdv_rate : (r.kdv_rate ?? 20),
            kdv_included: store === "hakedis" ? !!i.kdv_included : false,
          })
        : null;
      return {
        parent_id: r.id,
        date: r.date || r.created_date || r.date_from,
        customer_id: r.customer_id,
        site_id: i.site_id || r.site_id,
        quote_no: r.quote_no,
        contract_no: r.contract_no,
        hakedis_no: r.hakedis_no,
        status: r.status,
        title: r.title,
        work_type: i.work_type || i.description || i.label || i.name,
        quantity: type === "UNIT_PRICE" ? null : i.quantity,
        unit: i.unit,
        unit_price: i.unit_price ?? i.price,
        kdv_rate: i.kdv_rate ?? r.kdv_rate ?? 20,
        net_total: line?.amount ?? null,
        tax_total: line?.kdv ?? null,
        gross_total: line?.total ?? null,
        price_source: i.price_source,
      };
    });
  });
}

function sourceSignature(data, date) {
  let hash = 2166136261;
  const value = JSON.stringify(
    ["work_records", "fuel_records", "supplier_payments", "cash_records"].map(
      (s) =>
        (data[s] || [])
          .filter((r) => isActive(r) && r.date === date)
          .sort((a, b) => String(a.id || "").localeCompare(String(b.id || "")))
          .map((r) => ({
            id: r.id,
            date: r.date,
            quantity: r.quantity,
            unit: r.unit,
            customer_id: r.customer_id,
            vehicle_id: r.vehicle_id,
            slip_id: r.slip_id,
            price_snapshot: r.price_snapshot,
            liters: r.liters,
            total: r.total,
            amount: r.amount,
            cash_status: r.cash_status,
          })),
    ),
  );
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}
