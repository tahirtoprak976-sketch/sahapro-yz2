#!/usr/bin/env python3
"""SAHAPRO YZ2 — sunucu dilimi tarayıcı kabul testleri.

Üç AYRI browser context = üç AYRI GERÇEK oturum (şoför/ofis/yönetici) + rakip şirket
ve oturumsuz istemci, hepsi ORTAK GERÇEK test sunucusuna (yerel yığın) bağlanır.
Yetki denemeleri kullanıcıların kendi düşük yetkili oturumlarından yapılır.

Senaryolar (görev maddesi 6 ile birebir):
  B1  şoför gönderir → ofis ekranında görünür
  B2  ofis kontrolü tamamlar → yönetici ekranında görünür
  B3  yönetici onaylar → şoför ekranında Onaylandı
  B4  yeniden gönderim → sunucuda tek bildirim
  B5  sunucu yanıtı yolda kaybolur + aynı op ile yeniden deneme → tek bildirim, kuyruk kalıcı
  B6  iki yönetici aynı kaydı onaylar → tek iş
  B7  düzeltme iste → şoför düzeltip aynı op ile gönderir → tek bildirim, yeni revizyon
  B8  şoför approve RPC'sini çağırır → reddedilir (gerçek oturumdan)
  B9  rakip şirket kimliği bilse bile okuyamaz/yazamaz
  B10 oturumsuz istek → 401
  B11 çevrimdışı gönderim → kuyruk korunur; bağlantı dönünce aynı op ile gider
  (B12 = transaction ortası hata: API suitinde, tetik fikstürü gerektirdiği için orada)

Kullanım: python3 tests/sunucu_browser_test.py  (yığını gerektiğinde kendisi kurar)
"""
from __future__ import annotations

import asyncio
import json
import subprocess
import sys
import time
import uuid

sys.path.insert(0, __file__.rsplit("/", 1)[0])
import server_local_stack as S  # noqa: E402

BASE = "http://127.0.0.1:8124"
RESULTS: list[tuple[bool, str]] = []


def check(name: str, cond: bool, detail: str = "") -> None:
    RESULTS.append((bool(cond), name))
    print(f"{'ok' if cond else 'FAIL'} {len(RESULTS)} - {name}" + (f" :: {str(detail)[:300]}" if detail else ""))


async def login(page, email: str) -> None:
    await page.goto(f"{BASE}/sunucu.html", wait_until="networkidle")
    await page.fill("#email", email)
    await page.fill("#password", S.TEST_PASSWORD)
    await page.click("#login-form button[type=submit]")
    await page.wait_for_selector("#app:not([style*='none'])", timeout=10000)


async def fill_and_send(page, qty: int, note: str) -> None:
    await page.fill("#drv-quantity", str(qty))
    await page.fill("#drv-note", note)
    await page.click("#drv-form button[type=submit]")


async def outbox(page):
    return await page.evaluate("""async () => {
      const { outboxList } = await import('./js/sunucu-client.js');
      return await outboxList();
    }""")


async def api_from(page, js: str):
    """Sayfa oturumunun JWT'siyle API çağrısı (gerçek düşük yetkili oturum)."""
    return await page.evaluate(f"""async () => {{
      const {{ rpc, apiGet }} = await import('./js/sunucu-client.js');
      try {{ return {{ ok: true, data: await ({js}) }}; }}
      catch (e) {{ return {{ ok: false, status: e.status, code: e.code, message: e.message }}; }}
    }}""")


async def main() -> int:
    subprocess.run([sys.executable, __file__.rsplit("/", 1)[0] + "/server_local_stack.py", "up"],
                   check=True, capture_output=True)
    httpd = subprocess.Popen([sys.executable, "-m", "http.server", "8124", "--bind", "127.0.0.1"],
                             cwd=__file__.rsplit("/", 2)[0],
                             stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(1)
    try:
        from playwright.async_api import async_playwright
        pw = await async_playwright().start()
        br = await pw.chromium.launch(executable_path="/usr/bin/chromium", args=["--no-sandbox"])

        ctx_s = await br.new_context()   # şoför
        ctx_o = await br.new_context()   # ofis
        ctx_y1 = await br.new_context()  # yönetici 1
        ctx_y2 = await br.new_context()  # yönetici 2
        ctx_r = await br.new_context()   # rakip şirket şoförü
        ctx_a = await br.new_context()   # oturumsuz
        ps, po = await ctx_s.new_page(), await ctx_o.new_page()
        py1, py2 = await ctx_y1.new_page(), await ctx_y2.new_page()
        pr, pa = await ctx_r.new_page(), await ctx_a.new_page()
        for p, dlg in ((po, "TEST düzeltme gerekçesi"),):  # prompt() yanıtları
            p.on("dialog", lambda d: asyncio.ensure_future(d.accept(dlg)))

        await login(ps, "test-sofor-1@example.invalid")
        await login(po, "test-ofis-1@example.invalid")
        await login(py1, "test-yonetici-1@example.invalid")
        await login(py2, "test-yonetici-2@example.invalid")
        await login(pr, "test-rakip-sofor@example.invalid")
        await pa.goto(f"{BASE}/sunucu.html", wait_until="networkidle")

        # ---------- B1: şoför gönderir → ofis görür ----------
        tag1 = f"TEST-B1-{uuid.uuid4().hex[:6]}"
        await fill_and_send(ps, 4, tag1)
        await ps.wait_for_selector(".msg-ok:not([style*='none'])", timeout=10000)
        items = await outbox(ps)
        op1 = [i for i in items if i["fields"]["note"] == tag1][0]
        check("B1a şoför kuyruğu: Sunucu aldı (ofis sırasında)",
              op1["status"] == "sunucu_aldi" and op1["server_state"] == "gonderildi", op1)
        await po.click("#ofis-refresh")
        await po.wait_for_selector(f"#ofis-list .row:has-text('{tag1}')", timeout=10000)
        check("B1b ofis ekranında görünür", True)

        # ---------- B2: ofis kontrol → yönetici görür ----------
        await po.locator("#ofis-list .row", has_text=tag1).first.locator(".lab-btn").click()
        await po.locator("#ofis-detail .btn-row .lab-btn").first.click()  # Kontrole al
        await po.wait_for_selector(".msg-ok:not([style*='none'])", timeout=10000)
        await po.locator("#ofis-list .row", has_text=tag1).first.locator(".lab-btn").click()
        await po.wait_for_selector("#of-edit-q", timeout=10000)
        await po.locator("#ofis-detail button", has_text="Kontrolü tamamla").click()
        await po.wait_for_selector(".msg-ok:not([style*='none'])", timeout=10000)
        await py1.click("#yon-refresh")
        await py1.wait_for_selector(f"#yon-list .row:has-text('{tag1}')", timeout=10000)
        check("B2 yönetici ekranında onay bekleyen olarak görünür", True)

        # ---------- B3: yönetici onaylar → şoför Onaylandı ----------
        await py1.locator("#yon-list .row", has_text=tag1).first.locator(".lab-btn").click()
        await py1.wait_for_selector("#yon-detail:not([style*='none'])")
        await py1.locator("#yon-detail button", has_text="Onayla").click()
        await py1.wait_for_selector(".msg-ok:not([style*='none'])", timeout=10000)
        msg = await py1.inner_text("#msg")
        check("B3a onaylandı + iş kaydı", "Onaylandı; iş kaydı" in msg, msg)
        await ps.click("#drv-refresh")
        await ps.wait_for_selector(f"#drv-list .row:has-text('Onaylandı')", timeout=10000)
        check("B3b şoför ekranında Onaylandı", True)

        # ---------- B6: iki yönetici → tek iş ----------
        tag6 = f"TEST-B6-{uuid.uuid4().hex[:6]}"
        await fill_and_send(ps, 3, tag6)
        await ps.wait_for_selector(".msg-ok:not([style*='none'])", timeout=10000)
        await po.click("#ofis-refresh")
        await po.locator("#ofis-list .row", has_text=tag6).first.locator(".lab-btn").click()
        await po.locator("#ofis-detail .btn-row .lab-btn").first.click()
        await po.wait_for_selector(".msg-ok:not([style*='none'])", timeout=10000)
        await po.locator("#ofis-list .row", has_text=tag6).first.locator(".lab-btn").click()
        await po.wait_for_selector("#of-edit-q", timeout=10000)
        await po.locator("#ofis-detail button", has_text="Kontrolü tamamla").click()
        await po.wait_for_selector(".msg-ok:not([style*='none'])", timeout=10000)
        for py in (py1, py2):
            await py.click("#yon-refresh")
        # aynı anda iki onay tıklaması
        await py1.locator("#yon-list .row", has_text=tag6).first.locator(".lab-btn").click()
        await py2.locator("#yon-list .row", has_text=tag6).first.locator(".lab-btn").click()
        b1 = py1.locator("#yon-detail button", has_text="Onayla")
        b2 = py2.locator("#yon-detail button", has_text="Onayla")
        await asyncio.gather(b1.click(), b2.click())
        await asyncio.sleep(2)
        rid6 = op = None
        items = await outbox(ps)
        rid6 = [i for i in items if i["fields"]["note"] == tag6][0]["report_id"]
        works = await api_from(po, f"apiGet('/works?report_id=eq.{rid6}&select=id')")
        check("B6 iki yönetici onayı → sunucuda tek iş", len(works["data"]) == 1, works)

        # ---------- B5: kayıp yanıt + retry → tek bildirim; kuyruk reload'da kalıcı ----------
        tag5 = f"TEST-B5-{uuid.uuid4().hex[:6]}"

        async def sabotaj(route):
            await route.fetch()          # istek sunucuya GERÇEKTEN ulaşır ve işlenir
            await route.abort()          # ama yanıt telefona DÖNMEZ (kayıp yanıt)

        await ctx_s.route("**/rpc/submit_work", sabotaj)
        await fill_and_send(ps, 2, tag5)
        await ps.wait_for_selector("#drv-list .row:has-text('Telefonda bekliyor')", timeout=10000)
        items = await outbox(ps)
        it5 = [i for i in items if i["fields"]["note"] == tag5][0]
        check("B5a yanıt kaybı → kayıt telefonda bekliyor (sunucu aldı DENMEZ)",
              it5["status"] == "bekliyor" and it5["report_id"] is None, it5)
        await ps.reload(wait_until="networkidle")   # uygulama kapanıp açıldı say
        await ps.wait_for_selector(f"#drv-list .row:has-text('{tag5}')", timeout=10000)
        check("B5b yeniden başlatmada kuyruk korunur (IndexedDB)", True)
        await ctx_s.unroute("**/rpc/submit_work")
        await ps.locator("#drv-list .row", has_text=tag5).first.locator("button", has_text="Gönder").click()
        await ps.wait_for_selector(f"#drv-list .row:has-text('{tag5}'):has-text('Sunucu aldı')", timeout=10000)
        items = await outbox(ps)
        rid5 = [i for i in items if i["fields"]["note"] == tag5][0]["report_id"]
        reps = await api_from(po, f"apiGet('/reports?id=eq.{rid5}&select=id,state')")
        allr = await api_from(po, "apiGet('/reports?select=id,fields')")
        same = [r for r in allr["data"] if r["fields"].get("note") == tag5]
        check("B5c retry aynı op ile → tek bildirim, ikinci kayıt YOK",
              len(same) == 1 and reps["data"][0]["state"] == "gonderildi", same)

        # ---------- B4: aynı içerik yeniden gönderim → existing, tek satır ----------
        items = await outbox(ps)
        op5 = [i for i in items if i["fields"]["note"] == tag5][0]["op_id"]
        again = await api_from(ps, "rpc('submit_work', { p_op_key: '" + op5 + "',"
            " p_fields: { date: '2026-10-18', vehicle: 'TEST-34 ABC 01', customer: 'TEST-Müşteri Ümraniye',"
            " work_type: 'Hafriyat Nakliye', quantity: 2, unit: 'Sefer', note: '" + tag5 + "' } })")
        allr = await api_from(po, "apiGet('/reports?select=id,fields')")
        same = [r for r in allr["data"] if r["fields"].get("note") == tag5]
        check("B4 aynı op + aynı içerik → existing, tek bildirim",
              again["ok"] and again["data"].get("result") == "existing" and len(same) == 1, again)

        # ---------- B7: düzeltme döngüsü ----------
        tag7 = f"TEST-B7-{uuid.uuid4().hex[:6]}"
        await fill_and_send(ps, 9, tag7)
        await ps.wait_for_selector(".msg-ok:not([style*='none'])", timeout=10000)
        await po.click("#ofis-refresh")
        await po.locator("#ofis-list .row", has_text=tag7).first.locator(".lab-btn").click()
        await po.locator("#ofis-detail .btn-row .lab-btn").first.click()   # kontrole al
        await po.wait_for_selector(".msg-ok:not([style*='none'])", timeout=10000)
        await po.locator("#ofis-list .row", has_text=tag7).first.locator(".lab-btn").click()
        await po.wait_for_selector("#of-edit-q", timeout=10000)
        await po.locator("#ofis-detail button", has_text="Düzeltme iste").click()  # prompt auto-accept
        await po.wait_for_selector(".msg-ok:not([style*='none'])", timeout=10000)
        await ps.click("#drv-refresh")
        await ps.wait_for_selector(f"#drv-list .row:has-text('{tag7}'):has-text('Düzeltme istendi')", timeout=10000)
        check("B7a şoför 'Düzeltme istendi' + gerekçe görür", True)
        ps.once("dialog", lambda d: asyncio.ensure_future(d.accept("11")))  # miktar düzeltme promptu
        await ps.locator("#drv-list .row", has_text=tag7).first.locator("button", has_text="Düzelt ve yeniden gönder").click()
        await ps.wait_for_selector(f"#drv-list .row:has-text('{tag7}'):has-text('Sunucu aldı')", timeout=10000)
        items = await outbox(ps)
        rid7 = [i for i in items if i["fields"]["note"] == tag7][0]["report_id"]
        revs = await api_from(po, f"apiGet('/revisions?report_id=eq.{rid7}&select=rev_no,changes,reason&order=rev_no')")
        allr = await api_from(po, "apiGet('/reports?select=id,fields')")
        same = [r for r in allr["data"] if r["fields"].get("note") == tag7]
        check("B7b aynı op ile düzeltme → tek bildirim, yeni revizyon (quantity 9→11)",
              len(same) == 1 and len(revs["data"]) == 2 and
              revs["data"][1]["changes"].get("quantity", {}).get("to") == 11, revs)

        # ---------- B8: şoför approve çağırır → reddedilir (kendi gerçek oturumu) ----------
        atk = await api_from(ps, f"rpc('approve_report', {{ p_report_id: '{rid7}', p_expected_version: 1, p_rev_no: 0 }})")
        check("B8 şoför approve → 403 FORBIDDEN_ROLE",
              atk.get("status") == 403 and atk.get("code") == "FORBIDDEN_ROLE", atk)

        # ---------- B9: rakip şirket kimliği bilse bile erişemez ----------
        peek = await api_from(pr, f"apiGet('/reports?id=eq.{rid7}&select=id')")
        atk2 = await api_from(pr, f"rpc('approve_report', {{ p_report_id: '{rid7}', p_expected_version: 1, p_rev_no: 0 }})")
        check("B9 rakip okuma boş + onay tek tip 403",
              peek.get("data") == [] and atk2.get("status") == 403 and "FORBIDDEN" in str(atk2.get("message")),
              (peek, atk2))

        # ---------- B10: oturumsuz → 401 ----------
        raw = await pa.evaluate("""async () => {
          const r = await fetch('http://127.0.0.1:53001/reports?select=id');
          return r.status;
        }""")
        check("B10 oturumsuz GET → 401", raw == 401, raw)

        # ---------- B11: çevrimdışı gönderim → kuyruk korunur ----------
        tag11 = f"TEST-B11-{uuid.uuid4().hex[:6]}"
        await ctx_s.set_offline(True)
        await fill_and_send(ps, 1, tag11)
        await ps.wait_for_selector(f"#drv-list .row:has-text('{tag11}'):has-text('Telefonda bekliyor')", timeout=10000)
        items = await outbox(ps)
        it11 = [i for i in items if i["fields"]["note"] == tag11][0]
        check("B11a çevrimdışı → kayıt telefonda kalır (bekliyor)", it11["status"] == "bekliyor", it11)
        await ctx_s.set_offline(False)
        await ps.locator("#drv-list .row", has_text=tag11).first.locator("button", has_text="Gönder").click()
        await ps.wait_for_selector(f"#drv-list .row:has-text('{tag11}'):has-text('Sunucu aldı')", timeout=10000)
        allr = await api_from(po, "apiGet('/reports?select=id,fields')")
        same = [r for r in allr["data"] if r["fields"].get("note") == tag11]
        check("B11b bağlantı dönünce aynı op ile tek bildirim", len(same) == 1, same)

        # kanıt ekranları
        import os
        os.makedirs("/tmp/yz2shots", exist_ok=True)
        await ps.screenshot(path="/tmp/yz2shots/son-sofor.png", full_page=True)
        await po.click("#ofis-refresh"); await po.screenshot(path="/tmp/yz2shots/son-ofis.png", full_page=True)
        await py1.click("#yon-refresh"); await py1.screenshot(path="/tmp/yz2shots/son-yonetici.png", full_page=True)

        await br.close(); await pw.stop()
    finally:
        httpd.terminate()

    failed = [n for ok, n in RESULTS if not ok]
    print(f"\n{'PASS' if not failed else 'FAIL'} — {len(RESULTS) - len(failed)}/{len(RESULTS)} senaryo")
    for n in failed:
        print("  FAIL:", n)
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
