// WhatsApp Grubu — toplu işleme (#/whatsapp-toplu). Grubun dışa aktarımı (.txt / medyalı .zip) seçilir;
// daha önce işlenen mesajlar atlanır, kalanlar gün gün Akıllı Asistan'a (fotoğraflarıyla) verilir. Kayıt yine kartlarla onaylanır.
import { qs, qsa, esc, appbar, toast, notice, todayStr, trDate, confirmDialog } from "./ui.js";
import { addDays } from "./core.js";

const CACHE = "yz2-wa";
const DONE = "wa_bulk_done";
const DAY = ["Paz", "Pzt", "Sal", "Çar", "Per", "Cum", "Cmt"];
const dow = (d) => DAY[new Date(d + "T12:00:00").getDay()];

// Kaynak Cache Storage'da tutulur (asistandan dönünce yeniden seçmek gerekmez). Android paylaşımı: .txt + ayrı medya dosyaları.
async function saveSource(file) {
  if (!("caches" in self)) return;
  await caches.delete(CACHE);
  const c = await caches.open(CACHE);
  await c.put("./__wa/source", new Response(file, { headers: { "x-name": encodeURIComponent(file.name || "sohbet.txt"), "content-type": file.type || "application/octet-stream" } }));
}
const fileOf = async (r, fallback) => { const b = await r.blob(); return new File([b], decodeURIComponent(r.headers.get("x-name") || fallback), { type: b.type || r.headers.get("content-type") || "" }); };
async function loadSource() {
  if (!("caches" in self)) return null;
  const c = await caches.open(CACHE);
  const r = await c.match("./__wa/source");
  if (!r) return null;
  const media = [];
  for (let i = 0; i < 2000; i++) { const m = await c.match(`./__wa/media-${i}`); if (!m) break; media.push(await fileOf(m, "medya")); }
  return { file: await fileOf(r, "sohbet.txt"), media };
}
async function openSource(file, media = []) {
  const { parseChat } = await import("./wa-bulk-core.js");
  const isZip = /\.zip$/i.test(file.name) || /zip/.test(file.type);
  if (isZip) {
    const { openChatZip } = await import("./unzip.js");
    const z = await openChatZip(await file.arrayBuffer());
    return { name: file.name, zip: z, msgs: parseChat(z.text), mediaNames: new Set(z.names) };
  }
  const byName = new Map(media.map((f) => [f.name, f]));
  const zip = media.length ? { file: async (n) => byName.get(String(n).split("/").pop()) || null, names: [...byName.keys()] } : null;
  return { name: file.name, zip, msgs: parseChat(await file.text()), mediaNames: new Set(byName.keys()) };
}

export async function screen(ctx) {
  if (ctx.parts[0] !== "whatsapp-toplu") return false;
  const { root, db } = ctx;
  const core = await import("./wa-bulk-core.js");
  const today = todayStr();
  let done = (await db.metaGet(DONE)) || {};
  const firstTime = !Object.keys(done).length;
  let src = null;
  let from = (await db.metaGet("wa_bulk_from")) ?? (firstTime ? addDays(today, -2) : "");

  root.innerHTML =
    appbar("WhatsApp Grubu", "toplu işleme · yalnız yeni mesajlar") +
    `<div style="height:10px"></div>
    <details class="card" ${firstTime ? "open" : ""}><summary class="small strong">Nasıl yapılır?</summary>
      <div class="small" style="margin-top:6px;line-height:1.5">
      1. WhatsApp'ta grubu açın → sağ üst <b>⋮</b> → <b>Diğer</b> → <b>Sohbeti dışa aktar</b>.<br>
      2. Fiş fotoğrafları da gelsin diye <b>Medya dahil et</b>'i seçin (daha hızlı için medyasız da olur).<br>
      3. <b>Dosyalara kaydet</b> (ya da Drive) → buradan dosyayı seçin.<br>
      4. Gün gün <b>🤖 Asistanda işle</b>: asistan kartları çıkarır, siz kontrol edip kaydedersiniz.<br>
      Her akşam aynı grubu yeniden dışa aktarmanız yeterli: <b>daha önce işlenen mesajlar kendiliğinden atlanır</b>; "tamam", "👍" gibi sohbetler gönderilmez.</div></details>
    <div class="card">
      <div class="field"><label>Sohbet dosyası (.zip ya da .txt)</label><input type="file" accept=".zip,.txt,application/zip,text/plain" data-file></div>
      <div class="field"><label>Bu tarihten itibaren (boş = hepsi)</label><input type="date" data-from value="${esc(from || "")}"></div>
      <div data-src class="muted small"></div>
    </div>
    <div data-sum></div>
    <div data-list></div>`;

  const render = () => {
    const sum = qs("[data-sum]", root), list = qs("[data-list]", root);
    if (!src) { sum.innerHTML = ""; list.innerHTML = ""; return; }
    const { plan, skippedDone, skippedChatter } = core.planDays(src.msgs, { done, from });
    const omitted = src.msgs.filter((m) => m.omitted && !done[m.key]).length;
    const missing = plan.reduce((n, p) => n + p.msgs.reduce((k, m) => k + m.files.filter((f) => src.zip && !src.mediaNames.has(f)).length, 0), 0);
    const nMsg = plan.reduce((n, p) => n + p.msgs.length, 0), nPh = plan.reduce((n, p) => n + p.photos, 0);
    sum.innerHTML = `<div class="card"><div class="row between"><b>${nMsg} yeni mesaj · ${new Set(plan.map((p) => p.date)).size} gün${nPh ? ` · ${nPh} fotoğraf/ses` : ""}</b></div>
      <div class="muted tiny" style="margin-top:4px">${skippedDone ? `${skippedDone} mesaj daha önce işlendi, atlandı · ` : ""}${skippedChatter ? `${skippedChatter} kısa sohbet ("tamam", "👍") atlandı` : ""}</div>
      ${omitted && !src.zip ? `<div class="tiny" style="color:#b9770e;margin-top:4px">⚠ ${omitted} mesajın fotoğrafı dosyada yok (medyasız dışa aktarım). Fişler gerekiyorsa "Medya dahil et" ile tekrar dışa aktarın.</div>` : ""}
      ${missing ? `<div class="tiny" style="color:#b9770e;margin-top:4px">⚠ ${missing} fotoğraf ZIP içinde bulunamadı.</div>` : ""}
      ${plan.length ? `<button class="btn sm ghost" style="margin-top:6px" data-alldone>Hepsini işlendi say (göndermeden)</button>` : ""}</div>`;
    list.innerHTML = plan.length ? plan.map((p, i) => `
      <div class="card" data-i="${i}">
        <div class="row between"><b>${trDate(p.date)} ${dow(p.date)}${p.parts > 1 ? ` · parça ${p.part}/${p.parts}` : ""}</b><span class="muted small">${p.msgs.length} mesaj${p.photos ? ` · 📷 ${p.photos}` : ""}</span></div>
        <div class="muted tiny">${esc(p.senders.join(", "))}</div>
        <div class="tiny" style="white-space:pre-wrap;margin:6px 0;max-height:7.5em;overflow:hidden;background:var(--bg2);border-radius:8px;padding:6px 8px">${esc(p.msgs.slice(0, 6).map((m) => `${m.time} ${m.sender}: ${m.text || (m.files.length ? "📷" : "")}`).join("\n"))}${p.msgs.length > 6 ? "\n…" : ""}</div>
        <div class="row" style="gap:6px"><button class="btn primary sm grow" data-go-ai="${i}">🤖 Asistanda işle</button><button class="btn sm" data-skip="${i}">✓ İşlendi say</button></div>
      </div>`).join("") : notice("ok", "Yeni mesaj yok — hepsi işlenmiş. Yarın grubu yeniden dışa aktarın.");
    qs("[data-alldone]", root)?.addEventListener("click", async () => {
      if (!(await confirmDialog("Hepsi işlendi sayılsın mı?", `${nMsg} mesaj asistana gönderilmeden "işlendi" işaretlenecek. Bir daha listede çıkmaz.`, "İşlendi say"))) return;
      done = core.markDone(done, plan.flatMap((p) => p.msgs), today);
      await db.metaSet(DONE, done);
      render();
    });
    for (const b of qsa("[data-skip]", list)) b.addEventListener("click", async () => {
      done = core.markDone(done, plan[Number(b.dataset.skip)].msgs, today);
      await db.metaSet(DONE, done);
      toast("İşlendi sayıldı", "ok");
      render();
    });
    for (const b of qsa("[data-go-ai]", list)) b.addEventListener("click", async () => {
      const p = plan[Number(b.dataset.goAi)];
      b.disabled = true;
      try {
        if (!("caches" in self)) throw new Error("Bu tarayıcıda aktarım yapılamıyor");
        await caches.delete("yz2-share");
        const share = await caches.open("yz2-share");
        await share.put("./__share/text", new Response(p.text));
        let i = 0;
        if (src.zip) for (const m of p.msgs) for (const f of m.files) {
          if (i >= 10) break;
          const file = await src.zip.file(f);
          if (file && /^(image|audio)\/|pdf/.test(file.type)) await share.put(`./__share/file-${i++}`, new Response(file, { headers: { "content-type": file.type, "x-name": encodeURIComponent(file.name) } }));
        }
        await db.metaSet("wa_bulk_pending", { id: p.id, date: p.date, keys: p.msgs.map((m) => m.key), at: Date.now() });
        await db.metaSet("assistant_draft", "");
        location.hash = `#/akilli-asistan?shared=1&wa=${encodeURIComponent(trDate(p.date) + (p.parts > 1 ? ` (${p.part}/${p.parts})` : ""))}`;
      } catch (e) {
        b.disabled = false;
        toast(e.message || String(e), "err");
      }
    });
  };

  const load = async (file, fresh, media = []) => {
    const info = qs("[data-src]", root);
    info.textContent = "Okunuyor…";
    try {
      src = await openSource(file, media);
      if (fresh) await saveSource(file);
      info.innerHTML = `📄 ${esc(src.name)} · ${src.msgs.length} mesaj${src.zip ? ` · ${src.mediaNames.size} medya` : " · medyasız"}${src.msgs.length ? ` · ${trDate(src.msgs[0].date)} – ${trDate(src.msgs.at(-1).date)}` : ""}`;
      if (!src.msgs.length) info.innerHTML += '<br><span style="color:#d9534f">Bu dosyada WhatsApp mesajı bulunamadı.</span>';
    } catch (e) {
      src = null;
      info.innerHTML = `<span style="color:#d9534f">${esc(e.message || e)}</span>`;
    }
    render();
  };
  qs("[data-file]", root).addEventListener("change", (e) => { const f = e.target.files[0]; if (f) load(f, true); });
  qs("[data-from]", root).addEventListener("change", async (e) => { from = e.target.value || ""; await db.metaSet("wa_bulk_from", from); render(); });
  // Son seçilen dosya hatırlanır (asistandan dönünce yeniden seçmek gerekmez)
  const last = await loadSource().catch(() => null);
  if (last) await load(last.file, false, last.media);
  if (ctx.query?.shared && last) toast("WhatsApp sohbeti alındı", "ok");
  // Asistandan "sonraki parça": sıradaki gün doğrudan açılır
  if (ctx.query?.next && src) {
    const nxt = qs("[data-go-ai]", root);
    if (nxt) nxt.click(); else toast("Tüm günler işlendi 👍", "ok");
  }
  return true;
}
