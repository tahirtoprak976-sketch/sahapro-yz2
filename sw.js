// Versioned atomic app shell. Existing cached assets are never mixed with a new release.
const CACHE = "yz2-solo-v1-20261017-kurulum-1";
const CDN_CACHE = "yz2-solo-cdn-v1";
const ASSETS = [
  "./",
  "./index.html",
  "./sofor.html",
  "./js/sofor-main.js",
  "./styles.css",
  "./js/core.js",
  "./js/message-engine.js",
  "./js/message-smart-core.js", "./js/message-smart-db.js", "./js/message-smart-ui.js",
  "./js/solo-core.js", "./js/solo-db.js", "./js/solo-ui.js", "./vendor/qrcode.js",
  "./js/db.js",
  "./js/ui.js",
  "./js/parser.js",
  "./js/history-core.js",
  "./js/history-db.js",
  "./js/history-ui.js",
  "./data/history-template.json",
  "./js/pdf.js",
  "./js/ocr.js",
  "./js/m-dash.js",
  "./js/m-work.js",
  "./js/m-finance.js",
  "./js/m-ops.js",
  "./js/m-crm.js",
  "./js/app.js",
  "./js/business.js",
  "./js/pro.js",
  "./js/document-engine.js",
  "./js/pdf-templates.js",
  "./js/backup.js",
  "./js/backup-crypt.js",
  "./js/enterprise.js", "./js/enterprise-core.js", "./js/enterprise-db.js",
  "./js/esnaf.js",
  "./js/today.js",
  "./js/finance-chart.js",
  "./js/statement.js",
  "./js/ai-assist.js",
  "./js/ai-local.js",
  "./js/ai-screen.js",
  "./js/ai-gemini.js",
  "./js/assistant-core.js",
  "./js/assistant-docs.js",
  "./js/assistant-rules.js",
  "./js/slip-read.js",
  "./js/fuel-rules.js",
  "./js/day-summary.js",
  "./js/assistant-tools.js",
  "./js/assistant.js",
  "./js/merge-core.js",
  "./js/merge.js",
  "./js/who-check.js",
  "./js/yard-core.js",
  "./js/yard.js",
  "./js/fuel-pay.js",
  "./js/collect.js",
  "./js/unzip.js",
  "./js/wa-bulk-core.js",
  "./js/wa-bulk.js",
  "./js/payroll-core.js",
  "./js/payroll.js",
  "./js/maint-core.js",
  "./js/maint.js",
  "./js/receipt-detail.js",
  "./js/tank-match.js",
  "./js/leave-core.js",
  "./js/leave-ui.js",
  "./js/leave-form.js",
  "./js/security-core.js",
  "./js/security.js",
  "./js/invoice-import.js",
  "./js/invoice-import-ui.js",
  "./js/invoice-core.js",
  "./js/invoice-ui.js",
  "./js/price-health.js",
  "./js/price-health-ui.js",
  "./js/dump-account.js",
  "./js/dump-account-ui.js",
  "./js/cashflow-core.js",
  "./js/cashflow.js",
  "./js/day-close-core.js",
  "./js/image-shrink.js",
  "./js/report-core.js",
  "./js/report-ui.js",
  "./js/driver-core.js",
  "./js/driver.js",
  "./js/quote-core.js",
  "./js/quote-calc.js",
  "./js/collect-core.js",
  "./js/price-rule-core.js",
  "./js/assistant-actions.js",
  "./js/costs-core.js",
  "./js/dump-fees.js",
  "./js/brief.js",
  "./js/expert-core.js",
  "./js/undo.js",
  "./js/customer-report.js",
  "./vendor/DejaVuSans.ttf",
  "./vendor/DejaVuSans-Bold.ttf",
  "./manifest.webmanifest",
  "./icons/icon.svg",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
];
// Dosyalar her zaman internetten TAZE indirilir (cache: "reload"): tarayıcının HTTP önbelleğindeki eski kopya
// yeni sürümün içine karışmasın (GitHub Pages dosyaları 10 dk önbellekte tutar).
self.addEventListener("install", (event) =>
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(ASSETS.map((u) => new Request(u, { cache: "reload" }))))),
);
// New release waits for the user or until every old window is closed.
self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
});
self.addEventListener("activate", (event) =>
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter(
              (k) =>
                k.startsWith("yz2-solo-") && k !== CACHE && k !== CDN_CACHE,
            )
            .map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  ),
);
// Android "Paylaş" → SAHAPRO: WhatsApp mesajı / fotoğraf Akıllı Asistan'a düşer
self.addEventListener("fetch", (event) => {
  const u = new URL(event.request.url);
  if (event.request.method !== "POST" || u.origin !== location.origin || !u.pathname.endsWith("/share-target")) return;
  event.respondWith(
    (async () => {
      try {
        const fd = await event.request.formData();
        // WhatsApp "Sohbeti dışa aktar" → SAHAPRO: sohbet dosyası (.txt / .zip) + medya → WhatsApp toplu işleme
        const all = fd.getAll("photos").filter((f) => f && f.size);
        const chat = all.find((f) => /\.zip$/i.test(f.name || "") || /zip/.test(f.type || "")) || all.find((f) => /\.txt$/i.test(f.name || "") || f.type === "text/plain");
        if (chat) {
          await caches.delete("yz2-wa");
          const wa = await caches.open("yz2-wa");
          await wa.put("./__wa/source", new Response(chat, { headers: { "x-name": encodeURIComponent(chat.name || "sohbet.txt"), "content-type": chat.type || "application/octet-stream" } }));
          let j = 0;
          for (const f of all) if (f !== chat) await wa.put(`./__wa/media-${j++}`, new Response(f, { headers: { "x-name": encodeURIComponent(f.name || "medya"), "content-type": f.type || "application/octet-stream" } }));
          return Response.redirect("./index.html#/whatsapp-toplu?shared=1", 303);
        }
        const cache = await caches.open("yz2-share");
        for (const k of await cache.keys()) await cache.delete(k);
        const text = [fd.get("title"), fd.get("text"), fd.get("url")].filter(Boolean).join("\n");
        await cache.put("./__share/text", new Response(text));
        let i = 0;
        for (const f of fd.getAll("photos").slice(0, 10))
          if (f && f.size) await cache.put(`./__share/file-${i++}`, new Response(f, { headers: { "content-type": f.type || "image/jpeg", "x-name": encodeURIComponent(f.name || "foto.jpg") } }));
      } catch (e) {}
      return Response.redirect("./index.html#/akilli-asistan?shared=1", 303);
    })(),
  );
});
self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url),
    local = url.origin === location.origin,
    cdn = url.origin === "https://cdn.jsdelivr.net";
  if (!local && !cdn) return;
  event.respondWith(
    (async () => {
      const cache = await caches.open(cdn ? CDN_CACHE : CACHE),
        cached = await cache.match(event.request, { ignoreSearch: local });
      if (cached) return cached;
      const response = await fetch(event.request);
      if (response.ok && cdn) await cache.put(event.request, response.clone());
      return response;
    })(),
  );
});
