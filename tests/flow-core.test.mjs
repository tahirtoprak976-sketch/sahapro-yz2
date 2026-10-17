// flow-core saf makine testleri — I/O yok, yalnız kural tablosu.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  STATES, TRANSITIONS, EDITABLE_FIELDS, ERR,
  opKeyOf, parseOpKey, canonicalStringify, fingerprintPayload, opKeyDecision, forkDecision,
  canTransition, assertVersion, editablePatch, invalidationPlan, canCancel, findTransition,
} from "../js/flow-core.js";

const OFIS = { id: "o1", role: "ofis" };
const YON = { id: "y1", role: "yonetici" };
const SOFOR = { id: "s1", role: "sofor" };
const SISTEM = { id: "sys", role: "sistem" };

const rep = (state, extra = {}) => ({ id: "r1", state, version: 3, rev_no: 0, check: null, ...extra });

test("durum listesi ve geçiş tablosu kapalı dünya: tabloda olmayan geçiş reddedilir", () => {
  assert.equal(STATES.length, 9);
  for (const from of STATES) for (const to of STATES) {
    const t = findTransition(from, to);
    if (!t) assert.equal(canTransition(rep(from), to, YON).code, ERR.TRANSITION_DENIED, from + "→" + to);
  }
});

test("rol disiplini: ofis onaylayamaz, yönetici kontrol alamaz, şoför hiçbir ofis geçişini yapamaz", () => {
  assert.equal(canTransition(rep("onay_bekliyor", { check: { actor_id: "o1", rev_no: 0, revoked: false } }), "onaylandi", OFIS).code, ERR.ROLE_DENIED);
  assert.equal(canTransition(rep("gonderildi"), "kontrolde", YON).code, ERR.ROLE_DENIED);
  assert.equal(canTransition(rep("gonderildi"), "kontrolde", SOFOR).code, ERR.ROLE_DENIED);
  assert.ok(canTransition(rep("gonderildi"), "kontrolde", OFIS).ok);
});

test("gerekçe zorunluluğu: T4/T6/T7/T9 nedensiz reddedilir, nedenli geçer", () => {
  assert.equal(canTransition(rep("kontrolde"), "reddedildi", OFIS).code, ERR.REASON_REQUIRED);
  assert.equal(canTransition(rep("onay_bekliyor", { check: { actor_id: "o1", rev_no: 0 } }), "reddedildi", YON).code, ERR.REASON_REQUIRED);
  assert.ok(canTransition(rep("kontrolde"), "reddedildi", OFIS, {}, { reason: "yanlış şantiye" }).ok);
  assert.equal(canTransition(rep("onaylandi"), "iptal", YON).code, ERR.REASON_REQUIRED);
});

test("T8 onay guard'ları: kontrolsüz, eski revizyonlu, aynı aktörlü onay reddedilir", () => {
  assert.equal(canTransition(rep("onay_bekliyor"), "onaylandi", YON).code, ERR.CHECK_STALE);
  const checked = rep("onay_bekliyor", { check: { actor_id: "o1", rev_no: 0, revoked: false }, rev_no: 0 });
  assert.ok(canTransition(checked, "onaylandi", YON).ok);
  assert.equal(canTransition({ ...checked, rev_no: 2 }, "onaylandi", YON).code, ERR.REV_MISMATCH);
  assert.equal(canTransition({ ...checked, check: { ...checked.check, revoked: true } }, "onaylandi", YON).code, ERR.CHECK_STALE);
  // kontrolü yapan onaylayamaz (varsayılan); yapılandırma ile tek kişiye izin verilebilir
  assert.equal(canTransition(checked, "onaylandi", OFIS && { id: "o1", role: "yonetici" }).code, ERR.SAME_ACTOR);
  assert.ok(canTransition(checked, "onaylandi", { id: "o1", role: "yonetici" }, { allowSameActor: true }).ok);
});

test("teknik hata iş reddinden ayrıdır: T10/T11 yalnız sisteme açık, reddedildi'ye sistem geçemez", () => {
  assert.ok(canTransition(rep("gonderildi"), "teknik_hata", SISTEM).ok);
  assert.equal(canTransition(rep("gonderildi"), "teknik_hata", OFIS).code, ERR.ROLE_DENIED);
  assert.ok(canTransition(rep("teknik_hata"), "gonderildi", SISTEM).ok);
  assert.equal(findTransition("gonderildi", "reddedildi"), null, "ofis görmeden red yok");
  assert.equal(findTransition("teknik_hata", "reddedildi"), null, "teknik hatadan doğrudan red yok");
});

test("op-key kapsamı: tenant/link/entry eksikse hata; biçim sabit", () => {
  assert.equal(opKeyOf({ tenant: "yz2", linkId: "lnk1", entryId: "e42" }), "yz2/lnk1/e42");
  assert.throws(() => opKeyOf({ tenant: "yz2", linkId: "", entryId: "e1" }));
  assert.throws(() => opKeyOf({ tenant: "yz2", linkId: "l", entryId: null }));
});

test("op-key ayraç çakışması üretilemez: bileşendeki '/' kodlanır, ayraç tek anlamlıdır", () => {
  // Klasik çakışma çifti: (a/b, c) ile (a, b/c) ham birleştirmede aynı anahtarı verirdi.
  const k1 = opKeyOf({ tenant: "a/b", linkId: "c", entryId: "d" });
  const k2 = opKeyOf({ tenant: "a", linkId: "b/c", entryId: "d" });
  const k3 = opKeyOf({ tenant: "a", linkId: "b", entryId: "c/d" });
  assert.notEqual(k1, k2);
  assert.notEqual(k2, k3);
  assert.notEqual(k1, k3);
  // Kodlanmış bileşen ham '/' içeremez → anahtar her zaman tam 3 parçaya bölünür
  for (const k of [k1, k2, k3]) assert.equal(k.split("/").length, 3, k);
  // Zor karakterler serbest ve güvenli: unicode, boşluk, '%', '?', '#'
  const tricky = { tenant: "şirket %/?#", linkId: "bağ 100%/%2F", entryId: "kayıt?\u0001" };
  const kt = opKeyOf(tricky);
  assert.equal(kt.split("/").length, 3);
  assert.deepEqual(parseOpKey(kt), tricky, "round-trip birebir");
  assert.deepEqual(parseOpKey(k1), { tenant: "a/b", linkId: "c", entryId: "d" });
  // Bozuk anahtar reddedilir
  assert.throws(() => parseOpKey("tek-parca"));
  assert.throws(() => parseOpKey("a/b/c/d"));
  assert.throws(() => parseOpKey("%zz/b/c"));
});

test("fingerprintPayload: girdi sözleşmesi — içerik+ham metin+SIRALI ek hash'leri; taşıma meta'sı yok", () => {
  const base = { fields: { quantity: 3, customer_id: "c1" }, rawText: "ham", attachmentHashes: ["h1", "h2"] };
  // alan anahtar sırası sonucu değiştirmez (kararlı serileştirme)
  assert.equal(
    fingerprintPayload({ ...base, fields: { customer_id: "c1", quantity: 3 } }),
    fingerprintPayload(base)
  );
  // ek İÇERİĞİ değişirse payload değişir
  assert.notEqual(fingerprintPayload({ ...base, attachmentHashes: ["h1", "hX"] }), fingerprintPayload(base));
  // ek SIRASI değişirse payload değişir (sıra da içeriktir)
  assert.notEqual(fingerprintPayload({ ...base, attachmentHashes: ["h2", "h1"] }), fingerprintPayload(base));
  // miktar/müşteri değişirse payload değişir (sessiz kabul engelinin temeli)
  assert.notEqual(fingerprintPayload({ ...base, fields: { ...base.fields, quantity: 4 } }), fingerprintPayload(base));
  // taşıma meta'sı sözleşmede YOK: fonksiyon imzasında karşılığı olmadığı için
  // çağıran ne kadar meta basarsa bassın payload'a sızamaz
  const payload = fingerprintPayload(base);
  for (const metaKey of ["sent_at", "received_at", "retry_no", "channel"])
    assert.ok(!payload.includes(metaKey), metaKey + " payload'a sızdı!");
});

test("canonicalStringify: anahtar sırasından bağımsız aynı içerik aynı metin", () => {
  const a = { x: 1, y: [3, { b: 2, a: 1 }], z: "ş" };
  const b = { z: "ş", y: [3, { a: 1, b: 2 }], x: 1 };
  assert.equal(canonicalStringify(a), canonicalStringify(b));
  assert.notEqual(canonicalStringify(a), canonicalStringify({ ...a, x: 2 }));
});

test("opKeyDecision: yok→create, aynı içerik→return-existing, farklı içerik→OP_CONFLICT", () => {
  assert.equal(opKeyDecision(null, "fp1").action, "create");
  assert.equal(opKeyDecision({ fingerprint: "fp1" }, "fp1").action, "return-existing");
  assert.equal(opKeyDecision({ fingerprint: "fp1" }, "fp2").code, ERR.OP_CONFLICT);
});

test("fork: eski anahtar aşılamaz; yeni kimlik + gerekçe + ilişki zorunlu", () => {
  assert.equal(forkDecision({ originalKey: "yz2/l/e1", newKey: "yz2/l/e1", reason: "x" }).code, ERR.OP_KEY_REUSE);
  assert.equal(forkDecision({ originalKey: "yz2/l/e1", newKey: "yz2/l/e2", reason: " " }).code, ERR.REASON_REQUIRED);
  const ok = forkDecision({ originalKey: "yz2/l/e1", newKey: "yz2/l/e2", reason: "şoför ikinci seferi ayrı bildirdi" });
  assert.ok(ok.ok);
  assert.deepEqual(ok.relation, { type: "yeni_is", from: "yz2/l/e1" });
});

test("alan düzenleme: kontrolde yalnız izinli alanlar; onaylandı/reddedildi donmuş", () => {
  assert.ok(editablePatch(rep("kontrolde"), { quantity: 5, tonnage: 22 }).ok);
  assert.equal(editablePatch(rep("kontrolde"), { op_key: "hack" }).code, ERR.FIELD_LOCKED);
  assert.equal(editablePatch(rep("onaylandi"), { quantity: 5 }).code, ERR.FIELD_LOCKED);
  assert.equal(editablePatch(rep("gonderildi"), { quantity: 5 }).code, ERR.FIELD_LOCKED, "alıcı taraf gönderildi'de alan değiştiremez");
  assert.equal(editablePatch(rep("reddedildi"), { quantity: 5 }).code, ERR.FIELD_LOCKED);
});

test("içerik değişimi kontrolü geçersizleştirir: onay_bekliyor → T12 kontrolde; kontrolde → check revoke", () => {
  const ob = rep("onay_bekliyor", { check: { actor_id: "o1", rev_no: 0, revoked: false } });
  const p1 = invalidationPlan(ob);
  assert.ok(p1.revokeCheck && p1.autoTransition && p1.autoTransition.to === "kontrolde");
  const kd = rep("kontrolde", { check: { actor_id: "o1", rev_no: 0, revoked: false } });
  const p2 = invalidationPlan(kd);
  assert.ok(p2.revokeCheck && p2.autoTransition === null);
  assert.equal(invalidationPlan(rep("gonderildi")).revokeCheck, false);
});

test("sürüm beklentisi: uyuşmazlık VERSION_CONFLICT", () => {
  assert.ok(assertVersion(rep("kontrolde"), 3).ok);
  assert.equal(assertVersion(rep("kontrolde"), 2).code, ERR.VERSION_CONFLICT);
});

test("iptal koruması: kesinleşmiş bağlı kayıt varken basit iptal bloke", () => {
  assert.equal(canCancel(rep("kontrolde")).code, ERR.TRANSITION_DENIED, "yalnız onaylanmış iptal edilir");
  assert.equal(canCancel(rep("onaylandi"), { finalizedCount: 1 }).code, ERR.CANCEL_BLOCKED);
  assert.ok(canCancel(rep("onaylandi"), { finalizedCount: 0 }).ok);
});
