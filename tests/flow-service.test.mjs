// flow-service kabul testleri — H maddesindeki 12 senaryo + teknik hata/resume + fork.
// Gerçek IndexedDB anlambilimi: fake-indexeddb (transaction abort/serileşme dahil).
// NOT: Bu testler TEK CİHAZ laboratuvarıdır; çok cihazlı/sunucu senkronu bu dosyada "geçti" sayılmaz.
import { test } from "node:test";
import assert from "node:assert/strict";
import { indexedDB } from "fake-indexeddb";
import { FlowStore, deleteFlowDB, FLOW_DB_NAME } from "../js/flow-store.js";
import { makeFlowConfig, labIdentity } from "../js/flow-identity.js";
import { createFlowService } from "../js/flow-service.js";
import { ERR } from "../js/flow-core.js";

const OFIS = labIdentity("ofis1", "ofis");
const YON = labIdentity("yon1", "yonetici");
const YON2 = labIdentity("yon2", "yonetici");

let seq = 0;
const opened = [];
async function setup(cfg = {}) {
  const name = FLOW_DB_NAME + "_t" + ++seq + "_" + Date.now();
  const store = await FlowStore.open(name, indexedDB);
  opened.push({ store, name });
  const config = makeFlowConfig({ tenant: "yz2", knownLinks: ["lnk_1", "lnk_2"], ...cfg });
  const svc = createFlowService({ store, config });
  return { store, config, svc, name };
}
test.after(async () => {
  for (const { store } of opened) { try { store.close(); } catch (_) {} }       // önce TÜM bağlantılar
  for (const name of new Set(opened.map((o) => o.name))) await deleteFlowDB(name, indexedDB); // sonra sil
});

// TEST- etiketli örnek paket (gerçek kayıt değil)
function pkt(over = {}) {
  return {
    linkId: "lnk_1", entryId: "e1", rawText: "TEST- 34 ABC 01 Ümraniye şantiyesi 3 sefer hafriyat",
    fields: { date: "2026-10-18", vehicle_id: "v1", customer_id: "c1", site_id: "s1", work_type: "Hafriyat Nakliye", quantity: 3, unit: "Sefer" },
    ...over,
  };
}

// intake → kontrolde → onay_bekliyor; { report, version } döner
async function toApprovalReady(svc, packet = pkt()) {
  const inr = await svc.intakePacket(packet);
  assert.equal(inr.result, "created");
  const r1 = await svc.startCheck(inr.report.id, OFIS, inr.report.version);
  const r2 = await svc.completeCheck(inr.report.id, OFIS, r1.version);
  return { report: r2, id: inr.report.id };
}

const code = async (p) => { try { await p; return null; } catch (e) { return e.code || e.message; } };

// ── 1. Aynı paket iki kez gönderildi → tek sonuç ─────────────────────────────
test("H1: aynı paket iki kez → ikinci 'existing' döner, tek rapor açılır", async () => {
  const { svc, store } = await setup();
  const a = await svc.intakePacket(pkt());
  const b = await svc.intakePacket(pkt());
  assert.equal(a.result, "created");
  assert.equal(b.result, "existing");
  assert.equal(b.report.id, a.report.id);
  assert.equal((await store.all("reports")).length, 1);
});

// ── 2. Aynı işlem anahtarı + farklı içerik → çakışma ─────────────────────────
test("H2: aynı op-key farklı içerik → OP_CONFLICT, rapor tek kalır", async () => {
  const { svc, store } = await setup();
  await svc.intakePacket(pkt());
  const c = await code(svc.intakePacket(pkt({ fields: { ...pkt().fields, quantity: 5 } })));
  assert.equal(c, ERR.OP_CONFLICT);
  assert.equal((await store.all("reports")).length, 1);
});

// ── 3. İki sekme aynı anda onay → tek iş ─────────────────────────────────────
test("H3: iki bağlantı (sekme) aynı anda onaylar → tek iş, tek onay", async () => {
  const { svc, store, config, name } = await setup();
  const { id, report } = await toApprovalReady(svc);
  // ikinci "sekme": aynı DB'ye ikinci bağlantı + ikinci servis
  const store2 = await FlowStore.open(name, indexedDB);
  opened.push({ store: store2, name });
  const svc2 = createFlowService({ store: store2, config });
  const results = await Promise.allSettled([
    svc.approve(id, YON, report.version, report.rev_no),
    svc2.approve(id, YON2, report.version, report.rev_no),
  ]);
  const ok = results.filter((r) => r.status === "fulfilled").map((r) => r.value);
  assert.equal(ok.length, 2, "ikisi de hatasız döner (biri existing) — ama iş TEK olmalı");
  assert.equal(ok.filter((v) => v.result === "approved").length, 1, "tam bir onay");
  assert.equal(ok.filter((v) => v.result === "existing").length, 1, "diğeri mevcut sonucu görür");
  assert.equal((await store.all("works")).length, 1);
  assert.equal((await store.all("approvals")).length, 1);
});

// ── 4. Eski revizyona verilen onay → reddedilir ──────────────────────────────
test("H4: kontrol r0'a, içerik r1'e geçti → onay her katmanda reddedilir", async () => {
  const { svc } = await setup();
  const { id, report } = await toApprovalReady(svc); // rev0 kontrol edildi
  const r3 = await svc.editFields(id, { quantity: 4 }, OFIS, report.version); // içerik değişti
  assert.equal(r3.state, "kontrolde", "T12: onay_bekliyor iken değişiklik → kontrolde");
  assert.equal(r3.rev_no, 1);
  assert.equal(r3.check.revoked, true, "eski kontrol geçersiz");
  // Katman 1: kontrolde'ye düşmüş kayıt onaylanamaz (durum makinesi)
  assert.equal(await code(svc.approve(id, YON, r3.version, 0)), ERR.TRANSITION_DENIED, "eski kontrolle onay yok");
  assert.equal(await code(svc.approve(id, YON, r3.version, 1)), ERR.TRANSITION_DENIED, "kontrolde iken onay yok");
  // Katman 2: yeniden kontrol edilip onay_bekliyor'a alındıktan sonra bile ESKİ revizyon no ile onay reddedilir
  const r4 = await svc.completeCheck(id, OFIS, r3.version);
  assert.equal(await code(svc.approve(id, YON, r4.version, 0)), ERR.REV_MISMATCH, "r0 onayı reddedilir (güncel r1)");
});

// ── 5. Kontrol sonrası düzenleme → onay yeniden gerekir ──────────────────────
test("H5: düzenleme sonrası yeni kontrol + yeni revizyon onayı ile geçer", async () => {
  const { svc, store } = await setup();
  const { id, report } = await toApprovalReady(svc);
  const r3 = await svc.editFields(id, { quantity: 4 }, OFIS, report.version);
  const r4 = await svc.completeCheck(id, OFIS, r3.version);       // r1 yeniden kontrol
  const out = await svc.approve(id, YON, r4.version, 1);          // r1 onayı
  assert.equal(out.result, "approved");
  assert.equal(out.work.fields.quantity, 4, "onaylanan snapshot düzeltilmiş değeri taşır");
  assert.equal((await store.all("works")).length, 1);
});

// ── 6. Ek yazımı hatası → yarım iş oluşmaz ───────────────────────────────────
test("H6: finalize'da ek yazımı patlar → iş yok, onay yok, durum onay_bekliyor kalır", async () => {
  const { svc, store } = await setup();
  const p = pkt({ attachments: [{ name: "fis.jpg", bytes: new Uint8Array([1, 2, 3]) }] });
  const { id, report } = await toApprovalReady(svc, p);
  assert.equal((await store.all("attachments")).length, 1);
  const c = await code(svc.approve(id, YON, report.version, report.rev_no, { failAt: "attachment" }));
  assert.equal(c, "INJECTED");
  assert.equal((await store.all("works")).length, 0, "yarım iş YOK");
  assert.equal((await store.all("approvals")).length, 0, "yarım onay YOK");
  const r = await store.get("reports", id);
  assert.equal(r.state, "onay_bekliyor", "durum onaylandı OLMADI");
  assert.ok(r.last_tech_error, "teknik hata notu düşüldü");
  assert.equal((await store.all("attachments"))[0].work_id, null, "ek henüz işe bağlanmadı (rapora bağlı, sahipsiz değil)");
});

// ── 7. Audit/iş yazımı hatası → durum onaylandı kalmaz ───────────────────────
test("H7: audit veya iş yazımı patlar → tüm finalize geri alınır, onaylandı olmaz", async () => {
  for (const failAt of ["audit", "work", "approval"]) {
    const { svc, store } = await setup();
    const { id, report } = await toApprovalReady(svc);
    const c = await code(svc.approve(id, YON, report.version, report.rev_no, { failAt }));
    assert.equal(c, "INJECTED", failAt);
    assert.equal((await store.get("reports", id)).state, "onay_bekliyor", failAt + ": onaylandı olmadı");
    assert.equal((await store.all("works")).length, 0, failAt + ": iş yok");
    assert.equal((await store.all("approvals")).length, 0, failAt + ": onay yok");
    // yeniden deneme temiz çalışır (enjeksiyonsuz)
    const out = await svc.approve(id, YON, (await store.get("reports", id)).version, report.rev_no);
    assert.equal(out.result, "approved", failAt + ": retry başarılı");
  }
});

// ── 8. Uygulama kapanıp açılır → bekleyen işlem korunur ──────────────────────
test("H8: bağlantı kapanıp açılır → bekleyen bildirim ve durumu aynen durur", async () => {
  const { svc, store, config, name } = await setup();
  const inr = await svc.intakePacket(pkt());
  await svc.startCheck(inr.report.id, OFIS, inr.report.version);
  store.close(); // "uygulama kapandı"
  const store2 = await FlowStore.open(name, indexedDB); // "yeniden açıldı"
  opened.push({ store: store2, name });
  const svc2 = createFlowService({ store: store2, config });
  const r = await store2.get("reports", inr.report.id);
  assert.equal(r.state, "kontrolde");
  assert.equal(r.source.rawText, pkt().rawText, "ham kaynak korunur");
  const out = await svc2.completeCheck(inr.report.id, OFIS, r.version);
  assert.equal(out.state, "onay_bekliyor");
});

// ── 9. Tamamlanan işlem yeniden denenir → yeni kayıt oluşmaz ─────────────────
test("H9: onaylanmış işleme retry → mevcut sonuç döner, ikinci iş/onay açılmaz", async () => {
  const { svc, store } = await setup();
  const { id, report } = await toApprovalReady(svc);
  const first = await svc.approve(id, YON, report.version, report.rev_no);
  assert.equal(first.result, "approved");
  const again = await svc.approve(id, YON, report.version, report.rev_no); // eski sürümle bile
  assert.equal(again.result, "existing");
  assert.equal(again.work.id, first.work.id);
  const againIntake = await svc.intakePacket(pkt());
  assert.equal(againIntake.result, "existing");
  assert.equal((await store.all("works")).length, 1);
  assert.equal((await store.all("approvals")).length, 1);
  assert.equal((await store.all("reports")).length, 1);
});

// ── 10. İki benzer gerçek iş → ikisi de korunur, birleştirme yok ─────────────
test("H10: alanları birebir aynı iki ayrı iş → iki rapor, iki iş; otomatik birleşme yok", async () => {
  const { svc, store } = await setup();
  const a = await toApprovalReady(svc, pkt({ entryId: "e1" }));
  const b = await toApprovalReady(svc, pkt({ entryId: "e2" })); // aynı alanlar, farklı kimlik
  const ra = await svc.approve(a.id, YON, a.report.version, 0);
  const rb = await svc.approve(b.id, YON2, b.report.version, 0);
  assert.equal(ra.result, "approved");
  assert.equal(rb.result, "approved");
  assert.notEqual(ra.work.id, rb.work.id);
  assert.equal((await store.all("reports")).length, 2);
  assert.equal((await store.all("works")).length, 2);
});

// ── 11. İptal/bozuk/tanınmayan şoför bağlantısı → reddedilir ─────────────────
test("H11: tanınmayan/iptalli bağlantı ve bozuk paket rapor açamaz", async () => {
  const { svc, store, config } = await setup({ revokedLinks: ["lnk_rev"] });
  assert.equal(await code(svc.intakePacket(pkt({ linkId: "bilinmeyen" }))), ERR.LINK_UNKNOWN);
  assert.equal(await code(svc.intakePacket(pkt({ linkId: "lnk_rev" }))), ERR.LINK_REVOKED);
  assert.equal(await code(svc.intakePacket(pkt({ fields: { date: "2026-10-18" } }))), ERR.PACKET_INVALID);
  assert.equal(await code(svc.intakePacket(pkt({ entryId: "" }))), ERR.PACKET_INVALID);
  assert.equal((await store.all("reports")).length, 0, "hiç rapor açılmadı");
});

// ── 12. Kesinleşmiş bağlı kayıt → basit iptal engellenir ─────────────────────
test("H12: bağlı kesinleşmiş kayıt varken iptal CANCEL_BLOCKED; bağ yokken gerekçeli iptal çalışır", async () => {
  const { svc, store } = await setup();
  const { id, report } = await toApprovalReady(svc);
  await svc.approve(id, YON, report.version, report.rev_no);
  // hakediş kesinleşmiş gibi bağ ekle (lab simülasyonu — finansal etki bu turda kapsam dışı)
  await store.tx(["works"], async (x) => {
    const w = await x.byIndex("works", "op_key", "yz2/lnk_1/e1");
    await x.put("works", { ...w, finalized_links: [{ type: "hakedis", id: "h1", status: "Kesinleşti" }] });
  });
  const r1 = await store.get("reports", id);
  assert.equal(await code(svc.cancel(id, "yanlış iş", YON, r1.version)), ERR.CANCEL_BLOCKED);
  assert.equal((await store.get("reports", id)).state, "onaylandi", "bloke edilen iptal durumu değiştirmez");
  // bağı kaldır → iptal çalışır, iş SİLİNMEZ, gerekçe audit'te
  await store.tx(["works"], async (x) => {
    const w = await x.byIndex("works", "op_key", "yz2/lnk_1/e1");
    await x.put("works", { ...w, finalized_links: [] });
  });
  const r2 = await store.get("reports", id);
  const out = await svc.cancel(id, "müşteri vazgeçti", YON, r2.version);
  assert.equal(out.state, "iptal");
  const w = await store.byIndex("works", "op_key", "yz2/lnk_1/e1");
  assert.ok(w, "iş kaydı silinmedi");
  assert.equal(w.status, "iptal");
  assert.equal(w.cancelled.reason, "müşteri vazgeçti");
  const audits = await store.allByIndex("audit", "report_id", id);
  assert.ok(audits.some((a) => a.action === "iptal" && a.reason === "müşteri vazgeçti"));
});

// ── 13. Teknik hata ↔ iş reddi ayrımı ve yeniden deneme (T10/T11) ────────────
test("H13: ek hazırlama hatası → teknik_hata (reddedildi DEĞİL); aynı paketle resume temizler", async () => {
  const { svc, store } = await setup();
  const bad = pkt({ attachments: [{ name: "bozuk", bytes: "bayt-degil" }] });
  const t = await svc.intakePacket(bad);
  assert.equal(t.result, "tech_error");
  assert.equal(t.report.state, "teknik_hata");
  // teknik_hata'dan red yok; ofis de göremez (kontrol yalnız gonderildi'den başlar)
  assert.equal(await code(svc.startCheck(t.report.id, OFIS, t.report.version)), ERR.TRANSITION_DENIED);
  // aynı op-key + aynı içerik, sağlam ek ile yeniden gönderim → resume
  const good = pkt({ attachments: [{ name: "fis.jpg", bytes: new Uint8Array([9, 9]) }] });
  const r = await svc.intakePacket(good);
  assert.equal(r.result, "resumed");
  assert.equal(r.report.state, "gonderildi");
  assert.equal((await store.all("reports")).length, 1, "tek rapor");
  assert.equal((await store.all("attachments")).length, 1, "ek bu kez bağlandı");
});

// ── 14. "Farklı kayıt olarak aç" eski anahtarı aşamaz ────────────────────────
test("H14: fork yalnız yeni kimlik + gerekçe + ilişkiyle; eski op-key engeli aşılmaz", async () => {
  const { svc, store } = await setup();
  await svc.intakePacket(pkt());
  assert.equal(await code(svc.forkAsNewJob("yz2/lnk_1/e1", pkt(), "aynı anahtarla açma")), ERR.OP_KEY_REUSE);
  assert.equal(await code(svc.forkAsNewJob("yz2/lnk_1/e1", pkt({ entryId: "e2" }), "")), ERR.REASON_REQUIRED);
  const f = await svc.forkAsNewJob("yz2/lnk_1/e1", pkt({ entryId: "e2" }), "şoför ikinci seferi ayrı bildirdi");
  assert.equal(f.result, "created");
  assert.deepEqual(f.report.related_to, { type: "yeni_is", from: "yz2/lnk_1/e1", reason: "şoför ikinci seferi ayrı bildirdi" });
  assert.equal((await store.all("reports")).length, 2);
});
