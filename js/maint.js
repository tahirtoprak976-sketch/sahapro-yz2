// Bakım Takvimi (#/bakim-takvimi, #/bakim-takvimi/{araç}): hangi aracın hangi bakımı ne zaman geliyor.
// Kurallar araç kartında (service_rules). "✓ Yapıldı" bakım kaydı açar (kurala bağlı, km/saat ile) → sayaç sıfırlanır.
import { qs, qsa, esc, appbar, toast, notice, fmtNum, todayStr, trDate, confirmDialog, promptDialog } from "./ui.js";
import { isActive } from "./core.js";

const COLOR = { late: "#d9534f", soon: "#e0a030", ok: "#2e9e6b", "?": "#9aa4b2" };
const ICON = { late: "🔴", soon: "🟠", ok: "🟢", "?": "⚪" };

export async function screen(ctx) {
  if (ctx.parts[0] !== "bakim-takvimi") return false;
  const { root, db } = ctx;
  const core = await import("./maint-core.js");
  const today = todayStr();
  const d = await db.dumpAll();
  const vehicles = (d.vehicles || []).filter(isActive);
  const vid = ctx.parts[1];

  if (!vid) {
    const board = core.maintenanceBoard(d, { today });
    const without = vehicles.filter((v) => !(v.service_rules || []).length);
    const cnt = { late: 0, soon: 0 };
    for (const r of board) if (r.state in cnt) cnt[r.state]++;
    root.innerHTML = appbar("Bakım Takvimi", `${cnt.late} gecikmiş · ${cnt.soon} yaklaşan`) +
      `<div style="height:10px"></div>
      ${board.length ? board.map((r) => `<div class="card tap" data-go="#/bakim-takvimi/${esc(r.v.id)}" style="border-left:4px solid ${COLOR[r.state]}">
        <div class="row between"><b>${ICON[r.state]} ${esc(r.v.name)}</b><span class="small muted">${esc(r.rule.title)}</span></div>
        <div class="small" style="margin-top:3px;color:${r.state === "late" ? COLOR.late : "inherit"}">${esc(r.text)}</div>
        ${r.last?.date ? `<div class="tiny muted">son: ${trDate(r.last.date)}${r.last.km ? ` · ${fmtNum(r.last.km)} km` : ""}${r.last.hours ? ` · ${fmtNum(r.last.hours)} saat` : ""}</div>` : ""}
      </div>`).join("") : notice("info", "Henüz bakım kuralı yok. Aşağıdan bir araç seçip kural ekleyin (ör. motor yağı 500 saatte bir).")}
      ${without.length ? `<div class="section-title">Kuralı olmayan araçlar</div><button class="btn block" data-bulk style="margin-bottom:8px">⚡ Önerilen motor yağı + filtre kuralını ${without.length} araca ekle</button>${without.map((v) => `<div class="card tap" data-go="#/bakim-takvimi/${esc(v.id)}"><div class="row between"><span>${esc(v.name)} <span class="muted small">${esc(v.type || "")}</span></span><span class="muted small">kural ekle ›</span></div></div>`).join("")}` : ""}
      <div class="muted tiny" style="margin:6px 2px">Km / saat: araç kartı, yakıt kayıtları (km, makine saati) ve sayaç girişlerinden; makinede son okumadan sonraki saatlik işler eklenir. Son bakım: "✓ Yapıldı" ya da başlığına uyan bakım kaydından.</div>`;
    qs("[data-bulk]", root)?.addEventListener("click", async () => {
      if (!(await confirmDialog("Kurallar eklensin mi?", `${without.length} araca türüne göre "Motor yağı + filtre" kuralı eklenir (tır/kamyon/binek 20.000 km, iş makinesi 500 saat; römorka fren kontrolü). Sonra her araçta son bakımı girin; rakamları değiştirebilirsiniz.`, "Ekle"))) return;
      for (const v of without) await db.saveExisting("vehicles", v, { service_rules: [core.newRule(core.templatesFor(v)[0])] }, "Bakım kuralı (toplu)");
      toast(without.length + " araca kural eklendi", "ok"); ctx.reload();
    });
    return true;
  }

  const v = vehicles.find((x) => x.id === vid);
  if (!v) { root.innerHTML = appbar("Bakım Takvimi") + notice("warn", "Araç bulunamadı"); return true; }
  const rules = v.service_rules || [];
  const st = rules.map((r) => core.ruleStatus(d, v, r, { today }));
  const road = core.isRoadVehicle(v);
  const km = core.meterNow(d, v, "km", { today }), hr = core.meterNow(d, v, "hours", { today });
  const meterLine = (m, unit) => m ? `<b>${fmtNum(m.value)} ${unit}</b> <span class="muted tiny">(${m.src} ${trDate(m.readDate)}${m.est ? ` + ${fmtNum(m.est)} saat iş, tahmini` : ""}${m.perDay ? ` · günde ~${fmtNum(Math.round(m.perDay))} ${unit}` : ""})</span>` : '<span class="muted">bilinmiyor</span>';
  const tmpls = core.templatesFor(v).filter((t) => !rules.some((r) => r.title === t.title));
  root.innerHTML = appbar(v.name, "Bakım takvimi") +
    `<div style="height:10px"></div>
    <div class="card">
      <div class="small">${road ? "Kilometre" : "Çalışma saati"}: ${road ? meterLine(km, "km") : meterLine(hr, "saat")}</div>
      ${!road && km ? `<div class="small">Kilometre: ${meterLine(km, "km")}</div>` : ""}
      <div class="row" style="gap:6px;margin-top:8px"><input type="number" inputmode="decimal" data-meter placeholder="${road ? "Güncel km" : "Güncel saat"}" style="flex:1;min-height:42px;background:var(--bg2);border:1.5px solid var(--border);border-radius:10px;color:var(--text);padding:8px"><button class="btn" data-meter-save>Sayacı kaydet</button></div>
    </div>
    ${st.map((s, i) => `<div class="card" style="border-left:4px solid ${COLOR[s.state]}">
      <div class="row between"><b>${ICON[s.state]} ${esc(s.rule.title)}</b><span class="muted small">${[s.rule.every_km ? fmtNum(s.rule.every_km) + " km'de" : "", s.rule.every_hours ? fmtNum(s.rule.every_hours) + " saatte" : "", s.rule.every_days ? s.rule.every_days + " günde" : ""].filter(Boolean).join(" ya da ")} bir</span></div>
      <div class="small" style="margin-top:3px;color:${s.state === "late" ? COLOR.late : "inherit"}">${esc(s.text)}</div>
      <div class="tiny muted">${s.last ? `son: ${s.last.date ? trDate(s.last.date) : "?"}${s.last.km ? ` · ${fmtNum(s.last.km)} km` : ""}${s.last.hours ? ` · ${fmtNum(s.last.hours)} saat` : ""} (${s.last.src})` : "son bakım bilinmiyor"}</div>
      <div class="row" style="gap:6px;margin-top:8px;flex-wrap:wrap"><button class="btn sm primary grow" data-done="${i}">✓ Yapıldı</button><button class="btn sm grow" data-last="${i}">Son bakımı gir</button><button class="btn sm ghost" data-del="${i}">Sil</button></div>
    </div>`).join("")}
    <div class="card"><div class="strong small">+ Kural ekle</div>
      ${tmpls.length ? `<div class="muted tiny" style="margin:4px 0">Öneriler (üretici kitapçığına göre değiştirebilirsiniz):</div><div class="row" style="gap:6px;flex-wrap:wrap">${tmpls.map((t, i) => `<button class="btn sm" data-tpl="${i}">${esc(t.title)} · ${t.every_km ? fmtNum(t.every_km) + " km" : t.every_hours ? fmtNum(t.every_hours) + " saat" : t.every_days + " gün"}</button>`).join("")}</div>` : ""}
      <div class="formgrid2" style="margin-top:8px">
        <div class="field"><label>Bakım adı</label><input data-n="title" placeholder="ör. Gresleme"></div>
        <div class="field"><label>Her … km</label><input type="number" data-n="every_km"></div>
        <div class="field"><label>Her … saat</label><input type="number" data-n="every_hours"></div>
        <div class="field"><label>Her … gün</label><input type="number" data-n="every_days"></div>
      </div>
      <button class="btn sm primary" data-add>Ekle</button>
    </div>`;

  const saveRules = async (list, why) => { await db.saveExisting("vehicles", v, { service_rules: list }, why); ctx.reload(); };
  const curKm = km?.value ?? null, curH = hr?.value ?? null;
  qs("[data-meter-save]", root).addEventListener("click", async () => {
    const val = Number(qs("[data-meter]", root).value);
    if (!(val > 0)) return toast("Sayaç değeri yazın", "err");
    const cur = road ? curKm : curH;
    if (cur && val < cur - (road ? 0 : 0.5) && !(await confirmDialog("Sayaç geriye gidiyor", `Kayıtlı ${fmtNum(cur)}, yazılan ${fmtNum(val)}. Sayaç değişti/sıfırlandıysa devam edin.`, "Kaydet"))) return;
    await db.saveExisting("vehicles", v, { [road ? "km" : "machine_hours"]: val, meter_date: today }, "Sayaç girişi");
    toast("Kaydedildi", "ok"); ctx.reload();
  });
  for (const b of qsa("[data-tpl]", root)) b.addEventListener("click", () => saveRules([...rules, core.newRule(tmpls[Number(b.dataset.tpl)])], "Bakım kuralı"));
  qs("[data-add]", root).addEventListener("click", () => {
    const f = Object.fromEntries(qsa("[data-n]", root).map((el) => [el.dataset.n, el.value]));
    if (!f.title.trim()) return toast("Bakım adı yazın", "err");
    if (!(Number(f.every_km) || Number(f.every_hours) || Number(f.every_days))) return toast("Km, saat ya da gün aralığı yazın", "err");
    saveRules([...rules, core.newRule({ ...f, title: f.title.trim() })], "Bakım kuralı");
  });
  for (const b of qsa("[data-del]", root)) b.addEventListener("click", async () => {
    const r = rules[Number(b.dataset.del)];
    if (await confirmDialog("Kural silinsin mi?", r.title, "Sil", true)) saveRules(rules.filter((x) => x.id !== r.id), "Bakım kuralı silindi");
  });
  for (const b of qsa("[data-last]", root)) b.addEventListener("click", async () => {
    const r = rules[Number(b.dataset.last)];
    const date = await promptDialog("Son bakım tarihi", "GG.AA.YYYY (boş = bilmiyorum)", "");
    if (date == null) return;
    const m = String(date).trim().match(/^(\d{1,2})[./](\d{1,2})[./](\d{4})$/);
    const iso = m ? `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}` : null;
    const valS = await promptDialog(`Son bakımda ${r.every_km ? "km" : "saat"}`, r.every_km ? "km" : "saat", "");
    if (valS == null) return;
    const val = Number(String(valS).replace(/\./g, "").replace(",", "."));
    if (!iso && !(val > 0)) return toast("Tarih ya da sayaç girin", "err");
    const last = { date: iso, ...(r.every_km ? { km: val > 0 ? val : null } : { hours: val > 0 ? val : null }) };
    saveRules(rules.map((x) => (x.id === r.id ? { ...x, last } : x)), "Son bakım girildi");
  });
  for (const b of qsa("[data-done]", root)) b.addEventListener("click", async () => {
    const r = rules[Number(b.dataset.done)];
    const costS = await promptDialog(`${r.title} — yapıldı`, "Tutar ₺ (boş = bilinmiyor)", "");
    if (costS == null) return;
    const cost = Number(String(costS).replace(/\./g, "").replace(",", ".")) || null;
    await db.saveNew("maintenance_records", {
      date: today, vehicle_id: v.id, personnel_id: null, maint_type: "Bakım", status: "Tamamlandı", description: r.title, cost, kdv_rate: null, service_company: "",
      km_hours: [curKm ? curKm + " km" : "", curH ? curH + " saat" : ""].filter(Boolean).join(" · "), km: curKm, machine_hours: curH, service_rule_id: r.id,
    }, "Bakım takvimi: yapıldı");
    toast("Bakım kaydedildi; sayaç sıfırlandı", "ok"); ctx.reload();
  });
  return true;
}
