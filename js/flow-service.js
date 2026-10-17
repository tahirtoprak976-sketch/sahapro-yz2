// SAHAPRO YZ2 — onay akışı servis katmanı (orkestrasyon).
// Kurallar flow-core.js'te (saf), yazma flow-store.js'te (tek transaction), kimlik flow-identity.js'te.
// Bu katman yalnız bunları birbirine bağlar; kendi başına iş kuralı İÇERMEZ.
//
// Sözleşmeler:
//  - Yeniden deneme güvenliği: aynı op-key + aynı içerik → mevcut sonuç döner (asla ikinci kayıt yok).
//  - Atomik onay: iş + ek ilişkisi + onay + durum + audit TEK transaction'da; hata = hiçbiri yazılmaz.
//  - Ek hazırlığı (hash/boyut) transaction DIŞINDA yapılır (prepareAttachment).
//  - Ham kaynak değişmez; düzeltmeler yeni revizyondur; içerik değişimi eski kontrolü geçersizleştirir.

import * as core from "./flow-core.js";
import { linkVerdict } from "./flow-identity.js";

const err = (code, detail) => { const e = Error(detail || code); e.code = code; return e; };
const raise = (r) => { if (!r.ok) throw err(r.code, r.detail); };

export function createFlowService({ store, config, uuid, now, subtle }) {
  uuid = uuid || (() => globalThis.crypto.randomUUID());
  now = now || (() => new Date().toISOString());
  subtle = subtle || globalThis.crypto?.subtle;

  async function sha256hex(text) {
    const buf = await subtle.digest("SHA-256", new TextEncoder().encode(text));
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
  }

  // ---- ek hazırlığı: TX DIŞI (F maddesi). Dönen nesne finalize tx'ine hazır girer.
  async function prepareAttachment(bytes, name = "") {
    if (!(bytes instanceof Uint8Array)) throw err(core.ERR.PACKET_INVALID, "Ek bayt dizisi olmalı");
    const buf = await subtle.digest("SHA-256", bytes);
    return {
      id: uuid(), name,
      hash: [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join(""),
      size: bytes.length, bytes,
    };
  }

  function auditRow(reportId, actor, action, from, to, reason) {
    return { id: uuid(), report_id: reportId, actor_id: actor.id, role: actor.role, action, from: from || null, to: to || null, reason: reason || "", at: now() };
  }

  // ---- paket doğrulama: zorunlu alanlar (lab sözleşmesi; imza/HMAC security-core'da kalır)
  function validatePacket(p) {
    if (!p || typeof p !== "object") return core.ERR.PACKET_INVALID;
    if (!p.linkId || !p.entryId) return core.ERR.PACKET_INVALID;
    const f = p.fields || {};
    if (!f.date || !f.vehicle_id || !f.work_type || !(Number(f.quantity) > 0)) return core.ERR.PACKET_INVALID;
    return null;
  }

  // ============================ ALIM (şoför bildirimi geldi) ============================
  // packet: { linkId, entryId, fields, rawText, attachments?: [{name, bytes}] }
  //   packet'in taşıma meta'sı (sent_at, retry_no, kanal...) BİLİNÇLİ okunmaz:
  //   fingerprint sözleşmesi gereği yeniden gönderim sahte OP_CONFLICT üretmemeli.
  // related: fork ile açılıyorsa { type:'yeni_is', from, reason }
  // opts.failAt: yalnız testler için hata enjeksiyonu ('attachments' = ek yazım tx'i).
  async function intakePacket(packet, opts = {}) {
    const bad = validatePacket(packet);
    if (bad) throw err(bad, "Zorunlu alanlar eksik (date/vehicle_id/work_type/quantity)");
    const lv = linkVerdict(config, packet.linkId);
    if (!lv.ok) throw err(lv.code, lv.detail); // tanınmayan/iptalli bağlantı: rapor AÇILMAZ

    // Ek hazırlığı (içerik hash'i) tx DIŞI ve rapor açılmadan ÖNCE (F maddesi):
    // hash'ler fingerprint'e gireceği için karar anında hazır olmalı. Biçimi bozuk ek
    // (Uint8Array olmayan) PACKET_INVALID'dir — rapor AÇILMAZ, yarım kayıt kalmaz.
    const prepared = [];
    for (const a of packet.attachments || []) prepared.push(await prepareAttachment(a.bytes, a.name));

    const opKey = core.opKeyOf({ tenant: config.tenant, linkId: packet.linkId, entryId: packet.entryId });
    const fingerprint = await sha256hex(core.fingerprintPayload({
      fields: packet.fields,
      rawText: packet.rawText || "",
      attachmentHashes: prepared.map((p) => p.hash), // sıra korunur — ek sırası da içeriktir
    }));

    const existing = await store.byIndex("reports", "op_key", opKey);
    // Teknik hataya düşmüş kayıt aynı içerikle gelirse: yeniden dene (T11), yeni kayıt AÇMA.
    if (existing && existing.state === "teknik_hata" && existing.fingerprint === fingerprint)
      return resumeFromTechError(existing, packet, prepared);

    const dec = core.opKeyDecision(existing, fingerprint);
    if (!dec.ok) throw err(dec.code, dec.detail);              // OP_CONFLICT — sessiz birleştirme yok
    if (dec.action === "return-existing") return { result: "existing", report: dec.report };

    // Rapor + değişmez kaynak + revizyon 0 + audit: TEK TRANSACTION.
    const report = {
      id: uuid(), op_key: opKey, fingerprint,
      state: "gonderildi", version: 0, rev_no: 0,
      link_id: packet.linkId, entry_id: packet.entryId, tenant: config.tenant,
      source: { rawText: packet.rawText || "", received_at: now() }, // değişmez ham kaynak
      check: null, approved: null, related_to: opts.related || null,
      created_at: now(),
    };
    const rev0 = { id: uuid(), report_id: report.id, rev_no: 0, fields: { ...packet.fields }, edited_by: "kaynak", at: now() };
    try {
      await store.tx(["reports", "revisions", "audit"], async (x) => {
        await x.add("reports", report);           // unique op_key: yarışta ikinci yazım ConstraintError → abort
        await x.add("revisions", rev0);
        await x.put("audit", auditRow(report.id, { id: "kaynak", role: "sistem" }, "intake", null, "gonderildi"));
      });
    } catch (e) {
      // Paralel alım yarışı: kaydı diğeri açmış — mevcut sonucu döndür (çift kayıt yok).
      if (e && e.name === "ConstraintError") {
        const ex = await store.byIndex("reports", "op_key", opKey);
        if (ex) return { result: "existing", report: ex };
      }
      throw e;
    }

    // Eklerin YAZIMI ayrı tx (baytlar hash'lenmişti, tx dışı hazır). Yazım hatası → T10 teknik_hata
    // (iş reddi değil!); aynı paketle yeniden deneme resume eder.
    if (prepared.length)
      try {
        await store.tx(["attachments", "audit"], async (x) => {
          if (opts.failAt === "attachments") throw err("INJECTED", "ek yazımı hatası (test)");
          for (const p of prepared) await x.put("attachments", { ...p, report_id: report.id, work_id: null });
          await x.put("audit", auditRow(report.id, { id: "kaynak", role: "sistem" }, "attachments_attached", "gonderildi", "gonderildi", prepared.length + " ek"));
        });
      } catch (e) {
        // Yarış korumalı: rapor bizim bıraktığımız gonderildi/v0'dan ilerletildiyse not yazma.
        await markTechError(report.id, "Ek yazım hatası: " + e.message, { state: "gonderildi", version: report.version });
        return { result: "tech_error", report: await store.get("reports", report.id) };
      }
    return { result: "created", report: await store.get("reports", report.id) };
  }

  // Teknik hata kaydı da YARIŞ KORUMALI yazılır:
  //  - expect {state, version} verildiyse kayıt hâlâ öyleyse yaz; değilse SKIP
  //    (başka sekme ilerletmiştir — geç kalan hata notu güncel durumu kirletmez).
  //  - Final durumlar (onaylandi/iptal) ASLA teknik_hata'ya düşmez; not bile yazılmaz.
  //  - findTransition yalnız T10'a (gonderildi→teknik_hata) izin verir; diğer durumlarda
  //    durum DEĞİŞMEZ, yalnız not düşülür.
  async function markTechError(reportId, message, expect) {
    return store.tx(["reports", "audit"], async (x) => {
      const r = await x.get("reports", reportId);
      if (!r) throw err(core.ERR.PACKET_INVALID, "Rapor yok: " + reportId);
      if (expect) {
        if (expect.state !== undefined && r.state !== expect.state) return { skipped: "state", state: r.state, version: r.version };
        if (expect.version !== undefined && r.version !== expect.version) return { skipped: "version", state: r.state, version: r.version };
      }
      if (r.state === "onaylandi" || r.state === "iptal") return { skipped: "final", state: r.state, version: r.version };
      const t = core.findTransition(r.state, "teknik_hata");
      const from = r.state;
      if (t) { r.state = "teknik_hata"; r.version++; }
      r.last_tech_error = message;
      await x.put("reports", r);
      await x.put("audit", auditRow(reportId, { id: "sistem", role: "sistem" }, "tech_error", from, t ? "teknik_hata" : from, message));
      return { skipped: null, state: r.state, version: r.version };
    });
  }

  // T11: aynı op-key + aynı içerikle yeniden deneme — hazırlanmış ekleri yaz, durumu gonderildi'ye çek.
  async function resumeFromTechError(existing, packet, prepared) {
    await store.tx(["reports", "attachments", "audit"], async (x) => {
      const r = await x.get("reports", existing.id);
      raise(core.assertVersion(r, existing.version));
      const guard = core.canTransition(r, "gonderildi", { id: "sistem", role: "sistem" });
      raise(guard);
      for (const p of prepared) await x.put("attachments", { ...p, report_id: r.id, work_id: null });
      r.state = "gonderildi"; r.version++; delete r.last_tech_error;
      await x.put("reports", r);
      await x.put("audit", auditRow(r.id, { id: "sistem", role: "sistem" }, "resume", "teknik_hata", "gonderildi"));
    });
    return { result: "resumed", report: await store.get("reports", existing.id) };
  }

  // ============================ GEÇİŞLER ============================
  async function transition(reportId, to, actor, expectedVersion, { reason = "", mutate } = {}) {
    return store.tx(["reports", "audit"], async (x) => {
      const r = await x.get("reports", reportId);
      if (!r) throw err(core.ERR.PACKET_INVALID, "Rapor yok: " + reportId);
      raise(core.assertVersion(r, expectedVersion));
      raise(core.canTransition(r, to, actor, config, { reason }));
      const from = r.state;
      r.state = to; r.version++;
      if (mutate) await mutate(x, r);
      await x.put("reports", r);
      await x.put("audit", auditRow(reportId, actor, to, from, to, reason));
      return r;
    });
  }

  const startCheck = (id, actor, v) => transition(id, "kontrolde", actor, v);

  // Ofis kontrolü tamam: kontrol kaydı (rev + aktör + zaman) rapora yazılır.
  const completeCheck = (id, actor, v) =>
    transition(id, "onay_bekliyor", actor, v, {
      mutate: async (x, r) => { r.check = { actor_id: actor.id, rev_no: r.rev_no, at: now(), revoked: false }; },
    });

  const requestCorrection = (id, note, actor, v) => transition(id, "duzeltme_istendi", actor, v, { reason: note });

  // Kaynaktan yeni revizyon geldi (düzeltme_istendi → kontrolde): rev_no artar, kaynak üzerine yazılmaz.
  async function submitRevision(id, fields, actor, v) {
    return store.tx(["reports", "revisions", "audit"], async (x) => {
      const r = await x.get("reports", id);
      raise(core.assertVersion(r, v));
      raise(core.canTransition(r, "kontrolde", actor, config));
      const rev = { id: uuid(), report_id: id, rev_no: r.rev_no + 1, fields: { ...fields }, edited_by: actor.id, at: now() };
      await x.put("revisions", rev);
      const from = r.state;
      r.rev_no = rev.rev_no; r.state = "kontrolde"; r.version++;
      await x.put("reports", r);
      await x.put("audit", auditRow(id, actor, "revision", from, "kontrolde", "yeni revizyon r" + rev.rev_no));
      return r;
    });
  }

  // Ofis alan düzeltmesi: kaynak metnin ÜZERİNE YAZILMAZ — yeni revizyon.
  // İçerik değiştiği için bekleyen/geçerli kontrol geçersizleşir; onay_bekliyor'daysa T12 ile geri düşer.
  async function editFields(id, patch, actor, v) {
    return store.tx(["reports", "revisions", "audit"], async (x) => {
      const r = await x.get("reports", id);
      raise(core.assertVersion(r, v));
      raise(core.editablePatch(r, patch));
      const all = await x.allByIndex("revisions", "report_id", id);
      const latest = all.sort((a, b) => a.rev_no - b.rev_no).at(-1);
      const rev = { id: uuid(), report_id: id, rev_no: r.rev_no + 1, fields: { ...latest.fields, ...patch }, edited_by: actor.id, at: now() };
      await x.put("revisions", rev);
      const inv = core.invalidationPlan(r);
      if (inv.revokeCheck && r.check) {
        r.check = { ...r.check, revoked: true, revoked_at: now() };
        await x.put("audit", auditRow(id, actor, "check_revoked", r.state, r.state, "içerik değişti — kontrol geçersiz"));
      }
      if (inv.autoTransition) {
        const from = r.state;
        r.state = inv.autoTransition.to;
        await x.put("audit", auditRow(id, { id: "sistem", role: "sistem" }, inv.autoTransition.id, from, r.state, "içerik değişti"));
      }
      r.rev_no = rev.rev_no; r.version++;
      await x.put("reports", r);
      await x.put("audit", auditRow(id, actor, "edit", r.state, r.state, Object.keys(patch).join(",")));
      return r;
    });
  }

  // ============================ ONAY (atomik finalize) ============================
  // Tek transaction: iş + ek ilişkilendirme + onay kaydı + durum + audit.
  // Yeniden deneme: state zaten onaylandi → mevcut iş+onay döner (ikinci kayıt ASLA açılmaz).
  // opts.failAt: yalnız testler için hata enjeksiyonu ('work'|'attachment'|'approval'|'audit').
  async function approve(id, actor, expectedVersion, revNo, opts = {}) {
    const pre = await store.get("reports", id);
    if (!pre) throw err(core.ERR.PACKET_INVALID, "Rapor yok: " + id);
    if (pre.state === "onaylandi") return existingApproval(pre); // idempotent kısa yol
    let seen = null; // başarısız tx'in gördüğü durum/sürüm — geç kalan not yazımının referansı
    try {
      const out = await store.tx(["reports", "revisions", "approvals", "works", "attachments", "audit"], async (x) => {
        const r = await x.get("reports", id);
        if (r.state === "onaylandi") return { result: "existing", work: await x.byIndex("works", "op_key", r.op_key), approval: await x.byIndex("approvals", "op_key", r.op_key) };
        seen = { state: r.state, version: r.version };
        raise(core.assertVersion(r, expectedVersion));
        raise(core.canTransition(r, "onaylandi", actor, config));
        if (r.rev_no !== revNo) throw err(core.ERR.REV_MISMATCH, "onaylanan r" + revNo + ", güncel r" + r.rev_no);
        const dupWork = await x.byIndex("works", "op_key", r.op_key);
        if (dupWork) return { result: "existing", work: dupWork, approval: await x.byIndex("approvals", "op_key", r.op_key) };

        const revs = await x.allByIndex("revisions", "report_id", id);
        const latest = revs.sort((a, b) => a.rev_no - b.rev_no).at(-1);

        const work = {
          id: uuid(), op_key: r.op_key, report_id: r.id, source_rev: r.rev_no,
          fields: { ...latest.fields },            // ONAYLANAN ALANLARIN snapshot'ı
          status: "aktif", finalized_links: [],    // ileride: hakedis/tahsilat bağları buraya
          created_at: now(),
        };
        if (opts.failAt === "work") throw err("INJECTED", "iş yazımı hatası (test)");
        await x.put("works", work);

        const atts = await x.allByIndex("attachments", "report_id", id);
        for (const a of atts) {
          if (opts.failAt === "attachment") throw err("INJECTED", "ek yazımı hatası (test)");
          await x.put("attachments", { ...a, work_id: work.id }); // bağlantısız ek kalmaz
        }

        const approval = {
          id: uuid(), report_id: r.id, op_key: r.op_key, rev_no: r.rev_no,
          snapshot: { ...work.fields },            // onay anındaki içerik
          actor_id: actor.id, role: actor.role, at: now(),
        };
        if (opts.failAt === "approval") throw err("INJECTED", "onay kaydı hatası (test)");
        await x.put("approvals", approval);

        const from = r.state;
        r.state = "onaylandi"; r.version++;
        r.approved = { approval_id: approval.id, work_id: work.id, at: now() };
        await x.put("reports", r);

        if (opts.failAt === "audit") throw err("INJECTED", "audit yazımı hatası (test)");
        await x.put("audit", auditRow(id, actor, "onaylandi", from, "onaylandi", "r" + r.rev_no));
        return { result: "approved", work, approval };
      });
      return out;
    } catch (e) {
      // Hata = hiçbir şey yazılmadı (abort). Durum onay_bekliyor KALIR.
      // GEÇ KALAN hata notu YARIŞ KORUMALIDIR:
      //   - kayıt bu arada onaylandi/iptal olduysa (başka sekme kazandı) not YAZILMAZ —
      //     kazanan işlem asla teknik_hata notuyla kirlenmez, durumu asla düşürülmez.
      //   - durum/sürüm bizim gördüğümüzden ilerlediyse (düzenleme, başka geçiş) not YAZILMAZ —
      //     bizim hatamız artık güncel kaydın bağlamı değildir.
      await store.tx(["reports"], async (x) => {
        const r = await x.get("reports", id);
        if (!r) return;
        if (r.state === "onaylandi" || r.state === "iptal") return;
        if (seen && (r.version !== seen.version || r.state !== seen.state)) return;
        r.last_tech_error = e.message;
        await x.put("reports", r);
      });
      throw e;
    }
  }

  async function existingApproval(report) {
    return {
      result: "existing",
      work: await store.byIndex("works", "op_key", report.op_key),
      approval: await store.byIndex("approvals", "op_key", report.op_key),
    };
  }

  // ============================ RED / İPTAL ============================
  const reject = (id, reason, actor, v) => transition(id, "reddedildi", actor, v, { reason });

  // Onay sonrası iptal (G): bağlı kesinleşmiş kayıt varsa BLOKE. İş kaydı SİLİNMEZ;
  // basit "status=iptal" yazımı ancak hiç kesinleşmiş bağ yoksa ve gerekçeyle yapılır.
  async function cancel(id, reason, actor, v) {
    return store.tx(["reports", "works", "audit"], async (x) => {
      const r = await x.get("reports", id);
      raise(core.assertVersion(r, v));
      const work = await x.byIndex("works", "op_key", r.op_key);
      const finalizedCount = (work?.finalized_links || []).filter((l) => l.status === "Kesinleşti").length;
      raise(core.canCancel(r, { finalizedCount }));
      raise(core.canTransition(r, "iptal", actor, config, { reason }));
      const from = r.state;
      r.state = "iptal"; r.version++;
      await x.put("reports", r);
      if (work) { work.status = "iptal"; work.cancelled = { by: actor.id, reason, at: now() }; await x.put("works", work); }
      await x.put("audit", auditRow(id, actor, "iptal", from, "iptal", reason));
      return r;
    });
  }

  // ============================ "FARKLI KAYIT OLARAK AÇ" (fork) ============================
  // Eski işlem anahtarının engelini AŞMAZ: yeni iş = yeni kimlik + gerekçe + kaynak ilişkisi.
  async function forkAsNewJob(originalOpKey, packet, reason) {
    const newKey = core.opKeyOf({ tenant: config.tenant, linkId: packet.linkId, entryId: packet.entryId });
    raise(core.forkDecision({ originalKey: originalOpKey, newKey, reason }));
    return intakePacket(packet, { related: { type: "yeni_is", from: originalOpKey, reason } });
  }

  return {
    intakePacket, prepareAttachment, markTechError,
    startCheck, completeCheck, requestCorrection, submitRevision, editFields,
    approve, reject, cancel, forkAsNewJob,
  };
}
