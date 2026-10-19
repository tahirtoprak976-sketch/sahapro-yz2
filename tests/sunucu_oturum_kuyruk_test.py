#!/usr/bin/env python3
"""SAHAPRO YZ2 — oturum ve yerel kuyruk ilişkisi testleri (tarayıcı, gerçek oturumlar).

Görev maddesi 3:
  O1  oturum tamamen düşerse (refresh de geçersiz) kuyruk KORUNUR; yeniden
      girişte kayıtlar "bekliyor" durumuyla durur
  O2  süresi dolan access token refresh ile yenilenir ve aynı op yeniden
      gönderildiğinde sunucuda İKİNCİ bildirim açılmaz (existing)
  O3  kullanıcı değişimi: başka kullanıcıyla girişte ilk kullanıcının kuyruğu
      onun ADINA GÖNDERİLMEZ (istemci sahip kilidi OWNER_MISMATCH + arayüzde
      gösterge); sunucuda da kayıt oluşmaz
  O4  sahibi bilinmeyen ESKİ kayıt (owner_email yok) geriye uyumlu olarak
      gönderilebilir — bilinçli gevşeklik, raporda açıkça yazılır

Not: Bu testler istemci tarafındaki yanlışlık korumasını kanıtlar. Asıl yetki
denetimi her zaman sunucudadır (sunucu_rpc_denetim_test.py / sunucu_api_test.py).

Kullanım: python3 tests/sunucu_oturum_kuyruk_test.py
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


async def outbox(page):
    return await page.evaluate("""async () => {
      const { outboxList } = await import('./js/sunucu-client.js');
      return await outboxList();
    }""")


async def draft_offline(ctx, page, qty: int, note: str):
    """Ağ kapalıyken formu gönderir → kayıt 'bekliyor' kalır."""
    await ctx.set_offline(True)
    try:
        await page.fill("#drv-quantity", str(qty))
        await page.fill("#drv-note", note)
        await page.click("#drv-form button[type=submit]")
        await page.wait_for_selector(".msg-err:not([style*='none'])", timeout=10000)
    finally:
        await ctx.set_offline(False)


async def wait_status(page, op_id: str, want: str, timeout_s: float = 12):
    """Liste 'Gönder' düğmesi başarı mesajı göstermez; kuyruk durumunu yoklar."""
    t0 = time.time()
    while time.time() - t0 < timeout_s:
        it = [i for i in await outbox(page) if i["op_id"] == op_id]
        if it and it[0]["status"] == want:
            return it[0]
        await asyncio.sleep(0.5)
    return it[0] if it else None


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

        # ================= O1: oturum düşer, kuyruk kalır =================
        ctx1 = await br.new_context()
        p1 = await ctx1.new_page()
        await login(p1, "test-sofor-1@example.invalid")
        tag1 = f"TEST-O1-{uuid.uuid4().hex[:6]}"
        await draft_offline(ctx1, p1, 6, tag1)
        items = await outbox(p1)
        d1 = [i for i in items if i["fields"]["note"] == tag1]
        check("O1a çevrimdışı taslak 'bekliyor' ve sahibi kayıtlı",
              len(d1) == 1 and d1[0]["status"] == "bekliyor"
              and d1[0].get("owner_email") == "test-sofor-1@example.invalid", d1)
        op1 = d1[0]["op_id"]

        # oturumu tamamen düşür: expires_at geçmiş + refresh_token bozuk
        await p1.evaluate("""() => {
          const s = JSON.parse(localStorage.getItem('yz2_srv_session'));
          s.expires_at = Date.now() - 60000;
          s.refresh_token = 'BOZUK-refresh-token';
          localStorage.setItem('yz2_srv_session', JSON.stringify(s));
        }""")
        await p1.goto(f"{BASE}/sunucu.html", wait_until="networkidle")
        await p1.wait_for_selector("#login-card:not([style*='none'])", timeout=10000)
        items = await outbox(p1)   # giriş ekranında bile IndexedDB okunabilir
        check("O1b oturum düştü; giriş ekranına dönüldü ama kuyruk silinmedi",
              any(i["op_id"] == op1 for i in items), items)

        await login(p1, "test-sofor-1@example.invalid")   # aynı kullanıcı yeniden girer
        await p1.wait_for_selector(f"#drv-list .row:has-text('{tag1}')", timeout=10000)
        items = await outbox(p1)
        d1b = [i for i in items if i["op_id"] == op1][0]
        check("O1c yeniden girişte kayıt hâlâ 'bekliyor' ve gönderilebilir",
              d1b["status"] == "bekliyor", d1b)
        # gönderim çalışır → kuyruk gerçekten kullanılabilir durumda
        await p1.locator("#drv-list .row", has_text=tag1).first.locator(
            ".lab-btn", has_text="Gönder").click()
        d1c = await wait_status(p1, op1, "sunucu_aldi")
        check("O1d korunan kayıt sonradan gönderilebildi", d1c and d1c["status"] == "sunucu_aldi", d1c)

        # ================= O2: refresh çift iş açmaz =================
        ctx2 = await br.new_context()
        p2 = await ctx2.new_page()
        ctxo = await br.new_context()   # ofis gözlemci
        po = await ctxo.new_page()
        await login(p2, "test-sofor-1@example.invalid")
        await login(po, "test-ofis-1@example.invalid")
        tag2 = f"TEST-O2-{uuid.uuid4().hex[:6]}"

        # kayıp-yanıt sabotajı: sunucu işler, istemci yanıtı görmez → 'bekliyor'
        async def sabotaj(route):
            await route.fetch()
            await route.abort()
        await ctx2.route("**/rpc/submit_work", sabotaj)
        await p2.fill("#drv-quantity", "8")
        await p2.fill("#drv-note", tag2)
        await p2.click("#drv-form button[type=submit]")
        await p2.wait_for_selector(".msg-err:not([style*='none'])", timeout=10000)
        items = await outbox(p2)
        d2 = [i for i in items if i["fields"]["note"] == tag2][0]
        check("O2a sabotaj sonrası kayıt 'bekliyor'", d2["status"] == "bekliyor", d2)
        op2 = d2["op_id"]

        # access token'ı süresi dolmuş say → bir sonraki gönderim refresh yapar
        tok_before = await p2.evaluate("""() => {
          const s = JSON.parse(localStorage.getItem('yz2_srv_session'));
          s.expires_at = Date.now() - 60000;
          localStorage.setItem('yz2_srv_session', JSON.stringify(s));
          return s.access_token;
        }""")
        await ctx2.unroute("**/rpc/submit_work")
        await p2.locator("#drv-list .row", has_text=tag2).first.locator(
            ".lab-btn", has_text="Gönder").click()
        d2b = await wait_status(p2, op2, "sunucu_aldi")
        tok_after = await p2.evaluate(
            "() => JSON.parse(localStorage.getItem('yz2_srv_session')).access_token")
        check("O2b yeniden denemede access token refresh ile yenilendi",
              tok_after != tok_before)
        check("O2c yeniden deneme sunucuya ulaştı", d2b and d2b["status"] == "sunucu_aldi", d2b)
        cnt = await po.evaluate(f"""async () => {{
          const {{ apiGet }} = await import('./js/sunucu-client.js');
          return (await apiGet('/reports?op_key=eq.{op2}&select=id')).length;
        }}""")
        check("O2d refresh + retry sonrası sunucuda TEK bildirim", cnt == 1, cnt)

        # ================= O3: kullanıcı değişiminde sahip kilidi =================
        ctx3 = await br.new_context()
        p3 = await ctx3.new_page()
        await login(p3, "test-sofor-1@example.invalid")
        tag3 = f"TEST-O3-{uuid.uuid4().hex[:6]}"
        await draft_offline(ctx3, p3, 5, tag3)
        op3 = [i for i in await outbox(p3) if i["fields"]["note"] == tag3][0]["op_id"]

        await p3.click("#logout")   # çıkış → aynı cihazda başka kullanıcı
        await p3.wait_for_selector("#login-card:not([style*='none'])", timeout=10000)
        await login(p3, "test-rakip-sofor@example.invalid")
        await p3.wait_for_selector(f"#drv-list .row:has-text('{tag3}')", timeout=10000)
        row_txt = await p3.locator("#drv-list .row", has_text=tag3).first.inner_text()
        check("O3a yabancı kayıt arayüzde 'şu anki oturum DEĞİL' olarak işaretli",
              "şu anki oturum DEĞİL" in row_txt, row_txt[:160])
        btn_count = await p3.locator(
            f"#drv-list .row:has-text('{tag3}') .lab-btn").count()
        check("O3b yabancı kayıtta Gönder/Sil düğmesi yok", btn_count == 0, btn_count)
        r = await p3.evaluate(f"""async () => {{
          const {{ outboxSend, outboxGet }} = await import('./js/sunucu-client.js');
          try {{ await outboxSend('{op3}'); return {{ sent: true }}; }}
          catch (e) {{
            const it = await outboxGet('{op3}');
            return {{ sent: false, code: e.code, status: it.status }};
          }}
        }}""")
        check("O3c programatik gönderim OWNER_MISMATCH ile engellenir",
              r.get("sent") is False and r.get("code") == "OWNER_MISMATCH"
              and r.get("status") == "bekliyor", r)
        cnt = await po.evaluate(f"""async () => {{
          const {{ apiGet }} = await import('./js/sunucu-client.js');
          return (await apiGet('/reports?op_key=eq.{op3}&select=id')).length;
        }}""")
        check("O3d sunucuda bu op için hiç bildirim oluşmadı", cnt == 0, cnt)

        # ================= O4: sahipsiz eski kayıt geriye uyumluluğu =================
        # outboxDraft artık owner yazar; sahip alanı olmayan ESKİ kaydı elle kuruyoruz:
        op4 = str(uuid.uuid4())
        await p3.evaluate(f"""async () => {{
          const db = await new Promise((res, rej) => {{
            const rq = indexedDB.open('sahapro_yz2_srv', 1);
            rq.onsuccess = () => res(rq.result); rq.onerror = () => rej(rq.error);
          }});
          const item = {{ op_id: '{op4}', fields: {{ date: "2026-10-18",
            vehicle: "TEST-06 DEF 02", customer: "TEST-Müşteri Ataşehir",
            work_type: "Mıcır", quantity: 1, unit: "Sefer", note: "TEST-O4-eski" }},
            status: "bekliyor", report_id: null, server_state: null, reason: null,
            error: null, attempts: 0,
            created_at: new Date().toISOString(), updated_at: new Date().toISOString() }};
          await new Promise((res, rej) => {{
            const t = db.transaction('outbox','readwrite');
            t.objectStore('outbox').put(item);
            t.oncomplete = res; t.onerror = () => rej(t.error);
          }});
        }}""")
        r = await p3.evaluate(f"""async () => {{
          const {{ outboxSend }} = await import('./js/sunucu-client.js');
          try {{ const it = await outboxSend('{op4}'); return {{ ok: true, st: it.status }}; }}
          catch (e) {{ return {{ ok: false, code: e.code, msg: e.message }}; }}
        }}""")
        check("O4 sahipsiz (eski) kayıt gönderilebilir — bilinçli geriye uyumluluk",
              r.get("ok") is True and r.get("st") in ("sunucu_aldi", "gonderiliyor"), r)

        await br.close()
        await pw.stop()
    finally:
        httpd.terminate()

    ok = sum(1 for c, _ in RESULTS if c)
    print(f"\n{'PASS' if ok == len(RESULTS) else 'FAIL'} — {ok}/{len(RESULTS)} oturum/kuyruk kontrolü")
    return 0 if ok == len(RESULTS) else 1


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
