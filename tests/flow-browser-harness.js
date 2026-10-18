// Tarayıcı test köprüsü — GERÇEK IndexedDB'de flow servisini dışa açar.
// Playwright bu sayfayı aynı origin'de İKİ GERÇEK SEKME olarak açar; sekmeler aynı
// veritabanını paylaşır (aynı browser context = aynı profil = aynı IndexedDB).
// Hata enjeksiyonu (failAt) yalnız test içindir: servis katmanındaki 'work' |
// 'attachment' | 'approval' | 'audit' | 'attachments' noktalarında tx İÇİNDE hata fırlatır.
// SP1 köprüsü GERÇEK üreticiyi (driver-core.driverMessage) ve GERÇEK HMAC'i kullanır —
// testte sahte imza üreten yardımcı YOK; red senaryoları gerçek kapıdan geçemeyen paketlerle yapılır.
import { FlowStore, deleteFlowDB } from "../js/flow-store.js";
import { makeFlowConfig, labIdentity } from "../js/flow-identity.js";
import { createFlowService } from "../js/flow-service.js";
import { driverMessage } from "../js/driver-core.js";
import { randomB64 } from "../js/security-core.js";

const OFIS = labIdentity("ofis1", "ofis");
const YON = labIdentity("yon1", "yonetici");
const regs = new Map();

async function handle(db) {
  if (!regs.has(db)) {
    const store = await FlowStore.open(db);
    const config = makeFlowConfig({ tenant: "yz2" });
    regs.set(db, { store, svc: createFlowService({ store, config }) });
  }
  return regs.get(db);
}

// evaluate sınırından baytlar number[] gelir → Uint8Array
function decodePacket(p) {
  const q = { ...p };
  if (q.attachments) q.attachments = q.attachments.map((a) => ({ name: a.name, bytes: new Uint8Array(a.bytes) }));
  return q;
}
const asErr = (e) => ({ error: e && (e.code || e.name || "ERR") , message: e && e.message ? String(e.message) : String(e) });
async function guard(fn) { try { return await fn(); } catch (e) { return asErr(e); } }

window.FT = {
  ready: true,
  async intake(db, packet, opts = {}) {
    return guard(async () => {
      const { svc } = await handle(db);
      const out = await svc.intakePacket(decodePacket(packet), opts);
      return { result: out.result, id: out.report.id, state: out.report.state, version: out.report.version, rev_no: out.report.rev_no };
    });
  },
  // ---- lab bağlantıları + GERÇEK SP1 üretimi ----
  async makeLink(db, over = {}) {
    return guard(async () => {
      const { svc } = await handle(db);
      const pid = over.pid || "TEST-P-BT";
      const { link } = await svc.createLabLink({
        pid, name: over.name || "TEST-Şoför BT", vid: over.vid || "TEST-V-BT",
        days: over.days === undefined ? 180 : over.days,
      });
      return { lid: link.lid, pid: link.pid, name: link.name, exp: link.exp, secret: link.secret };
    });
  },
  async revokeLink(db, lid) {
    return guard(async () => {
      const { svc } = await handle(db);
      await svc.revokeLabLink(lid, "tarayıcı testi iptali");
      return { revoked: true };
    });
  },
  // entries: ham SP1 kayıt nesneleri; cfgOverride: { ls:null | başka anahtar, lid, p } — red senaryoları için
  async makeSp1(db, lid, entries, cfgOverride = {}) {
    return guard(async () => {
      const { store } = await handle(db);
      const link = lid ? await store.get("links", lid) : null;
      const base = link
        ? { p: [link.pid, link.name], lid: link.lid, ls: link.secret }
        : { p: ["TEST-P-BT", "TEST-Şoför BT"], lid: lid || "lnk_yok", ls: randomB64(16) }; // tanınmayan bağlantı
      const cfg = {
        V: [["TEST-V-BT", "TEST-34 BT 01"]],
        C: [["TEST-C-BT", "TEST-Müşteri BT"]],
        S: [["TEST-S-BT", "TEST-Şantiye BT", "TEST-C-BT", "", ""]],
        D: [], E: [], Y: null,
        ...base, ...cfgOverride,
      };
      return { message: await driverMessage(entries, cfg) };
    });
  },
  async intakeSp1(db, text) {
    return guard(async () => {
      const { svc } = await handle(db);
      return await svc.intakeSp1Message(text);
    });
  },
  async attachMedia(db, id, items, confirmed, v) {
    return guard(async () => {
      const { svc } = await handle(db);
      const r = await svc.attachMedia(id,
        (items || []).map((a) => ({ name: a.name, bytes: new Uint8Array(a.bytes) })),
        { confirmed: !!confirmed, actor: OFIS }, v);
      return { state: r.state, version: r.version, media: r.media };
    });
  },
  // ---- akış geçişleri ----
  async startCheck(db, id, v) {
    return guard(async () => {
      const { svc } = await handle(db);
      const r = await svc.startCheck(id, OFIS, v);
      return { state: r.state, version: r.version };
    });
  },
  async completeCheck(db, id, v) {
    return guard(async () => {
      const { svc } = await handle(db);
      const r = await svc.completeCheck(id, OFIS, v);
      return { state: r.state, version: r.version, rev_no: r.rev_no };
    });
  },
  async edit(db, id, patch, v, reason = "tarayıcı testi düzeltmesi") {
    return guard(async () => {
      const { svc } = await handle(db);
      const r = await svc.editFields(id, patch, OFIS, v, { reason });
      return { state: r.state, version: r.version, rev_no: r.rev_no };
    });
  },
  async approve(db, id, v, revNo, failAt) {
    return guard(async () => {
      const { svc } = await handle(db);
      const out = await svc.approve(id, YON, v, revNo, failAt ? { failAt } : {});
      return { result: out.result, workId: out.work && out.work.id, approvalId: out.approval && out.approval.id };
    });
  },
  async get(db, id) {
    return guard(async () => {
      const { store } = await handle(db);
      const r = await store.get("reports", id);
      if (!r) return null;
      let rawText = null;
      const sid = (r.source_ids || [])[0];
      if (sid) { const s = await store.get("sources", sid); rawText = s ? s.raw_text : null; }
      return {
        id: r.id, state: r.state, version: r.version, rev_no: r.rev_no,
        last_tech_error: r.last_tech_error || null, rawText,
        media: r.media || null, sourceCount: (r.source_ids || []).length,
      };
    });
  },
  async snapshot(db) {
    return guard(async () => {
      const { store } = await handle(db);
      const [reports, works, approvals, attachments, audit, sources, rejections, links] = await Promise.all([
        store.all("reports"), store.all("works"), store.all("approvals"), store.all("attachments"),
        store.all("audit"), store.all("sources"), store.all("rejections"), store.all("links"),
      ]);
      return {
        reports: reports.map((r) => ({ id: r.id, state: r.state, version: r.version, rev_no: r.rev_no, last_tech_error: r.last_tech_error || null })),
        works: works.length, approvals: approvals.length,
        attachments: attachments.map((a) => ({ name: a.name, work_id: a.work_id })),
        audit: audit.length,
        sources: sources.length, rejections: rejections.length, links: links.length,
      };
    });
  },
  // ---- ana uygulama davranış probu (izolasyon kanıtı; grep değil, davranış karşılaştırması) ----
  // Ana DB'nin store sayıları, meta anahtarları, localStorage ve Cache API içeriği önce/sonra
  // birebir karşılaştırılır. Prob VAR OLAN veritabanını açar (sürüm belirtmez — asla yaratmaz/
  // yükseltmez); listede yoksa sayım yapılmaz.
  async probeMain(mainDbName) {
    return guard(async () => {
      const dbs = (await indexedDB.databases()).map((d) => d.name).sort();
      const out = { databases: dbs, main: null, localStorage: { ...localStorage }, caches: {} };
      if (dbs.includes(mainDbName)) {
        const db = await new Promise((res, rej) => {
          const r = indexedDB.open(mainDbName);
          r.onsuccess = () => res(r.result);
          r.onerror = () => rej(r.error);
        });
        const counts = {}; let metaKeys = [];
        for (const s of db.objectStoreNames) {
          counts[s] = await new Promise((res, rej) => {
            const t = db.transaction(s, "readonly");
            const rq = t.objectStore(s).count();
            rq.onsuccess = () => res(rq.result); rq.onerror = () => rej(rq.error);
          });
          if (s === "meta")
            metaKeys = await new Promise((res, rej) => {
              const t = db.transaction(s, "readonly");
              const rq = t.objectStore(s).getAllKeys();
              rq.onsuccess = () => res(rq.result.map(String).sort()); rq.onerror = () => rej(rq.error);
            });
        }
        db.close();
        out.main = { counts, metaKeys };
      }
      if (globalThis.caches) {
        for (const k of (await caches.keys()).sort())
          out.caches[k] = (await (await caches.open(k)).keys()).length;
      }
      return out;
    });
  },
  async deleteDb(db) {
    return guard(async () => {
      const h = regs.get(db);
      if (h) { h.store.close(); regs.delete(db); }
      await deleteFlowDB(db);
      return { deleted: true };
    });
  },
};
window.__FT_READY = true;
