#!/usr/bin/env python3
"""SAHAPRO YZ2 — yedek / geri yükleme / wipe koruması kanıt testi.

Görev maddesi 6: "'wipe' geri dönüş değildir; veri silmedir."
Ayrılan kavramlar ve kanıtları:
  Y1  test ortamı sıfırlama (seed) — geliştirme kolaylığı, geri dönüş değil
  Y2  servis durdurma (down) — veri durur, süreçler durur; geri dönüş değil
  Y3  YEDEK: örnek veriyle pg_dump → dosya
  Y4  GERİ YÜKLEME: dump FARKLI, boş bir DB'ye yüklenir; rapor/onay/audit
      ilişkileri birebir karşılaştırılır (satır satır JSON eşitliği)
  Y5  wipe koruması: onaysız çalışmaz; TEST_ORTAMI işareti yoksa reddeder
  Y6  ileri-düzeltme (forward-fix) kavramı: migration'lar idempotent'dir —
      aynı sürümü tekrar uygulamak durumu bozmaz (yeniden kurulum kanıtı)

Çıkış: TAP benzeri satırlar + PASS/FAIL özeti.
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
import uuid

sys.path.insert(0, __file__.rsplit("/", 1)[0])
import server_local_stack as S  # noqa: E402

RESULTS: list[tuple[bool, str]] = []
DUMP = "/tmp/yz2_yedek_test.dump"
TARGET = "yz2_geri_yukle"


def check(name: str, cond: bool, detail: str = "") -> None:
    RESULTS.append((bool(cond), name + (f" — {detail}" if detail and not cond else "")))
    print(f"{'ok' if cond else 'FAIL'} {len(RESULTS)} - {name}" + (f" :: {detail}" if detail else ""))


def login(email: str) -> str:
    st, b = S.http("POST", f"{S.GOTRUE_URL}/token?grant_type=password",
                   {"email": email, "password": S.TEST_PASSWORD})
    assert st == 200, f"login {email}: {st} {b}"
    return b["access_token"]


def rpc(tok: str, name: str, args: dict):
    return S.http("POST", f"{S.PGRST_URL}/rpc/{name}", args, {"Authorization": f"Bearer {tok}"})


def jrows(db: str, table: str, cols: str, order: str) -> str:
    """Tabloyu JSON dizisi olarak döndürür (karşılaştırma için deterministik)."""
    return S.psql(
        f"select coalesce(json_agg(t order by {order})::text, '[]') "
        f"from (select {cols} from public.{table}) t",
        db=db, extra=["-tA"]).stdout.strip()


def main() -> int:
    subprocess.run([sys.executable, __file__.rsplit("/", 1)[0] + "/server_local_stack.py", "up"],
                   check=True, capture_output=True)

    # ---------- örnek veri: gerçek RPC akışıyla üret ----------
    sofor = login("test-sofor-1@example.invalid")
    ofis = login("test-ofis-1@example.invalid")
    yon1 = login("test-yonetici-1@example.invalid")
    tag = uuid.uuid4().hex[:8]
    fld = {"date": "2026-10-18", "vehicle": "TEST-34 ABC 01", "customer": "TEST-Müşteri Ümraniye",
           "work_type": "Hafriyat Nakliye", "quantity": 4, "unit": "Sefer", "note": f"TEST YEDEK {tag}"}
    st, b = rpc(sofor, "submit_work", {"p_op_key": f"YEDEK-{tag}-1", "p_fields": fld})
    rid_ok = b.get("report_id")
    rpc(ofis, "start_check", {"p_report_id": rid_ok, "p_expected_version": 1})
    rpc(ofis, "complete_check", {"p_report_id": rid_ok, "p_expected_version": 2})
    st, b = rpc(yon1, "approve_report", {"p_report_id": rid_ok, "p_expected_version": 3, "p_rev_no": 0})
    wid_ok = b.get("work_id")
    check("Y0a örnek akış: onaylı iş üretildi", st == 200 and wid_ok, f"{st} {b}")
    st, b = rpc(sofor, "submit_work", {"p_op_key": f"YEDEK-{tag}-2", "p_fields": {**fld, "quantity": 7}})
    rid_fix = b.get("report_id")
    rpc(ofis, "start_check", {"p_report_id": rid_fix, "p_expected_version": 1})
    st, b = rpc(ofis, "request_fix", {"p_report_id": rid_fix, "p_reason": "TEST miktar şüpheli",
                                      "p_expected_version": 2})
    check("Y0b örnek akış: düzeltme istenmiş rapor üretildi", st == 200, f"{st} {b}")

    # ---------- Y3: yedek ----------
    if os.path.exists(DUMP):
        os.remove(DUMP)
    S.backup(DUMP)
    check("Y3 yedek dosyası oluştu ve boş değil",
          os.path.exists(DUMP) and os.path.getsize(DUMP) > 4000,
          f"{os.path.getsize(DUMP) if os.path.exists(DUMP) else 'yok'} bayt")

    # ---------- Y4: farklı/boş DB'ye geri yükleme + ilişki karşılaştırması ----------
    S.restore(DUMP, TARGET)
    pairs = [
        ("tenants", "id, slug, name, allow_same_actor_check_approve", "id"),
        ("memberships", "tenant_id, user_id, role, display_name", "tenant_id, role"),
        ("reports", "id, tenant_id, driver_id, op_key, state, fields, rev_no, checked_rev_no, "
                    "check_revoked, fingerprint", "id"),
        ("revisions", "report_id, rev_no, fields, edited_by, reason", "report_id, rev_no"),
        ("works", "id, tenant_id, report_id, op_key, fields, source_rev_no, status", "id"),
        ("approvals", "id, tenant_id, op_key, report_id, rev_no, snapshot, actor_id", "id"),
        ("audit", "tenant_id, report_id, actor_id, role, action, from_state, to_state, reason",
                   "report_id, action"),
    ]
    for table, cols, order in pairs:
        a = jrows(S.DB, table, cols, order)
        c = jrows(TARGET, table, cols, order)
        check(f"Y4-{table} birebir eşit", a == c,
              f"kaynak {len(a)}b vs hedef {len(c)}b")

    # ilişki bütünlüğü: geri yüklenen DB'de onay→iş→rapor zinciri kopuksuz
    orphan_w = S.psql("select count(*) from public.works w "
                      "left join public.reports r on r.id = w.report_id where r.id is null",
                      db=TARGET, extra=["-tA"]).stdout.strip()
    orphan_a = S.psql("select count(*) from public.approvals ap "
                      "left join public.reports r on r.id = ap.report_id where r.id is null",
                      db=TARGET, extra=["-tA"]).stdout.strip()
    orphan_au = S.psql("select count(*) from public.audit au "
                       "left join public.reports r on r.id = au.report_id where r.id is null",
                       db=TARGET, extra=["-tA"]).stdout.strip()
    check("Y4-ilişki works→reports kopsuz", orphan_w == "0", orphan_w)
    check("Y4-ilişki approvals→reports kopsuz", orphan_a == "0", orphan_a)
    check("Y4-ilişki audit→reports kopsuz", orphan_au == "0", orphan_au)
    # örnek onaylı iş geri yüklenen DB'de aynı kimliklerle duruyor
    hit = S.psql(f"select state from public.reports where id='{rid_ok}'",
                 db=TARGET, extra=["-tA"]).stdout.strip()
    hitw = S.psql(f"select report_id from public.works where id='{wid_ok}'",
                  db=TARGET, extra=["-tA"]).stdout.strip()
    check("Y4-örnek onaylı rapor + iş aynı kimlikle geri yüklendi",
          hit == "onaylandi" and hitw == rid_ok, f"{hit} {hitw}")

    # ---------- Y5: wipe koruması ----------
    r = subprocess.run([sys.executable, S.__file__, "wipe"], capture_output=True, text=True)
    alive = S.psql("select 1", db="postgres", extra=["-tA"]).stdout.strip() == "1"
    check("Y5a wipe onaysız reddedilir ve veri durur",
          r.returncode != 0 and alive, f"rc={r.returncode} alive={alive}")
    marker = os.path.join(S.RUN, "TEST_ORTAMI")
    backup_marker = marker + ".sakla"
    os.rename(marker, backup_marker)
    try:
        r = subprocess.run([sys.executable, S.__file__, "wipe", "--evet"],
                           capture_output=True, text=True)
        alive = S.psql("select 1", db="postgres", extra=["-tA"]).stdout.strip() == "1"
        check("Y5b TEST_ORTAMI işareti olmadan --evet bile reddedilir",
              r.returncode != 0 and alive, f"rc={r.returncode} alive={alive}")
    finally:
        os.rename(backup_marker, marker)

    # ---------- Y6: forward-fix — migration'lar idempotent ----------
    before = jrows(S.DB, "reports", "id, state", "id")
    for f in ["0010_schema.sql", "0020_rls.sql", "0030_rpc.sql", "0040_denetim_sertlestirme.sql"]:
        S.psql_file(os.path.join(S.MIG, f))
    after = jrows(S.DB, "reports", "id, state", "id")
    check("Y6 migration'ların tekrar uygulanması veriyi bozmaz (idempotent)",
          before == after)

    # temizlik: geri yükleme hedefini kaldır
    S.psql(f'drop database if exists "{TARGET}"', db="postgres")

    ok = sum(1 for c, _ in RESULTS if c)
    print(f"\n{'PASS' if ok == len(RESULTS) else 'FAIL'} — {ok}/{len(RESULTS)} yedek kontrolü")
    return 0 if ok == len(RESULTS) else 1


if __name__ == "__main__":
    sys.exit(main())
