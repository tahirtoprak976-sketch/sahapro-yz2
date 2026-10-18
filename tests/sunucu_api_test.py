#!/usr/bin/env python3
"""SAHAPRO YZ2 — sunucu dilimi API kabul testleri (saldırgan dahil).

Ortam: GERÇEK yerel yığın (PostgreSQL + GoTrue + PostgREST), tests/server_local_stack.py ile.
Tüm API çağrıları GERÇEK DÜŞÜK YETKİLİ oturumlarla yapılır (kullanıcı JWT'leri);
service_role/yönetici bağlantısı yalnız test fikstürü kurulumunda (tohum, tetik, politika
bayrağı) kullanılır — hiçbir yetki testi o bağlantıyla koşmaz.

Senaryolar (görev maddesi 6):
  S1  şoför gönderir → ofis listede görür
  S2  ofis kontrolü tamamlar → yönetici onay listesinde görür
  S3  yönetici onaylar → şoför durumu Onaylandı + tek iş kaydı
  S4  aynı op ile tekrar gönderim → tek bildirim (existing)
  S5  yanıt kaybı sonrası aynı op ile yeniden deneme → tek bildirim
  S6  iki yönetici eşzamanlı onay → tek iş
  S7  kontrol sonrası içerik değişimi → eski revizyon onaylanamaz
  S8  şoför approve RPC çağırır → 403 FORBIDDEN_ROLE
  S9  rakip şirket kayıt kimliğini bilse bile erişemez
  S10 oturumsuz istek → 401
  S11 (tarayıcı suitinde: çevrimdışı kuyruk kalıcılığı)
  S12 onay transaction'ı ortasında hata → ne iş ne onay kalıntısı
  Ek: doğrudan tablo yazımı reddedilir; SAME_ACTOR şirket politikası; OP_CONFLICT.

Çıkış: TAP benzeri "ok N - ..." satırları; sonda PASS/FAIL özeti.
"""
from __future__ import annotations

import json
import subprocess
import sys
import threading
import uuid

sys.path.insert(0, __file__.rsplit("/", 1)[0])
import server_local_stack as S  # noqa: E402

RESULTS: list[tuple[bool, str]] = []


def check(name: str, cond: bool, detail: str = "") -> None:
    RESULTS.append((bool(cond), name + (f" — {detail}" if detail and not cond else "")))
    print(f"{'ok' if cond else 'FAIL'} {len(RESULTS)} - {name}" + (f" :: {detail}" if detail else ""))


def login(email: str) -> str:
    st, b = S.http("POST", f"{S.GOTRUE_URL}/token?grant_type=password",
                   {"email": email, "password": S.TEST_PASSWORD})
    assert st == 200, f"login {email}: {st} {b}"
    return b["access_token"]


def rpc(tok: str, name: str, args: dict):
    return S.http("POST", f"{S.PGRST_URL}/rpc/{name}", args,
                  {"Authorization": f"Bearer {tok}"})


def get(tok: str, path: str):
    return S.http("GET", f"{S.PGRST_URL}{path}", None, {"Authorization": f"Bearer {tok}"})


def sample_fields(tag: str, qty: int = 5) -> dict:
    return {"date": "2026-10-18", "vehicle": "TEST-34 ABC 01", "customer": "TEST-Müşteri Ümraniye",
            "work_type": "Hafriyat Nakliye", "quantity": qty, "unit": "Sefer", "note": f"TEST {tag}"}


def main() -> int:
    # yığın hazır (idempotent)
    subprocess.run([sys.executable, __file__.rsplit("/", 1)[0] + "/server_local_stack.py", "up"],
                   check=True, capture_output=True)

    sofor = login("test-sofor-1@example.invalid")
    ofis = login("test-ofis-1@example.invalid")
    yon1 = login("test-yonetici-1@example.invalid")
    yon2 = login("test-yonetici-2@example.invalid")
    rakip = login("test-rakip-sofor@example.invalid")

    # ---------- S1: şoför → ofis görünürlüğü ----------
    op1 = str(uuid.uuid4())
    st, b = rpc(sofor, "submit_work", {"p_op_key": op1, "p_fields": sample_fields("S1")})
    check("S1a submit created", st == 200 and b.get("result") == "created", f"{st} {b}")
    rid1 = b.get("report_id")
    st, rows = get(ofis, "/reports?state=eq.gonderildi&select=id")
    check("S1b ofis yeni bildirimi görür", st == 200 and any(r["id"] == rid1 for r in rows))
    st, rows = get(rakip, f"/reports?id=eq.{rid1}&select=id")
    check("S1c rakip şirket göremez", st == 200 and rows == [], f"{st} {rows}")

    # ---------- S4: aynı op aynı içerik → existing, tek bildirim ----------
    st, b = rpc(sofor, "submit_work", {"p_op_key": op1, "p_fields": sample_fields("S1")})
    check("S4a tekrar submit existing", st == 200 and b.get("result") == "existing", f"{st} {b}")
    st, rows = get(ofis, f"/reports?op_key=eq.{op1}&select=id")
    check("S4b tek bildirim satırı", st == 200 and len(rows) == 1, f"{rows}")

    # ---------- S4c: aynı op FARKLI içerik → OP_CONFLICT ----------
    st, b = rpc(sofor, "submit_work", {"p_op_key": op1, "p_fields": sample_fields("S1", qty=9)})
    check("S4c farklı içerik OP_CONFLICT", st == 400 and "OP_CONFLICT" in str(b), f"{st} {b}")

    # ---------- S5: yanıt kaybı simülasyonu — yeniden deneme tek kayıt ----------
    op5 = str(uuid.uuid4())
    st, b1 = rpc(sofor, "submit_work", {"p_op_key": op5, "p_fields": sample_fields("S5")})
    rid5 = b1.get("report_id")  # istemci bu yanıtı "kaybetti" say
    st, b2 = rpc(sofor, "submit_work", {"p_op_key": op5, "p_fields": sample_fields("S5")})
    st2, rows = get(ofis, f"/reports?op_key=eq.{op5}&select=id")
    check("S5 kayıp yanıt + retry → existing + tek satır",
          b2.get("result") == "existing" and b2.get("report_id") == rid5 and len(rows) == 1,
          f"{b2} {rows}")

    # ---------- S2: ofis kontrol → yönetici görünürlüğü ----------
    st, b = rpc(ofis, "start_check", {"p_report_id": rid1, "p_expected_version": 1})
    check("S2a start_check", st == 200 and b.get("state") == "kontrolde", f"{st} {b}")
    st, b = rpc(ofis, "complete_check", {"p_report_id": rid1, "p_expected_version": 2})
    check("S2b complete_check", st == 200 and b.get("state") == "onay_bekliyor", f"{st} {b}")
    st, rows = get(yon1, "/reports?state=eq.onay_bekliyor&select=id,checked_rev_no,rev_no")
    hit = [r for r in rows if r["id"] == rid1]
    check("S2c yönetici onay listesinde görür (kontrol revi ile)",
          st == 200 and hit and hit[0]["checked_rev_no"] == hit[0]["rev_no"], f"{rows}")

    # ---------- S3: onay → şoför durumu + tek iş ----------
    st, b = rpc(yon1, "approve_report", {"p_report_id": rid1, "p_expected_version": 3, "p_rev_no": 0})
    check("S3a approve", st == 200 and b.get("result") == "approved" and b.get("work_id"), f"{st} {b}")
    wid1 = b.get("work_id")
    st, rows = get(sofor, f"/reports?id=eq.{rid1}&select=state")
    check("S3b şoför Onaylandı görür", st == 200 and rows and rows[0]["state"] == "onaylandi", f"{rows}")
    st, rows = get(sofor, f"/works?report_id=eq.{rid1}&select=id")
    check("S3c şoför kendi iş kaydını görür", st == 200 and len(rows) == 1, f"{rows}")

    # ---------- S6: iki yönetici eşzamanlı onay → tek iş ----------
    op6 = str(uuid.uuid4())
    rpc(sofor, "submit_work", {"p_op_key": op6, "p_fields": sample_fields("S6")})
    st, rows = get(ofis, f"/reports?op_key=eq.{op6}&select=id,version")
    rid6, v = rows[0]["id"], rows[0]["version"]
    rpc(ofis, "start_check", {"p_report_id": rid6, "p_expected_version": v})
    rpc(ofis, "complete_check", {"p_report_id": rid6, "p_expected_version": v + 1})
    out: list[tuple[int, dict]] = []

    def approve_with(tok):
        out.append(rpc(tok, "approve_report", {"p_report_id": rid6, "p_expected_version": v + 2, "p_rev_no": 0}))

    t1, t2 = threading.Thread(target=approve_with, args=(yon1,)), threading.Thread(target=approve_with, args=(yon2,))
    t1.start(); t2.start(); t1.join(); t2.join()
    st, works = get(ofis, f"/works?op_key=eq.{op6}&select=id")
    ok_results = [b.get("result") for _, b in out if _ == 200]
    check("S6a eşzamanlı iki onay → tek iş satırı", len(works) == 1, f"{out} {works}")
    check("S6b biri approved diğeri existing (aynı work_id)",
          sorted(ok_results) == ["approved", "existing"] and
          len({b.get("work_id") for _, b in out if _ == 200}) == 1, f"{out}")

    # ---------- S7: kontrol sonrası içerik değişimi → eski rev onaylanamaz ----------
    op7 = str(uuid.uuid4())
    rpc(sofor, "submit_work", {"p_op_key": op7, "p_fields": sample_fields("S7")})
    st, rows = get(ofis, f"/reports?op_key=eq.{op7}&select=id,version")
    rid7, v = rows[0]["id"], rows[0]["version"]
    rpc(ofis, "start_check", {"p_report_id": rid7, "p_expected_version": v})
    rpc(ofis, "complete_check", {"p_report_id": rid7, "p_expected_version": v + 1})
    # ofis onay_bekliyor'daki kaydı düzeltir (T12) → kontrol geçersiz, kayıt kontrolde
    st, b = rpc(ofis, "edit_report", {"p_report_id": rid7,
                                      "p_fields": sample_fields("S7", qty=6),
                                      "p_reason": "TEST T12", "p_expected_version": v + 2})
    check("S7a onay bekleyende düzeltme → kontrolde", st == 200 and b.get("state") == "kontrolde", f"{st} {b}")
    st, b = rpc(yon1, "approve_report", {"p_report_id": rid7, "p_expected_version": v + 2, "p_rev_no": 0})
    check("S7b eski rev/durum onaylanamaz (BAD_STATE)", st == 400 and "BAD_STATE" in str(b), f"{st} {b}")
    st, works = get(ofis, f"/works?op_key=eq.{op7}&select=id")
    check("S7c iş kaydı oluşmadı", works == [], f"{works}")
    # ikinci tamamlama sonrası doğru rev ile onay başarılı (kontrol tazeliği kanıtı)
    st, rows = get(ofis, f"/reports?id=eq.{rid7}&select=version,rev_no")
    rpc(ofis, "complete_check", {"p_report_id": rid7, "p_expected_version": rows[0]["version"]})
    st, rows = get(ofis, f"/reports?id=eq.{rid7}&select=version,rev_no")
    st, b = rpc(yon1, "approve_report", {"p_report_id": rid7,
                                         "p_expected_version": rows[0]["version"], "p_rev_no": rows[0]["rev_no"]})
    check("S7d taze kontrol + doğru rev → onay", st == 200 and b.get("result") == "approved", f"{st} {b}")

    # ---------- S8: şoför approve çağırır → 403 ----------
    st, b = rpc(sofor, "approve_report", {"p_report_id": rid1, "p_expected_version": 99, "p_rev_no": 0})
    check("S8 şoför approve → 403 FORBIDDEN_ROLE", st == 403 and "FORBIDDEN_ROLE" in str(b), f"{st} {b}")

    # ---------- S9: rakip şirket kimliği bilse bile erişemez ----------
    st, b = rpc(rakip, "approve_report", {"p_report_id": rid1, "p_expected_version": 4, "p_rev_no": 0})
    check("S9a rakip approve → tek tip 403 (varlık sızıntısı yok)",
          st == 403 and "FORBIDDEN: kayıt yok veya erişim yok" in str(b), f"{st} {b}")
    st, rows = get(rakip, f"/works?report_id=eq.{rid1}&select=id")
    check("S9b rakip iş kaydını okuyamaz", st == 200 and rows == [], f"{st} {rows}")
    st, rows = get(rakip, f"/audit?report_id=eq.{rid1}&select=id")
    check("S9c rakip audit okuyamaz", st == 200 and rows == [], f"{st} {rows}")

    # ---------- S10: oturumsuz → 401 ----------
    st, b = get("GECERSIZ.TOKEN", "/reports?select=id")
    check("S10a sahte token GET → 401", st == 401, f"{st} {b}")
    st, b = rpc("GECERSIZ.TOKEN", "submit_work", {"p_op_key": str(uuid.uuid4()), "p_fields": {}})
    check("S10b sahte token RPC → 401", st == 401, f"{st} {b}")

    # ---------- Ek-A: doğrudan tablo yazımı reddedilir ----------
    st, b = S.http("POST", f"{S.PGRST_URL}/reports", {"op_key": "x", "fields": {}},
                   {"Authorization": f"Bearer {ofis}"})
    check("EkA1 ofis doğrudan reports insert → 403", st == 403, f"{st} {b}")
    st, b = S.http("PATCH", f"{S.PGRST_URL}/reports?id=eq.{rid1}", {"state": "reddedildi"},
                   {"Authorization": f"Bearer {ofis}"})
    check("EkA2 ofis doğrudan reports update → 403", st == 403, f"{st} {b}")
    st, b = S.http("DELETE", f"{S.PGRST_URL}/works?id=eq.{wid1}", None,
                   {"Authorization": f"Bearer {yon1}"})
    check("EkA3 yönetici doğrudan works delete → 403", st == 403, f"{st} {b}")

    # ---------- Ek-B: SAME_ACTOR şirket politikası ----------
    # yon1'e test-a'da ofis üyeliği ver (fikstür; SQL ile)
    S.psql("""insert into public.memberships (tenant_id, user_id, role, display_name)
              select tenant_id, user_id, 'ofis', 'TEST-Yönetici Bir (ofis)' from public.memberships
              where role='yonetici' and display_name='TEST-Yönetici Bir' on conflict do nothing""")
    opB = str(uuid.uuid4())
    rpc(sofor, "submit_work", {"p_op_key": opB, "p_fields": sample_fields("SAME")})
    st, rows = get(ofis, f"/reports?op_key=eq.{opB}&select=id,version")
    ridB, vB = rows[0]["id"], rows[0]["version"]
    rpc(yon1, "start_check", {"p_report_id": ridB, "p_expected_version": vB})        # yon1 ofis olarak
    rpc(yon1, "complete_check", {"p_report_id": ridB, "p_expected_version": vB + 1})
    st, b = rpc(yon1, "approve_report", {"p_report_id": ridB, "p_expected_version": vB + 2, "p_rev_no": 0})
    check("EkB1 kontrolü yapan onaylayamaz (SAME_ACTOR, politika kapalı)",
          st == 400 and "SAME_ACTOR" in str(b), f"{st} {b}")
    S.psql("update public.tenants set allow_same_actor_check_approve=true where slug='test-a'")
    st, b = rpc(yon1, "approve_report", {"p_report_id": ridB, "p_expected_version": vB + 2, "p_rev_no": 0})
    check("EkB2 politika açıkken aynı kişi onaylayabilir", st == 200 and b.get("result") == "approved", f"{st} {b}")
    S.psql("update public.tenants set allow_same_actor_check_approve=false where slug='test-a'")
    S.psql("""delete from public.memberships where display_name='TEST-Yönetici Bir (ofis)'""")

    # ---------- S12: transaction ortası hata → kısmi kalıntı yok ----------
    op12 = str(uuid.uuid4())
    rpc(sofor, "submit_work", {"p_op_key": op12, "p_fields": sample_fields("S12")})
    st, rows = get(ofis, f"/reports?op_key=eq.{op12}&select=id,version")
    rid12, v12 = rows[0]["id"], rows[0]["version"]
    rpc(ofis, "start_check", {"p_report_id": rid12, "p_expected_version": v12})
    rpc(ofis, "complete_check", {"p_report_id": rid12, "p_expected_version": v12 + 1})
    # fikstür: audit'e bilerek patlayan tetik (yalnız bu rapor için)
    S.psql("""create or replace function public.test_fail_audit() returns trigger
              language plpgsql as $f$ begin
                if new.report_id = '%s' then raise exception 'TEST_TX_FAILURE'; end if;
                return new; end $f$""" % rid12)
    S.psql("""create trigger test_fail_audit_trg before insert on public.audit
              for each row execute function public.test_fail_audit()""")
    st, b = rpc(yon2, "approve_report", {"p_report_id": rid12, "p_expected_version": v12 + 2, "p_rev_no": 0})
    check("S12a onay ortasında hata → istek başarısız", st != 200, f"{st} {b}")
    st, rows = get(ofis, f"/works?report_id=eq.{rid12}&select=id")
    works_left = rows
    st, rows = get(ofis, f"/approvals?report_id=eq.{rid12}&select=id")
    appr_left = rows
    st, rows = get(ofis, f"/reports?id=eq.{rid12}&select=state,approved_by")
    rep12 = rows[0]
    check("S12b iş+onay+durum hiçbiri yazılmadı (tek tx geri döndü)",
          works_left == [] and appr_left == [] and rep12["state"] == "onay_bekliyor"
          and rep12["approved_by"] is None, f"{works_left} {appr_left} {rep12}")
    S.psql("drop trigger if exists test_fail_audit_trg on public.audit; drop function if exists public.test_fail_audit()")
    st, b = rpc(yon2, "approve_report", {"p_report_id": rid12, "p_expected_version": v12 + 2, "p_rev_no": 0})
    check("S12c tetik kalkınca aynı onay temiz başarılı", st == 200 and b.get("result") == "approved", f"{st} {b}")

    failed = [n for ok, n in RESULTS if not ok]
    print(f"\n{'PASS' if not failed else 'FAIL'} — {len(RESULTS) - len(failed)}/{len(RESULTS)} senaryo")
    for n in failed:
        print("  FAIL:", n)
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
