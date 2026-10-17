// SAHAPRO YZ2 — Onay Akışı Laboratuvarı ekranı (İZOLE).
// Bu modül ana uygulamanın durum katmanını (db.js/app.js/assistant.js/security.js) İÇE AKTARMAZ.
// Yalnızca: flow-* çekirdeği + SAF SP1/kripto yardımcıları (driver-core.js, security-core.js;
// ikisi de yan etkisizdir — modül düzeyinde DOM/IndexedDB/ağ kullanmazlar).
// Veri yalnız lab veritabanına (sahapro_yz2_flowlab veya ?db= parametresi) yazılır.
// DÜRÜSTLÜK: Aktör etiketleri (ofis1/yon1) gerçek kullanıcı yetkilendirmesi DEĞİLDİR —
// LabIdentity yalnız "kim yaptı" etiketidir, kanıt değildir. Sunucu yoktur; veri cihazdan çıkmaz.
// İmza doğrulaması "bağlantı anahtarına sahip olunduğunu" gösterir; gerçek kişi kimliğini veya
// işin gerçekten yapıldığını KANITLAMAZ.

import { FlowStore, deleteFlowDB, FLOW_DB_NAME } from "./flow-store.js";
import { makeFlowConfig, labIdentity } from "./flow-identity.js";
import { createFlowService } from "./flow-service.js";
import { parseOpKey } from "./flow-core.js";
import { driverMessage } from "./driver-core.js"; // gerçek şoför üreticisi (saf katman)

const $ = (id) => document.getElementById(id);
const dbName = new URLSearchParams(location.search).get("db") || FLOW_DB_NAME;
$("lab-dbname").textContent = dbName;

const OFIS = labIdentity("ofis1", "ofis");   // kontrol aktörü etiketi (kanıt değil)
const YON = labIdentity("yon1", "yonetici"); // onay aktörü etiketi — kontrolden FARKLI (iki kişi disiplini)
const config = makeFlowConfig({ tenant: "yz2" }); // SP1 kapısı lab DB'deki links store'unu kullanır

let store, svc, selectedId = null;

function log(msg, cls = "") {
  const d = document.createElement("div");
  d.className = cls;
  d.textContent = (cls === "log-err" ? "✗ " : "✓ ") + msg;
  $("lab-log").prepend(d);
}
const logErr = (e) => log((e && (e.code || "")) + " " + (e && e.message ? e.message : e), "log-err");

function stateChip(state) {
  const s = document.createElement("span");
  s.className = "lab-state st-" + state;
  s.textContent = state;
  return s;
}
function kv(k, v) {
  const d = document.createElement("div");
  d.className = "lab-kv";
  const b = document.createElement("b");
  b.textContent = k + ": ";
  d.append(b, document.createTextNode(v));
  return d;
}
const short = (h) => (h ? String(h).slice(0, 16) + "…" : "—");
const esc = (s) => String(s ?? "");

// ============================ 0) LAB BAĞLANTILARI ============================
async function renderLinks() {
  const list = $("links-list");
  list.textContent = "";
  const links = (await svc.listLabLinks()).sort((a, b) => b.issued.localeCompare(a.issued));
  const sel = $("s-link");
  sel.textContent = "";
  if (!links.length) {
    const s = document.createElement("span");
    s.className = "lab-note";
    s.textContent = "Henüz bağlantı yok.";
    list.append(s);
    return;
  }
  for (const l of links) {
    const item = document.createElement("div");
    item.className = "lab-item";
    const title = document.createElement("div");
    const chip = document.createElement("span");
    chip.className = "lab-chip";
    chip.textContent = l.revoked_at ? "iptal" : (l.exp < new Date().toISOString().slice(0, 10) ? "süresi dolmuş" : "aktif");
    title.append(chip, document.createTextNode(" " + l.name + " (" + l.pid + ") — son geçerlilik " + l.exp));
    item.append(title);
    item.append(kv("lid", l.lid), kv("mesaj sayısı", String(l.msgs || 0) + (l.last_seen ? " · son " + l.last_seen : "")));
    if (l.revoked_at) item.append(kv("iptal", (l.revoke_reason || "") + " · " + l.revoked_at));
    const det = document.createElement("details");
    det.className = "lab-details";
    const sum = document.createElement("summary");
    sum.textContent = "Lab imza anahtarı (yalnız deney — üretim anahtarı değildir)";
    const pre = document.createElement("pre");
    pre.textContent = l.secret;
    det.append(sum, pre);
    item.append(det);
    if (!l.revoked_at) {
      const rb = document.createElement("button");
      rb.className = "lab-btn danger";
      rb.textContent = "Bağlantıyı iptal et";
      rb.onclick = async () => {
        await svc.revokeLabLink(l.lid, "lab ekranından iptal");
        log("Bağlantı iptal edildi: " + l.name);
        await renderLinks();
      };
      item.append(rb);
    }
    list.append(item);
    const opt = document.createElement("option");
    opt.value = l.lid;
    opt.textContent = l.name + " — " + l.lid.slice(0, 8) + "…";
    sel.append(opt);
  }
}

$("btn-link").onclick = async () => {
  try {
    const name = $("l-name").value.trim();
    const pid = "TEST-P-" + Math.random().toString(36).slice(2, 6).toUpperCase();
    const made = await svc.createLabLink({ pid, name, vid: "TEST-V-" + pid.slice(-4), days: Number($("l-days").value) });
    log("Lab bağlantısı oluşturuldu: " + name + " (" + pid + "), geçerlilik " + made.link.exp + " — anahtar yalnız lab DB'de");
    await renderLinks();
    $("s-link").value = made.link.lid;
  } catch (e) { logErr(e); }
};

// ============================ 1) ÖRNEK SP1 ÜRETİMİ (gerçek üretici) ============================
function entryForm() {
  return {
    id: $("f-entryId").value.trim(),
    date: $("f-date").value,
    vid: $("f-vehicle").value.trim(),
    cid: $("f-customer").value.trim(),
    sid: $("f-site").value.trim(),
    wt: $("f-worktype").value.trim(),
    q: Number($("f-quantity").value),
    u: $("f-unit").value.trim(),
    ton: $("f-tonnage").value === "" ? undefined : Number($("f-tonnage").value),
    slip: $("f-slip").value.trim() || undefined,
    ph: Number($("f-ph").value) || undefined,
  };
}

$("btn-make-sp1").onclick = async () => {
  try {
    const links = await svc.listLabLinks();
    const link = links.find((l) => l.lid === $("s-link").value);
    if (!link) return log("Önce lab bağlantısı oluşturun", "log-err");
    const e = entryForm();
    if (!e.id) return log("entryId gerekli", "log-err");
    // Şoför uygulamasındaki cfg biçimi: listeler kimlik+ad çiftleri (hepsi TEST- örnek veri)
    const cfg = {
      p: [link.pid, link.name],
      lid: link.lid, ls: link.secret,
      V: [[e.vid, e.vid]],
      C: [[e.cid, e.cid]],
      S: e.sid ? [[e.sid, e.sid, e.cid, "", ""]] : [],
      D: [], E: [], Y: null,
    };
    const entry = { id: e.id, date: e.date, vid: e.vid, cid: e.cid, sid: e.sid, wt: e.wt, q: e.q, u: e.u };
    if (e.ton !== undefined) entry.ton = e.ton;
    if (e.slip) entry.slip = e.slip;
    if (e.ph) entry.ph = e.ph;
    const msg = await driverMessage([entry], cfg); // mevcut şoför uygulamasının GERÇEK üreticisi
    $("sp1-out").value = msg;
    $("sp1-paste").value = msg;
    log("SP1 mesajı üretildi (imzalı, lab anahtarıyla) ve alım alanına koyuldu — entry: " + e.id);
  } catch (e2) { logErr(e2); }
};

// ============================ 2) SP1 DOĞRULA + AL ============================
const ENTRY_STATUS_TR = {
  created: "yeni bildirim açıldı", existing: "mevcut bildirime yönlendirildi", resumed: "teknik hata düzeltildi",
  skipped_kind: "iş dışı kayıt — atlandı", error: "reddedildi",
};

$("btn-sp1-intake").onclick = async () => {
  const box = $("sp1-result");
  box.textContent = "";
  try {
    const text = $("sp1-paste").value;
    const out = await svc.intakeSp1Message(text);
    for (const p of out.packets) {
      const d = document.createElement("div");
      if (p.status === "accepted") {
        d.className = "lab-okbox";
        d.textContent = "Paket kabul: bağlantı " + short(p.lid) + " · imza doğrulandı (lab anahtarıyla) · " + p.entries + " kayıt. " +
          "Not: imza yalnız anahtar sahipliğini gösterir — gerçek kişi kimliği veya işin yapıldığının kanıtı DEĞİLDİR.";
      } else {
        d.className = "lab-errbox";
        d.textContent = "Paket REDDEDİLDİ — " + p.code + ": " + p.reason + " (rapor açılmadı, okunur metinden iş üretilmedi)";
      }
      box.append(d);
    }
    for (const en of out.entries) {
      const d = document.createElement("div");
      d.className = "lab-kv";
      const b = document.createElement("b");
      b.textContent = esc(en.entryId) + ": ";
      d.append(b, document.createTextNode(ENTRY_STATUS_TR[en.status] || en.status) );
      if (en.reason) d.append(document.createTextNode(" — " + en.reason));
      if (en.workId) d.append(document.createTextNode(" · iş: " + short(en.workId)));
      box.append(d);
    }
    log("SP1 alımı: " + out.accepted + " paket kabul, " + out.rejected + " paket red, " + out.skipped + " iş dışı kayıt atlandı");
    await refreshList();
    await renderRejections();
    const first = out.entries.find((e) => e.reportId);
    if (first) await select(first.reportId);
  } catch (e) { logErr(e); }
};

// ============================ 3) MANUEL TEST PAKETİ ============================
function readPacket() {
  const e = entryForm();
  const p = {
    linkId: $("f-linkId").value.trim(),
    entryId: e.id,
    rawText: $("f-raw").value,
    fields: {
      date: e.date, vehicle_id: e.vid, customer_id: e.cid, site_id: e.sid,
      work_type: e.wt, quantity: e.q, unit: e.u,
    },
  };
  if ($("f-attach").checked)
    p.attachments = [{ name: "TEST-fis-ornek.bin", bytes: new TextEncoder().encode("TEST-EK " + p.linkId + "/" + p.entryId) }];
  return p;
}

$("btn-intake").onclick = async () => {
  try {
    const out = await svc.intakePacket(readPacket());
    log("Manuel alım sonucu: " + out.result + " → " + out.report.state + " (" + out.report.op_key + ")");
    await refreshList();
    await select(out.report.id);
  } catch (e) { logErr(e); }
};

// ============================ 4) KAYIT LİSTESİ ============================
async function refreshList() {
  const list = $("reports-list");
  list.textContent = "";
  const all = (await store.all("reports")).sort((a, b) => a.created_at.localeCompare(b.created_at));
  if (!all.length) {
    const s = document.createElement("span");
    s.className = "lab-note";
    s.textContent = "Henüz kayıt yok.";
    list.append(s);
    return;
  }
  for (const r of all) {
    const item = document.createElement("div");
    item.className = "lab-item";
    item.dataset.reportId = r.id;
    const title = document.createElement("div");
    let key = r.op_key;
    try { const p = parseOpKey(r.op_key); key = p.linkId.slice(0, 10) + "… / " + p.entryId; } catch (_) {}
    title.append(stateChip(r.state), document.createTextNode(" " + key + " — r" + r.rev_no + " v" + r.version));
    item.append(title);
    const sub = document.createElement("div");
    sub.className = "lab-mono";
    sub.textContent = "fp " + short(r.fingerprint) + " · zarf " + (r.source_ids || []).length + " · " + r.created_at;
    item.append(sub);
    if (r.media && r.media.required > 0 && (!r.media.confirmed || r.media.attached < r.media.required) && !["onaylandi", "iptal", "reddedildi"].includes(r.state)) {
      const w = document.createElement("div");
      w.className = "lab-warn";
      w.textContent = "Gerekli ek eksik: " + (r.media.attached || 0) + "/" + r.media.required + (r.media.confirmed ? "" : " · eşleşme onayı yok") + " — onaya hazır değil";
      item.append(w);
    }
    item.onclick = () => select(r.id);
    list.append(item);
  }
}

// ============================ 5) RED KAYITLARI ============================
async function renderRejections() {
  const list = $("rejections-list");
  list.textContent = "";
  const all = (await store.all("rejections")).sort((a, b) => b.at.localeCompare(a.at));
  if (!all.length) {
    const s = document.createElement("span");
    s.className = "lab-note";
    s.textContent = "Reddedilen paket yok.";
    list.append(s);
    return;
  }
  for (const r of all.slice(0, 20)) {
    const d = document.createElement("div");
    d.className = "lab-errbox";
    d.textContent = r.reason_code + " — " + r.reason + " · bağlantı: " + (r.link_id ? short(r.link_id) : "yok") +
      " · personel: " + (r.personnel_name || r.personnel_id || "?") + " · " + r.at;
    list.append(d);
  }
}

// ============================ 6) DETAY ============================
const FIELD_LABELS = { date: "Tarih", vehicle_id: "Araç", customer_id: "Müşteri", site_id: "Şantiye", work_type: "İş tipi", quantity: "Miktar", unit: "Birim", tonnage: "Fiş tonajı", material: "Malzeme", description: "Açıklama", slip_no: "Fiş no", unit_price: "Birim fiyat" };

async function select(id) {
  selectedId = id;
  $("detail-card").hidden = false;
  const r = await store.get("reports", id);

  $("d-head").textContent = "";
  $("d-head").append(stateChip(r.state), kv("op-key", r.op_key), kv("oluşturma", r.created_at));
  if (r.entry_index !== null && r.entry_index !== undefined) $("d-head").append(kv("paket içi sıra", String(r.entry_index) + " (kayıt amaçlı — eşleşme kanıtı değildir)"));
  if (r.last_tech_error) $("d-head").append(kv("teknik hata notu", r.last_tech_error));

  // Teslim zarfları (değişmez kanıt) — entry içeriğinden AYRI saklanır
  const src = $("d-source");
  src.textContent = "";
  const srcs = [];
  for (const sid of r.source_ids || []) { const s = await store.get("sources", sid); if (s) srcs.push(s); }
  if (!srcs.length) src.append(kv("zarf", "yok"));
  srcs.forEach((s, i) => {
    src.append(kv("zarf " + (i + 1), (s.kind === "sp1" ? "SP1 paketi" : "manuel paket") + " · imza: " + s.sig_status +
      " · alınma: " + s.received_at + (s.personnel_name ? " · gönderen (beyan): " + s.personnel_name : "") +
      " · kod özeti: " + short(s.code_hash)));
    const det = document.createElement("details");
    det.className = "lab-details";
    const sum = document.createElement("summary");
    sum.textContent = "Ham mesaj (değişmez)";
    const pre = document.createElement("pre");
    pre.textContent = s.raw_text;
    det.append(sum, pre);
    src.append(det);
  });
  src.append(kv("fingerprint", short(r.fingerprint) + " — yalnız iş içeriği+ekler; zarf/taşıma bilgisi girmez. Bütünlük karşılaştırmasıdır, değişmezlik/yetki garantisi değildir."));

  const atts = await store.allByIndex("attachments", "report_id", id);
  const da = $("d-attachments");
  da.textContent = "";
  if (!atts.length) da.append(kv("ek", "yok"));
  atts.forEach((a, i) => da.append(kv("ek " + (i + 1), a.name + " · " + a.size + " bayt · sha256 " + short(a.hash) +
    " · kaynağı: " + (a.origin === "ofis-eslestirme" ? "ofis eşleştirmesi" : "kaynak") + " · iş bağlantısı: " + (a.work_id ? "bağlı" : "henüz yok"))));

  renderMedia(r, atts.length);

  const revs = (await store.allByIndex("revisions", "report_id", id)).sort((a, b) => a.rev_no - b.rev_no);
  const latest = revs.at(-1);
  $("d-rev").textContent = "r" + r.rev_no;
  const df = $("d-fields");
  df.textContent = "";
  const editable = r.state === "kontrolde" || r.state === "onay_bekliyor";
  for (const [k, label] of Object.entries(FIELD_LABELS)) {
    if (!(k in latest.fields)) continue;
    const wrap = document.createElement("div");
    wrap.className = "lab-field";
    const lab = document.createElement("label");
    lab.textContent = label;
    const inp = document.createElement("input");
    inp.id = "e-" + k;
    inp.value = latest.fields[k] ?? "";
    inp.disabled = !editable;
    wrap.append(lab, inp);
    df.append(wrap);
  }
  df.style.display = "flex";
  df.style.flexWrap = "wrap";
  df.style.gap = "8px";

  // Revizyon farkları: eski → yeni + gerekçe + kim
  const dd = $("d-diffs");
  dd.textContent = "";
  const edited = revs.filter((x) => x.changes && Object.keys(x.changes).length);
  if (!edited.length) {
    const s = document.createElement("span");
    s.className = "lab-note";
    s.textContent = "Düzeltme yok.";
    dd.append(s);
  }
  for (const x of edited) {
    const d = document.createElement("div");
    d.className = "lab-diff";
    const b = document.createElement("b");
    b.textContent = "r" + x.rev_no + " · " + x.edited_by + " · " + x.at + (x.reason ? " · gerekçe: " + x.reason : "");
    d.append(b);
    for (const [k, ch] of Object.entries(x.changes)) {
      const line = document.createElement("div");
      line.textContent = (FIELD_LABELS[k] || k) + ": " + esc(ch.from) + " → " + esc(ch.to);
      d.append(line);
    }
    dd.append(d);
  }

  renderActions(r);
  await renderWork(r);
  await renderHistory(r);
}

// Medya eşleştirme bloğu — beyan edilen ek tamamlanmadan iş onaya hazır görünmez.
function renderMedia(r, attCount) {
  const dm = $("d-media");
  dm.textContent = "";
  const m = r.media || { required: 0, attached: 0, confirmed: false };
  if (!m.required && !attCount) return;
  const status = document.createElement("div");
  const complete = m.required > 0 && m.confirmed && (m.attached || 0) >= m.required;
  status.className = complete ? "lab-okbox" : "lab-warn";
  status.textContent = m.required > 0
    ? "Beyan edilen fotoğraf: " + m.required + " · bağlı ek: " + (m.attached || 0) + " · eşleşme onayı: " + (m.confirmed ? "evet" : "HAYIR") +
      (complete ? " — ek tamlığı sağlandı" : " — bu iş onaya HAZIR DEĞİL (kontrol kapatılamaz)")
    : "Ekler kaynak paketiyle geldi.";
  dm.append(status);
  if (!["gonderildi", "kontrolde"].includes(r.state)) return;
  const row = document.createElement("div");
  row.className = "lab-row";
  const cb = document.createElement("input");
  cb.type = "checkbox";
  cb.id = "media-confirm";
  const lab = document.createElement("label");
  lab.htmlFor = "media-confirm";
  lab.style.fontSize = "12px";
  lab.textContent = "Bu ek(ler)in bu işe ait olduğunu doğruladım — fotoğraf sırası tek başına kesin eşleşme sayılmaz";
  const btn = document.createElement("button");
  btn.className = "lab-btn secondary";
  btn.id = "act-media";
  btn.textContent = "TEST fotoğrafı eşleştir (1 ek)";
  btn.onclick = async () => {
    try {
      const c = await store.get("reports", r.id);
      const bytes = new TextEncoder().encode("TEST-MEDIA " + r.id + " " + Date.now());
      const out = await svc.attachMedia(r.id, [{ name: "TEST-foto.bin", bytes }], { confirmed: cb.checked, actor: OFIS }, c.version);
      log("Ek eşleştirildi — toplam " + out.media.attached + "/" + out.media.required + " · onay: " + (out.media.confirmed ? "evet" : "HAYIR"));
      await select(r.id);
      await refreshList();
    } catch (e) { logErr(e); }
  };
  row.append(btn, lab, cb);
  dm.append(row);
}

function actionBtn(id, text, cls, fn) {
  const b = document.createElement("button");
  b.className = "lab-btn " + (cls || "");
  b.id = id;
  b.textContent = text;
  b.onclick = fn;
  return b;
}

function renderActions(r) {
  const box = $("d-actions");
  box.textContent = "";
  $("d-reason-row").hidden = true;
  const needReason = (fn) => async () => {
    $("d-reason-row").hidden = false;
    const reason = $("reason-input").value.trim();
    await fn(reason);
  };
  const fresh = async () => store.get("reports", r.id);
  const run = (fn) => async () => { try { await fn(); await select(r.id); await refreshList(); } catch (e) { logErr(e); } };

  if (r.state === "gonderildi")
    box.append(actionBtn("act-start", "İncelemeye al (etiket: ofis1)", "", run(async () => {
      const c = await fresh();
      await svc.startCheck(r.id, OFIS, c.version);
      log("İnceleme başladı → kontrolde");
    })));

  if (r.state === "kontrolde" || r.state === "onay_bekliyor")
    box.append(actionBtn("act-save", "Alan düzeltmeyi kaydet (etiket: ofis1)", "secondary", needReason(async (reason) => {
      if (!reason) return log("Düzeltme gerekçesi zorunlu", "log-err");
      const c = await fresh();
      const revs = await store.allByIndex("revisions", "report_id", r.id);
      const latest = revs.sort((a, b) => a.rev_no - b.rev_no).at(-1);
      const patch = {};
      for (const k of Object.keys(FIELD_LABELS)) {
        const el = $("e-" + k);
        if (!el) continue;
        const v = k === "quantity" || k === "tonnage" || k === "unit_price" ? Number(el.value) : el.value;
        if (v !== latest.fields[k]) patch[k] = v;
      }
      if (!Object.keys(patch).length) return log("Değişiklik yok");
      const out = await svc.editFields(r.id, patch, OFIS, c.version, { reason });
      log("Yeni revizyon r" + out.rev_no + " (gerekçe: " + reason + ")" + (out.state === "kontrolde" && r.state === "onay_bekliyor" ? " — içerik değişti: kontrol geçersizleşti, akış kontrolde'ye döndü" : ""));
    })));

  if (r.state === "kontrolde") {
    const mediaBlock = r.media && r.media.required > 0 && (!r.media.confirmed || (r.media.attached || 0) < r.media.required);
    const completeBtn = actionBtn("act-complete", "Kontrolü tamamla → onaya gönder (etiket: ofis1)", "", run(async () => {
      const c = await fresh();
      await svc.completeCheck(r.id, OFIS, c.version);
      log("Kontrol tamam → onay_bekliyor");
    }));
    if (mediaBlock) completeBtn.disabled = true; // ATTACHMENT_MISSING — çekirdek de reddeder (çift katman)
    box.append(completeBtn);
    if (mediaBlock) {
      const w = document.createElement("span");
      w.className = "lab-note";
      w.textContent = "Gerekli ek eksik: kontrol tamamlanamaz. Önce yukarıdan ek eşleştirin ve onaylayın.";
      box.append(w);
    }
    box.append(actionBtn("act-correct", "Düzeltme iste (gerekçeli)", "secondary", needReason(async (reason) => {
      if (!reason) return log("Gerekçe zorunlu", "log-err");
      const c = await fresh();
      await svc.requestCorrection(r.id, reason, OFIS, c.version);
      log("Düzeltme istendi → duzeltme_istendi");
    })));
    box.append(actionBtn("act-reject", "Reddet (gerekçeli)", "danger", needReason(async (reason) => {
      if (!reason) return log("Gerekçe zorunlu", "log-err");
      const c = await fresh();
      await svc.reject(r.id, reason, OFIS, c.version);
      log("İş reddedildi (insan kararı) — teknik hata değil");
    })));
  }

  if (r.state === "duzeltme_istendi")
    box.append(actionBtn("act-revision", "TEST: yeni revizyon gönder (etiket: ofis1)", "", run(async () => {
      const c = await fresh();
      const revs = await store.allByIndex("revisions", "report_id", r.id);
      const latest = revs.sort((a, b) => a.rev_no - b.rev_no).at(-1);
      const fields = { ...latest.fields, quantity: latest.fields.quantity };
      await svc.submitRevision(r.id, fields, OFIS, c.version);
      log("Yeni revizyon geldi → kontrolde");
    })));

  if (r.state === "onay_bekliyor") {
    const note = document.createElement("span");
    note.className = "lab-note";
    note.textContent = "Kontrolü yapan: ofis1 — onaylayacak: yon1 (farklı aktör etiketi; aynı etiket onaylayamaz). Onaylanacak revizyon: r" + r.rev_no + ".";
    box.append(actionBtn("act-approve", "Onayla (etiket: yon1) — r" + r.rev_no, "", run(async () => {
      const c = await fresh();
      const out = await svc.approve(r.id, YON, c.version, c.rev_no);
      log(out.result === "existing" ? "Zaten onaylanmış — mevcut iş ve onay döndü (ikinci kayıt açılmadı)" : "Onaylandı — iş kaydı atomik oluştu (revizyon r" + c.rev_no + ")");
    })));
    box.append(actionBtn("act-reject2", "Reddet (yon1, gerekçeli)", "danger", needReason(async (reason) => {
      if (!reason) return log("Gerekçe zorunlu", "log-err");
      const c = await fresh();
      await svc.reject(r.id, reason, YON, c.version);
      log("Yönetici reddi — reddedildi");
    })));
    box.append(note);
  }

  if (r.state === "onaylandi")
    box.append(actionBtn("act-cancel", "İptal et (yon1, gerekçeli)", "danger", needReason(async (reason) => {
      if (!reason) return log("Gerekçe zorunlu", "log-err");
      const c = await fresh();
      await svc.cancel(r.id, reason, YON, c.version);
      log("İptal edildi — iş kaydı SİLİNMEDİ, gerekçe kaydedildi");
    })));

  if (r.state === "teknik_hata")
    box.append(actionBtn("act-resume", "Aynı paketle yeniden dene (formdaki içerik)", "", run(async () => {
      const out = await svc.intakePacket(readPacket());
      log("Sonuç: " + out.result + " → " + out.report.state);
      selectedId = out.report.id;
    })));

  if (r.state === "reddedildi" || r.state === "iptal") {
    const n = document.createElement("span");
    n.className = "lab-note";
    n.textContent = "Uç durum — bu kayıt artık değiştirilemez.";
    box.append(n);
  }
}

async function renderWork(r) {
  const wv = $("work-view");
  wv.textContent = "";
  if (r.state !== "onaylandi" && r.state !== "iptal") return;
  const w = await store.byIndex("works", "op_key", r.op_key);
  if (!w) return;
  const h = document.createElement("h3");
  h.textContent = "İş kaydı (lab)";
  wv.append(h);
  wv.append(
    kv("durum", w.status),
    kv("onaylanan revizyon", "r" + w.source_rev),
    kv("snapshot", Object.entries(w.fields).map(([k, v]) => (FIELD_LABELS[k] || k) + "=" + v).join(" · ")),
    kv("kesinleşmiş finans bağları", w.finalized_links.length ? w.finalized_links.length + " adet" : "yok (lab'da finans bağlantısı henüz kurulmadı)"),
  );
  if (w.cancelled) wv.append(kv("iptal", w.cancelled.by + " · " + w.cancelled.reason + " · " + w.cancelled.at));
  const ap = await store.byIndex("approvals", "op_key", r.op_key);
  if (ap) wv.append(kv("onay", ap.actor_id + " (" + ap.role + ") · onaylanan revizyon r" + ap.rev_no + " · " + ap.at));
}

async function renderHistory(r) {
  const hl = $("history-list");
  hl.textContent = "";
  const rows = (await store.allByIndex("audit", "report_id", r.id)).sort((a, b) => a.at.localeCompare(b.at));
  for (const a of rows) {
    const d = document.createElement("div");
    const b = document.createElement("b");
    b.textContent = a.action;
    d.append(b, document.createTextNode(" — " + a.actor_id + " (" + a.role + ")" + (a.reason ? " — " + a.reason : "") + " — " + a.at));
    hl.append(d);
  }
}

// ---- olaylar
$("btn-refresh").onclick = async () => { await refreshList(); await renderRejections(); };
$("btn-reset").onclick = async () => {
  if (!confirm("Lab veritabanı (" + dbName + ") silinsin mi? Ana uygulama verilerine dokunulmaz.")) return;
  store.close();
  await deleteFlowDB(dbName);
  log("Lab veritabanı silindi — sayfa yenileniyor", "log-ok");
  setTimeout(() => location.reload(), 400);
};

// ---- açılış
store = await FlowStore.open(dbName);
svc = createFlowService({ store, config });
window.__lab = { store, svc, config, dbName, OFIS, YON }; // lab/test erişimi (yetki değil, kolaylık)
await renderLinks();
await refreshList();
await renderRejections();
log("Laboratuvar hazır — veritabanı: " + dbName);
