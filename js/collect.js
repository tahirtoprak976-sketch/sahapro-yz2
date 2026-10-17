// Tahsilat Takibi (#/tahsilat, #/tahsilat/{müşteri}): kim ne kadar borçlu, kaç gündür; ödeme sözü; WhatsApp hatırlatma.
import { qs, esc, appbar, notice, toast, stat, li, emptyState, shareText, fmtTL, trDate, todayStr } from "./ui.js";

const NOTES = "collect_notes";

export async function screen(ctx) {
  if (ctx.parts[0] !== "tahsilat") return false;
  const { root, db } = ctx;
  const core = await import("./collect-core.js");
  const [d, notes, iban] = await Promise.all([db.dumpAll(), db.metaGet(NOTES), db.metaGet("collect_iban")]);
  const today = todayStr();
  const res = core.receivables(d, { today, notes: notes || {} });
  if (ctx.parts[1]) return detail(ctx, core, d, res, notes || {}, iban || "", ctx.parts[1]);

  const b = res.buckets;
  const soon = res.cheques.filter((q) => q.days_left <= 30 || q.status === "Karşılıksız");
  root.innerHTML =
    appbar("Tahsilat Takibi", res.rows.length ? `${res.rows.length} müşteride açık alacak` : "") +
    `<div style="height:10px"></div>
    <div class="card"><div class="row between"><span class="muted small">Toplam alacak</span><span class="strong" style="font-size:20px">${fmtTL(res.total)} ₺</span></div>
      ${res.unbilled ? `<div class="muted tiny">${fmtTL(res.unbilled)} ₺'si henüz hakedişe girmemiş işlerden (iş kaydındaki fiyattan)</div>` : ""}</div>
    <div class="statgrid" style="grid-template-columns:repeat(4,1fr)">
      ${stat(fmtTL(b.b0), "0–30 gün", "ok")}${stat(fmtTL(b.b30), "31–60 gün", b.b30 ? "accent" : "")}${stat(fmtTL(b.b60), "61–90 gün", b.b60 ? "warn" : "")}${stat(fmtTL(b.b90), "90+ gün", b.b90 ? "danger" : "")}
    </div>
    <div class="section-title">Kimden ne kadar? <span class="muted small">önce en riskli</span></div>
    ${res.rows.length ? res.rows.map((r) => li({
      ic: r.oldest_days > 90 ? "🔴" : r.oldest_days > 60 ? "🟠" : r.oldest_days > 30 ? "🟡" : "🟢",
      href: "#/tahsilat/" + r.id,
      t1: esc(r.name) + (r.parent ? ` <span class="muted tiny">(${esc(r.parent)} taşeronu)</span>` : ""),
      t2: esc([
        `en eskisi ${r.oldest_days} gün`,
        r.last_payment ? `son ödeme ${r.last_payment.days} gün önce` : "hiç ödeme kaydı yok",
        r.promise ? (r.promise.late ? "⚠ söz tarihi geçti" : "🤝 söz " + trDate(r.promise.date)) : "",
        r.reminded_days != null ? `hatırlatma ${r.reminded_days} gün önce` : "",
        r.cheque_count ? `${r.cheque_count} çek/senet ${fmtTL(r.cheque_total)} ₺` : "",
      ].filter(Boolean).join(" · ")),
      end: `<span class="amt">${fmtTL(r.total)} ₺</span>`,
    })).join("") : emptyState("💰", "Açık alacak yok — herkes ödemiş görünüyor")}
    <div class="section-title">Çek / Senet vadeleri <span class="muted small">30 gün içinde</span></div>
    ${soon.length ? soon.map((q) => li({
      ic: q.status === "Karşılıksız" ? "⛔" : q.direction === "Alınan" ? "📥" : "📤",
      href: "#/ceksenet/" + q.id,
      t1: esc(`${q.kind} #${q.document_no} · ${q.direction === "Alınan" ? "tahsil edilecek" : "ödenecek"}`),
      t2: esc(`${partyName(d, q)} · vade ${trDate(q.due_date)} · ${q.status === "Karşılıksız" ? "KARŞILIKSIZ" : q.days_left < 0 ? -q.days_left + " gün geçti" : q.days_left === 0 ? "bugün" : q.days_left + " gün kaldı"}`),
      end: `<span class="amt">${fmtTL(q.amount)} ₺</span>`,
    })).join("") : '<div class="muted small" style="padding:4px 8px">Yaklaşan çek/senet yok.</div>'}
    <div class="row" style="gap:8px;margin-top:6px"><button class="btn sm grow" data-go="#/ceksenet/new">+ Çek / Senet</button><button class="btn sm grow" data-go="#/ceksenet">Çek/Senet defteri ›</button></div>
    <div class="section-title">Hatırlatma ayarı</div>
    <div class="card"><div class="field"><label>IBAN (hatırlatma mesajının altına eklenir, boş bırakılabilir)</label><input data-iban value="${esc(iban || "")}" placeholder="TR.."></div>
      <button class="btn sm" data-iban-save>Kaydet</button></div>
    ${notice("info", "Alacak = kesinleşen hakedişler + hakedişe girmemiş fiyatlı işler − tahsilatlar. Tahsilat en eski borçtan düşülür. Fiyatı girilmemiş ya da mazotla ödenen işler alacağa sayılmaz.")}`;
  qs("[data-iban-save]", root).addEventListener("click", async () => {
    await db.metaSet("collect_iban", qs("[data-iban]", root).value.trim().toUpperCase());
    toast("Kaydedildi", "ok");
  });
  return true;
}

function partyName(d, q) {
  const s = { customer: "customers", supplier: "suppliers", contractor: "contractors" }[q.party_type];
  return (d[s] || []).find((x) => x.id === q.party_id)?.name || "—";
}

async function detail(ctx, core, d, res, notes, iban, cid) {
  const { root, db } = ctx;
  const c = (d.customers || []).find((x) => x.id === cid);
  if (!c) { root.innerHTML = appbar("Tahsilat", "", { back: "#/tahsilat" }) + emptyState("🏢", "Müşteri bulunamadı"); return true; }
  const r = res.rows.find((x) => x.id === cid);
  const n = notes[cid] || {};
  const saveNote = async (patch) => {
    const all = (await db.metaGet(NOTES)) || {};
    const next = { ...(all[cid] || {}), ...patch };
    for (const k of Object.keys(next)) if (next[k] === "" || next[k] == null) delete next[k];
    if (Object.keys(next).length) all[cid] = next; else delete all[cid];
    await db.metaSet(NOTES, all);
  };
  if (!r) {
    root.innerHTML = appbar(c.name, "Tahsilat", { back: "#/tahsilat" }) + `<div style="height:10px"></div>` + emptyState("✅", "Bu müşteride açık alacak yok", `<button class="btn" data-go="#/cari/${esc(cid)}">Cari ekstreye bak</button>`);
    if (n.promise_date) await saveNote({ promise_date: "", promise_amount: "", note: "" });
    return true;
  }
  const tone0 = r.promise?.late || r.oldest_days > 90 ? (r.reminded_days != null ? "son" : "net") : r.oldest_days > 45 ? "net" : "nazik";
  const wa = core.waPhone(c.phone);
  root.innerHTML =
    appbar(c.name, "Tahsilat", { back: "#/tahsilat" }) +
    `<div style="height:10px"></div>
    <div class="statgrid" style="grid-template-columns:repeat(3,1fr)">
      ${stat(fmtTL(r.total), "Alacak ₺", "warn")}${stat(r.oldest_days + " gün", "En eski kalem", r.oldest_days > 60 ? "danger" : "")}${stat(r.last_payment ? r.last_payment.days + " gün" : "—", "Son ödemeden beri")}
    </div>
    ${r.last_payment ? `<div class="muted tiny" style="margin:-4px 2px 6px">Son ödeme: ${trDate(r.last_payment.date)} · ${fmtTL(r.last_payment.amount)} ₺</div>` : ""}
    ${r.promise?.late ? notice("danger", `Ödeme sözü ${trDate(r.promise.date)} tarihindeydi, geçti.`) : ""}
    <div class="section-title">📲 Hatırlatma gönder</div>
    <div class="card">
      <div class="field"><label>Üslup</label><select data-tone>${Object.entries(core.TONES).map(([k, v]) => `<option value="${k}" ${k === tone0 ? "selected" : ""}>${v}</option>`).join("")}</select></div>
      <div class="field"><label>Mesaj (göndermeden önce düzeltebilirsiniz)</label><textarea data-msg rows="10"></textarea></div>
      ${wa ? "" : `<div class="field"><label>Müşterinin telefonu yok — eklerseniz WhatsApp doğrudan açılır</label><div class="row" style="gap:6px"><input data-phone type="tel" placeholder="05xx xxx xx xx" class="grow"><button class="btn sm" data-phone-save>Kaydet</button></div></div>`}
      <div class="row" style="gap:8px">
        ${wa ? `<button class="btn primary grow" data-wa>📲 WhatsApp'ta aç (${esc(c.phone)})</button>` : ""}
        <button class="btn ${wa ? "" : "primary"} grow" data-share>📤 Paylaş / Kopyala</button>
      </div>
      <div class="muted tiny" style="margin-top:6px">${r.reminded_at ? `Son hatırlatma: ${trDate(String(r.reminded_at).slice(0, 10))} (${r.reminded_days} gün önce)` : "Bu müşteriye daha önce hatırlatma gönderilmedi."}</div>
    </div>
    <div class="section-title">🤝 Ödeme sözü</div>
    <div class="card">
      <div class="formgrid2"><div class="field"><label>Ödeyeceği tarih</label><input type="date" data-pdate value="${esc(n.promise_date || "")}"></div>
      <div class="field"><label>Tutar (₺)</label><input type="number" step="any" data-pamt value="${esc(n.promise_amount || "")}"></div></div>
      <div class="field"><label>Not</label><input data-pnote value="${esc(n.note || "")}" placeholder="ör. Cuma çek verecek"></div>
      <div class="row" style="gap:8px"><button class="btn sm primary grow" data-psave>Kaydet</button>${n.promise_date ? '<button class="btn sm grow" data-pclear>Sözü sil</button>' : ""}</div>
      <div class="muted tiny" style="margin-top:4px">Tarih gelince ve geçince ana sayfada "Bugün Dikkat"te uyarı çıkar.</div>
    </div>
    <div class="row" style="gap:8px;margin-top:10px">
      <button class="btn primary grow" data-go="#/finans/kasa/new?customer_id=${encodeURIComponent(cid)}">💰 Tahsilat gir</button>
      <button class="btn grow" data-go="#/cari/${esc(cid)}">📄 Cari ekstre</button>
    </div>
    <div class="section-title">Açık kalemler (${r.open.length}) <span class="muted small">eskiden yeniye</span></div>
    ${r.open.map((x) => li({
      ic: x.kind === "hakedis" ? "📑" : x.kind === "is" ? "⚒" : "±",
      href: x.kind === "is" ? "#/isler/" + x.ref : x.kind === "hakedis" ? "#/hakedis/" + x.ref : "",
      t1: esc(`${trDate(x.date)} · ${x.label}`),
      t2: esc(`${x.days} gün${x.left < x.amount ? ` · ${fmtTL(x.amount)} ₺'nin kalanı` : ""}${x.kind === "is" ? " · hakedişe girmedi" : ""}`),
      end: `<span class="amt">${fmtTL(x.left)} ₺</span>`,
    })).join("")}`;
  const msg = qs("[data-msg]", root);
  const fill = () => { msg.value = core.reminderText(r, { tone: qs("[data-tone]", root).value, iban }); };
  fill();
  qs("[data-tone]", root).addEventListener("change", fill);
  const sent = async () => { await saveNote({ reminded_at: new Date().toISOString() }); };
  qs("[data-wa]", root)?.addEventListener("click", async () => {
    const url = core.waLink(c.phone, msg.value);
    await sent();
    window.open(url, "_blank", "noopener");
    toast("Hatırlatma tarihi kaydedildi", "ok");
  });
  qs("[data-share]", root).addEventListener("click", async () => {
    const out = await shareText(msg.value);
    if (out === "shared" || out === "copied") { await sent(); toast("Hatırlatma tarihi kaydedildi", "ok"); }
  });
  qs("[data-phone-save]", root)?.addEventListener("click", async () => {
    const p = qs("[data-phone]", root).value.trim();
    if (!core.waPhone(p)) { toast("Telefon 05xx xxx xx xx biçiminde olmalı", "err"); return; }
    await db.saveExisting("customers", c, { phone: p }, "Tahsilat ekranından telefon eklendi");
    toast("Telefon kaydedildi", "ok");
    ctx.reload();
  });
  qs("[data-psave]", root).addEventListener("click", async () => {
    const date = qs("[data-pdate]", root).value;
    if (!date) { toast("Tarih seçin", "err"); return; }
    await saveNote({ promise_date: date, promise_amount: Number(qs("[data-pamt]", root).value) || "", note: qs("[data-pnote]", root).value.trim() });
    toast("Ödeme sözü kaydedildi", "ok");
    ctx.reload();
  });
  qs("[data-pclear]", root)?.addEventListener("click", async () => {
    await saveNote({ promise_date: "", promise_amount: "", note: "" });
    toast("Söz silindi", "ok");
    ctx.reload();
  });
  return true;
}
