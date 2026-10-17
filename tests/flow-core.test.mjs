// flow-core saf makine testleri — I/O yok, yalnız kural tablosu.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  STATES, TRANSITIONS, EDITABLE_FIELDS, ERR,
  opKeyOf, canonicalStringify, opKeyDecision, forkDecision,
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
