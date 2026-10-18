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
import * as sp1 from "./flow-sp1.js";
import { randomB64 } from "./security-core.js";

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
  // packet: { linkId, entryId, fields, attachments?: [{name, bytes}],
  //           entry?: <ham SP1 kaydı>, entryIndex?: n, requiredMedia?: n,
  //           envelope?: <sp1.envelopeRecord çıktısı> }
  //   entry = iş İÇERİĞİ (fingerprint'e girer); envelope = teslim ZARFI (fingerprint'e GİRMEZ,
  //   sources store'da değişmez saklanır; aynı rapora birden çok zarf ilişkilenebilir).
  //   packet'in taşıma meta'sı (sent_at, retry_no, kanal...) BİLİNÇLİ okunmaz.
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

    // Zarf kaydı hazırlığı (hash tx DIŞI): SP1 ise kod özetiyle tekilleşir; manuel paketler
    // code_hash taşımaz (unique index'e girmez — her manuel alım kendi kaynak kaydını açar).
    let envelope = null;
    if (packet.envelope) envelope = { ...packet.envelope };
    else envelope = { kind: "manual", raw_text: packet.rawText || "", code: null, sig_status: "yok", link_id: packet.linkId, personnel_id: null, personnel_name: "", entry_count: 1 };
    envelope.code_hash = envelope.code ? await sha256hex(envelope.code) : null;

    const opKey = core.opKeyOf({ tenant: config.tenant, linkId: packet.linkId, entryId: packet.entryId });
    const fingerprint = await sha256hex(core.fingerprintPayload({
      fields: packet.fields,
      entry: packet.entry ?? null, // ham kayıt nesnesi — zarf DEĞİL
      attachmentHashes: prepared.map((p) => p.hash), // sıra korunur — ek sırası da içeriktir
    }));

    const existing = await store.byIndex("reports", "op_key", opKey);
    // Teknik hataya düşmüş kayıt aynı içerikle gelirse: yeniden dene (T11), yeni kayıt AÇMA.
    if (existing && existing.state === "teknik_hata" && existing.fingerprint === fingerprint) {
      const out = await resumeFromTechError(existing, packet, prepared);
      if (envelope.code_hash) await attachEnvelope(out.report.id, envelope);
      return out;
    }

    const dec = core.opKeyDecision(existing, fingerprint);
    if (!dec.ok) throw err(dec.code, dec.detail);              // OP_CONFLICT — sessiz birleştirme yok
    if (dec.action === "return-existing") {
      let rep = dec.report;
      // Aynı iş FARKLI zarfla tekrar geldi: içerik aynı → yeni rapor YOK; yeni zarf kanıt
      // zincirine eklenir (kayıt değişimi: version ilerler, audit'e düşülür).
      if (envelope.code_hash) rep = (await attachEnvelope(rep.id, envelope)).report;
      const w = await store.byIndex("works", "op_key", opKey);
      return { result: "existing", report: rep, workId: w ? w.id : null };
    }

    // Rapor + değişmez kaynak(zarf) + revizyon 0 + audit: TEK TRANSACTION.
    const report = {
      id: uuid(), op_key: opKey, fingerprint,
      state: "gonderildi", version: 0, rev_no: 0,
      link_id: packet.linkId, entry_id: packet.entryId, tenant: config.tenant,
      source_ids: [],                          // zarf kanıtları (sources store)
      entry_index: packet.entryIndex ?? null,  // paket içindeki sıra (kayıt amaçlı — eşleşme kanıtı DEĞİL)
      media: { required: packet.requiredMedia || 0, attached: prepared.length, confirmed: false },
      check: null, approved: null, related_to: opts.related || null,
      created_at: now(),
    };
    const rev0 = { id: uuid(), report_id: report.id, rev_no: 0, fields: { ...packet.fields }, edited_by: "kaynak", at: now(), changes: null, reason: "" };
    try {
      await store.tx(["reports", "revisions", "audit", "sources"], async (x) => {
        let srcId;
        if (envelope.code_hash) {
          const ex = await x.byIndex("sources", "code_hash", envelope.code_hash);
          if (ex) srcId = ex.id;
          else { srcId = uuid(); await x.add("sources", { id: srcId, ...envelope, received_at: now() }); }
        } else {
          srcId = uuid(); await x.add("sources", { id: srcId, ...envelope, received_at: now() });
        }
        report.source_ids = [srcId];
        await x.add("reports", report);           // unique op_key: yarışta ikinci yazım ConstraintError → abort
        await x.add("revisions", rev0);
        await x.put("audit", auditRow(report.id, { id: "kaynak", role: "sistem" }, "intake", null, "gonderildi"));
      });
    } catch (e) {
      // Paralel alım yarışı (op_key veya code_hash unique): kaydı/zarfı diğeri açmış —
      // mevcut sonucu döndür (çift kayıt yok).
      if (e && e.name === "ConstraintError") {
        const ex = await store.byIndex("reports", "op_key", opKey);
        if (ex) {
          if (envelope.code_hash) await attachEnvelope(ex.id, envelope);
          const w = await store.byIndex("works", "op_key", opKey);
          return { result: "existing", report: await store.get("reports", ex.id), workId: w ? w.id : null };
        }
      }
      throw e;
    }

    // Eklerin YAZIMI ayrı tx (baytlar hash'lenmişti, tx dışı hazır). Yazım hatası → T10 teknik_hata
    // (iş reddi değil!); aynı paketle yeniden deneme resume eder.
    if (prepared.length)
      try {
        await store.tx(["attachments", "audit"], async (x) => {
          if (opts.failAt === "attachments") throw err("INJECTED", "ek yazımı hatası (test)");
          for (const p of prepared) await x.put("attachments", { ...p, report_id: report.id, work_id: null, origin: "kaynak" });
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
      for (const p of prepared) await x.put("attachments", { ...p, report_id: r.id, work_id: null, origin: "kaynak" });
      r.state = "gonderildi"; r.version++; delete r.last_tech_error;
      await x.put("reports", r);
      await x.put("audit", auditRow(r.id, { id: "sistem", role: "sistem" }, "resume", "teknik_hata", "gonderildi"));
    });
    return { result: "resumed", report: await store.get("reports", existing.id) };
  }

  // Aynı içerik YENİ zarfla tekrar geldi: zarfı bul/oluştur ve raporun kanıt zincirine bağla.
  // Rapor içeriği değişmez; yalnız source_ids uzar + audit düşülür. Zarf aynıysa (code_hash
  // eşleşir) hiçbir şey yazılmaz. Yarış: iki sekme aynı yeni zarfı bağlarken unique index birini
  // abort eder → çağıran bir kez yeniden dener (ikinci denemede byIndex bulur).
  async function attachEnvelope(reportId, envelope) {
    for (let attempt = 0; ; attempt++) {
      try {
        return await store.tx(["reports", "sources", "audit"], async (x) => {
          const r = await x.get("reports", reportId);
          if (!r) throw err(core.ERR.PACKET_INVALID, "Rapor yok: " + reportId);
          let src = envelope.code_hash ? await x.byIndex("sources", "code_hash", envelope.code_hash) : null;
          if (!src) { src = { id: uuid(), ...envelope, received_at: now() }; await x.add("sources", src); }
          if ((r.source_ids || []).includes(src.id)) return { report: r, linked: false };
          r.source_ids = [...(r.source_ids || []), src.id];
          r.version++;
          await x.put("reports", r);
          await x.put("audit", auditRow(r.id, { id: "kaynak", role: "sistem" }, "yeniden_gonderim", r.state, r.state,
            "aynı içerik yeni teslim zarfıyla alındı (kod özeti " + String(envelope.code_hash || "—").slice(0, 12) + "…) — içerik değişmedi"));
          return { report: r, linked: true };
        });
      } catch (e) {
        if (e && e.name === "ConstraintError" && attempt === 0) continue; // zarf yarışı — bir kez daha dene
        throw e;
      }
    }
  }

  // ============================ LAB ŞOFÖR BAĞLANTILARI ============================
  // Bağlantılar + imza anahtarları YALNIZ lab veritabanının 'links' store'unda yaşar.
  // Ana uygulamanın 'driver_links' meta kaydına veya ana DB'ye ASLA bakılmaz; üretim anahtarı
  // koda GÖMÜLMEZ — her anahtar bu cihazda, bu lab için üretilir.
  async function createLabLink({ pid, name, vid = null, days = 180 }) {
    if (!pid || !name) throw err(core.ERR.PACKET_INVALID, "Bağlantı için personel kimliği (pid) ve ad gerekli");
    const lid = randomB64(9), secret = randomB64(16);
    const issued = new Date().toISOString().slice(0, 10);
    const ex = new Date(issued + "T12:00:00Z"); ex.setUTCDate(ex.getUTCDate() + (Number(days) || 180));
    const link = { lid, pid, name, vid, issued, exp: ex.toISOString().slice(0, 10), secret, revoked_at: null, revoke_reason: null, last_seen: null, msgs: 0, lab: true };
    await store.tx(["links"], (x) => x.add("links", link));
    // Şoför tarafına giden paket (ana uygulamadaki newDriverLink ile aynı biçim)
    return { link, forDriver: { lid, ls: secret, exp: link.exp } };
  }

  async function revokeLabLink(lid, reason = "Lab: iptal edildi") {
    return store.tx(["links"], async (x) => {
      const l = await x.get("links", lid);
      if (!l) throw err(core.ERR.LINK_UNKNOWN, "Bağlantı yok: " + lid);
      if (l.revoked_at) return l;
      l.revoked_at = now(); l.revoke_reason = reason;
      await x.put("links", l);
      return l;
    });
  }

  const listLabLinks = () => store.all("links");

  // ============================ SP1 MESAJ ALIMI ============================
  // Yapıştırılan metindeki SP1 paketlerini doğrular ve entry başına AYRI bildirim açar.
  // Paket kapısı (imza/bağlantı/personel/süre/iptal) GEÇEMEZSE: hiçbir entry işlenmez, rapor
  // AÇILMAZ, okunur metinden alternatif iş ÜRETİLMEZ; red kanıtı 'rejections'a yazılır.
  // Paket otomatik ONAYLANMAZ — tüm entry'ler 'gonderildi' durumunda ofis incelemesi bekler.
  // Dönüş: { packets: [...], entries: [...], accepted, rejected, skipped } (red bir SONUÇTUR, throw değil).
  async function intakeSp1Message(rawText, opts = {}) {
    const payloads = await sp1.extractPayloads(rawText);
    if (!payloads.length) throw err(core.ERR.PACKET_INVALID, "Metinde açılabilen SP1 kodu bulunamadı (bozuk ya da eksik kopyalanmış olabilir)");
    const today = opts.today || new Date().toISOString().slice(0, 10);
    const out = { packets: [], entries: [], accepted: 0, rejected: 0, skipped: 0 };
    for (const p of payloads) {
      const link = p.lid ? await store.get("links", p.lid) : null;
      const gate = await sp1.verifyPacketGate(p, link, { today });
      if (!gate.ok) {
        // kanıt: red kaydı (hash hesabı tx DIŞI — F maddesi)
        const rejHash = p._code ? "sha256:" + (await sha256hex(p._code)).slice(0, 24) : null;
        await store.tx(["rejections"], (x) => x.put("rejections", {
          id: uuid(), at: now(), link_id: p.lid || null, personnel_id: p.p || null, personnel_name: p.n || "",
          code_hash: rejHash, reason_code: gate.code, reason: gate.reason, entry_count: Array.isArray(p.e) ? p.e.length : 0,
        }));
        out.rejected++;
        out.packets.push({ status: "rejected", lid: p.lid || null, code: gate.code, reason: gate.reason });
        continue;
      }
      // kabul edilen bağlantının sayacı (ana uygulamadaki gibi last_seen/msgs)
      await store.tx(["links"], async (x) => {
        const l = await x.get("links", link.lid);
        if (l) { l.last_seen = now(); l.msgs = (l.msgs || 0) + 1; await x.put("links", l); }
      });
      out.accepted++;
      const envelope = sp1.envelopeRecord(p, rawText);
      out.packets.push({ status: "accepted", lid: p.lid, entries: p.e.length, sig: envelope.sig_status });
      for (const [i, e] of p.e.entries()) {
        if (!sp1.isWorkEntry(e)) {
          out.skipped++;
          out.entries.push({ entryId: (e && e.id) || null, status: "skipped_kind", kind: sp1.kindLabel(e), reason: "lab kapsamı yalnız iş bildirimleri (" + sp1.kindLabel(e) + " kaydı işlenmedi)" });
          continue;
        }
        try {
          const res = await intakePacket({
            linkId: p.lid, entryId: e.id || "",
            fields: sp1.entryToFields(e),
            entry: e,                       // ham kayıt — fingerprint bunun üzerinden
            envelope, entryIndex: i,
            requiredMedia: sp1.requiredMedia(e),
            attachments: [],                // SP1 bayt taşımaz; medya eşleştirme ayrı adımdır
          });
          out.entries.push({ entryId: e.id, status: res.result, reportId: res.report.id, workId: res.workId || null });
        } catch (ex) {
          out.entries.push({ entryId: e.id || null, status: "error", code: ex.code || "ERR", reason: ex.message });
        }
      }
    }
    return out;
  }

  // ============================ MEDYA EŞLEŞTİRME ============================
  // Kaynak mesajda medya baytı gelmez; ofis bilahare ekleri bağlar. Eşleştirme KESİN değilse
  // kullanıcıya sorulur: confirmed ancak kullanıcının açık onayıyla true olur — fotoğraf SIRASI
  // tek başına kesin iş eşleştirmesi SAYILMAZ. Beyan edilen ek (media.required) tamamlanmadan
  // T3 (kontrol tamam) ATTACHMENT_MISSING ile reddedilir → iş onaya hazır görünmez.
  async function attachMedia(reportId, items, { confirmed = false, actor } = {}, expectedVersion) {
    const prepared = [];
    for (const a of items || []) prepared.push(await prepareAttachment(a.bytes, a.name));
    if (!prepared.length) throw err(core.ERR.PACKET_INVALID, "Eşleştirilecek ek yok");
    if (!actor) throw err(core.ERR.PACKET_INVALID, "Eşleştirme aktörü gerekli");
    return store.tx(["reports", "attachments", "audit"], async (x) => {
      const r = await x.get("reports", reportId);
      if (!r) throw err(core.ERR.PACKET_INVALID, "Rapor yok: " + reportId);
      raise(core.assertVersion(r, expectedVersion));
      if (!["gonderildi", "kontrolde"].includes(r.state))
        throw err(core.ERR.TRANSITION_DENIED, r.state + " durumunda ek eşleştirme yapılmaz (pencere: gonderildi/kontrolde — kontrol ancak eksik tamamlanınca kapanabilir)");
      for (const p of prepared) await x.put("attachments", { ...p, report_id: r.id, work_id: null, origin: "ofis-eslestirme" });
      const total = (await x.allByIndex("attachments", "report_id", r.id)).length;
      r.media = { required: (r.media && r.media.required) || 0, attached: total, confirmed: !!confirmed };
      r.version++;
      await x.put("reports", r);
      await x.put("audit", auditRow(r.id, actor, "media_attached", r.state, r.state,
        prepared.length + " ek eşleştirildi (toplam " + total + "/" + r.media.required + ") · kullanıcı eşleşme onayı: " + (confirmed ? "evet" : "HAYIR") + " · fotoğraf sırası tek başına kanıt sayılmaz"));
      return r;
    });
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
  // Her değişen alan eski/yeni değeriyle (changes) ve gerekçeyle revizyon kaydına işlenir —
  // "kim, neyi, neden değiştirdi" sonradan görülebilir.
  // İçerik değiştiği için bekleyen/geçerli kontrol geçersizleşir; onay_bekliyor'daysa T12 ile geri düşer.
  async function editFields(id, patch, actor, v, opts = {}) {
    return store.tx(["reports", "revisions", "audit"], async (x) => {
      const r = await x.get("reports", id);
      raise(core.assertVersion(r, v));
      raise(core.editablePatch(r, patch));
      const all = await x.allByIndex("revisions", "report_id", id);
      const latest = all.sort((a, b) => a.rev_no - b.rev_no).at(-1);
      const changes = {};
      for (const k of Object.keys(patch)) changes[k] = { from: latest.fields[k] ?? null, to: patch[k] };
      const rev = { id: uuid(), report_id: id, rev_no: r.rev_no + 1, fields: { ...latest.fields, ...patch }, edited_by: actor.id, at: now(), changes, reason: opts.reason || "" };
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
      const why = opts.reason && String(opts.reason).trim() ? String(opts.reason).trim() + " — " : "";
      await x.put("audit", auditRow(id, actor, "edit", r.state, r.state, why + Object.keys(patch).join(",")));
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
    intakePacket, intakeSp1Message, prepareAttachment, markTechError, attachEnvelope, attachMedia,
    createLabLink, revokeLabLink, listLabLinks,
    startCheck, completeCheck, requestCorrection, submitRevision, editFields,
    approve, reject, cancel, forkAsNewJob,
  };
}
