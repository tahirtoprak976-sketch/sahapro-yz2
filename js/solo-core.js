// SOLO extensions: deterministic rules. No remote credentials or automatic financial writes.
import { isActive, toKurus, fromKurus, todayStr, normKey } from "./core.js";
import {
  validDate,
  workHours,
  costLedger,
  operatingResult,
  workFinancials,
  planRows,
} from "./enterprise-core.js";
import {
  parseWhatsApp,
  buildAliasIndex,
  matchByName,
  applyAlias,
} from "./parser.js";
export const SOLO_STORES = [
  "inbox_messages",
  "meter_readings",
  "shift_assignments",
  "custody_records",
  "downtime_records",
  "maintenance_parts",
  "cost_allocations",
  "bank_import_rows",
  "stock_counts",
];
export const live = (d, s) => (d[s] || []).filter(isActive);
export const label = (d, s, id) =>
  d[s]?.find((r) => r.id === id)?.name ||
  d[s]?.find((r) => r.id === id)?.doc_no ||
  "—";
export function required(v, title) {
  if (typeof v !== "string" || !v.trim()) throw Error(title + " zorunlu");
  return v.trim();
}
export function number(v, title, zero = false) {
  if (
    v == null ||
    v === "" ||
    !Number.isFinite(Number(v)) ||
    (zero ? Number(v) < 0 : Number(v) <= 0)
  )
    throw Error(title + " " + (zero ? "negatif olamaz" : "pozitif olmalı"));
  return Number(v);
}
export function reference(d, s, id) {
  const r = live(d, s).find((r) => r.id === id);
  if (!r) throw Error("İlgili kayıt bulunamadı: " + s);
  return r;
}
export function context(d, f) {
  if (f.customer_id) reference(d, "customers", f.customer_id);
  if (f.site_id) {
    const s = reference(d, "sites", f.site_id);
    if (s.customer_id !== f.customer_id)
      throw Error("Şantiye müşteriye ait değil");
  }
  if (f.vehicle_id) reference(d, "vehicles", f.vehicle_id);
  if (f.personnel_id) reference(d, "personnel", f.personnel_id);
}
export function digest(text) {
  let a = 2166136261,
    b = 5381;
  for (const ch of String(text)) {
    const v = ch.codePointAt(0);
    a = Math.imul(a ^ v, 16777619) >>> 0;
    b = ((b * 33) ^ v) >>> 0;
  }
  return a.toString(16).padStart(8, "0") + b.toString(16).padStart(8, "0");
}
export function validPast(v) {
  validDate(v);
  if (v > todayStr())
    throw Error("Gelecekteki gerçekleşme tarihi kabul edilmez");
  return v;
}
export function meterFields(d, f, exclude = null) {
  reference(d, "vehicles", f.vehicle_id);
  validPast(f.date);
  if (!["km", "hours"].includes(f.kind)) throw Error("Sayaç türü geçersiz");
  const value = number(f.value, "Sayaç", true);
  const rows = live(d, "meter_readings")
    .filter(
      (r) =>
        r.id !== exclude && r.vehicle_id === f.vehicle_id && r.kind === f.kind,
    )
    .sort((a, b) => a.date.localeCompare(b.date));
  if (rows.some((r) => r.date === f.date))
    throw Error("Bu gün ve sayaç için okuma zaten var");
  const prior = rows.filter((r) => r.date < f.date).at(-1),
    next = rows.find((r) => r.date > f.date);
  if ((prior && value < prior.value) || (next && value > next.value))
    throw Error(
      "Sayaç tarih sıralamasında geriye gidemez; değişim/sıfırlama ayrı incelenmeli",
    );
  return {
    vehicle_id: f.vehicle_id,
    date: f.date,
    kind: f.kind,
    value,
    note: String(f.note || ""),
  };
}
const clock = (v) => {
  if (!/^\d\d:\d\d$/.test(v || "")) throw Error("Saat gerekli");
  const [h, m] = v.split(":").map(Number);
  if (h > 23 || m > 59) throw Error("Saat geçersiz");
  return h * 60 + m;
};
export function shiftWindow(r) {
  const start =
    Date.parse(validDate(r.date) + "T00:00:00Z") + clock(r.start) * 60000;
  let end = Date.parse(r.date + "T00:00:00Z") + clock(r.end) * 60000;
  if (end <= start) end += 86400000;
  return [start, end];
}
export function shiftFields(d, f) {
  context(d, f);
  reference(d, "personnel", f.personnel_id);
  validDate(f.date);
  required(f.task, "Görev");
  const hours = workHours(f.start, f.end, Number(f.break_minutes || 0));
  const candidate = { ...f, hours };
  const [start, end] = shiftWindow(candidate);
  if (
    live(d, "shift_assignments").some(
      (r) =>
        r.status !== "İptal" &&
        (r.personnel_id === f.personnel_id ||
          (f.vehicle_id && r.vehicle_id === f.vehicle_id)) &&
        (() => {
          const [a, b] = shiftWindow(r);
          return a < end && start < b;
        })(),
    )
  )
    throw Error("Personel veya araç vardiyası çakışıyor");
  const dateEnd = new Date(end - 1).toISOString().slice(0, 10);
  if (
    live(d, "personnel_events").some(
      (r) =>
        r.personnel_id === f.personnel_id &&
        /izin|rapor/i.test(normKey(r.event_type || r.type || "")) &&
        (r.date || r.start_date) <= dateEnd &&
        (r.end_date || r.date_end || r.date) >= f.date,
    )
  )
    throw Error("Personelin izin/rapor kaydı var");
  return { ...candidate, status: "Planlı" };
}
export const CUSTODY_OWNERS = {
  vehicle: "vehicles",
  document: "documents",
  equipment: null,
};
export function custodyFields(d, f) {
  reference(d, "personnel", f.personnel_id);
  validPast(f.date);
  if (!Object.hasOwn(CUSTODY_OWNERS, f.owner_type))
    throw Error("Zimmet türü geçersiz");
  if (f.owner_type === "equipment") required(f.asset_name, "Ekipman");
  else reference(d, CUSTODY_OWNERS[f.owner_type], f.owner_id);
  const asset_key =
    f.owner_type +
    ":" +
    (f.owner_type === "equipment"
      ? normKey(required(f.asset_name, "Ekipman"))
      : f.owner_id);
  if (
    live(d, "custody_records").some(
      (r) => r.asset_key === asset_key && r.status === "Teslim Edildi",
    )
  )
    throw Error("Varlık zaten zimmette; önce iade alın");
  return { ...f, asset_key, status: "Teslim Edildi" };
}
export function downtimeHours(r, asOf = new Date().toISOString()) {
  const a = Date.parse(r.started_at),
    b = Date.parse(r.ended_at || asOf);
  if (!Number.isFinite(a) || !Number.isFinite(b) || b < a)
    throw Error("Duruş başlangıç/bitişi geçersiz");
  return Math.round(((b - a) / 3600000) * 100) / 100;
}
export function downtimeFields(d, f) {
  reference(d, "vehicles", f.vehicle_id);
  required(f.reason, "Duruş nedeni");
  downtimeHours(f);
  if (Date.parse(f.started_at) > Date.now())
    throw Error("Duruş başlangıcı gelecekte olamaz");
  if (
    live(d, "downtime_records").some(
      (r) => r.vehicle_id === f.vehicle_id && !r.ended_at,
    )
  )
    throw Error("Araçta açık duruş var");
  if (f.maintenance_id) {
    const m = reference(d, "maintenance_records", f.maintenance_id);
    if (m.vehicle_id !== f.vehicle_id) throw Error("Arıza başka araca ait");
  }
  return { ...f, status: "Açık" };
}
export function partFields(d, f) {
  const m = reference(d, "maintenance_records", f.maintenance_id);
  required(f.description, "Parça/işçilik");
  const quantity = number(f.quantity, "Miktar"),
    unit_price = number(f.unit_price, "Birim fiyat", true);
  if (!["Parça", "İşçilik"].includes(f.kind))
    throw Error("Kalem türü geçersiz");
  return {
    ...f,
    vehicle_id: m.vehicle_id,
    quantity,
    unit_price,
    total: fromKurus(Math.round(quantity * toKurus(unit_price))),
    informational: true,
  };
}
export function splitAmount(total, weights) {
  const value = toKurus(total);
  if (!Number.isSafeInteger(value) || value < 0 || !weights.length)
    throw Error("Dağıtım tutarı geçersiz");
  const sum = weights.reduce((a, b) => a + number(b, "Ağırlık"), 0);
  const raw = weights.map((w) => (value * w) / sum),
    parts = raw.map(Math.floor);
  let left = value - parts.reduce((a, b) => a + b, 0);
  const order = raw
    .map((n, i) => ({ i, remainder: n - parts[i] }))
    .sort((a, b) => b.remainder - a.remainder || a.i - b.i);
  for (let i = 0; i < left; i++) parts[order[i % order.length].i]++;
  return parts.map(fromKurus);
}
export function allocationFields(d, f) {
  const sources = costLedger(d);
  const source = sources.find(
    (r) => r.source_store === f.source_store && r.source_id === f.source_id,
  );
  if (!source) throw Error("Maliyet kaynağı bulunamadı");
  if (
    sources.filter(
      (r) => r.source_store === f.source_store && r.source_id === f.source_id,
    ).length !== 1
  )
    throw Error("Çok kalemli alışta maliyeti kaynak iş satırına bağlayın");
  if (source.work_record_id)
    throw Error("İşe bağlı maliyet tekrar dağıtılamaz");
  if (
    live(d, "cost_allocations").some(
      (r) =>
        r.source_store === f.source_store &&
        r.source_id === f.source_id &&
        r.status === "Aktif",
    )
  )
    throw Error("Kaynak maliyet zaten dağıtılmış");
  if (!Array.isArray(f.targets) || !f.targets.length || f.targets.length > 100)
    throw Error("1–100 dağıtım hedefi gerekli");
  const ids = new Set();
  const targets = f.targets.map((r) => {
    context(d, r);
    if (!r.site_id && !r.vehicle_id)
      throw Error("Şantiye veya araç hedefi gerekli");
    const key = [r.site_id || "", r.vehicle_id || ""].join("|");
    if (ids.has(key)) throw Error("Dağıtım hedefi yineleniyor");
    ids.add(key);
    return { ...r, weight: number(r.weight, "Dağıtım ağırlığı") };
  });
  const weights = targets.map((r) => r.weight),
    net =
      source.net != null
        ? splitAmount(source.net, weights)
        : targets.map(() => null),
    gross =
      source.net != null && source.tax != null
        ? splitAmount(source.tax, weights).map((tax, i) =>
            fromKurus(toKurus(net[i]) + toKurus(tax)),
          )
        : splitAmount(source.gross, weights);
  return {
    ...f,
    targets: targets.map((r, i) => ({
      ...r,
      net: net[i],
      gross: gross[i],
      tax:
        net[i] == null ? null : fromKurus(toKurus(gross[i]) - toKurus(net[i])),
    })),
    source_snapshot: {
      net: source.net,
      tax: source.tax,
      gross: source.gross,
      known_tax: source.known_tax,
      category: source.category,
    },
    status: "Aktif",
  };
}
export function allocatedCosts(d, f = {}) {
  const base = costLedger(d),
    alloc = live(d, "cost_allocations").filter((r) => r.status === "Aktif"),
    rows = [];
  for (const r of base) {
    const a = alloc.find(
      (a) => a.source_store === r.source_store && a.source_id === r.source_id,
    );
    if (a)
      for (const t of a.targets)
        rows.push({ ...r, ...t, known_tax: r.known_tax, allocation_id: a.id });
    else
      rows.push({
        ...r,
        unallocated: !r.site_id && !r.vehicle_id && !r.work_record_id,
      });
  }
  return rows.filter(
    (r) =>
      (!f.from || r.date >= f.from) &&
      (!f.to || r.date <= f.to) &&
      ["customer_id", "site_id", "vehicle_id", "personnel_id"].every(
        (k) => !f[k] || r[k] === f[k],
      ),
  );
}
export function resultReport(d, f = {}) {
  const original = operatingResult(d, f),
    costs = allocatedCosts(d, f),
    known = costs
      .filter((r) => r.known_tax)
      .reduce((n, r) => n + toKurus(r.net), 0),
    unknown = costs
      .filter((r) => !r.known_tax)
      .reduce((n, r) => n + toKurus(r.gross), 0);
  const works = live(d, "work_records").filter(
    (w) =>
      (!f.from || w.date >= f.from) &&
      (!f.to || w.date <= f.to) &&
      ["customer_id", "site_id", "vehicle_id", "personnel_id"].every(
        (k) => !f[k] || w[k] === f[k],
      ),
  );
  const billed = new Set(
    live(d, "hakedis")
      .filter((h) => h.status === "Kesinleşti")
      .flatMap((h) => (h.items || []).map((i) => i.work_record_id)),
  );
  const priced = works.filter((w) => !billed.has(w.id) && w.price_snapshot),
    unpriced = works.filter((w) => !w.price_snapshot);
  const costless = works.filter(
    (w) =>
      !costs.some(
        (r) =>
          r.work_record_id === w.id ||
          (!r.work_record_id &&
            r.vehicle_id === w.vehicle_id &&
            r.date === w.date),
      ),
  );
  return {
    ...original,
    costs,
    known_cost: fromKurus(known),
    unknown_cost: fromKurus(unknown),
    provisional_result: fromKurus(toKurus(original.revenue) - known - unknown),
    unbilled_value: fromKurus(
      priced.reduce((n, w) => n + toKurus(workFinancials(w).net_total || 0), 0),
    ),
    unpriced,
    costless,
    unallocated: costs.filter((r) => r.unallocated),
    complete: false,
  };
}
export function parseCSV(raw) {
  raw = String(raw).replace(/^\uFEFF/, "");
  if (raw.length > 2e6) throw Error("CSV en fazla 2 MB");
  const first = raw.split(/\r?\n/)[0] || "",
    delimiter = first.includes(";") ? ";" : ",";
  let rows = [],
    row = [],
    cell = "",
    quoted = false;
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i];
    if (c === '"') {
      if (quoted && raw[i + 1] === '"') {
        cell += '"';
        i++;
      } else quoted = !quoted;
    } else if (c === delimiter && !quoted) {
      row.push(cell);
      cell = "";
    } else if ((c === "\n" || c === "\r") && !quoted) {
      if (c === "\r" && raw[i + 1] === "\n") i++;
      row.push(cell);
      if (row.some((v) => v.trim())) rows.push(row);
      row = [];
      cell = "";
    } else cell += c;
  }
  if (quoted) throw Error("CSV tırnakları kapanmamış");
  row.push(cell);
  if (row.some((v) => v.trim())) rows.push(row);
  if (rows.length < 2 || rows.length > 10001)
    throw Error("CSV 1–10000 kayıt içermeli");
  const headers = rows.shift().map((s) => s.trim());
  if (headers.length > 30 || new Set(headers).size !== headers.length)
    throw Error("Kolon başlıkları geçersiz");
  if (rows.some((r) => r.length !== headers.length))
    throw Error("CSV kolon sayıları tutarsız");
  return { headers, rows };
}
export function bankNumber(v) {
  const raw = String(v || "").trim();
  if (!raw) throw Error("Banka tutarı boş");
  let text = raw.replace(/\s|₺|TL/gi, "");
  if (text.includes(",")) text = text.replace(/\./g, "").replace(",", ".");
  if (!/^[+-]?\d+(\.\d{1,2})?$/.test(text))
    throw Error("Banka tutarı geçersiz: " + raw);
  const n = Number(text);
  if (!Number.isSafeInteger(toKurus(n)) || !n)
    throw Error("Sıfır/geçersiz banka tutarı");
  return n;
}
export function bankPreview(csv, mapping, account_id, existing = []) {
  if (!account_id) throw Error("Banka hesabını seçin");
  const keys = ["date", "amount", "description"];
  for (const k of keys)
    if (mapping[k] == null || mapping[k] === "")
      throw Error("Kolon eşleştirin: " + k);
  const seen = new Set(existing.map((r) => r.source_key));
  return csv.rows.map((cells, i) => {
    let errors = [];
    let date, amount, direction;
    try {
      const raw = cells[Number(mapping.date)].trim();
      const m = raw.match(/^(\d{2})[.\/](\d{2})[.\/](\d{4})$/);
      date = m ? `${m[3]}-${m[2]}-${m[1]}` : raw;
      validPast(date);
      amount = bankNumber(cells[Number(mapping.amount)]);
      direction = amount > 0 ? "IN" : "OUT";
    } catch (e) {
      errors.push(e.message);
    }
    const description = cells[Number(mapping.description)] || "",
      ref =
        mapping.reference !== "" && mapping.reference != null
          ? cells[Number(mapping.reference)] || ""
          : "";
    const source_key = JSON.stringify([
      account_id,
      date,
      direction,
      Math.abs(amount),
      ref,
      normKey(description),
    ]);
    const duplicate = seen.has(source_key);
    seen.add(source_key);
    return {
      date,
      amount: Math.abs(amount),
      direction,
      description,
      reference: ref,
      source_key,
      duplicate,
      errors,
      raw_cells: cells,
    };
  });
}
export function bankSuggestions(row, d) {
  if (row.direction === "IN")
    return live(d, "customers")
      .filter((c) => normKey(row.description).includes(normKey(c.name)))
      .map((c) => ({ party_id: c.id, party_type: "customer", name: c.name }));
  return live(d, "payables")
    .filter(
      (b) =>
        b.status !== "İptal" &&
        Math.abs(Number(b.gross_total) - row.amount) < 0.005,
    )
    .map((b) => ({
      party_id: b.party_id,
      party_type: b.party_type,
      payable_id: b.id,
      name: b.document_no || "Alış",
    }));
}
export function messages(raw, year) {
  if (String(raw).length > 2e6) throw Error("Mesaj dosyası en fazla 2 MB");
  year = Number(year);
  if (!Number.isInteger(year) || year < 2000 || year > 2100)
    throw Error("Yıl gerekli");
  const blocks = [];
  let current = null;
  for (const line of String(raw)
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)) {
    const m = line.match(
      /^\[?(\d{1,2})[.\/](\d{1,2})(?:[.\/](\d{2,4}))?[,\s]+(\d{1,2}:\d{2})(?::\d{2})?\]?\s*(?:-\s*)?([^:]+):\s*(.*)$/,
    );
    if (m) {
      const y = m[3] ? (m[3].length === 2 ? "20" + m[3] : m[3]) : year;
      const date = `${y}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
      current = {
        date,
        time: m[4],
        sender: m[5].trim(),
        text: m[6],
        raw: line,
      };
      blocks.push(current);
    } else if (current) {
      current.text += "\n" + line;
      current.raw += "\n" + line;
    } else if (line.trim()) {
      current = { date: null, time: null, sender: null, text: line, raw: line };
      blocks.push(current);
    }
  }
  if (!blocks.length || blocks.length > 1000)
    throw Error("1–1000 mesaj gerekli");
  return blocks.map((r) => ({
    ...r,
    source_key: JSON.stringify([r.date, r.time, r.sender, r.text.trim()]),
  }));
}
export function draftMessage(m, d) {
  if (Array.isArray(m.review_rows))
    return m.review_rows.map((r) => ({ ...r, notes: [...(r.notes || [])] }));
  const ctx = {
    vehicles: live(d, "vehicles"),
    customers: live(d, "customers"),
    sites: live(d, "sites"),
    personnel: live(d, "personnel"),
    aliasIdx: buildAliasIndex(
      live(d, "aliases"),
      live(d, "vehicles"),
      live(d, "customers"),
      live(d, "sites"),
      live(d, "personnel"),
    ),
    defaultDate: m.date || todayStr(),
  };
  const drafts = parseWhatsApp(m.text, { ...ctx, personnel: [] });
  const head = m.text.split(
    /\d+(?:[.,]\d+)?\s*(?:sefer|saat|yevmiye|ton|m3|m³|adet)/i,
  )[0];
  const inheritedCustomer = matchByName(head, ctx.customers),
    inheritedSite = matchByName(head, ctx.sites),
    inheritedVehicle =
      matchByName(head, ctx.vehicles) ||
      ctx.vehicles.find(
        (v) => v.id === applyAlias(head, ctx.aliasIdx, "vehicle")?.target_id,
      );
  return drafts.map((r, i) => {
    let date = m.date,
      notes = [...r.notes];
    const explicit = r.description.match(
      /\b(\d{1,2})[.\/](\d{1,2})[.\/](\d{4})\b/,
    );
    if (explicit)
      date = `${explicit[3]}-${explicit[2].padStart(2, "0")}-${explicit[1].padStart(2, "0")}`;
    if (/(^|\s)(dün|dun)(?=\s|$)/.test(normKey(r.description)) && date) {
      const q = new Date(date + "T12:00:00Z");
      q.setUTCDate(q.getUTCDate() - 1);
      date = q.toISOString().slice(0, 10);
    }
    let personnel_id =
      live(d, "personnel").find((p) =>
        normKey(r.description).includes(normKey(p.name)),
      )?.id || null;
    return {
      ...r,
      customer_id:
        r.customer_id ||
        inheritedCustomer?.id ||
        inheritedSite?.customer_id ||
        null,
      site_id: r.site_id || inheritedSite?.id || null,
      vehicle_id: r.vehicle_id || inheritedVehicle?.id || null,
      date,
      personnel_id,
      notes,
      source_row: i,
      kind: r.fuel_liters ? "fuel" : "work",
    };
  });
}
// Evidence-led review: no invented confidence percentages or automatic approval.
export function messageReview(m, d) {
  return draftMessage(m, d).map((r) => {
    const issues = r.notes.filter((x) => x.includes("Araç adedi"));
    try {
      validPast(r.date);
    } catch {
      issues.push("Gerçek iş tarihi doğrulanmalı");
    }
    if (!r.vehicle_id) issues.push("Araç seçimi gerekli");
    if (r.kind === "work") {
      if (!r.customer_id) issues.push("Müşteri seçimi gerekli");
      if (!r.work_type) issues.push("İş türü gerekli");
      if (!r.unit || !(r.quantity > 0)) issues.push("Miktar ve birim gerekli");
      if (r.unit === "Sefer" && !Number.isInteger(r.quantity))
        issues.push("Sefer tam sayı olmalı");
    } else {
      issues.push(
        "Yakıt kaynağı ve tankın tarihli bakiyesi ayrıca doğrulanmalı",
      );
    }
    if (r.site_id) {
      const site = live(d, "sites").find((x) => x.id === r.site_id);
      if (site?.customer_id && site.customer_id !== r.customer_id)
        issues.push("Müşteri ve şantiye uyuşmuyor");
    }
    const candidates = {};
    for (const [field, store, type] of [
      ["vehicle_id", "vehicles", "vehicle"],
      ["customer_id", "customers", "customer"],
      ["site_id", "sites", "site"],
      ["personnel_id", "personnel", "personnel"],
    ]) {
      const text = normKey(r.description),
        pool = live(d, store);
      const ids = new Set(
        pool
          .filter(
            (x) =>
              normKey(x.name).length >= 3 && text.includes(normKey(x.name)),
          )
          .map((x) => x.id),
      );
      for (const a of live(d, "aliases"))
        if (
          a.active !== false &&
          a.target_type === type &&
          normKey(a.alias).length >= 2 &&
          text.includes(normKey(a.alias)) &&
          pool.some((x) => x.id === a.target_id)
        )
          ids.add(a.target_id);
      candidates[field] = [...ids].map((id) => ({
        id,
        name: label(d, store, id),
      }));
      if (ids.size > 1)
        issues.push(
          {
            vehicle_id: "Araç",
            customer_id: "Müşteri",
            site_id: "Şantiye",
            personnel_id: "Personel",
          }[field] + ": birden fazla eşleşme; seçim doğrulanmalı",
        );
    }
    return {
      ...r,
      issues: [...new Set(issues)],
      candidates,
      review_status: issues.length ? "Kontrol gerekli" : "Alanlar eşleşti",
    };
  });
}
export function historyFromMessage(m, d) {
  const rows = draftMessage(m, d)
    .filter((r) => r.include !== false)
    .map((r, i) => ({
      row_id: "inbox-" + m.id + "-" + (r.source_row ?? i),
      kind: r.kind,
      date: r.date,
      customer:
        label(d, "customers", r.customer_id) === "—"
          ? ""
          : label(d, "customers", r.customer_id),
      site: r.site_id ? label(d, "sites", r.site_id) : "",
      vehicle: r.vehicle_id ? label(d, "vehicles", r.vehicle_id) : "",
      personnel: r.personnel_id ? label(d, "personnel", r.personnel_id) : "",
      dump_site: r.dump_site_id ? label(d, "dump_sites", r.dump_site_id) : "",
      transport_group_key: r.transport_group_key || null,
      transport_total: r.transport_total || null,
      work_type: r.work_type,
      quantity: r.quantity,
      unit: r.unit,
      liters: r.fuel_liters,
      fuel_source: r.fuel_source || (m.review_rows ? "" : "Depo Tankı"),
      unit_price: r.unit_price ?? null,
      kdv_rate: r.kdv_rate ?? null,
      kdv_included: r.kdv_included ?? null,
      raw_message: m.source_messages?.map((x) => x.raw).join("\n") || m.raw,
      description: r.description,
      settlement_status: "unbilled_unpaid",
    }));
  return {
    format: "SAHAPRO_HISTORY_V1",
    title: "Mesajdan kontrollü aktarım",
    rows,
  };
}
export function fuelEfficiency(d, vehicle_id) {
  const rows = live(d, "fuel_records")
    .filter((r) => r.vehicle_id === vehicle_id)
    .sort(
      (a, b) =>
        a.date.localeCompare(b.date) ||
        String(a.created_at).localeCompare(String(b.created_at)),
    );
  const out = [];
  for (let i = 1; i < rows.length; i++) {
    const a = rows[i - 1],
      b = rows[i];
    if (!a.full_tank || !b.full_tank) continue;
    const kind = b.km != null && a.km != null ? "km" : "machine_hours",
      distance = Number(b[kind]) - Number(a[kind]);
    if (distance <= 0) continue;
    out.push({
      date: b.date,
      liters: b.liters,
      distance,
      unit: kind === "km" ? "L/100 km" : "L/saat",
      rate:
        Math.round(
          (Number(b.liters) / distance) * (kind === "km" ? 100 : 1) * 100,
        ) / 100,
    });
  }
  return out;
}
export function localAnswer(question, d) {
  const q = normKey(question);
  const customer = live(d, "customers").find((r) =>
      q.includes(normKey(r.name)),
    ),
    vehicle = live(d, "vehicles").find((r) => q.includes(normKey(r.name)));
  if (/borç|borc|alacak|cari/.test(q) && customer) {
    const rows = live(d, "cari_movements").filter(
      (r) => r.customer_id === customer.id,
    );
    const balance = rows.reduce((n, r) => n + toKurus(r.amount || 0), 0);
    return {
      answer:
        customer.name +
        " cari bakiyesi: " +
        fromKurus(balance).toLocaleString("tr-TR", {
          minimumFractionDigits: 2,
        }) +
        " TL",
      sources: rows.map((r) => ({
        store: "cari_movements",
        id: r.id,
        date: r.date,
        customer_id: r.customer_id,
      })),
    };
  }
  if (/yakit|mazot/.test(q)) {
    const rows = live(d, "fuel_records").filter(
      (r) => !vehicle || r.vehicle_id === vehicle.id,
    );
    return {
      answer:
        (vehicle ? vehicle.name + " için " : "") +
        "Kayıtlı verilen yakıt: " +
        rows
          .reduce((n, r) => n + Number(r.liters || 0), 0)
          .toLocaleString("tr-TR") +
        " litre. Gerçek motor tüketimi değildir.",
      sources: rows.map((r) => ({
        store: "fuel_records",
        id: r.id,
        date: r.date,
      })),
    };
  }
  if (/iş|is|sefer|saat/.test(q)) {
    const rows = live(d, "work_records").filter(
      (r) =>
        (!customer || r.customer_id === customer.id) &&
        (!vehicle || r.vehicle_id === vehicle.id),
    );
    const totals = {};
    for (const r of rows)
      totals[r.unit] = (totals[r.unit] || 0) + Number(r.quantity || 0);
    return {
      answer:
        rows.length +
        " iş kaydı; " +
        Object.entries(totals)
          .map(([u, n]) => n.toLocaleString("tr-TR") + " " + u)
          .join(", "),
      sources: rows.map((r) => ({
        store: "work_records",
        id: r.id,
        date: r.date,
      })),
    };
  }
  return {
    answer:
      "Desteklenen sorular: müşteri cari bakiyesi, araç yakıtı, iş/sefer/saat toplamı. Bu yerel sorgu asistanıdır; AI hizmetine bağlı değildir.",
    sources: [],
  };
}
export function validateSoloData(d) {
  for (const s of SOLO_STORES)
    if (d[s] && !Array.isArray(d[s])) throw Error("Geçersiz defter: " + s);
  for (const r of live(d, "meter_readings")) {
    reference(d, "vehicles", r.vehicle_id);
    validDate(r.date);
    number(r.value, "Sayaç", true);
    if (!["km", "hours"].includes(r.kind)) throw Error("Sayaç türü geçersiz");
  }
  for (const [i, a] of live(d, "meter_readings").entries())
    for (const b of live(d, "meter_readings").slice(i + 1))
      if (
        a.vehicle_id === b.vehicle_id &&
        a.kind === b.kind &&
        (a.date === b.date ||
          (a.date < b.date && a.value > b.value) ||
          (a.date > b.date && a.value < b.value))
      )
        throw Error("Sayaç sırası tutarsız");
  for (const r of live(d, "shift_assignments")) {
    context(d, r);
    reference(d, "personnel", r.personnel_id);
    shiftWindow(r);
  }
  for (const r of live(d, "custody_records")) {
    reference(d, "personnel", r.personnel_id);
    if (CUSTODY_OWNERS[r.owner_type])
      reference(d, CUSTODY_OWNERS[r.owner_type], r.owner_id);
  }
  for (const r of live(d, "downtime_records")) {
    reference(d, "vehicles", r.vehicle_id);
    downtimeHours(r);
  }
  for (const r of live(d, "maintenance_parts")) {
    const m = reference(d, "maintenance_records", r.maintenance_id);
    if (
      m.vehicle_id !== r.vehicle_id ||
      toKurus(r.total) !==
        Math.round(
          number(r.quantity, "Parça miktarı") *
            toKurus(number(r.unit_price, "Parça fiyatı", true)),
        )
    )
      throw Error("Parça toplamı veya aracı tutarsız");
  }
  for (const r of live(d, "cost_allocations")) {
    if (!d[r.source_store]?.some((x) => x.id === r.source_id))
      throw Error("Kopuk maliyet dağıtımı");
    for (const t of r.targets || []) context(d, t);
    const sum = r.targets.reduce((n, t) => n + toKurus(t.gross), 0);
    if (sum !== toKurus(r.source_snapshot.gross))
      throw Error("Dağıtım toplamı tutarsız");
  }
  const bankKeys = new Set(),
    linkedBank = new Set();
  for (const r of live(d, "bank_import_rows")) {
    reference(d, "bank_accounts", r.bank_account_id);
    validDate(r.date);
    number(r.amount, "Banka tutarı");
    if (
      !["IN", "OUT"].includes(r.direction) ||
      !["Eşleşti", "Eşleşmedi"].includes(r.status) ||
      typeof r.source_key !== "string" ||
      bankKeys.has(r.source_key)
    )
      throw Error("Banka satırı türü veya tekrar kaynağı geçersiz");
    bankKeys.add(r.source_key);
    if (r.bank_movement_id) {
      const m = reference(d, "bank_movements", r.bank_movement_id);
      if (
        linkedBank.has(m.id) ||
        m.bank_account_id !== r.bank_account_id ||
        m.date !== r.date ||
        m.direction !== r.direction ||
        toKurus(m.amount) !== toKurus(r.amount)
      )
        throw Error("Banka eşleşmesi tutarsız");
      linkedBank.add(m.id);
    }
  }
  for (const r of live(d, "stock_counts")) {
    validDate(r.date);
    number(r.physical_liters, "Fiziksel litre", true);
    if (
      Math.abs(r.physical_liters - r.theoretical_liters - r.difference) > 0.001
    )
      throw Error("Sayım farkı tutarsız");
    if (r.movement_id) {
      const m = reference(d, "fuel_tank_movements", r.movement_id);
      if (
        m.count_id !== r.id ||
        m.date !== r.date ||
        Math.abs(Number(m.liters) - Math.abs(r.difference)) > 0.001 ||
        (m.move_type === "GİRİŞ" ? 1 : -1) !== Math.sign(r.difference)
      )
        throw Error("Sayım hareketi tutarsız");
    }
  }
  for (const p of live(d, "service_plans"))
    if (p.next_plan_id) {
      const next = reference(d, "service_plans", p.next_plan_id);
      if (next.previous_plan_id !== p.id || next.vehicle_id !== p.vehicle_id)
        throw Error("Sonraki bakım planı kopuk");
    }
}
export function operationalAlerts(d, asOf = todayStr()) {
  const rows = [];
  const add = (level, title, route, detail) =>
    rows.push({ level, title, route, detail });
  for (const a of live(d, "inbox_messages").filter(
    (r) => !["Aktarıldı", "Reddedildi", "Birleştirildi"].includes(r.status),
  ))
    add(
      "warn",
      "Kontrol bekleyen mesaj",
      "#/mesajlar/" + a.id,
      a.sender || "Gönderen belirtilmedi",
    );
  for (const a of live(d, "bank_import_rows").filter(
    (r) => r.status === "Eşleşmedi",
  ))
    add(
      "warn",
      "Eşleşmemiş banka satırı",
      "#/banka-aktarim/" + a.id,
      a.date + " · " + a.amount + " TL",
    );
  for (const a of live(d, "downtime_records").filter((r) => !r.ended_at))
    add(
      "danger",
      "Araç duruşu açık",
      "#/duruslar/" + a.id,
      label(d, "vehicles", a.vehicle_id) + " · " + a.reason,
    );
  for (const a of live(d, "receivable_plans"))
    for (const row of planRows(a, live(d, "settlement_allocations"), asOf))
      if (row.remaining > 0 && row.age_days > 0)
        add(
          "danger",
          "Vadesi geçen alacak",
          "#/vadeler/" + a.id,
          label(d, "customers", a.customer_id) +
            " · " +
            row.remaining +
            " TL · " +
            row.age_days +
            " gün",
        );
  for (const v of live(d, "vehicles")) {
    const rates = fuelEfficiency(d, v.id);
    if (rates.length >= 4) {
      const last = rates.at(-1),
        prior = rates.slice(-4, -1).filter((r) => r.unit === last.unit);
      if (prior.length === 3) {
        const baseline = prior.reduce((n, r) => n + r.rate, 0) / 3;
        if (baseline > 0 && last.rate > baseline * 1.25)
          add(
            "warn",
            "Ölçümlü yakıt tüketimi artışı",
            "#/yakit?vehicle_id=" + v.id,
            v.name +
              " · son " +
              last.rate +
              " " +
              last.unit +
              " · önceki üç dolum " +
              Math.round(baseline * 100) / 100,
          );
      }
    }
  }
  return rows;
}
export function quoteActualRows(quote, works) {
  return (quote.items || []).map((item) => {
    const name = normKey(item.work_type || item.label || "");
    const candidates = works.filter(
      (w) => w.unit === item.unit && normKey(w.work_type) === name,
    );
    const quantity = candidates.reduce(
      (n, w) => n + Number(w.quantity || 0),
      0,
    );
    const priced = candidates.filter((w) => w.price_snapshot);
    const actualNet = fromKurus(
      priced.reduce((n, w) => n + toKurus(workFinancials(w).net_total || 0), 0),
    );
    const amount =
      quote.type === "UNIT_PRICE" || quote.type === "QUANTITY_BASED"
        ? fromKurus(Math.round(quantity * toKurus(item.unit_price || 0)))
        : null;
    return {
      label: item.label,
      unit: item.unit,
      quantity,
      quoted_price: item.unit_price,
      reference_amount: amount,
      actual_net: priced.length === candidates.length ? actualNet : null,
      matched: candidates.length,
      unpriced: candidates.length - priced.length,
    };
  });
}
