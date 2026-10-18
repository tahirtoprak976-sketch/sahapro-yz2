// flow-sp1: GERÇEK SP1 üreticisi (driver-core.driverMessage) + GERÇEK HMAC (security-core)
// ile lab alım akışının uçtan uca node testleri (fake-indexeddb; gerçek tx anlambilimi).
// Tarayıcı karşılığı: tests/flow_sp1_browser_test.py (T1–T10).
// NOT: Bu testler TEK CİHAZ laboratuvarıdır; imza doğrulaması kişi kimliği/iş kanıtı sayılmaz.
import { test } from "node:test";
import assert from "node:assert/strict";
import { indexedDB } from "fake-indexeddb";
import { FlowStore, deleteFlowDB, FLOW_DB_NAME } from "../js/flow-store.js";
import { makeFlowConfig, labIdentity } from "../js/flow-identity.js";
import { createFlowService } from "../js/flow-service.js";
import { driverMessage } from "../js/driver-core.js"; // mevcut şoför uygulamasının GERÇEK üreticisi
import { randomB64 } from "../js/security-core.js";
import { ERR } from "../js/flow-core.js";

const OFIS = labIdentity("ofis1", "ofis");
const YON = labIdentity("yon1", "yonetici"); // onay, kontrolden FARKLI aktör etiketiyle

let seq = 0;
const opened = [];
async function setup() {
  const name = FLOW_DB_NAME + "_sp1_" + ++seq + "_" + Date.now();
  const store = await FlowStore.open(name, indexedDB);
  opened.push({ store, name });
  // SP1 kapısı lab DB 'links' store'unu kullanır; config link listesi yalnız MANUEL paket yolundadır.
  const config = makeFlowConfig({ tenant: "yz2" });
  // audit satırları aynı milisaniyeye düşmesin diye monoton saat (sıralama testleri deterministik olsun)
  let clock = Date.parse("2026-10-18T09:00:00.000Z");
  const svc = createFlowService({ store, config, now: () => new Date((clock += 1000)).toISOString() });
  return { store, config, svc, name };
}
test.after(async () => {
  for (const { store } of opened) { try { store.close(); } catch (_) {} }
  for (const name of new Set(opened.map((o) => o.name))) await deleteFlowDB(name, indexedDB);
});

// Lab bağlantısı üret (anahtar yalnız lab DB'ye yazılır) — TEST- önekli örnek personel
const labLink = (svc, over = {}) => svc.createLabLink({ pid: "TEST-P-1", name: "TEST-Şoför Ali", vid: "TEST-V-1", days: 180, ...over });

// Şoför uygulamasındaki cfg biçimi (listeler kimlik+ad çiftleri; hepsi TEST- örnek veri)
function cfgFor(link, over = {}) {
  return {
    p: [link.pid, link.name],
    lid: link.lid, ls: link.secret,
    V: [["TEST-V-1", "TEST-34 ABC 01"]],
    C: [["TEST-C-1", "TEST-Müşteri A"]],
    S: [["TEST-S-1", "TEST-Ümraniye", "TEST-C-1", "", ""]],
    D: [], E: [], Y: null,
    ...over,
  };
}
function workEntry(id, over = {}) {
  return { id, date: "2026-10-18", vid: "TEST-V-1", cid: "TEST-C-1", sid: "TEST-S-1", wt: "Hafriyat Nakliye", q: 3, u: "Sefer", ...over };
}
const code = async (p) => { try { await p; return null; } catch (e) { return e.code || e.message; } };

// ── SP1-1. Geçerli imzalı paket: entry başına AYRI bildirim, otomatik onay YOK ──
test("SP1-1: gerçek üreticiden geçerli 2 kayıtlı paket → 2 ayrı bildirim, tek ortak zarf, onay yok", async () => {
  const { svc, store } = await setup();
  const { link } = await labLink(svc);
  const msg = await driverMessage([workEntry("e100"), workEntry("e101")], cfgFor(link));
  assert.ok(msg.includes("SAHAPRO şoför kaydı"), "okunur başlık mevcut üreticiden");
  assert.ok(/SP1:[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{16,}/.test(msg), "imzalı kod satırı");
  const out = await svc.intakeSp1Message(msg);
  assert.equal(out.accepted, 1);
  assert.equal(out.rejected, 0);
  assert.deepEqual(out.entries.map((e) => e.status), ["created", "created"]);
  const reports = await store.all("reports");
  assert.equal(reports.length, 2, "paket içi her kayıt ayrı bildirim");
  for (const r of reports) {
    assert.equal(r.state, "gonderildi", "otomatik onay/ilerleme YOK");
    assert.equal(r.check, null);
    assert.equal(r.approved, null);
  }
  assert.equal((await store.all("works")).length, 0, "iş kaydı ancak onayla oluşur");
  // İki bildirim aynı teslim zarfına (sources) bağlı; ham mesaj değişmez saklanır
  assert.equal(reports[0].source_ids[0], reports[1].source_ids[0]);
  const sources = await store.all("sources");
  assert.equal(sources.length, 1);
  assert.equal(sources[0].raw_text, msg, "ham SP1 mesajı birebir saklandı");
  assert.equal(sources[0].sig_status, "dogrulandi", "imza: lab anahtarı tuttu (kişi/iş kanıtı DEĞİL)");
  assert.equal(sources[0].entry_count, 2);
});

// ── SP1-2. Paket kapısı: 6 red senaryosu — rapor/zarf açılmaz, red kanıtı yazılır ──
test("SP1-2: imzasız/tanınmayan/iptalli/süresi dolmuş/bozuk imza/yanlış personel → red + kanıt", async () => {
  const { svc, store } = await setup();
  const good = (await labLink(svc)).link;
  const mk = (cfg) => driverMessage([workEntry("e1")], cfg);
  const revoked = (await labLink(svc, { pid: "TEST-P-2", name: "TEST-Şoför B" })).link;
  await svc.revokeLabLink(revoked.lid, "test iptali");
  const expired = (await labLink(svc, { pid: "TEST-P-3", name: "TEST-Şoför C", days: -1 })).link;
  const cases = [
    [ERR.SP1_UNSIGNED, await mk(cfgFor(good, { ls: null }))],                       // imza yok
    [ERR.LINK_UNKNOWN, await mk(cfgFor(good, { lid: "lnk_bilinmeyen" }))],         // lab böyle bir bağlantı tanımıyor
    [ERR.LINK_REVOKED, await mk(cfgFor(revoked))],                                 // iptal edilmiş bağlantı
    [ERR.LINK_EXPIRED, await mk(cfgFor(expired))],                                 // süresi dolmuş bağlantı
    [ERR.SP1_BAD_SIGNATURE, await mk(cfgFor(good, { ls: randomB64(16) }))],        // başka anahtarla imzalanmış
    [ERR.SP1_PERSONNEL_MISMATCH, await mk(cfgFor(good, { p: ["TEST-P-BASKA", "TEST-Başka Kişi"] }))], // bağlantı başkası adına
  ];
  for (const [want, msg] of cases) {
    const out = await svc.intakeSp1Message(msg);
    assert.equal(out.accepted, 0, want);
    assert.equal(out.rejected, 1, want);
    assert.equal(out.packets[0].status, "rejected", want);
    assert.equal(out.packets[0].code, want);
    assert.equal(out.entries.length, 0, want + ": hiçbir entry işlenmedi");
  }
  assert.equal((await store.all("reports")).length, 0, "reddedilen paketten rapor AÇILMAZ");
  assert.equal((await store.all("works")).length, 0);
  assert.equal((await store.all("sources")).length, 0, "reddedilen paket kaynak/zarf olmaz");
  const rejs = await store.all("rejections");
  assert.equal(rejs.length, 6, "her red kanıtı kaydedildi");
  assert.deepEqual(rejs.map((r) => r.reason_code).sort(), cases.map((c) => c[0]).sort());
  // bağlantı sayaçları: red edilen bağlantılara last_seen/msgs İŞLENMEZ
  const links = await store.all("links");
  assert.equal(links.find((l) => l.lid === revoked.lid).msgs || 0, 0);
});

// ── SP1-3. Çok satırlı paket + tekrar gönderim: A+B sonra B+C ──
test("SP1-3: A+B ardından B+C → B çift açılmaz, C yeni, sahte OP_CONFLICT yok, zarf zinciri uzar", async () => {
  const { svc, store } = await setup();
  const { link } = await labLink(svc);
  const cfg = cfgFor(link);
  const A = workEntry("eA"), B = workEntry("eB"), C = workEntry("eC");
  const out1 = await svc.intakeSp1Message(await driverMessage([A, B], cfg));
  assert.deepEqual(out1.entries.map((e) => e.status), ["created", "created"]);
  const bBefore = (await store.all("reports")).find((r) => r.entry_id === "eB");
  const fpBefore = bBefore.fingerprint;

  const out2 = await svc.intakeSp1Message(await driverMessage([B, C], cfg)); // B aynı içerikle, YENİ zarfta
  assert.equal(out2.entries[0].status, "existing", "B yeniden gönderildi: yeni bildirim YOK");
  assert.equal(out2.entries[0].reportId, bBefore.id);
  assert.equal(out2.entries[1].status, "created", "C yeni bildirim");
  assert.ok(!out2.entries.some((e) => e.code === ERR.OP_CONFLICT), "zarf değişimi sahte çakışma üretmez");

  const reports = await store.all("reports");
  assert.equal(reports.length, 3, "A, B, C — B tek kayıt");
  const bAfter = await store.get("reports", bBefore.id);
  assert.equal(bAfter.fingerprint, fpBefore, "aynı işin farklı paket zarfıyla yeniden gönderilmesi içerik değişikliği değildir");
  assert.equal(bAfter.source_ids.length, 2, "iki teslim zarfı kanıt zincirinde (kayıt amaçlı ilişki)");
  assert.equal(reports.find((r) => r.entry_id === "eA").source_ids.length, 1);
  assert.equal(reports.find((r) => r.entry_id === "eC").source_ids.length, 1);
  assert.equal((await store.all("sources")).length, 2, "iki farklı paket kodu = iki zarf");
  const audits = await store.allByIndex("audit", "report_id", bBefore.id);
  assert.ok(audits.some((a) => a.action === "yeniden_gonderim"), "zincir audit'e düşüldü");
});

// ── SP1-4. Aynı entry kimliği + DEĞİŞMİŞ içerik → çakışma reddi sürüyor ──
test("SP1-4: aynı entry id ile miktar değişimi → OP_CONFLICT (sessiz üzerine yazma yok)", async () => {
  const { svc, store } = await setup();
  const { link } = await labLink(svc);
  const cfg = cfgFor(link);
  await svc.intakeSp1Message(await driverMessage([workEntry("e1")], cfg));
  const out2 = await svc.intakeSp1Message(await driverMessage([workEntry("e1", { q: 9 })], cfg));
  assert.equal(out2.entries[0].status, "error");
  assert.equal(out2.entries[0].code, ERR.OP_CONFLICT);
  assert.equal((await store.all("reports")).length, 1, "tek rapor — birleştirme/ezme yok");
});

// ── SP1-5. İş dışı kayıtlar (gider/bakım/yakıt) atlanır — iş ÜRETİLMEZ ──
test("SP1-5: karma pakette yalnız iş kaydı bildirim açar; gider/bakım/yakıt skipped_kind", async () => {
  const { svc, store } = await setup();
  const { link } = await labLink(svc);
  const entries = [
    workEntry("eW"),
    { id: "eG", k: "g", date: "2026-10-18", cat: "Yemek", tl: 250, pay: "cep" },
    { id: "eM", k: "m", date: "2026-10-18", vid: "TEST-V-1", mt: "Arıza", desc: "TEST- hidrolik kaçağı", st: "Açık" },
    { id: "eF", k: "f", date: "2026-10-18", vid: "TEST-V-1", L: 50, src: "Depo Tankı" },
  ];
  const out = await svc.intakeSp1Message(await driverMessage(entries, cfgFor(link)));
  assert.equal(out.entries.filter((e) => e.status === "created").length, 1);
  const skipped = out.entries.filter((e) => e.status === "skipped_kind");
  assert.equal(skipped.length, 3);
  assert.deepEqual(skipped.map((s) => s.kind).sort(), ["bakım", "gider", "yakıt"]);
  assert.equal((await store.all("reports")).length, 1);
});

// ── SP1-6. Beyan edilen fotoğraf (📷n) tamamlanmadan iş onaya hazır değil ──
test("SP1-6: ph=1 → kontrol ATTACHMENT_MISSING ×2 (ek yok / onay yok) → onaylı eşleşmeyle akış biter", async () => {
  const { svc, store } = await setup();
  const { link } = await labLink(svc);
  const out = await svc.intakeSp1Message(await driverMessage([workEntry("e1", { ph: 1 })], cfgFor(link)));
  const rid = out.entries[0].reportId;
  let r = await store.get("reports", rid);
  assert.equal(r.media.required, 1, "şoförün 📷1 beyanı media.required oldu");
  assert.equal(r.media.attached, 0);
  r = await svc.startCheck(rid, OFIS, r.version);
  assert.equal(await code(svc.completeCheck(rid, OFIS, r.version)), ERR.ATTACHMENT_MISSING,
    "beyan edilen ek bağlanmadan kontrol kapanmaz — iş onaya hazır sayılmaz");
  // ek bağlandı ama kullanıcı eşleşmeyi ONAYLAMADI → yine kapanmaz
  r = await svc.attachMedia(rid, [{ name: "TEST-foto1.bin", bytes: new TextEncoder().encode("TEST-MEDIA-1") }],
    { confirmed: false, actor: OFIS }, r.version);
  assert.equal(r.media.attached, 1);
  assert.equal(r.media.confirmed, false);
  assert.equal(await code(svc.completeCheck(rid, OFIS, r.version)), ERR.ATTACHMENT_MISSING,
    "fotoğraf sırası/varlığı tek başına kanıt sayılmaz — açık kullanıcı onayı gerekir");
  // onaylı eşleşme → kontrol kapanır → onay
  r = await svc.attachMedia(rid, [{ name: "TEST-foto2.bin", bytes: new TextEncoder().encode("TEST-MEDIA-2") }],
    { confirmed: true, actor: OFIS }, r.version);
  assert.equal(r.media.confirmed, true);
  r = await svc.completeCheck(rid, OFIS, r.version);
  assert.equal(r.state, "onay_bekliyor");
  const ap = await svc.approve(rid, YON, r.version, r.rev_no);
  assert.equal(ap.result, "approved");
  // audit: eşleşme notları sırayla HAYIR → evet; dürüstlük ibaresi ikisinde de var
  const rows = (await store.allByIndex("audit", "report_id", rid))
    .filter((a) => a.action === "media_attached").sort((a, b) => a.at.localeCompare(b.at));
  assert.equal(rows.length, 2);
  assert.ok(rows[0].reason.includes("HAYIR"), "ilki onaysız");
  assert.ok(rows[1].reason.includes("evet"), "ikincisi onaylı");
  for (const a of rows) assert.ok(a.reason.includes("tek başına kanıt sayılmaz"));
  const atts = await store.allByIndex("attachments", "report_id", rid);
  assert.ok(atts.length === 2 && atts.every((a) => a.origin === "ofis-eslestirme"),
    "eşleştirilen ekler kaynak ekinden ayrı işaretli");
});

// ── SP1-7. Metin miktarı ile fiş tonajı AYRI alanlarda birlikte yaşar ──
test("SP1-7: q=3 (metin) ile ton=21.5 (fiş) ayrı alanlar; slip_no korunur", async () => {
  const { svc, store } = await setup();
  const { link } = await labLink(svc);
  const out = await svc.intakeSp1Message(
    await driverMessage([workEntry("e1", { q: 3, ton: 21.5, slip: "TEST-FİŞ-001" })], cfgFor(link)));
  const r = await store.get("reports", out.entries[0].reportId);
  const revs = await store.allByIndex("revisions", "report_id", r.id);
  const f = revs[0].fields;
  assert.equal(f.quantity, 3, "metin miktarı kendi alanında");
  assert.equal(f.tonnage, 21.5, "fiş tonajı AYRI alan — metin miktarının üzerine yazılmadı");
  assert.equal(f.slip_no, "TEST-FİŞ-001");
});

// ── SP1-8. Onaylanmış bildirim yeniden gönderilirse → aynı lab işine yönlendirir ──
test("SP1-8: onay sonrası aynı mesaj tekrar → existing + aynı workId; zarf çiftlenmez, durum bozulmaz", async () => {
  const { svc, store } = await setup();
  const { link } = await labLink(svc);
  const msg = await driverMessage([workEntry("e1")], cfgFor(link));
  const out1 = await svc.intakeSp1Message(msg);
  const rid = out1.entries[0].reportId;
  let r = await store.get("reports", rid);
  r = await svc.startCheck(rid, OFIS, r.version);
  r = await svc.completeCheck(rid, OFIS, r.version);
  const ap = await svc.approve(rid, YON, r.version, r.rev_no);
  assert.equal(ap.result, "approved");
  const out2 = await svc.intakeSp1Message(msg); // aynı zarf, aynı içerik
  assert.equal(out2.entries[0].status, "existing");
  assert.equal(out2.entries[0].reportId, rid);
  assert.equal(out2.entries[0].workId, ap.work.id, "aynı lab iş kaydına yönlendirildi");
  assert.equal((await store.all("works")).length, 1);
  assert.equal((await store.all("reports")).length, 1);
  const after = await store.get("reports", rid);
  assert.equal(after.state, "onaylandi", "tekrar gönderim durumu geri alamaz");
  assert.equal(after.source_ids.length, 1, "aynı zarf kanıt zincirine ikinci kez eklenmez");
  assert.equal((await store.all("sources")).length, 1);
});

// ── SP1-9. Ofis düzeltmesi: eski→yeni + gerekçe revizyona işlenir, kaynak dokunulmaz ──
test("SP1-9: editFields changes{from,to}+reason yazar; r0 (kaynak revizyon) aynen kalır", async () => {
  const { svc, store } = await setup();
  const { link } = await labLink(svc);
  const out = await svc.intakeSp1Message(await driverMessage([workEntry("e1")], cfgFor(link)));
  const rid = out.entries[0].reportId;
  const r1 = await svc.startCheck(rid, OFIS, (await store.get("reports", rid)).version);
  const r2 = await svc.editFields(rid, { quantity: 5 }, OFIS, r1.version,
    { reason: "şoförle konuşuldu: 5 sefer olacak" });
  assert.equal(r2.rev_no, 1);
  const revs = (await store.allByIndex("revisions", "report_id", rid)).sort((a, b) => a.rev_no - b.rev_no);
  assert.equal(revs.length, 2);
  assert.equal(revs[0].fields.quantity, 3, "kaynak revizyon üzerine yazılmadı");
  assert.equal(revs[0].changes, null);
  assert.deepEqual(revs[1].changes, { quantity: { from: 3, to: 5 } }, "eski→yeni görünür");
  assert.equal(revs[1].reason, "şoförle konuşuldu: 5 sefer olacak");
  assert.equal(revs[1].edited_by, "ofis1");
});

// ── SP1-10. Okunur metni değiştirilmiş ama kodu aynı mesaj → içerik aynı sayılır ──
test("SP1-10: okunur satırı değiştirilmiş aynı paket → existing; kanıt entry'dir, zarf çiftlenmez", async () => {
  const { svc, store } = await setup();
  const { link } = await labLink(svc);
  const msg1 = await driverMessage([workEntry("e1")], cfgFor(link));
  const msg2 = msg1.replace("3 sefer", "99 sefer"); // okunur metin kurcalandı, SP1 kodu aynı
  assert.notEqual(msg2, msg1);
  const out1 = await svc.intakeSp1Message(msg1);
  assert.equal(out1.entries[0].status, "created");
  const out2 = await svc.intakeSp1Message(msg2);
  assert.equal(out2.entries[0].status, "existing", "fingerprint okunur metne değil entry'ye bakar");
  assert.equal(out2.entries[0].reportId, out1.entries[0].reportId);
  assert.equal((await store.all("reports")).length, 1);
  assert.equal((await store.all("sources")).length, 1, "aynı paket kodu ikinci zarf olmaz");
  const src = await store.get("sources", (await store.all("reports"))[0].source_ids[0]);
  assert.equal(src.raw_text, msg1, "saklanan ham mesaj ilk alınandır (değişmez)");
});
