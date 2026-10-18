// SAHAPRO YZ2 — sunucu dilimi ekranı (yalnız TEST verisi).
// Üç en-küçük rol paneli: şoför / ofis / yönetici.
// UYARI: Bu ekrandaki rol gösterimi yalnız düzen içindir; yetki sunucuda denetlenir.

import {
  login, logout, getSession, mySession, rpc, apiGet,
  outboxList, outboxDraft, outboxSend, outboxRefresh, outboxRemove,
  QUEUE_LABELS, SERVER_STATE_LABELS,
} from "./sunucu-client.js";

const $ = (s) => document.querySelector(s);
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const VEHICLES = ["TEST-34 ABC 01", "TEST-06 DEF 02"];
const CUSTOMERS = ["TEST-Müşteri Ümraniye", "TEST-Müşteri Ataşehir"];
const WORK_TYPES = ["Hafriyat Nakliye", "Nehir Kum", "Mıcır"];
const STATE_LABELS = {
  gonderildi: "Gönderildi", kontrolde: "Kontrolde", duzeltme_istendi: "Düzeltme istendi",
  onay_bekliyor: "Onay bekliyor", onaylandi: "Onaylandı", reddedildi: "Reddedildi",
};

let ME = null;          // my_session() yanıtı
let SELECTED = null;    // ofis/yönetici detay raporu

function msg(text, kind = "info") {
  const el = $("#msg");
  el.textContent = text;
  el.className = `msg msg-${kind}`;
  el.style.display = "block";
}
function hideMsg() { $("#msg").style.display = "none"; }

function opt(list, cur) {
  return list.map((v) => `<option value="${esc(v)}" ${v === cur ? "selected" : ""}>${esc(v)}</option>`).join("");
}

function fieldsSummary(f) {
  return [f.date, f.vehicle, f.customer, f.work_type, `${f.quantity} ${f.unit}`, f.note]
    .filter(Boolean).map(esc).join(" · ");
}

// ---------- giriş ----------

async function boot() {
  $("#login-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    hideMsg();
    try {
      await login($("#email").value.trim(), $("#password").value);
      await afterLogin();
    } catch (err) { msg(err.message, "err"); }
  });
  document.querySelectorAll("[data-fill]").forEach((b) =>
    b.addEventListener("click", () => {
      $("#email").value = b.dataset.fill;
      $("#password").value = "TEST-parola-2026";
    }));
  $("#logout").addEventListener("click", async () => { await logout(); location.reload(); });

  if (getSession()) {
    try { await afterLogin(); } catch { /* oturum geçersizse giriş kartı kalır */ }
  }
}

async function afterLogin() {
  ME = await mySession();
  $("#login-card").style.display = "none";
  $("#app").style.display = "block";
  $("#who").textContent = `${ME.email}`;
  const roles = (ME.memberships || []).map((m) => m.role);
  $("#who-roles").textContent = roles.length
    ? `üyelik: ${ME.memberships.map((m) => `${m.tenant_slug}/${m.role}`).join(", ")}`
    : "üyelik yok";
  $("#panel-sofor").style.display = roles.includes("sofor") ? "block" : "none";
  $("#panel-ofis").style.display = roles.includes("ofis") ? "block" : "none";
  $("#panel-yonetici").style.display = roles.includes("yonetici") ? "block" : "none";
  if (roles.includes("sofor")) await renderDriver();
  if (roles.includes("ofis")) await renderOffice();
  if (roles.includes("yonetici")) await renderManager();
}

// ---------- şoför ----------

async function renderDriver() {
  await outboxRefresh().catch(() => {});
  const items = await outboxList();
  const box = $("#drv-list");
  box.innerHTML = items.length ? "" : `<p class="dim">Kuyruk boş. Örnek iş oluşturup gönderin.</p>`;
  for (const it of items) {
    const div = document.createElement("div");
    div.className = "row";
    const label = QUEUE_LABELS[it.status] || it.status;
    const sub = it.status === "sunucu_aldi" && it.server_state
      ? ` — ${SERVER_STATE_LABELS[it.server_state] || it.server_state}` : "";
    const reason = it.reason ? ` — sebep: ${it.reason}` : "";
    const err = it.error ? ` — hata: ${it.error}` : "";
    div.innerHTML = `
      <div><b>${esc(fieldsSummary(it.fields))}</b></div>
      <div class="dim">durum: ${esc(label)}${esc(sub)}${esc(reason)}${esc(err)}</div>
      <div class="dim">op: ${esc(it.op_id.slice(0, 8))}… · deneme: ${it.attempts}</div>`;
    const btns = document.createElement("div");
    if (it.status === "bekliyor") {
      const b = document.createElement("button");
      b.className = "lab-btn"; b.textContent = "Gönder";
      b.onclick = async () => { hideMsg(); try { await outboxSend(it.op_id); } catch (e) { msg(e.message, "err"); } await renderDriver(); };
      btns.appendChild(b);
      const d = document.createElement("button");
      d.className = "lab-btn lab-btn-ghost"; d.textContent = "Sil";
      d.onclick = async () => { await outboxRemove(it.op_id); await renderDriver(); };
      btns.appendChild(d);
    }
    if (it.status === "duzeltme_istendi") {
      const b = document.createElement("button");
      b.className = "lab-btn"; b.textContent = "Düzelt ve yeniden gönder";
      b.onclick = async () => {
        hideMsg();
        const q = prompt("Miktar (TEST düzeltme):", it.fields.quantity);
        if (q === null) return;
        const fields = { ...it.fields, quantity: Number(q) || it.fields.quantity };
        try { await outboxSend(it.op_id, fields); msg("Düzeltilmiş bildirim aynı op kimliğiyle gönderildi; sunucu aldı.", "ok"); }
        catch (e) { msg(e.message, "err"); }
        await renderDriver();
      };
      btns.appendChild(b);
    }
    div.appendChild(btns);
    box.appendChild(div);
  }
}

function bindDriverForm() {
  $("#drv-date").value = new Date().toISOString().slice(0, 10);
  $("#drv-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    hideMsg();
    const fields = {
      date: $("#drv-date").value,
      vehicle: $("#drv-vehicle").value,
      customer: $("#drv-customer").value,
      work_type: $("#drv-worktype").value,
      quantity: Number($("#drv-quantity").value),
      unit: $("#drv-unit").value,
      note: $("#drv-note").value.trim(),
    };
    if (!fields.quantity || fields.quantity <= 0) { msg("Miktar girin.", "err"); return; }
    const item = await outboxDraft(fields);
    try {
      await outboxSend(item.op_id);
      msg("Bildirim sunucuya ulaştı (op: " + item.op_id.slice(0, 8) + "…). Durum listede izlenebilir.", "ok");
    } catch (err2) {
      msg(`Kayıt telefonda bekliyor; yeniden denenebilir. (${err2.message})`, "err");
    }
    await renderDriver();
  });
  $("#drv-refresh").addEventListener("click", async () => { hideMsg(); await renderDriver(); });
}

// ---------- ofis ----------

async function renderOffice() {
  const [gonderildi, kontrolde, duzeltme] = await Promise.all([
    apiGet("/reports?state=eq.gonderildi&order=created_at&select=id,state,version,rev_no,fields,created_at"),
    apiGet("/reports?state=eq.kontrolde&order=created_at&select=id,state,version,rev_no,fields,created_at"),
    apiGet("/reports?state=eq.duzeltme_istendi&order=created_at&select=id,state,version,rev_no,fields,created_at"),
  ]);
  const box = $("#ofis-list");
  box.innerHTML = "";
  const group = (title, rows, cls) => {
    if (!rows.length) return;
    const h = document.createElement("h4"); h.textContent = title; box.appendChild(h);
    for (const r of rows) {
      const div = document.createElement("div");
      div.className = "row";
      div.innerHTML = `<div><b>${esc(fieldsSummary(r.fields))}</b></div>
        <div class="dim">${esc(STATE_LABELS[r.state])} · v${r.version} · rev ${r.rev_no}</div>`;
      const b = document.createElement("button");
      b.className = "lab-btn"; b.textContent = "Aç";
      b.onclick = () => openOfficeDetail(r.id);
      div.appendChild(b);
      box.appendChild(div);
    }
  };
  group("Yeni bildirimler", gonderildi);
  group("Kontrolde", kontrolde);
  group("Düzeltme istenenler", duzeltme);
  if (!gonderildi.length && !kontrolde.length && !duzeltme.length)
    box.innerHTML = `<p class="dim">Bekleyen bildirim yok.</p>`;
}

async function openOfficeDetail(id) {
  hideMsg();
  const r = (await apiGet(`/reports?id=eq.${id}&select=*`))[0];
  SELECTED = r;
  const d = $("#ofis-detail");
  d.style.display = "block";
  const revs = await apiGet(`/revisions?report_id=eq.${id}&order=rev_no&select=rev_no,fields,changes,reason,edited_at`);
  d.innerHTML = `
    <h4>Bildirim detayı</h4>
    <p><b>${esc(fieldsSummary(r.fields))}</b></p>
    <p class="dim">durum: ${esc(STATE_LABELS[r.state])} · sürüm v${r.version} · rev ${r.rev_no}
    · kaynak: ${esc(r.source?.channel || "?")}</p>
    <h5>Revizyonlar</h5>
    ${revs.map((v) => `<p class="dim">rev ${v.rev_no}: ${esc(fieldsSummary(v.fields))}
      ${v.reason ? ` — ${esc(v.reason)}` : ""}
      ${v.changes && Object.keys(v.changes).length ? ` — değişen: ${esc(Object.keys(v.changes).join(", "))}` : ""}</p>`).join("")}
  `;
  const act = document.createElement("div");
  act.className = "btn-row";
  if (r.state === "gonderildi") {
    const b = document.createElement("button");
    b.className = "lab-btn"; b.textContent = `Kontrole al (v${r.version})`;
    b.onclick = async () => {
      try { await rpc("start_check", { p_report_id: r.id, p_expected_version: r.version }); msg("Kontrole alındı.", "ok"); }
      catch (e) { msg(e.message, "err"); }
      await renderOffice(); $("#ofis-detail").style.display = "none";
    };
    act.appendChild(b);
  }
  if (r.state === "kontrolde") {
    const edit = document.createElement("div");
    edit.innerHTML = `
      <div class="lab-field"><label>Miktar (düzelt)</label><input id="of-edit-q" type="number" value="${esc(r.fields.quantity)}"></div>
      <div class="lab-field"><label>Not (düzelt)</label><input id="of-edit-n" value="${esc(r.fields.note || "")}"></div>
      <div class="lab-field"><label>Düzenleme sebebi (zorunlu)</label><input id="of-edit-reason" placeholder="TEST sebep"></div>`;
    act.appendChild(edit);
    const be = document.createElement("button");
    be.className = "lab-btn"; be.textContent = "Düzenlemeyi kaydet";
    be.onclick = async () => {
      const reason = $("#of-edit-reason").value.trim();
      const fields = { ...r.fields, quantity: Number($("#of-edit-q").value) || r.fields.quantity, note: $("#of-edit-n").value.trim() };
      try { await rpc("edit_report", { p_report_id: r.id, p_fields: fields, p_reason: reason, p_expected_version: r.version }); }
      catch (e) { msg(e.message, "err"); return; }
      await openOfficeDetail(r.id); await renderOffice();
      msg("Düzenleme kaydedildi.", "ok");
    };
    act.appendChild(be);
    const bc = document.createElement("button");
    bc.className = "lab-btn"; bc.textContent = "Kontrolü tamamla";
    bc.onclick = async () => {
      try { await rpc("complete_check", { p_report_id: r.id, p_expected_version: r.version }); msg("Kontrol tamamlandı; yönetici onayına gönderildi.", "ok"); }
      catch (e) { msg(e.message, "err"); }
      await renderOffice(); $("#ofis-detail").style.display = "none";
    };
    act.appendChild(bc);
    const bf = document.createElement("button");
    bf.className = "lab-btn lab-btn-ghost"; bf.textContent = "Düzeltme iste";
    bf.onclick = async () => {
      const reason = prompt("Düzeltme sebebi (TEST):");
      if (!reason) return;
      try { await rpc("request_fix", { p_report_id: r.id, p_reason: reason, p_expected_version: r.version }); msg("Düzeltme istendi.", "ok"); }
      catch (e) { msg(e.message, "err"); }
      await renderOffice(); $("#ofis-detail").style.display = "none";
    };
    act.appendChild(bf);
  }
  d.appendChild(act);
}

function bindOffice() {
  $("#ofis-refresh").addEventListener("click", async () => { hideMsg(); await renderOffice(); });
}

// ---------- yönetici ----------

async function renderManager() {
  const rows = await apiGet(
    "/reports?state=eq.onay_bekliyor&order=created_at&select=id,state,version,rev_no,fields,checked_by,checked_rev_no,checked_at,created_at");
  const box = $("#yon-list");
  box.innerHTML = rows.length ? "" : `<p class="dim">Onay bekleyen bildirim yok.</p>`;
  for (const r of rows) {
    const div = document.createElement("div");
    div.className = "row";
    div.innerHTML = `<div><b>${esc(fieldsSummary(r.fields))}</b></div>
      <div class="dim">v${r.version} · rev ${r.rev_no} · kontrol edilen rev: ${r.checked_rev_no}</div>`;
    const b = document.createElement("button");
    b.className = "lab-btn"; b.textContent = "İncele";
    b.onclick = () => openManagerDetail(r.id);
    div.appendChild(b);
    box.appendChild(div);
  }
}

async function openManagerDetail(id) {
  hideMsg();
  const r = (await apiGet(`/reports?id=eq.${id}&select=*`))[0];
  const revs = await apiGet(`/revisions?report_id=eq.${id}&order=rev_no&select=rev_no,fields,changes,reason,edited_at`);
  const d = $("#yon-detail");
  d.style.display = "block";
  d.innerHTML = `
    <h4>Onay bekleyen bildirim</h4>
    <p><b>${esc(fieldsSummary(r.fields))}</b></p>
    <p class="dim">sürüm v${r.version} · rev ${r.rev_no} · kontrol edilen rev: ${r.checked_rev_no}
    · kontrol zamanı: ${esc(r.checked_at || "?")}</p>
    <h5>Revizyonlar</h5>
    ${revs.map((v) => `<p class="dim">rev ${v.rev_no}: ${esc(fieldsSummary(v.fields))}
      ${v.reason ? ` — ${esc(v.reason)}` : ""}
      ${v.changes && Object.keys(v.changes).length ? ` — değişen: ${esc(Object.keys(v.changes).join(", "))}` : ""}</p>`).join("")}
  `;
  const act = document.createElement("div");
  act.className = "btn-row";
  const ba = document.createElement("button");
  ba.className = "lab-btn"; ba.textContent = `Onayla (v${r.version}, rev ${r.rev_no})`;
  ba.onclick = async () => {
    try {
      const out = await rpc("approve_report", { p_report_id: r.id, p_expected_version: r.version, p_rev_no: r.rev_no });
      msg(out.status === "existing"
        ? `Zaten onaylanmış — aynı iş kaydı: ${out.work_id.slice(0, 8)}… (ikinci iş AÇILMADI)`
        : `Onaylandı; iş kaydı: ${out.work_id.slice(0, 8)}…`, "ok");
    } catch (e) { msg(e.message, "err"); }
    await renderManager(); d.style.display = "none";
  };
  act.appendChild(ba);
  const br = document.createElement("button");
  br.className = "lab-btn lab-btn-ghost"; br.textContent = "Reddet";
  br.onclick = async () => {
    const reason = prompt("Ret sebebi (TEST):");
    if (!reason) return;
    try { await rpc("reject_report", { p_report_id: r.id, p_reason: reason, p_expected_version: r.version }); msg("Reddedildi.", "ok"); }
    catch (e) { msg(e.message, "err"); }
    await renderManager(); d.style.display = "none";
  };
  act.appendChild(br);
  d.appendChild(act);
}

function bindManager() {
  $("#yon-refresh").addEventListener("click", async () => { hideMsg(); await renderManager(); });
}

// ---------- init ----------

document.addEventListener("DOMContentLoaded", () => {
  $("#drv-vehicle").innerHTML = opt(VEHICLES);
  $("#drv-customer").innerHTML = opt(CUSTOMERS);
  $("#drv-worktype").innerHTML = opt(WORK_TYPES);
  bindDriverForm(); bindOffice(); bindManager();
  boot();
});
