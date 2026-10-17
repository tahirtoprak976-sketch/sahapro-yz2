// "Kendi Depo / Stok Sahası" ekranı (#/kendi-depo): kurulum, stok, araç yük katsayıları, açılış stoku, giriş/çıkış listesi.
import { qs, qsa, esc, appbar, toast, notice, trDate, todayStr, fmtNum } from "./ui.js";
import { YARD_MATS, YARD_SITE_NAME, YARD_CUSTOMER_NAME, yardSite, yardCustomer, yardStock, vehicleFactor, DEFAULT_FACTORS } from "./yard-core.js";

export async function screen(ctx) {
  if (ctx.parts[0] !== "kendi-depo") return false;
  const { root, db } = ctx;
  const d = await db.dumpAll();
  const site = yardSite(d), cust = yardCustomer(d);
  if (!site || !cust) {
    root.innerHTML =
      appbar("Kendi Depo / Stok Sahası", "moloz · çöp · hafriyat stoku") +
      `<div style="height:10px"></div>
      ${notice("info", "Kamyonetiniz müşteriden döküm dahil aldığı malzemeyi kendi deponuza döker; birikince tır/kamyonla döküm sahalarına götürülür. Bunu takip etmek için iki kart açılır: depo için bir döküm yeri ve depodan çıkan seferler için bir iç iş kartı (hakedişe para yazılmaz).")}
      <div class="card"><div class="field"><label>Deponun adı</label><input data-name value="${esc(YARD_SITE_NAME)}"></div>
      <button class="btn primary block" data-setup>Depoyu Kur</button></div>`;
    qs("[data-setup]", root).addEventListener("click", async () => {
      const name = qs("[data-name]", root).value.trim() || YARD_SITE_NAME;
      if (!site) await db.saveNew("dump_sites", { name, own_yard: true, note: "Kendi depo / stok sahası" }, "Kendi depo kuruldu");
      if (!cust) await db.saveNew("customers", { name: YARD_CUSTOMER_NAME, internal: true, note: "Depodan döküm sahalarına giden iç seferler. Hakedişe para yazılmaz." }, "Kendi depo kuruldu");
      toast("Depo kuruldu", "ok");
      ctx.reload();
    });
    return true;
  }
  const settings = (await db.metaGet("yard_settings")) || {};
  const st = yardStock(d, { settings });
  const month = todayStr().slice(0, 7);
  const vName = (v) => v?.plate || v?.name || "—";
  const cName = (id) => (d.customers || []).find((c) => c.id === id)?.name || "—";
  const recent = [...st.ins.map((x) => ({ ...x, dir: "in" })), ...st.outs.map((x) => ({ ...x, dir: "out" }))]
    .sort((a, b) => (b.w.date > a.w.date ? 1 : -1)).slice(0, 30);
  const usedVehicles = [...new Map([...st.ins, ...st.outs].map((x) => [x.vehicle?.id, x.vehicle]).filter(([id]) => id)).values()];
  const alert = Number(settings.alert) || 15;
  const monthIn = st.ins.filter((x) => x.w.date.startsWith(month)).reduce((n, x) => n + x.loads, 0);
  const monthOut = st.outs.filter((x) => x.w.date.startsWith(month)).reduce((n, x) => n + x.loads, 0);
  // Depo kâr–zarar: depoya döküm yapılan müşteri işlerinin tutarı − depodan çıkan seferlerin döküm ücreti ve sefer maliyeti
  const { dumpFee } = await import("./dump-fees.js");
  const { workAmount } = await import("./collect-core.js");
  const { yardPL } = await import("./yard-core.js");
  const pl = (pred) => yardPL(d, st, { settings, pred, dumpFee, workAmount });
  const tripCost = Number(settings.trip_cost) || 0;
  const plM = pl((x) => x.startsWith(month)), plA = pl(() => true);
  const tl = (n) => Math.round(n).toLocaleString("tr-TR") + " ₺";
  const vOf = (w) => vName((d.vehicles || []).find((v) => v.id === w.vehicle_id));
  const line = (href, left, right, warn = "") => `<div class="tap" data-go="${esc(href)}" style="padding:5px 0 5px 10px;border-left:2px solid ${warn ? "#e0a030" : "#e3e8ef"};margin:3px 0"><div class="row between tiny"><span>${left}</span><b style="white-space:nowrap;margin-left:8px">${right}</b></div>${warn ? `<div class="tiny" style="color:#b9770e">⚠ ${warn} — dokunup düzeltin</div>` : ""}</div>`;
  const inLine = (r) => line("#/isler/" + r.w.id, `${trDate(r.w.date)} · ${esc(vOf(r.w))} · ${esc(cName(r.w.customer_id))}${r.fuelL ? ` · ⛽ ${fmtNum(r.fuelL)} L mazot karşılığı` : ""}`, r.amount ? tl(r.amount) : r.fuelL ? "⛽ " + fmtNum(r.fuelL) + " L" : "—",
    r.unpriced ? "fiyat girilmemiş, 0 sayıldı" : "");
  const outLine = (r) => line("#/isler/" + r.w.id, `${trDate(r.w.date)} · ${esc(vOf(r.w))} · ${esc(r.w.material || r.w.work_type || "")} → ${esc(r.site || "?")}${r.empty ? '<br><span class="muted">maliyet yazılmadı (0 sayıldı) — yazmak için dokunun</span>' : ""}`, r.amount ? "− " + tl(r.amount) : "0 ₺");
  const same = plA.ins === plM.ins && plA.outs === plM.outs && Math.round(plA.result) === Math.round(plM.result);
  const plCard = (t, p, detail) => `<div class="card"><div class="strong small">${t}</div>
    <div class="row between small" style="margin-top:6px"><span>📥 Depoya getirilen işlerin değeri (${p.ins})</span><b style="white-space:nowrap;margin-left:8px">${tl(p.income)}${p.fuelL ? `<br><span class="small">+ ⛽ ${fmtNum(p.fuelL)} L</span>` : ""}</b></div>
    ${detail ? p.inRows.map(inLine).join("") : ""}
    <div class="row between small" style="margin-top:6px"><span>📤 Depodan çıkan seferlerin maliyeti (${fmtNum(p.trips)} sefer)</span><b style="white-space:nowrap;margin-left:8px">− ${tl(p.dump)}</b></div>
    ${detail ? p.outRows.map(outLine).join("") : ""}
    ${tripCost ? `<div class="row between small" style="margin-top:6px"><span>Sefer maliyeti (${fmtNum(p.trips)} × ${tl(tripCost)})</span><b>− ${tl(p.extra)}</b></div>` : ""}
    <div class="divider"></div><div class="row between"><span class="strong">Sonuç</span><span class="strong" style="color:${p.result < 0 ? "#d9534f" : "#2e9e6b"}">${tl(p.result)}</span></div>
    ${p.unpriced ? `<div class="tiny" style="color:#b9770e;margin-top:4px">⚠ Sonuç eksik: ${[p.unpriced ? p.unpriced + " giriş fiyatsız" : "", ""].filter(Boolean).join(", ")}. Yukarıdaki işaretli satırlara dokunup düzeltin.</div>` : ""}
    </div>`;
  root.innerHTML =
    appbar("Kendi Depo / Stok Sahası", esc(site.name)) +
    `<div style="height:10px"></div>
    <div class="statgrid" style="grid-template-columns:repeat(3,1fr)">
      <div class="stat ${st.total >= alert ? "warn" : ""}"><div class="v">${fmtNum(st.total)}</div><div class="l">Depoda (kamyonet yükü)</div></div>
      <div class="stat"><div class="v">${fmtNum(Math.round(monthIn * 10) / 10)}</div><div class="l">Bu ay giren</div></div>
      <div class="stat"><div class="v">${fmtNum(Math.round(monthOut * 10) / 10)}</div><div class="l">Bu ay çıkan</div></div>
    </div>
    ${st.total >= alert ? notice("warn", `Depoda yaklaşık ${fmtNum(st.total)} kamyonet yükü birikti — döküm sahasına gönderin.`) : ""}
    <div class="card">${st.rows.length ? st.rows.map((r) => `<div class="row between"><span>${esc(r.mat)}</span><span class="small">${r.opening ? `açılış ${fmtNum(r.opening)} + ` : ""}giren ${fmtNum(r.in)} − çıkan ${fmtNum(r.out)} = <b>${fmtNum(r.stock)}</b></span></div>`).join("") : '<div class="muted small">Henüz giriş/çıkış yok.</div>'}
      <div class="muted tiny" style="margin-top:6px">Tahmini: her aracın bir seferi aşağıdaki katsayı kadar kamyonet yükü sayılır.</div></div>
    ${st.unknownVehicles.length ? notice("warn", "Yük katsayısı bilinmeyen araç: " + st.unknownVehicles.map((v) => esc(vName(v))).join(", ") + " — aşağıdan girin (şimdilik 1 sayıldı).") : ""}
    <div class="section-title">Depo kâr–zarar</div>
    ${plM.ins || plM.outs ? plCard("Bu ay", plM, true) : '<div class="card muted small">Bu ay depoya giriş/çıkış yok.</div>'}${same ? (plA.ins || plA.outs ? '<div class="muted tiny" style="margin:-4px 2px 8px">Tüm kayıtlar bu aya ait (tüm zamanlar = bu ay).</div>' : "") : plCard("Tüm zamanlar", plA, false)}
    <div class="muted tiny" style="margin:-4px 2px 8px">Depodan çıkan seferlerin maliyetini siz yazarsınız: iş kaydında "Döküm maliyeti (₺)". Boş bırakılırsa (ör. stabilize çıkışı) maliyet 0 sayılır. Mazotla ödenen işler (Kılıç gibi) TL sayılmaz; hak edilen litre ayrıca yazılır. Mazot ve şoför için sefer başı bir maliyet girebilirsiniz (aşağıda).</div>
    <div class="section-title">Nasıl kaydedilir?</div>
    <div class="card small">
      • <b>Depoya giriş:</b> kamyonetin müşteri işini normal kaydedin, <b>Döküm Sahası = ${esc(site.name)}</b> seçin. Asistan "depoya döküldü / şantiyeye döktük" ifadesini anlar.<br>
      • <b>Depodan çıkış:</b> iş formunda müşteri yerine en alttaki <b>📦 Kendi depodan çıkış</b> seçeneği, Döküm Sahası = gittiği yer, varsa <b>Döküm maliyeti (₺)</b>. Stabilize gibi maliyetsiz çıkışta boş bırakın. Asistan "depodaki stoktan 1 sefer moloz Bolluca'ya" ifadesini anlar. Bu seferler kimseye borç yazmaz; maliyet olarak sayılır.
    </div>
    <div class="section-title">Araç yük katsayıları (1 sefer = kaç kamyonet yükü)</div>
    <div class="card" data-factors>
      <div class="formgrid2">
        <div class="field"><label>Kamyonet</label><input type="number" step="any" data-def="kamyonet" value="${settings.defaults?.kamyonet ?? DEFAULT_FACTORS.kamyonet}"></div>
        <div class="field"><label>Kamyon</label><input type="number" step="any" data-def="kamyon" value="${settings.defaults?.kamyon ?? DEFAULT_FACTORS.kamyon}"></div>
        <div class="field"><label>Tır</label><input type="number" step="any" data-def="tir" value="${settings.defaults?.tir ?? DEFAULT_FACTORS.tir}"></div>
        <div class="field"><label>Uyarı sınırı (kamyonet yükü)</label><input type="number" step="any" data-alert value="${alert}"></div>
        <div class="field"><label>Depodan çıkış: sefer başı ek maliyet (mazot + şoför, ₺)</label><input type="number" step="any" data-tripcost value="${esc(settings.trip_cost ?? "")}" placeholder="boş = sayılmaz"></div>
      </div>
      ${usedVehicles.map((v) => { const f = vehicleFactor(v, settings); return `<div class="field"><label>${esc(vName(v))} ${f.known ? "" : "⚠"}</label><input type="number" step="any" data-veh="${esc(v.id)}" value="${settings.byVehicle?.[v.id] ?? ""}" placeholder="${f.f}"></div>`; }).join("")}
      <div class="section-title" style="margin-top:6px">Açılış stoku (bugün depoda ne var?)</div>
      <div class="formgrid2">${YARD_MATS.map((m) => `<div class="field"><label>${m}</label><input type="number" step="any" data-open="${m}" value="${settings.opening?.[m] ?? ""}"></div>`).join("")}</div>
      <div class="field"><label>Açılış tarihi (bu tarihten önceki işler sayılmaz)</label><input type="date" data-opendate value="${esc(settings.opening_date || "")}"></div>
      <button class="btn primary block" data-save>Kaydet</button>
    </div>
    <div class="section-title">Son hareketler</div>
    ${recent.map((x) => `<div class="card tap" data-go="#/isler/${esc(x.w.id)}"><div class="row between"><span class="small">${x.dir === "in" ? "📥" : "📤"} ${trDate(x.w.date)} · ${esc(vName(x.vehicle))} · ${esc(x.mat)}</span><span class="small"><b>${x.dir === "in" ? "+" : "−"}${fmtNum(x.loads)}</b></span></div><div class="muted tiny">${x.dir === "in" ? esc(cName(x.w.customer_id)) : "→ " + esc((d.dump_sites || []).find((z) => z.id === x.w.dump_site_id)?.name || x.w.dump_area || "döküm yeri seçilmemiş")} · ${fmtNum(x.w.quantity)} ${esc(x.w.unit || "")}</div></div>`).join("") || '<div class="muted small">Hareket yok.</div>'}`;
  qs("[data-save]", root).addEventListener("click", async () => {
    const s = { ...settings, defaults: {}, byVehicle: {}, opening: {} };
    for (const el of qsa("[data-def]", root)) if (Number(el.value) > 0) s.defaults[el.dataset.def] = Number(el.value);
    for (const el of qsa("[data-veh]", root)) if (Number(el.value) > 0) s.byVehicle[el.dataset.veh] = Number(el.value);
    for (const el of qsa("[data-open]", root)) if (el.value !== "") s.opening[el.dataset.open] = Number(el.value);
    s.opening_date = qs("[data-opendate]", root).value || "";
    s.alert = Number(qs("[data-alert]", root).value) || 15;
    s.trip_cost = Number(qs("[data-tripcost]", root).value) || null;
    await db.metaSet("yard_settings", s);
    toast("Kaydedildi", "ok");
    ctx.reload();
  });
  return true;
}
