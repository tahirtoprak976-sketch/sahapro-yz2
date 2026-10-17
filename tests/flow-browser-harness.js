// Tarayıcı test köprüsü — GERÇEK IndexedDB'de flow servisini dışa açar.
// Playwright bu sayfayı aynı origin'de İKİ GERÇEK SEKME olarak açar; sekmeler aynı
// veritabanını paylaşır (aynı browser context = aynı profil = aynı IndexedDB).
// Hata enjeksiyonu (failAt) yalnız test içindir: servis katmanındaki 'work' |
// 'attachment' | 'approval' | 'audit' | 'attachments' noktalarında tx İÇİNDE hata fırlatır.
import { FlowStore, deleteFlowDB } from "../js/flow-store.js";
import { makeFlowConfig, labIdentity } from "../js/flow-identity.js";
import { createFlowService } from "../js/flow-service.js";

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
  async edit(db, id, patch, v) {
    return guard(async () => {
      const { svc } = await handle(db);
      const r = await svc.editFields(id, patch, OFIS, v);
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
      return r ? { id: r.id, state: r.state, version: r.version, rev_no: r.rev_no, last_tech_error: r.last_tech_error || null, rawText: r.source.rawText } : null;
    });
  },
  async snapshot(db) {
    return guard(async () => {
      const { store } = await handle(db);
      const [reports, works, approvals, attachments, audit] = await Promise.all([
        store.all("reports"), store.all("works"), store.all("approvals"), store.all("attachments"), store.all("audit"),
      ]);
      return {
        reports: reports.map((r) => ({ id: r.id, state: r.state, version: r.version, rev_no: r.rev_no, last_tech_error: r.last_tech_error || null })),
        works: works.length, approvals: approvals.length,
        attachments: attachments.map((a) => ({ name: a.name, work_id: a.work_id })),
        audit: audit.length,
      };
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
