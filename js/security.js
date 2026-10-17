// Güvenlik ve Yetki (#/guvenlik) + uygulama kilidi.
// • Yönetici kilidi: PBKDF2 şifre, parmak izi / Face ID (WebAuthn, cihazın kendi doğrulaması), boşta kalınca ve arka plana alınınca kilit,
//   yanlış denemede artan bekleme, uygulama değiştiricide içerik bulanık.
// • Hassas işlemler (yedek alma/geri yükleme, kilidi kapatma, şoför bağlantısı, çıkış kodları) şifreyi yeniden ister.
// • Şoför bağlantıları kaydı: her bağlantının gizli imza anahtarı, çıkış kodu, süresi; iptal edilebilir.
// • Güvenlik günlüğü: açma, hatalı deneme, kilit değişikliği, bağlantı oluşturma/iptal, reddedilen şoför mesajları, yedek işlemleri.
import { qs, qsa, esc, appbar, toast, notice, todayStr, trDate, confirmDialog } from "./ui.js";
import * as db from "./db.js";
import { hashSecret, verifySecret, pinProblem, lockoutMs, randomB64, randomDigits, b64u, unb64u, linkVerdict } from "./security-core.js";

const K_LOCK = "sec_lock", K_FAIL = "sec_fail", K_LOG = "security_log", K_LINKS = "driver_links";
export const SECRET_KEYS = [K_LOCK, K_FAIL]; // yedeğe girmez (kilit cihaza özeldir)
let unlocked = false, lastAct = Date.now(), hiddenAt = 0, watching = false, lockShown = null;

// ---- Günlük ----
export async function secLog(kind, text) {
  try {
    const L = (await db.metaGet(K_LOG)) || [];
    L.unshift({ at: new Date().toISOString(), kind, text: String(text).slice(0, 300) });
    await db.metaSet(K_LOG, L.slice(0, 400));
  } catch (e) { /* günlük yazılamazsa işlem durmaz */ }
}

export const lockConfig = () => db.metaGet(K_LOCK);
export async function lockEnabled() { return !!(await lockConfig())?.hash; }

// Eski basit PIN (pin_hash) — yalnız geçiş için
function oldPinHash(pin) { let h = 5381; const s = "solo-" + pin; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0; return "h" + h.toString(36); }

async function failState() { return (await db.metaGet(K_FAIL)) || { n: 0, until: 0 }; }
async function check(secret) {
  const cfg = await lockConfig();
  if (cfg?.hash) return verifySecret(secret, cfg);
  const old = await db.metaGet("pin_hash");
  if (old && oldPinHash(secret) === old) {
    // Eski PIN doğru: güçlü saklamaya geçir (PIN aynı kalır; zayıfsa Güvenlik ekranı değiştirmeyi önerir)
    await db.metaSet(K_LOCK, { ...(await hashSecret(secret)), idle_min: 5, created_at: new Date().toISOString(), weak: !!pinProblem(secret) });
    await db.metaSet("pin_hash", null);
    await secLog("lock", "Eski basit PIN güçlü kilide taşındı");
    return true;
  }
  return false;
}

// ---- Parmak izi / Face ID (WebAuthn, platform doğrulayıcı) ----
export const bioSupported = async () => { try { return !!(window.PublicKeyCredential && (await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable())); } catch (e) { return false; } };
async function bioRegister() {
  const cred = await navigator.credentials.create({ publicKey: {
    challenge: crypto.getRandomValues(new Uint8Array(32)), rp: { name: "SAHAPRO", id: location.hostname },
    user: { id: crypto.getRandomValues(new Uint8Array(16)), name: "yonetici", displayName: "SAHAPRO Yönetici" },
    pubKeyCredParams: [{ type: "public-key", alg: -7 }, { type: "public-key", alg: -257 }],
    authenticatorSelection: { authenticatorAttachment: "platform", userVerification: "required", residentKey: "discouraged" }, timeout: 60000, attestation: "none",
  } });
  return b64u(cred.rawId);
}
async function bioVerify(id) {
  const a = await navigator.credentials.get({ publicKey: { challenge: crypto.getRandomValues(new Uint8Array(32)), allowCredentials: [{ type: "public-key", id: unb64u(id) }], userVerification: "required", timeout: 60000 } });
  const ad = new Uint8Array(a.response.authenticatorData);
  return ad.length > 32 && (ad[32] & 0x04) !== 0; // UV: cihaz kullanıcıyı doğruladı (parmak izi / yüz / cihaz şifresi)
}

// ---- Kilit ekranı ----
function lockOverlay({ title = "SAHAPRO", sub = "Devam etmek için yönetici şifresi", reason = "", cancel = false } = {}) {
  return new Promise(async (resolve) => {
    const cfg = await lockConfig();
    const hasOld = !cfg?.hash && !!(await db.metaGet("pin_hash"));
    const el = document.createElement("div");
    el.id = "lock-root";
    el.style.cssText = "position:fixed;inset:0;z-index:99999;background:var(--bg,#f2f5f9);display:flex;align-items:flex-start;justify-content:center;overflow:auto";
    el.innerHTML = `<div style="width:100%;max-width:380px;padding:16vh 22px 30px;text-align:center">
      <div style="font-size:44px">🔒</div>
      <div class="strong" style="font-size:19px;margin:4px 0 2px">${esc(title)}</div>
      <div class="muted small" style="margin-bottom:${reason ? 4 : 18}px">${esc(sub)}</div>
      ${reason ? `<div class="small" style="margin-bottom:16px"><b>${esc(reason)}</b></div>` : ""}
      <input type="password" autocomplete="current-password" data-pw ${cfg?.alpha ? "" : 'inputmode="numeric"'} style="width:100%;text-align:center;font-size:24px;letter-spacing:6px;padding:12px;border-radius:12px;border:1px solid var(--border)">
      <button class="btn primary block" data-go-un style="margin-top:12px;min-height:50px">Aç</button>
      ${cfg?.bio_id ? '<button class="btn block" data-bio style="margin-top:8px;min-height:50px">👆 Parmak izi / Face ID</button>' : ""}
      ${cancel ? '<button class="btn ghost block" data-cancel style="margin-top:8px">Vazgeç</button>' : ""}
      <div class="tiny" data-msg style="margin-top:12px;min-height:16px;color:#d9534f"></div>
      ${hasOld ? '<div class="tiny muted">Eski PIN\'inizi girin; daha güçlü kilide kendiliğinden geçilir.</div>' : '<div class="tiny muted" style="margin-top:10px">Şifreyi unuttuysanız: Ayarlar\'dan değil, şifreli yedekten geri yükleyerek açılır (aşağıda “Şifremi unuttum”).</div><button class="btn ghost sm" data-forgot style="margin-top:6px">Şifremi unuttum</button>'}
    </div>`;
    document.body.appendChild(el);
    const pw = qs("[data-pw]", el), msg = qs("[data-msg]", el);
    const done = (ok) => { el.remove(); lockShown = null; resolve(ok); };
    let timer = null;
    const waitTick = async () => {
      const f = await failState(), left = f.until - Date.now();
      if (left > 0) { msg.textContent = `Çok fazla hatalı deneme. ${Math.ceil(left / 1000)} sn bekleyin.`; pw.disabled = true; clearTimeout(timer); timer = setTimeout(waitTick, 1000); return true; }
      pw.disabled = false; if (msg.textContent.startsWith("Çok fazla")) msg.textContent = ""; return false;
    };
    await waitTick();
    setTimeout(() => pw.focus(), 250);
    let checking = false;
    const tryIt = async () => {
      if (checking) return;
      checking = true;
      try {
      if (await waitTick()) return;
      const v = pw.value;
      if (!v) return;
      qs("[data-go-un]", el).disabled = true;
      const ok = await check(v);
      qs("[data-go-un]", el).disabled = false;
      if (ok) { await db.metaSet(K_FAIL, { n: 0, until: 0 }); await secLog("unlock", reason ? "Şifre doğrulandı: " + reason : "Uygulama açıldı (şifre)"); return done(true); }
      const f = await failState(); f.n++; f.until = Date.now() + lockoutMs(f.n); await db.metaSet(K_FAIL, f);
      await secLog("fail", `Hatalı şifre denemesi (${f.n}. kez)${reason ? " · " + reason : ""}`);
      pw.value = ""; msg.textContent = f.n < 5 ? `Şifre hatalı (${5 - f.n} hak kaldı)` : ""; await waitTick(); pw.focus();
      } catch (error) { msg.textContent = "Doğrulama tamamlanamadı; yeniden deneyin"; }
      finally {checking = false; qs("[data-go-un]", el).disabled = false;}
    };
    qs("[data-go-un]", el).addEventListener("click", tryIt);
    pw.addEventListener("keydown", (e) => { if (e.key === "Enter") tryIt(); });
    qs("[data-bio]", el)?.addEventListener("click", async () => {
      if (await waitTick()) return;
      try { if (await bioVerify(cfg.bio_id)) { await db.metaSet(K_FAIL, { n: 0, until: 0 }); await secLog("unlock", reason ? "Biyometrik doğrulandı: " + reason : "Uygulama açıldı (parmak izi / yüz)"); return done(true); } msg.textContent = "Doğrulanamadı"; }
      catch (e) { msg.textContent = "Parmak izi / yüz doğrulanamadı; şifreyi girin"; }
    });
    qs("[data-cancel]", el)?.addEventListener("click", () => done(false));
    qs("[data-forgot]", el)?.addEventListener("click", () => {
      msg.style.color = "inherit";
      msg.innerHTML = "Şifre hiçbir yerde açık tutulmaz; kurtarılamaz. Çözüm: uygulamanın verilerini telefon ayarlarından silin, uygulamayı açıp son <b>şifreli yedeği</b> geri yükleyin (yedek şifresiyle). Kayıtlar yedekte olduğu kadar geri gelir.";
    });
    // Kilit açıkken otomatik parmak izi teklifi (ilk açılış)
    if (cfg?.bio_id && !reason) setTimeout(() => qs("[data-bio]", el)?.click(), 400);
  });
}

// Açılışta (ve kilitlenince) kilit
export async function gate() {
  const cfg = await lockConfig();
  const old = !cfg?.hash && (await db.metaGet("pin_hash"));
  if (!cfg?.hash && !old) { unlocked = true; return true; }
  if (unlocked) return true;
  if (!lockShown) lockShown = lockOverlay();
  const ok = await lockShown;
  if (ok) { unlocked = true; lastAct = Date.now(); }
  return ok;
}
export async function lockNow(reason = "Elle kilitlendi") {
  if (!(await lockEnabled())) return toast("Önce Güvenlik ekranından yönetici kilidini kurun", "err");
  unlocked = false; await secLog("lock", reason); await gate();
}
// Hassas işlem: kilit kuruluysa şifre (ya da biyometri) yeniden sorulur
export async function reauth(reason) {
  if (!(await lockEnabled())) return true;
  const ok = await lockOverlay({ title: "Onay gerekli", sub: "Bu işlem için yönetici şifresi", reason, cancel: true });
  if (!ok) await secLog("deny", "Vazgeçildi: " + reason);
  return ok;
}
// Boşta kalma ve arka plan kilidi; arka plandayken içerik bulanık (uygulama değiştiricide görünmesin)
export function watchIdle() {
  if (watching) return; watching = true;
  const act = () => { lastAct = Date.now(); };
  for (const ev of ["pointerdown", "keydown", "touchstart", "scroll"]) addEventListener(ev, act, { passive: true, capture: true });
  setInterval(async () => {
    const cfg = await lockConfig();
    if (!cfg?.hash || !unlocked) return;
    if (Date.now() - lastAct > (Number(cfg.idle_min) || 5) * 60e3) { unlocked = false; await secLog("lock", `Boşta kaldı (${cfg.idle_min || 5} dk), kilitlendi`); gate(); }
  }, 15000);
  document.addEventListener("visibilitychange", async () => {
    const cfg = await lockConfig();
    if (!cfg?.hash) return;
    if (document.hidden) { hiddenAt = Date.now(); document.body.classList.add("sec-blur"); return; }
    document.body.classList.remove("sec-blur");
    if (unlocked && hiddenAt && Date.now() - hiddenAt > (Number(cfg.away_min ?? 1)) * 60e3) { unlocked = false; await secLog("lock", "Arka planda kaldı, kilitlendi"); gate(); }
  });
  const st = document.createElement("style");
  st.textContent = "body.sec-blur #screen,body.sec-blur #bottomnav,body.sec-blur #sheet-root{filter:blur(18px)}";
  document.head.appendChild(st);
}

// ---- Şoför bağlantıları kaydı ----
export const driverLinks = async () => (await db.metaGet(K_LINKS)) || [];
async function saveLinks(L) { await db.metaSet(K_LINKS, L); }
export async function newDriverLink({ pid, name, vid = null, days = 180 }) {
  const lid = randomB64(9), secret = randomB64(16), exit = randomDigits(8);
  const issued = todayStr();
  const ex = new Date(issued + "T12:00:00Z"); ex.setUTCDate(ex.getUTCDate() + days);
  const link = { lid, pid, name, vid, issued, exp: ex.toISOString().slice(0, 10), secret, exit, revoked_at: null, last_seen: null, msgs: 0 };
  const L = await driverLinks();
  await saveLinks([link, ...L].slice(0, 300));
  await secLog("link", `Şoför bağlantısı oluşturuldu: ${name} (${days} gün)`);
  // Şoför telefonuna giden: imza anahtarı + çıkış kodunun özeti (kodun kendisi gitmez)
  return { link, forDriver: { lid, ls: secret, exp: link.exp, xk: await hashSecret(exit, randomB64(16), 120000) } };
}
export async function revokeLink(lid, why = "İptal edildi") {
  const L = await driverLinks();
  const l = L.find((x) => x.lid === lid);
  if (!l || l.revoked_at) return;
  l.revoked_at = new Date().toISOString(); l.revoke_reason = why;
  await saveLinks(L);
  await secLog("revoke", `Şoför bağlantısı iptal: ${l.name} · ${why}`);
}
export async function revokeForPerson(pid, why) { for (const l of (await driverLinks()).filter((x) => x.pid === pid && !x.revoked_at)) await revokeLink(l.lid, why); }
// Gelen şoför mesajlarını denetle: [{payload, verdict}] — imza, iptal, süre, kişi uyuşması
export async function checkPayloads(payloads, d) {
  const { hmacOk } = await import("./security-core.js");
  const L = await driverLinks(), today = todayStr();
  const out = [];
  let touched = false;
  for (const p of payloads) {
    if (!p.lid) { out.push({ p, ok: false, reject: "İmzasız şoför paketi kabul edilmez; yeni imzalı bağlantı oluşturun" }); continue; }
    const link = L.find((x) => x.lid === p.lid);
    const person = (d.personnel || []).find((x) => x.id === p.p);
    const v = linkVerdict(link, { today, personnelActive: !!person && !person.deleted_at && person.active !== false });
    if (!v.ok) { out.push({ p, ok: false, reject: v.level === "unknown" ? "Şoför bağlantısı bu telefonda tanınmıyor; yetkili bağlantıyı geri yükleyin veya yeni bağlantı oluşturun" : v.why }); continue; }
    if (!(await hmacOk(link.secret, p._code, p._sig))) { out.push({ p, ok: false, reject: "Mesajın imzası tutmuyor: kod değiştirilmiş ya da eksik kopyalanmış" }); continue; }
    if (link.pid !== p.p) { out.push({ p, ok: false, reject: `Bağlantı ${link.name} adına; mesaj başka kişi adına` }); continue; }
    link.last_seen = new Date().toISOString(); link.msgs = (link.msgs || 0) + 1; touched = true;
    out.push({ p, ok: true });
  }
  if (touched) await saveLinks(L);
  for (const x of out.filter((x) => x.reject)) await secLog("reject", `Şoför mesajı reddedildi (${x.p.n || "?"}): ${x.reject}`);
  return out;
}

// ---- Ekran ----
export async function screen(ctx) {
  if (ctx.parts[0] !== "guvenlik") return false;
  const { root } = ctx;
  const cfg = await lockConfig();
  const on = !!cfg?.hash, oldPin = !on && !!(await db.metaGet("pin_hash"));
  const bioOk = await bioSupported();
  const links = await driverLinks();
  const log = ((await db.metaGet(K_LOG)) || []).slice(0, 60);
  const lastBk = await db.metaGet("last_backup_at"), bkPw = !!(await db.metaGet("backup_pw"));
  const d = await db.dumpAll();
  const today = todayStr();
  const pname = (id) => (d.personnel || []).find((x) => x.id === id)?.name;
  const active = links.filter((l) => linkVerdict(l, { today, personnelActive: (d.personnel || []).some((p) => p.id === l.pid && !p.deleted_at && p.active !== false) }).ok);
  const checks = [
    [on, "Yönetici kilidi kurulu", "Telefonunuzu eline alan kimse kayıtları göremez"],
    [on && !cfg.weak, "Şifre güçlü", "En az 6 hane, tahmini zor"],
    [!!cfg?.bio_id, "Parmak izi / Face ID", "Hızlı ve güvenli açma"],
    [on && (Number(cfg.idle_min) || 5) <= 10, "Otomatik kilit", "Boşta kalınca kilitlenir"],
    [bkPw, "Yedekler şifreli", "Yedek dosyası başkasının eline geçse de açılamaz"],
    [!!lastBk && (Date.now() - new Date(lastBk)) < 8 * 864e5, "Son 7 günde yedek", lastBk ? "Son yedek " + trDate(String(lastBk).slice(0, 10)) : "Hiç yedek alınmadı"],
  ];
  const score = checks.filter((c) => c[0]).length;
  const KIND = { unlock: "🔓", fail: "⛔", lock: "🔒", link: "🔗", revoke: "✂", reject: "🚫", deny: "↩", backup: "💾", setting: "⚙" };
  root.innerHTML = appbar("Güvenlik ve Yetki", "Yönetici kilidi · şoför bağlantıları · günlük") + `
    <div style="height:10px"></div>
    <div class="card"><div class="row between"><b>Güvenlik durumu</b><b style="color:${score >= 5 ? "#2e9e6b" : score >= 3 ? "#e0a030" : "#d9534f"}">${score} / ${checks.length}</b></div>
      ${checks.map(([ok, t, s]) => `<div class="row between small" style="padding:5px 0;border-bottom:1px solid var(--border)"><span>${ok ? "✅" : "⬜"} ${t}<br><span class="tiny muted">${esc(s)}</span></span></div>`).join("")}</div>

    <div class="section-title">Yönetici kilidi</div>
    <div class="card">
      ${on ? `<div class="small">Kilit <b>açık</b>${cfg.weak ? ' · <span style="color:#d9534f">şifre zayıf, değiştirin</span>' : ""}. Uygulama her açılışta, ${cfg.idle_min || 5} dk boşta kalınca ve ${cfg.away_min ?? 1} dk arka planda kalınca şifre ister.</div>
        <div class="formgrid2" style="margin-top:8px">
          <div class="field"><label>Boşta kilit</label><select data-idle>${[1, 3, 5, 10, 30].map((m) => `<option value="${m}" ${Number(cfg.idle_min || 5) === m ? "selected" : ""}>${m} dakika</option>`).join("")}</select></div>
          <div class="field"><label>Arka plandan dönünce</label><select data-away>${[[0, "Hemen"], [1, "1 dakika"], [5, "5 dakika"], [15, "15 dakika"]].map(([m, t]) => `<option value="${m}" ${Number(cfg.away_min ?? 1) === m ? "selected" : ""}>${t}</option>`).join("")}</select></div>
        </div>
        <div class="row" style="gap:6px;flex-wrap:wrap;margin-top:6px"><button class="btn grow" data-lock>🔒 Şimdi kilitle</button><button class="btn grow" data-chg>Şifreyi değiştir</button></div>
        ${bioOk ? (cfg.bio_id ? '<button class="btn block ghost" data-biooff style="margin-top:6px">Parmak izi / Face ID kaldır</button>' : '<button class="btn block" data-bioon style="margin-top:6px">👆 Parmak izi / Face ID ile açmayı kur</button>') : '<div class="tiny muted" style="margin-top:6px">Bu telefonda parmak izi / Face ID ile açma desteklenmiyor.</div>'}
        <button class="btn block ghost" data-off style="margin-top:6px;color:#d9534f">Kilidi kaldır</button>`
      : `${oldPin ? notice("warn", "Eski basit PIN kullanılıyor. Uygulamayı bir kez PIN ile açtığınızda güçlü kilide geçer; ya da aşağıdan yeni şifre kurun.") : notice("warn", "Kilit yok: telefonunuzu eline alan herkes kasa, cari, maaş ve tüm kayıtları görebilir.")}
        <button class="btn primary block" data-set style="margin-top:6px">🔒 Yönetici kilidini kur</button>`}
      <div class="tiny muted" style="margin-top:8px">Şifre telefonda yalnız geri çevrilemez özet olarak (PBKDF2, ${210000 .toLocaleString("tr-TR")} tur) tutulur; yedeğe girmez. Yedek alma/geri yükleme, kilidi kaldırma ve şoför bağlantısı işlemleri şifreyi yeniden ister.</div>
    </div>

    <div class="section-title">Şoför bağlantıları (${active.length} etkin)</div>
    <div class="card small" style="line-height:1.5">Her şoför bağlantısı <b>imzalıdır</b>: şoförün gönderdiği kayıtlar o bağlantının gizli anahtarıyla imzalanır. Kod değiştirilirse, bağlantı iptal edilmişse, süresi dolmuşsa ya da personel pasife alınmışsa kayıtlar <b>işlenmez</b>. Şoför telefonu şoför modundan yalnız aşağıdaki <b>çıkış koduyla</b> çıkabilir; yönetici ekranlarına hiç geçemez.</div>
    ${links.length ? links.map((l) => {
      const v = linkVerdict(l, { today, personnelActive: (d.personnel || []).some((p) => p.id === l.pid && !p.deleted_at && p.active !== false) });
      return `<div class="card" style="padding:10px 12px;border-left:4px solid ${v.ok ? "#2e9e6b" : "#9aa4b2"}">
        <div class="row between"><b>${esc(pname(l.pid) || l.name)}</b><span class="small">${v.ok ? "Etkin" : esc(v.level === "expired" ? "Süresi doldu" : "İptal")}</span></div>
        <div class="tiny muted">Verildi ${trDate(l.issued)} · geçerlilik ${trDate(l.exp)}${l.last_seen ? ` · son mesaj ${trDate(l.last_seen.slice(0, 10))} (${l.msgs || 0})` : " · henüz mesaj yok"}${l.revoke_reason ? " · " + esc(l.revoke_reason) : ""}</div>
        ${v.ok ? `<div class="row" style="gap:6px;margin-top:6px"><button class="btn sm grow" data-exit="${esc(l.lid)}">Çıkış kodunu göster</button><button class="btn sm grow" data-revoke="${esc(l.lid)}" style="color:#d9534f">İptal et</button></div>` : ""}
      </div>`; }).join("") : '<div class="muted small" style="margin:4px">Henüz imzalı şoför bağlantısı yok. Personel → kişi → 📲 Şoför bağlantısı.</div>'}
    <button class="btn block" data-go="#/sofor-kur" style="margin-top:6px">📲 Yeni şoför bağlantısı</button>

    <div class="section-title">Güvenlik günlüğü</div>
    <div class="card" style="padding:6px 10px">${log.map((x) => `<div class="small" style="padding:5px 0;border-bottom:1px solid var(--border)">${KIND[x.kind] || "•"} ${esc(x.text)}<br><span class="tiny muted">${new Date(x.at).toLocaleString("tr-TR", { timeZone: "Europe/Istanbul", dateStyle: "short", timeStyle: "short" })}</span></div>`).join("") || '<div class="muted small">Kayıt yok</div>'}</div>
    <div style="height:80px"></div>`;

  const setPw = async (title) => {
    const { promptDialog } = await import("./ui.js");
    const a = await promptDialog(title, "Yeni şifre (en az 6 hane; harf de olabilir)", "", { type: "password", hint: "Unutulursa kurtarılamaz; güvenli bir yere not edin." });
    if (a == null) return null;
    const pr = pinProblem(a.trim());
    if (pr) { toast(pr, "err"); return null; }
    const b = await promptDialog("Şifreyi tekrar girin", "Şifre tekrar", "", { type: "password" });
    if (b == null) return null;
    if (a.trim() !== b.trim()) { toast("Şifreler uyuşmuyor", "err"); return null; }
    return a.trim();
  };
  qs("[data-set]", root)?.addEventListener("click", async () => {
    if (oldPin && !(await reauthOld())) return;
    const pw = await setPw("Yönetici şifresi");
    if (!pw) return;
    await db.metaSet(K_LOCK, { ...(await hashSecret(pw)), alpha: /\D/.test(pw), idle_min: 5, away_min: 1, created_at: new Date().toISOString(), bio_id: null });
    await db.metaSet("pin_hash", null);
    unlocked = true;
    await secLog("setting", "Yönetici kilidi kuruldu");
    toast("Kilit kuruldu. Şifreyi unutmayın: kurtarılamaz.", "ok");
    ctx.reload();
  });
  async function reauthOld() { return lockOverlay({ title: "Eski PIN", sub: "Önce mevcut PIN'i girin", cancel: true }); }
  qs("[data-chg]", root)?.addEventListener("click", async () => {
    if (!(await reauth("Şifre değiştirme"))) return;
    const pw = await setPw("Yeni yönetici şifresi");
    if (!pw) return;
    await db.metaSet(K_LOCK, { ...cfg, ...(await hashSecret(pw)), alpha: /\D/.test(pw), weak: false });
    await secLog("setting", "Yönetici şifresi değiştirildi");
    toast("Şifre değiştirildi", "ok"); ctx.reload();
  });
  qs("[data-off]", root)?.addEventListener("click", async () => {
    if (!(await reauth("Kilidi kaldırma"))) return;
    if (!(await confirmDialog("Kilit kaldırılsın mı?", "Telefonu eline alan herkes tüm kayıtları görebilir.", "Kaldır", true))) return;
    await db.metaSet(K_LOCK, null);
    await secLog("setting", "Yönetici kilidi KALDIRILDI");
    ctx.reload();
  });
  qs("[data-lock]", root)?.addEventListener("click", () => lockNow());
  qs("[data-idle]", root)?.addEventListener("change", async (e) => { await db.metaSet(K_LOCK, { ...cfg, idle_min: Number(e.target.value) }); await secLog("setting", `Boşta kilit: ${e.target.value} dk`); toast("Kaydedildi", "ok"); });
  qs("[data-away]", root)?.addEventListener("change", async (e) => { await db.metaSet(K_LOCK, { ...cfg, away_min: Number(e.target.value) }); await secLog("setting", `Arka plan kilidi: ${e.target.value} dk`); toast("Kaydedildi", "ok"); });
  qs("[data-bioon]", root)?.addEventListener("click", async () => {
    if (!(await reauth("Parmak izi / Face ID kurulumu"))) return;
    try { const id = await bioRegister(); await db.metaSet(K_LOCK, { ...cfg, bio_id: id }); await secLog("setting", "Parmak izi / Face ID ile açma kuruldu"); toast("Kuruldu", "ok"); ctx.reload(); }
    catch (e) { toast("Kurulamadı: " + (e.message || e), "err"); }
  });
  qs("[data-biooff]", root)?.addEventListener("click", async () => { await db.metaSet(K_LOCK, { ...cfg, bio_id: null }); await secLog("setting", "Parmak izi / Face ID kaldırıldı"); ctx.reload(); });
  for (const b of qsa("[data-exit]", root))
    b.addEventListener("click", async () => {
      const l = links.find((x) => x.lid === b.dataset.exit);
      if (!(await reauth("Çıkış kodunu görme: " + l.name))) return;
      await secLog("setting", `Çıkış kodu görüntülendi: ${l.name}`);
      b.outerHTML = `<div class="notice info" style="flex:1"><div>Çıkış kodu: <b style="font-size:18px;letter-spacing:2px">${l.exit.slice(0, 4)} ${l.exit.slice(4)}</b><br><span class="tiny">Yalnız şoför telefonunu yönetici telefonuna çevirmek gerekirse kullanın. Şoföre vermeyin.</span></div></div>`;
    });
  for (const b of qsa("[data-revoke]", root))
    b.addEventListener("click", async () => {
      const l = links.find((x) => x.lid === b.dataset.revoke);
      if (!(await confirmDialog("Bağlantı iptal edilsin mi?", `${l.name}: bu bağlantıdan gelen yeni kayıtlar işlenmez. Şoför çalışmaya devam edecekse yeni bağlantı gönderin.`, "İptal et", true))) return;
      await revokeLink(l.lid, "Elle iptal");
      toast("İptal edildi", "ok"); ctx.reload();
    });
  return true;
}
