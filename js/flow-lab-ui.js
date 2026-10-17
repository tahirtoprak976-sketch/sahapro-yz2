// SAHAPRO YZ2 — Onay Akışı Laboratuvarı ekranı (İZOLE).
// Bu modül ana uygulamanın hiçbir dosyasını içe aktarmaz; yalnız flow-* çekirdeğini kullanır.
// Veri yalnız lab veritabanına (sahapro_yz2_flowlab veya ?db= parametresi) yazılır.
// DÜRÜSTLÜK: Aktör etiketleri (ofis1/yon1) gerçek kullanıcı yetkilendirmesi DEĞİLDİR —
// LabIdentity yalnız "kim yaptı" etiketidir, kanıt değildir. Sunucu yoktur; veri cihazdan çıkmaz.

import { FlowStore, deleteFlowDB, FLOW_DB_NAME } from "./flow-store.js";
import { makeFlowConfig, labIdentity } from "./flow-identity.js";
import { createFlowService } from "./flow-service.js";
import { parseOpKey } from "./flow-core.js";

const $ = (id) => document.getElementById(id);
const dbName = new URLSearchParams(location.search).get("db") || FLOW_DB_NAME;
$("lab-dbname").textContent = dbName;

const OFIS = labIdentity("ofis1", "ofis");   // kontrol aktörü etiketi (kanıt değil)
const YON = labIdentity("yon1", "yonetici"); // onay aktörü etiketi — kontrolden FARKLI (iki kişi disiplini)
const config = makeFlowConfig({ tenant: "yz2" }); // knownLinks boş = lab'da bağlantı serbest

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
const short = (h) => (h ? h.slice(0, 16) + "…" : "—");

// Formdaki TEST paketini topla (tamamı örnek veri — TEST- etiketli)
function readPacket() {
  const p = {
    linkId: $("f-linkId").value.trim(),
    entryId: $("f-entryId").value.trim(),
    rawText: $("f-raw").value,
    fields: {
      date: $("f-date").value,
      vehicle_id: $("f-vehicle").value,
      customer_id: $("f-customer").value,
      site_id: $("f-site").value,
      work_type: $("f-worktype").value,
      quantity: Number($("f-quantity").value),
      unit: $("f-unit").value,
    },
  };
  if ($("f-attach").checked)
    p.attachments = [{ name: "TEST-fis-ornek.bin", bytes: new TextEncoder().encode("TEST-EK " + p.linkId + "/" + p.entryId) }];
  return p;
}

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
    try { const p = parseOpKey(r.op_key); key = p.linkId + " / " + p.entryId; } catch (_) {}
    title.append(stateChip(r.state), document.createTextNode(" " + key + " — r" + r.rev_no + " v" + r.version));
    const sub = document.createElement("div");
    sub.className = "lab-mono";
    sub.textContent = "fp " + short(r.fingerprint) + " · " + r.created_at;
    item.append(title, sub);
    item.onclick = () => select(r.id);
    list.append(item);
  }
}

const FIELD_LABELS = { date: "Tarih", vehicle_id: "Araç", customer_id: "Müşteri", site_id: "Şantiye", work_type: "İş tipi", quantity: "Miktar", unit: "Birim" };

async function select(id) {
  selectedId = id;
  $("detail-card").hidden = false;
  const r = await store.get("reports", id);

  $("d-head").textContent = "";
  $("d-head").append(stateChip(r.state), kv("op-key", r.op_key), kv("oluşturma", r.created_at));
  if (r.last_tech_error) $("d-head").append(kv("teknik hata notu", r.last_tech_error));

  const src = $("d-source");
  src.textContent = "";
  src.append(kv("ham metin", r.source.rawText), kv("alınma", r.source.received_at), kv("fingerprint", short(r.fingerprint) + " (bütünlük karşılaştırması — değişmezlik/yetki garantisi değildir)"));

  const atts = await store.allByIndex("attachments", "report_id", id);
  const da = $("d-attachments");
  da.textContent = "";
  if (!atts.length) da.append(kv("ek", "yok"));
  atts.forEach((a, i) => da.append(kv("ek " + (i + 1), a.name + " · " + a.size + " bayt · sha256 " + short(a.hash) + " · iş bağlantısı: " + (a.work_id ? "bağlı" : "henüz yok"))));

  const revs = await store.allByIndex("revisions", "report_id", id);
  const latest = revs.sort((a, b) => a.rev_no - b.rev_no).at(-1);
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
    inp.value = latest.fields[k];
    inp.disabled = !editable;
    wrap.append(lab, inp);
    df.append(wrap);
  }
  df.style.display = "flex";
  df.style.flexWrap = "wrap";
  df.style.gap = "8px";

  renderActions(r);
  await renderWork(r);
  await renderHistory(r);
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
    box.append(actionBtn("act-save", "Alan düzeltmeyi kaydet (etiket: ofis1)", "secondary", run(async () => {
      const c = await fresh();
      const revs = await store.allByIndex("revisions", "report_id", r.id);
      const latest = revs.sort((a, b) => a.rev_no - b.rev_no).at(-1);
      const patch = {};
      for (const k of Object.keys(FIELD_LABELS)) {
        const el = $("e-" + k);
        if (!el) continue;
        const v = k === "quantity" ? Number(el.value) : el.value;
        if (v !== latest.fields[k]) patch[k] = v;
      }
      if (!Object.keys(patch).length) return log("Değişiklik yok");
      const out = await svc.editFields(r.id, patch, OFIS, c.version);
      log("Yeni revizyon r" + out.rev_no + (out.state === "kontrolde" && r.state === "onay_bekliyor" ? " — içerik değişti: kontrol geçersizleşti, akış kontrolde'ye döndü" : ""));
    })));

  if (r.state === "kontrolde") {
    box.append(actionBtn("act-complete", "Kontrolü tamamla → onaya gönder (etiket: ofis1)", "", run(async () => {
      const c = await fresh();
      await svc.completeCheck(r.id, OFIS, c.version);
      log("Kontrol tamam → onay_bekliyor");
    })));
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
      const fields = { ...latest.fields, quantity: latest.fields.quantity }; // lab: aynı alanlarla r+1
      await svc.submitRevision(r.id, fields, OFIS, c.version);
      log("Yeni revizyon geldi → kontrolde");
    })));

  if (r.state === "onay_bekliyor") {
    const note = document.createElement("span");
    note.className = "lab-note";
    note.textContent = "Kontrolü yapan: ofis1 — onaylayacak: yon1 (farklı aktör etiketi; aynı etiket onaylayamaz).";
    box.append(actionBtn("act-approve", "Onayla (etiket: yon1)", "", run(async () => {
      const c = await fresh();
      const out = await svc.approve(r.id, YON, c.version, c.rev_no);
      log(out.result === "existing" ? "Zaten onaylanmış — mevcut iş ve onay döndü (ikinci kayıt açılmadı)" : "Onaylandı — iş kaydı atomik oluştu");
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
  if (ap) wv.append(kv("onay", ap.actor_id + " (" + ap.role + ") · r" + ap.rev_no + " · " + ap.at));
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
$("btn-intake").onclick = async () => {
  try {
    const out = await svc.intakePacket(readPacket());
    log("Alım sonucu: " + out.result + " → " + out.report.state + " (" + out.report.op_key + ")");
    await refreshList();
    await select(out.report.id);
  } catch (e) { logErr(e); }
};
$("btn-refresh").onclick = refreshList;
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
window.__lab = { store, svc, config, dbName }; // lab/test erişimi (yetki değil, kolaylık)
await refreshList();
log("Laboratuvar hazır — veritabanı: " + dbName);
