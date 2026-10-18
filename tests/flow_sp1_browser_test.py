#!/usr/bin/env python3
"""SAHAPRO YZ2 — SP1 bildiriminin laboratuvar onay akışında GERÇEK TARAYICI testleri.

node sahte-depolama testlerinin (tests/flow-sp1.test.mjs) YANINA konur; yerine geçmez.
Farkı: gerçek Chromium + gerçek IndexedDB + İKİ GERÇEK SEKME (aynı browser context =
aynı profil = aynı veritabanı) + gerçek Service Worker (çevrimdışı senaryo).

Senaryolar (görev maddesi 6):
  T1  gerçek üreticiden geçerli SP1 → lab'da kabul, entry başına ayrı bildirim
  T2  imzasız / tanınmayan / iptalli / süresi dolmuş / bozuk imza / yanlış personel → red
  T3  çok satırlı paket: A+B ardından B+C → B çiftlenmez, C yeni, sahte çakışma yok
  T4  aynı entry kimliği + değişmiş içerik → OP_CONFLICT reddi sürüyor
  T5  iki sekme aynı paketi aynı anda alır → tek bildirim
  T6  iki sekme aynı revizyonu aynı anda onaylar → tek iş
  T7  eksik ek (📷 beyanı) tamamlanınca aynı işlem onaya gider
  T8  sekme kapanıp açılır → bekleyen bildirim korunur
  T9  ana YZ2 kayıtları + tarayıcı ayarları/önbellekleri değişmedi (davranış probu)
  T10 çevrimdışı (SW önbelleği) geçerli SP1 akışı uçtan uca çalışır

T9 notu: yalnız grep/dosya listesi değil, DAVRANIŞ kontrolü — ana DB'nin tüm store
sayıları, meta anahtarları, localStorage ve Cache API içeriği önce/sonra birebir
karşılaştırılır; tarayıcıya eklenen tek veritabanı flowlab_sp1_* olmalıdır.
"""
import asyncio
import base64
import os
import subprocess
import sys
import time

from playwright.async_api import async_playwright

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = 8124
BASE = f"http://127.0.0.1:{PORT}"
HARNESS = f"{BASE}/tests/flow-browser-harness.html"
MAIN_DB_SUFFIX = "YZ2SP1MAIN"
MAIN_DB = f"sahapro_yz2_db_{MAIN_DB_SUFFIX}"

results = []


def check(name, cond, detail=""):
    results.append((name, bool(cond), str(detail)))
    print(("PASS " if cond else "FAIL ") + name + (" — " + str(detail) if detail else ""), flush=True)


async def ft(tab, method, *args):
    """Köprü çağrısı: FT.<method>(*args) — evaluate sınırından JSON taşınır."""
    return await tab.evaluate("([m, a]) => FT[m](...a)", [method, list(args)])


def entry(eid, **over):
    e = {"id": eid, "date": "2026-10-18", "vid": "TEST-V-BT", "cid": "TEST-C-BT",
         "sid": "TEST-S-BT", "wt": "Hafriyat Nakliye", "q": 3, "u": "Sefer"}
    e.update(over)
    return e


def random_ls():
    return base64.urlsafe_b64encode(os.urandom(16)).decode().rstrip("=")


async def goto_ready(page, url):
    last = None
    for _ in range(3):
        try:
            await page.goto(url, wait_until="domcontentloaded", timeout=20000)
            await page.wait_for_function("window.__FT_READY === true", timeout=15000)
            return
        except Exception as e:  # noqa: BLE001
            last = e
            await page.wait_for_timeout(800)
    raise last


async def main():
    server = subprocess.Popen(
        [sys.executable, "-m", "http.server", str(PORT), "--bind", "127.0.0.1"],
        cwd=REPO, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )
    time.sleep(1.0)
    dbs = []
    probe_before = None
    try:
        async with async_playwright() as p:
            browser = await p.chromium.launch(
                executable_path="/usr/bin/chromium",
                args=["--no-sandbox", "--disable-dev-shm-usage"],
            )
            context = await browser.new_context(service_workers="allow")
            await context.add_init_script("localStorage.setItem('yz2_role','boss')")

            # ---- 0) ANA UYGULAMA gerçekten açılır + test işareti yazılır ----
            main_page = await context.new_page()
            await main_page.goto(f"{BASE}/index.html?db={MAIN_DB_SUFFIX}", wait_until="domcontentloaded", timeout=30000)
            await main_page.wait_for_selector(".command-hero", timeout=20000)
            await main_page.evaluate(
                """async () => {
                  const db = await import('./js/db.js'), c = await import('./js/core.js');
                  await db.put('customers', c.newRecord({ id: 'TEST_ANAMUS', name: 'TEST-Ana Müşteri' }));
                  await db.metaSet('test_isaret', 'LAB-DOKUNMA-2026');
                }"""
            )
            await main_page.evaluate("async () => { await navigator.serviceWorker.ready; }")
            await main_page.wait_for_timeout(1500)  # precache + claim otursun

            # ---- lab sekmeleri (İKİ GERÇEK SEKME, aynı origin+profil) ----
            tab1 = await context.new_page()
            tab2 = await context.new_page()
            await goto_ready(tab1, HARNESS)
            await goto_ready(tab2, HARNESS)

            # T9'un "öncesi" probu: ana DB sayıları + meta + localStorage + önbellekler
            probe_before = await ft(tab1, "probeMain", MAIN_DB)
            assert probe_before.get("main"), f"ana DB probu açılamadı: {probe_before}"
            assert probe_before["main"]["counts"].get("customers") == 1, probe_before["main"]["counts"].get("customers")

            # ================= T1: gerçek üreticiden geçerli SP1 =================
            db = "flowlab_sp1_t1"; dbs.append(db)
            link = await ft(tab1, "makeLink", db)
            msg = (await ft(tab1, "makeSp1", db, link["lid"], [entry("e1"), entry("e2", q=5)]))["message"]
            out = await ft(tab1, "intakeSp1", db, msg)
            snap = await ft(tab1, "snapshot", db)
            ok_hdr = "SAHAPRO şoför kaydı" in msg and "SP1:" in msg
            check("T1 gerçek üreticiden geçerli SP1 kabul",
                  ok_hdr and out.get("accepted") == 1 and out.get("rejected") == 0
                  and [e.get("status") for e in out["entries"]] == ["created", "created"]
                  and len(snap["reports"]) == 2 and snap["sources"] == 1 and snap["works"] == 0
                  and all(r["state"] == "gonderildi" for r in snap["reports"]),
                  f"kabul={out.get('accepted')} entryler={[e.get('status') for e in out.get('entries', [])]} "
                  f"rapor={len(snap['reports'])} zarf={snap['sources']} iş={snap['works']}")

            # ================= T2: kapı reddi — 6 senaryo =================
            db = "flowlab_sp1_t2"; dbs.append(db)
            link = await ft(tab1, "makeLink", db)
            revoked = await ft(tab1, "makeLink", db, {"pid": "TEST-P-R", "name": "TEST-Şoför R"})
            await ft(tab1, "revokeLink", db, revoked["lid"])
            expired = await ft(tab1, "makeLink", db, {"pid": "TEST-P-E", "name": "TEST-Şoför E", "days": -1})
            cases = [
                ("SP1_UNSIGNED", (await ft(tab1, "makeSp1", db, link["lid"], [entry("e1")], {"ls": None}))["message"]),
                ("LINK_UNKNOWN", (await ft(tab1, "makeSp1", db, "lnk_tanimdis", [entry("e1")]))["message"]),
                ("LINK_REVOKED", (await ft(tab1, "makeSp1", db, revoked["lid"], [entry("e1")]))["message"]),
                ("LINK_EXPIRED", (await ft(tab1, "makeSp1", db, expired["lid"], [entry("e1")]))["message"]),
                ("SP1_BAD_SIGNATURE", (await ft(tab1, "makeSp1", db, link["lid"], [entry("e1")], {"ls": random_ls()}))["message"]),
                ("SP1_PERSONNEL_MISMATCH", (await ft(tab1, "makeSp1", db, link["lid"], [entry("e1")], {"p": ["TEST-P-BASKA", "TEST-Başka Kişi"]}))["message"]),
            ]
            got = []
            for want, m in cases:
                o = await ft(tab1, "intakeSp1", db, m)
                got.append(o["packets"][0].get("code") if o.get("packets") else o.get("error"))
            snap = await ft(tab1, "snapshot", db)
            check("T2 imzasız/tanınmayan/iptalli/süresi dolmuş/bozuk imza/yanlış personel red",
                  got == [w for w, _ in cases] and len(snap["reports"]) == 0
                  and snap["sources"] == 0 and snap["rejections"] == 6,
                  f"kodlar={got} rapor={len(snap['reports'])} red={snap['rejections']}")

            # ================= T3: A+B sonra B+C =================
            db = "flowlab_sp1_t3"; dbs.append(db)
            link = await ft(tab1, "makeLink", db)
            m1 = (await ft(tab1, "makeSp1", db, link["lid"], [entry("eA"), entry("eB")]))["message"]
            o1 = await ft(tab1, "intakeSp1", db, m1)
            m2 = (await ft(tab1, "makeSp1", db, link["lid"], [entry("eB"), entry("eC")]))["message"]
            o2 = await ft(tab1, "intakeSp1", db, m2)
            rid_b = o1["entries"][1]["reportId"]
            gb = await ft(tab1, "get", db, rid_b)
            snap = await ft(tab1, "snapshot", db)
            statuses = [e.get("status") for e in o2["entries"]]
            conflicts = [e for e in o2["entries"] if e.get("code") == "OP_CONFLICT"]
            check("T3 A+B sonra B+C (B çiftlenmez, sahte çakışma yok)",
                  statuses == ["existing", "created"] and not conflicts
                  and len(snap["reports"]) == 3 and snap["sources"] == 2 and gb["sourceCount"] == 2,
                  f"durumlar={statuses} rapor={len(snap['reports'])} zarf={snap['sources']} B.zarf={gb['sourceCount']}")

            # ================= T4: aynı entry + değişmiş içerik =================
            db = "flowlab_sp1_t4"; dbs.append(db)
            link = await ft(tab1, "makeLink", db)
            await ft(tab1, "intakeSp1", db, (await ft(tab1, "makeSp1", db, link["lid"], [entry("e1")]))["message"])
            o2 = await ft(tab1, "intakeSp1", db,
                          (await ft(tab1, "makeSp1", db, link["lid"], [entry("e1", q=9)]))["message"])
            snap = await ft(tab1, "snapshot", db)
            check("T4 aynı entry kimliği + farklı miktar → OP_CONFLICT",
                  o2["entries"][0].get("status") == "error" and o2["entries"][0].get("code") == "OP_CONFLICT"
                  and len(snap["reports"]) == 1,
                  f"sonuç={o2['entries'][0].get('status')}/{o2['entries'][0].get('code')} rapor={len(snap['reports'])}")

            # ================= T5: iki sekme aynı paketi alır =================
            db = "flowlab_sp1_t5"; dbs.append(db)
            link = await ft(tab1, "makeLink", db)
            msg = (await ft(tab1, "makeSp1", db, link["lid"], [entry("e1")]))["message"]
            r1, r2 = await asyncio.gather(
                tab1.evaluate("([db, m]) => FT.intakeSp1(db, m)", [db, msg]),
                tab2.evaluate("([db, m]) => FT.intakeSp1(db, m)", [db, msg]),
            )
            st = sorted((r1["entries"][0].get("status"), r2["entries"][0].get("status")))
            same_id = r1["entries"][0].get("reportId") == r2["entries"][0].get("reportId")
            snap = await ft(tab1, "snapshot", db)
            check("T5 iki sekme aynı paket → tek bildirim",
                  st == ["created", "existing"] and same_id
                  and len(snap["reports"]) == 1 and snap["sources"] == 1,
                  f"sonuçlar={st} aynıRapor={same_id} rapor={len(snap['reports'])} zarf={snap['sources']}")

            # ================= T6: iki sekme aynı revizyonu onaylar =================
            db = "flowlab_sp1_t6"; dbs.append(db)
            link = await ft(tab1, "makeLink", db)
            o = await ft(tab1, "intakeSp1", db, (await ft(tab1, "makeSp1", db, link["lid"], [entry("e1")]))["message"])
            rid = o["entries"][0]["reportId"]
            g = await ft(tab1, "get", db, rid)
            g = await ft(tab1, "startCheck", db, rid, g["version"])
            g = await ft(tab1, "completeCheck", db, rid, g["version"])
            a1, a2 = await asyncio.gather(
                tab1.evaluate("([db, i, v, r]) => FT.approve(db, i, v, r)", [db, rid, g["version"], g["rev_no"]]),
                tab2.evaluate("([db, i, v, r]) => FT.approve(db, i, v, r)", [db, rid, g["version"], g["rev_no"]]),
            )
            res = sorted(x.get("result", x.get("error")) for x in (a1, a2))
            snap = await ft(tab1, "snapshot", db)
            check("T6 iki sekme aynı revizyon onayı → tek iş",
                  res == ["approved", "existing"] and snap["works"] == 1 and snap["approvals"] == 1,
                  f"sonuçlar={res} iş={snap['works']} onay={snap['approvals']}")

            # ================= T7: eksik ek tamamlanınca aynı işlem =================
            db = "flowlab_sp1_t7"; dbs.append(db)
            link = await ft(tab1, "makeLink", db)
            o = await ft(tab1, "intakeSp1", db,
                         (await ft(tab1, "makeSp1", db, link["lid"], [entry("e1", ph=1)]))["message"])
            rid = o["entries"][0]["reportId"]
            g = await ft(tab1, "get", db, rid)
            g = await ft(tab1, "startCheck", db, rid, g["version"])
            blocked = await ft(tab1, "completeCheck", db, rid, g["version"])
            g = await ft(tab1, "attachMedia", db, rid, [{"name": "TEST-foto.bin", "bytes": [7, 7, 7]}], True, g["version"])
            done = await ft(tab1, "completeCheck", db, rid, g["version"])
            ap = await ft(tab1, "approve", db, rid, done["version"], done["rev_no"])
            fin = await ft(tab1, "get", db, rid)
            check("T7 eksik ek tamamlanınca aynı op onaya gider",
                  blocked.get("error") == "ATTACHMENT_MISSING" and done.get("state") == "onay_bekliyor"
                  and ap.get("result") == "approved" and fin["id"] == rid and fin["state"] == "onaylandi",
                  f"blok={blocked.get('error')} sonra={done.get('state')} onay={ap.get('result')}")

            # ================= T8: kapanış/açılış kalıcılığı =================
            db = "flowlab_sp1_t8"; dbs.append(db)
            tabx = await context.new_page()
            await goto_ready(tabx, HARNESS)
            link = await ft(tabx, "makeLink", db)
            msg = (await ft(tabx, "makeSp1", db, link["lid"], [entry("e1")]))["message"]
            o = await ft(tabx, "intakeSp1", db, msg)
            rid = o["entries"][0]["reportId"]
            g = await ft(tabx, "get", db, rid)
            await ft(tabx, "startCheck", db, rid, g["version"])
            await tabx.close()  # "uygulama kapandı"
            taby = await context.new_page()  # "yeniden açıldı" — aynı origin+profil
            await goto_ready(taby, HARNESS)
            fin = await ft(taby, "get", db, rid)
            check("T8 kapanış/açılış: bekleyen bildirim + ham kaynak korunur",
                  fin and fin["state"] == "kontrolde" and fin["rawText"] == msg,
                  f"durum={fin and fin['state']} hamKaynak={fin and fin['rawText'] == msg}")
            await taby.close()

            # ================= T9: ana uygulama + tarayıcı durumu değişmedi =================
            probe_after = await ft(tab1, "probeMain", MAIN_DB)
            new_dbs = sorted(set(probe_after["databases"]) - set(probe_before["databases"]))
            main_same = probe_after["main"] == probe_before["main"]
            ls_same = probe_after["localStorage"] == probe_before["localStorage"]
            cache_same = probe_after["caches"] == probe_before["caches"]
            check("T9 ana YZ2 kayıtları + ayarlar + önbellekler değişmedi",
                  main_same and ls_same and cache_same and all(n.startswith("flowlab_sp1_") for n in new_dbs),
                  f"anaDB={'aynı' if main_same else 'DEĞİŞTİ'} localStorage={'aynı' if ls_same else 'DEĞİŞTİ'} "
                  f"cache={'aynı' if cache_same else 'DEĞİŞTİ'} yeniDB={new_dbs}")

            # ================= T10: çevrimdışı SP1 akışı (SW önbelleği) =================
            db = "flowlab_sp1_t10"; dbs.append(db)
            await context.set_offline(True)
            try:
                off = await context.new_page()
                await off.goto(f"{BASE}/lab.html?db={db}", wait_until="domcontentloaded", timeout=20000)
                await off.wait_for_function("!!window.__lab", timeout=15000)
                res = await off.evaluate(
                    """async () => {
                      const L = window.__lab;
                      const link = (await L.svc.createLabLink({ pid: 'TEST-P-OFF', name: 'TEST-Şoför Off', vid: 'TEST-V-BT', days: 180 })).link;
                      const drv = await import('./js/driver-core.js');
                      const cfg = { p: [link.pid, link.name], lid: link.lid, ls: link.secret,
                        V: [['TEST-V-BT', 'TEST-34 BT 01']], C: [['TEST-C-BT', 'TEST-Müşteri BT']],
                        S: [], D: [], E: [], Y: null };
                      const msg = await drv.driverMessage(
                        [{ id: 'e1', date: '2026-10-18', vid: 'TEST-V-BT', cid: 'TEST-C-BT',
                           wt: 'Hafriyat Nakliye', q: 2, u: 'Sefer' }], cfg);
                      const out = await L.svc.intakeSp1Message(msg);
                      const rid = out.entries[0].reportId;
                      let r = await L.store.get('reports', rid);
                      r = await L.svc.startCheck(rid, L.OFIS, r.version);
                      r = await L.svc.completeCheck(rid, L.OFIS, r.version);
                      const ap = await L.svc.approve(rid, L.YON, r.version, r.rev_no);
                      return { accepted: out.accepted, entry: out.entries[0].status,
                               result: ap.result, works: (await L.store.all('works')).length };
                    }"""
                )
                await off.close()
            finally:
                await context.set_offline(False)
            check("T10 çevrimdışı geçerli SP1 akışı (al→kontrol→onay)",
                  res.get("accepted") == 1 and res.get("entry") == "created"
                  and res.get("result") == "approved" and res.get("works") == 1,
                  f"sonuç={res}")

            # ---- temizlik: yalnız bu dosyanın lab veritabanları silinir ----
            for db in dbs:
                try:
                    await ft(tab1, "deleteDb", db)
                except Exception:  # noqa: BLE001
                    pass
            await browser.close()
    finally:
        server.terminate()

    failed = [r for r in results if not r[1]]
    print(f"\nTARAYICI SP1 ÖZET: {len(results) - len(failed)}/{len(results)} senaryo PASS", flush=True)
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
