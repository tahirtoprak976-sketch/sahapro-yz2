// Esnaf hesabı: lastikçi, tamirci, kaynakçı gibi veresiye çalışılan ustaların borç takibi.
// Mevcut tedarikçi / alış belgesi / tedarikçi ödemesi kayıtlarının üstünde basit bir ön yüzdür;
// yeni veri türü eklemez. Alış belgesi = borç, tedarikçi ödemesi = ödeme.
import * as edb from "./enterprise-db.js";
import { billBalance, taxValues, invoiceLines, invoiceTotals } from "./enterprise-core.js";
import { isActive, toKurus, fromKurus, uuid } from "./core.js";
import {
  qs,
  esc,
  appbar,
  li,
  badge,
  emptyState,
  kv,
  sheet,
  sheetClose,
  toast,
  fText,
  fNum,
  fDate,
  fSelect,
  collectForm,
  fmtTL,
  trDate,
  todayStr,
  shareText,
  promptDialog,
  confirmDialog,
} from "./ui.js";

const TYPES = ["Servis", "Tedarikçi", "Petrolcü", "Diğer"];
const CATEGORIES = [
  "Lastik",
  "Bakım / Onarım",
  "Yedek Parça",
  "Kaynak / Demir",
  "Malzeme",
  "Diğer",
];

export const ledgerOf = (d, supplierId) => {
  const bills = (d.payables || []).filter(
    (b) =>
      isActive(b) &&
      b.party_type === "supplier" &&
      b.party_id === supplierId &&
      b.status !== "İptal",
  );
  const pays = (d.supplier_payments || []).filter(
    (p) => isActive(p) && p.party_id === supplierId,
  );
  const total = bills.reduce((s, b) => s + toKurus(b.gross_total), 0),
    paid = pays.reduce((s, p) => s + toKurus(p.amount), 0);
  const entries = [
    ...bills.map((b) => ({
      kind: "bill",
      id: b.id,
      date: b.date,
      at: b.created_at || "",
      amount: toKurus(b.gross_total),
      text: b.items?.[0]?.description || b.description || "Veresiye alış",
      rec: b,
      paid: toKurus(billBalance(b, pays).paid),
    })),
  ];
  const groups = new Map();
  for (const p of pays) {
    const k = p.batch_key || p.id,
      g = groups.get(k);
    if (g) g.amount += toKurus(p.amount);
    else
      groups.set(k, {
        kind: "pay",
        id: k,
        date: p.date,
        at: p.created_at || "",
        amount: toKurus(p.amount),
        text: "Ödeme · " + (p.method || ""),
      });
  }
  entries.push(...groups.values());
  entries.sort((a, b) =>
    a.date === b.date ? a.at.localeCompare(b.at) : a.date.localeCompare(b.date),
  );
  let run = 0;
  for (const e of entries) {
    run += e.kind === "bill" ? e.amount : -e.amount;
    e.balance = run;
  }
  return { entries, total, paid, remaining: total - paid };
};

export const statementText = (name, ledger, today = todayStr()) =>
  `${name} hesap özeti (${trDate(today)})\n` +
  ledger.entries
    .map(
      (e) =>
        `${trDate(e.date)} · ${e.text} · ${e.kind === "bill" ? "+" : "−"}${fmtTL(fromKurus(e.amount))} ₺`,
    )
    .join("\n") +
  `\nToplam alış: ${fmtTL(fromKurus(ledger.total))} ₺\nÖdenen: ${fmtTL(fromKurus(ledger.paid))} ₺\nKalan borç: ${fmtTL(fromKurus(ledger.remaining))} ₺`;

const suppliersOf = (d) =>
  (d.suppliers || []).filter((s) => isActive(s) && s.active !== false);

export async function screen(ctx) {
  if (ctx.parts[0] !== "esnaf") return false;
  const d = await ctx.db.dumpAll();
  if (ctx.parts[1]) await detail(ctx, d, ctx.parts[1]);
  else await list(ctx, d);
  return true;
}

async function list(ctx, d) {
  const { root } = ctx;
  const rows = suppliersOf(d)
    .map((s) => ({ s, l: ledgerOf(d, s.id) }))
    .sort((a, b) => b.l.remaining - a.l.remaining);
  const sum = rows.reduce((n, r) => n + Math.max(0, r.l.remaining), 0);
  root.innerHTML =
    appbar("Esnaf Hesabı", "Usta / esnaf borçları") +
    `<div class="statgrid" style="margin-top:10px"><div class="stat"><div class="v">${fmtTL(fromKurus(sum))} ₺</div><div class="l">Toplam borcunuz</div></div></div>
    <div style="height:10px"></div>
    <div data-list>${
      rows.length
        ? rows
            .map(({ s, l }) =>
              li({
                ic: "🔧",
                t1: esc(s.name),
                t2: esc(
                  (s.type || "") +
                    (s.phone ? " · " + s.phone : "") +
                    (l.entries.length
                      ? " · son: " + trDate(l.entries.at(-1).date)
                      : ""),
                ),
                href: "#/esnaf/" + s.id,
                badgeHtml: badge(
                  fmtTL(fromKurus(l.remaining)) + " ₺",
                  l.remaining > 0 ? "warn" : "ok",
                ),
              }),
            )
            .join("")
        : emptyState(
            "🔧",
            "Henüz usta / esnaf yok",
            '<button class="btn primary" data-addsup>+ Usta / esnaf ekle</button>',
          )
    }</div>
    <div class="actionbar"><button class="btn primary" data-addsup>+ Usta / esnaf</button></div>`;
  for (const b of root.querySelectorAll("[data-addsup]"))
    b.addEventListener("click", () => supplierSheet(ctx));
}

function supplierSheet(ctx) {
  const sh = sheet(`<h3>Usta / esnaf ekle</h3>
    ${fText("Adı", "name", "", { req: true, ph: "ör. Lastikçi Mesut" })}
    ${fSelect("Türü", "type", TYPES, "Servis", { empty: false })}
    ${fText("Telefon (ops.)", "phone", "", { type: "tel" })}
    <button class="btn primary block" data-ok>Kaydet</button>`);
  const key = uuid();
  qs("[data-ok]", sh).addEventListener("click", async (ev) => {
    const okBtn = ev.currentTarget;
    okBtn.disabled = true;
    try {
      const f = collectForm(sh);
      const s = await edb.saveSupplier(f, key);
      sheetClose();
      toast("Eklendi", "ok");
      ctx.go("#/esnaf/" + s.id);
    } catch (e) {
      okBtn.disabled = false;
      toast(e.message || String(e), "err");
    }
  });
}

async function detail(ctx, d, id) {
  const { root } = ctx;
  const s = suppliersOf(d).find((x) => x.id === id);
  if (!s) {
    root.innerHTML =
      appbar("Esnaf Hesabı") + emptyState("🔧", "Kayıt bulunamadı");
    return;
  }
  const l = ledgerOf(d, id);
  root.innerHTML =
    appbar(s.name, (s.type || "") + (s.phone ? " · " + s.phone : "")) +
    `<div class="statgrid" style="margin-top:10px"><div class="stat ${l.remaining > 0 ? "warn" : ""}"><div class="v">${fmtTL(fromKurus(l.remaining))} ₺</div><div class="l">Kalan borç</div></div></div>
    ${kv("Toplam alış", fmtTL(fromKurus(l.total)) + " ₺")}
    ${kv("Ödenen", fmtTL(fromKurus(l.paid)) + " ₺")}
    <div class="row" style="gap:8px;margin:12px 0">
      <button class="btn primary grow" data-bill>+ Veresiye alış</button>
      <button class="btn grow" data-pay>💵 Ödeme yaptım</button>
    </div>
    <button class="btn block" data-share style="margin-bottom:12px">📤 Hesap özetini paylaş</button>
    <div data-ledger>${
      l.entries.length
        ? [...l.entries]
            .reverse()
            .map((e) =>
              li({
                id: e.id,
                ic: e.kind === "bill" ? "🧾" : "💵",
                t1: esc(e.text),
                t2: `${trDate(e.date)} · bakiye ${fmtTL(fromKurus(e.balance))} ₺`,
                badgeHtml: badge(
                  (e.kind === "bill" ? "+" : "−") +
                    fmtTL(fromKurus(e.amount)) +
                    " ₺",
                  e.kind === "bill" ? "warn" : "ok",
                ),
              }),
            )
            .join("")
        : emptyState("🧾", "Henüz hareket yok")
    }</div>`;
  qs("[data-bill]", root).addEventListener("click", () =>
    billSheet(ctx, d, s),
  );
  qs("[data-pay]", root).addEventListener("click", () => paySheet(ctx, d, s, l));
  qs("[data-share]", root).addEventListener("click", () =>
    shareText(statementText(s.name, l)),
  );
  qs("[data-ledger]", root).addEventListener("click", async (ev) => {
    const card = ev.target.closest(".li[data-rid]");
    const e = card && l.entries.find((x) => x.id === card.dataset.rid);
    if (e && e.kind === "bill") await billDetail(ctx, e);
    else if (e) await payDetail(ctx, e);
  });
}


// Tutar KDV dahil girilir. KDV oranı bilinmiyorsa uydurulmaz: kalem "KDV bilinmiyor" işaretlenir.
export function creditItem(description, gross, rate) {
  const known = rate !== "" && rate != null && Number.isFinite(Number(rate));
  const g = toKurus(gross);
  if (known) {
    const r = Number(rate);
    const base = toKurus(taxValues(gross, r, true).net);
    for (const n of [base, base - 1, base + 1]) {
      const items = [
        { description, quantity: 1, unit: "Adet", unit_price: fromKurus(n), kdv_rate: r },
      ];
      if (toKurus(invoiceTotals(invoiceLines(items)).gross_total) === g)
        return { items, kdv_unknown: false };
    }
  }
  return {
    items: [{ description, quantity: 1, unit: "Adet", unit_price: gross, kdv_rate: 0 }],
    kdv_unknown: true,
  };
}

// Aynı gün + aynı tutar: aynı iş ikinci kez girilmesin (Esnaf Hesabı ve Gider arasında).
export function findDuplicates(d, { date, amount, supplier_id = null }) {
  const k = toKurus(amount);
  const live = (b) => isActive(b) && b.status !== "İptal";
  const bills = (d.payables || []).filter(
    (b) =>
      live(b) &&
      b.party_type === "supplier" &&
      b.date === date &&
      toKurus(b.gross_total) === k &&
      (!supplier_id || b.party_id === supplier_id),
  );
  const linked = new Set(
    (d.payables || [])
      .filter((b) => live(b) && b.source_id)
      .map((b) => b.source_store + ":" + b.source_id),
  );
  const expenses = (d.expense_records || []).filter(
    (e) =>
      isActive(e) &&
      e.date === date &&
      toKurus(e.amount) === k &&
      !linked.has("expense_records:" + e.id),
  );
  return { bills, expenses };
}
const billLabel = (d, b) =>
  `${(d.suppliers || []).find((x) => x.id === b.party_id)?.name || "usta"} · ${trDate(b.date)} · ${fmtTL(b.gross_total)} ₺ · ${b.items?.[0]?.description || b.description || ""}`;

// Veresiye alışı tek yerden kaydeder: Esnaf ekranı ve Gider formu aynı fonksiyonu kullanır.
// Aynı iş daha önce girilmişse reddeder; kullanıcı "farklı iş" diye açıkça onaylamadıkça yazmaz.
// Dönüş: kayıt, ya da vazgeçildiyse null.
export async function createCreditBill(ctx, d, s, f, opts = {}) {
  const dup = findDuplicates(d, { date: f.date, amount: f.amount, supplier_id: s.id });
  let expense = opts.expense || null;
  if (!expense && dup.bills.length) {
    const ok = await confirmDialog(
      "Tekrar kayıt engellendi",
      "Bu alış zaten kayıtlı: " + billLabel(d, dup.bills[0]) + ". Aynı iş ise tekrar girmeyin.",
      "Farklı bir iş, kaydet",
    );
    if (!ok) return null;
  } else if (!expense && dup.expenses.length) {
    const e = dup.expenses[0];
    const same = await confirmDialog(
      "Aynı gün aynı tutarda gider var",
      `${trDate(e.date)} · ${e.category || "Gider"} · ${fmtTL(e.amount)} ₺ ${e.description ? "· " + e.description : ""}. Bu aynı iş mi? Evet derseniz yeni gider yazılmaz, mevcut gider bu ustanın borcuna bağlanır.`,
      "Evet, aynı iş",
    );
    if (same) expense = e;
    else {
      const ok = await confirmDialog(
        "Farklı iş olarak kaydedilsin mi?",
        "Mevcut gider ayrı kalır, bu alış ayrıca sayılır.",
        "Farklı iş, kaydet",
      );
      if (!ok) return null;
    }
  }
  const desc = (f.description || "").trim() || expense?.description || expense?.category || "";
  if (!desc) throw Error("Ne yapıldığını yazın");
  const kdv = creditItem(desc, expense ? expense.amount : f.amount, expense ? expense.kdv_rate : f.kdv_rate);
  const rec = await edb.savePayable(
    {
      date: expense ? expense.date : f.date,
      due_date: expense ? expense.date : f.date,
      document_no: nextDocNo(d, s.id, expense ? expense.date : f.date),
      party_type: "supplier",
      party_id: s.id,
      bill_kind: "Alış",
      cost_category: expense?.category || f.category || "Diğer",
      vehicle_id: expense ? expense.vehicle_id || null : f.vehicle_id || null,
      description: desc + (kdv.kdv_unknown ? " (KDV bilinmiyor)" : ""),
      items: kdv.items,
      kdv_unknown: kdv.kdv_unknown,
      ...(expense
        ? { source_store: "expense_records", source_id: expense.id }
        : opts.source
          ? { source_store: opts.source.store, source_id: opts.source.id }
          : {}),
    },
    opts.key,
  );
  if (f.file) await ctx.db.addAttachment("payable", rec.id, f.file);
  return { rec, linked: !!expense };
}

function nextDocNo(d, supplierId, date) {
  const prefix = "VR-" + date.replaceAll("-", "") + "-";
  const used = new Set(
    (d.payables || [])
      .filter((b) => b.party_type === "supplier" && b.party_id === supplierId)
      .map((b) => b.document_no),
  );
  for (let n = 1; ; n++) {
    const no = prefix + String(n).padStart(2, "0");
    if (!used.has(no)) return no;
  }
}

function billSheet(ctx, d, s) {
  const vehicles = (d.vehicles || []).filter(isActive);
  const sh = sheet(`<h3>Veresiye alış · ${esc(s.name)}</h3>
    ${fDate("Tarih", "date", todayStr())}
    ${fNum("Tutar (₺)", "amount", "", { req: true, step: "any" })}
    ${fText("Ne yapıldı / alındı?", "description", "", { req: true, ph: "ör. 2 lastik değişimi" })}
    ${fSelect("Kategori", "category", CATEGORIES, "Lastik", { empty: false })}
    ${fSelect("İlgili araç (ops.)", "vehicle_id", vehicles.map((v) => ({ v: v.id, t: v.name })), "")}
    <div class="field"><label>Fiş fotoğrafı (ops.)</label><input type="file" name="photo" accept="image/*"></div>
    ${fNum("KDV % (biliniyorsa; tutar KDV dahil)", "kdv_rate", "", { step: "any" })}
    <p class="muted small">KDV boşsa bilinmiyor kabul edilir, tahmin edilmez.</p>
    <button class="btn primary block" data-ok>Kaydet</button>`);
  const key = uuid();
  qs("[data-ok]", sh).addEventListener("click", async (ev) => {
    const btn = ev.currentTarget;
    btn.disabled = true;
    try {
      const f = collectForm(sh);
      if (!f.description?.trim()) throw Error("Ne yapıldığını yazın");
      if (!(Number(f.amount) > 0)) throw Error("Pozitif tutar girin");
      const res = await createCreditBill(
        ctx,
        d,
        s,
        { ...f, file: qs("input[name=photo]", sh).files[0] },
        { key },
      );
      if (!res) {
        btn.disabled = false;
        return;
      }
      sheetClose();
      toast(res.linked ? "Mevcut gider ustanın borcuna bağlandı" : "Veresiye alış kaydedildi", "ok");
      ctx.reload();
    } catch (e) {
      btn.disabled = false;
      toast(e.message || String(e), "err");
    }
  });
}

function paySheet(ctx, d, s, l) {
  const banks = (d.bank_accounts || []).filter(isActive);
  const sh = sheet(`<h3>Ödeme · ${esc(s.name)}</h3>
    <p class="muted small">Kalan borç: <b>${fmtTL(fromKurus(l.remaining))} ₺</b>. Ödeme en eski alıştan başlayarak düşülür.</p>
    ${fDate("Tarih", "date", todayStr())}
    ${fNum("Ödenen tutar (₺)", "amount", "", { req: true, step: "any" })}
    ${fSelect("Yöntem", "method", ["Nakit", ...(banks.length ? ["Banka"] : [])], "Nakit", { empty: false })}
    ${banks.length ? `<div data-bank style="display:none">${fSelect("Banka hesabı", "bank_account_id", banks.map((b) => ({ v: b.id, t: b.name })), "")}</div>` : ""}
    ${fText("Not (ops.)", "note", "")}
    <button class="btn primary block" data-ok>Ödemeyi kaydet</button>`);
  const method = qs("select[name=method]", sh),
    bank = qs("[data-bank]", sh);
  if (bank)
    method.addEventListener("change", () => {
      bank.style.display = method.value === "Banka" ? "" : "none";
    });
  const key = uuid();
  qs("[data-ok]", sh).addEventListener("click", async (ev) => {
    const btn = ev.currentTarget;
    btn.disabled = true;
    try {
      const f = collectForm(sh);
      await edb.paySupplierAccount({ ...f, supplier_id: s.id }, key);
      sheetClose();
      toast("Ödeme kaydedildi", "ok");
      ctx.reload();
    } catch (e) {
      btn.disabled = false;
      toast(e.message || String(e), "err");
    }
  });
}

async function payDetail(ctx, e) {
  const sh = sheet(`<h3>Ödeme</h3>
    ${kv("Tarih", trDate(e.date))}
    ${kv("Tutar", fmtTL(fromKurus(e.amount)) + " ₺")}
    ${kv("Açıklama", e.text)}
    <p class="muted small">Yanlış girildiyse geri alın: kayıt silinmez, nedenle iptal edilir; kasa/banka kaydı da geri çekilir ve borç yeniden açılır.</p>
    <button class="btn danger block" style="margin-top:8px" data-rev>Ödemeyi geri al</button>
    <button class="btn block" style="margin-top:8px" data-close>Kapat</button>`);
  qs("[data-close]", sh).addEventListener("click", () => sheetClose());
  qs("[data-rev]", sh).addEventListener("click", async () => {
    sheetClose(true);
    const reason = await promptDialog("Ödemeyi geri al", "Geri alma nedeni");
    if (!reason) return;
    try {
      await edb.reverseSupplierPayments(e.id, reason);
      toast("Ödeme geri alındı", "ok");
      ctx.reload();
    } catch (err) {
      toast(err.message || String(err), "err");
    }
  });
}
async function billDetail(ctx, e) {
  const atts = await ctx.db.attachmentsFor("payable", e.id);
  const sh = sheet(`<h3>${esc(e.text)}</h3>
    ${kv("Tarih", trDate(e.date))}
    ${kv("Tutar", fmtTL(fromKurus(e.amount)) + " ₺")}
    ${kv("Bu alıştan ödenen", fmtTL(fromKurus(e.paid)) + " ₺")}
    ${kv("Belge no", e.rec.document_no)}
    <div data-photos style="margin-top:10px">${atts.length ? "" : '<span class="muted small">Fiş fotoğrafı yok</span>'}</div>
    ${e.paid === 0 ? '<button class="btn danger block" style="margin-top:12px" data-cancel>Bu alışı iptal et</button>' : '<p class="muted small">Ödemesi olan alış iptal edilemez.</p>'}
    <button class="btn block" style="margin-top:8px" data-close>Kapat</button>`);
  const box = qs("[data-photos]", sh);
  for (const a of atts)
    if ((a.type || "").startsWith("image/")) {
      const img = document.createElement("img");
      img.src = URL.createObjectURL(a.blob);
      img.alt = "Fiş";
      img.style.cssText =
        "width:100%;max-height:55vh;object-fit:contain;border-radius:10px;border:1px solid var(--border);margin-bottom:8px";
      box.appendChild(img);
    }
  qs("[data-close]", sh).addEventListener("click", () => sheetClose());
  qs("[data-cancel]", sh)?.addEventListener("click", async () => {
    sheetClose(true);
    const reason = await promptDialog("Alışı iptal et", "İptal nedeni");
    if (!reason) return;
    try {
      await edb.cancelPayable(e.id, reason);
      toast("Alış iptal edildi", "ok");
      ctx.reload();
    } catch (err) {
      toast(err.message || String(err), "err");
    }
  });
}
