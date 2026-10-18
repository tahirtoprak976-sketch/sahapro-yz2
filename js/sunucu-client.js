// SAHAPRO YZ2 — sunucu dilimi istemcisi (yalnız geliştirme dalı).
// Gerçek oturum (GoTrue JWT) + PostgREST RPC + cihazda kalıcı çevrimdışı kuyruk.
//
// Güvenlik sözleşmesi:
// - İstemci user_id/role/tenant_id/approved_by GÖNDERMEZ; gönderse de sunucu okumaz.
// - Yetki yalnız sunucuda (RPC + RLS) denetlenir; buradaki rol bilgisi yalnız ekran düzenidir.
// - service_role / yönetim anahtarı bu dosyada ve istemcide YOK; yalnız kullanıcının kendi
//   oturum JWT'si kullanılır. Hosted Supabase'e geçişte publishable anon key ayrıca eklenir.

export const PGRST = "http://127.0.0.1:53001";
export const GOTRUE = "http://127.0.0.1:53002";

const SESSION_KEY = "yz2_srv_session";
const OUTBOX_DB = "sahapro_yz2_srv";

// ---------- oturum ----------

export function getSession() {
  try { return JSON.parse(localStorage.getItem(SESSION_KEY) || "null"); } catch { return null; }
}
function setSession(s) {
  if (s) localStorage.setItem(SESSION_KEY, JSON.stringify(s));
  else localStorage.removeItem(SESSION_KEY);
}

export async function login(email, password) {
  const r = await fetch(`${GOTRUE}/token?grant_type=password`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const b = await r.json().catch(() => ({}));
  if (!r.ok) throw clientError(r.status, b.error_description || b.msg || "giriş başarısız");
  setSession({
    access_token: b.access_token, refresh_token: b.refresh_token,
    expires_at: Date.now() + (b.expires_in || 3600) * 1000, email: b.user?.email || email,
  });
  return getSession();
}

export async function logout() {
  const s = getSession();
  if (s) {
    try {
      await fetch(`${GOTRUE}/logout`, { method: "POST", headers: { Authorization: `Bearer ${s.access_token}` } });
    } catch { /* çevrimdışı çıkışta sessiz geç */ }
  }
  setSession(null);
}

async function refreshSession() {
  const s = getSession();
  if (!s?.refresh_token) throw clientError(401, "AUTH_REQUIRED: oturum gerekli");
  const r = await fetch(`${GOTRUE}/token?grant_type=refresh_token`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refresh_token: s.refresh_token }),
  });
  const b = await r.json().catch(() => ({}));
  if (!r.ok) { setSession(null); throw clientError(401, "AUTH_REQUIRED: oturum yenilenemedi"); }
  setSession({ ...s, access_token: b.access_token, refresh_token: b.refresh_token || s.refresh_token,
               expires_at: Date.now() + (b.expires_in || 3600) * 1000 });
  return getSession();
}

async function token() {
  let s = getSession();
  if (!s) throw clientError(401, "AUTH_REQUIRED: oturum gerekli");
  if (Date.now() > s.expires_at - 30000) s = await refreshSession();
  return s.access_token;
}

// ---------- hata biçimi ----------

function clientError(status, message) {
  const e = new Error(message);
  e.status = status;
  const m = /^([A-Z_]+):/.exec(message || "");
  e.code = m ? m[1] : (status === 401 || status === 403 ? "FORBIDDEN" : "SERVER_ERROR");
  return e;
}

// ---------- API ----------

export async function rpc(name, args = {}) {
  const t = await token();
  let r;
  try {
    r = await fetch(`${PGRST}/rpc/${name}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${t}` },
      body: JSON.stringify(args),
    });
  } catch {
    throw clientError(0, "NETWORK: sunucuya ulaşılamadı");
  }
  const b = await r.json().catch(() => ({}));
  if (!r.ok) throw clientError(r.status, b.message || `HTTP ${r.status}`);
  return b;
}

export async function apiGet(path) {
  const t = await token();
  let r;
  try {
    r = await fetch(`${PGRST}${path}`, { headers: { Authorization: `Bearer ${t}` } });
  } catch {
    throw clientError(0, "NETWORK: sunucuya ulaşılamadı");
  }
  const b = await r.json().catch(() => ({}));
  if (!r.ok) throw clientError(r.status, b.message || `HTTP ${r.status}`);
  return b;
}

export const mySession = () => rpc("my_session");

// ---------- çevrimdışı kuyruk (IndexedDB, cihazda kalıcı) ----------

function openOutbox() {
  return new Promise((res, rej) => {
    const rq = indexedDB.open(OUTBOX_DB, 1);
    rq.onupgradeneeded = () => {
      if (!rq.result.objectStoreNames.contains("outbox"))
        rq.result.createObjectStore("outbox", { keyPath: "op_id" });
    };
    rq.onsuccess = () => res(rq.result);
    rq.onerror = () => rej(rq.error);
  });
}

async function withStore(mode, fn) {
  const db = await openOutbox();
  try {
    return await new Promise((res, rej) => {
      const tx = db.transaction("outbox", mode);
      const out = fn(tx.objectStore("outbox"));
      tx.oncomplete = () => res(out._result);
      tx.onerror = () => rej(tx.error);
      tx.onabort = () => rej(tx.error);
      if (out && typeof out === "object" && "onsuccess" in out) {
        out.onsuccess = () => { out._result = out.result; };
      }
    });
  } finally { db.close(); }
}

export const outboxList = () =>
  withStore("readonly", (s) => s.getAll()).then((r) => (r || []).sort((a, b) => a.created_at.localeCompare(b.created_at)));

export const outboxGet = (opId) => withStore("readonly", (s) => s.get(opId));

export async function outboxDraft(fields) {
  const item = {
    op_id: crypto.randomUUID(),           // kalıcı işlem kimliği — yeniden denemelerde AYNI kalır
    fields, status: "bekliyor",           // Telefonda bekliyor
    report_id: null, server_state: null, reason: null, error: null,
    attempts: 0, created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  };
  await withStore("readwrite", (s) => s.put(item));
  return item;
}

async function outboxPut(item) {
  item.updated_at = new Date().toISOString();
  await withStore("readwrite", (s) => s.put(item));
  return item;
}

export const outboxRemove = (opId) => withStore("readwrite", (s) => s.delete(opId));

// Kuyruk durumu etiketi — "Sunucu aldı" ile "Onaylandı" AYNI ŞEY DEĞİLDİR:
// sunucu_aldi yalnızca sunucunun kabul ettiğini söyler; onay ayrı durumdur.
export const QUEUE_LABELS = {
  bekliyor: "Telefonda bekliyor",
  gonderiliyor: "Gönderiliyor",
  sunucu_aldi: "Sunucu aldı",
  duzeltme_istendi: "Düzeltme istendi",
  onaylandi: "Onaylandı",
  reddedildi: "Reddedildi",
};

export const SERVER_STATE_LABELS = {
  gonderildi: "ofis sırasında",
  kontrolde: "ofis kontrol ediyor",
  onay_bekliyor: "yönetici onayı bekliyor",
};

function mapServerState(state) {
  if (state === "duzeltme_istendi" || state === "onaylandi" || state === "reddedildi") return state;
  return "sunucu_aldi";
}

// Gönderim: ağ hatasında kayıt kuyrukta 'bekliyor' kalır; sunucu yanıtı kaybolup
// yeniden denenirse aynı op_id ile gider → sunucu 'existing' döner, ikinci bildirim açılmaz.
export async function outboxSend(opId, fieldsOverride) {
  const item = await outboxGet(opId);
  if (!item) throw clientError(400, "kayıt yok");
  const fields = fieldsOverride || item.fields;
  item.status = "gonderiliyor";
  item.error = null;
  await outboxPut(item);
  let out;
  try {
    out = await rpc("submit_work", {
      p_op_key: item.op_id,
      p_fields: fields,
      p_entry: fields,
      p_source: { channel: "yz2-sunucu-dilim", app: "sunucu.html" },
    });
  } catch (e) {
    if (e.status === 0) {           // ağ yok: kuyrukta kal, sonra aynı op_id ile dene
      item.status = "bekliyor";
      item.error = "NETWORK";
      await outboxPut(item);
    } else {
      item.status = "bekliyor";     // sunucu reddi: kayıt korunur, hata görünür
      item.error = e.message;
      await outboxPut(item);
    }
    throw e;
  }
  item.fields = fields;
  item.report_id = out.report_id;
  item.server_state = out.state;
  item.status = mapServerState(out.state);
  item.error = null;
  await outboxPut(item);
  return item;
}

// Sürücü durum yenileme: sunucudaki gerçek durumu kuyruğa işler
export async function outboxRefresh() {
  const items = await outboxList();
  const mine = items.filter((i) => i.report_id);
  for (const item of mine) {
    const rows = await apiGet(`/reports?id=eq.${item.report_id}&select=id,state`);
    const r = rows[0];
    if (!r) continue;
    item.server_state = r.state;
    item.status = mapServerState(r.state);
    if (r.state === "duzeltme_istendi" || r.state === "reddedildi") {
      const a = await apiGet(
        `/audit?report_id=eq.${item.report_id}&action=eq.${r.state}&order=created_at.desc&limit=1&select=reason`);
      item.reason = a[0]?.reason || null;
    }
    await outboxPut(item);
  }
  return outboxList();
}
