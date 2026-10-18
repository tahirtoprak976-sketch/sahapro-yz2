#!/usr/bin/env python3
"""SAHAPRO YZ2 — onay akışı GERÇEK TARAYICI testleri (Playwright + gerçek IndexedDB).

node sahte-depolama (fake-indexeddb) testlerinin YANINA konur; yerine geçmez.
İKİ GERÇEK SEKME: aynı browser context içinde iki page — aynı origin, aynı profil,
dolayısıyla aynı IndexedDB veritabanını paylaşır (adaptör nesnesi benzetimi YOK).

Senaryolar (kullanıcı maddeleri):
  S1 iki sekme aynı bildirimi aynı anda alır
  S2 iki sekme aynı anda onaylar
  S3 onay + düzenleme yarışı
  S4 sekme kapanıp açılır (kalıcılık)
  S5 abort sonrası yeniden deneme
  S6 ek/audit hatasında sıfır yarım iş
  S7 tamamlanmış işlemin tekrarı

Hata enjeksiyonu: servis katmanının failAt kancası — tx İÇİNDE bilinçli hata
fırlatır ('work' | 'attachment' | 'approval' | 'audit' | 'attachments'); amaç
abort anlambilimini ve geç kalan not korumasını doğrulamak. Üretim kodu bu
kancayı kendiliğinden kullanmaz.

Çıkış: her senaryo için PASS/FAIL + kanıt özeti; sonda browser özeti.
"""
import asyncio
import json
import subprocess
import sys
import time
import os

from playwright.async_api import async_playwright

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = 8123
BASE = f"http://127.0.0.1:{PORT}"
HARNESS = f"{BASE}/tests/flow-browser-harness.html"

PKT = {
    "linkId": "lnk_bt", "entryId": "e1",
    "rawText": "TEST- tarayıcı senaryosu 3 sefer hafriyat",
    "fields": {"date": "2026-10-18", "vehicle_id": "v1", "customer_id": "c1",
               "site_id": "s1", "work_type": "Hafriyat Nakliye", "quantity": 3, "unit": "Sefer"},
    "attachments": [{"name": "TEST-fis.bin", "bytes": [1, 2, 3]}],
}

results = []


def check(name, cond, detail=""):
    results.append((name, bool(cond), str(detail)))
    print(("PASS " if cond else "FAIL ") + name + (" — " + str(detail) if detail else ""), flush=True)


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


async def prep_ready(tab, db, pkt=None):
    """intake → startCheck → completeCheck; (id, version, rev_no) döner."""
    pkt = pkt or PKT
    r = await tab.evaluate("([db, p]) => FT.intake(db, p)", [db, pkt])
    assert r.get("result") == "created", r
    rid, v = r["id"], r["version"]
    r = await tab.evaluate("([db, i, v]) => FT.startCheck(db, i, v)", [db, rid, v])
    assert r.get("state") == "kontrolde", r
    r = await tab.evaluate("([db, i, v]) => FT.completeCheck(db, i, v)", [db, rid, r["version"]])
    assert r.get("state") == "onay_bekliyor", r
    return rid, r["version"], r["rev_no"]


async def main():
    server = subprocess.Popen(
        [sys.executable, "-m", "http.server", str(PORT), "--bind", "127.0.0.1"],
        cwd=REPO, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )
    time.sleep(1.0)
    dbs = []
    try:
        async with async_playwright() as p:
            browser = await p.chromium.launch(
                executable_path="/usr/bin/chromium",
                args=["--no-sandbox", "--disable-dev-shm-usage"],
            )
            context = await browser.new_context()
            tab1 = await context.new_page()
            tab2 = await context.new_page()
            await goto_ready(tab1, HARNESS)
            await goto_ready(tab2, HARNESS)

            # ---- S1: iki sekme aynı bildirimi aynı anda alır
            db = "flowlab_bt_s1"; dbs.append(db)
            r1, r2 = await asyncio.gather(
                tab1.evaluate("([db, p]) => FT.intake(db, p)", [db, PKT]),
                tab2.evaluate("([db, p]) => FT.intake(db, p)", [db, PKT]),
            )
            got = sorted(x.get("result", x.get("error")) for x in (r1, r2))
            snap = await tab1.evaluate("(db) => FT.snapshot(db)", db)
            check("S1 eşzamanlı alım", got == ["created", "existing"] and len(snap["reports"]) == 1,
                  f"sonuçlar={got} rapor={len(snap['reports'])}")

            # ---- S2: iki sekme aynı anda onaylar
            db = "flowlab_bt_s2"; dbs.append(db)
            rid, v, rev = await prep_ready(tab1, db)
            a1, a2 = await asyncio.gather(
                tab1.evaluate("([db, i, v, r]) => FT.approve(db, i, v, r)", [db, rid, v, rev]),
                tab2.evaluate("([db, i, v, r]) => FT.approve(db, i, v, r)", [db, rid, v, rev]),
            )
            res = sorted(x.get("result", x.get("error")) for x in (a1, a2))
            snap = await tab1.evaluate("(db) => FT.snapshot(db)", db)
            check("S2 eşzamanlı onay", res == ["approved", "existing"] and snap["works"] == 1 and snap["approvals"] == 1,
                  f"sonuçlar={res} iş={snap['works']} onay={snap['approvals']}")

            # ---- S3: onay + düzenleme yarışı (tek kazanan, yırtık durum yok)
            db = "flowlab_bt_s3"; dbs.append(db)
            rid, v, rev = await prep_ready(tab1, db)
            ap, ed = await asyncio.gather(
                tab1.evaluate("([db, i, v, r]) => FT.approve(db, i, v, r)", [db, rid, v, rev]),
                tab2.evaluate("([db, i, p, v]) => FT.edit(db, i, p, v)", [db, rid, {"quantity": 9}, v]),
            )
            fin = await tab1.evaluate("([db, i]) => FT.get(db, i)", [db, rid])
            snap = await tab1.evaluate("(db) => FT.snapshot(db)", db)
            approve_won = fin["state"] == "onaylandi" and snap["works"] == 1
            edit_won = fin["state"] == "kontrolde" and fin["rev_no"] == 1 and snap["works"] == 0
            torn = (fin["state"] == "onaylandi" and fin["rev_no"] != 0) or (snap["works"] == 1 and fin["rev_no"] != 0)
            check("S3 onay+düzenleme yarışı", (approve_won or edit_won) and not torn,
                  f"kazanan={'onay' if approve_won else 'düzenleme' if edit_won else '?'} "
                  f"approve={ap.get('result', ap.get('error'))} edit={ed.get('state', ed.get('error'))} "
                  f"son={fin['state']}/r{fin['rev_no']} iş={snap['works']}")

            # ---- S4: sekme kapanıp açılır → bekleyen işlem korunur
            db = "flowlab_bt_s4"; dbs.append(db)
            r = await tab1.evaluate("([db, p]) => FT.intake(db, p)", [db, PKT])
            rid, v = r["id"], r["version"]
            await tab1.evaluate("([db, i, v]) => FT.startCheck(db, i, v)", [db, rid, v])
            await tab1.close()  # "uygulama kapandı"
            tab3 = await context.new_page()  # "yeniden açıldı" — aynı origin+profil
            await goto_ready(tab3, HARNESS)
            fin = await tab3.evaluate("([db, i]) => FT.get(db, i)", [db, rid])
            check("S4 kapanış/açılış kalıcılığı", fin and fin["state"] == "kontrolde" and fin["rawText"] == PKT["rawText"],
                  f"durum={fin and fin['state']} ham kaynak korunmuş={fin and fin['rawText'] == PKT['rawText']}")
            tab1 = tab3

            # ---- S5: abort sonrası yeniden deneme
            db = "flowlab_bt_s5"; dbs.append(db)
            rid, v, rev = await prep_ready(tab1, db)
            bad = await tab1.evaluate("([db, i, v, r]) => FT.approve(db, i, v, r, 'attachment')", [db, rid, v, rev])
            mid = await tab1.evaluate("([db, i]) => FT.get(db, i)", [db, rid])
            snap = await tab1.evaluate("(db) => FT.snapshot(db)", db)
            fin = await tab1.evaluate("([db, i]) => FT.get(db, i)", [db, rid])
            retry = await tab1.evaluate("([db, i, v, r]) => FT.approve(db, i, v, r)", [db, rid, fin["version"], rev])
            snap2 = await tab1.evaluate("(db) => FT.snapshot(db)", db)
            check("S5 abort→retry", bad.get("error") == "INJECTED" and mid["state"] == "onay_bekliyor"
                  and snap["works"] == 0 and retry.get("result") == "approved" and snap2["works"] == 1,
                  f"abort={bad.get('error')} orta durum={mid['state']} retry={retry.get('result')}")

            # ---- S6: ek/audit hatasında sıfır yarım iş
            for tag, fail_at in (("audit", "audit"), ("work", "work")):
                db = f"flowlab_bt_s6_{tag}"; dbs.append(db)
                rid, v, rev = await prep_ready(tab1, db)
                bad = await tab1.evaluate("([db, i, v, r, f]) => FT.approve(db, i, v, r, f)", [db, rid, v, rev, fail_at])
                snap = await tab1.evaluate("(db) => FT.snapshot(db)", db)
                unlinked = all(a["work_id"] is None for a in snap["attachments"])
                check(f"S6 yarım iş yok ({tag})", bad.get("error") == "INJECTED" and snap["works"] == 0
                      and snap["approvals"] == 0 and unlinked and snap["reports"][0]["state"] == "onay_bekliyor",
                      f"{tag}: iş={snap['works']} onay={snap['approvals']} bağsız ek={unlinked} durum={snap['reports'][0]['state']}")

            # ---- S7: tamamlanmış işlemin tekrarı
            db = "flowlab_bt_s7"; dbs.append(db)
            rid, v, rev = await prep_ready(tab1, db)
            first = await tab1.evaluate("([db, i, v, r]) => FT.approve(db, i, v, r)", [db, rid, v, rev])
            again = await tab1.evaluate("([db, i, v, r]) => FT.approve(db, i, v, r)", [db, rid, v, rev])
            rin = await tab1.evaluate("([db, p]) => FT.intake(db, p)", [db, PKT])
            snap = await tab1.evaluate("(db) => FT.snapshot(db)", db)
            check("S7 tamamlanmış işlem tekrarı", first.get("result") == "approved"
                  and again.get("result") == "existing" and again.get("workId") == first.get("workId")
                  and rin.get("result") == "existing" and snap["works"] == 1 and snap["approvals"] == 1,
                  f"ilk={first.get('result')} tekrar={again.get('result')} alım={rin.get('result')} iş={snap['works']}")

            # ---- temizlik: yalnız test veritabanları silinir
            for db in dbs:
                try:
                    await tab1.evaluate("(db) => FT.deleteDb(db)", db)
                except Exception:  # noqa: BLE001
                    pass
            await browser.close()
    finally:
        server.terminate()

    failed = [r for r in results if not r[1]]
    print(f"\nTARAYICI ÖZET: {len(results) - len(failed)}/{len(results)} senaryo PASS", flush=True)
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
