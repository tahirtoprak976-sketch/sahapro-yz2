// Şoför uygulaması girişi (sofor.html). Yönetici uygulamasından AYRI: menü, asistan, kasa, cari… hiç yüklenmez.
// Bağlantı kodu adreste durur (sofor.html?k=…): iPhone'da ana ekrandan açılan uygulama Safari'den ayrı hafızayla başlasa da
// kendini bu koddan kurar. Daha yeni bir bağlantı kurulduysa eski kod onu ezmez.
import * as db from "./db.js";
import { qs, toast, esc } from "./ui.js";
import * as driver from "./driver.js";

const codeFrom = (s) => (/(?:^|[#&?/])k=([A-Za-z0-9_-]{20,})/.exec(String(s || "")) || /^\s*([A-Za-z0-9_-]{60,})\s*$/.exec(String(s || "")) || [])[1] || null;

async function pasteScreen(root) {
  root.innerHTML = `<div style="padding:28px 18px;max-width:520px;margin:0 auto">
    <h2 style="margin:0 0 6px">🚚 SAHAPRO Şoför</h2>
    <div class="small muted" style="margin-bottom:14px">Patronun WhatsApp'tan gönderdiği mesajı (bağlantıyı) kopyalayıp buraya yapıştırın.</div>
    <textarea data-link rows="4" placeholder="Bağlantıyı buraya yapıştırın" style="width:100%"></textarea>
    <button class="btn primary block" data-ok style="margin-top:10px;min-height:52px">Şoför ekranını aç</button>
  </div>`;
  qs("[data-ok]", root).addEventListener("click", () => {
    const k = codeFrom(qs("[data-link]", root).value);
    if (!k) return toast("Bağlantı bulunamadı; mesajın tamamını yapıştırın", "err");
    location.replace(location.pathname + "?k=" + k);
  });
}

async function render() {
  const root = qs("#screen");
  const k = codeFrom(location.search) || codeFrom(location.hash);
  let has = false;
  try { has = !!localStorage.getItem("yz2_driver_cfg"); localStorage.setItem("yz2_role", "driver"); } catch (e) {}
  if (!k && !has) return pasteScreen(root);
  const ctx = { root, db, parts: ["sofor"], query: k ? { k } : {}, go: (h) => (location.hash = h), reload: render, toast, standaloneDriver: true };
  root.innerHTML = "";
  await driver.screen(ctx);
}

(async function boot() {
  try {
    await db.openDB();
    if ("serviceWorker" in navigator) {
      try {
        const reg = await navigator.serviceWorker.register("./sw.js");
        const ask = (sw) => { const b = document.createElement("button"); b.className = "btn primary block"; b.style.cssText = "position:fixed;left:12px;right:12px;bottom:12px;z-index:9999"; b.textContent = "Yeni sürüm hazır — dokunun"; b.onclick = () => sw.postMessage({ type: "SKIP_WAITING" }); document.body.appendChild(b); };
        if (reg.waiting && navigator.serviceWorker.controller) ask(reg.waiting);
        reg.addEventListener("updatefound", () => { const sw = reg.installing; sw?.addEventListener("statechange", () => { if (sw.state === "installed" && navigator.serviceWorker.controller) ask(sw); }); });
        document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") reg.update().catch(() => {}); });
        let done = false;
        navigator.serviceWorker.addEventListener("controllerchange", () => { if (!done) { done = true; location.reload(); } });
      } catch (e) {}
    }
    await render();
  } catch (e) {
    qs("#screen").innerHTML = `<div class="notice danger" style="margin:30px 14px"><span>⛔</span><span>Açılamadı: ${esc(e.message || e)}. Sayfayı yenileyin.</span></div>`;
  }
})();
